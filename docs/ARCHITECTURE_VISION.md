# Visione architetturale e principio di scalabilità

Aggiornamento: 16 ottobre 2026. Distingue **TARGET ARCHITECTURE APPROVED** per
il perimetro Persona/Gruppo e **FUTURE POSSIBILITY / DEFERRED** per la piattaforma
completa; nessuno dei due è implementato dalla sola approvazione.
[Stato AS-IS](MASTER_CONTEXT.md) e [roadmap Fase 0–10](PRODUCT_ROADMAP.md)
restano separati. Questo documento non autorizza refactoring o migrazioni.

## Punto di partenza — AS-IS

Alla release v62 l’app privata usa due membri preconfigurati N/V, un catalogo
`movies`, Personal Judgment in colonne N/V, candidatura `in_shared_list` e
`movie_nights` per gli eventi condivisi. Together deriva esclusivamente da
completed; voto/recensione N+V sono sul film, snack/luogo sulla singola serata.
`Cosa Guardiamo?` usa il Recommendation Core v2 come primo consumer. Non esistono
gruppi multipli, serie TV o community; il Core non è ancora generalizzato oltre
il contratto applicativo a due utenti.

Il runtime usa HTML/JavaScript vanilla/CSS, dipendenze CDN, script classici,
stato globale e domini store/UI separati. Realtime core unico, canale Match
separato, Supabase Auth/app_members e RLS verificati. Programmazione solo negli
eventi tramite RPC, legacy congelato. La mappa runtime è in
[AGENTS](../AGENTS.md); inventario del refactoring storico nel MASTER_CONTEXT;
[Auth/Supabase](AUTH_SUPABASE.md) e [transizione dati](DATA_MODEL_TRANSITION.md)
conservano i contratti tecnici. Questa visione non sostituisce quei vincoli.

## TARGET ARCHITECTURE APPROVED — Alternativa B

