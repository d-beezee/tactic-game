// A battle against the AI or another player, from deploy to payout: what the server replays and pays.
import { planTurn } from './ai';
import { activeUnit, apply, createBattle, type BattleState, type Goal } from './battle';
import { key, samePos, type MapData, type Pos, type Team } from './map';
import { testEnemies } from './missions';
import { PlayerError, type Player } from './player';
import { applyBattleXp, classLevel, raceOf, type RosterUnit } from './roster';
import { createUnit, type Unit } from './units';

const PLAYER = 'A';
/** In PvP every unit fights at this class level; passive and equipment stay. */
export const PVP_LEVEL = 5;

/**
 * A team's deployed units. `deploy` is untrusted: [{ id, pos }], each roster unit at most once, on the team's spawn cells,
 * 1 to maxDeploy of them. `level` overrides class levels (PvP); `idPrefix` keeps unit ids apart when both teams are rosters.
 */
export function deployTeam(roster: RosterUnit[], map: MapData, deploy: unknown, team: Team, opts: { level?: number; idPrefix?: string } = {}): Unit[] {
  if (!Array.isArray(deploy) || deploy.length < 1 || deploy.length > map.maxDeploy) throw new PlayerError('Schieramento non valido');
  const units = deploy.map((d: { id?: unknown; pos?: Pos }) => {
    const r = roster.find(u => u.id === d?.id);
    const pos = d?.pos;
    if (!r || !Number.isInteger(pos?.x) || !Number.isInteger(pos?.y) || !map.spawns[team].some(s => samePos(s, pos!))) throw new PlayerError('Schieramento non valido');
    return createUnit(`${opts.idPrefix ?? ''}${r.id}`, r.name, team, r.classId, { x: pos!.x, y: pos!.y }, team === 'A' ? 'S' : 'N',
      { level: opts.level ?? classLevel(r, r.classId), passive: r.passive, equip: r.equip, raceId: raceOf(r) });
  });
  if (new Set(units.map(u => u.id)).size !== units.length || new Set(units.map(u => key(u.pos))).size !== units.length) throw new PlayerError('Schieramento non valido');
  return units;
}

/** Starting units of a battle against the AI: the player's deployed units plus the enemies (a mission's, or the test battle's). */
export function deployBattle(roster: RosterUnit[], map: MapData, deploy: unknown, enemies = testEnemies(roster, map)): Unit[] {
  const units = [...deployTeam(roster, map, deploy, PLAYER), ...enemies];
  createBattle(map, units, 0); // checks cells and deploy count
  return units;
}

/**
 * Plays a battle against the AI (test, mission or chapter) to its end: `actions` are the player's, in order; enemy turns come from the AI, as on the client.
 * Throws PlayerError if an action is illegal or the list stops before the battle is decided.
 */
export function replayBattle(map: MapData, units: Unit[], seed: number, actions: unknown, goal?: Goal, protect?: string[]): BattleState {
  if (!Array.isArray(actions)) throw new PlayerError('Azioni non valide');
  let s = createBattle(map, units, seed, goal, protect);
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

/** Pays a won battle: XP to the class each unit fought as, plus `gold`. Daily missions and first campaign wins pay; test battles never do. */
export function payBattle(p: Player, units: Unit[], end: BattleState, gold: number) {
  const used = units.filter(u => u.team === PLAYER).map(u => ({ id: u.id, classId: u.classId }));
  const { roster, report } = applyBattleXp(p.roster, used, end.xp);
  return { player: { ...p, roster, gold: p.gold + gold }, report, gold };
}
