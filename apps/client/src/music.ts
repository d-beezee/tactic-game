import type { Music } from './api';
import { settings } from './theme';

// Background music: Strudel code saved by the admin, played by @strudel/web.
// The library is large: it loads behind the splash screen, never in the first bundle.
const SAMPLES = 'https://raw.githubusercontent.com/felixroos/dough-samples/main';
let evalError: Error | null = null;
let strudel: Promise<typeof import('@strudel/web')> | null = null;
let loaded: typeof import('@strudel/web') | null = null;
/** true once a user gesture started the audio; until then tracks are only remembered */
let audioReady = false;
const load = () => strudel ??= import('@strudel/web').then(async s => {
  loaded = s;
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
  if (!audioReady || code === playing) return;
  playing = code;
  if (!code) return void (strudel && (await strudel).hush());
  const s = await load();
  if (playing !== code) return; // something else was asked for while the library loaded
  evalError = null;
  await s.evaluate(code);
  if (evalError) { playing = null; throw evalError; }
}

/** Starts loading the library ahead of the first track. */
export const preloadMusic = () => void load().catch(e => console.warn('music:', e));

/**
 * Call from a tap or key press: browsers start audio only inside a user gesture.
 * Strudel's own unlock waits for a mousedown and, in 1.3.0, never resumes the context, so it is done here.
 */
export function startAudio() {
  void loaded?.getAudioContext().resume(); // still inside the gesture when the library is already here (Safari needs that)
  return load().then(async s => {
    await s.initAudio(); // the effect worklets (crush, coarse...)
    await s.getAudioContext().resume();
    audioReady = true;
    apply();
  }).catch(e => console.warn('music:', e));
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
