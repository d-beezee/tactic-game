import { CLASSES, type ClassId } from './classes';
import { isWalkable, key, samePos, type MapData, type Pos } from './map';
import { PlayerError, type Player } from './player';
import { allowedRaces, DEFAULT_RACE, RACES } from './races';
import { classLevel, type RosterUnit } from './roster';
import { createUnit, MAX_CLASS_LEVEL, type Unit } from './units';

/** Battle unit id of the i-th enemy of a mission, chapter or test battle. */
export const enemyId = (i: number) => `enemy${i}`;
/** Index of an enemy from its unit id, or NaN. */
export const enemyIndex = (id: unknown) => (typeof id === 'string' ? Number(/^enemy(\d+)$/.exec(id)?.[1]) : NaN);
/** Roster id of a mission's recruit: one per mission, so it joins only once. */
export const recruitId = (missionId: string) => `m-${missionId}`;

/** Classes default enemies cycle through: the test battle's, and a new mission's in the workshop. */
export const ENEMY_CLASSES: ClassId[] = ['warrior', 'archer', 'cleric'];
const ENEMY_NAMES = ['Grosk', 'Vespa', 'Mordo', 'Ruggine', 'Sterpo', 'Nebbia', 'Ghigno', 'Corvo'];

/** AI team that fills the enemy spawns, at the roster's average active-class level so the fight keeps up as units grow. */
export function testEnemies(roster: RosterUnit[], map: MapData): Unit[] {
  const level = Math.round(roster.reduce((sum, r) => sum + classLevel(r, r.classId), 0) / roster.length);
  return map.spawns.B.slice(0, map.maxDeploy).map((p, i) =>
    createUnit(enemyId(i), ENEMY_NAMES[i % ENEMY_NAMES.length], 'B', ENEMY_CLASSES[i % ENEMY_CLASSES.length], p, 'N', { level }));
}

/** An enemy a daily mission places on its map. */
export interface MissionEnemy { classId: string; /** DEFAULT_RACE if missing */ raceId?: string; level: number; pos: Pos; /** campaign only: a named enemy, e.g. a boss */ name?: string }
export const MAX_MISSION_ENEMIES = 12;
export const MAX_MISSION_GOLD = 10_000;
/** Text lengths and counts the server enforces; the workshop's forms use the same numbers. */
export const LIMITS = { unitName: 20, name: 60, label: 30, blurb: 160, line: 200, rounds: 30, cells: 12, required: 12, trackCode: 20_000 } as const;

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
  createUnit(enemyId(i), e.name ?? ENEMY_NAMES[i % ENEMY_NAMES.length], 'B', e.classId, e.pos, 'N', { level: e.level, raceId: e.raceId }));

/** A unit a daily mission adds to the roster on its first win. */
export interface Recruit { name: string; raceId: string; classId: string }

/** Untrusted recruit of a mission: null, or a name and a base class the race can take. Throws PlayerError. */
export function parseRecruit(data: unknown): Recruit | null {
  if (data === null || data === undefined) return null;
  const d = data as Partial<Recruit>;
  const name = typeof d.name === 'string' ? d.name.trim() : '';
  if (!name || name.length > LIMITS.unitName) throw new PlayerError(`Recluta: il nome deve avere tra 1 e ${LIMITS.unitName} caratteri`);
  if (typeof d.raceId !== 'string' || !Object.hasOwn(RACES, d.raceId)) throw new PlayerError('Recluta: razza non valida');
  if (typeof d.classId !== 'string' || !Object.hasOwn(CLASSES, d.classId) || CLASSES[d.classId].requires || !allowedRaces(d.classId).includes(d.raceId))
    throw new PlayerError('Recluta: serve una classe base adatta alla razza');
  return { name, raceId: d.raceId, classId: d.classId };
}

/** Adds a unit to the roster unless one with its id is already there (or there is none). `unlocked`: its name when it joined. */
export function joinRoster(p: Player, unit: RosterUnit | null | undefined): { player: Player; unlocked: string | null } {
  if (!unit || p.roster.some(u => u.id === unit.id)) return { player: p, unlocked: null };
  return { player: { ...p, roster: [...p.roster, unit] }, unlocked: unit.name };
}

/** Adds a mission's recruit to the roster, once: its id comes from the mission. */
export const addRecruit = (p: Player, missionId: string, r: Recruit | null) =>
  joinRoster(p, r && { id: recruitId(missionId), name: r.name, raceId: r.raceId, classId: r.classId, xp: {}, passive: null });
