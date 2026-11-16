# Codex Development Protocol — PB-049/050

Standard operativo iniziale **APPROVED e adottato dal PO** nella Final Consolidation (U03, fonte nel Product Hub). PB-049 e PB-050: **DONE per scope iniziale documentale**, verificato localmente; release N/A, pubblicazione dei template non ancora autorizzata. [Product Hub](PRODUCT_HUB.md) governa triage/board/beta; [Master Backlog](MASTER_BACKLOG.md) mantiene ID e fonti fino all'importazione. Nessun cambiamento alle protezioni esistenti o al runtime.

## Unità di lavoro e contesto minimo

Ogni sessione di implementazione parte da **una Issue identificata**, un obiettivo principale e AC verificabili. Finché GitHub non è attivato, un candidato locale con PB-ID, scope/AC e fonte è il riferimento identificato; non inventare numeri `#Issue`. Sprint 0 è l'eccezione di bootstrap documentale esplicitamente richiesta dal PO, non autorizza a iniziare le feature.

Leggere `AGENTS.md`, checkpoint corrente del `MASTER_CONTEXT.md` e corpo Issue; poi soltanto le specifiche/porzioni di codice toccate e le dipendenze dirette. Per prodotto nuovo leggere la sezione pertinente della roadmap e valutare Content/User/Group/Community. Non rileggere l'intera storia a ogni turno. Se una fonte si dichiara CURRENT v62, usare il checkpoint v76 e il commit, preservando la sezione come storia; non rimodellare il runtime per farla coincidere con documenti vecchi.

Il precedente handoff/test vale finché commit, scope e assunzioni sono ancora applicabili. Riesaminare solo se c'è un nuovo errore, un contratto cambiato, nuova evidenza o invalidazione della baseline; riportare cosa è invalidato e perché. Non rieseguire audit DB/release/import per acquisire familiarità. Non caricare dump/backup/chiavi nei prompt e non stampare `js/config.js`. Il repository è pubblico: un Project privato non rende private le Issue. Prima di pubblicare, minimizzare e anonimizzare evidenze; vietati dati personali dei tester, credenziali/token/dump, dati privati N/V e screenshot con dati personali. Feedback non pubblicabili restano in un file locale riservato fuori repository/cartelle sincronizzate pubblicamente, accessibile solo al PO e alle persone autorizzate; alle Issue arrivano solo descrizioni tecniche sanitizzate. Nessun nuovo servizio o canale remoto creato; [procedura e limiti](PRODUCT_HUB.md#privacy-e-visibilita--repository-pubblico).

## Ciclo operativo leggero

1. **Analyze/Plan:** stato Git e file preesistenti, Issue e AC; indicare delta concreto e file previsti. Un piano in poche righe basta per UI/copy; per Auth/RLS/DB specificare contratti, preservazione e recupero. Chiarire solo ciò che blocca una scelta irreversibile o gli AC, proseguendo il resto autorizzato.
2. **Implement:** un outcome per sessione; riusare handler, moduli e harness esistenti. Nessun refactoring o nuova astrazione senza necessità dimostrata. Documentare il debito scoperto come candidato separato e continuare se non blocca gli AC.
3. **Test/Review:** controlli proporzionati sotto, analisi del diff, sicurezza dati e accessibilità del percorso. Una suite già passata sullo stesso delta non va ripetuta senza motivo. Un test fallito pertinente blocca il DONE; un limite storico non pertinente va nel debito, senza dichiararlo corretto.
4. **Consegna:** AC soddisfatti/non soddisfatti, file principali, test eseguiti e limiti reali, eventuale prossimo gate. Commit/push/deploy solo se autorizzati nel contesto; non moltiplicare approvazioni per passi reversibili già compresi nello scope. Mai staging globale in worktree con untracked estranei.

Se manca un dettaglio non bloccante, esplicitare l'assunzione nella Issue. Cambiare scope o contratto fondamentale richiede aggiornare AC e decisione PO, non una catena di micro-approvazioni a ogni file.

## Matrice di test proporzionati

| Delta | Minimo pertinente | Quando allargare |
| --- | --- | --- |
| Solo docs/template | Link locali, ID/campi, coerenza stato, `git diff --check`, scope/preservazione | Non avviare runtime/browser/DB per docs |
| Copy/layout/CSS | Sintassi se JS/HTML inline cambia; browser superficie a 320/390 e larghezza pertinente, touch/focus/contrasto/motion | Altre viste/temi solo se condividono selettori/token modificati; niente suite DB con writers invariati |
| Logica client/query/async | Harness dominio con fixture, errore/retry/doppio submit/late response, percorso browser toccato | Smoke moduli se ordine/caricamento/globals cambiati; chiamanti riusati da query helper |
| Recommendation | Suite motore/profili/adapter interessati, fixture confrontabili, protezioni negative e canali; browser solo se consumer cambia | Benchmark solo per ipotesi ranking/calibrazione; non dichiarare predictive accuracy da fixture |
| Snapshot/command/runtime | Decoder/adapter/sessione/recovery/invalidation e flusso browser pertinente, CAS/idempotenza/risposte tardive | Snapshot wire/protocollo o package cambia: verificare compatibilità/PWA e consumer dipendenti |
| Auth/RLS/schema/integrità | Suite dedicate + negativi ruoli/tenancy, membership/session guard, replay/concorrenza/omissione-null, preservazione/recupero su ambiente isolato | Operazioni live solo con autorizzazione e preflight mirato; nessuna riduzione per risparmiare token |
| Release/PWA | Inventory asset/versione/SW, esclusione API e percorso updater se toccato; esatto SHA/deploy verificato se autorizzato | Contratto compatibilità o vecchi client: gate dedicato, entrambi i dispositivi quando richiesto |

