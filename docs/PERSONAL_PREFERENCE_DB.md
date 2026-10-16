# Explicit Personal Preference — contratto DB Phase 2

## Stato corrente — release v62

Schema Personal Preference live verificato e client/store/UI v62 rilasciati.
Al sanity check read-only la preference live risultava N=1, V=0. Le preference
live esistenti sono dati reali e non devono essere azzerate da cleanup, restore
o reimport. Rating valido domina preference; rimuovere il rating lascia Unknown,
senza resuscitare preference precedente. Prima di modificare preference,
aggiornare i client/PWA rimasti a versioni precedenti a v62. Non si assume qui
che entrambi i dispositivi siano stati verificati aggiornati.

Le sezioni Phase 3–4.5 più sotto sono **HISTORICAL checkpoint notes**: frasi
come “NOT DEPLOYED”, “DO NOT COLLECT” e conteggi dei test descrivono lo stato al
checkpoint indicato, non il rollout corrente.

**DB INSTALLED + LIVE VERIFIED**, applicazione manuale confermata dall’utente.
POST indipendente del 13 ottobre 2026, 13:37:10 UTC: dati 10/10, schema 6/6,
funzioni 5/5 PASS; fingerprint PRE/POST identici, sicurezza/FK invariate, zero
orphan e tutti i nuovi campi NULL. Non rieseguire la migration.

**HISTORICAL — checkpoint DB/Phase 3.** In quel momento lo Store/API era
compatibile, ma UI e consumer non erano ancora rilasciati. Il rollout v62 e lo
stato corrente sono descritti sopra; Recommendation Core e consumer sono
documentati in [RECOMMENDATION_ENGINE](RECOMMENDATION_ENGINE.md).

## Artifact

- [Migration incrementale](../database/supabase-migration-personal-preference.sql)
- [Audit read-only PRE/POST](../database/supabase-audit-personal-preference.sql)
- [Rollback esclusivamente pre-uso](../database/supabase-rollback-personal-preference.sql)
- [Test DB sintetici](../scripts/verify-personal-preference-db.js)

Non rieseguire Individual/Rewatch, Auth cutover o altre migration storiche.
La candidata è stata confrontata con lo schema live mediante il gate PRE;
l’esito POST sopra registra la successiva verifica indipendente dell’installazione.

## Persistenza e invarianti

Su `movies`, senza default e senza backfill:

| Colonna | Tipo | Significato |
|---|---|---|
| `personal_liked_n` | boolean nullable | TRUE Like, FALSE Dislike, NULL Unknown di N |
| `personal_liked_v` | boolean nullable | TRUE Like, FALSE Dislike, NULL Unknown di V |
| `personal_liked_updated_at_n` | timestamptz nullable | Ultimo cambiamento della dichiarazione manuale N |
| `personal_liked_updated_at_v` | timestamptz nullable | Ultimo cambiamento della dichiarazione manuale V |

I quattro campi partono NULL per tutte le righe esistenti. Nessuna derivazione
da seen, rating, review, Together, votes o Match. La polarità dei rating non è
materializzata. Restano validi NULL e rating 0–10 con al massimo un decimale.

CHECK strutturali separati N/V:

- `movies_personal_feedback_n_exclusive` / `_v_exclusive`: rating NULL oppure preference NULL.
- `movies_personal_preference_n_timestamp` / `_v_timestamp`: preference e timestamp entrambi NULL oppure entrambi non NULL.

Seen non partecipa ai CHECK: feedback con seen=false è valido. Undo seen preserva
rating, review, preference e timestamp. FALSE è un valore presente, non assenza.

## Scritture e ordine dei trigger

API prevista: UPDATE diretto su `movies`, con ownership `app_person()` e guard
esistenti. Nessuna nuova RPC personale.

`clear_personal_preference_for_rating()` è SECURITY INVOKER, search_path vuoto,
non eseguibile direttamente dai client. È chiamata da:

1. `movie_personal_rating_n_before`: BEFORE UPDATE OF `seen_rating_n`;
2. `movie_personal_rating_v_before`: BEFORE UPDATE OF `seen_rating_v`;
3. `movie_watch_guard`: guard finale INSERT/UPDATE/DELETE.

PostgreSQL ordina i trigger dello stesso tipo per nome. Questi nomi garantiscono
che la normalizzazione rating preceda la guard; preflight e test verificano
l'inventario e l'ordine. Non aggiungere altri BEFORE trigger senza nuova review.

