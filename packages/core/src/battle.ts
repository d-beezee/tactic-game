import type { ActionDef } from './classes';
import { areaCells, areaRadius, expectedAmount, inRange, pushResult, rangeBonus, sideOf, type Side } from './combat';
import { rollInitiative } from './initiative';
import { DIRS, facingToward, inBounds, isWalkable, key, manhattan, samePos, validateMap, type Dir, type MapData, type Pos, type Team } from './map';
import { destinations, pathTo, reachable } from './pathfinding';
import { nextRandom } from './rng';
import { STATUSES, type StatusId } from './statuses';
import { cloneUnit, unitActions, type Unit } from './units';

export type BattleAction =
  | { type: 'move'; to: Pos }
  | { type: 'act'; actionId: string; target: Pos }
  | { type: 'end'; facing: Dir };

/** What the last action did, for the client to animate. */
export type BattleEvent =
  | { type: 'move'; unitId: string; path: Pos[] }
  | { type: 'damage'; unitId: string; amount: number; side: Side }
  | { type: 'heal'; unitId: string; amount: number }
  | { type: 'ko'; unitId: string }
  | { type: 'status'; unitId: string; statusId: StatusId; on: boolean }
  /** HP change outside an attack: poison, regeneration, thorns. Negative hurts. */
  | { type: 'tick'; unitId: string; amount: number }
  /** `path` starts on the cell the unit was pushed from; damage from a bump or a fall */
  | { type: 'push'; unitId: string; path: Pos[]; damage: number }
  | { type: 'dodge'; unitId: string }
  /** a stunned unit loses its turn */
  | { type: 'skip'; unitId: string }
  | { type: 'teleport'; unitId: string; to: Pos }
  | { type: 'swap'; unitId: string; otherId: string };

/**
 * What team A must do to win. Team B (the AI, or the other player) always wins by downing all of A, or one of `protect`.
 * Downing all of B wins for A whatever the goal.
 */
export type Goal =
  | { type: 'rout' }
  | { type: 'survive'; rounds: number }
  | { type: 'reach'; cells: Pos[] }
  | { type: 'boss'; unitId: string };

export interface BattleState {
  map: MapData;
  goal: Goal;
  /** team A unit ids whose fall loses the battle */
  protect: string[];
  units: Unit[];
  /** unit ids, fixed for the whole battle */
  order: string[];
  /** index into order of the active unit */
  turn: number;
  round: number;
  moved: boolean;
  acted: boolean;
  seed: number;
  winner: Team | null;
  events: BattleEvent[];
  /** class XP earned this battle, by unit id */
  xp: Record<string, number>;
}

export const XP_ACTION = 10, XP_KILL = 20, XP_VICTORY = 20;

export class BattleError extends Error {}

export function createBattle(map: MapData, unitsIn: Unit[], seed: number, goal: Goal = { type: 'rout' }, protect: string[] = []): BattleState {
  const errors = validateMap(map);
  if (errors.length) throw new BattleError(`invalid map: ${errors.join('; ')}`);
  const units = unitsIn.map(cloneUnit);
  const cells = new Set<string>();
  for (const u of units) {
    if (!isWalkable(map, u.pos) || cells.has(key(u.pos))) throw new BattleError(`bad position for ${u.id}`);
    cells.add(key(u.pos));
  }
  // maxDeploy bounds the player only: a mission may field more enemies
  const n = (team: string) => units.filter(u => u.team === team).length;
  if (n('A') === 0 || n('A') > map.maxDeploy) throw new BattleError(`team A must deploy 1..${map.maxDeploy} units`);
  if (n('B') === 0) throw new BattleError('team B has no units');
  if (goal.type === 'survive' && !(Number.isInteger(goal.rounds) && goal.rounds >= 1)) throw new BattleError('bad survive goal');
  if (goal.type === 'reach' && !(goal.cells.length && goal.cells.every(p => isWalkable(map, p)))) throw new BattleError('bad reach goal');
  if (goal.type === 'boss' && !units.some(u => u.id === goal.unitId && u.team === 'B')) throw new BattleError('bad boss goal');
  if (protect.some(id => !units.some(u => u.id === id && u.team === 'A'))) throw new BattleError('protected unit not deployed');
  const init = rollInitiative(units, seed);
  const xp = Object.fromEntries(units.map(u => [u.id, 0]));
  return { map, goal, protect, units, order: init.order, turn: 0, round: 1, moved: false, acted: false, seed: init.seed, winner: null, events: [], xp };
}

