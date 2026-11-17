import { createBattle, type Goal } from './battle';
import { isWalkable, key, samePos, type MapData } from './map';
import { PlayerError } from './player';
import { allowedRaces, DEFAULT_RACE, RACES } from './races';
import { DEFAULT_ROSTER, parseRoster, type RosterUnit } from './roster';
import { enemyId, enemyIndex, LIMITS, MAX_MISSION_GOLD, missionUnits, parseMissionEnemies, type MissionEnemy } from './missions';
import type { Unit } from './units';
import { deployTeam } from './match';

/** Backdrop of a cutscene line: drawn scenes of the 1996 bedroom, or the chapter's own map. */
export type Scene = 'bedroom' | 'crt' | 'map' | 'black';
export type Fx = 'glitch' | 'suck' | 'flash' | 'shake';
/** One line of a cutscene. Without `who` it is narration. */
export interface Line { scene: Scene; who?: string; text: string; fx?: Fx }

export const SCENES: Scene[] = ['bedroom', 'crt', 'map', 'black'];
export const FXS: Fx[] = ['glitch', 'suck', 'flash', 'shake'];

export interface Chapter {
  id: string;
  mapId: string;
  /** "Prologo", "Capitolo 1"… */
  label: string;
  title: string;
  /** one line for the chapter list */
  blurb: string;
  map: MapData;
  /** enemy i becomes unit enemyId(i) */
  enemies: MissionEnemy[];
  goal: Goal;
  /** roster ids that must be deployed; if one falls the battle is lost */
  required: string[];
  /** paid with the class XP on the first win only */
  gold: number;
  /** joins the roster on the first win */
  unlock?: RosterUnit | null;
  /** the battle is played inside the bedroom's monitor, the two brothers taking turns */
  crt?: boolean;
  before: Line[];
  after: Line[];
}

/** A chapter is open once the one before it, in `order` (chapter ids), is won. */
export function chapterOpen(order: string[], cleared: string[], id: string): boolean {
  const i = order.indexOf(id);
  return i === 0 || (i > 0 && cleared.includes(order[i - 1]));
}

/** Starting units of a chapter battle. `deploy` is untrusted; required units must be in it. Throws PlayerError. */
export function chapterUnits(roster: RosterUnit[], ch: Chapter, deploy: unknown): Unit[] {
  const team = deployTeam(roster, ch.map, deploy, 'A');
  for (const id of ch.required)
    if (!team.some(u => u.id === id)) throw new PlayerError(`${roster.find(r => r.id === id)?.name ?? id} deve combattere`);
  const units = [...team, ...missionUnits(ch.enemies)];
  createBattle(ch.map, units, 0, ch.goal, ch.required); // checks cells, deploy count and goal
  return units;
}

/** What an admin sends for a chapter: everything but its id and map, the unlock without its id. */
export type ChapterInput = Omit<Chapter, 'id' | 'mapId' | 'map' | 'unlock'> & { unlock: Omit<RosterUnit, 'id'> | null };

const MAX_LINES = 60;
const text = (v: unknown, what: string, max: number, min = 1) => {
  const t = typeof v === 'string' ? v.trim() : '';
  if (t.length < min || t.length > max) throw new PlayerError(min ? `${what}: da ${min} a ${max} caratteri` : `${what}: al massimo ${max} caratteri`);
  return t;
};

function parseLines(data: unknown, what: string): Line[] {
  if (!Array.isArray(data) || data.length > MAX_LINES) throw new PlayerError(`${what}: al massimo ${MAX_LINES} battute`);
  return data.map((l: Partial<Line>, i) => {
    const n = `${what}, battuta ${i + 1}`;
    if (!SCENES.includes(l?.scene as Scene)) throw new PlayerError(`${n}: scena non valida`);
    if (l.fx !== undefined && !FXS.includes(l.fx)) throw new PlayerError(`${n}: effetto non valido`);
    const who = l.who === undefined ? '' : text(l.who, `${n}, chi parla`, LIMITS.unitName, 0);
    return { scene: l.scene!, ...(who ? { who } : {}), text: text(l.text, n, LIMITS.line), ...(l.fx ? { fx: l.fx } : {}) };
  });
}

