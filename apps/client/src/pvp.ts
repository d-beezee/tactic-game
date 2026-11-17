import { createBattle, type BattleAction, type RosterUnit } from '@tactics/core';
import { api, ApiError, retry, type PvpState } from './api';
import { Controller } from './controller';
import { Deploy } from './deploy';
import { hud, note } from './hud';
import { mountBattle } from './mountBattle';
import { music } from './music';
import { onLeave, toMenu } from './nav';

const POLL_MS = 1000;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * PvP match, from deploy to result. The server holds the battle: each of our actions is sent with its index,
 * the opponent's arrive through a poll that also keeps us marked as present.
 */
export function startPvp(roster: RosterUnit[], id: string, first: PvpState) {
  const { map, team } = first;
  /** true once the match is over here or the player left: stops the poll and the sending */
  let over = false;
  onLeave(() => { over = true; });
  const back = () => { void api.pvpLeave(id).catch(() => { /* the server ends it anyway once we stop polling */ }); toMenu(); };
  music('battle');

  mountBattle(map, [], s => {
    let placed: string[] = [];
    let controller: Controller | null = null;
    /** actions known here, ours and theirs: the next poll asks from this index */
    let count = 0;
    const incoming: BattleAction[] = [];
    let waiter: ((a: BattleAction) => void) | null = null;
    const remote = () => new Promise<BattleAction>(res => {
      const a = incoming.shift();
      if (a) res(a);
      else waiter = res;
    });

    const fail = (message: string) => {
      over = true;
      hud.banner(message);
      hud.buttons([{ label: 'Menu', icon: 'back', primary: true, onClick: back }]);
    };

    // ours go out in order; a network error is retried, a refusal means the two sides disagree
    let sending = Promise.resolve();
    const send = (a: BattleAction) => {
      const index = count++;
      sending = sending.then(() => retry(() => api.pvpAction(id, index, a), { delay: n => Math.min(5000, 500 * n), refused: e => e.status >= 400, stop: () => over })
        .then(() => {}, e => fail(`Mossa rifiutata dal server: ${(e as Error).message}`)));
    };

    const startBattle = (st: PvpState) => {
      for (const uid of placed) s.removeUnit(uid);
      for (const u of st.units!) s.addUnit(u);
      hud.banner('');
      controller = new Controller(s, createBattle(map, st.units!, st.seed!), async () => [note('Partita PvP: livelli a 5, niente XP né oro.')], {
        me: team, remote, onAction: send, onResign: back,
      });
      controller.start();
    };

    const endedOutside = (st: PvpState) => {
      over = true;
      const win = st.winner === team;
      const why = st.reason === 'gone' ? (win ? 'L\'avversario si è disconnesso.' : 'Sei rimasto disconnesso troppo a lungo.')
        : win ? 'L\'avversario si è arreso.' : 'Ti sei arreso.';
      hud.result(win, [note(why)], () => toMenu());
    };

    const poll = async () => {
      while (!over) {
        const from = count;
        try {
          const st = await api.pvpState(id, from);
          // our own action may have landed while this poll was out: its answer is stale
          if (from === count) {
            if (st.status === 'battle' || st.status === 'done') {
              if (!controller && st.units) startBattle(st);
              for (const a of st.actions) {
                count++;
                if (waiter) { const w = waiter; waiter = null; w(a); } else incoming.push(a);
              }
            }
            if (st.status === 'done' && st.reason !== 'battle') return endedOutside(st);
            // a battle won on the board ends in the controller once the last actions are played
            if (st.status === 'done') return;
          }
        } catch (e) {
          if (e instanceof ApiError && (e.status === 401 || e.status === 404)) return fail(`Partita non disponibile: ${e.message}`);
        }
        await wait(POLL_MS);
      }
    };

    new Deploy(s, map, roster, units => {
      placed = units.map(u => u.id);
      hud.buttons([{ label: 'Abbandona', icon: 'back', onClick: back }]);
      hud.banner('Schieramento inviato: aspetto l\'avversario…');
      api.pvpDeploy(id, units.map(u => ({ id: u.id, pos: u.pos }))).catch(e => fail(`Schieramento non accettato: ${(e as Error).message}`));
    }, team, back).start();
    hud.ribbon(team === 'A' ? 'Sei la squadra blu' : 'Sei la squadra rossa');
    void poll();
  }, team);
}
