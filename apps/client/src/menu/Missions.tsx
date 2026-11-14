import { CLASSES, type MapData } from '@tactics/core';
import type { Account, Mission } from '../api';
import { allMaps } from '../maps';
import { enemySummary, raceName } from '../ui';
import { Page, type PageProps } from './Page';

/** Today's daily missions: each pays XP and gold once a day, on a win. */
export function Missions({ list, player, fight, ...page }: PageProps & { list: Mission[]; player: Account; fight: (map: MapData, mission: Mission) => void }) {
  return (
    <Page title="Missioni giornaliere" {...page}>
      <p className="hint wide">Ogni missione vinta dà XP e oro, una volta al giorno. Si riparte a mezzanotte.</p>
      <div className="map-list">
        {list.map(m => {
          const map = allMaps().find(x => x.id === m.mapId);
          return (
            <button key={m.id} className="roster-item" disabled={m.done || !map} onClick={() => map && fight(map, m)}>
              <span className="rn">{m.name}</span>
              <span className="rc">{m.done ? 'Vinta oggi · torna domani' : `+${m.gold} oro e XP · ${map?.name ?? 'mappa mancante'}`}</span>
              <span className="rc">{enemySummary(m.enemies)}</span>
              {m.recruit && !player.roster.some(u => u.id === `m-${m.id}`) && (
                <span className="rc">Alla prima vittoria si unisce {m.recruit.name}, {raceName(m.recruit.raceId)} {CLASSES[m.recruit.classId].name}</span>
              )}
            </button>
          );
        })}
        {!list.length && <p className="hint">Oggi non ci sono missioni. Allenati con la battaglia di prova.</p>}
      </div>
    </Page>
  );
}
