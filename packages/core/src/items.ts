import type { Stats } from './classes';

export type Slot = 'weapon' | 'armor';
export const SLOTS: Slot[] = ['weapon', 'armor'];
export const SLOT_LABELS: Record<Slot, string> = { weapon: 'Arma', armor: 'Armatura' };

/** item id equipped in each slot; an empty slot has no key */
export type Equip = Partial<Record<Slot, string>>;

export interface ItemDef {
  id: string;
  name: string;
  slot: Slot;
  price: number;
  /** flat stat bonuses, added after level growth and before the passive */
  stats: Partial<Stats>;
}

const item = (id: string, name: string, slot: Slot, price: number, stats: Partial<Stats>): ItemDef => ({ id, name, slot, price, stats });

export const ITEMS: Record<string, ItemDef> = Object.fromEntries([
  item('keen-blade', 'Lama affilata', 'weapon', 120, { atk: 2 }),
  item('rune-blade', 'Lama runica', 'weapon', 300, { atk: 4 }),
  item('arcane-focus', 'Fulcro arcano', 'weapon', 150, { mag: 3 }),
  item('leather-coat', 'Giaco di cuoio', 'armor', 100, { def: 2 }),
  item('plate-armor', 'Corazza a piastre', 'armor', 280, { def: 4, speed: -1 }),
  item('vital-charm', 'Amuleto vitale', 'armor', 160, { maxHp: 10 }),
].map(i => [i.id, i]));

const STAT_SHORT: Record<keyof Stats, string> = { maxHp: 'PV', atk: 'ATT', def: 'DIF', mag: 'MAG', speed: 'VEL', move: 'MOV', jump: 'SALTO' };

/** e.g. "+4 DIF · -1 VEL" */
export const itemBonus = (i: ItemDef) =>
  Object.entries(i.stats).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${STAT_SHORT[k as keyof Stats]}`).join(' · ');
