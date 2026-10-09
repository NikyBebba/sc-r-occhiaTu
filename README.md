# sc(r)occhiaTu 🎬

**Un piccolo cinema per due utenti: scegliere un film, organizzare la serata e ritrovare le visioni passate.**

sc(r)occhiaTu è una web app pensata per rendere più semplice e divertente la domanda «Che film si guarda?». Due utenti costruiscono una lista comune, esprimono le proprie preferenze e scelgono cosa vedere attraverso un Match, una ruota della fortuna o una proposta diretta.

L'esperienza parte dalla scelta e continua dopo il film: appuntamenti, voti, recensioni, saghe e ricordi delle serate. Il tono è cinematografico e leggero, con attenzione all'uso da smartphone. Può essere uno spazio per amici, coinquilini o una coppia: conta condividere i film.

## Stato corrente: produzione v58

Pubblicata al commit `f3c49fd110592e9d8883f5e797809cf6fc34c0f2`, cache PWA
`scorochiatu-shell-v58`. Push e deployment Vercel completati; 41/41 file runtime
HTTP 200 e identici al commit. La migration Individual/Rewatch v54 è stata
applicata una sola volta dall’utente, con audit pre/post 24/24.
Le release frontend v55–v58 non modificano database, RLS, RPC o utenti Supabase.

Il login mantiene la scelta N/V e mostra **Account + Password**, senza il vecchio
vincolo PIN numerico. L’email è precompilata e modificabile, ma un valore diverso
dall’account selezionato blocca il submit. Il recupero apre **Imposta nuova password**
soltanto dopo un evento SDK PASSWORD_RECOVERY e le verifiche online richieste.
Dopo il reset si torna al login; ricaricare durante il recupero richiede un nuovo link.
[Flusso Auth, protezioni e limiti](docs/AUTH_SUPABASE.md).

Storico, introdotto nella v55 e ora pubblicato, è autonomo dalla Home con switch
**Storico N / Storico V**, card normali e ordine alfabetico, senza filtri Lista.
Le viste usano il rispettivo seen, possono sovrapporsi e ignorano la candidatura.
Ricordi conserva statistiche, Serate concluse e Dopo il film. Together dai completed
colora i due pallini oro senza cambiare il seen personale; “Segna come non visto”
conserva voto, recensione, candidatura ed eventi.
[Contratto Individual/Rewatch](docs/INDIVIDUAL_WATCH_REWATCH.md).

Il collaudo reale del recovery v58 e dell’Autofill Safari resta da confermare.
Le verifiche locali e HTTP non attestano questi comportamenti sui dispositivi reali.

## Come funziona

1. **Costruire la libreria.** Cercare film, scegliere la locandina corretta e aggiungerli alla lista. Ogni film conserva il proprio autore, i metadati disponibili e lo stato di visione.
2. **Scegliere cosa guardare.** Con Match Live entrambi scorrono i film: due preferenze positive producono un Match. La Ruota sceglie a caso dalla lista filtrata; in alternativa si può proporre direttamente un titolo.
3. **Organizzare la proiezione.** Scegliere «Oggi» con snack e luogo facoltativi oppure programmare data, ora e dettagli della proiezione. Le proposte programmate possono essere confermate dall'altro utente; il calendario raccoglie gli appuntamenti.
4. **Lasciare un voto o un commento.** Ogni utente può registrare le proprie visioni e valutazioni; una visione condivisa ha voto e recensione distinti da quelli personali.
5. **Continuare l'esperienza.** Consultare gli altri capitoli di una saga e aggiungerli esplicitamente alla Lista; Storico raccoglie le visioni N/V, mentre Ricordi raccoglie serate, statistiche e recensioni condivise.

## Funzioni disponibili

