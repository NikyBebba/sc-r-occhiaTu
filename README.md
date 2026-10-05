# sc(r)occhiaTu 🎬

**Un piccolo cinema per due utenti: scegliere un film, organizzare la serata e ritrovare le visioni passate.**

sc(r)occhiaTu è una web app pensata per rendere più semplice e divertente la domanda «Che film si guarda?». Due utenti costruiscono una lista comune, esprimono le proprie preferenze e scelgono cosa vedere attraverso un Match, una ruota della fortuna o una proposta diretta.

L'esperienza parte dalla scelta e continua dopo il film: appuntamenti, voti, recensioni, saghe e ricordi delle serate. Il tono è cinematografico e leggero, con attenzione all'uso da smartphone. Può essere uno spazio per amici, coinquilini o una coppia: conta condividere i film.

## Come funziona

1. **Costruire la libreria.** Cercare film, scegliere la locandina corretta e aggiungerli alla lista. Ogni film conserva il proprio autore, i metadati disponibili e lo stato di visione.
2. **Scegliere cosa guardare.** Con Match Live entrambi scorrono i film: due preferenze positive producono un Match. La Ruota sceglie a caso dalla lista filtrata; in alternativa si può proporre direttamente un titolo.
3. **Organizzare la proiezione.** Scegliere «Stasera» oppure programmare data, ora e snack. Le proposte programmate possono essere confermate dall'altro utente; il calendario raccoglie gli appuntamenti.
4. **Lasciare un voto o un commento.** Ogni utente può registrare le proprie visioni e valutazioni; una visione condivisa ha voto e recensione distinti da quelli personali.
5. **Continuare l'esperienza.** Consultare gli altri capitoli di una saga, aggiungerli esplicitamente alla lista e ritrovare serate e recensioni in Ricordi.

## Funzioni disponibili

- **Libreria condivisa:** ricerca TMDb, picker dei risultati, importazione in blocco, dettagli e trailer disponibili, filtri e ordinamento. Controllo duplicati tramite ID del film.
- **Match Live:** sessione sincronizzata su due dispositivi, swipe e riconoscimento dei film apprezzati da entrambi. La percentuale di accordo riguarda la sessione di Match.
- **Ruota e sorprese:** scelta casuale con filtri, veto settimanale per ciascun utente, film sorpresa con locandina nascosta fino alla rivelazione e confetti al risultato.
- **Serate e calendario:** proposte, conferme, scelta rapida, promemoria, snack personalizzati e luogo facoltativo. Rivedere un film crea un nuovo evento e conserva lo storico.
- **Voti e recensioni:** scala 0–10 con un decimale, tastierino mobile e supporto a punto o virgola. Valutazioni personali e condivise separate; il testo è facoltativo e può essere rimosso mantenendo il voto.
- **Saghe:** capitoli TMDb in ordine di uscita, stato dei film già presenti e suggerimento dopo una nuova visione. Nessuna aggiunta automatica: si scelgono i capitoli da salvare.
- **Film al cinema e prossimamente:** possono restare in libreria ed essere programmati, con esclusione da Ruota e Match finché sono segnati per il cinema. I capitoli di saga con uscita futura ricevono questa indicazione.
- **Ricordi / Titoli di coda:** storico mensile delle serate e quattro riepiloghi: voto medio, voto più alto, genere più visto e film aggiunti per autore. Voti e commenti sono raccolti in «Dopo il film».
- **Ticket cinematografico:** immagine PNG scaricabile con locandina, titolo, origine della scelta e dati disponibili della serata.
- **Atmosfere automatiche:** quattro stagioni e quattro festività, con cambio secondo il calendario e scelta manuale temporanea. Suoni e vibrazione sono facoltativi sui dispositivi compatibili.
- **PWA e sincronizzazione:** app installabile, aggiornamenti dell'app-shell e dati condivisi tramite Realtime. Se la connessione non è disponibile, viene segnalata la modalità locale.

