# Individual Watch Status, Storico e Rewatch — v54 production / v55 locale

Checkpoint 9 ottobre 2026: v54 pubblicata al commit
`7855c16cae940c4f1b9a3d4267cc9c0db95c9107`, cache production v54.
Migration applicata integralmente una sola volta dall’utente, audit
pre/post 24/24 e confronto integrale checkpoint tutti true.
Verifica HTTP v54 PASS; primo uso reale backend/caricamento positivo,
con problemi UX affrontati dalla v55. Non è un collaudo completo v54/v55.
La v55 è frontend locale, cache v55; nessun commit/push/deploy v55.
Le protezioni DB v54 restano invariate e non vanno riapplicate.

## Contratto

L'identità personale proviene da Supabase Auth → `app_members` → `app_person()`.
N può modificare solo il proprio stato visto, voto e testo; V solo i propri.
La conclusione di una serata resta condivisa ed eseguibile da uno dei membri,
senza doppia conferma e senza voto obbligatorio.

Schema applicativo aggiunto a `movies`, esclusivamente:

```sql
seen_n boolean NOT NULL DEFAULT false,
seen_v boolean NOT NULL DEFAULT false,
in_shared_list boolean NOT NULL DEFAULT false
```

Nessun `watched_together`, `legacy_seen`, enum o nuova tabella applicativa.
Le tabelle `app_watch_backup.checkpoint/grants`, create dalla migration v54, sono un
backup privato dell'operatore per il rollback, fuori dal modello runtime.
Non sono accessibili ad anon/authenticated né aggiunte alla publication.

Predicati canonici in `js/store/viewing.js`:

- together: esiste un evento dello stesso film con `status='completed'`;
- Rewatch: `seen_n && seen_v && !together`;
- Candidatura: `in_shared_list`, indipendente dagli stati personali;
- Lista disponibile: candidatura e assenza di together ed eventi proposed/confirmed;
- Storico N/V: rispettivo seen=true, anche per candidati e film together;
- Ruota/nuovo Match: Lista, escluso cinema e veto della settimana;
- Rewatch mostra anche i film In gioco e quelli programmati;
- pallini N/V originali: colore personale dai seen quando non together;
  con together entrambi oro, senza modificare gli stati personali.
  Nessun terzo badge o etichetta visibile Together.

Un booleano personale false significa assenza dello stato personale visto, anche
quando esiste una visione insieme. Voti e testi non dichiarano una visione.
`movies.status` è una proiezione operativa: evento attivo → tonight;
altrimenti together → watched; altrimenti watchlist. Non prova together.

## Snapshot del cutover v54 e backfill applicato

I conteggi sono stati forniti dall'utente dopo audit live, non verificati
nuovamente dall'agente. 94 film, 3 completed e 31 cancelled; nessuna evidenza
legacy-only insieme né incoerenza film/eventi. Voti: 13 N, 0 V, 3 condivisi.

| Gruppo | Numero | seen_n | seen_v | in_shared_list |
|---|---:|---|---|---|
| Watchlist senza marker | 79 | false | false | true |
| Watchlist watched_by=N, nessuna recensione legacy | 12 | true | false | true |
| Visti insieme, tutti con completed | 3 | false | false | false |

Dopo backfill: 12 seen_n=true, 0 seen_v=true, 3 together, 0 Rewatch iniziali, 91 candidati.
I 3 film condivisi sono riconosciuti dagli eventi e hanno indicatori oro.
Tutti i voti moderni, tutti gli eventi e tutte le colonne legacy si conservano.
Fallback voto 1–5 × 2 e testo legacy si materializzano soltanto su un campo
moderno NULL e con autore certo; un testo moderno vuoto resta vuoto.
La migration non crea eventi sintetici né date retroattive.

SQL applicato dall’utente una sola volta: `database/supabase-migration-individual-rewatch.sql`.
Transazione unica e lock movies/movie_nights; preflight del preciso audit
94/79/12/3 e 34/3/31, voti e mapping N/V. Se i dati sono cambiati o esiste già
il checkpoint, si ferma: fare un nuovo audit e aggiornare il candidato,
non rimuovere le guardie. Snapshot prima/dopo e grant originali sono salvati
privatamente nel database durante il cutover v54 concluso.

