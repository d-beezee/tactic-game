import { nextRandom } from './rng';
import type { Unit } from './units';

/** Rolled once at battle start: speed + random(0..5). Order is then fixed and cycles. */
export function rollInitiative(units: Unit[], seed: number): { order: string[]; seed: number } {
  const scored = units.map(u => {
    let r: number;
    [r, seed] = nextRandom(seed);
    return { id: u.id, score: u.stats.speed + r * 5 };
  });
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { order: scored.map(s => s.id), seed };
}
