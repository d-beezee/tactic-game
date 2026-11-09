export type Team = 'A' | 'B';
export interface Pos { x: number; y: number }
export type Terrain = 'grass' | 'dirt' | 'stone' | 'water' | 'blocked';

/** Compact map format, also the future editor's export format. */
export interface MapData {
  id: string;
  name: string;
  width: number;
  height: number;
  /** heights[y][x], integer steps */
  heights: number[][];
  /** one string per row, one char per cell: g d s w x */
  terrain: string[];
  spawns: Record<Team, Pos[]>;
  maxDeploy: number;
}

const TERRAIN: Record<string, Terrain> = { g: 'grass', d: 'dirt', s: 'stone', w: 'water', x: 'blocked' };
export const TERRAIN_CODES = TERRAIN;
export const MAP_MIN_SIZE = 4, MAP_MAX_SIZE = 24, MAX_HEIGHT = 8, MAX_DEPLOY = 8;

export const DIRS = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
} as const;
export type Dir = keyof typeof DIRS;

export const key = (p: Pos) => `${p.x},${p.y}`;
export const samePos = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y;
export const manhattan = (a: Pos, b: Pos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export const inBounds = (m: MapData, p: Pos) => p.x >= 0 && p.y >= 0 && p.x < m.width && p.y < m.height;
export const heightAt = (m: MapData, p: Pos) => m.heights[p.y][p.x];
export const terrainAt = (m: MapData, p: Pos): Terrain => TERRAIN[m.terrain[p.y][p.x]] ?? 'blocked';
export const isWalkable = (m: MapData, p: Pos) => inBounds(m, p) && terrainAt(m, p) !== 'blocked';

export function facingToward(from: Pos, to: Pos): Dir {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (dx === 0 && dy === 0) return 'S';
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'E' : 'W';
  return dy > 0 ? 'S' : 'N';
}

/** Map JSON comes from the editor / network: check it before use. Returns error messages, empty = valid. */
export function validateMap(m: MapData): string[] {
  const errors: string[] = [];
  const sizeOk = (n: number) => Number.isInteger(n) && n >= MAP_MIN_SIZE && n <= MAP_MAX_SIZE;
  if (!sizeOk(m.width) || !sizeOk(m.height)) return [`Le dimensioni devono essere tra ${MAP_MIN_SIZE} e ${MAP_MAX_SIZE}`];
  if (!Number.isInteger(m.maxDeploy) || m.maxDeploy < 1 || m.maxDeploy > MAX_DEPLOY) errors.push(`Le unità schierabili devono essere tra 1 e ${MAX_DEPLOY}`);
  if (m.heights?.length !== m.height || m.heights.some(r => r.length !== m.width || r.some(h => !Number.isInteger(h) || h < 0 || h > MAX_HEIGHT)))
    errors.push(`Le altezze devono essere numeri interi tra 0 e ${MAX_HEIGHT}`);
  if (m.terrain?.length !== m.height || m.terrain.some(r => r.length !== m.width || [...r].some(c => !(c in TERRAIN))))
    errors.push('Il terreno deve avere una lettera tra g, d, s, w, x per ogni casella');
  if (errors.length) return errors;
  const seen = new Set<string>();
  for (const team of ['A', 'B'] as const) {
    const s = m.spawns?.[team] ?? [];
    if (s.length < m.maxDeploy) errors.push(`Servono almeno ${m.maxDeploy} caselle di partenza ${team === 'A' ? 'blu' : 'nemiche'}`);
    for (const p of s) {
      if (!isWalkable(m, p)) errors.push(`La partenza ${team === 'A' ? 'blu' : 'nemica'} in ${key(p)} è su una casella non calpestabile`);
      if (seen.has(key(p))) errors.push(`La casella ${key(p)} è usata due volte come partenza`);
      seen.add(key(p));
    }
  }
  return errors;
}

/** Untrusted JSON (file import, storage, network) to a valid map, or null. */
export function parseMap(data: unknown): MapData | null {
  try {
    const d = data as MapData;
    const isPos = (p: Pos) => Number.isInteger(p?.x) && Number.isInteger(p?.y);
    const ok =
      typeof d?.id === 'string' && typeof d.name === 'string' &&
      Array.isArray(d.heights) && d.heights.every(r => Array.isArray(r) && r.every(h => typeof h === 'number')) &&
      Array.isArray(d.terrain) && d.terrain.every(r => typeof r === 'string') &&
      Array.isArray(d.spawns?.A) && Array.isArray(d.spawns?.B) && [...d.spawns.A, ...d.spawns.B].every(isPos);
    if (!ok) return null;
    const m: MapData = {
      id: d.id, name: d.name, width: d.width, height: d.height, maxDeploy: d.maxDeploy,
      heights: d.heights.map(r => [...r]), terrain: [...d.terrain],
      spawns: { A: d.spawns.A.map(p => ({ x: p.x, y: p.y })), B: d.spawns.B.map(p => ({ x: p.x, y: p.y })) },
    };
    return validateMap(m).length ? null : m;
  } catch {
    return null;
  }
}

/** Flat grass map with spawns on the first and last row: valid out of the box. */
export function blankMap(id: string, width = 10, height = 10, maxDeploy = 3): MapData {
  return {
    id, name: 'Nuova mappa', width, height, maxDeploy,
    heights: Array.from({ length: height }, () => Array(width).fill(0)),
    terrain: Array.from({ length: height }, () => 'g'.repeat(width)),
    spawns: {
      A: Array.from({ length: maxDeploy }, (_, i) => ({ x: i, y: 0 })),
      B: Array.from({ length: maxDeploy }, (_, i) => ({ x: width - 1 - i, y: height - 1 })),
    },
  };
}

/** New size: keeps overlapping cells, fills new ones with flat grass, drops spawns that fall outside. */
export function resizeMap(m: MapData, width: number, height: number): MapData {
  const inside = (p: Pos) => p.x < width && p.y < height;
  return {
    ...m, width, height,
    heights: Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => m.heights[y]?.[x] ?? 0)),
    terrain: Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => m.terrain[y]?.[x] ?? 'g').join('')),
    spawns: { A: m.spawns.A.filter(inside), B: m.spawns.B.filter(inside) },
  };
}
