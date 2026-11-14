import { DEFAULT_ROSTER, type Chapter, type MapData, type Player, type RosterUnit } from '@tactics/core';
import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { api, ApiError, type Account, type Mission, type PvpState } from '../api';
import { allMaps, BUILTIN_MAPS, loadMaps } from '../maps';
import { music, setLibrary } from '../music';
import { play } from '../sfx';
import { Workshop } from '../workshop';
import { Auth } from './Auth';
import { Barracks } from './Barracks';
import { Campaign } from './Campaign';
import { Main } from './Main';
import { Maps } from './Maps';
import { Missions } from './Missions';
import { Pvp, PvpWait } from './Pvp';
import { Shop } from './Shop';

/** Where the menu sends the player when a game starts. */
export interface Go {
  testBattle: (roster: RosterUnit[], map: MapData, mission?: Mission) => void;
  pvp: (roster: RosterUnit[], id: string, state: PvpState) => void;
  campaign: (roster: RosterUnit[], chapter: Chapter) => void;
  editor: () => void;
  rehearse: (roster: RosterUnit[], chapter: Chapter, trackId: string | null) => void;
}
type After = 'campaign' | 'workshop';

/** Live map behind the menu, loaded on demand so Phaser stays out of the first download. */
let stopBackdrop: (() => void) | null = null;
let backdropGen = 0; // newest request wins when loads overlap
async function backdrop(roster: RosterUnit[]) {
  const gen = ++backdropGen;
  stopBackdrop?.();
  stopBackdrop = null;
  try {
    const stop = (await import('../backdrop')).startBackdrop(BUILTIN_MAPS[0], roster);
    if (gen !== backdropGen) stop(); // replaced, or the player left the menu while it loaded
    else stopBackdrop = stop;
  } catch (e) {
    console.error(e); // no WebGL or canvas: the menu works without the scene
  }
}

let root: Root | null = null;
let opened = 0;

const leaveMenu = () => {
  music(null);
  backdropGen++;
  stopBackdrop?.();
  stopBackdrop = null;
  root?.render(null); // unmounts the screen, which stops its timers and polls
  document.getElementById('menu')!.hidden = true;
  document.getElementById('backdrop')!.hidden = true; // it sits above the game canvas
};

/** Opens the menu, at start and on every return from a screen; 'campaign' lands on the chapter list, 'workshop' on the Officina. */
export function showMenu(go: Go, after?: After) {
  const node = document.getElementById('menu')!;
  root ??= createRoot(node);
  node.hidden = false;
  document.getElementById('backdrop')!.hidden = false; // hidden by leaveMenu
  root.render(<Menu key={++opened} go={go} after={after} />); // a new key starts from the loading screen
}

type Screen =
  | { at: 'loading' | 'main' | 'pvp' | 'maps' | 'barracks' | 'shop' | 'workshop' }
  | { at: 'failed' | 'auth'; message: string }
  | { at: 'wait'; id: string }
  | { at: 'campaign'; cleared: string[]; chapters: Chapter[] }
  | { at: 'missions'; list: Mission[] };

