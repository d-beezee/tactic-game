import { DEFAULT_RACE, heightPct, RACES, SIDE_MULT, type MissionEnemy, type Side } from '@tactics/core';

export const raceName = (id: string | undefined) => RACES[id ?? DEFAULT_RACE].name;

/** "3 nemici, livello 2–5" */
export const enemySummary = (enemies: MissionEnemy[]) => {
  if (!enemies.length) return 'nessun nemico';
  const lv = enemies.map(e => e.level), lo = Math.min(...lv), hi = Math.max(...lv);
  return `${enemies.length === 1 ? '1 nemico' : `${enemies.length} nemici`}, livello ${lo === hi ? lo : `${lo}–${hi}`}`;
};

const SIDE_NAME: Record<Side, string> = { front: 'Di fronte', flank: 'Di fianco', back: 'Alle spalle' };
/** "Alle spalle ×1,5", from the core multiplier. */
export const sideText = (side: Side) =>
  SIDE_MULT[side] === 1 ? SIDE_NAME[side] : `${SIDE_NAME[side]} ×${SIDE_MULT[side].toLocaleString('it-IT')}`;
/** "+10%", the damage bonus for a height difference. */
export const heightText = (dh: number) => `${dh > 0 ? '+' : ''}${heightPct(dh)}%`;
