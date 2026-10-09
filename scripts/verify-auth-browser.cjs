#!/usr/bin/env node
// Browser reale, SDK/DB simulati. --playwright=/path/to/playwright
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.argv.find(a=>a.startsWith('--playwright='))?.slice(13)||'playwright');
const {createTestPassword}=require('./test-password.cjs');
const testPassword=createTestPassword();
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const scripts=[...read('index.html').matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map(m=>m[1]).filter(f=>f!=='js/config.js');
const html=read('index.html').replace(/<script src="js\/[^"]+"><\/script>/g,'').replace(/<script src="https:[^"]*supabase[^"]*"><\/script>/g,'').replace('<link href="css/style.css" rel="stylesheet">','<style>'+read('css/style.css')+'</style>');
const screenshots=process.argv.find(a=>a.startsWith('--screenshots='))?.slice(14);
// Usa le email runtime, senza importare nel browser le chiavi API reali.
const runtime=require('node:vm').createContext({});
require('node:vm').runInContext(read('js/config.js'),runtime);
const runtimeEmails=require('node:vm').runInContext('CONFIG.AUTH_EMAILS',runtime);
let checks=0;
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://auth.test/**',r=>r.fulfill({contentType:'text/html',body:html}));
 const load=async(mode='valid')=>{
  await page.goto('http://auth.test/',{waitUntil:'networkidle'});
  await page.evaluate(({mode,emails})=>{
   window.CONFIG={SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'fixture-public',AUTH_EMAILS:emails,PEOPLE:{N:{label:'N'},V:{label:'V'}}};
   window.fixtureCalls=[];window.fixtureAuthMode=mode;window.fixtureUpdates=0;
   window.supabase={createClient(url,key,options){
    const storage=options.auth.storage,storageKey=options.auth.storageKey;
    let session=JSON.parse(storage.getItem(storageKey)||'null'),listener;
    const channels=[];
    window.fixtureRecovery=()=>{session={access_token:'fixture-recovery',user:{id:'fixture-N'},expires_at:Math.floor(Date.now()/1000)+3600};storage.setItem(storageKey,JSON.stringify(session));listener?.('PASSWORD_RECOVERY',session);};
    window.fixtureExpireRecovery=()=>{session.expires_at=1;};
    window.fixtureSwitchRecovery=()=>{session={...session,user:{id:'fixture-V'}};};
    window.fixtureRefresh=()=>{session={...session,access_token:'fixture-refreshed',expires_at:session.expires_at+3600};storage.setItem(storageKey,JSON.stringify(session));listener?.('TOKEN_REFRESHED',session);};
    window.fixtureReconnect=()=>channels.forEach(c=>c.subscriptionCallback?.('SUBSCRIBED'));
    return {
     auth:{async resetPasswordForEmail(email){
      fixtureCalls.push(['reset-email',email]);
      if(window.fixtureResetMode==='held')await new Promise(resolve=>{window.fixtureResetRelease=resolve;});
      return {data:{},error:window.fixtureResetMode==='network'?{status:0,message:'fixture-private-error'}:window.fixtureResetMode==='rate'?{status:429,message:'fixture-private-error'}:null};
     },async updateUser(){window.fixtureUpdates++;if(window.fixtureAuthMode==='reset-offline')return {error:{status:0,message:'offline'}};if(window.fixtureAuthMode==='reset-weak')return {error:{status:422,name:'AuthApiError',code:'weak_password'}};await new Promise(resolve=>setTimeout(resolve,20));listener?.('USER_UPDATED',session);return {data:{user:session.user},error:null};},onAuthStateChange(fn){listener=fn;return {data:{subscription:{}}};},async initialize(){return {error:null};},async getSession(){return {data:{session},error:null};},async getUser(){fixtureCalls.push(['verify-user',window.fixtureAuthMode]);if(window.fixtureAuthMode==='offline')return {data:{},error:{status:0,name:'AuthRetryableFetchError',message:'offline'}};if(window.fixtureAuthMode==='invalid')return {data:{},error:{status:401,message:'invalid'}};return {data:{user:session?.user},error:null};},async signInWithPassword({email,password}){if(window.fixtureAuthMode==='login-invalid')return {error:{status:400,name:'AuthApiError',code:'invalid_credentials',message:'invalid'}};if(window.fixtureAuthMode==='login-offline')return {error:{status:0,name:'AuthRetryableFetchError',message:'offline'}};if(password.length===0)return {error:{status:400,message:'invalid'}};const person=Object.keys(CONFIG.AUTH_EMAILS).find(code=>CONFIG.AUTH_EMAILS[code]===email);session={access_token:'fixture-'+person,user:{id:'fixture-'+person},expires_at:Math.floor(Date.now()/1000)+3600};storage.setItem(storageKey,JSON.stringify(session));listener?.('SIGNED_IN',session);return {data:{session},error:null};},async signOut(opts){fixtureCalls.push(['signOut',opts.scope]);session=null;storage.removeItem(storageKey);listener?.('SIGNED_OUT',null);return {error:null};}},
     from(table){const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return q;},async maybeSingle(){return {data:window.fixtureAuthMode==='third'?null:{user_id:session?.user.id,person:session?.user.id.slice(-1)},error:null};},then(resolve,reject){return Promise.resolve({data:[],error:window.fixtureAuthMode==='offline'?{status:0,message:'offline'}:null}).then(resolve,reject);}};return q;},
     realtime:{async setAuth(token){fixtureCalls.push(['jwt',token]);},disconnect(){fixtureCalls.push(['disconnect']);}},
     channel(topic,opts){fixtureCalls.push(['channel',topic,opts.config.private]);const c={on(){return c;},subscribe(cb){c.subscriptionCallback=cb;channels.push(c);setTimeout(()=>cb('SUBSCRIBED'),0);return c;},untrack(){return Promise.resolve();},track(){return Promise.resolve();},presenceState(){return {};}};return c;},getChannels(){return channels;},removeChannel(c){const i=channels.indexOf(c);if(i>=0)channels.splice(i,1);return Promise.resolve();}
    };
   }};
  },{mode,emails:runtimeEmails});
  for(const f of scripts)await page.addScriptTag({content:read(f)});
  await page.evaluate(()=>checkLoginState());
 };
 const check=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
 await load();
 for(const width of [320,390,768]){
  await page.setViewportSize({width,height:844});
  await check('login N → Password a '+width+' px',async()=>{await page.evaluate(()=>selectUser('N'));assert(await page.locator('#loginGate').isVisible());assert.equal(await page.locator('#passwordInput').getAttribute('autocomplete'),'current-password');assert.equal(await page.locator('#authUsername').getAttribute('autocomplete'),'username');for(const attr of ['inputmode','pattern','minlength','maxlength'])assert.equal(await page.locator('#passwordInput').getAttribute(attr),null);assert(await page.locator('#rememberDevice').isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(screenshots)await page.screenshot({path:path.join(screenshots,'auth-login-'+width+'.png'),animations:'disabled'});await page.evaluate(()=>backToLanding());});
 }
 for(const person of ['N','V'])await check('Account '+person+': email visibile, semantica e focus password',async()=>{
  await page.evaluate(person=>selectUser(person),person);
  const account=page.locator('#authUsername'),password=page.locator('#passwordInput');
  assert.equal(await account.count(),1);
  assert(await account.isVisible());
  assert((await account.inputValue())===runtimeEmails[person]);
  assert.equal(await account.getAttribute('name'),'username');
  assert.equal(await account.getAttribute('type'),'email');
  assert.equal(await account.getAttribute('autocomplete'),'username');
  assert.equal(await account.getAttribute('tabindex'),null);
  assert(!(await account.evaluate(el=>el.classList.contains('sr-only'))));
  assert.equal(await page.locator('label[for="authUsername"]').innerText(),'Account');
  assert(await page.locator('label[for="authUsername"]').isVisible());
  assert(await account.evaluate(el=>!el.readOnly&&!el.disabled));
  assert(await account.isEditable());
  assert.equal(await password.getAttribute('autocomplete'),'current-password');
  assert(await password.evaluate(el=>document.activeElement===el));
  const accountBox=await account.boundingBox(),passwordBox=await password.boundingBox();
  assert(accountBox.y+accountBox.height<=passwordBox.y);
  await account.focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('other@example.test');
  assert.equal(await account.inputValue(),'other@example.test');
  await page.evaluate(()=>backToLanding());
 });
 await check('cambio N → V → N: account aggiornato, password vuota e focus preservato',async()=>{
  await page.locator('#landingUserN').click();
  for(const person of ['V','N']){
   await page.locator('#passwordInput').fill(testPassword);
   await page.locator('#loginGate .auth-back-btn').click();
   await page.locator('#landingUser'+person).click();
   assert((await page.locator('#authUsername').inputValue())===runtimeEmails[person]);
   assert.equal(await page.locator('#passwordInput').inputValue(),'');
   assert(await page.locator('#passwordInput').evaluate(el=>document.activeElement===el));
  }
  await page.evaluate(()=>backToLanding());
 });
 for(const person of ['N','V'])await check('Password dimenticata '+person+': mapping fisso, feedback, nessun login o modifica sessione',async()=>{
  await page.evaluate(person=>selectUser(person),person);
  await page.locator('#authUsername').fill('other@example.test');
  await page.locator('#passwordInput').fill(testPassword);
  await page.locator('#rememberDevice').check();
  const button=page.locator('#forgotPassword');assert(await button.isVisible());assert.equal(await button.getAttribute('type'),'button');
  assert.equal(await page.locator('#passwordResetNotice').getAttribute('role'),'status');
  await button.click();await page.waitForFunction(()=>!passwordResetBusy);
  const requests=await page.evaluate(()=>fixtureCalls.filter(c=>c[0]==='reset-email'));
  assert.equal(requests.at(-1)[1],runtimeEmails[person]);assert((await page.locator('#passwordResetNotice').innerText()).includes('riceverai'));
  assert.equal(await page.locator('#passwordInput').inputValue(),testPassword);assert(await page.locator('#rememberDevice').isChecked());
  assert.equal(await page.evaluate(()=>localStorage.getItem('scorochiatu_auth')),null);assert.equal(await page.evaluate(()=>sessionStorage.getItem('scorochiatu_auth')),null);
  assert(!(await page.evaluate(()=>isAppAuthorized())));assert.equal(await page.evaluate(()=>fixtureUpdates),0);
  await button.click();assert.equal(await page.evaluate(()=>fixtureCalls.filter(c=>c[0]==='reset-email').length),requests.length);
  assert((await page.locator('#passwordResetNotice').innerText()).includes('Attendi un minuto'));
  await page.evaluate(()=>backToLanding());
 });
 await check('richiesta recovery: doppio click bloccato, cambio persona ignora risposta obsoleta',async()=>{
  await page.evaluate(()=>{delete passwordResetLastSent.N;fixtureResetMode='held';selectUser('N');requestLoginPasswordReset();requestLoginPasswordReset();});
  await page.waitForFunction(()=>!!fixtureResetRelease);assert(await page.locator('#forgotPassword').isDisabled());
  const before=await page.evaluate(()=>fixtureCalls.filter(c=>c[0]==='reset-email').length);
  await page.evaluate(()=>{backToLanding();selectUser('V');fixtureResetRelease();});await page.waitForFunction(()=>!passwordResetBusy);
  assert(await page.locator('#passwordResetNotice').evaluate(el=>el.classList.contains('hidden')));
  assert.equal(await page.evaluate(()=>fixtureCalls.filter(c=>c[0]==='reset-email').length),before);assert(await page.locator('#forgotPassword').isEnabled());
  await page.evaluate(()=>{fixtureResetMode=null;backToLanding();});
 });
 for(const mode of ['network','rate'])await check('richiesta recovery '+mode+': errore controllato, retry/cooldown',async()=>{
  await page.evaluate(mode=>{delete passwordResetLastSent.N;fixtureResetMode=mode;selectUser('N');},mode);
  await page.locator('#forgotPassword').click();await page.waitForFunction(()=>!passwordResetBusy);
  const message=await page.locator('#passwordResetNotice').innerText();assert(message.includes(mode==='rate'?'Troppi invii':'connessione'));assert(!message.includes('fixture-private-error'));
  const before=await page.evaluate(()=>fixtureCalls.filter(c=>c[0]==='reset-email').length);
  await page.evaluate(()=>fixtureResetMode=null);await page.locator('#forgotPassword').click();await page.waitForFunction(()=>!passwordResetBusy);
  assert.equal(await page.evaluate(()=>fixtureCalls.filter(c=>c[0]==='reset-email').length),before+(mode==='rate'?0:1));
  await page.evaluate(()=>backToLanding());
 });
 await check('richiesta recovery: cooldown scaduto e configurazione mancante',async()=>{
  await page.evaluate(()=>{passwordResetLastSent.N=Date.now()-60001;selectUser('N');});
  await page.locator('#forgotPassword').click();await page.waitForFunction(()=>!passwordResetBusy);assert((await page.locator('#passwordResetNotice').innerText()).includes('riceverai'));
  const before=await page.evaluate(()=>fixtureCalls.filter(c=>c[0]==='reset-email').length);
  await page.evaluate(()=>{delete passwordResetLastSent.V;CONFIG.AUTH_EMAILS.V='';selectUser('V');});
  await page.locator('#forgotPassword').click();await page.waitForFunction(()=>!passwordResetBusy);assert((await page.locator('#passwordResetNotice').innerText()).includes('non ancora configurato'));
  assert.equal(await page.evaluate(()=>fixtureCalls.filter(c=>c[0]==='reset-email').length),before);
  await page.evaluate(email=>{CONFIG.AUTH_EMAILS.V=email;backToLanding();},runtimeEmails.V);
 });
 await check('richiesta recovery senza persona: nessun invio',async()=>{
  const before=await page.evaluate(()=>fixtureCalls.filter(c=>c[0]==='reset-email').length);
  await page.evaluate(()=>requestLoginPasswordReset());assert.equal(await page.evaluate(()=>fixtureCalls.filter(c=>c[0]==='reset-email').length),before);
 });
 for(const person of ['N','V'])await check('Password '+person+': solo vuoto bloccato, valori non vuoti inoltrati intatti ad Auth',async()=>{
  await page.evaluate(person=>{
   selectUser(person);
   window.fixturePasswordSignInAttempts=0;
   window.fixturePasswordAuthAttempts=0;
   window.fixtureSubmittedPassword=null;
   const originalSignIn=signInPerson;
   const originalAuth=sb.auth.signInWithPassword;
   window.fixtureRestorePasswordSignIn=()=>{signInPerson=originalSignIn;sb.auth.signInWithPassword=originalAuth;fixtureAuthMode='valid';};
   signInPerson=(...args)=>{fixturePasswordSignInAttempts++;return originalSignIn(...args);};
   sb.auth.signInWithPassword=(credentials)=>{fixturePasswordAuthAttempts++;fixtureSubmittedPassword=credentials.password;return originalAuth(credentials);};
  },person);
  try{
   const password=page.locator('#passwordInput');
   assert.equal(await password.getAttribute('type'),'password');
   assert.equal(await password.getAttribute('name'),'password');
   assert.equal(await password.getAttribute('autocomplete'),'current-password');
   assert.equal(await page.locator('label[for="passwordInput"]').innerText(),'Password');
   for(const attr of ['inputmode','pattern','minlength','maxlength'])assert.equal(await password.getAttribute(attr),null);
   await password.fill('');
   await page.locator('#loginSubmit').click();
   assert.equal(await page.locator('#loginError').innerText(),'Inserisci la password.');
   assert.equal(await page.evaluate(()=>fixturePasswordSignInAttempts),0);
   assert.equal(await page.evaluate(()=>fixturePasswordAuthAttempts),0);
   const values=[createTestPassword(),createTestPassword()+String.fromCharCode(33,36,37),String.fromCharCode(97),createTestPassword().slice(0,8),String.fromCharCode(32)+createTestPassword()+String.fromCharCode(32),String.fromCharCode(32)];
   for(const [i,value] of values.entries()){
    await page.evaluate(person=>{fixtureAuthMode='login-invalid';selectUser(person);},person);
    await password.fill(value);
    await page.locator('#loginSubmit').click();
    await page.waitForFunction(()=>!authBusy&&!document.getElementById('loginError').classList.contains('hidden'));
    assert.equal(await page.evaluate(()=>fixturePasswordSignInAttempts),i+1);
    assert.equal(await page.evaluate(()=>fixturePasswordAuthAttempts),i+1);
    assert(await page.evaluate(value=>fixtureSubmittedPassword===value,value));
    assert.equal(await page.locator('#loginError').innerText(),'Password errata o accesso non autorizzato.');
   }
  }finally{
   await page.evaluate(()=>{fixtureRestorePasswordSignIn();backToLanding();});
  }
 });
 for(const person of ['N','V'])await check('Account diverso da '+person+': nessun login o chiamata Auth, valore conservato',async()=>{
  await page.evaluate(person=>{
   selectUser(person);
   window.fixtureSignInAttempts=0;
   window.fixtureAuthAttempts=0;
   const originalSignIn=signInPerson;
   const originalAuth=sb.auth.signInWithPassword;
   window.fixtureRestoreSignIn=()=>{signInPerson=originalSignIn;sb.auth.signInWithPassword=originalAuth;};
   signInPerson=(...args)=>{fixtureSignInAttempts++;return originalSignIn(...args);};
   sb.auth.signInWithPassword=(...args)=>{fixtureAuthAttempts++;return originalAuth(...args);};
  },person);
  try{
   for(const email of [runtimeEmails[person==='N'?'V':'N'],'other@example.test','']){
    await page.locator('#authUsername').fill(email);
    await page.locator('#passwordInput').fill(testPassword);
    await page.locator('#loginSubmit').click();
    assert(await page.locator('#loginError').isVisible());
    assert.equal(await page.locator('#loginError').innerText(),"L'account non corrisponde alla persona scelta. Usa Cambia persona.");
    assert.equal(await page.evaluate(()=>fixtureSignInAttempts),0);
    assert.equal(await page.evaluate(()=>fixtureAuthAttempts),0);
    assert((await page.locator('#authUsername').inputValue())===email);
    assert.equal(await page.locator('#passwordInput').inputValue(),testPassword);
    assert(!(await page.evaluate(()=>isAppAuthorized())));
    assert(await page.locator('#loginSubmit').isEnabled());
   }
  }finally{
   await page.evaluate(()=>{fixtureRestoreSignIn();backToLanding();});
  }
 });
 for(const mode of ['login-invalid','login-offline','third'])await check('login rifiutato '+mode+': nessun ingresso/cache/token',async()=>{await page.evaluate(mode=>{fixtureAuthMode=mode;selectUser('N');},mode);await page.locator('#passwordInput').fill(testPassword);await page.locator('#rememberDevice').check();await page.locator('#loginSubmit').click();await page.waitForFunction(()=>!authBusy&&!document.getElementById('loginError').classList.contains('hidden'));assert(!(await page.evaluate(()=>isAppAuthorized())));assert(!(await page.locator('#appRoot').isVisible()));assert.equal(await page.locator('#passwordInput').inputValue(),'');assert.equal(await page.evaluate(()=>localStorage.getItem('scorochiatu_auth')),null);assert.equal(await page.evaluate(()=>sessionStorage.getItem('scorochiatu_auth')),null);assert((await page.locator('#loginError').innerText()).includes(mode==='login-offline'?'connessione':'non autorizzato'));await page.evaluate(()=>{fixtureAuthMode='valid';backToLanding();});});
 await check('Ricordami: email normalizzata, login N, JWT e canali privati senza duplicati',async()=>{await page.evaluate(()=>selectUser('N'));await page.locator('#authUsername').fill(' '+runtimeEmails.N.toUpperCase()+' ');await page.locator('#passwordInput').fill(testPassword);await page.locator('#rememberDevice').check();await page.locator('#loginSubmit').click();await page.waitForFunction(()=>isAppAuthorized());assert.equal(await page.evaluate(()=>currentUser),'N');assert(await page.locator('#appRoot').isVisible());assert(!(await page.locator('#landingScreen').isVisible()));assert(!(await page.locator('#loginGate').isVisible()));const calls=await page.evaluate(()=>fixtureCalls);assert(calls.some(c=>c[0]==='jwt'));assert(calls.filter(c=>c[0]==='channel').every(c=>c[2]===true));assert.equal(calls.filter(c=>c[0]==='channel').length,1);assert(!(await page.evaluate(()=>JSON.stringify(localStorage))).includes(testPassword));});
 await check('refresh JWT: SDK callback autentica trasporto e conserva Ricordami',async()=>{await page.evaluate(()=>fixtureRefresh());await page.waitForFunction(()=>fixtureCalls.some(c=>c[0]==='jwt'&&c[1]==='fixture-refreshed'));assert.equal(await page.evaluate(()=>fixtureCalls.filter(c=>c[0]==='channel').length),1);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('scorochiatu_auth')).access_token),'fixture-refreshed');assert(await page.evaluate(()=>isAppAuthorized()));});
 await check('reconnect core: resync senza nuova subscription',async()=>{const before=await page.evaluate(()=>fixtureCalls.filter(c=>c[0]==='verify-user').length);await page.evaluate(()=>fixtureReconnect());await page.waitForFunction(before=>fixtureCalls.filter(c=>c[0]==='verify-user').length>before,before);assert.equal(await page.evaluate(()=>fixtureCalls.filter(c=>c[0]==='channel').length),1);assert.equal(await page.evaluate(()=>sb.getChannels().length),1);});
 await check('riapertura: ingresso automatico verificato',async()=>{await load();await page.waitForFunction(()=>isAppAuthorized());assert.equal(await page.evaluate(()=>currentUser),'N');assert(await page.locator('#appRoot').isVisible());assert(!(await page.locator('#landingScreen').isVisible()));assert(!(await page.locator('#loginGate').isVisible()));});
 await check('offline già autenticato: mirror consentito',async()=>{await page.evaluate(async()=>{fixtureAuthMode='offline';lastSupabaseFailAt=0;await loadMovies();});assert.equal(await page.evaluate(()=>dbMode),'local');assert(await page.evaluate(()=>isAppAuthorized()));});
 await check('Auth 401: UI chiusa, cache rimossa',async()=>{await page.evaluate(async()=>{fixtureAuthMode='invalid';lastSupabaseFailAt=0;try{await loadMovies();}catch(_){}});assert(!(await page.evaluate(()=>isAppAuthorized())));assert(await page.locator('#landingScreen').isVisible());assert.equal(await page.evaluate(()=>localStorage.getItem('scorochiatu_movies')),null);});
 await check('logout locale conserva tema/audio e chiude canali',async()=>{await page.evaluate(()=>{fixtureAuthMode='valid';localStorage.setItem('scorochiatu_theme','autunno');localStorage.setItem('scorochiatu_audio','true');});await page.evaluate(async()=>{await establishAuth((await sb.auth.getSession()).data.session);subscribeRealtime();await signOutApp();});assert.equal(await page.evaluate(()=>sb.getChannels().length),0);assert.equal(await page.evaluate(()=>localStorage.getItem('scorochiatu_auth')),null);assert.equal(await page.evaluate(()=>localStorage.getItem('scorochiatu_audio')),'true');assert((await page.evaluate(()=>fixtureCalls)).some(c=>c[0]==='signOut'&&c[1]==='local'));});
 await check('senza Ricordami: token solo sessionStorage',async()=>{await page.evaluate(()=>selectUser('V'));await page.locator('#passwordInput').fill(testPassword);await page.locator('#rememberDevice').uncheck();await page.locator('#loginSubmit').click();await page.waitForFunction(()=>isAppAuthorized());assert.equal(await page.evaluate(()=>currentUser),'V');assert.equal(await page.evaluate(()=>localStorage.getItem('scorochiatu_auth')),null);assert(await page.evaluate(()=>!!sessionStorage.getItem('scorochiatu_auth')));});
 await check('nuova scheda senza sessione temporanea: login necessario',async()=>{await page.evaluate(()=>sessionStorage.clear());await load();assert(!(await page.evaluate(()=>isAppAuthorized())));assert(await page.locator('#landingScreen').isVisible());});
 await check('V con Ricordami: ingresso automatico dal mapping, ignora vecchio utente N',async()=>{await page.evaluate(()=>selectUser('V'));await page.locator('#passwordInput').fill(testPassword);await page.locator('#rememberDevice').check();await page.locator('#loginSubmit').click();await page.waitForFunction(()=>isAppAuthorized());await page.evaluate(()=>{localStorage.setItem('scorochiatu_user','N');sessionStorage.setItem('scorochiatu_user','N');});await load();assert.equal(await page.evaluate(()=>currentUser),'V');assert(await page.locator('#appRoot').isVisible());assert(!(await page.locator('#landingScreen').isVisible()));});
 await check('cold start offline con token persistente: nessun bypass',async()=>{await load('offline');assert(!(await page.evaluate(()=>isAppAuthorized())));assert(await page.locator('#landingScreen').isVisible());assert(!(await page.locator('#appRoot').isVisible()));assert.equal(await page.evaluate(()=>localStorage.getItem('scorochiatu_movies')),null);});
 await check('ripristino online dopo avvio offline: mapping V verificato',async()=>{await load();assert(await page.evaluate(()=>isAppAuthorized()));assert.equal(await page.evaluate(()=>currentUser),'V');assert(await page.locator('#appRoot').isVisible());});
 await page.evaluate(()=>{localStorage.clear();sessionStorage.clear();});
 await load();
 await check('apertura normale: login, nessuna recovery',async()=>{assert(await page.locator('#landingScreen').isVisible());assert(!(await page.locator('#recoveryGate').isVisible()));for(const id of ['newPassword','confirmPassword'])assert(await page.locator('#'+id).isDisabled());});
 const recovery=async()=>{
  await page.evaluate(()=>{fixtureAuthMode='valid';fixtureRecovery();});
  await page.waitForFunction(()=>!!authRecoveryIdentity);
 };
 await recovery();
 await check('recovery verificata: schermata dedicata e new-password',async()=>{
  assert(await page.locator('#recoveryGate').isVisible());
  for(const id of ['landingScreen','loginGate','appRoot'])assert(!(await page.locator('#'+id).isVisible()));
  for(const id of ['newPassword','confirmPassword']){assert.equal(await page.locator('#'+id).getAttribute('type'),'password');assert.equal(await page.locator('#'+id).getAttribute('autocomplete'),'new-password');}
  assert(await page.locator('#newPassword').evaluate(el=>document.activeElement===el));
  assert(!(await page.evaluate(()=>isAppAuthorized())));
  await page.evaluate(()=>selectUser('V'));assert(!(await page.locator('#loginGate').isVisible()));
 });
 await check('recovery password vuota: nessuna updateUser',async()=>{await page.locator('#recoverySubmit').click();assert.equal(await page.evaluate(()=>fixtureUpdates),0);assert((await page.locator('#recoveryError').innerText()).includes('Inserisci'));});
 await check('recovery conferma diversa: nessuna updateUser',async()=>{await page.locator('#newPassword').fill(testPassword);await page.locator('#confirmPassword').fill(testPassword+String.fromCharCode(33));await page.locator('#recoverySubmit').click();assert.equal(await page.evaluate(()=>fixtureUpdates),0);assert((await page.locator('#recoveryError').innerText()).includes('non coincidono'));});
 await check('recovery errore rete: controllato, campi svuotati, ripetibile',async()=>{await page.evaluate(()=>fixtureAuthMode='reset-offline');await page.locator('#confirmPassword').fill(testPassword);await page.locator('#recoverySubmit').click();await page.waitForFunction(()=>!authRecoveryBusy);assert.equal(await page.evaluate(()=>fixtureUpdates),1);assert(await page.locator('#recoverySubmit').isEnabled());assert.equal(await page.locator('#newPassword').inputValue(),'');assert((await page.locator('#recoveryError').innerText()).includes('connessione'));});
 await check('recovery password rifiutata da Auth: errore controllato, sessione riutilizzabile',async()=>{await page.evaluate(()=>fixtureAuthMode='reset-weak');for(const id of ['newPassword','confirmPassword'])await page.locator('#'+id).fill(testPassword);await page.locator('#recoverySubmit').click();await page.waitForFunction(()=>!authRecoveryBusy);assert(await page.locator('#recoverySubmit').isEnabled());assert((await page.locator('#recoveryError').innerText()).includes('requisiti'));});
 await check('recovery valida: una sola updateUser anche con doppio submit, conferma e login',async()=>{
  await page.evaluate(()=>{fixtureAuthMode='valid';fixtureUpdates=0;});
  const candidate=testPassword+String.fromCharCode(33,64);
  for(const id of ['newPassword','confirmPassword'])await page.locator('#'+id).fill(candidate);
  await page.evaluate(()=>Promise.all([submitRecoveryPassword(),submitRecoveryPassword()]));
  assert.equal(await page.evaluate(()=>fixtureUpdates),1);
  assert(await page.locator('#landingScreen').isVisible());assert(!(await page.locator('#recoveryGate').isVisible()));
  assert((await page.locator('#authNotice').innerText()).includes('Password aggiornata'));
  assert(!(await page.evaluate(()=>isAppAuthorized())));
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('scorochiatu_recovery')),null);
  for(const store of ['localStorage','sessionStorage'])assert(!(await page.evaluate(store=>JSON.stringify(window[store]),store)).includes(candidate));
  for(const id of ['newPassword','confirmPassword'])assert.equal(await page.locator('#'+id).inputValue(),'');
 });
 await recovery();
 await check('reload recovery: login controllato, nessuna autorizzazione dal marker',async()=>{await load();assert(await page.locator('#landingScreen').isVisible());assert(!(await page.locator('#recoveryGate').isVisible()));assert(!(await page.evaluate(()=>isAppAuthorized())));assert((await page.locator('#authNotice').innerText()).includes('Recupero interrotto'));});
 await recovery();
 await check('recovery scaduta prima del submit: nessuna updateUser',async()=>{await page.evaluate(()=>{fixtureUpdates=0;fixtureExpireRecovery();});for(const id of ['newPassword','confirmPassword'])await page.locator('#'+id).fill(testPassword);await page.locator('#recoverySubmit').click();await page.waitForFunction(()=>!authRecoveryBusy);assert.equal(await page.evaluate(()=>fixtureUpdates),0);assert((await page.locator('#recoveryError').innerText()).includes('scaduta'));assert(await page.locator('#recoverySubmit').isDisabled());await page.locator('#recoveryExit').click();});
 await recovery();
 await check('recovery account cambiato: nessuna updateUser',async()=>{await page.evaluate(()=>{fixtureUpdates=0;fixtureSwitchRecovery();});for(const id of ['newPassword','confirmPassword'])await page.locator('#'+id).fill(testPassword);await page.locator('#recoverySubmit').click();await page.waitForFunction(()=>!authRecoveryBusy);assert.equal(await page.evaluate(()=>fixtureUpdates),0);assert(await page.locator('#recoverySubmit').isDisabled());await page.locator('#recoveryExit').click();});
 await check('evento recovery non verificabile: reset disabilitato, nessun bypass',async()=>{await page.evaluate(()=>{fixtureAuthMode='invalid';fixtureRecovery();});await page.waitForFunction(()=>document.getElementById('recoveryError').textContent.includes('non valida'));assert(await page.locator('#recoverySubmit').isDisabled());assert(!(await page.evaluate(()=>isAppAuthorized())));await page.locator('#recoveryExit').click();});
 assert.deepEqual(errors,[]);console.log(`Chromium Auth: ${checks}/${checks} PASS; zero errori JS`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
