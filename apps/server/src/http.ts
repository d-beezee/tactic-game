import { LIMITS } from '@tactics/core';
import type { Context, Hono } from 'hono';
import type pg from 'pg';

export type Env = { Variables: { userId: string } };
export type App = Hono<Env>;
export type Db = pg.Pool | pg.PoolClient;

/** Request the client got wrong; the message is shown to the player. */
export class HttpError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 429, message: string) { super(message); }
}

export const body = (c: Context) => c.req.json().catch(() => { throw new HttpError(400, 'Richiesta non valida'); });

/** JSON with sorted keys: jsonb does not keep the key order it was given. */
export const canon = (v: unknown) => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x);
/**
 * SQL pieces for a row given as { column: value }, its placeholders starting at $first.
 * The column names must come from code, never from the request.
 */
export function sqlRow(row: Record<string, unknown>, first: number) {
  const cols = Object.keys(row), at = (i: number) => `$${i + first}`;
  return {
    cols: cols.join(', '),
    params: cols.map((_, i) => at(i)).join(', '),
    set: cols.map((c, i) => `${c} = ${at(i)}`).join(', '),
    values: Object.values(row),
  };
}

/** A trimmed name of 1 to `max` characters, or a 400. */
export const nameField = (v: unknown, max: number = LIMITS.name) => {
  const name = typeof v === 'string' ? v.trim() : '';
  if (!name || name.length > max) throw new HttpError(400, `Il nome deve avere tra 1 e ${max} caratteri`);
  return name;
};

export const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);
