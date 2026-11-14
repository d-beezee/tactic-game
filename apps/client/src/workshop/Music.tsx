import { useState } from 'react';
import { api, type Music as Library } from '../api';
import { getLibrary, playCode, setLibrary } from '../music';
import { Btn, Confirm, confirmFirst, EditHead, Field, Frame, ListPane, MasterDetail, Row, SaveBar, Select, Text, UNSAVED } from './parts';
import { dirty, draw, edit, matches, mutate, replace, touch, ws, type Edit, type TrackDraft } from './state';

const slotsOf = (l: Library) => ({ menu: l.menu, battle: l.battle });
const blankTrack = (): Edit<TrackDraft> => edit({ id: null, name: '', code: '' });

export function Music() {
  /** an error in the Strudel code of the preview */
  const [problem, setProblem] = useState('');
  const lib = getLibrary();
  // the slots follow the library, unless they hold unsaved changes
  if (!ws.slots || ws.slots.orig !== JSON.stringify(slotsOf(lib)) && !dirty(ws.slots)) ws.slots = edit(slotsOf(lib));
  const s = ws.slots;
  const choices: [string, string][] = [['', 'Nessuna (silenzio)'], ...lib.tracks.map(t => [t.id, t.name] as [string, string])];
  const saveSlots = () => void mutate((async () => {
    let l = lib;
    if (s.d.menu !== lib.menu) l = await api.setMusicSlot('menu', s.d.menu);
    if (s.d.battle !== lib.battle) l = await api.setMusicSlot('battle', s.d.battle);
    return l;
  })(), l => { setLibrary(l); ws.slots = null; });

  // the open draft goes away with its track
  if (ws.tEdit?.d.id && !lib.tracks.some(t => t.id === ws.tEdit!.d.id)) ws.tEdit = null;
  const e = ws.tEdit ??= blankTrack();
  const d = e.d;
  /** Opens a draft in the editor. */
  const open = (next: Edit<TrackDraft> = e) => { ws.tEdit = next; ws.open = true; draw(); };
  const key = d.id ?? 'draft';
  const toggle = () => {
    setProblem('');
    if (ws.playing === key) { ws.playing = null; void playCode(null); return draw(); }
    void playCode(d.code).then(() => { ws.playing = key; draw(); }, err => setProblem(`Errore nel codice: ${(err as Error).message}`));
  };
  const save = () => void mutate(d.id ? api.updateTrack(d.id, { name: d.name, code: d.code }) : api.createTrack({ name: d.name, code: d.code }), l => {
    const fresh = l.tracks.find(t => t.id === d.id) ?? l.tracks.find(t => !lib.tracks.some(o => o.id === t.id));
    setLibrary(l);
    ws.tEdit = fresh ? edit({ ...fresh }) : null;
  });

  const list = (
    <ListPane placeholder="Cerca brano" rows={q => (
      <>
        {!d.id && <Row title={d.name || 'Nuovo brano'} sub="non ancora salvato" chip={dirty(e) ? UNSAVED : ws.playing === 'draft' ? ['In riproduzione', 'ok'] : null} on onClick={() => open()} />}
        {lib.tracks.filter(t => matches(q, t.name)).map(t => (
          <Row
            key={t.id}
            title={t.name}
            on={t.id === d.id}
            sub={[t.id === lib.menu && 'Menu', t.id === lib.battle && 'Battaglie'].filter(Boolean).join(' · ') || 'Non in uso di default'}
            chip={t.id === d.id && dirty(e) ? UNSAVED : ws.playing === t.id ? ['In riproduzione', 'ok'] : null}
            onClick={() => t.id === d.id ? open() : replace(e, () => open(edit({ ...t })))}
          />
        ))}
      </>
    )} />
  );

  return (
    <Frame title="Musiche" bar actions={<Btn label="+ Nuovo brano" onClick={() => replace(e, () => open(blankTrack()))} />}>
      <section className="ws-slots">
        <div className="ws-fields">
          <Field label="Musica del menu"><Select<string> options={choices} value={s.d.menu ?? ''} set={v => { s.d.menu = v || null; touch(); }} /></Field>
          <Field label="Musica delle battaglie" help="Una missione può avere la sua: si sceglie nella missione.">
            <Select<string> options={choices} value={s.d.battle ?? ''} set={v => { s.d.battle = v || null; touch(); }} />
          </Field>
        </div>
        <SaveBar edit={s} label="Salva" onSave={saveSlots} />
      </section>
      <MasterDetail list={list}>
        <EditHead title={d.id ? d.name : 'Nuovo brano'}>
          {d.id && <Btn label="Elimina" cls="ghost" onClick={confirmFirst(`del:${d.id}`)} />}
        </EditHead>
        <Confirm k={`del:${d.id}`} ok="Elimina" cls="warn" run={() => void mutate(api.deleteTrack(d.id!), l => { setLibrary(l); ws.tEdit = null; }, false)}>
          Eliminare <b>{d.name}</b>? Le missioni che la usano passano alla musica delle battaglie.
        </Confirm>
        <div className="ws-pane">
          <div className="ws-fields">
            <Field label="Nome del brano" wide><Text value={d.name} set={v => { d.name = v; touch(); }} maxLength={60} /></Field>
            <Field label="Codice Strudel" wide>
              <textarea className="field code" required maxLength={20000} spellCheck={false} value={d.code} placeholder="Incolla qui il codice da strudel.cc" onChange={ev => { d.code = ev.target.value; touch(); }} />
            </Field>
          </div>
          <p className="error" role="alert" hidden={!problem}>{problem}</p>
          <Btn label={ws.playing === key ? '■ Ferma' : '▶ Ascolta'} cls={ws.playing === key ? 'on' : ''} onClick={toggle} disabled={!d.code.trim()} />
        </div>
        <SaveBar edit={e} label={d.id ? 'Salva brano' : 'Crea brano'} onSave={save} />
      </MasterDetail>
    </Frame>
  );
}
