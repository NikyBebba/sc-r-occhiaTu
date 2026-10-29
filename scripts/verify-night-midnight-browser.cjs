#!/usr/bin/env node
// Movie card e ricerca Storico: browser reale, Auth sintetica e mirror locale. --playwright=/path/to/playwright
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.argv.find(a=>a.startsWith('--playwright='))?.slice(13)||'playwright');
const {createTestPassword}=require('./test-password.cjs');
const testPassword=createTestPassword();
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const scripts=[...read('index.html').matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map(m=>m[1]).filter(f=>f!=='js/config.js');
const html=read('index.html').replace(/<script src="js\/[^"]+"><\/script>/g,'').replace(/<script src="https:[^"]*supabase[^"]*"><\/script>/g,'').replace('<link href="css/style.css" rel="stylesheet">','<style>'+read('css/style.css')+'</style>');
const screenshots=process.argv.find(a=>a.startsWith('--screenshots='))?.slice(14);
const runtimeEmails={N:'n@example.invalid',V:'v@example.invalid'};
let checks=0;
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Rome'});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://auth.test/**',r=>r.fulfill({contentType:'text/html',body:html}));
 let persistedRows=null;
 const load=async(mode='valid')=>{
  await page.goto('http://auth.test/',{waitUntil:'networkidle'});
  await page.evaluate(({mode,emails,rows})=>{
   window.fixtureRows=rows;
   window.CONFIG={SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'fixture-public',AUTH_EMAILS:emails,PEOPLE:{N:{label:'N'},V:{label:'V'}}};
   window.fixtureCalls=[];window.fixtureAuthMode=mode;
   window.supabase={createClient(url,key,options){
    const storage=options.auth.storage,storageKey=options.auth.storageKey;
    let session=JSON.parse(storage.getItem(storageKey)||'null'),listener;
    const channels=[];
    window.fixtureRefresh=()=>{session={...session,access_token:'fixture-refreshed',expires_at:session.expires_at+3600};storage.setItem(storageKey,JSON.stringify(session));listener?.('TOKEN_REFRESHED',session);};
    window.fixtureReconnect=()=>channels.forEach(c=>c.subscriptionCallback?.('SUBSCRIBED'));
    return {
     auth:{onAuthStateChange(fn){listener=fn;return {data:{subscription:{}}};},async initialize(){return {error:null};},async getSession(){return {data:{session},error:null};},async getUser(){fixtureCalls.push(['verify-user',window.fixtureAuthMode]);if(window.fixtureAuthMode==='offline')return {data:{},error:{status:0,name:'AuthRetryableFetchError',message:'offline'}};if(window.fixtureAuthMode==='invalid')return {data:{},error:{status:401,message:'invalid'}};return {data:{user:session?.user},error:null};},async signInWithPassword({email,password}){if(window.fixtureAuthMode==='login-invalid')return {error:{status:400,name:'AuthApiError',code:'invalid_credentials',message:'invalid'}};if(window.fixtureAuthMode==='login-offline')return {error:{status:0,name:'AuthRetryableFetchError',message:'offline'}};if(password.length===0)return {error:{status:400,message:'invalid'}};const person=Object.keys(CONFIG.AUTH_EMAILS).find(code=>CONFIG.AUTH_EMAILS[code]===email);session={access_token:'fixture-'+person,user:{id:'fixture-'+person},expires_at:Math.floor(Date.now()/1000)+86400};storage.setItem(storageKey,JSON.stringify(session));listener?.('SIGNED_IN',session);return {data:{session},error:null};},async signOut(opts){fixtureCalls.push(['signOut',opts.scope]);session=null;storage.removeItem(storageKey);listener?.('SIGNED_OUT',null);return {error:null};}},
     from(table){const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return q;},async maybeSingle(){return {data:window.fixtureAuthMode==='third'?null:{user_id:session?.user.id,person:session?.user.id.slice(-1)},error:null};},then(resolve,reject){return Promise.resolve({data:window.fixtureRows?.[table]||[],error:window.fixtureAuthMode==='offline'?{status:0,message:'offline'}:null}).then(resolve,reject);}};return q;},
     realtime:{async setAuth(token){fixtureCalls.push(['jwt',token]);},disconnect(){fixtureCalls.push(['disconnect']);}},
     channel(topic,opts){fixtureCalls.push(['channel',topic,opts.config.private]);const c={on(){return c;},subscribe(cb){c.subscriptionCallback=cb;channels.push(c);setTimeout(()=>cb('SUBSCRIBED'),0);return c;},untrack(){fixtureCalls.push(['untrack']);return Promise.resolve();},track(payload){fixtureCalls.push(['track',payload.user]);return Promise.resolve();},presenceState(){return {};}};return c;},getChannels(){return channels;},removeChannel(c){const i=channels.indexOf(c);if(i>=0)channels.splice(i,1);return Promise.resolve();}
    };
   }};
  },{mode,emails:runtimeEmails,rows:persistedRows});
  for(const f of scripts)await page.addScriptTag({content:read(f)});
  await require('./install-legacy-ui-fixture.cjs')(page);
  await page.evaluate(()=>checkLoginState());
 };
 const check=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
 await load();
 await page.clock.setFixedTime(new Date('2026-10-12T23:30:00+02:00'));
 await page.evaluate(()=>selectUser('N'));await page.locator('#rememberDevice').check();await page.locator('#passwordInput').fill(testPassword);await page.locator('#loginSubmit').click();await page.waitForFunction(()=>isAppAuthorized());


 await page.waitForTimeout(350);
 await page.route('https://fixture.invalid/**',r=>r.abort());
 const seed=async()=>page.evaluate(()=>{
  sb=null;dbMode='local';movies=[{id:'midnight',title:'Film oltre mezzanotte',status:'tonight',in_shared_list:true,seen_n:true,seen_v:false,seen_rating_n:7.3,review_text_n:'CULT'}];
  movieNights=[{id:'night-midnight',movie_id:'midnight',status:'confirmed',date:'2026-10-12',time:'22:30',snack:'Popcorn',location:'Casa',proposed_by:'N',created_at:'2026-10-12T16:00:00Z'}];vetoes=[];saveLocal();openDashboardHome();
 });
 for(const width of [320,390,768]){
  await page.setViewportSize({width,height:844});await page.clock.setFixedTime(new Date('2026-10-12T23:30:00+02:00'));await seed();
  await check('Home completion at 23:30 '+width,async()=>{assert(await page.locator('#nextMovieBox').getByRole('button',{name:'Completa serata',exact:true}).isVisible());});
  await check('Future hour and cancellation never show complete or initial Together vote '+width,async()=>{
   await page.clock.setFixedTime(new Date('2026-10-12T21:30:00+02:00'));await page.evaluate(()=>render());assert.equal(await page.locator('#nextMovieBox button[onclick^="finishTogetherNightUI"]').count(),0);
   await page.evaluate(()=>setTab('tonight'));await page.locator('#movieGrid summary').filter({hasText:'Programmazione'}).click();assert.equal(await page.locator('#movieGrid button[onclick^="finishTogetherNightUI"]').count(),0);
   await page.evaluate(()=>openMovieDetail('midnight'));assert.equal(await page.locator('#detailBody .shared-vote-action').count(),0);await page.keyboard.press('Escape');
   await page.evaluate(()=>{movieNights[0].status='cancelled';saveLocal();render();});assert.equal(await page.evaluate(()=>nightIsDue(movieNights[0])),false);assert.equal(await page.locator('#scheduledList button[onclick^="finishTogetherNightUI"]').count(),0);
   await page.clock.setFixedTime(new Date('2026-10-12T23:30:00+02:00'));await seed();
  });
  for(const time of ['00:01','01:30'])await check('Midnight '+time+' remains completable, compact and no duplicate '+width,async()=>{
   await page.clock.setFixedTime(new Date('2026-10-13T'+time+':00+02:00'));await page.evaluate(()=>render());
   assert(!(await page.locator('#nextMovieHero').isVisible()));assert(await page.locator('#scheduledList').getByRole('button',{name:'Completa serata',exact:true}).isVisible());
   assert((await page.locator('#scheduledList').textContent()).includes('DA CONCLUDERE'));assert.equal(await page.evaluate(()=>movieNights.length),1);
   await page.evaluate(()=>setTab('tonight'));await page.locator('#movieGrid summary').filter({hasText:'Programmazione'}).click();
   assert(await page.locator('#movieGrid').getByRole('button',{name:'Completa serata',exact:true}).isVisible());await page.evaluate(()=>openDashboardHome());
  });
  await check('Manual completion and Together review preserve event and seen '+width,async()=>{
   await page.locator('#scheduledList').getByRole('button',{name:'Completa serata',exact:true}).click();await page.waitForFunction(()=>movieNights[0].status==='completed');
   assert.equal(await page.evaluate(()=>movieNights.length),1);assert.deepEqual(await page.evaluate(()=>({date:movieNights[0].date,time:movieNights[0].time,n:movies[0].seen_n,v:movies[0].seen_v})),{date:'2026-10-12',time:'22:30',n:true,v:false});
   await page.evaluate(()=>addReview('midnight'));await page.locator('#reviewRating').fill('8,2');await page.locator('#reviewText').fill('Recensione dopo mezzanotte');await page.locator('#reviewSaveButton').click();await page.waitForFunction(()=>movies[0].seen_rating_together===8.2);
   assert.equal(await page.evaluate(()=>movies[0].seen_rating_n),7.3);assert.equal(await page.evaluate(()=>movies[0].seen_v),false);assert.equal(await page.evaluate(()=>movieNights.length),1);
  });
  await check('Every Ricordi section closed; manual keyboard and rerender preserve openings '+width,async()=>{
   await page.locator('#homeMemories').click();assert.equal(await page.locator('#statsModal details[open]').count(),0);
   await page.locator('#numbersSection > summary').focus();await page.keyboard.press('Enter');assert(await page.locator('#statsGrid').isVisible());
   await page.locator('#nightHistorySection > summary').click();await page.locator('#nightHistory details[data-memory-key="year:2026"] > summary').click();await page.locator('#nightHistory details[data-memory-key="month:2026-10"] > summary').click();
   assert((await page.locator('#nightHistory').textContent()).includes('Popcorn'));
   await page.evaluate(()=>render());assert(await page.locator('#numbersSection').evaluate(el=>el.open));assert(await page.locator('[data-memory-key="month:2026-10"]').evaluate(el=>el.open));
   await page.keyboard.press('Escape');await page.locator('#homeMemories').click();assert.equal(await page.locator('#statsModal details[open]').count(),0);await page.keyboard.press('Escape');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  });
 }
 await check('Real page reload after midnight re-verifies Auth and restores pending event',async()=>{
  await seed();persistedRows=await page.evaluate(()=>({movies:movies,movie_nights:movieNights,vetoes:vetoes}));await load();await page.waitForFunction(()=>isAppAuthorized());await page.waitForTimeout(150);
  await page.evaluate(()=>{sb=null;dbMode='local';loadLocal();openDashboardHome();});
  assert.equal(await page.evaluate(()=>movieNights[0].id),'night-midnight');assert(await page.evaluate(()=>nightIsDue(movieNights[0])));assert(await page.locator('#scheduledList').getByRole('button',{name:'Completa serata',exact:true}).isVisible());
 });
 assert.deepEqual(errors,[]);console.log(`Midnight / Ricordi Chromium: ${checks}/${checks} PASS; controlled clock and synthetic Auth/data`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
