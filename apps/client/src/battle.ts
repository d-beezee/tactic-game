import Phaser from 'phaser';
import { CLASSES, createBattle, missionUnits, testEnemies, validateMap, type MapData, type RosterUnit, type Unit } from '@tactics/core';
import { api, ApiError, type Mission } from './api';
import { BattleScene } from './BattleScene';
import { Controller } from './controller';
import { Deploy } from './deploy';
import { hud, mountRotate } from './hud';

/**
 * Deploy roster units on the map, then fight an AI team that fills the enemy spawns.
 * With a mission it is a daily mission, with its own enemies, which can pay; without, a test battle, which never does.
 */
export function startTestBattle(roster: RosterUnit[], map: MapData, mission?: Mission) {
  const missionId = mission?.id;
  const errors = validateMap(map);
  if (errors.length) throw new Error(`map invalid: ${errors.join('; ')}`);
  const enemies = mission ? missionUnits(mission.enemies) : testEnemies(roster, map);

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
        battle = await api.battleStart(missionId ? { missionId } : { mapId: map.id }, team.map(u => ({ id: u.id, pos: u.pos })));
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
            const { report, gold, won, paid } = await api.battleFinish(battle.id, actions);
            if (!paid) return [
              !missionId ? 'Battaglia di prova: niente XP né oro. Per quelli ci sono le missioni giornaliere.'
                : won ? 'Missione già vinta oggi: niente ricompensa. Torna domani.'
                : 'Missione fallita: niente ricompensa. Puoi riprovare.',
            ];
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