- **Libreria condivisa:** ricerca TMDb, picker dei risultati, importazione in blocco, dettagli e trailer disponibili, filtri e ordinamento. Viste separate Streaming e Al cinema / prossimamente, con Streaming all’apertura e card cinema riconoscibili. Controllo duplicati tramite ID del film.
- **Match Live:** sessione sincronizzata su due dispositivi, swipe e riconoscimento dei film apprezzati da entrambi. La percentuale di accordo riguarda la sessione di Match.
- **Ruota e sorprese:** scelta casuale con filtri, veto settimanale per ciascun utente, film sorpresa con locandina nascosta fino alla rivelazione e confetti al risultato.
- **Serate e calendario:** proposte, conferme, scelta rapida «Oggi», promemoria, snack personalizzati e luogo facoltativo, modificabili anche dopo. Le altre proposte restano visibili e accettabili durante la proiezione di oggi. Rivedere un film crea un nuovo evento e conserva lo storico.
- **Voti e recensioni:** scala 0–10 con un decimale, tastierino mobile e supporto a punto o virgola. Valutazioni personali e condivise separate; il testo è facoltativo e può essere rimosso mantenendo il voto.
- **Saghe:** capitoli TMDb in ordine di uscita, stato dei film già presenti e suggerimento dopo una nuova visione. Nessuna aggiunta automatica: si scelgono i capitoli da salvare.
- **Film al cinema e prossimamente:** possono restare in libreria ed essere programmati, con esclusione da Ruota e Match finché sono segnati per il cinema. I capitoli di saga con uscita futura ricevono questa indicazione.
- **Storico personale:** destinazione Home con switch N/V, film visti personalmente anche fuori Lista e viste sovrapponibili, senza filtri Lista.
- **Rewatch:** `seen_n && seen_v && !together`, con badge In gioco quando candidato; Oggi/Programma disponibili anche fuori Lista.
- **Ricordi / Titoli di coda:** storico mensile delle serate e quattro riepiloghi: voto medio, voto più alto, genere più visto e film aggiunti per autore. Voti e commenti sono raccolti in «Dopo il film».
- **Ticket cinematografico:** immagine PNG scaricabile con locandina, titolo, origine della scelta e dati disponibili della proiezione, compreso il luogo. Testi cinematografici senza formule romantiche ripetute.
- **Atmosfere automatiche:** quattro stagioni e quattro festività, con cambio secondo il calendario e scelta manuale temporanea. Suoni e vibrazione sono facoltativi sui dispositivi compatibili.
- **PWA e sincronizzazione:** app installabile, aggiornamenti dell'app-shell e dati condivisi tramite Realtime. Se la connessione non è disponibile, viene segnalata la modalità locale.

## Architettura

Il progetto usa **HTML, JavaScript vanilla ES6 e CSS**, senza framework o bundler. Tailwind CSS, Font Awesome e il client Supabase sono caricati via CDN.

- **Supabase** conserva i film, gli eventi delle serate, le sessioni di Match e i dati di interazione. Realtime aggiorna il secondo dispositivo.
- **TMDb** fornisce ricerca, dettagli, locandine e collection; **OMDb** integra metadati e valutazioni esterne.
- **Canvas 2D** gestisce Ruota e ticket PNG.
- **localStorage** conserva un mirror e il fallback locale; il service worker gestisce l'app-shell della PWA.

La distinzione centrale è **film = contenuto, serata = evento**. Uno stesso film può avere più serate, senza perdere le date e i luoghi dei rewatch. I voti appartengono al film e restano separati tra personali e condiviso.

La programmazione ha un'unica fonte: gli eventi `movie_nights`. Il client non legge né aggiorna i vecchi dettagli sul film; colonne e dati DB restano per un eventuale rollback con riallineamento dei mirror. Il precedente sistema di like/dislike `votes` conserva API dormienti e una cache separata, senza letture/scritture nel core, nell'interfaccia o nel Match Live. [Audit e piano di dismissione](docs/DATA_MODEL_TRANSITION.md).

L'app gestisce **uno spazio con due profili preconfigurati**, senza registrazione o gruppi indipendenti. L’ingresso mantiene persona → Account/Password e usa Supabase Auth con mapping protetto e RLS, con l'opzione «Ricordami su questo dispositivo». Le password non sono nel codice né nello storage applicativo. Il form normale usa username/current-password; il form recovery usa new-password.

