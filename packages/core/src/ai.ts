import { actionTargets, activeUnit, affectedBy, living, type BattleAction, type BattleState } from './battle';
import type { ActionDef } from './classes';
import { expectedAmount, pushResult } from './combat';
import { facingToward, manhattan, samePos, type Pos } from './map';
import { destinations } from './pathfinding';
import { STATUSES } from './statuses';
import { unitActions, type Unit } from './units';

/** Greedy AI: best single action over all reachable cells, else walk toward the nearest enemy. Never teleports or swaps. */
export function planTurn(s: BattleState): BattleAction[] {
  const u = activeUnit(s);
  const spots = s.moved ? [u.pos] : [u.pos, ...destinations(s.map, s.units, u)];
  const enemies = living(s).filter(t => t.team !== u.team);
  const nearestEnemy = (p: Pos) => enemies.reduce((a, b) => (manhattan(p, b.pos) < manhattan(p, a.pos) ? b : a));
  const actions = unitActions(u).filter(a => a.effect !== 'teleport' && a.effect !== 'swap');

  let best: { score: number; from: Pos; action: ActionDef; cell: Pos } | null = null;
  if (!s.acted) {
    for (const from of spots)
      for (const action of actions)
        for (const cell of actionTargets(s, u, action, from)) {
          const score = scoreAction(s, u, from, action, affectedBy(s, u, action, from, cell)) - 0.01 * manhattan(u.pos, from);
          if (score > 0 && (!best || score > best.score)) best = { score, from, action, cell };
        }
  }

  const plan: BattleAction[] = [];
  let final = u.pos;
  if (best) {
    if (!samePos(best.from, u.pos)) plan.push({ type: 'move', to: best.from });
    plan.push({ type: 'act', actionId: best.action.id, target: best.cell });
    final = best.from;
  } else if (!s.moved && enemies.length) {
    const dist = (p: Pos) => manhattan(p, nearestEnemy(p).pos);
    final = spots.reduce((a, b) => (dist(b) < dist(a) ? b : a));
    if (!samePos(final, u.pos)) plan.push({ type: 'move', to: final });
  }
  plan.push({ type: 'end', facing: enemies.length ? facingToward(final, nearestEnemy(final).pos) : u.facing });
  return plan;
}

// shortcut: fixed weights for statuses and pushes, tuned by feel; revisit once the new classes have been played.
function scoreAction(s: BattleState, u: Unit, from: Pos, action: ActionDef, targets: Unit[]): number {
  let score = 0;
  for (const t of targets) {
    const amount = expectedAmount(s.map, u, from, action, t);
    if (action.effect === 'heal') score += 0.8 * Math.min(amount, t.stats.maxHp - t.hp);
    if (action.effect === 'damage') {
      score += Math.min(amount, t.hp) + (amount >= t.hp ? 50 : 0);
      if (amount >= t.hp) continue;
    }
    const st = action.status;
    if (st && !t.statuses.some(x => x.id === st.id && x.turns >= st.turns) && !(st.id === 'stun' && t.mods.stunImmune)) {
      const tick = Math.max(1, Math.round((t.stats.maxHp * Math.abs(STATUSES[st.id].tickPct ?? 0)) / 100));
      const value = st.id === 'stun' ? 0.3 * t.hp
        : st.id === 'poison' ? Math.min(3 * tick, t.hp)
        : st.id === 'regen' ? 0.5 * Math.min(3 * tick, t.stats.maxHp - t.hp)
        : STATUSES[st.id].buff ? 8 : 10;
      score += value * Math.min(1, ((st.chance ?? 100) + u.mods.chanceBonus) / 100);
    }
    if (action.push && !t.mods.pushImmune) score += pushResult(s.map, s.units, from, t, action.push + u.mods.pushBonus).damage;
  }
  return score;
}
