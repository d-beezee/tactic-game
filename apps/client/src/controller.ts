import {
  CLASSES, activeUnit, apply, rangeCells, destinations, expectedAmount, facingToward, heightAt, key, pathTo, planTurn, reachable, samePos, sideOf, targetsFor,
  unitById, type ActionDef, type BattleAction, type BattleState, type Dir, type Pos, type Team, type Unit,
} from '@tactics/core';
import type { BattleScene } from './BattleScene';
import { hud } from './hud';
import { toMenu } from './nav';
import { COLOR } from './theme';

const actionColor = (a: ActionDef) => (a.effect === 'heal' ? COLOR.mend : COLOR.strike);
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/** The goal of team A, in words, with the units that must not fall. */
export function goalText(s: BattleState): string {
  const g = s.goal;
  const text = g.type === 'survive' ? `Resisti fino alla fine del round ${g.rounds} (ora ${Math.min(s.round, g.rounds)}/${g.rounds})`
    : g.type === 'reach' ? 'Porta un\'unità sulle caselle d\'oro'
    : g.type === 'boss' ? `Sconfiggi ${unitById(s, g.unitId).name}`
    : 'Sconfiggi tutti i nemici';
  const keep = s.protect.map(id => unitById(s, id).name);
  return keep.length ? `${text}. ${keep.join(' e ')} non deve cadere` : text;
}

type Mode =
  | { k: 'busy' }
  | { k: 'idle' }
  | { k: 'move'; cells: Pos[] }
  | { k: 'target'; action: ActionDef; cells: Pos[] }
  /** first tap on a target: the forecast is up, a second tap (or Conferma) acts */
  | { k: 'confirm'; action: ActionDef; cells: Pos[]; target: Pos }
  | { k: 'face' };

export class Controller {
  private mode: Mode = { k: 'busy' };

  /** the player's actions in order: what the server needs to replay the battle */
  private log: BattleAction[] = [];

  /** where the active unit will face when the turn ends: its last step, or where it already looked */
  private facing: Dir = 'S';

  /** the local player's team */
  private me: Team;

  /**
   * onEnd sends the player's actions to be replayed and returns lines for the result screen.
   * PvP: `remote` hands out the opponent's actions one at a time, `onAction` sends each of ours, `onResign` gives up.
   */
  constructor(
    private scene: BattleScene, private state: BattleState, private onEnd: (actions: BattleAction[]) => Promise<string[]>,
    private opts: {
      me?: Team; remote?: () => Promise<BattleAction>; onAction?: (a: BattleAction) => void; onResign?: () => void;
      /** ribbon text for one of our turns (prologue: the brothers take turns) */
      turnLabel?: (u: Unit) => string;
      /** after the result screen; default back to the menu */
      onDone?: { label: string; run: (win: boolean) => void };
    } = {},
  ) {
    this.me = opts.me ?? 'A';
    scene.events.on('cell', (p: Pos) => void this.onCell(p));
    scene.events.on('hover', (p: Pos | null) => this.onHover(p));
  }

  /** Mouse previews: the route to the cell under the pointer, or the forecast on a target. */
  private onHover(p: Pos | null) {
    const m = this.mode;
    if (m.k === 'move') {
      this.scene.showPath(p && m.cells.some(c => samePos(c, p)) ? pathTo(reachable(this.state.map, this.state.units, this.unit), p) : []);
    } else if (m.k === 'target') {
      hud.forecast(p && m.cells.some(c => samePos(c, p)) ? this.forecastFor(m.action, p) : null);
    }
  }

