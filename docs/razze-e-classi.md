# Razze e classi

Documento di design e di implementazione. Descrive cosa aggiungiamo al gioco e come lo costruiamo sul codice che esiste già. I numeri sono un primo bilanciamento: si cambiano nei dati, senza toccare il motore.

## Obiettivi

1. **Razze.** Ogni unità ha una razza fissa. La razza modifica le statistiche, dà un tratto sempre attivo e può aprire classi che le altre razze non hanno.
2. **Più classi.** L'albero passa da 6 a 20 classi. Alcune sono aperte a tutte le razze, altre sono riservate a una razza (anche alle razze meta), altre ancora sono ibride che richiedono una classe riservata.
3. **Nuovi effetti in battaglia.** Stati nel tempo, buff e debuff, aree d'effetto, spinta e caduta, teletrasporto, scambio di posto.
4. **Abilità secondaria.** Un'unità che porta certe classi al livello massimo può usarne le azioni da secondaria, dopo aver speso un Cristallo di luna.
5. **Razze meta nell'endgame.** Tre razze legate alla trama del Giocatore 2 arrivano come alleati nei capitoli dopo la battaglia finale.

Fuori dal perimetro di questa versione: linea di vista per le azioni a distanza, ordine di turno dinamico.

## Stato attuale

- `packages/core/src/classes.ts`: 6 classi. Guerriero, Arciere e Chierico sono base. Paladino, Ranger e Saggio sono avanzate e si sbloccano con `requires` (livelli in altre classi).
- Ogni classe ha 1 o 2 azioni. Le azioni fanno solo danno o cura a un bersaglio singolo.
- `roster.ts`: XP separata per ogni classe, livello massimo 8 (`MAX_CLASS_LEVEL`). Una passiva equipaggiabile, presa da una classe al livello 4 o più (`PASSIVE_LEVEL`).
- `units.ts`: `createUnit` calcola le statistiche in quest'ordine: base della classe, crescita per livello, oggetti, passiva.
- `battle.ts`: reducer puro `apply()`, eseguito anche dal server per verificare le battaglie. L'ordine di turno si tira a inizio battaglia e non cambia più.
- `ai.ts`: IA greedy che valuta ogni azione da ogni casella raggiungibile.
- Il roster è un campo `jsonb` in `users`. Gli sprite sono in `apps/client/public/units/<classId>/{N,E,S,W}.png` e vengono caricati tutti all'avvio di `BattleScene`.

## Razze

### Elenco

Le statistiche delle razze sono **bonus fissi**, sommati dopo la crescita per livello. Un bonus in percentuale non funzionerebbe: la magia del Guerriero vale 2, quella del Saggio 14.

| Razza | id | Disponibile | Statistiche | Tratto |
|---|---|---|---|---|
| Umani | `human` | da subito | nessun bonus | **Versatili**: +10% XP di classe |
| Corvidi | `corvid` | da subito | PV −6, VEL +1, SALTO +1 | **Piume**: nessun danno da caduta |
| Torbidi | `peatfolk` | da subito | PV +8, DIF +1, VEL −1 | **Radici**: recuperano il 5% dei PV massimi a inizio turno |
| Lucigeni | `lumen` | da subito | MAG +2, ATT −2 | **Lanterna**: +1 gittata alle azioni che usano MAG |
| Pedine | `pawn` | endgame | DIF +2, MOV −1 | **Legno pieno**: immuni a spinta e stordimento |
| Sprite | `sprite` | endgame | VEL +2, PV −4 | **Sfarfallio**: 10% di probabilità di schivare un danno |
| Glitch | `glitch` | endgame | MAG +3, DIF −2 | **Salto di frame**: azione extra, teletrasporto a 1–3 caselle, una volta per battaglia |

Corvidi, Torbidi e Lucigeni sono la gente di Valdombra: brughiera, palude, lanterne. Pedine, Sprite e Glitch vengono dalla "cartuccia": sono pezzi del gioco che il Giocatore 2 ha corrotto, e si uniscono al gruppo solo dopo la battaglia finale.

