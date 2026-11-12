import type { StatusId } from './statuses';

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
  /** 'none': only the status; 'teleport': the actor jumps to an empty cell; 'swap': actor and target trade cells */
  effect: 'damage' | 'heal' | 'none' | 'teleport' | 'swap';
  stat: 'atk' | 'mag';
  power: number;
  minRange: number;
  maxRange: number;
  /** ranged: no vertical reach limit, gains range from height. Melee: |dh| <= MELEE_REACH */
  ranged: boolean;
  /** 'cell': an empty cell (teleport) */
  targets: 'enemy' | 'ally' | 'cell';
  /** radius of a diamond around the target cell; the cell may be empty */
  area?: number;
  /** chance in % (always if missing) */
  status?: { id: StatusId; turns: number; chance?: number };
  /** cells the target is pushed away from the actor */
  push?: number;
  /** uses per battle; unlimited if missing */
  uses?: number;
}

/** Battle-time effects of the race trait and the equipped passive that are not plain stats. Trait and passive add up. */
export interface Mods {
  /** extra range for ranged actions */
  range: number;
  /** extra range for ranged actions that use MAG */
  magicRange: number;
  /** % bonus to healing done */
  healPct: number;
  /** % change to damage taken (negative = less) */
  damageTakenPct: number;
  /** % of max HP healed at the start of each turn */
  regenPct: number;
  /** % chance to dodge a damaging action */
  dodgePct: number;
  /** flags: 1 = yes */
  fallImmune: number;
  pushImmune: number;
  stunImmune: number;
  /** % bonus to damage dealt from behind */
  backDamagePct: number;
  /** % bonus to damage dealt with MAG */
  magicDamagePct: number;
  /** % of melee damage taken that goes back to the attacker */
  thornsPct: number;
  areaBonus: number;
  pushBonus: number;
  /** extra turns on the buffs this unit applies */
  buffTurns: number;
  /** points added to the chance of the statuses this unit applies */
  chanceBonus: number;
}

export const EMPTY_MODS: Mods = {
  range: 0, magicRange: 0, healPct: 0, damageTakenPct: 0, regenPct: 0, dodgePct: 0, fallImmune: 0, pushImmune: 0, stunImmune: 0,
  backDamagePct: 0, magicDamagePct: 0, thornsPct: 0, areaBonus: 0, pushBonus: 0, buffTurns: 0, chanceBonus: 0,
};

/** Passive unlocked at PASSIVE_LEVEL of its class; one can be equipped per unit. */
export interface PassiveDef {
  name: string;
  description: string;
  stat?: { key: keyof Stats; add?: number; pct?: number };
  mods?: Partial<Mods>;
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
  /** races that can take it; all if missing. A class requiring a race-locked class is locked too: see allowedRaces */
  races?: string[];
}

type Opt = Partial<Pick<ActionDef, 'area' | 'status' | 'push' | 'uses'>>;
const melee = (id: string, name: string, power: number, opt: Opt = {}, maxRange = 1): ActionDef =>
  ({ id, name, effect: 'damage', stat: 'atk', power, minRange: 1, maxRange, ranged: false, targets: 'enemy', ...opt });
const shot = (id: string, name: string, stat: 'atk' | 'mag', power: number, minRange: number, maxRange: number, opt: Opt = {}): ActionDef =>
  ({ id, name, effect: 'damage', stat, power, minRange, maxRange, ranged: true, targets: 'enemy', ...opt });
const heal = (id: string, name: string, power: number, maxRange: number, opt: Opt = {}): ActionDef =>
  ({ id, name, effect: 'heal', stat: 'mag', power, minRange: 0, maxRange, ranged: true, targets: 'ally', ...opt });
/** no damage, only the status (or the swap) */
const spell = (id: string, name: string, targets: 'enemy' | 'ally', minRange: number, maxRange: number, opt: Opt = {}, effect: 'none' | 'swap' = 'none'): ActionDef =>
  ({ id, name, effect, stat: 'mag', power: 0, minRange, maxRange, ranged: true, targets, ...opt });