  private forecastFor(action: ActionDef, p: Pos) {
    const u = this.unit, t = this.state.units.find(x => x.hp > 0 && samePos(x.pos, p))!;
    const heal = action.effect === 'heal';
    return {
      title: `${action.name}: ${u.name} su ${t.name}`, heal, hp: t.hp, maxHp: t.stats.maxHp,
      amount: expectedAmount(this.state.map, u, u.pos, action, t),
      side: heal ? undefined : sideOf(u.pos, t), dh: heightAt(this.state.map, u.pos) - heightAt(this.state.map, t.pos),
    };
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
      hud.banner('Salvataggio…');
      const win = this.state.winner === this.me;
      hud.goal(null);
      const done = this.opts.onDone;
      return void this.onEnd(this.log).then(lines => {
        hud.banner('');
        hud.result(win, lines, done ? () => done.run(win) : () => toMenu(), done?.label);
      });
    }
    this.scene.setActive(u.id);
    this.scene.focus(u.pos);
    this.facing = u.facing;
    hud.card(u);
    hud.goal(goalText(this.state));
    hud.ribbon(u.team === this.me ? this.opts.turnLabel?.(u) ?? `Turno di ${u.name}` : `Turno nemico: ${u.name}`);
    if (u.team === this.me) this.menu();
    else void (this.opts.remote ? this.runRemote() : this.runAi());
  }

  private menu() {
    const u = this.unit;
    this.mode = { k: 'idle' };
    this.scene.clearHighlights();
    this.scene.clearPath();
    hud.forecast(null);
    this.scene.showFacing(u.id, this.facing);
    hud.banner(this.state.moved && this.state.acted ? `${u.name} ha finito: chiudi il turno` : `Round ${this.state.round}: scegli cosa fa ${u.name}`);
    const actions = CLASSES[u.classId].actions.map(a => {
      const n = targetsFor(this.state, u, a).length;
      return {
        label: a.name, icon: a.effect === 'heal' ? 'heal' as const : 'attack' as const,
        hint: this.state.acted ? 'già fatto' : n ? undefined : 'nessun bersaglio', disabled: this.state.acted || !n, onClick: () => this.target(a),
        onHover: (on: boolean) => {
          if (this.mode.k !== 'idle') return;
          this.scene.clearHighlights();
          if (on) this.scene.highlight(rangeCells(this.state.map, u.pos, a, u.mods.range), actionColor(a), 0.3);
        },
      };
    });
    hud.buttons([
      ...this.resignButton(),
      { label: 'Muovi', icon: 'move', hint: this.state.moved ? 'già fatto' : undefined, disabled: this.state.moved, onClick: () => this.move() },
      ...actions,
      { label: 'Direzione', icon: 'face', hint: 'facoltativa', onClick: () => this.face() },
      { label: 'Fine turno', icon: 'end', primary: true, onClick: () => void this.end(this.facing) },
    ]);
  }

  private move() {
    const cells = destinations(this.state.map, this.state.units, this.unit);
    this.mode = { k: 'move', cells };
    this.scene.clearHighlights();
    this.scene.highlight(cells, COLOR.reach);
    hud.banner('Tocca una casella azzurra');
    hud.buttons([{ label: 'Indietro', icon: 'back', onClick: () => this.menu() }]);
  }

  private target(action: ActionDef) {
    const cells = targetsFor(this.state, this.unit, action).map(t => t.pos);
    this.mode = { k: 'target', action, cells };
    this.scene.clearHighlights();
    this.scene.highlight(rangeCells(this.state.map, this.unit.pos, action, this.unit.mods.range), actionColor(action), 0.18);
    this.scene.highlight(cells, actionColor(action));
    hud.forecast(null);
    hud.banner(`${action.name}: tocca un bersaglio`);
    hud.buttons([{ label: 'Indietro', icon: 'back', onClick: () => this.menu() }]);
  }

  /** Show what the action will do; the same tap again, or Conferma, carries it out. */
  private confirm(action: ActionDef, cells: Pos[], target: Pos) {
    this.mode = { k: 'confirm', action, cells, target };
    this.scene.clearHighlights();
    this.scene.highlight(cells, actionColor(action), 0.25);
    this.scene.highlight([target], COLOR.brass, 0.6);
    hud.forecast(this.forecastFor(action, target));
    hud.banner('Tocca di nuovo il bersaglio, o Conferma');
    hud.buttons([
      { label: 'Indietro', icon: 'back', onClick: () => this.target(action) },
      { label: 'Conferma', icon: 'confirm', primary: true, onClick: () => void this.act(action, target) },
    ]);
  }

  private async act(action: ActionDef, target: Pos) {
    hud.forecast(null);
    await this.commit({ type: 'act', actionId: action.id, target });
    if (this.state.winner) this.beginTurn();
    else this.menu();
  }

  private face() {
    this.mode = { k: 'face' };
    this.scene.clearHighlights();
    hud.banner('Scegli dove guarda e chiudi il turno');
    const id = this.unit.id;
    hud.buttons([
      { label: 'Indietro', icon: 'back', onClick: () => this.menu() },
      hud.dirs(d => void this.end(this.scene.gridDir(d)), d => this.scene.showFacing(id, d ? this.scene.gridDir(d) : this.facing)),
    ]);
  }

  private async end(facing: Dir) {
    await this.commit({ type: 'end', facing });
    this.beginTurn();
  }

  private async onCell(p: Pos) {
    const m = this.mode;
    if (m.k === 'move' && m.cells.some(c => samePos(c, p))) {
      this.scene.clearPath();
      await this.commit({ type: 'move', to: p });
      this.menu();
    } else if (m.k === 'confirm' && samePos(m.target, p)) {
      await this.act(m.action, p);
    } else if ((m.k === 'target' || m.k === 'confirm') && m.cells.some(c => samePos(c, p))) {
      this.confirm(m.action, m.cells, p);
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
      const mine = this.unit.team === this.me;
      this.state = apply(this.state, a);
      if (mine) {
        this.log.push(a);
        this.opts.onAction?.(a);
      }
    } catch (e) {
      console.error(e);
      return;
    }
    const byId = (id: string) => this.state.units.find(u => u.id === id)!;
    const actor = this.unit;
    for (const ev of this.state.events) {
      if (ev.type === 'move') {
        await this.scene.animateMove(ev.unitId, ev.path);
        // the rules keep the old facing after a move; the natural default is the direction of the last step
        if (ev.path.length > 1) this.facing = facingToward(ev.path[ev.path.length - 2], ev.path[ev.path.length - 1]);
      }
      if (ev.type === 'damage' || ev.type === 'heal') this.facing = this.unit.facing;
      if (ev.type === 'damage' || ev.type === 'heal') {
        // the target's card shows the HP before the hit, then drops (or fills) with a trail
        const target = byId(ev.unitId), sign = ev.type === 'damage' ? 1 : -1;
        hud.card({ ...target, hp: Math.min(target.stats.maxHp, target.hp + sign * ev.amount) });
        if (ev.type === 'damage') {
          await this.scene.lunge(actor.id, target.pos);
          this.scene.impact(target, ev.amount, ev.side);
        } else this.scene.healFx(target, ev.amount);
        this.scene.syncUnit(target);
        hud.card(target);
      }
      if (ev.type === 'ko') this.scene.koFx(byId(ev.unitId));
    }
    for (const u of this.state.units) this.scene.syncUnit(u);
    if (a.type !== 'end') this.scene.showFacing(this.unit.id, this.facing);
    if (this.state.events.some(e => e.type === 'damage' || e.type === 'heal')) await wait(900);
    hud.card(this.unit);
  }

  private resignButton() {
    const resign = this.opts.onResign;
    return resign ? [{ label: 'Arrenditi', icon: 'back' as const, onClick: () => confirm('Arrenderti? La vittoria va all\'avversario.') && resign() }] : [];
  }

  /** PvP: plays the opponent's actions as they arrive, until their unit ends its turn. */
  private async runRemote() {
    this.mode = { k: 'busy' };
    hud.buttons(this.resignButton());
    hud.banner(`L'avversario muove ${this.unit.name}…`);
    this.scene.focus(this.unit.pos);
    for (;;) {
      const a = await this.opts.remote!();
      if (a.type === 'act') {
        const action = CLASSES[this.unit.classId].actions.find(x => x.id === a.actionId)!;
        this.scene.highlight([a.target], actionColor(action));
        await wait(350);
      }
      await this.commit(a);
      hud.buttons(this.resignButton());
      if (this.state.winner || a.type === 'end') break;
    }
    this.beginTurn();
  }

  private async runAi() {
    this.mode = { k: 'busy' };
    hud.buttons([]);
    hud.banner(`${this.unit.name} sta decidendo…`);
    this.scene.focus(this.unit.pos);
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
