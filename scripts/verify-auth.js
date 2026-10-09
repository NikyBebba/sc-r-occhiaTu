#!/usr/bin/env node
// Auth reale dell'app con SDK simulato: nessuna connessione o credenziale reale.
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createTestPassword } = require('./test-password.cjs');
const testPassword = createTestPassword();
const root = path.resolve(__dirname, '..');
const storage = map => ({ getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,String(v)), removeItem: k => map.delete(k) });
function fixture(local = new Map(), temporary = new Map()) {
  const calls = [], elements = new Map();
  const session = { access_token: 'fixture-token', user: {id:'fixture-N'}, expires_at: Math.floor(Date.now()/1000)+3600 };
  const state = {initError:null,updates:0,session, member:{user_id:'fixture-N',person:'N'}, userError:null, memberError:null, transportError:null};
  let callback;
  const sdk = {
    auth:{
      mfa:{async getAuthenticatorAssuranceLevel(){throw new Error('MFA must not be called');}},
      async updateUser(){state.updates++;return {data:{user:state.session.user},error:null};},
      async initialize(){return {error:state.initError};},async getSession(){return {data:{session:state.session},error:null};},
      async getUser(){calls.push('getUser');return {data:{user:state.session?.user},error:state.userError};},
      async signInWithPassword(credentials){calls.push(['login',credentials]);vm.runInContext('authStorage',ctx).setItem('scorochiatu_auth',JSON.stringify(state.session));return {data:{session:state.session},error:null};},
      async signOut(options){calls.push(['signOut',options]);callback?.('SIGNED_OUT',null);return {error:null};},
      onAuthStateChange(fn){callback=fn;return {data:{subscription:{unsubscribe(){}}}};}
    },
    from(table){assert.equal(table,'app_members');return {select(){return this;},eq(){return this;},async maybeSingle(){calls.push('membership');return {data:state.member,error:state.memberError,status:state.memberStatus};}};},
    realtime:{async setAuth(token){calls.push(['jwt',token]);if(state.transportError)throw state.transportError;},disconnect(){calls.push('disconnect');}}
  };
  const el = id => {if(!elements.has(id)) elements.set(id,{textContent:'',focus(){},classList:{add(){},remove(){}}});return elements.get(id);};
  const ctx = vm.createContext({testPassword,localStorage:storage(local),sessionStorage:storage(temporary),Date,Number,Error,Promise,setTimeout,clearTimeout,console,
    window:{addEventListener(){}},document:{addEventListener(){},querySelectorAll(){return [];},getElementById:el},
    sb:sdk,CONFIG:{AUTH_EMAILS:{N:'n@example.test',V:'v@example.test'}},currentUser:null,currentTab:'watchlist',
    movies:[],movieNights:[],vetoes:[],votes:[],swipeSessions:[],swipes:[],resyncTimer:null,matchResyncTimer:null,matchChannel:null,
    unsubscribeRealtime(){calls.push('unsubscribe');},leaveMatch(full){calls.push(['leaveMatch',full]);},showLanding(){calls.push('landing');},showApp(){calls.push('app');},showRecoveryScreen(message=''){calls.push(['recovery',message]);},
    subscribeRealtime(){calls.push('subscribe');},async resyncQuiet(){calls.push('resync');},async enterMatch(){calls.push('match');}
  });
  vm.runInContext(fs.readFileSync(path.join(root,'js/auth.js'),'utf8'),ctx);
  return {ctx,state,calls,local,temporary,run:code=>vm.runInContext(code,ctx),emit:(event,value)=>callback(event,value)};
}
let count=0;
async function test(name,fn){await fn();count++;console.log('PASS '+name);}
(async()=>{
 const startRecovery=async f=>{f.run('attachAuthListener()');f.emit('PASSWORD_RECOVERY',f.state.session);await f.run('initializeAuth()');};
 for(const amr of ['otp','password','other'])await test('PASSWORD_RECOVERY + AMR '+amr+': verificata senza AAL',async()=>{
  const f=fixture();f.state.session.amr=[{method:amr}];f.ctx.sb.auth.mfa.getAuthenticatorAssuranceLevel=()=>{throw new Error('MFA must not be called');};await startRecovery(f);
  assert(f.run('!!authRecoveryIdentity'));assert(!f.run('isAppAuthorized()'));assert(!f.calls.includes('app'));assert(f.calls.includes('membership'));
 });
 await test('updateUser vietata senza contesto recovery',async()=>{const f=fixture();await f.run('initializeAuth()');await assert.rejects(f.run('updateRecoveryPassword(testPassword)'),/INVALID_SESSION/);assert.equal(f.state.updates,0);});
 for(const event of ['INITIAL_SESSION','SIGNED_IN'])await test('sessione OTP '+event+' senza PASSWORD_RECOVERY: reset impossibile',async()=>{
  const f=fixture();f.state.session.amr=[{method:'otp'}];f.run('attachAuthListener()');f.emit(event,f.state.session);await f.run('initializeAuth()');await f.run('preparePasswordRecovery()');
  assert(!f.run('authRecoveryIdentity'));assert(!f.calls.some(c=>Array.isArray(c)&&c[0]==='recovery'));await assert.rejects(f.run('updateRecoveryPassword(testPassword)'),/INVALID_SESSION/);
 });
 for(const owner of ['fixture-N','fixture-V'])await test('marker locale '+owner+' non autorizza reset; reload richiede nuovo link',async()=>{
  const f=fixture();f.temporary.set('scorochiatu_recovery',owner);await f.run('initializeAuth()');assert(!f.run('authRecoveryIdentity'));assert(!f.calls.includes('app'));assert(!f.calls.some(c=>Array.isArray(c)&&c[0]==='recovery'));
  await assert.rejects(f.run('updateRecoveryPassword(testPassword)'),/INVALID_SESSION/);assert.equal(f.state.updates,0);assert(!f.temporary.has('scorochiatu_recovery'));
 });
 await test('reload recovery: SIGNED_IN durante getSession non anticipa il restore normale',async()=>{
  const f=fixture();f.temporary.set('scorochiatu_recovery','fixture-N');let finish;f.ctx.sb.auth.getSession=()=>new Promise(resolve=>{finish=resolve;});
  const boot=f.run('initializeAuth()');await new Promise(resolve=>setTimeout(resolve,0));f.emit('SIGNED_IN',f.state.session);await new Promise(resolve=>setTimeout(resolve,0));assert(!f.calls.includes('app'));
  finish({data:{session:f.state.session},error:null});await boot;assert(!f.calls.includes('app'));assert(!f.run('authRecoveryIdentity'));
 });
 await test('redirect scaduto prevale su sessione salvata',async()=>{const f=fixture();f.run("detectAuthCallback(null,{error_code:'otp_expired'})");f.state.initError={status:400,code:'otp_expired'};await f.run('initializeAuth()');assert(!f.calls.includes('app'));assert.equal(f.run('authRecoveryError.category'),'INVALID_SESSION');});
 await test('redirect SDK scaduto con status 0 non è un errore rete',()=>{const f=fixture();assert.equal(f.run("recoveryFailure({name:'AuthImplicitGrantRedirectError',status:0},'bootstrap').recoveryCategory"),'INVALID_SESSION');});
 await test('INITIAL_SESSION → PASSWORD_RECOVERY: restore attende evento SDK',async()=>{
  const f=fixture();f.run('attachAuthListener()');f.run("detectAuthCallback(null,{type:'recovery',access_token:'fixture-token'})");
  const pending=f.run('initializeAuth()');f.emit('INITIAL_SESSION',f.state.session);await new Promise(resolve=>setTimeout(resolve,0));assert(!f.calls.includes('app'));
  f.emit('PASSWORD_RECOVERY',f.state.session);await pending;assert(f.run('!!authRecoveryIdentity'));assert(!f.calls.includes('app'));
 });
 await test('PASSWORD_RECOVERY → SIGNED_IN: mantiene solo recovery',async()=>{const f=fixture();await startRecovery(f);f.emit('SIGNED_IN',f.state.session);await new Promise(resolve=>setTimeout(resolve,0));assert(f.run('!!authRecoveryIdentity'));assert(!f.calls.includes('app'));});
 for(const staleError of [false,true])await test('due recovery ravvicinate: risposta precedente '+(staleError?'fallita':'valida')+', prevale V',async()=>{
  const f=fixture();let finish;let n=0;f.ctx.sb.auth.getUser=async()=>{if(++n===1)return new Promise(resolve=>{finish=resolve;});return {data:{user:f.state.session.user},error:null};};
  f.run('attachAuthListener()');f.emit('PASSWORD_RECOVERY',f.state.session);const boot=f.run('initializeAuth()');await new Promise(resolve=>setTimeout(resolve,0));
  f.state.session={...f.state.session,user:{id:'fixture-V'},access_token:'fixture-V'};f.state.member={user_id:'fixture-V',person:'V'};f.emit('PASSWORD_RECOVERY',f.state.session);
  await f.run('preparePasswordRecovery()');assert.equal(f.run('authRecoveryIdentity.uid'),'fixture-V');
  finish(staleError?{data:{},error:{status:401}}:{data:{user:{id:'fixture-N'}},error:null});await boot;await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(f.run('authRecoveryIdentity.uid'),'fixture-V');assert.equal(f.run('authRecoveryIdentity.person'),'V');assert.equal(f.run('authRecoveryError'),null);assert(!f.calls.includes('app'));
 });
 await test('refresh SDK durante verifica: verifica token più recente senza blocco',async()=>{
  const f=fixture();let finish,n=0;f.ctx.sb.auth.getUser=async()=>{if(++n===1)return new Promise(resolve=>{finish=resolve;});return {data:{user:f.state.session.user},error:null};};
  f.run('attachAuthListener()');f.emit('PASSWORD_RECOVERY',f.state.session);const boot=f.run('initializeAuth()');await new Promise(resolve=>setTimeout(resolve,0));
  f.state.session={...f.state.session,access_token:'fixture-refreshed'};f.emit('TOKEN_REFRESHED',f.state.session);await f.run('preparePasswordRecovery()');assert(f.run('!!authRecoveryIdentity'));finish({data:{user:f.state.session.user},error:null});await boot;
  assert(f.run('!!authRecoveryIdentity'));assert.equal(f.run('authRecoverySession.access_token'),'fixture-refreshed');await f.run('updateRecoveryPassword(testPassword)');assert.equal(f.state.updates,1);
 });
 await test('reload durante verifica: nessun contesto ricreato dal marker',async()=>{
  const f=fixture();let finish;f.ctx.sb.auth.getUser=()=>new Promise(resolve=>{finish=resolve;});f.run('attachAuthListener()');f.emit('PASSWORD_RECOVERY',f.state.session);const boot=f.run('initializeAuth()');await new Promise(resolve=>setTimeout(resolve,0));
  const next=fixture(f.local,f.temporary);await next.run('initializeAuth()');assert(!next.run('authRecoveryIdentity'));assert(!next.calls.includes('app'));await assert.rejects(next.run('updateRecoveryPassword(testPassword)'),/INVALID_SESSION/);
  finish({data:{user:f.state.session.user},error:null});await boot;
 });
 for(const scenario of ['expired','user-invalid','user-mismatch','member-absent','member-invalid','network','service','postgrest-network','member-denied'])await test('recovery errore classificato: '+scenario,async()=>{
  const f=fixture();let category;
  if(scenario==='expired'){f.state.session.expires_at=1;category='INVALID_SESSION';}
  if(scenario==='user-invalid'){f.state.userError={status:400,code:'unexpected_user_error'};category='USER_UNVERIFIABLE';}
  if(scenario==='user-mismatch'){f.ctx.sb.auth.getUser=async()=>({data:{user:{id:'other'}},error:null});category='USER_UNVERIFIABLE';}
  if(scenario==='member-absent'){f.state.member=null;category='MEMBERSHIP_UNAUTHORIZED';}
  if(scenario==='member-invalid'){f.state.member.person='X';category='MEMBERSHIP_UNAUTHORIZED';}
  if(scenario==='network'){f.state.userError={status:0,name:'AuthRetryableFetchError'};category='SERVICE_UNAVAILABLE';}
  if(scenario==='service'){f.state.memberError={status:503};category='SERVICE_UNAVAILABLE';}
  if(scenario==='postgrest-network'){f.state.memberError={message:'Failed to fetch'};f.state.memberStatus=0;category='SERVICE_UNAVAILABLE';}
  if(scenario==='member-denied'){f.state.memberError={code:'42501'};f.state.memberStatus=403;category='MEMBERSHIP_UNAUTHORIZED';}
  await startRecovery(f);assert(!f.run('authRecoveryIdentity'));assert.equal(f.run('authRecoveryError.category'),category);assert.equal(f.state.updates,0);assert(!f.calls.includes('app'));
 });
 await test('SIGNED_IN per altra identità invalida recovery, nessuna updateUser',async()=>{
  const f=fixture();await startRecovery(f);f.state.session={...f.state.session,user:{id:'fixture-V'}};f.emit('SIGNED_IN',f.state.session);
  await assert.rejects(f.run('updateRecoveryPassword(testPassword)'),/INVALID_SESSION/);assert(!f.run('authRecoveryIdentity'));assert.equal(f.state.updates,0);
 });
 await test('updateUser verifica identità preparata anche senza evento cambio account',async()=>{
  const f=fixture();await startRecovery(f);f.state.session={...f.state.session,user:{id:'fixture-V'}};f.state.member={user_id:'fixture-V',person:'V'};
  await assert.rejects(f.run('updateRecoveryPassword(testPassword)'),/INVALID_SESSION/);assert.equal(f.state.updates,0);
 });
 await test('recovery: logout durante verifica impedisce updateUser',async()=>{
  const f=fixture();await startRecovery(f);let finish;f.ctx.sb.auth.getUser=()=>new Promise(resolve=>{finish=resolve;});const pending=f.run('updateRecoveryPassword(testPassword)');
  await new Promise(resolve=>setTimeout(resolve,0));f.emit('SIGNED_OUT',null);finish({data:{user:f.state.session.user},error:null});await assert.rejects(pending,/INVALID_SESSION/);assert.equal(f.state.updates,0);
 });
 await test('config runtime: email N/V distinte, login Auth e nessuna password/secret',async()=>{
  const runtime=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(root,'js/config.js'),'utf8'),runtime);
  const config=vm.runInContext('CONFIG',runtime);
  assert.ok(['N','V'].every(person=>typeof config.AUTH_EMAILS?.[person]==='string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.AUTH_EMAILS[person])));
  assert.ok(config.AUTH_EMAILS.N!==config.AUTH_EMAILS.V);
  assert.ok(!/sb_secret_|service_role/.test(JSON.stringify(config)));
  assert.ok(['N','V'].every(person=>!Object.keys(config.PEOPLE[person]).some(key=>/pin|password|uuid|secret/i.test(key))));
  for(const person of ['N','V']){
   const f=fixture();f.ctx.CONFIG.AUTH_EMAILS=config.AUTH_EMAILS;f.state.member.person=person;
   await f.run(`signInPerson('${person}',testPassword,false)`);
   assert.ok(f.calls.find(call=>Array.isArray(call)&&call[0]==='login')?.[1].email===config.AUTH_EMAILS[person]);
   assert.equal(f.ctx.currentUser,person);
  }
 });
 await test('identità locale e UI non autorizzano',()=>{const f=fixture();f.ctx.currentUser='N';f.local.set('scorochiatu_user','N');assert.equal(f.run('isAppAuthorized()'),false);assert.throws(()=>f.run('requireAppIdentity()'),/AUTH_REQUIRED/);});
 for(const remember of [true,false]){
  await test('login: storage '+(remember?'persistente':'temporaneo')+', mai password',async()=>{const f=fixture();await f.run(`signInPerson('N',testPassword,${remember})`);assert.equal(f.ctx.currentUser,'N');assert.equal(f.run('isAppAuthorized()'),true);assert.equal(f.local.has('scorochiatu_auth'),remember);assert.equal(f.temporary.has('scorochiatu_auth'),!remember);assert(!JSON.stringify([...f.local,...f.temporary]).includes(testPassword));assert(f.calls.some(c=>Array.isArray(c)&&c[0]==='jwt'));});
  await test('riapertura: '+(remember?'sessione verificata ripristinata':'sessione non conservata'),async()=>{const first=fixture();await first.run(`signInPerson('N',testPassword,${remember})`);const next=fixture(first.local,new Map());if(!remember)next.state.session=null;await next.run('initializeAuth()');assert.equal(next.run('isAppAuthorized()'),remember);assert.equal(next.calls.includes('app'),remember);if(remember)assert(next.calls.indexOf('membership')<next.calls.indexOf('app'));});
 }
 await test('mapping V prevale su persona locale N',async()=>{const f=fixture();f.ctx.currentUser='N';f.state.session.user.id='fixture-V';f.state.member={user_id:'fixture-V',person:'V'};await f.run('initializeAuth()');assert.equal(f.ctx.currentUser,'V');});
 for(const name of ['terzo account','mapping UUID diverso','persona invalida','JWT scaduto','utente server diverso']){
  await test('nega '+name,async()=>{const f=fixture();if(name==='terzo account')f.state.member=null;if(name==='mapping UUID diverso')f.state.member.user_id='other';if(name==='persona invalida')f.state.member.person='X';if(name==='JWT scaduto')f.state.session.expires_at=1;if(name==='utente server diverso'){f.ctx.sb.auth.getUser=async()=>({data:{user:{id:'different'}},error:null});}await f.run('initializeAuth()');assert.equal(f.run('isAppAuthorized()'),false);assert(!f.calls.includes('app'));});
 }
 await test('selezione N con mapping V: login negato e signout locale',async()=>{const f=fixture();f.state.member.person='V';await assert.rejects(f.run("signInPerson('N',testPassword,true)"),/AUTH_NOT_MEMBER/);assert.equal(f.run('isAppAuthorized()'),false);assert(!f.local.has('scorochiatu_auth'));assert(f.calls.some(c=>c[0]==='signOut'&&c[1].scope==='local'));});
 await test('email non configurata: fail closed',async()=>{const f=fixture();f.ctx.CONFIG.AUTH_EMAILS.N='';await assert.rejects(f.run("signInPerson('N',testPassword,true)"),/AUTH_NOT_CONFIGURED/);assert(!f.calls.some(c=>c[0]==='login'));});
 await test('cold start offline: mirror non autorizza',async()=>{const f=fixture();f.local.set('scorochiatu_movies','[{}]');f.state.userError={name:'AuthRetryableFetchError',status:0,message:'offline'};await f.run('initializeAuth()');assert.equal(f.run('isAppAuthorized()'),false);assert(!f.calls.includes('app'));});
 await test('offline dopo verifica: identità valida conservata',async()=>{const f=fixture();await f.run('establishAuth(sbFixtureSession)'.replace('sbFixtureSession',JSON.stringify(f.state.session)));f.state.userError={name:'AuthRetryableFetchError',status:0,message:'offline'};await assert.rejects(f.run('validateCurrentAuth()'));assert(f.run('isAppAuthorized()'));});
 for(const status of [401,403]) await test('errore '+status+' chiude app, nessun fallback',async()=>{const f=fixture();await f.run('initializeAuth()');f.state.userError={status,message:'denied'};await assert.rejects(f.run('validateCurrentAuth()'),/AUTH_REQUIRED/);assert.equal(f.ctx.currentUser,null);});
 await test('RLS 42501 chiude immediatamente',async()=>{const f=fixture();await f.run('initializeAuth()');assert.throws(()=>f.run("handleDataAuthError({code:'42501'})"),/AUTH_DENIED/);assert.equal(f.run('isAppAuthorized()'),false);});
 await test('logout: canali, mirror, token rimossi; tema/audio conservati',async()=>{const f=fixture();await f.run("signInPerson('N',testPassword,true)");for(const k of ['movies','movie_nights','votes','vetoes','user','mirror_owner'])f.local.set('scorochiatu_'+k,'sensitive');f.local.set('scorochiatu_theme','autunno');f.local.set('scorochiatu_audio','true');await f.run('signOutApp()');assert.equal(f.run('isAppAuthorized()'),false);assert.equal(f.local.size,2);assert.equal(f.temporary.size,0);assert(f.calls.includes('disconnect'));assert(f.calls.some(c=>c[0]==='leaveMatch'&&c[1]===true));});
 await test('risposta Auth in volo dopo logout non ristabilisce identità',async()=>{const f=fixture();let release;f.ctx.sb.auth.getUser=()=>new Promise(resolve=>{release=resolve;});const pending=f.run('initializeAuth()');await new Promise(r=>setTimeout(r,0));await f.run('signOutApp()');release({data:{user:{id:'fixture-N'}},error:null});await pending;assert.equal(f.run('isAppAuthorized()'),false);assert(!f.calls.includes('app'));});
 await test('errore autenticazione trasporto al boot: ingresso negato',async()=>{const f=fixture();f.state.transportError=new Error('transport');await f.run('initializeAuth()');assert.equal(f.run('isAppAuthorized()'),false);assert(!f.calls.includes('app'));});
 await test('refresh: JWT aggiornato, canali senza duplicare ingresso',async()=>{const f=fixture();await f.run('initializeAuth()');f.state.session.access_token='fixture-refreshed';await f.run('refreshAuthConnection()');assert.equal(f.calls.filter(c=>c==='app').length,1);assert.equal(f.calls.filter(c=>c==='subscribe').length,1);assert(f.calls.some(c=>c[0]==='jwt'&&c[1]==='fixture-refreshed'));});
 await test('refresh single flight e recupero Match',async()=>{const f=fixture();await f.run('initializeAuth()');f.ctx.currentTab='match';await Promise.all([f.run('refreshAuthConnection()'),f.run('refreshAuthConnection()')]);assert.equal(f.calls.filter(c=>c==='subscribe').length,1);assert.equal(f.calls.filter(c=>c==='match').length,1);});
 await test('callback SIGNED_OUT invalida identità',async()=>{const f=fixture();await f.run('initializeAuth()');f.emit('SIGNED_OUT',null);assert.equal(f.run('isAppAuthorized()'),false);});
 await test('membership revocata al refresh: app chiusa',async()=>{const f=fixture();await f.run('initializeAuth()');f.state.member=null;await f.run('refreshAuthConnection()');assert.equal(f.run('isAppAuthorized()'),false);});
 await test('JWT scaduto offline: mirror vietato',async()=>{const f=fixture();await f.run('initializeAuth()');f.run('authIdentity.expiresAt=1');assert.throws(()=>f.run('requireAppIdentity()'),/AUTH_REQUIRED/);assert.equal(f.ctx.currentUser,null);});
 await test('insertMovie completato dopo logout: nessun dato ripopolato',async()=>{const f=fixture();await f.run('initializeAuth()');vm.runInContext(fs.readFileSync(path.join(root,'js/store/movies.js'),'utf8'),f.ctx);let finish;f.ctx.sb.from=()=>({insert(){return this;},select(){return new Promise(resolve=>{finish=resolve;});}});const pending=f.run("insertMovie({title:'Fixture'})");await f.run('signOutApp()');finish({data:[{id:'fixture'}],error:null});await assert.rejects(pending,/AUTH_REQUIRED|AUTH_CHANGED/);assert.equal(f.ctx.movies.length,0);});
 await test('RPC serata completata dopo logout non ripopola il mirror',async()=>{
  const f=fixture();await f.run('initializeAuth()');vm.runInContext(fs.readFileSync(path.join(root,'js/store/nights.js'),'utf8'),f.ctx);
  f.ctx.movies=[{id:'fixture',seen_n:false,seen_v:false}];let finish;f.ctx.sb.rpc=()=>new Promise(resolve=>{finish=resolve;});
  const pending=f.run("setQuickTonight('fixture')");await f.run('signOutApp()');finish({data:{id:'night',movie_id:'fixture',status:'confirmed'},error:null});
  await assert.rejects(pending,/AUTH_REQUIRED|AUTH_CHANGED/);assert.equal(f.ctx.movies.length,0);assert.equal(f.ctx.movieNights.length,0);
 });
 await test('RPC RLS 42501 chiude Auth senza successo offline',async()=>{
  const f=fixture();await f.run('initializeAuth()');vm.runInContext(fs.readFileSync(path.join(root,'js/store/nights.js'),'utf8'),f.ctx);
  f.ctx.movies=[{id:'fixture'}];f.ctx.dbMode='supabase';f.ctx.sb.rpc=async()=>({error:{code:'42501',message:'denied'},data:null});
  await assert.rejects(f.run("setQuickTonight('fixture')"),/AUTH_DENIED/);assert.equal(f.run('isAppAuthorized()'),false);assert.equal(f.ctx.movieNights.length,0);assert.equal(f.ctx.dbMode,'supabase');
 });
 await test('RPC errore rete non crea una serata locale fittizia',async()=>{
  const f=fixture();await f.run('initializeAuth()');vm.runInContext(fs.readFileSync(path.join(root,'js/store/nights.js'),'utf8'),f.ctx);
  f.ctx.movies=[{id:'fixture',in_shared_list: true, status:'watchlist'}];f.ctx.dbMode='supabase';f.ctx.sb.rpc=async()=>{throw new Error('network');};
  assert.equal(await f.run("setQuickTonight('fixture')"),false);assert.equal(f.ctx.movieNights.length,0);assert.equal(f.ctx.movies[0].status,'watchlist');assert.equal(f.ctx.dbMode,'local');assert.equal(f.run('isAppAuthorized()'),true);
 });
 await test('identità Auth N rifiuta dichiarazione V prima di qualsiasi query',async()=>{
  const f=fixture();await f.run('initializeAuth()');vm.runInContext(fs.readFileSync(path.join(root,'js/store/viewing.js'),'utf8'),f.ctx);
  f.ctx.sb.from=()=>{throw new Error('Unexpected query');};assert.equal(await f.run("markMovieSeen('fixture','V',10)"),false);
 });
 await test('conferma personale pendente non agisce dopo cambio account N→V',async()=>{
  const f=fixture();await f.run('initializeAuth()');vm.runInContext(fs.readFileSync(path.join(root,'js/ui/actions/viewing.js'),'utf8'),f.ctx);
  f.ctx.document.getElementById('detailModal').classList.contains=()=>true;let finish,writes=0;
  f.ctx.showConfirmModal=()=>new Promise(resolve=>{finish=resolve;});f.ctx.savePersonalReview=async()=>{writes++;return true;};
  const pending=f.run("removePersonalRating('fixture')");await f.run('signOutApp()');f.state.session.user.id='fixture-V';f.state.member={user_id:'fixture-V',person:'V'};await f.run('initializeAuth()');finish(true);await pending;
  assert.equal(writes,0);assert.equal(f.ctx.currentUser,'V');
 });
 await test('storage refresh: conserva la scelta e rimuove copia opposta',async()=>{const f=fixture();await f.run("signInPerson('N',testPassword,false)");f.local.set('scorochiatu_auth','stale');f.run("authStorage.setItem(AUTH_STORAGE_KEY,'refreshed')");assert.equal(f.local.has('scorochiatu_auth'),false);assert.equal(f.temporary.get('scorochiatu_auth'),'refreshed');});
 await test('Match reale: JWT e private channel N, refresh senza duplicati, logout chiude',async()=>{const f=fixture();f.ctx.dbMode='supabase';vm.runInContext(fs.readFileSync(path.join(root,'js/store/match.js'),'utf8'),f.ctx);const channels=[];f.ctx.sb.channel=(topic,options)=>{f.calls.push(['matchChannel',topic,options]);const c={on(){return c;},subscribe(){channels.push(c);return c;},untrack(){return Promise.resolve();}};return c;};f.ctx.sb.getChannels=()=>channels;f.ctx.sb.removeChannel=c=>{channels.splice(channels.indexOf(c),1);return Promise.resolve();};assert.equal(f.run('openMatchChannel()'),null);await f.run('initializeAuth()');f.run('matchAvailable=true');f.run('openMatchChannel()');f.run('openMatchChannel()');await f.run('refreshAuthConnection()');assert.equal(channels.length,1);const call=f.calls.find(c=>c[0]==='matchChannel');assert.equal(call[1],'scorochiatu-match');assert.equal(call[2].config.private,true);assert.equal(call[2].config.presence.key,'N');await f.run('signOutApp()');assert.equal(channels.length,0);assert.equal(f.run('isAppAuthorized()'),false);});
 for(const method of ['validateCurrentAuth','refreshAuthConnection'])await test('risposta '+method+' obsoleta non chiude nuova sessione',async()=>{const f=fixture();await f.run('initializeAuth()');let finish;f.ctx.sb.auth.getUser=()=>new Promise(resolve=>{finish=resolve;});const pending=f.run(method+'()');await new Promise(r=>setTimeout(r,0));f.run('authEpoch++');finish({data:{},error:{status:401,message:'stale'}});if(method==='validateCurrentAuth')await assert.rejects(pending,/AUTH_CHANGED/);else await pending;assert.equal(f.run('isAppAuthorized()'),true);});
 await test('getSession obsoleto: errore Auth non invalida nuova identità',async()=>{const f=fixture();await f.run('initializeAuth()');let finish;f.ctx.sb.auth.getSession=()=>new Promise(resolve=>{finish=resolve;});const pending=f.run('validateCurrentAuth()');f.run('authEpoch++');finish({data:{session:null},error:{status:401,message:'stale'}});await assert.rejects(pending,/AUTH_CHANGED/);assert.equal(f.run('isAppAuthorized()'),true);});
 await test('AuthSessionMissingError senza status non è offline',async()=>{const f=fixture();await f.run('initializeAuth()');f.state.userError={name:'AuthSessionMissingError',message:'session missing'};await assert.rejects(f.run('validateCurrentAuth()'),/AUTH_REQUIRED/);assert.equal(f.run('isAppAuthorized()'),false);});
 for(const person of ['N','V'])for(const remember of [false,true])await test('account '+person+' storage/login '+remember,async()=>{const f=fixture();f.state.session.user.id='fixture-'+person;f.state.member={user_id:'fixture-'+person,person};await f.run(`signInPerson('${person}',testPassword,${remember})`);assert.equal(f.ctx.currentUser,person);assert.equal(f.calls.find(c=>c[0]==='login')[1].email,f.ctx.CONFIG.AUTH_EMAILS[person]);assert.equal(f.local.has('scorochiatu_auth'),remember);assert.equal(f.temporary.has('scorochiatu_auth'),!remember);});
 await test('callback TOKEN_REFRESHED aggiorna JWT/scadenza senza nuovo ingresso',async()=>{const f=fixture();await f.run('initializeAuth()');const refreshed={...f.state.session,access_token:'fixture-latest',expires_at:f.state.session.expires_at+3600};f.state.session=refreshed;f.emit('TOKEN_REFRESHED',refreshed);await new Promise(r=>setTimeout(r,10));assert(f.calls.some(c=>c[0]==='jwt'&&c[1]==='fixture-latest'));assert.equal(f.run('authIdentity.expiresAt'),refreshed.expires_at*1000);assert.equal(f.calls.filter(c=>c==='app').length,1);assert.equal(f.calls.filter(c=>c==='subscribe').length,1);});
 const {supabaseAuthHeaders}=require('./supabase-auth-headers');
 const oldToken=process.env.SUPABASE_ACCESS_TOKEN;
 try {
  for(const mode of ['assente','service_role','scaduto','authenticated'])await test('CLI JWT '+mode,()=>{delete process.env.SUPABASE_ACCESS_TOKEN;if(mode!=='assente'){const claims={sub:'fixture',role:mode==='service_role'?'service_role':'authenticated',exp:mode==='scaduto'?1:Math.floor(Date.now()/1000)+60};process.env.SUPABASE_ACCESS_TOKEN='fixture.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.fixture';}if(mode==='authenticated')assert.equal(supabaseAuthHeaders('public-key').Authorization,'Bearer '+process.env.SUPABASE_ACCESS_TOKEN);else assert.throws(()=>supabaseAuthHeaders('public-key'),/SUPABASE_ACCESS_TOKEN/);});
 } finally {if(oldToken===undefined)delete process.env.SUPABASE_ACCESS_TOKEN;else process.env.SUPABASE_ACCESS_TOKEN=oldToken;}
 console.log(`Auth: ${count}/${count} PASS (SDK simulato, nessun test live)`);
})().catch(error=>{console.error(error);process.exitCode=1;});
