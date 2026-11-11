// Colours used by Phaser. Each one mirrors a CSS variable in style.css: change both together.
export const COLOR = {
  night: 0x15110e,  // --night
  brass: 0xe0ac4a,  // --brass
  ember: 0xff8f3a,  // --ember
  reach: 0x7fd3e6,  // --reach: movement and deploy cells
  strike: 0xff7a59, // --strike: attack range
  mend: 0x8fe08a,   // --mend: heal range
  hp: 0x7cc64a,     // --hp
  hpLow: 0xf2c14e,
  teamA: 0x4f8cff,  // --team-a
  teamB: 0xe8603c,  // --team-b
} as const;

export const TEAM_COLOR = { A: COLOR.teamA, B: COLOR.teamB } as const;

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Player settings, kept per browser. */
const SETTINGS_KEY = 'tactics.settings';
export interface Settings { fx: boolean; sound: boolean }
let current: Settings | null = null;
export function settings(): Settings {
  if (current) return current;
  // touch devices start with light graphics: bloom and tilt-shift are full-screen passes
  const fallback = { fx: !matchMedia('(pointer: coarse)').matches, sound: true };
  try {
    current = { ...fallback, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    current = fallback;
  }
  return current!;
}
export function saveSettings(s: Settings) {
  current = s;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage blocked: kept in memory until reload */ }
}
