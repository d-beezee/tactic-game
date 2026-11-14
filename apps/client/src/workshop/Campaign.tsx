import {
  CLASSES, DEFAULT_RACE, DEFAULT_ROSTER, FXS, MAX_CLASS_LEVEL, RACES, SCENES, allowedRaces, classLevel, xpToReach,
  type Chapter, type Fx, type Goal, type Line, type MapData, type RosterUnit,
} from '@tactics/core';
import { api } from '../api';
import { allMaps, BUILTIN_MAPS } from '../maps';
import { raceName } from '../ui';
import { EnemyEditor } from './EnemyEditor';
import { Btn, Check, Confirm, confirmFirst, EditHead, Field, Frame, ListPane, MasterDetail, Num, Row, SaveBar, Select, TabBar, Text, UNSAVED } from './parts';
import { baseClassesOf, clone, defaultEnemies, dirty, draw, edit, mapName, matches, mutate, replace, touch, ws, type ChapterDraft, type Edit } from './state';

const GOAL_NAMES: Record<Goal['type'], string> = { rout: 'Sconfiggi tutti', survive: 'Sopravvivi', reach: 'Raggiungi le caselle', boss: 'Sconfiggi il boss' };
const GOAL_HINTS: Record<Goal['type'], string> = { rout: 'vince chi resta in piedi', survive: 'resisti per un numero di round', reach: 'porta un\'unità sulle caselle', boss: 'abbatti un nemico preciso' };
const goalText = (g: Goal) => g.type === 'survive' ? `sopravvivi ${g.rounds === 1 ? '1 round' : `${g.rounds} round`}` : GOAL_NAMES[g.type].toLowerCase();
const SCENE_NAMES: Record<Line['scene'], string> = { bedroom: 'Cameretta', crt: 'Monitor', map: 'Mappa', black: 'Nero' };
const FX_NAMES: Record<Fx, string> = { glitch: 'disturbo', suck: 'risucchio', flash: 'lampo', shake: 'scossa' };

const newUnlock = (): Omit<RosterUnit, 'id'> => ({ name: '', classId: 'warrior', xp: { warrior: xpToReach(3) }, passive: null });
const chapterDraft = (ch: Chapter | null, map: MapData): ChapterDraft => {
  const g = ch?.goal ?? { type: 'rout' };
  const { id: _, ...unlock } = ch?.unlock ?? { id: '', ...newUnlock() };
  return {
    id: ch?.id ?? null, mapId: map.id, label: ch?.label ?? '', title: ch?.title ?? '', blurb: ch?.blurb ?? '', gold: ch?.gold ?? 150, crt: !!ch?.crt,
    enemies: ch ? clone(ch.enemies) : defaultEnemies(map), required: [...(ch?.required ?? [])], before: clone(ch?.before ?? []), after: clone(ch?.after ?? []),
    goalType: g.type, rounds: g.type === 'survive' ? g.rounds : 5, cells: g.type === 'reach' ? clone(g.cells) : [],
    boss: g.type === 'boss' ? Number(g.unitId.slice(5)) : 0,
    unlockOn: !!ch?.unlock, unlock, unlockLevel: classLevel({ id: '', ...unlock }, unlock.classId),
  };
};
const goalOf = (d: ChapterDraft): Goal => d.goalType === 'survive' ? { type: 'survive', rounds: d.rounds } : d.goalType === 'reach' ? { type: 'reach', cells: d.cells }
  : d.goalType === 'boss' ? { type: 'boss', unitId: `enemy${d.boss}` } : { type: 'rout' };