function Menu({ go, after }: { go: Go; after?: After }) {
  const [player, setPlayer] = useState<Account | null>(null);
  const [screen, setScreen] = useState<Screen>({ at: 'loading' });
  /** the unit open in the barracks; the shop compares items against it */
  const [selected, setSelected] = useState('');
  /** last failed request, shown on the current screen */
  const [error, setError] = useState('');

  // The screen asked for last, known before React redraws.
  // A slow answer must not pull the player back to a screen they already left.
  const asked = useRef(screen);
  const show = (s: Screen) => { asked.current = s; setScreen(s); };
  const stay = () => { const from = asked.current; return () => asked.current === from; };
  /** where to land after the first login; a later login in the same visit lands on the main menu */
  const landing = useRef(after);

  const auth = (message = '') => {
    if (!stopBackdrop) void backdrop(DEFAULT_ROSTER);
    show({ at: 'auth', message });
  };
  const toMain = () => {
    music('menu'); // also stops an admin preview
    setError('');
    show({ at: 'main' });
  };

  /** Waits for a request. A 401 opens the login, any other failure is shown on the current screen. Null when it failed. */
  const load = async <T,>(request: Promise<T>): Promise<T | null> => {
    try {
      const answer = await request;
      setError('');
      return answer;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) auth();
      else setError((e as Error).message);
      return null;
    }
  };
  /** Sends a change to the server and keeps the new state. False when it failed. */
  const run = async (request: Promise<Player>) => {
    const next = await load(request);
    if (next) setPlayer(p => ({ ...p!, ...next }));
    return !!next;
  };

  const enter = (account: Account) => {
    setPlayer(account);
    setSelected(account.roster[0].id);
    void backdrop(account.roster);
    void api.music().then(setLibrary, () => { /* no music list: the menu works silently */ });
    toMain();
    const to = landing.current;
    landing.current = undefined;
    // back from a chapter: straight to the chapter list
    if (to === 'campaign') void openCampaign();
    if (to === 'workshop' && account.admin) show({ at: 'workshop' });
  };

  const boot = async () => {
    show({ at: 'loading' });
    try {
      enter(await api.me());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return auth();
      show({ at: 'failed', message: (e as Error).message });
    }
  };
  useEffect(() => { void boot(); }, []);

  /** The story, chapter by chapter. A failed load still opens the screen, empty, with the error. */
  const openCampaign = async () => {
    const still = stay();
    const data = await load(api.campaign());
    if (still()) show({ at: 'campaign', cleared: data?.cleared ?? [], chapters: data?.chapters ?? [] });
  };
  /** Loads missions and maps together; the maps are needed to start a mission and to name its map. */
  const openMissions = async () => {
    const still = stay();
    const data = await load(Promise.all([api.missions(), loadMaps(player!.admin)]));
    if (still()) show({ at: 'missions', list: data?.[0] ?? [] });
  };
  const openMaps = async () => {
    const still = stay();
    let failed = false;
    try {
      await loadMaps(player!.admin);
      setError('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return auth();
      setError(`Mappe salvate non caricate: ${(e as Error).message}`);
      failed = true;
    }
    if (!still()) return;
    const maps = allMaps();
    if (maps.length === 1 && !failed) return fight(maps[0]);
    show({ at: 'maps' });
  };
  /** Opens a PvP room or joins the queue, then waits there for the other player. */
  const waitMatch = async (request: Promise<{ id: string }>) => {
    const still = stay();
    const room = await load(request);
    if (room && still()) show({ at: 'wait', id: room.id });
  };

  const fight = (map: MapData, mission?: Mission) => { leaveMenu(); go.testBattle(player!.roster, map, mission); };

  if (screen.at === 'loading') return <div className="menu-main"><p className="hint">Caricamento…</p></div>;
  if (screen.at === 'failed') return (
    <div className="menu-main">
      <p className="error" role="alert">{screen.message}</p>
      <button className="menu-btn primary" onClick={() => void boot()}>Riprova</button>
    </div>
  );
  if (screen.at === 'auth' || !player) return <Auth message={screen.at === 'auth' ? screen.message : ''} onEnter={enter} />;

  const page = { back: toMain, error };
  switch (screen.at) {
    case 'main': return (
      <Main
        player={player}
        onFx={() => void backdrop(player.roster)}
        open={{
          campaign: () => void openCampaign(),
          missions: () => void openMissions(),
          pvp: () => show({ at: 'pvp' }),
          maps: () => void openMaps(),
          barracks: () => show({ at: 'barracks' }),
          shop: () => show({ at: 'shop' }),
          workshop: () => show({ at: 'workshop' }),
          logout: () => void api.logout().then(() => auth(), e => auth((e as Error).message)),
        }}
      />
    );
    case 'pvp': return (
      <Pvp {...page} queue={() => void waitMatch(api.pvpQueue())} room={() => void waitMatch(api.pvpRoom())} join={code => void waitMatch(api.pvpJoin(code))} />
    );
    case 'wait': return (
      <PvpWait
        id={screen.id}
        onStart={st => { play('select'); leaveMenu(); go.pvp(player.roster, screen.id, st); }}
        onClosed={() => { setError('La stanza è stata chiusa'); show({ at: 'pvp' }); }}
        onAuth={() => auth()}
        onCancel={() => { void api.pvpLeave(screen.id).catch(() => {}); show({ at: 'pvp' }); }}
      />
    );
    case 'campaign': return (
      <Campaign {...page} cleared={screen.cleared} chapters={screen.chapters} play={ch => { play('select'); leaveMenu(); go.campaign(player.roster, ch); }} />
    );
    case 'missions': return <Missions {...page} list={screen.list} player={player} fight={fight} />;
    case 'maps': return <Maps {...page} fight={fight} />;
    case 'shop': return <Shop {...page} player={player} selected={selected} buy={id => run(api.buy(id))} />;
    case 'barracks': return (
      <Barracks {...page} player={player} selected={selected} select={setSelected} update={(id, change) => void run(api.updateUnit(id, change))} />
    );
    case 'workshop': return (
      <Workshop
        player={player}
        back={toMain}
        auth={() => auth()}
        mapEditor={() => { leaveMenu(); go.editor(); }}
        rehearse={(ch, trackId) => { leaveMenu(); go.rehearse(player.roster, ch, trackId); }}
      />
    );
  }
}
