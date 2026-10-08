#!/usr/bin/env node
// Browser reale per Individual Watch/Rewatch, Auth simulata e mirror locale. --playwright=/path/to/playwright
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
     from(table){const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return q;},async maybeSingle(){return {data:window.fixtureAuthMode==='third'?null:{user_id:session?.user.id,person:session?.user.id.slice(-1)},error:null};},then(resolve,reject){return Promise.resolve({data:window.fixtureRows?.[table]||[],error:window.fixtureAuthMode==='offline'?{status:0,message:'offline'}:null}).then(resolve,reject);}};return q;},
     realtime:{async setAuth(token){fixtureCalls.push(['jwt',token]);},disconnect(){fixtureCalls.push(['disconnect']);}},
     channel(topic,opts){fixtureCalls.push(['channel',topic,opts.config.private]);const c={on(){return c;},subscribe(cb){c.subscriptionCallback=cb;channels.push(c);setTimeout(()=>cb('SUBSCRIBED'),0);return c;},untrack(){fixtureCalls.push(['untrack']);return Promise.resolve();},track(payload){fixtureCalls.push(['track',payload.user]);return Promise.resolve();},presenceState(){return {};}};return c;},getChannels(){return channels;},removeChannel(c){const i=channels.indexOf(c);if(i>=0)channels.splice(i,1);return Promise.resolve();}
    };
   }};
  },{mode,emails:runtimeEmails});
  for(const f of scripts)await page.addScriptTag({content:read(f)});
  await page.evaluate(()=>checkLoginState());
 };
 const check=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
 await load();
 await page.evaluate(()=>selectUser('N'));await page.locator('#pinInput').fill('12345678');await page.locator('#pinSubmit').click();await page.waitForFunction(()=>isAppAuthorized());

 await page.evaluate(()=>{
  window.fixtureClient=sb;
  window.resetWatchFixture=()=>{
   ['statsModal','addSeenModal','addErrorModal','confirmModal','scheduleModal','reviewModal','detailModal','seenModal','duplicateModal'].forEach(closeModalNow);
   sb=null;dbMode='local';pendingAddEpoch=null;pendingAddSeen=null;pickerMode='add';pendingAddedBy=currentUser;
   movies=[{id:'rewatch',tmdb_id:9001,title:'Ritorno sul grande schermo',in_shared_list: true, status:'watchlist',seen_n:true,seen_v:true,in_shared_list:false,seen_rating_n:8.3,seen_rating_v:7.2,review_text_n:'Una recensione conservata',genres:['Drama']},
    {id:'gold',title:'Già visti insieme',status:'watched',seen_n:false,seen_v:false,seen_rating_n:0},
    {id:'plain',title:'Nuova avventura',in_shared_list: true, status:'watchlist',seen_n:false,seen_v:false}];
   movieNights=[{id:'gold-night',movie_id:'gold',status:'completed',date:'2026-10-08'}];vetoes=[];
   resetListFilters();saveLocal();setTab('rewatch');
  };
 });
 for(const width of [320,390,768]){
  await page.setViewportSize({width,height:width===320?568:844});
  await page.evaluate(()=>resetWatchFixture());
  await check('Rewatch card, actions and pools '+width,async()=>{
   assert.equal(await page.locator('#movieGrid > *').count(),1);
   assert(await page.locator('#movieGrid').getByText('Rimetti in gioco',{exact:true}).isVisible());
   assert(await page.locator('#movieGrid').getByText('Oggi',{exact:true}).isVisible());
   assert(await page.locator('#movieGrid').getByText('Programma',{exact:true}).isVisible());
   assert(!(await page.evaluate(()=>normalListEligible(movies[0]))));
   await page.locator('#movieGrid').getByText('Rimetti in gioco',{exact:true}).click();
   assert(await page.locator('#movieGrid').getByText('In gioco',{exact:true}).isVisible());
   assert(await page.evaluate(()=>normalListEligible(movies[0])));
   assert.equal(await page.locator('#movieGrid > *').count(),1);
   await page.locator('#movieGrid').getByText('Togli dalla Lista',{exact:true}).click();
   assert(!(await page.evaluate(()=>normalListEligible(movies[0]))));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(screenshots){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(screenshots,'rewatch-'+width+'.png'),fullPage:true,animations:'disabled'});}
  });
  await check('Oggi and cancel without In gioco '+width,async()=>{
   await page.locator('#movieGrid').getByText('Oggi',{exact:true}).click();assert(await page.locator('#scheduleModal').isVisible());
   assert(!(await page.locator('#scheduleDate').isVisible()));
   await page.locator('#scheduleConfirm').click();
   await page.waitForFunction(()=>activeNightForMovie('rewatch'));
   assert(await page.evaluate(()=>isRewatch(movies[0])&&!movies[0].in_shared_list));
   await page.locator('#nextMovieBox button[onclick^="cancelNightUI"]').click();await page.locator('#confirmYes').click();
   await page.waitForFunction(()=>!activeNightForMovie('rewatch'));
   assert(!(await page.evaluate(()=>normalListEligible(movies[0]))));
  });
  await check('Programma then complete without rating '+width,async()=>{
   await page.locator('#movieGrid').getByText('Programma',{exact:true}).click();
   await page.locator('#scheduleDate').fill('2026-11-10');await page.locator('#scheduleConfirm').click();
   await page.waitForFunction(()=>activeNightForMovie('rewatch')?.status==='proposed');
   await page.locator('#movieGrid').getByText('Completa serata',{exact:true}).click();
   await page.waitForFunction(()=>togetherSeen(movies.find(m=>m.id==='rewatch')));
   assert.equal(await page.locator('#movieGrid .movie-ticket').count(),0);
   assert.equal(await page.evaluate(()=>movies.find(m=>m.id==='rewatch').seen_rating_n),8.3);
   assert.equal(await page.evaluate(()=>movies.find(m=>m.id==='rewatch').seen_rating_v),7.2);
   await page.evaluate(()=>setTab('all'));
   assert.equal(await page.locator('.viewing-person.is-together').count(),0);assert.equal(await page.locator('[aria-label="Visto insieme"]').count(),2);
   assert.equal(await page.evaluate(()=>movies.find(m=>m.id==='gold').seen_n),false);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  });
  await page.evaluate(()=>resetWatchFixture());
  await check('Personal removal preserves vote and text '+width,async()=>{
   await page.locator('#movieGrid button[onclick^="undoSeenUI"]').click();await page.locator('#confirmYes').click();
   await page.waitForFunction(()=>!movies[0].seen_n);
   assert.equal(await page.evaluate(()=>movies[0].seen_rating_n),8.3);assert.equal(await page.evaluate(()=>movies[0].review_text_n),'Una recensione conservata');
   assert.equal(await page.evaluate(()=>movies[0].seen_v),true);
   await page.evaluate(()=>setTab('history_v'));
   assert(await page.locator('#movieGrid').getByText('Rimuovi il tuo voto',{exact:true}).isVisible());
   await page.locator('#movieGrid').getByText('Rimuovi il tuo voto',{exact:true}).click();await page.locator('#confirmYes').click();
   await page.waitForFunction(()=>movies[0].seen_rating_n===null);
   assert.equal(await page.evaluate(()=>movies[0].seen_rating_v),7.2);
   assert.equal(await page.evaluate(()=>movies[0].review_text_n),'Una recensione conservata');
  });
  await page.evaluate(()=>resetWatchFixture());
  await check('Minimal Add No/Sì and personal zero '+width,async()=>{
   await page.evaluate(()=>applyResolvedDetails({title:'Aggiunto',tmdb_id:9002}));
   assert(await page.locator('#addSeenModal').isVisible());assert.equal(await page.locator('#addSeenModal textarea, #addSeenModal input[type=date]').count(),0);
   assert(!(await page.locator('#addSeenRating').isVisible()));
   await page.locator('#addSeenModal').getByText('Sì',{exact:true}).click();
   assert(await page.locator('#addSeenRating').isVisible());
   await page.locator('#addSeenDestination').selectOption('list');
   await page.locator('#addSeenSave').click();assert(await page.locator('#addSeenError').isVisible());
   await page.locator('#addSeenRating').fill('0');
   if(screenshots)await page.screenshot({path:path.join(screenshots,'rewatch-add-'+width+'.png'),animations:'disabled'});
   await page.locator('#addSeenSave').click();await page.waitForFunction(()=>movies.some(m=>m.tmdb_id===9002));
   assert.deepEqual(await page.evaluate(()=>{const m=movies.find(m=>m.tmdb_id===9002);return {n:m.seen_n,v:m.seen_v,rating:m.seen_rating_n,review:reviewTextFor(m,'N'),events:movieNights.filter(n=>n.movie_id===m.id).length};}),{n:true,v:false,rating:0,review:'',events:0});
   await page.evaluate(()=>{pickerMode='add';applyResolvedDetails({title:'Nuovo',tmdb_id:9003});});
   await page.locator('#addSeenModal').getByText('No',{exact:true}).click();await page.waitForFunction(()=>movies.some(m=>m.tmdb_id===9003));
   assert(await page.evaluate(()=>{const m=movies.find(m=>m.tmdb_id===9003);return !m.seen_n&&!m.seen_v;}));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  });
 }
 for(const width of [320,390,768]) {
  await page.setViewportSize({width,height:844});await page.evaluate(()=>resetWatchFixture());
  await check('Solo Storico without score and candidature with zero '+width,async()=>{
   await page.evaluate(()=>applyResolvedDetails({title:'Storico senza voto',tmdb_id:9010}));
   await page.locator('#addSeenModal').getByText('Sì',{exact:true}).click();
   await page.locator('#addSeenSave').click();
   await page.waitForFunction(()=>movies.some(m=>m.tmdb_id===9010));
   assert(await page.evaluate(()=>{const m=findDuplicateByTmdbId(9010);return m.seen_n&&!m.in_shared_list&&personalRating(m,'N')===null;}));
   await page.evaluate(()=>setTab('history_n'));
   assert(await page.locator('#movieGrid').getByText('Storico senza voto',{exact:true}).isVisible());
   await page.locator('#movieGrid .movie-ticket').filter({hasText:'Storico senza voto'}).getByText('Aggiungi alla nostra Lista',{exact:true}).click();
   assert(await page.locator('#listCandidateModal').isVisible());
   await page.locator('#listCandidateModal').getByText('Aggiungi alla Lista',{exact:true}).click();
   assert((await page.locator('#listCandidateError').textContent()).includes('Serve un voto'));
   await page.locator('#listCandidateRating').fill('0');await page.locator('#listCandidateModal').getByText('Aggiungi alla Lista',{exact:true}).click();
   await page.waitForFunction(()=>findDuplicateByTmdbId(9010).in_shared_list);
   assert.equal(await page.evaluate(()=>personalRating(findDuplicateByTmdbId(9010),'N')),0);
   await page.evaluate(()=>setTab('history_n'));
   assert(await page.locator('#movieGrid .movie-ticket').filter({hasText:'Storico senza voto'}).getByText('In Lista',{exact:true}).isVisible());
  });
  await check('Solo Storico with score and known-state search label '+width,async()=>{
   await page.evaluate(()=>applyResolvedDetails({title:'Storico con voto',tmdb_id:9011}));
   await page.locator('#addSeenModal').getByText('Sì',{exact:true}).click();await page.locator('#addSeenRating').fill('8,3');await page.locator('#addSeenSave').click();
   await page.waitForFunction(()=>findDuplicateByTmdbId(9011));
   assert(await page.evaluate(()=>{const m=findDuplicateByTmdbId(9011);return !m.in_shared_list&&personalRating(m,'N')===8.3;}));
   await page.evaluate(()=>applyResolvedDetails({title:'Storico con voto',tmdb_id:9011}));
   assert((await page.locator('#addSeenKnown').textContent()).includes('N l’ha già visto'));
   await page.keyboard.press('Escape');
  });
  await check('Personal and gold states remain distinct in overlapping history '+width,async()=>{
   await page.evaluate(()=>{const m=findDuplicateByTmdbId(9010);movieNights.push({id:'completed-history',movie_id:m.id,status:'completed'});m.in_shared_list=false;saveLocal();setTab('history_n');});
   const card=page.locator('#movieGrid .movie-ticket').filter({hasText:'Storico senza voto'});
   assert.equal(await card.locator('.viewing-person-n.is-seen').count(),1);
   assert.equal(await card.locator('.viewing-person-v.is-seen').count(),0);
   assert.equal(await card.locator('[aria-label="Visto insieme"]').count(),1);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(screenshots)await page.screenshot({path:path.join(screenshots,'history-'+width+'.png'),fullPage:true,animations:'disabled'});
  });
 }
 await check('Detail toggle and scheduling use the same accessible flows',async()=>{
  await page.evaluate(()=>resetWatchFixture());
  await page.evaluate(()=>openMovieDetail('rewatch'));await page.waitForFunction(()=>!document.getElementById('detailModal').classList.contains('hidden'));
  await page.locator('#detailBody').getByText('Rimetti in gioco',{exact:true}).click();
  assert(await page.locator('#detailBody').getByText('Togli dalla Lista',{exact:true}).isVisible());
  await page.locator('#detailBody').getByText('Programma',{exact:true}).click();
  assert(!(await page.locator('#detailModal').isVisible()));assert(await page.locator('#scheduleModal').isVisible());
  await page.keyboard.press('Escape');
  await page.evaluate(()=>openMovieDetail('rewatch'));await page.waitForFunction(()=>!document.getElementById('detailModal').classList.contains('hidden'));
  await page.locator('#detailBody').getByText('Oggi',{exact:true}).click();
  assert(!(await page.locator('#detailModal').isVisible()));assert(await page.locator('#scheduleModal').isVisible());await page.keyboard.press('Escape');
 });
 await check('V from authenticated account edits only V',async()=>{
  await page.evaluate(async()=>{sb=fixtureClient;await signOutApp();selectUser('V');});await page.locator('#pinInput').fill('12345678');await page.locator('#pinSubmit').click();await page.waitForFunction(()=>isAppAuthorized()&&currentUser==='V');
  await page.evaluate(()=>resetWatchFixture());
  await page.locator('#movieGrid button[onclick^="undoSeenUI"]').click();await page.locator('#confirmYes').click();await page.waitForFunction(()=>!movies[0].seen_v);
  assert.equal(await page.evaluate(()=>movies[0].seen_n),true);assert.equal(await page.evaluate(()=>movies[0].seen_rating_n),8.3);
  assert(!(await page.evaluate(()=>updateMovie('rewatch',{seen_n:false}))));
  assert(!(await page.evaluate(()=>deleteMovie('gold'))));
 });
 await check('Logout clears pending Add and prevents late writes',async()=>{
  await page.evaluate(()=>applyResolvedDetails({title:'In attesa',tmdb_id:9004}));
  await page.evaluate(async()=>{sb=fixtureClient;await signOutApp();});
  assert.equal(await page.evaluate(()=>pendingAddSeen),null);assert(await page.locator('#landingScreen').isVisible());
 });
 assert.deepEqual(errors,[]);console.log(`Individual/Rewatch Chromium: ${checks}/${checks} PASS; Auth fixture, local mirror only`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
