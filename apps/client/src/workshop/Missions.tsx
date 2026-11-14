import { RACES, type MapData } from '@tactics/core';
import { api, type Mission } from '../api';
import { allMaps } from '../maps';
import { getLibrary } from '../music';
import { enemySummary } from '../ui';
import { EnemyEditor } from './EnemyEditor';
import { Btn, Check, Confirm, confirmFirst, EditHead, Field, Frame, ListPane, MasterDetail, Num, Row, SaveBar, Select, TabBar, Text, UNSAVED } from './parts';
import { baseClassesOf, clone, defaultEnemies, dirty, draw, edit, mapName, matches, mutate, replace, touch, trackName, ws, type Edit, type MissionDraft } from './state';

const blankMission = (m: MapData): MissionDraft => ({ id: null, name: '', mapId: m.id, gold: 50, enemies: defaultEnemies(m), trackId: null, recruit: { on: false, name: '', raceId: 'corvid', classId: 'lancer' } });
const missionDraft = (m: Mission): MissionDraft => ({
  id: m.id, name: m.name, mapId: m.mapId, gold: m.gold, enemies: clone(m.enemies), trackId: m.trackId,
  recruit: m.recruit ? { on: true, ...m.recruit } : { on: false, name: '', raceId: 'corvid', classId: 'lancer' },
});

