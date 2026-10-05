# Transizione dati: film, proiezioni e legacy

5 ottobre 2026. Prima fase implementata, cache PWA `v47`. Nessuna migration
SQL preparata/applicata, cancellazione di dati, modifica ad autenticazione o
Match Live, push o deploy. L'obiettivo finale resta togliere i mirror di
programmazione e il vecchio sistema `votes`; questa fase conserva la
compatibilità e riduce le dipendenze attive.

## Audit del codice e piano

Inventario basato sui moduli caricati da `index.html`, handler HTML, script,
schema/migration e smoke. `movies` resta il contenuto e lo stato di visione;
`movie_nights` è l'evento, con più righe per film e storico dei rewatch.

| Dato/flusso | Letture e dipendenze | Scritture correnti |
| --- | --- | --- |
| `movies.status` | Filtri, contatori/home, card/dettaglio, `viewingState`, Ruota e deck Match; fallback hero/ticket | Aggiunta/import/saghe → watchlist; scelta/proposta serata → tonight; voto/visione condivisa → watched; annullo → watchlist o tonight se rimangono eventi |
| `movie_nights` | `activeNights`/`activeNightForMovie`, pick prossimo/oggi, card/cartellone/hero, calendario, storico, form recensione, ticket; esclusione eventi attivi dal deck Match | Insert quick/proposta, conferma/annullo, completamento e creazione evento per nuova recensione condivisa; modifica snack/luogo e luogo storico |
| `movies.scheduled_date/time` | Fallback `nextMoviePick`, cartellone per film senza alcun evento, fallback card/ticket; l'ordinamento storico del pick usa 21:30 se l'ora manca | Mirror quick NULL; proposta con data/ora; annullo ripristina l'evento restante o pulisce |
| `movies.snack` | Fallback proiezioni/ticket e catalogo `snackChoices` insieme agli snack degli eventi | Mirror quick/proposta/annullo; modifica snack del più recente evento attivo |
| `movies.proposed_by/night_confirmed` | Fallback proiezioni; adattatori mantengono gli stessi nomi per renderer/ticket | Mirror proposta, conferma, annullo; quick usa autore NULL e confirmed false nel film, autore reale e confirmed nell'evento |
| `movie_nights.location` | Proiezioni, form, ticket e storico, distinto per rewatch | Scelta/proposta/modifica dettagli/completamento; modifica recensione aggiorna solo l'evento concluso scelto |
| `votes` | Snapshot opzionale core/mirror locale e API legacy; nessuna vista, statistica o calcolo Match Live lo usa | Solo `castVote`, privo di chiamanti UI: upsert/delete e rilettura; cancellazione film locale filtra lo snapshot, FK DB con cascade |
| `rating/review_text/review_by` su film | Fallback voti e testi storici, stato visione e sort; distinti dai like/dislike | Recensione condivisa mantiene il mirror; recensione personale preserva/aggiorna il mirror del suo autore |
| `watched_by` e `seen_rating_*`/`review_text_*` | Stato visione N/V/N+V, voti decimali, recensioni e riepiloghi | Visione personale con confronto sul precedente watched_by; voto condiviso indipendente dagli eventi |
| `movies.matched` | Segnala metadati TMDb/OMDb non risolti; nessun legame con la celebrazione Match | Risoluzione metadati all'aggiunta/import/retry |

Tutti i mirror sono mantenuti durante la transizione. Le scritture sono
sequenziali, non una transazione tra film ed evento:

- `setQuickTonight`/`proposeNight`: insert evento, poi update film. Se il
  secondo fallisce, l'evento può esistere con mirror non aggiornato; le
  funzioni storiche non propagano quel secondo esito.
- `confirmNight`: update evento, poi flag sul film solo per l'evento corrente
  o fallback senza ID. Un ID esplicito deve corrispondere a un evento attivo.
- `cancelNight`: annulla l'evento preciso, poi ripristina sul film il più
  recente evento restante o pulisce la programmazione.
- `confirmSchedule` in modifica: update snack/luogo sull'evento, poi snack
  sul film solo se è il più recente attivo.
- `confirmReview`/`finishTogetherNightUI`: aggiorna voto/stato del film,
  poi completa l'evento. Modificare una recensione esistente non conclude un
  rewatch né cambia la sua data; senza evento storico il luogo crea una
  serata conclusa con data non registrata.

`proposeMovie`/`acceptProposal`/`rejectProposal` non hanno chiamanti runtime;
solo lo smoke richiama le prime due. `proposeMovie` scrive `proposal`, stato
non ammesso dallo schema attuale: l'API è conservata e isolata, non è il
flusso di proposta di una proiezione. Anche `updateStatus` è privo di chiamanti
UI ed è mantenuto per compatibilità. I test delle API legacy sono mantenuti.

