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
  await page.evaluate(()=>checkLoginState());
 };
 const check=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
 await load();
 await page.evaluate(()=>selectUser('N'));await page.locator('#passwordInput').fill(testPassword);await page.locator('#loginSubmit').click();await page.waitForFunction(()=>isAppAuthorized());

 await page.waitForTimeout(350);
 await page.route('https://**/*',r=>r.abort());
 await page.evaluate(()=>{
  window.fixtureClient=sb;sb=null;dbMode='local';vetoes=[];
  window.resetCardFixture=()=>{
   vetoes=[];
   ['detailModal','reviewModal','seenModal','scheduleModal','confirmModal','sagaModal'].forEach(closeModalNow);
   movies=[{id:'scary',tmdb_id:4247,title:'Scary Movie',director:'Keenen Ivory Wayans',release_year:2000,duration:'88 min',platform:'Streaming',genres:['Commedia'],status:'watched',seen_n:true,seen_v:false,in_shared_list:false,seen_rating_n:7.3,review_text_n:'CULT',seen_rating_together:8.2,review_text_together:'Una recensione lunga. '.repeat(35),collection_id:4248,trailer_url:'https://trailer.invalid/watch',imdb_rating:'6.3',rt_rating:'51%',metacritic_rating:'48'},
    {id:'plain',title:'Altro film N',director:'Regista N',status:'watchlist',seen_n:true,seen_v:false,in_shared_list:false},
    {id:'v-film',title:'Avventura V',director:'Regista V',status:'watchlist',seen_n:false,seen_v:true,in_shared_list:false},
    {id:'both',title:'Visioni separate',director:'Regista comune',status:'watchlist',seen_n:true,seen_v:true,in_shared_list:false}];
   movieNights=[{id:'scary-completed',movie_id:'scary',status:'completed',date:'2026-10-01'}];
   resetHistorySearch();resetListFilters();saveLocal();setTab('history_n');
  };
  window.detailCalls=[];window.sagaCalls=[];
  const detail=openMovieDetail;openMovieDetail=(...args)=>{detailCalls.push(args[0]);detail(...args);};
  openMovieSaga=id=>sagaCalls.push(id);fetchOscarWins=async()=>null;
 });
 const card=()=>page.locator('#movieGrid .movie-ticket').filter({has:page.locator('h3',{hasText:'Scary Movie'})});
 const section=(label,host=card())=>host.locator('.movie-card-section').filter({has:page.locator('summary > span:first-child',{hasText:label})});
 const open=async(label,host=card())=>{const el=section(label,host);if(!(await el.evaluate(e=>e.open)))await el.locator('summary').click();await page.waitForTimeout(30);return el;};
 const neutralCalls=()=>page.evaluate(()=>detailCalls.length);
 for(const width of [320,390,768]){
  await page.setViewportSize({width,height:844});await page.evaluate(()=>resetCardFixture());
  if(screenshots)await page.screenshot({path:path.join(screenshots,'cards-closed-'+width+'.png'),fullPage:true,animations:'disabled'});
  await check('No review accordion without saved text '+width,async()=>{
   const plain=page.locator('#movieGrid .movie-ticket').filter({has:page.locator('h3',{hasText:'Altro film N'})});
   assert.equal(await section('Recension',plain).count(),0);
   await open('Gestione',plain);assert(await plain.getByRole('button',{name:'Aggiungi voto o recensione N',exact:true}).isVisible());
  });
  await check('Single saved review uses singular '+width,async()=>{
   await page.evaluate(()=>{movies[1].review_text_n='Breve';saveLocal();render();});
   const plain=page.locator('#movieGrid .movie-ticket').filter({has:page.locator('h3',{hasText:'Altro film N'})});
   assert.equal(await section('Recensione',plain).locator('summary > span:first-child').textContent(),'Recensione');
   await open('Recensione',plain);assert(await plain.getByText('“Breve”',{exact:true}).isVisible());assert(!(await plain.locator('.movie-card-review-toggle').isVisible()));
  });
  await page.evaluate(()=>resetCardFixture());
  await check('Scary N and Together, primary scores and trailer visible when closed '+width,async()=>{
   assert.equal(await card().locator('details[open]').count(),0);
   assert.equal(await section('Recensioni').locator('summary > span:first-child').textContent(),'Recensioni · 2');
   for(const text of ['N','N+V'])assert((await card().locator('.viewing-scores').textContent()).includes(text));
   assert((await card().locator('.viewing-scores').textContent()).includes('7,3/10'));assert((await card().locator('.viewing-scores').textContent()).includes('8,2/10'));
   assert(await card().locator('.rating-holo').isVisible());assert(await card().getByText('Trailer',{exact:true}).isVisible());assert(await card().getByText('Continua la saga').isVisible());
   assert(!(await card().locator('.movie-card-review-text').first().isVisible()));
   assert.equal(await card().locator('.viewing-person.is-together').count(),2);
  });
  await check('Accordion and single review expansion never open detail '+width,async()=>{
   const before=await neutralCalls();const reviews=await open('Recensioni');
   assert(await reviews.getByText('“CULT”',{exact:true}).isVisible());
   const long=reviews.locator('.movie-card-review').last(),toggle=long.locator('button');
   assert(await toggle.isVisible());assert.equal(await long.locator('p').evaluate(e=>getComputedStyle(e).webkitLineClamp),'2');
   assert(await long.locator('p').evaluate(e=>e.scrollHeight>e.clientHeight));
   await toggle.focus();await page.keyboard.press('Enter');assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert(!(await long.locator('p').evaluate(e=>e.classList.contains('is-clamped'))));
   await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
   assert.equal(await reviews.locator('.movie-card-review').first().locator('button').getAttribute('aria-expanded'),'false');
   await reviews.locator('p').first().click();assert.equal(await neutralCalls(),before);
   await open('Programmazione');assert.equal(await card().locator('details[open]').count(),1);assert(!(await reviews.evaluate(e=>e.open)));
   await section('Programmazione').locator('summary').focus();await page.keyboard.press('Enter');assert.equal(await card().locator('details[open]').count(),0);
   assert.equal(await neutralCalls(),before);
  });
  await check('Trailer default link and independent saga action '+width,async()=>{
   const before=await neutralCalls();
   const popupPromise=page.waitForEvent('popup');await card().getByText('Trailer',{exact:true}).click();const popup=await popupPromise;await popup.close();
   await card().getByText('Continua la saga').click();assert.equal(await page.evaluate(()=>sagaCalls.at(-1)),'scary');assert.equal(await neutralCalls(),before);
   assert.equal(await card().locator('a').count(),1);
  });
  await check('Neutral card opens unchanged detail '+width,async()=>{
   const before=await neutralCalls();await card().locator('h3').click();assert.equal(await neutralCalls(),before+1);await page.waitForFunction(()=>!document.getElementById('detailModal').classList.contains('hidden'));assert(await page.locator('#detailModal').isVisible());
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!detailTransitionActive);
  });
  await check('Together permits missing N personal declaration '+width,async()=>{
   await page.evaluate(()=>{movies[0].seen_n=false;saveLocal();setTab('watched');});await open('Gestione');await card().getByText("L'ho già visto",{exact:true}).click();
   await page.waitForFunction(()=>movies[0].seen_n);assert.equal(await page.evaluate(()=>movies[0].seen_v),false);assert.equal(await page.evaluate(()=>togetherSeen(movies[0])),true);assert(!(await page.locator('#seenModal').isVisible()));
  });
  await check('Personal editing and separate removal preserve shared data '+width,async()=>{
   await open('Gestione');await card().getByRole('button',{name:'Modifica voto e recensione N',exact:true}).click();assert(await page.locator('#reviewModal').isVisible());
   await page.locator('#reviewRating').fill('7,4');await page.locator('#reviewText').fill('Nuova personale');await page.locator('#reviewSaveButton').click();await page.waitForFunction(()=>movies[0].seen_rating_n===7.4);
   await open('Gestione');await card().getByRole('button',{name:'Rimuovi voto o recensione N',exact:true}).click();await page.getByRole('button',{name:'Solo voto',exact:true}).click();await page.waitForFunction(()=>movies[0].seen_rating_n===null);
   assert.equal(await page.evaluate(()=>movies[0].review_text_n),'Nuova personale');
   await open('Gestione');await card().getByRole('button',{name:'Rimuovi voto o recensione N',exact:true}).click();await page.locator('#confirmYes').click();await page.waitForFunction(()=>!movies[0].review_text_n);
   assert.equal(await page.evaluate(()=>movies[0].seen_n),true);assert.equal(await page.evaluate(()=>movies[0].seen_rating_together),8.2);assert(await page.evaluate(()=>!!movies[0].review_text_together));
  });
  await page.evaluate(()=>resetCardFixture());
  await check('All N/V/shared scores visible and shared edit preserves personal data '+width,async()=>{
   await page.evaluate(()=>{movies[0].seen_rating_v=6.4;saveLocal();render();});
   assert((await card().locator('.viewing-scores').textContent()).includes('6,4/10'));
   assert.equal(await card().locator('details[open]').count(),0);
   await open('Gestione');await card().getByRole('button',{name:'Modifica voto e recensione N+V',exact:true}).click();
   await page.locator('#reviewRating').fill('8,5');await page.locator('#reviewText').fill('Nuova condivisa');await page.locator('#reviewSaveButton').click();await page.waitForFunction(()=>movies[0].seen_rating_together===8.5);
   assert.equal(await page.evaluate(()=>movies[0].seen_rating_n),7.3);assert.equal(await page.evaluate(()=>movies[0].seen_rating_v),6.4);assert.equal(await page.evaluate(()=>movies[0].seen_v),false);
  });
  await page.evaluate(()=>resetCardFixture());
  await check('Existing schedule actions keep event data and summary '+width,async()=>{
   const before=await neutralCalls();await open('Programmazione');await card().getByText('Programma',{exact:true}).click();assert(await page.locator('#scheduleModal').isVisible());
   await page.locator('#scheduleDate').fill('2026-11-10');await page.locator('#scheduleConfirm').click();await page.waitForFunction(()=>!!activeNightForMovie('scary'));
   assert((await section('Programmazione').locator('summary').textContent()).includes('10 nov'));
   await open('Programmazione');assert(await card().getByText('Snack e luogo',{exact:true}).isVisible());assert(await card().getByText('Annulla proposta',{exact:true}).isVisible());
   assert.equal(await neutralCalls(),before);assert.equal(await page.evaluate(()=>movies[0].seen_v),false);assert.equal(await page.evaluate(()=>movies[0].seen_rating_n),7.3);
  });
  await page.evaluate(()=>resetCardFixture());
  await check('Compact Gestione: context rows, touch targets and separate film deletion '+width,async()=>{
   await page.evaluate(()=>resetCardFixture());const management=await open('Gestione');
   assert.deepEqual(await management.locator('[data-evaluation-context]').evaluateAll(rows=>rows.map(row=>row.dataset.evaluationContext)),['N','both']);
   assert.equal(await management.locator('.movie-card-icon-action').count(),4);
   for(const row of await management.locator('.movie-card-evaluation-row').all()){
    const badge=row.locator('.movie-card-evaluation-badge');assert.equal(await badge.count(),1);
    assert.equal(await row.locator('.viewing-person').count(),0);
    const box=await badge.boundingBox(),rowBox=await row.boundingBox(),first=await row.locator('button').first().boundingBox(),last=await row.locator('button').last().boundingBox();
    assert.equal(box.height,32);assert(box.width>=32);assert.equal(await badge.evaluate(el=>getComputedStyle(el).borderRadius),'10px');
    assert(Math.abs(box.x-rowBox.x)<1);assert(box.x+box.width<first.x);assert(Math.abs(box.y+box.height/2-(first.y+first.height/2))<1);assert(Math.abs(last.x+last.width-(rowBox.x+rowBox.width))<1);
    assert.equal(first.width,44);assert.equal(first.height,44);assert.equal(last.width,44);assert.equal(last.height,44);assert.equal(rowBox.height,44);
    assert(Math.abs(last.x-first.x-first.width-8)<1);assert(Math.abs(last.y-first.y)<1);
    const shared=await row.getAttribute('data-evaluation-context')==='both';
    assert.equal(await badge.evaluate(el=>getComputedStyle(el).color),shared?'rgb(15, 23, 42)':'rgb(255, 255, 255)');
    assert.equal(await badge.textContent(),shared?'N+V':'N');assert.equal(await badge.getAttribute('aria-label'),shared?'Valutazione N+V':'Valutazione N');
   }

   const personalRow=await management.locator('[data-evaluation-context="N"]').boundingBox(),sharedRow=await management.locator('[data-evaluation-context="both"]').boundingBox();
   assert(Math.abs(sharedRow.y-personalRow.y-personalRow.height-8)<1);
   for(const button of await management.locator('.movie-card-icon-action').all()){
    const box=await button.boundingBox();assert(box.width>=44&&box.height>=44);assert(await button.getAttribute('aria-label'));assert(await button.getAttribute('title'));
   }
   assert(!(await management.textContent()).includes('7,3'));assert(!(await management.textContent()).includes('CULT'));
   assert.equal(await card().locator('button[onclick^="vetoMovie"],button[onclick^="unvetoMovie"]').count(),0);
   const filmDelete=management.getByRole('button',{name:'Rimuovi film',exact:true});assert(await filmDelete.isVisible());assert(!(await filmDelete.evaluate(el=>el.classList.contains('movie-card-icon-action'))));
   const before=await neutralCalls();await management.getByRole('button',{name:'Rimuovi voto o recensione N',exact:true}).focus();await page.keyboard.press('Enter');
   assert(await page.getByText('Cosa vuoi rimuovere?',{exact:true}).isVisible());assert.equal(await neutralCalls(),before);
   assert.equal(await page.evaluate(()=>document.activeElement.id),'confirmNo');
   await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Chiudi');
   await page.keyboard.press('Escape');assert(!(await page.locator('#confirmModal').isVisible()));assert.equal(await page.evaluate(()=>movies[0].seen_rating_n),7.3);
   if(screenshots){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(screenshots,'management-scary-'+width+'.png'),fullPage:true,animations:'disabled'});}
  });
  for(const by of ['N','both'])for(const choice of ['rating','text','both']){
   await check('Removal '+by+'/'+choice+' preserves every unrelated field '+width,async()=>{
    await page.evaluate(()=>resetCardFixture());await open('Gestione');
    const before=await page.evaluate(()=>({movie:structuredClone(movies[0]),nights:structuredClone(movieNights),count:movies.length}));
    const label=by==='both'?'N+V':'N';await card().getByRole('button',{name:'Rimuovi voto o recensione '+label,exact:true}).click();
    assert.equal(await page.locator('#confirmChoices button').count(),3);assert(!(await page.locator('#confirmYes').isVisible()));
    await page.locator('[data-removal-choice="'+choice+'"]').click();await page.waitForFunction(()=>document.getElementById('confirmModal').classList.contains('hidden'));
    const suffix=by==='both'?'together':'n',expected={...before.movie};
    if(choice!=='text')expected['seen_rating_'+suffix]=null;if(choice!=='rating')expected['review_text_'+suffix]='';
    assert.deepEqual(await page.evaluate(()=>movies[0]),expected);assert.deepEqual(await page.evaluate(()=>movieNights),before.nights);assert.equal(await page.evaluate(()=>movies.length),before.count);
   });
  }
  for(const by of ['N','both'])for(const only of ['rating','text']){
   await check('Single '+by+'/'+only+' confirm and cancel, no inapplicable options '+width,async()=>{
    await page.evaluate(({by,only})=>{resetCardFixture();const suffix=by==='both'?'together':'n';movies[0]['seen_rating_'+suffix]=only==='rating'?0:null;movies[0]['review_text_'+suffix]=only==='text'?'Solo testo':'';saveLocal();render();},{by,only});
    await open('Gestione');const label=by==='both'?'N+V':'N';await card().getByRole('button',{name:'Rimuovi voto o recensione '+label,exact:true}).click();
    assert.equal(await page.locator('#confirmChoices button').count(),0);assert(await page.locator('#confirmYes').isVisible());
    await page.locator('#confirmNo').click();const suffix=by==='both'?'together':'n';assert.equal(await page.evaluate(({suffix,only})=>movies[0][only==='rating'?'seen_rating_'+suffix:'review_text_'+suffix],{suffix,only}),only==='rating'?0:'Solo testo');
    await card().getByRole('button',{name:'Rimuovi voto o recensione '+label,exact:true}).click();await page.locator('#confirmYes').click();
    await page.waitForFunction(suffix=>movies[0]['seen_rating_'+suffix]===null&&!movies[0]['review_text_'+suffix],suffix);
    assert.equal(await page.evaluate(()=>movies[0].seen_n),true);assert.equal(await page.evaluate(()=>movies[0].seen_v),false);assert(await page.evaluate(()=>togetherSeen(movies[0])));
   });
  }
  await check('Da Vinci personal only, add routes and no useless bins '+width,async()=>{
   await page.evaluate(()=>{resetCardFixture();movies=[{id:'davinci',tmdb_id:591,title:'Il codice da Vinci',director:'Ron Howard',status:'watchlist',seen_n:true,seen_v:false,in_shared_list:false,seen_rating_n:7,review_text_n:'Personale'}];movieNights=[];saveLocal();setTab('history_n');});
   const davinci=page.locator('#movieGrid .movie-ticket');await open('Gestione',davinci);
   assert.deepEqual(await davinci.locator('[data-evaluation-context]').evaluateAll(rows=>rows.map(row=>row.dataset.evaluationContext)),['N']);
   await davinci.getByRole('button',{name:'Modifica voto e recensione N',exact:true}).click();assert.equal(await page.locator('#reviewRating').inputValue(),'7');assert.equal(await page.locator('#reviewText').inputValue(),'Personale');await page.keyboard.press('Escape');
   await page.evaluate(()=>{movies[0].seen_rating_n=null;movies[0].review_text_n='';saveLocal();render();});await open('Gestione',davinci);
   assert.equal(await davinci.locator('.movie-card-evaluation-remove').count(),0);await davinci.getByRole('button',{name:'Aggiungi voto o recensione N',exact:true}).click();assert(await page.locator('#reviewModal').isVisible());await page.keyboard.press('Escape');
   await page.evaluate(()=>{movies[0].seen_n=false;movies[0].in_shared_list=true;saveLocal();setTab('watchlist');});await open('Gestione',davinci);
   assert.equal(await davinci.locator('[data-evaluation-context]').count(),0);await davinci.getByText("L'ho già visto",{exact:true}).click();assert(await page.locator('#seenModal').isVisible());await page.keyboard.press('Escape');
   await page.evaluate(()=>resetCardFixture());
  });
  await check('Together with no personal evaluation keeps separate rows '+width,async()=>{
   await page.evaluate(()=>{resetCardFixture();movies[0].seen_n=false;movies[0].seen_rating_n=null;movies[0].review_text_n='';saveLocal();setTab('watched');});await open('Gestione');
   const personal=card().locator('[data-evaluation-context="N"]');assert.equal(await personal.locator('button').count(),1);assert(await personal.getByRole('button',{name:'Aggiungi voto o recensione N',exact:true}).isVisible());
   assert.equal(await card().locator('[data-evaluation-context="both"] button').count(),2);
   await personal.locator('button').click();assert.equal(await page.locator('#reviewBy').inputValue(),'N');assert.equal(await page.locator('#reviewRating').inputValue(),'');assert.equal(await page.locator('#reviewText').inputValue(),'');await page.keyboard.press('Escape');
  });
  await check('Veto lives in detail, same eligibility and own undo '+width,async()=>{
   await page.evaluate(()=>{resetCardFixture();movies=[{id:'veto-film',title:'Film per il veto',status:'watchlist',in_shared_list:true,seen_n:false,seen_v:false}];movieNights=[];saveLocal();setTab('watchlist');});
   assert.equal(await page.locator('#movieGrid button[onclick^="vetoMovie"]').count(),0);
   await page.locator('#movieGrid h3').click();await page.waitForFunction(()=>!detailTransitionActive&&!document.getElementById('detailModal').classList.contains('hidden'));
   await page.evaluate(()=>{document.getElementById('detailAwards').innerHTML='<span>Premio fixture</span>';});
   await page.locator('#detailBody').getByRole('button',{name:'Vieta questa settimana',exact:true}).click();await page.waitForFunction(()=>vetoes.some(v=>v.person==='N'));
   assert(await page.locator('#detailBody').getByRole('button',{name:'Togli il veto',exact:true}).isVisible());
   await page.locator('#detailBody').getByRole('button',{name:'Togli il veto',exact:true}).click();await page.waitForFunction(()=>vetoes.length===0);
   assert(await page.locator('#detailBody').getByRole('button',{name:'Vieta questa settimana',exact:true}).isVisible());
   assert.equal(await page.locator('#detailAwards').textContent(),'Premio fixture');
   await page.evaluate(()=>{vetoes=[{id:'other-veto',person:'V',movie_id:'veto-film',week_key:currentWeekKey()}];renderMovieDetail(movies[0]);});assert.equal(await page.locator('#detailBody button[onclick^="unvetoMovie"]').count(),0);
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!detailTransitionActive);
   await page.evaluate(()=>resetCardFixture());
  });
  await page.evaluate(()=>resetCardFixture());
  await check('History N title/director, empty, no results and live N/V switch '+width,async()=>{
   const input=page.locator('#historySearchInput');const calls=await page.evaluate(()=>fixtureCalls.length);
   await input.fill('sCaRy');await page.waitForFunction(()=>historySearchDebounceTimer===null);assert.deepEqual(await page.locator('#movieGrid h3').allTextContents(),['Scary Movie']);
   await input.fill('WAYANS');await page.waitForFunction(()=>historySearchDebounceTimer===null);assert.deepEqual(await page.locator('#movieGrid h3').allTextContents(),['Scary Movie']);
   await page.locator('#historySwitchV').click();assert.equal(await page.locator('#movieGrid h3').count(),0);assert(await page.getByText('Nessun film corrisponde alla ricerca nello storico selezionato.').isVisible());
   await input.fill('REGISTA V');await page.waitForFunction(()=>historySearchDebounceTimer===null);assert.deepEqual(await page.locator('#movieGrid h3').allTextContents(),['Avventura V']);
   await input.fill('avventura');await page.waitForFunction(()=>historySearchDebounceTimer===null);assert.deepEqual(await page.locator('#movieGrid h3').allTextContents(),['Avventura V']);
   await page.locator('#historySwitchN').click();assert.equal(await page.locator('#movieGrid h3').count(),0);
   await input.fill('');await page.waitForFunction(()=>historySearchDebounceTimer===null);assert.equal(await page.locator('#movieGrid h3').count(),3);
   await input.fill('zzzzz');await page.waitForFunction(()=>historySearchDebounceTimer===null);assert.equal(await page.locator('#movieGrid h3').count(),0);
   assert.equal(await page.evaluate(()=>fixtureCalls.length),calls);assert.equal(await input.inputValue(),'zzzzz');
   await input.fill('');await page.waitForFunction(()=>historySearchDebounceTimer===null);await page.locator('#historySwitchV').click();assert.equal(await page.locator('#movieGrid h3').count(),2);assert.equal(await card().count(),0);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  });
 }
 await check('Together permits missing V declaration through authenticated V',async()=>{
  await page.evaluate(async()=>{sb=fixtureClient;await signOutApp();selectUser('V');});await page.locator('#passwordInput').fill(testPassword);await page.locator('#loginSubmit').click();await page.waitForFunction(()=>currentUser==='V'&&isAppAuthorized());
  await page.evaluate(()=>{sb=null;dbMode='local';resetCardFixture();setTab('history_n');});await open('Gestione');await card().getByText("L'ho già visto",{exact:true}).click();await page.waitForFunction(()=>movies[0].seen_v);
  assert.equal(await page.evaluate(()=>movies[0].seen_n),true);assert.equal(await page.evaluate(()=>togetherSeen(movies[0])),true);
  assert((await card().locator('.viewing-scores').textContent()).includes('7,3/10'));
  await page.evaluate(()=>resetHistorySearch());assert.equal(await page.locator('#historySearchInput').inputValue(),'');
 });
 await check('V ownership: only V row, V removal and shared removal preserve N',async()=>{
  await page.evaluate(()=>{resetCardFixture();movies[0].seen_rating_v=6.7;movies[0].review_text_v='Recensione V';saveLocal();setTab('history_n');});await open('Gestione');
  assert.deepEqual(await card().locator('[data-evaluation-context]').evaluateAll(rows=>rows.map(row=>row.dataset.evaluationContext)),['V','both']);
  await card().getByRole('button',{name:'Modifica voto e recensione V',exact:true}).click();assert.equal(await page.locator('#reviewBy').inputValue(),'V');assert.equal(await page.locator('#reviewRating').inputValue(),'6,7');await page.keyboard.press('Escape');
  await card().getByRole('button',{name:'Rimuovi voto o recensione V',exact:true}).click();await page.getByRole('button',{name:'Voto e recensione',exact:true}).click();await page.waitForFunction(()=>movies[0].seen_rating_v===null&&!movies[0].review_text_v);
  assert.equal(await page.evaluate(()=>movies[0].seen_rating_n),7.3);assert.equal(await page.evaluate(()=>movies[0].review_text_n),'CULT');assert.equal(await page.evaluate(()=>movies[0].seen_rating_together),8.2);
  await open('Gestione');await card().getByRole('button',{name:'Rimuovi voto o recensione N+V',exact:true}).click();await page.getByRole('button',{name:'Voto e recensione',exact:true}).click();await page.waitForFunction(()=>movies[0].seen_rating_together===null&&!movies[0].review_text_together);
  assert.equal(await page.evaluate(()=>movies[0].seen_rating_n),7.3);assert.equal(await page.evaluate(()=>movies[0].seen_n),true);assert.equal(await page.evaluate(()=>movies[0].seen_v),false);assert(await page.evaluate(()=>togetherSeen(movies[0])));
  assert.equal(await page.evaluate(()=>removeEvaluationData('scary','N','both')),false);
 });

 for(const width of [320,390,768])await check('V identity badge and shared badge stay aligned with 44px controls '+width,async()=>{
  await page.setViewportSize({width,height:844});await page.evaluate(()=>{resetCardFixture();movies[0].seen_rating_v=6.7;movies[0].review_text_v='V';saveLocal();setTab('history_n');});await open('Gestione');
  const row=card().locator('[data-evaluation-context="V"]'),badge=row.locator('.movie-card-evaluation-badge');
  assert.equal(await badge.textContent(),'V');assert.equal(await badge.getAttribute('aria-label'),'Valutazione V');
  assert(await badge.evaluate(el=>el.classList.contains('auth-person-v')));assert.equal(await badge.evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)');
  assert.equal(await row.locator('.viewing-person').count(),0);
  const box=await badge.boundingBox(),rowBox=await row.boundingBox(),actions=await row.locator('button').first().boundingBox();
  assert.equal(box.width,32);assert.equal(box.height,32);assert(Math.abs(box.x-rowBox.x)<1);assert(box.x+box.width<actions.x);assert(Math.abs(box.y+16-(actions.y+22))<1);
  const sharedRow=await card().locator('[data-evaluation-context="both"]').boundingBox(),last=await row.locator('button').last().boundingBox();
  assert.equal(rowBox.height,44);assert.equal(sharedRow.height,44);assert(Math.abs(sharedRow.y-rowBox.y-rowBox.height-8)<1);assert(Math.abs(last.x-actions.x-actions.width-8)<1);assert(Math.abs(last.y-actions.y)<1);
  for(const button of await card().locator('.movie-card-icon-action').all()){const target=await button.boundingBox();assert.equal(target.width,44);assert.equal(target.height,44);}
  assert.equal(await card().locator('[data-evaluation-context="both"] .movie-card-evaluation-badge').textContent(),'N+V');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(screenshots){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(screenshots,'management-v-badges-'+width+'.png'),fullPage:true,animations:'disabled'});}
 });
 assert.deepEqual(errors,[]);console.log(`Movie cards / History Chromium: ${checks}/${checks} PASS; synthetic Auth, local data only`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