const STRIKE = melee('strike', 'Colpo', 1);
const MEND = heal('mend', 'Cura', 1.5, 3);
const POISON_DAGGER = melee('poison-dagger', 'Pugnale avvelenato', 0.8, { status: { id: 'poison', turns: 3 } });
const FLAMES = shot('flames', 'Fiammata', 'mag', 0.8, 2, 4, { area: 1 });
const SPORES = shot('spores', 'Spore', 'mag', 0.6, 2, 4, { area: 1, status: { id: 'poison', turns: 3 } });
const LUNGE = melee('lunge', 'Affondo', 1, {}, 2);
const DIVE = melee('dive', 'Picchiata', 1.2, { push: 1 });
const WARM_LIGHT = spell('warm-light', 'Luce calda', 'ally', 0, 3, { area: 1, status: { id: 'atk-up', turns: 3 } });

const TORBIDI = ['peatfolk'], CORVIDI = ['corvid'], LUCIGENI = ['lumen'];

export const CLASSES: Record<string, ClassDef> = {
  warrior: {
    id: 'warrior',
    name: 'Guerriero',
    stats: { maxHp: 60, atk: 14, def: 6, mag: 2, speed: 6, move: 4, jump: 2 },
    actions: [STRIKE],
    passive: { name: 'Tempra', description: '+10% PV massimi', stat: { key: 'maxHp', pct: 10 } },
  },
  archer: {
    id: 'archer',
    name: 'Arciere',
    stats: { maxHp: 45, atk: 12, def: 3, mag: 2, speed: 8, move: 4, jump: 3 },
    actions: [shot('shoot', 'Tiro', 'atk', 0.9, 2, 4)],
    passive: { name: 'Occhio di falco', description: '+1 gittata alle azioni a distanza', mods: { range: 1 } },
  },
  cleric: {
    id: 'cleric',
    name: 'Chierico',
    stats: { maxHp: 42, atk: 7, def: 3, mag: 12, speed: 5, move: 3, jump: 2 },
    actions: [melee('staff', 'Bastone', 1), MEND],
    passive: { name: 'Grazia', description: '+25% alle cure', mods: { healPct: 25 } },
  },
  thief: {
    id: 'thief',
    name: 'Ladro',
    stats: { maxHp: 46, atk: 12, def: 4, mag: 2, speed: 9, move: 5, jump: 3 },
    actions: [POISON_DAGGER, melee('kick', 'Calcio', 0.5, { push: 1 })],
    passive: { name: 'Alle spalle', description: '+15% danni alle spalle', mods: { backDamagePct: 15 } },
  },
  arcanist: {
    id: 'arcanist',
    name: 'Arcanista',
    stats: { maxHp: 40, atk: 4, def: 2, mag: 14, speed: 6, move: 3, jump: 2 },
    actions: [shot('spark', 'Scintilla', 'mag', 1, 1, 3), FLAMES],
    passive: { name: 'Fuoco vivo', description: '+10% danni magici', mods: { magicDamagePct: 10 } },
  },
  green_mage: {
    id: 'green_mage',
    name: 'Mago verde',
    races: TORBIDI,
    stats: { maxHp: 50, atk: 6, def: 4, mag: 11, speed: 5, move: 3, jump: 2 },
    actions: [
      SPORES,
      heal('sap', 'Linfa', 1, 3, { status: { id: 'regen', turns: 3 } }),
      spell('roots', 'Radici', 'enemy', 1, 3, { status: { id: 'root', turns: 2 } }),
    ],
    passive: { name: 'Muschio', description: 'Recupera il 3% dei PV a inizio turno', mods: { regenPct: 3 } },
  },
  lancer: {
    id: 'lancer',
    name: 'Lanciere',
    races: CORVIDI,
    stats: { maxHp: 50, atk: 13, def: 5, mag: 2, speed: 8, move: 4, jump: 4 },
    actions: [LUNGE, DIVE],
    passive: { name: 'Ali', description: '+1 salto', stat: { key: 'jump', add: 1 } },
  },
  lampwright: {
    id: 'lampwright',
    name: 'Lanternaio',
    races: LUCIGENI,
    stats: { maxHp: 44, atk: 5, def: 3, mag: 12, speed: 7, move: 3, jump: 2 },
    actions: [
      WARM_LIGHT,
      shot('dazzle', 'Abbaglio', 'mag', 0.5, 2, 4, { status: { id: 'atk-down', turns: 2 } }),
      shot('wisp', 'Fiamma fatua', 'mag', 0.9, 2, 4),
    ],
    passive: { name: 'Rifrazione', description: 'I buff che applica durano 1 turno in più', mods: { buffTurns: 1 } },
  },
  paladin: {
    id: 'paladin',
    name: 'Paladino',
    requires: { warrior: 4, cleric: 2 },
    stats: { maxHp: 64, atk: 13, def: 7, mag: 7, speed: 5, move: 4, jump: 2 },
    actions: [STRIKE, heal('lay-hands', 'Cura minore', 1, 1)],
    passive: { name: 'Scudo sacro', description: '-10% danni subiti', mods: { damageTakenPct: -10 } },
  },
  ranger: {
    id: 'ranger',
    name: 'Ranger',
    requires: { archer: 4, warrior: 2 },
    stats: { maxHp: 52, atk: 13, def: 4, mag: 2, speed: 8, move: 5, jump: 3 },
    actions: [shot('longshot', 'Tiro lungo', 'atk', 0.9, 2, 5), melee('knife', 'Coltello', 0.8)],
    passive: { name: 'Passo leggero', description: '+1 movimento', stat: { key: 'move', add: 1 } },
  },
  sage: {
    id: 'sage',
    name: 'Saggio',
    requires: { cleric: 4, archer: 2 },
    stats: { maxHp: 44, atk: 5, def: 3, mag: 14, speed: 6, move: 3, jump: 2 },
    actions: [shot('bolt', 'Folgore', 'mag', 1, 2, 4), heal('mend', 'Cura', 1.5, 4)],
    passive: { name: 'Concentrazione', description: '+15% magia', stat: { key: 'mag', pct: 15 } },
  },
  assassin: {
    id: 'assassin',
    name: 'Assassino',
    requires: { thief: 4, archer: 2 },
    stats: { maxHp: 48, atk: 15, def: 4, mag: 2, speed: 10, move: 5, jump: 3 },
    actions: [
      melee('stab', 'Pugnalata', 1.1, { status: { id: 'stun', turns: 1, chance: 30 } }),
      POISON_DAGGER,
      shot('knives', 'Lancio di coltelli', 'atk', 0.7, 2, 3),
    ],
    passive: { name: 'Ombra', description: '+25% danni alle spalle', mods: { backDamagePct: 25 } },
  },
  warlock: {
    id: 'warlock',
    name: 'Stregone',
    requires: { arcanist: 4, sage: 2 },
    stats: { maxHp: 42, atk: 4, def: 3, mag: 16, speed: 6, move: 3, jump: 2 },
    actions: [
      FLAMES,
      spell('curse', 'Maledizione', 'enemy', 2, 4, { status: { id: 'def-down', turns: 3 } }),
      shot('meteor', 'Meteora', 'mag', 1.1, 3, 5, { area: 1 }),
    ],
    passive: { name: 'Vastità', description: '+1 al raggio delle aree', mods: { areaBonus: 1 } },
  },
  green_knight: {
    id: 'green_knight',
    name: 'Cavaliere verde',
    requires: { green_mage: 4, warrior: 3 },
    stats: { maxHp: 66, atk: 13, def: 7, mag: 7, speed: 5, move: 4, jump: 2 },
    actions: [
      STRIKE,
      melee('bramble-grip', 'Stretta di rovi', 0.8, { status: { id: 'root', turns: 2 } }),
      spell('bark', 'Corteccia', 'ally', 0, 0, { status: { id: 'def-up', turns: 3 } }),
    ],
    passive: { name: 'Spine', description: 'Chi lo colpisce in mischia subisce il 10% del danno', mods: { thornsPct: 10 } },
  },
  druid: {
    id: 'druid',
    name: 'Druido',
    requires: { green_mage: 4, cleric: 4 },
    stats: { maxHp: 48, atk: 5, def: 4, mag: 14, speed: 6, move: 3, jump: 2 },
    actions: [
      heal('sap-rain', 'Pioggia di linfa', 1, 3, { area: 1 }),
      SPORES,
      shot('brambles', 'Rovi', 'mag', 0.9, 2, 4, { area: 1, status: { id: 'root', turns: 1, chance: 50 } }),
    ],
    passive: { name: 'Germoglio', description: '+20% alle cure', mods: { healPct: 20 } },
  },
  stormcaller: {
    id: 'stormcaller',
    name: 'Tempestaio',
    requires: { lancer: 4, ranger: 2 },
    stats: { maxHp: 54, atk: 14, def: 5, mag: 2, speed: 9, move: 5, jump: 4 },
    actions: [LUNGE, shot('gust', 'Raffica', 'atk', 0.7, 2, 4, { push: 1 }), DIVE],
    passive: { name: 'Turbine', description: 'Le sue spinte spostano di 1 casella in più', mods: { pushBonus: 1 } },
  },
  beacon: {
    id: 'beacon',
    name: 'Faro',
    requires: { lampwright: 4, sage: 2 },
    stats: { maxHp: 46, atk: 5, def: 3, mag: 15, speed: 7, move: 3, jump: 2 },
    actions: [WARM_LIGHT, shot('glare', 'Bagliore', 'mag', 0.7, 2, 4, { area: 1, status: { id: 'stun', turns: 1, chance: 30 } }), MEND],
    passive: { name: 'Fiaccola', description: '+20% alle cure', mods: { healPct: 20 } },
  },
  rook: {
    id: 'rook',
    name: 'Torre',
    races: ['pawn'],
    stats: { maxHp: 64, atk: 12, def: 8, mag: 3, speed: 4, move: 3, jump: 1 },
    actions: [STRIKE, spell('castling', 'Arrocco', 'ally', 1, 3, {}, 'swap')],
    passive: { name: 'Bastione', description: '+15% difesa', stat: { key: 'def', pct: 15 } },
  },
  flicker: {
    id: 'flicker',
    name: 'Lampo',
    races: ['sprite'],
    stats: { maxHp: 42, atk: 13, def: 3, mag: 4, speed: 11, move: 5, jump: 3 },
    actions: [melee('quick-cut', 'Taglio rapido', 0.7), spell('split', 'Sdoppiamento', 'ally', 0, 0, { status: { id: 'def-up', turns: 2 } })],
    passive: { name: 'Frame perso', description: '+10% schivata', mods: { dodgePct: 10 } },
  },
  corruptor: {
    id: 'corruptor',
    name: 'Corruttore',
    races: ['glitch'],
    stats: { maxHp: 40, atk: 4, def: 2, mag: 15, speed: 6, move: 3, jump: 2 },
    actions: [
      shot('rot-bit', 'Bit marcio', 'mag', 0.7, 2, 4, { area: 1, status: { id: 'def-down', turns: 2 } }),
      spell('invert', 'Inversione', 'enemy', 1, 4, {}, 'swap'),
    ],
    passive: { name: 'Instabilità', description: '+15% alla probabilità degli stati', mods: { chanceBonus: 15 } },
  },
};
