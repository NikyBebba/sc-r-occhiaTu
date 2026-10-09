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
  const state = {recoveryMethod:true,initError:null,updates:0,session, member:{user_id:'fixture-N',person:'N'}, userError:null, memberError:null, transportError:null};
  let callback;
  const sdk = {
    auth:{
      mfa:{async getAuthenticatorAssuranceLevel(){return {data:{currentAuthenticationMethods:state.recoveryMethod?[{method:'recovery'}]:[{method:'password'}]},error:null};}},
      async updateUser(){state.updates++;return {data:{user:state.session.user},error:null};},
      async initialize(){return {error:state.initError};},async getSession(){return {data:{session:state.session},error:null};},
      async getUser(){calls.push('getUser');return {data:{user:state.session?.user},error:state.userError};},
      async signInWithPassword(credentials){calls.push(['login',credentials]);vm.runInContext('authStorage',ctx).setItem('scorochiatu_auth',JSON.stringify(state.session));return {data:{session:state.session},error:null};},
      async signOut(options){calls.push(['signOut',options]);callback?.('SIGNED_OUT',null);return {error:null};},
      onAuthStateChange(fn){callback=fn;return {data:{subscription:{unsubscribe(){}}}};}
    },
    from(table){assert.equal(table,'app_members');return {select(){return this;},eq(){return this;},async maybeSingle(){calls.push('membership');return {data:state.member,error:state.memberError};}};},
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
 await test('recovery prima del boot: verificata, nessun ingresso app',async()=>{
  const f=fixture();f.run('attachAuthListener()');f.emit('PASSWORD_RECOVERY',f.state.session);await f.run('initializeAuth()');
  assert(f.run('!!authRecoveryIdentity'));assert(!f.run('isAppAuthorized()'));assert(!f.calls.includes('app'));assert(f.calls.includes('membership'));
 });
 await test('updateUser vietata senza contesto recovery',async()=>{const f=fixture();await f.run('initializeAuth()');await assert.rejects(f.run('updateRecoveryPassword(testPassword)'),/AUTH_REQUIRED/);assert.equal(f.state.updates,0);});
 await test('marker recovery solo UI: sessione normale non autorizza il reset',async()=>{const f=fixture();f.temporary.set('scorochiatu_recovery','fixture-N');f.state.recoveryMethod=false;await f.run('initializeAuth()');assert(!f.run('authRecoveryIdentity'));await assert.rejects(f.run('updateRecoveryPassword(testPassword)'),/AUTH_REQUIRED/);assert.equal(f.state.updates,0);assert(!f.calls.includes('app'));});
 await test('marker recovery con account diverso: nessun bypass',async()=>{const f=fixture();f.temporary.set('scorochiatu_recovery','fixture-V');await f.run('initializeAuth()');assert(!f.run('authRecoveryIdentity'));assert(!f.calls.includes('app'));});
 await test('redirect scaduto prevale su sessione salvata',async()=>{const f=fixture();f.run("detectAuthCallback(null,{error_code:'otp_expired'})");f.state.initError={status:400};await f.run('initializeAuth()');assert(!f.calls.includes('app'));assert(f.calls.some(call=>Array.isArray(call)&&call[0]==='recovery'&&call[1].includes('scaduto')));});
 await test('restore attende evento SDK recovery, senza timer applicativo',async()=>{
  const f=fixture();f.run('attachAuthListener()');f.run("detectAuthCallback(null,{type:'recovery',access_token:'fixture-token'})");
  const pending=f.run('initializeAuth()');await new Promise(resolve=>setTimeout(resolve,0));assert(!f.calls.includes('app'));
  f.emit('PASSWORD_RECOVERY',f.state.session);await pending;assert(f.run('!!authRecoveryIdentity'));assert(!f.calls.includes('app'));
 });
 await test('recovery: logout durante verifica impedisce updateUser',async()=>{
  const f=fixture();f.run('attachAuthListener()');f.emit('PASSWORD_RECOVERY',f.state.session);await f.run('initializeAuth()');
  let finish;f.ctx.sb.auth.getUser=()=>new Promise(resolve=>{finish=resolve;});const pending=f.run('updateRecoveryPassword(testPassword)');
  await new Promise(resolve=>setTimeout(resolve,0));f.emit('SIGNED_OUT',null);finish({data:{user:f.state.session.user},error:null});
  await assert.rejects(pending,/AUTH_CHANGED/);assert.equal(f.state.updates,0);
 });
 await test('recovery: refresh SDK conserva contesto senza aprire app',async()=>{
  const f=fixture();f.run('attachAuthListener()');f.emit('PASSWORD_RECOVERY',f.state.session);await f.run('initializeAuth()');
  f.state.session={...f.state.session,access_token:'fixture-refreshed'};f.emit('TOKEN_REFRESHED',f.state.session);
  await f.run('updateRecoveryPassword(testPassword)');assert.equal(f.state.updates,1);assert(!f.calls.includes('app'));
 });
 await test('recovery: terzo account senza membership non può cambiare password',async()=>{
  const f=fixture();f.state.member=null;f.run('attachAuthListener()');f.emit('PASSWORD_RECOVERY',f.state.session);await f.run('initializeAuth()');
  await assert.rejects(f.run('updateRecoveryPassword(testPassword)'),/AUTH_REQUIRED/);assert.equal(f.state.updates,0);
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
