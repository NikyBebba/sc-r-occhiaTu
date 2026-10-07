#!/usr/bin/env node
// Browser reale, SDK/DB simulati. --playwright=/path/to/playwright
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.argv.find(a=>a.startsWith('--playwright='))?.slice(13)||'playwright');
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
   window.fixtureCalls=[];window.fixtureAuthMode=mode;
   window.supabase={createClient(url,key,options){
    const storage=options.auth.storage,storageKey=options.auth.storageKey;
    let session=JSON.parse(storage.getItem(storageKey)||'null'),listener;
    const channels=[];
    window.fixtureRefresh=()=>{session={...session,access_token:'fixture-refreshed',expires_at:session.expires_at+3600};storage.setItem(storageKey,JSON.stringify(session));listener?.('TOKEN_REFRESHED',session);};
    window.fixtureReconnect=()=>channels.forEach(c=>c.subscriptionCallback?.('SUBSCRIBED'));
    return {
     auth:{onAuthStateChange(fn){listener=fn;return {data:{subscription:{}}};},async getSession(){return {data:{session},error:null};},async getUser(){fixtureCalls.push(['verify-user',window.fixtureAuthMode]);if(window.fixtureAuthMode==='offline')return {data:{},error:{status:0,name:'AuthRetryableFetchError',message:'offline'}};if(window.fixtureAuthMode==='invalid')return {data:{},error:{status:401,message:'invalid'}};return {data:{user:session?.user},error:null};},async signInWithPassword({email,password}){if(window.fixtureAuthMode==='login-invalid')return {error:{status:400,name:'AuthApiError',code:'invalid_credentials',message:'invalid'}};if(window.fixtureAuthMode==='login-offline')return {error:{status:0,name:'AuthRetryableFetchError',message:'offline'}};if(password.length!==8)return {error:{status:400,message:'invalid'}};const person=Object.keys(CONFIG.AUTH_EMAILS).find(code=>CONFIG.AUTH_EMAILS[code]===email);session={access_token:'fixture-'+person,user:{id:'fixture-'+person},expires_at:Math.floor(Date.now()/1000)+3600};storage.setItem(storageKey,JSON.stringify(session));listener?.('SIGNED_IN',session);return {data:{session},error:null};},async signOut(opts){fixtureCalls.push(['signOut',opts.scope]);session=null;storage.removeItem(storageKey);listener?.('SIGNED_OUT',null);return {error:null};}},
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
  await check('login N → PIN a '+width+' px',async()=>{await page.evaluate(()=>selectUser('N'));assert(await page.locator('#pinGate').isVisible());assert.equal(await page.locator('#pinInput').getAttribute('autocomplete'),'current-password');assert.equal(await page.locator('#authUsername').getAttribute('autocomplete'),'username');assert.equal(await page.locator('#pinInput').getAttribute('maxlength'),'8');assert(await page.locator('#rememberDevice').isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(screenshots)await page.screenshot({path:path.join(screenshots,'auth-pin-'+width+'.png'),animations:'disabled'});await page.evaluate(()=>backToLanding());});
 }
 for(const mode of ['login-invalid','login-offline','third'])await check('login rifiutato '+mode+': nessun ingresso/cache/token',async()=>{await page.evaluate(mode=>{fixtureAuthMode=mode;selectUser('N');},mode);await page.locator('#pinInput').fill('12345678');await page.locator('#rememberDevice').check();await page.locator('#pinSubmit').click();await page.waitForFunction(()=>!authBusy&&!document.getElementById('pinError').classList.contains('hidden'));assert(!(await page.evaluate(()=>isAppAuthorized())));assert(!(await page.locator('#appRoot').isVisible()));assert.equal(await page.locator('#pinInput').inputValue(),'');assert.equal(await page.evaluate(()=>localStorage.getItem('scorochiatu_auth')),null);assert.equal(await page.evaluate(()=>sessionStorage.getItem('scorochiatu_auth')),null);assert((await page.locator('#pinError').innerText()).includes(mode==='login-offline'?'connessione':'non autorizzato'));await page.evaluate(()=>{fixtureAuthMode='valid';backToLanding();});});
 await check('Ricordami: login, JWT e canali privati senza duplicati',async()=>{await page.evaluate(()=>selectUser('N'));await page.locator('#pinInput').fill('12345678');await page.locator('#rememberDevice').check();await page.locator('#pinSubmit').click();await page.waitForFunction(()=>isAppAuthorized());assert(await page.locator('#appRoot').isVisible());assert(!(await page.locator('#landingScreen').isVisible()));assert(!(await page.locator('#pinGate').isVisible()));const calls=await page.evaluate(()=>fixtureCalls);assert(calls.some(c=>c[0]==='jwt'));assert(calls.filter(c=>c[0]==='channel').every(c=>c[2]===true));assert.equal(calls.filter(c=>c[0]==='channel').length,1);assert(!(await page.evaluate(()=>JSON.stringify(localStorage))).includes('12345678'));});
 await check('refresh JWT: SDK callback autentica trasporto e conserva Ricordami',async()=>{await page.evaluate(()=>fixtureRefresh());await page.waitForFunction(()=>fixtureCalls.some(c=>c[0]==='jwt'&&c[1]==='fixture-refreshed'));assert.equal(await page.evaluate(()=>fixtureCalls.filter(c=>c[0]==='channel').length),1);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('scorochiatu_auth')).access_token),'fixture-refreshed');assert(await page.evaluate(()=>isAppAuthorized()));});
 await check('reconnect core: resync senza nuova subscription',async()=>{const before=await page.evaluate(()=>fixtureCalls.filter(c=>c[0]==='verify-user').length);await page.evaluate(()=>fixtureReconnect());await page.waitForFunction(before=>fixtureCalls.filter(c=>c[0]==='verify-user').length>before,before);assert.equal(await page.evaluate(()=>fixtureCalls.filter(c=>c[0]==='channel').length),1);assert.equal(await page.evaluate(()=>sb.getChannels().length),1);});
 await check('riapertura: ingresso automatico verificato',async()=>{await load();await page.waitForFunction(()=>isAppAuthorized());assert.equal(await page.evaluate(()=>currentUser),'N');assert(await page.locator('#appRoot').isVisible());assert(!(await page.locator('#landingScreen').isVisible()));assert(!(await page.locator('#pinGate').isVisible()));});
 await check('offline già autenticato: mirror consentito',async()=>{await page.evaluate(async()=>{fixtureAuthMode='offline';lastSupabaseFailAt=0;await loadMovies();});assert.equal(await page.evaluate(()=>dbMode),'local');assert(await page.evaluate(()=>isAppAuthorized()));});
 await check('Auth 401: UI chiusa, cache rimossa',async()=>{await page.evaluate(async()=>{fixtureAuthMode='invalid';lastSupabaseFailAt=0;try{await loadMovies();}catch(_){}});assert(!(await page.evaluate(()=>isAppAuthorized())));assert(await page.locator('#landingScreen').isVisible());assert.equal(await page.evaluate(()=>localStorage.getItem('scorochiatu_movies')),null);});
 await check('logout locale conserva tema/audio e chiude canali',async()=>{await page.evaluate(()=>{fixtureAuthMode='valid';localStorage.setItem('scorochiatu_theme','autunno');localStorage.setItem('scorochiatu_audio','true');});await page.evaluate(async()=>{await establishAuth((await sb.auth.getSession()).data.session);subscribeRealtime();await signOutApp();});assert.equal(await page.evaluate(()=>sb.getChannels().length),0);assert.equal(await page.evaluate(()=>localStorage.getItem('scorochiatu_auth')),null);assert.equal(await page.evaluate(()=>localStorage.getItem('scorochiatu_audio')),'true');assert((await page.evaluate(()=>fixtureCalls)).some(c=>c[0]==='signOut'&&c[1]==='local'));});
 await check('senza Ricordami: token solo sessionStorage',async()=>{await page.evaluate(()=>selectUser('V'));await page.locator('#pinInput').fill('87654321');await page.locator('#rememberDevice').uncheck();await page.locator('#pinSubmit').click();await page.waitForFunction(()=>isAppAuthorized());assert.equal(await page.evaluate(()=>currentUser),'V');assert.equal(await page.evaluate(()=>localStorage.getItem('scorochiatu_auth')),null);assert(await page.evaluate(()=>!!sessionStorage.getItem('scorochiatu_auth')));});
 await check('nuova scheda senza sessione temporanea: login necessario',async()=>{await page.evaluate(()=>sessionStorage.clear());await load();assert(!(await page.evaluate(()=>isAppAuthorized())));assert(await page.locator('#landingScreen').isVisible());});
 await check('V con Ricordami: ingresso automatico dal mapping, ignora vecchio utente N',async()=>{await page.evaluate(()=>selectUser('V'));await page.locator('#pinInput').fill('87654321');await page.locator('#rememberDevice').check();await page.locator('#pinSubmit').click();await page.waitForFunction(()=>isAppAuthorized());await page.evaluate(()=>{localStorage.setItem('scorochiatu_user','N');sessionStorage.setItem('scorochiatu_user','N');});await load();assert.equal(await page.evaluate(()=>currentUser),'V');assert(await page.locator('#appRoot').isVisible());assert(!(await page.locator('#landingScreen').isVisible()));});
 await check('cold start offline con token persistente: nessun bypass',async()=>{await load('offline');assert(!(await page.evaluate(()=>isAppAuthorized())));assert(await page.locator('#landingScreen').isVisible());assert(!(await page.locator('#appRoot').isVisible()));assert.equal(await page.evaluate(()=>localStorage.getItem('scorochiatu_movies')),null);});
 await check('ripristino online dopo avvio offline: mapping V verificato',async()=>{await load();assert(await page.evaluate(()=>isAppAuthorized()));assert.equal(await page.evaluate(()=>currentUser),'V');assert(await page.locator('#appRoot').isVisible());});
 assert.deepEqual(errors,[]);console.log(`Chromium Auth: ${checks}/${checks} PASS; zero errori JS`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
