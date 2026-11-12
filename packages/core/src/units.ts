import { CLASSES, EMPTY_MODS, type ActionDef, type Mods, type Stats } from './classes';
import { ITEMS, type Equip } from './items';
import type { Dir, Pos, Team } from './map';
import { DEFAULT_RACE, RACES } from './races';
import { STATUSES, type StatusInst } from './statuses';

export const MAX_CLASS_LEVEL = 8;
/** stat growth per class level above 1 (move and jump excluded) */
export const GROWTH_PER_LEVEL = 0.05;

export interface Unit {
  id: string;
  name: string;
  team: Team;
  classId: string;
  raceId: string;
  /** level of the active class */
  level: number;
  /** class id whose passive is equipped */
  passive: string | null;
  stats: Stats;
  mods: Mods;
  hp: number;
  pos: Pos;
  facing: Dir;
  statuses: StatusInst[];
  /** times each limited action was used this battle */
  uses: Record<string, number>;
}

const GROWING: (keyof Stats)[] = ['maxHp', 'atk', 'def', 'mag', 'speed'];

export function createUnit(
  id: string, name: string, team: Team, classId: string, pos: Pos, facing: Dir,
  level = 1, passive: string | null = null, equip: Equip = {}, raceId = DEFAULT_RACE,
): Unit {
  const cls = CLASSES[classId];
  if (!cls) throw new Error(`unknown class ${classId}`);
  const race = RACES[raceId];
  if (!race) throw new Error(`unknown race ${raceId}`);
  if (passive !== null && !CLASSES[passive]) throw new Error(`unknown passive ${passive}`);
  const lvl = Math.max(1, Math.min(MAX_CLASS_LEVEL, Math.floor(level)));
  const stats = { ...cls.stats };
  for (const k of GROWING) stats[k] = Math.round(stats[k] * (1 + GROWTH_PER_LEVEL * (lvl - 1)));
  for (const [k, v] of Object.entries(race.stats)) stats[k as keyof Stats] = Math.max(1, stats[k as keyof Stats] + v);
  for (const id of Object.values(equip)) {
    if (!Object.hasOwn(ITEMS, id)) throw new Error(`unknown item ${id}`);
    for (const [k, v] of Object.entries(ITEMS[id].stats)) stats[k as keyof Stats] = Math.max(1, stats[k as keyof Stats] + v);
  }
  const p = passive ? CLASSES[passive].passive : null;
  if (p?.stat) stats[p.stat.key] = Math.round((stats[p.stat.key] + (p.stat.add ?? 0)) * (1 + (p.stat.pct ?? 0) / 100));
  const mods = { ...EMPTY_MODS };
  for (const m of [race.trait.mods, p?.mods]) for (const [k, v] of Object.entries(m ?? {})) mods[k as keyof Mods] += v;
  return { id, name, team, classId, raceId, level: lvl, passive, stats, mods, hp: stats.maxHp, pos: { ...pos }, facing, statuses: [], uses: {} };
}

/** A stat with the unit's statuses applied: buffs and debuffs, and Radicato for move. */
export function effectiveStat(u: Unit, k: keyof Stats): number {
  let pct = 0;
  for (const s of u.statuses) {
    const def = STATUSES[s.id];
    if (k === 'move' && def.noMove) return 0;
    if (def.stat?.key === k) pct += def.stat.pct;
  }
  return pct ? Math.max(1, Math.round(u.stats[k] * (1 + pct / 100))) : u.stats[k];
}

/** Actions of the class, then of the race. */
export function unitActions(u: Pick<Unit, 'classId' | 'raceId'>): ActionDef[] {
  const out = [...CLASSES[u.classId].actions];
  for (const a of RACES[u.raceId]?.actions ?? []) if (!out.some(b => b.id === a.id)) out.push(a);
  return out;
}

/** A copy safe to mutate. Units saved before races and statuses existed get the defaults. */
export const cloneUnit = (u: Unit): Unit => ({
  ...u, pos: { ...u.pos }, raceId: u.raceId ?? DEFAULT_RACE, mods: { ...EMPTY_MODS, ...u.mods },
  statuses: (u.statuses ?? []).map(s => ({ ...s })), uses: { ...u.uses },
});
