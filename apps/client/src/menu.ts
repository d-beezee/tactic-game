import {
  CLASSES, DEFAULT_RACE, FXS, SCENES, RACES, STATUSES, allowedRaces, chapterOpen, DEFAULT_ROSTER, raceOf, unitActions, ITEMS, isWalkable, MAX_CLASS_LEVEL, MAX_MISSION_ENEMIES, PASSIVE_LEVEL, SLOTS, SLOT_LABELS, classLevel, freeCopies, itemBonus, missingRequirements, unitFromRoster,
  unlockedPassives, xpToReach, type ActionDef, type Chapter, type ChapterInput, type Goal, type ItemDef, type Line, type Pos, type MapData, type MissionEnemy, type Player, type RosterUnit, type Stats, type UnitChange,
} from '@tactics/core';
import { api, ApiError, type Account, type Mission, type Music, type PvpState, type User } from './api';
import { allMaps, BUILTIN_MAPS, loadMaps } from './maps';
import { getLibrary, music, playCode, setLibrary } from './music';
import { play } from './sfx';
import { spriteDir } from './sprites';
import { reducedMotion, saveSettings, settings } from './theme';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};

const STAT_LABELS = [
  ['maxHp', 'PV'], ['atk', 'Attacco'], ['def', 'Difesa'], ['mag', 'Magia'],
  ['speed', 'Velocità'], ['move', 'Movimento'], ['jump', 'Salto'],
] as const;
const STAT_SHORT: Record<keyof Stats, string> = { maxHp: 'PV', atk: 'ATT', def: 'DIF', mag: 'MAG', speed: 'VEL', move: 'MOV', jump: 'SALTO' };
// full length of a stat bar in the barracks
const BAR_MAX: Partial<Record<keyof Stats, number>> = { maxHp: 120, atk: 30, def: 30, mag: 30, speed: 20 };
const FACINGS = ['S', 'E', 'N', 'W'];

/** The unit's sprite turning on a lit pedestal; stops by itself once the screen is gone. Empty for art not drawn yet. */
function pedestal(u: RosterUnit) {
  const dir = spriteDir(raceOf(u), u.classId);
  if (!dir) return el('div', { className: 'pedestal' });
  const img = el('img', { alt: '', src: `${dir}/S.png`, width: 168, height: 168 });
  if (!reducedMotion()) {
    let f = 0;
    const spin = setInterval(() => {
      if (!img.isConnected) return clearInterval(spin);
      img.src = `${dir}/${FACINGS[f = (f + 1) % 4]}.png`;
    }, 1100);
  }
  return el('div', { className: 'pedestal' }, img);
}

const EFFECT_TEXT: Record<ActionDef['effect'], string> = { damage: 'danno', heal: 'cura', none: '', teleport: 'teletrasporto', swap: 'scambio di posto' };

/** "danno · gittata 2–4 · area 1 · Veleno 3 turni" */
function actionText(a: ActionDef): string {
  const st = a.status;
  return [
    EFFECT_TEXT[a.effect],
    `gittata ${a.minRange === a.maxRange ? a.maxRange : `${a.minRange}–${a.maxRange}`}${a.ranged ? '' : ' (corpo a corpo)'}`,
    a.area !== undefined ? `area ${a.area}` : '',
    st ? `${STATUSES[st.id].name} ${st.turns} ${st.turns === 1 ? 'turno' : 'turni'}${st.chance !== undefined ? ` (${st.chance}%)` : ''}` : '',
    a.push ? `spinta ${a.push}` : '',
    a.uses ? `${a.uses === 1 ? 'una volta' : `${a.uses} volte`} per battaglia` : '',
  ].filter(Boolean).join(' · ');
}

const raceName = (id: string | undefined) => RACES[id ?? DEFAULT_RACE].name;
/** Base classes a race can start in: what a mission recruit can be. */
const baseClassesOf = (raceId: string) => Object.values(CLASSES).filter(c => !c.requires && allowedRaces(c.id).includes(raceId));

/** Live map behind the menu, loaded on demand so Phaser stays out of the first download. */
let stopBackdrop: (() => void) | null = null;
let backdropGen = 0; // newest request wins when loads overlap
async function backdrop(roster: RosterUnit[]) {
  const gen = ++backdropGen;
  stopBackdrop?.();
  stopBackdrop = null;
  try {
    const stop = (await import('./backdrop')).startBackdrop(BUILTIN_MAPS[0], roster);
    if (gen !== backdropGen) stop(); // replaced, or the player left the menu while it loaded
    else stopBackdrop = stop;
  } catch (e) {
    console.error(e); // no WebGL or canvas: the menu works without the scene
  }
}

const leaveMenu = () => {
  music(null);
  backdropGen++;
  stopBackdrop?.();
  stopBackdrop = null;
  document.getElementById('menu')!.hidden = true;
  document.getElementById('backdrop')!.hidden = true; // it sits above the game canvas
};

/** Starting enemies for a new mission: the map's enemy spawns, base classes in turn, level 1. */
const defaultEnemies = (m: MapData): MissionEnemy[] =>
  m.spawns.B.slice(0, m.maxDeploy).map((pos, i) => ({ classId: ['warrior', 'archer', 'cleric'][i % 3], level: 1, pos: { ...pos } }));

/** "3 nemici, livello 2–5" */
const enemySummary = (enemies: MissionEnemy[]) => {
  const lv = enemies.map(e => e.level), lo = Math.min(...lv), hi = Math.max(...lv);
  return `${enemies.length === 1 ? '1 nemico' : `${enemies.length} nemici`}, livello ${lo === hi ? lo : `${lo}–${hi}`}`;
};

/**
 * Enemy placement on a map: a brush (race, class, level) and one button per cell. A tap places or removes an enemy,
 * or toggles a goal cell while `goal.editing()` is true. `onChange` runs after every tap.
 */
