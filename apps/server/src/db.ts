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
];

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
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
});
