import type { BattleAction, MapData, MissionEnemy, Player, Pos, Unit, UnitChange, XpReport } from '@tactics/core';

export interface Account extends Player {
  email: string;
  /** the admin is the only one with the map editor and custom maps */
  admin: boolean;
}

export interface User { id: string; email: string; admin: boolean; createdAt: string }

/** A daily mission; done = already won today by this player. */
export interface Mission { id: string; name: string; mapId: string; gold: number; enemies: MissionEnemy[]; done: boolean }

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
  users: () => call<User[]>('GET', '/admin/users'),
  setAdmin: (id: string, admin: boolean) => call<User[]>('PATCH', `/admin/users/${id}`, { admin }),
  maps: () => call<MapData[]>('GET', '/maps'),
  saveMap: (m: MapData) => call<MapData[]>('PUT', `/admin/maps/${encodeURIComponent(m.id)}`, m),
  deleteMap: (id: string) => call<MapData[]>('DELETE', `/admin/maps/${encodeURIComponent(id)}`),
  logout: () => call<unknown>('POST', '/auth/logout'),
  updateUnit: (id: string, change: UnitChange) => call<Player>('PATCH', `/units/${encodeURIComponent(id)}`, change),
  buy: (itemId: string) => call<Player>('POST', '/shop/buy', { itemId }),
  /** The server picks the seed and builds the starting units from its own copy of the roster. */
  /** A test battle names its map, a mission its id. */
  battleStart: (target: { mapId: string } | { missionId: string }, deploy: { id: string; pos: Pos }[]) =>
    call<{ id: string; seed: number; units: Unit[] }>('POST', '/battles', { ...target, deploy }),
  /** Sends only the player's actions; the server replays the battle and decides XP and gold. Safe to retry. */
  battleFinish: (id: string, actions: BattleAction[]) =>
    call<{ report: XpReport[]; gold: number; won: boolean; paid: boolean }>('POST', `/battles/${id}/finish`, { actions }),
  missions: () => call<Mission[]>('GET', '/missions'),
  createMission: (m: { name: string; mapId: string; gold: number; enemies: MissionEnemy[] }) => call<Mission[]>('POST', '/admin/missions', m),
  deleteMission: (id: string) => call<Mission[]>('DELETE', `/admin/missions/${id}`),
};