export const unitById = (s: BattleState, id: string) => s.units.find(u => u.id === id)!;
export const activeUnit = (s: BattleState) => unitById(s, s.order[s.turn]);
export const living = (s: BattleState) => s.units.filter(u => u.hp > 0);

const sideMatches = (unit: Unit, action: ActionDef, t: Unit) => (t.team === unit.team) === (action.targets === 'ally');
/** Where a unit stands if `unit` were at `from`. */
const posIf = (unit: Unit, from: Pos, t: Unit) => (t === unit ? from : t.pos);

/** Valid single targets of an action if the unit stood at `from`. */
export function targetsFor(s: BattleState, unit: Unit, action: ActionDef, from: Pos = unit.pos): Unit[] {
  return living(s).filter(t => {
    if (!sideMatches(unit, action, t)) return false;
    if (action.effect === 'swap' && (t === unit || (t.team !== unit.team && t.mods.pushImmune))) return false;
    return inRange(s.map, from, action, posIf(unit, from, t), rangeBonus(unit, action));
  });
}

/** Units an action aimed at `cell` hits if the unit stood at `from`. */
export function affectedBy(s: BattleState, unit: Unit, action: ActionDef, from: Pos, cell: Pos): Unit[] {
  if (action.effect === 'teleport') return [];
  const r = areaRadius(unit, action);
  if (r < 0) return targetsFor(s, unit, action, from).filter(t => samePos(posIf(unit, from, t), cell));
  return living(s).filter(t => sideMatches(unit, action, t) && manhattan(posIf(unit, from, t), cell) <= r);
}

/** Cells the action can be aimed at from `from`: single targets, area centres that hit someone, or empty cells for a teleport. */
export function actionTargets(s: BattleState, unit: Unit, action: ActionDef, from: Pos = unit.pos): Pos[] {
  if (action.uses !== undefined && (unit.uses[action.id] ?? 0) >= action.uses) return [];
  const bonus = rangeBonus(unit, action);
  if (action.effect === 'teleport') {
    const taken = new Set(living(s).filter(u => u !== unit).map(u => key(u.pos)));
    const out: Pos[] = [];
    for (let y = 0; y < s.map.height; y++) for (let x = 0; x < s.map.width; x++) {
      const p = { x, y };
      if (!samePos(p, from) && isWalkable(s.map, p) && !taken.has(key(p)) && inRange(s.map, from, action, p, bonus)) out.push(p);
    }
    return out;
  }
  const r = areaRadius(unit, action);
  if (r < 0) return targetsFor(s, unit, action, from).map(t => posIf(unit, from, t));
  // only centres that would hit someone: around each possible target
  const seen = new Set<string>(), out: Pos[] = [];
  for (const t of living(s).filter(t => sideMatches(unit, action, t)))
    for (const p of areaCells(s.map, posIf(unit, from, t), r))
      if (!seen.has(key(p))) {
        seen.add(key(p));
        if (inRange(s.map, from, action, p, bonus)) out.push(p);
      }
  return out;
}

