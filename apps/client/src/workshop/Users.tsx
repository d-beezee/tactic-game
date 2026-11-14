import { api } from '../api';
import { Btn, Confirm, confirmFirst, Frame } from './parts';
import { draw, matches, mutate, ws } from './state';

export function Users() {
  const q = ws.queries.users ?? '';
  const search = (
    <input type="search" className="field ws-search" placeholder="Cerca per email" aria-label="Cerca per email" value={q} onChange={e => { ws.queries.users = e.target.value; draw(); }} />
  );
  return (
    <Frame title="Utenti" actions={search}>
      <div className="ws-users">
        {ws.users.filter(u => matches(q, u.email)).map(u => {
          const me = u.email === ws.ctx.player.email;
          const verb = u.admin ? 'Togli admin' : 'Rendi admin';
          return (
            <div key={u.id} className="ws-user">
              <span><b>{u.email}</b><small>dal {new Date(u.createdAt).toLocaleDateString('it-IT')}{me ? ' · sei tu' : ''}</small></span>
              <span className={`ws-role${u.admin ? ' admin' : ''}`}>{u.admin ? 'Admin' : 'Giocatore'}</span>
              {me ? <span /> : <Btn label={verb} cls="ghost" onClick={confirmFirst(`role:${u.id}`)} />}
              <Confirm k={`role:${u.id}`} ok={`Sì, ${verb.toLowerCase()}`} cls="primary" run={() => void mutate(api.setAdmin(u.id, !u.admin), l => { ws.users = l; }, false)}>
                {u.admin
                  ? <>Togliere i poteri admin a <b>{u.email}</b>? Tornerà a essere un giocatore.</>
                  : <>Dare i poteri admin a <b>{u.email}</b>? Potrà cambiare campagna, missioni, mappe, musiche e ruoli.</>}
              </Confirm>
            </div>
          );
        })}
      </div>
    </Frame>
  );
}