**APPROVED / NOT IMPLEMENTED — 16 ottobre 2026.** Il Product Owner ha scelto
relazioni con scope esplicito, **modello ibrido e incrementale**. La [grammatica
e le transizioni congelate](INDIVIDUAL_WATCH_REWATCH.md#target-approved--product-grammar-e-relation--transition-contract)
guidano la soluzione; [requisiti informativi e preservazione](DATA_MODEL_TRANSITION.md#target-approved--requisiti-informativi-e-preservazione)
sono vincoli dell'Implementation Plan, non schema già definito.

- Lista personale: relazione autonoma persona-film, distinta dal gradimento,
  con generation persistente e monotona per distinguere ritiro e nuova intenzione.
- Candidatura: relazione/stato con scope gruppo-film; supporto esplicito e
  convergenza distinguibili; ritiro e consumo riferiti al ciclo pertinente.
- Together: evento del gruppo con partecipanti reali espliciti per gli eventi
  nuovi; nessuna equivalenza universale evento=tutti i membri.
- Seen e giudizi v62 mantenuti per ora; `movies` resta catalogo/contenuto e
  compatibilità corrente. Non normalizzare automaticamente tutto il modello.
- Identità Persona/Gruppo per le nuove relazioni, senza costruire ora account,
  group switcher, inviti o piattaforma multi-group completa. N/V resta l'adapter
  dell'installazione corrente, non la forma permanente delle nuove relazioni.

**APPROVED TECHNICAL CONTRACT — refinement finale:** `auth.users.id` (Auth UUID)
è l'identità persona delle nuove relazioni; nessuna tabella `people` autonoma.
`app_members`/`app_person()` restano adapter N/V per seen e giudizi legacy.
Nessun mutex globale: le transizioni film-centriche acquisiscono lock sul film
e sugli aggregati pertinenti, con ordine stabile quando i lock sono multipli.
Le versioni sono scoped, senza global commit ordering. La lettura autorevole è
uno snapshot coerente composto sul server; Realtime invalida e provoca resync,
non ricostruisce relazioni. La [satisfaction minimale](DATA_MODEL_TRANSITION.md#satisfaction-minimale--approved-technical-contract)
usa riferimenti alle generation pertinenti, senza contesti generici di visione.

**NEEDED NOW:** stato sufficiente per intenzione/ciclo, supporti, ritiro/consumo,
partecipazione e satisfaction conservativa; transizioni server-authoritative,
intent-based e retry-safe; letture non definitivamente accettate se incoerenti.
Realtime riallinea e non prende decisioni di dominio.

**ARCHITECTURE-READY:** scope e identità espliciti delle nuove relazioni.
Una proiezione compatibile della candidatura per Match/Ruota/Recommendation è
possibile, ma non è schema scelto né seconda fonte autorevole. Match/Ruota
mantengono i contratti correnti, incluso Together escluso anche se ricandidato.

**FUTURE POSSIBILITY / DEFERRED:** multi-group completo, normalizzazione di
seen/giudizi, policy di convergenza/familiarità per gruppi >2, cronologia delle
visioni personali, giudizi per singolo evento e discovery esterna. La scelta B
non implementa questi elementi e non cambia il Core v2 frozen.

Implementation Plan e refinement finale sono approvati, non implementati.
I nomi proposti nel piano restano **CANDIDATE IMPLEMENTATION NAME**, non API
pubbliche definitive; nessuno schema/SQL è stato applicato. Prossimo passo nella
[roadmap unica](PRODUCT_ROADMAP.md#checkpoint-personagruppo--approved--not-implemented):
**PHASE 1 — LOCAL FOUNDATION / CANDIDATE MIGRATION**, da autorizzare separatamente.
Questo checkpoint non avvia implementazione, migration live o deploy.

## Principio ufficiale — quattro livelli

Ogni nuova feature significativa deve essere ragionata rispetto a questi
livelli, mantenendo chiari proprietario, ambito e fonte dei dati.

| Livello | Responsabilità |
| --- | --- |
| **CONTENT** | Film, Series e futuri tipi di contenuto; identità e metadati del contenuto |
| **USER** | Stato personale, storico, voto, recensione, taste profile e recommendation personale |
| **GROUP** | Lobby, lista condivisa, proposta/decisione, Match Live, programmazione, viewing, rating condiviso e Ricordi |
| **COMMUNITY** | Rating aggregato, recensioni pubbliche, social e discovery globale |

N e V sono progressivamente **due istanze di USER**, non concetti fondamentali
permanenti del dominio. L’app può continuare a usarli oggi dove necessario.
Quando esiste una modellazione altrettanto semplice e generalizzabile,
evitare nuove dipendenze N/V superflue. La scalabilità guida la progettazione,
senza richiedere refactoring prematuri, framework, bundler o backend nuovi.

Per una nuova feature chiarire: quale livello possiede il dato; cosa è
personale o condiviso; se funziona con più di due membri e più gruppi; quale
identità verificata può leggerlo/modificarlo; cosa preservare nello storico.
Registrare eventuali dipendenze N/V necessarie e il loro confine. Questo esame
non richiede introdurre ora tabelle/API astratte per ogni futura possibilità.

## FUTURE POSSIBILITY — modello completo, da progettare in Fase 4

```text
User → UserContentState → Content
User → GroupMembership → Group → GroupContentState / GroupViewing
```

| Concetto futuro | Significato e confine |
| --- | --- |
| User | Identità utente; N e V diventano i primi utenti storici |
| Content | Contenuto unico e metadati comuni; film e serie con domini specifici |
| UserContentState | Stato/progresso e valutazioni del singolo su un contenuto |
| GroupMembership | Partecipazione e autorizzazioni dell’utente in un gruppo |
| Group | Contesto condiviso; un utente può appartenere a più gruppi |
| GroupContentState | Candidatura/lista e stato del contenuto in quel gruppo |
| GroupViewing | Evento condiviso con partecipanti e dettagli della visione |

Sono entità concettuali della piattaforma futura, **non uno schema SQL approvato**.
La scelta incrementale B sopra è approvata, senza anticipare questo intero modello.
Cardinalità, identificativi, vincoli e visibilità della piattaforma completa
restano da progettare. Il perimetro approvato mantiene il giudizio del gruppo sul
film; un eventuale giudizio per singola visione è differito. Uno stesso contenuto
può avere stati differenti in gruppi differenti. Il progresso personale non
viene derivato automaticamente da quello condiviso.

## Mapping dal modello privato — direzione, non migrazione

| AS-IS | Direzione TO-BE da verificare |
| --- | --- |
| app_members N/V + utenti Auth | User storici e mapping Auth preservati; futura membership di gruppo separata |
| movies e identificativi TMDb | Content unico con dedup e metadati conservati |
| seen_n/seen_v, seen_rating_n/v, review_text_n/v | UserContentState del rispettivo proprietario |
| in_shared_list | GroupContentState del primo gruppo storico |
| movie_nights e date/time/snack/location | GroupViewing, un evento per ogni riga storica senza fusione dei rewatch |
| Together derivato da completed | Evidenza delle visioni condivise, senza alterare stati personali |
| seen_rating_together/review_text_together | CURRENT e TARGET corrente: opinione del gruppo sul film; eventuale destinazione per singolo evento DEFERRED, senza inventare voti storici |
| veto, sessioni/swipe Match | Dati di decisione nel contesto del gruppo con autore preservato |
| legacy congelato e backup operatore | Strategia esplicita di conservazione/compatibilità, senza drop automatici |

Non attribuire date di visione ai seen importati, non trasformare il catalogo
JustWatch in eventi condivisi e non reinterpretare le eccezioni intenzionali.
L’import concluso e i successivi dati N/V vanno preservati integralmente.

## Prima di migrare

La Fase 4 deve produrre e rendere revisionabili:

1. **Target data model:** entità, relazioni, cardinalità, stati e appartenenza
   dei voti/testi/dettagli; confini film/serie e User/Group/Community.
2. **Mapping N/V:** copertura di personali, candidatura, Together, serate,
   rewatch, valutazioni, veto, Match, metadati e legacy, senza perdita di dati.
3. **Migration strategy:** sequenza e compatibilità dei client, gestione delle
   scritture concorrenti, checkpoint e verifiche di conservazione.
4. **Rollback strategy:** condizioni di reversibilità, gestione delle nuove
   scritture e dati che non possono essere riportati al modello a due colonne.
5. **Compatibilità dello storico:** preservare ID/riferimenti ed eventi,
   distinguere informazioni assenti da zero e dati osservati da inferenze.
6. **Impatto RLS/Auth:** membership per gruppo, isolamento multi-tenant,
   autorizzazione proprietario/partecipante, API e canali Realtime.
7. **Test strategy:** conservazione prima/dopo, casi N/V, più utenti/gruppi,
   accessi negati, concorrenza/idempotenza, reload/offline, rewatch e rollback.

Servono fase e autorizzazione dedicate prima dell’esecuzione DB. La migration
storica v54 e la migration snack applicata restano immutate; Auth/RLS correnti
non vanno riaperte o indebolite per preparare il futuro.

## Recommendation e Decision Engine

Discovery & Recommendation Core v2 e il primo consumer `Cosa Guardiamo?` sono
implementati e rilasciati in v62. Le direzioni TO-BE restano separate dalla
release: recommendation personale («cosa piace a me») e recommendation di gruppo
(«cosa funziona qui») sono concetti distinti.

Gli esempi `recommend(user_id)` e `recommend(group_id)` esprimono due contesti,
non funzioni già presenti o una firma API definitiva. Una prima implementazione
può usare adattamenti semplici dei dati privati esistenti; deve poter evolvere
senza assumere che due colonne N/V esauriscano il dominio.
Cosa Guardiamo? consuma il Core v2. La Ruota resta indipendente; non esiste un
piano approvato per sostituire Match Live con il Core. Qualsiasi futuro uso per
nuovi deck Match richiederebbe una decisione dedicata e manterrebbe distinta la
Session Decision. Non cambiare pendingMatch, Continua, metriche o sessioni per
anticipare convergenze. Il [Core v2](RECOMMENDATION_ENGINE.md) è frozen
semanticamente. Surprise/Veto sono deprecated nel target ma il runtime attuale
conserva le semantiche esistenti; votes resta legacy senza nuove semantiche.

Candidate generation e ranking sono separati. Il Core può ricevere candidati
generati da fonti diverse; `Cosa Guardiamo?` v62 usa intenzionalmente soltanto la
shared list. Un futuro discovery mode fuori lista è **ARCHITECTURE-READY /
DEFERRED**: fonte del pool, filtri, retrieval, dimensione, UX, fonti esterne e
fase di implementazione restano da decidere. Non è implementato né autorizzato.

### User-centric Taste Profiles & Group Recommendation

**DEFERRED / ARCHITECTURE-READY.** Direzione futura, non CURRENT RELEASE SCOPE
né PLANNED MULTIUSER MIGRATION. Il prodotto attuale e il contratto applicativo
restano N/V; l'aggregazione corrente resta per due utenti. Il learning stabile
individuale e la composizione dei profili sono responsabilità separate:

```text
Stable observations(user) → Stable Taste Profile(user)
profiles[] → Group Recommendation → compatible candidates
compatible candidates → Session Decision / Match Live
```

Un profilo individuale potrà descrivere affinità per generi, registi, cast,
collection, durata ed epoche/anni, con supporto, confidence e provenance,
soltanto dove sostenuti dall'evidenza. Le osservazioni personali stabili sono
Personal Rating ed Explicit Personal Like/Dislike secondo la precedence
consolidata; seen resta exposure. Together Rating rimane shared evidence
separata e non viene trasferito automaticamente ai profili personali.

Match Live è Session Decision Data: le scelte di una serata/gruppo non
modificano automaticamente il gusto stabile individuale. Un futuro Session
Context Model potrà analizzare quei dati separatamente, se giustificato;
non viene progettato o implementato ora. **More observations → more knowledge /
confidence, NOT more voting power:** confidence e peso decisionale sono distinti.

`buildProfile(userId, observations)` e `recommendForGroup(profiles[], candidates)`
sono esempi concettuali, non nuove API da implementare. Un'eventuale superficie
personale «Il mio profilo» potrà mostrare affinità supportate, confidence,
quantità e provenienza dell'evidenza; nessun design/UI è previsto ora.

Per le evoluzioni ancora pianificate o deferred, evitare nuova duplicazione N/V
quando una funzione parametrizzata per utente è altrettanto semplice; mantenere profile learning
separato da couple aggregation, senza rendere `buildProfile()` matematicamente
dipendente da esattamente due utenti. Confinare N/V, dove ragionevole, negli
adapter/store/application boundaries. Non modificare API pubbliche, schema DB,
Auth, modello utenti, gruppi, Match Live o UI per anticipare il multiuser;
non introdurre refactoring generalizzanti né ampliare lo scope della prima
implementazione. Semplicità e sicurezza della release corrente restano prioritarie.

## Series, gruppi e community

Series → Seasons → Episodes richiede un dominio e un tracking dedicati.
Membri dello stesso gruppo possono essere a episodi differenti: progresso
personale e condiviso vanno rappresentati separatamente. Account/profili e
lobby restano fasi successive secondo la roadmap; la Fase 1 è parzialmente
implementata in v62 come descritto nella sezione Recommendation.

**MY RATING**, **GROUP/VIEWING RATING** e **COMMUNITY RATING** sono concetti
distinti. Il futuro livello community richiede regole di pubblicazione,
privacy e aggregazione proprie; un dato personale/condiviso non è pubblico
perché partecipa a un calcolo di raccomandazione.
