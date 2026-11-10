# v76 — Final Integration Gate

Verifica locale del 10 novembre 2026. Baseline produzione: `b1c3f5103bcd5129006afa8db1732c66b799e8fa` (v75). Nessuno staging, commit, push, deploy, accesso ai giudizi privati o intervento Supabase remoto. Il gate prepara una release candidate; non autorizza il cutover.

## Risultato integrato

`scripts/verify-v76-integrated-browser.cjs` serve l'index reale via HTTP loopback e carica i classic script nell'ordine di produzione. Configurazione sostituita con fixture; richieste TMDb/OMDb simulate; scritture instradate nel transport sintetico, con runtime TARGET, adapter, ricevute e riconciliazione reali del client.

Verificati i tre intenti: `PROPOSE_TO_GROUP`, `ADD_PERSONAL_LIST`, `RETROSPECTIVE_SEEN`. Acquisizione contenuto e relazione restano due comandi distinti. La scheda transiziona dall'ID temporaneo all'ID autorevole; poster, trama, generi, durata, regia, cast, collection, trailer e valutazioni arrivano alla scheda persistita nella fixture. Nessuna azione personale candida il film al gruppo. Il percorso include completamento normale, post-visione e scrittura separata di memoria evento e giudizio Together.

| Verifica eseguita | Risultato |
| --- | --- |
| Integrazione completa Chromium | 31 controlli, 9 comandi sintetici PASS |
| Integrazione completa WebKit | 31 controlli, 9 comandi sintetici PASS |
| Safari nativo, pagina HTTP locale e comando di test tramite UI | 31 controlli, 9 comandi sintetici PASS |
| Discovery Chromium, 320/390/768/1280 e otto temi | 293 controlli PASS |
| Discovery WebKit, stesse larghezze e temi | 293 controlli PASS |
| Completed Nights Chromium, quattro larghezze e otto temi | 104 controlli PASS |
| Completed Nights WebKit, stesse larghezze e temi | 104 controlli PASS |
| Auth browser Chromium | 43/43 PASS, zero errori JavaScript |
| Recovery con SDK v2 pubblico e PWA, Auth simulato | 10/10 PASS |
| Service worker, esclusioni API e grafo offline | 18/18 PASS |
| Aggiornamento reale worker v75 → v76, multi-tab, offline, install fallita | 17/17 PASS |

Le matrici Discovery sono state ripetute con lo script pubblico Tailwind effettivamente usato dall'app, scaricato soltanto in `/tmp`. Ispezionati anche gli screenshot del dettaglio a 320 px e della griglia 2×3 a 1280 px. Poster, provider e contenuti sono sintetici; i font/icona remoti sono esclusi dal test. Safari nativo ha eseguito il percorso integrato, **non** l'intera matrice di viewport: quella usa WebKit automatizzato. Il tentativo iniziale di sessione Safari WebDriver è scaduto; la verifica nativa è stata completata tramite UI, senza cambiare impostazioni del browser.

## Completed Nights — SQL esclusivamente PostgreSQL nativo

Cluster temporaneo PostgreSQL **17.11**, bind `127.0.0.1:62476`, database UTF8 vuoto `sc_person_group_test_v76_gate`, popolato solo dalle fixture. Nessun container remoto, Supabase o PGlite eseguito per questo gate.

`scripts/local-postgres-fixture.cjs` adatta il costruttore storico del test a una connessione `pg` persistente, verifica host loopback, nome database di test e schema vuoto. La dipendenza `pg` è solo in `/tmp`; nessuna dipendenza aggiunta all'app. `--pg-driver` è un'opzione del solo supporto test.

```sh
node scripts/verify-cap1-target-v2.cjs --completed-memory \
  --pg-driver=scripts/local-postgres-fixture.cjs \
  --pg=/tmp/sc-v76-gate-tools/node_modules/pg \
  --connection=postgresql://sc_v76_gate@127.0.0.1:62476/sc_person_group_test_v76_gate
node scripts/verify-v76-postgres-race.cjs \
  --pg=/tmp/sc-v76-gate-tools/node_modules/pg \
  --connection=postgresql://sc_v76_gate@127.0.0.1:62476/sc_person_group_test_v76_gate
```

Prima suite: **24 casi PASS**. Il database deve essere vuoto prima dell'installazione della fixture; non riutilizzare un database applicativo. Coperti migration atomica in manutenzione, righe esistenti invariate, writer CAP-1, snapshot v2/cache, memoria normale e retroattiva, aggiunta/modifica/omissione/null, limiti Unicode, CAS, replay, membership, date e partecipanti protetti, giudizi indipendenti.

