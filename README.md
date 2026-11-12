# Tactics

Gioco strategico a turni su griglia isometrica a più livelli di altezza. Si gioca nel browser, da desktop e da mobile. È scritto in TypeScript.

**Stato attuale:** client più server con account. Le parti sono:
- accesso con email e password;
- un menu iniziale;
- una caserma dove vedi il roster, cambi classe alle unità e le equipaggi;
- un negozio dove compri armi e armature con l'oro;
- missioni giornaliere create dall'admin: le uniche battaglie che danno XP e oro;
- PvP contro altri giocatori: coda in lobby o stanza privata con codice;
- una battaglia di prova contro l'IA, su una mappa a scelta, con schieramento iniziale tramite drag and drop, che non dà ricompense;
- un editor di mappe.

La campagna a capitoli non c'è ancora.

## Avvio

Servono Node 24, pnpm e Docker. Docker serve solo per il Postgres di sviluppo.

```bash
pnpm install
pnpm dev        # avvia Postgres (docker compose), il server su :3000 e il client (Vite)
pnpm test       # test della logica di gioco (vitest)
pnpm typecheck  # controllo dei tipi su tutti i pacchetti
pnpm build      # typecheck + client in ./dist + server in ./dist-server/server.cjs
pnpm start      # avvia il server di produzione (serve DATABASE_URL)
```

In sviluppo Vite gira su una porta sua e inoltra `/api` al server. Il Postgres di sviluppo ascolta su `localhost:5433` con utente, password e database `tactics`. Per usare un altro database, imposta `DATABASE_URL` prima di `pnpm dev`.

## Deploy (Coolify + Railpack)

Il gioco è un solo servizio Node. Lo stesso processo risponde su `/api` e serve i file del client dalla cartella `dist/`. Il database è un Postgres creato come risorsa Coolify sullo stesso server.

Railpack compila con `pnpm build` e avvia `node dist-server/server.cjs`. Il comando di avvio è in `railpack.json` (`deploy.startCommand`): averlo impostato disattiva la modalità sito statico con Caddy usata prima.

In Coolify:
1. Crea una risorsa **PostgreSQL** nello stesso progetto e copia il suo URL interno.
2. Nella risorsa del gioco scegli **Railpack** come build pack.
3. Aggiungi la variabile `DATABASE_URL` con l'URL interno del database.
4. In **Ports Exposes** metti `3000`. Il server ascolta su `$PORT`, oppure su 3000 se `PORT` non è impostata.
5. Come health check usa `GET /api/health`: risponde 200 solo se il database è raggiungibile.
6. Attiva i backup pianificati sulla risorsa PostgreSQL. Senza backup, perdere il volume vuol dire perdere tutti gli account.

Se nella risorsa era rimasta la variabile `RAILPACK_SPA_OUTPUT_DIR`, toglila: forza la modalità sito statico.

Variabili del server:

| Variabile | Obbligatoria | Significato |
|---|---|---|
| `DATABASE_URL` | sì | stringa di connessione a Postgres |
| `PORT` | no | porta di ascolto, 3000 se manca |
| `STATIC_DIR` | no | cartella del client compilato, `./dist` se manca |

**Migrazioni:** il server le applica all'avvio, prima di accettare richieste. Sono in `apps/server/src/db.ts`, in un elenco a cui si aggiunge soltanto in fondo. Una migrazione già eseguita in produzione non va più modificata.

**Sessioni:** il cookie di sessione è `httpOnly` e dura 30 giorni. Ha l'attributo `Secure` quando il proxy segnala HTTPS con l'intestazione `X-Forwarded-Proto`, come fa quello di Coolify.

Le versioni di Node e pnpm sono fissate in `package.json` (`engines.node`, `packageManager`) e in `railpack.json`.

## Struttura

