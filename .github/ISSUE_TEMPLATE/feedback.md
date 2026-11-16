---
name: "Feedback"
about: "Segnalazione da classificare e collegare dopo triage"
title: "[PB-ID] "
labels: ""
assignees: ""
---

## Identità e decisione

PB-ID o feedback locale: …
Tipo: Feedback (label proposta `type:feedback` dopo setup Hub).
Lifecycle: IDEA / BACKLOG / READY / IN PROGRESS / IN REVIEW / DONE.
Decision: PROPOSED / APPROVED / EXPLORATORY / DEPRECATED (fonte PO: …).
Implementation: NOT IMPLEMENTED / PARTIAL / IMPLEMENTED.
Epic: E…; Priority proposta e motivo: …; sprint solo se concordato.

## Obiettivo

Un risultato principale: …
Repository pubblico: inserire soltanto sintesi tecniche minimizzate e anonimizzate. Niente nomi/contatti/coorti riconoscibili dei tester, credenziali, token, dump, dati privati N/V o screenshot con dati personali. Fonte/data/versione/device solo se adeguatamente sanitizzati; classe bug/UX/feature/qualitativo/miglioramento/da triage. Feedback non pubblicabili al PO tramite canale locale riservato fuori repository: non allegarli qui. Vedi [privacy Product Hub](../../docs/PRODUCT_HUB.md#privacy-e-visibilita--repository-pubblico).

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

Riproduzione se bug; collegamento al canonico e risultato triage. Nessun test prodotto obbligatorio per opinioni.
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

## Triage feedback

Impatto/frequenza/workaround: …
Classe confermata: …
Issue/PB canonico o motivo nuova Issue dopo triage: …
Decisione PO, data, motivo ed esito: …
Feedback chiuso come collegato non significa problema risolto.