function parseGoal(map: MapData, enemies: MissionEnemy[], g: Partial<Goal> | undefined): Goal {
  const v = g as Record<string, unknown> | undefined;
  switch (v?.type) {
    case 'rout': return { type: 'rout' };
    case 'survive':
      if (!Number.isInteger(v.rounds) || (v.rounds as number) < 1 || (v.rounds as number) > LIMITS.rounds) throw new PlayerError(`Obiettivo: i round vanno da 1 a ${LIMITS.rounds}`);
      return { type: 'survive', rounds: v.rounds as number };
    case 'reach': {
      const cells = v.cells;
      if (!Array.isArray(cells) || cells.length < 1 || cells.length > LIMITS.cells) throw new PlayerError(`Obiettivo: servono da 1 a ${LIMITS.cells} caselle da raggiungere`);
      const seen = new Set<string>();
      return {
        type: 'reach', cells: cells.map(c => {
          if (!Number.isInteger(c?.x) || !Number.isInteger(c?.y) || !isWalkable(map, c)) throw new PlayerError('Obiettivo: casella da raggiungere non calpestabile');
          if (map.spawns.A.some(s => samePos(s, c)) || seen.has(key(c))) throw new PlayerError('Obiettivo: casella da raggiungere non valida');
          seen.add(key(c));
          return { x: c.x, y: c.y };
        }),
      };
    }
    case 'boss': {
      const i = enemyIndex(v.unitId);
      if (!(i >= 0 && i < enemies.length)) throw new PlayerError('Obiettivo: scegli un nemico come boss');
      return { type: 'boss', unitId: enemyId(i) };
    }
    default: throw new PlayerError('Obiettivo non valido');
  }
}

/** Untrusted chapter from the admin, checked against its map. Throws PlayerError with the first problem. */
export function parseChapter(map: MapData, data: unknown): ChapterInput {
  const d = (data ?? {}) as Record<string, unknown>;
  if (!Number.isInteger(d.gold) || (d.gold as number) < 0 || (d.gold as number) > MAX_MISSION_GOLD) throw new PlayerError(`L'oro deve essere un intero tra 0 e ${MAX_MISSION_GOLD}`);
  if (d.crt !== undefined && typeof d.crt !== 'boolean') throw new PlayerError('Richiesta non valida');
  if (!Array.isArray(d.required) || d.required.length > LIMITS.required || !d.required.every(id => typeof id === 'string')) throw new PlayerError('Unità obbligatorie non valide');
  const enemies = parseMissionEnemies(map, d.enemies).map((e, i) => {
    const name = (d.enemies as MissionEnemy[])[i].name === undefined ? '' : text((d.enemies as MissionEnemy[])[i].name, `Nemico ${i + 1}, nome`, LIMITS.unitName, 0);
    return name ? { ...e, name } : e;
  });
  let unlock: ChapterInput['unlock'] = null;
  if (d.unlock !== null && d.unlock !== undefined) {
    const u = d.unlock as Partial<RosterUnit>;
    const name = text(u.name, 'Alleato, nome', LIMITS.unitName);
    const raceId = u.raceId ?? DEFAULT_RACE;
    if (typeof raceId !== 'string' || !Object.hasOwn(RACES, raceId)) throw new PlayerError('Alleato: razza non valida');
    if (!allowedRaces(String(u.classId)).includes(raceId)) throw new PlayerError('Alleato: classe non adatta alla razza');
    const [r] = parseRoster([{ id: 'x', name, raceId, classId: u.classId, xp: u.xp, passive: null }]) ?? [];
    if (!r) throw new PlayerError('Alleato: classe o XP non validi');
    unlock = { name, ...(r.raceId && r.raceId !== DEFAULT_RACE ? { raceId: r.raceId } : {}), classId: r.classId, xp: r.xp, passive: null };
  }
  return {
    label: text(d.label, 'Etichetta', LIMITS.label), title: text(d.title, 'Titolo', LIMITS.name), blurb: text(d.blurb, 'Descrizione', LIMITS.blurb),
    enemies, goal: parseGoal(map, enemies, d.goal as Goal), required: [...new Set(d.required as string[])],
    gold: d.gold as number, unlock, crt: d.crt === true, before: parseLines(d.before, 'Prima'), after: parseLines(d.after, 'Dopo'),
  };
}

/** Problems of the whole campaign in this order: a required unit must be in the starting roster or unlocked by an earlier chapter. */
export function campaignErrors(chapters: Pick<Chapter, 'title' | 'required' | 'unlock'>[]): string[] {
  const owned = new Set(DEFAULT_ROSTER.map(r => r.id)), errors: string[] = [];
  const name = (id: string) => chapters.find(c => c.unlock?.id === id)?.unlock?.name ?? id;
  for (const ch of chapters) {
    for (const id of ch.required) if (!owned.has(id)) errors.push(`«${ch.title}» richiede ${name(id)}, che a quel punto non è ancora sbloccato`);
    if (ch.unlock) {
      if (owned.has(ch.unlock.id)) errors.push(`«${ch.title}» sblocca un'unità già presente`);
      owned.add(ch.unlock.id);
    }
  }
  return errors;
}
