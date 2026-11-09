import {
  CLASSES, activeUnit, apply, rangeCells, destinations, facingToward, key, planTurn, samePos, targetsFor,
  type ActionDef, type BattleAction, type BattleState, type Dir, type Pos,
} from '@tactics/core';
import type { BattleScene } from './BattleScene';
import { hud } from './hud';

const PLAYER = 'A';
const actionColor = (a: ActionDef) => (a.effect === 'heal' ? 0x6cc04a : 0xff5a4f);
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

type Mode =
  | { k: 'busy' }
  | { k: 'idle' }
  | { k: 'move'; cells: Pos[] }
  | { k: 'target'; action: ActionDef; cells: Pos[] }
  | { k: 'face' };

export class Controller {
  private mode: Mode = { k: 'busy' };

  constructor(private scene: BattleScene, private state: BattleState) {
    scene.events.on('cell', (p: Pos) => void this.onCell(p));
  }

  private get unit() { return activeUnit(this.state); }

  start() { this.beginTurn(); }

  private beginTurn() {
    const u = this.unit;
    hud.timeline(this.state);
    this.scene.clearHighlights();
    if (this.state.winner) {
      this.scene.setActive(null);
      hud.buttons([]);
      hud.banner('');
      return hud.result(this.state.winner === PLAYER ? 'Vittoria!' : 'Sconfitta', () => location.reload())  // reload = back to menu;
    }
    this.scene.setActive(u.id);
    hud.card(u);
    if (u.team === PLAYER) this.menu();
    else void this.runAi();
  }

  private menu() {
    if (this.state.moved && this.state.acted) return this.face();
    const u = this.unit;
    this.mode = { k: 'idle' };
    this.scene.clearHighlights();
    hud.banner(`Turno di ${u.name} · round ${this.state.round}`);
    const actions = CLASSES[u.classId].actions.map(a => {
      const n = targetsFor(this.state, u, a).length;
      return {
        label: a.name, hint: this.state.acted ? 'già fatto' : n ? undefined : 'nessun bersaglio', disabled: this.state.acted || !n, onClick: () => this.target(a),
        onHover: (on: boolean) => {
          if (this.mode.k !== 'idle') return;
          this.scene.clearHighlights();
          if (on) this.scene.highlight(rangeCells(this.state.map, u.pos, a), actionColor(a), 0.3);
        },
      };
    });
    hud.buttons([
      { label: 'Muovi', hint: this.state.moved ? 'già fatto' : undefined, disabled: this.state.moved, onClick: () => this.move() },
      ...actions,
      { label: 'Fine turno', primary: true, onClick: () => this.face() },
    ]);
  }

  private move() {
    const cells = destinations(this.state.map, this.state.units, this.unit);
    this.mode = { k: 'move', cells };
    this.scene.clearHighlights();
    this.scene.highlight(cells, 0x4fc3ff);
    hud.banner('Tocca una casella blu');
    hud.buttons([{ label: 'Indietro', onClick: () => this.menu() }]);
  }

  private target(action: ActionDef) {
    const cells = targetsFor(this.state, this.unit, action).map(t => t.pos);
    this.mode = { k: 'target', action, cells };
    this.scene.clearHighlights();
    this.scene.highlight(rangeCells(this.state.map, this.unit.pos, action), actionColor(action), 0.18);
    this.scene.highlight(cells, actionColor(action));
    hud.banner(`${action.name}: tocca un bersaglio`);
    hud.buttons([{ label: 'Indietro', onClick: () => this.menu() }]);
  }

  private face() {
    this.mode = { k: 'face' };
    this.scene.clearHighlights();
    hud.banner('Scegli la direzione (o tocca una casella)');
    const back = this.state.moved && this.state.acted ? [] : [{ label: 'Indietro', onClick: () => this.menu() }];
    hud.buttons([...back, hud.dirs(d => void this.end(d))]);
  }

  private async end(facing: Dir) {
    await this.commit({ type: 'end', facing });
    this.beginTurn();
  }

  private async onCell(p: Pos) {
    const m = this.mode;
    if (m.k === 'move' && m.cells.some(c => samePos(c, p))) {
      await this.commit({ type: 'move', to: p });
      this.menu();
    } else if (m.k === 'target' && m.cells.some(c => samePos(c, p))) {
      await this.commit({ type: 'act', actionId: m.action.id, target: p });
      if (this.state.winner) this.beginTurn();
      else this.menu();
    } else if (m.k === 'face' && !samePos(p, this.unit.pos)) {
      await this.end(facingToward(this.unit.pos, p));
    } else if (m.k === 'idle') {
      // inspect any unit by tapping it
      const u = this.state.units.find(x => x.hp > 0 && key(x.pos) === key(p));
      hud.card(u ?? this.unit);
    }
  }

  private async commit(a: BattleAction) {
    this.mode = { k: 'busy' };
    hud.buttons([]);
    this.scene.clearHighlights();
    try {
      this.state = apply(this.state, a);
    } catch (e) {
      console.error(e);
      return;
    }
    const byId = (id: string) => this.state.units.find(u => u.id === id)!;
    for (const ev of this.state.events) {
      if (ev.type === 'move') await this.scene.animateMove(ev.unitId, ev.path);
      if (ev.type === 'damage') this.scene.floatText(byId(ev.unitId), `${ev.amount}${ev.side === 'back' ? ' alle spalle!' : ev.side === 'flank' ? ' di fianco' : ''}`, '#ffd2c2');
      if (ev.type === 'heal') this.scene.floatText(byId(ev.unitId), `+${ev.amount}`, '#b6f29a');
    }
    for (const u of this.state.units) this.scene.syncUnit(u);
    hud.card(this.unit);
    if (this.state.events.some(e => e.type === 'damage' || e.type === 'heal')) await wait(500);
  }

  private async runAi() {
    this.mode = { k: 'busy' };
    hud.buttons([]);
    hud.banner(`Turno nemico: ${this.unit.name}`);
    await wait(500);
    for (const a of planTurn(this.state)) {
      if (a.type === 'act') {
        const action = CLASSES[this.unit.classId].actions.find(x => x.id === a.actionId)!;
        this.scene.highlight([a.target], actionColor(action));
        await wait(350);
      }
      await this.commit(a);
      if (this.state.winner) break;
      await wait(200);
    }
    this.beginTurn();
  }
}
