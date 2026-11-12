---
name: Tactics
description: Tattica a turni HD-2D, il campo di battaglia come un diorama al tramonto
colors:
  night: "#15110e"
  umber: "#241b15"
  umber-raised: "#33271e"
  line: "#4a3a2c"
  parchment: "#f1e4c6"
  ash: "#b8a88c"
  brass: "#e0ac4a"
  brass-deep: "#8a6224"
  ember: "#ff8f3a"
  dusk: "#4a6b86"
  dusk-hi: "#9db8cf"
  reach: "#7fd3e6"
  strike: "#ff7a59"
  mend: "#8fe08a"
  team-a: "#4f8cff"
  team-b: "#e8603c"
  hp: "#7cc64a"
  hp-low: "#f2c14e"
  danger: "#e2503c"
typography:
  display:
    fontFamily: "Grenze, Alegreya Sans, serif"
    fontSize: "4.5rem"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-0.005em"
  ui:
    fontFamily: "Alegreya Sans, sans-serif"
    fontSize: "17px"
    fontWeight: 500
    lineHeight: 1.35
  numbers:
    fontFamily: "Jersey 15, Alegreya Sans, sans-serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1
rounded:
  sm: "2px"
  full: "50%"
spacing:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.brass}"
    textColor: "{colors.night}"
    rounded: "{rounded.sm}"
    height: "58px"
  button-action:
    backgroundColor: "{colors.umber}"
    textColor: "{colors.parchment}"
    rounded: "{rounded.sm}"
    height: "60px"
  panel:
    backgroundColor: "{colors.umber}"
    textColor: "{colors.parchment}"
    padding: "12px 16px"
  medal:
    backgroundColor: "{colors.umber}"
    rounded: "{rounded.full}"
    size: "46px"
---

# Design System: Tactics

## Overview

HD-2D: sprite in pixel dentro un mondo con luce moderna. La battaglia è un plastico in miniatura sul tavolo del comandante, illuminato da un sole basso: luce calda in alto a sinistra, ombre fredde. L'audacia sta tutta nel mondo (terreno, luce, colpi). L'interfaccia è luce posata sopra il plastico: più sottile e più quieta del mondo, mai più pesante.

Modi: la battaglia, la caserma, il negozio e l'Officina sono superfici da usare (leggibilità prima di tutto). Titolo e schermata di vittoria sono esperienza: lì si può osare.

## Colors

Base calda e scura, testo pergamena, un solo accento d'ottone per l'azione principale. I colori di Phaser stanno in `src/theme.ts` e rispecchiano le variabili CSS di `src/style.css`: si cambiano insieme.

### Primary
- **Ottone** `#e0ac4a`: azione principale, selezione, unità di turno, cursore a rombo. Il pieno d'ottone è riservato all'azione principale; la selezione è un bordo d'ottone su fondo caldo.

### Neutral
- **Notte** `#15110e` sfondo; **Terra d'ombra** `#241b15` e `#33271e` superfici; **Linea** `#4a3a2c` bordi sottili.
- **Pergamena** `#f1e4c6` testo; **Cenere** `#b8a88c` testo secondario.

### Light
- **Brace** `#ff8f3a`: luce del sole, alone dell'unità attiva. **Crepuscolo** `#4a6b86`: ombre, mai testo. Nell'Officina fa da cornice (bordo, griglia, striscia).
- **Crepuscolo chiaro** `#9db8cf`: etichette e segni dell'Officina ("admin", gruppi, stato bozza). Solo lì.

### Game colours
- **Portata** `#7fd3e6` movimento e caselle di schieramento, **Colpo** `#ff7a59` gittata d'attacco, **Cura** `#8fe08a` gittata di cura.
- **Squadra A** `#4f8cff`, **Squadra B** `#e8603c`.
- **Pericolo** `#e2503c` solo per gli errori.

### Named Rules
- Portata deve restare distinguibile dal blu della squadra A.
- Il rosso non decora: Colpo per l'attacco, Pericolo per gli errori.

## Typography

- **Grenze 800**: logo, Vittoria e Sconfitta, banner del turno, titoli delle schermate. Solo sopra i 28 px. Grenze Gotisch è stato scartato: le maiuscole I, H, U, D diventano ambigue.
- **Alegreya Sans 500–800**: tutta l'interfaccia e i testi.
- **Jersey 15**: solo numeri (PV, statistiche, danni, oro, prezzi). È il filo che lega l'HUD agli sprite.
- Cifre tabellari ovunque.

### Hierarchy
Titolo schermata 40–112 px, nome unità 24 px, testo 17 px, etichette 13–15 px, numeri di danno nel mondo 40 px.

