# Discovery locale v76 — sei proposte, informazione e rotazione

**Retrieval aggiornato localmente:** [Discovery Retrieval 2.0](DISCOVERY_RETRIEVAL_V2.md) sostituisce le sezioni di questo checkpoint su quattro pool, tre pagine globali, riserve e cursori. I conteggi qui sotto sono storici. Restano invariati Six Picks, memoria esposizioni, gate qualità/informativo e azioni native; è rimossa la seconda frase esplorativa generica.

Implementato solo localmente; nessuna release, rete live, scrittura Supabase o modifica delle azioni native. Questo documento sostituisce le sezioni su copy, cinque proposte e quality gate delle precedenti note Discovery. I profili personali/Together, Core v75, Core 2.0, Adapter e consumer Dalla Lista sono conservati.

## Sei proposte e budget

La pipeline Discovery richiede sei titoli; Dalla Lista continua a richiederne cinque. La griglia esistente a due colonne da 768 px produce tre righe. Le disponibilità di tre, quattro e cinque titoli mostrano il conteggio effettivo, senza riempitivi. Tutte le card aprono il Movie Detail condiviso con Per noi / Per me invariati.

Ogni avanzamento ha **16 tentativi HTTP complessivi**, condivisi fra pagine, fallback e dettagli: concorrenza 2, retry massimo 1, riserva prudenziale di due tentativi per richiesta non in cache. I tentativi di retry non utilizzati non sono riciclati. Massimo tre round/pagine; quattro pool pubblici per round. Se il ranking non trova sei ammissibili, si tenta il round successivo col budget residuo. Se un piccolo pool ha altre pagine, i dettagli opzionali sono rimandati a favore del retrieval; nessuna chiamata di enrichment massivo.

Dettagli ordinari: al massimo quattro candidati per round, sempre entro il budget aggregato. Recupero sinossi: al massimo due ID per round, prima `/movie/{id}?language=it-IT&append_to_response=credits`, poi `en-US` soltanto per quelli ancora senza testo utilizzabile. Il fallback precede i dettagli opzionali e conserva titolo italiano e `overviewLanguage`. Tutti i parametri inviati sono pubblici: nessun profilo, voto o identificativo persona viene inviato a TMDb.

429/Retry-After, backoff, timeout, abort e controllo di generazione restano attivi. Un'attesa Retry-After superiore al limite non viene abbreviata. Dalla Lista resta disponibile anche in caso di errore TMDb. Risposte obsolete non pubblicano risultati né esposizioni.

## Quality gate sperimentale `cinematic-quality-v1.2`

Restano voto medio, quantità voti, popolarità limitata logaritmicamente, data di uscita valida e completezza di cinque metadati. Non sono dati di critica o premi. La data deve essere già trascorsa; nessun vincolo sulla lingua originale.

- Consolidato: almeno 100 voti, media almeno 6.
- Classico: almeno 20 anni, 30 voti, media almeno 6,5.
- Recente: al massimo tre anni, almeno 50 voti, media almeno 6,2.
- Nicchia: media almeno 7, almeno 10 voti, completezza almeno 3/5 e almeno tre anni **oppure** almeno 30 voti. Questa via mantiene accessibili anche classici sotto i 30 voti; non attesta lo status di autore/culto.

Correzione concreta: il gate v1.1 ammetteva un recente con 8 voti a 9,5 grazie a trama/poster/genere. La nuova soglia supporto/maturità lo esclude; il campione internazionale del 2018 con 12 voti a 8,1 resta ammesso. I parametri sono prudenziali e sperimentali, non calibrati su dati reali: opere recenti di nicchia poco votate possono essere perse.

Lo shrinkage pubblico resta `(n × media + 100 × 6)/(n+100)`, confidenza `n/(n+100)`. Il punteggio pubblico conserva pesi 0,6 voto corretto, 0,2 supporto, 0,1 popolarità limitata, 0,1 metadati. Un titolo famoso e ben valutato non viene penalizzato per la fama; un mediocre non viene salvato dalla sola popolarità.

**Ordinamento Discovery** `discovery-six-fresh-v1`: prima eligibility/protezioni Core, poi stesso tier di protezione e finestra `near-relevance-v1` di 0,02 rispetto alla massima rilevanza personale rimasta. In quella finestra, soltanto candidati entro 0,06 dalla migliore qualità pubblica competono per qualità, esposizione e diversità. Valore di scelta = score Core + qualità pubblica − penalità esposizione − penalità diversità. Diversità riusa coefficienti e famiglie direttore/genere/collection del Core; non modifica il suo default globale. Together resta distinto nel Core e nel tie-break riproducibile. Una preferenza negativa esplicita non viene aggirata.

