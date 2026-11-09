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
  if (!(m.width > 0 && m.height > 0)) return ['invalid size'];
  if (m.heights?.length !== m.height || m.heights.some(r => r.length !== m.width || r.some(h => !Number.isInteger(h) || h < 0)))
    errors.push('heights must be height × width non-negative integers');
  if (m.terrain?.length !== m.height || m.terrain.some(r => r.length !== m.width || [...r].some(c => !(c in TERRAIN))))
    errors.push('terrain must be height rows of width chars in "gdswx"');
  if (errors.length) return errors;
  for (const team of ['A', 'B'] as const) {
    const s = m.spawns?.[team] ?? [];
    if (s.length < m.maxDeploy) errors.push(`team ${team} needs at least ${m.maxDeploy} spawns`);
    for (const p of s) if (!isWalkable(m, p)) errors.push(`spawn ${key(p)} of team ${team} is not walkable`);
  }
  return errors;
}