const enemyEditor = (
  d: { enemies: MissionEnemy[]; raceId: string; classId: string; level: number }, current: () => MapData,
  opts: { goal?: { cells: () => Pos[] | null; editing: () => boolean }; onChange?: () => void } = {},
) => {
  // classes follow the race: changing race keeps the class if that race can take it
  const cls = el('select', { className: 'field', ariaLabel: 'Classe del prossimo nemico', onchange: () => { d.classId = cls.value; } });
  const fillClasses = () => {
    const ok = Object.values(CLASSES).filter(c => allowedRaces(c.id).includes(d.raceId));
    if (!ok.some(c => c.id === d.classId)) d.classId = ok[0].id;
    cls.replaceChildren(...ok.map(c => el('option', { value: c.id, textContent: c.name, selected: c.id === d.classId })));
  };
  fillClasses();
  const race = el('select', { className: 'field', ariaLabel: 'Razza del prossimo nemico', onchange: () => { d.raceId = race.value; fillClasses(); } },
    ...Object.values(RACES).map(r => el('option', { value: r.id, textContent: r.name, selected: r.id === d.raceId })));
  const lvl = el('input', { className: 'field', type: 'number', min: '1', max: String(MAX_CLASS_LEVEL), step: '1', value: String(d.level), ariaLabel: 'Livello del prossimo nemico',
    oninput: () => { d.level = Number(lvl.value); } });
  const count = el('span', { className: 'hint' });
  const hint = el('p', { className: 'hint' });
  const grid = el('div', { className: 'enemy-grid' });

  /** One button per cell: an empty walkable cell gets a new enemy, an enemy's cell loses it. */
  const draw = () => {
    const m = current(), goal = opts.goal?.cells() ?? [], editingGoal = !!opts.goal?.editing();
    hint.textContent = editingGoal
      ? 'Tocca le caselle da raggiungere per vincere, toccale di nuovo per toglierle.'
      : 'Tocca una casella per piazzare un nemico, toccalo di nuovo per toglierlo. In blu le partenze del giocatore.';
    grid.style.gridTemplateColumns = `repeat(${m.width}, 1fr)`;
    grid.replaceChildren(...m.heights.flatMap((row, y) => row.map((h, x) => {
      const i = d.enemies.findIndex(e => e.pos.x === x && e.pos.y === y);
      const foe = d.enemies[i];
      const mine = m.spawns.A.some(p => p.x === x && p.y === y);
      const g = goal.findIndex(p => p.x === x && p.y === y);
      const b = el('button', {
        type: 'button', className: `cell t-${m.terrain[y][x]}${mine ? ' mine' : ''}${foe ? ' foe' : ''}${g >= 0 ? ' goal' : ''}`,
        disabled: mine || !isWalkable(m, { x, y }),
        title: foe ? `${foe.name ? `${foe.name}: ` : ''}${raceName(foe.raceId)} ${CLASSES[foe.classId].name}, livello ${foe.level}` : mine ? 'Partenza del giocatore' : g >= 0 ? 'Casella obiettivo' : `Altezza ${h}`,
        textContent: foe ? `${CLASSES[foe.classId].name[0]}${foe.level}` : '',
        onclick: () => {
          if (editingGoal) {
            if (g >= 0) goal.splice(g, 1);
            else goal.push({ x, y });
          } else if (foe) d.enemies.splice(i, 1);
          else if (d.enemies.length < MAX_MISSION_ENEMIES) d.enemies.push({ classId: d.classId, ...(d.raceId !== DEFAULT_RACE ? { raceId: d.raceId } : {}), level: d.level, pos: { x, y } });
          draw();
          opts.onChange?.();
        },
      });
      b.style.setProperty('--h', String(h));
      return b;
    })));
    count.textContent = `${d.enemies.length === 1 ? '1 nemico' : `${d.enemies.length} nemici`}, massimo ${MAX_MISSION_ENEMIES}`;
  };
  draw();
  const node = el('div', { className: 'enemy-editor' },
    hint,
    el('div', { className: 'brush' }, el('span', { className: 'hint', textContent: 'Prossimo nemico:' }), race, cls, el('label', {}, 'livello ', lvl), count),
    grid,
  );
  return { node, draw };
};

const GOAL_NAMES: Record<Goal['type'], string> = { rout: 'Sconfiggi tutti', survive: 'Sopravvivi', reach: 'Raggiungi le caselle', boss: 'Sconfiggi il boss' };
const goalText = (g: Goal) => g.type === 'survive' ? `sopravvivi ${g.rounds === 1 ? '1 round' : `${g.rounds} round`}` : GOAL_NAMES[g.type].toLowerCase();
const SCENE_NAMES: Record<Line['scene'], string> = { bedroom: 'Cameretta', crt: 'Monitor', map: 'Mappa', black: 'Nero' };

