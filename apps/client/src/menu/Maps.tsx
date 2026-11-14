import type { MapData } from '@tactics/core';
import { allMaps } from '../maps';
import { Page, type PageProps } from './Page';

/** Picks the map of a test battle. */
export function Maps({ fight, ...page }: PageProps & { fight: (map: MapData) => void }) {
  return (
    <Page title="Scegli la mappa" {...page}>
      <div className="map-list">
        {allMaps().map(m => (
          <button key={m.id} className="roster-item" onClick={() => fight(m)}>
            <span className="rn">{m.name}</span>
            <span className="rc">{m.width}×{m.height} · fino a {m.maxDeploy} unità</span>
          </button>
        ))}
      </div>
    </Page>
  );
}
