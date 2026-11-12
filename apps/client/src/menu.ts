import {
  CLASSES, DEFAULT_ROSTER, ITEMS, isWalkable, MAX_CLASS_LEVEL, MAX_MISSION_ENEMIES, PASSIVE_LEVEL, SLOTS, SLOT_LABELS, classLevel, freeCopies, itemBonus, missingRequirements, unitFromRoster,
  unlockedPassives, xpToReach, type ItemDef, type MapData, type MissionEnemy, type Player, type RosterUnit, type Stats, type UnitChange,
} from '@tactics/core';
import { api, ApiError, type Account, type Mission, type User } from './api';
import { allMaps, BUILTIN_MAPS, loadMaps } from './maps';
import { play } from './sfx';
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

/** The unit's sprite turning on a lit pedestal; stops by itself once the screen is gone. */
function pedestal(classId: string) {
  const img = el('img', { alt: '', src: `units/${classId}/S.png`, width: 168, height: 168 });
  if (!reducedMotion()) {
    let f = 0;
    const spin = setInterval(() => {
      if (!img.isConnected) return clearInterval(spin);
      img.src = `units/${classId}/${FACINGS[f = (f + 1) % 4]}.png`;
    }, 1100);
  }
  return el('div', { className: 'pedestal' }, img);
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

export function showMenu(go: { testBattle: (roster: RosterUnit[], map: MapData, mission?: Mission) => void; editor: () => void }) {
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
    main();
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
    error = '';
    pending = notice = '';
    root.replaceChildren(
      el('div', { className: 'menu-main' },
        el('h1', { className: 'title', textContent: 'Tactics' }),
        el('p', { className: 'account' }, `${player.email}, `, el('b', { textContent: `${player.gold} oro` })),
        el('button', { className: 'menu-btn', textContent: 'Caserma', onclick: barracks }),
        el('button', { className: 'menu-btn', textContent: 'Negozio', onclick: shop }),
        el('button', { className: 'menu-btn primary', textContent: 'Missioni giornaliere', onclick: () => void missions() }),
        el('button', { className: 'menu-btn', textContent: 'Battaglia di prova', onclick: () => void pickMap() }),
        ...(player.admin ? [
          el('button', { className: 'menu-btn', textContent: 'Gestisci missioni', onclick: () => void manageMissions(api.missions()) }),
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
            );
          }),
          ...(list.length ? [] : [el('p', { className: 'hint', textContent: 'Oggi non ci sono missioni. Allenati con la battaglia di prova.' })]),
        ),
      ),
    );
  };

  /** Admin only: create and delete daily missions. The draft survives the redraw after a failed create. */
  let draft: { name: string; mapId: string; gold: number; enemies: MissionEnemy[]; classId: string; level: number } | null = null;
  const manageMissions = async (request: Promise<Mission[]>, shown: Mission[] = []) => {
    const list = await loadMissions(request, shown);
    if (!list) return auth();
    const maps = allMaps();
    if (!draft || !maps.some(m => m.id === draft!.mapId)) draft = { name: '', mapId: maps[0].id, gold: 50, enemies: defaultEnemies(maps[0]), classId: 'warrior', level: 1 };
    const d = draft;
    const current = () => maps.find(m => m.id === d.mapId)!;

    const name = el('input', { className: 'field', placeholder: 'Nome della missione', ariaLabel: 'Nome della missione', maxLength: 60, required: true, value: d.name, oninput: () => { d.name = name.value; } });
    const map = el('select', { className: 'field', ariaLabel: 'Mappa', onchange: () => { d.mapId = map.value; d.enemies = defaultEnemies(current()); drawGrid(); } },
      ...maps.map(m => el('option', { value: m.id, textContent: m.name, selected: m.id === d.mapId })));
    const gold = el('input', { className: 'field', type: 'number', min: '0', max: '10000', step: '1', value: String(d.gold), ariaLabel: 'Oro', oninput: () => { d.gold = Number(gold.value); } });
    const cls = el('select', { className: 'field', ariaLabel: 'Classe del prossimo nemico', onchange: () => { d.classId = cls.value; } },
      ...Object.values(CLASSES).map(c => el('option', { value: c.id, textContent: c.name, selected: c.id === d.classId })));
    const lvl = el('input', { className: 'field', type: 'number', min: '1', max: String(MAX_CLASS_LEVEL), step: '1', value: String(d.level), ariaLabel: 'Livello del prossimo nemico',
      oninput: () => { d.level = Number(lvl.value); } });
    const count = el('span', { className: 'hint' });
    const grid = el('div', { className: 'enemy-grid' });

    /** One button per cell: an empty walkable cell gets a new enemy, an enemy's cell loses it. */
    const drawGrid = () => {
      const m = current();
      grid.style.gridTemplateColumns = `repeat(${m.width}, 1fr)`;
      grid.replaceChildren(...m.heights.flatMap((row, y) => row.map((h, x) => {
        const i = d.enemies.findIndex(e => e.pos.x === x && e.pos.y === y);
        const foe = d.enemies[i];
        const mine = m.spawns.A.some(p => p.x === x && p.y === y);
        const b = el('button', {
          type: 'button', className: `cell t-${m.terrain[y][x]}${mine ? ' mine' : ''}${foe ? ' foe' : ''}`,
          disabled: mine || !isWalkable(m, { x, y }),
          title: foe ? `${CLASSES[foe.classId].name}, livello ${foe.level}` : mine ? 'Partenza del giocatore' : `Altezza ${h}`,
          textContent: foe ? `${CLASSES[foe.classId].name[0]}${foe.level}` : '',
          onclick: () => {
            if (foe) d.enemies.splice(i, 1);
            else if (d.enemies.length < MAX_MISSION_ENEMIES) d.enemies.push({ classId: d.classId, level: d.level, pos: { x, y } });
            drawGrid();
          },
        });
        b.style.setProperty('--h', String(h));
        return b;
      })));
      count.textContent = `${d.enemies.length === 1 ? '1 nemico' : `${d.enemies.length} nemici`}, massimo ${MAX_MISSION_ENEMIES}`;
    };
    drawGrid();

    const form = el('form', { className: 'mission-form' },
      name, map, el('label', {}, gold, ' oro'),
      el('div', { className: 'enemy-editor' },
        el('p', { className: 'hint', textContent: 'Tocca una casella per piazzare un nemico, toccalo di nuovo per toglierlo. In blu le partenze del giocatore.' }),
        el('div', { className: 'brush' }, el('span', { className: 'hint', textContent: 'Prossimo nemico:' }), cls, el('label', {}, 'livello ', lvl), count),
        grid,
      ),
      el('button', { className: 'menu-btn primary', type: 'submit', textContent: 'Crea missione' }),
    );
    form.onsubmit = e => {
      e.preventDefault();
      const created = api.createMission({ name: d.name, mapId: d.mapId, gold: d.gold, enemies: d.enemies }).then(l => { draft = null; return l; });
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
            el('span', { className: 'rc', textContent: `${mapName(m.mapId) ?? 'mappa mancante'} · +${m.gold} oro · ${enemySummary(m.enemies)}` }),
            el('button', {
              className: 'back', textContent: 'Elimina',
              onclick: () => confirm(`Eliminare la missione "${m.name}"?`) && void manageMissions(api.deleteMission(m.id), list),
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
      }, el('span', { className: 'rn', textContent: u.name }), el('span', { className: 'rc', textContent: `${CLASSES[u.classId].name} Lv ${classLevel(u, u.classId)}` }))),
    );

    const classes = el('div', { className: 'class-grid' },
      ...Object.values(CLASSES).map(c => {
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
      ...cls.actions.map(a => el('li', {},
        el('b', { textContent: a.name }),
        ` · ${a.effect === 'heal' ? 'cura' : 'danno'} · gittata ${a.minRange === a.maxRange ? a.maxRange : `${a.minRange}–${a.maxRange}`}${a.ranged ? '' : ' (corpo a corpo)'}`,
      )),
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
            pedestal(unit.classId),
            el('div', {},
              el('h3', { textContent: unit.name }),
              el('p', { className: 'sub', textContent: `${cls.name} Lv ${eff.level}` }),
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
  void boot();
}