Scegliere gli script esistenti tramite ricerca `rg --files scripts` e pattern del dominio; non installare un nuovo test runner per una modifica minore. La tabella indica copertura, non obbliga a tutte le suite di una release passata. Test live con dati reali e verifiche su entrambi i telefoni restano evidenze separate dai mock.

## Definition of Ready

Una Issue può essere READY solo se:

- Un risultato principale, tipo e PB-ID/fonte chiari; per idee Codex Decision PROPOSED ancora visibile finché il PO non approva.
- Problema/comportamento corrente e atteso distinti; componenti già implementati identificati per evitare ricostruzioni.
- Scope/in-scope/out-of-scope e AC osservabili definiti; contenitore Epic/Idea suddiviso solo quanto serve al prossimo incremento.
- Dipendenze bloccanti risolte o un percorso autonomo circoscritto; nessuna ambiguità critica su dati/identità/scritture.
- Vincoli, test necessari e livello di rischio proporzionati; per dati/Auth piano di preservazione e recupero prima di implementare.
- Priorità/capacità concordate per l'eventuale sprint. READY non implica assegnazione sprint, autorizzazione SQL/live o deploy.

## Definition of Done e prove di rilascio

Nel corpo Issue mantenere tre evidenze distinte:

- **Sviluppo completato:** AC soddisfatti, review diff conclusa, nessun regressione nota pertinente, docs contrattuali aggiornate solo dove cambiano, file estranei preservati.
- **Test superati:** comando/ambiente/esito e limiti; non copiare un totale storico come nuovo PASS. Test non eseguito è esplicito, non successo implicito.
- **Release effettiva:** NOT RELEASED / RELEASED (SHA + deployment/versione + data/fonte) / VERIFIED (controlli effettivamente svolti + device/limiti). Milestone, commit o merge da soli non equivalgono a produzione.

Per codice, DONE indica sviluppo e test accettati; può restare **NOT RELEASED**, chiaramente indicato, finché manca il rilascio autorizzato. Vista Release History distingue released/verified. Se l'AC della Issue richiede disponibilità production, la Issue resta IN REVIEW finché quella prova manca. Per docs/spike, accettazione PO e output verificato chiudono DONE senza deploy, Release N/A. Un deliverable documentale accettato può essere DONE anche se il processo continuerà a evolvere: approvazione del modello, completamento dell’artefatto e attivazione operativa sono evidenze distinte. PB-048–051 sono DONE nello scope iniziale; PB-047 resta PARTIAL perché la beta non è eseguita. Non chiudere un’iniziativa ampia per la sola accettazione del piano. Per feedback, chiusura triage non significa bug risolto; per duplicate/deprecated chiusura non planned e link canonico, non DONE.

Non dichiarare una release «verificata su due telefoni» dalla sola pubblicazione HTTP. Nessun downgrade/restore/cleanup per adattare dati reali a vecchi client. I gate tecnici v76 restano quelli delle specifiche interessate, non vengono sostituiti dal workflow leggero.

## Prompt riutilizzabile

```text
sc(r)occhiaTu — [PB-ID] / [#Issue o candidato locale]
Obiettivo unico: …
Baseline: [SHA/release]; Issue e fonti: [link + sezioni pertinenti].
Contesto riusabile: [handoff/test esistenti e limiti ancora validi].
Corrente → atteso: …
Scope: …
Fuori scope: …
Acceptance criteria:
- [risultato osservabile]
- [caso negativo rilevante]
Vincoli/dati da preservare: …
Dipendenze/decisioni PO: …
Test pertinenti previsti: [script/percorso; ambiente sintetico o autorizzato].
Autorizzazioni: [solo locale / eventuali commit-push-deploy esplicitamente consentiti].
Leggi solo fonti e dipendenze necessarie; riusa harness e contratti.
Non ripetere audit conclusi senza evidenza nuova; debito non bloccante separato.
Completa lo scope autorizzato e verifica gli AC; report finale breve con esiti/limiti.
```

Report standard: `Risultato/AC | Test effettivi | Rischi o blocchi | Stato sviluppo/test/release | Prossimo passo`. Link ai file/Issue al posto di ripetere la specifica. Non produrre un nuovo documento di handoff per un piccolo cambio già descrivibile nella Issue.
