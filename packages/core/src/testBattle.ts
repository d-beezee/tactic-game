import { planTurn } from './ai';
import { activeUnit, apply, createBattle, type BattleState } from './battle';
import { samePos, type MapData, type Pos } from './map';
import { PlayerError, TEST_BATTLE_GOLD, type Player } from './player';
import { applyBattleXp, classLevel, unitFromRoster, type RosterUnit } from './roster';
import { createUnit, type Unit } from './units';

const ENEMY_CLASSES = ['warrior', 'archer', 'cleric'];
const ENEMY_NAMES = ['Grosk', 'Vespa', 'Mordo', 'Ruggine', 'Sterpo', 'Nebbia', 'Ghigno', 'Corvo'];
const PLAYER = 'A';

/** AI team that fills the enemy spawns, at the roster's average active-class level so the fight keeps up as units grow. */
export function testEnemies(roster: RosterUnit[], map: MapData): Unit[] {
  const level = Math.round(roster.reduce((sum, r) => sum + classLevel(r, r.classId), 0) / roster.length);
  return map.spawns.B.slice(0, map.maxDeploy).map((p, i) =>
    createUnit(`enemy${i}`, ENEMY_NAMES[i % ENEMY_NAMES.length], 'B', ENEMY_CLASSES[i % ENEMY_CLASSES.length], p, 'N', level));
}

/**
 * Starting units of a test battle: the player's deployed units plus the enemies.
 * `deploy` is untrusted: [{ id, pos }], each unit of the roster once, on the player's spawn cells.
 */
export function deployTestBattle(roster: RosterUnit[], map: MapData, deploy: unknown): Unit[] {
  if (!Array.isArray(deploy)) throw new PlayerError('Schieramento non valido');
  const team = deploy.map((d: { id?: unknown; pos?: Pos }) => {
    const r = roster.find(u => u.id === d?.id);
    const pos = d?.pos;
    if (!r || !Number.isInteger(pos?.x) || !Number.isInteger(pos?.y) || !map.spawns.A.some(s => samePos(s, pos!))) throw new PlayerError('Schieramento non valido');
    return unitFromRoster(r, PLAYER, { x: pos!.x, y: pos!.y }, 'S');
  });
  if (new Set(team.map(u => u.id)).size !== team.length) throw new PlayerError('Schieramento non valido');
  const units = [...team, ...testEnemies(roster, map)];
  createBattle(map, units, 0); // checks cells and deploy count
  return units;
}

/**
 * Plays a test battle to its end: `actions` are the player's, in order; enemy turns come from the AI, as on the client.
 * Throws PlayerError if an action is illegal or the list stops before the battle is decided.
 */
export function replayTestBattle(map: MapData, units: Unit[], seed: number, actions: unknown): BattleState {
  if (!Array.isArray(actions)) throw new PlayerError('Azioni non valide');
  let s = createBattle(map, units, seed);
  let next = 0;
  while (!s.winner) {
    if (activeUnit(s).team !== PLAYER) {
      for (const a of planTurn(s)) {
        s = apply(s, a);
        if (s.winner) break;
      }
      continue;
    }
    if (next >= actions.length) throw new PlayerError('La battaglia non è conclusa');
    try {
      s = apply(s, actions[next++]);
    } catch {
      // BattleError, or a TypeError from a malformed action
      throw new PlayerError(`Azione ${next} non valida`);
    }
  }
  return s;
}

/** Replays a test battle and pays out: XP to the class each unit fought as, gold on victory. */
export function finishTestBattle(p: Player, map: MapData, units: Unit[], seed: number, actions: unknown) {
  const end = replayTestBattle(map, units, seed, actions);
  const used = units.filter(u => u.team === PLAYER).map(u => ({ id: u.id, classId: u.classId }));
  const { roster, report } = applyBattleXp(p.roster, used, end.xp);
  const won = end.winner === PLAYER;
  const gold = won ? TEST_BATTLE_GOLD : 0;
  return { player: { ...p, roster, gold: p.gold + gold }, report, gold, won };
}
