import { useEffect, useState } from 'react';
import { api, ApiError, type PvpState } from '../api';
import { Page, type PageProps } from './Page';

/** PvP: search the lobby, open a room with a code, or join a friend's code. */
export function Pvp({ queue, room, join, ...page }: PageProps & { queue: () => void; room: () => void; join: (code: string) => void }) {
  const [code, setCode] = useState('');
  return (
    <Page title="PvP" {...page}>
      <p className="hint wide">Tutte le unità combattono al livello 5, con passive ed equipaggiamento. Niente XP né oro: si gioca per vincere.</p>
      <div className="pvp-actions">
        <button className="menu-btn primary" onClick={queue}>Cerca un avversario</button>
        <button className="menu-btn" onClick={room}>Crea una stanza per un amico</button>
        <form className="mission-form" onSubmit={e => { e.preventDefault(); join(code); }}>
          <input className="field" placeholder="Codice" aria-label="Codice dell'amico" maxLength={6} autoCapitalize="characters" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} />
          <button className="menu-btn" type="submit">Entra con il codice</button>
        </form>
      </div>
    </Page>
  );
}

/** Waits in the lobby or in a room until someone joins, then starts the match. Leaving the screen stops the poll. */
export function PvpWait({ id, onStart, onClosed, onAuth, onCancel }: {
  id: string; onStart: (state: PvpState) => void; onClosed: () => void; onAuth: () => void; onCancel: () => void;
}) {
  /** the room's code, null in the public queue, undefined until the first answer */
  const [code, setCode] = useState<string | null>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      while (live) {
        try {
          const st = await api.pvpState(id);
          if (!live) return;
          if (st.status !== 'waiting') return onStart(st);
          setCode(st.code);
        } catch (e) {
          if (!live) return;
          if (e instanceof ApiError && e.status === 401) return onAuth();
          if (e instanceof ApiError && e.status === 404) return onClosed();
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    })();
    return () => { live = false; };
  }, [id]);

  return (
    <div className="menu-main pvp-wait">
      {code === undefined ? <p className="hint">Caricamento…</p> : code ? (
        <>
          <p className="hint">Manda questo codice a un amico:</p>
          <div className="room-code">{code}</div>
          <button className="back" onClick={() => void navigator.clipboard?.writeText(code).then(() => setCopied(true), () => {})}>{copied ? 'Copiato' : 'Copia'}</button>
        </>
      ) : (
        <>
          <h2>In cerca di un avversario…</h2>
          <p className="hint">Appena entra qualcun altro in coda, si parte.</p>
        </>
      )}
      <button className="menu-btn" onClick={onCancel}>Annulla</button>
    </div>
  );
}