Qualsiasi UPDATE che include la colonna rating propria cancella preference e
timestamp, anche NULL→NULL e anche se il payload include una preference propria.
Targeting della colonna rating altrui è rifiutato anche se il valore è invariato.
Una preference-only non NULL con rating presente fallisce il CHECK: il rating
non viene cancellato. La rimozione del rating lascia preference Unknown.

Su INSERT il rating non NULL prevale sulla preference propria; dati personali
altrui sono rifiutati prima della normalizzazione. Su INSERT conta lo stato finale: rating NULL consente preference TRUE/FALSE/NULL.
Non è richiesto distinguere NULL esplicito da campo omesso. La semantica
intenzionale NULL→NULL resta garantita per UPDATE OF, senza nuove RPC.

La guard controlla i campi altrui prima di normalizzare i timestamp. Il client
non può falsificare il timestamp proprio: il valore finale è server-controlled.
NULL→boolean e cambio boolean assegnano `clock_timestamp()`; retry dello stesso
boolean conserva OLD; rimozione e rating operation producono NULL. Il timestamp
non è un ID univoco o un contatore monotono. Scritture non pertinenti lo preservano.

Le protezioni DELETE/identity includono anche la preference altrui FALSE.
Legacy frozen, Together/completed, membership e RPC serate restano protetti.

## TARGET APPROVED — giudizio distinto dalla Lista personale e candidatura

