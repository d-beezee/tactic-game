import { randomUUID } from 'node:crypto';
import { campaignErrors, LIMITS, MAX_MISSION_GOLD, parseChapter, parseMap, parseMissionEnemies, parseRecruit, type User } from '@tactics/core';
import type { Context, MiddlewareHandler } from 'hono';
import type pg from 'pg';
import { tx } from '../db';
import { body, HttpError, isUuid, nameField, sqlRow, type App, type Env } from '../http';
import { BUILTIN_MAP, findMap, listChapters, listMaps, listMissions, listMusic, trackId } from '../queries';

const MUSIC_SLOTS = ['menu', 'battle'];

/** Admin only; checked on every request so a removed admin loses access at once. */
export const requireAdmin = (pool: pg.Pool): MiddlewareHandler<Env> => async (c, next) => {
  const { rows } = await pool.query('SELECT is_admin FROM users WHERE id = $1', [c.get('userId')]);
  if (!rows[0]?.is_admin) throw new HttpError(403, 'Riservato all\'admin');
  await next();
};

/** The Workshop: users, maps, missions, campaign chapters and music. */
export function adminRoutes(app: App, pool: pg.Pool) {
  const listUsers = async (): Promise<User[]> =>
    (await pool.query('SELECT id, email, is_admin AS admin, created_at AS "createdAt" FROM users ORDER BY created_at, id')).rows;

  app.get('/api/admin/users', async c => c.json(await listUsers()));

  app.patch('/api/admin/users/:id', async c => {
    const { admin } = await body(c);
    const id = c.req.param('id');
    if (typeof admin !== 'boolean' || !isUuid(id)) throw new HttpError(400, 'Richiesta non valida');
    // an admin cannot demote themselves, so there is always at least one
    if (id === c.get('userId')) throw new HttpError(400, 'Non puoi togliere il ruolo a te stesso');
    const { rowCount } = await pool.query('UPDATE users SET is_admin = $2 WHERE id = $1', [id, admin]);
    if (!rowCount) throw new HttpError(404, 'Utente non trovato');
    return c.json(await listUsers());
  });

  app.put('/api/admin/maps/:id', async c => {
    const map = parseMap(await body(c));
    const id = c.req.param('id');
    if (!map || map.id !== id) throw new HttpError(400, 'Mappa non valida');
    if (!/^[\w-]{1,64}$/.test(id) || id === BUILTIN_MAP.id) throw new HttpError(400, 'Id della mappa non valido');
    map.name = nameField(map.name);
    await pool.query('INSERT INTO maps (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = now()', [id, JSON.stringify(map)]);
    return c.json(await listMaps(pool));
  });

  app.delete('/api/admin/maps/:id', async c => {
    const { rows: [used] } = await pool.query('SELECT name FROM missions WHERE map_id = $1 LIMIT 1', [c.req.param('id')]);
    if (used) throw new HttpError(409, `La mappa è usata dalla missione "${used.name}": elimina prima la missione`);
    const { rows: [inCampaign] } = await pool.query('SELECT title FROM chapters WHERE map_id = $1 LIMIT 1', [c.req.param('id')]);
    if (inCampaign) throw new HttpError(409, `La mappa è usata dal capitolo "${inCampaign.title}": cambia prima la mappa del capitolo`);
    await pool.query('DELETE FROM maps WHERE id = $1', [c.req.param('id')]);
    return c.json(await listMaps(pool));
  });

  /** The mission's columns, checked. */
  const missionBody = async (c: Context) => {
    const b = await body(c);
    const name = nameField(b.name);
    if (!Number.isInteger(b.gold) || b.gold < 0 || b.gold > MAX_MISSION_GOLD) throw new HttpError(400, `L'oro deve essere un intero tra 0 e ${MAX_MISSION_GOLD}`);
    const map = await findMap(pool, b.mapId);
    if (!map) throw new HttpError(400, 'Mappa non trovata');
    const enemies = parseMissionEnemies(map, b.enemies);
    const recruit = parseRecruit(b.recruit);
    return { name, map_id: b.mapId, gold: b.gold, enemies: JSON.stringify(enemies), recruit: recruit && JSON.stringify(recruit), track_id: await trackId(pool, b.trackId) };
  };

  app.post('/api/admin/missions', async c => {
    const m = sqlRow(await missionBody(c), 1);
    await pool.query(`INSERT INTO missions (${m.cols}) VALUES (${m.params})`, m.values);
    return c.json(await listMissions(pool, c.get('userId')));
  });

  // today's wins stay: a player who already won it does not get paid again for the edited mission
  app.put('/api/admin/missions/:id', async c => {
    const id = c.req.param('id');
    if (!isUuid(id)) throw new HttpError(404, 'Missione non trovata');
    const m = sqlRow(await missionBody(c), 2);
    const { rowCount } = await pool.query(`UPDATE missions SET ${m.set} WHERE id = $1`, [id, ...m.values]);
    if (!rowCount) throw new HttpError(404, 'Missione non trovata');
    return c.json(await listMissions(pool, c.get('userId')));
  });

  app.delete('/api/admin/missions/:id', async c => {
    const id = c.req.param('id');
    if (isUuid(id)) await pool.query('DELETE FROM missions WHERE id = $1', [id]);
    return c.json(await listMissions(pool, c.get('userId')));
  });

  /** Runs a change to the campaign; it is undone if the campaign, in its new order, no longer holds together. */
  const campaignChange = (fn: (db: pg.PoolClient) => Promise<unknown>) => tx(pool, async db => {
    await db.query('LOCK TABLE chapters IN EXCLUSIVE MODE');
    await fn(db);
    const chapters = await listChapters(db);
    const [problem] = campaignErrors(chapters);
    if (problem) throw new HttpError(400, problem);
    return chapters;
  });

  const chapterBody = async (c: Context) => {
    const b = await body(c);
    const map = await findMap(pool, b.mapId);
    if (!map || b.mapId === BUILTIN_MAP.id) throw new HttpError(400, 'Mappa non trovata');
    return { mapId: b.mapId as string, ch: parseChapter(map, b) };
  };
  /** A chapter's columns, placeholders from $2 ($1 is its id). */
  const chapterRow = (mapId: string, ch: ReturnType<typeof parseChapter>, unlockId: string) => sqlRow({
    label: ch.label, title: ch.title, blurb: ch.blurb, map_id: mapId, gold: ch.gold, enemies: JSON.stringify(ch.enemies), goal: JSON.stringify(ch.goal),
    required: JSON.stringify(ch.required), unlock: ch.unlock && JSON.stringify({ id: unlockId, ...ch.unlock }), crt: ch.crt,
    before: JSON.stringify(ch.before), after: JSON.stringify(ch.after),
  }, 2);

  app.post('/api/admin/chapters', async c => {
    const { mapId, ch } = await chapterBody(c);
    return c.json(await campaignChange(async db => {
      const id = randomUUID(), row = chapterRow(mapId, ch, `u-${id}`);
      await db.query(
        `INSERT INTO chapters (id, position, ${row.cols}) VALUES ($1, (SELECT coalesce(max(position) + 1, 0) FROM chapters), ${row.params})`,
        [id, ...row.values]);
    }));
  });

  // the unlock keeps its id, so the chapters that require it and the rosters that hold it stay valid
  app.put('/api/admin/chapters/:id', async c => {
    const { mapId, ch } = await chapterBody(c), id = c.req.param('id');
    return c.json(await campaignChange(async db => {
      const { rows: [old] } = await db.query('SELECT unlock FROM chapters WHERE id = $1', [id]);
      if (!old) throw new HttpError(404, 'Capitolo non trovato');
      const row = chapterRow(mapId, ch, old.unlock?.id ?? `u-${id}`);
      await db.query(`UPDATE chapters SET ${row.set} WHERE id = $1`, [id, ...row.values]);
    }));
  });

  app.post('/api/admin/chapters/:id/move', async c => {
    const { dir } = await body(c), id = c.req.param('id');
    if (dir !== -1 && dir !== 1) throw new HttpError(400, 'Richiesta non valida');
    return c.json(await campaignChange(async db => {
      const ids = (await db.query('SELECT id FROM chapters ORDER BY position, id')).rows.map(r => r.id as string);
      const i = ids.indexOf(id), j = i + dir;
      if (i < 0) throw new HttpError(404, 'Capitolo non trovato');
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await db.query('UPDATE chapters SET position = array_position($1::text[], id) - 1', [ids]);
    }));
  });

  // campaign_wins rows stay: a player who won it keeps the next chapter open only if it follows one they won
  app.delete('/api/admin/chapters/:id', async c =>
    c.json(await campaignChange(db => db.query('DELETE FROM chapters WHERE id = $1', [c.req.param('id')]))));

  // the code runs in every player's browser: only admins can save it
  const trackBody = async (c: Context) => {
    const b = await body(c);
    const name = nameField(b.name);
    if (typeof b.code !== 'string' || !b.code.trim() || b.code.length > LIMITS.trackCode) throw new HttpError(400, `Il codice deve avere tra 1 e ${LIMITS.trackCode} caratteri`);
    return { name, code: b.code };
  };

  app.post('/api/admin/tracks', async c => {
    const t = await trackBody(c);
    await pool.query('INSERT INTO tracks (name, code) VALUES ($1, $2)', [t.name, t.code]);
    return c.json(await listMusic(pool));
  });

  app.put('/api/admin/tracks/:id', async c => {
    const id = c.req.param('id');
    if (!isUuid(id)) throw new HttpError(404, 'Musica non trovata');
    const t = await trackBody(c);
    const { rowCount } = await pool.query('UPDATE tracks SET name = $2, code = $3 WHERE id = $1', [id, t.name, t.code]);
    if (!rowCount) throw new HttpError(404, 'Musica non trovata');
    return c.json(await listMusic(pool));
  });

  // its slots go empty and its missions fall back to the battle music
  app.delete('/api/admin/tracks/:id', async c => {
    const id = c.req.param('id');
    if (isUuid(id)) await pool.query('DELETE FROM tracks WHERE id = $1', [id]);
    return c.json(await listMusic(pool));
  });

  app.put('/api/admin/music/:slot', async c => {
    const slot = c.req.param('slot');
    if (!MUSIC_SLOTS.includes(slot)) throw new HttpError(404, 'Non trovato');
    const id = await trackId(pool, (await body(c)).trackId);
    if (id) await pool.query('INSERT INTO music_slots VALUES ($1, $2) ON CONFLICT (slot) DO UPDATE SET track_id = $2', [slot, id]);
    else await pool.query('DELETE FROM music_slots WHERE slot = $1', [slot]);
    return c.json(await listMusic(pool));
  });
}
