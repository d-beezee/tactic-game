import Phaser from 'phaser';
import { CLASSES, createBattle, missionUnits, testEnemies, validateMap, type Chapter, type MapData, type RosterUnit, type Unit } from '@tactics/core';
import { api, ApiError, type Mission } from './api';
import { BattleScene } from './BattleScene';
import { Controller } from './controller';
import { Deploy } from './deploy';
import { hud, mountRotate } from './hud';
import { music } from './music';
import { leaveScreen, ownGame, toMenu } from './nav';

/**
 * A campaign chapter in play; onDone runs after the result screen, with the battle already torn down.
 * rehearsal = an admin trying an unsaved draft: played locally, nothing is sent to the server.
 */
export interface ChapterRun { chapter: Chapter; onDone: (win: boolean) => void; rehearsal?: boolean; trackId?: string | null }

/**
 * Deploy roster units on the map, then fight an AI team that fills the enemy spawns.
 * With a mission it is a daily mission, with its own enemies, which can pay; without, a test battle, which never does.
 * With a chapter it is a campaign battle: its goal, required units and first-win reward.
 */
export function startTestBattle(roster: RosterUnit[], map: MapData, mission?: Mission, run?: ChapterRun) {
  const missionId = mission?.id, ch = run?.chapter;
  const errors = validateMap(map);
  if (errors.length) throw new Error(`map invalid: ${errors.join('; ')}`);
  const enemies = ch ? missionUnits(ch.enemies) : mission ? missionUnits(mission.enemies) : testEnemies(roster, map);
  const target = ch ? { chapterId: ch.id } : missionId ? { missionId } : { mapId: map.id };
  // a rehearsal goes back to where the admin left the draft
  const back = run?.rehearsal ? () => { leaveScreen(); run.onDone(false); } : () => toMenu();

  music('battle', mission?.trackId ?? run?.trackId);
  document.getElementById('hud')!.hidden = false;
  // the prologue is played on the brothers' monitor
  document.getElementById('game')!.classList.toggle('crt', !!ch?.crt);
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
        battle = run?.rehearsal
          ? { id: '', seed: Math.floor(Math.random() * 2 ** 32), units: [...team, ...enemies] }
          : await api.battleStart(target, team.map(u => ({ id: u.id, pos: u.pos })));
        if (run?.rehearsal) createBattle(map, battle.units, battle.seed, ch?.goal, ch?.required); // the checks the server would make
      } catch (e) {
        hud.banner(`Battaglia non avviata: ${(e as Error).message}`);
        return hud.buttons([
          { label: 'Menu', icon: 'back', onClick: back },
          { label: 'Riprova', primary: true, onClick: () => void begin(team) },
        ]);
      }
      // the server's units and seed, so its replay sees exactly this battle
      const state = createBattle(map, battle.units, battle.seed, ch?.goal, ch?.required);
      if (state.goal.type === 'reach') s.markGoal(state.goal.cells);
      if (state.goal.type === 'boss') s.markBoss(state.goal.unitId);
      // prologue: the brothers take one unit each, in turn
      let turns = 0;
      new Controller(s, state, async actions => {
        if (run?.rehearsal) return ['Prova: niente XP né oro, nulla è stato salvato.'];
        // the actions exist only here: retry before giving up, or a network blip loses the battle
        for (let attempt = 1; ; attempt++) {
          try {
            const { report, gold, won, paid, unlocked } = await api.battleFinish(battle.id, actions);
            if (ch && !paid) return [won ? 'Capitolo già vinto: niente ricompensa questa volta.' : 'La storia si ferma qui. Riprova quando vuoi.'];
            if (!paid) return [
              !missionId ? 'Battaglia di prova: niente XP né oro. Per quelli ci sono le missioni giornaliere.'
                : won ? 'Missione già vinta oggi: niente ricompensa. Torna domani.'
                : 'Missione fallita: niente ricompensa. Puoi riprovare.',
            ];
            const lines = report.map(r => `${r.name}, ${CLASSES[r.classId].name}: +${r.gained} XP${r.to > r.from ? `, livello ${r.to}!` : ''}`);
            if (gold) lines.push(`+${gold} oro`);
            if (unlocked) lines.push(`${unlocked} si unisce alla squadra!`);
            return lines;
          } catch (e) {
            // 4xx: the server refused these actions, sending them again cannot help
            const refused = e instanceof ApiError && e.status >= 400 && e.status < 500;
            if (refused || attempt === 3) return [`Progressi non salvati: ${(e as Error).message}`];
            await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }
      }, {
        turnLabel: ch?.crt ? u => `Tocca a ${turns++ % 2 ? 'Nico' : 'Teo'}: ${u.name}` : undefined,
        onDone: run && { label: 'Continua', run: win => { leaveScreen(); run.onDone(win); } },
      }).start();
    };
    new Deploy(s, map, roster, team => void begin(team), 'A', back, ch?.required).start();
  });
  ownGame(new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    transparent: true, // the stage background and light shafts are CSS behind the canvas
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene: [scene],
  }));
}
