import { showMenu } from './menu';
import { setMenu, toMenu } from './nav';
import { splash } from './splash';

// the menu loads behind the title screen
void splash();

const go: Parameters<typeof showMenu>[0] = {
  battle: async (roster, map, mission) => (await import('./battle')).startBattle(roster, map, mission ? { kind: 'mission', mission } : { kind: 'test' }),
  campaign: async (roster, chapter) => (await import('./campaign')).startChapter(roster, chapter),
  pvp: async (roster, id, state) => (await import('./pvp')).startPvp(roster, id, state),
  editor: async () => (await import('./editor')).startEditor(),
  rehearse: async (roster, chapter, trackId) => (await import('./campaign')).startChapter(roster, chapter, { trackId, back: () => toMenu('workshop') }),
};
setMenu(after => showMenu(go, after));
showMenu(go);