Test concorrente aggiuntivo: due backend PostgreSQL distinti, attesa di lock osservata tramite terza connessione, vincitore `SUCCESS`, concorrente `STALE`, replay della ricevuta, un solo incremento versione e nessuna modifica all'identità/cronologia dell'evento o al numero delle serate. Il test è ripetibile grazie a testo sintetico univoco per esecuzione. Il preflight SQL è stato eseguito **solo sul cluster locale** per verificarne la sintassi.

## Non regressione

| Suite | PASS |
| --- | --- |
| TasteProfiles/Core 2.0/diversità/Discovery/quality/freshness/ratings/metadati, `node --test` su 12 file | 116 |
| Recommendation v75 `verify-recommendation.js` | 132 |
| Shell integrata VM, incluse acquisizione, Movie Detail, Home, Ruota, Lista e completed | 284 casi / 1473 asserzioni |
| Auth sintetico | 82 |
| TARGET action adapter | 71 casi / 564 asserzioni |
| Match adapter | 105 casi / 359 asserzioni |
| Snapshot core | 61 casi, 807 input invalidi respinti |
| Snapshot controller recovery / invalidation | 28 / 35 |
| TARGET runtime / consumer facade / integration host | 44 / 53 / 93 |
| Production bridges / protocol session | 127 / 42 |
| Production protocol | 67 |
| Paginazione | 34 |
| Personal watch/Together / rimozione valutazioni / snack completed | 20 / 22 / 14 |
| Serate oltre mezzanotte, tre fusi orari | 12 per fuso |
| Frontend CAP-1 v72 | PASS |
| Sintassi JS e `git diff --check` | PASS |

I totali delle suite che riusano altre suite **non sono sommabili**. Nessuna misura qui dimostra qualità predittiva superiore dei consigli reali.

Durante il gate quattro harness storici fallivano anche su un'estrazione del commit v75: conteggio `is-together` troppo ampio (includeva il badge giudizio), due fixture prive delle guardie legacy reali, fixture protocollo che negoziava solo snapshot 1 mentre il client usa snapshot 2. Corretti **soltanto i test**: conteggio degli indicatori di visione, caricamento delle guardie reali, negoziazione sintetica v1/v2 secondo gli argomenti ricevuti. Eliminata dal test personale la lettura facoltativa di un export privato: ora solo fixture. Esito finale delle quattro suite: PASS.

Altri adattamenti del harness VM: metodi DOM mancanti, Discovery verificata nel browser invece del DOM stub Lista, asserzione di copy aggiornata al testo neutro già approvato. Nessun algoritmo di prodotto modificato dal gate.

## PWA e marker

Marker locale `protocol-v1-v76`, footer visibile `v76`, cache `scorochiatu-shell-v76`. Il precache contiene tutti gli script dell'index e anche l'helper puro `ranking-v2-input.js`, non caricato direttamente dal consumer. Nessun cambio di strategia worker: la v76 attende i client precedenti; nessun `skipWaiting` forzato. Provati più tab v75, aggiornamento differito, chiusura dei vecchi client, attivazione v76, pulizia della sola vecchia cache e fallimento di un asset che conserva la shell v75 integra.

Offline significa **app-shell**, non disponibilità di TMDb, autenticazione o autorizzazione TARGET offline. Il gate offline isola le dipendenze CDN con fixture; non certifica una nuova capacità offline completa. Il debito preesistente delle dipendenze CDN resta distinto dalla correttezza del precache locale.

## Inventario e preservazione

`V76_RELEASE_INVENTORY.json` elenca ogni file candidato nuovo/modificato rispetto a v75, con SHA-256. Generazione/verifica senza staging:

```sh
node scripts/verify-v76-release-inventory.cjs --write
git diff --check
```

Ambiti: nuovi moduli puri profili/ranking/retrieval/quality, consumer Discovery e salvataggi/copy/esposizioni; integrazione TMDb/OMDb e renderer condivisi; Completed Nights, writer SQL locale e decoder v2; test, benchmark sintetici e documentazione. Una sola nuova migration candidata: `20261110012012_completed_nights_memory.sql`, **non applicata remotamente**.

L'inventario esclude artefatti storico N, import/approvazioni, fixture private, asset `icon & mascotte`, cache Python e materiali estranei. Non usare `git add .` per una futura release. `js/config.js` è identico a v75: contiene la configurazione frontend preesistente, non viene stampata o modificata. Nessuna nuova credenziale rilevata dai controlli per chiavi private, JWT letterali e segreti provider; il controllo automatico non sostituisce la review finale del diff.

Confronto con il manifest iniziale di 706 file: nessuna rimozione; 485 file protetti, inclusi storico/backup e implementazione Completed Nights/SQL, identici byte per byte. Dal gate cambiano soltanto marker/precache e harness di verifica; il codice funzionale Discovery e Completed Nights già presente resta intatto.

