import { serve } from '@hono/node-server';
import pg from 'pg';
import { createApp } from './app';
import { migrate } from './db';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString: url });
  await migrate(pool);

  const port = Number(process.env.PORT ?? 3000);
  // STATIC_DIR is the built client, relative to the working directory
  const server = serve({ fetch: createApp(pool, process.env.STATIC_DIR ?? './dist').fetch, port }, () => console.log(`listening on :${port}`));

  // a deploy stops the old container with SIGTERM: finish open requests first
  process.on('SIGTERM', () => server.close(() => void pool.end().then(() => process.exit(0))));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
