import { chapterOpen, type Chapter } from '@tactics/core';
import { Page, type PageProps } from './Page';

/** The story, chapter by chapter: each opens when the one before is won, and pays once. */
export function Campaign({ cleared, chapters, play, ...page }: PageProps & { cleared: string[]; chapters: Chapter[]; play: (chapter: Chapter) => void }) {
  const order = chapters.map(c => c.id);
  return (
    <Page title="Cronache di Valdombra" {...page}>
      <div className="chapters">
        {chapters.map((ch, i) => {
          const won = cleared.includes(ch.id), open = chapterOpen(order, cleared, ch.id) && !!ch.map;
          const state = !ch.map ? 'In manutenzione: manca la mappa'
            : won ? 'Vinto · rigioca quando vuoi, senza ricompensa'
            : open ? `+${ch.gold} oro e XP alla prima vittoria${ch.unlock ? ' · un nuovo alleato' : ''}`
            : `Vinci prima «${chapters[i - 1].title}»`;
          return (
            <button key={ch.id} className={`chapter${won ? ' won' : open ? ' next' : ''}`} disabled={!open} onClick={() => play(ch)}>
              <span className="ch-label">{ch.label}</span>
              <span className="ch-title">{ch.title}</span>
              <span className="ch-blurb">{ch.blurb}</span>
              <span className="ch-state">{state}</span>
            </button>
          );
        })}
        <p className="hint wide">Continua… I prossimi capitoli sono in lavorazione.</p>
      </div>
    </Page>
  );
}
