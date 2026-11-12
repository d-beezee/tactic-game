import { DEFAULT_RACE } from '@tactics/core';

// shortcut: hand-kept list of the sprite sets in public/units; update it when new art lands.
// Humans live in units/<classId>/, the other races in units/<raceId>/<classId>/, each with N/E/S/W.png.
const SETS: Record<string, string[]> = {
  [DEFAULT_RACE]: ['warrior', 'archer', 'cleric', 'paladin', 'ranger', 'sage', 'thief', 'arcanist', 'assassin', 'warlock'],
  corvid: ['warrior', 'archer', 'cleric', 'paladin', 'ranger', 'sage', 'thief', 'arcanist', 'assassin', 'warlock', 'lancer', 'stormcaller'],
  peatfolk: ['warrior', 'archer', 'cleric', 'paladin', 'ranger', 'sage', 'thief', 'arcanist', 'assassin', 'warlock', 'green_mage', 'green_knight', 'druid'],
};

/** Folder of a unit's sprites: its race's art, else the human art of its class, else null (placeholder body). */
export function spriteDir(raceId: string, classId: string): string | null {
  if (raceId !== DEFAULT_RACE && SETS[raceId]?.includes(classId)) return `units/${raceId}/${classId}`;
  return SETS[DEFAULT_RACE].includes(classId) ? `units/${classId}` : null;
}

/** Every sprite folder, for the battle to preload. */
export const ALL_SPRITE_DIRS = Object.entries(SETS).flatMap(([race, classes]) => classes.map(c => spriteDir(race, c)!));
