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
   window.fixtureCalls=[];window.fixtureAuthMode=mode;
   window.supabase={createClient(url,key,options){
    const storage=options.auth.storage,storageKey=options.auth.storageKey;
    let session=JSON.parse(storage.getItem(storageKey)||'null'),listener;
    const channels=[];
    window.fixtureRefresh=()=>{session={...session,access_token:'fixture-refreshed',expires_at:session.expires_at+3600};storage.setItem(storageKey,JSON.stringify(session));listener?.('TOKEN_REFRESHED',session);};
    window.fixtureReconnect=()=>channels.forEach(c=>c.subscriptionCallback?.('SUBSCRIBED'));
    return {
     auth:{onAuthStateChange(fn){listener=fn;return {data:{subscription:{}}};},async initialize(){return {error:null};},async getSession(){return {data:{session},error:null};},async getUser(){fixtureCalls.push(['verify-user',window.fixtureAuthMode]);if(window.fixtureAuthMode==='offline')return {data:{},error:{status:0,name:'AuthRetryableFetchError',message:'offline'}};if(window.fixtureAuthMode==='invalid')return {data:{},error:{status:401,message:'invalid'}};return {data:{user:session?.user},error:null};},async signInWithPassword({email,password}){if(window.fixtureAuthMode==='login-invalid')return {error:{status:400,name:'AuthApiError',code:'invalid_credentials',message:'invalid'}};if(window.fixtureAuthMode==='login-offline')return {error:{status:0,name:'AuthRetryableFetchError',message:'offline'}};if(password.length===0)return {error:{status:400,message:'invalid'}};const person=Object.keys(CONFIG.AUTH_EMAILS).find(code=>CONFIG.AUTH_EMAILS[code]===email);session={access_token:'fixture-'+person,user:{id:'fixture-'+person},expires_at:Math.floor(Date.now()/1000)+3600};storage.setItem(storageKey,JSON.stringify(session));listener?.('SIGNED_IN',session);return {data:{session},error:null};},async signOut(opts){fixtureCalls.push(['signOut',opts.scope]);session=null;storage.removeItem(storageKey);listener?.('SIGNED_OUT',null);return {error:null};}},
     from(table){const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return q;},async maybeSingle(){return {data:window.fixtureAuthMode==='third'?null:{user_id:session?.user.id,person:session?.user.id.slice(-1)},error:null};},then(resolve,reject){return Promise.resolve({data:window.fixtureRows?.[table]||[],error:window.fixtureAuthMode==='offline'?{status:0,message:'offline'}:null}).then(resolve,reject);}};return q;},
     realtime:{async setAuth(token){fixtureCalls.push(['jwt',token]);},disconnect(){fixtureCalls.push(['disconnect']);}},
     channel(topic,opts){fixtureCalls.push(['channel',topic,opts.config.private]);const c={on(){return c;},subscribe(cb){c.subscriptionCallback=cb;channels.push(c);setTimeout(()=>cb('SUBSCRIBED'),0);return c;},untrack(){fixtureCalls.push(['untrack']);return Promise.resolve();},track(payload){fixtureCalls.push(['track',payload.user]);return Promise.resolve();},presenceState(){return {};}};return c;},getChannels(){return channels;},removeChannel(c){const i=channels.indexOf(c);if(i>=0)channels.splice(i,1);return Promise.resolve();}
    };
   }};
  },{mode,emails:runtimeEmails});
  for(const f of scripts)await page.addScriptTag({content:read(f)});
  await require('./install-legacy-ui-fixture.cjs')(page);
  await page.evaluate(()=>{renderAppVersion();checkLoginState();});
 };
 const check=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
 await load();
 await page.evaluate(()=>selectUser('N'));await page.locator('#passwordInput').fill(testPassword);await page.locator('#loginSubmit').click();await page.waitForFunction(()=>isAppAuthorized());
 await page.evaluate(async()=>{
  fixtureRows={movies:Array.from({length:45},(_,i)=>({id:'m'+i,title:'Film '+String(i).padStart(2,'0'),status:'watched',added_by:i%2?'V':'N',seen_rating_together:i%11,review_text_together:i%3?'Testo recensione '+i:'',genres:['Drama']})),vetoes:[],movie_nights:[
   {id:'n1',movie_id:'m0',status:'completed',date:'2026-10-02'},
   {id:'n2',movie_id:'m0',status:'completed',date:'2026-10-04'},
   {id:'n3',movie_id:'m1',status:'completed',date:'2026-09-04'},
   {id:'n4',movie_id:'m1',status:'completed',date:'2025-09-04'},
   {id:'n5',movie_id:'m2',status:'completed'},
   {id:'n6',movie_id:'m2',status:'cancelled',date:'2026-11-01'}],swipe_sessions:[{id:'session',status:'open',created_by:'N',created_at:new Date().toISOString(),seed:1,deck:['m0']}],swipes:[]};
  fixtureRows.movie_nights.push(...Array.from({length:42},(_,i)=>({id:'undated-'+i,movie_id:'m'+(i+3),status:'completed'})));
  await loadMovies();
 });
 for(const width of [320,390,768,1280]){
  await page.setViewportSize({width,height:width===320?568:844});
  await check('navigation long list '+width,async()=>{
   await page.evaluate(()=>{setTab('all');activateDestination('library');});await page.waitForTimeout(400);
   assert.equal(await page.locator('#movieGrid .movie-ticket').count(),24);
   const total = await page.evaluate(()=>activeResultsPage.totalResults);
   assert(total>=45);
   const firstPage = await page.locator('#movieGrid h3').allTextContents();
   await page.evaluate(()=>changeResultsPage(1,{detail:1}));
   const secondPage = await page.locator('#movieGrid h3').allTextContents();
   assert.equal(secondPage.length,Math.min(24,total-24));
   assert.equal(new Set([...firstPage,...secondPage]).size,firstPage.length+secondPage.length);
   await page.evaluate(()=>changeResultsPage(-1,{detail:1}));
   await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.waitForTimeout(100);
   assert(await page.evaluate(()=>scrollY>500));
   const nav=await page.locator('#destinationNav').boundingBox();assert(nav.y>=0&&nav.y+nav.height<=page.viewportSize().height+1);
   if(width>=768){const header=await page.locator('.site-nav').boundingBox();assert(header.y>=-1);assert(header.y+header.height<=nav.y+1);}
   if(screenshots)await page.screenshot({path:path.join(screenshots,'ux-navigation-'+width+'.png'),animations:'disabled'});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.equal(await page.locator('[data-destination="library"]').getAttribute('aria-current'),'page');
   const final=await page.locator('#movieGrid > :last-child').boundingBox();if(width<768)assert(final.y+final.height<=nav.y);
   await page.locator('[data-destination="library"]').click();await page.waitForFunction(()=>scrollY<2);
   await page.locator('[data-destination="memories"]').click();
   assert(await page.locator('#destinationNav').isVisible());
   await page.keyboard.press('Escape');
   assert.equal(await page.evaluate(()=>dashboardView),'library');
   assert(await page.locator('#destinationNav').isVisible());
   assert.equal(await page.evaluate(()=>document.activeElement.dataset.destination),'memories');
  });
  await check('Home and wheel destinations '+width,async()=>{
   await page.locator('[data-destination="home"]').click();assert.equal(await page.evaluate(()=>dashboardView),'home');
   assert(await page.locator('#destinationNav').isVisible());
   assert.equal(await page.locator('#appRoot').evaluate(el=>parseFloat(getComputedStyle(el).paddingBottom)>0),width<768);
   assert.equal(await page.locator('[data-destination="home"]').getAttribute('aria-current'),'page');
   const primary=await page.locator('#sceltaCta .home-mode-primary').boundingBox(),secondary=await page.locator('#sceltaCta .home-mode-secondary').first().boundingBox();
   assert(primary&&secondary&&primary.y<=secondary.y&&primary.height>secondary.height&&primary.height<180&&primary.width>=secondary.width);
   assert.deepEqual(await page.locator('#sceltaCta .home-mode-primary').evaluate(el=>{const r=el.getBoundingClientRect(),i=el.querySelector('.home-mode-icon').getBoundingClientRect(),c=el.querySelector('.home-mode-copy').getBoundingClientRect();return {textAlign:getComputedStyle(el).textAlign,copyAlign:getComputedStyle(el.querySelector('.home-mode-copy')).alignItems,iconCenter:Math.round(i.left+i.width/2),cardCenter:Math.round(r.left+r.width/2),copyCenter:Math.round(c.left+c.width/2),cue:el.querySelector('.home-mode-cue').textContent.trim()};}),{textAlign:'center',copyAlign:'center',iconCenter:Math.round(primary.x+primary.width/2),cardCenter:Math.round(primary.x+primary.width/2),copyCenter:Math.round(primary.x+primary.width/2),cue:'Esplora i film'});
   const decorationThemes=await page.evaluate(()=>{
    const list=document.querySelector('#sceltaCta .home-mode-list'),original=currentTheme,wrap=list.querySelector('.home-list-decorations');
    const rows=THEME_OPTIONS.map(({id})=>{
     setTheme(id);const plain=getComputedStyle(list).backgroundImage,icons=[...wrap.querySelectorAll('.home-list-decoration')],visible=icons.filter(icon=>getComputedStyle(icon).display!=='none');
     const content=[list.querySelector('.home-mode-icon'),list.querySelector('.home-mode-copy'),list.querySelector('.home-mode-cue')].map(el=>el.getBoundingClientRect()),box=list.getBoundingClientRect(),height=list.offsetHeight;
     wrap.style.display='none';const heightWithout=list.offsetHeight;wrap.style.display='';
     const positions=visible.map(icon=>{const r=icon.getBoundingClientRect(),cs=getComputedStyle(icon),glyph=getComputedStyle(icon,'::before');return {inside:r.left>=box.left&&r.right<=box.right&&r.top>=box.top&&r.bottom<=box.bottom,clear:content.every(c=>r.right<=c.left||r.left>=c.right||r.bottom<=c.top||r.top>=c.bottom),opacity:parseFloat(cs.opacity),pointer:cs.pointerEvents,fontLoaded:cs.fontFamily.includes('Font Awesome')&&glyph.content!=='none'&&glyph.content!=='normal'&&glyph.content!=='""'};});
     const modes=['.home-mode-recommendation','.home-mode-wheel','.home-mode-match'].map(q=>getComputedStyle(document.querySelector(q)).backgroundImage);
     return {id,expectedCount:visible.length===(innerWidth<768?6:innerWidth<900?8:12),wrapperHidden:wrap.getAttribute('aria-hidden')==='true'&&getComputedStyle(wrap).pointerEvents==='none',absolute:getComputedStyle(wrap).position==='absolute'&&visible.every(icon=>getComputedStyle(icon).position==='absolute'),noPoster:getComputedStyle(list,'::before').content==='none'&&getComputedStyle(list,'::after').content==='none',distinct:modes.every(bg=>bg!==plain),contentAbove:Number(getComputedStyle(list.querySelector('.home-mode-copy')).zIndex)>0,textVisible:getComputedStyle(list.querySelector('strong')).color!=='transparent',heightUnchanged:height===heightWithout,positionsClear:positions.every(p=>p.inside&&p.clear&&p.opacity<=.15&&p.pointer==='none'&&p.fontLoaded),overflow:document.documentElement.scrollWidth>innerWidth};
    });setTheme(original);return rows;
   });
   assert.equal(decorationThemes.length,8);assert(decorationThemes.every(row=>Object.entries(row).filter(([k])=>!['id']).every(([,v])=>v===true)),JSON.stringify(decorationThemes));
   assert(await page.evaluate(()=>{const n=movies.filter(m=>normalListEligible(m)).length;return document.getElementById('homeWatchlistCount').textContent===(n?`${n} film in attesa del ciak.`:'La lista aspetta il primo titolo.');}));
   assert.equal(await page.locator('#sceltaCta .dashboard-choice-actions > :first-child').getAttribute('aria-label'),'Sfoglia la lista dei film');
   if(screenshots)await page.screenshot({path:path.join(screenshots,'ux-home-cta-'+width+'.png'),animations:'disabled'});
   await page.locator('.home-mode-wheel').click();assert.equal(await page.evaluate(()=>dashboardView),'wheel');
   assert(await page.locator('#destinationNav').isVisible());
   assert.equal(await page.locator('[data-destination="wheel"]').getAttribute('aria-current'),'page');
   await page.locator('[data-destination="library"]').click();assert(await page.locator('#destinationNav').isVisible());
   assert.equal(await page.locator('#groupCalendarLink').count(),0);
   assert(await page.locator('#libraryBack').isVisible());
   if(width<1024){await page.locator('#libraryViewSelect').selectOption('watched');assert.equal(await page.evaluate(()=>currentTab),'watched');assert.equal(await page.locator('#libraryViewSelect').inputValue(),'watched');}
   else{await page.locator('#tabWatched').click();assert.equal(await page.evaluate(()=>currentTab),'watched');assert.equal(await page.locator('#tabWatched').getAttribute('aria-selected'),'true');}
   await page.locator('[data-destination="home"]').click();
   await page.locator('#homeCalendar').click();assert.equal(await page.evaluate(()=>currentTab),'calendar');assert(await page.locator('#libraryBack').isVisible());
   await page.locator('[data-destination="home"]').click();
   await page.locator('.home-mode-list').click();assert.equal(await page.evaluate(()=>dashboardView),'library');assert(await page.locator('#destinationNav').isVisible());
   await page.locator('[data-destination="home"]').click();
   await page.locator('.home-mode-recommendation').click();assert.equal(await page.evaluate(()=>dashboardView),'recommendations');assert.equal(await page.locator('[data-destination="home"]').getAttribute('aria-current'),'page');
   assert.equal(await page.locator('#recommendationRefresh').count(),0);
   assert.equal(await page.locator('#recommendationMore').count(),1);
   assert.equal((await page.locator('#recommendationMore').innerText()).trim(),'Altri suggerimenti');
   assert(await page.locator('#recommendationMore i.fa-arrows-rotate').count());
   assert((await page.locator('#recommendationMore').boundingBox()).height>=44);
   await page.locator('[data-destination="home"]').click();
   await page.locator('#tabMatch').click();await page.waitForFunction(()=>matchChannelStatus==='subscribed');
   assert(await page.locator('#destinationNav').isVisible());
   const matchHeader=await page.locator('#matchViewHeader').boundingBox();
   const matchBack=await page.locator('#matchViewHeader .dashboard-back').boundingBox();
   assert(Math.abs(matchBack.x-matchHeader.x-17)<2);
   const matchTitle=await page.locator('#matchViewHeader > div').boundingBox();
   assert(Math.abs(matchTitle.x+matchTitle.width/2-matchHeader.x-matchHeader.width/2)<2);
   assert.equal(await page.locator('#matchViewHeader > div').evaluate(el=>getComputedStyle(el).textAlign),'center');
   assert(matchTitle.y>=matchBack.y+matchBack.height||matchTitle.x>=matchBack.x+matchBack.width);
   assert(await page.locator('#matchViewHeader').evaluate(el=>el.firstElementChild.classList.contains('dashboard-back')));
   await page.locator('#matchViewHeader .dashboard-back').click();
   assert.equal(await page.evaluate(()=>dashboardView),'home');assert(await page.locator('#destinationNav').isVisible());
   if(width<768){await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.waitForTimeout(30);const navBox=await page.locator('#destinationNav').boundingBox(),lastShortcut=await page.locator('#homeMemories').boundingBox();assert(lastShortcut.y+lastShortcut.height<=navBox.y+1);}
  });
  await check('footer version visible above mobile navigation '+width,async()=>{
   const footer=page.locator('#appRoot > footer[data-app-version]');
   assert.equal((await footer.innerText()).trim(),'v74');
   await footer.scrollIntoViewIfNeeded();
   const box=await footer.boundingBox(),nav=await page.locator('#destinationNav').boundingBox();
   assert(box.y>=0&&box.y+box.height<=page.viewportSize().height+1,'version footer is visible after scrolling');
   if(width<768)assert(box.y+box.height<=nav.y+1,'version footer is not covered by bottom navigation');
  });
  await check('Home memories preserves underlying geometry and focus '+width,async()=>{
   await page.locator('#homeMemories').focus();
   const before=await page.evaluate(()=>({height:document.getElementById('appRoot').getBoundingClientRect().height,scroll:scrollY,padding:getComputedStyle(document.getElementById('appRoot')).paddingBottom}));
   await page.locator('#homeMemories').click();
   assert(await page.locator('#statsModal').isVisible());
   assert(await page.locator('#destinationNav').isVisible());
   await page.keyboard.press('Escape');
   const after=await page.evaluate(()=>({height:document.getElementById('appRoot').getBoundingClientRect().height,scroll:scrollY,padding:getComputedStyle(document.getElementById('appRoot')).paddingBottom}));
   assert.deepEqual(after,before);assert.equal(await page.evaluate(()=>document.activeElement.id),'homeMemories');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  });
  await check('memories modal and sticky header '+width,async()=>{
   await page.locator('#homeMemories').click();assert(await page.locator('#statsModal').isVisible());
   assert(await page.evaluate(()=>document.getElementById('appRoot').inert));
   await page.locator('#reviewSection > summary').click();
   await page.evaluate(()=>document.getElementById('memoriesScroll').scrollTop=1000);
   const panel=await page.locator('#memoriesScroll').boundingBox(),header=await page.locator('.memories-header').boundingBox();
   assert(Math.abs(header.y-panel.y)<3);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(screenshots)await page.screenshot({path:path.join(screenshots,'ux-memories-'+width+'.png'),animations:'disabled'});
   await page.locator('.memories-header button[aria-label="Chiudi"]').click();assert(!(await page.evaluate(()=>document.getElementById('appRoot').inert)));
   assert.equal(await page.evaluate(()=>document.activeElement.id),'homeMemories');
   assert(await page.locator('#destinationNav').isVisible());
  });
 }
 await page.evaluate(()=>resetMemoriesState());await page.locator('[data-destination="memories"]').click();
 await check('all memories disclosures closed initially, counts, undated and rewatches',async()=>{
  assert.equal(await page.locator('#nightHistoryCount').innerText(),'47 serate');
  assert(!(await page.locator('#nightHistorySection').evaluate(el=>el.open)));
  assert.equal(await page.locator('#statsModal details[open]').count(),0);
  const groups=await page.locator('#nightHistory details').evaluateAll(elements=>elements.map(el=>({label:el.querySelector('summary').innerText,open:el.open})));
  assert(groups.every(group=>!group.open));
  assert.equal(await page.locator('.history-ticket').count(),47);
  assert(!(await page.locator('#reviewSection').evaluate(el=>el.open)));
 });
 await check('reviews capped, alphabetic, Show more and individual text',async()=>{
  await page.locator('#reviewSection > summary').click();assert.equal(await page.locator('#reviewTimeline .review-item').count(),10);
  const titles=await page.locator('#reviewTimeline .review-item').evaluateAll(els=>els.map(el=>el.textContent));assert(titles[0].includes('Film 00'));assert(titles[9].includes('Film 09'));
  await page.locator('#reviewsMore').click();assert.equal(await page.locator('#reviewTimeline .review-item').count(),20);
  await page.locator('#reviewItem-m1-toggle').click();assert(await page.locator('#reviewItem-m1').evaluate(el=>el.open));
 });
 await check('rerender Realtime preserves disclosure, pagination, focus and scroll',async()=>{
  const before=await page.locator('#memoriesScroll').evaluate(el=>el.scrollTop);
  await page.evaluate(()=>render());await page.waitForTimeout(30);
  assert.equal(await page.locator('#reviewTimeline .review-item').count(),20);assert(await page.locator('#reviewItem-m1').evaluate(el=>el.open));
  assert(await page.locator('#reviewSection').evaluate(el=>el.open));assert.equal(await page.evaluate(()=>document.activeElement.id),'reviewItem-m1-toggle');
  assert(Math.abs(await page.locator('#memoriesScroll').evaluate(el=>el.scrollTop)-before)<3);
  await page.locator('#nightHistorySection > summary').click();await page.locator('#nightHistorySection > summary').click();await page.evaluate(()=>render());assert(!(await page.locator('#nightHistorySection').evaluate(el=>el.open)));
 });
 await check('close/reopen closes every disclosure and preserves Show more limit',async()=>{
  await page.locator('.memories-header button[aria-label="Chiudi"]').click();await page.locator('[data-destination="memories"]').click();
  assert(!(await page.locator('#nightHistorySection').evaluate(el=>el.open)));
  assert(!(await page.locator('#reviewSection').evaluate(el=>el.open)));assert.equal(await page.locator('#reviewTimeline .review-item').count(),20);
  assert(!(await page.locator('#reviewItem-m1').evaluate(el=>el.open)));assert.equal(await page.locator('#statsModal details[open]').count(),0);
 });
 await check('keyboard focus trap and Escape restores opener',async()=>{
  await page.locator('.memories-header button[aria-label="Chiudi"]').focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'Chiudi');
  await page.keyboard.press('Tab');assert(await page.locator('.memories-header button[aria-label="Chiudi"]').evaluate(el=>el===document.activeElement));
  await page.keyboard.press('Escape');assert(!(await page.locator('#statsModal').isVisible()));assert.equal(await page.evaluate(()=>document.activeElement.dataset.destination),'memories');
 });
 await check('offline Match disabled, calendar still accessible from Home',async()=>{
  await page.evaluate(()=>{dbMode='local';render();});assert(await page.locator('[data-destination="match"]').isDisabled());
  await page.evaluate(()=>activateDestination('match'));assert.notEqual(await page.evaluate(()=>currentTab),'match');
  await page.evaluate(()=>{dbMode='supabase';activateDestination('home');});await page.locator('.home-shortcuts button').filter({hasText:'Calendario'}).click();assert.equal(await page.evaluate(()=>currentTab),'calendar');
 });
 await check('Match entry/reselection/exit preserves channel and Presence',async()=>{
  await page.locator('[data-destination="match"]').click();await page.waitForFunction(()=>matchChannel&&matchChannelStatus==='subscribed');
  assert(await page.evaluate(()=>fixtureCalls.some(c=>c[0]==='track'&&c[1]==='N')));
  const before=await page.evaluate(()=>fixtureCalls.filter(c=>c[0]==='channel').length);
  await page.locator('[data-destination="match"]').click();assert.equal(await page.evaluate(()=>fixtureCalls.filter(c=>c[0]==='channel').length),before);
  const untracks=await page.evaluate(()=>fixtureCalls.filter(c=>c[0]==='untrack').length);
  await page.locator('[data-destination="memories"]').click();assert.equal(await page.evaluate(()=>fixtureCalls.filter(c=>c[0]==='untrack').length),untracks);await page.keyboard.press('Escape');
  await page.locator('[data-destination="home"]').click();assert(await page.evaluate(()=>fixtureCalls.some(c=>c[0]==='untrack')));
  await page.locator('[data-destination="match"]').click();await page.waitForFunction(()=>currentTab==='match');assert.equal(await page.evaluate(()=>fixtureCalls.filter(c=>c[0]==='channel').length),before);
 });
 await check('logout resets memory state and inert navigation',async()=>{
  await page.locator('[data-destination="memories"]').click();
  await page.evaluate(()=>signOutApp());assert.equal(await page.evaluate(()=>memoriesState.sections.size),0);assert.equal(await page.evaluate(()=>memoriesState.reviewLimit),10);
  assert(!(await page.evaluate(()=>document.getElementById('appRoot').inert)));assert(await page.locator('#landingScreen').isVisible());
 });
 assert.deepEqual(errors,[]);console.log(`UX Chromium: ${checks}/${checks} PASS; SDK/DB fixtures only`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