export function Campaign() {
  const maps = allMaps().filter(m => !BUILTIN_MAPS.some(b => b.id === m.id));
  if (!maps.length) return (
    <Frame title="Cronache di Valdombra">
      <div className="ws-empty">
        <div className="ws-empty-mark" aria-hidden="true" />
        <h3>Prima serve una mappa</h3>
        <p>Ogni capitolo si gioca su una mappa salvata. La mappa dimostrativa non si può usare nella campagna.</p>
        <Btn label="Apri l'editor mappe" cls="primary" onClick={ws.ctx.mapEditor} />
      </div>
    </Frame>
  );
  // the open draft goes away with its chapter or its map
  if (ws.cEdit?.d.id && !ws.chapters.some(c => c.id === ws.cEdit!.d.id)) ws.cEdit = null;
  if (ws.cEdit && !maps.some(m => m.id === ws.cEdit!.d.mapId)) ws.cEdit = null;
  const e = ws.cEdit ??= edit(chapterDraft(null, maps[0]));
  const d = e.d, map = maps.find(m => m.id === d.mapId)!;
  const chapters = ws.chapters;
  const at = d.id ? chapters.findIndex(c => c.id === d.id) : chapters.length;
  const ch = chapters[at];
  /** Opens a draft in the editor. */
  const open = (next: Edit<ChapterDraft> = e) => { ws.cEdit = next; ws.open = true; draw(); };

  const save = () => {
    const before = chapters;
    const c = {
      mapId: d.mapId, label: d.label, title: d.title, blurb: d.blurb, gold: d.gold, crt: d.crt, enemies: d.enemies, goal: goalOf(d),
      required: d.required, unlock: d.unlockOn ? d.unlock : null, before: d.before, after: d.after,
    };
    void mutate(d.id ? api.updateChapter(d.id, c) : api.createChapter(c), list => {
      ws.chapters = list;
      const saved = list.find(x => x.id === d.id) ?? list.find(x => !before.some(b => b.id === x.id));
      ws.cEdit = saved ? edit(chapterDraft(saved, maps.find(m => m.id === saved.mapId) ?? maps[0])) : null;
    });
  };
  const rehearse = () => ws.ctx.rehearse({
    id: 'prova', mapId: d.mapId, map, label: d.label, title: d.title, blurb: d.blurb, gold: 0, crt: d.crt, enemies: d.enemies, goal: goalOf(d),
    // a draft may ask for allies this account has not unlocked yet
    required: d.required.filter(id => ws.ctx.player.roster.some(u => u.id === id)), unlock: null, before: d.before, after: d.after,
  }, null);
  const move = (dir: -1 | 1) => void mutate(api.moveChapter(d.id!, dir), l => { ws.chapters = l; }, false);

  const story = () => (
    <>
      <div className="ws-fields">
        <Field label="Etichetta"><Text value={d.label} set={v => { d.label = v; touch(); }} maxLength={30} placeholder="es. Capitolo 4" /></Field>
        <Field label="Titolo"><Text value={d.title} set={v => { d.title = v; touch(); }} maxLength={60} /></Field>
        <Field label="Descrizione" wide help="Una riga, sotto il titolo nella lista dei capitoli."><Text value={d.blurb} set={v => { d.blurb = v; touch(); }} maxLength={160} /></Field>
      </div>
      <Check label="La battaglia si gioca dentro il monitor della cameretta" on={!!d.crt} set={v => { d.crt = v; touch(); }} />
    </>
  );
  const battle = () => (
    <>
      <div className="ws-fields">
        <Field label="Mappa" help="Cambiare mappa rimette i nemici sulle partenze e svuota le caselle obiettivo.">
          <Select options={maps.map(m => [m.id, m.name] as [string, string])} value={d.mapId} set={v => { d.mapId = v; d.enemies = defaultEnemies(maps.find(m => m.id === v)!); d.cells = []; draw(); }} />
        </Field>
      </div>
      <EnemyEditor d={d} map={map} onChange={() => { if (d.boss >= d.enemies.length) d.boss = 0; touch(); }} />
    </>
  );
  // four cards, because each goal changes the fields below
  const goal = () => (
    <>
      <div className="ws-cards" role="radiogroup" aria-label="Obiettivo">
        {(Object.keys(GOAL_NAMES) as Goal['type'][]).map(t => (
          <button key={t} type="button" role="radio" aria-checked={t === d.goalType} className={`ws-card${t === d.goalType ? ' on' : ''}`} onClick={() => { d.goalType = t; draw(); }}>
            <b>{GOAL_NAMES[t]}</b><small>{GOAL_HINTS[t]}</small>
          </button>
        ))}
      </div>
      {d.goalType === 'survive' && (
        <div className="ws-fields"><Field label="Durata" unit="round"><Num value={d.rounds} set={v => { d.rounds = v; touch(); }} min={1} max={30} /></Field></div>
      )}
      {d.goalType === 'boss' && (
        <div className="ws-fields">
          {d.enemies.length ? (
            <Field label="Boss" help="Scelto tra i nemici della scheda Battaglia.">
              <Select
                options={d.enemies.map((x, i) => [String(i), `${x.name ?? `${raceName(x.raceId)} ${CLASSES[x.classId].name}`}, livello ${x.level} (${x.pos.x + 1},${x.pos.y + 1})`] as [string, string])}
                value={String(Math.min(d.boss, d.enemies.length - 1))}
                set={v => { d.boss = Number(v); touch(); }}
              />
            </Field>
          ) : <p className="hint">Piazza almeno un nemico nella scheda Battaglia.</p>}
        </div>
      )}
      {d.goalType === 'reach' && <EnemyEditor d={d} map={map} goal={d.cells} onChange={touch} />}
    </>
  );
  const squad = () => {
    // required units: the starting roster plus what the chapters before this one unlock
    const pool = [...DEFAULT_ROSTER, ...chapters.slice(0, at).flatMap(c => c.unlock ? [c.unlock] : [])];
    const un = d.unlock, race = un.raceId ?? DEFAULT_RACE;
    // the unlock keeps its XP until its class or level changes, so a multi-class unit survives a text edit
    const resetXp = () => { un.xp = { [un.classId]: xpToReach(d.unlockLevel) }; };
    // the class follows the race; a class the race can take but not start in stays in the list
    const base = baseClassesOf(race);
    if (!base.some(c => c.id === un.classId) && !allowedRaces(un.classId).includes(race)) { un.classId = base[0].id; resetXp(); }
    const classes = base.some(c => c.id === un.classId) ? base : [CLASSES[un.classId], ...base];
    return (
      <>
        <fieldset className="ws-set">
          <legend>Devono combattere</legend>
          {pool.map(u => (
            <Check key={u.id} label={u.name} on={d.required.includes(u.id)} set={v => { d.required = v ? [...d.required, u.id] : d.required.filter(id => id !== u.id); touch(); }} />
          ))}
        </fieldset>
        <div className="ws-fields">
          <Field label="Premio alla prima vittoria" unit="oro" help="Più XP. Le vittorie dopo la prima non pagano."><Num value={d.gold} set={v => { d.gold = v; touch(); }} min={0} max={10000} /></Field>
        </div>
        <Check label="Alla prima vittoria si unisce un alleato" on={d.unlockOn} set={v => { d.unlockOn = v; draw(); }} />
        {d.unlockOn && (
          <div className="ws-fields">
            <Field label="Nome dell'alleato"><Text value={un.name} set={v => { un.name = v; touch(); }} maxLength={20} /></Field>
            <Field label="Razza"><Select options={Object.values(RACES).map(r => [r.id, r.name] as [string, string])} value={race} set={v => { un.raceId = v; touch(); }} /></Field>
            <Field label="Classe"><Select options={classes.map(c => [c.id, c.name] as [string, string])} value={un.classId} set={v => { un.classId = v; resetXp(); touch(); }} /></Field>
            <Field label="Livello"><Num value={d.unlockLevel} set={v => { d.unlockLevel = v; resetXp(); touch(); }} min={1} max={MAX_CLASS_LEVEL} /></Field>
          </div>
        )}
      </>
    );
  };
  const cutscenes = () => (
    <>
      <Lines lines={d.before} k="before" title="Prima della battaglia" />
      <Lines lines={d.after} k="after" title="Dopo la vittoria" />
    </>
  );
  const pane = [story, battle, goal, squad, cutscenes][ws.tabs.campaign]();

  const list = (
    <ListPane placeholder="Cerca capitolo" rows={q => (
      <>
        {chapters.filter(c => matches(q, c.label, c.title)).map(c => (
          <Row
            key={c.id}
            label={c.label}
            title={c.title}
            on={c.id === d.id}
            sub={`${mapName(c.mapId) ?? 'mappa mancante'} · ${goalText(c.goal)}`}
            chip={c.id === d.id && dirty(e) ? UNSAVED : !c.map ? ['Manca la mappa', 'warn'] : null}
            onClick={() => c.id === d.id ? open() : replace(e, () => open(edit(chapterDraft(c, maps.find(m => m.id === c.mapId) ?? maps[0]))))}
          />
        ))}
        {!d.id && <Row label={d.label || 'Nuovo'} title={d.title || 'Nuovo capitolo'} sub="non ancora creato" chip={dirty(e) ? UNSAVED : null} on onClick={() => open()} />}
      </>
    )} />
  );

  return (
    <Frame
      title="Cronache di Valdombra"
      bar
      actions={<Btn label="+ Nuovo capitolo" onClick={() => replace(e, () => { ws.tabs.campaign = 0; open(edit(chapterDraft(null, maps[0]))); })} />}
    >
      <MasterDetail list={list}>
        <EditHead title={d.id ? `${ch?.label ?? ''} · ${ch?.title ?? ''}` : 'Nuovo capitolo'}>
          {d.id && (
            <>
              <Btn label="↑" cls="ghost" onClick={() => move(-1)} disabled={at === 0} />
              <Btn label="↓" cls="ghost" onClick={() => move(1)} disabled={at === chapters.length - 1} />
              <Btn label="Duplica" cls="ghost" onClick={() => open(edit({ ...clone(d), id: null, title: `${d.title} (copia)` }, chapterDraft(null, maps[0])))} />
              <Btn label="Elimina" cls="ghost" onClick={confirmFirst(`del:${d.id}`)} />
            </>
          )}
        </EditHead>
        <Confirm k={`del:${d.id}`} ok="Elimina" cls="warn" run={() => void mutate(api.deleteChapter(d.id!), l => { ws.chapters = l; ws.cEdit = null; }, false)}>
          Eliminare <b>{d.title}</b>? Chi l'ha già vinto tiene ricompense e alleato.
        </Confirm>
        <TabBar names={['Racconto', 'Battaglia', 'Obiettivo', 'Squadra e premio', 'Cutscene']} which="campaign" />
        <div className="ws-pane">{pane}</div>
        <SaveBar edit={e} label={d.id ? 'Salva capitolo' : 'Crea capitolo'} onSave={save} extra={<Btn label="Prova il capitolo" onClick={rehearse} disabled={!d.enemies.length} />} />
      </MasterDetail>
    </Frame>
  );
}