### Regole

- La razza è fissa per tutta la vita dell'unità. Nessuna azione del giocatore la cambia.
- Le unità salvate senza razza diventano Umani alla lettura del roster. Brando, Lia, Oris e gli alleati attuali della campagna restano Umani.
- Anche i nemici hanno una razza. Se una missione non la indica, il nemico è Umano.
- Il PvP usa la razza delle unità come in campagna. Le razze meta sono ammesse: il giocatore le schiera appena possiede l'unità, senza altri vincoli.

### Reclutamento

Le unità di altre razze entrano nel roster in due modi:

- **Campagna**: alleati sbloccati alla prima vittoria di un capitolo, come oggi Teo o Fiora. Il campo `unlock` del capitolo riceve `raceId`.
- **Missioni giornaliere**: l'admin può aggiungere a una missione una recluta (nome, razza, classe). La recluta entra nel roster alla prima vittoria di quella missione, una volta sola per giocatore. Le vittorie dei giorni dopo pagano solo XP, oro e oggetti.

Le razze meta arrivano solo dalla campagna, nei capitoli dopo la battaglia finale.

## Classi

### Albero

Le classi riservate valgono solo per una razza. Un'ibrida che richiede una classe riservata è riservata a quella razza di conseguenza: il codice lo calcola, non va scritto a mano (vedi "Modello dati").

| Classe | id | Tipo | Razze | Requisiti | Concede secondaria |
|---|---|---|---|---|---|
| Guerriero | `warrior` | base | tutte | — | sì |
| Arciere | `archer` | base | tutte | — | sì |
| Chierico | `cleric` | base | tutte | — | sì |
| Ladro | `thief` | base | tutte | — | sì |
| Arcanista | `arcanist` | base | tutte | — | sì |
| Mago verde | `green_mage` | base | Torbidi | — | sì |
| Lanciere | `lancer` | base | Corvidi | — | sì |
| Lanternaio | `lampwright` | base | Lucigeni | — | sì |
| Paladino | `paladin` | avanzata | tutte | Guerriero 4, Chierico 2 | no |
| Ranger | `ranger` | avanzata | tutte | Arciere 4, Guerriero 2 | no |
| Saggio | `sage` | avanzata | tutte | Chierico 4, Arciere 2 | no |
| Assassino | `assassin` | avanzata | tutte | Ladro 4, Arciere 2 | no |
| Stregone | `warlock` | avanzata | tutte | Arcanista 4, Saggio 2 | no |
| Cavaliere verde | `green_knight` | ibrida | Torbidi | Mago verde 4, Guerriero 3 | no |
| Druido | `druid` | ibrida | Torbidi | Mago verde 4, Chierico 4 | no |
| Tempestaio | `stormcaller` | ibrida | Corvidi | Lanciere 4, Ranger 2 | no |
| Faro | `beacon` | ibrida | Lucigeni | Lanternaio 4, Saggio 2 | no |
| Torre | `rook` | base | Pedine | — | sì |
| Lampo | `flicker` | base | Sprite | — | sì |
| Corruttore | `corruptor` | base | Glitch | — | sì |

### Nuove classi nel dettaglio

Statistiche a livello 1 nell'ordine PV / ATT / DIF / MAG / VEL / MOV / SALTO. Per confronto, il Guerriero ha 60 / 14 / 6 / 2 / 6 / 4 / 2.

**Ladro** — 46 / 12 / 4 / 2 / 9 / 5 / 3
- Pugnale avvelenato: ATT ×0,8, mischia, applica Veleno per 3 turni.
- Calcio: ATT ×0,5, mischia, spinta di 1 casella.
- Passiva *Alle spalle*: +15% danni dagli attacchi alle spalle.

**Arcanista** — 40 / 4 / 2 / 14 / 6 / 3 / 2
- Scintilla: MAG ×1,0, gittata 1–3, bersaglio singolo.
- Fiammata: MAG ×0,8, gittata 2–4, area di raggio 1.
- Passiva *Fuoco vivo*: +10% danni magici.