## Cutover coordinato — piano, non eseguito

1. **Preflight di sola lettura:** l'operatore esegue `V76_LIVE_PREFLIGHT.sql` sul progetto previsto e confronta schema, vincoli validati, definizioni/fingerprint installati con CAP-1 v2 + valutazioni atomiche. Devono esistere bootstrap v2, snapshot, writer e operazione manutenzione; TARGET/floor 1 coerente, ACL e RLS invariati. Output assente, diverso o ambiguo → STOP. Nessuna verifica live è stata dichiarata eseguita in questo gate.
2. **Pausa concordata N/V e backup:** risolvere comandi pendenti/incerti, chiudere tutte le PWA/tab. Entrare in `read_only/1` con l'operazione operatore esistente e verificare il drain; acquisire/verificare un backup consistente pre-migration, con schema, dati, partecipanti, versioni e ricevute. Conservare backup e istruzioni di recupero fuori repository. Backup assente/non recuperabile → STOP.
3. **Migration autorizzata separatamente:** applicare soltanto il file candidato verificato, con i timeout e la transazione già presenti. Non backfillare, convertire o cancellare record. La migration non riapre le scritture. Errore/timeout → rollback transazionale, restare read_only, non pubblicare.
4. **Frontend:** pubblicare la candidata verificata solo con autorizzazione successiva. Deploy/asset incompleto → STOP in read_only. Verificare marker, grafo script e precache sui file effettivamente serviti prima di procedere.
5. **Entrambi i dispositivi:** aggiornare ogni PWA N/V e chiudere eventuali vecchi tab. Verificare su ciascuno footer `v76`, build `protocol-v1-v76`, worker/cache `scorochiatu-shell-v76`, login/ bootstrap online e decoder snapshot 2. Un solo dispositivo non verificato → restare in manutenzione. Worker waiting non equivale a client aggiornato.
6. **Ripresa controllata:** usare la procedura operatore di ripresa TARGET mantenendo floor 1, ACL e ricevute. Non rieseguire `runtime_4a4_activate_target` (attivazione iniziale floor 0), non abbassare la soglia. Verificare entrambi i contesti online e la riconciliazione prima di riprendere l'uso. Le eventuali scritture di verifica reali richiedono un'autorizzazione esplicita separata; i record di esempio non sono strumenti di test.

**Arresto/rollback:** se migration o deploy falliscono, nessuna ripresa parziale. Dopo una migration riuscita è preferibile mantenere lo schema ampliato e correggere in avanti. Il vecchio vincolo è ripristinabile solo se i dati lo soddisfano ancora; dopo una memoria su completed normale, non cancellarla per rendere compatibile v75 e non ripubblicare un decoder incapace di leggerla. Preservare identità, cronologia, ricevute e versioni; nessun restore indiscriminato che perda operazioni successive.

## Limiti residui e decisione

Gate locale PASS. Nessuna regressione di prodotto riproducibile rimasta nei test eseguiti. Preflight remoto, backup recuperabile, applicazione SQL, deploy e verifica delle due PWA sono precondizioni operative **ancora da eseguire e autorizzare**. Safari nativo non sostituisce il collaudo finale delle due PWA installate. La release candidate è pronta per review; non è pubblicata e non è autorizzata automaticamente alla produzione.


## Procedura operativa definitiva v76 — preparata, NON eseguita

Questa sezione aggiorna lo stato operativo delle sezioni storiche sopra: preflight remoto mirato e validazione del backup pre-v76 conclusi; nessuna migration, manutenzione, staging, commit, push o pubblicazione eseguiti. Codice funzionale invariato. Non eseguire l'intera procedura come un unico script: ogni checkpoint richiede esito confermato e autorizzazione appropriata.

### A. Salvaguardia locale e seconda copia

Sorgente `csvbackup/pre-v76/`: `roles.sql` 297 byte, `schema.sql` 236339 byte, `data.sql` 1217115 byte. SHA-256 verificati nuovamente:

```text
25873cec56a2cc6514e204f420231777f85c03da818caa7090cdcdfa89776ecd  roles.sql
ad923f809caf6f655cea0d6ca58d0a12b84bd5f9a9a11009f955ca79c4ca9df3  schema.sql
7c7e2d53d9d1fdf6a969781970a17a371380ead6fd6be53df9059ef877281878  data.sql
```

Destinazione proposta: nuova sottocartella datata in `/Users/nikybebba/Documents/scrocchiatu-cleanup-backup/`. Directory padre esistente e scrivibile; spazio sufficiente. È esterna al repository **ma sullo stesso filesystem/disco**: non è una copia off-device. In questa fase è stata verificata solo la possibilità, non creata la copia.

