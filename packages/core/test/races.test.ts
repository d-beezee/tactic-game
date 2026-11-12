import { describe, expect, it } from 'vitest';
import {
  actionTargets, addRecruit, allowedRaces, apply, CLASSES, createBattle, createUnit, effectiveStat, isUnlocked, newPlayer, parseMissionEnemies,
  parseRecruit, parseRoster, planTurn, PlayerError, RACES, reachable, unitActions, xpToReach, type BattleState, type MapData, type Unit,
} from '../src';

const flat = (w: number, h: number, heights?: number[][]): MapData => ({
  id: 't', name: 't', width: w, height: h,
  heights: heights ?? Array.from({ length: h }, () => Array(w).fill(0)),
  terrain: Array.from({ length: h }, () => 'g'.repeat(w)),
  spawns: { A: [0, 1, 2, 3].map(x => ({ x, y: 0 })), B: [0, 1, 2, 3].map(x => ({ x, y: h - 1 })) },
  maxDeploy: 4,
});

/** A battle where units play in the given order, first one active. */
const battle = (map: MapData, units: Unit[], seed = 1): BattleState => ({ ...createBattle(map, units, seed), order: units.map(u => u.id), turn: 0 });
const mk = (id: string, team: 'A' | 'B', classId: string, x: number, y: number, raceId?: string, passive: string | null = null) =>
  createUnit(id, id, team, classId, { x, y }, team === 'A' ? 'E' : 'W', 1, passive, {}, raceId);
const get = (s: BattleState, id: string) => s.units.find(u => u.id === id)!;

describe('races', () => {
  it('race-locked classes, and hybrids inherit the lock', () => {
    expect(allowedRaces('green_mage')).toEqual(['peatfolk']);
    expect(allowedRaces('green_knight')).toEqual(['peatfolk']);
    expect(allowedRaces('stormcaller')).toEqual(['corvid']);
    expect(allowedRaces('warrior')).toEqual(Object.keys(RACES));
    for (const id of Object.keys(CLASSES)) expect(allowedRaces(id).length, id).toBeGreaterThan(0);
  });

  it('race bonuses are flat, after level growth', () => {
    const h = createUnit('h', 'h', 'A', 'warrior', { x: 0, y: 0 }, 'S', 3);
    const p = createUnit('p', 'p', 'A', 'warrior', { x: 0, y: 0 }, 'S', 3, null, {}, 'peatfolk');
    expect(p.stats.maxHp).toBe(h.stats.maxHp + 8);
    expect(p.stats.speed).toBe(h.stats.speed - 1);
    expect(p.mods.regenPct).toBe(5);
    expect(() => createUnit('x', 'x', 'A', 'warrior', { x: 0, y: 0 }, 'S', 1, null, {}, 'elf')).toThrow();
  });

  it('a unit can only take classes of its race', () => {
    const base = { id: 'r', name: 'r', classId: 'warrior', xp: { green_mage: xpToReach(4), warrior: xpToReach(3) }, passive: null };
    expect(isUnlocked({ ...base, raceId: 'peatfolk' }, 'green_mage')).toBe(true);
    expect(isUnlocked({ ...base, raceId: 'peatfolk' }, 'green_knight')).toBe(true);
    expect(isUnlocked(base, 'green_mage')).toBe(false); // human by default
    expect(parseRoster([{ ...base, raceId: 'corvid', classId: 'green_mage' }])).toBeNull();
    expect(parseRoster([{ ...base, raceId: 'elf' }])).toBeNull();
    expect(parseRoster([{ ...base, raceId: 'peatfolk', classId: 'green_mage' }])![0].raceId).toBe('peatfolk');
  });

  it('Glitch gets Salto di frame, once per battle', () => {
    const g = mk('g', 'A', 'warrior', 0, 0, 'glitch'), e = mk('e', 'B', 'warrior', 4, 4);
    expect(unitActions(g).map(a => a.id)).toEqual(['strike', 'frame-skip']);
    let s = battle(flat(5, 5), [g, e]);
    s = apply(s, { type: 'act', actionId: 'frame-skip', target: { x: 2, y: 1 } });
    expect(get(s, 'g').pos).toEqual({ x: 2, y: 1 });
    expect(actionTargets(s, get(s, 'g'), unitActions(g)[1])).toEqual([]);
  });

  it('mission enemies and recruits must fit their race', () => {
    const m = flat(5, 5);
    expect(parseMissionEnemies(m, [{ classId: 'green_mage', raceId: 'peatfolk', level: 1, pos: { x: 3, y: 3 } }])[0].raceId).toBe('peatfolk');
    expect(() => parseMissionEnemies(m, [{ classId: 'green_mage', level: 1, pos: { x: 3, y: 3 } }])).toThrow(PlayerError);
    expect(() => parseMissionEnemies(m, [{ classId: 'warrior', raceId: 'elf', level: 1, pos: { x: 3, y: 3 } }])).toThrow(PlayerError);
    expect(parseRecruit(null)).toBeNull();
    expect(parseRecruit({ name: ' Gracchio ', raceId: 'corvid', classId: 'lancer' })).toEqual({ name: 'Gracchio', raceId: 'corvid', classId: 'lancer' });
    expect(() => parseRecruit({ name: 'X', raceId: 'corvid', classId: 'green_mage' })).toThrow(PlayerError);
    expect(() => parseRecruit({ name: 'X', raceId: 'corvid', classId: 'stormcaller' })).toThrow(PlayerError); // not a base class
  });

  it('a recruit joins once', () => {
    const r = { name: 'Gracchio', raceId: 'corvid', classId: 'lancer' };
    const first = addRecruit(newPlayer(), 'abc', r);
    expect(first.unlocked).toBe('Gracchio');
    expect(first.player.roster.at(-1)).toMatchObject({ id: 'm-abc', raceId: 'corvid', classId: 'lancer' });
    expect(addRecruit(first.player, 'abc', r)).toEqual({ player: first.player, unlocked: null });
  });
});

