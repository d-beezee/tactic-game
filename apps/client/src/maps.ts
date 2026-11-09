import { parseMap, type MapData } from '@tactics/core';
import demo from './maps/demo.json';

const KEY = 'tactics.maps';

/** Maps shipped with the game: read-only, the editor saves copies. */
export const BUILTIN_MAPS: MapData[] = [demo as MapData];
export const isBuiltin = (id: string) => BUILTIN_MAPS.some(m => m.id === id);

// shortcut: custom maps live in localStorage until the backend exists; move them server-side with admin accounts.
export function savedMaps(): MapData[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.map(parseMap).filter((m): m is MapData => m !== null) : [];
  } catch {
    return [];
  }
}

export const allMaps = () => [...BUILTIN_MAPS, ...savedMaps()];

function write(maps: MapData[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(maps));
    return true;
  } catch {
    return false;
  }
}

export const saveMap = (m: MapData) => write([...savedMaps().filter(x => x.id !== m.id), m]);
export const deleteMap = (id: string) => write(savedMaps().filter(x => x.id !== id));