Comando locale preparato per la fase di esecuzione; non richiede accesso Supabase. Rifiuta collisioni e checksum inattesi; non sovrascrive backup storici. Se interrotto, conservare la directory parziale e ripartire in una nuova directory, senza considerarla una copia verificata.

```sh
python3 - <<'PY_COPY'
from pathlib import Path
from datetime import datetime, timezone
import hashlib, os
source=Path('csvbackup/pre-v76')
expected={
 'roles.sql':'25873cec56a2cc6514e204f420231777f85c03da818caa7090cdcdfa89776ecd',
 'schema.sql':'ad923f809caf6f655cea0d6ca58d0a12b84bd5f9a9a11009f955ca79c4ca9df3',
 'data.sql':'7c7e2d53d9d1fdf6a969781970a17a371380ead6fd6be53df9059ef877281878'}
blobs={n:(source/n).read_bytes() for n in expected}
assert all(hashlib.sha256(blobs[n]).hexdigest()==h for n,h in expected.items())
parent=Path.home()/'Documents/scrocchiatu-cleanup-backup'
assert parent.is_dir()
destination=parent/('pre-v76-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
os.umask(0o077)
destination.mkdir(mode=0o700,exist_ok=False)
for name,blob in blobs.items():
 with (destination/name).open('xb') as f:
  f.write(blob);f.flush();os.fsync(f.fileno())
 assert hashlib.sha256((destination/name).read_bytes()).hexdigest()==expected[name]
with (destination/'SHA256SUMS').open('x') as f:
 for name,h in expected.items():f.write(h+'  '+name+'\n')
 f.flush();os.fsync(f.fileno())
print('SECOND_COPY_VERIFIED',destination)
PY_COPY
```

Checkpoint A: tre file presenti in entrambe le posizioni e hash identici, directory esterna protetta. Nessun dump nuovo necessario se il backup resta allineato al fermo scritture. Prima della migration attestare assenza di modifiche successive al backup; se non attestabile, acquisire e validare un nuovo pacchetto a scritture ferme, in percorsi nuovi, senza sovrascrivere pre-v76. I tre dump logici non sono un restore integrale dimostrato e non includono tutti gli oggetti gestiti/configurazioni/file Storage.

### B. Elenco Git esatto

**79 file payload con SHA-256 + il manifest stesso = 80 path da includere.** Il manifest non contiene un hash ricorsivo di sé stesso. I 447 untracked estranei restano esclusi; tutti i backup sotto `/csvbackup/` sono ignorati e la seconda copia è fuori repository. Nessun `git add .`, `git add -A` o `git add -f`.

<!-- V76_EXACT_RELEASE_PATHS -->
```text
css/style.css
database/20261110012012_completed_nights_memory.sql
docs/COMPLETED_NIGHTS_UNIFICATION.md
docs/DISCOVERY_FINAL_CORRECTIVE_PASS.md
docs/DISCOVERY_FIRST_UX.md
docs/DISCOVERY_NATIVE_ACTIONS_QUALITY.md
docs/DISCOVERY_NATIVE_DIAGNOSTICS.json
docs/DISCOVERY_NATIVE_METADATA_INTEGRATION.md
docs/DISCOVERY_NATIVE_REFINEMENT.md
docs/DISCOVERY_RETRIEVAL_V2.md
docs/DISCOVERY_RETRIEVAL_V2_FIXTURES.json
docs/DISCOVERY_SIX_FRESHNESS.md
docs/DISCOVERY_SIX_FRESHNESS_FIXTURES.json
docs/RATINGS_CONSISTENCY_NATIVE_LAYOUT.md
docs/RECOMMENDATION_CORE_V2.md
docs/RECOMMENDATION_CORE_V2_BENCHMARK.json
docs/RECOMMENDATION_DIVERSITY_VALIDATION.json
docs/RECOMMENDATION_DIVERSITY_VALIDATION.md
docs/TASTE_PROFILES_V1.md
docs/TMDB_DISCOVERY_RETRIEVAL.md
docs/V76_FINAL_INTEGRATION_GATE.md
docs/V76_LIVE_PREFLIGHT.sql
index.html
js/api/omdb.js
js/api/tmdb.js
js/recommendation/cinematic-quality.js
js/recommendation/discovery-catalog.js
js/recommendation/discovery-pipeline.js
js/recommendation/discovery-tmdb.js
js/recommendation/profiles.js
js/recommendation/ranking-v2-input.js
js/recommendation/ranking-v2.js
js/runtime/action-adapter.js
js/snapshot/core.js
js/ui/cap1-nights.js
js/ui/discovery-copy.js
js/ui/discovery-exposures.js
js/ui/discovery-save.js
js/ui/discovery-view.js
js/ui/product-context.js
js/ui/product-editors.js
js/ui/recommendations.js
js/ui/render/cards.js
js/ui/render/detail.js
js/ui/target-shell.js
scripts/benchmark-recommendation-ranking-v2.cjs
scripts/compare-discovery-retrieval.cjs
scripts/compare-discovery-six.cjs
scripts/diagnose-discovery-native.cjs
scripts/fixtures/discovery-live-findings.cjs
scripts/fixtures/discovery-retrieval-before.cjs
scripts/local-postgres-fixture.cjs
scripts/person-group-command-test-support.cjs
scripts/validate-recommendation-diversity.cjs
scripts/verify-cap1-target-v2.cjs
scripts/verify-completed-snack.js
scripts/verify-completed-unified-browser.cjs
scripts/verify-discovery-live-corrections.cjs
scripts/verify-discovery-native-diagnostics.cjs
scripts/verify-discovery-native-metadata.cjs
scripts/verify-discovery-refinement.cjs
scripts/verify-discovery-save.cjs
scripts/verify-discovery-six-fresh.cjs
scripts/verify-discovery-tmdb.cjs
scripts/verify-discovery-view-browser.cjs
scripts/verify-evaluation-removal.js
scripts/verify-personal-watch-together.js
scripts/verify-production-protocol.cjs
scripts/verify-production-shell-pwa.cjs
scripts/verify-production-shell.cjs
scripts/verify-ratings-consistency.cjs
scripts/verify-recommendation-consumer-browser.cjs
scripts/verify-recommendation-diversity.cjs
scripts/verify-recommendation-profiles.cjs
scripts/verify-recommendation-ranking-v2.cjs
scripts/verify-v76-integrated-browser.cjs
scripts/verify-v76-postgres-race.cjs
scripts/verify-v76-release-inventory.cjs
service-worker.js
docs/V76_RELEASE_INVENTORY.json
```
<!-- /V76_EXACT_RELEASE_PATHS -->

