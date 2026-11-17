import { randomBytes } from 'node:crypto';
import { activeUnit, apply, createBattle, deployTeam, PVP_LEVEL, type BattleAction, type PvpState, type Team } from '@tactics/core';
import type pg from 'pg';
import { tx } from '../db';
import { body, canon, HttpError, isUuid, type App } from '../http';
import { BUILTIN_MAP } from '../queries';

/** A PvP player not heard from for this long loses; a lobby player this stale is not matched. */
const PVP_GONE_SECONDS = 45, PVP_LOBBY_SECONDS = 10;
const PVP_MAX_ACTIONS = 2000;
// no 0/O, 1/I/L: the code is read aloud and typed on phones
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(randomBytes(6), b => CODE_CHARS[b % CODE_CHARS.length]).join('');
/** Each team's own columns in pvp_matches. */
const COLS = { A: { seen: 'seen_a', deploy: 'deploy_a' }, B: { seen: 'seen_b', deploy: 'deploy_b' } } as const;
const otherTeam = (t: Team): Team => t === 'A' ? 'B' : 'A';

// shortcut: clients poll once a second; switch to SSE or WebSocket if turn latency matters.
export function pvpRoutes(app: App, pool: pg.Pool) {
  /** A player has one PvP match at a time: entering the lobby or a room resigns or drops the old one. */
  const leaveOtherMatches = async (db: pg.PoolClient, userId: string) => {
    await db.query(`DELETE FROM pvp_matches WHERE status = 'waiting' AND player_a = $1`, [userId]);
    await db.query(
      `UPDATE pvp_matches SET status = 'done', reason = 'resign', winner = CASE WHEN player_a = $1 THEN 'B' ELSE 'A' END
       WHERE status IN ('deploy', 'battle') AND $1 IN (player_a, player_b)`, [userId]);
  };
  const createWaiting = async (db: pg.PoolClient, userId: string, code: string | null) =>
    (await db.query('INSERT INTO pvp_matches (player_a, map, code) VALUES ($1, $2, $3) RETURNING id', [userId, JSON.stringify(BUILTIN_MAP), code])).rows[0].id as string;

  // lobby: join the oldest player still searching, or start searching; the advisory lock makes two searchers pair up instead of both waiting
  app.post('/api/pvp/queue', async c => {
    const userId = c.get('userId');
    return c.json(await tx(pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(727275)');
      await leaveOtherMatches(db, userId);
      const { rows: [m] } = await db.query(
        `UPDATE pvp_matches SET player_b = $1, seen_b = now(), status = 'deploy'
         WHERE id = (SELECT id FROM pvp_matches WHERE status = 'waiting' AND code IS NULL AND player_a <> $1
                     AND seen_a > now() - interval '${PVP_LOBBY_SECONDS} seconds' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
         RETURNING id`, [userId]);
      return { id: m?.id ?? await createWaiting(db, userId, null) };
    }));
  });

  app.post('/api/pvp/rooms', async c => {
    const userId = c.get('userId');
    return c.json(await tx(pool, async db => {
      await leaveOtherMatches(db, userId);
      return { id: await createWaiting(db, userId, newCode()) };
    }));
  });

  app.post('/api/pvp/join', async c => {
    const code = String((await body(c)).code ?? '').trim().toUpperCase();
    const userId = c.get('userId');
    return c.json(await tx(pool, async db => {
      const { rows: [m] } = await db.query(`SELECT id, player_a FROM pvp_matches WHERE code = $1 AND status = 'waiting' FOR UPDATE`, [code]);
      if (!m) throw new HttpError(404, 'Codice non trovato o stanza già piena');
      if (m.player_a === userId) throw new HttpError(400, 'Questo è il codice della tua stanza: mandalo a un amico');
      await leaveOtherMatches(db, userId);
      // the code is free again once the room is full
      await db.query(`UPDATE pvp_matches SET player_b = $2, seen_b = now(), status = 'deploy', code = NULL WHERE id = $1`, [m.id, userId]);
      return { id: m.id };
    }));
  });

  /** Loads the caller's match with a row lock and their team, or throws 404. */
  const lockMatch = async (db: pg.PoolClient, id: string, userId: string) => {
    if (!isUuid(id)) throw new HttpError(404, 'Partita non trovata');
    const { rows: [m] } = await db.query('SELECT * FROM pvp_matches WHERE id = $1 AND $2 IN (player_a, player_b) FOR UPDATE', [id, userId]);
    if (!m) throw new HttpError(404, 'Partita non trovata');
    return { m, team: (m.player_a === userId ? 'A' : 'B') as Team };
  };

  // poll: marks the caller as present, ends the match if the other player vanished, returns what changed since action `from`.
  // A POST, not a GET: it writes.
  app.post('/api/pvp/:id/poll', async c => {
    const userId = c.get('userId');
    const from = Math.max(0, Number(c.req.query('from')) || 0);
    return c.json<PvpState>(await tx(pool, async db => {
      const { m, team } = await lockMatch(db, c.req.param('id'), userId);
      await db.query(`UPDATE pvp_matches SET ${COLS[team].seen} = now() WHERE id = $1`, [m.id]);
      if ((m.status === 'deploy' || m.status === 'battle') && Date.now() - new Date(m[COLS[otherTeam(team)].seen]).getTime() > PVP_GONE_SECONDS * 1000) {
        await db.query(`UPDATE pvp_matches SET status = 'done', winner = $2, reason = 'gone' WHERE id = $1`, [m.id, team]);
        Object.assign(m, { status: 'done', winner: team, reason: 'gone' });
      }
      return {
        status: m.status, team, code: m.code, map: m.map,
        deployed: !!m[COLS[team].deploy],
        seed: m.seed === null ? null : Number(m.seed), units: m.units,
        actions: (m.actions as BattleAction[]).slice(from), winner: m.winner, reason: m.reason,
      };
    }));
  });

  // PvP fights at a fixed level: XP and gold never come from it
  app.post('/api/pvp/:id/deploy', async c => {
    const { deploy } = await body(c);
    const userId = c.get('userId');
    return c.json(await tx(pool, async db => {
      const { m, team } = await lockMatch(db, c.req.param('id'), userId);
      if (m.status !== 'deploy') throw new HttpError(409, 'La partita non è nella fase di schieramento');
      const { rows: [user] } = await db.query('SELECT roster FROM users WHERE id = $1', [userId]);
      const units = deployTeam(user.roster, m.map, deploy, team, { level: PVP_LEVEL, idPrefix: `${team.toLowerCase()}-` });
      m[COLS[team].deploy] = units;
      if (m.deploy_a && m.deploy_b) {
        const all = [...m.deploy_a, ...m.deploy_b], seed = randomBytes(4).readUInt32BE();
        createBattle(m.map, all, seed); // checks the two teams together
        await db.query(`UPDATE pvp_matches SET deploy_a = $2, deploy_b = $3, units = $4, seed = $5, status = 'battle' WHERE id = $1`,
          [m.id, JSON.stringify(m.deploy_a), JSON.stringify(m.deploy_b), JSON.stringify(all), seed]);
      } else {
        await db.query(`UPDATE pvp_matches SET ${COLS[team].deploy} = $2 WHERE id = $1`, [m.id, JSON.stringify(units)]);
      }
      return { ok: true };
    }));
  });

  // one action of the caller's team; `index` makes a retried request harmless
  app.post('/api/pvp/:id/actions', async c => {
    const { index, action } = await body(c);
    const userId = c.get('userId');
    return c.json(await tx(pool, async db => {
      const { m, team } = await lockMatch(db, c.req.param('id'), userId);
      const actions = m.actions as unknown[];
      if (Number.isInteger(index) && index < actions.length && canon(actions[index]) === canon(action)) return { ok: true };
      if (m.status !== 'battle') throw new HttpError(409, 'La partita è finita');
      if (index !== actions.length || actions.length >= PVP_MAX_ACTIONS) throw new HttpError(409, 'Azione fuori sequenza');
      let s = createBattle(m.map, m.units, Number(m.seed));
      for (const a of actions) s = apply(s, a as BattleAction);
      if (activeUnit(s).team !== team) throw new HttpError(409, 'Non è il tuo turno');
      try {
        s = apply(s, action);
      } catch {
        throw new HttpError(400, 'Azione non valida');
      }
      await db.query(`UPDATE pvp_matches SET actions = actions || $2::jsonb, status = $3, winner = $4, reason = $5 WHERE id = $1`,
        [m.id, JSON.stringify([action]), s.winner ? 'done' : 'battle', s.winner, s.winner ? 'battle' : null]);
      return { ok: true };
    }));
  });

  app.post('/api/pvp/:id/leave', async c => {
    const userId = c.get('userId');
    return c.json(await tx(pool, async db => {
      const { m, team } = await lockMatch(db, c.req.param('id'), userId);
      if (m.status === 'waiting') await db.query('DELETE FROM pvp_matches WHERE id = $1', [m.id]);
      else if (m.status !== 'done') await db.query(`UPDATE pvp_matches SET status = 'done', winner = $2, reason = 'resign' WHERE id = $1`, [m.id, otherTeam(team)]);
      return { ok: true };
    }));
  });
}
