import { settings } from './theme';

// Every sound is synthesised with WebAudio: no audio files to load.
let ac: AudioContext | null = null;
const ctx = () => {
  // browsers start audio only after a user gesture; every call here comes from one or follows one
  ac ??= new AudioContext();
  if (ac.state === 'suspended') void ac.resume();
  return ac;
};

function tone({ f = 440, to, dur = 0.12, type = 'square', vol = 0.15, at = 0 }: { f?: number; to?: number; dur?: number; type?: OscillatorType; vol?: number; at?: number }) {
  const a = ctx(), t = a.currentTime + at, g = a.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  o.frequency.exponentialRampToValueAtTime(to ?? f, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise({ dur = 0.15, vol = 0.3, freq = 1200, at = 0 }) {
  const a = ctx(), t = a.currentTime + at;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate), ch = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
  const src = a.createBufferSource();
  src.buffer = buf;
  const flt = a.createBiquadFilter();
  flt.type = 'lowpass';
  flt.frequency.value = freq;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(flt).connect(g).connect(a.destination);
  src.start(t);
}

const SOUNDS = {
  select: () => tone({ f: 880, to: 1320, dur: 0.06, vol: 0.06 }),
  step: () => noise({ dur: 0.05, vol: 0.18, freq: 600 }),
  hit: () => { noise({ dur: 0.14, vol: 0.45, freq: 1800 }); tone({ f: 180, to: 60, dur: 0.14, vol: 0.18 }); },
  heavy: () => { noise({ dur: 0.2, vol: 0.55, freq: 2600 }); tone({ f: 240, to: 50, dur: 0.22, vol: 0.22, type: 'sawtooth' }); tone({ f: 1320, dur: 0.08, vol: 0.05, at: 0.05 }); },
  heal: () => [523, 659, 784, 1047].forEach((f, i) => tone({ f, dur: 0.18, vol: 0.06, type: 'triangle', at: i * 0.06 })),
  ko: () => { tone({ f: 330, to: 55, dur: 0.5, vol: 0.16, type: 'sawtooth' }); noise({ dur: 0.4, vol: 0.18, freq: 500, at: 0.05 }); },
  turn: () => { tone({ f: 587, dur: 0.1, vol: 0.07, type: 'triangle' }); tone({ f: 880, dur: 0.16, vol: 0.07, type: 'triangle', at: 0.09 }); },
  drop: () => { tone({ f: 220, to: 110, dur: 0.1, vol: 0.12, type: 'triangle' }); noise({ dur: 0.06, vol: 0.15, freq: 900 }); },
  win: () => [523, 659, 784, 659, 1047].forEach((f, i) => tone({ f, dur: i === 4 ? 0.5 : 0.14, vol: 0.08, at: i * 0.12 })),
  lose: () => [392, 330, 262].forEach((f, i) => tone({ f, to: f * 0.97, dur: i === 2 ? 0.6 : 0.22, vol: 0.08, type: 'triangle', at: i * 0.2 })),
  level: () => [784, 988, 1175, 1568].forEach((f, i) => tone({ f, dur: 0.12, vol: 0.06, type: 'square', at: i * 0.05 })),
};
export type Sound = keyof typeof SOUNDS;

export function play(s: Sound) {
  if (!settings().sound) return;
  try { SOUNDS[s](); } catch { /* no audio device: the game works silently */ }
}

/** Short buzz on phones that support it (Android; iOS ignores it). */
export const buzz = (ms: number) => { if (settings().sound) navigator.vibrate?.(ms); };
