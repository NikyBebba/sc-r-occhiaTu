# Supabase Auth e RLS — implementazione locale, attivazione pendente

Checkpoint candidato pre-cutover: 8 ottobre 2026, cache PWA **v50**. L'utente conferma
PREPARE applicato sul progetto live, due account Auth confermati e due mapping
UUID → N/V verificati via SQL. Non sono verifiche remote eseguite dall'agente.
Il candidato costituisce un checkpoint Git locale autorizzato; nessuna
operazione Supabase live, push o deploy. CUTOVER e impostazioni Realtime
restano pendenti.

AUTH_EMAILS contiene le due email reali fornite dall’utente e autorizzate come
identificativi pubblici frontend. Configurazione e login N/V verificati localmente;
nessun PIN/password, UUID reale o secret aggiunto. Candidato locale completo,
pronto per il cutover coordinato; attivazione hosted e deploy ancora pendenti.
Il backup CLI è stato abbandonato e ripulito; CSV applicativi conservati
manualmente dall'utente. Non costituiscono un dump di schema, Auth o policy.

Verifiche: smoke 400/400, Auth 43/43, RLS PostgreSQL locale 40/40, PWA 15/15,
Chromium Auth 18/18 e 144 scenari DOM invariati (345 API). Proiezioni, cinema,
Ricordi e recensioni Chromium mobile green. SDK/DB simulati: nessun login,
query o subscription contro Supabase live per queste verifiche.
Corrette due regressioni Auth: errore getSession obsoleto non invalida una
sessione successiva; AuthSessionMissingError senza status non è un guasto rete.

## Dipendenze e scelte

Inventario prima del cambiamento: login/bootstrap e logout in main; client,
mirror/fallback e subscription core in store; CRUD film, visioni e recensioni,
veto e serate nei domini store; sessioni/swipe/Presence in store/match; guardia
render; ordine script, form e app-shell PWA; import, audit e backfill CLI.
Il vecchio `scorochiatu_user` e i PIN in PEOPLE non sono più fonti d'identità.

`js/auth.js` verifica il token con `auth.getUser()` e legge la propria riga
`app_members(user_id UUID FK auth.users, person UNIQUE N/V)`. Il mapping è
modificabile solo dall'operatore Dashboard. Nessuna identità proviene da
user_metadata, dalla persona selezionata o dallo storage applicativo. La
selezione N/V sceglie soltanto l'email per `signInWithPassword`; il mapping
verificato deve corrispondere. Non si riscrivono gli autori N/V storici.

Non sono introdotti backend, registrazione, OAuth, redirect o magic link.
L'accesso usa due utenti email/password precreati e confermati. La password
è il nuovo PIN numerico di otto cifre richiesto, distinto per ciascun account,
generato dall'operatore; non compare in config, SQL o storage applicativo.
Il form offre username/current-password al password manager; supporto e
salvataggio dipendono dal browser. La publishable key resta client-side.

## Sessione, rete e logout

L'adapter storage dell'SDK conserva token e refresh token sotto
`scorochiatu_auth`: localStorage con Ricordami, sessionStorage altrimenti.
Il refresh mantiene la scelta e cancella la copia nell'altro storage. La
sessione temporanea segue la sessione della scheda/PWA gestita dal browser;
ricaricare la stessa scheda non equivale a logout. Non si salvano password.

All'avvio il token memorizzato non basta: ingresso automatico soltanto dopo
verifica online Auth + membership + scadenza e autenticazione Realtime.
Un avvio offline resta alla landing, anche con mirror/token memorizzati.
Dopo una verifica riuscita nella stessa esecuzione, un guasto di rete/server
può usare il mirror finché il JWT verificato non è scaduto. Errori 401/403,
RLS 42501, sessione assente/scaduta o membership mancante chiudono l'app:
nessun fallback offline può autorizzare l'ingresso. Una generazione della
sessione invalida risposte asincrone arrivate dopo logout/cambio identità.