/** Pure reducer: returns a new state or throws BattleError. Safe to run on the server with untrusted actions. */
export function apply(prev: BattleState, action: BattleAction): BattleState {
  if (prev.winner) throw new BattleError('battle is over');
  const s: BattleState = { ...prev, units: prev.units.map(cloneUnit), events: [], xp: { ...prev.xp } };
  const u = activeUnit(s);

  switch (action?.type) {
    case 'move': {
      if (s.moved) throw new BattleError('already moved');
      const to = action.to;
      if (!destinations(s.map, s.units, u).some(p => samePos(p, to))) throw new BattleError('cannot move there');
      const path = pathTo(reachable(s.map, s.units, u), to);
      u.pos = { x: to.x, y: to.y };
      s.moved = true;
      s.events.push({ type: 'move', unitId: u.id, path });
      settle(s);
      break;
    }
    case 'act': {
      if (s.acted) throw new BattleError('already acted');
      const def = unitActions(u).find(a => a.id === action.actionId);
      if (!def) throw new BattleError('unknown action');
      const cell = action.target;
      if (!Number.isInteger(cell?.x) || !Number.isInteger(cell?.y) || !inBounds(s.map, cell)) throw new BattleError('invalid target');
      if (!actionTargets(s, u, def).some(p => samePos(p, cell))) throw new BattleError('invalid target');
      if (def.effect === 'teleport') {
        u.pos = { x: cell.x, y: cell.y };
        s.events.push({ type: 'teleport', unitId: u.id, to: u.pos });
      } else if (def.effect === 'swap') {
        const t = affectedBy(s, u, def, u.pos, cell)[0];
        [u.pos, t.pos] = [t.pos, u.pos];
        s.events.push({ type: 'swap', unitId: u.id, otherId: t.id });
      } else {
        if (!samePos(cell, u.pos)) u.facing = facingToward(u.pos, cell);
        for (const t of affectedBy(s, u, def, u.pos, cell)) hit(s, u, def, t);
      }
      if (def.uses !== undefined) u.uses[def.id] = (u.uses[def.id] ?? 0) + 1;
      s.xp[u.id] += XP_ACTION;
      s.acted = true;
      settle(s);
      break;
    }
    case 'end': {
      if (!Object.hasOwn(DIRS, action.facing)) throw new BattleError('invalid facing');
      u.facing = action.facing;
      endTurn(s, u);
      advance(s);
      settle(s);
      break;
    }
    default:
      throw new BattleError('unknown action type');
  }
  return s;
}

/** HP loss outside the attack roll; true if it downed the unit. */
function hurt(s: BattleState, t: Unit, amount: number): boolean {
  if (t.hp <= 0) return false;
  t.hp = Math.max(0, t.hp - amount);
  if (t.hp > 0) return false;
  s.events.push({ type: 'ko', unitId: t.id });
  return true;
}

/** One target of an action: damage or heal, then status, then push. */
function hit(s: BattleState, u: Unit, def: ActionDef, t: Unit) {
  let r: number;
  if (def.effect === 'damage') {
    if (t.mods.dodgePct > 0) {
      [r, s.seed] = nextRandom(s.seed);
      if (r * 100 < t.mods.dodgePct) return void s.events.push({ type: 'dodge', unitId: t.id });
    }
    [r, s.seed] = nextRandom(s.seed);
    const amount = Math.max(1, Math.round(expectedAmount(s.map, u, u.pos, def, t) * (0.9 + r * 0.2)));
    t.hp = Math.max(0, t.hp - amount);
    s.events.push({ type: 'damage', unitId: t.id, amount, side: sideOf(u.pos, t) });
    if (t.hp === 0) {
      s.events.push({ type: 'ko', unitId: t.id });
      s.xp[u.id] += XP_KILL;
    }
    if (t.mods.thornsPct > 0 && !def.ranged && u.hp > 0) {
      const back = Math.max(1, Math.round((amount * t.mods.thornsPct) / 100));
      s.events.push({ type: 'tick', unitId: u.id, amount: -back });
      hurt(s, u, back);
    }
  } else if (def.effect === 'heal') {
    [r, s.seed] = nextRandom(s.seed);
    const amount = Math.max(1, Math.round(expectedAmount(s.map, u, u.pos, def, t) * (0.9 + r * 0.2)));
    const healed = Math.min(amount, t.stats.maxHp - t.hp);
    t.hp += healed;
    s.events.push({ type: 'heal', unitId: t.id, amount: healed });
  }
  if (t.hp <= 0) return;
  const st = def.status;
  if (st && !(st.id === 'stun' && t.mods.stunImmune)) {
    let lands = true;
    if (st.chance !== undefined) {
      [r, s.seed] = nextRandom(s.seed);
      lands = r * 100 < st.chance + u.mods.chanceBonus;
    }
    if (lands) addStatus(s, t, st.id, st.turns + (STATUSES[st.id].buff ? u.mods.buffTurns : 0));
  }
  if (def.push && !t.mods.pushImmune) {
    const { path, damage } = pushResult(s.map, s.units, u.pos, t, def.push + u.mods.pushBonus);
    t.pos = { ...path[path.length - 1] };
    s.events.push({ type: 'push', unitId: t.id, path, damage });
    if (damage && hurt(s, t, damage)) s.xp[u.id] += XP_KILL;
  }
}

