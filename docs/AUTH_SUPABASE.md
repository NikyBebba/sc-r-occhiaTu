# Supabase Auth e RLS — production-verified

Auth/RLS concluse l’8 ottobre 2026, originariamente distribuite con
`2bd43a6458733d479b32c790a6da5982f425dbce` e cache v50.
Checkpoint produzione v58 (base della release v59) al commit `f3c49fd110592e9d8883f5e797809cf6fc34c0f2`,
[Vercel Production](https://sc-r-occhia-tu.vercel.app), cache `scorochiatu-shell-v58`.
Push/deployment completati; 41/41 file runtime HTTP 200 e identici al commit.
La migration Individual/Rewatch v54 è applicata dall’utente; audit pre/post 24/24.
Frontend v55–v59 pubblicati senza modifiche database/RLS/RPC o utenti Supabase.
Non rieseguire cutover Auth o migration v54. Il collaudo hosted Auth v50 sotto
è distinto dal successivo test reale v58: l’utente ha confermato reset e login
con la nuova password per entrambi gli account N/V.

L’utente ha eseguito e confermato PREPARE, account/mapping, CUTOVER e nuove
policy RLS N/V/realtime.messages. Realtime ON, Allow public access OFF;
publication con movies, movie_nights, swipe_sessions, swipes, vetoes.
votes rimossa dalla publication, tabella e dati conservati, accesso applicativo
negato. Signup pubblico e anonymous disabilitati.

Collaudo reale del cutover Auth v50, confermato dall’utente su entrambi i dispositivi: login N/V, dati,
persistenza sessione, Realtime, Match Live e logout PASS. L’agente ha verificato
push/deployment dello SHA candidato, HTTP 200, 45 file runtime identici,
landing/gate a 320/390/768 px senza errori JS/overflow e SW v50 installato.
Le verifiche browser dell’agente non hanno inviato PIN o richieste Supabase.

Baseline storica del candidato Auth v50: smoke 400/400, Auth 43/43, RLS PostgreSQL
locale 40/40, PWA 15/15, Chromium Auth 18/18 e 144 scenari DOM invariati
(345 API). SDK/Auth e schema hosted sono simulati nei test locali: i casi
negativi anon/terzo account, offline/Auth failure e refresh JWT non sono
nuovi test hosted né casi specifici attestati dal collaudo dell’utente.

AUTH_EMAILS contiene soltanto gli identificativi pubblici forniti dall’utente;
nessun PIN/password, UUID reale o secret aggiunto. Autori N/V, UX e algoritmi
Match conservati. Il backup CLI è stato abbandonato/ripulito; CSV applicativi
manuali conservati fuori da Git, non equivalenti a backup schema/Auth/storage.

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

Non sono introdotti backend, registrazione, OAuth o login tramite magic link.
L'accesso usa due utenti email/password precreati e confermati. Le password
sono gestite dall’operatore in Supabase Auth, mai in config, SQL o storage
applicativo; l’agente non modifica le credenziali. Il frontend accetta password
non vuote, comprese lettere e simboli, senza vincoli PIN/otto cifre o requisiti
ulteriori. La validità della credenziale è determinata da Supabase Auth.

La scelta N/V precompila l’input Account visibile/editabile (type=email,
name=username, autocomplete=username). L’email normalizzata deve corrispondere
a CONFIG.AUTH_EMAILS[pendingUser]: una discrepanza blocca signInPerson senza
correzione automatica. Cambiare persona aggiorna email, svuota password e porta
il focus alla password. Password usa type=password, name=password e
current-password, senza inputmode/pattern/minlength/maxlength del vecchio PIN.
La publishable key resta client-side. La semantica Autofill è convenzionale,
ma il riconoscimento delle credenziali salvate in Safari non è ancora attestato:
le prove reali del campo readonly e della v56 editabile sono fallite.

## Richiesta link dal login — v59

“Password dimenticata?” appare dopo la scelta N/V e non invia il form login.
requestPersonPasswordReset usa esclusivamente CONFIG.AUTH_EMAILS[person]
per N/V, senza leggere l’Account editabile; assenza di mapping/client blocca
la richiesta. Non invia nulla senza persona o durante sessione app/recovery.
La chiamata [resetPasswordForEmail](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)
non specifica redirectTo: usa il Site URL configurato e già verificato dall’utente.
Non modifica sessione/identità, Ricordami o password e non abilita il reset.
Il link deve comunque generare il contesto SDK verificato descritto sotto.

La UI conferma la richiesta senza garantire la consegna, blocca doppio clic e
applica un cooldown di 60 secondi per persona dopo successo o HTTP 429.
Cooldown solo in memoria, senza timer o storage; non sostituisce i limiti server.
Errori rete/configurazione/rate limit hanno testo controllato, senza errori SDK grezzi.
Cambiare persona/uscire invalida il feedback della richiesta precedente.
Cache release v59; pubblicazione autorizzata. UI/invio locale simulato, nessuna email reale inviata
nei test. Auth 82/82, Browser Auth 43/43, SDK pubblico con server locale/PWA 10/10 con AMR otp e 10/10 senza AMR.

## Password recovery — v58

L’utente ha corretto manualmente il Site URL Supabase verso
[production](https://sc-r-occhia-tu.vercel.app/). Il test reale v57 ha confermato arrivo in
production e schermata recovery, ma la verifica rifiutava immediatamente il link.
La causa riprodotta era il requisito errato AMR method=recovery: una sessione
recovery valida può riportare AMR otp. La v58 rimuove la verifica MFA/AAL/AMR
senza sostituirla con una autorizzazione basata su otp.

Il client Supabase JS v2 è caricato dal CDN @2, senza pin di versione. La
simulazione v58 ha usato il SDK pubblico 2.117.3; ciò non garantisce la medesima
versione in ogni cache browser. detectSessionInUrl usa il callback già previsto
nell’API SDK; onAuthStateChange viene collegato appena creato il client.
L’SDK gestisce i parametri e crea la sessione: l’app non interpreta/scambia
manualmente token URL. Il contesto autorizzante richiede l’evento reale
PASSWORD_RECOVERY, non basta rilevare un URL, una sessione OTP, SIGNED_IN,
INITIAL_SESSION o un marker locale.

Prima di abilitare “Imposta nuova password” si verificano sessione SDK, scadenza,
utente online tramite getUser e membership app_members N/V. Bootstrap e normale
session restore non devono sovrascrivere il recovery. Le verifiche sono delegate
fuori dal callback Auth per evitare il lock SDK. Ogni nuovo evento recovery
avanza la revisione e prevale sulle verifiche precedenti: risultati tardivi non
abilitano il form né sovrascrivono il contesto più recente. SIGNED_IN dello stesso
utente conserva il contesto; cambio identità o SIGNED_OUT lo invalidano.
TOKEN_REFRESHED dello stesso utente richiede nuova verifica nel contesto corrente.

Nuova password e Conferma password sono type=password e autocomplete=new-password,
solo nella schermata dedicata. Vuoto o valori diversi bloccano updateUser.
Prima di supabase.auth.updateUser({ password }) si ripetono le verifiche e si
controlla l’identità rispetto a quella preparata; protezioni contro risposte
obsolete e double-submit restano attive. Successo: logout locale, conferma e
ritorno al normale ingresso N/V, senza entrare automaticamente nell’app.

Gli errori espongono messaggi controllati e categorie interne/testabili:

| Categoria | Significato |
| --- | --- |
| INVALID_SESSION | Contesto/sessione recovery non valida o scaduta |
| USER_UNVERIFIABLE | Utente non verificabile online |
| MEMBERSHIP_UNAUTHORIZED | Membership assente o non autorizzata |
| SERVICE_UNAVAILABLE | Rete/servizio non disponibile |

Non tutti gli errori diventano “link scaduto”. Gli errori di validazione della
nuova password permettono un messaggio di riprova coerente, senza dettagli sensibili.
Nessun token/password o errore SDK grezzo è salvato nei diagnostici o loggato.
Lo storage SDK mantiene i token secondo il contratto Auth esistente; il marker
sessionStorage scorochiatu_recovery contiene solo l’ID utente, non autorizza reset.
Il contesto recovery verificato resta in memoria: **un reload lo interrompe**,
elimina la sessione recovery locale e richiede un nuovo link. L’app-shell PWA v58
non conserva URL/token recovery; API Supabase sono escluse dal service worker.

Verifiche v58: Auth 77/77, Chromium Auth 36/36, SDK reale + PWA 8/8 con AMR otp
(default) e 8/8 senza AMR. Auth/membership e sessioni sono simulati con dati
sintetici generati a runtime; nessun reset su account reale eseguito dall’agente.
L’utente conferma reset hosted v58 e login successivo per N/V, oltre al
salvataggio automatico delle credenziali Apple Passwords/Safari. Non estendere
questa conferma alla proposta automatica delle credenziali al prossimo accesso.
Signup pubblico resta disabilitato secondo la configurazione già confermata;
nessun signup introdotto e nessuna nuova verifica/modifica Dashboard in questo ciclo.

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
| movies | SELECT/INSERT/UPDATE/DELETE per membri; guardia v54 protegge personali, legacy e identità; niente TRUNCATE |
| movie_nights | SELECT; niente INSERT/UPDATE/DELETE/TRUNCATE diretti né INSERT/UPDATE di colonna; scritture solo RPC manage_movie_night con membership verificata |
| vetoes | SELECT condiviso; INSERT/DELETE solo person = mapping |
| swipe_sessions | SELECT condiviso; INSERT created_by = mapping; UPDATE condiviso soltanto status/matched_movie_id/matched_at |
| swipes | SELECT condiviso; INSERT person = mapping; niente UPDATE/DELETE |
| votes | Nessun privilegio o policy applicativa, tabella conservata |
| realtime.messages | SELECT sui due topic; INSERT Presence soltanto su scorochiatu-match, sempre membership richiesta |

Le policy precedenti sulle sei tabelle e realtime.messages sono state rimosse
integralmente al cutover Auth concluso: una vecchia policy permissiva si sommerebbe con OR.
Sono revocati i grants applicativi delle tabelle pubbliche, anche per colonna.
La funzione app_person è SECURITY INVOKER e segue la SELECT self del mapping.
Anon non ha accesso. Un terzo account authenticated non è un membro.

La tabella sopra include le restrizioni v54, aggiunte senza cambiare le policy
Auth o la publication. La guardia movies deriva l’autore da app_person e
protegge seen/voto/testo dell’altro anche su INSERT, UPDATE e upsert.
La RPC serate SECURITY DEFINER controlla la membership internamente.
[Contratto e rollback separato v54](INDIVIDUAL_WATCH_REWATCH.md).
La v55 espone Storico N/V dalla Home con gli stessi dati condivisi, senza
aggiungere letture private, duplicare voti o introdurre scritture Auth.

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

## Procedura storica di cutover — completata, non rieseguire

La sequenza sotto documenta la procedura utilizzata. Il cutover del progetto
corrente e il collaudo dei flussi dichiarati sopra sono conclusi; non è una
lista di attività ancora pendenti. Non rieseguire migration già applicate.
Per le verifiche non dichiarate come reali, distinguere la copertura locale.

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

Il cutover è completato: preferire, se necessario, una revisione frontend
compatibile con Auth mantenendo RLS. Non rieseguire PREPARE/CUTOVER e non
riaprire l’accesso pubblico per manutenzione ordinaria. Nessun rollback è
stato eseguito; qualsiasi intervento richiede autorizzazione esplicita.

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

## Limiti residui

- Due membri preconfigurati, nessuna registrazione o separazione multi-spazio.
- Avvio/ripristino richiede rete; mirror offline solo dopo verifica nel runtime
  corrente e con JWT non scaduto.
- Sessione temporanea, ripristino schede e password manager dipendono dal browser.
- Logout locale non revoca immediatamente access token già emessi e non chiude
  l’altro dispositivo; Presence autorizza il topic, non certifica il payload.
- CSV manuali e snapshot policy/grants/publication non sostituiscono un backup
  completo di schema, Auth e storage.

Sono limiti del modello attuale, non blocchi alla migrazione conclusa.

## Verifiche ripetibili

```sh
node scripts/smoke.js
node scripts/verify-sw.js
node scripts/verify-auth.js
node scripts/verify-auth-rls.js --pglite=/percorso/node_modules/@electric-sql/pglite
node scripts/verify-auth-browser.cjs --playwright=/percorso/node_modules/playwright
# SDK pubblico scaricato separatamente; Auth/membership simulati, AMR otp predefinito
NODE_PATH=/percorso/node_modules node scripts/verify-recovery-browser.cjs --sdk=/percorso/supabase-v2.js
NODE_PATH=/percorso/node_modules node scripts/verify-recovery-browser.cjs --sdk=/percorso/supabase-v2.js --amr=none
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
