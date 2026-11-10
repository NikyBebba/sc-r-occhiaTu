# Discovery Retrieval 2.0 — correzione locale, non rilasciata

**Correzioni successive ai findings live:** [Final Corrective Pass](DISCOVERY_FINAL_CORRECTIVE_PASS.md) aggiorna formato, qualificazione della nicchia, spiegazioni, feedback e guardia franchise. Sette pool e cursori restano invariati; i numeri di questo documento descrivono il checkpoint precedente.

## Causa verificata nel codice

I quattro pool precedenti erano `popular` (popularity.desc, >=100 voti/media6, nessun limite inferiore di data), `classic` (vote_average.desc, >=30/media6,5, fino al 2006 nel fixture 2026), `recent` (popularity.desc, >=50/media6,2, dal 2023), `niche` (vote_average.desc, >=5/media7, nessun limite inferiore). Tutti avevano lingua metadati italiana, adult/video false e limite superiore alla data corrente.

Popular e recent si sovrapponevano; i pool ordinati per media potevano anteporre concerti con supporto limitato. Il Quality Gate pubblico non identificava il formato concerto. Non esisteva una sorgente specifica per 1980–1999, 2000–2014, 2015–2022 o per riconoscimento storico tramite quantità di voti. Una sola pagina globale avanzava per tutti i pool, solo quando tutte le query riuscivano. Alla terza pagina `hasMore=false` anche con altre pagine TMDb disponibili. All'uscita il cursore si perdeva: si ripartiva da pagina 1; gli ID esposti davano solo una penalità morbida. La cache era locale all'istanza, query cinque minuti/dettagli un'ora: non conservava l'avanzamento.

Il budget di 16 riservava due tentativi per ciascuna chiamata anche dopo un successo al primo tentativo. Quattro query più quattro dettagli eseguivano otto chiamate e impegnavano tutti i sedici slot. Il messaggio «tutte le proposte disponibili» descriveva quindi spesso il limite della ricerca, non l'esaurimento del catalogo.

## Strategia implementata

Nuovo modulo puro `discovery-catalog.js`; il retrieval resta separato dal ranking. Nessuna modifica a Core v75, Core 2.0, Adapter, profili, consumer Lista, runtime di salvataggio, Auth, Match, Ruota o serate.

| Area | Date | Supporto query | Ordinamenti alternati |
|---|---|---|---|
| classics | 1870–1979 | >=30 voti, media >=6,5 | vote_count.desc / vote_average.desc |
| eighties_nineties | 1980–1999 | >=50, >=6,5 | stessi |
| millennium | 2000–2014 | >=100, >=6,5 | stessi |
| modern | 2015–2022 | >=100, >=6,5 | stessi |
| recent | 2023–oggi, già usciti | >=100, >=6,5 | stessi |
| international | fino all'anno corrente meno tre | >=10, >=7 | stessi, per fr/ja/ko/es/it/fa |
| recognized | fino al 2022 | >=300, >=6,5 | stessi |

Le query generali non hanno filtro di lingua originale: includono anche opere anglofone. Le sei lingue dedicate ampliano la copertura, senza rappresentare tutto il cinema internazionale né certificare lo status d'autore. «Recognized» è un percorso a supporto pubblico consolidato, non una certificazione critica. I parametri usano i filtri ufficiali [Discover Movie](https://developer.themoviedb.org/reference/discover-movie).

Si consultano prima i segmenti meno visitati, poi l'ordinamento/lingua meno visitato di quel segmento. Massimo sei query per round, tre round per azione, sempre nel budget condiviso. La prima ricerca copre cinque periodi e una lingua internazionale; recognized ha priorità nel round successivo. Nessun parametro viene derivato dai gusti N/V.

