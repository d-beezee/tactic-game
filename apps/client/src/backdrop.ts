import Phaser from 'phaser';
import { facingToward, testEnemies, unitFromRoster, type MapData, type RosterUnit } from '@tactics/core';
import { BattleScene } from './BattleScene';

/**
 * The title screen's live background: the demo map with the player's own team facing the enemy, slowly drifting,
 * with every light effect on. The map sits right of the menu. Returns a function that tears it down.
 */
export function startBackdrop(map: MapData, roster: RosterUnit[]): () => void {
  const enemies = testEnemies(roster, map).map(u => ({ ...u, facing: facingToward(u.pos, map.spawns.A[0]) }));
  const team = roster.slice(0, Math.min(map.maxDeploy, map.spawns.A.length)).map((r, i) => unitFromRoster(r, 'A', map.spawns.A[i], facingToward(map.spawns.A[i], map.spawns.B[0])));
  const scene = new BattleScene(map, [...team, ...enemies], s => {
    s.pannable = false;
    s.enableFx();
    s.drift();
  }, w => ({ top: 40, bottom: 40, right: 0, left: w < 760 ? 0 : Math.min(520, w * 0.4) }));
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'backdrop',
    transparent: true,
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene: [scene],
  });
  return () => game.destroy(true);
}
