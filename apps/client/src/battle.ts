import Phaser from 'phaser';
import { CLASSES, applyBattleXp, classLevel, createBattle, createUnit, validateMap, type MapData, type RosterUnit } from '@tactics/core';
import { BattleScene } from './BattleScene';
import { Controller } from './controller';
import { Deploy } from './deploy';
import { mountRotate } from './hud';
import { loadRoster, saveRoster } from './rosterStore';

const ENEMY_CLASSES = ['warrior', 'archer', 'cleric'];
const ENEMY_NAMES = ['Grosk', 'Vespa', 'Mordo', 'Ruggine', 'Sterpo', 'Nebbia', 'Ghigno', 'Corvo'];

/** Test battle: deploy roster units on the chosen map, then fight an AI team that fills the enemy spawns. */
export function startTestBattle(roster: RosterUnit[], map: MapData) {
  const errors = validateMap(map);
  if (errors.length) throw new Error(`map invalid: ${errors.join('; ')}`);

  // enemies match the roster's average active-class level, so test battles stay a fight as units grow
  const level = Math.round(roster.reduce((sum, r) => sum + classLevel(r, r.classId), 0) / roster.length);
  const enemies = map.spawns.B.slice(0, map.maxDeploy).map((p, i) =>
    createUnit(`enemy${i}`, ENEMY_NAMES[i % ENEMY_NAMES.length], 'B', ENEMY_CLASSES[i % ENEMY_CLASSES.length], p, 'N', level));

  document.getElementById('hud')!.hidden = false;
  const scene = new BattleScene(map, enemies, s => {
    if (import.meta.env.DEV) Object.assign(window, { __scene: s }); // for browser tests
    mountRotate(s);
    new Deploy(s, map, roster, team => {
      // createBattle re-validates positions and deploy count
      const state = createBattle(map, [...team, ...enemies], Date.now() >>> 0);
      new Controller(s, state, end => {
        // re-read: the stored roster is the source of truth, not the copy passed in at start
        const { roster: next, report } = applyBattleXp(loadRoster(), team.map(u => ({ id: u.id, classId: u.classId })), end.xp);
        saveRoster(next);
        return report.map(r => `${r.name} · ${CLASSES[r.classId].name} +${r.gained} XP${r.to > r.from ? ` · livello ${r.to}!` : ''}`);
      }).start();
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
