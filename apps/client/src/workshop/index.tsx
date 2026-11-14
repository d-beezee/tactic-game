// The Officina: the admin's tools (campaign, missions, music, users), kept apart from the player's menu.
// Every editor has the same shape: list on the left, tabs on the right, a save bar at the bottom.
import { useLayoutEffect } from 'react';
import { Campaign } from './Campaign';
import { Missions } from './Missions';
import { Music } from './Music';
import { Frame } from './parts';
import { go, leave, useDraw, ws, type WorkshopCtx } from './state';
import { Users } from './Users';

const TOOLS = { campaign: Campaign, missions: Missions, music: Music, users: Users };

export function Workshop(ctx: WorkshopCtx) {
  ws.ctx = ctx;
  useDraw();
  // reopens the tool that was open last, with fresh data
  useLayoutEffect(() => { void go(ws.tool); return leave; }, []);
  if (ws.loading) return <Frame title="Officina"><p className="hint">Caricamento…</p></Frame>;
  const Tool = TOOLS[ws.tool];
  return <Tool />;
}
