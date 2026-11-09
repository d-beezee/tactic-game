import Phaser from 'phaser';
import { createBattle, createUnit, validateMap, type MapData, type RosterUnit } from '@tactics/core';
import { BattleScene } from './BattleScene';
import { Controller } from './controller';
import { Deploy } from './deploy';
import demo from './maps/demo.json';

/** Test battle on the demo map: deploy roster units, then fight a fixed AI team. */
export function startTestBattle(roster: RosterUnit[]) {
  const map = demo as MapData;
  const errors = validateMap(map);
  if (errors.length) throw new Error(`demo map invalid: ${errors.join('; ')}`);

  const enemyDefs = [['warrior', 'Grosk'], ['archer', 'Vespa'], ['cleric', 'Mordo']] as const;
  const enemies = enemyDefs.slice(0, map.maxDeploy).map(([cls, name], i) => createUnit(`enemy${i}`, name, 'B', cls, map.spawns.B[i], 'N'));

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
