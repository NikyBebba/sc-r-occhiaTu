# Discovery v76 — correzioni finali da findings live

10 novembre 2026. Solo locale, non rilasciato. Nessun nuovo pool, cursore, data model, consumer Lista o Movie Detail. Profili, aggregazioni/protezioni Core 2.0 e Core v75 conservati. Questo documento aggiorna i precedenti checkpoint per formato, nicchia, spiegazioni, feedback e guardia franchise.

## Formato: causa e correzione

La lettura TMDb reale del film 76115 (`The Phantom of the Opera at the Royal Albert Hall`) restituisce Musica/Dramma/Romance, keyword `filmed play`, `live theatre`, `filmed theater`, sinossi con performance/anniversary. Il vecchio elenco di formati non comprendeva queste keyword e il ramo ambiguo richiedeva Musica + Documentario/TV. Musica + Dramma risultava quindi automaticamente `CINEMATIC_FORMAT` e non prioritario per la verifica.

Il classifier ora riconosce keyword esplicite di teatro/rappresentazione filmata e descrizioni di ripresa teatrale. Un contesto musicale di performance anniversario, senza i caratteri di una storia di fiction, resta `UNVERIFIED_PERFORMANCE_FORMAT` finché il dettaglio non lo chiarisce. I casi non risolti non entrano nel batch. Non esiste una blacklist del titolo: il regression test cambia il titolo e conserva lo stesso esito.

Le sole keyword `musical`, `based on play or musical` e `live theatre` non causano l'esclusione: l'ultima può descrivere l'argomento di un vero documentario. Restano i controlli positivi su narrazione biografica/investigativa e metadati documentari; è coperto anche il controesempio reale Searching for Sugar Man. L'adattamento cinematografico di un musical non è equiparato a una registrazione del palcoscenico.

Resta un filtro euristico su metadati pubblici, non un classificatore universale. Keyword erronee o descrizioni prive di indizi possono ancora essere problematiche. La prudenza opera sui casi riconosciuti come ambigui, senza escludere indiscriminatamente musical o documentari.

## Quality Gate: scorciatoia identificata

La lettura pubblica TMDb del film 292073 (`Stop-and-Cop Interactive`) conferma 28 voti, media 8,5, durata **13 minuti**, keyword `short film` e un regista nei credits. Nel gate v1.2 bastavano almeno 10 voti, media >=7, tre anni e tre metadati (trama/poster/genere). La maturità temporale diventava impropriamente una qualificazione sufficiente per questo contenuto.

In `cinematic-quality-v1.3`, per la sola nicchia sotto il supporto recente già configurato di 30 voti, trama/poster/genere non bastano: serve un dettaglio verificato, durata >=60 minuti e almeno un regista nei credits. Il retrieval ammette questi casi soltanto alla verifica limitata già disponibile e li prioritizza; senza conferma restano fuori. Non si aggiungono chiamate massive o nuove sorgenti di reputazione.

Un lungometraggio internazionale o documentario con 12 voti può ancora passare con tali evidenze. Classici con supporto consolidato e film brevi già consolidati non ricevono una soglia universale di durata o quantità voti. Lo shrinkage e la confidenza restano invariati. Queste informazioni qualificano il contenuto e il suo supporto minimo, non ne dimostrano la qualità artistica: non vengono attribuiti premi o consenso critico.

Le fixture sintetiche precedenti che rappresentavano una nicchia qualificata ora dichiarano esplicitamente il dettaglio verificato, la regia e la durata; le varianti senza verifica sono coperte separatamente come escluse. Gli artefatti JSON dei checkpoint precedenti restano storici, non vengono riscritti come se rappresentassero questo gate.

## Evidenze Core → testo della card

Il test dedicato esegue realmente Adapter → TasteProfiles → Core 2.0/pipeline → DiscoveryCopy. Distingue:

| Situazione sintetica | Diagnosi interna | Testo aggiuntivo |
|---|---|---|
| Nessun rating Together | ABSENT | nessuno |
| Un solo giudizio Together pertinente | INSUFFICIENT_SUPPORT | nessuno |
| Rating condivisi senza feature corrispondente | NO_MATCHING_EVIDENCE | nessuno |
| Solo genere generico | WEAK_OR_GENERIC | nessuno |
| Feature specifica sostenuta ma proiezione/catalogo non verificabile | UNVERIFIABLE | nessuno |
| Giudizio individuale negativo rende non positivo il tie-break condiviso | SUPPRESSED_BY_NEGATIVE | nessuno |
| Due film condivisi positivi, feature specifica e tie-break applicato | SUPPORTED | affinità collettiva verificata |

È stato trovato un vero difetto della proiezione: Core/profili comprimono gli spazi interni, mentre DiscoveryCopy non lo faceva. `Regista    Comune` poteva essere riconosciuto nel Core ma perso al momento di cercare la label della reason. Ora la normalizzazione è coerente; il test passa attraverso l'intera pipeline con questa differenza di spaziatura.

L'affinità condivisa mantiene i vincoli precedenti: supporto almeno due, almeno due film distinti presenti nella sorgente con rating Together >=7, feature specifica corrispondente e contributo positivo applicato. Nessuna deduzione di gusto dai Visti o dalla trama; nessun nome personale in UI. Le diagnosi interne non sono renderizzate nelle card.

Il fallback «Apprezzato dal pubblico su TMDb, con ... valutazioni» è rimosso. In assenza di affinità verificabile la card mostra **soltanto la premessa narrativa** della vera sinossi. Non viene aggiunta una frase esplorativa o cinematografica artificiale. Non è stata attribuita una causa alla mancanza di reason della sessione privata reale: le distinzioni sopra sono dimostrate su fixture, senza interrogare giudizi personali.