La quota esplorativa è una preferenza condizionata, non un obbligo: dopo la prima esplorazione si preferiscono candidati ordinari comparabili. Quando questi sono esauriti possono entrare altre opere di nicchia idonee; non si amplia la finestra di pertinenza per riempire la quota.

## Information gate

La sinossi deve essere testo TMDb: almeno 40 caratteri e otto parole alfabetiche; placeholder espliciti senza trama non passano. È una verifica euristica di contenuto minimo, non un'analisi semantica o una garanzia editoriale. Nessuna trama viene costruita da genere, anno o regia. Il dettaglio italiano ha precedenza; quello inglese è un fallback attendibile ma resta in inglese, senza traduzione inventata.

Il controllo viene ripetuto prima del ranking. Un'opera di nicchia a cui manca solo la sinossi può accedere al tentativo di recupero; solo il testo realmente recuperato può soddisfare il gate finale. Con budget insufficiente il candidato viene omesso, anche se ciò riduce il batch.

## Una sola spiegazione cinematografica

La card contiene un solo paragrafo: premessa dalla vera sinossi, troncata a circa 150 caratteri, più un breve motivo se verificabile. Nessun nome personale, contributo N/V, diagnostica o formula di compatibilità viene renderizzato. Le diagnostiche sintetiche restano strumenti interni separati.

Un richiamo collettivo richiede un contributo Together positivo applicato, supporto almeno due, almeno due diversi film presenti nel catalogo con rating Together almeno 7 e una feature specifica corrispondente: coppia di generi, regista, cast o collection. Il solo genere generico, la durata, il decennio o un giudizio personale non autorizzano questo claim. Il titolo citato è verificato fra i film di evidenza. Un'indicazione esplorativa dice soltanto «Una scoperta da esplorare». In assenza di evidenza comune, restano la trama e, se media almeno 7 su almeno 1000 voti, l'apprezzamento del pubblico **TMDb**, con il numero di voti. Nessun claim di critica/premi o gusto concorde è dedotto dalla trama.

Il Movie Detail mantiene tutta la sinossi e le azioni native; nessuna modifica a salvataggi o semantica condiviso/personale.

## Memoria esposizioni e freschezza

Chiave locale `scorochiatu_discovery_exposures_v1`: array di soli `{id: "tmdb:123", at: timestampMs}`. Massimo 200 elementi, scadenza sette giorni, dedup per ID usando il timestamp massimo; ordinamento stabile timestamp/ID. Nessuna identità utente, titolo, voto, profilo, cronologia dei giudizi o sincronizzazione remota. Dati corrotti/quota/storage non disponibile degradano alla sola memoria della pagina.

Si registra il batch pubblicato, non il pool recuperato o una risposta obsoleta. È un'esposizione di batch, non una misura della reale lettura o visibilità di ciascuna card. La penalità parte da 0,06 e decade linearmente a zero in sette giorni. È temporanea: se tutti sono recenti si producono comunque i titoli ammissibili; qualità e diversità possono consentire riproposizioni. Stessi input, ora/configurazione e registro → stesso output, senza randomizzazione. Entro la sessione `shownIds` resta esclusione rigorosa.

Cache query cinque minuti; dettagli un'ora; massimo 100 risposte pubbliche in memoria. Un nuovo avanzamento dopo cinque minuti invalida anche il pool UI e riparte dalle query, conservando gli ID esclusi nella sessione. Alla riapertura il client è nuovo e il registro locale resta. Nessun polling in background: la scadenza opera al successivo utilizzo. Cambi di giudizi/catalogo riconciliano silenziosamente il batch e ricalcolano i profili; gli ID entrati nel catalogo vengono rimossi. Le azioni native restano l'unico percorso di acquisizione.

## Risultati verificati

Fixture pubbliche/sintetiche, nessun dato personale o collegamento TMDb live:

