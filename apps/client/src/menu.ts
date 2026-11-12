import {
  CLASSES, RACES, STATUSES, allowedRaces, chapterOpen, DEFAULT_ROSTER, raceOf, unitActions, ITEMS, MAX_CLASS_LEVEL, PASSIVE_LEVEL, SLOTS, SLOT_LABELS, classLevel, freeCopies, itemBonus, missingRequirements, unitFromRoster, unlockedPassives, xpToReach, type ActionDef, type Chapter, type ItemDef, type MapData, type Player, type RosterUnit, type Stats, type UnitChange,
} from '@tactics/core';
import { api, ApiError, type Account, type Mission, type PvpState } from './api';
import { allMaps, BUILTIN_MAPS, loadMaps } from './maps';
import { music, setLibrary } from './music';
import { play } from './sfx';
import { spriteDir } from './sprites';
import { reducedMotion, saveSettings, settings } from './theme';
import { el, enemySummary, raceName } from './ui';
import { showWorkshop } from './workshop';

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

/** Opens the menu, at start and on every return from a screen; 'campaign' lands on the chapter list, 'workshop' on the Officina. */
export function showMenu(go: {
  testBattle: (roster: RosterUnit[], map: MapData, mission?: Mission) => void;
  pvp: (roster: RosterUnit[], id: string, state: PvpState) => void;
  campaign: (roster: RosterUnit[], chapter: Chapter) => void;
  editor: () => void;
  rehearse: (roster: RosterUnit[], chapter: Chapter, trackId: string | null) => void;
}, after?: 'campaign' | 'workshop') {
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
    if (after === 'workshop' && player.admin) workshop();
  };

  /** The admin's tools, apart from the game. */
  const workshop = () => {
    pvpWait++;
    showWorkshop({
      root, player, back: main, auth: () => auth(),
      mapEditor: () => { leaveMenu(); go.editor(); },
      rehearse: (ch, trackId) => { leaveMenu(); go.rehearse(player.roster, ch, trackId); },
    });
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
        // play first, then get the squad ready
        el('button', { className: 'menu-btn primary', textContent: 'Campagna', onclick: () => void campaign() }),
        el('button', { className: 'menu-btn', textContent: 'Missioni giornaliere', onclick: () => void missions() }),
        el('button', { className: 'menu-btn', textContent: 'PvP', onclick: () => pvp() }),
        el('button', { className: 'menu-btn', textContent: 'Battaglia di prova', onclick: () => void pickMap() }),
        el('button', { className: 'menu-btn', textContent: 'Caserma', onclick: barracks }),
        el('button', { className: 'menu-btn', textContent: 'Negozio', onclick: shop }),
        ...(player.admin ? [el('button', { className: 'menu-btn workshop-btn', onclick: workshop }, 'Officina', el('small', { textContent: 'admin' }))] : []),
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
