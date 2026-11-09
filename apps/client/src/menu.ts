import {
  CLASSES, MAX_CLASS_LEVEL, PASSIVE_LEVEL, classLevel, isUnlocked, missingRequirements, unitFromRoster, unlockedPassives, xpToReach,
  type MapData, type RosterUnit,
} from '@tactics/core';
import { allMaps } from './maps';
import { loadRoster, saveRoster } from './rosterStore';

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

  const update = (id: string, change: Partial<RosterUnit>) => {
    roster = roster.map(u => (u.id === id ? { ...u, ...change } : u));
    saveRoster(roster);
    barracks();
  };

  const barracks = () => {
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
        list,
        el('section', { className: 'detail' },
          el('h3', { textContent: unit.name }),
          el('div', { className: 'label', textContent: 'Classi' }), classes,
          el('div', { className: 'label', textContent: 'Passiva (1 slot)' }), passives,
          el('div', { className: 'label', textContent: `Statistiche · ${cls.name} Lv ${eff.level}` }), stats,
          el('div', { className: 'label', textContent: 'Abilità' }), actions,
        ),
      ),
    );
  };

  root.hidden = false;
  main();
}