Prima di staging (solo dopo autorizzazione): `node scripts/verify-v76-release-inventory.cjs`, `git diff --check`, branch `main`, HEAD e `origin/main`/main remoto ancora sul commit v75 atteso. Se il remoto avanza, STOP: nessun pull/rebase/merge automatico in questo worktree.

Comando preparato per uno staging limitato alla allowlist. **NON eseguito.** Lo script di inventario esistente richiede staging vuoto e va eseguito prima, non dopo questo comando.

```sh
python3 - <<'PY_STAGE'
from pathlib import Path
import subprocess,json,hashlib
baseline='b1c3f5103bcd5129006afa8db1732c66b799e8fa'
def git(*args):return subprocess.check_output(['git',*args])
assert git('branch','--show-current').decode().strip()=='main'
assert git('rev-parse','HEAD').decode().strip()==baseline
assert git('rev-parse','origin/main').decode().strip()==baseline
assert git('ls-remote','origin','refs/heads/main').decode().split()[0]==baseline
assert not git('diff','--cached','--name-only').strip()
manifest=Path('docs/V76_RELEASE_INVENTORY.json');manifest_bytes=manifest.read_bytes()
r=json.loads(manifest_bytes);assert len(r['files'])==79
expected={x['path']:x['sha256'] for x in r['files']}
expected[str(manifest)]=hashlib.sha256(manifest_bytes).hexdigest()
assert len(expected)==80
for path,digest in expected.items():assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==digest,path
subprocess.run(['git','add','--',*expected],check=True)
staged=set(git('diff','--cached','--name-only','-z').decode().rstrip('\0').split('\0'))
assert staged==set(expected),'STOP: unexpected staged paths'
for path,digest in expected.items():assert hashlib.sha256(git('show',':'+path)).hexdigest()==digest,path
subprocess.run(['git','diff','--cached','--check'],check=True)
print('EXACT_STAGING_VERIFIED',len(staged))
PY_STAGE
```

Errore dopo staging → STOP senza commit; preservare il worktree e ispezionare l'indice, senza reset/checkout indiscriminati.

### C. Manutenzione e drain — autorizzazione remota distinta

Concordare pausa N/V, risolvere gli esiti incerti e chiudere PWA/tab. Prima del push confermare il progetto Vercel esistente e il collegamento Git della production branch `main`: un push può già avviare il deploy. L'autorizzazione al push deve quindi comprendere l'eventuale deploy automatico; non separare artificialmente i due effetti.

Eseguire come operatore autorizzato sul progetto Supabase `teslxpcgrrmqysfkdewe`, in una sessione SQL controllata; mai usando chiavi frontend come credenziali amministrative. SQL preparato, non eseguito:

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT public.runtime_4a4_enter_maintenance();
COMMIT;

