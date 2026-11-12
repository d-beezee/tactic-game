import Phaser from 'phaser';
import {
  MAP_MAX_SIZE, MAP_MIN_SIZE, MAX_DEPLOY, MAX_HEIGHT, blankMap, inBounds, key, parseMap, resizeMap, samePos, validateMap,
  type MapData, type Pos, type Team,
} from '@tactics/core';
import { BattleScene, TEAM_COLOR, type Insets } from './BattleScene';
import { mountRotate } from './hud';
import { allMaps, deleteMap, isBuiltin, loadMaps, saveMap } from './maps';

type Tool =
  | { k: 'raise' } | { k: 'lower' }
  | { k: 'paint'; code: string }
  | { k: 'spawn'; team: Team };

const TOOLS: { label: string; tool: Tool }[] = [
  { label: 'Alza', tool: { k: 'raise' } },
  { label: 'Abbassa', tool: { k: 'lower' } },
  { label: 'Erba', tool: { k: 'paint', code: 'g' } },
  { label: 'Terra', tool: { k: 'paint', code: 'd' } },
  { label: 'Pietra', tool: { k: 'paint', code: 's' } },
  { label: 'Acqua', tool: { k: 'paint', code: 'w' } },
  { label: 'Albero', tool: { k: 'paint', code: 'x' } },
  { label: 'Partenza blu', tool: { k: 'spawn', team: 'A' } },
  { label: 'Partenza nemica', tool: { k: 'spawn', team: 'B' } },
];

const newId = () => `map-${Date.now().toString(36)}`;
const editorInsets = (w: number, h: number): Insets => (w >= 800 ? { top: 16, right: 360, bottom: 16, left: 0 } : { top: 16, right: 0, bottom: Math.round(h * 0.45), left: 0 });

// props typed loosely: the precise Partial<Element> type makes nested calls too complex for tsc
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: object = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};

/** Admin map editor. Opens a blank map; builtin maps are edited as copies. */
export function startEditor() {
  const root = document.getElementById('editor')!;
  root.hidden = false;
  document.body.classList.add('editing');
  const first = blankMap(newId());
  const scene = new BattleScene(first, [], s => {
    if (import.meta.env.DEV) Object.assign(window, { __scene: s }); // for browser tests
    mountRotate(s);
    s.pannable = false; // dragging paints here
    new Editor(s, root, first).start();
  }, editorInsets);
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#1b1712',
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene: [scene],
  });
}

class Editor {
  private tool: Tool = TOOLS[0].tool;
  private dirty = false;
  private ui!: { name: HTMLInputElement; w: HTMLInputElement; h: HTMLInputElement; deploy: HTMLInputElement; open: HTMLSelectElement; status: HTMLElement; save: HTMLButtonElement; del: HTMLButtonElement; tools: HTMLElement };

  constructor(private scene: BattleScene, private root: HTMLElement, private map: MapData) {}

  start() {
    this.buildPanel();
    this.load(this.map);
    const canvas = this.scene.game.canvas;
    canvas.addEventListener('pointerdown', e => this.stroke(e));
    window.addEventListener('beforeunload', e => { if (this.dirty) e.preventDefault(); });
    loadMaps(true).then(() => this.refresh(), e => alert(`Mappe salvate non caricate: ${(e as Error).message}`));
  }

  // ---------- map changes ----------

  private load(m: MapData) {
    this.map = structuredClone(m);
    this.scene.setMap(this.map);
    this.dirty = false;
    this.syncInputs();
    this.refresh();
  }

  private changed() {
    this.dirty = true;
    this.refresh();
  }

