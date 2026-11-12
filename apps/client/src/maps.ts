import { parseMap, type MapData } from '@tactics/core';
import { api } from './api';
import demo from './maps/demo.json';

/** Where the editor kept maps before they moved to the server. */
const LEGACY_KEY = 'tactics.maps';

/** Maps shipped with the game: read-only, the editor saves copies. */
export const BUILTIN_MAPS: MapData[] = [demo as MapData];
export const isBuiltin = (id: string) => BUILTIN_MAPS.some(m => m.id === id);

/** Maps saved on the server, as of the last loadMaps, saveMap or deleteMap. */
let saved: MapData[] = [];
export const allMaps = () => [...BUILTIN_MAPS, ...saved];

/** Fetches the saved maps. For the admin, first uploads maps still in this browser's storage, then clears it. */
export async function loadMaps(admin: boolean) {
  if (admin) {
    let local: MapData[] = [];
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '[]');
      if (Array.isArray(raw)) local = raw.map(parseMap).filter((m): m is MapData => m !== null);
    } catch { /* unreadable storage: nothing to move */ }
    for (const m of local) await api.saveMap(m);
    // cleared only after every upload succeeded, so a failure keeps them for the next try
    try { localStorage.removeItem(LEGACY_KEY); } catch { /* storage unavailable */ }
  }
  saved = await api.maps();
}

export const saveMap = async (m: MapData) => { saved = await api.saveMap(m); };
export const deleteMap = async (id: string) => { saved = await api.deleteMap(id); };
