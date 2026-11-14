import {
  CLASSES, ITEMS, MAX_CLASS_LEVEL, PASSIVE_LEVEL, RACES, SLOTS, SLOT_LABELS, STATUSES, allowedRaces, classLevel, freeCopies, itemBonus, missingRequirements, raceOf,
  unitActions, unitFromRoster, unlockedPassives, xpToReach, type ActionDef, type RosterUnit, type Stats, type UnitChange,
} from '@tactics/core';
import { Fragment, useEffect, useState } from 'react';
import type { Account } from '../api';
import { spriteDir } from '../sprites';
import { reducedMotion } from '../theme';
import { raceName } from '../ui';
import { Page, type PageProps } from './Page';

const STAT_LABELS = [
  ['maxHp', 'PV'], ['atk', 'Attacco'], ['def', 'Difesa'], ['mag', 'Magia'],
  ['speed', 'Velocità'], ['move', 'Movimento'], ['jump', 'Salto'],
] as const;
// full length of a stat bar
const BAR_MAX: Partial<Record<keyof Stats, number>> = { maxHp: 120, atk: 30, def: 30, mag: 30, speed: 20 };
const FACINGS = ['S', 'E', 'N', 'W'];
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

/** The unit's sprite turning on a lit pedestal. Empty for art not drawn yet. */
function Pedestal({ unit }: { unit: RosterUnit }) {
  const dir = spriteDir(raceOf(unit), unit.classId);
  const [facing, setFacing] = useState(0);
  useEffect(() => {
    if (!dir || reducedMotion()) return;
    const spin = setInterval(() => setFacing(f => (f + 1) % 4), 1100);
    return () => clearInterval(spin);
  }, [dir]);
  return <div className="pedestal">{dir && <img alt="" src={`${dir}/${FACINGS[facing]}.png`} width={168} height={168} />}</div>;
}

export function Barracks({ player, selected, select, update, ...page }: PageProps & {
  player: Account; selected: string; select: (unitId: string) => void; update: (unitId: string, change: UnitChange) => void;
}) {
  const roster = player.roster;
  const unit = roster.find(u => u.id === selected)!;
  const race = raceOf(unit);
  const eff = unitFromRoster(unit, 'A', { x: 0, y: 0 }, 'S');
  // bars: the class's own value in parchment, what the equipment adds in brass
  const bare = unitFromRoster({ ...unit, equip: {} }, 'A', { x: 0, y: 0 }, 'S');
  const unlocked = unlockedPassives(unit);

  return (
    <Page title={`Caserma · ${roster.length} unità`} {...page}>
      <div className="roster">
        {roster.map(u => (
          <button key={u.id} className={`roster-item${u.id === selected ? ' sel' : ''}`} onClick={() => select(u.id)}>
            <span className="rn">{u.name}</span>
            <span className="rc">{raceName(u.raceId)} · {CLASSES[u.classId].name} Lv {classLevel(u, u.classId)}</span>
          </button>
        ))}
      </div>

      <section className="detail">
        <div className="hero-unit">
          <Pedestal unit={unit} />
          <div>
            <h3>{unit.name}</h3>
            <p className="sub">{raceName(unit.raceId)} · {CLASSES[unit.classId].name} Lv {eff.level}</p>
            <p className="hint">{RACES[race].trait.name}: {RACES[race].trait.description}</p>
            <div className="statbars">
              {STAT_LABELS.map(([k, label]) => {
                const max = BAR_MAX[k], v = eff.stats[k], base = Math.min(v, bare.stats[k]);
                return (
                  <Fragment key={k}>
                    <span className="t">{label}</span>
                    {max ? (
                      <span className="b">
                        <i style={{ width: `${(100 * Math.min(base, max)) / max}%` }} />
                        <i style={{ left: `${(100 * Math.min(base, max)) / max}%`, width: `${(100 * Math.max(0, Math.min(v, max) - base)) / max}%` }} />
                      </span>
                    ) : <span />}
                    <span className="v">{v}</span>
                  </Fragment>
                );
              })}
            </div>
          </div>
        </div>

        <div className="label">Classi</div>
        <div className="class-grid">
          {/* only the classes of the unit's race */}
          {Object.values(CLASSES).filter(c => allowedRaces(c.id).includes(race)).map(c => {
            const lvl = classLevel(unit, c.id), xp = unit.xp[c.id] ?? 0;
            const max = lvl >= MAX_CLASS_LEVEL;
            const pct = max ? 100 : (100 * (xp - xpToReach(lvl))) / (xpToReach(lvl + 1) - xpToReach(lvl));
            const missing = missingRequirements(unit, c.id);
            const active = c.id === unit.classId;
            return (
              <button
                key={c.id}
                className={`class-card${active ? ' sel' : ''}${missing.length ? ' locked' : ''}`}
                disabled={active || missing.length > 0}
                onClick={() => update(unit.id, { classId: c.id })}
              >
                <span className="cn">{c.name}</span>
                <span className="cl">{missing.length ? 'Bloccata' : `Lv ${lvl}${active ? ' · attiva' : ''} · ${max ? 'max' : `${xp - xpToReach(lvl)}/${xpToReach(lvl + 1) - xpToReach(lvl)} XP`}`}</span>
                {missing.length
                  ? <span className="req">Richiede {missing.map(m => `${CLASSES[m.classId].name} ${m.level}`).join(' · ')}</span>
                  : <span className="xpbar" title={max ? 'Livello massimo' : `${xp} / ${xpToReach(lvl + 1)} XP`}><span style={{ width: `${pct}%` }} /></span>}
              </button>
            );
          })}
        </div>

        <div className="label">Abilità</div>
        <ul className="abilities">
          {unitActions({ classId: unit.classId, raceId: race }).map(a => <li key={a.name}><b>{a.name}</b> · {actionText(a)}</li>)}
        </ul>

        <div className="label">Passiva (1 slot)</div>
        {unlocked.length ? (
          <div className="class-pick">
            <button className={unit.passive === null ? 'sel' : ''} onClick={() => update(unit.id, { passive: null })}>Nessuna</button>
            {unlocked.map(c => (
              <button key={c} className={unit.passive === c ? 'sel' : ''} title={CLASSES[c].passive.description} onClick={() => update(unit.id, { passive: c })}>
                {CLASSES[c].passive.name}<small>{CLASSES[c].passive.description}</small>
              </button>
            ))}
          </div>
        ) : <p className="hint">Porta una classe al livello {PASSIVE_LEVEL} per sbloccare la sua passiva.</p>}

        {SLOTS.map(slot => {
          const current = unit.equip?.[slot];
          return (
            <Fragment key={slot}>
              <div className="label">{SLOT_LABELS[slot]}</div>
              <div className="class-pick">
                <button className={current ? '' : 'sel'} onClick={() => update(unit.id, { equip: { [slot]: null } })}>Nessuna</button>
                {Object.values(ITEMS).filter(i => i.slot === slot && player.inventory[i.id]).map(i => {
                  const free = current === i.id || freeCopies(player, i.id) > 0;
                  return (
                    <button key={i.id} className={current === i.id ? 'sel' : ''} disabled={!free} onClick={() => update(unit.id, { equip: { [slot]: i.id } })}>
                      {i.name}<small>{free ? itemBonus(i) : 'In uso da altre unità'}</small>
                    </button>
                  );
                })}
              </div>
            </Fragment>
          );
        })}
        {!Object.keys(player.inventory).length && <p className="hint">Compra armi e armature al negozio.</p>}
      </section>
    </Page>
  );
}
