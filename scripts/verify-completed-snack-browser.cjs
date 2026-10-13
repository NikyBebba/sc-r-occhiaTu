#!/usr/bin/env node
// Snack completed e Ricordi: browser reale, Auth sintetica e mirror locale. --playwright=/path/to/playwright
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
  await page.evaluate(()=>checkLoginState());
 };
 const check=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
 await load();
 await page.clock.setFixedTime(new Date('2026-10-12T23:30:00+02:00'));
 await page.evaluate(()=>selectUser('N'));await page.locator('#rememberDevice').check();await page.locator('#passwordInput').fill(testPassword);await page.locator('#loginSubmit').click();await page.waitForFunction(()=>isAppAuthorized());


 await page.waitForTimeout(350);
 await page.route('https://fixture.invalid/**',r=>r.abort());
 const fixtureClient=await page.evaluateHandle(()=>sb);
 const seed=async()=>page.evaluate(()=>{
  sb=null;dbMode='local';movies=[{id:'snack-film',title:'Scary Movie',tmdb_id:4247,status:'watched',in_shared_list:false,seen_n:true,seen_v:false,seen_rating_n:7.3,review_text_n:'CULT',seen_rating_together:8.2,review_text_together:'Una serata memorabile',personal_liked_n:null,personal_liked_updated_at_n:null,personal_liked_v:false,personal_liked_updated_at_v:'2026-10-13T12:00:00Z'}];
  movieNights=['first','rewatch'].map((id,i)=>({id,movie_id:'snack-film',status:'completed',date:i?'2026-10-12':'2026-10-11',time:'22:30',snack:i?null:'Snack A',location:i?'Cinema':'Casa',proposed_by:'N',created_at:'2026-10-12T16:00:00Z',completed_at:i?'2026-10-12T21:30:00Z':'2026-10-11T21:30:00Z'}));vetoes=[];saveLocal();setTab('history_n');
 });
 const state=()=>page.evaluate(()=>({movies:movies,nights:movieNights}));
 const edit=async(night='first')=>{
  await page.locator('#movieGrid button[data-judgment-context="both"]').click();
  assert(await page.locator('#detailModal').evaluate(el=>el.classList.contains('hidden')));
  await page.locator('#reviewNightSelect').selectOption(night);
 };
 const save=async()=>{await page.locator('#reviewSaveButton').click();await page.waitForFunction(()=>document.getElementById('reviewModal').classList.contains('hidden'));};
 const expectOnly=async(before,index,patch)=>{const expected=structuredClone(before);Object.assign(expected.nights[index],patch);assert.deepEqual(await state(),expected);};
 const history=async()=>{await page.evaluate(()=>openDashboardHome());await page.locator('#homeMemories').click();assert.equal(await page.locator('#statsModal details[open]').count(),0);await page.locator('#nightHistorySection > summary').click();await page.locator('[data-memory-key="year:2026"] > summary').click();await page.locator('[data-memory-key="month:2026-10"] > summary').click();};
 for(const width of [320,390,768]){
  await page.setViewportSize({width,height:844});await seed();
  await check('N+V prefill, rewatch selection and responsive form '+width,async()=>{
   await edit();assert.equal(await page.locator('#reviewSnack').inputValue(),'Snack A');assert.equal(await page.locator('#reviewLocation').inputValue(),'Casa');assert.equal(await page.locator('#reviewRating').inputValue(),'8,2');
   await page.locator('#reviewNightSelect').selectOption('rewatch');assert.equal(await page.locator('#reviewSnack').inputValue(),'');assert.equal(await page.locator('#reviewLocation').inputValue(),'Cinema');
   assert(await page.locator('#reviewSnack').isVisible());assert.equal(await page.locator('label[for="reviewSnack"]').innerText(),'Snack (facoltativo)');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.keyboard.press('Escape');
  });
  await check('Snack + location on selected completed preserves all other data '+width,async()=>{
   await seed();const before=await state();await edit();await page.locator('#reviewSnack').fill('Snack B');await page.locator('#reviewLocation').fill('Terrazza');await save();await expectOnly(before,0,{snack:'Snack B',location:'Terrazza'});
  });
  await check('Snack-only edit preserves location, ratings, reviews and seen '+width,async()=>{
   await seed();const before=await state();await edit();await page.locator('#reviewSnack').fill('Snack B');await save();await expectOnly(before,0,{snack:'Snack B'});
  });
  await check('Location-only edit preserves snack, ratings and reviews '+width,async()=>{
   await seed();const before=await state();await edit();await page.locator('#reviewLocation').fill('Terrazza');await save();await expectOnly(before,0,{location:'Terrazza'});
  });
  await check('Empty snack becomes NULL and absent snack can be added '+width,async()=>{
   await seed();const before=await state();await edit();await page.locator('#reviewSnack').fill('   ');await save();await expectOnly(before,0,{snack:null});await edit();assert.equal(await page.locator('#reviewSnack').inputValue(),'');await page.locator('#reviewSnack').fill('Snack A');await save();assert.deepEqual(await state(),before);
   await edit('rewatch');await page.locator('#reviewSnack').fill('Pizza');await save();await expectOnly(before,1,{snack:'Pizza'});
  });
  await check('Cancel and invalid length preserve data; personal form hides snack '+width,async()=>{
   await seed();const before=await state();await edit();await page.locator('#reviewSnack').fill('Discarded');await page.locator('#reviewModal').getByRole('button',{name:'Annulla',exact:true}).click();assert.deepEqual(await state(),before);
   await edit();await page.evaluate(()=>document.getElementById('reviewSnack').value='x'.repeat(81));await page.locator('#reviewSaveButton').click();assert(await page.locator('#reviewError').isVisible());assert.deepEqual(await state(),before);await page.keyboard.press('Escape');
   await page.evaluate(()=>addPersonalReview('snack-film'));assert(!(await page.locator('#reviewSnack').isVisible()));await page.keyboard.press('Escape');
  });
  await check('Ricordi cards show snack with no controls or reserved wrappers '+width,async()=>{
   await seed();await history();assert.equal(await page.locator('#nightHistory .history-ticket button, #nightHistory .history-snack-row, #nightHistory .history-snack-actions').count(),0);assert.equal(await page.locator('#nightHistory [id^="nightSnack"]').count(),0);assert((await page.locator('#nightHistory').innerText()).includes('🍿 Snack A'));
   await page.locator('#numbersSection > summary').click();const openings=await page.locator('#statsModal details[open]').evaluateAll(nodes=>nodes.map(n=>n.id||n.dataset.memoryKey));await page.evaluate(()=>render());assert.deepEqual(await page.locator('#statsModal details[open]').evaluateAll(nodes=>nodes.map(n=>n.id||n.dataset.memoryKey)),openings);await page.keyboard.press('Escape');
  });
  await check('Failed RPC stays in form with no mirror success '+width,async()=>{
   await seed();const before=await state();await edit();await page.evaluate(()=>{window.originalUpdateMovieNight=updateMovieNight;updateMovieNight=async()=>false;});await page.locator('#reviewSnack').fill('Rejected');await page.locator('#reviewSaveButton').click();assert(await page.locator('#reviewError').isVisible());assert.deepEqual(await state(),before);await page.evaluate(()=>{updateMovieNight=window.originalUpdateMovieNight;});await page.keyboard.press('Escape');
  });
 }
 await check('V edits the shared snack with the same ownership protection',async()=>{
  await page.evaluate(client=>{sb=client;},fixtureClient);await page.evaluate(()=>signOutApp());await page.evaluate(()=>selectUser('V'));await page.locator('#passwordInput').fill(testPassword);await page.locator('#loginSubmit').click();await page.waitForFunction(()=>isAppAuthorized()&&currentUser==='V');await seed();const before=await state();await edit();await page.locator('#reviewSnack').fill('Snack V');await save();await expectOnly(before,0,{snack:'Snack V'});
 });
 assert.deepEqual(errors,[]);console.log(`Completed snack in N+V review / Ricordi Chromium: ${checks}/${checks} PASS; synthetic Auth/data, 320/390/768`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
