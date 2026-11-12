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
