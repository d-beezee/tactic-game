import { planTurn } from './ai';
import { activeUnit, apply, createBattle, type BattleState, type Goal } from './battle';
import { CLASSES } from './classes';
import { isWalkable, key, samePos, type MapData, type Pos, type Team } from './map';
import { PlayerError, type Player } from './player';
import { allowedRaces, DEFAULT_RACE, RACES } from './races';
import { applyBattleXp, classLevel, raceOf, type RosterUnit } from './roster';
import { createUnit, MAX_CLASS_LEVEL, type Unit } from './units';

const ENEMY_CLASSES = ['warrior', 'archer', 'cleric'];
const ENEMY_NAMES = ['Grosk', 'Vespa', 'Mordo', 'Ruggine', 'Sterpo', 'Nebbia', 'Ghigno', 'Corvo'];
const PLAYER = 'A';

/** AI team that fills the enemy spawns, at the roster's average active-class level so the fight keeps up as units grow. */
export function testEnemies(roster: RosterUnit[], map: MapData): Unit[] {
  const level = Math.round(roster.reduce((sum, r) => sum + classLevel(r, r.classId), 0) / roster.length);
  return map.spawns.B.slice(0, map.maxDeploy).map((p, i) =>
    createUnit(`enemy${i}`, ENEMY_NAMES[i % ENEMY_NAMES.length], 'B', ENEMY_CLASSES[i % ENEMY_CLASSES.length], p, 'N', level));
}

/** An enemy a daily mission places on its map. */
export interface MissionEnemy { classId: string; /** DEFAULT_RACE if missing */ raceId?: string; level: number; pos: Pos; /** campaign only: a named enemy, e.g. a boss */ name?: string }
export const MAX_MISSION_ENEMIES = 12;

/** Untrusted enemy list of a mission, checked against its map. Throws PlayerError with the first problem. */
export function parseMissionEnemies(map: MapData, data: unknown): MissionEnemy[] {
  if (!Array.isArray(data) || data.length < 1 || data.length > MAX_MISSION_ENEMIES) throw new PlayerError(`Servono da 1 a ${MAX_MISSION_ENEMIES} nemici`);
  const seen = new Set<string>();
  return data.map((e: Partial<MissionEnemy>, i) => {
    const pos = e?.pos, n = i + 1;
    if (typeof e?.classId !== 'string' || !Object.hasOwn(CLASSES, e.classId)) throw new PlayerError(`Nemico ${n}: classe non valida`);
    if (e.raceId !== undefined && (typeof e.raceId !== 'string' || !Object.hasOwn(RACES, e.raceId))) throw new PlayerError(`Nemico ${n}: razza non valida`);
    if (!allowedRaces(e.classId).includes(e.raceId ?? DEFAULT_RACE)) throw new PlayerError(`Nemico ${n}: ${CLASSES[e.classId].name} non è per la razza ${RACES[e.raceId ?? DEFAULT_RACE].name}`);
    if (!Number.isInteger(e.level) || e.level! < 1 || e.level! > MAX_CLASS_LEVEL) throw new PlayerError(`Nemico ${n}: il livello va da 1 a ${MAX_CLASS_LEVEL}`);
    if (!Number.isInteger(pos?.x) || !Number.isInteger(pos?.y) || !isWalkable(map, pos!)) throw new PlayerError(`Nemico ${n}: casella non calpestabile`);
    if (map.spawns.A.some(s => samePos(s, pos!))) throw new PlayerError(`Nemico ${n}: è su una partenza del giocatore`);
    if (seen.has(key(pos!))) throw new PlayerError(`Nemico ${n}: casella già occupata`);
    seen.add(key(pos!));
    return { classId: e.classId, ...(e.raceId ? { raceId: e.raceId } : {}), level: e.level!, pos: { x: pos!.x, y: pos!.y } };
  });
}

/** Battle units for a mission's enemies. */
export const missionUnits = (enemies: MissionEnemy[]): Unit[] => enemies.map((e, i) =>
  createUnit(`enemy${i}`, e.name ?? ENEMY_NAMES[i % ENEMY_NAMES.length], 'B', e.classId, e.pos, 'N', e.level, null, {}, e.raceId));

/** A unit a daily mission adds to the roster on its first win. */
export interface Recruit { name: string; raceId: string; classId: string }

/** Untrusted recruit of a mission: null, or a name and a base class the race can take. Throws PlayerError. */
export function parseRecruit(data: unknown): Recruit | null {
  if (data === null || data === undefined) return null;
  const d = data as Partial<Recruit>;
  const name = typeof d.name === 'string' ? d.name.trim() : '';
  if (!name || name.length > 20) throw new PlayerError('Recluta: il nome deve avere tra 1 e 20 caratteri');
  if (typeof d.raceId !== 'string' || !Object.hasOwn(RACES, d.raceId)) throw new PlayerError('Recluta: razza non valida');
  if (typeof d.classId !== 'string' || !Object.hasOwn(CLASSES, d.classId) || CLASSES[d.classId].requires || !allowedRaces(d.classId).includes(d.raceId))
    throw new PlayerError('Recluta: serve una classe base adatta alla razza');
  return { name, raceId: d.raceId, classId: d.classId };
}

/** Adds a mission's recruit to the roster, once: its id comes from the mission. */
export function addRecruit(p: Player, missionId: string, r: Recruit | null): { player: Player; unlocked: string | null } {
  const id = `m-${missionId}`;
  if (!r || p.roster.some(u => u.id === id)) return { player: p, unlocked: null };
  return { player: { ...p, roster: [...p.roster, { id, name: r.name, raceId: r.raceId, classId: r.classId, xp: {}, passive: null }] }, unlocked: r.name };
}

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
      opts.level ?? classLevel(r, r.classId), r.passive, r.equip, raceOf(r));
  });
  if (new Set(units.map(u => u.id)).size !== units.length || new Set(units.map(u => key(u.pos))).size !== units.length) throw new PlayerError('Schieramento non valido');
  return units;
}

/** Starting units of a battle against the AI: the player's deployed units plus the enemies (a mission's, or the test battle's). */
export function deployTestBattle(roster: RosterUnit[], map: MapData, deploy: unknown, enemies = testEnemies(roster, map)): Unit[] {
  const units = [...deployTeam(roster, map, deploy, PLAYER), ...enemies];
  createBattle(map, units, 0); // checks cells and deploy count
  return units;
}

/**
 * Plays a test battle to its end: `actions` are the player's, in order; enemy turns come from the AI, as on the client.
 * Throws PlayerError if an action is illegal or the list stops before the battle is decided.
 */
export function replayTestBattle(map: MapData, units: Unit[], seed: number, actions: unknown, goal?: Goal, protect?: string[]): BattleState {
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
