# Navigazione persistente e Ricordi scalabili

Checkpoint locale: 8 ottobre 2026, candidato PWA **v51**. Non pubblicato.
La produzione resta sulla versione funzionale Auth/RLS v50 già collaudata.
Nessuna modifica a DB, dati, formule, Auth/RLS, trasporto Realtime o algoritmi
Match. Il reset in showLanding riguarda solo stato UI e modali.

## Navigazione

Un solo nav responsive con Home, Match, Ruota, Lista, Ricordi: fisso in basso
sotto 768 px, integrato visivamente sotto l'header sticky da 768 px.
Tema e Aggiungi restano nell'header insieme a identità/logout; Calendario
resta nel collegamento Home. Calendario non viene etichettato come Lista attiva.
Altezza dell'header misurata dopo aggiornamento badge e al resize per evitare
sovrapposizioni desktop. Bottom nav con spazio riservato e safe-area.

aria-current e indicatore di colore/bordo identificano la destinazione attiva;
Match disabilitato offline. Reselezionare la stessa destinazione scorre a inizio
vista, senza ripetere enterMatch, track o creare subscription. Gli altri
passaggi delegano a openDashboardHome/openWheelView/setTab; il tab Lista già
selezionato conserva la sottovista. Ricordi apre il modale senza lasciare Match.

## Ricordi

Header del modale sticky; contenuto scorre all'interno. Serate concluse è un
details aperto di default, con Anno → Mese → card. Al primo caricamento con
eventi datati si aprono anno e mese più recenti; altri gruppi sono chiusi.
Ogni gruppo mostra il numero di eventi, inclusi rewatch. Data non registrata
è separata e chiusa. Se non ci sono eventi, rimane il messaggio esistente.
Regole night.date/completed_at, annullate escluse, protezione sorpresa,
film rimossi, voti N+V e formule dei quattro riepiloghi sono conservati.

Dopo il film è chiuso di default, senza gruppi alfabetici o date inventate.
Stesso ordinamento per titolo e stessi voti/testi condivisi; 10 elementi generati
inizialmente, Mostra altre ne aggiunge 10. Le righe con solo voto non hanno
controlli vuoti; il testo completo usa un details per film. Recensioni personali
restano nelle card/scheda, senza fusioni o cambi al modello dati.

Lo stato vive soltanto in memoria: sezioni aperte, anno/mese, testi e limite
Mostra altre sopravvivono a chiusura/riapertura e rerender Realtime. showLanding
lo resetta all'uscita/lock Auth. Nessun localStorage aggiunto.
Prima di ricreare il contenuto si acquisisce lo stato DOM perché toggle è
asincrono; eventi di nodi già rimossi sono ignorati. Focus ripristinato tramite
ID stabili senza scroll automatico. Mostra altre porta focus al primo elemento
aggiunto. Il modale rende inerte appRoot, confina Tab/Shift+Tab e restituisce
focus al trigger alla chiusura; Esc usa lo stack modali esistente.

## Componenti

- index.html e css/style.css: nav, safe-area, dettagli e modale.
- js/ui/navigation.js e js/ui/render.js: destinazione attiva e handler esistenti.
- js/ui/render/memories.js: stato temporaneo, gruppi e rendering limitato.
- js/ui/modals.js e js/main.js: focus/inert e reset della presentazione.
- service-worker.js: cache candidata v51; precache invariato.

## Verifiche locali

- Smoke **400/400**, Auth **43/43**, RLS PostgreSQL locale **40/40**, PWA **15/15**.
- Chromium Auth **18/18**, nuovo UX browser **20/20** con SDK/DB simulati.
- Liste lunghe e nav a 320/390/768/1280 px; reselect, header sticky,
  accordion, 10→20 recensioni, rerender, focus/scroll, tastiera, offline Match,
  Calendar entry, Presence/canale persistente e logout.
- Programmazione/Cinema/Ricordi a 320/390/768; recensioni N/V 320/390.
  Screenshot ispezionati, zero errori JS/overflow. Sintassi **52/52** e diff check.

```sh
node scripts/verify-ux-browser.cjs --playwright=/percorso/node_modules/playwright
```

Nessun accesso Supabase live nei test. Restano da collaudare bottom nav,
safe-area nativa, aggiornamento PWA v51 e interazione condivisa sui due
telefoni dopo un futuro push/deploy autorizzato. I gruppi serate collassati
mantengono le card nel DOM; non è stata introdotta paginazione delle serate.
