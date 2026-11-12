// The Officina: the admin's tools (campaign, missions, music, users), kept apart from the player's menu.
// Every editor has the same shape: list on the left, tabs on the right, a save bar at the bottom.
import {
  CLASSES, DEFAULT_RACE, DEFAULT_ROSTER, FXS, MAX_CLASS_LEVEL, MAX_MISSION_ENEMIES, RACES, SCENES, allowedRaces, classLevel, isWalkable, xpToReach,
  type Chapter, type ChapterInput, type Fx, type Goal, type Line, type MapData, type MissionEnemy, type Pos, type RosterUnit,
} from '@tactics/core';
import { api, ApiError, type Account, type Mission, type Music, type User } from './api';
import { allMaps, BUILTIN_MAPS, loadMaps } from './maps';
import { getLibrary, playCode, setLibrary } from './music';
import { el, enemySummary, raceName } from './ui';

export type Tool = 'campaign' | 'missions' | 'music' | 'users';

export interface WorkshopCtx {
  root: HTMLElement;
  player: Account;
  /** back to the player's menu */
  back: () => void;
  /** the session expired */
  auth: () => void;
  mapEditor: () => void;
  /** plays a draft locally, then comes back here */
  rehearse: (ch: Chapter, trackId: string | null) => void;
}

const GOAL_NAMES: Record<Goal['type'], string> = { rout: 'Sconfiggi tutti', survive: 'Sopravvivi', reach: 'Raggiungi le caselle', boss: 'Sconfiggi il boss' };
const GOAL_HINTS: Record<Goal['type'], string> = { rout: 'vince chi resta in piedi', survive: 'resisti per un numero di round', reach: 'porta un\'unità sulle caselle', boss: 'abbatti un nemico preciso' };
const goalText = (g: Goal) => g.type === 'survive' ? `sopravvivi ${g.rounds === 1 ? '1 round' : `${g.rounds} round`}` : GOAL_NAMES[g.type].toLowerCase();
const SCENE_NAMES: Record<Line['scene'], string> = { bedroom: 'Cameretta', crt: 'Monitor', map: 'Mappa', black: 'Nero' };
const FX_NAMES: Record<Fx, string> = { glitch: 'disturbo', suck: 'risucchio', flash: 'lampo', shake: 'scossa' };

/** Base classes a race can start in: what a recruit or an unlocked ally can be. */
const baseClassesOf = (raceId: string) => Object.values(CLASSES).filter(c => !c.requires && allowedRaces(c.id).includes(raceId));
/** Starting enemies for a new mission or chapter: the map's enemy spawns, base classes in turn, level 1. */
const defaultEnemies = (m: MapData): MissionEnemy[] =>
  m.spawns.B.slice(0, m.maxDeploy).map((pos, i) => ({ classId: ['warrior', 'archer', 'cleric'][i % 3], level: 1, pos: { ...pos } }));
const clone = <T>(v: T): T => structuredClone(v);

// ---------- state: outlives redraws, a trip to the game menu and a rehearsal battle; a reload asks first ----------
let ctx: WorkshopCtx;
let tool: Tool = 'campaign';
let missions: Mission[] = [], chapters: Chapter[] = [], users: User[] = [];
let error = '';
/** key of the action waiting for its second tap (delete, role change) */
let pending = '';
/** a change of draft waiting for "discard the unsaved changes?" */
let ask: (() => void) | null = null;
let savedAt = '';
/** on phones the editor replaces the list */
let open = false;
const queries: Partial<Record<Tool, string>> = {};
/** the last enemy placed, reused by the next tap */
const brush = { raceId: DEFAULT_RACE, classId: 'warrior', level: 1 };

/** A draft and the snapshot it started from: it has unsaved changes when they differ. */
interface Edit<T> { d: T; orig: string }
const edit = <T>(d: T, from: unknown = d): Edit<T> => ({ d, orig: JSON.stringify(from) });
const dirty = (e: Edit<unknown> | null) => !!e && JSON.stringify(e.d) !== e.orig;

type MissionDraft = { id: string | null; name: string; mapId: string; gold: number; enemies: MissionEnemy[]; trackId: string | null; recruit: { on: boolean; name: string; raceId: string; classId: string } };
type ChapterDraft = Omit<ChapterInput, 'goal' | 'unlock'> & {
  id: string | null; mapId: string; goalType: Goal['type']; rounds: number; cells: Pos[]; boss: number;
  unlockOn: boolean; unlock: Omit<RosterUnit, 'id'>; unlockLevel: number;
};
type TrackDraft = { id: string | null; name: string; code: string };
let mEdit: Edit<MissionDraft> | null = null, cEdit: Edit<ChapterDraft> | null = null, tEdit: Edit<TrackDraft> | null = null;
let slots: Edit<{ menu: string | null; battle: string | null }> | null = null;
const tabs: Record<'missions' | 'campaign', number> = { missions: 0, campaign: 0 };
/** the cutscene line open for editing, as "before:2" */
let openLine = '';
/** what the preview is playing: a track id, or 'draft' */
let playing: string | null = null;

addEventListener('beforeunload', e => { if ([mEdit, cEdit, tEdit, slots].some(dirty)) e.preventDefault(); });

export function showWorkshop(c: WorkshopCtx, to: Tool = tool) {
  ctx = c;
  void go(to);
}

