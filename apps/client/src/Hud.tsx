// The battle HUD over the canvas. It only shows hudStore: the controller and the deploy phase write it through the `hud` facade.
import { CLASSES, RACES, STATUSES, unitById, type BattleState, type Side, type Unit } from '@tactics/core';
import { Fragment, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { hudStore, ICONS, isBtn, type Btn, type Forecast as ForecastData, type Look } from './hudStore';
import { play } from './sfx';
import { reducedMotion } from './theme';

const s = hudStore.state;

const PHONE = '(max-width: 640px)';
const usePhone = () => useSyncExternalStore(
  fn => { const m = matchMedia(PHONE); m.addEventListener('change', fn); return () => m.removeEventListener('change', fn); },
  () => matchMedia(PHONE).matches,
);

export function Button({ b }: { b: Btn }) {
  const btn = (
    <button className={b.primary ? 'primary' : undefined} disabled={!!b.disabled} aria-label={b.ariaLabel} title={b.ariaLabel} onClick={() => { play('select'); b.onClick(); }}>
      {b.icon && <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[b.icon] }} />}
      <span className="lbl">{b.label}</span>
      {b.hint && <small>{b.hint}</small>}
    </button>
  );
  if (!b.onHover) return btn;
  // disabled buttons get no mouse events, so the wrapper listens instead
  return <span className="btn-wrap" onPointerEnter={() => b.onHover!(true)} onPointerLeave={() => b.onHover!(false)}>{btn}</span>;
}

function Medal({ u, extra = '', hidden = true }: { u: Look & { team: string }; extra?: string; hidden?: boolean }) {
  const url = s.portraitOf(u);
  return <div className={`medal ${u.team}${extra}`} style={url ? { backgroundImage: `url(${url})` } : undefined} aria-hidden={hidden || undefined} />;
}

function Timeline({ state }: { state: BattleState | null }) {
  const items = [];
  for (let i = 0, shown = 0; state && shown < 9 && i < state.order.length * 3; i++) {
    const u = unitById(state, state.order[(state.turn + i) % state.order.length]);
    if (u.hp <= 0) continue;
    // the order wraps: mark where the next round starts
    if (i > 0 && (state.turn + i) % state.order.length === 0) items.push(<div key={`r${i}`} className="round-mark">Round {state.round + Math.floor((state.turn + i) / state.order.length)}</div>);
    items.push(
      <div key={i} className={`medal ${u.team}${i === 0 ? ' now' : ''}`} title={`${u.name}, ${CLASSES[u.classId].name}`}
        style={s.portraitOf(u) ? { backgroundImage: `url(${s.portraitOf(u)})` } : undefined}>
        <small>{u.name}</small>
      </div>,
    );
    shown++;
  }
  return <div id="timeline">{items}</div>;
}

/** "Veleno 2 · Forza 3": each status with its turns left. */
const statusText = (u: Unit) => (u.statuses ?? []).map(x => `${STATUSES[x.id].name} ${x.turns}`).join(' · ');

/** Keyed by unit: the same unit keeps its HP bar, so the lost part trails behind before it drops. */
function CardBody({ u }: { u: Unit }) {
  const { stats } = u;
  const pct = `${(100 * Math.max(0, u.hp)) / stats.maxHp}%`;
  const low = u.hp / stats.maxHp <= 0.35;
  return (
    <>
      <div className="head">
        <Medal u={u} />
        <div>
          <div className="name">{u.name}</div>
          <div className="cls">{`${RACES[u.raceId]?.name ?? ''} ${CLASSES[u.classId].name} Lv ${u.level}${u.passive ? `, ${CLASSES[u.passive].passive.name}` : ''}${u.team === s.me ? '' : ', nemico'}`}</div>
        </div>
      </div>
      <div className="bar">
        <div className="hp-ghost" style={{ width: pct }} />
        <div className={`hp-now${low ? ' low' : ''}`} style={{ width: pct }} />
      </div>
      <div className="hp-row"><span className="hp-num">{Math.max(0, u.hp)}/{stats.maxHp}</span><span className="hp-lbl">PV</span></div>
      <div className="stats">
        {([['ATT', stats.atk], ['DIF', stats.def], ['MAG', stats.mag], ['VEL', stats.speed], ['MOV', stats.move], ['SALTO', stats.jump]] as const).map(([label, value]) => (
          <span key={label}><i>{label}</i>{value}</span>
        ))}
      </div>
      <div className="statuses">{statusText(u) || null}</div>
    </>
  );
}

const SIDE_TEXT: Record<Side, string> = { front: 'Di fronte', flank: 'Di fianco ×1,25', back: 'Alle spalle ×1,5' };