## Protezioni DB v54 applicate; v55 invariata

Le RLS membership esistenti restano attive; non rieseguire Auth cutover.

Un trigger BEFORE INSERT/UPDATE/DELETE su movies:

- ricava la persona da Auth, rifiuta chiamanti senza membership;
- INSERT accetta solo il proprio tripletto seen/rating/text; rifiuta campi
  personali dell'altro anche se arrivano da un payload arbitrario;
- UPDATE confronta il tripletto dell'altro con IS DISTINCT FROM: anche NULL,
  rimozioni, payload misti e upsert sono protetti, con rifiuto atomico;
- congela watched_by/rating/review_by/review_text e rende immutabile id;
- DELETE e cambio tmdb_id negati se esiste uno stato personale visto, voto o testo
  dell'altro, oppure qualsiasi movie_nights, incluse cancelled;
- voto/testo condiviso modificabili soltanto con completed autorevole;
- normalizza solo status; cambiare seen non modifica la candidatura;
- candidato all’INSERT o UPDATE candidatura false→true: se il chiamante
  ha il proprio seen=true, richiede il suo voto valido (zero ammesso).
  Requisito temporale, non CHECK permanente: un voto può essere rimosso
  dopo la candidatura; dichiarare seen su candidato non richiede voto.

Una RPC `manage_movie_night` con parametri nominati espliciti:
propose, quick, confirm, cancel, complete, complete_now, edit.
SECURITY DEFINER con search_path vuoto, oggetti qualificati, membership
controllata internamente ed EXECUTE solo authenticated. Il client non sceglie
autore/timestamp né invia patch arbitrarie. Blocca film prima dell'evento,
verifica movie_id/night_id e transizioni, aggiorna evento e proiezione nella
stessa transazione. Il ruolo proprietario è quello dell'operatore SQL.

INSERT/UPDATE/DELETE diretti su movie_nights sono revocati anche a livello
colonna; TRUNCATE revocato su entrambe le tabelle. SELECT/RLS/Realtime e le
altre tabelle conservano il contratto esistente. Complete/cancel/confirm
sono idempotenti sugli stati ammessi; completed non riapribile, cancellabile
o riassegnabile dal client. Edit completed modifica il luogo, non data/snack.
Le conclusioni non programmate senza evento riutilizzano il completed già
presente per i retry; rewatch successivi creano un evento tramite Oggi/Programma.

La protezione vale per i membri applicativi. L'operatore amministrativo può
modificare schema/trigger: non è un'identità disponibile al frontend.
Nessun service-role, nuovo account o cambio a app_members nel client.

## Frontend

- Dopo TMDb: Hai già visto questo film? No → candidato senza voto.
  Sì → Solo Storico (voto facoltativo) / Anche alla Lista (proprio voto
  obbligatorio all’ingresso). Nessuna recensione/data/serata obbligatoria.
- Ricerca/Add mostrano chi ha già visto il film e se è in Lista; nessuna copia
  privata o tabella personal_movies. N/V leggono gli stessi dati.
- Solo Storico su candidato registra soltanto i propri personali e conserva
  la candidatura; UI esplicita. Stati Storico N/V sovrapponibili alla Lista.
- Film storico candidato dalla card: voto mancante richiesto nel modale,
  voto e candidatura salvati atomicamente; Togli modifica solo candidatura.
- Su film già presente: No non cancella dati; Sì salva i propri dati e la candidatura soltanto se richiesta.
  UNIQUE concorrente recupera l'esistente senza crearne una copia offline.
- Stato visto, voto e recensione sono indipendenti. **Segna come non visto**
  rimuove solo il proprio seen; conserva voto, testo, candidatura, eventi e
  Together. La conferma chiede “Vuoi segnare questo film come non visto da te?”.
  Rimozioni del voto/testo sono esplicite. È possibile
  modificare un testo conservato anche dopo aver rimosso il voto.
- Rewatch ha Rimetti/Togli, badge In gioco, Oggi e Programma; toggle disponibile
  anche nel dettaglio. Un appuntamento sospende il pool senza modificare la candidatura.
  Quando anche l’altro utente segna come visto un candidato, questo diventa
  Rewatch · In gioco se non esiste together, senza
  espulsione automatica e senza voto obbligatorio.
