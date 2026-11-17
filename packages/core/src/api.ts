// Shapes of the HTTP API responses, shared by the server that builds them and the client that reads them.
import type { BattleAction } from './battle';
import type { MapData, Team } from './map';
import type { Player } from './player';
import type { XpReport } from './roster';
import type { MissionEnemy, Recruit } from './missions';
import type { Unit } from './units';

export interface Account extends Player {
  email: string;
  /** the admin is the only one with the map editor and custom maps */
  admin: boolean;
}

export interface User { id: string; email: string; admin: boolean; createdAt: string }

/** A PvP match as the poll sees it; actions start at the `from` index asked for. */
export interface PvpState {
  status: 'waiting' | 'deploy' | 'battle' | 'done';
  team: Team;
  code: string | null;
  map: MapData;
  deployed: boolean;
  seed: number | null;
  units: Unit[] | null;
  actions: BattleAction[];
  winner: Team | null;
  /** how a done match ended: battle, resign, gone (the other player vanished) */
  reason: 'battle' | 'resign' | 'gone' | null;
}

/** A daily mission; done = already won today by this player; trackId = its own music instead of the battle one. */
export interface Mission { id: string; name: string; mapId: string; gold: number; enemies: MissionEnemy[]; recruit: Recruit | null; trackId: string | null; done: boolean }

/** A piece of background music: Strudel code. */
export interface Track { id: string; name: string; code: string }
/** Saved tracks, and the one chosen for the menu and for battles (null = silence). */
export interface Music { tracks: Track[]; menu: string | null; battle: string | null }

/** A battle the server handed out: the client plays it with this seed and these starting units. */
export interface BattleStart { id: string; seed: number; units: Unit[] }

/** The outcome of a replayed battle; paid = this win earned XP and gold, unlocked = name of a unit that joined. */
export interface BattleResult { report: XpReport[]; gold: number; won: boolean; paid: boolean; unlocked: string | null }
