// Integration tests against the docker-compose Postgres: each run starts from an empty tactics_test database.
import { activeUnit, apply, createBattle, DEMO_MAP, planTurn, type Account, type BattleAction, type BattleResult, type BattleStart, type Chapter, type Mission, type PvpState, type Unit } from '@tactics/core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { migrate } from '../src/db';

const BASE = process.env.TEST_DATABASE_URL ?? 'postgres://tactics:tactics@localhost:5433';
let pool: pg.Pool;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: `${BASE}/tactics` });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS tactics_test WITH (FORCE)');
  await admin.query('CREATE DATABASE tactics_test');
  await admin.end();
  pool = new pg.Pool({ connectionString: `${BASE}/tactics_test` });
  const log = console.log;
  console.log = () => {}; // migrations log one line each
  await migrate(pool).finally(() => { console.log = log; });
  app = createApp(pool, 'test');
});

afterAll(() => pool?.end());

/** A logged-in player: call(method, path, body) returns [status, json]. */
async function signUp(email: string) {
  const res = await app.request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  expect(res.status).toBe(200);
  const cookie = res.headers.get('set-cookie')!.split(';')[0];
  const account = await res.json() as Account;
  const call = async <T = any>(method: string, path: string, body?: unknown): Promise<[number, T]> => {
    const r = await app.request(`/api${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return [r.status, await r.json() as T];
  };
  return { account, call };
}

const map = DEMO_MAP;
const deployOf = (a: Account, n = map.maxDeploy) => map.spawns.A.slice(0, n).map((pos, i) => ({ id: a.roster[i].id, pos }));

/** Plays both sides with the AI, as the client would, and returns the player's actions. */
function play(units: Unit[], seed: number) {
  let s = createBattle(map, units, seed);
  const log: BattleAction[] = [];
  while (!s.winner) {
    const mine = activeUnit(s).team === 'A';
    for (const a of planTurn(s)) {
      s = apply(s, a);
      if (mine) log.push(a);
      if (s.winner) break;
    }
  }
  return { winner: s.winner, log };
}

/** Starts battles until the AI-played player side wins one; the opponent is a single level 1 enemy, so this takes one or two tries. */
async function winBattle(call: Awaited<ReturnType<typeof signUp>>['call'], target: object, deploy: unknown) {
  for (let i = 0; i < 10; i++) {
    const [status, b] = await call<BattleStart>('POST', '/battles', { ...target, deploy });
    expect(status).toBe(200);
    const { winner, log } = play(b.units, b.seed);
    if (winner === 'A') return { id: b.id, log };
  }
  throw new Error('no win in 10 battles');
}

describe('rewards', () => {
  let admin: Awaited<ReturnType<typeof signUp>>;
  let mission: Mission;

  beforeAll(async () => {
    admin = await signUp('admin@test.it');
    expect(admin.account.admin).toBe(true);
    const enemy = map.spawns.B[0];
    const [status, missions] = await admin.call<Mission[]>('POST', '/admin/missions', { name: 'Facile', mapId: map.id, gold: 40, enemies: [{ classId: 'warrior', level: 1, pos: enemy }], recruit: null, trackId: null });
    expect(status).toBe(200);
    mission = missions[0];
  });

  it('a second /finish for the same battle returns the same result and pays once', async () => {
    const p = await signUp('double@test.it');
    const { id, log } = await winBattle(p.call, { missionId: mission.id }, deployOf(p.account));
    const [s1, r1] = await p.call<BattleResult>('POST', `/battles/${id}/finish`, { actions: log });
    const [s2, r2] = await p.call<BattleResult>('POST', `/battles/${id}/finish`, { actions: log });
    expect([s1, s2]).toEqual([200, 200]);
    expect(r1.paid).toBe(true);
    expect(r2).toEqual(r1);
    const [, me] = await p.call<Account>('GET', '/me');
    expect(me.gold).toBe(p.account.gold + 40);
  });

  it('a mission already won today does not pay again', async () => {
    const p = await signUp('daily@test.it');
    const first = await winBattle(p.call, { missionId: mission.id }, deployOf(p.account));
    expect((await p.call<BattleResult>('POST', `/battles/${first.id}/finish`, { actions: first.log }))[1].paid).toBe(true);
    const second = await winBattle(p.call, { missionId: mission.id }, deployOf(p.account));
    const [, r] = await p.call<BattleResult>('POST', `/battles/${second.id}/finish`, { actions: second.log });
    expect(r).toMatchObject({ won: true, paid: false, gold: 0 });
    const [, me] = await p.call<Account>('GET', '/me');
    expect(me.gold).toBe(p.account.gold + 40);
    const [, missions] = await p.call<Mission[]>('GET', '/missions');
    expect(missions[0].done).toBe(true);
  });

  it('an unfinished action list is refused and pays nothing', async () => {
    const p = await signUp('cheat@test.it');
    const { id, log } = await winBattle(p.call, { missionId: mission.id }, deployOf(p.account));
    const [status] = await p.call('POST', `/battles/${id}/finish`, { actions: log.slice(0, -1) });
    expect(status).toBe(400);
    const [, me] = await p.call<Account>('GET', '/me');
    expect(me.gold).toBe(p.account.gold);
  });

  it('a player cannot finish another player\'s battle', async () => {
    const p = await signUp('owner@test.it'), other = await signUp('thief@test.it');
    const { id, log } = await winBattle(p.call, { missionId: mission.id }, deployOf(p.account));
    expect((await other.call('POST', `/battles/${id}/finish`, { actions: log }))[0]).toBe(404);
  });
});

describe('PvP', () => {
  /** Two players in a private room, both deployed: the match is in battle. */
  async function match() {
    const a = await signUp(`a${Math.random()}@test.it`), b = await signUp(`b${Math.random()}@test.it`);
    const [, { id }] = await a.call<{ id: string }>('POST', '/pvp/rooms');
    const [, room] = await a.call<PvpState>('POST', `/pvp/${id}/poll`);
    expect((await b.call('POST', '/pvp/join', { code: room.code }))[0]).toBe(200);
    const two = (acc: Account, spawns: typeof map.spawns.A) => spawns.slice(0, 2).map((pos, i) => ({ id: acc.roster[i].id, pos }));
    expect((await a.call('POST', `/pvp/${id}/deploy`, { deploy: two(a.account, map.spawns.A) }))[0]).toBe(200);
    expect((await b.call('POST', `/pvp/${id}/deploy`, { deploy: two(b.account, map.spawns.B) }))[0]).toBe(200);
    const [, state] = await a.call<PvpState>('POST', `/pvp/${id}/poll`);
    expect(state.status).toBe('battle');
    const s = createBattle(state.map, state.units!, state.seed!);
    const first = activeUnit(s).team;
    const [mover, waiter] = first === 'A' ? [a, b] : [b, a];
    return { id, s, mover, waiter };
  }

  it('an action out of turn is refused', async () => {
    const { id, s, waiter } = await match();
    const [status, err] = await waiter.call('POST', `/pvp/${id}/actions`, { index: 0, action: planTurn(s)[0] });
    expect(status).toBe(409);
    expect(err.error).toBe('Non è il tuo turno');
  });

  it('a repeated action with the same index is applied once', async () => {
    const { id, s, mover } = await match();
    const action = planTurn(s)[0];
    expect((await mover.call('POST', `/pvp/${id}/actions`, { index: 0, action }))[0]).toBe(200);
    expect((await mover.call('POST', `/pvp/${id}/actions`, { index: 0, action }))[0]).toBe(200);
    const [, state] = await mover.call<PvpState>('POST', `/pvp/${id}/poll`);
    expect(state.actions).toHaveLength(1);
  });

  it('an action that skips ahead is refused', async () => {
    const { id, s, mover } = await match();
    expect((await mover.call('POST', `/pvp/${id}/actions`, { index: 1, action: planTurn(s)[0] }))[0]).toBe(409);
  });
});

describe('campaign and roster', () => {
  it('an edited chapter keeps every field and its unlock id', async () => {
    const admin = await signUp('editor@test.it');
    await pool.query("UPDATE users SET is_admin = true WHERE email = 'editor@test.it'");
    const [, { chapters: [ch] }] = await admin.call<{ chapters: Chapter[] }>('GET', '/campaign');
    const { id, mapId, map: _, unlock, ...input } = ch;
    const [status, after] = await admin.call<Chapter[]>('PUT', `/admin/chapters/${id}`, { ...input, mapId, title: 'Nuovo titolo', unlock: { ...unlock, id: undefined } });
    expect(status).toBe(200);
    expect(after[0]).toMatchObject({ ...input, mapId, title: 'Nuovo titolo', unlock });
  });

  it('kicking keeps the campaign units and the last unit', async () => {
    const p = await signUp('kick@test.it');
    const [ok, me] = await p.call<Account>('POST', `/units/kick/${p.account.roster[1].id}`);
    expect(ok).toBe(200);
    expect(me.roster).toHaveLength(p.account.roster.length - 1);
    for (const u of me.roster.slice(1)) expect((await p.call('POST', `/units/kick/${u.id}`))[0]).toBe(200);
    expect((await p.call('POST', `/units/kick/${me.roster[0].id}`))[0]).toBe(400);
  });
});

describe('access', () => {
  it('needs a session for the API and admin rights for the Workshop', async () => {
    expect((await app.request('/api/me')).status).toBe(401);
    const p = await signUp('plain@test.it');
    expect(p.account.admin).toBe(false);
    expect((await p.call('GET', '/me'))[0]).toBe(200);
    expect((await p.call('GET', '/admin/users'))[0]).toBe(403);
    expect((await p.call('GET', '/nope'))[0]).toBe(404);
  });
});