Ogni pagina TMDb fornisce fino a 20 righe. L'harvest progressivo ne esamina dieci alla volta, quattro per il segmento recent: ciò riduce l'iniezione iniziale di novità senza cambiare pesi Core. L'offset persistito recupera il resto della pagina al successivo passaggio: nessuna riga viene scartata solo perché fuori dalla prima finestra. Questo è un limite di acquisizione per query, **non una quota nel batch finale**; un test con soli recenti restituisce comunque sei recenti accumulando più finestre. Non ci sono quote temporali nel ranking.

## Cursori e scadenza

Chiave per dispositivo `scorochiatu_discovery_cursors_v2`, distinta dal registro esposizioni già esistente. Solo versione, scadenza e 24 track pubblici (segmento/ordinamento/lingua) con pagina, offset, total_pages, numero visite e ultima consultazione. Nessun titolo, film personale, voto, profilo o account. Normalizzazione whitelist, stato serializzabile e ordinamento riproducibile, fallback in memoria se storage non disponibile. TTL cursori 14 giorni.

Le track riuscite avanzano singolarmente; una query fallita resta sulla stessa pagina. Le risposte obsolete non pubblicano candidati né cursori. `reset()` interrompe il caricamento ma conserva il fronte; il restart esplicito è disponibile per test. Uscita/rientro prosegue i track salvati, invece di ricominciare gli stessi quattro pool.

Cache query cinque minuti, dettagli un'ora, cap 100. Il pool UI scade dopo cinque minuti e il prossimo utilizzo riprende il fronte con query aggiornate; gli ID mostrati nella sessione restano esclusi. Una track realmente arrivata a total_pages viene riaperta dopo cinque minuti, perché un risultato vuoto non può bloccare le nuove disponibilità per 14 giorni. Il cap di venti pagine per track resta invece esplicito fino alla scadenza del cursore. Un timer di sola presentazione riabilita il comando dopo scadenza anche a vista aperta; non avvia rete in background.

`MORE_SEGMENTS` indica ricerca ancora disponibile; `SEARCH_WINDOW_LIMIT` indica il cap applicativo; `SEGMENTS_EXHAUSTED` indica soltanto l'esaurimento dei percorsi/risposte consultabili con questi filtri. Tutti sono scoped: **nessuno attesta l'esaurimento dell'intero TMDb**. Il testo UI dice «Non ci sono altri titoli nei percorsi esplorati per ora». Non si promettono sei risultati.

## Documentari, concerti e ambiguità

Non è applicato `without_genres=99` né una blacklist indiscriminata di Musica. Si escludono marker espliciti di film-concerto, concerti registrati, raccolte di videoclip/compilation musicali e special TV non pertinenti. Gli indizi sono titolo originale/localizzato, sinossi, generi e keyword **di formato** già nel dettaglio. Per esempio `concert film`, `filmed concert`, `music video compilation` identificano un formato; la keyword generica `concert` da sola non basta. Un titolo Live at/In concert combinato con genere musicale/documentario/TV è trattato come performance registrata.

Un documentario musicale o TV con formato ambiguo riceve priorità per un dettaglio limitato e viene trattenuto se non chiarito; i documentari investigativi e i ritratti biografici informativi restano ammissibili con i normali gate. Fiction musicale e documentari cinematografici sono coperti dai test. Non si deduce qualità da premi o critica non disponibili.

