# sc(r)occhiaTu 🎬

**Scegliere un film, organizzare la visione e trasformarla in un ricordo.**

sc(r)occhiaTu è oggi una web app privata per due utenti preconfigurati. Una
lista comune, Match Live, Ruota e sorprese rendono la scelta un’esperienza
condivisa, con un tono leggero e cinematografico e un’interfaccia mobile-first.

La direzione di prodotto copre il ciclo **discovery → proposta → decisione
condivisa → programmazione → visione → valutazione → ricordo**. Il tracking
personale resta importante; le interazioni tra persone sono un elemento
centrale della value proposition.

## Stato corrente — IMPLEMENTED + RELEASED + PRODUCTION v61

[Produzione](https://sc-r-occhia-tu.vercel.app/): release conclusa e verificata,
commit `c8dfa6b9b370d75520d423413d8ca2506b285d39`,
`perf: add bounded movie pagination`, **PWA/cache scorochiatu-shell-v61**.
Push su main completato, HEAD locale/origin/main/remote main allineati alla finalizzazione runtime;
Vercel production verificata.
Verifica registrata: **45/45 file hosted HTTP 200 e identici al commit**,
smoke produzione **14 controlli PASS**, responsive 320/390/768 PASS; fixture
production-test 436 film con massimo 24 card. Zero errori JS online, asset
mancanti o richieste Supabase durante lo smoke; nessuna operazione database.
Questi esiti appartengono alla release; non sono nuovi test
live di questo aggiornamento documentale.

La precedente release `91ecb9b4adeb82cefb7d5fdbd1a2e1a54bd7a248`,
`feat: redesign movie cards and add history search`, è inclusa: card con
progressive disclosure, Gestione compatta, valutazioni contestuali e ricerca
locale nello Storico personale. Trailer e Continua la saga restano indipendenti;
il veto settimanale si gestisce nel dettaglio.

La v60 conserva le serate con orario raggiunto anche oltre mezzanotte/reload,
senza duplicazioni o scadenze artificiali. Ricordi parte con tutte le sezioni
chiuse a ogni apertura e conserva le aperture manuali nei rerender dello stesso
modal. Snack e luogo della specifica serata Together si modificano da
**Gestione → Valutazioni → N+V → modifica**; snack vuoto salva NULL.
Voto/testo N+V restano dati del film, distinti dai dettagli del singolo evento.
La migration incrementale snack è stata applicata manualmente dall’utente;
non va rieseguita né va modificata la migration storica v54.

## Esperienza disponibile

Fase 0.5A **rilasciata in produzione v61**: [paginazione limitata a 24 card e
hardening delle liste](docs/BOUNDED_PAGINATION.md). NAV-01 resta **OPEN**:
osservato su device reale, non riprodotto nel harness, root cause non identificata.
La paginazione non è un fix dimostrato di NAV-01.

- **Libreria e Storico:** ricerca/picker TMDb, dedup, filtri, viste Streaming/Cinema,
  card e dettaglio. Storico N/V usa il rispettivo stato personale, con ricerca
  locale per titolo/regista e ordine alfabetico, anche fuori dalla Lista.
- **Scelta condivisa:** Match Live sincronizzato su due dispositivi, Ruota con
  filtri e confetti, sorprese e un veto settimanale per persona.
- **Serate:** Oggi, proposte/conferme, snack/luogo, calendario, completamento e
  rewatch. Un film può avere più eventi senza perdere lo storico.
- **Valutazioni e Ricordi:** voti personali e N+V 0–10 con un decimale,
  recensioni facoltative e rimozioni contestuali; serate concluse, timeline e
  quattro riepiloghi in Titoli di coda.
- **Esperienza cinematografica:** saghe TMDb con aggiunta esplicita, ticket PNG,
  otto temi automatici, audio/vibrazioni opt-in e ciak loader.
- **Accesso e sincronizzazione:** Account/Password, Ricordami, recovery e
  Password dimenticata?, Supabase Auth/RLS e Realtime privato, PWA installabile.

Together deriva soltanto da serate completed: colora entrambi i pallini N/V
oro senza cambiare seen_n/seen_v. Candidatura e stato personale sono indipendenti;
“Segna come non visto” conserva voto, recensione, candidatura ed eventi.

## Architettura attuale

HTML, **JavaScript vanilla ES6** e CSS, senza framework/bundler/backend nuovo.
Tailwind Play, Font Awesome e Supabase JS v2 via CDN; TMDb/OMDb per metadati,
canvas 2D per Ruota e ticket. Moduli per dominio con script classici e stato
globale, Realtime core unico e canale Match separato.

**Film = contenuto; serata = evento.** La programmazione vive solo in
`movie_nights`, con scritture tramite `manage_movie_night`. I vecchi campi di
programmazione sui film sono congelati, senza fallback/dual-write runtime.
`votes` resta legacy, senza I/O remoto né uso nel core.

Oggi esiste uno spazio con due profili preconfigurati: nessun signup, multi-lobby,
serie TV o recommendation engine già disponibile. L’ingresso/restore richiede
verifica online Auth/membership; il mirror offline è ammesso solo nel runtime
già autorizzato con JWT valido. Errori Auth/RLS non autorizzano fallback.

**Debito noto, non bloccante:** online verificato; l’app-shell offline si carica,
ma il test offline mostra `tailwind is not defined`, collegato alla dipendenza
Tailwind CDN: debito preesistente, non introdotto dalla v60 né dalla v61 e non bloccante per
la produzione online. Full offline capability non ancora raggiunta.

## Documentazione ufficiale

| Documento | Scopo |
| --- | --- |
| [MASTER_CONTEXT](docs/MASTER_CONTEXT.md) | Stato operativo AS-IS, semantiche, import concluso e checkpoint storici |
| [PRODUCT_ROADMAP](docs/PRODUCT_ROADMAP.md) | Value proposition, Fasi 0–10, PLANNED ed EXPLORATORY |
| [ARCHITECTURE_VISION](docs/ARCHITECTURE_VISION.md) | Principio Content/User/Group/Community, direzione TO-BE |
| [AGENTS](AGENTS.md) | Architettura runtime e regole operative/sicurezza |
| [Auth/Supabase](docs/AUTH_SUPABASE.md) | Login/recovery, RLS, limiti e procedure storiche/d’emergenza |
| [Modello film e visioni](docs/INDIVIDUAL_WATCH_REWATCH.md), [Transizione dati](docs/DATA_MODEL_TRANSITION.md) | Personali, candidatura, Together, rewatch e legacy |
| [Movie cards](docs/MOVIE_CARD_DISCLOSURE.md) | Disclosure, valutazioni, veto e ricerca Storico |
| [Movie nights v60](docs/MOVIE_NIGHTS_MIDNIGHT_MEMORIES.md), [Proiezioni](docs/PROIEZIONI.md) | Lifecycle oltre mezzanotte, snack/luogo e RPC |
| [Navigazione/Ricordi](docs/UX_NAVIGATION_MEMORIES.md), [Timeline](docs/PHASE22_TIMELINE.md), [Riepiloghi](docs/PHASE23_MOVIE_CHEMISTRY.md) | UX e memoria condivisa |
| [Decimali](docs/PHASE38_DECIMAL_RATINGS.md), [Saghe](docs/PHASE41_SAGHE.md), [Cinema](docs/PHASE8_3_CINEMA_WATCHLIST.md) | Contratti specifici e verifiche storiche |

Import JustWatch concluso: **354/354 titoli risolti, 337 nuovi film, 436 totali
al termine dell’import**. Shared list, seen_v e Together preservati, nessun
evento o voto/recensione inventato. Eccezioni intenzionali e successiva visione
personale N di Scary Movie nel MASTER_CONTEXT. Artefatti dell’import fuori Git;
`data/movie-watchlist.json` è la lista iniziale storica, non il catalogo corrente.

## Avvio e verifica locale

```sh
python3 -m http.server 8000
```

Aprire `http://localhost:8000`; nessun build richiesto. Runtime in `index.html`,
`css/`, `js/`; PWA in manifest/service worker/icons; strumenti in `scripts/`;
schema/migration in `database/`, senza dump. Le migration applicate in produzione
non sono istruzioni da rieseguire per avviare il progetto.

```sh
node scripts/smoke.js
node scripts/verify-sw.js
node scripts/verify-auth.js
```

Suite specifiche e distinzione tra fixture locali e collaudi reali nei documenti
sopra. Non eseguire manutenzione live come test locale; nessuna password/token
nel repository e nessuna service-role frontend.

## Prossima direzione — PLANNED

**Discovery & Recommendation Engine è la prossima grande fase**, prima di
multiutente e serie. Raccomandazioni personali e di gruppo restano distinte;
Cosa Guardiamo?, Ruota, Surprise e Match Live potranno diventare superfici del
medesimo motore di raccomandazione/decisione. La roadmap ordina le espansioni e
la visione architetturale guida le nuove feature senza refactoring prematuri.
