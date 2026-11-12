import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { serveStatic } from '@hono/node-server/serve-static';
import { activeUnit, apply, buyItem, chapterById, chapterOpen, chapterUnits, createBattle, deployTeam, deployTestBattle, PVP_LEVEL, missionUnits, parseMissionEnemies, payBattle, replayTestBattle, newPlayer, parseMap, parseRoster, PlayerError, updateUnit, type BattleAction, type MapData, type Player } from '@tactics/core';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import type pg from 'pg';
import builtinMap from '../../client/src/maps/demo.json';

const BUILTIN_MAP = parseMap(builtinMap)!;
import { ensureAdmin, tx } from './db';

const COOKIE = 'sid';
const SESSION_DAYS = 30;
const MAX_FAILS = 10, FAIL_WINDOW_MS = 15 * 60_000;
const MAX_MISSION_GOLD = 10_000;
const MAX_TRACK_CODE = 20_000;
const MUSIC_SLOTS = ['menu', 'battle'];
/** The game's day, for daily missions: midnight in Italy, whatever the server's time zone. */
const TODAY = `(now() AT TIME ZONE 'Europe/Rome')::date`;
/** A PvP player not heard from for this long loses; a lobby player this stale is not matched. */
const PVP_GONE_SECONDS = 45, PVP_LOBBY_SECONDS = 10;
const PVP_MAX_ACTIONS = 2000;
// no 0/O, 1/I/L: the code is read aloud and typed on phones
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(randomBytes(6), b => CODE_CHARS[b % CODE_CHARS.length]).join('');

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${(await scryptAsync(pw, salt, 64)).toString('hex')}`;
}

async function checkPassword(pw: string, stored: string) {
  const [salt, hash] = stored.split(':').map(h => Buffer.from(h, 'hex'));
  return timingSafeEqual(hash, await scryptAsync(pw, salt, 64));
}

/** JSON with sorted keys: jsonb does not keep the key order it was given. */
const canon = (v: unknown) => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x);
const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);

/** Request the client got wrong; the message is shown to the player. */
class HttpError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 429, message: string) { super(message); }
}

function credentials(body: any) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Email non valida');
  // the upper bound keeps scrypt from hashing huge inputs
  if (password.length < 8 || password.length > 200) throw new HttpError(400, 'La password deve avere tra 8 e 200 caratteri');
  return { email, password };
}

export function createApp(pool: pg.Pool, staticDir: string) {
  const app = new Hono<{ Variables: { userId: string } }>();

  // shortcut: failed logins are counted in memory, per address and email; move to the database with more than one server instance.
  const fails = new Map<string, { n: number; until: number }>();

  const body = (c: Context) => c.req.json().catch(() => { throw new HttpError(400, 'Richiesta non valida'); });

  async function openSession(c: Context, userId: string) {
    const token = randomBytes(32).toString('base64url');
    await pool.query(`INSERT INTO sessions VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [sha256(token), userId]);
    setCookie(c, COOKIE, token, {
      httpOnly: true, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86_400,
      // TLS ends at the proxy, which sets this header
      secure: c.req.header('x-forwarded-proto') === 'https',
    });
  }

  /** Inside a transaction: loads the player with a row lock, applies a pure core function, saves the result. */
  async function mutateIn<T extends { player: Player }>(db: pg.PoolClient, userId: string, fn: (p: Player) => T) {
    const { rows } = await db.query('SELECT gold, roster, inventory FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const out = fn(rows[0]);
    await db.query('UPDATE users SET gold = $2, roster = $3, inventory = $4 WHERE id = $1',
      [userId, out.player.gold, JSON.stringify(out.player.roster), JSON.stringify(out.player.inventory)]);
    return out;
  }
  const mutate = <T extends { player: Player }>(userId: string, fn: (p: Player) => T) => tx(pool, db => mutateIn(db, userId, fn));

  app.onError((e, c) => {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status);
    if (e instanceof PlayerError) return c.json({ error: e.message }, 400);
    if (e instanceof HTTPException) return c.json({ error: 'Richiesta rifiutata' }, e.status); // csrf, body limit
    console.error(e);
    return c.json({ error: 'Errore del server' }, 500);
  });

  app.get('/api/health', async c => {
    await pool.query('SELECT 1');
    return c.json({ ok: true });
  });

  // the API only reads JSON bodies; csrf() rejects cross-site form posts, the only ones a browser sends without a preflight
  app.use('/api/*', csrf(), bodyLimit({ maxSize: 256 * 1024 }));

  app.post('/api/auth/register', async c => {
    const b = await body(c);
    const { email, password } = credentials(b);
    // progress made before accounts existed comes along; parseRoster rejects anything malformed
    const p = newPlayer(parseRoster(b.roster) ?? undefined);
    const { rows } = await pool.query(
      'INSERT INTO users (email, password_hash, gold, roster, inventory) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING RETURNING id',
      [email, await hashPassword(password), p.gold, JSON.stringify(p.roster), JSON.stringify(p.inventory)]);
    if (!rows[0]) throw new HttpError(409, 'Email già registrata');
    await ensureAdmin(pool);
    const { rows: [{ admin }] } = await pool.query('SELECT is_admin AS admin FROM users WHERE id = $1', [rows[0].id]);
    await openSession(c, rows[0].id);
    return c.json({ email, admin, ...p });
  });

  app.post('/api/auth/login', async c => {
    const { email, password } = credentials(await body(c));
    const key = `${c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? ''}|${email}`;
    const f = fails.get(key);
    if (f && f.until > Date.now() && f.n >= MAX_FAILS) throw new HttpError(429, 'Troppi tentativi. Riprova tra qualche minuto.');
    const { rows } = await pool.query('SELECT id, password_hash, is_admin AS admin, gold, roster, inventory FROM users WHERE email = $1', [email]);
    if (!rows[0] || !(await checkPassword(password, rows[0].password_hash))) {
      if (fails.size > 10_000) fails.clear(); // bound memory under a flood of made-up emails
      fails.set(key, { n: f && f.until > Date.now() ? f.n + 1 : 1, until: Date.now() + FAIL_WINDOW_MS });
      throw new HttpError(401, 'Email o password sbagliate');
    }
    fails.delete(key);
    await openSession(c, rows[0].id);
    const { admin, gold, roster, inventory } = rows[0];
    return c.json({ email, admin, gold, roster, inventory });
  });

  app.post('/api/auth/logout', async c => {
    const token = getCookie(c, COOKIE);
    if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  // everything below needs a session
  app.use('/api/*', async (c, next) => {
    const token = getCookie(c, COOKIE);
    const { rows } = token
      ? await pool.query('SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()', [sha256(token)])
      : { rows: [] };
    if (!rows[0]) throw new HttpError(401, 'Accedi per continuare');
    c.set('userId', rows[0].user_id);
    await next();
  });

  app.get('/api/me', async c => {
    const { rows } = await pool.query('SELECT email, is_admin AS admin, gold, roster, inventory FROM users WHERE id = $1', [c.get('userId')]);
    return c.json(rows[0]);
  });

  app.patch('/api/units/:id', async c => {
    const change = await body(c);
    return c.json((await mutate(c.get('userId'), p => ({ player: updateUnit(p, c.req.param('id'), change) }))).player);
  });

  app.post('/api/shop/buy', async c => {
    const { itemId } = await body(c);
    return c.json((await mutate(c.get('userId'), p => ({ player: buyItem(p, itemId) }))).player);
  });

  // The server hands out the battle (seed and starting units) and later replays the player's actions:
  // XP and gold come from that replay, never from what the client says happened.
  app.post('/api/battles', async c => {
    const b = await body(c);
    const userId = c.get('userId');
    const { rows: [user] } = await pool.query('SELECT roster FROM users WHERE id = $1', [userId]);
    let map: MapData | undefined, units, missionId = null, chapterId = null;
    if (b.chapterId !== undefined) {
      // a campaign chapter: map, enemies and goal all come from the core's CAMPAIGN
      const ch = chapterById(b.chapterId);
      if (!ch) throw new HttpError(404, 'Capitolo non trovato');
      if (!chapterOpen(await clearedChapters(userId), ch.id)) throw new HttpError(400, 'Capitolo ancora chiuso: vinci prima quello prima');
      [map, units, chapterId] = [ch.map, chapterUnits(user.roster, ch, b.deploy), ch.id];
    } else {
      // a mission brings its own map; the map always comes from the server's copy, never from the client
      let mapId = b.mapId, mission: { id: string; enemies: unknown } | null = null;
      if (b.missionId !== undefined) {
        const { rows: [m] } = isUuid(b.missionId) ? await pool.query('SELECT id, map_id, enemies FROM missions WHERE id = $1', [b.missionId]) : { rows: [] };
        if (!m) throw new HttpError(404, 'Missione non trovata');
        [mapId, mission] = [m.map_id, m];
      }
      map = await findMap(mapId);
      if (!map) throw new HttpError(404, 'Mappa non trovata');
      // checked again here: the map may have been edited since the mission was made
      units = deployTestBattle(user.roster, map, b.deploy, mission ? missionUnits(parseMissionEnemies(map, mission.enemies)) : undefined);
      missionId = mission?.id ?? null;
    }
    const seed = randomBytes(4).readUInt32BE();
    return c.json(await tx(pool, async db => {
      // one battle at a time: starting a new one drops the old ones, finished or abandoned
      await db.query('DELETE FROM battles WHERE user_id = $1', [userId]);
      const { rows } = await db.query('INSERT INTO battles (user_id, seed, map, units, mission_id, chapter_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [userId, seed, JSON.stringify(map), JSON.stringify(units), missionId, chapterId]);
      return { id: rows[0].id, seed, units };
    }));
  });

  app.post('/api/battles/:id/finish', async c => {
    const { actions } = await body(c);
    const id = c.req.param('id'), userId = c.get('userId');
    if (!isUuid(id)) throw new HttpError(404, 'Battaglia non trovata');
    return c.json(await tx(pool, async db => {
      const { rows: [battle] } = await db.query('SELECT seed, map, units, result, mission_id, chapter_id FROM battles WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, userId]);
      if (!battle) throw new HttpError(404, 'Battaglia non trovata: ne hai iniziata un\'altra?');
      // a retry after a lost response gets the same answer and no second payout
      if (battle.result) return battle.result;
      const ch = battle.chapter_id ? chapterById(battle.chapter_id) : undefined;
      const end = replayTestBattle(battle.map, battle.units, Number(battle.seed), actions, ch?.goal, ch?.required);
      const won = end.winner === 'A';
      if (ch) {
        // a chapter pays and unlocks its unit on the first win only; the insert is the check
        const { rowCount } = won ? await db.query('INSERT INTO campaign_wins (user_id, chapter_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, ch.id]) : { rowCount: 0 };
        const out = rowCount
          ? { ...await mutateIn(db, userId, p => {
              const r = payBattle(p, battle.units, end, ch.gold);
              const unlock = ch.unlock && !r.player.roster.some(u => u.id === ch.unlock!.id) ? ch.unlock : undefined;
              return { ...r, player: unlock ? { ...r.player, roster: [...r.player.roster, unlock] } : r.player, unlocked: unlock?.name ?? null };
            }), won, paid: true }
          : { report: [], gold: 0, won, paid: false, unlocked: null };
        await db.query('UPDATE battles SET result = $2 WHERE id = $1', [id, JSON.stringify(out)]);
        return out;
      }
      // only a mission won for the first time today pays; the insert is the once-a-day check
      const { rows: [paid] } = won && battle.mission_id ? await db.query(
        `INSERT INTO mission_wins (user_id, mission_id, day) SELECT $1, id, ${TODAY} FROM missions WHERE id = $2
         ON CONFLICT DO NOTHING RETURNING (SELECT gold FROM missions WHERE id = $2)`, [userId, battle.mission_id]) : { rows: [] };
      const out = paid
        ? { ...await mutateIn(db, userId, p => payBattle(p, battle.units, end, paid.gold)), won, paid: true }
        : { report: [], gold: 0, won, paid: false };
      await db.query('UPDATE battles SET result = $2 WHERE id = $1', [id, JSON.stringify(out)]);
      return out;
    }));
  });

  /** The built-in map or a saved one, by id. */
  const findMap = async (id: unknown): Promise<MapData | undefined> =>
    id === BUILTIN_MAP.id ? BUILTIN_MAP
      : typeof id === 'string' ? (await pool.query('SELECT data FROM maps WHERE id = $1', [id])).rows[0]?.data
      : undefined;

  const listMissions = async (userId: string) => (await pool.query(
    `SELECT m.id, m.name, m.map_id AS "mapId", m.gold, m.enemies, m.track_id AS "trackId",
       EXISTS (SELECT 1 FROM mission_wins w WHERE w.mission_id = m.id AND w.user_id = $1 AND w.day = ${TODAY}) AS done
     FROM missions m ORDER BY m.created_at, m.id`, [userId])).rows;

  app.get('/api/missions', async c => c.json(await listMissions(c.get('userId'))));

  const clearedChapters = async (userId: string): Promise<string[]> =>
    (await pool.query('SELECT chapter_id FROM campaign_wins WHERE user_id = $1', [userId])).rows.map(r => r.chapter_id);

  app.get('/api/campaign', async c => c.json({ cleared: await clearedChapters(c.get('userId')) }));

  const listMaps = async () => (await pool.query("SELECT data FROM maps ORDER BY data->>'name', id")).rows.map(r => r.data as MapData);

  app.get('/api/maps', async c => c.json(await listMaps()));

  /** Every track with its code (players need it to play), and the track chosen for each slot. */
  const listMusic = async () => {
    const [{ rows: tracks }, { rows: slots }] = await Promise.all([
      pool.query('SELECT id, name, code FROM tracks ORDER BY name, id'),
      pool.query('SELECT slot, track_id FROM music_slots'),
    ]);
    const chosen = (slot: string) => slots.find(s => s.slot === slot)?.track_id ?? null;
    return { tracks, menu: chosen('menu'), battle: chosen('battle') };
  };

  app.get('/api/music', async c => c.json(await listMusic()));

  /** null, or the id of a saved track; anything else is refused. */
  const trackId = async (id: unknown) => {
    if (id === null || id === undefined) return null;
    if (isUuid(id) && (await pool.query('SELECT 1 FROM tracks WHERE id = $1', [id])).rowCount) return id;
    throw new HttpError(400, 'Musica non trovata');
  };

  // user and map management, admin only; checked on every request so a removed admin loses access at once
  app.use('/api/admin/*', async (c, next) => {
    const { rows } = await pool.query('SELECT is_admin FROM users WHERE id = $1', [c.get('userId')]);
    if (!rows[0]?.is_admin) throw new HttpError(403, 'Riservato all\'admin');
    await next();
  });

  const listUsers = async () =>
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
    map.name = map.name.trim();
    if (!map.name || map.name.length > 60) throw new HttpError(400, 'Il nome deve avere tra 1 e 60 caratteri');
    await pool.query('INSERT INTO maps (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = now()', [id, JSON.stringify(map)]);
    return c.json(await listMaps());
  });

  app.delete('/api/admin/maps/:id', async c => {
    const { rows: [used] } = await pool.query('SELECT name FROM missions WHERE map_id = $1 LIMIT 1', [c.req.param('id')]);
    if (used) throw new HttpError(409, `La mappa è usata dalla missione "${used.name}": elimina prima la missione`);
    await pool.query('DELETE FROM maps WHERE id = $1', [c.req.param('id')]);
    return c.json(await listMaps());
  });

  app.post('/api/admin/missions', async c => {
    const b = await body(c);
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name || name.length > 60) throw new HttpError(400, 'Il nome deve avere tra 1 e 60 caratteri');
    if (!Number.isInteger(b.gold) || b.gold < 0 || b.gold > MAX_MISSION_GOLD) throw new HttpError(400, `L'oro deve essere un intero tra 0 e ${MAX_MISSION_GOLD}`);
    const map = await findMap(b.mapId);
    if (!map) throw new HttpError(400, 'Mappa non trovata');
    const enemies = parseMissionEnemies(map, b.enemies);
    await pool.query('INSERT INTO missions (name, map_id, gold, enemies, track_id) VALUES ($1, $2, $3, $4, $5)', [name, b.mapId, b.gold, JSON.stringify(enemies), await trackId(b.trackId)]);
    return c.json(await listMissions(c.get('userId')));
  });

  app.delete('/api/admin/missions/:id', async c => {
    const id = c.req.param('id');
    if (isUuid(id)) await pool.query('DELETE FROM missions WHERE id = $1', [id]);
    return c.json(await listMissions(c.get('userId')));
  });

  // the code runs in every player's browser: only admins can save it
  const trackBody = async (c: Context) => {
    const b = await body(c);
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name || name.length > 60) throw new HttpError(400, 'Il nome deve avere tra 1 e 60 caratteri');
    if (typeof b.code !== 'string' || !b.code.trim() || b.code.length > MAX_TRACK_CODE) throw new HttpError(400, `Il codice deve avere tra 1 e ${MAX_TRACK_CODE} caratteri`);
    return { name, code: b.code };
  };

  app.post('/api/admin/tracks', async c => {
    const t = await trackBody(c);
    await pool.query('INSERT INTO tracks (name, code) VALUES ($1, $2)', [t.name, t.code]);
    return c.json(await listMusic());
  });

  app.put('/api/admin/tracks/:id', async c => {
    const t = await trackBody(c), id = c.req.param('id');
    const { rowCount } = isUuid(id) ? await pool.query('UPDATE tracks SET name = $2, code = $3 WHERE id = $1', [id, t.name, t.code]) : { rowCount: 0 };
    if (!rowCount) throw new HttpError(404, 'Musica non trovata');
    return c.json(await listMusic());
  });

  // its slots go empty and its missions fall back to the battle music
  app.delete('/api/admin/tracks/:id', async c => {
    const id = c.req.param('id');
    if (isUuid(id)) await pool.query('DELETE FROM tracks WHERE id = $1', [id]);
    return c.json(await listMusic());
  });

  app.put('/api/admin/music/:slot', async c => {
    const slot = c.req.param('slot');
    if (!MUSIC_SLOTS.includes(slot)) throw new HttpError(404, 'Non trovato');
    const id = await trackId((await body(c)).trackId);
    if (id) await pool.query('INSERT INTO music_slots VALUES ($1, $2) ON CONFLICT (slot) DO UPDATE SET track_id = $2', [slot, id]);
    else await pool.query('DELETE FROM music_slots WHERE slot = $1', [slot]);
    return c.json(await listMusic());
  });

  // ---------- PvP ----------
  // shortcut: clients poll once a second; switch to SSE or WebSocket if turn latency matters.

  /** A player has one PvP match at a time: entering the lobby or a room resigns or drops the old one. */
  const leaveOtherMatches = async (db: pg.PoolClient, userId: string) => {
    await db.query(`DELETE FROM pvp_matches WHERE status = 'waiting' AND player_a = $1`, [userId]);
    await db.query(
      `UPDATE pvp_matches SET status = 'done', reason = 'resign', winner = CASE WHEN player_a = $1 THEN 'B' ELSE 'A' END
       WHERE status IN ('deploy', 'battle') AND $1 IN (player_a, player_b)`, [userId]);
  };
  const createWaiting = async (db: pg.PoolClient, userId: string, code: string | null) =>
    (await db.query('INSERT INTO pvp_matches (player_a, map, code) VALUES ($1, $2, $3) RETURNING id', [userId, JSON.stringify(BUILTIN_MAP), code])).rows[0].id as string;

  // lobby: join the oldest player still searching, or start searching; the advisory lock makes two searchers pair up instead of both waiting
  app.post('/api/pvp/queue', async c => {
    const userId = c.get('userId');
    return c.json(await tx(pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(727275)');
      await leaveOtherMatches(db, userId);
      const { rows: [m] } = await db.query(
        `UPDATE pvp_matches SET player_b = $1, seen_b = now(), status = 'deploy'
         WHERE id = (SELECT id FROM pvp_matches WHERE status = 'waiting' AND code IS NULL AND player_a <> $1
                     AND seen_a > now() - interval '${PVP_LOBBY_SECONDS} seconds' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
         RETURNING id`, [userId]);
      return { id: m?.id ?? await createWaiting(db, userId, null) };
    }));
  });

  app.post('/api/pvp/rooms', async c => {
    const userId = c.get('userId');
    return c.json(await tx(pool, async db => {
      await leaveOtherMatches(db, userId);
      return { id: await createWaiting(db, userId, newCode()) };
    }));
  });

  app.post('/api/pvp/join', async c => {
    const code = String((await body(c)).code ?? '').trim().toUpperCase();
    const userId = c.get('userId');
    return c.json(await tx(pool, async db => {
      const { rows: [m] } = await db.query(`SELECT id, player_a FROM pvp_matches WHERE code = $1 AND status = 'waiting' FOR UPDATE`, [code]);
      if (!m) throw new HttpError(404, 'Codice non trovato o stanza già piena');
      if (m.player_a === userId) throw new HttpError(400, 'Questo è il codice della tua stanza: mandalo a un amico');
      await leaveOtherMatches(db, userId);
      // the code is free again once the room is full
      await db.query(`UPDATE pvp_matches SET player_b = $2, seen_b = now(), status = 'deploy', code = NULL WHERE id = $1`, [m.id, userId]);
      return { id: m.id };
    }));
  });

  /** Loads the caller's match with a row lock and their team, or throws 404. */
  const lockMatch = async (db: pg.PoolClient, id: string, userId: string) => {
    const { rows: [m] } = isUuid(id) ? await db.query('SELECT * FROM pvp_matches WHERE id = $1 AND $2 IN (player_a, player_b) FOR UPDATE', [id, userId]) : { rows: [] };
    if (!m) throw new HttpError(404, 'Partita non trovata');
    return { m, team: (m.player_a === userId ? 'A' : 'B') as 'A' | 'B' };
  };

  // poll: marks the caller as present, ends the match if the other player vanished, returns what changed since action `from`
  app.get('/api/pvp/:id', async c => {
    const userId = c.get('userId');
    const from = Math.max(0, Number(c.req.query('from')) || 0);
    return c.json(await tx(pool, async db => {
      const { m, team } = await lockMatch(db, c.req.param('id'), userId);
      const other = team === 'A' ? 'B' : 'A';
      await db.query(`UPDATE pvp_matches SET seen_${team.toLowerCase()} = now() WHERE id = $1`, [m.id]);
      if ((m.status === 'deploy' || m.status === 'battle') && Date.now() - new Date(m[`seen_${other.toLowerCase()}`]).getTime() > PVP_GONE_SECONDS * 1000) {
        await db.query(`UPDATE pvp_matches SET status = 'done', winner = $2, reason = 'gone' WHERE id = $1`, [m.id, team]);
        Object.assign(m, { status: 'done', winner: team, reason: 'gone' });
      }
      return {
        status: m.status, team, code: m.code, map: m.map,
        deployed: !!m[`deploy_${team.toLowerCase()}`],
        seed: m.seed === null ? null : Number(m.seed), units: m.units,
        actions: (m.actions as unknown[]).slice(from), winner: m.winner, reason: m.reason,
      };
    }));
  });

  // PvP fights at a fixed level: XP and gold never come from it
  app.post('/api/pvp/:id/deploy', async c => {
    const { deploy } = await body(c);
    const userId = c.get('userId');
    return c.json(await tx(pool, async db => {
      const { m, team } = await lockMatch(db, c.req.param('id'), userId);
      if (m.status !== 'deploy') throw new HttpError(409, 'La partita non è nella fase di schieramento');
      const { rows: [user] } = await db.query('SELECT roster FROM users WHERE id = $1', [userId]);
      const units = deployTeam(user.roster, m.map, deploy, team, { level: PVP_LEVEL, idPrefix: `${team.toLowerCase()}-` });
      m[`deploy_${team.toLowerCase()}`] = units;
      if (m.deploy_a && m.deploy_b) {
        const all = [...m.deploy_a, ...m.deploy_b], seed = randomBytes(4).readUInt32BE();
        createBattle(m.map, all, seed); // checks the two teams together
        await db.query(`UPDATE pvp_matches SET deploy_a = $2, deploy_b = $3, units = $4, seed = $5, status = 'battle' WHERE id = $1`,
          [m.id, JSON.stringify(m.deploy_a), JSON.stringify(m.deploy_b), JSON.stringify(all), seed]);
      } else {
        await db.query(`UPDATE pvp_matches SET deploy_${team.toLowerCase()} = $2 WHERE id = $1`, [m.id, JSON.stringify(units)]);
      }
      return { ok: true };
    }));
  });

  // one action of the caller's team; `index` makes a retried request harmless
  app.post('/api/pvp/:id/actions', async c => {
    const { index, action } = await body(c);
    const userId = c.get('userId');
    return c.json(await tx(pool, async db => {
      const { m, team } = await lockMatch(db, c.req.param('id'), userId);
      const actions = m.actions as unknown[];
      if (Number.isInteger(index) && index < actions.length && canon(actions[index]) === canon(action)) return { ok: true };
      if (m.status !== 'battle') throw new HttpError(409, 'La partita è finita');
      if (index !== actions.length || actions.length >= PVP_MAX_ACTIONS) throw new HttpError(409, 'Azione fuori sequenza');
      let s = createBattle(m.map, m.units, Number(m.seed));
      for (const a of actions) s = apply(s, a as BattleAction);
      if (activeUnit(s).team !== team) throw new HttpError(409, 'Non è il tuo turno');
      try {
        s = apply(s, action);
      } catch {
        throw new HttpError(400, 'Azione non valida');
      }
      await db.query(`UPDATE pvp_matches SET actions = actions || $2::jsonb, status = $3, winner = $4, reason = $5 WHERE id = $1`,
        [m.id, JSON.stringify([action]), s.winner ? 'done' : 'battle', s.winner, s.winner ? 'battle' : null]);
      return { ok: true };
    }));
  });

  app.post('/api/pvp/:id/leave', async c => {
    const userId = c.get('userId');
    return c.json(await tx(pool, async db => {
      const { m, team } = await lockMatch(db, c.req.param('id'), userId);
      if (m.status === 'waiting') await db.query('DELETE FROM pvp_matches WHERE id = $1', [m.id]);
      else if (m.status !== 'done') await db.query(`UPDATE pvp_matches SET status = 'done', winner = $2, reason = 'resign' WHERE id = $1`, [m.id, team === 'A' ? 'B' : 'A']);
      return { ok: true };
    }));
  });

  app.all('/api/*', c => c.json({ error: 'Non trovato' }, 404));
  app.use('*', serveStatic({ root: staticDir }));
  return app;
}
