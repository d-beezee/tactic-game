import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { newPlayer, parseRoster, type Account } from '@tactics/core';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type pg from 'pg';
import { ensureAdmin } from '../db';
import { body, HttpError, type App, type Env } from '../http';

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

function credentials(body: any) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Email non valida');
  // the upper bound keeps scrypt from hashing huge inputs
  if (password.length < 8 || password.length > 200) throw new HttpError(400, 'La password deve avere tra 8 e 200 caratteri');
  return { email, password };
}

/** Sign-up, login and logout: the only API routes that work without a session. */
export function authRoutes(app: App, pool: pg.Pool) {
  // shortcut: failed logins are counted in memory, per address and email; move to the database with more than one server instance.
  const fails = new Map<string, { n: number; until: number }>();

  async function openSession(c: Context, userId: string) {
    const token = randomBytes(32).toString('base64url');
    await pool.query(`INSERT INTO sessions VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [sha256(token), userId]);
    setCookie(c, COOKIE, token, {
      httpOnly: true, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86_400,
      // TLS ends at the proxy, which sets this header
      secure: c.req.header('x-forwarded-proto') === 'https',
    });
  }

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
    return c.json<Account>({ email, admin, ...p });
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
    return c.json<Account>({ email, admin, gold, roster, inventory });
  });

  app.post('/api/auth/logout', async c => {
    const token = getCookie(c, COOKIE);
    if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });
}

/** Rejects requests without a live session; sets userId for the routes after it. */
export const requireSession = (pool: pg.Pool): MiddlewareHandler<Env> => async (c, next) => {
  const token = getCookie(c, COOKIE);
  const { rows } = token
    ? await pool.query('SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()', [sha256(token)])
    : { rows: [] };
  if (!rows[0]) throw new HttpError(401, 'Accedi per continuare');
  c.set('userId', rows[0].user_id);
  await next();
};
