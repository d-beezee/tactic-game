export interface Stats {
  maxHp: number;
  atk: number;
  def: number;
  mag: number;
  speed: number;
  move: number;
  jump: number;
}

export interface ActionDef {
  id: string;
  name: string;
  effect: 'damage' | 'heal';
  stat: 'atk' | 'mag';
  power: number;
  minRange: number;
  maxRange: number;
  /** ranged: no vertical reach limit, gains range from height. Melee: |dh| <= MELEE_REACH */
  ranged: boolean;
  targets: 'enemy' | 'ally';
}

/** Passive unlocked at PASSIVE_LEVEL of its class; one can be equipped per unit. */
export interface PassiveDef {
  name: string;
  description: string;
  stat?: { key: keyof Stats; add?: number; pct?: number };
  /** extra range for ranged actions */
  range?: number;
  /** % bonus to healing done */
  healPct?: number;
  /** % change to damage taken (negative = less) */
  damageTakenPct?: number;
}

export interface ClassDef {
  id: string;
  name: string;
  /** stats at class level 1 */
  stats: Stats;
  actions: ActionDef[];
  passive: PassiveDef;
  /** class levels needed to unlock it; base classes have none */
  requires?: Record<string, number>;
}

export const CLASSES: Record<string, ClassDef> = {
  warrior: {
    id: 'warrior',
    name: 'Guerriero',
    stats: { maxHp: 60, atk: 14, def: 6, mag: 2, speed: 6, move: 4, jump: 2 },
    actions: [{ id: 'strike', name: 'Colpo', effect: 'damage', stat: 'atk', power: 1, minRange: 1, maxRange: 1, ranged: false, targets: 'enemy' }],
    passive: { name: 'Tempra', description: '+10% PV massimi', stat: { key: 'maxHp', pct: 10 } },
  },
  archer: {
    id: 'archer',
    name: 'Arciere',
    stats: { maxHp: 45, atk: 12, def: 3, mag: 2, speed: 8, move: 4, jump: 3 },
    actions: [{ id: 'shoot', name: 'Tiro', effect: 'damage', stat: 'atk', power: 0.9, minRange: 2, maxRange: 4, ranged: true, targets: 'enemy' }],
    passive: { name: 'Occhio di falco', description: '+1 gittata alle azioni a distanza', range: 1 },
  },
  cleric: {
    id: 'cleric',
    name: 'Chierico',
    stats: { maxHp: 42, atk: 7, def: 3, mag: 12, speed: 5, move: 3, jump: 2 },
    actions: [
      { id: 'staff', name: 'Bastone', effect: 'damage', stat: 'atk', power: 1, minRange: 1, maxRange: 1, ranged: false, targets: 'enemy' },
      { id: 'mend', name: 'Cura', effect: 'heal', stat: 'mag', power: 1.5, minRange: 0, maxRange: 3, ranged: true, targets: 'ally' },
    ],
    passive: { name: 'Grazia', description: '+25% alle cure', healPct: 25 },
  },
  paladin: {
    id: 'paladin',
    name: 'Paladino',
    requires: { warrior: 4, cleric: 2 },
    stats: { maxHp: 64, atk: 13, def: 7, mag: 7, speed: 5, move: 4, jump: 2 },
    actions: [
      { id: 'strike', name: 'Colpo', effect: 'damage', stat: 'atk', power: 1, minRange: 1, maxRange: 1, ranged: false, targets: 'enemy' },
      { id: 'lay-hands', name: 'Cura minore', effect: 'heal', stat: 'mag', power: 1, minRange: 0, maxRange: 1, ranged: true, targets: 'ally' },
    ],
    passive: { name: 'Scudo sacro', description: '-10% danni subiti', damageTakenPct: -10 },
  },
  ranger: {
    id: 'ranger',
    name: 'Ranger',
    requires: { archer: 4, warrior: 2 },
    stats: { maxHp: 52, atk: 13, def: 4, mag: 2, speed: 8, move: 5, jump: 3 },
    actions: [
      { id: 'longshot', name: 'Tiro lungo', effect: 'damage', stat: 'atk', power: 0.9, minRange: 2, maxRange: 5, ranged: true, targets: 'enemy' },
      { id: 'knife', name: 'Coltello', effect: 'damage', stat: 'atk', power: 0.8, minRange: 1, maxRange: 1, ranged: false, targets: 'enemy' },
    ],
    passive: { name: 'Passo leggero', description: '+1 movimento', stat: { key: 'move', add: 1 } },
  },
  sage: {
    id: 'sage',
    name: 'Saggio',
    requires: { cleric: 4, archer: 2 },
    stats: { maxHp: 44, atk: 5, def: 3, mag: 14, speed: 6, move: 3, jump: 2 },
    actions: [
      { id: 'bolt', name: 'Folgore', effect: 'damage', stat: 'mag', power: 1, minRange: 2, maxRange: 4, ranged: true, targets: 'enemy' },
      { id: 'mend', name: 'Cura', effect: 'heal', stat: 'mag', power: 1.5, minRange: 0, maxRange: 4, ranged: true, targets: 'ally' },
    ],
    passive: { name: 'Concentrazione', description: '+15% magia', stat: { key: 'mag', pct: 15 } },
  },
};
