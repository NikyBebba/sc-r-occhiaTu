#!/usr/bin/env node
'use strict';
// Full production HTML/module graph over loopback HTTP. Synthetic Auth/RPC only.
// --playwright=... --executable=... --tailwind=/local/tailwind.js --out=/tmp/report
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const arg=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const {chromium,webkit}=require(arg('playwright')||'playwright');
const root=path.resolve(__dirname,'..'),out=arg('out')||'/tmp/sc-target-ui-http';fs.mkdirSync(out,{recursive:true});
const data=require('./verify-production-shell.cjs').fixtureData();
const F=require('./fixtures/snapshot-v1.cjs');
data.raw=F.scale({contents:10,nights:0});
for(const [i,c]of data.raw.catalog.entries()){c.title=['Dune','Aftersun','Scary Movie','Detachment','Digger','Arrival','Alien','Interstellar','Moon','Past Lives'][i];c.duration='120 min';c.release_year=2020+i;c.poster='/fixture-poster.svg';c.genres=['Dramma'];c.platform='Streaming';}
for(const p of data.raw.personal)for(const state of p.states){state.list={active:false,generation:null};state.seen=false;}
for(const g of data.raw.group.states){g.effective_candidacy=true;g.list_visible=true;g.eligibility={match_base:true,ruota_base:true};}
for(const [i,p]of data.raw.personal.entries()){p.states[0].seen=true;p.states[1].seen=true;p.states[0].list={active:true,generation:i===0?'1':null};p.states[0].judgment={rating:null,preference:i===0,review:null};p.states[1].judgment={rating:i===0?0:8.7,preference:null,review:i===0?'Una recensione personale.':null};}
for(const g of data.raw.group.states.slice(0,2)){g.rewatch_semantic=true;g.rewatch_visible=true;}
data.raw.catalog[0].collection_id='123';data.raw.catalog[0].tmdb_id='1231';data.raw.catalog[0].collection_name='Dune';
for(const [index,status]of [[2,'completed'],[3,'completed'],[4,'completed'],[5,'confirmed'],[6,'proposed']]){
 const n=F.night(F.uid(70000+index),data.raw.catalog[index].movie_id,status);n.snack='Popcorn';n.location='Pigneto';if(status==='proposed')n.proposed_by_person_id=F.V;n.date=status==='completed'?'2026-12-20':'2027-01-06';n.time='21:30';data.raw.nights.push(n);data.raw.versions.entries.push(F.version('night',F.G,n.night_id));
 if(status==='completed'){data.raw.participants.push({night_id:n.night_id,person_id:F.N},{night_id:n.night_id,person_id:F.V});data.raw.group.judgments.push({movie_id:n.movie_id,rating:index===2?8.2:index===3?8.7:7,review:'Una recensione storica preservata.'});}
 data.raw.group.states[index].list_visible=false;data.raw.group.states[index].eligibility={match_base:false,ruota_base:false};
}
// Explicit personal exposure only, separate from historical Together.
data.raw.exposure=[];
for(const person of data.raw.personal)for(const state of person.states)if(state.seen)data.raw.exposure.push({person_id:person.person_id,movie_id:state.movie_id,sources:['PERSONAL_SEEN']});
for(const n of data.raw.nights.filter(n=>n.status==='completed'))for(const person_id of [F.N,F.V])data.raw.exposure.push({person_id,movie_id:n.movie_id,sources:['SELECTED_GROUP_TOGETHER']});
F.finish(data.raw);
function installFixture(data,delay){
 if(localStorage.getItem('fixture-wire'))data.raw=JSON.parse(localStorage.getItem('fixture-wire'));
 const at=data.at, session={access_token:'synthetic-target-session',user:{id:data.N},expires_at:Math.floor(Date.now()/1000)+3600};
 window.fixtureCalls=[];window.fixtureTableReads=[];window.fixtureCommands=[];window.fixtureAuthChecks=0;
 window.fixtureMatch={session:{id:'00000000-0000-4000-8000-000000000600',status:'open',deck:data.raw.group.states.filter(g=>g.eligibility.match_base).map(g=>g.movie_id),created_by:'N',created_at:data.at,seed:42,matched_movie_id:null,matched_at:null},swipes:[]};
 window.fixtureMutatingError=false;
 window.fetchTmdbCollection=async()=>({id:123,name:'Dune',parts:[{id:1231,title:'Dune',release_date:'2021-01-01',poster:'/fixture-poster.svg'},{id:1232,title:'Dune · Parte due',release_date:'2024-01-01',poster:'/fixture-poster.svg'}]});
 
 const envelope=data=>({count:null,data,error:null,status:200,statusText:'OK',success:true});
 const client={auth:{initialize:async()=>({error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
 getSession:async()=>({data:{session:JSON.parse(localStorage.getItem('ui-fixture-session'))},error:null}),
 getUser:async()=>{window.fixtureAuthChecks++;return {data:{user:session.user},error:null};}},realtime:{setAuth:async()=>{}},
 async rpc(name,args){window.fixtureCalls.push(name);if(name==='read_app_protocol')return envelope({protocol_read_contract_version:1,outcome:'OK',mode:'TARGET',minimum_client_protocol:1,authority_epoch:'a'.repeat(64)});
 if(name==='get_app_runtime_context'){await new Promise(r=>setTimeout(r,delay));return envelope({bootstrap_contract_version:1,outcome:'OK',caller:{person_id:data.N,legacy_person:'N'},selected_group:{group_id:data.G},protocol:{client_protocol:1,supported_protocol:1,minimum_client_protocol:1,snapshot_contract_version:1},runtime:{mode:'target',activation_allowed:true}});}
 if(name==='get_person_group_snapshot')return envelope(data.raw);if(name==='execute_match_action'){
  window.fixtureCommands.push({name,body:args});const p=args.p_parameters,m=window.fixtureMatch;
  if(args.p_action==='swipe')m.swipes.push({id:'00000000-0000-4000-8000-'+String(80000+m.swipes.length).padStart(12,'0'),session_id:m.session.id,movie_id:p.movie_id,person:'N',liked:p.liked,created_at:data.at});
  if(args.p_action==='acknowledge-match')m.session.matched_movie_id=p.matched_movie_id;
  if(args.p_action==='reconcile-done')m.session.status='done';
  if(args.p_action==='close')m.session.status='closed';
  return envelope({outcome:'SUCCESS',session:m.session,swipes:m.swipes});
 }
 if(name==='execute_app_command'){window.fixtureCommands.push({name,body:args});const body=args.p_request;if(window.fixtureHoldCommand)await new Promise(resolve=>window.fixtureReleaseCommand=resolve);
  if(['SCHEDULE_NIGHT','QUICK_NIGHT'].includes(body.intent)){
   const raw=data.raw,id=body.target.movie_id,p=body.parameters,nid='00000000-0000-4000-8000-000000090001';
   const night={night_id:nid,movie_id:id,status:body.intent==='SCHEDULE_NIGHT'?'proposed':'confirmed',date:p.date??null,time:p.time??null,snack:p.snack??null,location:p.location??null,proposed_by_person_id:data.N,created_at:data.at,confirmed_at:body.intent==='QUICK_NIGHT'?data.at:null,cancelled_at:null,completed_at:null};raw.nights.push(night);raw.nights.sort((a,b)=>a.night_id.localeCompare(b.night_id));
   const g=raw.group.states.find(g=>g.movie_id===id);g.active_night_ids.push(nid);g.active_night_ids.sort();g.list_visible=false;g.rewatch_visible=false;raw.group.collections.rewatch_movie_ids=raw.group.states.filter(g=>g.rewatch_visible).map(g=>g.movie_id);g.eligibility={match_base:false,ruota_base:false};raw.group.collections.list_movie_ids=raw.group.states.filter(g=>g.list_visible).map(g=>g.movie_id);raw.group.collections.scheduled_night_ids=raw.nights.filter(n=>['proposed','confirmed'].includes(n.status)).map(n=>n.night_id);
   const version=(kind,entity)=>{let v=raw.versions.entries.find(v=>v.scope_kind===kind&&v.scope_id===data.G&&v.entity_id===entity);if(!v){v={scope_kind:kind,scope_id:data.G,entity_id:entity,version:'0',tombstone:false};raw.versions.entries.push(v);}v.version=String(BigInt(v.version)+1n);const {tombstone,...affected}=v;return affected;};
   const affected=[version('group_film',id),version('night',nid)].sort((a,b)=>(a.scope_kind+a.scope_id+a.entity_id).localeCompare(b.scope_kind+b.scope_id+b.entity_id));raw.versions.entries.sort((a,b)=>(a.scope_kind+'|'+a.scope_id+'|'+a.entity_id).localeCompare(b.scope_kind+'|'+b.scope_id+'|'+b.entity_id));
   raw.coverage.counts.nights=raw.nights.length;raw.coverage.counts.version_entries=raw.versions.entries.length;localStorage.setItem('fixture-wire',JSON.stringify(raw));
   return envelope({protocol_version:1,request_id:body.request_id,outcome:'SUCCESS',replayed:false,result:{movie_id:id,night_id:nid},affected_versions:affected});
  }
  if(window.fixtureMutatingError)return envelope({protocol_version:1,request_id:body.request_id,outcome:'ERROR',error:{code:'INVALID_INPUT'}});
  return envelope({protocol_version:1,request_id:body.request_id,outcome:'ALREADY_IN_TARGET_STATE',replayed:false,result:{movie_id:body.target.movie_id,night_id:body.target.night_id||null},affected_versions:[]});
 }throw Error('Unexpected writer RPC '+name);},
 from(table){window.fixtureTableReads.push(table);if(!['app_members','swipe_sessions','swipes'].includes(table)){window.legacyCalls.push('raw table '+table);throw Error('Forbidden TARGET table read '+table);}const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return q;},maybeSingle:async()=>({data:{user_id:data.N,person:'N'},error:null}),then(resolve,reject){return Promise.resolve({data:table==='swipe_sessions'?[window.fixtureMatch.session]:table==='swipes'?window.fixtureMatch.swipes:[],error:null}).then(resolve,reject);}};return q;},
 channel(){const handlers=[];const c={on(type,filter,fn){handlers.push({type,filter,fn});return c;},subscribe(fn){setTimeout(()=>{fn?.('SUBSCRIBED');for(const h of handlers)if(h.type==='presence')h.fn();},0);return c;},presenceState:()=>({n:[{person_id:data.N,person:'N'}],v:[{person_id:data.V,person:'V'}]}),track:async()=>{},untrack:async()=>{}};return c;},removeChannel:async()=>{}};
 window.fixtureRestored=localStorage.getItem('ui-fixture-session')!==null;
 if(!window.fixtureRestored)localStorage.setItem('ui-fixture-session',JSON.stringify(session));
 sb=client;authIdentity=null;currentUser=null;authListener=null;
 localStorage.setItem(AUTH_STORAGE_KEY,JSON.stringify(session));
 window.legacyCalls=[];
 for(const name of ['loadMovies','resyncQuiet','subscribeRealtime','saveLocal','requireLegacyAuthority','verifyLegacyAuthority','assertLegacyDomainAccess','personalRating','personalPreference','togetherRating','viewingState','reviewTextFor','movieProjection','activeNightForMovie','togetherSeen','addReview','addPersonalReview','quickTonightUI','scheduleMovie','recordSwipe','continueMatch','enterMatch','leaveMatch','ensureActiveSession','addMovie','updateMovie','deleteMovie','markMovieSeen','undoMovieSeen','savePersonalReview','savePersonalReviewText','setPersonalPreference','proposeNight','confirmNight','cancelNight','editNight','completeNight','setQuickTonight','setWatched','setSurprise','vetoMovie','unvetoMovie']){
  try{window.eval(name+"=function(){window.legacyCalls.push('"+name+"');throw Error('LEGACY reached: "+name+"');}");}catch(_){}
 }
 checkLoginState();
}
const config="const CONFIG={SUPABASE_URL:'',SUPABASE_ANON_KEY:'',TMDB_API_KEY:'',OMDB_API_KEY:'',PEOPLE:{N:{label:'N',badgeClass:'badge-n'},V:{label:'V',badgeClass:'badge-v'}},AUTH_EMAILS:{N:'n@example.test',V:'v@example.test'}};";
const source=f=>fs.readFileSync(path.join(root,f));
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost'),file=u.pathname==='/'?'index.html':u.pathname.slice(1);res.setHeader('Cache-Control','no-store');let body;
 try{if(file==='index.html')body=source(file).toString().replace(/<script src="https:[^"]*"><\/script>/g,'').replace(/<link[^>]*https:[^>]*>/g,'').replace('<head>','<head><link rel="stylesheet" href="/fixture-vendor/icons.css"><link rel="stylesheet" href="/fixture-vendor/fonts.css"><script src="/fixture-prelude.js"></script><script src="/fixture-tailwind.js"></script>').replace('</body>',`<script src="/fixture-start.js?delay=${u.searchParams.get('delay')||0}"></script></body>`);
 else if(file==='fixture-prelude.js')body=`window.tailwind={config:{}};const OD=Date;window.Date=class extends OD{constructor(...a){super(...(a.length?a:[${JSON.stringify(data.at)}]));}static now(){return new OD(${JSON.stringify(data.at)}).getTime();}};if(navigator.serviceWorker)navigator.serviceWorker.register=async()=>({addEventListener(){}});`;
 else if(file==='fixture-tailwind.js')body=fs.readFileSync(arg('tailwind'));
 else if(file==='fixture-start.js')body=`window.addEventListener('load',()=>(${installFixture.toString()})(${JSON.stringify(data)},${Number(u.searchParams.get('delay'))}));`;
 else if(file==='fixture-poster.svg'){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><defs><linearGradient id="a" x2="1" y2="1"><stop stop-color="#23334f"/><stop offset="1" stop-color="#74504b"/></linearGradient></defs><rect width="300" height="450" fill="url(#a)"/><circle cx="150" cy="160" r="65" fill="#b8a67a"/><text x="150" y="350" text-anchor="middle" fill="white" font-size="20">CINEMA · FIXTURE</text></svg>');return;}
 else if(/^fixture-vendor\/[a-z0-9.-]+$/.test(file)){const name=file.split('/')[1];res.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.woff2')?'font/woff2':name.endsWith('.woff')?'font/woff':'font/ttf');res.end(fs.readFileSync(path.join(arg('vendors')||'/tmp/sc-product-target-vendor',name)));return;}
 else if(file==='js/config.js')body=config;
 else if(/^(js\/[a-z0-9_/-]+\.js|css\/style\.css|manifest\.json|icons\/[a-z0-9-]+\.png)$/.test(file))body=source(file);
 else{res.writeHead(404).end();return;}
 res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(body);
 }catch(e){res.writeHead(500).end(e.message);}});