Piano adottato: unificare gli adattatori di lettura, isolare le API obsolete,
rendere `votes` non fatale e separarlo dal render/Realtime corrente, aggiungere
audit aggregato e regressioni. Rimozione di dati/schema e cambiamento delle
scritture restano successivi, subordinati alla verifica dei client e dei dati.

## Cleanup implementato

`nightProjectionFields` converte un evento nei nomi richiesti dalle API UI;
`movieProjection` compone il film con l'evento attivo scelto. NULL e dettagli
rimossi nell'evento prevalgono sul film, senza recuperare vecchi snack/luoghi.
Hero/pick, cartellone, info card e ticket riusano l'adattatore. Il badge data
della card programmata ora usa lo stesso evento delle sue informazioni:
con un mirror divergente non mostra più due date diverse. Markup, copy,
selezione degli eventi, priorità oggi/prossima e azioni restano invariati.

`movies.status` non è derivato dagli eventi: modifica filtri, visioni, Ruota
e Match e richiede una decisione distinta. Il fallback senza evento attivo
resta compatibile con i dati storici. In particolare `nextMoviePick` può
ancora leggere un mirror stale se esistono solo eventi chiusi: la semantica
non viene cambiata qui; l'audit segnala il caso. Il cartellone continua a
escludere il fallback per qualsiasi film con almeno un evento.

`js/store/legacy.js` conserva like/dislike e proposte obsolete, con le stesse
API. `votes` resta una lettura opzionale a ogni fetch core e un mirror
`scorochiatu_votes`; errori REST/query rifiutate mantengono lo snapshot o la
cache valida. Una cache legacy corrotta non blocca più il caricamento offline
di film e serate. `votes` esce dalla firma del render e dal canale core, che
ora ascolta movies/vetoes/movie_nights. Le API legacy continuano a rileggere
votes dopo le proprie scritture; il nuovo client non ne segue autonomamente
gli eventi Realtime. I vecchi client e la pubblicazione DB restano compatibili.
Nessuna modifica ai canali/sessioni/swipe/presence del Match.

## Audit reale e limiti delle migrazioni

`node scripts/audit-data-model.js --live` usa esclusivamente GET paginati;
output aggregato senza titoli, ID, chiavi o PIN. Supporta anche
`--file=fixture.json` con array `movies`, `movie_nights` e `votes` opzionale.

Lettura live del ciclo: **94 film** (93 watchlist, 0 tonight, 1 watched),
**30 eventi** (29 cancelled, 1 completed, nessuno attivo), **1 voto legacy**.
Zero programmazioni legacy senza evento, mirror di eventi chiusi ancora
programmati, snack presenti solo sul film, orfani o date/conferme mancanti
rilevati dai conteggi. La lista iniziale di 131 titoli è storica.

Non ci sono eventi attivi nell'istantanea: il conteggio zero dei conflitti
attivi non dimostra il dual-write live. Le query non costituiscono uno
snapshot transazionale e l'audit non certifica altri dispositivi o copie
offline. L'assenza di record da migrare oggi non autorizza a eliminare campi
ancora scritti dai client attuali o a cancellare il voto legacy esistente.

Prima di un futuro backfill/drop occorre verificare adozione dei client,
copie locali, archivio/backup del legacy e assenza di dipendenze residue.
Per i quick pick senza timestamp non inventare confirmed_at o la data della
visione; autore/conferma dei mirror storici possono essere ambigui. Più eventi
attivi sono supportati oggi: nessun vincolo UNIQUE per film viene introdotto.
La rimozione di votes richiede anche la pubblicazione Realtime DB e le API
di compatibilità; nessuna modifica SQL in questo ciclo.

## Verifiche

- Baseline 379/379; prima suite dopo adattatori/isolamento 389/389;
  suite finale **391/391**. Dodici regressioni aggiunte per precedenza evento,
  NULL, rewatch, badge coerente, fallback, votes opzionale, errori core,
  cache corrotta, render silenzioso e audit senza mutazioni.
- Service worker **15/15**, sintassi JS completa e diff check PASS. Nuovo
  modulo incluso nell'ordine HTML e nel precache `v47`.
- Chromium con fixture: proiezioni, snack/luogo, Streaming/Cinema e Ricordi a
  320/390/768 px; recensioni N/V a 320/390 px. Zero errori JS/overflow,
  screenshot rappresentativi ispezionati; script/browser in directory temporanee.
- Confronto baseline: **343 funzioni esistenti conservate**, **144 scenari DOM
  identici** sui dati coerenti (N/V, streaming/cinema, vuoto/fixture, sei tab e
  tre viste). Regressione del mirror divergente coperta da test dedicato.
- Le verifiche locali non sostituiscono l'uso condiviso su due telefoni dopo
  un eventuale deploy. Nessuna scrittura al database reale.
