import { showMenu } from './menu';
import { setMenu } from './nav';
import { splash } from './splash';

// the menu loads behind the title screen
void splash();

const go: Parameters<typeof showMenu>[0] = {
  testBattle: async (roster, map, mission) => (await import('./battle')).startTestBattle(roster, map, mission),
  campaign: async (roster, chapter) => (await import('./campaign')).startChapter(roster, chapter),
  pvp: async (roster, id, state) => (await import('./pvp')).startPvp(roster, id, state),
  editor: async () => (await import('./editor')).startEditor(),
};
setMenu(after => showMenu(go, after));
showMenu(go);
