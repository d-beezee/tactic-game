import { CLASSES } from './classes';
import type { Dir, Pos, Team } from './map';
import { createUnit, MAX_CLASS_LEVEL, type Unit } from './units';

/** A unit owned by the player, outside battle. */
export interface RosterUnit {
  id: string;
  name: string;
  /** active class */
  classId: string;
  /** total XP earned in each class */
  xp: Record<string, number>;
  /** class id whose passive is equipped (1 slot) */
  passive: string | null;
}

export const PASSIVE_LEVEL = 4;

/** Total XP needed to reach a class level: 100 for level 2, then each level costs 50 more than the previous one. */
export const xpToReach = (level: number) => 100 * (level - 1) + 25 * (level - 1) * (level - 2);
export const MAX_CLASS_XP = xpToReach(MAX_CLASS_LEVEL);

export function levelFromXp(xp: number): number {
  let lvl = 1;
  while (lvl < MAX_CLASS_LEVEL && xp >= xpToReach(lvl + 1)) lvl++;
  return lvl;
}

export const classLevel = (r: RosterUnit, classId: string) => levelFromXp(r.xp[classId] ?? 0);

/** Requirements not yet met, e.g. [{ classId: 'cleric', level: 2 }]. Empty = unlocked. */
export function missingRequirements(r: RosterUnit, classId: string): { classId: string; level: number }[] {
  return Object.entries(CLASSES[classId]?.requires ?? {})
    .filter(([c, lvl]) => classLevel(r, c) < lvl)
    .map(([c, level]) => ({ classId: c, level }));
}

export const isUnlocked = (r: RosterUnit, classId: string) => !!CLASSES[classId] && missingRequirements(r, classId).length === 0;

export const unlockedPassives = (r: RosterUnit) => Object.keys(CLASSES).filter(c => classLevel(r, c) >= PASSIVE_LEVEL);

export function unitFromRoster(r: RosterUnit, team: Team, pos: Pos, facing: Dir): Unit {
  return createUnit(r.id, r.name, team, r.classId, pos, facing, classLevel(r, r.classId), r.passive);
}

export interface XpReport { id: string; name: string; classId: string; gained: number; from: number; to: number }

/** Adds battle XP to each unit's class used in that battle (capped at max level). */
export function applyBattleXp(roster: RosterUnit[], used: { id: string; classId: string }[], xp: Record<string, number>) {
  const report: XpReport[] = [];
  const next = roster.map(r => {
    const u = used.find(x => x.id === r.id);
    const gained = u ? Math.max(0, Math.floor(xp[r.id] ?? 0)) : 0;
    if (!u || gained === 0) return r;
    const before = r.xp[u.classId] ?? 0;
    const after = Math.min(MAX_CLASS_XP, before + gained);
    report.push({ id: r.id, name: r.name, classId: u.classId, gained: after - before, from: levelFromXp(before), to: levelFromXp(after) });
    return { ...r, xp: { ...r.xp, [u.classId]: after } };
  });
  return { roster: next, report };
}

export const DEFAULT_ROSTER: RosterUnit[] = [
  { id: 'r1', name: 'Brando', classId: 'warrior', xp: {}, passive: null },
  { id: 'r2', name: 'Lia', classId: 'archer', xp: {}, passive: null },
  { id: 'r3', name: 'Oris', classId: 'cleric', xp: {}, passive: null },
  { id: 'r4', name: 'Tessa', classId: 'warrior', xp: {}, passive: null },
  { id: 'r5', name: 'Nilo', classId: 'archer', xp: {}, passive: null },
  { id: 'r6', name: 'Maela', classId: 'cleric', xp: {}, passive: null },
];

/**
 * Saved data is untrusted: returns null unless it is a well-formed roster.
 * Rosters saved before progression existed (no xp/passive) are migrated.
 */
export function parseRoster(data: unknown): RosterUnit[] | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  const out: RosterUnit[] = [];
  for (const u of data) {
    if (!u || typeof u.id !== 'string' || typeof u.name !== 'string' || typeof u.classId !== 'string') return null;
    const xpIn = u.xp ?? {};
    if (typeof xpIn !== 'object' || Array.isArray(xpIn)) return null;
    const xp: Record<string, number> = {};
    for (const [c, v] of Object.entries(xpIn)) {
      if (!Object.hasOwn(CLASSES, c) || !Number.isInteger(v) || (v as number) < 0) return null;
      xp[c] = Math.min(MAX_CLASS_XP, v as number);
    }
    const r: RosterUnit = { id: u.id, name: u.name, classId: u.classId, xp, passive: u.passive ?? null };
    if (!isUnlocked(r, r.classId)) return null;
    if (r.passive !== null && !unlockedPassives(r).includes(r.passive)) return null;
    out.push(r);
  }
  return out;
}
