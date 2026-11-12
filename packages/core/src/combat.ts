import type { ActionDef } from './classes';
import { DIRS, facingToward, heightAt, inBounds, isWalkable, key, manhattan, type MapData, type Pos } from './map';
import { effectiveStat, type Unit } from './units';

export type Side = 'front' | 'flank' | 'back';
export const SIDE_MULT: Record<Side, number> = { front: 1, flank: 1.25, back: 1.5 };
export const MELEE_REACH = 2;
/** % of max HP lost when a push hits an obstacle, and for each level of fall beyond the jump */
export const BUMP_PCT = 10, FALL_PCT = 10;

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

/** Extra range a unit gets on an action, from its passive and race. Only ranged actions use it. */
export const rangeBonus = (u: Unit, a: ActionDef) => u.mods.range + (a.stat === 'mag' ? u.mods.magicRange : 0);

/** Radius of an action's area for this unit, or -1 for a single target. */
export const areaRadius = (u: Unit, a: ActionDef) => (a.area === undefined ? -1 : a.area + u.mods.areaBonus);

// shortcut: no line-of-sight check for ranged actions; add when maps get walls/pillars.
/** `bonus`: extra range for ranged actions (passive, race). */
export function inRange(map: MapData, from: Pos, action: ActionDef, target: Pos, bonus = 0): boolean {
  const d = manhattan(from, target);
  const dh = heightAt(map, from) - heightAt(map, target);
  if (action.ranged) return d >= action.minRange && d <= action.maxRange + bonus + (dh > 0 ? Math.floor(dh / 2) : 0);
  return d >= action.minRange && d <= action.maxRange && Math.abs(dh) <= MELEE_REACH;
}

/** Every cell an action could reach from `from`, whether or not someone stands there. */
export function rangeCells(map: MapData, from: Pos, action: ActionDef, bonus = 0): Pos[] {
  const out: Pos[] = [];
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (inRange(map, from, action, { x, y }, bonus)) out.push({ x, y });
  return out;
}

/** Cells of the map within `radius` steps of `center`. */
export function areaCells(map: MapData, center: Pos, radius: number): Pos[] {
  const out: Pos[] = [];
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius + Math.abs(dy); dx <= radius - Math.abs(dy); dx++) {
      const p = { x: center.x + dx, y: center.y + dy };
      if (inBounds(map, p)) out.push(p);
    }
  return out;
}

/** Amount before random variance. Used by the reducer and by the AI / UI preview. 0 for actions that neither hurt nor heal. */
export function expectedAmount(map: MapData, actor: Unit, from: Pos, action: ActionDef, target: Unit): number {
  const power = effectiveStat(actor, action.stat) * action.power;
  if (action.effect === 'heal') return Math.round(power * 1.5 * (1 + actor.mods.healPct / 100));
  if (action.effect !== 'damage') return 0;
  const dh = heightAt(map, from) - heightAt(map, target.pos);
  const side = sideOf(from, target);
  const raw = Math.max(1, power * 2 - effectiveStat(target, 'def'));
  const bonus = 1 + ((side === 'back' ? actor.mods.backDamagePct : 0) + (action.stat === 'mag' ? actor.mods.magicDamagePct : 0)) / 100;
  return Math.max(1, Math.round(raw * SIDE_MULT[side] * heightMult(dh) * bonus * (1 + target.mods.damageTakenPct / 100)));
}

/**
 * Where a push of `n` cells takes the target, away from `from`, and the damage it takes: a bump if it cannot move at all,
 * a fall if it ends lower than it can jump. `path` starts on the target's cell.
 */
export function pushResult(map: MapData, units: Unit[], from: Pos, target: Unit, n: number): { path: Pos[]; damage: number } {
  const dx = target.pos.x - from.x, dy = target.pos.y - from.y;
  const d = DIRS[Math.abs(dx) === Math.abs(dy) ? facingToward(from, target.pos) : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : dy > 0 ? 'S' : 'N'];
  const taken = new Set(units.filter(u => u.hp > 0 && u !== target).map(u => key(u.pos)));
  const path = [target.pos];
  for (let i = 0; i < n; i++) {
    const cur = path[path.length - 1], next = { x: cur.x + d.x, y: cur.y + d.y };
    if (!isWalkable(map, next) || taken.has(key(next)) || heightAt(map, next) - heightAt(map, cur) > MELEE_REACH) break;
    path.push(next);
  }
  const max = target.stats.maxHp, end = path[path.length - 1];
  if (path.length === 1) return { path, damage: Math.max(1, Math.round((max * BUMP_PCT) / 100)) };
  const drop = heightAt(map, target.pos) - heightAt(map, end) - target.stats.jump;
  const damage = drop > 0 && !target.mods.fallImmune ? Math.round((max * FALL_PCT * drop) / 100) : 0;
  return { path, damage };
}
