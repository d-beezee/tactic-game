import { serveStatic } from '@hono/node-server/serve-static';
import { PlayerError } from '@tactics/core';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import type pg from 'pg';
import { HttpError, type Env } from './http';
import { adminRoutes, requireAdmin } from './routes/admin';
import { authRoutes, requireSession } from './routes/auth';
import { battleRoutes } from './routes/battles';
import { contentRoutes } from './routes/content';
import { playerRoutes } from './routes/player';
import { pvpRoutes } from './routes/pvp';

/** The order matters: each middleware guards only the routes registered after it. */
export function createApp(pool: pg.Pool, staticDir: string) {
  const app = new Hono<Env>();

  app.onError((e, c) => {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status);
    if (e instanceof PlayerError) return c.json({ error: e.message }, 400);
    if (e instanceof HTTPException) return c.json({ error: 'Richiesta rifiutata' }, e.status); // csrf, body limit
    console.error(e);
    return c.json({ error: 'Errore del server' }, 500);
  });

  app.get('/api/health', async c => {
    await pool.query('SELECT 1');
    return c.json({ ok: true });
  });

  // the API only reads JSON bodies; csrf() rejects cross-site form posts, the only ones a browser sends without a preflight
  app.use('/api/*', csrf(), bodyLimit({ maxSize: 256 * 1024 }));
  authRoutes(app, pool);

  app.use('/api/*', requireSession(pool));
  playerRoutes(app, pool);
  battleRoutes(app, pool);
  contentRoutes(app, pool);
  pvpRoutes(app, pool);

  app.use('/api/admin/*', requireAdmin(pool));
  adminRoutes(app, pool);

  app.all('/api/*', c => c.json({ error: 'Non trovato' }, 404));
  app.use('*', serveStatic({ root: staticDir }));
  return app;
}
