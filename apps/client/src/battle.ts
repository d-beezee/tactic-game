import Phaser from 'phaser';
import { createBattle, createUnit, validateMap, type MapData, type RosterUnit } from '@tactics/core';
import { BattleScene } from './BattleScene';
import { Controller } from './controller';
import { Deploy } from './deploy';

const ENEMY_CLASSES = ['warrior', 'archer', 'cleric'];
const ENEMY_NAMES = ['Grosk', 'Vespa', 'Mordo', 'Ruggine', 'Sterpo', 'Nebbia', 'Ghigno', 'Corvo'];

/** Test battle: deploy roster units on the chosen map, then fight an AI team that fills the enemy spawns. */
export function startTestBattle(roster: RosterUnit[], map: MapData) {
  const errors = validateMap(map);
  if (errors.length) throw new Error(`map invalid: ${errors.join('; ')}`);

  const enemies = map.spawns.B.slice(0, map.maxDeploy).map((p, i) =>
    createUnit(`enemy${i}`, ENEMY_NAMES[i % ENEMY_NAMES.length], 'B', ENEMY_CLASSES[i % ENEMY_CLASSES.length], p, 'N'));

  document.getElementById('hud')!.hidden = false;
  const scene = new BattleScene(map, enemies, s => {
    if (import.meta.env.DEV) Object.assign(window, { __scene: s }); // for browser tests
    new Deploy(s, map, roster, team => {
      // createBattle re-validates positions and deploy count
      const state = createBattle(map, [...team, ...enemies], Date.now() >>> 0);
      new Controller(s, state).start();
    }).start();
  });
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#1b1712',
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene: [scene],
  });
}
