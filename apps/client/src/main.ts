import { showMenu } from './menu';

showMenu(async roster => (await import('./battle')).startTestBattle(roster));