SELECT mode,minimum_client_protocol
FROM public.app_protocol_state WHERE singleton;
-- Deve risultare read_only / 1. Qualsiasi altro esito: STOP.
```

La transazione di manutenzione deve essere confermata prima della cattura drain. Il solo cambio mode e l'assenza apparente di query in pg_stat_activity non provano che le RPC già ammesse siano terminate.

Nella stessa sessione **psql** operatore (autenticazione sicura già predisposta), con autocommit e `ON_ERROR_STOP`:

```sql
\set ON_ERROR_STOP on
SELECT public.runtime_4a4_capture_drain() AS v76_drain \gset
SELECT public.runtime_4a4_verify_drain(:'v76_drain'::jsonb);
```

Se si usa l'editor SQL, mantenere il checkpoint JSON in una nota operatore privata e passare lo stesso JSON a `runtime_4a4_verify_drain(jsonb)` in una transazione successiva; non salvarlo in Git. Solo `true` consente il passo successivo. `DRAIN_PENDING`: aspettare la conclusione delle transazioni catturate e riprovare la verifica senza cicli infiniti; `DRAIN_CHECKPOINT_INVALID` richiede ricattura; prepared transaction o timeout non risolto → STOP. Non terminare sessioni a caso e non rieseguire il fence iniziale o l'attivazione TARGET iniziale.

Checkpoint B: manutenzione confermata, drain verificato, backup coerente col fermo e seconda copia confermata. Senza questi esiti non applicare SQL.

Prima e dopo il DDL, eseguire lo stesso controllo aggregato di sola lettura e confrontare i risultati in una nota operatore privata. Nessuna riga o testo viene esportato dal controllo; tutti i risultati devono restare identici. Le impronte non vanno committate:

```sql
SELECT 'movie_nights' AS relation,count(*) AS rows,
 md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text,'[]')) AS fingerprint
FROM public.movie_nights t
UNION ALL
SELECT 'participants',count(*),
 md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.night_id,t.person_id)::text,'[]'))
FROM public.movie_night_participants t
UNION ALL
SELECT 'movies',count(*),
 md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text,'[]'))
FROM public.movies t
UNION ALL
SELECT 'versions',count(*),
 md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]'))
FROM public.domain_versions t
UNION ALL
SELECT 'receipts',count(*),
 md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]'))
FROM public.domain_command_receipts t;
```


### D. Migration Completed Nights — autorizzazione DDL distinta

Una sola migration approvata: `database/20261110012012_completed_nights_memory.sql`, SHA-256 `5df19111dd0698f0ab34b7e329f877093eb4f410e553809d3ed1d7eeb90d1824`. Eseguire l'esatto contenuto una sola volta tramite la sessione SQL operatore; lo script contiene già BEGIN/COMMIT e timeout. Non introdurre wrapper SQL, backfill o altre migration.

Esempio **psql**, solo nella futura fase autorizzata:

```sql
\set ON_ERROR_STOP on
\i database/20261110012012_completed_nights_memory.sql
```

Errore/timeout/connessione persa → STOP, non assumere commit riuscito né ritentare ciecamente; verificare esito da una nuova sessione operatore. Se la transazione non ha committato, le modifiche sono annullate atomicamente. Restare in manutenzione.

Verifica successiva di sola lettura:

```sql
SELECT mode,minimum_client_protocol FROM public.app_protocol_state WHERE singleton;
SELECT conname,convalidated,pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid='public.movie_nights'::regclass
AND conname IN ('movie_nights_cap1_shape','movie_nights_cap1_memory_length');
SELECT md5(prosrc) AS writer_source_md5,pg_get_userbyid(proowner) AS owner,
 prosecdef,proconfig,
 has_function_privilege('authenticated',oid,'EXECUTE') AS auth_execute,
 has_function_privilege('anon',oid,'EXECUTE') AS anon_execute
FROM pg_proc WHERE oid='public.cap1_execute_app_command(jsonb)'::regprocedure;
```

Atteso: ancora `read_only/1`; vincoli validati, testo solo su completed, limite 1000 invariato, regole retroattive intatte; writer MD5 `d1d07f984facadf893a5864b6fe6d36d`, owner postgres, SECURITY DEFINER/search_path vuoto, helper non eseguibile da authenticated/anon. Confrontare l'impronta aggregata privata di eventi/partecipanti/giudizi/identità acquisita prima del DDL: nessuna modifica delle righe da questa migration. Non stampare testi o giudizi nel report. Lo storico rimane fermo.

Checkpoint C: schema/writer esatti e nessuna modifica dati. Il checkpoint drain precedente diventa invalido dopo DDL: non riutilizzarlo per verifiche successive.

### E. Commit, push e pubblicazione — autorizzazioni esplicite

Dopo C, eseguire lo staging limitato di B, verificare esattamente gli 80 path e i blob staged, quindi solo con autorizzazione:

```sh
git commit -m "feat: release v76 Discovery First and completed night memories"
git rev-parse HEAD
git push origin main
```

Registrare lo SHA effettivo del commit v76. Nessun force-push. Se il commit o il push falliscono, restare in manutenzione e verificare SHA locali/remoti prima di qualsiasi retry.

Su Vercel usare il progetto esistente `sc-r-occhia-tu` nella team/workspace già usata, ambiente Production, sorgente Git `NikyBebba/sc-r-occhiaTu`, commit **esatto** appena registrato. Attendere `READY` e confermare assegnazione al dominio `https://sc-r-occhia-tu.vercel.app/`. Push accettato non significa deploy concluso. Se l'integrazione non parte, STOP e autorizzare il deploy dell'esatto commit tramite il flusso esistente. Non avviare un secondo deploy concorrente o `vercel --prod` da questo worktree con 447 file estranei.