**Auth/RLS verificata in produzione:** cutover completato, accesso DB riservato ai due membri e canali Realtime privati. Il collaudo reale del cutover v50 sui due dispositivi ha confermato login, dati, persistenza sessione, Realtime, Match Live e logout. La versione Auth originaria era `2bd43a6`/v50; production corrente v58, disponibile su [Vercel](https://sc-r-occhia-tu.vercel.app). [Stato tecnico e rollback d’emergenza](docs/AUTH_SUPABASE.md).

`votes` è esclusa dalla publication Realtime e dall’accesso applicativo;
la tabella e i suoi dati restano conservati. Il rollback ripristina la
membership originaria solo nell’eventuale procedura d’emergenza autorizzata.

La navigazione persistente resta Home/Match/Ruota/Lista/Ricordi. Storico,
Calendario e Visti e recensioni si aprono dalla Home; Storico non è aggiunto
alla bottom navigation. Ricordi conserva anno/mese collassabili e recensioni
in blocchi di dieci, con stato temporaneo azzerato al logout.
[Dettagli e verifiche](docs/UX_NAVIGATION_MEMORIES.md).

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
node scripts/verify-auth.js
# Test PostgreSQL/browser: percorsi delle dipendenze di verifica
node scripts/verify-auth-rls.js --pglite=/percorso/node_modules/@electric-sql/pglite
node scripts/verify-auth-browser.cjs --playwright=/percorso/node_modules/playwright
node scripts/verify-individual-rewatch-db.js --pglite=/percorso/node_modules/@electric-sql/pglite
node scripts/verify-ux-browser.cjs --playwright=/percorso/node_modules/playwright
node scripts/verify-individual-rewatch-browser.cjs --playwright=/percorso/node_modules/playwright
# SDK pubblico separato, Auth/membership simulati; AMR otp predefinito
NODE_PATH=/percorso/node_modules node scripts/verify-recovery-browser.cjs --sdk=/percorso/supabase-v2.js
NODE_PATH=/percorso/node_modules node scripts/verify-recovery-browser.cjs --sdk=/percorso/supabase-v2.js --amr=none
```

Verifiche del candidato v58 pubblicato: Smoke 436/436, Auth 77/77, RLS locale 40/40, DB Individual/Rewatch 52/52,
PWA 18/18, Chromium Auth 36/36, UX 24/24, Individual/Rewatch browser 39/39,
sintassi 56/56 e diff check PASS.
Simulazione recovery con SDK Supabase v2 reale e PWA: 8/8 con AMR otp e
8/8 senza AMR. Auth/membership sono simulati, le credenziali generate a runtime;
PostgreSQL temporaneo. Nessun test locale scrive Supabase.
Production: 41/41 file runtime identici al commit, HTTP 200 e SW v58.
Recovery reale v58, Autofill Safari e collaudo completo condiviso restano da confermare.

L’ingresso richiede verifica online: il mirror offline è disponibile solo dopo autorizzazione nella stessa esecuzione e con JWT valido. La sessione temporanea e l’autofill dipendono dal browser; il logout locale lascia indipendente l’altro dispositivo. Rimane un’app per due membri preconfigurati. I CSV manuali sono conservati fuori da Git e non costituiscono un backup completo Supabase.

L'audit dati usa `--file=fixture.json` oppure `--live` con JWT temporaneo membro in `SUPABASE_ACCESS_TOKEN`; anche import/backfill richiedono il JWT. Nessun fallback anonimo e nessuna service-role nel frontend. L'accesso a votes è disabilitato; il suo conteggio live può risultare non disponibile. Non eseguire manutenzione live come parte dei test locali.

Specifiche: [proiezioni, snack e luogo](docs/PROIEZIONI.md), [voti decimali](docs/PHASE38_DECIMAL_RATINGS.md), [saghe](docs/PHASE41_SAGHE.md), [Ricordi e statistiche](docs/PHASE23_MOVIE_CHEMISTRY.md), [timeline mensile](docs/PHASE22_TIMELINE.md).

## Possibili evoluzioni

La base attuale può essere sviluppata attraverso raccomandazioni, statistiche personali, piccoli traguardi ludici e strumenti aggiuntivi per programmare le proiezioni. Sono idee da progettare e verificare in fasi dedicate.

Un'eventuale apertura ad altre coppie di utenti o a più spazi condivisi richiederà una progettazione specifica di profili, accessi e separazione dei dati. È una direzione possibile, **non una funzionalità già disponibile**. La roadmap aggiornata rimane nel [master context](docs/MASTER_CONTEXT.md).
