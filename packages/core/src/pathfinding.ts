import { DIRS, heightAt, inBounds, isWalkable, key, type MapData, type Pos } from './map';
import { effectiveStat, type Unit } from './units';

export interface Reach { pos: Pos; cost: number; prev: string | null }

/** BFS over cells within move range. Steps need |dh| <= jump. Allies can be passed through, enemies block. */
export function reachable(map: MapData, units: Unit[], mover: Unit): Map<string, Reach> {
  const occupant = new Map(units.filter(u => u.hp > 0).map(u => [key(u.pos), u]));
  const move = effectiveStat(mover, 'move');
  const out = new Map<string, Reach>([[key(mover.pos), { pos: mover.pos, cost: 0, prev: null }]]);
  const queue: Pos[] = [mover.pos];
  while (queue.length) {
    const cur = queue.shift()!;
    const node = out.get(key(cur))!;
    if (node.cost >= move) continue;
    for (const d of Object.values(DIRS)) {
      const next = { x: cur.x + d.x, y: cur.y + d.y };
      const k = key(next);
      if (out.has(k) || !inBounds(map, next) || !isWalkable(map, next)) continue;
      if (Math.abs(heightAt(map, next) - heightAt(map, cur)) > mover.stats.jump) continue;
      const occ = occupant.get(k);
      if (occ && occ.team !== mover.team) continue;
      out.set(k, { pos: next, cost: node.cost + 1, prev: key(cur) });
      queue.push(next);
    }
  }
  return out;
}

/** Cells the mover can end on (not its own cell, not occupied). */
export function destinations(map: MapData, units: Unit[], mover: Unit): Pos[] {
  const taken = new Set(units.filter(u => u.hp > 0).map(u => key(u.pos)));
  return [...reachable(map, units, mover).values()].filter(r => !taken.has(key(r.pos))).map(r => r.pos);
}

export function pathTo(reach: Map<string, Reach>, to: Pos): Pos[] {
  const path: Pos[] = [];
  for (let n = reach.get(key(to)); n; n = n.prev ? reach.get(n.prev) : undefined) path.unshift(n.pos);
  return path;
}
