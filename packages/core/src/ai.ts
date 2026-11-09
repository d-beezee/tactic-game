import { activeUnit, living, targetsFor, type BattleAction, type BattleState } from './battle';
import { CLASSES, type ActionDef } from './classes';
import { expectedAmount } from './combat';
import { facingToward, manhattan, samePos, type Pos } from './map';
import { destinations } from './pathfinding';
import type { Unit } from './units';

/** Greedy AI: best single action over all reachable cells, else walk toward the nearest enemy. */
export function planTurn(s: BattleState): BattleAction[] {
  const u = activeUnit(s);
  const spots = s.moved ? [u.pos] : [u.pos, ...destinations(s.map, s.units, u)];
  const enemies = living(s).filter(t => t.team !== u.team);
  const nearestEnemy = (p: Pos) => enemies.reduce((a, b) => (manhattan(p, b.pos) < manhattan(p, a.pos) ? b : a));

  let best: { score: number; from: Pos; action: ActionDef; target: Unit } | null = null;
  if (!s.acted) {
    for (const from of spots)
      for (const action of CLASSES[u.classId].actions)
        for (const target of targetsFor(s, u, action, from)) {
          const score = scoreAction(s, u, from, action, target) - 0.01 * manhattan(u.pos, from);
          if (score > 0 && (!best || score > best.score)) best = { score, from, action, target };
        }
  }

  const plan: BattleAction[] = [];
  let final = u.pos;
  if (best) {
    if (!samePos(best.from, u.pos)) plan.push({ type: 'move', to: best.from });
    plan.push({ type: 'act', actionId: best.action.id, target: best.target === u ? best.from : best.target.pos });
    final = best.from;
  } else if (!s.moved && enemies.length) {
    const dist = (p: Pos) => manhattan(p, nearestEnemy(p).pos);
    final = spots.reduce((a, b) => (dist(b) < dist(a) ? b : a));
    if (!samePos(final, u.pos)) plan.push({ type: 'move', to: final });
  }
  plan.push({ type: 'end', facing: enemies.length ? facingToward(final, nearestEnemy(final).pos) : u.facing });
  return plan;
}

function scoreAction(s: BattleState, u: Unit, from: Pos, action: ActionDef, target: Unit): number {
  const amount = expectedAmount(s.map, u, from, action, target);
  if (action.effect === 'heal') return 0.8 * Math.min(amount, target.stats.maxHp - target.hp);
  return Math.min(amount, target.hp) + (amount >= target.hp ? 50 : 0);
}