function Forecast({ f }: { f: ForecastData | null }) {
  if (!f) return <div id="forecast" hidden />;
  const rows: [string, string][] = [...(f.rows ?? [])];
  if (!f.heal && f.side) rows.push(['Lato', SIDE_TEXT[f.side]]);
  if (!f.heal && f.dh) rows.push([f.dh > 0 ? `Più in alto di ${f.dh}` : `Più in basso di ${-f.dh}`, `${f.dh > 0 ? '+' : ''}${Math.max(-4, Math.min(4, f.dh)) * 5}%`]);
  const after = f.amount !== undefined && f.hp !== undefined && f.maxHp !== undefined
    ? f.heal ? Math.min(f.maxHp, f.hp + f.amount) : Math.max(0, f.hp - f.amount) : null;
  return (
    <div id="forecast" className={f.heal ? 'heal' : ''}>
      <h4>{f.title}</h4>
      {f.amount !== undefined && <div className="big">{f.heal ? '+' : ''}{f.amount}<small>{f.heal ? 'cura, circa' : 'danno, circa'}</small></div>}
      <dl>{rows.map(([k, v], i) => <Fragment key={i}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
      {after !== null && <div className="after">PV {f.hp} <span>diventa</span> <b className={after === 0 ? 'ko' : ''}>{after === 0 ? 'KO' : after}</b></div>}
    </div>
  );
}

function Ribbon({ text, n }: { text: string; n: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const r = ref.current!;
    r.classList.remove('show');
    if (!n) return;
    void r.offsetWidth; // restart the animation
    r.classList.add('show');
  }, [n]);
  return <div id="ribbon" ref={ref} aria-live="polite">{text}</div>;
}

function Result() {
  const r = s.result;
  if (!r) return <div id="result" hidden />;
  const step = reducedMotion() ? 0 : 280;
  return (
    <div id="result" className={r.win ? 'win' : 'lose'}>
      <h1>{r.win ? 'Vittoria' : 'Sconfitta'}</h1>
      <ul className="xp-report">
        {r.lines.map((l, i) => (
          <li key={i} className={l.kind === 'level' ? 'up' : l.kind === 'gold' ? 'gold' : ''} style={{ animationDelay: `${600 + i * step}ms` }}>{l.text}</li>
        ))}
      </ul>
      <Button b={{ label: r.label, icon: r.win && r.label !== 'Torna al menu' ? 'confirm' : 'back', onClick: r.onRestart, primary: true }} />
    </div>
  );
}

/** ⟲ ⟳ buttons plus Q/E keys to rotate the camera; also used by the map editor, outside the HUD. */
function Rotate() {
  const cam = s.rotate;
  const box = document.getElementById('rotate')!;
  useEffect(() => {
    box.hidden = !cam;
    if (!cam) return;
    const keys = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.repeat) return;
      if (e.key === 'q' || e.key === 'Q') cam.rotate(-1);
      if (e.key === 'e' || e.key === 'E') cam.rotate(1);
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [cam, box]);
  if (!cam) return null;
  return createPortal(<>
    <Button b={{ label: '⟲', ariaLabel: 'Ruota a sinistra (Q)', onClick: () => cam.rotate(-1) }} />
    <Button b={{ label: '⟳', ariaLabel: 'Ruota a destra (E)', onClick: () => cam.rotate(1) }} />
  </>, box);
}

export function Hud() {
  hudStore.useStore();
  const phone = usePhone();
  const menu = s.actions;
  // phones get the turn menu in the bottom row: a list beside the unit would cover the map
  const row = phone && menu ? [...s.buttons, ...menu.list] : s.buttons;
  return (
    <>
      <div id="hud" hidden={!s.visible}>
        <Timeline state={s.timeline} />
        <div id="banner">{s.banner || null}</div>
        <div id="goal" hidden={!s.goal}>{s.goal}</div>
        <Ribbon {...s.ribbon} />
        <Forecast f={s.forecast} />
        {/* always mounted: the scene keeps it next to the active unit */}
        <div id="actions" hidden={!menu || phone}>
          {menu && <><h4>{menu.title}</h4>{menu.list.map((b, i) => <Button key={i} b={b} />)}</>}
        </div>
        <div id="panel">
          <div id="card" className={s.card?.team}>{s.card && <CardBody key={s.card.id} u={s.card} />}</div>
          <div id="buttons">{row.map((b, i) => isBtn(b) ? <Button key={i} b={b} /> : <Fragment key={i}>{b}</Fragment>)}</div>
        </div>
        <Result />
      </div>
      <Rotate />
    </>
  );
}

/** 2×2 grid of iso arrows, laid out like they appear on screen. */
export function Dirs({ onPick, onPreview }: { onPick: (d: 'N' | 'E' | 'S' | 'W') => void; onPreview?: (d: 'N' | 'E' | 'S' | 'W' | null) => void }) {
  return (
    <div className="dirs">
      {([['W', '↖', 'alto a sinistra'], ['N', '↗', 'alto a destra'], ['S', '↙', 'basso a sinistra'], ['E', '↘', 'basso a destra']] as const).map(([d, label, name]) => (
        <Button key={d} b={{ label, ariaLabel: `Guarda in ${name}`, onClick: () => onPick(d), onHover: onPreview && (on => onPreview(on ? d : null)) }} />
      ))}
    </div>
  );
}

/** The deploy phase's roster: units not on the field yet, dragged (or tapped) onto the spawn cells. */
export function Tray({ units, full, onGrab }: {
  units: { id: string; name: string; cls: string; team: string; portrait: string }[]; full: boolean; onGrab: (id: string, e: ReactPointerEvent) => void;
}) {
  return (
    <div className="tray">
      {units.length ? units.map(u => (
        <div key={u.id} className={`tray-item${full ? ' full' : ''}`} onPointerDown={e => onGrab(u.id, e)}>
          <div className={`medal ${u.team}`} style={{ backgroundImage: `url(${u.portrait})` }} />
          <span><b>{u.name}</b><small>{u.cls}</small></span>
        </div>
      )) : <span className="tray-empty">Tutte le unità sono in campo</span>}
    </div>
  );
}
