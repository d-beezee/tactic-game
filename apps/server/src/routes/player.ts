import { buyItem, kickUnit, updateUnit, type Account } from '@tactics/core';
import type pg from 'pg';
import { body, type App } from '../http';
import { mutate } from '../queries';

/** The logged-in player's own account: roster changes and the shop. */
export function playerRoutes(app: App, pool: pg.Pool) {
  app.get('/api/me', async c => {
    const { rows } = await pool.query('SELECT email, is_admin AS admin, gold, roster, inventory FROM users WHERE id = $1', [c.get('userId')]);
    return c.json<Account>(rows[0]);
  });

  app.patch('/api/units/:id', async c => {
    const change = await body(c);
    return c.json((await mutate(pool, c.get('userId'), p => ({ player: updateUnit(p, c.req.param('id'), change) }))).player);
  });

  app.post('/api/units/kick/:id', async c => {
    const { rows } = await pool.query('SELECT DISTINCT jsonb_array_elements_text(required) AS id FROM chapters');
    const keep = rows.map(r => r.id as string);
    return c.json((await mutate(pool, c.get('userId'), p => ({ player: kickUnit(p, c.req.param('id'), keep) }))).player);
  });

  app.post('/api/shop/buy', async c => {
    const { itemId } = await body(c);
    return c.json((await mutate(pool, c.get('userId'), p => ({ player: buyItem(p, itemId) }))).player);
  });
}
