# Serate completed — ricordo unificato, cutover privato N/V

Stato: implementato e verificato **soltanto localmente**. Il SQL è una proposta da revisionare, mai applicata al Supabase remoto. Nessun commit/push/deploy, accesso a dati reali o modifica a Discovery/Recommendation.

## Soluzione minima

Si conservano snapshot contract **2**, protocollo comandi **1**, bootstrap e cache esistenti. Non si introduce snapshot 3: il prodotto ha due dispositivi aggiornabili insieme, quindi il nuovo decoder e il writer vengono attivati tramite un cutover coordinato, senza supporto continuativo a v75.

La struttura JSON non cambia. Nel decoder l'invariante `ORDINARY_NIGHT_MEMORY` diventa `COMPLETED_NIGHT_MEMORY`: testo ammesso solo su eventi completed, massimo 1.000 caratteri. Restano tutte le regole retroattive (completed, orario nullo, data non futura). Gli snapshot/cache v2 precedenti con ricordo normale nullo sono un sottoinsieme valido del nuovo contratto; formato della cache, firme e identità del contesto non cambiano. Nessuna cancellazione o conversione della cache è necessaria; una cache non conferisce comunque autorità di scrittura e il runtime richiede uno snapshot online.

**Il vecchio decoder v75 resta incompatibile con un ricordo normale non nullo.** La scelta v2 è consentita dalla decisione di cutover privato, non costituisce compatibilità con vecchi client. Un vecchio dispositivo riaperto dopo il cutover può rifiutare lo snapshot. Il protocollo 1 da solo non identifica la build: serve verificare manualmente entrambi gli aggiornamenti prima di riaprire le scritture.

## SQL preparato

File: `database/20261110012012_completed_nights_memory.sql`, generato come migration locale tramite CLI e mantenuto nel percorso SQL del repository. Nessuna nuova cartella/configurazione Supabase nel progetto.

Prerequisiti: CAP-1 v2 e modifica atomica delle valutazioni già installati, vincolo di forma esistente/validato, runtime TARGET con soglia protocollo 1. L'applicazione è ammessa anche in manutenzione `read_only/1`; lo script non cambia tale modalità e non riapre le scritture. DDL e sostituzione del writer sono nella stessa transazione, con lock/statement timeout limitati.

Il vincolo `movie_nights_cap1_shape` diventa:

```sql
(NOT retrospective OR (status = 'completed' AND time IS NULL))
AND (night_memory IS NULL OR status = 'completed')
```

Il vincolo separato `movie_nights_cap1_memory_length` resta invariato. Non ci sono UPDATE di backfill, nuove colonne, tabelle, RPC, policy, grant o trigger. Nessuna conversione di `retrospective` e nessuna modifica di date, identità o partecipanti.

Il writer privato `cap1_execute_app_command` viene sostituito conservando la versione più recente con valutazione atomica in registrazione. Il nome storico `EDIT_PAST_TOGETHER` è riutilizzato per tutte le completed:

- Verifica evento/film/gruppo e stato completed sotto i lock esistenti.
- Sulle normali rifiuta la **presenza** del campo `date`, anche nullo o uguale al valore corrente.
- Su tutte rifiuta `time`, partecipanti, stato, timestamp ed evaluation nel comando di modifica.
- Accetta snack, luogo e `night_memory`. Campo omesso conserva; testo sostituisce; `null` cancella esplicitamente.
- CAS sullo scope night, incremento solo per variazioni effettive, ricevute immutabili e replay dello stesso request ID invariati. Nessuna versione group_film/person_film viene modificata dal solo ricordo.

`EDIT_NIGHT`, registrazione retroattiva e comandi di conclusione restano semanticamente invariati. Le migration già presenti non sono riscritte. Il wrapper pubblico e le sue ACL restano invariati.

## Client e post-visione

`ActionAdapter.editPastTogether` accetta tutte le completed online v2 e rifiuta localmente la data sulle normali. L'editor CAP-1 già condiviso usa questo comando per snack, luogo e ricordo di ogni completed; mantiene il cambio data solo per le retroattive e non modifica partecipanti. Nel dettaglio il ricordo assente invita ad aggiungerlo anche per le serate normali.

Il flusso implementato nel passaggio precedente resta invariato: completamento autorevolmente confermato, riconciliazione dell'evento esatto, quindi «Com’è andata?». Chiusura/Più tardi non scrive, pending/incertezza non aprono il post-visione. Solo un salvataggio esplicito successivo invia il ricordo, senza riconcludere o creare un evento.

Recensione/voto Together restano sul film e vengono modificati con `SET_TOGETHER_EVALUATION`, separatamente dal ricordo sull'evento. I passi di un salvataggio misto non sono atomici: l'editor conserva i passi confermati e riprova soltanto il comando incerto con il suo handle. I giudizi personali non vengono toccati; nessun testo o voto viene copiato tra visioni.

## Ordine di cutover da autorizzare separatamente

Nessuno di questi passi di produzione è stato eseguito.

