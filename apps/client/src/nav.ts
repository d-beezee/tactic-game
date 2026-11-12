import type Phaser from 'phaser';
import { hud } from './hud';

// Going back to the menu never reloads the page: a reload would stop the music until the next tap.
// Each screen registers what it leaves behind instead, and toMenu() undoes it.
const cleanups: (() => void)[] = [];
let openMenu: (after?: 'campaign') => void = () => {};

export const setMenu = (fn: typeof openMenu) => { openMenu = fn; };
export const onLeave = (fn: () => void) => { cleanups.push(fn); };
export const ownGame = (game: Phaser.Game) => onLeave(() => game.destroy(true));

/** Tears down the screen being played: its Phaser game, listeners, the HUD. */
export function leaveScreen() {
  while (cleanups.length) cleanups.pop()!();
  hud.reset();
  document.getElementById('game')!.classList.remove('crt');
}

/** Back to the menu; 'campaign' opens straight on the chapter list. */
export function toMenu(after?: 'campaign') {
  leaveScreen();
  openMenu(after);
}
