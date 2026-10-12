# Serate oltre mezzanotte e Ricordi — chiusura release v60, 12 ottobre 2026

Lifecycle oltre mezzanotte, Ricordi chiuso all’apertura e snack nel form N+V
validati. L’utente conferma PASS end-to-end su localhost contro Supabase reale.
La migration snack è già stata applicata manualmente dall’utente nel progetto
corretto; nessuna nuova esecuzione o scrittura reale da parte dell’agente.
Pubblicazione Git/Vercel autorizzata; app-shell aggiornato a cache v60.

## Audit e riproduzione

`activeNights` include proposed/confirmed senza filtro data;
`activeNightForMovie` prende il più recente per created_at. `movieProjection`
legge date/time/snack/location esclusivamente dall’evento, usando scheduled_*
solo come nomi dell’adattatore. Nessun mirror di programmazione sul film.

`tonightPick` identifica il giorno locale corrente: date === localDateKey(now),
o quick confirmed con confirmed_at dello stesso giorno locale. Prima, la Home
usava tonightPick || nextMoviePick; nextMoviePick selezionava il più vecchio
appuntamento attivo con data (poi quick), senza escludere gli arretrati. Il
pulsante Completa serata della Home richiedeva un tonightPick e una conferma.
Il cartellone escludeva l’evento del banner e non offriva completamento per un
confirmed. Date/time venivano interpretati localmente, ma l’ordinamento
aggiungeva :00 al testo dell’ora e inventava 21:30 quando mancava.

Riproduzione sui moduli reali, clock Europe/Rome: evento confirmed del
12/10/2026 22:30; alle 23:30 la Home mostra Completa serata. Alle 00:01 e
01:30 del 13/10 tonightPick è null, nextMoviePick continua a scegliere lo
stesso evento, la Home non mostra più il pulsante e il cartellone non lo
recupera. L’evento non viene perso nel database: le card offrivano ancora
completamento, anche prematuramente, e il dettaglio poteva aprire il voto
Together. Il difetto era nella selezione/abilitazione UI della Home.

Ricordi contiene completed, non serate attive; il calendario mostra eventi
nel loro mese originario. Lo storico concluso usa night.date, se valida, e
solo altrimenti completed_at locale. Reload ricostruiva lo stesso difetto
perché la condizione dipendeva dal giorno, non da un marker di sessione.

## Regola applicativa

`nightIsDue`: proposed/confirmed e orario programmato raggiunto. Closed
(completed/cancelled/skipped) esclusi. Non scade al cambio di data.
`nightStartTime` costruisce date/time per componenti locali, supportando
HH:mm e HH:mm:ss; valida data e ora, senza parsing UTC di YYYY-MM-DD. Senza
ora è noto solo il giorno, non viene inventato un orario serale. Quick usa
confirmed_at come istante assoluto; se un quick confirmed storico non ha
il timestamp, resta completabile manualmente dallo stato, senza promozione
arbitraria nel banner.

Tonight Mode resta il concetto grafico di oggi. `homeNightPick` dà priorità
al pick di oggi, poi al prossimo evento futuro. Tutti gli altri eventi
attivi rimangono nel cartellone compatto e nella vista In programma. I
confirmed già trascorsi mostrano Da concludere e controlli Completa serata /
Annulla proiezione. Nessun timeout, nuovo stato o auto-cancellazione; un
arretrato molto vecchio non monopolizza il banner. Le proposte conservano
accetta/rifiuta/attesa e il percorso manuale di completamento della card
soltanto quando l’orario è raggiunto, compatibile con la RPC esistente.

Card e dettaglio conservano il redesign: completamento e ingresso al voto
Together su evento pendente sono offerti solo quando due; la modifica dei
dati Together già esistenti resta disponibile anche con un rewatch futuro.
Il handler di completamento controlla nuovamente l’eleggibilità, anche se
la UI fosse obsoleta. Il clock non è una nuova autorizzazione backend.

Completamento usa l’ID dell’evento originale e la RPC esistente: niente
secondo evento, modifica date/time o seen personali, auto-completamento o
nuove scritture introdotte nel lifecycle. Candidatura consumata alla prima
conclusione e idempotenza restano quelle esistenti. Voto/recensione Together
successivi riusano il form e non creano una seconda serata.

## Ricordi

In numeri ora è un details coerente con Serate concluse e Dopo il film.
Rimossi open iniziale di Serate concluse e apertura automatica di ultimo
anno/mese. Ad ogni apertura del modal sono chiusi numeri, storico, anni,
mesi, gruppo senza data, recensioni e singoli testi. Durante la stessa
apertura, rerender/Realtimes preservano scelte manuali, focus e scroll;
la paginazione conserva la semantica precedente. Tutto solo in memoria,
con summary nativi, aria-expanded e tastiera. Statistiche/contenuti invariati.