Checkpoint D: SHA del deployment e del dominio corrispondenti; nessun errore di build o asset. Se READY è di un commit diverso o il dominio serve ancora v75, non proseguire.

Verifica HTTP preparata, non eseguita: impostare `V76_RELEASE_SHA` allo SHA approvato del commit, senza usare un HEAD mobile. Il controllo confronta byte degli asset e non stampa configurazione/credenziali.

```sh
python3 - <<'PY_HTTP'
import os,re,subprocess,urllib.request,hashlib
sha=os.environ['V76_RELEASE_SHA'];assert re.fullmatch(r'[0-9a-f]{40}',sha)
def content(p):return subprocess.check_output(['git','show',sha+':'+p])
index=content('index.html').decode()
paths=['index.html','service-worker.js','manifest.json','css/style.css']+re.findall(r'<script src="(js/[^\"]+)"',index)
for path in sorted(set(paths)):
 url='https://sc-r-occhia-tu.vercel.app/'+('' if path=='index.html' else path)
 with urllib.request.urlopen(urllib.request.Request(url,headers={'Cache-Control':'no-cache'}),timeout=30) as response:
  assert response.status==200;remote=response.read()
 assert hashlib.sha256(remote).digest()==hashlib.sha256(content(path)).digest(),path
assert 'protocol-v1-v76' in index and 'scorochiatu-shell-v76' in content('service-worker.js').decode()
print('PRODUCTION_ASSETS_MATCH_APPROVED_COMMIT',len(set(paths)))
PY_HTTP
```

### F. Aggiornamento verificato di ENTRAMBE le PWA

Per N e V separatamente, mantenendo manutenzione:

1. Con connessione online, aprire l'app e richiedere l'aggiornamento disponibile. Il worker non usa skipWaiting: il pulsante/refresh da solo può lasciare la shell v75 finché esistono altri client.
2. Chiudere completamente la PWA e tutti i tab di quel sito sullo stesso dispositivo, quindi riaprire online. Se ancora v75, verificare worker waiting e ripetere il ciclo update/chiusura; non usare un timeout fisso come prova di successo.
3. Verificare la versione realmente caricata sul dispositivo: footer v76, DOM `protocol-v1-v76` e worker/cache attivi `scorochiatu-shell-v76` tramite gli strumenti disponibili. Il marker HTTP del server non prova la versione della PWA. Registrare separatamente gli esiti N e V; dove l'ispezione cache non è disponibile, segnalarlo e ottenere la verifica operatore prima della ripresa.
4. Verificare login normale e stato manutenzione senza tentare azioni. Nessuna autorizzazione dalla cache offline. Non cancellare dati sito/token o reinstallare la PWA automaticamente; una procedura manuale ulteriore va concordata dopo aver risolto ogni operazione pendente.

Checkpoint E: entrambi i dispositivi confermati v76, nessun vecchio client aperto. Uno solo ancora v75 o non verificato → STOP in read_only. Non abbassare protocol floor e non aggiungere compatibilità automatica v75.

### G. Smoke e riapertura controllata

Prima della riattivazione, lo smoke verifica asset/versione, shell, login, stato manutenzione, worker/PWA e metadati SQL. **Il runtime TARGET completo non è accessibile in read_only:** non fingere che sia stato collaudato prima della riapertura. Lo smoke con snapshot online e viste applicative deve seguire una riattivazione controllata, con N/V ancora in pausa e senza comandi di modifica.

