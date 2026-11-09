import type { ActionDef } from './classes';
import { DIRS, heightAt, manhattan, type MapData, type Pos } from './map';
import type { Unit } from './units';

export type Side = 'front' | 'flank' | 'back';
export const SIDE_MULT: Record<Side, number> = { front: 1, flank: 1.25, back: 1.5 };
export const MELEE_REACH = 2;

/** Which side of the target the attack hits, from the target's facing. Diagonal ties count as flank. */
export function sideOf(from: Pos, target: Unit): Side {
  const dx = from.x - target.pos.x, dy = from.y - target.pos.y;
  const f = DIRS[target.facing];
  const dot = dx * f.x + dy * f.y;
  const cross = Math.abs(dx * f.y - dy * f.x);
  if (dot > cross) return 'front';
  if (-dot > cross) return 'back';
  return 'flank';
}

export const heightMult = (dh: number) => 1 + 0.05 * Math.max(-4, Math.min(4, dh));

// shortcut: no line-of-sight check for ranged actions; add when maps get walls/pillars.
export function inRange(map: MapData, from: Pos, action: ActionDef, target: Pos): boolean {
  const d = manhattan(from, target);
  const dh = heightAt(map, from) - heightAt(map, target);
  if (action.ranged) return d >= action.minRange && d <= action.maxRange + (dh > 0 ? Math.floor(dh / 2) : 0);
  return d >= action.minRange && d <= action.maxRange && Math.abs(dh) <= MELEE_REACH;
}

/** Amount before random variance. Used by the reducer and by the AI / UI preview. */
export function expectedAmount(map: MapData, actor: Unit, from: Pos, action: ActionDef, target: Unit): number {
  const power = actor.stats[action.stat] * action.power;
  if (action.effect === 'heal') return Math.round(power * 1.5);
  const dh = heightAt(map, from) - heightAt(map, target.pos);
  const raw = Math.max(1, power * 2 - target.stats.def);
  return Math.max(1, Math.round(raw * SIDE_MULT[sideOf(from, target)] * heightMult(dh)));
}