/** Opens the menu, at start and on every return from a screen; 'campaign' lands on the chapter list. */
export function showMenu(go: {
  testBattle: (roster: RosterUnit[], map: MapData, mission?: Mission) => void;
  pvp: (roster: RosterUnit[], id: string, state: PvpState) => void;
  campaign: (roster: RosterUnit[], chapter: Chapter) => void;
  editor: () => void;
}, after?: 'campaign') {
  const root = document.getElementById('menu')!;
  let player: Account;
  let selected = '';
  /** last failed request, shown on the current screen */
  let error = '';
  /** shop: item waiting for a second tap to confirm, and the last purchase */
  let pending = '';
  let notice = '';

  const errorLine = () => el('p', { className: 'error', role: 'alert', textContent: error, hidden: !error });

  const enter = (account: Account) => {
    player = account;
    selected = player.roster[0].id;
    error = '';
    void backdrop(player.roster);
    void api.music().then(setLibrary, () => { /* no music list: the menu works silently */ });
    main();
    // back from a chapter: straight to the chapter list
    if (after === 'campaign') void campaign();
  };

  /** Sends a change to the server, then redraws the screen with the new state or with the error. */
  const run = async (request: Promise<Player>, redraw: () => void) => {
    try {
      player = { ...player, ...(await request) };
      error = '';
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return auth();
      error = (e as Error).message;
    }
    redraw();
  };

  const auth = (message = '', typed = '') => {
    if (!stopBackdrop) void backdrop(DEFAULT_ROSTER);
    const email = el('input', { type: 'email', name: 'email', autocomplete: 'email', required: true, placeholder: 'Email', value: typed });
    const password = el('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true, minLength: 8, placeholder: 'Password (almeno 8 caratteri)' });
    const show = el('button', {
      type: 'button', className: 'reveal', textContent: 'Mostra',
      onclick: () => { const hidden = password.type === 'password'; password.type = hidden ? 'text' : 'password'; show.textContent = hidden ? 'Nascondi' : 'Mostra'; },
    });
    const problem = el('p', { className: 'error', role: 'alert', textContent: message, hidden: !message });
    const send = async (request: (email: string, password: string) => Promise<Account>) => {
      // our own messages, in the game's style, instead of the browser's tooltip
      const bad = !email.validity.valid ? [email, 'Scrivi un indirizzo email valido.'] as const
        : !password.validity.valid ? [password, 'La password deve avere almeno 8 caratteri.'] as const : null;
      if (bad) {
        problem.textContent = bad[1];
        problem.hidden = false;
        return bad[0].focus();
      }
      try {
        enter(await request(email.value, password.value));
      } catch (e) {
        auth((e as Error).message, email.value);
      }
    };
    const form = el('form', { className: 'menu-main auth', noValidate: true },
      el('h1', { className: 'title', textContent: 'Tactics' }),
      email, el('div', { className: 'pw' }, password, show),
      problem,
      el('button', { className: 'menu-btn primary', type: 'submit', textContent: 'Accedi' }),
      el('p', { className: 'hint or', textContent: 'Prima volta qui?' }),
      el('button', { className: 'menu-btn', type: 'button', textContent: 'Crea account', onclick: () => void send(api.register) }),
    );
    form.onsubmit = e => { e.preventDefault(); void send(api.login); };
    root.replaceChildren(form);
  };

  const boot = async () => {
    root.replaceChildren(el('div', { className: 'menu-main' }, el('p', { className: 'hint', textContent: 'Caricamento…' })));
    try {
      enter(await api.me());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return auth();
      root.replaceChildren(el('div', { className: 'menu-main' },
        el('p', { className: 'error', role: 'alert', textContent: (e as Error).message }),
        el('button', { className: 'menu-btn primary', textContent: 'Riprova', onclick: () => void boot() }),
      ));
    }
  };

  const main = () => {
    pvpWait++;
    music('menu'); // also stops an admin preview
    error = '';
    pending = notice = '';
    root.replaceChildren(
      el('div', { className: 'menu-main' },
        el('h1', { className: 'title', textContent: 'Tactics' }),
        el('p', { className: 'account' }, `${player.email}, `, el('b', { textContent: `${player.gold} oro` })),
        el('button', { className: 'menu-btn', textContent: 'Caserma', onclick: barracks }),
        el('button', { className: 'menu-btn', textContent: 'Negozio', onclick: shop }),
        el('button', { className: 'menu-btn primary', textContent: 'Campagna', onclick: () => void campaign() }),
        el('button', { className: 'menu-btn', textContent: 'Missioni giornaliere', onclick: () => void missions() }),
        el('button', { className: 'menu-btn', textContent: 'PvP', onclick: () => pvp() }),
        el('button', { className: 'menu-btn', textContent: 'Battaglia di prova', onclick: () => void pickMap() }),
        ...(player.admin ? [
          el('button', { className: 'menu-btn', textContent: 'Gestisci missioni', onclick: () => void manageMissions(api.missions()) }),
          el('button', { className: 'menu-btn', textContent: 'Gestisci campagna', onclick: () => void manageCampaign(api.campaign().then(c => c.chapters)) }),
          el('button', { className: 'menu-btn', textContent: 'Musiche', onclick: () => void musicAdmin(api.music()) }),
          el('button', { className: 'menu-btn', textContent: 'Editor mappe', onclick: () => { leaveMenu(); go.editor(); } }),
          el('button', { className: 'menu-btn', textContent: 'Utenti', onclick: () => void users(api.users()) }),
        ] : []),
        el('button', { className: 'menu-btn', textContent: 'Esci', onclick: () => void api.logout().then(() => auth(), e => auth((e as Error).message)) }),
        settingsRow(),
      ),
    );
  };

  /** Graphics and sound toggles. Graphics apply from the next scene. */
  const settingsRow = () => {
    const s = settings();
    const toggle = (label: string, on: boolean, flip: () => void) => el('button', {
      className: 'toggle', type: 'button', onclick: () => { flip(); play('select'); main(); },
      ariaPressed: String(on),
    }, `${label}: `, el('b', { textContent: on ? (label === 'Grafica' ? 'piena' : 'acceso') : (label === 'Grafica' ? 'leggera' : 'spento') }));
    return el('div', { className: 'settings' },
      toggle('Grafica', s.fx, () => { saveSettings({ ...s, fx: !s.fx }); void backdrop(player.roster); }),
      toggle('Audio', s.sound, () => saveSettings({ ...s, sound: !s.sound })),
    );
  };

  const fight = (map: MapData, mission?: Mission) => { leaveMenu(); go.testBattle(player.roster, map, mission); };

  /** Loads missions and maps together; the maps are needed to start a mission and to name its map. */
  const loadMissions = async (request: Promise<Mission[]>, shown: Mission[]) => {
    try {
      const [list] = await Promise.all([request, loadMaps(player.admin)]);
      error = '';
      return list;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null;
      error = (e as Error).message;
      return shown;
    }
  };
  const mapName = (id: string) => allMaps().find(m => m.id === id)?.name;

  /** PvP: search the lobby, open a room with a code, or join a friend's code. */
  let pvpWait = 0; // bumped to stop the poll of a wait screen that was left
  const pvp = () => {
    pvpWait++;
    const code = el('input', { className: 'field', placeholder: 'Codice', ariaLabel: 'Codice dell\'amico', maxLength: 6, autocapitalize: 'characters', autocomplete: 'off' });
    const join = el('form', { className: 'mission-form' }, code, el('button', { className: 'menu-btn', type: 'submit', textContent: 'Entra con il codice' }));
    join.onsubmit = e => { e.preventDefault(); void waitMatch(api.pvpJoin(code.value)); };
    root.replaceChildren(
      el('div', { className: 'barracks' },
        el('header', {},
          el('button', { className: 'back', textContent: '← Menu', onclick: main }),
          el('h2', { textContent: 'PvP' }),
        ),
        errorLine(),
        el('p', { className: 'hint wide', textContent: 'Tutte le unità combattono al livello 5, con passive ed equipaggiamento. Niente XP né oro: si gioca per vincere.' }),
        el('div', { className: 'pvp-actions' },
          el('button', { className: 'menu-btn primary', textContent: 'Cerca un avversario', onclick: () => void waitMatch(api.pvpQueue()) }),
          el('button', { className: 'menu-btn', textContent: 'Crea una stanza per un amico', onclick: () => void waitMatch(api.pvpRoom()) }),
          join,
        ),
      ),
    );
  };

  /** Waits in the lobby or in a room until someone joins, then starts the match. */
  const waitMatch = async (request: Promise<{ id: string }>) => {
    const gen = ++pvpWait;
    let id: string;
    try {
      ({ id } = await request);
      error = '';
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return auth();
      error = (e as Error).message;
      return pvp();
    }
    const cancel = () => { pvpWait++; void api.pvpLeave(id).catch(() => {}); pvp(); };
    let shownCode: string | null | undefined;
    while (gen === pvpWait) {
      let st: PvpState;
      try {
        st = await api.pvpState(id);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return auth();
        if (e instanceof ApiError && e.status === 404) { error = 'La stanza è stata chiusa'; return pvp(); }
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      if (gen !== pvpWait) return;
      if (st.status !== 'waiting') {
        play('select');
        leaveMenu();
        return go.pvp(player.roster, id, st);
      }
      if (shownCode !== st.code) {
        shownCode = st.code;
        const copy = el('button', { className: 'back', textContent: 'Copia' });
        copy.onclick = () => void navigator.clipboard?.writeText(st.code!).then(() => { copy.textContent = 'Copiato'; }, () => {});
        root.replaceChildren(
          el('div', { className: 'menu-main pvp-wait' },
            ...(st.code
              ? [el('p', { className: 'hint', textContent: 'Manda questo codice a un amico:' }), el('div', { className: 'room-code', textContent: st.code }), copy]
              : [el('h2', { textContent: 'In cerca di un avversario…' }), el('p', { className: 'hint', textContent: 'Appena entra qualcun altro in coda, si parte.' })]),
            el('button', { className: 'menu-btn', textContent: 'Annulla', onclick: cancel }),
          ),
        );
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  };

  /** The story, chapter by chapter: each opens when the one before is won, and pays once. */
  const campaign = async () => {
    let cleared: string[], chapters: Chapter[];
    try {
      ({ cleared, chapters } = await api.campaign());
      error = '';
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return auth();
      error = (e as Error).message;
      [cleared, chapters] = [[], []];
    }
    const order = chapters.map(c => c.id);
    root.replaceChildren(
      el('div', { className: 'barracks' },
        el('header', {},
          el('button', { className: 'back', textContent: '← Menu', onclick: main }),
          el('h2', { textContent: 'Cronache di Valdombra' }),
        ),
        errorLine(),
        el('div', { className: 'chapters' },
          ...chapters.map((ch, i) => {
            const won = cleared.includes(ch.id), open = chapterOpen(order, cleared, ch.id) && !!ch.map;
            const state = !ch.map ? 'In manutenzione: manca la mappa'
              : won ? 'Vinto · rigioca quando vuoi, senza ricompensa'
              : open ? `+${ch.gold} oro e XP alla prima vittoria${ch.unlock ? ' · un nuovo alleato' : ''}`
              : `Vinci prima «${chapters[i - 1].title}»`;
            return el('button', {
              className: `chapter${won ? ' won' : open ? ' next' : ''}`, disabled: !open,
              onclick: () => { play('select'); leaveMenu(); go.campaign(player.roster, ch); },
            },
              el('span', { className: 'ch-label', textContent: ch.label }),
              el('span', { className: 'ch-title', textContent: ch.title }),
              el('span', { className: 'ch-blurb', textContent: ch.blurb }),
              el('span', { className: 'ch-state', textContent: state }),
            );
          }),
          el('p', { className: 'hint wide', textContent: 'Continua… I prossimi capitoli sono in lavorazione.' }),
        ),
      ),
    );
  };

  /** Today's daily missions: each pays XP and gold once a day, on a win. */
  const missions = async () => {
    const list = await loadMissions(api.missions(), []);
    if (!list) return auth();
    root.replaceChildren(
      el('div', { className: 'barracks' },
        el('header', {},
          el('button', { className: 'back', textContent: '← Menu', onclick: main }),
          el('h2', { textContent: 'Missioni giornaliere' }),
        ),
        errorLine(),
        el('p', { className: 'hint wide', textContent: 'Ogni missione vinta dà XP e oro, una volta al giorno. Si riparte a mezzanotte.' }),
        el('div', { className: 'map-list' },
          ...list.map(m => {
            const map = allMaps().find(x => x.id === m.mapId);
            return el('button', { className: 'roster-item', disabled: m.done || !map, onclick: () => map && fight(map, m) },
              el('span', { className: 'rn', textContent: m.name }),
              el('span', { className: 'rc', textContent: m.done ? 'Vinta oggi · torna domani' : `+${m.gold} oro e XP · ${map?.name ?? 'mappa mancante'}` }),
              el('span', { className: 'rc', textContent: enemySummary(m.enemies) }),
              ...(m.recruit && !player.roster.some(u => u.id === `m-${m.id}`)
                ? [el('span', { className: 'rc', textContent: `Alla prima vittoria si unisce ${m.recruit.name}, ${raceName(m.recruit.raceId)} ${CLASSES[m.recruit.classId].name}` })] : []),
            );
          }),
          ...(list.length ? [] : [el('p', { className: 'hint', textContent: 'Oggi non ci sono missioni. Allenati con la battaglia di prova.' })]),
        ),
      ),
    );
  };

  /** Admin only: create, edit and delete daily missions. The draft survives the redraw after a failed create. */
  let draft: {
    id: string | null; name: string; mapId: string; gold: number; enemies: MissionEnemy[]; raceId: string; classId: string; level: number; trackId: string | null;
    recruit: { on: boolean; name: string; raceId: string; classId: string };
  } | null = null;
  const manageMissions = async (request: Promise<Mission[]>, shown: Mission[] = []) => {
    const list = await loadMissions(request, shown);
    if (!list) return auth();
    const maps = allMaps();
    if (draft?.id && !list.some(m => m.id === draft!.id)) draft = null;
    if (!draft || !maps.some(m => m.id === draft!.mapId)) draft = {
      id: null, name: '', mapId: maps[0].id, gold: 50, enemies: defaultEnemies(maps[0]), raceId: DEFAULT_RACE, classId: 'warrior', level: 1, trackId: null,
      recruit: { on: false, name: '', raceId: 'corvid', classId: 'lancer' },
    };
    const d = draft;
    const current = () => maps.find(m => m.id === d.mapId)!;

    const name = el('input', { className: 'field', placeholder: 'Nome della missione', ariaLabel: 'Nome della missione', maxLength: 60, required: true, value: d.name, oninput: () => { d.name = name.value; } });
    const map = el('select', { className: 'field', ariaLabel: 'Mappa', onchange: () => { d.mapId = map.value; d.enemies = defaultEnemies(current()); foes.draw(); } },
      ...maps.map(m => el('option', { value: m.id, textContent: m.name, selected: m.id === d.mapId })));
    const gold = el('input', { className: 'field', type: 'number', min: '0', max: '10000', step: '1', value: String(d.gold), ariaLabel: 'Oro', oninput: () => { d.gold = Number(gold.value); } });
    const tracks = getLibrary().tracks;
    if (!tracks.some(t => t.id === d.trackId)) d.trackId = null;
    const track = el('select', { className: 'field', ariaLabel: 'Musica', onchange: () => { d.trackId = track.value || null; } },
      el('option', { value: '', textContent: 'Musica: quella delle battaglie' }),
      ...tracks.map(t => el('option', { value: t.id, textContent: `Musica: ${t.name}`, selected: t.id === d.trackId })));
    const rc = d.recruit;
    const recruitName = el('input', { className: 'field', placeholder: 'Nome della recluta', ariaLabel: 'Nome della recluta', maxLength: 20, value: rc.name, oninput: () => { rc.name = recruitName.value; } });
    const recruitClass = el('select', { className: 'field', ariaLabel: 'Classe della recluta', onchange: () => { rc.classId = recruitClass.value; } });
    const fillRecruitClasses = () => {
      const ok = baseClassesOf(rc.raceId);
      if (!ok.some(c => c.id === rc.classId)) rc.classId = ok[0].id;
      recruitClass.replaceChildren(...ok.map(c => el('option', { value: c.id, textContent: c.name, selected: c.id === rc.classId })));
    };
    fillRecruitClasses();
    const recruitRace = el('select', { className: 'field', ariaLabel: 'Razza della recluta', onchange: () => { rc.raceId = recruitRace.value; fillRecruitClasses(); } },
      ...Object.values(RACES).map(r => el('option', { value: r.id, textContent: r.name, selected: r.id === rc.raceId })));
    const recruitFields = el('div', { className: 'brush', hidden: !rc.on }, recruitName, recruitRace, recruitClass);
    const recruitOn = el('input', { type: 'checkbox', checked: rc.on, onchange: () => { rc.on = recruitOn.checked; recruitFields.hidden = !rc.on; recruitName.required = rc.on; } });
    recruitName.required = rc.on;
    const foes = enemyEditor(d, current);

    const form = el('form', { className: 'mission-form' },
      name, map, el('label', {}, gold, ' oro'), track,
      foes.node,
      el('div', { className: 'enemy-editor' },
        el('label', { className: 'hint' }, recruitOn, ' Alla prima vittoria si unisce una recluta'),
        recruitFields,
      ),
      ...(d.id ? [el('button', { className: 'menu-btn', type: 'button', textContent: 'Annulla modifica', onclick: () => { draft = null; void manageMissions(Promise.resolve(list)); } })] : []),
      el('button', { className: 'menu-btn primary', type: 'submit', textContent: d.id ? 'Salva modifiche' : 'Crea missione' }),
    );
    form.onsubmit = e => {
      e.preventDefault();
      const m = {
        name: d.name, mapId: d.mapId, gold: d.gold, enemies: d.enemies, trackId: d.trackId,
        recruit: rc.on ? { name: rc.name, raceId: rc.raceId, classId: rc.classId } : null,
      };
      const created = (d.id ? api.updateMission(d.id, m) : api.createMission(m)).then(l => { draft = null; return l; });
      void manageMissions(created, list);
    };
    root.replaceChildren(
      el('div', { className: 'barracks' },
        el('header', {},
          el('button', { className: 'back', textContent: '← Menu', onclick: main }),
          el('h2', { textContent: `Gestisci missioni · ${list.length}` }),
        ),
        errorLine(),
        form,
        el('div', { className: 'user-list' },
          ...list.map(m => el('div', { className: 'user-row' },
            el('span', { className: 'rn', textContent: m.name }),
            el('span', { className: 'rc', textContent: `${mapName(m.mapId) ?? 'mappa mancante'} · +${m.gold} oro · ${enemySummary(m.enemies)}${m.recruit ? ` · recluta ${m.recruit.name}` : ''}${trackName(m.trackId) ? ` · ♪ ${trackName(m.trackId)}` : ''}` }),
            el('button', {
              className: 'back', textContent: 'Modifica',
              onclick: () => {
                draft = {
                  ...draft!, id: m.id, name: m.name, mapId: m.mapId, gold: m.gold, enemies: m.enemies.map(e => ({ ...e, pos: { ...e.pos } })), trackId: m.trackId,
                  recruit: m.recruit ? { on: true, ...m.recruit } : { on: false, name: '', raceId: 'corvid', classId: 'lancer' },
                };
                void manageMissions(Promise.resolve(list));
                window.scrollTo(0, 0);
              },
            }),
            el('button', {
              className: 'back', textContent: 'Elimina',
              onclick: () => confirm(`Eliminare la missione "${m.name}"?`) && void manageMissions(api.deleteMission(m.id), list),
            }),
          )),
        ),
      ),
    );
  };

  /** Admin only: create, edit, reorder and delete campaign chapters. The draft survives the redraw after a failed save. */
  type ChapterDraft = Omit<ChapterInput, 'goal' | 'unlock'> & {
    id: string | null; mapId: string; raceId: string; classId: string; level: number;
    goalType: Goal['type']; rounds: number; cells: Pos[]; boss: number; editingCells: boolean;
    unlockOn: boolean; unlock: Omit<RosterUnit, 'id'>; unlockLevel: number;
  };
  let chapterDraft: ChapterDraft | null = null;
  const newUnlock = (): Omit<RosterUnit, 'id'> => ({ name: '', classId: 'warrior', xp: { warrior: xpToReach(3) }, passive: null });
  const toDraft = (ch: Chapter | null, mapId: string, map: MapData): ChapterDraft => {
    const g = ch?.goal ?? { type: 'rout' };
    const { id: _, ...unlock } = ch?.unlock ?? { id: '', ...newUnlock() };
    return {
      id: ch?.id ?? null, mapId, label: ch?.label ?? '', title: ch?.title ?? '', blurb: ch?.blurb ?? '', gold: ch?.gold ?? 150, crt: !!ch?.crt,
      enemies: ch ? ch.enemies.map(e => ({ ...e, pos: { ...e.pos } })) : defaultEnemies(map), required: [...(ch?.required ?? [])],
      before: (ch?.before ?? []).map(l => ({ ...l })), after: (ch?.after ?? []).map(l => ({ ...l })),
      raceId: DEFAULT_RACE, classId: 'warrior', level: 1,
      goalType: g.type, rounds: g.type === 'survive' ? g.rounds : 5, cells: g.type === 'reach' ? g.cells.map(c => ({ ...c })) : [],
      boss: g.type === 'boss' ? Number(g.unitId.slice(5)) : 0, editingCells: false,
      unlockOn: !!ch?.unlock, unlock, unlockLevel: classLevel({ id: '', ...unlock }, unlock.classId),
    };
  };

  const manageCampaign = async (request: Promise<Chapter[]>, shown: Chapter[] = []) => {
    let list: Chapter[];
    try {
      [list] = await Promise.all([request, loadMaps(player.admin)]);
      error = '';
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return auth();
      error = (e as Error).message;
      list = shown;
    }
    const maps = allMaps().filter(m => !BUILTIN_MAPS.some(b => b.id === m.id));
    if (!maps.length) {
      error = 'Prima crea una mappa con l\'editor mappe';
      return root.replaceChildren(el('div', { className: 'barracks' }, el('header', {}, el('button', { className: 'back', textContent: '← Menu', onclick: main }), el('h2', { textContent: 'Gestisci campagna' })), errorLine()));
    }
    if (chapterDraft?.id && !list.some(c => c.id === chapterDraft!.id)) chapterDraft = null;
    if (!chapterDraft || !maps.some(m => m.id === chapterDraft!.mapId)) chapterDraft = toDraft(null, maps[0].id, maps[0]);
    const d = chapterDraft;
    const current = () => maps.find(m => m.id === d.mapId)!;
    const redraw = () => void manageCampaign(Promise.resolve(list), list);

    const input = (label: string, key: 'label' | 'title' | 'blurb', max: number) => {
      const i = el('input', { className: 'field', placeholder: label, ariaLabel: label, maxLength: max, required: true, value: d[key], oninput: () => { d[key] = i.value; } });
      return i;
    };
    const map = el('select', { className: 'field', ariaLabel: 'Mappa', onchange: () => { d.mapId = map.value; d.enemies = defaultEnemies(current()); d.cells = []; redraw(); } },
      ...maps.map(m => el('option', { value: m.id, textContent: m.name, selected: m.id === d.mapId })));
    const gold = el('input', { className: 'field', type: 'number', min: '0', max: '10000', step: '1', value: String(d.gold), ariaLabel: 'Oro', oninput: () => { d.gold = Number(gold.value); } });
    const crt = el('input', { type: 'checkbox', checked: d.crt, onchange: () => { d.crt = crt.checked; } });

    // goal: the boss list follows the enemies, the cells are picked on the grid
    const boss = el('select', { className: 'field', ariaLabel: 'Boss', onchange: () => { d.boss = Number(boss.value); } });
    const fillBoss = () => {
      if (d.boss >= d.enemies.length) d.boss = 0;
      boss.replaceChildren(...d.enemies.map((e, i) => el('option', {
        value: String(i), selected: i === d.boss, textContent: `Boss: ${e.name ?? `${raceName(e.raceId)} ${CLASSES[e.classId].name}`}, livello ${e.level} (${e.pos.x},${e.pos.y})`,
      })));
    };
    const foes = enemyEditor(d, current, { goal: { cells: () => d.goalType === 'reach' ? d.cells : null, editing: () => d.goalType === 'reach' && d.editingCells }, onChange: fillBoss });
    fillBoss();
    const rounds = el('input', { className: 'field', type: 'number', min: '1', max: '30', step: '1', value: String(d.rounds), ariaLabel: 'Round', oninput: () => { d.rounds = Number(rounds.value); } });
    const cellsToggle = el('button', {
      type: 'button', className: 'back', ariaPressed: String(d.editingCells),
      textContent: d.editingCells ? 'Fatto: torna ai nemici' : `Scegli le caselle (${d.cells.length})`,
      onclick: () => { d.editingCells = !d.editingCells; redraw(); },
    });
    const goalType = el('select', { className: 'field', ariaLabel: 'Obiettivo', onchange: () => { d.goalType = goalType.value as Goal['type']; d.editingCells = false; redraw(); } },
      ...(Object.keys(GOAL_NAMES) as Goal['type'][]).map(t => el('option', { value: t, textContent: `Obiettivo: ${GOAL_NAMES[t]}`, selected: t === d.goalType })));
    const goalExtra = d.goalType === 'survive' ? [el('label', {}, rounds, ' round')] : d.goalType === 'boss' ? [boss] : d.goalType === 'reach' ? [cellsToggle] : [];

    // required units: the starting roster plus what the chapters before this one unlock
    const at = d.id ? list.findIndex(c => c.id === d.id) : list.length;
    const pool = [...DEFAULT_ROSTER, ...list.slice(0, at).flatMap(c => c.unlock ? [c.unlock] : [])];
    const required = el('div', { className: 'brush' }, el('span', { className: 'hint', textContent: 'Devono combattere:' }),
      ...pool.map(u => {
        const box = el('input', { type: 'checkbox', checked: d.required.includes(u.id), onchange: () => { d.required = box.checked ? [...d.required, u.id] : d.required.filter(id => id !== u.id); } });
        return el('label', {}, box, ` ${u.name}`);
      }));

    // the unlock keeps its XP until its class or level changes, so a multi-class unit survives a text edit
    const un = d.unlock;
    const resetXp = () => { un.xp = { [un.classId]: xpToReach(d.unlockLevel) }; };
    const unName = el('input', { className: 'field', placeholder: 'Nome dell\'alleato', ariaLabel: 'Nome dell\'alleato', maxLength: 20, value: un.name, oninput: () => { un.name = unName.value; } });
    const unClass = el('select', { className: 'field', ariaLabel: 'Classe dell\'alleato', onchange: () => { un.classId = unClass.value; resetXp(); } });
    const fillUnClasses = () => {
      const ok = baseClassesOf(un.raceId ?? DEFAULT_RACE);
      if (!ok.some(c => c.id === un.classId) && !allowedRaces(un.classId).includes(un.raceId ?? DEFAULT_RACE)) { un.classId = ok[0].id; resetXp(); }
      const opts = ok.some(c => c.id === un.classId) ? ok : [CLASSES[un.classId], ...ok];
      unClass.replaceChildren(...opts.map(c => el('option', { value: c.id, textContent: c.name, selected: c.id === un.classId })));
    };
    fillUnClasses();
    const unRace = el('select', { className: 'field', ariaLabel: 'Razza dell\'alleato', onchange: () => { un.raceId = unRace.value; fillUnClasses(); } },
      ...Object.values(RACES).map(r => el('option', { value: r.id, textContent: r.name, selected: r.id === (un.raceId ?? DEFAULT_RACE) })));
    const unLevel = el('input', { className: 'field', type: 'number', min: '1', max: String(MAX_CLASS_LEVEL), step: '1', value: String(d.unlockLevel), ariaLabel: 'Livello dell\'alleato',
      oninput: () => { d.unlockLevel = Number(unLevel.value); resetXp(); } });
    const unFields = el('div', { className: 'brush', hidden: !d.unlockOn }, unName, unRace, unClass, el('label', {}, 'livello ', unLevel));
    const unOn = el('input', { type: 'checkbox', checked: d.unlockOn, onchange: () => { d.unlockOn = unOn.checked; unFields.hidden = !d.unlockOn; unName.required = d.unlockOn; } });
    unName.required = d.unlockOn;

    /** One row per line of a cutscene; the block redraws itself so typing elsewhere keeps its focus. */
    const linesEditor = (lines: Line[], title: string) => {
      const box = el('div', { className: 'enemy-editor' });
      const draw = () => box.replaceChildren(
        el('span', { className: 'hint', textContent: `${title} · ${lines.length === 1 ? '1 battuta' : `${lines.length} battute`}` }),
        ...lines.map((l, i) => {
          const scene = el('select', { className: 'field', ariaLabel: 'Scena', onchange: () => { l.scene = scene.value as Line['scene']; } },
            ...SCENES.map(sc => el('option', { value: sc, textContent: SCENE_NAMES[sc], selected: sc === l.scene })));
          const who = el('input', { className: 'field', placeholder: 'Narratore', ariaLabel: 'Chi parla', maxLength: 20, value: l.who ?? '', oninput: () => { if (who.value.trim()) l.who = who.value; else delete l.who; } });
          const text = el('input', { className: 'field line-text', placeholder: 'Testo', ariaLabel: 'Testo', maxLength: 200, required: true, value: l.text, oninput: () => { l.text = text.value; } });
          const fx = el('select', { className: 'field', ariaLabel: 'Effetto', onchange: () => { if (fx.value) l.fx = fx.value as Line['fx']; else delete l.fx; } },
            el('option', { value: '', textContent: 'Nessun effetto' }), ...FXS.map(f => el('option', { value: f, textContent: f, selected: f === l.fx })));
          const move = (to: number) => { [lines[i], lines[to]] = [lines[to], lines[i]]; draw(); };
          return el('div', { className: 'brush line-row' }, scene, who, text, fx,
            el('button', { type: 'button', className: 'back', textContent: '↑', ariaLabel: 'Sposta su', disabled: i === 0, onclick: () => move(i - 1) }),
            el('button', { type: 'button', className: 'back', textContent: '↓', ariaLabel: 'Sposta giù', disabled: i === lines.length - 1, onclick: () => move(i + 1) }),
            el('button', { type: 'button', className: 'back', textContent: '✕', ariaLabel: 'Elimina battuta', onclick: () => { lines.splice(i, 1); draw(); } }),
          );
        }),
        el('button', { type: 'button', className: 'back', textContent: '+ battuta', onclick: () => { lines.push({ scene: lines.at(-1)?.scene ?? 'map', text: '' }); draw(); } }),
      );
      draw();
      return box;
    };

    const form = el('form', { className: 'mission-form' },
      input('Etichetta, es. Capitolo 4', 'label', 30), input('Titolo', 'title', 60), input('Descrizione di una riga', 'blurb', 160),
      map, el('label', {}, gold, ' oro'), el('label', { className: 'hint' }, crt, ' Dentro il monitor della cameretta'),
      goalType, ...goalExtra,
      foes.node,
      required,
      el('div', { className: 'enemy-editor' }, el('label', { className: 'hint' }, unOn, ' Alla prima vittoria si unisce un alleato'), unFields),
      linesEditor(d.before, 'Prima della battaglia'),
      linesEditor(d.after, 'Dopo la vittoria'),
      ...(d.id ? [el('button', { className: 'menu-btn', type: 'button', textContent: 'Annulla modifica', onclick: () => { chapterDraft = null; redraw(); } })] : []),
      el('button', { className: 'menu-btn primary', type: 'submit', textContent: d.id ? 'Salva capitolo' : 'Crea capitolo' }),
    );
    form.onsubmit = e => {
      e.preventDefault();
      const goal: Goal = d.goalType === 'survive' ? { type: 'survive', rounds: d.rounds } : d.goalType === 'reach' ? { type: 'reach', cells: d.cells }
        : d.goalType === 'boss' ? { type: 'boss', unitId: `enemy${d.boss}` } : { type: 'rout' };
      const c = {
        mapId: d.mapId, label: d.label, title: d.title, blurb: d.blurb, gold: d.gold, crt: d.crt, enemies: d.enemies, goal,
        required: d.required, unlock: d.unlockOn ? d.unlock : null, before: d.before, after: d.after,
      };
      void manageCampaign((d.id ? api.updateChapter(d.id, c) : api.createChapter(c)).then(l => { chapterDraft = null; return l; }), list);
    };
    const edit = (ch: Chapter) => {
      const m = maps.find(x => x.id === ch.mapId) ?? maps[0];
      chapterDraft = toDraft(ch, m.id, m);
      redraw();
      window.scrollTo(0, 0);
    };
    root.replaceChildren(
      el('div', { className: 'barracks' },
        el('header', {},
          el('button', { className: 'back', textContent: '← Menu', onclick: main }),
          el('h2', { textContent: `Gestisci campagna · ${list.length === 1 ? '1 capitolo' : `${list.length} capitoli`}` }),
        ),
        errorLine(),
        form,
        el('div', { className: 'user-list' },
          ...list.map((ch, i) => el('div', { className: 'user-row' },
            el('span', { className: 'rn', textContent: `${ch.label} · ${ch.title}` }),
            el('span', { className: 'rc', textContent: `${mapName(ch.mapId) ?? 'mappa mancante'} · ${goalText(ch.goal)} · +${ch.gold} oro · ${enemySummary(ch.enemies)}${ch.unlock ? ` · sblocca ${ch.unlock.name}` : ''}` }),
            el('button', { className: 'back', textContent: '↑', ariaLabel: 'Sposta prima', disabled: i === 0, onclick: () => void manageCampaign(api.moveChapter(ch.id, -1), list) }),
            el('button', { className: 'back', textContent: '↓', ariaLabel: 'Sposta dopo', disabled: i === list.length - 1, onclick: () => void manageCampaign(api.moveChapter(ch.id, 1), list) }),
            el('button', { className: 'back', textContent: 'Modifica', onclick: () => edit(ch) }),
            el('button', {
              className: 'back', textContent: 'Elimina',
              onclick: () => confirm(`Eliminare il capitolo "${ch.title}"? Chi l'ha già vinto tiene ricompense e alleato.`) && void manageCampaign(api.deleteChapter(ch.id), list),
            }),
          )),
        ),
      ),
    );
  };

  const trackName = (id: string | null) => getLibrary().tracks.find(t => t.id === id)?.name;

  /** Admin only: save Strudel tracks, try them, pick the menu and battle music. The draft survives a failed save. */
  let trackDraft: { id: string | null; name: string; code: string } = { id: null, name: '', code: '' };
  const musicAdmin = async (request: Promise<Music>, after?: () => void) => {
    try {
      setLibrary(await request);
      error = '';
      after?.();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return auth();
      error = (e as Error).message;
    }
    const lib = getLibrary(), d = trackDraft;
    if (d.id && !lib.tracks.some(t => t.id === d.id)) trackDraft = { id: null, name: '', code: '' };
    const preview = (code: string) => playCode(code).then(() => { problem.hidden = true; }, e => {
      problem.textContent = `Errore nel codice: ${(e as Error).message}`;
      problem.hidden = false;
    });
    const problem = el('p', { className: 'error', role: 'alert', hidden: true });

    const slot = (s: 'menu' | 'battle', label: string) => {
      const pick = el('select', { className: 'field', ariaLabel: label, onchange: () => void musicAdmin(api.setMusicSlot(s, pick.value || null)) },
        el('option', { value: '', textContent: 'Nessuna (silenzio)' }),
        ...lib.tracks.map(t => el('option', { value: t.id, textContent: t.name, selected: t.id === lib[s] })));
      return el('label', {}, label, pick);
    };

    const name = el('input', { className: 'field', placeholder: 'Nome del brano', ariaLabel: 'Nome del brano', maxLength: 60, required: true, value: d.name, oninput: () => { d.name = name.value; } });
    const code = el('textarea', {
      className: 'field code', ariaLabel: 'Codice Strudel', required: true, maxLength: 20000, spellcheck: false, value: d.code,
      placeholder: 'Incolla qui il codice da strudel.cc', oninput: () => { d.code = code.value; },
    });
    const form = el('form', { className: 'mission-form' },
      name, code, problem,
      el('button', { className: 'menu-btn', type: 'button', textContent: 'Ascolta', onclick: () => void preview(d.code) }),
      el('button', { className: 'menu-btn', type: 'button', textContent: 'Stop', onclick: () => void playCode(null) }),
      ...(d.id ? [el('button', { className: 'menu-btn', type: 'button', textContent: 'Annulla modifica', onclick: () => { trackDraft = { id: null, name: '', code: '' }; void musicAdmin(Promise.resolve(lib)); } })] : []),
      el('button', { className: 'menu-btn primary', type: 'submit', textContent: d.id ? 'Salva modifiche' : 'Salva brano' }),
    );
    form.onsubmit = e => {
      e.preventDefault();
      const t = { name: d.name, code: d.code };
      void musicAdmin(d.id ? api.updateTrack(d.id, t) : api.createTrack(t), () => { trackDraft = { id: null, name: '', code: '' }; });
    };

    root.replaceChildren(
      el('div', { className: 'barracks' },
        el('header', {},
          el('button', { className: 'back', textContent: '← Menu', onclick: main }),
          el('h2', { textContent: `Musiche · ${lib.tracks.length}` }),
        ),
        errorLine(),
        el('div', { className: 'mission-form' }, slot('menu', 'Menu'), slot('battle', 'Battaglie')),
        el('p', { className: 'hint wide', textContent: 'Le missioni giornaliere possono avere una musica propria: si sceglie quando le crei.' }),
        form,
        el('div', { className: 'user-list' },
          ...lib.tracks.map(t => el('div', { className: 'user-row' },
            el('span', { className: 'rn', textContent: t.name }),
            el('span', { className: 'rc', textContent: [t.id === lib.menu && 'Menu', t.id === lib.battle && 'Battaglie'].filter(Boolean).join(' · ') || 'Non in uso di default' }),
            el('button', { className: 'back', textContent: 'Ascolta', onclick: () => void preview(t.code) }),
            el('button', { className: 'back', textContent: 'Modifica', onclick: () => { trackDraft = { ...t }; void musicAdmin(Promise.resolve(lib)); } }),
            el('button', {
              className: 'back', textContent: 'Elimina',
              onclick: () => confirm(`Eliminare "${t.name}"? Le missioni che la usano passano alla musica delle battaglie.`) && void musicAdmin(api.deleteTrack(t.id)),
            }),
          )),
        ),
      ),
    );
  };

  /** Admin only: list of accounts, with a button to give or take the admin role. */
  const users = async (request: Promise<User[]>, shown: User[] = []) => {
    let list = shown;
    try {
      list = await request;
      error = '';
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return auth();
      error = (e as Error).message;
    }
    root.replaceChildren(
      el('div', { className: 'barracks' },
        el('header', {},
          el('button', { className: 'back', textContent: '← Menu', onclick: main }),
          el('h2', { textContent: `Utenti · ${list.length}` }),
        ),
        errorLine(),
        el('div', { className: 'user-list' },
          ...list.map(u => {
            const me = u.email === player.email;
            return el('div', { className: 'user-row' },
              el('span', { className: 'rn', textContent: u.email }),
              el('span', { className: 'rc', textContent: `${u.admin ? 'Admin' : 'Giocatore'}${me ? ' · tu' : ''} · dal ${new Date(u.createdAt).toLocaleDateString('it-IT')}` }),
              ...(me ? [] : [el('button', {
                className: 'back', textContent: u.admin ? 'Togli admin' : 'Rendi admin',
                onclick: () => void users(api.setAdmin(u.id, !u.admin), list),
              })]),
            );
          }),
        ),
      ),
    );
  };

  const shop = () => {
    root.replaceChildren(
      el('div', { className: 'barracks' },
        el('header', {},
          el('button', { className: 'back', textContent: '← Menu', onclick: main }),
          el('h2', { textContent: `Negozio · ${player.gold} oro` }),
        ),
        errorLine(),
        el('p', { className: 'notice', role: 'status', textContent: notice, hidden: !notice }),
        el('div', { className: 'class-grid shop' },
          ...Object.values(ITEMS).map(i => {
            const missing = i.price - player.gold;
            const confirm = pending === i.id && missing <= 0;
            // two taps: the first asks, the second buys (a purchase cannot be undone)
            const buy = () => {
              if (!confirm) { pending = i.id; notice = ''; return shop(); }
              pending = '';
              void run(api.buy(i.id), () => { notice = error ? '' : `Comprato: ${i.name}. Equipaggialo in caserma.`; shop(); });
            };
            return el('button', { className: `class-card${confirm ? ' confirm' : ''}`, disabled: missing > 0, onclick: buy },
              el('span', { className: 'cn', textContent: i.name }),
              el('span', { className: 'cl', textContent: `${SLOT_LABELS[i.slot]}, ${itemBonus(i)}` }),
              compare(i),
              el('span', { className: 'cl', textContent: `Possedute: ${player.inventory[i.id] ?? 0}` }),
              el('span', { className: 'price', textContent: missing > 0 ? `${i.price} oro · mancano ${missing}` : confirm ? `Tocca di nuovo per comprare · ${i.price} oro` : `Compra · ${i.price} oro` }),
            );
          }),
        ),
      ),
    );
  };

  /** What the item would change on the unit selected in the barracks, against what it wears now. */
  const compare = (i: ItemDef) => {
    const unit = player.roster.find(u => u.id === selected) ?? player.roster[0];
    if (unit.equip?.[i.slot] === i.id) return el('span', { className: 'delta', textContent: `Già addosso a ${unit.name}` });
    const now = unitFromRoster(unit, 'A', { x: 0, y: 0 }, 'S').stats;
    const next = unitFromRoster({ ...unit, equip: { ...unit.equip, [i.slot]: i.id } }, 'A', { x: 0, y: 0 }, 'S').stats;
    const diffs = (Object.keys(STAT_SHORT) as (keyof Stats)[]).filter(k => next[k] !== now[k]);
    return el('span', { className: 'delta' }, `${unit.name}: `,
      ...diffs.flatMap((k, n) => [n ? ', ' : '', `${STAT_SHORT[k]} ${now[k]} `, el(next[k] > now[k] ? 'b' : 'em', { textContent: String(next[k]) })]));
  };

  const pickMap = async () => {
    try {
      await loadMaps(player.admin);
      error = '';
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return auth();
      error = `Mappe salvate non caricate: ${(e as Error).message}`;
    }
    const maps = allMaps();
    if (maps.length === 1 && !error) return fight(maps[0]);
    root.replaceChildren(
      el('div', { className: 'barracks' },
        el('header', {},
          el('button', { className: 'back', textContent: '← Menu', onclick: main }),
          el('h2', { textContent: 'Scegli la mappa' }),
        ),
        errorLine(),
        el('div', { className: 'map-list' },
          ...maps.map(m => el('button', { className: 'roster-item', onclick: () => fight(m) },
            el('span', { className: 'rn', textContent: m.name }),
            el('span', { className: 'rc', textContent: `${m.width}×${m.height} · fino a ${m.maxDeploy} unità` }),
          )),
        ),
      ),
    );
  };

  const update = (id: string, change: UnitChange) => void run(api.updateUnit(id, change), barracks);

  const barracks = () => {
    const roster = player.roster;
    const unit = roster.find(u => u.id === selected)!;
    const cls = CLASSES[unit.classId];
    const eff = unitFromRoster(unit, 'A', { x: 0, y: 0 }, 'S');

    const list = el('div', { className: 'roster' },
      ...roster.map(u => el('button', {
        className: `roster-item${u.id === selected ? ' sel' : ''}`,
        onclick: () => { selected = u.id; barracks(); },
      }, el('span', { className: 'rn', textContent: u.name }), el('span', { className: 'rc', textContent: `${raceName(u.raceId)} · ${CLASSES[u.classId].name} Lv ${classLevel(u, u.classId)}` }))),
    );

    const classes = el('div', { className: 'class-grid' },
      // only the classes of the unit's race
      ...Object.values(CLASSES).filter(c => allowedRaces(c.id).includes(raceOf(unit))).map(c => {
        const lvl = classLevel(unit, c.id), xp = unit.xp[c.id] ?? 0;
        const max = lvl >= MAX_CLASS_LEVEL;
        const pct = max ? 100 : (100 * (xp - xpToReach(lvl))) / (xpToReach(lvl + 1) - xpToReach(lvl));
        const missing = missingRequirements(unit, c.id);
        const active = c.id === unit.classId;
        return el('button', {
          className: `class-card${active ? ' sel' : ''}${missing.length ? ' locked' : ''}`,
          disabled: active || missing.length > 0,
          onclick: () => update(unit.id, { classId: c.id }),
        },
          el('span', { className: 'cn', textContent: c.name }),
          el('span', { className: 'cl', textContent: missing.length ? 'Bloccata' : `Lv ${lvl}${active ? ' · attiva' : ''} · ${max ? 'max' : `${xp - xpToReach(lvl)}/${xpToReach(lvl + 1) - xpToReach(lvl)} XP`}` }),
          missing.length
            ? el('span', { className: 'req', textContent: `Richiede ${missing.map(m => `${CLASSES[m.classId].name} ${m.level}`).join(' · ')}` })
            : el('span', { className: 'xpbar', title: max ? 'Livello massimo' : `${xp} / ${xpToReach(lvl + 1)} XP` }, Object.assign(el('span'), { style: `width:${pct}%` } as object)),
        );
      }),
    );

    const unlocked = unlockedPassives(unit);
    const passives = unlocked.length
      ? el('div', { className: 'class-pick' },
          el('button', { className: unit.passive === null ? 'sel' : '', textContent: 'Nessuna', onclick: () => update(unit.id, { passive: null }) }),
          ...unlocked.map(c => el('button', {
            className: unit.passive === c ? 'sel' : '',
            title: CLASSES[c].passive.description,
            onclick: () => update(unit.id, { passive: c }),
          }, CLASSES[c].passive.name, el('small', { textContent: CLASSES[c].passive.description }))),
        )
      : el('p', { className: 'hint', textContent: `Porta una classe al livello ${PASSIVE_LEVEL} per sbloccare la sua passiva.` });

    const equipment = SLOTS.flatMap(slot => {
      const current = unit.equip?.[slot];
      return [
        el('div', { className: 'label', textContent: SLOT_LABELS[slot] }),
        el('div', { className: 'class-pick' },
          el('button', { className: current ? '' : 'sel', textContent: 'Nessuna', onclick: () => update(unit.id, { equip: { [slot]: null } }) }),
          ...Object.values(ITEMS).filter(i => i.slot === slot && player.inventory[i.id]).map(i => {
            const free = current === i.id || freeCopies(player, i.id) > 0;
            return el('button', {
              className: current === i.id ? 'sel' : '', disabled: !free,
              onclick: () => update(unit.id, { equip: { [slot]: i.id } }),
            }, i.name, el('small', { textContent: free ? itemBonus(i) : 'In uso da altre unità' }));
          }),
        ),
      ];
    });
    const noItems = Object.keys(player.inventory).length ? [] : [el('p', { className: 'hint', textContent: 'Compra armi e armature al negozio.' })];

    // bars: the class's own value in parchment, what the equipment adds in brass
    const bare = unitFromRoster({ ...unit, equip: {} }, 'A', { x: 0, y: 0 }, 'S');
    const stats = el('div', { className: 'statbars' },
      ...STAT_LABELS.flatMap(([k, label]) => {
        const max = BAR_MAX[k], v = eff.stats[k], base = Math.min(v, bare.stats[k]);
        const bar = max
          ? el('span', { className: 'b' },
              Object.assign(el('i'), { style: `width:${(100 * Math.min(base, max)) / max}%` } as object),
              Object.assign(el('i'), { style: `left:${(100 * Math.min(base, max)) / max}%;width:${(100 * Math.max(0, Math.min(v, max) - base)) / max}%` } as object))
          : el('span');
        return [el('span', { className: 't', textContent: label }), bar, el('span', { className: 'v', textContent: String(v) })];
      }),
    );

    const actions = el('ul', { className: 'abilities' },
      ...unitActions({ classId: unit.classId, raceId: raceOf(unit) }).map(a => el('li', {}, el('b', { textContent: a.name }), ` · ${actionText(a)}`)),
    );

    root.replaceChildren(
      el('div', { className: 'barracks' },
        el('header', {},
          el('button', { className: 'back', textContent: '← Menu', onclick: main }),
          el('h2', { textContent: `Caserma · ${roster.length} unità` }),
        ),
        errorLine(),
        list,
        el('section', { className: 'detail' },
          el('div', { className: 'hero-unit' },
            pedestal(unit),
            el('div', {},
              el('h3', { textContent: unit.name }),
              el('p', { className: 'sub', textContent: `${raceName(unit.raceId)} · ${cls.name} Lv ${eff.level}` }),
              el('p', { className: 'hint', textContent: `${RACES[raceOf(unit)].trait.name}: ${RACES[raceOf(unit)].trait.description}` }),
              stats,
            ),
          ),
          el('div', { className: 'label', textContent: 'Classi' }), classes,
          el('div', { className: 'label', textContent: 'Abilità' }), actions,
          el('div', { className: 'label', textContent: 'Passiva (1 slot)' }), passives,
          ...equipment, ...noItems,
        ),
      ),
    );
  };

  root.hidden = false;
  document.getElementById('backdrop')!.hidden = false; // hidden by leaveMenu
  void boot();
}