I dettagli usano `append_to_response=credits,keywords`, supportato dal [contratto TMDb](https://developer.themoviedb.org/docs/append-to-response): nessuna richiesta keyword separata, nessuna keyword nei profili o in persistenza. Le regole testuali sono conservative e possono perdere documentari musicali legittimi o non riconoscere descrizioni ambigue/non localizzate: non sono una classificazione semantica universale.

## Qualità, affinità, informazione, esposizione

Il gate cinematografico `cinematic-quality-v1.2` e i pesi del ranking sono invariati. Il retrieval produce candidati. Una sola corrispondenza di genere non attribuisce più la lane «supported»: servono segnali specifici supportati (regia/cast/collection), oppure coppie di generi supportate per la lane combination. Le protezioni Core restano autorevoli.

Le diagnostiche separano qualità pubblica e motivo di ammissione, affinità/confidenza/supporto personali e tie-break Together, gate informativo, formato, penalità esposizione e provenienza pool. Nel confronto cold start l'affinità è zero: nessun candidato viene descritto come compatibile grazie alla sola qualità pubblica.

La card conserva la premessa narrativa TMDb. Tolta la seconda frase vuota «Una scoperta da esplorare». Un'aggiunta compare soltanto per una vera evidenza collettiva specifica verificata o per apprezzamento pubblico TMDb con almeno 1000 voti e media >=7. Nessun nome N/V, diagnostica, similitudine generica o claim critico. Movie Detail e azioni native invariati.

## Diagnostiche e confronto riproducibile

`node scripts/compare-discovery-retrieval.cjs --write` genera [risultati completi](DISCOVERY_RETRIEVAL_V2_FIXTURES.json). Il retriever precedente è conservato in una fixture con sola strumentazione dei conteggi, senza cambiarne il comportamento. Stesso catalogo pubblico sintetico, stessi profili cold start, stessa pipeline/Core, data e budget. Lo stesso valutatore qualità/informazione/formato valuta entrambi: l'esclusione di formato è intenzionalmente nuova, quindi l'eligibility operativa non è identica. Nessun film reale o giudizio personale è interrogato.

Due cataloghi: stress con forte pressione di recenti/performance (382 righe) e controllo cinematografico senza performance (282). Dodici batch, riapertura dopo il sesto, esposizioni mantenute; gli ID della sessione si azzerano solo alla riapertura, come in UI. Conta sia ripetizioni fra aperture sia varietà cumulativa. Il catalogo contiene cinque anni rappresentativi; non simula la distribuzione reale TMDb.

### Distribuzione anni, 72 suggerimenti per esperimento

| Anno | Stress prima | Stress dopo | Controllo prima | Controllo dopo |
| 1965 | 34 | 12 | 18 | 17 |
| 1988 | 0 | 20 | 14 | 17 |
| 2008 | 0 | 16 | 2 | 13 |
| 2018 | 0 | 20 | 0 | 17 |
| 2026 | 38 | 4 | 38 | 8 |

### Contributo cumulativo pool nello stress test

Le membership si sovrappongono: un candidato può provenire da più query; non sommare queste colonne per ottenere il numero di film.

| Prima: pool | Contributi | Dopo: area | Contributi |
|---|---:|---|---:|
| popular | 38 | recent | 4 |
| recent | 38 | classics | 8 |
| classic | 34 | modern | 18 |
| niche | 33 | millennium | 14 |
| — | — | international | 7 |
| — | — | eighties_nineties | 16 |
| — | — | recognized | 10 |

### Funnel della prima ricerca nello stress test

Raw = righe ricevute dalla query; valid = righe esaminate nella finestra che hanno identità/metadati minimi; canonical = dedup/conflitti; eligibility = catalogo/serate/possibili duplicati; format include i casi trattenuti per verifica fino al controllo finale; quality/information sono gate separati. Conteggi per membership pool, non additivi.

| Fase / pool | Raw | Valid | Canonical | Eligibility | Format | Quality | Information | Finali |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| before / popular | 20 | 20 | 20 | 20 | non applicato | 20 | 19 | 19 |
| before / classic | 20 | 20 | 20 | 20 | non applicato | 20 | 20 | 20 |
| before / recent | 20 | 20 | 20 | 20 | non applicato | 20 | 19 | 19 |
| before / niche | 20 | 20 | 20 | 20 | non applicato | 19 | 19 | 19 |
| after / classics | 20 | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| after / eighties_nineties | 20 | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| after / millennium | 20 | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| after / modern | 20 | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| after / recent | 20 | 4 | 4 | 4 | 4 | 4 | 4 | 4 |
| after / international | 20 | 10 | 10 | 10 | 10 | 10 | 10 | 10 |

Totali unici dopo i gate della prima ricerca: 39 prima, 46 dopo. La prima raccolta dopo non include ancora recognized; quel percorso parte alla successiva necessità di retrieval. I filtri catalogo/serate non eliminano righe in questa specifica fixture pubblica: sono esercitati nelle suite separate.

### Primi sei finali: provenienza, anno e ammissione

| Fase | Pos. | ID sintetico | Anno | Pool | Gate ammissione | Formato |
|---|---:|---|---:|---|---|---|
| before | 1 | tmdb:362 | 2026 | popular, recent | recent | RECORDED_PERFORMANCE |
| before | 2 | tmdb:363 | 2026 | popular, recent | recent | RECORDED_PERFORMANCE |
| before | 3 | tmdb:364 | 2026 | popular, recent | recent | RECORDED_PERFORMANCE |
| before | 4 | tmdb:365 | 2026 | popular, recent | recent | RECORDED_PERFORMANCE |
| before | 5 | tmdb:366 | 2026 | popular, recent | recent | RECORDED_PERFORMANCE |
| before | 6 | tmdb:367 | 2026 | popular, recent | recent | RECORDED_PERFORMANCE |
| after | 1 | tmdb:184 | 2026 | recent | recent | CINEMATIC_FORMAT |
| after | 2 | tmdb:183 | 2026 | recent | recent | CINEMATIC_FORMAT |
| after | 3 | tmdb:10 | 1965 | classics | classic | CINEMATIC_DOCUMENTARY |
| after | 4 | tmdb:182 | 2026 | recent | recent | CINEMATIC_FORMAT |
| after | 5 | tmdb:181 | 2026 | recent | recent | CINEMATIC_FORMAT |
| after | 6 | tmdb:145 | 2018 | modern | established | CINEMATIC_DOCUMENTARY |

Il primo batch corretto ha ancora quattro recenti su sei: l'approccio amplia le sorgenti, non impone equilibrio temporale a ciascun batch. Non va presentato come un motore che garantisce una selezione sempre storicamente bilanciata.

### Copertura, costo e limiti osservati

- Stress: 39 → 65 ID unici su 72 esposizioni; fuori formato 72 → 0. I generi osservati passano da solo Musica/Documentario a otto generi; il controllo senza performance conserva otto generi e zero fuori formato.
- Controllo: 40 → 66 ID unici; nessun aumento dei fuori formato (0 → 0). Questi conteggi non misurano pertinenza soggettiva o qualità critica.
- Prima ricerca: 8 richieste effettive / 16 slot impegnati prima; 10 effettive dopo (sei query + quattro dettagli), riserva finale 10. Le riserve retry inutilizzate vengono liberate. Il costo a caricamento è più alto, non gratuito.
- Dodici batch e due aperture: 16 → 20 richieste totali. Gli altri batch consumano il buffer già recuperato.
- Estensione senza riapertura a 40 batch: prima 119 ID unici, di cui 100 fuori formato, 24 richieste, vuoto dal batch 21. Dopo 236 ID unici, zero fuori formato, 120 richieste e ancora `MORE_SEGMENTS`. Due batch restano da quattro; non si esaurisce il catalogo, si raggiunge il budget/fronte dell'azione. Il confronto espone anche questo costo e i batch incompleti.
- Fixture finita di tre film: soltanto tre ID unici, nessuna ripetizione in sessione e poi `SEGMENTS_EXHAUSTED`, con ambito dichiarato. Il test separato sul cap 20 produce `SEARCH_WINDOW_LIMIT`, non «catalogo esaurito».

Concorrenza massima 2, retry 1, 429/Retry-After e stale guards conservati; massimo 16 tentativi complessivi per azione. I test coprono liberazione delle riserve, fallimenti parziali, scadenze, paginazione/offset, cold start e riapertura. Nessun dato di gusto nei parametri TMDb. La cache obsoleta non blocca Dalla Lista.

## Verifiche e limiti

Le fixture stress sono costruite per riprodurre il problema segnalato: il miglioramento di copertura/formato è reale per tali input, ma **non dimostra superiorità predittiva**. Non esiste una misura della distribuzione live o dei gusti reali N/V. Un paese/lingua o uno status d'autore non è inferibile con certezza dal solo pool. Le regole di formato possono essere conservative; il registry non copre tutte le lingue; il cap resta un limite di ricerca dichiarato. Le track consultate possono contenere candidati validi non scelti prima della chiusura: il buffer non è persistito, quindi quei titoli possono attendere un altro ordinamento o un successivo ciclo. I cursori aiutano la copertura, non garantiscono la visione di ogni film del catalogo.

Comandi: suite `verify-discovery-retrieval-v2.cjs` più le suite Discovery/TasteProfiles/Ranking/Diversity esistenti, `verify-recommendation.js`, controlli sintetici Production Shell per native acquisition/detail/list removal/night, Match adapter, browser Discovery e consumer v75, `git diff --check`. Risultati finali registrati a verifica conclusa sotto.

File del presente intervento: `index.html`; `js/recommendation/discovery-catalog.js`, `discovery-tmdb.js`; `js/ui/discovery-view.js`, `discovery-copy.js`; `scripts/fixtures/discovery-retrieval-before.cjs`, `compare-discovery-retrieval.cjs`, `verify-discovery-retrieval-v2.cjs`, aggiornamenti `verify-discovery-tmdb.cjs`, `verify-discovery-six-fresh.cjs`, `verify-discovery-refinement.cjs`, `verify-discovery-view-browser.cjs`; questo report, relativo JSON e avviso nelle note Six/Freshness. Tutti gli altri lavori locali e gli untracked dello storico N sono preservati.

### Esito finale eseguito

| Verifica | Esito |
|---|---|
| Suite Discovery Retrieval 2.0 dedicata | 14/14 PASS |
| Suite complessiva Discovery, profili, Core 2.0, benchmark/diversità | 91/91 PASS |
| Core v75 | 132/132 PASS |
| Browser Discovery | 157 controlli PASS, 320/390/768/1280, otto temi |
| Browser consumer v75 | 17/17 PASS |
| Match adapter | 105 casi / 359 assert PASS |
| Acquisizione nativa sintetica reale shell/runtime | 6 casi / 60 assert PASS |
| Movie Detail | 29 / 151 PASS |
| Rimozione Lista | 3 / 25 PASS |
| Serate, solo non regressione sintetica | 15 / 75 PASS |
| Diff check, whitespace e sintassi file dell'intervento | PASS |

Il browser completo verifica cursori fra aperture, cache dopo giorni, loading/errori, sei card, scelte native e transizione temporaneo/persistito. La parte isolata dei salvataggi arresta esplicitamente il coordinatore sintetico prima di avviare un secondo controller: una pubblicazione tardiva della shell altrimenti ripristinava la Home e falsava il test. Il teardown è esposto soltanto dalla risposta del server del test; `js/production-session.js` e Auth non sono modificati. Le fixture di errore/catalogo indipendenti azzerano i cursori fra scenari; il test di riapertura conserva invece lo stato.

Screenshot `/tmp/sc-discovery-ux`: CSS reale e shim Tailwind locale, risorse esterne simulate. Quindi verifica locale di comportamento/layout, non test live TMDb, CDN o telefono fisico. I film scelti e le loro trame sono sintetici. I risultati TMDb live possono cambiare ordinamento mentre si attraversano pagine/cache: la deduplica impedisce ripetizioni in sessione, ma non esiste uno snapshot remoto stabile garantito.

La verifica del JSON confronta l'esecuzione attuale con il documento serializzato: report e fixture sono allineati. Nessun commit, push, deploy, migration, accesso Supabase o dato personale reale. Lavoro pronto per review locale, non rilasciato.
