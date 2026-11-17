// The battle HUD's facade: the controller and the deploy phase call these methods, which only write hudStore; <Hud/> shows it.
import type { BattleState, Team, Unit } from '@tactics/core';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Dirs, Hud } from './Hud';
import { hudStore, resetHud, type Btn, type Forecast, type Look, type ResultLine, type Slot } from './hudStore';
import { music } from './music';
import { play, type Sound } from './sfx';
import { reducedMotion } from './theme';

export type { Btn, Forecast, Icon, ResultLine } from './hudStore';
export { note } from './hudStore';

const s = hudStore.state;

/** Mounts <Hud/> into #hud-root, once and synchronously: the turn menu's box must exist the first time the scene asks for it. */
let mounted = false;
export function mountHud() {
  if (mounted) return;
  mounted = true;
  const root = createRoot(document.getElementById('hud-root')!);
  flushSync(() => root.render(createElement(Hud)));
}

export const hud = {
  /** Empty and hidden, as before any battle. */
  reset: resetHud,
  show() { s.visible = true; },
  setPortraits(fn: (u: Look) => string) { s.portraitOf = fn; },
  setTeam(team: Team) { s.me = team; },
  timeline(state: BattleState) { s.timeline = state; },
  /** Unit card. Updating the same unit keeps the HP bar, so the lost part trails behind before it drops. */
  card(u: Unit) { s.card = u; },
  /** The battle goal, under the banner; null hides it. */
  goal(text: string | null) { s.goal = text; },
  banner(text: string) { s.banner = text; },

  /** Big title across the screen at the start of a turn. */
  ribbon(text: string, sound: Sound = 'turn') {
    s.ribbon = { text, n: s.ribbon.n + 1 };
    play(sound);
  },

  /** Expected result of an action, shown before the player confirms it. */
  forecast(f: Forecast | null) { s.forecast = f; },

  /** Fixed row at the bottom right; also closes the turn menu. */
  buttons(list: Slot[]) {
    s.actions = null;
    s.buttons = list;
  },

  /**
   * Turn menu: a titled vertical list the scene keeps next to the unit, plus `fixed` in the bottom row.
   * Phones show the list in the bottom row instead. Returns the list's box, for the scene to follow.
   */
  actions(title: string, list: Btn[], fixed: Btn[] = []): HTMLElement {
    s.buttons = fixed;
    s.actions = { title, list };
    return document.getElementById('actions')!;
  },

  /** 2×2 grid of iso arrows, for the bottom row. */
  dirs: (onPick: (d: 'N' | 'E' | 'S' | 'W') => void, onPreview?: (d: 'N' | 'E' | 'S' | 'W' | null) => void) => createElement(Dirs, { onPick, onPreview }),

  /** End screen: the title lands, then each report line appears in turn; level-ups get their own sound. */
  result(win: boolean, lines: ResultLine[], onRestart: () => void, label = 'Torna al menu') {
    s.result = { win, lines, onRestart, label };
    const step = reducedMotion() ? 0 : 280;
    lines.forEach((l, i) => { if (l.kind === 'level') setTimeout(() => play('level'), 600 + i * step); });
    music(null);
    play(win ? 'win' : 'lose');
  },
};

/** ⟲ ⟳ buttons plus Q/E keys to rotate the camera of this scene; the next scene replaces it. */
export function mountRotate(scene: { rotate(steps: 1 | -1): void }) { s.rotate = scene; }
