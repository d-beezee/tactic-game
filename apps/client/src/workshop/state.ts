// The Officina's state. It lives outside React on purpose: drafts outlive a trip to the game menu
// and a rehearsal battle, when the whole menu is unmounted. A reload asks first.
// Components read `ws` and change it in place: the store redraws the Officina by itself.
import {
  CLASSES, DEFAULT_RACE, ENEMY_CLASSES, allowedRaces,
  type Chapter, type ChapterInput, type Goal, type MapData, type MissionEnemy, type Pos, type RosterUnit,
} from '@tactics/core';
import { api, ApiError, type Account, type Mission, type User } from '../api';
import { allMaps, loadMaps } from '../maps';
import { getLibrary, setLibrary } from '../music';
import { createStore, toRaw } from '../store';

export type Tool = 'campaign' | 'missions' | 'music' | 'users';

export interface WorkshopCtx {
  player: Account;
  /** back to the player's menu */
  back: () => void;
  /** the session expired */
  auth: () => void;
  mapEditor: () => void;
  /** plays a draft locally, then comes back here */
  rehearse: (ch: Chapter, trackId: string | null) => void;
}

/** A draft and the snapshot it started from: it has unsaved changes when they differ. */
export interface Edit<T> { d: T; orig: string }
export const edit = <T>(d: T, from: unknown = d): Edit<T> => ({ d, orig: JSON.stringify(from) });
export const dirty = (e: Edit<unknown> | null) => !!e && JSON.stringify(e.d) !== e.orig;

export type MissionDraft = { id: string | null; name: string; mapId: string; gold: number; enemies: MissionEnemy[]; trackId: string | null; recruit: { on: boolean; name: string; raceId: string; classId: string } };
export type ChapterDraft = Omit<ChapterInput, 'goal' | 'unlock'> & {
  id: string | null; mapId: string; goalType: Goal['type']; rounds: number; cells: Pos[]; boss: number;
  unlockOn: boolean; unlock: Omit<RosterUnit, 'id'>; unlockLevel: number;
};
export type TrackDraft = { id: string | null; name: string; code: string };

/** What the menu hands the Officina; kept apart from the store, since a new one arrives on every render. */
export let ctx: WorkshopCtx;
export const setCtx = (c: WorkshopCtx) => { ctx = c; };

const store = createStore({
  tool: 'campaign' as Tool,
  /** true until the open tool has its data */
  loading: true,
  missions: [] as Mission[],
  chapters: [] as Chapter[],
  users: [] as User[],
  error: '',
  /** key of the action waiting for its second tap (delete, role change) */
  pending: '',
  /** a change of draft waiting for "discard the unsaved changes?" */
  ask: null as (() => void) | null,
  savedAt: '',
  /** on phones the editor replaces the list */
  open: false,
  queries: {} as Partial<Record<Tool, string>>,
  /** the last enemy placed, reused by the next tap */
  brush: { raceId: DEFAULT_RACE as string, classId: 'warrior', level: 1 },
  mEdit: null as Edit<MissionDraft> | null,
  cEdit: null as Edit<ChapterDraft> | null,
  tEdit: null as Edit<TrackDraft> | null,
  slots: null as Edit<{ menu: string | null; battle: string | null }> | null,
  tabs: { missions: 0, campaign: 0 },
  /** the cutscene line open for editing, as "before:2" */
  openLine: '',
  /** what the preview is playing: a track id, or 'draft' */
  playing: null as string | null,
});
export const ws = store.state;
/** Called by the Officina's root component: it redraws on every change to `ws`. */
export const useWorkshop = store.useStore;

/** The drafts each tool's save bar watches. */
const drafts = () => ws.tool === 'campaign' ? [ws.cEdit] : ws.tool === 'missions' ? [ws.mEdit] : ws.tool === 'music' ? [ws.tEdit, ws.slots] : [];
// "saved at" holds until the open draft changes again
store.subscribe(() => { if (ws.savedAt && drafts().some(dirty)) ws.savedAt = ''; });

addEventListener('beforeunload', e => { if ([ws.mEdit, ws.cEdit, ws.tEdit, ws.slots].some(dirty)) e.preventDefault(); });

let loads = 0; // newest load wins when they overlap
/** Opens a tool and loads what it shows. Drafts of the other tools stay as they are. */
export const go = async (to: Tool) => {
  const gen = ++loads;
  Object.assign(ws, { tool: to, error: '', pending: '', ask: null, open: false, loading: true });
  try {
    if (to === 'users') ws.users = await api.users();
    else {
      const [m, c, lib] = await Promise.all([api.missions(), api.campaign(), api.music(), loadMaps(true)]);
      [ws.missions, ws.chapters] = [m, c.chapters];
      setLibrary(lib);
    }
  } catch (e) {
    if (gen !== loads) return;
    if (e instanceof ApiError && e.status === 401) return ctx.auth();
    ws.error = (e as Error).message;
  }
  if (gen !== loads) return;
  ws.loading = false;
};
/** The Officina left the screen: a load still running must not show stale data on the way back. */
export const leave = () => { loads++; ws.loading = true; };

/** Sends a change, keeps the answer, then redraws with it or with the error. */
export const mutate = async <T>(request: Promise<T>, ok: (r: T) => void, saved = true) => {
  try {
    const r = await request;
    ws.error = '';
    ok(r);
    ws.savedAt = saved ? new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return ctx.auth();
    ws.error = (e as Error).message;
  }
};

/** Runs `fn`, which replaces the open draft, after asking when that draft has unsaved changes. */
export const replace = (current: Edit<unknown> | null, fn: () => void) => {
  if (!dirty(current)) return fn();
  ws.ask = fn;
};

export const clone = <T>(v: T): T => structuredClone(toRaw(v));
export const matches = (q: string, ...text: string[]) => !q.trim() || text.some(t => t.toLowerCase().includes(q.trim().toLowerCase()));
export const mapName = (id: string) => allMaps().find(m => m.id === id)?.name;
export const trackName = (id: string | null) => getLibrary().tracks.find(t => t.id === id)?.name;
/** Base classes a race can start in: what a recruit or an unlocked ally can be. */
export const baseClassesOf = (raceId: string) => Object.values(CLASSES).filter(c => !c.requires && allowedRaces(c.id).includes(raceId));
/** Starting enemies for a new mission or chapter: the map's enemy spawns, base classes in turn, level 1. */
export const defaultEnemies = (m: MapData): MissionEnemy[] =>
  m.spawns.B.slice(0, m.maxDeploy).map((pos, i) => ({ classId: ENEMY_CLASSES[i % ENEMY_CLASSES.length], level: 1, pos: { ...pos } }));
