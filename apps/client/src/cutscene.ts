import Phaser from 'phaser';
import type { Line, MapData, Unit } from '@tactics/core';
import { BattleScene } from './BattleScene';
import { mountScene, type SceneHandle } from './scenes';
import { play } from './sfx';
import { reducedMotion } from './theme';

/** Who speaks: name-plate colour and, inside the game world, the class sprite as portrait. */
const SPEAKERS: Record<string, { cls?: string; color?: string }> = {
  Teo: { cls: 'warrior', color: 'var(--team-a)' },
  Nico: { color: 'var(--strike)' },
  Brando: { cls: 'warrior' }, Lia: { cls: 'archer' }, Oris: { cls: 'cleric' },
  Fiora: { cls: 'cleric' }, Bastian: { cls: 'ranger' }, Sibilla: { cls: 'sage' },
};
const FX_MS = { shake: 500, glitch: 900, suck: 1500, flash: 700 } as const;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') =>
  Object.assign(document.createElement(tag), { className, textContent: text });

/**
 * Plays a cutscene over everything and resolves when it ends or is skipped.
 * `map` and `units` are the diorama shown by lines with scene 'map'.
 */
export function playCutscene(lines: Line[], world: { map: MapData; units: Unit[] }): Promise<void> {
  if (!lines.length) return Promise.resolve();
  const root = el('div', 'story');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Scena');
  const stage = el('div', 'story-stage');
  const canvas = el('canvas', 'story-canvas');
  const mapBox = el('div', 'story-map');
  stage.append(canvas, mapBox);
  const flash = el('div', 'story-flash');
  const box = el('div', 'story-box');
  const portrait = el('img', 'story-portrait');
  portrait.alt = '';
  const who = el('div', 'story-who'), text = el('p', 'story-text'), next = el('span', 'story-next');
  text.setAttribute('aria-live', 'polite');
  box.append(portrait, who, text, next);
  const skip = el('button', 'story-skip', 'Salta');
  root.append(stage, flash, box, skip);
  document.body.append(root);

  let drawn: { kind: 'bedroom' | 'crt'; h: SceneHandle } | null = null;
  let game: Phaser.Game | null = null;
  let typing: number | null = null;
  let i = -1;
  let done!: () => void;
  const finished = new Promise<void>(r => (done = r));

  const setScene = (scene: Line['scene']) => {
    stage.dataset.scene = scene;
    if (scene === 'bedroom' || scene === 'crt') {
      if (drawn?.kind !== scene) { drawn?.h.stop(); drawn = { kind: scene, h: mountScene(canvas, scene) }; }
    } else { drawn?.h.stop(); drawn = null; }
    if (scene === 'map' && !game) {
      // the chapter's diorama, drifting, with every light effect on
      game = new Phaser.Game({
        type: Phaser.AUTO, parent: mapBox, transparent: true,
        scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
        scene: [new BattleScene(world.map, world.units, s => { s.pannable = false; s.enableFx(); s.drift(); }, w => ({ top: 30, right: 0, left: 0, bottom: w < 640 ? 220 : 200 }))],
      });
    }
  };

  const fx = (f: Line['fx']) => {
    if (!f) return;
    play(f === 'shake' ? 'thunder' : f);
    if (f === 'shake') drawn?.h.lightning();
    const target = f === 'flash' ? flash : stage;
    target.classList.remove(f);
    void target.offsetWidth; // restart the animation
    target.classList.add(f);
    setTimeout(() => target.classList.remove(f), FX_MS[f]);
  };

  const finishTyping = (full: string) => {
    if (typing !== null) clearInterval(typing);
    typing = null;
    text.textContent = full;
    next.hidden = false;
  };

  const show = (n: number) => {
    i = n;
    if (i >= lines.length) return close();
    const line = lines[i];
    setScene(line.scene);
    fx(line.fx);
    const sp = line.who ? SPEAKERS[line.who] : undefined;
    box.classList.toggle('narration', !line.who);
    who.textContent = line.who ?? '';
    who.style.color = sp?.color ?? '';
    // the kids are kids in the bedroom: class sprites only inside the game
    const cls = line.scene === 'map' ? sp?.cls : undefined;
    portrait.hidden = !cls;
    if (cls) portrait.src = `units/${cls}/S.png`;
    next.hidden = true;
    if (reducedMotion()) return finishTyping(line.text);
    let k = 0;
    text.textContent = '';
    typing = window.setInterval(() => {
      k++;
      text.textContent = line.text.slice(0, k);
      if (k % 3 === 0 && line.text[k - 1] !== ' ') play('blip');
      if (k >= line.text.length) finishTyping(line.text);
    }, 24);
  };

  const advance = () => {
    // first tap completes the line, the second goes on
    if (typing !== null) finishTyping(lines[i].text);
    else show(i + 1);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); advance(); }
  };

  function close() {
    if (typing !== null) clearInterval(typing);
    window.removeEventListener('keydown', onKey);
    drawn?.h.stop();
    game?.destroy(true);
    root.remove();
    done();
  }

  root.addEventListener('click', e => { if (e.target !== skip) advance(); });
  skip.onclick = () => close();
  window.addEventListener('keydown', onKey);
  show(0);
  return finished;
}
