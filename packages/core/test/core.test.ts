import { describe, expect, it } from 'vitest';
import demo from '../../../apps/client/src/maps/demo.json';
import {
  apply, createBattle, createUnit, destinations, planTurn, reachable, rollInitiative, sideOf, validateMap,
  activeUnit, BattleError, type MapData,
} from '../src';

const flat = (w: number, h: number, heights?: number[][]): MapData => ({
  id: 't', name: 't', width: w, height: h,
  heights: heights ?? Array.from({ length: h }, () => Array(w).fill(0)),
  terrain: Array.from({ length: h }, () => 'g'.repeat(w)),
  spawns: { A: [{ x: 0, y: 0 }], B: [{ x: w - 1, y: h - 1 }] },
  maxDeploy: 1,
});

describe('map', () => {
  it('demo map is valid', () => expect(validateMap(demo as MapData)).toEqual([]));
  it('rejects bad terrain', () => expect(validateMap({ ...flat(2, 2), terrain: ['gq', 'gg'] })).not.toEqual([]));
});

describe('pathfinding', () => {
  it('respects jump and move', () => {
    // wall of height 3 at x=1 blocks jump 2
    const m = flat(3, 1, [[0, 3, 0]]);
    const u = createUnit('a', 'a', 'A', 'warrior', { x: 0, y: 0 }, 'E');
    expect(destinations(m, [u], u)).toEqual([]);
    const archer = createUnit('b', 'b', 'A', 'archer', { x: 0, y: 0 }, 'E'); // jump 3
    expect(destinations(m, [archer], archer)).toHaveLength(2);
  });
  it('passes allies, is blocked by enemies', () => {
    const m = flat(3, 1);
    const u = createUnit('a', 'a', 'A', 'warrior', { x: 0, y: 0 }, 'E');
    const ally = createUnit('b', 'b', 'A', 'warrior', { x: 1, y: 0 }, 'E');
    expect(destinations(m, [u, ally], u)).toEqual([{ x: 2, y: 0 }]);
    const enemy = { ...ally, team: 'B' as const };
    expect(reachable(m, [u, enemy], u).size).toBe(1);
  });
});

describe('combat', () => {
  it('detects front / flank / back', () => {
    const t = createUnit('t', 't', 'B', 'warrior', { x: 5, y: 5 }, 'N');
    expect(sideOf({ x: 5, y: 4 }, t)).toBe('front');
    expect(sideOf({ x: 6, y: 5 }, t)).toBe('flank');
    expect(sideOf({ x: 5, y: 6 }, t)).toBe('back');
  });
  it('back attack hits harder than front', () => {
    const m = flat(4, 4);
    const hit = (from: { x: number; y: number }) => {
      const a = createUnit('a', 'a', 'A', 'warrior', from, 'N');
      const b = createUnit('b', 'b', 'B', 'warrior', { x: 1, y: 1 }, 'N');
      let s = createBattle(m, [a, b], 1);
      if (activeUnit(s).id === 'b') s = apply(s, { type: 'end', facing: 'N' });
      s = apply(s, { type: 'act', actionId: 'strike', target: { x: 1, y: 1 } });
      return s.events[0].type === 'damage' ? s.events[0].amount : 0;
    };
    expect(hit({ x: 1, y: 2 })).toBeGreaterThan(hit({ x: 1, y: 0 }));
  });
});

describe('battle', () => {
  const units = () => [
    createUnit('a1', 'a1', 'A', 'warrior', { x: 1, y: 0 }, 'S'),
    createUnit('a2', 'a2', 'A', 'archer', { x: 0, y: 1 }, 'S'),
    createUnit('a3', 'a3', 'A', 'cleric', { x: 2, y: 1 }, 'S'),
    createUnit('b1', 'b1', 'B', 'warrior', { x: 8, y: 9 }, 'N'),
    createUnit('b2', 'b2', 'B', 'archer', { x: 9, y: 8 }, 'N'),
    createUnit('b3', 'b3', 'B', 'cleric', { x: 7, y: 9 }, 'N'),
  ];

  it('initiative is deterministic for a seed', () => {
    expect(rollInitiative(units(), 42)).toEqual(rollInitiative(units(), 42));
  });

  it('rejects illegal actions', () => {
    const s = createBattle(demo as MapData, units(), 7);
    expect(() => apply(s, { type: 'move', to: { x: -1, y: 0 } })).toThrow(BattleError);
    expect(() => apply(s, { type: 'end', facing: 'X' as never })).toThrow(BattleError);
  });

  it('AI vs AI always plays legal moves and finishes', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      let s = createBattle(demo as MapData, units(), seed);
      let steps = 0;
      while (!s.winner && steps++ < 2000) for (const a of planTurn(s)) { s = apply(s, a); if (s.winner) break; }
      expect(s.winner).not.toBeNull();
    }
  });
});

import { DEFAULT_ROSTER, parseRoster } from '../src';
describe('roster', () => {
  it('accepts a valid roster and rejects bad data', () => {
    expect(parseRoster(JSON.parse(JSON.stringify(DEFAULT_ROSTER)))).toEqual(DEFAULT_ROSTER);
    expect(parseRoster([{ id: 'x', name: 'x', classId: 'dragon' }])).toBeNull();
    expect(parseRoster({})).toBeNull();
    expect(parseRoster([])).toBeNull();
  });
});

import { blankMap, parseMap, resizeMap } from '../src';
describe('map editing', () => {
  it('blank map is valid and survives a JSON round trip', () => {
    const m = blankMap('m1', 12, 8);
    expect(validateMap(m)).toEqual([]);
    expect(parseMap(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });
  it('parseMap rejects malformed or invalid data without throwing', () => {
    expect(parseMap(null)).toBeNull();
    expect(parseMap({ id: 'x' })).toBeNull();
    expect(parseMap({ ...blankMap('m'), terrain: [1, 2] })).toBeNull();
    const dup = blankMap('m');
    dup.spawns.B[0] = dup.spawns.A[0];
    expect(parseMap(dup)).toBeNull();
  });
  it('resize keeps cells and drops spawns outside', () => {
    const m = blankMap('m', 10, 10);
    m.heights[1][1] = 3;
    const r = resizeMap(m, 6, 6);
    expect(r.heights[1][1]).toBe(3);
    expect(r.spawns.B).toEqual([]); // were on row 9
    expect(r.terrain).toHaveLength(6);
  });
});
