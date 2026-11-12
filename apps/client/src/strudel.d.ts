// @strudel/web ships no types; only what music.ts uses
declare module '@strudel/web' {
  export function initStrudel(options?: { prebake?: () => Promise<unknown>; onEvalError?: (e: Error) => void }): Promise<unknown>;
  export function evaluate(code: string, autoplay?: boolean): Promise<unknown>;
  export function hush(): void;
  export function samples(url: string): Promise<unknown>;
  export function initAudio(): Promise<void>;
  export function getAudioContext(): AudioContext;
}