Logout chiude core e Match, invalida l'identità, elimina token e mirror
film/serate/veto/votes/sessioni/swipe/vecchio utente, esegue
`signOut({scope:'local'})` e disconnette Realtime. Tema e preferenze audio
restano. Il sign-out locale non disconnette l'altro telefono. Come per
Supabase Auth, un access token già emesso può restare valido sul server fino
alla sua scadenza: il logout locale elimina l'accesso di questa istanza.

## Policy e trasporto

| Risorsa | Privilegi authenticated, soltanto membri |
| --- | --- |
| app_members | SELECT della sola propria riga; nessuna scrittura |
| movies, movie_nights | SELECT/INSERT/UPDATE/DELETE condivisi |
| vetoes | SELECT condiviso; INSERT/DELETE solo person = mapping |
| swipe_sessions | SELECT condiviso; INSERT created_by = mapping; UPDATE condiviso soltanto status/matched_movie_id/matched_at |
| swipes | SELECT condiviso; INSERT person = mapping; niente UPDATE/DELETE |
| votes | Nessun privilegio o policy applicativa, tabella conservata |
| realtime.messages | SELECT sui due topic; INSERT Presence soltanto su scorochiatu-match, sempre membership richiesta |

Le policy precedenti sulle sei tabelle e realtime.messages sono rimosse
integralmente al cutover: una vecchia policy permissiva si sommerebbe con OR.
Sono revocati i grants applicativi delle tabelle pubbliche, anche per colonna.
La funzione app_person è SECURITY INVOKER e segue la SELECT self del mapping.
Anon non ha accesso. Un terzo account authenticated non è un membro.

Il JWT è passato a `realtime.setAuth`; core e Match usano private:true.
Topic, binding, Presence N/V e contratto Match non cambiano. Il callback Auth
delega fuori dal lock SDK verifica/refresh; refresh single flight, canali
riusati, recupero allo stato online/visibile e resync al SUBSCRIBED core anche
dopo reconnect SDK. La logica pura `js/match.js` e la UI Match sono invariate.
Le policy Presence autorizzano i membri al topic; non autenticano il contenuto
arbitrario di un payload Presence. Le scritture Match restano protette da RLS.

