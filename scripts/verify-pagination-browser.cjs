#!/usr/bin/env node
// Bounded pagination: real browser, synthetic Auth/Realtime and 436 movies.
// --playwright=/path/to/playwright; SC_ENGINE=chromium|webkit; optional SC_TAILWIND=/local/CDN.js
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.argv.find(a=>a.startsWith('--playwright='))?.slice(13)||'playwright');
const {createTestPassword}=require('./test-password.cjs');
const testPassword=createTestPassword();
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const scripts=[...read('index.html').matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map(m=>m[1]).filter(f=>f!=='js/config.js');
const html=read('index.html').replace(/<script src="js\/[^"]+"><\/script>/g,'').replace(/<script src="https:[^"]*supabase[^"]*"><\/script>/g,'').replace('<link href="css/style.css" rel="stylesheet">','<style>'+read('css/style.css')+'</style>');
const screenshots=process.argv.find(a=>a.startsWith('--screenshots='))?.slice(14);
const runtimeEmails={N:'n@example.invalid',V:'v@example.invalid'};
let checks=0;
(async()=>{
 const engine=process.env.SC_ENGINE||'chromium';
 const browser=await ({chromium,webkit}[engine]).launch({headless:true});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:engine==='chromium',hasTouch:true});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**/*',r=>r.request().url().startsWith('https://cdn.tailwindcss.com') && process.env.SC_TAILWIND ? r.fulfill({contentType:'text/javascript',body:fs.readFileSync(process.env.SC_TAILWIND,'utf8')}):r.request().url().startsWith('https://cdn.tailwindcss.com')?r.continue():r.abort());
 await page.route('http://auth.test/poster/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#334155"/></svg>'}));
 await page.route('http://auth.test/',r=>r.fulfill({contentType:'text/html',body:html}));
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
     auth:{onAuthStateChange(fn){listener=fn;return {data:{subscription:{}}};},async initialize(){return {error:null};},async getSession(){return {data:{session},error:null};},async getUser(){fixtureCalls.push(['verify-user',window.fixtureAuthMode]);if(window.fixtureAuthMode==='offline')return {data:{},error:{status:0,name:'AuthRetryableFetchError',message:'offline'}};if(window.fixtureAuthMode==='invalid')return {data:{},error:{status:401,message:'invalid'}};return {data:{user:session?.user},error:null};},async signInWithPassword({email,password}){if(window.fixtureAuthMode==='login-invalid')return {error:{status:400,name:'AuthApiError',code:'invalid_credentials',message:'invalid'}};if(window.fixtureAuthMode==='login-offline')return {error:{status:0,name:'AuthRetryableFetchError',message:'offline'}};if(password.length===0)return {error:{status:400,message:'invalid'}};const person=Object.keys(CONFIG.AUTH_EMAILS).find(code=>CONFIG.AUTH_EMAILS[code]===email);session={access_token:'fixture-'+person,user:{id:'fixture-'+person},expires_at:Math.floor(Date.now()/1000)+3600};storage.setItem(storageKey,JSON.stringify(session));listener?.('SIGNED_IN',session);return {data:{session},error:null};},async signOut(opts){fixtureCalls.push(['signOut',opts.scope]);session=null;storage.removeItem(storageKey);listener?.('SIGNED_OUT',null);return {error:null};}},
     from(table){fixtureCalls.push(['read',table]);const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return q;},async maybeSingle(){return {data:window.fixtureAuthMode==='third'?null:{user_id:session?.user.id,person:session?.user.id.slice(-1)},error:null};},then(resolve,reject){return Promise.resolve({data:window.fixtureRows?.[table]||[],error:window.fixtureAuthMode==='offline'?{status:0,message:'offline'}:null}).then(resolve,reject);}};return q;},
     realtime:{async setAuth(token){fixtureCalls.push(['jwt',token]);},disconnect(){fixtureCalls.push(['disconnect']);}},
     channel(topic,opts){fixtureCalls.push(['channel',topic,opts.config.private]);const c={handlers:[],on(type,filter,callback){c.handlers.push({type,filter,callback});return c;},subscribe(cb){c.subscriptionCallback=cb;channels.push(c);setTimeout(()=>cb('SUBSCRIBED'),0);return c;},untrack(){fixtureCalls.push(['untrack']);return Promise.resolve();},track(payload){fixtureCalls.push(['track',payload.user]);return Promise.resolve();},presenceState(){return {};}};return c;},getChannels(){return channels;},removeChannel(c){const i=channels.indexOf(c);if(i>=0)channels.splice(i,1);return Promise.resolve();}
    };
   }};
  },{mode,emails:runtimeEmails});
  for(const f of scripts)await page.addScriptTag({content:read(f)});
  await page.evaluate(()=>checkLoginState());
 };
 const check=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
 await load();
 await page.evaluate(()=>selectUser('N'));await page.locator('#passwordInput').fill(testPassword);await page.locator('#loginSubmit').click();await page.waitForFunction(()=>isAppAuthorized());

 await page.waitForTimeout(300);
 await page.evaluate(()=>{
  window.auditFixture=()=>{
   movies=Array.from({length:436},(_,i)=>({id:'audit-'+i,tmdb_id:100000+i,title:'Film audit '+String(i).padStart(3,'0'),director:i%2?'Regista Uno':'Regista Due',added_by:i%2?'V':'N',poster:'http://auth.test/poster/'+i,release_year:2000+i%25,duration:(80+i%100)+' min',platform:'Streaming',genres:[i%2?'Commedia':'Dramma'],status:i<70?'tonight':i<100?'watched':'watchlist',seen_n:true,seen_v:true,in_shared_list:true,matched:true,seen_rating_n:i%3?null:7.5,seen_rating_v:null,seen_rating_together:i<100&&i>=70?8:null,review_text_n:i%3?'':'Recensione sintetica breve',collection_id:i%10?null:500,collection_name:'Saga sintetica',trailer_url:i%10?null:'http://trailer.invalid/'}));
   movieNights=Array.from({length:100},(_,i)=>({id:'night-'+i,movie_id:'audit-'+i,status:i<70?(i%2?'proposed':'confirmed'):'completed',proposed_by:i%2?'V':'N',date:i<70?'2027-01-15':'2026-10-01',time:'21:30',created_at:'2026-10-01T10:00:00Z',completed_at:i<70?null:'2026-10-01T22:00:00Z'}));
   vetoes=[];window.fixtureRows={movies:movies.map(m=>({...m})),movie_nights:movieNights.map(n=>({...n})),vetoes:[]};saveLocal();
  };auditFixture();


 });
 const cdp=engine==='chromium'?await context.newCDPSession(page):null;
 const count=()=>page.locator('#movieGrid .movie-ticket').count();
 const state=()=>page.evaluate(()=>({page:activeResultsPage?.pageIndex,total:activeResultsPage?.totalResults,view:dashboardView,tab:currentTab}));
 const reset=async()=>page.evaluate(()=>{auditFixture();resetHistorySearch();resetListFiltersUI();resetPaginationUI();setTab('all');});
 const go=async(index)=>page.evaluate(index=>{resultPages.set(currentTab,{criteria:resultCriteriaKey(),pageIndex:index});render();},index);
 for(const width of [320,390,768]){
  await page.setViewportSize({width,height:844});await reset();
  await check('436 bounded cards/posters and global counters '+width,async()=>{
   assert.equal(await count(),24);assert.equal(await page.locator('#movieGrid img').count(),24);
   assert.equal(await page.locator('#libraryCount').textContent(),'436 film');
   assert.equal(await page.locator('#pillCountAll').textContent(),'436');
   assert.equal(await page.locator('#resultsPagerTop [data-page-number]').textContent(),'1 di 19');
   assert.equal(await page.locator('#resultsPagerBottom [data-page-range]').textContent(),'1–24 di 436');
   assert(await page.locator('#resultsPagerTop [data-page-previous]').isDisabled());
   assert.equal(await page.locator('#resultsPageStatus[aria-live="polite"]').count(),1);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert(await page.evaluate(()=>[...document.querySelectorAll('.results-pager button')].every(b=>b.getBoundingClientRect().height>=44 && b.getAttribute('aria-controls')==='movieGrid')));
   assert(await page.evaluate(()=>[...document.querySelectorAll('#movieGrid img')].every(i=>i.loading==='lazy'&&i.decoding==='async'&&i.parentElement.getBoundingClientRect().height===192)));
  });
  await check('Keyboard paging, focus and results scroll '+width,async()=>{
   const next=page.locator('#resultsPagerTop [data-page-next]');await next.focus();await page.keyboard.press('Enter');
   assert.equal((await state()).page,1);assert.equal(await count(),24);
   assert.equal(await page.evaluate(()=>document.activeElement.id),'resultsStart');
   assert.equal(await page.locator('#resultsPagerBottom [data-page-range]').textContent(),'25–48 di 436');
   assert(await page.evaluate(()=>{const y=document.getElementById('resultsStart').getBoundingClientRect().top;return y>=document.querySelector('.site-nav').getBoundingClientRect().bottom-1&&y<innerHeight/2;}));
   await page.locator('#resultsPagerTop [data-page-previous]').focus();await page.keyboard.press('Space');assert.equal((await state()).page,0);
  });
  await check('Final partial page, clamp, empty and single '+width,async()=>{
   await go(18);assert.equal(await count(),4);assert(await page.locator('#resultsPagerBottom [data-page-next]').isDisabled());
   await page.evaluate(()=>{movies=movies.slice(0,25);render();});assert.equal((await state()).page,1);assert.equal(await count(),1);
   await page.evaluate(()=>{movies=[];render();});assert.equal(await count(),0);assert(!(await page.locator('#resultsPagerTop').isVisible()));
   assert(!(await page.locator('#resultsPageStatus').textContent()).includes('1 di 0'));
   await reset();await page.evaluate(()=>{movies=movies.slice(0,24);render();});assert.equal(await count(),24);assert(!(await page.locator('#resultsPagerBottom').isVisible()));
  });
  await reset();
  await check('Global search/filter/sort before slice '+width,async()=>{
   await go(4);await page.locator('#movieSearchInput').fill('435');await page.waitForTimeout(290);
   assert.equal(await count(),1);assert.equal((await state()).page,0);assert(await page.locator('#movieGrid').getByText('Film audit 435',{exact:true}).isVisible());
   await page.evaluate(()=>{resetListFiltersUI();setGenreListFilter('Commedia');setListSortKey('title');listSortDir='desc';render();});
   assert.equal((await state()).total,218);assert.equal(await page.locator('#movieGrid h3').first().textContent(),'Film audit 435');
   await page.locator('#movieSearchInput').fill('43');await page.waitForTimeout(290);assert.equal((await state()).total,7);
   assert.equal(await page.locator('#movieGrid h3').first().textContent(),'Film audit 435');assert.equal(await count(),7);
  });
  await reset();
  await check('Independent tabs and N/V, details preserve page '+width,async()=>{
   await go(4);await page.evaluate(()=>setTab('watchlist'));await go(1);await page.evaluate(()=>setTab('all'));assert.equal((await state()).page,4);
   await page.evaluate(()=>setTab('history_n'));await go(6);await page.evaluate(()=>setTab('history_v'));assert.equal((await state()).page,0);
   await page.evaluate(()=>setTab('history_n'));assert.equal((await state()).page,6);
   await page.evaluate(()=>{openMovieDetail(activeResultsPage.items[0].id);closeModalNow('detailModal');render();});assert.equal((await state()).page,6);
   await page.evaluate(()=>setTab('watchlist'));assert.equal((await state()).page,1);
  });
  await check('Shared criteria reset scope; history debounce and stale cancellation '+width,async()=>{
   await page.evaluate(()=>setGenreListFilter('Commedia'));await page.evaluate(()=>setTab('all'));assert.equal((await state()).page,0);
   await page.evaluate(()=>setTab('history_n'));await go(6);
   await page.locator('#historySearchInput').fill('435');assert.equal((await state()).page,6);
   await page.evaluate(()=>setTab('history_v'));await page.waitForTimeout(290);assert.equal((await state()).total,1);assert.equal((await state()).page,0);
   await page.locator('#historySearchInput').fill('');await page.waitForTimeout(290);assert.equal((await state()).total,436);assert.equal(await count(),24);
   await page.evaluate(()=>setTab('history_n'));await page.locator('#historySearchInput').fill('Film');
   await page.evaluate(()=>openDashboardHome());const renders=await page.evaluate(()=>{window.paginationRenderCount=0;const original=render;window.restorePaginationRender=()=>{render=original;};render=()=>{paginationRenderCount++;original();};return paginationRenderCount;});
   await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>paginationRenderCount),renders);await page.evaluate(()=>restorePaginationRender());
   assert.equal(await count(),0);assert(!(await page.locator('#resultsPagerTop').isVisible()));
  });
  await reset();
  await check('Availability/order reset and one render for a history input burst '+width,async()=>{
   await go(4);await page.evaluate(()=>{setAvailabilityFilter('streaming');setGenreListFilter('all');setListSortKey('added');});assert.equal((await state()).page,4);
   await page.evaluate(()=>toggleListSortDir());assert.equal((await state()).page,0);
   await go(4);await page.evaluate(()=>setAvailabilityFilter('cinema'));assert.equal((await state()).total,0);assert.equal((await state()).page,0);
   await page.evaluate(()=>{setAvailabilityFilter('streaming');setTab('history_n');window.burstRenderCount=0;const original=render;window.restoreBurstRender=()=>{render=original;};render=()=>{burstRenderCount++;original();};for(const q of ['f','fi','fil','film','film a','film au','film aud','film audi','film audit']){document.getElementById('historySearchInput').value=q;onHistorySearchInput();}});
   assert.equal(await page.evaluate(()=>burstRenderCount),0);await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>burstRenderCount),1);await page.evaluate(()=>restoreBurstRender());
  });
  await reset();
  await check('Save/load, actual realtime handler and equivalent render preserve page/scroll '+width,async()=>{
   await go(4);await page.waitForTimeout(500);await page.evaluate(()=>{window.scrollTo({top:1400,behavior:'instant'});});await page.waitForTimeout(100);const y=await page.evaluate(()=>scrollY);
   await page.evaluate(()=>render());assert.equal((await state()).page,4);assert.equal(await page.evaluate(()=>scrollY),y);
   await page.evaluate(async()=>{const remote=sb;sb=null;await savePersonalReview(activeResultsPage.items[0].id,7.4,'Pagina preservata');render();sb=remote;fixtureRows.movies=movies.map(m=>({...m}));});assert.equal((await state()).page,4);
   await page.evaluate(async()=>{await loadMovies();render();});assert.equal((await state()).page,4);
   await page.evaluate(()=>{fixtureRows.movies[0].overview='Aggiornamento realtime sintetico';const channel=sb.getChannels().find(c=>c.handlers?.some(h=>h.type==='postgres_changes'));channel.handlers.find(h=>h.type==='postgres_changes').callback({eventType:'UPDATE'});});
   await page.waitForFunction(()=>movies[0].overview==='Aggiornamento realtime sintetico');assert.equal((await state()).page,4);assert.equal(await count(),24);
   const paging=await page.evaluate(()=>{
    const reads=fixtureCalls.filter(c=>c[0]==='read').length;
    const sizes=[1,1,-1,-1].map(direction=>{changeResultsPage(direction,{detail:1});return [document.querySelectorAll('#movieGrid .movie-ticket').length,document.querySelectorAll('#movieGrid img').length];});
    return {sizes,extraReads:fixtureCalls.filter(c=>c[0]==='read').length-reads};
   });
   assert.deepEqual(paging.sizes,[[24,24],[24,24],[24,24],[24,24]]);assert.equal(paging.extraReads,0);
   await page.evaluate(()=>openWheelView());assert.equal(await count(),0);await page.evaluate(()=>setTab('all'));assert.equal((await state()).page,4);
  });
  for(const tab of ['all','watchlist','tonight','history_n','history_v']){
   await reset();await page.evaluate(tab=>setTab(tab),tab);await go(1);
   await check('Navigation scroll regression '+tab+' '+width,async()=>{
    await page.evaluate(()=>{window.scrollTo({top:document.getElementById('movieGrid').getBoundingClientRect().top+scrollY,behavior:'instant'});});await page.waitForTimeout(500);
    const before=await state();
    if(cdp){
     await cdp.send('Input.synthesizeScrollGesture',{x:Math.floor(width/2),y:650,yDistance:-1300,speed:12000,gestureSourceType:'touch',preventFling:false});await page.waitForTimeout(1000);
     await cdp.send('Input.synthesizeScrollGesture',{x:Math.floor(width/2),y:600,xDistance:70,yDistance:-900,speed:10000,gestureSourceType:'touch',preventFling:false});await page.waitForTimeout(1000);
     await page.evaluate(()=>window.scrollTo({top:document.getElementById('movieGrid').getBoundingClientRect().top+scrollY,behavior:'instant'}));await page.waitForTimeout(300);
     for(const targetY of [100,800]){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:Math.floor(width/2),y:450}]});
      for(let step=1;step<=4;step++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:Math.floor(width/2),y:450+(targetY-450)*step/4}]});if(step===2)await page.evaluate(()=>render());await page.waitForTimeout(20);}
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(1100);
     }
    }else{await page.mouse.move(width/2,500);for(let i=0;i<3;i++){await page.mouse.wheel(0,1500);await page.evaluate(()=>render());await page.waitForTimeout(100);}await page.waitForTimeout(300);}
    assert.deepEqual(await state(),before);assert(await page.locator('#detailModal').evaluate(el=>el.classList.contains('hidden')));assert(await count()<=24);
   });
  }
 }
 await check('Lock/logout/person change cancels pending searches and clears pages',async()=>{
  await reset();await go(4);await page.evaluate(()=>setTab('history_n'));await page.locator('#historySearchInput').fill('435');await page.evaluate(()=>lockApp());await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>resultPages.size),0);assert.equal(await page.evaluate(()=>historySearchDebounceTimer),null);
  await page.evaluate(()=>selectUser('V'));await page.locator('#passwordInput').fill(testPassword);await page.locator('#loginSubmit').click();await page.waitForFunction(()=>currentUser==='V'&&isAppAuthorized());await page.evaluate(()=>{auditFixture();setTab('all');});assert.equal((await state()).page,0);
  await go(2);let logoutPages;await page.exposeFunction('capturePaginationLogout',size=>{logoutPages=size;});
  await page.evaluate(()=>{const original=signOutApp;signOutApp=async()=>{await original();await capturePaginationLogout(resultPages.size);};});
  await Promise.all([page.waitForEvent('load'),page.evaluate(()=>{void logout();})]);assert.equal(logoutPages,0);
  await load();assert.equal(await page.evaluate(()=>resultPages.size),0);assert.equal(await page.evaluate(()=>isAppAuthorized()),false);
 });
 await check('No browser JavaScript errors',()=>assert.deepEqual(errors,[]));
 console.log(`Pagination browser ${engine}: ${checks}/${checks} PASS; ${engine==='chromium'?'CDP touch/flick':'WebKit wheel only; no equivalent touch/flick API'}; mocked Auth/Realtime, no remote I/O`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
