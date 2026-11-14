import { useState } from 'react';
import type { Account } from '../api';
import { music } from '../music';
import { play } from '../sfx';
import { saveSettings, settings } from '../theme';

type Target = 'campaign' | 'missions' | 'pvp' | 'maps' | 'barracks' | 'shop' | 'workshop' | 'logout';

export function Main({ player, open, onFx }: { player: Account; open: Record<Target, () => void>; onFx: () => void }) {
  return (
    <div className="menu-main">
      <h1 className="title">Tactics</h1>
      <p className="account">{player.email}, <b>{player.gold} oro</b></p>
      {/* play first, then get the squad ready */}
      <button className="menu-btn primary" onClick={open.campaign}>Campagna</button>
      <button className="menu-btn" onClick={open.missions}>Missioni giornaliere</button>
      <button className="menu-btn" onClick={open.pvp}>PvP</button>
      <button className="menu-btn" onClick={open.maps}>Battaglia di prova</button>
      <button className="menu-btn" onClick={open.barracks}>Caserma</button>
      <button className="menu-btn" onClick={open.shop}>Negozio</button>
      {player.admin && <button className="menu-btn workshop-btn" onClick={open.workshop}>Officina<small>admin</small></button>}
      <button className="menu-btn" onClick={open.logout}>Esci</button>
      <Settings onFx={onFx} />
    </div>
  );
}

/** Graphics and sound toggles. Graphics apply from the next scene. */
function Settings({ onFx }: { onFx: () => void }) {
  const [s, setS] = useState(settings);
  const flip = (key: 'fx' | 'sound') => {
    const next = { ...s, [key]: !s[key] };
    saveSettings(next);
    setS(next);
    if (key === 'fx') onFx();
    play('select');
    music('menu'); // starts or stops with the sound setting
  };
  return (
    <div className="settings">
      <button className="toggle" type="button" aria-pressed={s.fx} onClick={() => flip('fx')}>Grafica: <b>{s.fx ? 'piena' : 'leggera'}</b></button>
      <button className="toggle" type="button" aria-pressed={s.sound} onClick={() => flip('sound')}>Audio: <b>{s.sound ? 'acceso' : 'spento'}</b></button>
    </div>
  );
}
