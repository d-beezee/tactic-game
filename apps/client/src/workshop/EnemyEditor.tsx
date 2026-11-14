import { CLASSES, DEFAULT_RACE, MAX_CLASS_LEVEL, MAX_MISSION_ENEMIES, RACES, allowedRaces, isWalkable, type MapData, type MissionEnemy, type Pos } from '@tactics/core';
import type { CSSProperties } from 'react';
import { raceName } from '../ui';
import { Field, Num, Select } from './parts';
import { draw, ws } from './state';

/**
 * Enemy placement on a map: one button per cell. A tap places an enemy with the brush, or removes it.
 * With `goal`, taps toggle goal cells instead and the brush is hidden.
 * `onChange` runs after every tap and must redraw.
 */
export function EnemyEditor({ d, map: m, goal, onChange }: { d: { enemies: MissionEnemy[] }; map: MapData; goal?: Pos[]; onChange: () => void }) {
  const brush = ws.brush;
  // classes follow the race: changing race keeps the class if that race can take it
  const classes = Object.values(CLASSES).filter(c => allowedRaces(c.id).includes(brush.raceId));
  if (!classes.some(c => c.id === brush.classId)) brush.classId = classes[0].id;

  return (
    <div className="ws-board">
      <div className="ws-board-grid">
        <div className="enemy-grid" style={{ gridTemplateColumns: `repeat(${m.width}, 1fr)` }}>
          {m.heights.flatMap((row, y) => row.map((h, x) => {
            const i = d.enemies.findIndex(e => e.pos.x === x && e.pos.y === y);
            const foe = d.enemies[i];
            const mine = m.spawns.A.some(p => p.x === x && p.y === y);
            const g = goal ? goal.findIndex(p => p.x === x && p.y === y) : -1;
            const what = foe ? `${foe.name ? `${foe.name}: ` : ''}${raceName(foe.raceId)} ${CLASSES[foe.classId].name}, livello ${foe.level}` : mine ? 'Partenza del giocatore' : g >= 0 ? 'Casella obiettivo' : `Casella libera, altezza ${h}`;
            return (
              <button
                key={`${x},${y}`}
                type="button"
                className={`cell t-${m.terrain[y][x]}${mine ? ' mine' : ''}${foe ? ' foe' : ''}${g >= 0 ? ' goal' : ''}`}
                style={{ '--h': h } as CSSProperties}
                disabled={mine || !isWalkable(m, { x, y })}
                title={what}
                aria-label={`${x + 1},${y + 1}: ${what}`}
                onClick={() => {
                  if (goal) {
                    if (g >= 0) goal.splice(g, 1);
                    else goal.push({ x, y });
                  } else if (foe) d.enemies.splice(i, 1);
                  else if (d.enemies.length < MAX_MISSION_ENEMIES) d.enemies.push({ classId: brush.classId, ...(brush.raceId !== DEFAULT_RACE ? { raceId: brush.raceId } : {}), level: brush.level, pos: { x, y } });
                  onChange();
                }}
              >
                {foe ? `${CLASSES[foe.classId].name[0]}${foe.level}` : ''}
              </button>
            );
          }))}
        </div>
        <div className="ws-legend">
          <span><i className="lg-foe" />Nemico: iniziale della classe e livello</span>
          <span><i className="lg-mine" />Partenza del giocatore</span>
          {goal && <span><i className="lg-goal" />Casella obiettivo</span>}
          <span><i className="lg-h" />Più chiaro = più alto</span>
        </div>
      </div>
      <div className="ws-brush">
        <p className="hint">{goal ? 'Tocca le caselle da raggiungere per vincere, toccale di nuovo per toglierle.' : 'Tocca una casella per piazzare il prossimo nemico, toccalo di nuovo per toglierlo.'}</p>
        {!goal && (
          <>
            <Field label="Razza"><Select options={Object.values(RACES).map(r => [r.id, r.name] as [string, string])} value={brush.raceId} set={v => { brush.raceId = v; draw(); }} /></Field>
            <Field label="Classe"><Select options={classes.map(c => [c.id, c.name] as [string, string])} value={brush.classId} set={v => { brush.classId = v; draw(); }} /></Field>
            <Field label="Livello"><Num value={brush.level} set={v => { brush.level = v; draw(); }} min={1} max={MAX_CLASS_LEVEL} /></Field>
          </>
        )}
        <p className="hint">
          {goal
            ? `${goal.length === 1 ? '1 casella' : `${goal.length} caselle`} da raggiungere`
            : `${d.enemies.length === 1 ? '1 nemico' : `${d.enemies.length} nemici`} su ${MAX_MISSION_ENEMIES}`}
        </p>
      </div>
    </div>
  );
}