**APPROVED / NOT IMPLEMENTED — 16 ottobre 2026.** Preference è gradimento;
non rappresenta e non deve essere riutilizzata per la nuova Lista personale.
Il [contratto Persona/Gruppo](INDIVIDUAL_WATCH_REWATCH.md#target-approved--product-grammar-e-relation--transition-contract)
elimina il requisito di giudizio per candidare un film già visto. **CURRENT v62**
conserva invece guardie DB/store/UI descritte sotto: non sono state modificate.
Rating/preference/review reali e precedence correnti vanno preservati; un
giudizio può esistere senza visto. L'[Alternativa B](ARCHITECTURE_VISION.md#target-architecture-approved--alternativa-b)
mantiene per ora i campi giudizio v62. Nuove intenzioni e candidature non sono
nuovi segnali di gusto implicitamente approvati.

## Candidatura — CURRENT RUNTIME FACT v62

Solo all'ingresso nella shared list (INSERT o false→true), un film personalmente
visto richiede rating valido **oppure** preference non NULL della persona corrente.
Si valuta NEW dopo normalizzazione. Rating 0, rating neutro, Like e Dislike sono
feedback validi. Dislike non è veto. Errore: `PERSONAL_FEEDBACK_REQUIRED` (22023).
Rimuovere successivamente feedback non espelle automaticamente dalla lista.
Store/error mapping sono stati riallineati nella Phase 3. **HISTORICAL:** al
checkpoint Phase 4 la candidatura UI era stata riallineata nel candidato locale.
**CURRENT — v62 production:** la candidatura richiede feedback personale
sufficiente, cioè un Rating valido **OR** una Explicit Preference non NULL.
Rating 0 e Preference FALSE sono validi; Seen resta indipendente dal gusto.
Questo stato non attesta che entrambi i client N/V siano stati verificati
aggiornati.

## HISTORICAL — gate old client prima della v62

Il client production v61 `savePersonalReview()` in `js/store/viewing.js` include sempre
`seen_rating_*` nel patch, anche per una recensione con rating NULL. Per il nuovo
DB questo è intenzionalmente una rating operation e cancella la preference.

La combinazione migration installata + vecchio client era tollerabile solo prima
della raccolta reale. In v62 il review-only fix e il contratto Preference sono
rilasciati; un client/PWA precedente a v62 non deve essere usato per modificare
Personal Preferences. Le preference live esistenti vanno preservate. La verifica
di aggiornamento di entrambi i dispositivi non è dedotta dalla sola release.

## Procedura PRE/POST — eseguita manualmente per questa migration

1. Eseguire manualmente l'audit read-only PRE con privilegi operatore; conservare
   l'export fuori Git. Verificare tipi/default/nullability, CHECK rating, guard,
   RPC snack corrente, app_person, trigger attivi, RLS, policy e grant.
2. Confrontare le definizioni con le migration repository. Il preflight usa hash
   di corpi funzione e CHECK: anche drift di formattazione/versione PostgreSQL
   può fermarlo. Nessun controllo va aggirato: eventuale differenza richiede review.
3. Coordinare una finestra senza scritture applicative e backup esterno verificato.
   Una discrepanza dal T0 non va automaticamente considerata errore: usare una
   baseline PRE fresca e approvata, senza assumere conteggi live dagli snapshot.
4. Solo con autorizzazione separata, applicare la singola transazione. Lock timeout
   5s, statement timeout 30s; errore → rollback, nessuna modifica parziale.
5. Eseguire l'audit POST. Confrontare fingerprint della proiezione esplicita dei
   **42 campi storici movies**, tutte le movie_nights/completed, sessioni/swipe,
   votes/vetoes; confrontare metriche seen/shared/rating/review, FK, RLS e grant.
   Non confrontare `to_jsonb(movies)` completo dopo aggiunta colonne.
6. Verificare tutti e quattro i nuovi campi NULL; quattro CHECK validati e corrette
   definizioni; helper/trigger nuovi corretti; guard aggiornata; RPC snack e altre
   definizioni/policy/grant invariati. Assenza orphan e sessioni Match vuote sono
   stati validi, non richiedono seed o ricostruzione di dati eliminati.

L'audit restituisce inventari e fingerprint in un JSON, senza testi personali.
`schema_checks` è informativo: non è autorizzazione automatica all'applicazione.

## Rollback

Solo prima di qualsiasi preference reale: backup verificato e conferma esplicita
operatore di pre-uso. Lo script richiede il parametro di sessione
`scorochiatu.preference_rollback_pre_use_confirmed=yes`, verifica guard/helper,
trigger e assenza di preference/timestamp, ripristina la guard storica e rimuove
solo gli oggetti aggiunti. L'assenza attuale di preference non prova assenza di
uso storico: la conferma operatore è necessaria, non va usata dopo feedback reali.

Dopo feedback reali: **DO NOT DROP DATA**. Conservare schema e dati, esportare
feedback fuori Git, fare rollback solo a un client compatibile con il contratto
nuovo. Il vecchio client review-only non è un rollback compatibile.

## Phase 3 — contratto store/API candidato

Al checkpoint Phase 3 il blocker review-only era risolto nel candidato locale,
ma non nel client production v61. Il gate pre-rollout è stato superato con v62;
questa sezione descrive lo stato storico. In questo checkpoint non c’erano UI
Like/Dislike né integrazione Recommendation.

| API/percorso | Mutation personale |
|---|---|
| `savePersonalReview(id, rating, text?)` | Rating operation esplicita: rating presente anche se NULL; testo solo se fornito |
| `savePersonalReviewText(id, text)` | Review-only: solo testo; stringa vuota rimuove |
| `setPersonalPreference(id, person, value)` | Solo preference propria TRUE/FALSE/NULL; mai timestamp |
| `markMovieSeen()` / `undoMovieSeen()` | Seen-only, salvo feedback opzionale inserito intenzionalmente |
| Rimozione evaluation personale | Solo testo usa review-only; voto/both sono rating operations |
| Together | Campi shared/RPC esistenti; nessun rating personale nel patch |

L’API preference restituisce un boolean tramite Promise, richiede identità Auth
corrente e connessione, rifiuta valori ambigui e persona altrui. Un rating valido,
compreso 0, impedisce Like/Dislike manuale senza cancellare automaticamente il
rating; remove preference NULL resta consentito. Nessun dato viene inventato.

I form esistenti registrano valore iniziale, input del rating e generazione Auth.
Review-only non riscrive il voto precompilato, anche se cambia via Realtime mentre
il modal è aperto. Un input rating toccato include il rating anche se ritorna NULL.
Una rating-only non ripassa testo precompilato/stale; un salvataggio senza modifiche
non scrive. Nel form Seen, voto opzionale vuoto resta assenza di rating operation;
la rimozione intenzionale usa il form recensione o l’azione Rimuovi voto.

`MOVIE_SELECT_FIELDS`, letture e risposte INSERT/UPDATE includono i quattro campi.
Mirror legacy missing diventa Unknown/NULL senza write DB; FALSE è preservato.
La firma Realtime normalizza missing e NULL come lo stesso stato e conserva
rilevabili i cambiamenti true/false/null e dei timestamp. Nessun nuovo canale.

UPDATE usa patch ristrette. La risposta DB aggiorna i soli campi scritti e i campi
preference/timestamp propri normalizzati dal server; non sovrascrive altri dati
personali più recenti con la copia completa della risposta. Auth epoch viene
ricontrollata prima di applicare la risposta o salvare il mirror. Rating operation
recepisce la cancellazione preference/timestamp; niente optimistic Like.

La candidatura usa `hasPersonalFeedback()` (rating valido OR preference non NULL),
anche per FALSE, per ingresso Lista, aggiunta di un titolo esistente e import UI.
Valuta lo stato finale: rating NULL intenzionale elimina la preference prima del
controllo. Le protezioni delete/identity comprendono preference/timestamp altrui.

Errori SQL di dati/constraint, guard business note e schema incompatibile sono
rifiuti, non offline/successi locali. `PERSONAL_FEEDBACK_REQUIRED` ha messaggio
business. Solo le guard ownership note vengono distinte dal generico 42501:
Auth/RLS/JWT non riconosciuti come business restano fail-closed attraverso Auth.
`lastMovieMutationError` è volatile e non viene persistito.

Preference non disponibile offline: serve il DB per timestamp e ownership.
Un errore remoto non applica il patch al mirror. Le mutation locali preesistenti
rimangono disponibili nel relativo fallback; review/seen preservano preference,
un rating locale intenzionale la azzera senza inventare un timestamp server.
Il refetch online resta autorevole; non c’è replay automatico dei patch locali.

Import metadata e storico non scrivono preference né fanno backfill. Il mirror
JSON conserva tutti i campi. Non esiste un export runtime ripristinabile del
catalogo da estendere qui: il ticket PNG è un’immagine, non un backup. Un futuro
export/import strutturato dovrà distinguere boolean FALSE e NULL, includere i
timestamp e definire la policy di ripristino dei dati server-authoritative.

Test sintetici store/form/Realtime: `node scripts/verify-personal-preference-store.js`.
Le verifiche browser card includono review-only con Dislike e NULL→NULL intenzionale.
Nessuna mutation automatica o preference reale sul live.

## Test locali e concorrenza

PGlite esegue PostgreSQL in memoria con identità/RLS e dati sintetici; niente live.

```sh
node scripts/verify-personal-preference-db.js --pglite=/percorso/locale/@electric-sql/pglite
```

La suite esercita migration reale, guard, trigger, CHECK, ownership, timestamp,
precedenza, candidatura, percorsi SECURITY DEFINER, atomicità, PRE/POST audit e
rollback. Non usa export personali. Le suite storiche restano inalterate e
verificano le rispettive baseline; la suite nuova verifica il contratto migrato.

Un solo backend PGlite: si provano entrambi gli ordini serializzati, non vera
concorrenza fra connessioni. PostgreSQL serializza UPDATE sulla stessa riga e i
CHECK impediscono stati finali inconsistenti: rating dopo preference la cancella;
preference dopo rating non NULL fallisce. Un test multi-connessione resta da
eseguire in un ambiente PostgreSQL locale dedicato prima di affermare copertura
concorrenza reale. Nessuna nuova politica last-write-wins basata su timestamp.


## Checkpoint Phase 4 — UI candidata locale, UX raffinata dalla Phase 4.5

**HISTORICAL — IMPLEMENTED LOCALLY / NOT DEPLOYED al checkpoint Phase 4.** DB
live già pronto e verificato; la produzione v61 era ancora priva dei fix
review-only Phase 3. Il gate pre-rollout valeva fino alla pubblicazione v62.

Card e dettaglio riusano `viewingStatusHtml()` e il medesimo personal judgment
slot: rating numerico, altrimenti thumb-up/thumb-down, altrimenti controllo
Unknown dell'utente corrente quando visto. Nessuna nuova riga permanente o
secondo badge accanto al rating. Gli indicatori Seen restano esposizione.
I token esistenti `--color-persona-n/v`, anche nelle varianti tema, identificano
l'autore; la direzione del thumb comunica il giudizio. Non si usano colori
verde/rosso per la preference. Il giudizio dell'altro utente è read-only.

Storico è la superficie primaria. Dallo slot si apre un dialogo compatto,
con due scelte da almeno 44 px, `aria-pressed`, focus iniziale, trap Tab/Esc e
ritorno al controllo. Selezionare nuovamente la scelta attiva rimuove il
feedback; le sei transizioni TRUE/FALSE/NULL usano esclusivamente
`setPersonalPreference()`, senza timestamp client e senza ottimismo persistito.
Una sola richiesta per film/persona può essere pending; doppio click/tap è
bloccato. La risposta server e il refetch sono autorevoli, anche in caso di
rating stale. Offline la mutation resta indisponibile. Rating presente disabilita
le scelte categoriche; non viene cancellato automaticamente.

La candidatura propone voto oppure lo stesso dialogo rapido. Per i nuovi titoli
non ancora persistiti, si può salvare in Solo Storico, esprimere il giudizio e
candidare dalla card. Dislike resta feedback valido, non veto.
Rating salva/rimuove intenzionalmente il voto e cancella preference; rimozione
rating torna Unknown senza ripristini. Review-only e Undo Seen conservano il
feedback. Il canale Realtime esistente aggiorna gli slot senza nuovi canali.

Test browser: `scripts/verify-personal-preference-browser.cjs`, Auth/server
sintetici e runtime reale; nessuna scrittura live. Le regressioni Recommendation
restano quelle esistenti: il Core non è ancora riallineato e Match resta invariato.
Runtime modificato: index, CSS, actions/viewing, actions, modals, render/cards,
render. Nessun nuovo asset/script da precachare; il bump della cache/versione e
la verifica dell'aggiornamento dei due client appartengono al futuro release gate.

Verifica locale Phase 4: Personal Preference browser Chromium **193/193** e
WebKit **193/193**, viewport 320/390/768/1280 per N/V; Store **77/77**, DB
**85/85**. Inclusi review-only, rating 0/decimale/rimozione, double tap,
Realtime a dialogo aperto, network/offline/race, sessione scaduta e ritorno
focus dal dettaglio. Regression Recommendation **125/125** senza cambiarne
implementazione o expected output. Nessuna preferenza reale creata sul live.


## Phase 4.5 — contratto UX Personal Judgment definitivo locale

**HISTORICAL — REFINED LOCALLY / NOT DEPLOYED al checkpoint Phase 4.5.** A quel
checkpoint la produzione v61 era invariata e il gate pre-rollout restava attivo
fino alla pubblicazione del client compatibile v62. La nota non descrive lo
stato corrente.

Personal Judgment = **Rating OR Explicit Preference**. Add già visto, Seen da
card/dettaglio, candidatura e modifica personale espongono nello stesso form
Mi è piaciuto / Non mi è piaciuto e input voto, senza wizard obbligatorio.
Together conserva il proprio form senza controlli preference personali.
Il giudizio è facoltativo salvo candidatura Seen senza feedback. Like e Dislike
soddisfano il requisito anche per un nuovo titolo, tramite un solo INSERT.

Digitare un rating valido deseleziona i thumb: rating operation intenzionale,
preference finale NULL. Scegliere un thumb dopo un rating draft svuota il campo e
salva solo la preference, senza UPDATE OF rating NULL. Il rating già persistito
non è sostituito da un tap: i thumb restano disabilitati finché l'utente non
rimuove esplicitamente il voto e salva. Seen/Add su un film esistente consentono
questa rimozione intenzionale; riaprendo il form è possibile dichiarare la
preference. Nessuna vecchia preference riattivata. Testo review-only non include
rating/preference; Undo Seen conserva tutto il giudizio.

Mutation attraverso le API/store Phase 3: updateMovie/insertMovie per patch
combinate Seen/candidacy/review + intenzione finale, API personali esistenti per
rating/testo/quick preference. Nessuna RPC o nuovo persistence path; timestamp
mai inviato. Save bloccato durante pending e lock condiviso film/persona tra i
form personali e il dialogo rapido. Offline preference fail-closed; race rating
rifiutata senza cancellare il voto, refetch autorevole, errori senza PostgreSQL.

Saved rendering = **inline rating OR inline thumb**, nella stessa viewing-scores
row, senza border/background/box del thumb. Font Awesome esistente, scala ottica
thumb 1.15em rispetto al testo, colore persona dai token N/V e varianti tema.
Touch target ≥44px invisibile, focus visibile e label chiara; Unknown mantiene
soltanto una discreta affordance personale per film visti. Seen dots restano
esposizione. Nel form semantic buttons/aria-pressed, rating labelled e alternativa
“oppure”, Tab trap, Escape e pending disabilitato.

Suite dedicata: scripts/verify-personal-judgment-ux-browser.cjs, fixture server e
Auth sintetici, 320/390/768/1280 N/V. Screenshot dei quattro abbinamenti thumb /
rating a 390/1280 verificati fuori repository, con Font Awesome reale caricato.
Nessuno screenshot o preference reale aggiunto al repository/live.
Runtime cambiato: index.html, css/style.css, js/ui/actions.js,
js/ui/actions/viewing.js, js/ui/modals.js. Nessun nuovo asset da precachare;
cache/version bump rinviato al release gate.

Verifica finale Phase 4.5: Personal Judgment UX Chromium/WebKit **256/256**
ciascuna; Personal Preference UI **193/193** ciascuna; Store **77/77**, DB
**85/85**, Smoke **436/436**, Recommendation Phase 5 invariata **132/132**.
Core/store/migration/Match/Auth/PWA preservati; a quel checkpoint nessuna preference live o release.


## Phase 4.5 — consolidamento degli entry point (locale)

**HISTORICAL — NOT DEPLOYED al checkpoint di consolidamento.** Personal Judgment display = Personal Judgment editor entry
point for current user. Lo slot proprio Rating / Like / Dislike / Unknown apre
`addPersonalReview → openReviewFor(id, currentUser) → reviewModal`, con
Preference, Rating e Review nello stesso editor. Il giudizio dell'altra persona
resta uno span read-only. Personal N/V **non è** Together N+V.

Unknown compare discretamente quando esistono Seen personale, completed Together
o Review personale; Rating/Preference già presenti restano accessibili anche
senza Seen. Review-only senza Seen mantiene quindi il proprio accesso completo.
Lo slot inline resta senza box/bordo/background: token persona N/V, icona del
giudizio, stessa scala Phase 4.5 e target minimo 44px. Button semantici, focus
visibile, Enter/Space, trap/Escape; al ritorno si usa lo slot aggiornato oppure,
se è scomparso, il controllo visibile Torna alla home della libreria.

Il dialogo rapido `personalPreferenceModal` e tutti i relativi handler/CSS sono
ritirati: non esistono caller residui. Il lock condiviso film/persona resta nei
form Seen/Add/candidatura/editor personale. Risultato server-authoritative,
review-only con patch testo-only, rating removal senza preference resurrection,
offline preference fail-closed e refetch sul rifiuto/race restano invariati.
Realtime aggiorna gli slot e i campi personali non modificati nel form aperto;
un draft intenzionale non viene sovrascritto.

Gestione > Valutazioni non contiene più righe/pencil/bin personali duplicati.
Le rimozioni personali avvengono nell'editor: svuotare voto e/o testo oppure
ripremere la preference selezionata. I precedenti shortcut di rimozione nel
dettaglio sono preservati. Together Rating (o affordance ellipsis quando
completed/due) apre `addReview → openReviewFor(id, 'both')`; il CTA Together
preesistente nel dettaglio è conservato. In Gestione rimane il cestino N+V,
con Solo voto / Solo recensione / entrambi, perché l'editor condiviso non ha
ancora equivalenza funzionale per la rimozione.

**Limite Together review-only preservato:** il testo senza rating resta
visualizzato, raggiungibile nell'editor e rimovibile dal cestino. Salvare il form
Together continua a richiedere un rating valido; questo cleanup non abilita
edit/save review-only senza rating. Le rimozioni non modificano completed né
le valutazioni personali. Surprise nascosta conserva le guardie e gli slot non
aprono anche il dettaglio della card.

Core Phase 5, DB/migration, Store/API, Match, Auth, Together/Seen semantics e
Realtime architecture restano invariati. Nessun nuovo asset; runtime coinvolto:
index.html, css/style.css, actions/viewing, modals, render, render/cards e
render/detail. Cache/version bump rinviato al release gate. Produzione allora
v61; questa nota è storica e il client compatibile è stato rilasciato in v62.
Nessun test mutativo live in quel checkpoint.

Verifica del consolidamento: Personal Judgment UX **256/256 Chromium e
256/256 WebKit**, Personal Preference UI **136/136 Chromium e 136/136 WebKit**,
Card/Storico **86/86**. Suite adattate dagli entry point duplicati agli inline:
Individual/Rewatch **39/39**, Snack browser **25/25**; restano verificati
campi estranei, completed, ownership e guardie. Store **77/77**, Preference DB
**85/85**, Recommendation **132/132** invariata, Personal/Together **23/23**,
Evaluation removal **22/22**, Auth **82/82 + 43/43 browser**, UX **24/24**,
Pagination **34/34 + 41/41 per motore**, Midnight **36/36 + 19/19 browser**,
Individual/Rewatch DB **65/65**, Snack **14/14**, RLS **40/40**, PWA **18/18**,
syntax **95/95**, Smoke **436/436**. Tutti con dati sintetici/DB locale; nessuna preference live al checkpoint.