**Mago verde** (Torbidi) — 50 / 6 / 4 / 11 / 5 / 3 / 2
- Spore: MAG ×0,6, gittata 2–4, area di raggio 1, applica Veleno per 3 turni.
- Linfa: cura MAG ×1,0, gittata 0–3, applica Rigenerazione per 3 turni.
- Radici: nessun danno, gittata 1–3, applica Radicato per 2 turni.
- Passiva *Muschio*: recupera il 3% dei PV massimi a inizio turno.

**Lanciere** (Corvidi) — 50 / 13 / 5 / 2 / 8 / 4 / 4
- Affondo: ATT ×1,0, mischia con gittata 1–2.
- Picchiata: ATT ×1,2, mischia, spinta di 1 casella.
- Passiva *Ali*: +1 SALTO.

**Lanternaio** (Lucigeni) — 44 / 5 / 3 / 12 / 7 / 3 / 2
- Luce calda: nessun danno, alleati, gittata 0–3, area di raggio 1, applica Forza per 3 turni.
- Abbaglio: MAG ×0,5, gittata 2–4, applica Indebolito per 2 turni.
- Fiamma fatua: MAG ×0,9, gittata 2–4.
- Passiva *Rifrazione*: i buff che applica durano 1 turno in più.

**Assassino** — 48 / 15 / 4 / 2 / 10 / 5 / 3
- Pugnalata: ATT ×1,1, mischia, 30% di probabilità di Stordito per 1 turno.
- Pugnale avvelenato (come il Ladro).
- Lancio di coltelli: ATT ×0,7, gittata 2–3, a distanza.
- Passiva *Ombra*: +25% danni dagli attacchi alle spalle.