- Annullamento conserva storico e ripristina la classificazione derivata.
- Completa serata aggiorna lo specifico evento senza voto e senza scrivere
  stati o voti personali. Consuma in_shared_list=false atomicamente
  solo alla nuova conclusione: retry su completed conserva una successiva
  ricandidatura. Identica garanzia per complete_now; il ramo locale replica
  il contratto, il client remoto rilegge il film autorevole dopo la RPC.
  Il film entra nei Ricordi ed esce da Rewatch.
- Ulteriori visioni di un film condiviso usano nuovi eventi; non torna tra i
  film ancora da vedere insieme.
- Saghe candidano anche capitoli noti fuori Lista; voto mancante richiesto
  attraverso lo stesso modale. Import UI candida duplicati ammissibili;
  quelli visti senza voto sono segnalati per candidatura dalla card.
  CLI di manutenzione aggiunge nuovi candidati, conserva l’arricchimento
  non distruttivo degli esistenti e non è stata eseguita.
- Ruota e Lista usano il predicato comune. Match aperto salta film esclusi,
  senza cancellare swipe o riscrivere la percentuale/storico. pendingMatch
  resta la fonte della celebrazione; Continua e matched_movie_id invariati.
- Nessuna lettura/scrittura dei marker legacy nel nuovo percorso; programmazione
  resta solo movie_nights, tutte le scritture passano dalla RPC.
- Errori remoti non producono salvataggi fittizi nel mirror; errori Auth/RLS
  chiudono l'accesso invece di diventare successi offline. Pending Add azzerato
  al logout e protetto dalla generazione Auth contro risposte tardive.

Moduli modificati nella v54 (inventario storico): store/viewing, movies, nights e campi SELECT; filters,
wheel, match; Add e azioni viewing/nights; card/dettaglio/proiezioni/Ricordi,
libreria/navigazione/Home; index/modali/main e SW. Nessun framework o backend.

## Verifiche finali locali v55

Comandi locali (dipendenze PGlite/Playwright disponibili fuori dal repository;
passare --pglite=/percorso e --playwright=/percorso):

```text
node scripts/smoke.js
node scripts/verify-auth.js
node scripts/verify-auth-rls.js --pglite=/percorso
node scripts/verify-individual-rewatch-db.js --pglite=/percorso
node scripts/verify-sw.js
node scripts/verify-auth-browser.cjs --playwright=/percorso
node scripts/verify-ux-browser.cjs --playwright=/percorso
node scripts/verify-individual-rewatch-browser.cjs --playwright=/percorso
node --check (tutti i file JS/CJS di js e scripts)
git diff --check
```

La suite smoke conserva i 400 casi precedenti adattando le fixture shared
agli eventi completed, e aggiunge i casi della feature e dei tre assi indipendenti.
Le fixture dei film nel pool hanno candidatura esplicita; nessun fallback
nel runtime rende candidati i dati con flag assente. I mock serate
verificano ora la RPC anziché il DML diretto. Nessun indebolimento della
guardia per accettare vecchi payload o far passare i test.

I test DB eseguono SQL reale in PostgreSQL temporaneo PGlite, non regex:
preflight/backfill, conservazione, rollback, ruoli N/V/anon/terzo, INSERT,
UPDATE, DELETE/upsert/payload misti, legacy/identità, grant/TRUNCATE, RPC,
stati terminali, timestamp idempotenti e recensione condivisa atomica.
PGlite usa una connessione: non prova il locking concorrente di due backend
reali. Il smoke verifica patch personali concorrenti e retry idempotenti;
Realtime e i due telefoni reali restano nel collaudo post-cutover.

Browser: Auth/SDK simulati; nuova feature sul mirror locale dopo mapping
Auth verificato nella fixture, a 320/390/768 px, N/V, form minimi, azioni,
conservazione, overflow e zero errori JS. UX esistente anche a 1280 px.
Gli screenshot sono temporanei, fuori dal repository. Il smoke include
letture reali TMDb/OMDb; nessun test scrive Supabase live.