describe('statuses', () => {
  it('poison ticks at turn start and can down the unit, without XP', () => {
    const t = mk('t', 'A', 'thief', 0, 0), e = mk('e', 'B', 'warrior', 1, 0), f = mk('f', 'B', 'warrior', 4, 4);
    let s = battle(flat(5, 5), [t, e, f]);
    s = apply(s, { type: 'act', actionId: 'poison-dagger', target: { x: 1, y: 0 } });
    expect(get(s, 'e').statuses).toEqual([{ id: 'poison', turns: 3 }]);
    const xp = s.xp.t;
    get(s, 'e').hp = 1;
    s = apply(s, { type: 'end', facing: 'E' });
    expect(get(s, 'e').hp).toBe(0);
    expect(s.events.some(ev => ev.type === 'ko' && ev.unitId === 'e')).toBe(true);
    expect(s.xp.t).toBe(xp);
    expect(s.order[s.turn]).toBe('f'); // the downed unit lost its turn
  });

  it('stun skips the turn', () => {
    const a = mk('a', 'A', 'warrior', 0, 0), b = mk('b', 'B', 'warrior', 1, 0), c = mk('c', 'A', 'warrior', 4, 4);
    let s = battle(flat(5, 5), [a, b, c]);
    get(s, 'b').statuses.push({ id: 'stun', turns: 1 });
    s = apply(s, { type: 'end', facing: 'E' });
    expect(s.events.some(ev => ev.type === 'skip' && ev.unitId === 'b')).toBe(true);
    expect(s.order[s.turn]).toBe('c');
    expect(get(s, 'b').statuses).toEqual([]);
  });

  it('root stops movement, buffs and debuffs change stats, refresh does not stack', () => {
    const k = mk('k', 'A', 'green_knight', 0, 0, 'peatfolk'), e = mk('e', 'B', 'warrior', 1, 0);
    let s = battle(flat(5, 5), [k, e]);
    s = apply(s, { type: 'act', actionId: 'bramble-grip', target: { x: 1, y: 0 } });
    expect(reachable(s.map, s.units, get(s, 'e')).size).toBe(1);
    const u = get(s, 'k');
    u.statuses.push({ id: 'def-up', turns: 2 });
    expect(effectiveStat(u, 'def')).toBe(Math.round(u.stats.def * 1.3));
    s = { ...s, acted: false };
    s = apply(s, { type: 'act', actionId: 'bark', target: { x: 0, y: 0 } });
    expect(get(s, 'k').statuses).toEqual([{ id: 'def-up', turns: 3 }]);
  });
});

