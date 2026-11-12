import { showMenu } from './menu';

showMenu({
  testBattle: async (roster, map, mission) => (await import('./battle')).startTestBattle(roster, map, mission),
  editor: async () => (await import('./editor')).startEditor(),
});
