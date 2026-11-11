import { CLASSES } from './classes';
import { ITEMS, SLOTS, type Slot } from './items';
import { DEFAULT_ROSTER, isUnlocked, unlockedPassives, type RosterUnit } from './roster';

/** Everything a player owns. All functions here are pure and validate untrusted input: the server runs them. */
export interface Player {
  gold: number;
  roster: RosterUnit[];
  /** owned copies of each item id, equipped ones included */
  inventory: Record<string, number>;
}

export const START_GOLD = 300;
export const TEST_BATTLE_GOLD = 20;

/** Invalid request from the player; the message is shown to them. */
export class PlayerError extends Error {}

export const newPlayer = (roster: RosterUnit[] = structuredClone(DEFAULT_ROSTER)): Player => ({ gold: START_GOLD, roster, inventory: {} });

export const equippedCount = (p: Player, itemId: string) =>
  p.roster.filter(u => Object.values(u.equip ?? {}).includes(itemId)).length;

export const freeCopies = (p: Player, itemId: string) => (p.inventory[itemId] ?? 0) - equippedCount(p, itemId);

export function buyItem(p: Player, itemId: unknown): Player {
  if (typeof itemId !== 'string' || !Object.hasOwn(ITEMS, itemId)) throw new PlayerError('Oggetto sconosciuto');
  const { price } = ITEMS[itemId];
  if (p.gold < price) throw new PlayerError(`Oro insufficiente: mancano ${price - p.gold}`);
  return { ...p, gold: p.gold - price, inventory: { ...p.inventory, [itemId]: (p.inventory[itemId] ?? 0) + 1 } };
}

export interface UnitChange {
  classId?: string;
  passive?: string | null;
  /** null empties the slot */
  equip?: Partial<Record<Slot, string | null>>;
}

export function updateUnit(p: Player, unitId: string, change: UnitChange): Player {
  const unit = p.roster.find(u => u.id === unitId);
  if (!unit) throw new PlayerError('Unità sconosciuta');
  if (!change || typeof change !== 'object') throw new PlayerError('Richiesta non valida');
  const next: RosterUnit = { ...unit, equip: { ...unit.equip } };

  if (change.classId !== undefined) {
    if (typeof change.classId !== 'string' || !Object.hasOwn(CLASSES, change.classId) || !isUnlocked(unit, change.classId)) throw new PlayerError('Classe non sbloccata');
    next.classId = change.classId;
  }
  if (change.passive !== undefined) {
    if (change.passive !== null && !unlockedPassives(unit).includes(change.passive)) throw new PlayerError('Passiva non sbloccata');
    next.passive = change.passive;
  }
  if (change.equip !== undefined) {
    if (!change.equip || typeof change.equip !== 'object') throw new PlayerError('Richiesta non valida');
    for (const [slot, itemId] of Object.entries(change.equip) as [Slot, unknown][]) {
      if (!SLOTS.includes(slot)) throw new PlayerError('Slot sconosciuto');
      if (itemId === null) { delete next.equip![slot]; continue; }
      if (typeof itemId !== 'string' || !Object.hasOwn(ITEMS, itemId) || ITEMS[itemId].slot !== slot) throw new PlayerError('Oggetto non adatto a questo slot');
      if (unit.equip?.[slot] !== itemId && freeCopies(p, itemId) < 1) throw new PlayerError('Nessuna copia libera di questo oggetto');
      next.equip![slot] = itemId;
    }
  }
  return { ...p, roster: p.roster.map(u => (u === unit ? next : u)) };
}
