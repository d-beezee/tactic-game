import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { serveStatic } from '@hono/node-server/serve-static';
import { buyItem, deployTestBattle, finishTestBattle, newPlayer, parseMap, parseRoster, PlayerError, updateUnit, type MapData, type Player } from '@tactics/core';
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
    // the map comes from the server's own copy, never from the client
    const map = b.mapId === BUILTIN_MAP.id ? BUILTIN_MAP
      : typeof b.mapId === 'string' ? (await pool.query('SELECT data FROM maps WHERE id = $1', [b.mapId])).rows[0]?.data as MapData | undefined
      : undefined;
    if (!map) throw new HttpError(404, 'Mappa non trovata');
    const userId = c.get('userId');
    const { rows: [user] } = await pool.query('SELECT roster FROM users WHERE id = $1', [userId]);
    const units = deployTestBattle(user.roster, map, b.deploy);
    const seed = randomBytes(4).readUInt32BE();
    return c.json(await tx(pool, async db => {
      // one battle at a time: starting a new one drops the old ones, finished or abandoned
      await db.query('DELETE FROM battles WHERE user_id = $1', [userId]);
      const { rows } = await db.query('INSERT INTO battles (user_id, seed, map, units) VALUES ($1, $2, $3, $4) RETURNING id',
        [userId, seed, JSON.stringify(map), JSON.stringify(units)]);
      return { id: rows[0].id, seed, units };
    }));
  });

  app.post('/api/battles/:id/finish', async c => {
    const { actions } = await body(c);
    const id = c.req.param('id'), userId = c.get('userId');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, 'Battaglia non trovata');
    return c.json(await tx(pool, async db => {
      const { rows: [battle] } = await db.query('SELECT seed, map, units, result FROM battles WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, userId]);
      if (!battle) throw new HttpError(404, 'Battaglia non trovata: ne hai iniziata un\'altra?');
      // a retry after a lost response gets the same answer and no second payout
      if (battle.result) return battle.result;
      const out = await mutateIn(db, userId, p => finishTestBattle(p, battle.map, battle.units, Number(battle.seed), actions));
      await db.query('UPDATE battles SET result = $2 WHERE id = $1', [id, JSON.stringify(out)]);
      return out;
    }));
  });

  const listMaps = async () => (await pool.query("SELECT data FROM maps ORDER BY data->>'name', id")).rows.map(r => r.data as MapData);

  app.get('/api/maps', async c => c.json(await listMaps()));

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
    if (typeof admin !== 'boolean' || !/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Richiesta non valida');
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
    await pool.query('DELETE FROM maps WHERE id = $1', [c.req.param('id')]);
    return c.json(await listMaps());
  });

  app.all('/api/*', c => c.json({ error: 'Non trovato' }, 404));
  app.use('*', serveStatic({ root: staticDir }));
  return app;
}