  /** One pointer stroke: height/paint tools apply once per cell crossed, spawn tools toggle the first cell only. */
  private stroke(e: PointerEvent) {
    const done = new Set<string>();
    const apply = (ev: PointerEvent) => {
      const p = this.scene.cellAt(ev.clientX, ev.clientY);
      if (!p || done.has(key(p))) return;
      done.add(key(p));
      this.applyTool(p);
    };
    apply(e);
    if (this.tool.k === 'spawn') return;
    const up = () => {
      window.removeEventListener('pointermove', apply);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', apply);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  private applyTool(p: Pos) {
    const m = this.map, t = this.tool;
    if (t.k === 'raise' || t.k === 'lower') {
      const h = m.heights[p.y][p.x] + (t.k === 'raise' ? 1 : -1);
      if (h < 0 || h > MAX_HEIGHT) return;
      m.heights[p.y][p.x] = h;
      this.scene.redrawCell(m, p);
    } else if (t.k === 'paint') {
      const row = m.terrain[p.y];
      if (row[p.x] === t.code) return;
      m.terrain[p.y] = row.slice(0, p.x) + t.code + row.slice(p.x + 1);
      this.scene.redrawCell(m, p);
    } else {
      const other: Team = t.team === 'A' ? 'B' : 'A';
      const mine = m.spawns[t.team];
      m.spawns[other] = m.spawns[other].filter(s => !samePos(s, p));
      m.spawns[t.team] = mine.some(s => samePos(s, p)) ? mine.filter(s => !samePos(s, p)) : [...mine, { ...p }];
    }
    this.changed();
  }

  private resize() {
    const clamp = (v: string) => Math.max(MAP_MIN_SIZE, Math.min(MAP_MAX_SIZE, Math.round(Number(v)) || MAP_MIN_SIZE));
    const w = clamp(this.ui.w.value), h = clamp(this.ui.h.value);
    if (w === this.map.width && h === this.map.height) return this.syncInputs();
    this.map = resizeMap(this.map, w, h);
    this.scene.setMap(this.map);
    this.syncInputs();
    this.changed();
  }

  // ---------- panel ----------

  private buildPanel() {
    const name = el('input', { type: 'text', maxLength: 40, oninput: () => { this.map.name = name.value; this.changed(); } });
    const num = (min: number, max: number) => el('input', { type: 'number', min: String(min), max: String(max) });
    const w = num(MAP_MIN_SIZE, MAP_MAX_SIZE), h = num(MAP_MIN_SIZE, MAP_MAX_SIZE);
    w.onchange = h.onchange = () => this.resize();
    const deploy = num(1, MAX_DEPLOY);
    deploy.onchange = () => {
      this.map.maxDeploy = Math.max(1, Math.min(MAX_DEPLOY, Math.round(Number(deploy.value)) || 1));
      deploy.value = String(this.map.maxDeploy);
      this.changed();
    };
    const open = el('select', { onchange: () => this.openSelected() });
    const tools = el('div', { className: 'ed-tools' });
    const status = el('div', { className: 'ed-status' });
    const save = el('button', { className: 'primary', onclick: () => this.save() });
    const del = el('button', { textContent: 'Elimina', onclick: () => this.remove() });
    const file = el('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: () => this.importFile(file) });

    this.ui = { name, w, h, deploy, open, status, save, del, tools };
    this.root.replaceChildren(
      el('header', {},
        el('button', { textContent: '← Menu', onclick: () => location.reload() }),
        el('h2', { textContent: 'Editor mappe' }),
      ),
      el('section', {},
        el('div', { className: 'ed-row' }, open, el('button', { textContent: 'Nuova', onclick: () => this.confirmDiscard() && this.load(blankMap(newId())) })),
        el('label', {}, 'Nome', name),
        el('div', { className: 'ed-row' }, el('label', {}, 'Larghezza', w), el('label', {}, 'Profondità', h), el('label', {}, 'Unità max', deploy)),
      ),
      el('section', {}, el('div', { className: 'ed-label', textContent: 'Strumento' }), tools),
      status,
      el('div', { className: 'ed-row' },
        save,
        el('button', { textContent: 'Esporta', onclick: () => this.exportFile() }),
        el('button', { textContent: 'Importa', onclick: () => file.click() }),
        del, file,
      ),
    );
  }

  private syncInputs() {
    this.ui.name.value = this.map.name;
    this.ui.w.value = String(this.map.width);
    this.ui.h.value = String(this.map.height);
    this.ui.deploy.value = String(this.map.maxDeploy);
  }

  /** Re-render everything that depends on map state, except the canvas cells. */
  private refresh() {
    const m = this.map;
    this.scene.clearHighlights();
    this.scene.highlight(m.spawns.A.filter(p => inBounds(m, p)), TEAM_COLOR.A);
    this.scene.highlight(m.spawns.B.filter(p => inBounds(m, p)), TEAM_COLOR.B);

    this.ui.tools.replaceChildren(...TOOLS.map(({ label, tool }) => el('button', {
      textContent: label,
      className: JSON.stringify(tool) === JSON.stringify(this.tool) ? 'sel' : '',
      onclick: () => { this.tool = tool; this.refresh(); },
    })));

    const maps = allMaps();
    const current = maps.some(x => x.id === m.id) ? m.id : '';
    this.ui.open.replaceChildren(
      el('option', { value: '', textContent: current ? 'Apri mappa…' : `${m.name} (non salvata)`, disabled: !!current }),
      ...maps.map(x => el('option', { value: x.id, textContent: `${x.name}${isBuiltin(x.id) ? ' · base' : ''}`, selected: x.id === current })),
    );

    const errors = validateMap(m);
    this.ui.status.className = `ed-status ${errors.length ? 'bad' : 'ok'}`;
    this.ui.status.replaceChildren(
      errors.length
        ? el('ul', {}, ...errors.map(e => el('li', { textContent: e })))
        : el('span', { textContent: `Mappa valida · ${m.spawns.A.length} partenze blu, ${m.spawns.B.length} nemiche${this.dirty ? ' · modifiche non salvate' : ''}` }),
    );
    this.ui.save.disabled = errors.length > 0;
    this.ui.save.textContent = errors.length ? 'Correggi gli errori per salvare' : isBuiltin(m.id) ? 'Salva come copia' : 'Salva';
    this.ui.del.disabled = isBuiltin(m.id) || !maps.some(x => x.id === m.id);
  }

  // ---------- storage ----------

  private confirmDiscard() {
    return !this.dirty || confirm('Ci sono modifiche non salvate. Continuare?');
  }

  private openSelected() {
    const m = allMaps().find(x => x.id === this.ui.open.value);
    if (m && this.confirmDiscard()) this.load(m);
    else this.refresh();
  }

  private async save() {
    if (isBuiltin(this.map.id)) this.map = { ...this.map, id: newId(), name: `${this.map.name} (copia)` };
    this.ui.save.disabled = true; // no double save while the request runs
    try {
      await saveMap(this.map);
    } catch (e) {
      alert(`Salvataggio non riuscito: ${(e as Error).message}`);
      return this.refresh();
    }
    this.dirty = false;
    this.syncInputs();
    this.refresh();
  }

  private async remove() {
    if (!confirm(`Eliminare la mappa "${this.map.name}"? La perdono tutti i giocatori e non si può annullare.`)) return;
    try {
      await deleteMap(this.map.id);
    } catch (e) {
      return alert(`Eliminazione non riuscita: ${(e as Error).message}`);
    }
    this.load(blankMap(newId()));
  }

  private exportFile() {
    const blob = new Blob([JSON.stringify(this.map, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `${this.map.id}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private async importFile(input: HTMLInputElement) {
    const f = input.files?.[0];
    input.value = '';
    if (!f || !this.confirmDiscard()) return;
    let m: MapData | null = null;
    try {
      m = parseMap(JSON.parse(await f.text()));
    } catch {
      /* not JSON */
    }
    if (!m) return alert('File non valido: non è una mappa o contiene errori.');
    // imported maps get a fresh id so they never overwrite an existing one by accident
    this.load({ ...m, id: newId() });
    this.dirty = true;
    this.refresh();
  }
}