## Disponibilità: trigger riprodotto

Fixture con sei query e recupero di due sinossi: tutte le risposte effettive sono HTTP 200. Le riserve dei retry nelle richieste parallele lasciano un dettaglio opzionale con `DETAIL_BUDGET`; si osservano 13 chiamate effettive, dieci candidati informativi e `partial=true`. Il consumer mostrava il messaggio generico perché qualsiasi `DETAIL_*` attivava partial, anche senza una sinossi mancante o un errore della ricerca.

Il flag legacy `partial` e i diagnostici restano disponibili. Il nuovo campo diagnostico `availability` separa `searchPartial`, `optionalDetailsSkipped` e `optionalDetailsFailed`. L'interfaccia usa solo `searchPartial`: dettagli facoltativi saltati, credits mancanti e fallimenti dell'arricchimento opzionale non producono un allarme generale se il batch è valido. Non si cambia il budget, né si lancia un secondo salvataggio o un retry di comandi runtime.

Un pool realmente fallito produce «La ricerca è parziale. Puoi chiedere altri suggerimenti», conservando anche il conteggio se i titoli sono meno di sei. Errori complessivi, indisponibilità e 429/Retry-After conservano i loro stati/retry. Il browser copre sia HTTP 400 nei soli dettagli opzionali (nessun avviso generico), sia HTTP 503 su un pool (messaggio di ricerca parziale).

## Controlli accessori

La sola guardia Discovery di `discovery-six-fresh-v1.1` preferisce una collection non ancora usata quando esiste già fra le alternative della stessa protezione Core, della finestra di pertinenza 0,02 e della finestra di qualità pubblica 0,06. Non cambiano pesi, aggregazione, configurazione Core o strategia dei sette pool. Se non esiste un'alternativa comparabile, la collection può ricomparire: non si aggirano i negativi e non si impediscono sei titoli.

La guardia richiede collection note; non indovina franchise dai titoli. Senza tale metadato non può garantire che due capitoli non compaiano insieme. Nessuna nuova chiamata viene aggiunta per questa guardia. La memoria esposizioni resta temporanea (sette giorni, 200 ID), con penalità decrescente e fallback quando tutti i candidati sono recenti; non diventa una blacklist permanente.

## Live recheck sicuro

Letture GET pubbliche tramite il transport TMDb configurato, credenziale soltanto in memoria e mai stampata. Nessun modulo Auth/Supabase caricato nel recheck e nessun gusto privato utilizzato/esportato. Verdetti sui dettagli reali, con codice aggiornato:

| Titolo | Risposta | Formato | Gate qualità | Esito congiunto |
|---|---|---|---|---|
| The Phantom of the Opera at the Royal Albert Hall | HTTP 200 | RECORDED_PERFORMANCE | PUBLIC_SIGNALS | escluso |
| Stop-and-Cop Interactive | HTTP 200 | CINEMATIC_FORMAT | LOW_SUPPORT_UNVERIFIED_FEATURE | escluso |
| La La Land | HTTP 200 | CINEMATIC_FORMAT | PUBLIC_SIGNALS | ammissibile |
| Searching for Sugar Man | HTTP 200 | CINEMATIC_DOCUMENTARY | PUBLIC_SIGNALS | ammissibile |

Il recheck è limitato ai quattro dettagli pubblici: **non** è una nuova verifica dei 24 suggerimenti della sessione Safari autenticata né una prova di pertinenza predittiva personale. Le fixture fedeli conservano ID, durata, voti, generi e keyword pertinenti; le brevi sinossi nelle fixture sono parafrasi sintetiche dichiarate. Nessuna nuova produzione o release avviata.

## Test eseguiti

- Nuova suite mirata: 8/8 PASS.
- Suite complessiva Discovery/TasteProfiles/Core 2.0/diversità: 99/99 PASS.
- Core v75: 132/132 PASS.
- Browser Discovery: 162 controlli PASS, 320/390/768/1280 e otto temi; sei titoli, nessun fallback sui votanti, pool parziale distinto dall'arricchimento opzionale, rotazione, azioni native e transizione alla scheda persistita.
- Browser consumer v75: 17/17 PASS.
- Acquisizione nativa shell/runtime: 6 casi / 60 assert PASS.
- Movie Detail: 29 casi / 151 assert PASS; rimozione Lista: 3 / 25 PASS.
- Sintassi e whitespace dei file di questo intervento, incluso l'untracked; `git diff --check`: PASS.

Nessuna modifica ai file dei Core congelati, Adapter, Auth o sessione di produzione. Movie Detail e azioni native mantengono i cambiamenti v76 preesistenti. Backup e untracked dello storico N non toccati. Nessun commit, push, deploy, migration o scrittura Supabase.

File dell'intervento: i sei moduli Discovery `cinematic-quality.js`, `discovery-catalog.js`, `discovery-pipeline.js`, `discovery-tmdb.js`, `discovery-copy.js`, `discovery-view.js`; fixture `scripts/fixtures/discovery-live-findings.cjs`; test `scripts/verify-discovery-live-corrections.cjs`; adeguamenti delle fixture sintetiche in `verify-discovery-six-fresh.cjs`, `compare-discovery-six.cjs`, `diagnose-discovery-native.cjs`; aggiornamenti del browser harness; questo documento e il rimando nel report Retrieval 2.0.
