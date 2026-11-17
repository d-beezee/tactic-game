// What the battle HUD shows. The `hud` facade writes it, the <Hud/> component reads it.
import type { BattleState, Side, Team, Unit } from '@tactics/core';
import type { ReactNode } from 'react';
import { createStore } from './store';

export const ICONS = {
  move: '<path d="M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5"/>',
  attack: '<path d="M4 20 15 9M14 4h6v6M9 15l-3-3M12 18l-3-3"/>',
  heal: '<path d="M12 5v14M5 12h14"/>',
  face: '<path d="M4 12h13M12 6l6 6-6 6"/><path d="M20 4v16"/>',
  end: '<path d="M5 5v14l8-7zM15 5v14"/>',
  back: '<path d="M10 6 4 12l6 6M4 12h16"/>',
  confirm: '<path d="m4 12 5 5L20 6"/>',
} as const;
export type Icon = keyof typeof ICONS;

export interface Btn { label: string; hint?: string; icon?: Icon; onClick: () => void; disabled?: boolean; primary?: boolean; onHover?: (on: boolean) => void; ariaLabel?: string }
/** One place in the bottom row: a button, or a piece of HUD of its own (the deploy tray, the facing arrows). */
export type Slot = Btn | ReactNode;
export const isBtn = (s: Slot): s is Btn => typeof s === 'object' && s !== null && 'onClick' in s && 'label' in s && !('$$typeof' in s);

/** Expected result of an action. Without `amount` (statuses, teleport) only the title and the rows show. */
export interface Forecast { title: string; amount?: number; heal: boolean; side?: Side; dh?: number; hp?: number; maxHp?: number; rows?: [string, string][] }

/** A line of the end screen; its kind picks colour and sound. */
export interface ResultLine { kind: 'level' | 'gold' | 'note'; text: string }
export const note = (text: string): ResultLine => ({ kind: 'note', text });

export type Look = { raceId?: string; classId: string };

const initial = () => ({
  visible: false,
  /** the local player's team: in PvP it can be B */
  me: 'A' as Team,
  /** portrait data URL for a race and class; set by the battle once the sprites are loaded */
  portraitOf: (() => '') as (u: Look) => string,
  timeline: null as BattleState | null,
  card: null as Unit | null,
  banner: '',
  goal: null as string | null,
  /** n changes on every ribbon, so the same text plays again */
  ribbon: { text: '', n: 0 },
  forecast: null as Forecast | null,
  buttons: [] as Slot[],
  /** the turn menu beside the unit; phones show it in the bottom row */
  actions: null as { title: string; list: Btn[] } | null,
  result: null as { win: boolean; lines: ResultLine[]; onRestart: () => void; label: string } | null,
  /** the camera of the scene on screen, for the ⟲ ⟳ buttons and Q/E */
  rotate: null as { rotate(steps: 1 | -1): void } | null,
});

export const hudStore = createStore(initial());
export const resetHud = () => { Object.assign(hudStore.state, initial()); };
