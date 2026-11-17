import Phaser from 'phaser';

/** A window-sized Phaser game showing one scene. Transparent, so the CSS stage behind shows, unless a background is given. */
export const sceneGame = (scene: Phaser.Scene, parent: string | HTMLElement, backgroundColor?: string) => new Phaser.Game({
  type: Phaser.AUTO,
  parent,
  transparent: !backgroundColor,
  backgroundColor,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: [scene],
});
