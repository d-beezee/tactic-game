import { CLASSES, type ActionDef } from './classes';
import { expectedAmount, inRange, sideOf, type Side } from './combat';
import { rollInitiative } from './initiative';
import { DIRS, facingToward, isWalkable, key, samePos, validateMap, type Dir, type MapData, type Pos, type Team } from './map';
import { destinations, pathTo, reachable } from './pathfinding';
import { nextRandom } from './rng';
import type { Unit } from './units';

export type BattleAction =
  | { type: 'move'; to: Pos }
  | { type: 'act'; actionId: string; target: Pos }
  | { type: 'end'; facing: Dir };

/** What the last action did, for the client to animate. */
export type BattleEvent =
  | { type: 'move'; unitId: string; path: Pos[] }
  | { type: 'damage'; unitId: string; amount: number; side: Side }
  | { type: 'heal'; unitId: string; amount: number }
  | { type: 'ko'; unitId: string };

export interface BattleState {
  map: MapData;
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

export function createBattle(map: MapData, units: Unit[], seed: number): BattleState {
  const errors = validateMap(map);
  if (errors.length) throw new BattleError(`invalid map: ${errors.join('; ')}`);
  const cells = new Set<string>();
  for (const u of units) {
    if (!isWalkable(map, u.pos) || cells.has(key(u.pos))) throw new BattleError(`bad position for ${u.id}`);
    cells.add(key(u.pos));
  }
  // maxDeploy bounds the player only: a mission may field more enemies
  const n = (team: string) => units.filter(u => u.team === team).length;
  if (n('A') === 0 || n('A') > map.maxDeploy) throw new BattleError(`team A must deploy 1..${map.maxDeploy} units`);
  if (n('B') === 0) throw new BattleError('team B has no units');
  const init = rollInitiative(units, seed);
  const xp = Object.fromEntries(units.map(u => [u.id, 0]));
  return { map, units, order: init.order, turn: 0, round: 1, moved: false, acted: false, seed: init.seed, winner: null, events: [], xp };
}

export const unitById = (s: BattleState, id: string) => s.units.find(u => u.id === id)!;
export const activeUnit = (s: BattleState) => unitById(s, s.order[s.turn]);
export const living = (s: BattleState) => s.units.filter(u => u.hp > 0);

/** Valid targets of an action if the unit stood at `from`. */
export function targetsFor(s: BattleState, unit: Unit, action: ActionDef, from: Pos = unit.pos): Unit[] {
  return living(s).filter(t => {
    if ((t.team === unit.team) !== (action.targets === 'ally')) return false;
    return inRange(s.map, from, action, t === unit ? from : t.pos, unit.mods.range);
  });
}

/** Pure reducer: returns a new state or throws BattleError. Safe to run on the server with untrusted actions. */
export function apply(prev: BattleState, action: BattleAction): BattleState {
  if (prev.winner) throw new BattleError('battle is over');
  const s: BattleState = { ...prev, units: prev.units.map(u => ({ ...u, pos: { ...u.pos } })), events: [], xp: { ...prev.xp } };
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
      break;
    }
    case 'act': {
      if (s.acted) throw new BattleError('already acted');
      const def = CLASSES[u.classId].actions.find(a => a.id === action.actionId);
      if (!def) throw new BattleError('unknown action');
      const target = targetsFor(s, u, def).find(t => samePos(t === u ? u.pos : t.pos, action.target));
      if (!target) throw new BattleError('invalid target');
      let r: number;
      [r, s.seed] = nextRandom(s.seed);
      const amount = Math.max(1, Math.round(expectedAmount(s.map, u, u.pos, def, target) * (0.9 + r * 0.2)));
      if (def.effect === 'heal') {
        const healed = Math.min(amount, target.stats.maxHp - target.hp);
        target.hp += healed;
        s.events.push({ type: 'heal', unitId: target.id, amount: healed });
      } else {
        const side = sideOf(u.pos, target);
        target.hp = Math.max(0, target.hp - amount);
        s.events.push({ type: 'damage', unitId: target.id, amount, side });
        if (target.hp === 0) {
          s.events.push({ type: 'ko', unitId: target.id });
          s.xp[u.id] += XP_KILL;
        }
      }
      s.xp[u.id] += XP_ACTION;
      if (target !== u) u.facing = facingToward(u.pos, target.pos);
      s.acted = true;
      s.winner = checkWinner(s.units);
      if (s.winner) for (const w of s.units) if (w.team === s.winner && w.hp > 0) s.xp[w.id] += XP_VICTORY;
      break;
    }
    case 'end': {
      if (!Object.hasOwn(DIRS, action.facing)) throw new BattleError('invalid facing');
      u.facing = action.facing;
      advance(s);
      break;
    }
    default:
      throw new BattleError('unknown action type');
  }
  return s;
}

function checkWinner(units: Unit[]): Team | null {
  const alive = new Set(units.filter(u => u.hp > 0).map(u => u.team));
  return alive.size === 1 ? [...alive][0] : null;
}

function advance(s: BattleState) {
  let idx = s.turn;
  do {
    idx++;
    if (idx >= s.order.length) { idx = 0; s.round++; }
  } while (unitById(s, s.order[idx]).hp <= 0);
  s.turn = idx;
  s.moved = false;
  s.acted = false;
}
