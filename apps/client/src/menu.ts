import { CLASSES, DEFAULT_ROSTER, parseRoster, type MapData, type RosterUnit } from '@tactics/core';
import { allMaps } from './maps';

const KEY = 'tactics.roster';

// shortcut: roster lives in localStorage until the backend exists; move to the server with accounts.
function loadRoster(): RosterUnit[] {
  try {
    return parseRoster(JSON.parse(localStorage.getItem(KEY) ?? 'null')) ?? structuredClone(DEFAULT_ROSTER);
  } catch {
    return structuredClone(DEFAULT_ROSTER);
  }
}

function saveRoster(r: RosterUnit[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* private mode: changes last for this session only */
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) => {
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
  let roster = loadRoster();
  let selected = roster[0].id;

  const main = () => {
    root.replaceChildren(
      el('div', { className: 'menu-main' },
        el('h1', { className: 'title', textContent: 'Tactics' }),
        el('button', { className: 'menu-btn', textContent: 'Caserma', onclick: barracks }),
        el('button', {
          className: 'menu-btn primary', textContent: 'Battaglia di prova',
          onclick: pickMap,
        }),
        el('button', { className: 'menu-btn', textContent: 'Editor mappe', onclick: () => { root.hidden = true; go.editor(); } }),
      ),
    );
  };

  const fight = (map: MapData) => { root.hidden = true; go.testBattle(roster, map); };

  const pickMap = () => {
    const maps = allMaps();
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

  const barracks = () => {
    const unit = roster.find(u => u.id === selected)!;
    const cls = CLASSES[unit.classId];

    const list = el('div', { className: 'roster' },
      ...roster.map(u => el('button', {
        className: `roster-item${u.id === selected ? ' sel' : ''}`,
        onclick: () => { selected = u.id; barracks(); },
      }, el('span', { className: 'rn', textContent: u.name }), el('span', { className: 'rc', textContent: CLASSES[u.classId].name }))),
    );

    const classes = el('div', { className: 'class-pick' },
      ...Object.values(CLASSES).map(c => el('button', {
        className: c.id === unit.classId ? 'sel' : '',
        textContent: c.name,
        onclick: () => {
          roster = roster.map(u => (u.id === unit.id ? { ...u, classId: c.id } : u));
          saveRoster(roster);
          barracks();
        },
      })),
    );

    const stats = el('table', { className: 'stats' },
      ...STAT_LABELS.map(([k, label]) => el('tr', {}, el('th', { textContent: label }), el('td', { textContent: String(cls.stats[k]) }))),
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
        list,
        el('section', { className: 'detail' },
          el('h3', { textContent: unit.name }),
          el('div', { className: 'label', textContent: 'Classe' }), classes,
          el('div', { className: 'label', textContent: 'Statistiche' }), stats,
          el('div', { className: 'label', textContent: 'Abilità' }), actions,
        ),
      ),
    );
  };

  root.hidden = false;
  main();
}