| Caso | Prima | Dopo |
|---|---|---|
| 80 risultati grezzi, quattro pool | 52 idonei, batch 5, 8 richieste | 36 idonei, batch 6, 8 richieste |
| Tre titoli validi per pagina, due pagine | primo batch limitato al primo pool | sei titoli, 8 richieste effettive / 16 tentativi riservati |
| Trama recuperabile (uno IT, uno EN) | non obbligatoria | due candidati informativi, 7 richieste effettive |
| Campione fisso di nove opere | cinque titoli, incluso uno senza trama | cinque validi: niente riempitivo per il sesto slot |
| Riapertura browser, pool arricchito | nessuna memoria tra aperture | cinque titoli diversi su sei; penalità morbida |

[Confronto riproducibile dei nove candidati](DISCOVERY_SIX_FRESHNESS_FIXTURES.json), generato da `node scripts/compare-discovery-six.cjs --write`. Il bridge precedente è riprodotto nello script usando lo stesso Core congelato, pool, giudizi e data; le nuove esclusioni qualità/informazione sono riportate separatamente. Non è un benchmark predittivo a eligibility identica e non dimostra superiorità NDCG. I nomi «autore»/«internazionale» descrivono casi sintetici, non riconoscimenti certificati.

Verifiche finali: suite locale complessiva 77/77; v75 132/132; Match 105 casi/359 assert; acquisizione nativa 6/60; Movie Detail 29/151; rimozione Lista 3/25; serate 15/75. Browser Discovery 154 controlli, 320/390/768/1280 px, otto temi, sei card, desktop 2×3, sinossi, spiegazioni senza attribuzioni, salvataggi simulati e scadenza dopo giorni. Browser consumer v75 17/17. Screenshot `/tmp/sc-discovery-ux`. CSS reale con shim Tailwind locale e risorse esterne simulate: verifica di layout/accessibilità e comportamento, non certificazione visiva delle CDN né test su telefono fisico. `git diff --check` e controllo whitespace dei file untracked del presente intervento PASS.

La qualità reale e il numero di richieste reali restano da valutare nella verifica finale autorizzata: i numeri sopra sono quelli effettivamente eseguiti dai transport simulati. Nessuna release avviata.

## File del presente intervento

- `index.html` — caricamento del registro esposizioni.
- `js/recommendation/cinematic-quality.js`, `discovery-tmdb.js`, `discovery-pipeline.js` — gate, fallback e ordinamento Discovery.
- `js/ui/discovery-copy.js`, `discovery-exposures.js`, `discovery-view.js` — testo collettivo, memoria locale, sei proposte e rinnovo pool.
- `scripts/verify-discovery-tmdb.cjs`, `verify-discovery-refinement.cjs`, `verify-discovery-native-diagnostics.cjs`, `verify-discovery-view-browser.cjs` — fixture e aspettative aggiornate.
- `scripts/verify-discovery-six-fresh.cjs`, `compare-discovery-six.cjs`, `diagnose-discovery-native.cjs` — nuovi casi, confronto e diagnostica interna.
- `docs/DISCOVERY_SIX_FRESHNESS.md`, `DISCOVERY_SIX_FRESHNESS_FIXTURES.json`, `DISCOVERY_NATIVE_DIAGNOSTICS.json`, `DISCOVERY_NATIVE_ACTIONS_QUALITY.md` — risultati e distinzione fra note storiche e comportamento corrente.

I cambiamenti locali preesistenti a CSS, Movie Detail, ProductContext, TARGET shell e test di acquisizione restano preservati. Nessun file dello storico N o backup è stato toccato.

Suite riproducibile:

```sh
node --test scripts/verify-discovery-tmdb.cjs scripts/verify-discovery-refinement.cjs scripts/verify-discovery-save.cjs scripts/verify-discovery-six-fresh.cjs scripts/verify-discovery-native-diagnostics.cjs scripts/verify-recommendation-ranking-v2.cjs scripts/verify-recommendation-diversity.cjs scripts/verify-recommendation-profiles.cjs
node scripts/verify-recommendation.js
node scripts/verify-target-match-adapter.cjs
node scripts/verify-production-shell.cjs 'Discovery native acquisition'
node scripts/verify-production-shell.cjs detail
node scripts/verify-production-shell.cjs 'list removal'
node scripts/verify-production-shell.cjs night
git diff --check
```

Il browser harness usa Playwright/Chromium locali con i parametri già configurati nel workspace. I moduli congelati `core.js`, `config.js`, `adapters.js` e `ui/recommendations.js` hanno diff vuoto rispetto a HEAD.
