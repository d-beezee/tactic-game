import { CLASSES, key, samePos, unitFromRoster, type MapData, type Pos, type RosterUnit, type Unit } from '@tactics/core';
import type { BattleScene } from './BattleScene';
import { hud } from './hud';
import { COLOR } from './theme';

const SPAWN = COLOR.reach, HOVER = COLOR.brass;

type Source = { kind: 'tray'; r: RosterUnit } | { kind: 'cell'; u: Unit };

/** Pre-battle phase: drag roster units onto the team's spawn cells. */
export class Deploy {
  private placed: Unit[] = [];
  private drag: { src: Source; ghost: HTMLElement; startX: number; startY: number; moved: boolean; hover: Pos | null } | null = null;
  private onCanvasDown = (e: PointerEvent) => {
    const p = this.scene.cellAt(e.clientX, e.clientY);
    const u = p && this.placed.find(x => samePos(x.pos, p));
    if (u) { hud.card(u); this.startDrag({ kind: 'cell', u }, e); }
  };

  constructor(
    private scene: BattleScene,
    private map: MapData,
    private roster: RosterUnit[],
    private onStart: (team: Unit[]) => void,
  ) {}

  start() {
    this.scene.game.canvas.addEventListener('pointerdown', this.onCanvasDown);
    this.scene.focus(this.spawns[0]);
    this.render();
  }

  private get spawns() { return this.map.spawns.A; }
  private get max() { return this.map.maxDeploy; }
  private at(p: Pos) { return this.placed.find(u => samePos(u.pos, p)); }
  private isSpawn(p: Pos | null): p is Pos { return !!p && this.spawns.some(s => samePos(s, p)); }

  private render() {
    this.scene.clearHighlights();
    this.scene.highlight(this.spawns, SPAWN);
    if (this.drag?.hover) this.scene.highlight([this.drag.hover], HOVER);
    const full = this.placed.length >= this.max;
    hud.banner(full
      ? `Squadra al completo (${this.max}/${this.max}): trascina un'unità su una casella occupata per sostituirla`
      : `Schieramento ${this.placed.length}/${this.max}: tocca o trascina un'unità sulle caselle azzurre`);

    const tray = this.roster.filter(r => !this.placed.some(u => u.id === r.id)).map(r => {
      const item = Object.assign(document.createElement('div'), { className: `tray-item${full ? ' full' : ''}` });
      const face = Object.assign(document.createElement('div'), { className: 'medal A' });
      face.style.backgroundImage = `url(${this.scene.portrait(r.classId)})`;
      const txt = document.createElement('span');
      txt.append(Object.assign(document.createElement('b'), { textContent: r.name }), Object.assign(document.createElement('small'), { textContent: CLASSES[r.classId].name }));
      item.append(face, txt);
      item.onpointerdown = e => { hud.card(unitFromRoster(r, 'A', { x: 0, y: 0 }, 'S')); this.startDrag({ kind: 'tray', r }, e); };
      return item;
    });
    const trayBox = Object.assign(document.createElement('div'), { className: 'tray' });
    trayBox.append(...(tray.length ? tray : [Object.assign(document.createElement('span'), { className: 'tray-empty', textContent: 'Tutte le unità sono in campo' })]));

    hud.buttons([
      trayBox,
      { label: 'Menu', icon: 'back', onClick: () => location.reload() },
      {
        label: this.placed.length ? 'Inizia battaglia' : 'Schiera almeno 1 unità',
        primary: true,
        disabled: this.placed.length === 0,
        onClick: () => {
          this.scene.game.canvas.removeEventListener('pointerdown', this.onCanvasDown);
          this.onStart(this.placed);
        },
      },
    ]);
  }

  private startDrag(src: Source, e: PointerEvent) {
    e.preventDefault();
    const name = src.kind === 'tray' ? src.r.name : src.u.name;
    const classId = src.kind === 'tray' ? src.r.classId : src.u.classId;
    // the unit itself follows the finger, half transparent
    const ghost = Object.assign(document.createElement('div'), { className: 'drag-ghost' });
    ghost.append(Object.assign(document.createElement('img'), { src: `units/${classId}/S.png`, alt: '' }), Object.assign(document.createElement('span'), { textContent: name }));
    ghost.hidden = true;
    document.body.append(ghost);
    this.drag = { src, ghost, startX: e.clientX, startY: e.clientY, moved: false, hover: null };
    this.scene.panLock = true;

    const move = (ev: PointerEvent) => {
      const d = this.drag!;
      if (!d.moved && Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < 6) return;
      d.moved = true;
      ghost.hidden = false;
      ghost.style.transform = `translate(${ev.clientX}px, ${ev.clientY}px)`;
      const cell = this.scene.cellAt(ev.clientX, ev.clientY);
      const hover = this.isSpawn(cell) ? cell : null;
      if (key(hover ?? { x: -1, y: -1 }) !== key(d.hover ?? { x: -1, y: -1 })) { d.hover = hover; this.render(); }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const d = this.drag!;
      this.scene.panLock = false;
      ghost.remove();
      this.drag = null;
      if (ev.type === 'pointercancel') return this.render();
      // a tap on a tray unit places it on the first free spawn
      const target = d.moved ? this.scene.cellAt(ev.clientX, ev.clientY) : d.src.kind === 'tray' ? this.spawns.find(s => !this.at(s)) ?? null : null;
      if (d.moved || d.src.kind === 'tray') this.drop(d.src, target);
      this.render();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  private drop(src: Source, target: Pos | null) {
    const occupant = target && this.at(target);
    if (src.kind === 'cell') {
      if (!this.isSpawn(target)) return this.remove(src.u);          // dragged off the spawn zone
      if (occupant && occupant !== src.u) this.setPos(occupant, src.u.pos); // swap
      this.setPos(src.u, target);
      return;
    }
    if (!this.isSpawn(target)) return;
    if (occupant) this.remove(occupant);                               // replace: occupant back to the tray
    else if (this.placed.length >= this.max) return; // full: the banner already shows N/N
    const u = unitFromRoster(src.r, 'A', target, 'S');
    this.placed.push(u);
    this.scene.addUnit(u);
    this.scene.dropIn(u.id);
    hud.card(u);
  }

  private setPos(u: Unit, p: Pos) {
    u.pos = { ...p };
    this.scene.syncUnit(u);
  }

  private remove(u: Unit) {
    this.placed = this.placed.filter(x => x !== u);
    this.scene.removeUnit(u.id);
  }
}

