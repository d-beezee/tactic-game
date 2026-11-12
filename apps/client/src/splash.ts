import { preloadMusic, startAudio } from './music';
import { play } from './sfx';
import { reducedMotion } from './theme';

const BOOTED_KEY = 'tactics.booted';
const BIOS = [
  'VALDOMBRA BIOS v1.996',
  'CPU 6502 @ 1,79 MHz ............ OK',
  'RAM 64K ........................ OK',
  'CHIP AUDIO 4 VOCI .............. OK',
  'CARTUCCIA: TACTICS (ITA) ....... OK',
];
// the favicon's gem, one cell per pixel
const GEM = 'M3 0h2v1h1v2h1v2H6v2H5v1H3V7H2V5H1V3h1V1h1z';

/**
 * Title screen in the style of a 90s console booting up. A tap or key press starts the game:
 * that gesture is what lets the browser start the music. The boot text plays once per tab;
 * after a reload (every return from a battle) the title comes up at once.
 */
export function splash(): Promise<void> {
  preloadMusic();
  let booted = false;
  try {
    booted = !!sessionStorage.getItem(BOOTED_KEY);
    sessionStorage.setItem(BOOTED_KEY, '1');
  } catch { /* storage blocked: the boot text plays every time */ }
  const still = reducedMotion();
  const touch = matchMedia('(pointer: coarse)').matches;

  const root = document.createElement('div');
  root.id = 'splash';
  root.tabIndex = 0;
  root.setAttribute('role', 'button');
  root.setAttribute('aria-label', 'Inizia');
  root.innerHTML = `
    <pre class="bios" aria-hidden="true"></pre>
    <div class="title-card">
      <div class="glow"></div>
      <svg class="gem" viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true"><path d="${GEM}"/><path class="shine" d="M3 1h1v1H3zM2 3h1v1H2z"/></svg>
      <h1>Tactics</h1>
      <p class="sub">Cronache di Valdombra</p>
      <p class="start">${touch ? 'Tocca per iniziare' : 'Clicca o premi un tasto'}</p>
      <p class="copy">© 1996 Valdombra Soft · 1 giocatore</p>
    </div>
    ${still ? '' : `<div class="embers" aria-hidden="true">${Array.from({ length: 18 }, () =>
      `<i style="left:${Math.random() * 100}%;animation-delay:${-Math.random() * 8}s;animation-duration:${6 + Math.random() * 6}s"></i>`).join('')}</div>`}`;
  document.body.append(root);
  root.focus();

  const bios = root.querySelector('.bios')!;
  const timers: number[] = [];
  const showTitle = () => { timers.forEach(clearTimeout); root.classList.add('on'); };
  if (booted || still) showTitle();
  else {
    // silent: the browser keeps audio off until the first tap
    BIOS.forEach((line, i) => timers.push(window.setTimeout(() => { bios.textContent += `${line}\n`; }, 250 + i * 260)));
    timers.push(window.setTimeout(showTitle, 250 + BIOS.length * 260 + 450));
  }

  return new Promise(resolve => {
    const start = (e: Event) => {
      if (e instanceof KeyboardEvent && (e.repeat || e.key === 'Tab')) return;
      root.removeEventListener('pointerdown', start);
      root.removeEventListener('keydown', start);
      void startAudio();
      play('level');
      showTitle();
      root.classList.add('go');
      // the start text blinks fast, the screen flashes, then the menu shows through
      window.setTimeout(() => { root.classList.add('out'); resolve(); }, still ? 0 : 650);
      window.setTimeout(() => root.remove(), still ? 0 : 1100);
    };
    root.addEventListener('pointerdown', start);
    root.addEventListener('keydown', start);
  });
}