```
packages/core/      logica di gioco pura: nessuna dipendenza grafica, deterministica
  src/map.ts          formato mappa, direzioni, validazione
  src/classes.ts      classi e abilità
  src/units.ts        unità in battaglia
  src/roster.ts       unità del giocatore, progressione e XP
  src/items.ts        catalogo di armi e armature
  src/player.ts       stato del giocatore: oro, inventario, acquisti, equipaggiamento
  src/testBattle.ts   battaglie contro l'IA: nemici, schieramento, replay delle azioni e ricompense
  src/pathfinding.ts  caselle raggiungibili (movimento, salto, ostacoli)
  src/combat.ts       gittata, danno, lato colpito
  src/initiative.ts   ordine dei turni
  src/battle.ts       stato della battaglia e reducer delle azioni
  src/ai.ts           IA nemica
  test/               test vitest
apps/server/        server Node (Hono) + Postgres
  src/main.ts         avvio: migrazioni, poi server HTTP
  src/app.ts          API: account, sessioni, caserma, negozio, battaglie
  src/db.ts           migrazioni e transazioni
apps/client/        client Vite + Phaser 3
  src/menu.ts         accesso, menu iniziale, caserma e negozio
  src/api.ts          chiamate al server
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

Le regole stanno tutte in `packages/core`. Il server non le riscrive: per ogni richiesta carica il giocatore, applica una funzione pura del core (`buyItem`, `updateUnit`, `finishTestBattle`) e salva il risultato. Il client usa lo stesso codice solo per mostrare cosa è permesso.

La battaglia è un reducer puro: `apply(state, action)` restituisce un nuovo stato oppure lancia `BattleError` se l'azione non è valida. Il server PvP usa la stessa funzione per validare le mosse. La telecamera ruota a scatti di 90° (pulsanti ⟲ ⟳ o tasti Q/E): la logica resta in coordinate di griglia, e solo `BattleScene` converte in coordinate di vista. Il seme del generatore casuale fa parte dello stato, quindi una battaglia si può rigiocare identica a partire dalle sue azioni.

## Regole

- **Turni:** l'iniziativa si calcola una volta a inizio battaglia, come velocità più un valore casuale. L'ordine resta poi fisso e si ripete.
- **Turno di un'unità:** un movimento, un'azione e la scelta della direzione, in quest'ordine. Movimento e azione si possono anche invertire.
- **Movimento:** la classe decide quante caselle si percorrono (`move`) e quanto dislivello si può superare a ogni passo (`jump`). Si può passare attraverso gli alleati, non attraverso i nemici.
- **Danno:** un colpo sul fianco fa ×1.25, uno alle spalle ×1.5. Ogni livello di altezza in più rispetto al bersaglio aggiunge il 5% di danno (massimo 4 livelli).
- **Gittata:** il corpo a corpo raggiunge al massimo 2 livelli di dislivello. Gli attacchi a distanza guadagnano 1 casella di gittata ogni 2 livelli di altezza in più.
- **Classi base:** Guerriero, Arciere e Chierico. Il Chierico può curare.
- **Vittoria:** vince chi elimina tutte le unità avversarie.

## Progressione

- **Livelli:** ogni classe ha il suo livello, da 1 a 8. Le statistiche dipendono dalla classe attiva e dal suo livello: +5% per livello su PV, attacco, difesa, magia e velocità. Movimento e salto non crescono.
- **XP:** va alla classe attiva, solo da una missione giornaliera vinta. Ogni azione dà 10 XP, un'eliminazione +20, la vittoria +20 a chi è ancora in piedi. Il livello 2 costa 100 XP, e ogni livello successivo costa 50 XP in più del precedente (livello 4 = 450 XP totali, livello 8 = 1750).
- **Classi avanzate:** si sbloccano con i livelli delle altre classi.
  - Paladino: Guerriero 4 + Chierico 2.
  - Ranger: Arciere 4 + Guerriero 2.
  - Saggio: Chierico 4 + Arciere 2.
- **Passive:** ogni classe sblocca la sua al livello 4. Ogni unità ne equipaggia una (1 slot), da scegliere in caserma.

| Classe | Passiva | Effetto |
|---|---|---|
| Guerriero | Tempra | +10% PV massimi |
| Arciere | Occhio di falco | +1 gittata alle azioni a distanza |
| Chierico | Grazia | +25% alle cure |
| Paladino | Scudo sacro | -10% danni subiti |
| Ranger | Passo leggero | +1 movimento |
| Saggio | Concentrazione | +15% magia |

Nella battaglia di prova i nemici hanno il livello medio delle classi attive del roster. Il codice è in `packages/core/src/roster.ts` (curva XP, sblocchi, `applyBattleXp`) e in `units.ts` (crescita delle statistiche ed effetti delle passive).

## Battaglie e server

XP e oro li decide il server, non il client.

1. A fine schieramento il client manda le posizioni e l'id della mappa (battaglia di prova) o della missione a `POST /api/battles`. Il server prende la mappa dalla sua copia (quella di base o una salvata), controlla lo schieramento, costruisce le unità dal roster salvato, sceglie il seme casuale e salva tutto. Risponde con id, seme e unità.
2. Il client gioca la battaglia in locale con quei dati e registra solo le azioni del giocatore.
3. A fine battaglia il client manda le azioni a `POST /api/battles/:id/finish`. Il server rigioca la battaglia: applica le azioni del giocatore con `apply` e calcola i turni nemici con la stessa IA. Se un'azione non è valida, o se la lista finisce prima che ci sia un vincitore, rifiuta tutto.
4. Paga solo una missione giornaliera vinta per la prima volta nella giornata: XP dallo stato finale del replay, oro dalla missione. La battaglia di prova, una missione persa o una missione già vinta oggi non danno niente. Il risultato è salvato sulla battaglia: una seconda richiesta con lo stesso id riceve la stessa risposta e non paga due volte.

Una battaglia abbandonata non dà nulla. Il codice è in `packages/core/src/testBattle.ts`.

## Missioni giornaliere

- **Creazione:** dal menu "Gestisci missioni" l'admin crea una missione con nome, mappa (di base o salvata), oro (da 0 a 10000) e nemici, e può eliminarla. Una mappa usata da una missione non si può eliminare.
- **Nemici:** da 1 a 12, ognuno con classe (anche avanzata), livello da 1 a 8 e casella di partenza. Si piazzano toccando le caselle di una griglia della mappa. Una casella deve essere calpestabile e non può essere una partenza del giocatore. Alla scelta della mappa la griglia propone un nemico per ogni partenza nemica. Il numero di nemici non dipende da `maxDeploy`, che limita solo il giocatore.
- **Gioco:** dal menu "Missioni giornaliere" ogni giocatore vede tutte le missioni. Una missione vinta paga XP e l'oro indicato, una volta al giorno per giocatore. Il giorno cambia a mezzanotte, ora italiana (`Europe/Rome`). Una missione persa si può rigiocare.
- **Dati:** tabelle `missions` (con i nemici in `enemies`) e `mission_wins` (una riga per giocatore, missione e giorno). Il controllo dei nemici (`parseMissionEnemies`) e il pagamento (`payBattle`) sono in `packages/core/src/testBattle.ts`. Il server ricontrolla i nemici a ogni avvio di battaglia, perché la mappa può essere cambiata dopo.

## PvP

- **Entrare:** dal menu "PvP". "Cerca un avversario" mette in coda: se c'è già qualcuno in coda, la partita parte subito, altrimenti si aspetta il prossimo. "Crea una stanza per un amico" dà un codice di 6 caratteri da condividere; l'amico lo scrive in "Entra con il codice". Un codice vale finché la stanza non è piena.
- **Partita:** mappa di base. Chi crea la stanza, o aspettava in coda, è la squadra blu (A); l'altro la rossa (B), sulle partenze nemiche. Ognuno schiera fino a `maxDeploy` unità; la battaglia parte quando hanno schierato entrambi.
- **Livelli:** tutte le unità combattono al livello 5 (`PVP_LEVEL`), con passiva ed equipaggiamento. Il PvP non dà XP né oro.
- **Server autoritativo:** il server conserva le azioni della partita. A ogni mossa rigioca la battaglia, controlla che tocchi alla squadra di chi la manda e la applica con `apply`. Ogni azione porta il suo indice, così un invio ripetuto non viene applicato due volte.
- **Comunicazione:** ogni client interroga il server una volta al secondo (`GET /api/pvp/:id?from=n`) e riceve le azioni nuove. Niente WebSocket.
- **Fine:** vince chi elimina le unità avversarie. "Arrenditi" dà la vittoria all'altro. Chi non si fa sentire per 45 secondi (pagina chiusa, rete persa) perde. Entrare di nuovo in coda o in una stanza chiude la partita precedente con una resa.
- **Dati:** tabella `pvp_matches`, una riga per partita, con stato (`waiting`, `deploy`, `battle`, `done`), schieramenti, unità, seme e azioni.

## Account, oro ed equipaggiamento

- **Account:** email e password. Chi si registra da un browser in cui aveva già giocato porta con sé il roster salvato lì.
- **Admin:** il primo account registrato è l'admin. Se esistono account ma nessuno è admin, lo diventa il più vecchio: il controllo gira a ogni avvio del server e dopo ogni registrazione. Dal menu "Utenti" un admin può dare o togliere il ruolo agli altri account, ma non può toglierlo a sé stesso: così ne resta sempre almeno uno. Solo gli admin vedono l'editor mappe e possono salvare o eliminare mappe. Tutti i giocatori combattono sulle mappe salvate.
- **Oro:** si parte con 300. Lo danno solo le missioni giornaliere.
- **Negozio:** vende armi e armature. Ogni acquisto aggiunge una copia all'inventario.
- **Equipaggiamento:** ogni unità ha due slot, arma e armatura. Una copia di un oggetto può stare su una sola unità alla volta. I bonus sono fissi e si sommano alle statistiche dopo la crescita di livello e prima della passiva.

| Oggetto | Slot | Prezzo | Bonus |
|---|---|---|---|
| Lama affilata | Arma | 120 | +2 attacco |
| Lama runica | Arma | 300 | +4 attacco |
| Fulcro arcano | Arma | 150 | +3 magia |
| Giaco di cuoio | Armatura | 100 | +2 difesa |
| Corazza a piastre | Armatura | 280 | +4 difesa, -1 velocità |
| Amuleto vitale | Armatura | 160 | +10 PV |

Il catalogo è in `packages/core/src/items.ts`.

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

Dal menu, "Editor mappe". La voce compare solo all'admin.
- **Strumenti:** alza e abbassa il terreno, dipingi il tipo di terreno (erba, terra, pietra, acqua, albero), piazza le caselle di partenza blu e nemiche. Alza, abbassa e terreno si applicano anche trascinando sulla mappa.
- **Proprietà:** nome, dimensioni (da 4 a 24 caselle per lato), unità schierabili per squadra.
- **Validazione:** la mappa viene controllata a ogni modifica e si può salvare solo se è valida.
- **Salvataggio:** le mappe si salvano sul server (tabella `maps`) e si possono esportare o importare come file JSON. Le mappe di base sono di sola lettura e si salvano come copia. Le mappe rimaste nel browser da prima vengono caricate sul server la prima volta che l'admin apre l'editor o la scelta della mappa.
- **Uso:** le mappe salvate compaiono a tutti i giocatori nella scelta della mappa della battaglia di prova. Eliminare una mappa la toglie a tutti.

## Asset

- **Terreno:** "Isometric Landscape" di Kenney ([kenney.nl](https://www.kenney.nl)), licenza CC0. Il file della licenza è in `apps/client/public/tiles/`.
- **Unità:** sprite pixel art 48×48 generate con un'IA, in 8 direzioni di cui il gioco usa le 4 diagonali. La licenza dipende dallo strumento con cui sono state create.

## Limiti noti

- Si può avere una sola battaglia aperta per account: iniziarne una seconda, anche da un'altra scheda, annulla la prima.
- Non c'è verifica dell'email né recupero della password: servirebbe un servizio di posta.
- Gli oggetti non si possono rivendere e non hanno restrizioni di classe. I nemici non hanno equipaggiamento.
- I tentativi di accesso falliti sono contati in memoria: il limite vale per una sola istanza del server e si azzera a ogni riavvio.
- Gli attacchi a distanza non controllano la linea di tiro.
- Le sprite hanno solo la posa ferma.
- In battaglia non si può annullare un movimento.
- PvP: ricaricare la pagina fa perdere la partita in corso, perché non c'è un modo per rientrarci. Non c'è un limite di tempo per turno: un avversario presente ma fermo blocca la partita finché qualcuno non si arrende.
- PvP: il polling ogni secondo regge pochi giocatori alla volta. Per molte partite insieme servono SSE o WebSocket.

## Roadmap

1. Campagna a capitoli.
