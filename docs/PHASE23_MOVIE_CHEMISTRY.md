# Phase 23 — Ricordi / Titoli di coda

Aggiornamento UX locale v51, 8 ottobre 2026: storico Anno → Mese collassabile
con stato in memoria; Dopo il film alfabetico, dieci elementi iniziali e
Mostra altre, testi espandibili. Header Ricordi sticky. Nessuna nuova data o
formula. [Specifica e verifiche correnti](UX_NAVIGATION_MEMORIES.md).
Le descrizioni precedenti sotto documentano la baseline della fase originale.


Stato: revisione implementata e verificata localmente, 5 ottobre 2026.
Prova su due telefoni dopo deploy ancora da fare.

## Revisione concordata

Gli otto riquadri precedenti ripetevano più volte film visti e votati.
Il modale «Titoli di coda» usa quattro riepiloghi sotto «In numeri»,
prima dello storico «Serate concluse» e della sezione «Dopo il film».
«In numeri» è accompagnato da un'icona chart-bar.
Il tono è cinematografico e leggero: non ripetere continuamente noi/nostro/insieme.

- **Voto medio**: solo voti condivisi dei film visti insieme, zero incluso;
  niente voti personali. Un decimale nella media, fallback condiviso legacy.
  Media calcolata in decimi per arrotondare correttamente (9,1 e 0 → 4,6).
- **Voto più alto**: massimo dei voti condivisi visibili, con titolo del film.
  In caso di ex aequo mostra quanti film hanno quel voto; nessun vincitore
  scelto arbitrariamente. Zero valido, decimali e fallback legacy.
  Sorprese non rivelate escluse, titoli escapati; senza voti mostra «—».
- **Genere più visto**: generi dei film visti insieme; ogni film contribuisce
  una volta per genere. Nessun conteggio di serate/rewatch in questa metrica.
- **Film aggiunti**: tutti i film attualmente in libreria per `added_by` N/V,
  inclusi watchlist, cinema, sorprese e visti. Zero esplicito; film eliminati
  fuori dal totale, autore sconosciuto non attribuito, rewatch non moltiplicati.

Il totale delle serate resta accanto allo storico. Ogni serata conclusa,
compresi i rewatch, conserva la propria card con data, snack e luogo.
Il voto sulla card è identificato da N+V, usando i nomi configurati.
In «Dopo il film» il voto è solo «★ x/10»; senza voto non si crea una riga
vuota. Recensioni solo testuali e voti senza testo restano visibili.

## Conteggi precedenti

Rimossi dalla UI i riquadri «Serate concluse», «Film diversi visti»,
«Serate di rewatch», «Film con voto insieme» e il secondo conteggio
«Film visti insieme». Nessun dato storico cancellato o schema modificato.
`movieChemistryStats` conserva le formule come helper interno DOM-free:
serate = eventi completati, film = movie_id distinti, rewatch = eventi
successivi al primo per film, votati = film condivisi con voto valido.
Non sono più un blocco di statistiche visibile.

## Verifiche

Smoke **369/369 PASS**, service worker **12/12 PASS**, controlli sintassi
JS e `git diff --check` senza errori. Cache PWA corrente `v44`.
Test su quattro riquadri distinti, media con zero e decimali, voto massimo,
ex aequo, input senza voto, titoli escapati, sorprese, intera libreria per
conteggio aggiunte, storico N+V e recensioni senza etichette ripetute.
Chromium con fixture a 320/390/768 px: riepiloghi, titoli lunghi, stato vuoto,
nessun overflow orizzontale e zero errori JS; screenshot ispezionati.
Nessuna dipendenza dell'app, migration o scrittura sul database reale.
