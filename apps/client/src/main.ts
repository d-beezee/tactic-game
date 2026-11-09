import { showMenu } from './menu';

showMenu({
  testBattle: async (roster, map) => (await import('./battle')).startTestBattle(roster, map),
  editor: async () => (await import('./editor')).startEditor(),
});
