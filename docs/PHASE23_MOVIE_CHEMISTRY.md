# Phase 23 — I nostri numeri

Stato: **implementata nel codice locale; verifica visiva su due telefoni da eseguire** · 5 ottobre 2026

## Obiettivo

Nel modale «Il Nostro Cinema» mostrare quattro conteggi retrospettivi. Non sono
una nuova percentuale di compatibilità: la Match % resta esclusiva di Match Live.
La sezione è di sola lettura e usa `movie_nights` e `movies` già caricati.

## Definizioni

- **Serate concluse**: numero di eventi `movie_nights` con `status = completed`.
  Una serata proposta, confermata o annullata non entra nel totale.
- **Film diversi visti**: numero di `movie_id` distinti fra quelle serate.
  L'evento rimane nel conteggio anche se il film collegato è stato rimosso.
- **Serate di rewatch**: per ogni film, serate concluse oltre la prima;
  la somma equivale a eventi conclusi con `movie_id` meno film distinti.
- **Film con voto insieme**: film visti insieme con voto condiviso valido
  (scala 0–10, zero incluso, testo facoltativo). È un conteggio di film,
  indipendente dal numero di serate. `togetherRating()` include il fallback
  delle vecchie valutazioni condivise. Aggiornamento del 5 ottobre 2026:
  i voti personali non contribuiscono più a questo conteggio.

Un evento senza `movie_id` conta fra le serate concluse, ma non fra film diversi
o rewatch. Con dati vuoti tutti i conteggi sono zero. La sezione non mostra
titoli o poster e non svela i film sorpresa.

## Verifica

Smoke test su più serate dello stesso film, film rimosso, serata annullata,
voto insieme zero e stato vuoto: **329/329 PASS** nell'harness complessivo.
`node scripts/verify-sw.js`: **12/12 PASS**. Cache PWA `v34`.
Resta una prova visiva su due telefoni dopo il deploy.
