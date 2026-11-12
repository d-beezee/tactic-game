import pg from 'pg';

/** Append only: a migration that already ran in production must never change. */
const MIGRATIONS = [
  `CREATE TABLE users (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     email text NOT NULL UNIQUE,
     password_hash text NOT NULL,
     gold integer NOT NULL CHECK (gold >= 0),
     roster jsonb NOT NULL,
     inventory jsonb NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE TABLE sessions (
     token_hash text PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at timestamptz NOT NULL
   );`,
  // one row per test battle the server handed out; result is set once, when the battle is replayed and paid
  `CREATE TABLE battles (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     seed bigint NOT NULL,
     map jsonb NOT NULL,
     units jsonb NOT NULL,
     result jsonb,
     created_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE INDEX battles_user_id ON battles (user_id);`,
  `ALTER TABLE users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;`,
  // maps made with the editor, shared with every player; data is the map as parseMap returns it
  `CREATE TABLE maps (
     id text PRIMARY KEY,
     data jsonb NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
   );`,
  // daily missions: each pays XP and gold once per player per day, on a win; map_id is a saved map or the built-in one
  `CREATE TABLE missions (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     name text NOT NULL,
     map_id text NOT NULL,
     gold integer NOT NULL CHECK (gold >= 0),
     created_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE TABLE mission_wins (
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     mission_id uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
     day date NOT NULL,
     PRIMARY KEY (user_id, mission_id, day)
   );
   ALTER TABLE battles ADD COLUMN mission_id uuid REFERENCES missions(id) ON DELETE SET NULL;`,
  // the enemies a mission places: [{ classId, level, pos }], checked by parseMissionEnemies
  `ALTER TABLE missions ADD COLUMN enemies jsonb NOT NULL DEFAULT '[]';`,
  // PvP: waiting (lobby or private code) -> deploy -> battle -> done. actions is the whole battle, replayed on each move.
  `CREATE TABLE pvp_matches (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     code text UNIQUE,
     status text NOT NULL DEFAULT 'waiting',
     player_a uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     player_b uuid REFERENCES users(id) ON DELETE CASCADE,
     seen_a timestamptz NOT NULL DEFAULT now(),
     seen_b timestamptz NOT NULL DEFAULT now(),
     map jsonb NOT NULL,
     deploy_a jsonb,
     deploy_b jsonb,
     seed bigint,
     units jsonb,
     actions jsonb NOT NULL DEFAULT '[]',
     winner text,
     reason text,
     created_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE INDEX pvp_matches_player_a ON pvp_matches (player_a);
   CREATE INDEX pvp_matches_player_b ON pvp_matches (player_b);`,
  // campaign chapters won, by id from the core's CAMPAIGN; the row is the once-only payout check
  `CREATE TABLE campaign_wins (
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     chapter_id text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (user_id, chapter_id)
   );
   ALTER TABLE battles ADD COLUMN chapter_id text;`,
  // background music: Strudel code saved by the admin; a slot (menu, battle) names the track played there, a mission can override battle
  `CREATE TABLE tracks (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     name text NOT NULL,
     code text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE TABLE music_slots (
     slot text PRIMARY KEY,
     track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE
   );
   ALTER TABLE missions ADD COLUMN track_id uuid REFERENCES tracks(id) ON DELETE SET NULL;
   WITH t AS (
     INSERT INTO tracks (name, code) VALUES ('Rovine al tramonto', $track$setcpm(84/4)

// lead: onda quadra con eco
$: n("<[4 ~ 2 4 7 ~ 6 4] [5 ~ 4 2 4 ~ ~ ~] [2 ~ 4 6 7 ~ 6 4] [6 ~ 5 4 1 ~ ~ ~]>")
  .scale("A4:minor")
  .s("square").gain(.18)
  .attack(.005).decay(.15).sustain(.5).release(.1)
  .lpf(3500)
  .delay(.35).delaytime(.357).delayfeedback(.35)

// arpeggio: Am F C G a sedicesimi
$: n("<[0,2,4] [5,7,9] [2,4,6] [6,8,10]>")
  .arp("[0 1 2 1]*4")
  .scale("A3:minor")
  .s("square").gain(.08)
  .decay(.08).sustain(0)
  .lpf(2200)

// basso: onda triangolare stile NES
$: n("0 ~ 0 7 0 ~ 7 0".add("<0 5 2 6>"))
  .scale("A1:minor")
  .s("triangle").gain(.45)
  .decay(.2).sustain(.3)

// charleston leggero di rumore bianco
$: s("[~ white]*4").gain(.07).decay(.03).sustain(0).hpf(6000)$track$), ('Lama e acciaio', $track$setcpm(152/4)

// lead eroico
$: note("<[e5 ~ b4 e5 g5 ~ f#5 e5] [g5 ~ e5 g5 c6 ~ b5 g5] [a5 ~ f#5 a5 d6 ~ a5 f#5] [d#5 ~ f#5 b5 a5 ~ f#5 d#5]>")
  .s("square").gain(.17)
  .attack(.003).decay(.1).sustain(.6).release(.05)
  .lpf(4000)
  .delay(.2).delaytime(.197).delayfeedback(.25)

// arpeggio veloce: Em C D B
$: note("<[e4,g4,b4] [c4,e4,g4] [d4,f#4,a4] [b3,d#4,f#4]>")
  .arp("[0 1 2 1]*4")
  .s("square").gain(.07)
  .decay(.06).sustain(0)
  .lpf(2500)

// basso a ottave che martella
$: note("[0 12]*4".add("<40 36 38 35>"))
  .s("triangle").gain(.5)
  .decay(.12).sustain(.2)

// batteria compressa a 8 bit
$: s("bd ~ bd [~ bd], ~ sd ~ sd, hh*8")
  .bank("RolandTR909")
  .crush(5).gain(.5)$track$)
     RETURNING id, name
   )
   INSERT INTO music_slots SELECT CASE name WHEN 'Rovine al tramonto' THEN 'menu' ELSE 'battle' END, id FROM t;`,
];

/**
 * If nobody is admin, the oldest account becomes one. Runs at startup and after each sign-up,
 * so the first account ever is the admin and a database that lost its admin gets one back.
 */
export const ensureAdmin = (db: pg.Pool | pg.PoolClient) => db.query(
  `UPDATE users SET is_admin = true
   WHERE id = (SELECT id FROM users ORDER BY created_at, id LIMIT 1) AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin)`);

/** Runs fn in a transaction on one connection. */
export async function tx<T>(pool: pg.Pool, fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const out = await fn(db);
    await db.query('COMMIT');
    return out;
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    db.release();
  }
}

/** Applies the migrations that have not run yet. The lock makes two servers starting together take turns. */
export const migrate = (pool: pg.Pool) => tx(pool, async db => {
  await db.query('SELECT pg_advisory_xact_lock(727274)');
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY)');
  const { rows } = await db.query('SELECT coalesce(max(version), 0) AS v FROM schema_migrations');
  for (let v = rows[0].v; v < MIGRATIONS.length; v++) {
    await db.query(MIGRATIONS[v]);
    await db.query('INSERT INTO schema_migrations VALUES ($1)', [v + 1]);
    console.log(`migration ${v + 1} applied`);
  }
  await ensureAdmin(db);
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
  await db.query(`DELETE FROM pvp_matches WHERE status = 'waiting' AND created_at < now() - interval '1 day'`);
});