## Layout

- Battaglia: timeline in alto a sinistra, rotazione in alto a destra, banner istruzioni centrato sotto la timeline, scheda unità in basso a sinistra, azioni in basso a destra, previsione sopra le azioni. La camera lascia libere queste zone (`battleInsets` in `BattleScene.ts`).
- Menu: allineato a sinistra sopra la mappa demo viva, sfumata da sinistra. Su telefono il menu va a tutta larghezza con una sfumatura verticale.
- Caserma e negozio: fondo scuro quasi opaco, griglia roster più dettaglio.

### Officina (strumenti admin)
- Area separata dal gioco: nel menu una sola voce "Officina", dopo un filetto, con bordo in crepuscolo e la parola "admin". Mai in ottone: non è l'azione principale.
- Dentro: navigazione laterale (Contenuti: Campagna, Missioni, Mappe, Musiche; Persone: Utenti), striscia fissa "Le modifiche salvate valgono subito per tutti i giocatori", sfondo a griglia tenue in crepuscolo (il tavolo da disegno sotto il plastico).
- Ogni editor: lista a sinistra con ricerca, editor a schede a destra, barra di salvataggio fissa in basso (nessuna modifica / modifiche non salvate / salvato alle HH:MM). Su telefono lista ed editor si alternano.
- Campi con etichetta sopra, unità dentro il campo, aiuto sotto. Azioni irreversibili e cambi di ruolo chiedono un secondo tocco in riga, con il nome dell'oggetto e la conseguenza; niente `confirm()` del browser.
- "Prova" gioca la bozza in locale, senza salvarla e senza ricompense, poi torna all'Officina.

## Elevation & Depth

La profondità viene dalla luce, non dalle ombre dei box.
- Mondo: facce del blocco al 100% (sopra), 86% (sinistra), 60% (destra); ombra portata fredda sulla cima se la colonna verso il sole è più alta.
- Post-processing (WebGL, grafica piena): matrice colore leggera, tilt-shift tenue, vignetta. Niente bloom di Phaser: sul canvas trasparente scurisce e impasta i pixel.
- Raggi di sole: CSS dietro l'HUD (`#game.fx::after`, `#backdrop::after`).
- Pannelli: `rgba(18,14,11,.92)` con ombra morbida `0 10px 30px rgba(0,0,0,.35)`.

## Shapes

Angoli quasi vivi (2 px) su pannelli e pulsanti. Cerchi solo per i medaglioni dei ritratti. Il segno ricorrente è il rombo (cursore della casella, cursore del menu).

## Components

### Buttons
- **Primario**: ottone pieno, testo scuro, smusso leggero, scende di 2 px alla pressione.
- **Azione (HUD)**: pannello scuro con icona SVG sopra l'etichetta, bordo d'ottone all'hover. Disattivato resta leggibile e dice perché ("già fatto", "nessun bersaglio").
- **Voce di menu**: testo cenere senza fondo, rombo d'ottone e testo pergamena all'hover o al focus.

### Medals
Ritratto ritagliato via codice dalla testa dello sprite S (`BattleScene.portrait`), ingrandito in nearest-neighbour, anello del colore di squadra. L'unità di turno è più grande, con anello d'ottone.

### Cards / Containers
Scheda unità: medaglione, nome, classe, barra PV con scia (la parte persa resta chiara 250 ms e poi scende), statistiche in Jersey 15. Previsione: danno atteso, lato, bonus d'altezza, PV dopo il colpo.

### Inputs / Fields
Fondo quasi nero, bordo da 1 px in Linea, bordo d'ottone da 2 px al focus. Errori accanto al campo, con barra a sinistra in Pericolo.

### World
- Tile pixel generate al boot (`src/tiles.ts`), stessa densità degli sprite: 1 texel = 1,25 px di mondo.
- Unità: contorno di 1 px del colore di squadra (`preFX.addGlow`), anello sottile a terra, ombra morbida, respiro a scatti di 1 px.
- Aree d'azione: riempimento tenue e bordo pieno che pulsa. Rombo d'ottone sotto il puntatore, linea del percorso con freccia.

## Do's and Don'ts

- Fai: dai a ogni evento importante un segno visivo e un suono (`src/sfx.ts`, sintetizzati).
- Fai: rispetta `prefers-reduced-motion`; tremolio, pulviscolo, respiro e deriva della camera si spengono.
- Non: tinte sugli sprite (sporcano la pixel art), scale frazionarie sugli sprite, cornici pixel pesanti sull'interfaccia.
- Non: emoji come icone, testo cenere su fondo chiaro, Pericolo per cose che non sono errori.