Dopo D/E e smoke preliminare riusciti, autorizzazione esplicita alla riapertura. Ricatturare/verificare un checkpoint drain aggiornato se necessario; non riutilizzare quello precedente al DDL. Non esiste una RPC di resume dedicata: si prepara soltanto una transazione operatore minima sul mode, senza nuova infrastruttura e senza cambiare floor, ACL o dati applicativi. **Non eseguita**:

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_catalog.pg_advisory_xact_lock(473106,1);
DO $v76_resume$
DECLARE cfg public.app_protocol_state; changed integer;
BEGIN
 SELECT * INTO cfg FROM public.app_protocol_state WHERE singleton FOR UPDATE;
 IF NOT FOUND OR cfg.mode IS DISTINCT FROM 'read_only' OR cfg.minimum_client_protocol IS DISTINCT FROM 1 THEN
  RAISE EXCEPTION 'V76_RESUME_PRECONDITION';
 END IF;
 IF NOT EXISTS(SELECT FROM pg_proc WHERE oid='public.cap1_execute_app_command(jsonb)'::regprocedure
  AND md5(prosrc)='d1d07f984facadf893a5864b6fe6d36d') THEN RAISE EXCEPTION 'V76_WRITER_NOT_VERIFIED';END IF;
 IF NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='public.movie_nights'::regclass
  AND conname='movie_nights_cap1_shape' AND convalidated) THEN RAISE EXCEPTION 'V76_CONSTRAINT_NOT_VALIDATED';END IF;
 UPDATE public.app_protocol_state SET mode='target' WHERE singleton AND mode='read_only' AND minimum_client_protocol=1;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'V76_RESUME_NOT_CONFIRMED';END IF;
END $v76_resume$;
COMMIT;
SELECT mode,minimum_client_protocol FROM public.app_protocol_state WHERE singleton;
```

Atteso `target/1`. Non rieseguire `runtime_4a4_activate_target`, che richiede floor 0. Dopo commit, entrambe le PWA devono riconciliare un contesto online aggiornato; se non avviene, usare il refresh/riavvio ordinario già previsto, non scrivere da una vista obsoleta.

Smoke finale **read-only**: bootstrap/snapshot v2 accettati su entrambi, Home/Lista/Discovery e dettaglio persistito/esterno leggibili, sei proposte quando disponibili, metadati/ratings/trailer, dettaglio delle serate normali/retroattive. Nessuna acquisizione, voto, completamento, editor-save, avvio Match o altra scrittura come smoke senza autorizzazione separata. Non usare i film reali citati nella review come fixture.

Checkpoint F: smoke finale riuscito su N/V → comunicare ripresa dell'uso. Se fallisce, tornare immediatamente in manutenzione tramite la transazione di C, confermare read_only/1 e drain; N/V restano in pausa.

### H. Arresto, recupero e autorizzazioni

| Evento | Azione |
| --- | --- |
| Manutenzione non confermata / drain pendente | Nessuna migration, push o deploy; risolvere il punto e ricatturare solo quando necessario. |
| Migration fallita / esito incerto | Restare in manutenzione; controllare l'esito transazionale. Nessun retry cieco e nessun deploy anticipato. |
| Deploy fallito / SHA o asset errati | Restare read_only con lo schema ampliato; correggere e pubblicare solo il commit approvato. |
| N o V ancora v75 | Nessuna riapertura; completare l'aggiornamento di tutti i client del dispositivo. |
| Smoke preliminare fallito | Non riattivare TARGET. |
| Smoke finale fallito dopo riattivazione | Rientrare in read_only/1, verificare drain, correggere in avanti preservando le ricevute. |
| Nuove memorie normali già scritte | Non ripristinare vecchio vincolo/decoder, non cancellare testi e non restaurare dump sopra i dati correnti. |

Un rollback frontend v75 non è una soluzione sicura dopo memorie normali. Nessun reset Git distruttivo, restore indiscriminato o cleanup della cronologia. Il recupero predefinito è manutenzione + correzione in avanti; qualsiasi restore o rollback aggiuntivo richiede un piano e autorizzazione separati.

| Categoria | Autorizzazione richiesta |
| --- | --- |
| Letture locali, verifica hash, piano/documentazione | Preparazione autorizzata in questo turno; nessuna esecuzione di rilascio. |
| Seconda copia locale esterna | Comando preparato; eseguire nella fase locale autorizzata, senza overwrite. |
| Manutenzione / ripresa TARGET | Scritture remote al protocol state: consenso esplicito per ciascun passaggio. |
| Migration SQL | Consenso DDL esplicito dopo backup e drain. |
| Staging / commit | Consenso Git locale esplicito; allowlist esatta. |
| Push / deploy Vercel | Consenso esplicito comprensivo dell'eventuale deploy automatico da main. |
| Aggiornamento PWA N/V | Azione manuale verificata su ogni dispositivo. |
| Smoke con modifiche reali | Non incluso; richiede consenso separato. |

Stato finale di questa preparazione: procedura pronta per review/autorizzazione a fasi; seconda copia, manutenzione, migration, staging, commit/push, deploy e ripresa **non eseguiti**.
