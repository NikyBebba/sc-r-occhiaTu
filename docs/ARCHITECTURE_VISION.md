# Visione architetturale e principio di scalabilità

Aggiornamento: 12 ottobre 2026. **TO-BE** per il modello di dominio futuro;
principio da applicare alla progettazione dei prossimi incrementi.
[Stato AS-IS](MASTER_CONTEXT.md) e [roadmap Fase 0–10](PRODUCT_ROADMAP.md)
restano separati. Questo documento non autorizza refactoring o migrazioni.

## Punto di partenza — AS-IS

Oggi l’app privata usa due membri preconfigurati N/V, un catalogo `movies`,
seen/voti/testi personali in colonne N/V, candidatura `in_shared_list` e
`movie_nights` per gli eventi condivisi. Together deriva esclusivamente da
completed; voto/recensione N+V sono sul film, snack/luogo sulla singola serata.
Non esistono gruppi multipli, serie, community o recommendation engine generale.

Il runtime usa HTML/JavaScript vanilla/CSS, dipendenze CDN, script classici,
stato globale e domini store/UI separati. Realtime core unico, canale Match
separato, Supabase Auth/app_members e RLS verificati. Programmazione solo negli
eventi tramite RPC, legacy congelato. La mappa runtime è in
[AGENTS](../AGENTS.md); inventario del refactoring storico nel MASTER_CONTEXT;
[Auth/Supabase](AUTH_SUPABASE.md) e [transizione dati](DATA_MODEL_TRANSITION.md)
conservano i contratti tecnici. Questa visione non sostituisce quei vincoli.

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

## Direzione del modello — TO-BE, da progettare in Fase 4

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

Sono entità concettuali, **non uno schema SQL approvato**. Cardinalità,
identificativi, vincoli, rating di gruppo rispetto a rating della singola
visione e visibilità vanno definiti nel target data model. Uno stesso contenuto
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
| seen_rating_together/review_text_together | Valutazione condivisa oggi a livello film; destinazione futura da decidere senza inventare un voto per ogni evento |
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

La prossima grande fase è Discovery & Recommendation Engine, **prima** della
progettazione multiutente e delle serie. Separare recommendation personale
(«cosa piace a me») da recommendation del gruppo («cosa funziona qui»).

Gli esempi `recommend(user_id)` e `recommend(group_id)` esprimono due contesti,
non funzioni già presenti o una firma API definitiva. Una prima implementazione
può usare adattamenti semplici dei dati privati esistenti; deve poter evolvere
senza assumere che due colonne N/V esauriscano il dominio.
Cosa Guardiamo?, Ruota, Surprise e Match Live potranno condividere segnali e
candidati mantenendo interazioni e contratti espliciti. Non cambiare ora
pendingMatch, Continua, metriche o sessioni per anticipare questa convergenza.

## Series, gruppi e community

Series → Seasons → Episodes richiede un dominio e un tracking dedicati.
Membri dello stesso gruppo possono essere a episodi differenti: progresso
personale e condiviso vanno rappresentati separatamente. Account/profili e
lobby seguono l’ordine della roadmap, senza diventare prerequisiti per iniziare
la Fase 1.

**MY RATING**, **GROUP/VIEWING RATING** e **COMMUNITY RATING** sono concetti
distinti. Il futuro livello community richiede regole di pubblicazione,
privacy e aggregazione proprie; un dato personale/condiviso non è pubblico
perché partecipa a un calcolo di raccomandazione.
