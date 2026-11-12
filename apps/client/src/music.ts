import type { Music } from './api';
import { settings } from './theme';

// Background music: Strudel code saved by the admin, played by @strudel/web.
// The library is large, so it loads only when the first track plays.
const SAMPLES = 'https://raw.githubusercontent.com/felixroos/dough-samples/main';
let evalError: Error | null = null;
let strudel: Promise<typeof import('@strudel/web')> | null = null;
const load = () => strudel ??= import('@strudel/web').then(async s => {
  await s.initStrudel({
    onEvalError: (e: Error) => { evalError = e; },
    // the same drum machines and samples the strudel.cc REPL has, so a track sounds the same here
    prebake: () => Promise.all([s.samples(`${SAMPLES}/Dirt-Samples.json`), s.samples(`${SAMPLES}/tidal-drum-machines.json`)]),
  });
  return s;
});

let library: Music = { tracks: [], menu: null, battle: null };
let wanted: { slot: 'menu' | 'battle' | null; trackId?: string | null } = { slot: null };
/** code playing now, null when silent */
let playing: string | null = null;

/** Plays Strudel code in a loop; null stops. The same code keeps playing. Rejects with the code's error. */
export async function playCode(code: string | null) {
  if (!settings().sound) code = null;
  if (code === playing) return;
  playing = code;
  if (!code) return void (strudel && (await strudel).hush());
  const s = await load();
  if (playing !== code) return; // something else was asked for while the library loaded
  evalError = null;
  await s.evaluate(code);
  if (evalError) { playing = null; throw evalError; }
}

const apply = () => {
  const { slot, trackId } = wanted;
  const id = slot && (trackId ?? library[slot]);
  playCode(library.tracks.find(t => t.id === id)?.code ?? null).catch(e => console.warn('music:', e));
};

/** Music for a place in the game; a mission's track overrides the slot's. null stops. */
export function music(slot: 'menu' | 'battle' | null, trackId?: string | null) {
  wanted = { slot, trackId };
  apply();
}

/** The saved tracks and slot choices, from the server; what should be playing follows them. */
export function setLibrary(m: Music) {
  library = m;
  apply();
}
export const getLibrary = () => library;