## Snack nel form N+V — UX validata

Inserimento: popup Programma/Oggi, elenco snack, testo custom max 80 e scelta
vuota; persistenza esclusivamente su movie_nights.snack via manage_movie_night.
Il ramo edit v54 rifiuta cambi snack su completed con COMPLETED_SNACK_FROZEN.
Il luogo invece è già modificabile nel form recensione: confirmReview chiama
updateMovieNight con la sola location; l'adattatore passa lo snack corrente
alla RPC e p_set_location=true. Questo percorso e la sua UX restano invariati.

La nuova migration incrementale `database/supabase-migration-completed-night-snack.sql`
sostituisce esclusivamente la RPC, senza rieseguire cutover/backfill v54.
Consente snack valore→valore, valore→NULL, NULL→valore sui completed. Il ramo
edit aggiorna ancora soltanto snack e location, quest'ultima solo se richiesta.
Respinge payload di programmazione non null sui completed; voto/recensione
nel ramo edit restano respinti atomicamente. Dopo la validazione, edit restituisce
l'evento senza UPDATE ridondante del film, evitando effetti dei relativi trigger.
Gli altri rami lifecycle sono identici; auth/membership, search_path, ACL e RLS
sono invariati. N e V mantengono entrambi la gestione della serata condivisa,
indipendentemente dal proponente. DML diretto ancora vietato.

Ricordi torna alla presentazione pulita: snack visualizzato soltanto quando
presente, senza penna/cestino/+Snack, wrapper o spazio riservato. Rimossi i
relativi handler, modalità snack del popup programmazione, CSS e focus dedicati.

Snack è un campo testo facoltativo max 80 nel form esistente N+V, accanto a
Luogo. La selezione della specifica serata precompila entrambi i campi; cambia
solo l'evento scelto, anche con rewatch. Campo snack vuoto salva NULL. Nessun
pulsante separato di eliminazione né conferma aggiuntiva: vale Salva/Annulla
esistente. Il campo non è mostrato nei form personali N/V.

Il salvataggio dei dettagli completed riusa updateMovieNight con una patch
contenente solo snack/location modificati; entrambi nello stesso edit RPC se
cambiano insieme. Location-only passa ancora lo snack corrente tramite
l'adattatore e p_set_location=true. Snack-only non imposta location. Voto e
recensione mantengono il percorso movies esistente; se invariati, non vengono
risalvati. Complete/complete_now mantengono il lifecycle esistente; lo snack
di una prima conclusione programmata è salvato tramite edit dopo complete,
perché il contratto complete non modifica lo snack. Non si crea un secondo
movie_night. Nessuna ulteriore modifica della RPC/migration in questo pass UX.

La migration è stata applicata manualmente dall'utente, come da sua conferma;
nessuna nuova esecuzione o scrittura reale da parte dell'agente. Il collaudo
end-to-end del nuovo form locale sul backend reale è PASS, confermato dall’utente.

## Verifiche locali

- `verify-night-midnight.js`: **36/36**, clock controllato in Europe/Rome,
  UTC e America/Los_Angeles. 23:30/00:01/01:30, reload runtime, manual complete,
  recensione Together, future/closed, quick, vecchi arretrati, annullo,
  timezone, secondi, date invalide e nessuna duplicazione.
- `verify-night-midnight-browser.cjs`: **19/19**, Chromium Europe/Rome a
  320/390/768 px, clock controllato, Auth/data sintetici, vero reload pagina,
  lifecycle, condivisione, futuro/annullato, accordion e tastiera.
- UX **24/24**, Individual/Rewatch browser **39/39**, card/Storico **80/80**,
  personal/Together **23/23**, Auth **82/82**, PWA **18/18**, smoke **436/436**.
- Individual/Rewatch DB **65/65** su PGlite temporaneo: prima contratto v54
  e guardia snack frozen, poi migration incrementale e nuove regressioni snack. Nessun collegamento al database reale.
- Adeguate solo le aspettative superate intenzionalmente: accordion chiusi,
  fixture completed dopo orario raggiunto, quick senza data nel cartellone.
- Snack SDK/mirror/form **14/14**, snack/form N+V/Ricordi Chromium **25/25** a 320/390/768,
  Auth browser **43/43**, RLS locale **40/40**.
- Sintassi dei moduli/test pertinenti e git diff --check PASS.

Le suite automatiche usano scritture simulate. Il PASS end-to-end su localhost
contro il backend reale è confermato dall’utente e distinto dai test automatici.
Dopo pubblicazione resta utile una prova del form dalla PWA aggiornata.
