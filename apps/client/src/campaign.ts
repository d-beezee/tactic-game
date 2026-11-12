import { facingToward, missionUnits, unitFromRoster, type Chapter, type RosterUnit } from '@tactics/core';
import { startTestBattle } from './battle';
import { playCutscene } from './cutscene';
import { AFTER_KEY } from './menu';

/** A campaign chapter: the cutscene, the battle, and on a win the closing cutscene. Then back to the chapter list. */
export async function startChapter(roster: RosterUnit[], ch: Chapter) {
  // the diorama behind 'map' lines: the chapter's enemies, and the heroes on their spawns looking at them
  const map = ch.map, enemies = missionUnits(ch.enemies);
  const heroes = [...ch.required, ...roster.map(r => r.id).filter(id => !ch.required.includes(id))]
    .map(id => roster.find(r => r.id === id)).filter((r): r is RosterUnit => !!r).slice(0, map.maxDeploy)
    .map((r, i) => unitFromRoster(r, 'A', map.spawns.A[i], facingToward(map.spawns.A[i], enemies[0].pos)));
  const world = { map, units: [...heroes, ...enemies] };

  await playCutscene(ch.before, world);
  startTestBattle(roster, map, undefined, {
    chapter: ch,
    onDone: async win => {
      if (win) await playCutscene(ch.after, world);
      try { sessionStorage.setItem(AFTER_KEY, 'campaign'); } catch { /* storage blocked: the main menu instead */ }
      location.reload();
    },
  });
}
