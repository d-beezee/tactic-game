import { CLASSES, createBattle, missionUnits, testEnemies, validateMap, type BattleResult, type BattleStart, type Chapter, type MapData, type RosterUnit, type Unit } from '@tactics/core';
import { api, retry, type Mission } from './api';
import { Controller } from './controller';
import { Deploy } from './deploy';
import { hud, note, type ResultLine } from './hud';
import { mountBattle } from './mountBattle';
import { music } from './music';
import { leaveScreen, toMenu } from './nav';

/**
 * A campaign chapter in play; onDone runs after the result screen, with the battle already torn down.
 * rehearsal = an admin trying an unsaved draft: played locally, nothing is sent to the server.
 */
export interface ChapterRun { chapter: Chapter; onDone: (win: boolean) => void; rehearsal?: boolean; trackId?: string | null }

/** What a battle against the AI is: a test battle (map only), a daily mission, or a campaign chapter. */
export type BattleMode = { kind: 'test' } | { kind: 'mission'; mission: Mission } | { kind: 'chapter'; run: ChapterRun };

/** The end screen's lines for a replayed battle. */
export function rewardLines(r: BattleResult, mode: BattleMode['kind']): ResultLine[] {
  if (mode === 'chapter' && !r.paid) return [note(r.won ? 'Capitolo già vinto: niente ricompensa questa volta.' : 'La storia si ferma qui. Riprova quando vuoi.')];
  if (!r.paid) return [note(
    mode === 'test' ? 'Battaglia di prova: niente XP né oro. Per quelli ci sono le missioni giornaliere.'
      : r.won ? 'Missione già vinta oggi: niente ricompensa. Torna domani.'
      : 'Missione fallita: niente ricompensa. Puoi riprovare.',
  )];
  const lines: ResultLine[] = r.report.map(x => x.to > x.from
    ? { kind: 'level', text: `${x.name}, ${CLASSES[x.classId].name}: +${x.gained} XP, livello ${x.to}!` }
    : note(`${x.name}, ${CLASSES[x.classId].name}: +${x.gained} XP`));
  if (r.gold) lines.push({ kind: 'gold', text: `+${r.gold} oro` });
  if (r.unlocked) lines.push(note(`${r.unlocked} si unisce alla squadra!`));
  return lines;
}

/** Deploy roster units on the map, then fight the AI. Test battles never pay; missions and chapters pay on their first win. */
export function startBattle(roster: RosterUnit[], map: MapData, mode: BattleMode) {
  const errors = validateMap(map);
  if (errors.length) throw new Error(`map invalid: ${errors.join('; ')}`);
  const run = mode.kind === 'chapter' ? mode.run : undefined, ch = run?.chapter;
  const enemies = mode.kind === 'chapter' ? missionUnits(mode.run.chapter.enemies) : mode.kind === 'mission' ? missionUnits(mode.mission.enemies) : testEnemies(roster, map);
  const target = mode.kind === 'chapter' ? { chapterId: mode.run.chapter.id } : mode.kind === 'mission' ? { missionId: mode.mission.id } : { mapId: map.id };
  const rehearsal = !!run?.rehearsal;
  // a rehearsal goes back to where the admin left the draft
  const back = rehearsal ? () => { leaveScreen(); run!.onDone(false); } : () => toMenu();

  music('battle', mode.kind === 'mission' ? mode.mission.trackId : run?.trackId);
  // the prologue is played on the brothers' monitor
  document.getElementById('game')!.classList.toggle('crt', !!ch?.crt);

  /** The battle as the server hands it out; a rehearsal makes its own and runs the checks the server would. */
  const open = async (team: Unit[]): Promise<BattleStart> => {
    if (!rehearsal) return api.battleStart(target, team.map(u => ({ id: u.id, pos: u.pos })));
    const b = { id: '', seed: Math.floor(Math.random() * 2 ** 32), units: [...team, ...enemies] };
    createBattle(map, b.units, b.seed, ch?.goal, ch?.required);
    return b;
  };

  /** Sends the player's actions to be replayed. They exist only here: retry before giving up, or a network blip loses the battle. */
  const finish = async (id: string, actions: Parameters<typeof api.battleFinish>[1]): Promise<ResultLine[]> => {
    if (rehearsal) return [note('Prova: niente XP né oro, nulla è stato salvato.')];
    try {
      return rewardLines((await retry(() => api.battleFinish(id, actions), { attempts: 3, delay: n => 1000 * n }))!, mode.kind);
    } catch (e) {
      return [note(`Progressi non salvati: ${(e as Error).message}`)];
    }
  };

  mountBattle(map, enemies, s => {
    const begin = async (team: Unit[]) => {
      hud.buttons([]);
      hud.banner('Preparazione della battaglia…');
      let battle: BattleStart;
      try {
        battle = await open(team);
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
      new Controller(s, state, actions => finish(battle.id, actions), {
        turnLabel: ch?.crt ? u => `Tocca a ${turns++ % 2 ? 'Nico' : 'Teo'}: ${u.name}` : undefined,
        onDone: run && { label: 'Continua', run: win => { leaveScreen(); run.onDone(win); } },
      }).start();
    };
    new Deploy(s, map, roster, team => void begin(team), 'A', back, ch?.required).start();
  });
}
