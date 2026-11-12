import { showMenu } from './menu';
import { splash } from './splash';

// the menu loads behind the title screen
void splash();

showMenu({
  testBattle: async (roster, map, mission) => (await import('./battle')).startTestBattle(roster, map, mission),
  campaign: async (roster, chapter) => (await import('./campaign')).startChapter(roster, chapter),
  pvp: async (roster, id, state) => (await import('./pvp')).startPvp(roster, id, state),
  editor: async () => (await import('./editor')).startEditor(),
});
