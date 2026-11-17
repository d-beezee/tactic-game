import type { MapData, Team, Unit } from '@tactics/core';
import { BattleScene } from './BattleScene';
import { sceneGame } from './game';
import { hud, mountRotate } from './hud';
import { ownGame } from './nav';

/** Puts a battle on screen: the scene with `units`, camera buttons, light effects, portraits in the HUD. `onReady` gets the scene once loaded. */
export function mountBattle(map: MapData, units: Unit[], onReady: (s: BattleScene) => void, team: Team = 'A') {
  hud.setTeam(team);
  hud.show();
  const scene = new BattleScene(map, units, s => {
    if (import.meta.env.DEV) Object.assign(window, { __scene: s }); // for poking at the scene from the browser console
    mountRotate(s);
    s.enableFx();
    hud.setPortraits(c => s.portrait(c));
    onReady(s);
  });
  ownGame(sceneGame(scene, 'game'));
}
