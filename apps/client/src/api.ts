import type { Account, BattleAction, BattleResult, BattleStart, Chapter, ChapterInput, MapData, Mission, MissionEnemy, Music, Player, Pos, PvpState, Recruit, UnitChange, User } from '@tactics/core';

export type { Account, Mission, Music, PvpState, Track, User } from '@tactics/core';

export class ApiError extends Error {
  /** status 0 = the server could not be reached */
  constructor(public status: number, message: string) { super(message); }
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Calls `fn` until it succeeds. A refusal (by default any 4xx: sending again cannot help) and the last failure are thrown.
 * `stop` ends the retries early, resolving to undefined.
 */
export async function retry<T>(fn: () => Promise<T>, opts: { attempts?: number; delay: (attempt: number) => number; refused?: (e: ApiError) => boolean; stop?: () => boolean }): Promise<T | undefined> {
  const refused = opts.refused ?? (e => e.status >= 400 && e.status < 500);
  for (let attempt = 1; !opts.stop?.(); attempt++) {
    try {
      return await fn();
    } catch (e) {
      if ((e instanceof ApiError && refused(e)) || attempt >= (opts.attempts ?? Infinity)) throw e;
      await wait(opts.delay(attempt));
    }
  }
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
  kickUnit: (id: string) => call<Player>('POST', `/units/kick/${encodeURIComponent(id)}`),
  buy: (itemId: string) => call<Player>('POST', '/shop/buy', { itemId }),
  /** The server picks the seed and builds the starting units from its own copy of the roster. */
  /** A test battle names its map, a mission or a campaign chapter its id. */
  battleStart: (target: { mapId: string } | { missionId: string } | { chapterId: string }, deploy: { id: string; pos: Pos }[]) =>
    call<BattleStart>('POST', '/battles', { ...target, deploy }),
  /** Sends only the player's actions; the server replays the battle and decides XP and gold. Safe to retry. */
  battleFinish: (id: string, actions: BattleAction[]) =>
    call<BattleResult>('POST', `/battles/${id}/finish`, { actions }),
  /** the chapters in play order, and the ids of those this player has won */
  campaign: () => call<{ chapters: Chapter[]; cleared: string[] }>('GET', '/campaign'),
  createChapter: (c: ChapterInput & { mapId: string }) => call<Chapter[]>('POST', '/admin/chapters', c),
  updateChapter: (id: string, c: ChapterInput & { mapId: string }) => call<Chapter[]>('PUT', `/admin/chapters/${encodeURIComponent(id)}`, c),
  moveChapter: (id: string, dir: -1 | 1) => call<Chapter[]>('POST', `/admin/chapters/${encodeURIComponent(id)}/move`, { dir }),
  deleteChapter: (id: string) => call<Chapter[]>('DELETE', `/admin/chapters/${encodeURIComponent(id)}`),
  pvpQueue: () => call<{ id: string }>('POST', '/pvp/queue'),
  pvpRoom: () => call<{ id: string }>('POST', '/pvp/rooms'),
  pvpJoin: (code: string) => call<{ id: string }>('POST', '/pvp/join', { code }),
  pvpState: (id: string, from = 0) => call<PvpState>('POST', `/pvp/${id}/poll?from=${from}`),
  pvpDeploy: (id: string, deploy: { id: string; pos: Pos }[]) => call<unknown>('POST', `/pvp/${id}/deploy`, { deploy }),
  /** index = the action's place in the whole battle, so a retry is not applied twice */
  pvpAction: (id: string, index: number, action: BattleAction) => call<unknown>('POST', `/pvp/${id}/actions`, { index, action }),
  pvpLeave: (id: string) => call<unknown>('POST', `/pvp/${id}/leave`),
  missions: () => call<Mission[]>('GET', '/missions'),
  createMission: (m: { name: string; mapId: string; gold: number; enemies: MissionEnemy[]; recruit: Recruit | null; trackId: string | null }) => call<Mission[]>('POST', '/admin/missions', m),
  updateMission: (id: string, m: { name: string; mapId: string; gold: number; enemies: MissionEnemy[]; recruit: Recruit | null; trackId: string | null }) => call<Mission[]>('PUT', `/admin/missions/${id}`, m),
  deleteMission: (id: string) => call<Mission[]>('DELETE', `/admin/missions/${id}`),
  music: () => call<Music>('GET', '/music'),
  createTrack: (t: { name: string; code: string }) => call<Music>('POST', '/admin/tracks', t),
  updateTrack: (id: string, t: { name: string; code: string }) => call<Music>('PUT', `/admin/tracks/${id}`, t),
  deleteTrack: (id: string) => call<Music>('DELETE', `/admin/tracks/${id}`),
  setMusicSlot: (slot: 'menu' | 'battle', trackId: string | null) => call<Music>('PUT', `/admin/music/${slot}`, { trackId }),
};