| Suite locale | Esito |
|---|---|
| Smoke (400 precedenti + 36 feature) | 436/436 |
| Auth (43 precedenti + 5 nuovi) | 48/48 |
| RLS Auth esistenti | 40/40 |
| PostgreSQL Individual/Rewatch | 52/52 |
| Service worker | 15/15 |
| Chromium Auth | 18/18 |
| Chromium UX esistente | 24/24 |
| Chromium Individual/Storico/Rewatch | 39/39 |
| Sintassi JS/CJS | 54/54 |
| git diff --check | PASS |

Verifiche esplicite: otto stati canonici, Solo Storico con/senza voto,
candidatura con voto mancante/presente/zero, secondo stato visto su
candidato senza voto, Rewatch In gioco, toggle senza perdita dei personali,
consumo completed, retry dopo ricandidatura per complete e complete_now,
programmazione/annullamento con flag true e false, oro sui due pallini senza modificare i seen,
ownership bidirezionale, dedup TMDb e recupero delle gare, backfill 79/12/3.

In revisione il caso saga concorrente è stato aggiornato a righe complete
con titolo obbligatorio: ora verifica il recupero e la candidatura dei
duplicati comparsi durante fetch e INSERT. Nessuna protezione ridotta.
Match mantiene le verifiche di riconoscimento, Continua, Presence, sessioni
e metriche, con candidatura esplicita nelle fixture dei film nel pool.

Il reset v53 al secondo seen è superato: la candidatura è generale.
Nessuna deviazione dai contratti aggiornati approvati. La ricandidatura
UI dei film together resta futura: Programma/Oggi creano nuovi eventi,
mentre il flag da solo non supera l’esclusione together dal pool normale. In revisione è stato corretto il
puntamento del pulsante Completa serata all'evento mostrato, coperto da un
caso con due appuntamenti dello stesso film. Revoca TRUNCATE e snapshot
privati dell'operatore completano le protezioni/rollback; non aggiungono un
modello applicativo. Dipendenze di test restano in directory temporanee.

Inventario storico della v54 già pubblicata:

- Creati: le due SQL migration/rollback citate; questo documento;
  scripts/verify-individual-rewatch-db.js e verify-individual-rewatch-browser.cjs.
- Modificati: index.html, service-worker.js, README.md, docs/MASTER_CONTEXT.md;
  js/store.js, store/{movies,viewing,nights}.js; js/filters.js, wheel.js, match.js,
  main.js; js/ui/actions.js, actions/{nights,viewing}.js; js/ui/modals.js,
  navigation.js, sagas.js, render.js, render/{cards,detail,library,memories,projections}.js;
  scripts/smoke.js, verify-auth.js, verify-ux-browser.cjs
  e import-movies.js (solo preparazione locale).

Il checkpoint corrente è anche in MASTER_CONTEXT.

## Rollback

`database/supabase-rollback-individual-rewatch.sql` è solo pre-utilizzo:
confronta l'intero catalogo e tutti gli eventi con il checkpoint dopo la
migration. Qualunque differenza di stato rispetto ai checkpoint blocca il rollback. Rimuove guardia/RPC,
ripristina grant e soli campi moderni materializzati; conserva booleani e
backup. Non modifica RLS Auth o publication né ripristina policy pubbliche.
Il checkpoint conservato impedisce di rieseguire lo stesso backfill.

Dopo nuove scritture: mantenere dati/colonne/eventi e usare una correzione
compatibile. Il solo ritorno al vecchio frontend non è sicuro: i marker
legacy sono congelati e non rappresentano più i nuovi stati personali.

## Checklist storica del cutover v54 — migration e pubblicazione concluse

La sequenza sotto conserva il piano approvato della v54, non ordina di
rieseguire migration o deploy. Audit, migration, commit/push e verifica HTTP
sono conclusi; il primo uso reale non attesta tutti i test dei punti 6/9.
Per v55 non serve SQL: eventuale commit/push/deploy richiede autorizzazione.

1. Revisionare il candidato e scegliere finestra coordinata. Nessun deploy
   del frontend nuovo prima delle protezioni DB. Confermare il commit/release
   da distribuire: include anche i refinement locali v52 già presenti.
2. Chiudere app/PWA su entrambi i dispositivi e sospendere scritture. Salvare
   un backup operatore di dati/schema/grant/funzioni, non soltanto CSV.