(async()=>{let browser,checks=0;const results=[],shots=[];const check=(ok,label)=>{assert(ok,label);checks++;results.push(label);};
 try{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await (arg('engine')==='webkit'?webkit:chromium).launch({headless:true,...(arg('executable')?{executablePath:arg('executable')}:{})});
 for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:width===390?844:1000},hasTouch:width<768,isMobile:width<768,timezoneId:'Europe/Rome',serviceWorkers:'block'});
 await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await context.addInitScript(()=>{window.fixtureNativeTransition=document.startViewTransition?.bind(document);document.startViewTransition=undefined;});
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const ready=async()=>{await page.waitForFunction(()=>ProductionSession.getState().phase==='READY'&&ProductionSession.getState().view.kind==='AVAILABLE');await page.waitForTimeout(500);await page.evaluate(()=>chooseTheme('halloween'));await page.evaluate(()=>document.fonts.ready);};
 const shot=async name=>{await page.evaluate(()=>window.scrollTo(0,0));const filename=name+'-'+width+'.png',viewportFile=name+'-'+width+'-viewport.png';await page.screenshot({path:path.join(out,viewportFile)});await page.screenshot({path:path.join(out,filename),fullPage:true});shots.push({name,width,filename,viewportFile});};
 const nav=async route=>{await page.evaluate(route=>TargetShell.navigate(route),route);await page.waitForTimeout(100);};
 await page.goto(origin+'/?delay=450');await ready();
 for(const route of ['home','groupList','personalList','personalSeen','together','memories','scheduled','rewatch','calendar','match','wheel']){
  await nav(route);await shot(route);
  if(route==='home'){check(await page.locator('#nextMovieHero').isVisible(),'product Home hero visible for active future event '+width);check(await page.locator('#scheduledPanel').isVisible(),'product Home cartellone visible for other proposal '+width);}
  const state=await page.evaluate(()=>({legacy:legacyCalls,loader:document.getElementById('initialLoadingBanner').getClientRects().length>0,raw:/(^|\s)(true|false)(\s|$)/.test(document.getElementById('movieGrid').textContent),nav:document.querySelectorAll('#movieGrid nav').length,overflow:document.documentElement.scrollWidth>innerWidth}));
  check(state.legacy.length===0,'no LEGACY read/writer '+route+'/'+width+': '+state.legacy.join());check(!state.loader&&!state.raw&&state.nav===0&&!state.overflow,'clean product surface '+route+'/'+width);
 }
 await nav('groupList');
 check(await page.locator('#movieGrid .movie-ticket').count()>0,'product cards present '+width);
 for(const target of ['card','poster','title']){console.log('INTERACTION',width,target);
  const card=page.locator('#movieGrid .movie-ticket').first(),node=target==='poster'?card.locator('img'):target==='title'?card.locator('h3 button'):card;
  await node.evaluate(el=>el.scrollIntoView({block:'center'}));const bounds=await node.boundingBox();const x=bounds.x+(target==='card'?4:bounds.width/2),y=bounds.y+(target==='card'?4:bounds.height/2);if(width<768)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);
  await page.locator('#detailModal').waitFor({state:'visible'});check(await page.locator('#detailModal').isVisible(),'card '+target+' opens modal '+width);await shot('detail-'+target);await page.keyboard.press('Escape');console.log('ESCAPE',await page.locator('#detailModal').isVisible());check(!await page.locator('#detailModal').isVisible(),'Escape closes detail '+width);check(await page.evaluate(()=>document.activeElement?.matches('#movieGrid h3 button')),'focus returns to movie title '+width);
 }
 await page.locator('#movieGrid .movie-ticket').first().locator('h3 button').focus();await page.keyboard.press('Enter');check(await page.locator('#detailModal').isVisible(),'keyboard detail '+width);await page.keyboard.press('Escape');
 await page.locator('#movieGrid .movie-ticket').first().locator('summary').filter({hasText:'Programmazione'}).click();check(!await page.locator('#detailModal').isVisible(),'nested disclosure does not open detail '+width);
 await page.locator('#movieGrid .movie-ticket').first().getByText('Programma',{exact:true}).click();check(await page.locator('#scheduleModal').isVisible(),'nested CTA opens product schedule only '+width);await shot('schedule-modal');await page.evaluate(()=>closeModal('scheduleModal'));

 await nav('groupList');await page.locator('#movieGrid .movie-ticket h3 button').first().click();
 await page.evaluate(()=>{window.preRefreshView=ProductionSession.getState().view;ProductionSession.requestRefresh();});
 await page.waitForFunction(()=>ProductionSession.getState().view!==preRefreshView);
 await page.keyboard.press('Escape');check(await page.evaluate(()=>document.activeElement?.matches('#movieGrid h3 button')),'focus restored after TARGET re-render replaces source card '+width);
 await nav('personalSeen');await page.locator('#movieGrid .viewing-score-n').first().click();check(await page.locator('#reviewModal').isVisible(),'product judgment dialog '+width);await shot('judgment-modal');await page.evaluate(()=>closeModal('reviewModal'));
 await page.evaluate(()=>ProductionSession.setObservedPerson('00000000-0000-4000-8000-000000001002'));
 await nav('personalList');await shot('personalList-other');
 await nav('memories');await page.locator('#nightHistorySection > summary').click();await page.locator('#nightHistory details > summary').first().click();await page.locator('#nightHistory details details > summary').first().click();await shot('memories-expanded');await page.locator('#reviewSection > summary').click();await page.locator('#reviewTimeline details > summary').first().click();await shot('memories-reviews');
 check(await page.locator('#nightHistory .history-ticket').count()===3,'three historical event cards '+width);
 await nav('calendar');await page.evaluate(()=>calendarShift(-1));await page.evaluate(()=>calendarSelectDay('2026-12-20'));await shot('calendar-past');check(await page.locator('[data-calendar-movie]').count()===3,'calendar historical completed '+width);

 await nav('groupList');await page.locator('#movieGrid .movie-ticket').first().getByText('Continua la saga').click();
 await page.waitForFunction(()=>document.querySelectorAll('#sagaBody .saga-chapter').length===2);
 await shot('saga');check(await page.locator('#sagaModal').isVisible(),'product Saga panel '+width);await page.evaluate(()=>closeModal('sagaModal'));
 await nav('wheel');await page.evaluate(()=>spinWheel());await page.waitForFunction(()=>!wheelSpinning&&!document.getElementById('wheelWinner').classList.contains('hidden'));
 await shot('wheel-result');check(await page.locator('#wheelWinner').getByText('Scheda film · trama e trailer').isVisible(),'product wheel winner '+width);
 await page.locator('#wheelWinner').getByText('Scheda film · trama e trailer').click();check(await page.locator('#detailModal').isVisible(),'wheel result detail '+width);await page.keyboard.press('Escape');
 await nav('match');await page.waitForTimeout(300);await shot('match-ready');
 
 check(await page.locator('#matchCard').count()===1,'Tinder product presenter '+width);

 const matchId=await page.evaluate(()=>ProductionSession.getState().match.derived.currentCard.movie_id);
 await page.locator('#movieGrid button').filter({hasText:'Like'}).click();
 await page.waitForFunction(()=>ProductionSession.getState().match.authoritative.swipes.length===1);
 check((await page.locator('#movieGrid').textContent()).includes('In attesa di V'),'Match waits without revealing partner choice '+width);await shot('match-waiting');
 await page.evaluate(({id})=>{fixtureMatch.swipes.push({id:'00000000-0000-4000-8000-000000080099',session_id:fixtureMatch.session.id,movie_id:id,person:'V',liked:true,created_at:fixtureMatch.session.created_at});return ProductionSession.match(ProductionSession.capture(),'reconcile');},{id:matchId});
 await page.waitForFunction(()=>!!ProductionSession.getState().match.derived.pendingMatch);await shot('match-reveal');
 check(await page.locator('#matchReveal').isVisible(),'product Match reveal '+width);
 await page.locator('#matchReveal button[title="Chiudi"]').click();
 await page.locator('#movieGrid').getByText('Programma',{exact:true}).click();await page.locator('#scheduleDate').fill('2027-01-08');await page.locator('#scheduleConfirm').click();
 await page.waitForFunction(()=>fixtureMatch.session.status==='closed');
 check(await page.evaluate(()=>fixtureCommands.some(c=>c.name==='execute_app_command'&&c.body.p_request.intent==='SCHEDULE_NIGHT')&&fixtureCommands.some(c=>c.name==='execute_match_action'&&c.body.p_action==='close')),'Match schedules via TARGET then closes owned session '+width);
 check(await page.evaluate(()=>fixtureCommands.find(c=>c.name==='execute_app_command'&&c.body.p_request.intent==='SCHEDULE_NIGHT').body.p_request.parameters.select_candidate===true),'chosen candidacy is explicit and version guarded '+width);
 await shot('match-night-created');await page.waitForTimeout(1500);
 check(await page.evaluate(()=>TargetShell.getDestination()==='scheduled'),'Match returns to programmed event '+width);
 await page.evaluate(()=>TargetShell.edit('setMyEvaluation',ProductionSession.getState().view.catalog.contents[0].movie_id,{rating:null,preference:true,review:null}));
 await page.locator('#reviewRating').fill('8,3');await page.locator('#reviewSaveButton').click();
 await page.waitForFunction(()=>document.getElementById('reviewModal').classList.contains('hidden')||!document.getElementById('reviewError').classList.contains('hidden'));check(!await page.locator('#reviewModal').isVisible(),'TARGET evaluation callback success '+width+': '+await page.locator('#reviewError').textContent());
 check(await page.evaluate(()=>fixtureCommands.some(c=>c.name==='execute_app_command'&&c.body.p_request.intent==='SET_PERSONAL_EVALUATION')),'evaluation uses TARGET command '+width);
 check(await page.evaluate(()=>fixtureCommands.filter(c=>c.name==='execute_app_command').every(c=>c.body.p_request.expected_versions.filter(v=>v.scope_kind==='person_film').every(v=>v.scope_id==='00000000-0000-4000-8000-000000001001'))),'caller authority '+width);


 await nav('groupList');
 for(let n=0;n<2;n++){await page.evaluate(()=>TargetShell.edit('createContent'));check(await page.locator('#addModal').isVisible(),'product Add reopens '+n+'/'+width);await page.evaluate(()=>closeModal('addModal'));}
 const editCount=await page.evaluate(()=>fixtureCommands.length);
 await page.evaluate(()=>{const item=ProductionSession.getState().view.events.completed[0];TargetShell.edit('editNight',item.event.night_id,item.event);});
 await page.locator('#scheduleLocation').fill('Luogo aggiornato nella fixture');await shot('historical-night-edit');await page.locator('#scheduleConfirm').click();await page.waitForFunction(()=>document.getElementById('scheduleModal').classList.contains('hidden'));
 check(await page.evaluate(n=>fixtureCommands.length===n+1&&Object.keys(fixtureCommands.at(-1).body.p_request.parameters).sort().join()==='location,night_id',editCount),'historical metadata edit sends only changed location '+width);
 await page.evaluate(()=>{const item=ProductionSession.getState().view.events.scheduled[0];TargetShell.edit('editNight',item.event.night_id,{...item.event,date:null,time:null});});
 check(!await page.locator('#scheduleDateField').isVisible(),'undated quick-event metadata never requires invented date '+width);await page.evaluate(()=>closeModal('scheduleModal'));
 await nav('groupList');const beforeCompletion=await page.evaluate(()=>fixtureCommands.length);
 await page.evaluate(()=>TargetShell.edit('completeNow',ProductionSession.getState().view.catalog.contents[0].movie_id));
 check(await page.locator('#targetParticipants input:checked').count()===0,'no inferred completion participants '+width);
 await page.locator('#scheduleConfirm').click();check(await page.evaluate(()=>fixtureCommands.length)===beforeCompletion,'missing participants block command '+width);
 await page.locator('#targetParticipants input').first().check();await shot('completion-modal');
 await page.evaluate(()=>{fixtureHoldCommand=true;document.getElementById('scheduleConfirm').onclick();document.getElementById('scheduleConfirm').onclick();});
 await page.waitForFunction(n=>fixtureCommands.length===n+1,beforeCompletion);
 check(await page.evaluate(()=>fixtureCommands.at(-1).body.p_request.parameters.participants.length===1),'explicit participant subset and single pending command '+width);
 await page.evaluate(()=>{fixtureHoldCommand=false;fixtureReleaseCommand();});await page.waitForFunction(()=>document.getElementById('scheduleModal').classList.contains('hidden'));

 if(await page.evaluate(()=>!!fixtureNativeTransition)){
  await nav('groupList');await page.evaluate(()=>{document.startViewTransition=fixtureNativeTransition;});
  await page.locator('#movieGrid .movie-ticket h3 button').first().click();await page.locator('#detailModal').waitFor({state:'visible'});await page.waitForFunction(()=>!detailTransitionActive);await page.keyboard.press('Escape');await page.locator('#detailModal').waitFor({state:'hidden'});await page.waitForFunction(()=>!detailTransitionActive);
  check(await page.evaluate(()=>document.activeElement?.matches('#movieGrid h3 button')),'native detail transition returns focus '+width);
  await page.evaluate(()=>{document.startViewTransition=undefined;});
 }
 const oldCallback=await page.evaluate(()=>{TargetShell.detail(ProductionSession.getState().view.catalog.contents[0].movie_id);const button=[...document.getElementById('detailBody').querySelectorAll('button')].find(b=>b.textContent==='Nella mia Lista'||b.textContent==='Rimuovi dalla mia Lista');window.retiredProductCallback=button.onclick;return fixtureCommands.length;});
 await page.evaluate(()=>{openModal('themeModal');lockApp();});await page.evaluate(()=>retiredProductCallback({stopPropagation(){}}));
 check(await page.evaluate(()=>modalStack.length===0&&!document.getElementById('appRoot').inert&&document.body.style.overflow!=='hidden'),'Auth teardown releases dialogs and scroll lock '+width);
 check(await page.evaluate(()=>fixtureCommands.length)===oldCallback,'retired rendered callback cannot write after auth invalidation '+width);
 await page.reload();await ready();check(await page.evaluate(()=>fixtureRestored&&fixtureAuthChecks>=2&&currentUser==='N'),'verified session restore '+width);
 check(await page.evaluate(()=>legacyCalls.length===0),'no LEGACY across reload '+width);
 check(errors.length===0,'console/page errors zero '+width+': '+errors.join(';'));await context.close();
 }
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,results,shots,productionAccess:false},null,2));
 fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><meta charset="utf-8"><title>Product TARGET review</title><style>body{background:#101019;color:#eee;font:16px system-ui}section{margin:2rem}img{max-width:100%;border:1px solid #555}a{color:#bac8ff}</style><h1>Review UI TARGET · fixture locale HTTP</h1><p>Dati sintetici. Nessun accesso production. Screenshot desktop e touch/mobile.</p>'+shots.map(s=>'<section><h2>'+s.name+' · '+s.width+'</h2><a href="'+s.filename+'"><img loading="lazy" src="'+s.viewportFile+'"></a></section>').join(''));
 console.log('PRODUCT UI HTTP '+checks+'/'+checks+' PASS');
 }finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
