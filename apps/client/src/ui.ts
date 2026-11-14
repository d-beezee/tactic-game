import { DEFAULT_RACE, RACES, type MissionEnemy } from '@tactics/core';

export const raceName = (id: string | undefined) => RACES[id ?? DEFAULT_RACE].name;

/** "3 nemici, livello 2–5" */
export const enemySummary = (enemies: MissionEnemy[]) => {
  if (!enemies.length) return 'nessun nemico';
  const lv = enemies.map(e => e.level), lo = Math.min(...lv), hi = Math.max(...lv);
  return `${enemies.length === 1 ? '1 nemico' : `${enemies.length} nemici`}, livello ${lo === hi ? lo : `${lo}–${hi}`}`;
};