/** The same status again does not stack: it keeps the longer duration. */
function addStatus(s: BattleState, t: Unit, id: StatusId, turns: number) {
  const cur = t.statuses.find(x => x.id === id);
  if (cur) cur.turns = Math.max(cur.turns, turns);
  else t.statuses.push({ id, turns });
  s.events.push({ type: 'status', unitId: t.id, statusId: id, on: true });
}

function endTurn(s: BattleState, u: Unit) {
  for (const st of u.statuses) if (--st.turns <= 0) s.events.push({ type: 'status', unitId: u.id, statusId: st.id, on: false });
  u.statuses = u.statuses.filter(st => st.turns > 0);
}

/** Regeneration (race, passive, status), then poison. */
function startTurn(s: BattleState, u: Unit) {
  const max = u.stats.maxHp;
  let regen = u.mods.regenPct, poison = 0;
  for (const st of u.statuses) {
    const pct = STATUSES[st.id].tickPct ?? 0;
    if (pct > 0) regen += pct;
    else poison -= pct;
  }
  const healed = Math.min(Math.round((max * regen) / 100), max - u.hp);
  if (healed > 0) {
    u.hp += healed;
    s.events.push({ type: 'tick', unitId: u.id, amount: healed });
  }
  if (poison > 0) {
    const dmg = Math.max(1, Math.round((max * poison) / 100));
    s.events.push({ type: 'tick', unitId: u.id, amount: -dmg });
    hurt(s, u, dmg);
  }
}

export function checkWinner(s: BattleState): Team | null {
  const up = (u: Unit) => u.hp > 0;
  const a = s.units.filter(u => u.team === 'A'), b = s.units.filter(u => u.team === 'B');
  if (!a.some(up) || s.protect.some(id => !up(unitById(s, id)))) return 'B';
  if (!b.some(up)) return 'A';
  const g = s.goal;
  if (g.type === 'boss' && !up(unitById(s, g.unitId))) return 'A';
  if (g.type === 'reach' && a.some(u => up(u) && g.cells.some(c => samePos(c, u.pos)))) return 'A';
  if (g.type === 'survive' && s.round > g.rounds) return 'A';
  return null;
}

/** Sets the winner, if any, and gives the victory XP once. */
function settle(s: BattleState) {
  if (s.winner) return;
  s.winner = checkWinner(s);
  if (s.winner) for (const w of s.units) if (w.team === s.winner && w.hp > 0) s.xp[w.id] += XP_VICTORY;
}

/** Next living unit; its turn starts with the ticks, and a stunned unit passes straight on. */
function advance(s: BattleState) {
  for (;;) {
    let idx = s.turn;
    do {
      idx++;
      if (idx >= s.order.length) { idx = 0; s.round++; }
    } while (unitById(s, s.order[idx]).hp <= 0);
    s.turn = idx;
    s.moved = false;
    s.acted = false;
    const u = activeUnit(s);
    startTurn(s, u);
    settle(s);
    if (s.winner) return;
    if (u.hp <= 0) continue;
    if (!u.statuses.some(st => STATUSES[st.id].skipTurn)) return;
    s.events.push({ type: 'skip', unitId: u.id });
    endTurn(s, u);
  }
}
