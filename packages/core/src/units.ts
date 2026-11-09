import { CLASSES, type Stats } from './classes';
import type { Dir, Pos, Team } from './map';

export const MAX_CLASS_LEVEL = 8;
/** stat growth per class level above 1 (move and jump excluded) */
export const GROWTH_PER_LEVEL = 0.05;

/** Battle-time effects of the equipped passive that are not plain stats. */
export interface Mods {
  range: number;
  healPct: number;
  damageTakenPct: number;
}

export interface Unit {
  id: string;
  name: string;
  team: Team;
  classId: string;
  /** level of the active class */
  level: number;
  /** class id whose passive is equipped */
  passive: string | null;
  stats: Stats;
  mods: Mods;
  hp: number;
  pos: Pos;
  facing: Dir;
}

const GROWING: (keyof Stats)[] = ['maxHp', 'atk', 'def', 'mag', 'speed'];

export function createUnit(
  id: string, name: string, team: Team, classId: string, pos: Pos, facing: Dir,
  level = 1, passive: string | null = null,
): Unit {
  const cls = CLASSES[classId];
  if (!cls) throw new Error(`unknown class ${classId}`);
  if (passive !== null && !CLASSES[passive]) throw new Error(`unknown passive ${passive}`);
  const lvl = Math.max(1, Math.min(MAX_CLASS_LEVEL, Math.floor(level)));
  const stats = { ...cls.stats };
  for (const k of GROWING) stats[k] = Math.round(stats[k] * (1 + GROWTH_PER_LEVEL * (lvl - 1)));
  const p = passive ? CLASSES[passive].passive : null;
  if (p?.stat) stats[p.stat.key] = Math.round((stats[p.stat.key] + (p.stat.add ?? 0)) * (1 + (p.stat.pct ?? 0) / 100));
  const mods: Mods = { range: p?.range ?? 0, healPct: p?.healPct ?? 0, damageTakenPct: p?.damageTakenPct ?? 0 };
  return { id, name, team, classId, level: lvl, passive, stats, mods, hp: stats.maxHp, pos: { ...pos }, facing };
}
