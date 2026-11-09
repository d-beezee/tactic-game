import { CLASSES } from './classes';

/** A unit owned by the player, outside battle. Stats derive from the class for now. */
export interface RosterUnit {
  id: string;
  name: string;
  classId: string;
}

export const DEFAULT_ROSTER: RosterUnit[] = [
  { id: 'r1', name: 'Brando', classId: 'warrior' },
  { id: 'r2', name: 'Lia', classId: 'archer' },
  { id: 'r3', name: 'Oris', classId: 'cleric' },
  { id: 'r4', name: 'Tessa', classId: 'warrior' },
  { id: 'r5', name: 'Nilo', classId: 'archer' },
  { id: 'r6', name: 'Maela', classId: 'cleric' },
];

/** Saved data is untrusted: returns null unless it is a well-formed roster. */
export function parseRoster(data: unknown): RosterUnit[] | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  const ok = data.every(
    u => u && typeof u.id === 'string' && typeof u.name === 'string' && typeof u.classId === 'string' && Object.hasOwn(CLASSES, u.classId),
  );
  return ok ? data.map(u => ({ id: u.id, name: u.name, classId: u.classId })) : null;
}