export function Missions() {
  const maps = allMaps();
  // the open draft goes away with its mission or its map
  if (ws.mEdit?.d.id && !ws.missions.some(m => m.id === ws.mEdit!.d.id)) ws.mEdit = null;
  if (ws.mEdit && !maps.some(m => m.id === ws.mEdit!.d.mapId)) ws.mEdit = null;
  const e = ws.mEdit ??= edit(blankMission(maps[0]));
  const d = e.d, map = maps.find(m => m.id === d.mapId)!;
  /** Opens a draft in the editor. */
  const open = (next: Edit<MissionDraft> = e) => { ws.mEdit = next; ws.open = true; draw(); };

  const save = () => {
    const before = ws.missions;
    const m = { name: d.name, mapId: d.mapId, gold: d.gold, enemies: d.enemies, trackId: d.trackId, recruit: d.recruit.on ? { name: d.recruit.name, raceId: d.recruit.raceId, classId: d.recruit.classId } : null };
    void mutate(d.id ? api.updateMission(d.id, m) : api.createMission(m), list => {
      ws.missions = list;
      const saved = list.find(x => x.id === d.id) ?? list.find(x => !before.some(b => b.id === x.id));
      ws.mEdit = saved ? edit(missionDraft(saved)) : null;
    });
  };
  const rehearse = () => ws.ctx.rehearse(
    { id: 'prova', mapId: map.id, map, label: 'Prova', title: d.name || 'Missione', blurb: '', enemies: d.enemies, goal: { type: 'rout' }, required: [], gold: 0, before: [], after: [] },
    d.trackId,
  );

  const data = () => (
    <div className="ws-fields">
      <Field label="Nome della missione" wide><Text value={d.name} set={v => { d.name = v; touch(); }} maxLength={60} placeholder="es. Il ponte dei corvi" /></Field>
      <Field label="Mappa" help="Cambiare mappa rimette i nemici sulle partenze nemiche.">
        <Select options={maps.map(m => [m.id, m.name] as [string, string])} value={d.mapId} set={v => { d.mapId = v; d.enemies = defaultEnemies(maps.find(m => m.id === v)!); draw(); }} />
      </Field>
      <Field label="Premio alla vittoria" unit="oro" help="Più XP, una volta al giorno."><Num value={d.gold} set={v => { d.gold = v; touch(); }} min={0} max={10000} /></Field>
      <Field label="Musica">
        <Select<string> options={[['', 'Quella delle battaglie'], ...getLibrary().tracks.map(t => [t.id, t.name] as [string, string])]} value={d.trackId ?? ''} set={v => { d.trackId = v || null; touch(); }} />
      </Field>
    </div>
  );
  const recruit = () => {
    const rc = d.recruit;
    // the class follows the race
    const classes = baseClassesOf(rc.raceId);
    if (!classes.some(c => c.id === rc.classId)) rc.classId = classes[0].id;
    return (
      <>
        <Check label="Alla prima vittoria si unisce una recluta" on={rc.on} set={v => { rc.on = v; draw(); }} />
        {rc.on ? (
          <div className="ws-fields">
            <Field label="Nome della recluta"><Text value={rc.name} set={v => { rc.name = v; touch(); }} maxLength={20} /></Field>
            <Field label="Razza"><Select options={Object.values(RACES).map(r => [r.id, r.name] as [string, string])} value={rc.raceId} set={v => { rc.raceId = v; touch(); }} /></Field>
            <Field label="Classe"><Select options={classes.map(c => [c.id, c.name] as [string, string])} value={rc.classId} set={v => { rc.classId = v; touch(); }} /></Field>
          </div>
        ) : <p className="hint">Nessuna recluta: la missione paga solo oro e XP.</p>}
      </>
    );
  };
  const pane = [data, () => <EnemyEditor d={d} map={map} onChange={touch} />, recruit][ws.tabs.missions]();

  const list = (
    <ListPane placeholder="Cerca missione" rows={q => (
      <>
        {!d.id && <Row title={d.name || 'Nuova missione'} sub="non ancora creata" chip={dirty(e) ? UNSAVED : null} on onClick={() => open()} />}
        {ws.missions.filter(m => matches(q, m.name, mapName(m.mapId) ?? '')).map(m => (
          <Row
            key={m.id}
            title={m.name}
            on={m.id === d.id}
            sub={`${mapName(m.mapId) ?? 'mappa mancante'} · +${m.gold} oro · ${enemySummary(m.enemies)}${m.recruit ? ` · recluta ${m.recruit.name}` : ''}${trackName(m.trackId) ? ` · ♪ ${trackName(m.trackId)}` : ''}`}
            chip={m.id === d.id && dirty(e) ? UNSAVED : !mapName(m.mapId) ? ['Manca la mappa', 'warn'] : null}
            onClick={() => m.id === d.id ? open() : replace(e, () => open(edit(missionDraft(m))))}
          />
        ))}
        {!ws.missions.length && <p className="hint ws-empty-list">Ancora nessuna missione: la prima si crea qui accanto.</p>}
      </>
    )} />
  );

  return (
    <Frame
      title="Missioni giornaliere"
      bar
      actions={<Btn label="+ Nuova missione" onClick={() => replace(e, () => { ws.tabs.missions = 0; open(edit(blankMission(maps[0]))); })} />}
    >
      <MasterDetail list={list}>
        <EditHead title={d.id ? d.name : 'Nuova missione'}>
          {d.id && (
            <>
              <Btn label="Duplica" cls="ghost" onClick={() => open(edit({ ...clone(d), id: null, name: `${d.name} (copia)` }, blankMission(maps[0])))} />
              <Btn label="Elimina" cls="ghost" onClick={confirmFirst(`del:${d.id}`)} />
            </>
          )}
        </EditHead>
        <Confirm k={`del:${d.id}`} ok="Elimina" cls="warn" run={() => void mutate(api.deleteMission(d.id!), l => { ws.missions = l; ws.mEdit = null; }, false)}>
          Eliminare <b>{d.name}</b>? Sparisce dalle missioni di oggi per tutti i giocatori.
        </Confirm>
        <TabBar names={['Dati', 'Nemici', 'Recluta']} which="missions" />
        <div className="ws-pane">{pane}</div>
        <SaveBar edit={e} label={d.id ? 'Salva missione' : 'Crea missione'} onSave={save} extra={<Btn label="Prova la battaglia" onClick={rehearse} disabled={!d.enemies.length} />} />
      </MasterDetail>
    </Frame>
  );
}
