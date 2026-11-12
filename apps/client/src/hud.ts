import { CLASSES, RACES, STATUSES, unitById, type BattleState, type Side, type Team, type Unit } from '@tactics/core';
import { music } from './music';
import { play, type Sound } from './sfx';
import { reducedMotion } from './theme';

const ICONS = {
  move: '<path d="M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5"/>',
  attack: '<path d="M4 20 15 9M14 4h6v6M9 15l-3-3M12 18l-3-3"/>',
  heal: '<path d="M12 5v14M5 12h14"/>',
  face: '<path d="M4 12h13M12 6l6 6-6 6"/><path d="M20 4v16"/>',
  end: '<path d="M5 5v14l8-7zM15 5v14"/>',
  back: '<path d="M10 6 4 12l6 6M4 12h16"/>',
  confirm: '<path d="m4 12 5 5L20 6"/>',
} as const;
export type Icon = keyof typeof ICONS;

export interface Btn { label: string; hint?: string; icon?: Icon; onClick: () => void; disabled?: boolean; primary?: boolean; onHover?: (on: boolean) => void }

const $ = (id: string) => document.getElementById(id)!;
const el = (tag: string, className: string, text = '') => Object.assign(document.createElement(tag), { className, textContent: text });

/** The local player's team: in PvP it can be B. */
let me: Team = 'A';

type Look = { raceId?: string; classId: string };
/** Portrait data URL for a race and class; set by the battle once the sprites are loaded. */
let portraitOf: (u: Look) => string = () => '';

function medal(u: Look & { team: string; name: string }, extra = '') {
  const m = el('div', `medal ${u.team}${extra}`);
  const url = portraitOf(u);
  if (url) m.style.backgroundImage = `url(${url})`;
  m.setAttribute('aria-hidden', 'true');
  return m;
}

