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

export interface ClassDef {
  id: string;
  name: string;
  stats: Stats;
  actions: ActionDef[];
}

export const CLASSES: Record<string, ClassDef> = {
  warrior: {
    id: 'warrior',
    name: 'Guerriero',
    stats: { maxHp: 60, atk: 14, def: 6, mag: 2, speed: 6, move: 4, jump: 2 },
    actions: [{ id: 'strike', name: 'Colpo', effect: 'damage', stat: 'atk', power: 1, minRange: 1, maxRange: 1, ranged: false, targets: 'enemy' }],
  },
  archer: {
    id: 'archer',
    name: 'Arciere',
    stats: { maxHp: 45, atk: 12, def: 3, mag: 2, speed: 8, move: 4, jump: 3 },
    actions: [{ id: 'shoot', name: 'Tiro', effect: 'damage', stat: 'atk', power: 0.9, minRange: 2, maxRange: 4, ranged: true, targets: 'enemy' }],
  },
  cleric: {
    id: 'cleric',
    name: 'Chierico',
    stats: { maxHp: 42, atk: 7, def: 3, mag: 12, speed: 5, move: 3, jump: 2 },
    actions: [
      { id: 'staff', name: 'Bastone', effect: 'damage', stat: 'atk', power: 1, minRange: 1, maxRange: 1, ranged: false, targets: 'enemy' },
      { id: 'mend', name: 'Cura', effect: 'heal', stat: 'mag', power: 1.5, minRange: 0, maxRange: 3, ranged: true, targets: 'ally' },
    ],
  },
};
