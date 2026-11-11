import {
  CLASSES, ITEMS, MAX_CLASS_LEVEL, PASSIVE_LEVEL, SLOTS, SLOT_LABELS, classLevel, freeCopies, itemBonus, missingRequirements, unitFromRoster,
  unlockedPassives, xpToReach, type MapData, type Player, type RosterUnit, type UnitChange,
} from '@tactics/core';
import { api, ApiError, type Account, type User } from './api';
import { allMaps, BUILTIN_MAPS } from './maps';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};

const STAT_LABELS = [
  ['maxHp', 'PV'], ['atk', 'Attacco'], ['def', 'Difesa'], ['mag', 'Magia'],
  ['speed', 'Velocità'], ['move', 'Movimento'], ['jump', 'Salto'],
] as const;

export function showMenu(go: { testBattle: (roster: RosterUnit[], map: MapData) => void; editor: () => void }) {
  const root = document.getElementById('menu')!;
  let player: Account;
  let selected = '';
  /** last failed request, shown on the current screen */
  let error = '';

  const errorLine = () => el('p', { className: 'error', role: 'alert', textContent: error, hidden: !error });

  const enter = (account: Account) => {
    player = account;
    selected = player.roster[0].id;
    error = '';
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

  const auth = (message = '') => {
    const email = el('input', { type: 'email', name: 'email', autocomplete: 'email', required: true, placeholder: 'Email' });
    const password = el('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true, minLength: 8, placeholder: 'Password (almeno 8 caratteri)' });
    const send = async (request: (email: string, password: string) => Promise<Account>) => {
      if (!form.reportValidity()) return;
      try {
        enter(await request(email.value, password.value));
      } catch (e) {
        auth((e as Error).message);
      }
    };
    const form = el('form', { className: 'menu-main auth' },
      el('h1', { className: 'title', textContent: 'Tactics' }),
      email, password,
      el('p', { className: 'error', role: 'alert', textContent: message, hidden: !message }),
      el('button', { className: 'menu-btn primary', type: 'submit', textContent: 'Accedi' }),
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
    root.replaceChildren(
      el('div', { className: 'menu-main' },
        el('h1', { className: 'title', textContent: 'Tactics' }),
        el('p', { className: 'account', textContent: `${player.email} · ${player.gold} oro` }),
        el('button', { className: 'menu-btn', textContent: 'Caserma', onclick: barracks }),
        el('button', { className: 'menu-btn', textContent: 'Negozio', onclick: shop }),
        el('button', {
          className: 'menu-btn primary', textContent: 'Battaglia di prova',
          onclick: pickMap,
        }),
        ...(player.admin ? [
          el('button', { className: 'menu-btn', textContent: 'Editor mappe', onclick: () => { root.hidden = true; go.editor(); } }),
          el('button', { className: 'menu-btn', textContent: 'Utenti', onclick: () => void users(api.users()) }),
        ] : []),
        el('button', { className: 'menu-btn', textContent: 'Esci', onclick: () => void api.logout().then(() => auth(), e => auth((e as Error).message)) }),
      ),
    );
  };

  const fight = (map: MapData) => { root.hidden = true; go.testBattle(player.roster, map); };

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
        el('div', { className: 'class-grid shop' },
          ...Object.values(ITEMS).map(i => {
            const missing = i.price - player.gold;
            return el('button', { className: 'class-card', disabled: missing > 0, onclick: () => void run(api.buy(i.id), shop) },
              el('span', { className: 'cn', textContent: i.name }),
              el('span', { className: 'cl', textContent: `${SLOT_LABELS[i.slot]} · ${itemBonus(i)}` }),
              el('span', { className: 'cl', textContent: `Possedute: ${player.inventory[i.id] ?? 0}` }),
              el('span', { className: 'price', textContent: missing > 0 ? `${i.price} oro · mancano ${missing}` : `Compra · ${i.price} oro` }),
            );
          }),
        ),
      ),
    );
  };

  const pickMap = () => {
    // the server refuses custom maps from anyone but the admin
    const maps = player.admin ? allMaps() : BUILTIN_MAPS;
    if (maps.length === 1) return fight(maps[0]);
    root.replaceChildren(
      el('div', { className: 'barracks' },
        el('header', {},
          el('button', { className: 'back', textContent: '← Menu', onclick: main }),
          el('h2', { textContent: 'Scegli la mappa' }),
        ),
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
          el('span', { className: 'cl', textContent: missing.length ? 'Bloccata' : `Lv ${lvl}${active ? ' · attiva' : ''}` }),
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

    const stats = el('table', { className: 'stats' },
      ...STAT_LABELS.map(([k, label]) => el('tr', {}, el('th', { textContent: label }), el('td', { textContent: String(eff.stats[k]) }))),
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
          el('h3', { textContent: unit.name }),
          el('div', { className: 'label', textContent: 'Classi' }), classes,
          el('div', { className: 'label', textContent: 'Passiva (1 slot)' }), passives,
          ...equipment, ...noItems,
          el('div', { className: 'label', textContent: `Statistiche · ${cls.name} Lv ${eff.level}` }), stats,
          el('div', { className: 'label', textContent: 'Abilità' }), actions,
        ),
      ),
    );
  };

  root.hidden = false;
  void boot();
}
