// Reads and writes shared by more than one route area.
import { DEMO_MAP, parseMap, type Chapter, type MapData, type Mission, type Music, type Player } from '@tactics/core';
import type pg from 'pg';
import { tx } from './db';
import { HttpError, isUuid, type Db } from './http';

export const BUILTIN_MAP = parseMap(DEMO_MAP)!;
/** The game's day, for daily missions: midnight in Italy, whatever the server's time zone. */
export const TODAY = `(now() AT TIME ZONE 'Europe/Rome')::date`;

/** Inside a transaction: loads the player with a row lock, applies a pure core function, saves the result. */
export async function mutateIn<T extends { player: Player }>(db: pg.PoolClient, userId: string, fn: (p: Player) => T) {
  const { rows } = await db.query('SELECT gold, roster, inventory FROM users WHERE id = $1 FOR UPDATE', [userId]);
  const out = fn(rows[0]);
  await db.query('UPDATE users SET gold = $2, roster = $3, inventory = $4 WHERE id = $1',
    [userId, out.player.gold, JSON.stringify(out.player.roster), JSON.stringify(out.player.inventory)]);
  return out;
}
export const mutate = <T extends { player: Player }>(pool: pg.Pool, userId: string, fn: (p: Player) => T) => tx(pool, db => mutateIn(db, userId, fn));

const CHAPTER_COLS = `c.id, c.label, c.title, c.blurb, c.map_id AS "mapId", c.gold, c.enemies, c.goal, c.required, c.unlock, c.crt, c.before, c.after`;
/** Campaign chapters in play order, each with its map (undefined if the map is gone). */
export const listChapters = async (db: Db): Promise<Chapter[]> => (await db.query(
  `SELECT ${CHAPTER_COLS}, m.data AS map FROM chapters c LEFT JOIN maps m ON m.id = c.map_id ORDER BY c.position, c.id`)).rows;
export const chapterRow = async (db: Db, id: string): Promise<Chapter | undefined> =>
  (await db.query(`SELECT ${CHAPTER_COLS} FROM chapters c WHERE c.id = $1`, [id])).rows[0];
export const clearedChapters = async (db: Db, userId: string): Promise<string[]> =>
  (await db.query('SELECT chapter_id FROM campaign_wins WHERE user_id = $1', [userId])).rows.map(r => r.chapter_id);

/** The built-in map or a saved one, by id. */
export const findMap = async (db: Db, id: unknown): Promise<MapData | undefined> =>
  id === BUILTIN_MAP.id ? BUILTIN_MAP
    : typeof id === 'string' ? (await db.query('SELECT data FROM maps WHERE id = $1', [id])).rows[0]?.data
    : undefined;
export const listMaps = async (db: Db) => (await db.query("SELECT data FROM maps ORDER BY data->>'name', id")).rows.map(r => r.data as MapData);

export const listMissions = async (db: Db, userId: string): Promise<Mission[]> => (await db.query(
  `SELECT m.id, m.name, m.map_id AS "mapId", m.gold, m.enemies, m.recruit, m.track_id AS "trackId",
     EXISTS (SELECT 1 FROM mission_wins w WHERE w.mission_id = m.id AND w.user_id = $1 AND w.day = ${TODAY}) AS done
   FROM missions m ORDER BY m.created_at, m.id`, [userId])).rows;

/** Every track with its code (players need it to play), and the track chosen for each slot. */
export const listMusic = async (db: Db): Promise<Music> => {
  const [{ rows: tracks }, { rows: slots }] = await Promise.all([
    db.query('SELECT id, name, code FROM tracks ORDER BY name, id'),
    db.query('SELECT slot, track_id FROM music_slots'),
  ]);
  const chosen = (slot: string) => slots.find(s => s.slot === slot)?.track_id ?? null;
  return { tracks, menu: chosen('menu'), battle: chosen('battle') };
};

/** null, or the id of a saved track; anything else is refused. */
export const trackId = async (db: Db, id: unknown) => {
  if (id === null || id === undefined) return null;
  if (isUuid(id) && (await db.query('SELECT 1 FROM tracks WHERE id = $1', [id])).rowCount) return id;
  throw new HttpError(400, 'Musica non trovata');
};
