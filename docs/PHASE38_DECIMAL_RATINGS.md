# Phase 38 — Voti decimali da tastierino

Scelta dell'utente: proseguire con i voti decimali, personali e insieme.
Codice implementato localmente; migration Supabase preparata, **non applicata**.
Non pubblicare il frontend prima della migration.

I due menu voto diventano campi con `inputmode="decimal"`: da 0 a 10,
con un decimale facoltativo. Si accettano `8.3` e `8,3`, con spazi esterni;
`0` e `10` restano validi. Vuoto, valori fuori scala, più di un decimale,
segni, esponenti e separatori misti mostrano un errore senza salvare.
Il tastierino effettivo dipende dal dispositivo: [documentazione inputmode](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inputmode).

I salvataggi usano numeri, la UI italiana la virgola. Modifica e riapertura
mantengono i decimali. Card, dettaglio, recensioni, storico, ordinamento
e media insieme li conservano; la media continua a includere zero e solo
i voti condivisi dei film visti insieme. N, V e insieme restano distinti.
I voti legacy 1–5 mantengono il fallback in lettura 2–10.
Modificare un voto non cambia la data della serata né conclude un rewatch.

## Database e pubblicazione

La migration [Phase 38](../database/supabase-migration-step38-decimal-ratings.sql)
cambia solo `seen_rating_n`, `seen_rating_v`, `seen_rating_together` da
`smallint` a `numeric`, in transazione, conservando dati, NULL, zero e
vincoli 0–10. Un CHECK sui decimi rifiuta valori come `8.34`.
Si usa numeric senza scala per evitare l'arrotondamento implicito dei
tipi con scala fissa: [documentazione PostgreSQL](https://www.postgresql.org/docs/17/datatype-numeric.html).
I vincoli dedicati vengono ricreati con gli stessi nomi alla riesecuzione.
Schema iniziale aggiornato; nessun backfill, nuova colonna o tabella.
Notifica PostgREST per riallineare la cache dello schema.

Applicare lo script dal SQL Editor Supabase dopo l'autorizzazione
dell'utente, poi controllare i tre tipi con:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'movies'
  AND column_name IN ('seen_rating_n', 'seen_rating_v', 'seen_rating_together');
```

Solo dopo pubblicare il frontend (cache PWA `v40`). Un vecchio client
accetta ancora solo gli interi e può non mostrare i nuovi decimali: aggiornare
entrambi i telefoni. Nessuna modifica alle credenziali o alle serate.

## Verifiche

- Smoke **358/358 PASS**, service worker **12/12 PASS**, controlli sintassi.
- Tutti i 101 decimi, punto/virgola, input errati, zero, salvataggi personali
  e condivisi, modifica, persistenza locale, legacy, ordinamento e media.
- Migration eseguita su PostgreSQL temporaneo PGlite: preserva valori,
  303 scritture valide (101 per colonna), 18 valori invalidi rifiutati,
  NULL, decimali, riesecuzione e schema nuovo. Nessuna scrittura sul DB reale.
- Chromium con dati fittizi a 320/390/768 px: salvataggi personali e insieme,
  punto/virgola, errori, riapertura, target voto ≥44 px, font mobile 16 px,
  nessun overflow orizzontale e zero errori JS; screenshot ispezionati.
- Tastierino e salvataggio condiviso su due telefoni reali: da verificare
  dopo migration e deploy.

Nessuna dipendenza aggiunta all'app. Browser e PostgreSQL di verifica
sono installazioni temporanee fuori dal repository.
