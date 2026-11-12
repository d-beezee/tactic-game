# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Giocatori di strategia a turni che giocano nel browser, da desktop e da telefono. Nessun pubblico più preciso è stato definito.

## Product Purpose

Tactics è un gioco strategico a turni su griglia isometrica con più livelli di altezza. Il giocatore gestisce un roster di unità (classi, livelli, passive, equipaggiamento), le schiera e combatte contro l'IA. Una partita riuscita è una battaglia in cui il giocatore capisce perché ha vinto o perso: posizione, altezza, lato del colpo.

## Positioning

Le regole sono tutte in un core puro e deterministico condiviso da client e server: il client mostra cosa è permesso, il server rigioca le azioni e salva il risultato. Una battaglia si può rigiocare identica dal suo seme e dalle sue azioni.

## Operating Context

- Partite brevi, una battaglia di prova alla volta, su una mappa scelta.
- Si gioca con mouse (hover per anteprime, Q/E per ruotare) o col tocco (pinch, trascinamento, tocchi).
- L'admin usa l'editor di mappe e la lista utenti.

## Capabilities and Constraints

- Esistono: accesso con email e password, menu, caserma (classi, passive, equipaggiamento), negozio con oro, schieramento drag and drop, missioni giornaliere (le uniche che danno XP e oro), battaglia di prova senza ricompense, PvP con coda o codice (livelli a 5, senza ricompense), editor mappe e gestione missioni (admin).
- Non esistono ancora: campagna a capitoli.
- Regole che l'interfaccia deve rendere visibili: colpo sul fianco ×1,25, alle spalle ×1,5, +5% di danno per livello di altezza (massimo 4), gittata a distanza +1 ogni 2 livelli, corpo a corpo entro 2 livelli di dislivello.
- Classi: Guerriero, Arciere, Chierico; avanzate Paladino, Ranger, Saggio.
- Stack: TypeScript, Phaser 3.90 (WebGL), Vite, server Hono + Postgres.
- Lingua dell'interfaccia: italiano.

## Brand Commitments

- Nome: Tactics.
- Direzione visiva scelta: HD-2D, "diorama al tramonto" (vedi DESIGN.md).
- Vincolo: nessun asset nuovo. Terreno, luce, effetti e suoni si generano con codice.

## Evidence on Hand

- Sprite pixel 48×48 delle sei classi, quattro direzioni: `public/units/<classe>/<N|E|S|W>.png`.
- Mappa demo: `src/maps/demo.json`.
- Tile Kenney in `public/tiles/` (non più usate dal rendering).
- Nessuna musica, nessun ritratto disegnato, nessuna illustrazione: non vanno inventati.

## Product Principles

1. Le regole si vedono: ogni bonus che conta (lato, altezza, gittata) ha un segno visivo prima della conferma.
2. In battaglia la leggibilità viene prima dell'effetto.
3. Ogni azione importante ha un riscontro visivo e uno sonoro.
4. Telefono e desktop sono entrambi di prima classe.

## Accessibility & Inclusion

- Contrasto del testo almeno 4,5:1, bersagli tattili di almeno 44 px, focus visibile.
- Con `prefers-reduced-motion` niente tremolio, pulviscolo, respiro o deriva della camera; restano i segnali informativi.
- Oggi le squadre si distinguono solo per colore (contorno, anello, medaglione), più la parola "nemico" nella scheda. Serve un segno in più che non dipenda dal colore: decisione aperta.
