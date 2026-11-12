import { CLASSES, type ActionDef, type Mods, type Stats } from './classes';

export interface RaceDef {
  id: string;
  name: string;
  /** flat bonuses, added after level growth */
  stats: Partial<Stats>;
  trait: { name: string; description: string; mods?: Partial<Mods>; /** % bonus to class XP */ xpPct?: number };
  /** actions every unit of the race has, whatever its class */
  actions?: ActionDef[];
  /** endgame race, from the "cartridge" */
  meta?: boolean;
}

export const DEFAULT_RACE = 'human';

export const RACES: Record<string, RaceDef> = {
  human: {
    id: 'human', name: 'Umano', stats: {},
    trait: { name: 'Versatili', description: '+10% XP di classe', xpPct: 10 },
  },
  corvid: {
    id: 'corvid', name: 'Corvide', stats: { maxHp: -6, speed: 1, jump: 1 },
    trait: { name: 'Piume', description: 'Nessun danno da caduta', mods: { fallImmune: 1 } },
  },
  peatfolk: {
    id: 'peatfolk', name: 'Torbido', stats: { maxHp: 8, def: 1, speed: -1 },
    trait: { name: 'Radici', description: 'Recupera il 5% dei PV a inizio turno', mods: { regenPct: 5 } },
  },
  lumen: {
    id: 'lumen', name: 'Lucigeno', stats: { mag: 2, atk: -2 },
    trait: { name: 'Lanterna', description: '+1 gittata alle azioni magiche', mods: { magicRange: 1 } },
  },
  pawn: {
    id: 'pawn', name: 'Pedina', meta: true, stats: { def: 2, move: -1 },
    trait: { name: 'Legno pieno', description: 'Immune a spinta, scambio e stordimento', mods: { pushImmune: 1, stunImmune: 1 } },
  },
  sprite: {
    id: 'sprite', name: 'Sprite', meta: true, stats: { speed: 2, maxHp: -4 },
    trait: { name: 'Sfarfallio', description: '10% di schivare un danno', mods: { dodgePct: 10 } },
  },
  glitch: {
    id: 'glitch', name: 'Glitch', meta: true, stats: { mag: 3, def: -2 },
    trait: { name: 'Salto di frame', description: 'Teletrasporto a 1–3 caselle, una volta per battaglia' },
    actions: [{ id: 'frame-skip', name: 'Salto di frame', effect: 'teleport', stat: 'atk', power: 0, minRange: 1, maxRange: 3, ranged: true, targets: 'cell', uses: 1 }],
  },
};

/** Races that can take a class: its own list, narrowed by the classes it requires. */
export function allowedRaces(classId: string): string[] {
  const c = CLASSES[classId];
  if (!c) return [];
  let out = c.races ?? Object.keys(RACES);
  for (const req of Object.keys(c.requires ?? {})) {
    const ok = allowedRaces(req);
    out = out.filter(r => ok.includes(r));
  }
  return out;
}
