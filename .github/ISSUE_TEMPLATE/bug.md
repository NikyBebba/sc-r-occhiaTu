---
name: "Bug"
about: "Violazione riproducibile del comportamento concordato"
title: "[PB-ID] "
labels: ""
assignees: ""
---

## Identità e decisione

PB-ID o feedback locale: …
Tipo: Bug (label proposta `type:bug` dopo setup Hub).
Lifecycle: IDEA / BACKLOG / READY / IN PROGRESS / IN REVIEW / DONE.
Decision: PROPOSED / APPROVED / EXPLORATORY / DEPRECATED (fonte PO: …).
Implementation: NOT IMPLEMENTED / PARTIAL / IMPLEMENTED.
Epic: E…; Priority proposta e motivo: …; sprint solo se concordato.

## Obiettivo

Un risultato principale: …
Passi di riproduzione, versione/device, frequenza e impatto; atteso vs osservato.

## Comportamento attuale e atteso

Attuale/osservato: …
Atteso (per ricerca: risposta/decisione da ottenere): …

## Scope e acceptance criteria

In scope: …
Fuori scope: …

- [ ] Risultato osservabile: …
- [ ] Caso negativo/limite pertinente: …
- [ ] Output/evidenza di accettazione: …

## Vincoli e dati da preservare

… oppure N/A motivato. Auth/RLS, identità, dati reali, storico N/V, backup e file estranei preservati. Nessuna operazione live implicita.

## Dipendenze e duplicati

Blocked by / related / duplicate of: #… o PB-…; nessuna se non nota.
Se blocked: motivo, evidenza e condizione di sblocco (senza nuovo stato).

## Test necessari

Riproduzione prima del fix, regressione del percorso, integrità se dati coinvolti.
Comandi/percorso/ambiente e limiti: …

## Evidenze e fonti

Issue/doc/sezione/SHA e data: …
Decisioni PO e motivazione: …
Non allegare credenziali, dump o giudizi privati; screenshot redatti se necessari.

## Completamento e rilascio

- [ ] Sviluppo/output completato e review AC.
- [ ] Test/document check pertinenti superati (comando/esito/limiti: …).
- [ ] Accettazione PO se necessaria per il risultato: …

Release evidence: NOT RELEASED / RELEASED / VERIFIED / N/A per docs, spike o triage.
Versione/milestone, SHA/deployment e verifiche effettive: …
Chiusura duplicate/deprecated: non planned + link/motivo, non DONE di delivery.
