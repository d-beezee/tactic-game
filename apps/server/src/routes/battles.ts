import { randomBytes } from 'node:crypto';
import {
  addRecruit, chapterOpen, chapterUnits, deployBattle, joinRoster, missionUnits, parseMissionEnemies, payBattle, replayBattle,
  type BattleResult, type BattleStart, type Chapter, type Goal, type MapData, type Player, type RosterUnit, type Unit,
} from '@tactics/core';
import type pg from 'pg';
import { tx } from '../db';
import { body, HttpError, isUuid, type App, type Db } from '../http';
import { chapterRow, clearedChapters, findMap, listChapters, mutateIn, TODAY } from '../queries';

/** A battle ready to be saved: its map and starting units, and what it is for. */
interface Start { map: MapData; units: Unit[]; missionId: string | null; chapterId: string | null; goal: Goal | null; protect: string[] | null }

/** What a first win adds on top of XP: gold, and a unit that joins (a chapter's unlock or a mission's recruit). */
interface Reward { gold: number; join: (p: Player) => { player: Player; unlocked: string | null } }

/** A campaign chapter: map, enemies and goal all come from the server's chapters. */
async function chapterStart(db: Db, userId: string, roster: RosterUnit[], chapterId: unknown, deploy: unknown): Promise<Start> {
  const chapters = await listChapters(db);
  const ch = chapters.find(x => x.id === chapterId);
  if (!ch?.map) throw new HttpError(404, 'Capitolo non trovato');
  if (!chapterOpen(chapters.map(x => x.id), await clearedChapters(db, userId), ch.id)) throw new HttpError(400, 'Capitolo ancora chiuso: vinci prima quello prima');
  return { map: ch.map, units: chapterUnits(roster, ch, deploy), missionId: null, chapterId: ch.id, goal: ch.goal, protect: ch.required };
}

/** A mission brings its own map, a test battle names one; the map always comes from the server's copy, never from the client. */
async function missionStart(db: Db, roster: RosterUnit[], b: { missionId?: unknown; mapId?: unknown; deploy?: unknown }): Promise<Start> {
  let mapId = b.mapId, mission: { id: string; enemies: unknown } | null = null;
  if (b.missionId !== undefined) {
    if (!isUuid(b.missionId)) throw new HttpError(404, 'Missione non trovata');
    const { rows: [m] } = await db.query('SELECT id, map_id, enemies FROM missions WHERE id = $1', [b.missionId]);
    if (!m) throw new HttpError(404, 'Missione non trovata');
    [mapId, mission] = [m.map_id, m];
  }
  const map = await findMap(db, mapId);
  if (!map) throw new HttpError(404, 'Mappa non trovata');
  // checked again here: the map may have been edited since the mission was made
  const units = deployBattle(roster, map, b.deploy, mission ? missionUnits(parseMissionEnemies(map, mission.enemies)) : undefined);
  return { map, units, missionId: mission?.id ?? null, chapterId: null, goal: null, protect: null };
}

/** A chapter pays and unlocks its unit on the first win only; the insert is the check. A deleted chapter does not pay. */
async function chapterReward(db: pg.PoolClient, userId: string, ch: Chapter | undefined): Promise<Reward | null> {
  if (!ch) return null;
  const { rowCount } = await db.query('INSERT INTO campaign_wins (user_id, chapter_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, ch.id]);
  return rowCount ? { gold: ch.gold, join: p => joinRoster(p, ch.unlock) } : null;
}

/** Only a mission won for the first time today pays; the insert is the once-a-day check. */
async function missionReward(db: pg.PoolClient, userId: string, missionId: string): Promise<Reward | null> {
  const { rows: [paid] } = await db.query(
    `INSERT INTO mission_wins (user_id, mission_id, day) SELECT $1, id, ${TODAY} FROM missions WHERE id = $2
     ON CONFLICT DO NOTHING RETURNING (SELECT gold FROM missions WHERE id = $2), (SELECT recruit FROM missions WHERE id = $2)`, [userId, missionId]);
  // the recruit joins on the first paid win; its id comes from the mission, so later wins do not add it again
  return paid ? { gold: paid.gold, join: p => addRecruit(p, missionId, paid.recruit) } : null;
}

// The server hands out the battle (seed and starting units) and later replays the player's actions:
// XP and gold come from that replay, never from what the client says happened.
export function battleRoutes(app: App, pool: pg.Pool) {
  app.post('/api/battles', async c => {
    const b = await body(c);
    const userId = c.get('userId');
    const { rows: [user] } = await pool.query('SELECT roster FROM users WHERE id = $1', [userId]);
    const st = b.chapterId !== undefined ? await chapterStart(pool, userId, user.roster, b.chapterId, b.deploy) : await missionStart(pool, user.roster, b);
    const seed = randomBytes(4).readUInt32BE();
    return c.json<BattleStart>(await tx(pool, async db => {
      // one battle at a time: starting a new one drops the old ones, finished or abandoned
      await db.query('DELETE FROM battles WHERE user_id = $1', [userId]);
      const { rows } = await db.query('INSERT INTO battles (user_id, seed, map, units, mission_id, chapter_id, goal, protect) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
        [userId, seed, JSON.stringify(st.map), JSON.stringify(st.units), st.missionId, st.chapterId, st.goal && JSON.stringify(st.goal), st.protect && JSON.stringify(st.protect)]);
      return { id: rows[0].id, seed, units: st.units };
    }));
  });

  app.post('/api/battles/:id/finish', async c => {
    const { actions } = await body(c);
    const id = c.req.param('id'), userId = c.get('userId');
    if (!isUuid(id)) throw new HttpError(404, 'Battaglia non trovata');
    if (!Array.isArray(actions)) throw new HttpError(400, 'Azioni non valide');
    return c.json<BattleResult>(await tx(pool, async db => {
      const { rows: [battle] } = await db.query('SELECT seed, map, units, result, mission_id, chapter_id, goal, protect FROM battles WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, userId]);
      if (!battle) throw new HttpError(404, 'Battaglia non trovata: ne hai iniziata un\'altra?');
      // a retry after a lost response gets the same answer and no second payout
      if (battle.result) return battle.result;
      // gold and unlock as the chapter is now; goal and protect as they were when the battle started
      const ch = battle.chapter_id ? await chapterRow(db, battle.chapter_id) : undefined;
      const end = replayBattle(battle.map, battle.units, Number(battle.seed), actions, battle.goal ?? ch?.goal, battle.protect ?? ch?.required);
      const won = end.winner === 'A';
      const reward = !won ? null
        : battle.chapter_id ? await chapterReward(db, userId, ch)
        : battle.mission_id ? await missionReward(db, userId, battle.mission_id)
        : null; // test battles never pay
      let out: BattleResult = { report: [], gold: 0, won, paid: false, unlocked: null };
      if (reward) {
        const r = await mutateIn(db, userId, p => {
          const pay = payBattle(p, battle.units, end, reward.gold);
          return { ...pay, ...reward.join(pay.player) };
        });
        out = { report: r.report, gold: r.gold, won, paid: true, unlocked: r.unlocked };
      }
      await db.query('UPDATE battles SET result = $2 WHERE id = $1', [id, JSON.stringify(out)]);
      return out;
    }));
  });
}