describe('areas, pushes and swaps', () => {
  it('an area hits every enemy in it and no ally', () => {
    const a = mk('a', 'A', 'arcanist', 0, 2), ally = mk('b', 'A', 'warrior', 3, 1);
    const e1 = mk('e1', 'B', 'warrior', 3, 2), e2 = mk('e2', 'B', 'warrior', 4, 2), far = mk('e3', 'B', 'warrior', 4, 4);
    let s = battle(flat(6, 6), [a, ally, e1, e2, far]);
    s = apply(s, { type: 'act', actionId: 'flames', target: { x: 3, y: 2 } });
    expect(s.events.filter(ev => ev.type === 'damage').map(ev => ev.unitId).sort()).toEqual(['e1', 'e2']);
    expect(get(s, 'b').hp).toBe(get(s, 'b').stats.maxHp);
  });

  it('push: moves away, bumps on obstacles, falls hurt except Corvidi, Pedine stay', () => {
    const row = (r: number[]) => [r, ...Array.from({ length: 3 }, () => [0, 0, 0, 0])];
    const cliff = flat(4, 4, row([0, 5, 5, 0]));
    const pushOnce = (raceId?: string, heights = cliff) => {
      const t = mk('t', 'A', 'thief', 2, 0), e = mk('e', 'B', 'warrior', 1, 0, raceId);
      // stand the target on the cliff, the thief to its right
      const s = apply(battle(heights, [t, e]), { type: 'act', actionId: 'kick', target: { x: 1, y: 0 } });
      return { e: get(s, 'e'), ev: s.events.find(ev => ev.type === 'push') };
    };
    const human = pushOnce();
    expect(human.e.pos).toEqual({ x: 0, y: 0 });
    expect(human.ev).toMatchObject({ damage: Math.round(human.e.stats.maxHp * 0.1 * (5 - 2)) }); // 5 down, jump 2
    expect(pushOnce('corvid').ev).toMatchObject({ damage: 0 });
    expect(pushOnce('pawn').ev).toBeUndefined();
    const wall = pushOnce(undefined, flat(4, 4, row([8, 0, 0, 0])));
    expect(wall.e.pos).toEqual({ x: 1, y: 0 });
    expect(wall.ev).toMatchObject({ damage: Math.round(wall.e.stats.maxHp * 0.1) });
  });

  it('swap trades cells; enemy Pedine cannot be swapped', () => {
    const c = mk('c', 'A', 'corruptor', 0, 0, 'glitch'), e = mk('e', 'B', 'warrior', 2, 0), p = mk('p', 'B', 'warrior', 0, 2, 'pawn');
    const s = apply(battle(flat(5, 5), [c, e, p]), { type: 'act', actionId: 'invert', target: { x: 2, y: 0 } });
    expect(get(s, 'c').pos).toEqual({ x: 2, y: 0 });
    expect(get(s, 'e').pos).toEqual({ x: 0, y: 0 });
    expect(() => apply(battle(flat(5, 5), [c, e, p]), { type: 'act', actionId: 'invert', target: { x: 0, y: 2 } })).toThrow();
  });

  it('thorns hurt melee attackers', () => {
    const a = mk('a', 'A', 'warrior', 0, 0), k = mk('k', 'B', 'warrior', 1, 0, 'peatfolk', 'green_knight');
    const s = apply(battle(flat(4, 4), [a, k]), { type: 'act', actionId: 'strike', target: { x: 1, y: 0 } });
    expect(s.events.some(ev => ev.type === 'tick' && ev.unitId === 'a' && ev.amount < 0)).toBe(true);
  });
});

describe('determinism with new classes', () => {
  it('AI vs AI with every class plays legal moves, finishes, and repeats exactly', () => {
    const races = (c: string) => allowedRaces(c);
    const ids = Object.keys(CLASSES);
    const m = flat(10, 10);
    const units = ids.slice(0, 16).map((c, i) => {
      const team = i % 2 ? 'B' : 'A';
      const race = races(c)[i % races(c).length];
      return createUnit(`u${i}`, `u${i}`, team, c, { x: Math.floor(i / 2) + 1, y: team === 'A' ? 1 : 8 }, team === 'A' ? 'S' : 'N', 4, null, {}, race);
    });
    const run = () => {
      const spawns = (y: number) => Array.from({ length: 8 }, (_, x) => ({ x, y }));
      let s = createBattle({ ...m, maxDeploy: 8, spawns: { A: spawns(0), B: spawns(9) } }, units, 42);
      for (let n = 0; n < 4000 && !s.winner; n++) for (const a of planTurn(s)) { s = apply(s, a); if (s.winner) break; }
      return s;
    };
    const a = run(), b = run();
    expect(a.winner).not.toBeNull();
    expect(b.units).toEqual(a.units);
    expect(b.xp).toEqual(a.xp);
  });
});