/** A cutscene as a list of closed lines; the open one shows its fields and a preview of the dialogue box. `k` names the cutscene. */
function Lines({ lines, k, title }: { lines: Line[]; k: string; title: string }) {
  const show = (id: string) => { ws.openLine = id; draw(); };
  return (
    <fieldset className="ws-set ws-lines">
      <legend>{title} · {lines.length === 1 ? '1 battuta' : `${lines.length} battute`}</legend>
      {lines.map((l, i) => {
        const id = `${k}:${i}`;
        if (ws.openLine !== id) return (
          <button key={i} type="button" className="ws-line" onClick={() => show(id)}>
            <small>{[SCENE_NAMES[l.scene], l.who ?? 'Narratore', l.fx && FX_NAMES[l.fx]].filter(Boolean).join(' · ')}</small>
            <span>{l.text || 'Battuta vuota'}</span>
          </button>
        );
        const move = (to: number) => { [lines[i], lines[to]] = [lines[to], lines[i]]; ws.openLine = `${k}:${to}`; touch(); };
        return (
          <div key={i} className="ws-line open">
            <div className="ws-fields">
              <Field label="Scena"><Select options={SCENES.map(s => [s, SCENE_NAMES[s]] as [Line['scene'], string])} value={l.scene} set={v => { l.scene = v; touch(); }} /></Field>
              <Field label="Chi parla"><Text value={l.who ?? ''} set={v => { if (v.trim()) l.who = v; else delete l.who; touch(); }} maxLength={20} placeholder="Narratore" /></Field>
              <Field label="Effetto">
                <Select<string> options={[['', 'Nessuno'], ...FXS.map(f => [f, FX_NAMES[f]] as [string, string])]} value={l.fx ?? ''} set={v => { if (v) l.fx = v as Fx; else delete l.fx; touch(); }} />
              </Field>
              <Field label="Testo" wide><textarea className="field" rows={2} maxLength={200} value={l.text} onChange={ev => { l.text = ev.target.value; touch(); }} /></Field>
            </div>
            <div className={`ws-story${l.who ? '' : ' narration'}`}>{l.who && <b>{l.who}</b>}<span>{l.text || '…'}</span></div>
            <div className="ws-line-actions">
              <Btn label="Sposta su" cls="ghost" onClick={() => move(i - 1)} disabled={i === 0} />
              <Btn label="Sposta giù" cls="ghost" onClick={() => move(i + 1)} disabled={i === lines.length - 1} />
              <Btn label="Elimina battuta" cls="ghost" onClick={() => { lines.splice(i, 1); ws.openLine = ''; touch(); }} />
              <Btn label="Chiudi" onClick={() => show('')} />
            </div>
          </div>
        );
      })}
      <Btn label="+ Battuta" cls="ghost" onClick={() => { lines.push({ scene: lines.at(-1)?.scene ?? 'map', text: '' }); ws.openLine = `${k}:${lines.length - 1}`; touch(); }} />
    </fieldset>
  );
}