## Architettura

Il progetto usa **HTML, JavaScript vanilla ES6 e CSS**, senza framework o bundler. Tailwind CSS, Font Awesome e il client Supabase sono caricati via CDN.

- **Supabase** conserva i film, gli eventi delle serate, le sessioni di Match e i dati di interazione. Realtime aggiorna il secondo dispositivo.
- **TMDb** fornisce ricerca, dettagli, locandine e collection; **OMDb** integra metadati e valutazioni esterne.
- **Canvas 2D** gestisce Ruota e ticket PNG.
- **localStorage** conserva un mirror e il fallback locale; il service worker gestisce l'app-shell della PWA.

La distinzione centrale è **film = contenuto, serata = evento**. Uno stesso film può avere più serate, senza perdere le date e i luoghi dei rewatch. I voti appartengono al film e restano separati tra personali e condiviso.

L'implementazione attuale gestisce **uno spazio con due profili preconfigurati** e ingresso tramite PIN lato client. Non include registrazione o gestione di gruppi indipendenti. I profili e la configurazione dei servizi sono in `js/config.js`; chiavi e PIN non vanno riportati in documentazione o log. Il PIN è un deterrente locale, non un sistema di autenticazione server; le policy Supabase pubbliche fanno parte del modello attuale.

## Avvio locale

Dalla radice del repository:

```sh
python3 -m http.server 8000
```

Aprire `http://localhost:8000`. Non è richiesto un passaggio di build. Per una propria istanza occorre configurare i servizi e applicare schema e migration versionate in [`database/`](database/). I file SQL descrivono la struttura; non contengono esportazioni dei dati.

| Percorso | Contenuto |
| --- | --- |
| `index.html`, `css/`, `js/` | Interfaccia e moduli dell'app |
| `manifest.json`, `service-worker.js`, `icons/` | PWA e cache dell'app-shell |
| `scripts/` | Import, aggiornamento metadati e verifiche |
| `data/movie-watchlist.json` | Lista iniziale dei titoli |
| `database/` | Schema e migration Supabase |
| [`docs/MASTER_CONTEXT.md`](docs/MASTER_CONTEXT.md) | Stato tecnico, decisioni e roadmap |
| [`AGENTS.md`](AGENTS.md) | Regole per lo sviluppo |

## Verifiche e stato corrente

```sh
node scripts/smoke.js
node scripts/verify-sw.js
```

Checkpoint del 5 ottobre 2026: **369/369 smoke test** e **12/12 controlli del service worker** superati, controlli sintassi e diff senza errori. Cache PWA `v44`. Login, home, voti, Ricordi e saghe sono stati verificati anche in Chromium con dati di prova e screenshot a larghezze mobile e tablet.

La migration dei voti decimali è stata applicata sull'istanza di riferimento. Restano da verificare su due telefoni reali il tastierino nativo e la sincronizzazione degli ultimi flussi di voti, recensioni e saghe. Il dettaglio delle verifiche, delle migration e dei limiti è nel [master context](docs/MASTER_CONTEXT.md).

Specifiche: [voti decimali](docs/PHASE38_DECIMAL_RATINGS.md), [saghe](docs/PHASE41_SAGHE.md), [Ricordi e statistiche](docs/PHASE23_MOVIE_CHEMISTRY.md), [timeline mensile](docs/PHASE22_TIMELINE.md).

## Possibili evoluzioni

La base attuale può essere sviluppata attraverso raccomandazioni, statistiche personali, piccoli traguardi ludici e strumenti aggiuntivi per programmare le proiezioni. Sono idee da progettare e verificare in fasi dedicate.

Un'eventuale apertura ad altre coppie di utenti o a più spazi condivisi richiederà una progettazione specifica di profili, accessi e separazione dei dati. È una direzione possibile, **non una funzionalità già disponibile**. La roadmap aggiornata rimane nel [master context](docs/MASTER_CONTEXT.md).
