# Tactics

Gioco strategico a turni su griglia isometrica a più livelli di altezza. Si gioca nel browser, da desktop e da mobile. È scritto in TypeScript.

**Stato attuale:** MVP locale con quattro parti:
- un menu iniziale;
- una caserma dove vedi il roster e cambi classe alle unità;
- una battaglia di prova contro l'IA, su una mappa a scelta, con schieramento iniziale tramite drag and drop;
- un editor di mappe.

Server, account e PvP non ci sono ancora.

## Avvio

Serve Node 22+ e pnpm.

```bash
pnpm install
pnpm dev        # avvia il client (Vite), raggiungibile anche dalla rete locale
pnpm test       # test della logica di gioco (vitest)
pnpm typecheck  # controllo dei tipi su tutti i pacchetti
pnpm build      # typecheck + build di produzione del client in ./dist
```

## Deploy (Coolify + Railpack)

Il gioco per ora è un sito statico. Railpack lo compila con `pnpm build` e serve la cartella `dist/` con Caddy, sulla porta 80 (o su `$PORT` se è impostata).

In Coolify:
1. Crea una risorsa dal repository e scegli **Railpack** come build pack.
2. In **Ports Exposes** metti `80`.
3. Se il build non riconosce il sito statico, aggiungi la variabile `RAILPACK_SPA_OUTPUT_DIR=dist`.

Le versioni di Node e pnpm sono fissate in `package.json` (`engines.node`, `packageManager`) e in `railpack.json`.

## Struttura

```
packages/core/      logica di gioco pura: nessuna dipendenza grafica, deterministica
  src/map.ts          formato mappa, direzioni, validazione
  src/classes.ts      classi e abilità
  src/units.ts        unità in battaglia
  src/roster.ts       unità del giocatore fuori dalla battaglia
  src/pathfinding.ts  caselle raggiungibili (movimento, salto, ostacoli)
  src/combat.ts       gittata, danno, lato colpito
  src/initiative.ts   ordine dei turni
  src/battle.ts       stato della battaglia e reducer delle azioni
  src/ai.ts           IA nemica
  test/               test vitest
apps/client/        client Vite + Phaser 3
  src/menu.ts         menu iniziale e caserma
  src/battle.ts       avvio della battaglia di prova
  src/deploy.ts       schieramento con drag and drop
  src/editor.ts       editor mappe (admin)
  src/maps.ts         mappe di base e mappe salvate
  src/controller.ts   flusso dei turni e input del giocatore
  src/BattleScene.ts  rendering isometrico, unità, animazioni
  src/hud.ts          interfaccia sopra la mappa
  src/maps/           mappe in JSON
  public/tiles/       tile del terreno
  public/units/       sprite delle unità
```

La battaglia è un reducer puro: `apply(state, action)` restituisce un nuovo stato oppure lancia `BattleError` se l'azione non è valida. Il futuro server PvP potrà usare la stessa funzione per validare le mosse. Il seme del generatore casuale fa parte dello stato, quindi una battaglia si può rigiocare identica a partire dalle sue azioni.

## Regole

- **Turni:** l'iniziativa si calcola una volta a inizio battaglia, come velocità più un valore casuale. L'ordine resta poi fisso e si ripete.
- **Turno di un'unità:** un movimento, un'azione e la scelta della direzione, in quest'ordine. Movimento e azione si possono anche invertire.
- **Movimento:** la classe decide quante caselle si percorrono (`move`) e quanto dislivello si può superare a ogni passo (`jump`). Si può passare attraverso gli alleati, non attraverso i nemici.
- **Danno:** un colpo sul fianco fa ×1.25, uno alle spalle ×1.5. Ogni livello di altezza in più rispetto al bersaglio aggiunge il 5% di danno (massimo 4 livelli).
- **Gittata:** il corpo a corpo raggiunge al massimo 2 livelli di dislivello. Gli attacchi a distanza guadagnano 1 casella di gittata ogni 2 livelli di altezza in più.
- **Classi:** Guerriero, Arciere e Chierico. Il Chierico può curare.
- **Vittoria:** vince chi elimina tutte le unità avversarie.

## Formato mappa

```jsonc
{
  "id": "demo-river",
  "name": "Guado del colle",
  "width": 10,
  "height": 10,
  "heights": [[4, 4, 3, ...], ...],   // heights[y][x], interi >= 0
  "terrain": ["sssgggggdd", ...],      // una riga per y: g erba, d terra, s pietra, w acqua, x bloccato
  "spawns": { "A": [{ "x": 1, "y": 0 }, ...], "B": [...] },
  "maxDeploy": 3                       // unità schierabili per squadra
}
```

`validateMap()` in `packages/core/src/map.ts` controlla la mappa prima che venga usata. `parseMap()` fa lo stesso controllo sui JSON che arrivano da file o dallo storage.

## Editor mappe

Dal menu, "Editor mappe".
- **Strumenti:** alza e abbassa il terreno, dipingi il tipo di terreno (erba, terra, pietra, acqua, albero), piazza le caselle di partenza blu e nemiche. Alza, abbassa e terreno si applicano anche trascinando sulla mappa.
- **Proprietà:** nome, dimensioni (da 4 a 24 caselle per lato), unità schierabili per squadra.
- **Validazione:** la mappa viene controllata a ogni modifica e si può salvare solo se è valida.
- **Salvataggio:** le mappe si salvano nel browser e si possono esportare o importare come file JSON. Le mappe di base sono di sola lettura e si salvano come copia.
- **Uso:** le mappe salvate compaiono nella scelta della mappa della battaglia di prova.

## Asset

- **Terreno:** "Isometric Landscape" di Kenney ([kenney.nl](https://www.kenney.nl)), licenza CC0. Il file della licenza è in `apps/client/public/tiles/`.
- **Unità:** sprite pixel art 48×48 generate con un'IA, in 8 direzioni di cui il gioco usa le 4 diagonali. La licenza dipende dallo strumento con cui sono state create.

## Limiti noti

- Roster e mappe sono salvati in `localStorage`: vengono persi in una finestra privata o se si cancellano i dati del sito.
- L'editor non ha un accesso riservato: è aperto a chiunque apra il gioco.
- Nell'editor una colonna alta copre le caselle dietro di sé, che non si possono modificare finché non la abbassi.
- Gli attacchi a distanza non controllano la linea di tiro.
- Non si può ruotare la telecamera né zoomare con le dita.
- Le sprite hanno solo la posa ferma.
- In battaglia non si può annullare un movimento.

## Roadmap

1. Albero delle classi: requisiti per le classi avanzate, XP a ogni azione, passive sbloccate.
2. Backend Node + Postgres: account, roster, equipaggiamento, negozio.
3. Missioni: campagna a capitoli e missioni giornaliere create dall'admin, con ricompense in denaro.
4. PvP live a turni con livelli normalizzati e server autoritativo.