function button(b: Btn): HTMLElement {
  const btn = document.createElement('button');
  if (b.icon) btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[b.icon]}</svg>`;
  btn.append(el('span', 'lbl', b.label));
  if (b.hint) btn.append(el('small', '', b.hint));
  btn.disabled = !!b.disabled;
  if (b.primary) btn.className = 'primary';
  btn.onclick = () => { play('select'); b.onClick(); };
  if (!b.onHover) return btn;
  // disabled buttons get no mouse events, so the wrapper listens instead
  const wrap = el('span', 'btn-wrap');
  wrap.append(btn);
  wrap.onpointerenter = () => b.onHover!(true);
  wrap.onpointerleave = () => b.onHover!(false);
  return wrap;
}

/** "Veleno 2 · Forza 3": each status with its turns left. */
const statusText = (u: Unit) => (u.statuses ?? []).map(s => `${STATUSES[s.id].name} ${s.turns}`).join(' · ');

/** Expected result of an action. Without `amount` (statuses, teleport) only the title and the rows show. */
export interface Forecast { title: string; amount?: number; heal: boolean; side?: Side; dh?: number; hp?: number; maxHp?: number; rows?: [string, string][] }

const SIDE_TEXT: Record<Side, string> = { front: 'Di fronte', flank: 'Di fianco ×1,25', back: 'Alle spalle ×1,5' };

export const hud = {
  /** Empty and hidden, as before any battle. */
  reset() {
    for (const id of ['timeline', 'banner', 'goal', 'ribbon', 'forecast', 'card', 'buttons', 'actions', 'result', 'rotate']) $(id).replaceChildren();
    for (const id of ['hud', 'goal', 'forecast', 'actions', 'result', 'rotate']) $(id).hidden = true;
    $('ribbon').classList.remove('show');
    me = 'A';
    portraitOf = () => '';
  },
  setPortraits(fn: (u: Look) => string) { portraitOf = fn; },
  setTeam(team: Team) { me = team; },

  timeline(s: BattleState) {
    const items: HTMLElement[] = [];
    for (let i = 0, shown = 0; shown < 9 && i < s.order.length * 3; i++) {
      const u = unitById(s, s.order[(s.turn + i) % s.order.length]);
      if (u.hp <= 0) continue;
      // the order wraps: mark where the next round starts
      if (i > 0 && (s.turn + i) % s.order.length === 0) items.push(el('div', 'round-mark', `Round ${s.round + Math.floor((s.turn + i) / s.order.length)}`));
      const m = medal(u, i === 0 ? ' now' : '');
      m.removeAttribute('aria-hidden');
      m.title = `${u.name}, ${CLASSES[u.classId].name}`;
      m.append(el('small', '', u.name));
      items.push(m);
      shown++;
    }
    $('timeline').replaceChildren(...items);
  },

  /** Unit card. Updating the same unit keeps the HP bar, so the lost part trails behind before it drops. */
  card(u: Unit) {
    const c = $('card');
    const pct = `${(100 * Math.max(0, u.hp)) / u.stats.maxHp}%`;
    const low = u.hp / u.stats.maxHp <= 0.35;
    if (c.dataset.id === u.id) {
      c.querySelector<HTMLElement>('.hp-now')!.style.width = pct;
      c.querySelector<HTMLElement>('.hp-now')!.classList.toggle('low', low);
      c.querySelector<HTMLElement>('.hp-ghost')!.style.width = pct;
      c.querySelector('.hp-num')!.textContent = `${Math.max(0, u.hp)}/${u.stats.maxHp}`;
      c.querySelector('.statuses')!.textContent = statusText(u);
      return;
    }
    c.dataset.id = u.id;
    c.className = u.team;
    const { stats } = u;
    const grid = el('div', 'stats');
    for (const [label, value] of [['ATT', stats.atk], ['DIF', stats.def], ['MAG', stats.mag], ['VEL', stats.speed], ['MOV', stats.move], ['SALTO', stats.jump]] as const) {
      const cell = el('span', '');
      cell.append(el('i', '', label), String(value));
      grid.append(cell);
    }
    const bar = el('div', 'bar');
    const now = el('div', `hp-now${low ? ' low' : ''}`), ghost = el('div', 'hp-ghost');
    now.style.width = ghost.style.width = pct;
    bar.append(ghost, now);
    const head = el('div', 'head'), who = el('div', '');
    who.append(el('div', 'name', u.name), el('div', 'cls', `${RACES[u.raceId]?.name ?? ''} ${CLASSES[u.classId].name} Lv ${u.level}${u.passive ? `, ${CLASSES[u.passive].passive.name}` : ''}${u.team === me ? '' : ', nemico'}`));
    head.append(medal(u), who);
    const hpRow = el('div', 'hp-row');
    hpRow.append(el('span', 'hp-num', `${Math.max(0, u.hp)}/${stats.maxHp}`), el('span', 'hp-lbl', 'PV'));
    c.replaceChildren(head, bar, hpRow, grid, el('div', 'statuses', statusText(u)));
  },

  /** The battle goal, under the banner; null hides it. */
  goal(text: string | null) {
    const g = $('goal');
    g.textContent = text ?? '';
    g.hidden = !text;
  },

  banner(text: string) {
    $('banner').textContent = text;
  },

  /** Big title across the screen at the start of a turn. */
  ribbon(text: string, sound: Sound = 'turn') {
    const r = $('ribbon');
    r.textContent = text;
    r.classList.remove('show');
    void r.offsetWidth; // restart the animation
    r.classList.add('show');
    play(sound);
  },

  /** Expected result of an action, shown before the player confirms it. */
  forecast(f: Forecast | null) {
    const box = $('forecast');
    if (!f) return void (box.hidden = true);
    box.className = f.heal ? 'heal' : '';
    const rows: [string, string][] = [...(f.rows ?? [])];
    if (!f.heal && f.side) rows.push(['Lato', SIDE_TEXT[f.side]]);
    if (!f.heal && f.dh) rows.push([f.dh > 0 ? `Più in alto di ${f.dh}` : `Più in basso di ${-f.dh}`, `${f.dh > 0 ? '+' : ''}${Math.max(-4, Math.min(4, f.dh)) * 5}%`]);
    const dl = document.createElement('dl');
    for (const [k, v] of rows) dl.append(el('dt', '', k), el('dd', '', v));
    const parts: HTMLElement[] = [el('h4', '', f.title)];
    if (f.amount !== undefined) {
      const big = el('div', 'big', `${f.heal ? '+' : ''}${f.amount}`);
      big.append(el('small', '', f.heal ? 'cura, circa' : 'danno, circa'));
      parts.push(big);
    }
    parts.push(dl);
    if (f.amount !== undefined && f.hp !== undefined && f.maxHp !== undefined) {
      const after = f.heal ? Math.min(f.maxHp, f.hp + f.amount) : Math.max(0, f.hp - f.amount);
      const res = el('div', 'after');
      res.append(`PV ${f.hp} `, el('span', '', 'diventa'), ' ', el('b', after === 0 ? 'ko' : '', after === 0 ? 'KO' : String(after)));
      parts.push(res);
    }
    box.replaceChildren(...parts);
    box.hidden = false;
  },

  /** Fixed row at the bottom right; also closes the action list. */
  buttons(list: (Btn | HTMLElement)[]) {
    $('actions').hidden = true;
    $('buttons').replaceChildren(...list.map(b => (b instanceof HTMLElement ? b : button(b))));
  },

  /**
   * Turn menu: a titled vertical list the scene keeps next to the unit, plus `fixed` in the bottom row.
   * Phones get the plain bottom row: a list beside the unit would cover the map. Returns the list, or null on phones.
   */
  actions(title: string, list: Btn[], fixed: Btn[] = []): HTMLElement | null {
    // shortcut: decided when the menu opens, a resize keeps the old layout until the next menu
    if (matchMedia('(max-width: 640px)').matches) return this.buttons([...fixed, ...list]), null;
    this.buttons(fixed);
    const box = $('actions');
    box.replaceChildren(el('h4', '', title), ...list.map(button));
    box.hidden = false;
    return box;
  },

  /** 2×2 grid of iso arrows, laid out like they appear on screen. */
  dirs(onPick: (d: 'N' | 'E' | 'S' | 'W') => void, onPreview?: (d: 'N' | 'E' | 'S' | 'W' | null) => void): HTMLElement {
    const g = el('div', 'dirs');
    for (const [d, label, name] of [['W', '↖', 'alto a sinistra'], ['N', '↗', 'alto a destra'], ['S', '↙', 'basso a sinistra'], ['E', '↘', 'basso a destra']] as const) {
      const b = button({ label, onClick: () => onPick(d), onHover: onPreview && (on => onPreview(on ? d : null)) });
      (b.querySelector('button') ?? b).setAttribute('aria-label', `Guarda in ${name}`);
      g.append(b);
    }
    return g;
  },

  /** End screen: the title lands, then each report line appears in turn; level-ups get their own sound. */
  result(win: boolean, lines: string[], onRestart: () => void, label = 'Torna al menu') {
    const r = $('result');
    r.className = win ? 'win' : 'lose';
    const list = el('ul', 'xp-report');
    const step = reducedMotion() ? 0 : 280;
    lines.forEach((l, i) => {
      const li = el('li', /livello/i.test(l) ? 'up' : /oro/.test(l) ? 'gold' : '', l);
      li.style.animationDelay = `${600 + i * step}ms`;
      list.append(li);
      if (/livello/i.test(l)) setTimeout(() => play('level'), 600 + i * step);
    });
    r.replaceChildren(el('h1', '', win ? 'Vittoria' : 'Sconfitta'), list, button({ label, icon: win && label !== 'Torna al menu' ? 'confirm' : 'back', onClick: onRestart, primary: true }));
    r.hidden = false;
    music(null);
    play(win ? 'win' : 'lose');
  },
};

/** Q/E handler of the scene on screen; replaced by the next one, so a torn-down scene gets no keys. */
let rotateKeys: ((e: KeyboardEvent) => void) | null = null;

/** ⟲ ⟳ buttons plus Q/E keys to rotate the camera. */
export function mountRotate(scene: { rotate(steps: 1 | -1): void }) {
  const box = $('rotate');
  box.replaceChildren(
    button({ label: '⟲', onClick: () => scene.rotate(-1) }),
    button({ label: '⟳', onClick: () => scene.rotate(1) }),
  );
  box.querySelectorAll('button').forEach((b, i) => {
    b.title = i ? 'Ruota a destra (E)' : 'Ruota a sinistra (Q)';
    b.setAttribute('aria-label', b.title);
  });
  box.hidden = false;
  if (rotateKeys) window.removeEventListener('keydown', rotateKeys);
  rotateKeys = e => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.repeat || box.hidden) return;
    if (e.key === 'q' || e.key === 'Q') scene.rotate(-1);
    if (e.key === 'e' || e.key === 'E') scene.rotate(1);
  };
  window.addEventListener('keydown', rotateKeys);
}
