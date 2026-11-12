import { createBattle, type Goal } from './battle';
import { isWalkable, key, samePos, type MapData } from './map';
import { PlayerError } from './player';
import { allowedRaces, DEFAULT_RACE, RACES } from './races';
import { DEFAULT_ROSTER, parseRoster, xpToReach, type RosterUnit } from './roster';
import { deployTeam, MAX_MISSION_GOLD, missionUnits, parseMissionEnemies, type MissionEnemy } from './testBattle';
import type { Unit } from './units';
import prologueMap from './campaign/prologue.json';
import crowsMap from './campaign/crows.json';
import bridgeMap from './campaign/bridge.json';
import towerMap from './campaign/tower.json';

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
  /** enemy i becomes unit `enemy${i}` */
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

const e = (classId: string, level: number, x: number, y: number, name?: string): MissionEnemy => ({ classId, level, pos: { x, y }, ...(name ? { name } : {}) });

/** The chapters as they shipped in code; the migration copies them into the DB once. Never change: it already ran in production. */
export const CAMPAIGN_SEED: Chapter[] = [
  {
    id: 'prologue', label: 'Prologo', title: 'Turno tuo, turno mio',
    blurb: 'Novembre 1996. Due fratelli, un computer, un gioco per un giocatore solo.',
    mapId: 'camp-prologue', map: prologueMap as MapData,
    enemies: [e('warrior', 1, 4, 7), e('archer', 1, 6, 7)],
    goal: { type: 'rout' }, required: [], gold: 100, crt: true,
    unlock: { id: 'teo', name: 'Teo', classId: 'warrior', xp: { warrior: xpToReach(3) }, passive: null },
    before: [
      { scene: 'bedroom', text: 'Novembre 1996. Mezzanotte meno tredici. Fuori piove da tre giorni.' },
      { scene: 'bedroom', who: 'Nico', text: 'Ancora un tiro, Teo. Uno solo. Il Re Senzavolto è a due caselle.' },
      { scene: 'bedroom', who: 'Teo', text: 'Hai detto "uno solo" quaranta minuti fa. Adesso tocca a me.' },
      { scene: 'bedroom', who: 'Nico', text: 'È un gioco per UN giocatore. C\'è scritto sulla scatola.' },
      { scene: 'bedroom', who: 'Teo', text: 'E la mamma ha detto che il computer è di tutti e due. Un\'unità a testa, come sempre.' },
      { scene: 'bedroom', who: 'Nico', text: 'Va bene. Ma se perdi, il salvataggio lo tengo io.' },
      { scene: 'crt', text: 'CRONACHE DI VALDOMBRA. Livello 1: il guado.' },
      { scene: 'crt', who: 'Teo', text: 'Brando davanti, Lia dietro. Oris cura chi resta indietro.' },
      { scene: 'crt', who: 'Nico', text: 'Lo so come si gioca. Muoviti.' },
    ],
    after: [
      { scene: 'crt', text: 'VITTORIA.' },
      { scene: 'crt', who: 'Teo', text: 'Visto? Neanche un\'unità persa.' },
      { scene: 'crt', who: 'Nico', text: 'Fortuna. Dammi il mouse. Il Re lo batto io. Da solo, tutti i turni miei.' },
      { scene: 'bedroom', fx: 'shake', text: 'Un tuono. La lampada sfarfalla. Il modem, spento, comincia a fischiare.' },
      { scene: 'crt', fx: 'glitch', who: '???', text: 'GIOCATORE 2 RILEVATO. VUOI GIOCARE TUTTI I TURNI?' },
      { scene: 'crt', who: 'Nico', text: '…Sì.' },
      { scene: 'crt', who: 'Teo', text: 'Nico, non toccare niente! Lo schermo… si sta piegando.' },
      { scene: 'crt', fx: 'suck', text: 'Lo schermo si apre come una bocca. Il pavimento diventa luce.' },
      { scene: 'black', fx: 'flash', who: 'Teo', text: 'NICO!' },
    ],
  },
  {
    id: 'crows', label: 'Capitolo 1', title: 'Il campo dei corvi',
    blurb: 'Teo si sveglia dentro il gioco. E il gioco è vero.',
    mapId: 'camp-crows', map: crowsMap as MapData,
    enemies: [
      e('warrior', 2, 2, 11), e('warrior', 2, 5, 11), e('archer', 2, 8, 11), e('cleric', 2, 11, 11),
      e('warrior', 1, 0, 3), e('archer', 1, 11, 0),
    ],
    goal: { type: 'survive', rounds: 5 }, required: ['teo'], gold: 150,
    unlock: { id: 'fiora', name: 'Fiora', classId: 'cleric', xp: { cleric: xpToReach(3) }, passive: null },
    before: [
      { scene: 'black', text: 'Odore d\'erba bagnata. Niente moquette. Niente computer.' },
      { scene: 'map', who: 'Teo', text: 'Questo è il campo del primo livello. Ma è vero. Ed è enorme.' },
      { scene: 'map', who: 'Lia', text: 'Brando, guarda. Uno sconosciuto che tiene la spada al contrario.' },
      { scene: 'map', who: 'Brando', text: 'Vestiti strani, faccia da nuovo arrivato. Sai combattere, ragazzo?' },
      { scene: 'map', who: 'Teo', text: 'Io vi conosco! Brando sta sempre in prima fila. Lia non sbaglia mai un tiro.' },
      { scene: 'map', who: 'Lia', text: 'Ci conosce. Questo non mi piace per niente.' },
      { scene: 'map', who: 'Teo', text: 'Avete visto mio fratello? Quattordici anni, più alto di me, sempre arrabbiato.' },
      { scene: 'map', fx: 'shake', who: 'Brando', text: 'Abbiamo visto solo i corvi del Re. E stanno arrivando.' },
      { scene: 'map', who: 'Lia', text: 'Sono troppi. Teniamo la collina per cinque round, poi arrivano quelli del villaggio. E il ragazzo non deve cadere.' },
    ],
    after: [
      { scene: 'map', who: 'Brando', text: 'Le gambe reggono, ragazzo? Per uno nuovo, niente male.' },
      { scene: 'map', who: 'Fiora', text: 'Ho visto tutto dal mulino. Sono Fiora: curo le ferite e faccio domande. Tu da dove vieni?' },
      { scene: 'map', who: 'Teo', text: 'Da una cameretta. Con un computer. È difficile da spiegare.' },
      { scene: 'map', who: 'Fiora', text: 'Spiegamelo camminando. In paese dicono che il Re Senzavolto ha un nuovo campione. Un ragazzo che non aspetta mai il suo turno.' },
      { scene: 'map', who: 'Teo', text: '…Nico.' },
    ],
  },
  {
    id: 'bridge', label: 'Capitolo 2', title: 'Il ponte',
    blurb: 'Una sola strada per la torre. Non serve vincere: serve passare.',
    mapId: 'camp-bridge', map: bridgeMap as MapData,
    enemies: [
      e('warrior', 2, 4, 8), e('warrior', 2, 5, 8), e('archer', 2, 8, 8),
      e('cleric', 2, 5, 10),
    ],
    goal: { type: 'reach', cells: [{ x: 4, y: 11 }, { x: 5, y: 11 }] }, required: ['teo'], gold: 200,
    unlock: { id: 'bastian', name: 'Bastian', classId: 'ranger', xp: { archer: xpToReach(4), warrior: xpToReach(2) }, passive: null },
    before: [
      { scene: 'map', text: 'Il ponte di Valdombra. L\'unica strada per la torre del Re.' },
      { scene: 'map', who: 'Lia', text: 'Sull\'altra sponda ci sono più arcieri che sassi.' },
      { scene: 'map', who: 'Teo', text: 'Nel gioco questo livello lo saltavamo sempre. Nico conosceva un trucco.' },
      { scene: 'map', who: 'Brando', text: 'Qui non ci sono trucchi. Solo un ponte e gente che non vuole farci passare.' },
      { scene: 'map', who: 'Fiora', text: 'Non serve batterli tutti. Basta che uno di noi arrivi sulle pietre in fondo, e il passaggio è nostro.' },
      { scene: 'map', who: 'Teo', text: 'Ci arriviamo. Nico, sto arrivando.' },
    ],
    after: [
      { scene: 'map', who: 'Bastian', text: 'Fermi, non tirate! Sono Bastian, il guardiano del ponte. L\'ex guardiano.' },
      { scene: 'map', who: 'Bastian', text: 'Il campione del Re è passato di qui ieri. Ha guardato i soldati muoversi uno alla volta e si è messo a ridere.' },
      { scene: 'map', who: 'Bastian', text: 'Ha detto: "Che spreco. Io li muovo tutti insieme." E loro si sono mossi. Tutti insieme.' },
      { scene: 'map', who: 'Teo', text: 'Non si può. Nel gioco si va a turno. Sempre.' },
      { scene: 'map', who: 'Bastian', text: 'Nel gioco, forse. Qui comanda chi ha la corona. Vengo con voi: conosco la strada per la torre.' },
    ],
  },
  {
    id: 'tower', label: 'Capitolo 3', title: 'La torre',
    blurb: 'Il Guardiano tiene la porta. Finché sta in piedi, la torre resta chiusa.',
    mapId: 'camp-tower', map: towerMap as MapData,
    enemies: [
      e('paladin', 4, 4, 8, 'Il Guardiano'), e('archer', 2, 8, 6),
      e('warrior', 2, 3, 5), e('sage', 2, 5, 9),
    ],
    goal: { type: 'boss', unitId: 'enemy0' }, required: ['teo'], gold: 300,
    unlock: { id: 'sibilla', name: 'Sibilla', classId: 'sage', xp: { cleric: xpToReach(4), archer: xpToReach(2) }, passive: null },
    before: [
      { scene: 'map', text: 'La torre del Re Senzavolto. Ogni gradino è più alto del precedente.' },
      { scene: 'map', who: 'Bastian', text: 'Il Guardiano tiene la porta. Finché sta in piedi, la torre non si apre.' },
      { scene: 'map', who: 'Lia', text: 'E tutti gli altri?' },
      { scene: 'map', who: 'Bastian', text: 'Gli altri sono un problema. Il Guardiano è IL problema.' },
      { scene: 'map', who: 'Brando', text: 'Quindi si punta al grosso, e il resto lo teniamo a bada.' },
      { scene: 'map', who: 'Teo', text: 'È come il livello finale. Lo conosco a memoria.' },
      { scene: 'map', who: 'Fiora', text: 'Allora, ragazzo della cameretta, dicci dove colpire.' },
    ],
    after: [
      { scene: 'map', text: 'Il Guardiano cade. Le porte si aprono con un suono che Teo conosce bene: la musichetta di fine livello.' },
      { scene: 'map', who: 'Sibilla', text: 'Finalmente. Sono Sibilla. Il Re mi teneva qui perché leggo le stelle, e le stelle dicevano: arriverà un fratello.' },
      { scene: 'map', fx: 'flash', who: '???', text: 'Un fratello. Che carino.' },
      { scene: 'map', text: 'In cima alla scala non c\'è il Re Senzavolto. C\'è un ragazzo di quattordici anni, con una corona troppo grande.' },
      { scene: 'map', who: 'Teo', text: 'Nico! Andiamo a casa. La mamma…' },
      { scene: 'map', who: 'Nico', text: 'Casa? A casa aspettavo e basta. Il tuo turno, il mio turno, il turno per la doccia, il turno per dormire.' },
      { scene: 'map', who: 'Nico', text: 'Qui la corona dice che i turni sono miei. Tutti.' },
      { scene: 'map', who: 'Teo', text: 'Non è così che si gioca.' },
      { scene: 'map', fx: 'glitch', who: 'Nico', text: 'Allora vieni a prendermi, fratellino. Ti aspetto in cima. Ma tocca a me.' },
      { scene: 'black', text: 'Fine del capitolo 3. Continua…' },
    ],
  },
];

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
    const who = l.who === undefined ? '' : text(l.who, `${n}, chi parla`, 20, 0);
    return { scene: l.scene!, ...(who ? { who } : {}), text: text(l.text, n, 200), ...(l.fx ? { fx: l.fx } : {}) };
  });
}