/** Opens a tool and loads what it shows. Drafts of the other tools stay as they are. */
const go = async (to: Tool) => {
  tool = to;
  error = pending = '';
  ask = null;
  open = false;
  ctx.root.replaceChildren(frame('Officina', [], [el('p', { className: 'hint', textContent: 'Caricamento…' })]));
  try {
    if (to === 'users') users = await api.users();
    else {
      const [m, c, lib] = await Promise.all([api.missions(), api.campaign(), api.music(), loadMaps(true)]);
      [missions, chapters] = [m, c.chapters];
      setLibrary(lib);
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return ctx.auth();
    error = (e as Error).message;
  }
  draw();
};

/** Sends a change, keeps the answer, then redraws with it or with the error. */
const mutate = async <T>(request: Promise<T>, ok: (r: T) => void, saved = true) => {
  try {
    const r = await request;
    error = '';
    ok(r);
    savedAt = saved ? new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return ctx.auth();
    error = (e as Error).message;
  }
  draw();
};

/** Runs `fn`, which replaces the open draft, after asking when that draft has unsaved changes. */
const replace = (current: Edit<unknown> | null, fn: () => void) => {
  if (!dirty(current)) return fn();
  ask = fn;
  draw();
};

let barShown = false;
/** redraws the rows of the list on screen, so its "unsaved" chip follows the typing */
let refreshRows: (() => void) | null = null;
const draw = () => {
  barShown = false;
  refreshRows = null;
  const v = tool === 'missions' ? missionsView() : tool === 'campaign' ? campaignView() : tool === 'music' ? musicView() : usersView();
  ctx.root.replaceChildren(frame(v.title, v.actions, v.content));
  // a question that just opened takes the focus, on its safe answer
  (ctx.root.querySelector('.ws-confirm button, .ws-bar.ask button') as HTMLElement | null)?.focus();
};

// ---------- pieces ----------
const btn = (label: string, cls: string, onclick: () => void, disabled = false) =>
  el('button', { type: 'button', className: `ws-btn ${cls}`, textContent: label, onclick, disabled });

const frame = (title: string, actions: Node[], content: Node[]) => {
  const link = (t: Tool, label: string, n: number) => el('button', {
    type: 'button', className: `ws-link${tool === t ? ' on' : ''}`, onclick: () => void go(t), ariaCurrent: tool === t ? 'page' : null,
  }, label, el('small', { textContent: n ? String(n) : '' }));
  return el('div', { className: 'workshop' },
    el('nav', { className: 'ws-nav', ariaLabel: 'Strumenti dell\'Officina' },
      el('div', { className: 'ws-brand' }, el('b', { textContent: 'Officina' }), el('small', { textContent: 'Strumenti admin' })),
      el('span', { className: 'ws-grp', textContent: 'Contenuti' }),
      link('campaign', 'Campagna', chapters.length),
      link('missions', 'Missioni', missions.length),
      el('button', { type: 'button', className: 'ws-link', onclick: ctx.mapEditor }, 'Mappe', el('small', { textContent: String(allMaps().length - BUILTIN_MAPS.length || '') })),
      link('music', 'Musiche', getLibrary().tracks.length),
      el('span', { className: 'ws-grp', textContent: 'Persone' }),
      link('users', 'Utenti', users.length),
      el('button', { type: 'button', className: 'ws-link ws-exit', textContent: '← Torna al gioco', onclick: ctx.back }),
    ),
    el('main', { className: 'ws-main' },
      el('p', { className: 'ws-live', textContent: tool === 'users' ? 'Gli admin possono modificare tutto e cambiare i ruoli degli altri.' : 'Le modifiche salvate valgono subito per tutti i giocatori.' }),
      el('header', { className: 'ws-head' }, el('h2', { textContent: title }), ...actions),
      el('p', { className: 'error', role: 'alert', textContent: error, hidden: !error || barShown }),
      ...content,
    ),
  );
};

/** The save bar. It redraws itself: call touch() after every edit so its state follows the draft. */
const saveBar = (o: { edit: Edit<unknown>; label: string; onSave: () => void; extra?: () => Node[] }) => {
  barShown = true;
  const slot = el('div', { className: 'ws-bar-slot' });
  const make = () => {
    const changed = dirty(o.edit);
    return ask
      ? el('div', { className: 'ws-bar ask' },
          el('p', { textContent: 'Le modifiche non salvate andranno perse.' }),
          btn('Resta qui', 'ghost', () => { ask = null; draw(); }),
          btn('Scarta le modifiche', 'warn', () => { const fn = ask!; ask = null; fn(); }))
      : el('div', { className: 'ws-bar' },
          ...(error ? [el('p', { className: 'error', role: 'alert', textContent: error })] : []),
          el('p', { className: `ws-state${changed ? ' dirty' : savedAt ? ' ok' : ''}`, role: 'status', textContent: changed ? 'Modifiche non salvate' : savedAt ? `Salvato alle ${savedAt}` : 'Nessuna modifica' }),
          ...(o.extra?.() ?? []),
          ...(changed ? [btn('Annulla modifiche', 'ghost', () => { o.edit.d = JSON.parse(o.edit.orig); draw(); })] : []),
          btn(o.label, 'primary', o.onSave, !changed));
  };
  slot.append(make());
  return { node: slot, touch: () => { savedAt = ''; slot.replaceChildren(make()); refreshRows?.(); } };
};

/** Second tap for actions that cannot be undone, shown where the action was asked. */
const confirmRow = (key: string, text: (string | Node)[], ok: string, cls: string, run: () => void) =>
  pending === key
    ? [el('div', { className: 'ws-confirm', role: 'group' }, el('p', {}, ...text), btn('Annulla', 'ghost', () => { pending = ''; draw(); }), btn(ok, cls, () => { pending = ''; run(); }))]
    : [];
const confirmFirst = (key: string) => () => { pending = key; draw(); };

let uid = 0;
/** A labelled field; the unit, when given, sits inside the box. */
const field = (label: string, control: HTMLElement, o: { help?: string; unit?: string; wide?: boolean } = {}) => {
  control.id ||= `ws-f${++uid}`;
  return el('div', { className: `ws-field${o.wide ? ' wide' : ''}` },
    el('label', { htmlFor: control.id, textContent: label }),
    o.unit ? el('div', { className: 'ws-unit' }, control, el('span', { textContent: o.unit })) : control,
    ...(o.help ? [el('small', { className: 'hint', textContent: o.help })] : []));
};
const input = (value: string, set: (v: string) => void, o: Partial<HTMLInputElement> = {}) => {
  const i = el('input', { className: 'field', value, ...o });
  i.oninput = () => set(i.value);
  return i;
};
/** Numbers stay NaN while the box is empty, so the server refuses them instead of saving a silent 0. */
const number = (value: number, set: (v: number) => void, min: number, max: number) => {
  const i = el('input', { className: 'field', type: 'number', min: String(min), max: String(max), step: '1', value: Number.isNaN(value) ? '' : String(value) });
  i.oninput = () => set(i.valueAsNumber);
  return i;
};
const select = <V extends string>(options: [V, string][], value: V, set: (v: V) => void) => {
  const s = el('select', { className: 'field' }, ...options.map(([v, t]) => el('option', { value: v, textContent: t, selected: v === value })));
  s.onchange = () => set(s.value as V);
  return s;
};
const check = (label: string, on: boolean, set: (v: boolean) => void) => {
  const box = el('input', { type: 'checkbox', checked: on });
  box.onchange = () => set(box.checked);
  return el('label', { className: 'ws-check' }, box, ` ${label}`);
};
const tabBar = (names: string[], which: 'missions' | 'campaign') => el('div', { className: 'ws-tabs', role: 'tablist' },
  ...names.map((n, i) => el('button', {
    type: 'button', role: 'tab', className: `ws-tab${i === tabs[which] ? ' on' : ''}`, ariaSelected: String(i === tabs[which]), textContent: n,
    onclick: () => { tabs[which] = i; draw(); },
  })));

/** A list row; the whole row opens the item. */
const row = (o: { title: string; sub: string; label?: string; chip?: [string, string] | null; on: boolean; onclick: () => void }) => el('button', {
  type: 'button', className: `ws-row${o.on ? ' on' : ''}`, ariaCurrent: o.on ? 'true' : null, onclick: o.onclick,
},
  ...(o.label ? [el('small', { className: 'ws-eyebrow', textContent: o.label })] : []),
  el('b', { textContent: o.title }),
  el('small', { textContent: o.sub }),
  ...(o.chip ? [el('span', { className: `ws-chip ${o.chip[1]}`, textContent: o.chip[0] })] : []));

/** The searchable list beside an editor; typing filters without losing the focus. */
const listPane = (placeholder: string, rows: (q: string) => Node[], footer: Node[] = []) => {
  const box = el('div', { className: 'ws-rows' }, ...rows(queries[tool] ?? ''));
  const search = el('input', { type: 'search', className: 'field ws-search', placeholder, ariaLabel: placeholder, value: queries[tool] ?? '' });
  refreshRows = () => box.replaceChildren(...rows(queries[tool] ?? ''));
  search.oninput = () => { queries[tool] = search.value; refreshRows!(); };
  return el('div', { className: 'ws-list' }, search, box, ...footer);
};
const matches = (q: string, ...text: string[]) => !q.trim() || text.some(t => t.toLowerCase().includes(q.trim().toLowerCase()));

/** List and editor side by side; on phones one at a time. */
const masterDetail = (list: Node, editor: Node[]) => el('div', { className: `ws-md${open ? ' open' : ''}` }, list, el('section', { className: 'ws-edit' }, ...editor));
const editHead = (title: string, actions: Node[]) => el('div', { className: 'ws-edit-head' },
  btn('← Elenco', 'ghost ws-phone', () => { open = false; draw(); }),
  el('h3', { textContent: title }), ...actions);

const unsaved: [string, string] = ['Modifiche non salvate', 'draft'];
const mapName = (id: string) => allMaps().find(m => m.id === id)?.name;
const trackName = (id: string | null) => getLibrary().tracks.find(t => t.id === id)?.name;

/**
 * Enemy placement on a map: one button per cell. A tap places an enemy with the brush, or removes it.
 * With `goal`, taps toggle goal cells instead and the brush is hidden.
 */
const enemyEditor = (d: { enemies: MissionEnemy[] }, current: () => MapData, opts: { goal?: () => Pos[]; onChange?: () => void } = {}) => {
  // classes follow the race: changing race keeps the class if that race can take it
  const cls = el('select', { className: 'field', onchange: () => { brush.classId = cls.value; } });
  const fillClasses = () => {
    const ok = Object.values(CLASSES).filter(c => allowedRaces(c.id).includes(brush.raceId));
    if (!ok.some(c => c.id === brush.classId)) brush.classId = ok[0].id;
    cls.replaceChildren(...ok.map(c => el('option', { value: c.id, textContent: c.name, selected: c.id === brush.classId })));
  };
  fillClasses();
  const race = select(Object.values(RACES).map(r => [r.id, r.name] as [string, string]), brush.raceId, v => { brush.raceId = v; fillClasses(); });
  const lvl = number(brush.level, v => { brush.level = v; }, 1, MAX_CLASS_LEVEL);
  const count = el('p', { className: 'hint' });
  const grid = el('div', { className: 'enemy-grid' });

  const draw = () => {
    const m = current(), goal = opts.goal?.() ?? [];
    grid.style.gridTemplateColumns = `repeat(${m.width}, 1fr)`;
    grid.replaceChildren(...m.heights.flatMap((row, y) => row.map((h, x) => {
      const i = d.enemies.findIndex(e => e.pos.x === x && e.pos.y === y);
      const foe = d.enemies[i];
      const mine = m.spawns.A.some(p => p.x === x && p.y === y);
      const g = goal.findIndex(p => p.x === x && p.y === y);
      const what = foe ? `${foe.name ? `${foe.name}: ` : ''}${raceName(foe.raceId)} ${CLASSES[foe.classId].name}, livello ${foe.level}` : mine ? 'Partenza del giocatore' : g >= 0 ? 'Casella obiettivo' : `Casella libera, altezza ${h}`;
      const b = el('button', {
        type: 'button', className: `cell t-${m.terrain[y][x]}${mine ? ' mine' : ''}${foe ? ' foe' : ''}${g >= 0 ? ' goal' : ''}`,
        disabled: mine || !isWalkable(m, { x, y }), title: what, ariaLabel: `${x + 1},${y + 1}: ${what}`,
        textContent: foe ? `${CLASSES[foe.classId].name[0]}${foe.level}` : '',
        onclick: () => {
          if (opts.goal) {
            if (g >= 0) goal.splice(g, 1);
            else goal.push({ x, y });
          } else if (foe) d.enemies.splice(i, 1);
          else if (d.enemies.length < MAX_MISSION_ENEMIES) d.enemies.push({ classId: brush.classId, ...(brush.raceId !== DEFAULT_RACE ? { raceId: brush.raceId } : {}), level: brush.level, pos: { x, y } });
          draw();
          opts.onChange?.();
        },
      });
      b.style.setProperty('--h', String(h));
      return b;
    })));
    count.textContent = opts.goal
      ? `${goal.length === 1 ? '1 casella' : `${goal.length} caselle`} da raggiungere`
      : `${d.enemies.length === 1 ? '1 nemico' : `${d.enemies.length} nemici`} su ${MAX_MISSION_ENEMIES}`;
  };
  draw();
  return el('div', { className: 'ws-board' },
    el('div', { className: 'ws-board-grid' },
      grid,
      el('div', { className: 'ws-legend' },
        el('span', {}, el('i', { className: 'lg-foe' }), 'Nemico: iniziale della classe e livello'),
        el('span', {}, el('i', { className: 'lg-mine' }), 'Partenza del giocatore'),
        ...(opts.goal ? [el('span', {}, el('i', { className: 'lg-goal' }), 'Casella obiettivo')] : []),
        el('span', {}, el('i', { className: 'lg-h' }), 'Più chiaro = più alto'),
      )),
    el('div', { className: 'ws-brush' },
      el('p', { className: 'hint', textContent: opts.goal ? 'Tocca le caselle da raggiungere per vincere, toccale di nuovo per toglierle.' : 'Tocca una casella per piazzare il prossimo nemico, toccalo di nuovo per toglierlo.' }),
      ...(opts.goal ? [] : [field('Razza', race), field('Classe', cls), field('Livello', lvl)]),
      count,
    ),
  );
};

// ---------- missions ----------
const blankMission = (m: MapData): MissionDraft => ({ id: null, name: '', mapId: m.id, gold: 50, enemies: defaultEnemies(m), trackId: null, recruit: { on: false, name: '', raceId: 'corvid', classId: 'lancer' } });
const missionDraft = (m: Mission): MissionDraft => ({
  id: m.id, name: m.name, mapId: m.mapId, gold: m.gold, enemies: clone(m.enemies), trackId: m.trackId,
  recruit: m.recruit ? { on: true, ...m.recruit } : { on: false, name: '', raceId: 'corvid', classId: 'lancer' },
});

function missionsView() {
  const maps = allMaps();
  if (mEdit?.d.id && !missions.some(m => m.id === mEdit!.d.id)) mEdit = null;
  if (mEdit && !maps.some(m => m.id === mEdit!.d.mapId)) mEdit = null;
  const e = mEdit ??= edit(blankMission(maps[0]));
  const d = e.d, current = () => maps.find(m => m.id === d.mapId)!;
  const fresh = () => edit(blankMission(maps[0]));

  const save = () => {
    const before = missions;
    const m = { name: d.name, mapId: d.mapId, gold: d.gold, enemies: d.enemies, trackId: d.trackId, recruit: d.recruit.on ? { name: d.recruit.name, raceId: d.recruit.raceId, classId: d.recruit.classId } : null };
    void mutate(d.id ? api.updateMission(d.id, m) : api.createMission(m), list => {
      missions = list;
      const saved = list.find(x => x.id === d.id) ?? list.find(x => !before.some(b => b.id === x.id));
      mEdit = saved ? edit(missionDraft(saved)) : null;
    });
  };
  const rehearse = () => {
    const map = current();
    ctx.rehearse({ id: 'prova', mapId: map.id, map, label: 'Prova', title: d.name || 'Missione', blurb: '', enemies: d.enemies, goal: { type: 'rout' }, required: [], gold: 0, before: [], after: [] }, d.trackId);
  };
  const bar = saveBar({
    edit: e, label: d.id ? 'Salva missione' : 'Crea missione', onSave: save,
    extra: () => [btn('Prova la battaglia', '', rehearse, !d.enemies.length)],
  });

  const pane = [
    () => [el('div', { className: 'ws-fields' },
      field('Nome della missione', input(d.name, v => { d.name = v; bar.touch(); }, { maxLength: 60, placeholder: 'es. Il ponte dei corvi' }), { wide: true }),
      field('Mappa', select(maps.map(m => [m.id, m.name] as [string, string]), d.mapId, v => { d.mapId = v; d.enemies = defaultEnemies(current()); draw(); }),
        { help: 'Cambiare mappa rimette i nemici sulle partenze nemiche.' }),
      field('Premio alla vittoria', number(d.gold, v => { d.gold = v; bar.touch(); }, 0, 10000), { unit: 'oro', help: 'Più XP, una volta al giorno.' }),
      field('Musica', select<string>([['', 'Quella delle battaglie'], ...getLibrary().tracks.map(t => [t.id, t.name] as [string, string])], d.trackId ?? '', v => { d.trackId = v || null; bar.touch(); })),
    )],
    () => [enemyEditor(d, current, { onChange: bar.touch })],
    () => {
      const rc = d.recruit;
      const cls = el('select', { className: 'field', onchange: () => { rc.classId = cls.value; bar.touch(); } });
      const fill = () => {
        const ok = baseClassesOf(rc.raceId);
        if (!ok.some(c => c.id === rc.classId)) rc.classId = ok[0].id;
        cls.replaceChildren(...ok.map(c => el('option', { value: c.id, textContent: c.name, selected: c.id === rc.classId })));
      };
      fill();
      return [
        check('Alla prima vittoria si unisce una recluta', rc.on, v => { rc.on = v; draw(); }),
        ...(rc.on ? [el('div', { className: 'ws-fields' },
          field('Nome della recluta', input(rc.name, v => { rc.name = v; bar.touch(); }, { maxLength: 20 })),
          field('Razza', select(Object.values(RACES).map(r => [r.id, r.name] as [string, string]), rc.raceId, v => { rc.raceId = v; fill(); bar.touch(); })),
          field('Classe', cls),
        )] : [el('p', { className: 'hint', textContent: 'Nessuna recluta: la missione paga solo oro e XP.' })]),
      ];
    },
  ][tabs.missions]();

  const list = listPane('Cerca missione', q => [
    ...(d.id ? [] : [row({ title: d.name || 'Nuova missione', sub: 'non ancora creata', chip: dirty(e) ? unsaved : null, on: true, onclick: () => { open = true; draw(); } })]),
    ...missions.filter(m => matches(q, m.name, mapName(m.mapId) ?? '')).map(m => row({
      title: m.name, on: m.id === d.id,
      sub: `${mapName(m.mapId) ?? 'mappa mancante'} · +${m.gold} oro · ${enemySummary(m.enemies)}${m.recruit ? ` · recluta ${m.recruit.name}` : ''}${trackName(m.trackId) ? ` · ♪ ${trackName(m.trackId)}` : ''}`,
      chip: m.id === d.id && dirty(e) ? unsaved : !mapName(m.mapId) ? ['Manca la mappa', 'warn'] : null,
      onclick: () => m.id === d.id ? (open = true, draw()) : replace(e, () => { mEdit = edit(missionDraft(m)); open = true; draw(); }),
    })),
    ...(missions.length ? [] : [el('p', { className: 'hint ws-empty-list', textContent: 'Ancora nessuna missione: la prima si crea qui accanto.' })]),
  ]);

  return {
    title: 'Missioni giornaliere',
    actions: [btn('+ Nuova missione', '', () => replace(e, () => { mEdit = fresh(); open = true; tabs.missions = 0; draw(); }))],
    content: [masterDetail(list, [
      editHead(d.id ? d.name : 'Nuova missione', d.id ? [
        btn('Duplica', 'ghost', () => { mEdit = edit({ ...clone(d), id: null, name: `${d.name} (copia)` }, blankMission(maps[0])); open = true; draw(); }),
        btn('Elimina', 'ghost', confirmFirst(`del:${d.id}`)),
      ] : []),
      ...confirmRow(`del:${d.id}`, ['Eliminare ', el('b', { textContent: d.name }), '? Sparisce dalle missioni di oggi per tutti i giocatori.'], 'Elimina', 'warn',
        () => void mutate(api.deleteMission(d.id!), l => { missions = l; mEdit = null; }, false)),
      tabBar(['Dati', 'Nemici', 'Recluta'], 'missions'),
      el('div', { className: 'ws-pane' }, ...pane),
      bar.node,
    ])],
  };
}

// ---------- campaign ----------
const newUnlock = (): Omit<RosterUnit, 'id'> => ({ name: '', classId: 'warrior', xp: { warrior: xpToReach(3) }, passive: null });
const chapterDraft = (ch: Chapter | null, map: MapData): ChapterDraft => {
  const g = ch?.goal ?? { type: 'rout' };
  const { id: _, ...unlock } = ch?.unlock ?? { id: '', ...newUnlock() };
  return {
    id: ch?.id ?? null, mapId: map.id, label: ch?.label ?? '', title: ch?.title ?? '', blurb: ch?.blurb ?? '', gold: ch?.gold ?? 150, crt: !!ch?.crt,
    enemies: ch ? clone(ch.enemies) : defaultEnemies(map), required: [...(ch?.required ?? [])], before: clone(ch?.before ?? []), after: clone(ch?.after ?? []),
    goalType: g.type, rounds: g.type === 'survive' ? g.rounds : 5, cells: g.type === 'reach' ? clone(g.cells) : [],
    boss: g.type === 'boss' ? Number(g.unitId.slice(5)) : 0,
    unlockOn: !!ch?.unlock, unlock, unlockLevel: classLevel({ id: '', ...unlock }, unlock.classId),
  };
};
const goalOf = (d: ChapterDraft): Goal => d.goalType === 'survive' ? { type: 'survive', rounds: d.rounds } : d.goalType === 'reach' ? { type: 'reach', cells: d.cells }
  : d.goalType === 'boss' ? { type: 'boss', unitId: `enemy${d.boss}` } : { type: 'rout' };

function campaignView() {
  const maps = allMaps().filter(m => !BUILTIN_MAPS.some(b => b.id === m.id));
  if (!maps.length) return {
    title: 'Cronache di Valdombra', actions: [],
    content: [el('div', { className: 'ws-empty' },
      el('div', { className: 'ws-empty-mark', ariaHidden: 'true' }),
      el('h3', { textContent: 'Prima serve una mappa' }),
      el('p', { textContent: 'Ogni capitolo si gioca su una mappa salvata. La mappa dimostrativa non si può usare nella campagna.' }),
      btn('Apri l\'editor mappe', 'primary', ctx.mapEditor))],
  };
  if (cEdit?.d.id && !chapters.some(c => c.id === cEdit!.d.id)) cEdit = null;
  if (cEdit && !maps.some(m => m.id === cEdit!.d.mapId)) cEdit = null;
  const e = cEdit ??= edit(chapterDraft(null, maps[0]));
  const d = e.d, current = () => maps.find(m => m.id === d.mapId)!;
  const at = d.id ? chapters.findIndex(c => c.id === d.id) : chapters.length;
  const ch = chapters[at];

  const save = () => {
    const before = chapters;
    const c = {
      mapId: d.mapId, label: d.label, title: d.title, blurb: d.blurb, gold: d.gold, crt: d.crt, enemies: d.enemies, goal: goalOf(d),
      required: d.required, unlock: d.unlockOn ? d.unlock : null, before: d.before, after: d.after,
    };
    void mutate(d.id ? api.updateChapter(d.id, c) : api.createChapter(c), list => {
      chapters = list;
      const saved = list.find(x => x.id === d.id) ?? list.find(x => !before.some(b => b.id === x.id));
      cEdit = saved ? edit(chapterDraft(saved, maps.find(m => m.id === saved.mapId) ?? maps[0])) : null;
    });
  };
  const rehearse = () => ctx.rehearse({
    id: 'prova', mapId: d.mapId, map: current(), label: d.label, title: d.title, blurb: d.blurb, gold: 0, crt: d.crt, enemies: d.enemies, goal: goalOf(d),
    // a draft may ask for allies this account has not unlocked yet
    required: d.required.filter(id => ctx.player.roster.some(u => u.id === id)), unlock: null, before: d.before, after: d.after,
  }, null);
  const bar = saveBar({
    edit: e, label: d.id ? 'Salva capitolo' : 'Crea capitolo', onSave: save,
    extra: () => [btn('Prova il capitolo', '', rehearse, !d.enemies.length)],
  });

  const pane = [
    // story
    () => [el('div', { className: 'ws-fields' },
      field('Etichetta', input(d.label, v => { d.label = v; bar.touch(); }, { maxLength: 30, placeholder: 'es. Capitolo 4' })),
      field('Titolo', input(d.title, v => { d.title = v; bar.touch(); }, { maxLength: 60 })),
      field('Descrizione', input(d.blurb, v => { d.blurb = v; bar.touch(); }, { maxLength: 160 }), { wide: true, help: 'Una riga, sotto il titolo nella lista dei capitoli.' }),
    ), check('La battaglia si gioca dentro il monitor della cameretta', !!d.crt, v => { d.crt = v; bar.touch(); })],
    // battle
    () => [
      el('div', { className: 'ws-fields' }, field('Mappa', select(maps.map(m => [m.id, m.name] as [string, string]), d.mapId, v => {
        d.mapId = v; d.enemies = defaultEnemies(current()); d.cells = []; draw();
      }), { help: 'Cambiare mappa rimette i nemici sulle partenze e svuota le caselle obiettivo.' })),
      enemyEditor(d, current, { onChange: () => { if (d.boss >= d.enemies.length) d.boss = 0; bar.touch(); } }),
    ],
    // goal: four cards, because each one changes the fields below
    () => [
      el('div', { className: 'ws-cards', role: 'radiogroup', ariaLabel: 'Obiettivo' }, ...(Object.keys(GOAL_NAMES) as Goal['type'][]).map(t => el('button', {
        type: 'button', role: 'radio', ariaChecked: String(t === d.goalType), className: `ws-card${t === d.goalType ? ' on' : ''}`,
        onclick: () => { d.goalType = t; draw(); },
      }, el('b', { textContent: GOAL_NAMES[t] }), el('small', { textContent: GOAL_HINTS[t] })))),
      ...(d.goalType === 'survive' ? [el('div', { className: 'ws-fields' }, field('Durata', number(d.rounds, v => { d.rounds = v; bar.touch(); }, 1, 30), { unit: 'round' }))]
        : d.goalType === 'boss' ? [el('div', { className: 'ws-fields' }, d.enemies.length
          ? field('Boss', select(d.enemies.map((x, i) => [String(i), `${x.name ?? `${raceName(x.raceId)} ${CLASSES[x.classId].name}`}, livello ${x.level} (${x.pos.x + 1},${x.pos.y + 1})`] as [string, string]),
              String(Math.min(d.boss, d.enemies.length - 1)), v => { d.boss = Number(v); bar.touch(); }), { help: 'Scelto tra i nemici della scheda Battaglia.' })
          : el('p', { className: 'hint', textContent: 'Piazza almeno un nemico nella scheda Battaglia.' }))]
        : d.goalType === 'reach' ? [enemyEditor(d, current, { goal: () => d.cells, onChange: bar.touch })] : []),
    ],
    // squad and reward; required units: the starting roster plus what the chapters before this one unlock
    () => {
      const pool = [...DEFAULT_ROSTER, ...chapters.slice(0, at).flatMap(c => c.unlock ? [c.unlock] : [])];
      const un = d.unlock;
      // the unlock keeps its XP until its class or level changes, so a multi-class unit survives a text edit
      const resetXp = () => { un.xp = { [un.classId]: xpToReach(d.unlockLevel) }; };
      const cls = el('select', { className: 'field', onchange: () => { un.classId = cls.value; resetXp(); bar.touch(); } });
      const fill = () => {
        const ok = baseClassesOf(un.raceId ?? DEFAULT_RACE);
        if (!ok.some(c => c.id === un.classId) && !allowedRaces(un.classId).includes(un.raceId ?? DEFAULT_RACE)) { un.classId = ok[0].id; resetXp(); }
        const opts = ok.some(c => c.id === un.classId) ? ok : [CLASSES[un.classId], ...ok];
        cls.replaceChildren(...opts.map(c => el('option', { value: c.id, textContent: c.name, selected: c.id === un.classId })));
      };
      fill();
      return [
        el('fieldset', { className: 'ws-set' }, el('legend', { textContent: 'Devono combattere' }),
          ...pool.map(u => check(u.name, d.required.includes(u.id), v => { d.required = v ? [...d.required, u.id] : d.required.filter(id => id !== u.id); bar.touch(); }))),
        el('div', { className: 'ws-fields' }, field('Premio alla prima vittoria', number(d.gold, v => { d.gold = v; bar.touch(); }, 0, 10000), { unit: 'oro', help: 'Più XP. Le vittorie dopo la prima non pagano.' })),
        check('Alla prima vittoria si unisce un alleato', d.unlockOn, v => { d.unlockOn = v; draw(); }),
        ...(d.unlockOn ? [el('div', { className: 'ws-fields' },
          field('Nome dell\'alleato', input(un.name, v => { un.name = v; bar.touch(); }, { maxLength: 20 })),
          field('Razza', select(Object.values(RACES).map(r => [r.id, r.name] as [string, string]), un.raceId ?? DEFAULT_RACE, v => { un.raceId = v; fill(); bar.touch(); })),
          field('Classe', cls),
          field('Livello', number(d.unlockLevel, v => { d.unlockLevel = v; resetXp(); bar.touch(); }, 1, MAX_CLASS_LEVEL)),
        )] : []),
      ];
    },
    // cutscenes
    () => [linesEditor(d.before, 'before', 'Prima della battaglia', bar.touch), linesEditor(d.after, 'after', 'Dopo la vittoria', bar.touch)],
  ][tabs.campaign]();

  const list = listPane('Cerca capitolo', q => [
    ...chapters.filter(c => matches(q, c.label, c.title)).map(c => row({
      label: c.label, title: c.title, on: c.id === d.id,
      sub: `${mapName(c.mapId) ?? 'mappa mancante'} · ${goalText(c.goal)}`,
      chip: c.id === d.id && dirty(e) ? unsaved : !c.map ? ['Manca la mappa', 'warn'] : null,
      onclick: () => c.id === d.id ? (open = true, draw()) : replace(e, () => { cEdit = edit(chapterDraft(c, maps.find(m => m.id === c.mapId) ?? maps[0])); open = true; draw(); }),
    })),
    ...(d.id ? [] : [row({ label: d.label || 'Nuovo', title: d.title || 'Nuovo capitolo', sub: 'non ancora creato', chip: dirty(e) ? unsaved : null, on: true, onclick: () => { open = true; draw(); } })]),
  ]);

  return {
    title: 'Cronache di Valdombra',
    actions: [btn('+ Nuovo capitolo', '', () => replace(e, () => { cEdit = edit(chapterDraft(null, maps[0])); open = true; tabs.campaign = 0; draw(); }))],
    content: [masterDetail(list, [
      editHead(d.id ? `${ch?.label ?? ''} · ${ch?.title ?? ''}` : 'Nuovo capitolo', d.id ? [
        btn('↑', 'ghost', () => void mutate(api.moveChapter(d.id!, -1), l => { chapters = l; }, false), at === 0),
        btn('↓', 'ghost', () => void mutate(api.moveChapter(d.id!, 1), l => { chapters = l; }, false), at === chapters.length - 1),
        btn('Duplica', 'ghost', () => { cEdit = edit({ ...clone(d), id: null, title: `${d.title} (copia)` }, chapterDraft(null, maps[0])); open = true; draw(); }),
        btn('Elimina', 'ghost', confirmFirst(`del:${d.id}`)),
      ] : []),
      ...confirmRow(`del:${d.id}`, ['Eliminare ', el('b', { textContent: d.title }), '? Chi l\'ha già vinto tiene ricompense e alleato.'], 'Elimina', 'warn',
        () => void mutate(api.deleteChapter(d.id!), l => { chapters = l; cEdit = null; }, false)),
      tabBar(['Racconto', 'Battaglia', 'Obiettivo', 'Squadra e premio', 'Cutscene'], 'campaign'),
      el('div', { className: 'ws-pane' }, ...pane),
      bar.node,
    ])],
  };
}

/** A cutscene as a list of closed lines; the open one shows its fields and a preview of the dialogue box. */
function linesEditor(lines: Line[], key: string, title: string, touch: () => void) {
  const box = el('fieldset', { className: 'ws-set ws-lines' });
  const redraw = () => box.replaceChildren(
    el('legend', { textContent: `${title} · ${lines.length === 1 ? '1 battuta' : `${lines.length} battute`}` }),
    ...lines.map((l, i) => {
      const id = `${key}:${i}`;
      if (openLine !== id) return el('button', { type: 'button', className: 'ws-line', onclick: () => { openLine = id; redraw(); } },
        el('small', { textContent: [SCENE_NAMES[l.scene], l.who ?? 'Narratore', l.fx && FX_NAMES[l.fx]].filter(Boolean).join(' · ') }),
        el('span', { textContent: l.text || 'Battuta vuota' }));
      const preview = el('div', { className: `ws-story${l.who ? '' : ' narration'}` },
        ...(l.who ? [el('b', { textContent: l.who })] : []), el('span', { textContent: l.text || '…' }));
      const text = el('textarea', { className: 'field', rows: 2, maxLength: 200, value: l.text });
      text.oninput = () => { l.text = text.value; preview.lastElementChild!.textContent = l.text || '…'; touch(); };
      const move = (to: number) => { [lines[i], lines[to]] = [lines[to], lines[i]]; openLine = `${key}:${to}`; redraw(); touch(); };
      return el('div', { className: 'ws-line open' },
        el('div', { className: 'ws-fields' },
          field('Scena', select(SCENES.map(s => [s, SCENE_NAMES[s]] as [Line['scene'], string]), l.scene, v => { l.scene = v; touch(); })),
          field('Chi parla', input(l.who ?? '', v => { if (v.trim()) l.who = v; else delete l.who; touch(); }, { maxLength: 20, placeholder: 'Narratore' })),
          field('Effetto', select<string>([['', 'Nessuno'], ...FXS.map(f => [f, FX_NAMES[f]] as [string, string])], l.fx ?? '', v => { if (v) l.fx = v as Fx; else delete l.fx; touch(); })),
          field('Testo', text, { wide: true }),
        ),
        preview,
        el('div', { className: 'ws-line-actions' },
          btn('Sposta su', 'ghost', () => move(i - 1), i === 0),
          btn('Sposta giù', 'ghost', () => move(i + 1), i === lines.length - 1),
          btn('Elimina battuta', 'ghost', () => { lines.splice(i, 1); openLine = ''; redraw(); touch(); }),
          btn('Chiudi', '', () => { openLine = ''; redraw(); })),
      );
    }),
    btn('+ Battuta', 'ghost', () => { lines.push({ scene: lines.at(-1)?.scene ?? 'map', text: '' }); openLine = `${key}:${lines.length - 1}`; redraw(); touch(); }),
  );
  redraw();
  return box;
}

// ---------- music ----------
function musicView() {
  const lib = getLibrary();
  const slotsOf = (l: Music) => ({ menu: l.menu, battle: l.battle });
  if (!slots || slots.orig !== JSON.stringify(slotsOf(lib)) && !dirty(slots)) slots = edit(slotsOf(lib));
  const s = slots;
  const choices: [string, string][] = [['', 'Nessuna (silenzio)'], ...lib.tracks.map(t => [t.id, t.name] as [string, string])];
  const slotBar = saveBar({
    edit: s, label: 'Salva', onSave: () => void mutate((async () => {
      let l = lib;
      if (s.d.menu !== lib.menu) l = await api.setMusicSlot('menu', s.d.menu);
      if (s.d.battle !== lib.battle) l = await api.setMusicSlot('battle', s.d.battle);
      return l;
    })(), l => { setLibrary(l); slots = null; }),
  });

  if (tEdit?.d.id && !lib.tracks.some(t => t.id === tEdit!.d.id)) tEdit = null;
  const e = tEdit ??= edit<TrackDraft>({ id: null, name: '', code: '' });
  const d = e.d;
  const problem = el('p', { className: 'error', role: 'alert', hidden: true });
  const key = d.id ?? 'draft';
  const toggle = () => {
    if (playing === key) { playing = null; void playCode(null); return draw(); }
    void playCode(d.code).then(() => { playing = key; draw(); }, err => {
      problem.textContent = `Errore nel codice: ${(err as Error).message}`;
      problem.hidden = false;
    });
  };
  const bar = saveBar({
    edit: e, label: d.id ? 'Salva brano' : 'Crea brano',
    onSave: () => void mutate(d.id ? api.updateTrack(d.id, { name: d.name, code: d.code }) : api.createTrack({ name: d.name, code: d.code }), l => {
      const fresh = l.tracks.find(t => t.id === d.id) ?? l.tracks.find(t => !lib.tracks.some(o => o.id === t.id));
      setLibrary(l);
      tEdit = fresh ? edit({ ...fresh }) : null;
    }),
  });
  const code = el('textarea', { className: 'field code', required: true, maxLength: 20000, spellcheck: false, value: d.code, placeholder: 'Incolla qui il codice da strudel.cc' });
  code.oninput = () => { d.code = code.value; bar.touch(); };

  const list = listPane('Cerca brano', q => [
    ...(d.id ? [] : [row({ title: d.name || 'Nuovo brano', sub: 'non ancora salvato', chip: dirty(e) ? unsaved : playing === 'draft' ? ['In riproduzione', 'ok'] : null, on: true, onclick: () => { open = true; draw(); } })]),
    ...lib.tracks.filter(t => matches(q, t.name)).map(t => row({
      title: t.name, on: t.id === d.id,
      sub: [t.id === lib.menu && 'Menu', t.id === lib.battle && 'Battaglie'].filter(Boolean).join(' · ') || 'Non in uso di default',
      chip: t.id === d.id && dirty(e) ? unsaved : playing === t.id ? ['In riproduzione', 'ok'] : null,
      onclick: () => t.id === d.id ? (open = true, draw()) : replace(e, () => { tEdit = edit({ ...t }); open = true; draw(); }),
    })),
  ]);

  return {
    title: 'Musiche',
    actions: [btn('+ Nuovo brano', '', () => replace(e, () => { tEdit = edit<TrackDraft>({ id: null, name: '', code: '' }); open = true; draw(); }))],
    content: [
      el('section', { className: 'ws-slots' },
        el('div', { className: 'ws-fields' },
          field('Musica del menu', select<string>(choices, s.d.menu ?? '', v => { s.d.menu = v || null; slotBar.touch(); })),
          field('Musica delle battaglie', select<string>(choices, s.d.battle ?? '', v => { s.d.battle = v || null; slotBar.touch(); }),
            { help: 'Una missione può avere la sua: si sceglie nella missione.' })),
        slotBar.node),
      masterDetail(list, [
        editHead(d.id ? d.name : 'Nuovo brano', d.id ? [btn('Elimina', 'ghost', confirmFirst(`del:${d.id}`))] : []),
        ...confirmRow(`del:${d.id}`, ['Eliminare ', el('b', { textContent: d.name }), '? Le missioni che la usano passano alla musica delle battaglie.'], 'Elimina', 'warn',
          () => void mutate(api.deleteTrack(d.id!), l => { setLibrary(l); tEdit = null; }, false)),
        el('div', { className: 'ws-pane' },
          el('div', { className: 'ws-fields' },
            field('Nome del brano', input(d.name, v => { d.name = v; bar.touch(); }, { maxLength: 60 }), { wide: true }),
            field('Codice Strudel', code, { wide: true })),
          problem,
          btn(playing === key ? '■ Ferma' : '▶ Ascolta', playing === key ? 'on' : '', toggle, !d.code.trim())),
        bar.node,
      ]),
    ],
  };
}

// ---------- users ----------
function usersView() {
  const rows = (q: string) => users.filter(u => matches(q, u.email)).map(u => {
    const me = u.email === ctx.player.email;
    const verb = u.admin ? 'Togli admin' : 'Rendi admin';
    return el('div', { className: 'ws-user' },
      el('span', {}, el('b', { textContent: u.email }), el('small', { textContent: `dal ${new Date(u.createdAt).toLocaleDateString('it-IT')}${me ? ' · sei tu' : ''}` })),
      el('span', { className: `ws-role${u.admin ? ' admin' : ''}`, textContent: u.admin ? 'Admin' : 'Giocatore' }),
      me ? el('span') : btn(verb, 'ghost', confirmFirst(`role:${u.id}`)),
      ...confirmRow(`role:${u.id}`, u.admin
        ? ['Togliere i poteri admin a ', el('b', { textContent: u.email }), '? Tornerà a essere un giocatore.']
        : ['Dare i poteri admin a ', el('b', { textContent: u.email }), '? Potrà cambiare campagna, missioni, mappe, musiche e ruoli.'],
      `Sì, ${verb.toLowerCase()}`, 'primary', () => void mutate(api.setAdmin(u.id, !u.admin), l => { users = l; }, false)),
    );
  });
  const box = el('div', { className: 'ws-users' }, ...rows(queries.users ?? ''));
  const search = el('input', { type: 'search', className: 'field ws-search', placeholder: 'Cerca per email', ariaLabel: 'Cerca per email', value: queries.users ?? '' });
  search.oninput = () => { queries.users = search.value; box.replaceChildren(...rows(search.value)); };
  return { title: 'Utenti', actions: [search], content: [box] };
}
