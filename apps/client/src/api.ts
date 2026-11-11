import type { BattleAction, MapData, Player, Pos, Unit, UnitChange, XpReport } from '@tactics/core';

export interface Account extends Player {
  email: string;
  /** the admin is the only one with the map editor and custom maps */
  admin: boolean;
}

export class ApiError extends Error {
  /** status 0 = the server could not be reached */
  constructor(public status: number, message: string) { super(message); }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Server non raggiungibile');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Errore ${res.status}`);
  return data;
}

/** Roster saved in this browser before accounts existed; sent once at sign-up so progress is kept. The server validates it. */
function localRoster(): unknown {
  try {
    return JSON.parse(localStorage.getItem('tactics.roster') ?? 'null');
  } catch {
    return null;
  }
}

export const api = {
  me: () => call<Account>('GET', '/me'),
  register: (email: string, password: string) => call<Account>('POST', '/auth/register', { email, password, roster: localRoster() }),
  login: (email: string, password: string) => call<Account>('POST', '/auth/login', { email, password }),
  logout: () => call<unknown>('POST', '/auth/logout'),
  updateUnit: (id: string, change: UnitChange) => call<Player>('PATCH', `/units/${encodeURIComponent(id)}`, change),
  buy: (itemId: string) => call<Player>('POST', '/shop/buy', { itemId }),
  /** The server picks the seed and builds the starting units from its own copy of the roster. */
  battleStart: (map: MapData, deploy: { id: string; pos: Pos }[]) => call<{ id: string; seed: number; units: Unit[] }>('POST', '/battles', { map, deploy }),
  /** Sends only the player's actions; the server replays the battle and decides XP and gold. Safe to retry. */
  battleFinish: (id: string, actions: BattleAction[]) =>
    call<{ player: Player; report: XpReport[]; gold: number }>('POST', `/battles/${id}/finish`, { actions }),
};