function parseGoal(map: MapData, enemies: MissionEnemy[], g: Partial<Goal> | undefined): Goal {
  const v = g as Record<string, unknown> | undefined;
  switch (v?.type) {
    case 'rout': return { type: 'rout' };
    case 'survive':
      if (!Number.isInteger(v.rounds) || (v.rounds as number) < 1 || (v.rounds as number) > 30) throw new PlayerError('Obiettivo: i round vanno da 1 a 30');
      return { type: 'survive', rounds: v.rounds as number };
    case 'reach': {
      const cells = v.cells;
      if (!Array.isArray(cells) || cells.length < 1 || cells.length > 12) throw new PlayerError('Obiettivo: servono da 1 a 12 caselle da raggiungere');
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
      const i = typeof v.unitId === 'string' ? Number(/^enemy(\d+)$/.exec(v.unitId)?.[1]) : NaN;
      if (!(i >= 0 && i < enemies.length)) throw new PlayerError('Obiettivo: scegli un nemico come boss');
      return { type: 'boss', unitId: `enemy${i}` };
    }
    default: throw new PlayerError('Obiettivo non valido');
  }
}

/** Untrusted chapter from the admin, checked against its map. Throws PlayerError with the first problem. */
export function parseChapter(map: MapData, data: unknown): ChapterInput {
  const d = (data ?? {}) as Record<string, unknown>;
  if (!Number.isInteger(d.gold) || (d.gold as number) < 0 || (d.gold as number) > MAX_MISSION_GOLD) throw new PlayerError(`L'oro deve essere un intero tra 0 e ${MAX_MISSION_GOLD}`);
  if (d.crt !== undefined && typeof d.crt !== 'boolean') throw new PlayerError('Richiesta non valida');
  if (!Array.isArray(d.required) || d.required.length > 12 || !d.required.every(id => typeof id === 'string')) throw new PlayerError('Unità obbligatorie non valide');
  const enemies = parseMissionEnemies(map, d.enemies).map((e, i) => {
    const name = (d.enemies as MissionEnemy[])[i].name === undefined ? '' : text((d.enemies as MissionEnemy[])[i].name, `Nemico ${i + 1}, nome`, 20, 0);
    return name ? { ...e, name } : e;
  });
  let unlock: ChapterInput['unlock'] = null;
  if (d.unlock !== null && d.unlock !== undefined) {
    const u = d.unlock as Partial<RosterUnit>;
    const name = text(u.name, 'Alleato, nome', 20);
    const raceId = u.raceId ?? DEFAULT_RACE;
    if (typeof raceId !== 'string' || !Object.hasOwn(RACES, raceId)) throw new PlayerError('Alleato: razza non valida');
    if (!allowedRaces(String(u.classId)).includes(raceId)) throw new PlayerError('Alleato: classe non adatta alla razza');
    const [r] = parseRoster([{ id: 'x', name, raceId, classId: u.classId, xp: u.xp, passive: null }]) ?? [];
    if (!r) throw new PlayerError('Alleato: classe o XP non validi');
    unlock = { name, ...(r.raceId && r.raceId !== DEFAULT_RACE ? { raceId: r.raceId } : {}), classId: r.classId, xp: r.xp, passive: null };
  }
  return {
    label: text(d.label, 'Etichetta', 30), title: text(d.title, 'Titolo', 60), blurb: text(d.blurb, 'Descrizione', 160),
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
