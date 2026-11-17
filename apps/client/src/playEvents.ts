import { facingToward, STATUSES, type BattleEvent, type BattleState, type Dir, type Unit } from '@tactics/core';
import type { BattleScene } from './BattleScene';
import { hud } from './hud';
import { play } from './sfx';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
// pop-up text colours: CSS strings, as Phaser text takes them
const TEXT = { status: '#ffc83d', poison: '#c6f27a', bump: '#ffffff', dodge: '#7fd3e6' };

interface Ctx { scene: BattleScene; actor: Unit; byId: (id: string) => Unit; facing: Dir }
type Players = { [K in BattleEvent['type']]: (ev: Extract<BattleEvent, { type: K }>, c: Ctx) => void | Promise<void> };

async function hpChange(ev: Extract<BattleEvent, { type: 'damage' | 'heal' }>, c: Ctx) {
  c.facing = c.actor.facing;
  // the target's card shows the HP before the hit, then drops (or fills) with a trail
  const target = c.byId(ev.unitId), sign = ev.type === 'damage' ? 1 : -1;
  hud.card({ ...target, hp: Math.min(target.stats.maxHp, target.hp + sign * ev.amount) });
  if (ev.type === 'damage') {
    await c.scene.lunge(c.actor.id, target.pos);
    c.scene.impact(target, ev.amount, ev.side);
  } else c.scene.healFx(target, ev.amount);
  c.scene.syncUnit(target);
  hud.card(target);
}

/** How each event is shown: animation, sound, pause. */
const PLAY: Players = {
  async move(ev, c) {
    await c.scene.animateMove(ev.unitId, ev.path);
    // the rules keep the old facing after a move; the natural default is the direction of the last step
    if (ev.path.length > 1) c.facing = facingToward(ev.path[ev.path.length - 2], ev.path[ev.path.length - 1]);
  },
  damage: hpChange,
  heal: hpChange,
  ko: (ev, c) => c.scene.koFx(c.byId(ev.unitId)),
  async status(ev, c) {
    if (!ev.on) return;
    play('select');
    c.scene.popText(c.byId(ev.unitId), STATUSES[ev.statusId].name, TEXT.status);
    c.scene.syncUnit(c.byId(ev.unitId));
    await wait(300);
  },
  async tick(ev, c) {
    const t = c.byId(ev.unitId);
    if (ev.amount > 0) c.scene.healFx(t, ev.amount);
    else { play('hit'); c.scene.popText(t, String(-ev.amount), TEXT.poison); }
    c.scene.syncUnit(t);
    await wait(450);
  },
  async push(ev, c) {
    await c.scene.animateMove(ev.unitId, ev.path);
    if (!ev.damage) return;
    play('heavy');
    c.scene.popText(c.byId(ev.unitId), String(ev.damage), TEXT.bump, ev.path.length === 1 ? 'Urto' : 'Caduta');
  },
  dodge(ev, c) {
    play('step');
    c.scene.popText(c.byId(ev.unitId), 'Schivata', TEXT.dodge);
  },
  async skip(ev, c) {
    const t = c.byId(ev.unitId);
    c.scene.focus(t.pos);
    c.scene.popText(t, 'Stordito', TEXT.status);
    await wait(700);
  },
  teleport: (ev, c) => dropIn(c, [ev.unitId]),
  swap: (ev, c) => dropIn(c, [ev.unitId, ev.otherId]),
};

async function dropIn(c: Ctx, ids: string[]) {
  for (const id of ids) {
    c.scene.syncUnit(c.byId(id));
    c.scene.dropIn(id);
  }
  await wait(350);
}

/**
 * Shows the events of the action just applied, in order, then brings every unit in line with the state.
 * `actor` is the unit that acted; returns where it should face when its turn ends.
 */
export async function playEvents(scene: BattleScene, state: BattleState, actor: Unit, facing: Dir): Promise<Dir> {
  const c: Ctx = { scene, actor, facing, byId: id => state.units.find(u => u.id === id)! };
  for (const ev of state.events) await (PLAY[ev.type] as (ev: BattleEvent, c: Ctx) => void | Promise<void>)(ev, c);
  for (const u of state.units) scene.syncUnit(u);
  return c.facing;
}
