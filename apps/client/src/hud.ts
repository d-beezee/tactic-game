import { CLASSES, unitById, type BattleState, type Unit } from '@tactics/core';

export interface Btn { label: string; hint?: string; onClick: () => void; disabled?: boolean; primary?: boolean; onHover?: (on: boolean) => void }

const $ = (id: string) => document.getElementById(id)!;

function button(b: Btn): HTMLElement {
  const el = document.createElement('button');
  el.textContent = b.label;
  if (b.hint) el.append(Object.assign(document.createElement('small'), { textContent: b.hint }));
  el.disabled = !!b.disabled;
  if (b.primary) el.className = 'primary';
  el.onclick = b.onClick;
  if (!b.onHover) return el;
  // disabled buttons get no mouse events, so the wrapper listens instead
  const wrap = Object.assign(document.createElement('span'), { className: 'btn-wrap' });
  wrap.append(el);
  wrap.onpointerenter = () => b.onHover!(true);
  wrap.onpointerleave = () => b.onHover!(false);
  return wrap;
}

export const hud = {
  timeline(s: BattleState) {
    const chips: HTMLElement[] = [];
    for (let i = 0; chips.length < 10 && i < s.order.length * 3; i++) {
      const u = unitById(s, s.order[(s.turn + i) % s.order.length]);
      if (u.hp <= 0) continue;
      chips.push(Object.assign(document.createElement('div'), { className: `chip ${u.team}${i === 0 ? ' now' : ''}`, textContent: u.name }));
    }
    $('timeline').replaceChildren(...chips);
  },

  card(u: Unit) {
    const c = $('card');
    c.className = u.team;
    c.innerHTML = '';
    const { stats } = u;
    c.append(
      Object.assign(document.createElement('div'), { className: 'name', textContent: u.name }),
      Object.assign(document.createElement('div'), { className: 'cls', textContent: `${CLASSES[u.classId].name} Lv ${u.level}${u.passive ? ` · ${CLASSES[u.passive].passive.name}` : ''} · ${u.team === 'A' ? 'tua squadra' : 'nemico'}` }),
      Object.assign(document.createElement('div'), { className: 'bar', innerHTML: `<div style="width:${(100 * u.hp) / stats.maxHp}%"></div>` }),
      Object.assign(document.createElement('div'), {
        className: 'stats',
        textContent: `PV ${u.hp}/${stats.maxHp} · ATT ${stats.atk} · DIF ${stats.def} · MAG ${stats.mag} · VEL ${stats.speed} · MOV ${stats.move} · SALTO ${stats.jump}`,
      }),
    );
  },

  banner(text: string) {
    $('banner').textContent = text;
  },

  buttons(list: (Btn | HTMLElement)[]) {
    $('buttons').replaceChildren(...list.map(b => (b instanceof HTMLElement ? b : button(b))));
  },

  /** 2×2 grid of iso arrows, laid out like they appear on screen. */
  dirs(onPick: (d: 'N' | 'E' | 'S' | 'W') => void): HTMLElement {
    const g = Object.assign(document.createElement('div'), { className: 'dirs' });
    for (const [d, label] of [['W', '↖'], ['N', '↗'], ['S', '↙'], ['E', '↘']] as const) g.append(button({ label, onClick: () => onPick(d) }));
    return g;
  },

  result(text: string, lines: string[], onRestart: () => void) {
    const r = $('result');
    r.innerHTML = '';
    const list = Object.assign(document.createElement('ul'), { className: 'xp-report' });
    list.append(...lines.map(l => Object.assign(document.createElement('li'), { textContent: l })));
    r.append(Object.assign(document.createElement('h1'), { textContent: text }), list, button({ label: 'Torna al menu', onClick: onRestart, primary: true }));
    r.hidden = false;
  },
};

/** ⟲ ⟳ buttons plus Q/E keys to rotate the camera. */
export function mountRotate(scene: { rotate(steps: 1 | -1): void }) {
  const box = $('rotate');
  box.replaceChildren(
    button({ label: '⟲', onClick: () => scene.rotate(-1) }),
    button({ label: '⟳', onClick: () => scene.rotate(1) }),
  );
  box.querySelectorAll('button').forEach((b, i) => (b.title = i ? 'Ruota a destra (E)' : 'Ruota a sinistra (Q)'));
  box.hidden = false;
  window.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.repeat) return;
    if (e.key === 'q' || e.key === 'Q') scene.rotate(-1);
    if (e.key === 'e' || e.key === 'E') scene.rotate(1);
  });
}
