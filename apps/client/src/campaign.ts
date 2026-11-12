import { facingToward, missionUnits, unitFromRoster, type Chapter, type RosterUnit } from '@tactics/core';
import { startTestBattle } from './battle';
import { playCutscene } from './cutscene';
import { toMenu } from './nav';

/**
 * A campaign chapter: the cutscene, the battle, and on a win the closing cutscene. Then back to the chapter list.
 * With `rehearse` it is an admin's unsaved draft: played locally, then `back`.
 */
export async function startChapter(roster: RosterUnit[], ch: Chapter, rehearse?: { back: () => void; trackId?: string | null }) {
  // the diorama behind 'map' lines: the chapter's enemies, and the heroes on their spawns looking at them
  const map = ch.map, enemies = missionUnits(ch.enemies);
  const heroes = [...ch.required, ...roster.map(r => r.id).filter(id => !ch.required.includes(id))]
    .map(id => roster.find(r => r.id === id)).filter((r): r is RosterUnit => !!r).slice(0, map.maxDeploy)
    .map((r, i) => unitFromRoster(r, 'A', map.spawns.A[i], facingToward(map.spawns.A[i], enemies[0].pos)));
  const world = { map, units: [...heroes, ...enemies] };

  await playCutscene(ch.before, world);
  startTestBattle(roster, map, undefined, {
    chapter: ch,
    rehearsal: !!rehearse,
    trackId: rehearse?.trackId,
    onDone: async win => {
      if (win) await playCutscene(ch.after, world);
      if (rehearse) rehearse.back();
      else toMenu('campaign');
    },
  });
}