1. Revisionare SQL e risultati locali; verificare con l'operatore le definizioni installate e predisporre il recupero previsto dal progetto.
2. Concordare con N e V la pausa, chiudere entrambe le PWA/tab e risolvere le operazioni pendenti/incerte prima di procedere. Entrare nella manutenzione `read_only/1` con il meccanismo esistente e attendere il drain. Non azzerare protocollo, ACL, ricevute o dati.
3. Applicare la migration approvata in manutenzione. Non riaprire ancora le scritture.
4. Pubblicare il client approvato nel normale rilascio e aggiornare entrambe le PWA, incluso il service worker secondo il processo di release. Questo intervento non modifica la versione della shell e non avvia il rilascio.
5. Verificare su **entrambi** i dispositivi il caricamento della build con nuovo decoder. Non basta che il deploy risulti disponibile: evitare tab/client vecchi ancora attivi. Se un dispositivo non è aggiornato, restare in manutenzione.
6. Riaprire TARGET preservando la soglia 1 tramite l'operazione operatore prevista per la ripresa. Non rieseguire `runtime_4a4_activate_target`, che riguarda l'attivazione iniziale e richiede floor 0. Verificare la normale riconciliazione delle due PWA.

Non si promette un blocco automatico dei client v75 dopo la ripresa: la verifica dei due aggiornamenti è la condizione del cutover privato approvato.

## Arresto e rollback

Se il passaggio non è completato, mantenere read_only e non usare il client vecchio per scrivere. Prima della prima scrittura normale con ricordo, il vecchio vincolo è ripristinabile solo dopo verifica che i dati lo rispettino. Dopo nuove memorie normali, **non ripristinare il vecchio vincolo né cancellare i testi** per adattarli al frontend. Preferire manutenzione e correzione in avanti, conservando il nuovo decoder e schema.

Un rollback a v75 dopo nuove memorie non è sicuro sullo snapshot v2. Le ricevute delle richieste già confermate e la possibilità di riallinearne l'esito devono essere preservate.

## Test eseguiti

Dipendenza di test PGlite installata esclusivamente in `/tmp/sc-completed-test-deps`; nessuna dipendenza o infrastruttura aggiunta all'app. Tutti i database sono in memoria con fixture sintetiche, mai connessioni PostgreSQL/Supabase remote.

```sh
node scripts/verify-cap1-target-v2.cjs --completed-memory --pglite=/tmp/sc-completed-test-deps/node_modules/@electric-sql/pglite
node scripts/verify-cap1-target-v2.cjs --pglite=/tmp/sc-completed-test-deps/node_modules/@electric-sql/pglite
node scripts/verify-production-shell.cjs 'Completed unified'
```

- SQL esteso: **24 casi PASS**; contratto precedente installato separatamente: **16 PASS**. Migrazione in read_only, righe iniziali identiche, aggiunta/modifica/null/omissione/no-op, Unicode 1.000/1.001 caratteri, stato non completed, CAS con due richieste alla stessa versione, retry/reuse ID, membership e gruppo, identità/cronologia/partecipanti/giudizi invariati, snapshot/cache v2. Il test CAS in PGlite non equivale a uno stress test con due connessioni PostgreSQL: il protocollo di lock resta quello preesistente.
- Il vecchio setup sintetico precede l'inizializzazione TARGET delle versioni delle serate storiche: solo nella fixture estesa vengono inizializzate le versioni night a 1. **La migration di prodotto non aggiunge o ripara versioni**; `NIGHT_VERSION_MISSING` resta un errore.
- UI/runtime completed: **13 casi / 93 assert PASS**, incluso ricordo post-visione solo dopo conferma, nessuna duplicazione, date protette e retry parziale esatto.
- Browser completed: **104 controlli PASS**, HTTP locale, 320/390/768/1280 px e otto temi; markup/CSS esistenti e subset offline Tailwind. Verifiche isolate con fixture, non attestazione Safari/dispositivi reali.
- Snapshot core **61/61** (807 input negativi); adapter **71 casi / 564 assert**; recovery **28/28**; invalidation **35/35**.
- Browser Discovery **162 controlli PASS**, incluse Movie Detail e azioni native.
- Discovery/TasteProfiles/Core 2.0 **99/99**; Recommendation v75 **132/132**; frontend CAP-1 PASS.
- Regressioni shell pertinenti: night **17/91**, detail **29/151**, Match **17/57**, rimozione Lista **5/39**, azioni native Discovery **6/60**. Conteggi sovrapposti, non sommabili come casi distinti.

La suite VM production-shell integrale ha il limite preesistente dello stub MutationObserver quando parte Discovery; si usano i filtri pertinenti e il browser dedicato. Nessun PASS remoto o di produzione dichiarato.

## Preservazione

Manifest temporaneo SHA-256 di 701 file acquisito prima di questa modifica. Nessuna modifica ai moduli, test o documenti Discovery/Recommendation, al Movie Detail condiviso, agli altri cambiamenti v76, ai backup o agli untracked dello storico N. Le sole modifiche esistenti di questo passaggio sono decoder snapshot, adapter, CAP-1 UI, test CAP-1/production-shell/browser completed e questo documento; si aggiunge il SQL preparato.
