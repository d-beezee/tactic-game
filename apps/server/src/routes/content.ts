import type pg from 'pg';
import type { App } from '../http';
import { clearedChapters, listChapters, listMaps, listMissions, listMusic } from '../queries';

/** What every player reads: missions, campaign, maps and music. The admin changes them in routes/admin.ts. */
export function contentRoutes(app: App, pool: pg.Pool) {
  app.get('/api/missions', async c => c.json(await listMissions(pool, c.get('userId'))));
  app.get('/api/campaign', async c => c.json({ chapters: await listChapters(pool), cleared: await clearedChapters(pool, c.get('userId')) }));
  app.get('/api/maps', async c => c.json(await listMaps(pool)));
  app.get('/api/music', async c => c.json(await listMusic(pool)));
}