**Stregone** — 42 / 4 / 3 / 16 / 6 / 3 / 2
- Fiammata (come l'Arcanista).
- Maledizione: nessun danno, gittata 2–4, applica Spezzato per 3 turni.
- Meteora: MAG ×1,1, gittata 3–5, area di raggio 1.
- Passiva *Vastità*: +1 al raggio delle aree.

**Cavaliere verde** (Torbidi) — 66 / 13 / 7 / 7 / 5 / 4 / 2
- Colpo (come il Guerriero).
- Stretta di rovi: ATT ×0,8, mischia, applica Radicato per 2 turni.
- Corteccia: nessun danno, su sé stesso, applica Scudo per 3 turni.
- Passiva *Spine*: chi lo colpisce in mischia subisce il 10% del danno inflitto.

**Druido** (Torbidi) — 48 / 5 / 4 / 14 / 6 / 3 / 2
- Pioggia di linfa: cura MAG ×1,0, gittata 0–3, area di raggio 1.
- Spore (come il Mago verde).
- Rovi: MAG ×0,9, gittata 2–4, area di raggio 1, 50% di probabilità di Radicato per 1 turno.
- Passiva *Germoglio*: +20% alle cure.

**Tempestaio** (Corvidi) — 54 / 14 / 5 / 2 / 9 / 5 / 4
- Affondo (come il Lanciere).
- Raffica: ATT ×0,7, gittata 2–4, a distanza, spinta di 1 casella.
- Picchiata (come il Lanciere).
- Passiva *Turbine*: le spinte che infligge spostano di 1 casella in più.

**Faro** (Lucigeni) — 46 / 5 / 3 / 15 / 7 / 3 / 2
- Luce calda (come il Lanternaio).
- Bagliore: MAG ×0,7, gittata 2–4, area di raggio 1, 30% di probabilità di Stordito per 1 turno.
- Cura (come il Chierico).
- Passiva *Fiaccola*: +20% alle cure.

**Torre** (Pedine) — 64 / 12 / 8 / 3 / 4 / 3 / 1
- Colpo (come il Guerriero).
- Arrocco: scambia di posto con un alleato, gittata 1–3.
- Passiva *Bastione*: +15% DIF.

**Lampo** (Sprite) — 42 / 13 / 3 / 4 / 11 / 5 / 3
- Taglio rapido: ATT ×0,7, mischia.
- Sdoppiamento: nessun danno, su sé stesso, applica Scudo per 2 turni.
- Passiva *Frame perso*: +10% schivata, che si somma al tratto Sfarfallio.

**Corruttore** (Glitch) — 40 / 4 / 2 / 15 / 6 / 3 / 2
- Bit marcio: MAG ×0,7, gittata 2–4, area di raggio 1, applica Spezzato per 2 turni.
- Inversione: scambia di posto con un nemico, gittata 1–4.
- Passiva *Instabilità*: +15 punti percentuali alle probabilità degli stati che applica.

Le classi esistenti non cambiano.

## Effetti in battaglia

### Stati

Un'unità può avere più stati diversi. Lo stesso stato applicato di nuovo non si somma: riparte dalla durata più lunga. La durata scende di 1 alla fine di ogni turno dell'unità che lo porta.

| Stato | id | Effetto |
|---|---|---|
| Veleno | `poison` | perde l'8% dei PV massimi a inizio turno, almeno 1 |
| Rigenerazione | `regen` | recupera l'8% dei PV massimi a inizio turno |
| Stordito | `stun` | salta il turno |
| Radicato | `root` | non può muoversi, può agire |
| Forza | `atk-up` | ATT +20% |
| Scudo | `def-up` | DIF +30% |
| Indebolito | `atk-down` | ATT −20% |
| Spezzato | `def-down` | DIF −30% |

Nessuno stato cambia la VEL: l'ordine di turno è fisso per tutta la battaglia, quindi un buff alla VEL non avrebbe effetto.

Il veleno può mandare KO. Il KO da veleno non dà XP a nessuno.

### Aree d'effetto

- Un'azione ad area ha `area: { radius }`. L'area è un rombo: tutte le caselle a distanza di Manhattan ≤ raggio dalla casella bersaglio.
- Il bersaglio è una casella nella gittata, anche vuota.
- Colpisce le unità vive nell'area che corrispondono a `targets` (nemici o alleati). In questa versione non c'è fuoco amico.
- Lato e altezza si calcolano per ogni unità colpita, dalla posizione di chi agisce.
- XP: `XP_ACTION` una volta per azione, `XP_KILL` per ogni KO.

### Spinta e caduta

- La spinta sposta il bersaglio di N caselle nella direzione da chi attacca a chi è colpito. Con una diagonale esatta si usa `facingToward`.
- Si ferma prima di una casella fuori mappa, non calpestabile, occupata, o più alta di `MELEE_REACH` rispetto alla casella di partenza. Se la spinta si ferma prima di aver percorso almeno una casella, il bersaglio subisce un urto pari al 10% dei suoi PV massimi.
- Se il dislivello verso il basso supera il SALTO del bersaglio, il bersaglio subisce il 10% dei PV massimi per ogni livello di dislivello oltre il SALTO.
- I Corvidi non subiscono danni da caduta. Le Pedine non vengono spinte.

### Teletrasporto

Effetto `teleport`, usato da *Salto di frame* dei Glitch. Bersaglio: una casella calpestabile e libera nella gittata. Conta come azione del turno. Il campo `uses` limita quante volte si usa per battaglia.

### Scambio di posto

Effetto `swap`, usato da Arrocco (alleato) e Inversione (nemico). Chi agisce e il bersaglio si scambiano le caselle. Non c'è danno da caduta. Le Pedine nemiche non si possono scambiare con Inversione.

### Schivata e probabilità

Schivata (Sprite) e stati con probabilità usano `nextRandom` sul `seed` della battaglia, come la varianza dei danni. Così il server ripete la battaglia e ottiene lo stesso risultato.

## Abilità secondaria e Cristallo di luna

### Regole

- Solo le classi con "Concede secondaria: sì" (le 8 classi base) si possono usare come secondaria.
- Per sbloccare una classe come secondaria di un'unità servono due cose: quella classe al livello 8 per l'unità, e un Cristallo di luna nell'inventario. Lo sblocco consuma il cristallo.
- Lo sblocco è permanente e vale solo per quell'unità. Dopo, il giocatore cambia secondaria quando vuole tra quelle sbloccate, senza costi.
- Un'unità ha un solo slot secondaria. Non può mettere come secondaria la classe attiva.
- In battaglia l'unità ha le azioni della classe attiva più quelle della secondaria. Un'azione presente in entrambe compare una volta sola.
- Le classi riservate seguono la razza anche qui: solo un Torbido può avere il Mago verde al livello 8, quindi solo un Torbido può usarlo come secondaria.

### Da dove arrivano i cristalli

| Fonte | Quantità |
|---|---|
| Negozio | prezzo 1500 oro |
| Campagna | 1 cristallo alla prima vittoria di alcuni capitoli, scelti nei dati del capitolo |
| Missioni giornaliere | l'admin può aggiungere cristalli alla ricompensa |

## Modello dati

Tutto in `packages/core`. Le funzioni restano pure e validano l'input non fidato, perché il server le esegue.

### `races.ts` (nuovo)

```ts
export interface RaceDef {
  id: string;
  name: string;
  /** bonus fissi, sommati dopo la crescita per livello */
  stats: Partial<Stats>;
  trait: { name: string; description: string; mods: Partial<Mods> };
  /** azioni aggiunte dalla razza, es. Salto di frame */
  actions?: ActionDef[];
  /** razza dell'endgame: non compare nelle scelte prima della fine della campagna */
  meta?: boolean;
}
export const DEFAULT_RACE = 'human';
export const RACES: Record<string, RaceDef>;
```

### `classes.ts`

```ts
export interface ActionDef {
  id: string;
  name: string;
  effect: 'damage' | 'heal' | 'none' | 'teleport' | 'swap';
  stat: 'atk' | 'mag';
  power: number;
  minRange: number;
  maxRange: number;
  ranged: boolean;
  /** 'cell' per teletrasporto e aree che possono puntare una casella vuota */
  targets: 'enemy' | 'ally' | 'self' | 'cell';
  area?: { radius: number };
  status?: { id: StatusId; turns: number; chance?: number };
  push?: number;
  /** usi per battaglia; senza limite se manca */
  uses?: number;
}

export interface ClassDef {
  // campi esistenti, più:
  /** razze ammesse; se manca, tutte */
  races?: string[];
  /** la classe si può usare come secondaria */
  grantsSecondary?: boolean;
}
```

Nuova funzione `allowedRaces(classId)`: intersezione tra `races` della classe e `allowedRaces` di ogni classe in `requires`. Così il Cavaliere verde è riservato ai Torbidi perché richiede il Mago verde. Un test controlla che nessuna classe abbia un insieme vuoto.

### `statuses.ts` (nuovo)

```ts
export type StatusId = 'poison' | 'regen' | 'stun' | 'root' | 'atk-up' | 'def-up' | 'atk-down' | 'def-down';
export interface StatusDef { name: string; tickPct?: number; skipTurn?: boolean; noMove?: boolean; stat?: { key: 'atk' | 'def' | 'mag'; pct: number } }
export const STATUSES: Record<StatusId, StatusDef>;
export interface StatusInst { id: StatusId; turns: number }
```

### `units.ts`

- `Mods` riceve i nuovi campi: `magicRange`, `regenPct`, `dodgePct`, `fallImmune`, `pushImmune`, `stunImmune`, `backDamagePct`, `magicDamagePct`, `thornsPct`, `areaBonus`, `pushBonus`, `buffTurns`, `chanceBonus`. I mod del tratto di razza e della passiva si sommano.
- `Unit` riceve `raceId`, `secondary`, `statuses: StatusInst[]` e `uses: Record<string, number>`.
- `createUnit` riceve `raceId` come ultimo parametro (default `human`). Ordine di calcolo: base della classe → crescita per livello → bonus di razza → oggetti → passiva.
- Nuova `effectiveStat(u, key)`: statistica con gli stati applicati. La usano `expectedAmount` e la ricerca del percorso (Radicato porta MOV a 0).
- Nuova `unitActions(u)`: azioni della classe, della secondaria e della razza, senza doppioni. Sostituisce `CLASSES[u.classId].actions` in `battle.ts`, `ai.ts` e nel client.

### `roster.ts` e `player.ts`

```ts
export interface RosterUnit {
  // campi esistenti, più:
  /** se manca: DEFAULT_RACE */
  raceId?: string;
  secondary?: string | null;
  /** classi sbloccate come secondaria con un Cristallo di luna */
  secondaryUnlocked?: string[];
}
```

- `isUnlocked` controlla anche `allowedRaces`. `missingRequirements` resta uguale.
- `applyBattleXp` applica il +10% degli Umani.
- La lettura del roster normalizza `raceId` assente a `human`. Siccome il roster è `jsonb`, non serve una migrazione SQL.
- `UnitChange` riceve `secondary?: string | null` e `unlockSecondary?: string`. `updateUnit` controlla livello 8, `grantsSecondary`, sblocco già fatto, e cristallo libero. Poi scala il cristallo da `inventory`.
- Il Cristallo di luna è un **materiale**, non un oggetto equipaggiabile: nuovo `MATERIALS` in `items.ts` con `id`, `name`, `price`. Condivide `inventory` con gli oggetti. `buyItem` accetta entrambi.

### Missioni e campagna

- `MissionEnemy` riceve `raceId?`. Il server valida che la razza esista e che la classe la ammetta.
- `Chapter` riceve `items?: Record<string, number>`, pagati alla prima vittoria insieme all'oro.
- Tabella `missions`: nuova migrazione in fondo all'elenco di `db.ts`, con `ALTER TABLE missions ADD COLUMN items jsonb NOT NULL DEFAULT '{}', ADD COLUMN recruit jsonb`. `recruit` è `{ name, raceId, classId }` oppure `NULL`. Il server la valida come i nemici.
- `payBattle` aggiunge gli oggetti all'inventario. Se la missione ha una recluta e il roster non ha ancora l'unità con id `m<missionId>`, la aggiunge con 0 XP. L'id fisso rende lo sblocco idempotente.

## Motore di battaglia

Modifiche a `battle.ts`:

- `act`: cerca l'azione in `unitActions(u)`. Controlla `uses`. Per le aree risolve le unità colpite. Applica danno o cura, poi stato, poi spinta, una unità alla volta.
- **Inizio turno**: dentro `advance()`, quando tocca a un'unità, applica nell'ordine Radici (razza) e passiva Muschio, poi Veleno e Rigenerazione. Se l'unità va KO, passa alla successiva. Se è Stordita, emette un evento e passa alla successiva.
- **Fine turno**: in `end`, scala di 1 la durata degli stati dell'unità e toglie quelli a 0.
- `settle()` va chiamato anche dopo i danni di inizio turno, perché il veleno può chiudere la battaglia.

Nuovi `BattleEvent`, che il client anima:

```ts
| { type: 'status'; unitId: string; statusId: StatusId; on: boolean }
| { type: 'tick'; unitId: string; amount: number; statusId: StatusId | 'race' | 'passive' }
| { type: 'push'; unitId: string; path: Pos[]; damage: number }
| { type: 'dodge'; unitId: string }
| { type: 'skip'; unitId: string }
| { type: 'teleport'; unitId: string; to: Pos }
| { type: 'swap'; unitId: string; otherId: string }
```

`combat.ts`:
- `inRange` riceve la gittata extra dai mod (`range` per le azioni a distanza, `magicRange` per quelle su MAG).
- `expectedAmount` usa `effectiveStat` e applica `backDamagePct`, `magicDamagePct`, `healPct`.
- Nuove `areaCells(map, center, radius)` e `pushPath(state, from, target, n)`, condivise da reducer, IA e anteprima nel client.

`ai.ts`:
- Le azioni ad area si valutano su ogni casella nella gittata che ha almeno un'unità entro il raggio. Il punteggio è la somma sulle unità colpite.
- Punteggio fisso per gli stati: Stordito vale come il 30% dei PV del bersaglio, Veleno 3 tick, Radicato e i debuff 10 punti, i buff 8 punti per alleato. Vanno tarati giocando.
- Spinta: bonus pari al danno di caduta o di urto previsto.

## Client

- **Sprite**: nuovo percorso `units/<raceId>/<classId>/<dir>.png`. Gli Umani usano i file attuali in `units/<classId>/`. Se un file di razza manca, si usa quello della classe: si controlla con `textures.exists(key)` dopo il caricamento, e il loader ignora gli errori di file mancanti. `BattleScene` carica solo le combinazioni presenti nella battaglia, non tutte: 7 razze × 20 classi × 4 direzioni fanno 560 immagini. Gli sprite di tutte le combinazioni vengono generati a parte; il fallback serve finché non ci sono tutti.
- **Caserma**: razza e tratto nella scheda dell'unità. Le classi di altre razze compaiono bloccate con il motivo ("Solo Torbidi"). Nuovo slot secondaria: si vede dalla prima classe concedibile al livello 8 e ha il pulsante "Usa Cristallo di luna".
- **Negozio**: il Cristallo di luna in una sezione materiali.
- **Battaglia**: icone degli stati sopra le unità con i turni rimasti. Anteprima dell'area e della direzione di spinta quando si punta una casella. Le azioni della secondaria nel menu, separate da quelle della classe attiva.
- **Admin missioni**: razza per ogni nemico, filtrata per classe. Campo per i cristalli in ricompensa. Recluta opzionale: nome, razza e classe tra quelle ammesse per la razza.
- **Fine battaglia**: la schermata dei risultati annuncia la recluta quando entra nel roster.
- Ogni evento nuovo ha un suono (`sfx.ts`): stato applicato, tick di veleno, spinta, caduta, schivata.

## Fasi

Ogni fase si chiude con `pnpm test` e `pnpm typecheck` verdi e si può rilasciare da sola.

1. **Razze.** `races.ts`, razza nel roster e nei nemici, bonus e tratti senza effetti di spostamento (Versatili, Radici, Lanterna, Sfarfallio). Normalizzazione dei vecchi salvataggi. Caserma e sprite con fallback.
2. **Motore effetti.** Stati, buff e debuff, aree, spinta, caduta, teletrasporto, scambio. Eventi, anteprime e animazioni nel client. IA. Tratto Piume.
3. **Nuove classi e reclutamento.** I dati delle 11 classi nuove delle razze folk, `races` e `allowedRaces`, sprite. Alleati di altre razze in campagna e reclute nelle missioni giornaliere.
4. **Secondaria e Cristallo di luna.** Materiali, negozio, sblocco e slot, ricompense di campagna, migrazione delle missioni.
5. **Razze meta.** Capitoli dopo la battaglia finale, che sbloccano un alleato Pedina, uno Sprite e uno Glitch, con le loro classi Torre, Lampo e Corruttore. Dipende dalla battaglia finale, che oggi manca.

## Test

In `packages/core`, con vitest:

- Statistiche: ordine di calcolo con razza, oggetti, passiva e stati.
- `allowedRaces`: le ibride ereditano la razza, nessuna classe resta senza razze ammesse.
- Roster: un roster senza `raceId` si legge come Umano. Una classe di un'altra razza viene rifiutata.
- Stati: durata, refresh senza somma, KO da veleno, turno saltato, Radicato.
- Area: unità colpite, nessun fuoco amico, XP.
- Spinta: blocco, urto, caduta, Corvidi senza danno da caduta, Pedine immobili.
- Determinismo: la stessa sequenza di azioni con lo stesso seed dà lo stesso stato, anche con schivate e stati con probabilità.
- Secondaria: requisiti, consumo del cristallo, nessun doppio consumo, azioni unite senza doppioni.
- Scambio: alleato, nemico, Pedina nemica rifiutata.
- Recluta: entra alla prima vittoria, non si duplica alle vittorie successive.

## Domande aperte

- **Numeri.** Tutti i valori di questo documento vanno provati in partita, a partire dal Veleno all'8% e dai bonus del 20–30%.
