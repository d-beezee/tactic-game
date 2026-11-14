// The pieces every Officina tool is built from: list on the left, tabs on the right, a save bar at the bottom.
import { cloneElement, useId, type InputHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { allMaps, BUILTIN_MAPS } from '../maps';
import { getLibrary } from '../music';
import { dirty, draw, go, ws, type Edit, type Tool } from './state';

export function Btn({ label, cls = '', onClick, disabled, autoFocus }: { label: string; cls?: string; onClick: () => void; disabled?: boolean; autoFocus?: boolean }) {
  return <button type="button" className={`ws-btn ${cls}`} onClick={onClick} disabled={disabled} autoFocus={autoFocus}>{label}</button>;
}

/** The Officina's page: tools on the left, the open tool on the right. `bar`: a save bar below shows the error instead. */
export function Frame({ title, actions, bar, children }: { title: string; actions?: ReactNode; bar?: boolean; children: ReactNode }) {
  const link = (t: Tool, label: string, n: number) => (
    <button type="button" className={`ws-link${ws.tool === t ? ' on' : ''}`} aria-current={ws.tool === t ? 'page' : undefined} onClick={() => void go(t)}>
      {label}<small>{n || ''}</small>
    </button>
  );
  return (
    <div className="workshop">
      <nav className="ws-nav" aria-label="Strumenti dell'Officina">
        <div className="ws-brand"><b>Officina</b><small>Strumenti admin</small></div>
        <span className="ws-grp">Contenuti</span>
        {link('campaign', 'Campagna', ws.chapters.length)}
        {link('missions', 'Missioni', ws.missions.length)}
        <button type="button" className="ws-link" onClick={ws.ctx.mapEditor}>Mappe<small>{allMaps().length - BUILTIN_MAPS.length || ''}</small></button>
        {link('music', 'Musiche', getLibrary().tracks.length)}
        <span className="ws-grp">Persone</span>
        {link('users', 'Utenti', ws.users.length)}
        <button type="button" className="ws-link ws-exit" onClick={ws.ctx.back}>← Torna al gioco</button>
      </nav>
      <main className="ws-main">
        <p className="ws-live">{ws.tool === 'users' ? 'Gli admin possono modificare tutto e cambiare i ruoli degli altri.' : 'Le modifiche salvate valgono subito per tutti i giocatori.'}</p>
        <header className="ws-head"><h2>{title}</h2>{actions}</header>
        <p className="error" role="alert" hidden={!ws.error || bar}>{ws.error}</p>
        {children}
      </main>
    </div>
  );
}

/** The save bar of a draft; it turns into the "discard the changes?" question when one is waiting. */
export function SaveBar({ edit, label, onSave, extra }: { edit: Edit<unknown>; label: string; onSave: () => void; extra?: ReactNode }) {
  const changed = dirty(edit);
  return (
    <div className="ws-bar-slot">
      {ws.ask ? (
        <div className="ws-bar ask">
          <p>Le modifiche non salvate andranno perse.</p>
          {/* the question takes the focus, on its safe answer */}
          <Btn label="Resta qui" cls="ghost" autoFocus onClick={() => { ws.ask = null; draw(); }} />
          <Btn label="Scarta le modifiche" cls="warn" onClick={() => { const fn = ws.ask!; ws.ask = null; fn(); }} />
        </div>
      ) : (
        <div className="ws-bar">
          {ws.error && <p className="error" role="alert">{ws.error}</p>}
          <p className={`ws-state${changed ? ' dirty' : ws.savedAt ? ' ok' : ''}`} role="status">
            {changed ? 'Modifiche non salvate' : ws.savedAt ? `Salvato alle ${ws.savedAt}` : 'Nessuna modifica'}
          </p>
          {extra}
          {changed && <Btn label="Annulla modifiche" cls="ghost" onClick={() => { edit.d = JSON.parse(edit.orig); draw(); }} />}
          <Btn label={label} cls="primary" onClick={onSave} disabled={!changed} />
        </div>
      )}
    </div>
  );
}

/** Second tap for actions that cannot be undone, shown where the action was asked. `k` is the key given to confirmFirst. */
export function Confirm({ k, ok, cls, run, children }: { k: string; ok: string; cls: string; run: () => void; children: ReactNode }) {
  if (ws.pending !== k) return null;
  return (
    <div className="ws-confirm" role="group">
      <p>{children}</p>
      <Btn label="Annulla" cls="ghost" autoFocus onClick={() => { ws.pending = ''; draw(); }} />
      <Btn label={ok} cls={cls} onClick={() => { ws.pending = ''; run(); }} />
    </div>
  );
}
export const confirmFirst = (key: string) => () => { ws.pending = key; draw(); };

/** A labelled field around one control; the unit, when given, sits inside the box. */
export function Field({ label, help, unit, wide, children }: { label: string; help?: string; unit?: string; wide?: boolean; children: ReactElement<{ id?: string }> }) {
  const id = useId();
  const control = cloneElement(children, { id });
  return (
    <div className={`ws-field${wide ? ' wide' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {unit ? <div className="ws-unit">{control}<span>{unit}</span></div> : control}
      {help && <small className="hint">{help}</small>}
    </div>
  );
}

export function Text({ value, set, ...rest }: { value: string; set: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value'>) {
  return <input className="field" value={value} onChange={e => set(e.target.value)} {...rest} />;
}
/** Numbers stay NaN while the box is empty, so the server refuses them instead of saving a silent 0. */
export function Num({ value, set, min, max, id }: { value: number; set: (v: number) => void; min: number; max: number; id?: string }) {
  return <input id={id} className="field" type="number" min={min} max={max} step={1} value={Number.isNaN(value) ? '' : value} onChange={e => set(e.target.valueAsNumber)} />;
}
export function Select<V extends string>({ options, value, set, id }: { options: [V, string][]; value: V; set: (v: V) => void; id?: string }) {
  return (
    <select id={id} className="field" value={value} onChange={e => set(e.target.value as V)}>
      {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
    </select>
  );
}
export function Check({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return <label className="ws-check"><input type="checkbox" checked={on} onChange={e => set(e.target.checked)} /> {label}</label>;
}

export function TabBar({ names, which }: { names: string[]; which: 'missions' | 'campaign' }) {
  return (
    <div className="ws-tabs" role="tablist">
      {names.map((n, i) => (
        <button key={n} type="button" role="tab" className={`ws-tab${i === ws.tabs[which] ? ' on' : ''}`} aria-selected={i === ws.tabs[which]} onClick={() => { ws.tabs[which] = i; draw(); }}>{n}</button>
      ))}
    </div>
  );
}

export const UNSAVED: [string, string] = ['Modifiche non salvate', 'draft'];

/** A list row; the whole row opens the item. `chip` is [text, class]. */
export function Row({ title, sub, label, chip, on, onClick }: { title: string; sub: string; label?: string; chip?: [string, string] | null; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`ws-row${on ? ' on' : ''}`} aria-current={on ? 'true' : undefined} onClick={onClick}>
      {label && <small className="ws-eyebrow">{label}</small>}
      <b>{title}</b>
      <small>{sub}</small>
      {chip && <span className={`ws-chip ${chip[1]}`}>{chip[0]}</span>}
    </button>
  );
}

/** The searchable list beside an editor; `rows` gets the search text. */
export function ListPane({ placeholder, rows }: { placeholder: string; rows: (q: string) => ReactNode }) {
  const q = ws.queries[ws.tool] ?? '';
  return (
    <div className="ws-list">
      <input type="search" className="field ws-search" placeholder={placeholder} aria-label={placeholder} value={q} onChange={e => { ws.queries[ws.tool] = e.target.value; draw(); }} />
      <div className="ws-rows">{rows(q)}</div>
    </div>
  );
}

/** List and editor side by side; on phones one at a time. */
export function MasterDetail({ list, children }: { list: ReactNode; children: ReactNode }) {
  return <div className={`ws-md${ws.open ? ' open' : ''}`}>{list}<section className="ws-edit">{children}</section></div>;
}
export function EditHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="ws-edit-head">
      <Btn label="← Elenco" cls="ghost ws-phone" onClick={() => { ws.open = false; draw(); }} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}