3. Ripetere audit SELECT, inclusi conteggi recensioni/fallback e privilegi.
   Verificare snapshot atteso 94/34. Se differisce, aggiornare e ritestare
   migration/backfill prima di proseguire; non forzare il preflight.
4. Eseguire solo la nuova migration Rewatch in SQL Editor Supabase come
   operatore. Non rieseguire Auth prepare/cutover, vecchio bootstrap o vecchie
   migration. Verificare commit della transazione e schema cache PostgREST.
5. Verificare READ-ONLY backfill: 94 film totali, 91 con in_shared_list=true
   (79+12), 3 con in_shared_list=false perché già visti insieme;
   12 con seen_n=true, 0 con seen_v=true, 0 Rewatch iniziali;
   34 eventi intatti, voti 13/0/3 e testi conservati;
   trigger, funzione, grant, RLS, assenza di accesso al backup. Publication
   movies/movie_nights/swipe_sessions/swipes/vetoes e Realtime privato invariati.
6. Con nuova autorizzazione ai test live, verificare con JWT dei membri i
   dinieghi N→V/V→N, DML diretto serate, anon/terzo e RPC; usare fixture
   concordate. La normale cancellazione non elimina eventi di test, quindi
   prevedere ripristino amministrativo senza alterare lo storico reale.
7. Soltanto dopo DB verificato: push del candidato autorizzato e deploy Vercel.
   Verificare file runtime e cache v54 sulla release, nessun errore schema/RPC.
8. Riavviare entrambi i client online, aggiornare PWA/app-shell e verificare
   che carichino v54. Rimuovere vecchie schede/runtime; non basta la cache dati.
9. Collaudo N/V su due telefoni: Add No/Sì, Solo Storico/Lista e duplicati; Storico N/V, stato/voto/testo,
   Realtime, Rewatch/toggle/pool, Programma/conferma/Oggi/annullo, conclusione
   da un solo membro senza voto, ulteriori serate e Ricordi; Match/Continua,
   veto/cinema/sorprese/ticket/calendario; JWT, logout e limiti offline.
10. Dopo esito reale positivo aggiornare il checkpoint production-verified.
    In caso di problemi fermare l'uso e applicare rollback pre-utilizzo solo
    se ammesso, altrimenti correzione compatibile che preservi nuove scritture.

Non ripetere i passaggi DB conclusi. Il ciclo v55 modifica solo frontend e documentazione.

## UX finale v55 (locale)

Storico è una destinazione interna autonoma, aperta dal widget Home, non un
modale e non una voce della bottom navigation. Riusa movieGrid e
createMovieCard della Lista, con switch Storico N/V e titoli alfabetici.
Storico N usa `seen_n === true`, Storico V `seen_v === true`.
Le viste dipendono solo dai rispettivi booleani: sovrapposte e indipendenti da
candidatura, Streaming/Cinema, ricerca e filtri/ordinamento Lista.
Ricordi conserva soltanto i suoi contenuti originali: statistiche,
Serate concluse e Dopo il film. Nessuna UI Storico dentro Ricordi.

I badge circolari originali N/V seguono i seen quando non Together; con
Together entrambi diventano oro, dai completed, senza modificare i seen.
Nessun terzo badge/SVG o etichetta visibile aggiuntiva. N+V resta nei voti,
recensioni e azioni condivise. Cache v55, nessuna modifica backend.

Il precedente “Annulla” era l’azione undoSeenUI della card/dettaglio:
conferma e rimuove soltanto il seen del chiamante, conservando voto, testo,
candidatura, eventi e Together.
Resta disponibile con etichetta esplicita “Segna come non visto”.
Non è un pulsante di chiusura o un’azione del contenitore Ricordi.

Verifiche finali della destinazione autonoma: Smoke 436/436, Auth 48/48,
PWA 15/15, Chromium Auth 18/18, UX 24/24, feature 39/39, sintassi 54/54
e git diff --check PASS. Home → Storico, switch N/V, fuori Lista, sovrapposizione,
Together oro, dettaglio/sorpresa/resync, ritorno Home, Ricordi senza Storico e
assenza dei filtri verificati a 320/390/768 px; screenshot ispezionati.
Backend/Auth dei browser simulati, nessuna scrittura o lettura Supabase live.
