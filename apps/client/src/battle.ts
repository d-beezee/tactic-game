import Phaser from 'phaser';
import { CLASSES, createBattle, testEnemies, validateMap, type MapData, type RosterUnit, type Unit } from '@tactics/core';
import { api, ApiError } from './api';
import { BattleScene } from './BattleScene';
import { Controller } from './controller';
import { Deploy } from './deploy';
import { hud, mountRotate } from './hud';

/** Test battle: deploy roster units on the chosen map, then fight an AI team that fills the enemy spawns. */
export function startTestBattle(roster: RosterUnit[], map: MapData) {
  const errors = validateMap(map);
  if (errors.length) throw new Error(`map invalid: ${errors.join('; ')}`);
  const enemies = testEnemies(roster, map);

  document.getElementById('hud')!.hidden = false;
  const scene = new BattleScene(map, enemies, s => {
    if (import.meta.env.DEV) Object.assign(window, { __scene: s }); // for browser tests
    mountRotate(s);
    s.enableFx();
    hud.setPortraits(c => s.portrait(c));

    const begin = async (team: Unit[]) => {
      hud.buttons([]);
      hud.banner('Preparazione della battaglia…');
      let battle: Awaited<ReturnType<typeof api.battleStart>>;
      try {
        battle = await api.battleStart(map, team.map(u => ({ id: u.id, pos: u.pos })));
      } catch (e) {
        hud.banner(`Battaglia non avviata: ${(e as Error).message}`);
        return hud.buttons([
          { label: 'Menu', icon: 'back', onClick: () => location.reload() },
          { label: 'Riprova', primary: true, onClick: () => void begin(team) },
        ]);
      }
      // the server's units and seed, so its replay sees exactly this battle
      new Controller(s, createBattle(map, battle.units, battle.seed), async actions => {
        // the actions exist only here: retry before giving up, or a network blip loses the battle
        for (let attempt = 1; ; attempt++) {
          try {
            const { report, gold } = await api.battleFinish(battle.id, actions);
            const lines = report.map(r => `${r.name}, ${CLASSES[r.classId].name}: +${r.gained} XP${r.to > r.from ? `, livello ${r.to}!` : ''}`);
            return gold ? [...lines, `+${gold} oro`] : lines;
          } catch (e) {
            // 4xx: the server refused these actions, sending them again cannot help
            const refused = e instanceof ApiError && e.status >= 400 && e.status < 500;
            if (refused || attempt === 3) return [`Progressi non salvati: ${(e as Error).message}`];
            await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }
      }).start();
    };
    new Deploy(s, map, roster, team => void begin(team)).start();
  });
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    transparent: true, // the stage background and light shafts are CSS behind the canvas
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene: [scene],
  });
}