Realtime messages ha già RLS: nessun ALTER/DROP di questa tabella di sistema.
Riferimenti ufficiali: [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization),
[permessi realtime.messages](https://supabase.com/docs/guides/troubleshooting/realtime-must-be-owner-of-table-messages),
[signOut locale](https://supabase.com/docs/reference/javascript/auth-signout).
Il collaudo locale non verifica le impostazioni o i privilegi del progetto hosted.

`votes` mantiene le firme delle API dormienti ma non effettua query SDK;
castVote remoto restituisce false, fetchLegacyVotes remoto restituisce [].
Il vecchio toggle locale resta isolato e richiede identità verificata.
L'audit diagnostico CLI può incontrare un diniego su votes e lo riporta come
conteggio non disponibile; nessuna nuova autorizzazione per leggerlo.

## Checklist sequenziale di cutover — nessuna azione live eseguita adesso

1. **Candidato locale completato**: AUTH_EMAILS configurato con le email reali
   fornite dall’utente; suite e configurazione verificate. Usare il checkpoint
   locale pre-cutover e non inserire i PIN. PREPARE/account/mapping sono già
   completati: non ripeterli né creare altri account.
2. **Tu, Dashboard, prima della finestra**: controllare il progetto corretto,
   due account confermati e mapping N/V; provider email/password disponibile,
   signup pubblico e anonymous sign-ins disabilitati, password/rate limit
   coerenti con i PIN impostati. In Database Publications verificare che
   supabase_realtime contenga movies, movie_nights, vetoes, swipe_sessions e
   swipes. La presenza storica di votes è ammessa prima del cutover: sarà
   rimossa dalla publication dalla migration, senza cancellare tabella/dati.
   La publication deve esistere e non essere FOR ALL TABLES.
   Conservare CSV e annotare impostazioni/policy correnti; nessun
   ulteriore backup CLI richiesto. Non rieseguire vecchie policy pubbliche.
3. **Coordinare la finestra**: avere disponibile il candidato locale testato
   e il meccanismo di deploy, senza pubblicarlo ancora. Chiudere le vecchie
   sessioni/PWA sui due dispositivi e sospendere le azioni fino al nuovo accesso.
   Le vecchie app anonime smetteranno di funzionare appena il DB viene chiuso:
   è prevista una breve interruzione tra cutover e deploy, senza nuove scritture.
4. **Tu, SQL Editor, ora CUTOVER**: eseguire l'intero file
   `database/supabase-migration-auth-cutover.sql` una volta sola. Attendere
   successo/COMMIT prima di proseguire. Se fallisce, fermarsi: la transazione
   non è da aggirare con grants pubblici o esecuzione selettiva dei pezzi.
   Verificare le sei tabelle con RLS attiva, nessuna vecchia policy permissiva,
   votes senza accesso, assente dalla publication e con dati conservati;
   backup policy/grants in app_security_backup.auth_ddl e stato originario
   della membership votes in app_security_backup.auth_publication.
   Il backup è di sicurezza SQL, non un nuovo export dei dati applicativi.
5. **Tu, Dashboard Realtime, DOPO il COMMIT**: disabilitare **Allow public
   access** in Realtime Settings. Confermare le cinque tabelle pubblicate
   (movies, movie_nights, vetoes, swipe_sessions, swipes) e votes assente;
   non cambiare topic, Presence, replica identity o algoritmi e non aggiungere
   votes. Annotare il valore precedente per l'eventuale rollback. Policy e
   grants realtime.messages sono già nel cutover: nessun ALTER della tabella.
6. **Deploy, solo DOPO SQL + Realtime e dopo autorizzazione separata**:
   pubblicare esattamente il candidato Auth verificato, config con sole email
   e chiavi pubbliche esistenti, service worker v50 e tutti i moduli. Nessuna
   registrazione o migration automatica all'avvio. Solo commit locale
   autorizzato in questa fase, nessun deploy/push. Non pubblicare se manca
   una email o un controllo.
7. **Tu, due dispositivi, aggiornamento PWA**: riaprire online entrambi e
   accettare l'aggiornamento; verificare app-shell v50. Se rimane il vecchio
   ingresso, chiudere/riaprire tutte le schede/PWA; solo se necessario eliminare
   la vecchia app-shell/cache e reinstallare. Dopo un'eliminazione dei dati del
   sito serve login e possono essere perse anche le preferenze locali.
8. **Tu, accesso separato**: dispositivo N sceglie N e il suo PIN; dispositivo
   V sceglie V e il suo PIN. Verificare badge N/V corretti e stessa libreria/
   storico CSV di riferimento. PIN sbagliato deve lasciare il gate, senza dati
   né canali; l'email selezionata non deve autorizzare una persona diversa dal
   mapping. Non modificare mapping reali per simulare un errore.
9. **Tu, sessioni**: su N provare Ricordami attivo, chiusura/riapertura online
   con ingresso automatico dopo verifica; su V senza Ricordami, ricarica stessa
   scheda mantiene sessione, nuova sessione/scheda senza opener richiede PIN.
   Ripetere scambiando i casi tra N e V. Il browser può ripristinare schede e
   sessionStorage: verificarlo anche sulla PWA reale. Logout su un dispositivo
   rimuove token/mirror e canali ma conserva tema/audio e lascia l'altro connesso.
10. **Tu, sincronizzazione e refresh**: una modifica film/serata deve arrivare
    sull'altro client una sola volta; proposte/conferme, visioni/recensioni e
    veto proprio funzionano. In Match aprire entrambi, controllare Presence N/V,
    swipe e celebrazione dai dati, Continua simultaneo, uscita/rientro tab senza
    canali duplicati. Dopo il normale refresh JWT della sessione entrambi restano
    autenticati e sincronizzati; interrompere rete e ripristinarla, verificando
    reconnect e recupero eventi. Non accorciare il TTL live per accelerare il test.
11. **Tu, controlli di diniego e rete**: avvio freddo offline con token/cache
    non deve entrare; perdita rete dopo verifica ammette mirror con badge offline
    solo finché il JWT non scade. Errore Auth/RLS deve chiudere l'app, senza
    fallback autorizzante. Richiesta REST anonima e join pubblico/anonimo devono
    essere negati; votes negato anche a N/V. Se già disponibile un account di test
    senza mapping, verificare anche il terzo account; non creare nuovi account
    come parte implicita di questa checklist. Distinguere errore REST esplicito
    da SELECT RLS vuota e verificare che nessun dato applicativo sia esposto.
12. **Chiusura**: registrare gli esiti reali di N/V, PWA, Auth, RLS e Realtime.
    Solo allora dichiarare la messa in sicurezza attiva. In caso di guasto
    interrompere l'uso e preferire correzione frontend compatibile con Auth/RLS;
    nessun riavvio automatico di policy pubbliche. Rollback sotto, scelta manuale.

La sequenza SQL → impostazione Realtime → deploy è obbligatoria per questo
cutover coordinato. La [documentazione Realtime](https://supabase.com/docs/guides/realtime/authorization)
richiede private:true e Allow public access disabilitato per imporre canali privati.

## Rollback

Prima del cutover i dati applicativi e il frontend live sono intatti; PREPARE
ha già aggiunto mapping/helper e account secondo la conferma dell’utente: annullare la fase
locale non richiede modificare i dati storici. Dopo cutover preferire il
rollback a una revisione frontend compatibile con Auth, mantenendo RLS.

L'emergenza verso il vecchio frontend richiede una scelta esplicita:
`supabase-rollback-auth.sql` ripristina policy e grants salvati e lo stato
originario di votes nella publication: la aggiunge solo se prima era pubblicata,
altrimenti la mantiene assente, anche in presenza di modifiche successive.
Le altre membership non vengono modificate. Il rollback può riaprire
l'accesso pubblico e si rifiuta senza `SET scorochiatu.allow_public_rollback = 'yes'`.
Ripristinare separatamente Allow public access se si torna ai vecchi canali.
Account, mapping, backup e dati sono conservati. Nessun DROP. Non rieseguire
il cutover sovrascrivendo il backup: preparare una nuova migration revisionata.
Cutover e rollback sono transazionali: un errore annulla anche la modifica
della publication. Si fermano se supabase_realtime è assente o FOR ALL TABLES,
senza inventare una nuova configurazione di replica.

## Verifiche ripetibili

```sh
node scripts/smoke.js
node scripts/verify-sw.js
node scripts/verify-auth.js
node scripts/verify-auth-rls.js --pglite=/percorso/node_modules/@electric-sql/pglite
node scripts/verify-auth-browser.cjs --playwright=/percorso/node_modules/playwright
```

PGlite e Playwright sono dipendenze solo di verifica; non introdotti nella
app/CDN né installati nel repository. Le fixture sono sintetiche e non sono
account, email o credenziali di produzione. Il test RLS esegue le migration
vere su PostgreSQL locale con schemi Auth/Realtime simulati.

Gli script import/audit/backfill richiedono ora SUPABASE_ACCESS_TOKEN, JWT
breve di un membro autenticato, fornito in ambiente senza salvarlo nel repo o
nella history. Non usare service-role. Il controllo locale del payload non
verifica la firma: la verifica effettiva resta di Supabase e RLS. Non eseguire
script live per validare questa fase senza autorizzazione specifica.
