#!/usr/bin/env node
'use strict';
// Full production HTML/module graph over loopback HTTP. Synthetic Auth/RPC only.
// --playwright=... --executable=... --tailwind=/local/tailwind.js --out=/tmp/report
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const arg=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const {chromium}=require(arg('playwright')||'playwright');
const root=path.resolve(__dirname,'..'),out=arg('out')||'/tmp/sc-target-ui-http';fs.mkdirSync(out,{recursive:true});
const data=require('./verify-production-shell.cjs').fixtureData();
const F=require('./fixtures/snapshot-v1.cjs');
for (const [index,person] of data.raw.personal.entries()) {
  person.states[index].seen=true;
  person.states[index].list={active:true,generation:person.person_id===data.N?'1':null};
}
F.finish(data.raw);
function installFixture(data,delay){
 const at=data.at, session={access_token:'synthetic-target-session',user:{id:data.N},expires_at:Math.floor(Date.now()/1000)+3600};
 window.fixtureCalls=[];window.fixtureAuthChecks=0;
 const envelope=data=>({count:null,data,error:null,status:200,statusText:'OK',success:true});
 const client={auth:{initialize:async()=>({error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
 getSession:async()=>({data:{session:JSON.parse(localStorage.getItem('ui-fixture-session'))},error:null}),
 getUser:async()=>{window.fixtureAuthChecks++;return {data:{user:session.user},error:null};}},realtime:{setAuth:async()=>{}},
 async rpc(name){window.fixtureCalls.push(name);if(name==='read_app_protocol')return envelope({protocol_read_contract_version:1,outcome:'OK',mode:'TARGET',minimum_client_protocol:1,authority_epoch:'a'.repeat(64)});
 if(name==='get_app_runtime_context'){await new Promise(r=>setTimeout(r,delay));return envelope({bootstrap_contract_version:1,outcome:'OK',caller:{person_id:data.N,legacy_person:'N'},selected_group:{group_id:data.G},protocol:{client_protocol:1,supported_protocol:1,minimum_client_protocol:1,snapshot_contract_version:1},runtime:{mode:'target',activation_allowed:true}});}
 if(name==='get_person_group_snapshot')return envelope(data.raw);throw Error('Unexpected writer RPC '+name);},
 from(table){const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return q;},maybeSingle:async()=>({data:{user_id:data.N,person:'N'},error:null}),then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject);}};return q;},
 channel(){const c={on(){return c;},subscribe(){return c;},presenceState:()=>({}),track:async()=>{},untrack:async()=>{}};return c;},removeChannel:async()=>{}};
 window.fixtureRestored=localStorage.getItem('ui-fixture-session')!==null;
 if(!window.fixtureRestored)localStorage.setItem('ui-fixture-session',JSON.stringify(session));
 sb=client;authIdentity=null;currentUser=null;authListener=null;
 localStorage.setItem(AUTH_STORAGE_KEY,JSON.stringify(session));
 checkLoginState();
}
const config="const CONFIG={SUPABASE_URL:'',SUPABASE_ANON_KEY:'',TMDB_API_KEY:'',OMDB_API_KEY:'',PEOPLE:{N:{label:'N',badgeClass:'badge-n'},V:{label:'V',badgeClass:'badge-v'}},AUTH_EMAILS:{N:'n@example.test',V:'v@example.test'}};";
const source=f=>fs.readFileSync(path.join(root,f));
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost'),file=u.pathname==='/'?'index.html':u.pathname.slice(1);res.setHeader('Cache-Control','no-store');let body;
 try{if(file==='index.html')body=source(file).toString().replace(/<script src="https:[^"]*"><\/script>/g,'').replace(/<link[^>]*https:[^>]*>/g,'').replace('<head>','<head><script src="/fixture-prelude.js"></script><script src="/fixture-tailwind.js"></script>').replace('</body>',`<script src="/fixture-start.js?delay=${u.searchParams.get('delay')||0}"></script></body>`);
 else if(file==='fixture-prelude.js')body=`window.tailwind={config:{}};const OD=Date;window.Date=class extends OD{constructor(...a){super(...(a.length?a:[${JSON.stringify(data.at)}]));}static now(){return new OD(${JSON.stringify(data.at)}).getTime();}};if(navigator.serviceWorker)navigator.serviceWorker.register=async()=>({addEventListener(){}});`;
 else if(file==='fixture-tailwind.js')body=fs.readFileSync(arg('tailwind'));
 else if(file==='fixture-start.js')body=`window.addEventListener('load',()=>(${installFixture.toString()})(${JSON.stringify(data)},${Number(u.searchParams.get('delay'))}));`;
 else if(file==='js/config.js')body=config;
 else if(/^(js\/[a-z0-9_/-]+\.js|css\/style\.css|manifest\.json|icons\/[a-z0-9-]+\.png)$/.test(file))body=source(file);
 else{res.writeHead(404).end();return;}
 res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(body);
 }catch(e){res.writeHead(500).end(e.message);}});
(async()=>{let browser,checks=0;const results=[];const check=(ok,label)=>{assert(ok,label);checks++;results.push(label);};
 try{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(arg('executable')?{executablePath:arg('executable')}:{})});
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}])for(const delay of [0,450]){
  const context=await browser.newContext({viewport,serviceWorkers:'block'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const ready=async()=>{await page.waitForFunction(()=>ProductionSession.getState().phase==='READY'&&ProductionSession.getState().view.kind==='AVAILABLE'&&ProductionSession.getState().runtime.source==='ONLINE');await page.waitForTimeout(250);};
  const inspect=()=>page.evaluate(()=>{const visible=id=>{const el=document.getElementById(id);return !!el&&getComputedStyle(el).display!=='none'&&!!el.getClientRects().length;};return {route:TargetShell.getDestination?.() || (dashboardView==='home'?'home':currentTab==='match'?'match':'groupList'),active:[...document.querySelectorAll('#destinationNav [aria-current="page"]')].map(e=>e.dataset.destination),navs:document.querySelectorAll('#movieGrid nav').length,topNav:visible('destinationNav'),loader:visible('initialLoadingBanner'),pending:initialLoadingPending,busy:document.getElementById('librarySection').getAttribute('aria-busy'),home:visible('sceltaCta'),library:visible('librarySection'),wheel:visible('dashboardSidebar'),title:document.getElementById('libraryPageTitle').textContent,personal:visible('targetPersonalCollections'),group:visible('libraryViewSelect')||visible('segControl'),technical:/Verificato online|Osserva N|Osserva V|Mia Lista \d/.test(document.getElementById('movieGrid').textContent),cards:document.querySelectorAll('#movieGrid article').length,overflow:document.documentElement.scrollWidth>innerWidth};});
  await page.goto(origin+'/?delay='+delay);await ready();let s=await inspect();
  check(s.route==='home'&&s.home&&!s.library,'Home panel only '+viewport.width+'/'+delay);
  check(!s.loader&&!s.pending&&s.busy==='false','startup loader dismissed, including timer race '+viewport.width+'/'+delay);
  for(let cycle=0;cycle<2;cycle++)for(const [route,top,title] of [['groupList','library','Libreria'],['personalList','','Lista personale'],['personalSeen','','Visti personali'],['memories','memories','Ricordi'],['match','match',''],['wheel','wheel',''],['home','home','']]){
   if(route==='groupList'){if((await inspect()).route==='home')await page.locator('#sceltaCta [onclick="setTab(\'watchlist\')"]').click();else await page.locator('#destinationNav [data-destination="library"]').click();}
   else if(route==='personalList'){await page.evaluate(()=>activateDestination('history'));await page.locator('#targetPersonalList').click();}
   else if(route==='personalSeen')await page.locator('#targetPersonalSeen').click();
   else await page.locator('#destinationNav [data-destination="'+top+'"]').click();
   s=await inspect();const label=viewport.width+'/'+delay+'/'+cycle+'/'+route;
   check(s.route===route&&s.active.join()===top,'route and navbar selection '+label);
   check(s.topNav===(viewport.width>=768||route!=='home')&&s.navs===0&&!s.technical,'single app navigation and no technical surface '+label);
   check(!s.loader&&!s.pending&&!s.overflow,'no loader or horizontal overflow '+label);
   if(title)check(s.title===title&&s.library,'matching collection title/container '+label);
   check(s.personal===['personalList','personalSeen'].includes(route),'contextual personal controls '+label);
   if(cycle===0&&delay===450)await page.screenshot({path:path.join(out,route+'-'+viewport.width+'.png'),fullPage:true});
   if(route==='home')check(s.home&&!s.library&&!s.wheel,'home exclusive '+label);
   if(route==='wheel')check(s.wheel&&!s.library&&!s.home,'existing wheel panel exclusive '+label);
  }
  await page.evaluate(()=>activateDestination('history'));
  await page.locator('#historySwitchV').click();
  check(await page.evaluate(()=>ProductionSession.getState().view.context.observedPerson.legacyLabel==='V'&&currentTab==='history_v'&&currentUser==='N'),'observed V scope preserves caller authority '+viewport.width+'/'+delay);
  await page.locator('#targetPersonalList').click();
  check(await page.locator('#targetPersonalList').getAttribute('aria-pressed')==='true','personal collection selection '+viewport.width+'/'+delay);
  await page.locator('#historySwitchN').click();
  await page.evaluate(()=>activateDestination('library'));
  check(!(await page.locator('#tabAll').isVisible())&&await page.locator('#movieGrid [data-movie-id]').count()<=24,'no TARGET Tutti collection and bounded cards '+viewport.width+'/'+delay);
  check(await page.locator('#movieGrid button').filter({hasText:'Veto'}).count()===0,'management stays out of primary card '+viewport.width+'/'+delay);
  await page.locator('#movieSearchInput').fill('no synthetic title matches');
  check(await page.locator('#movieGrid article').count()===0,'existing search filters TARGET locally '+viewport.width+'/'+delay);
  await page.locator('#movieSearchInput').fill('');
  check(await page.locator('#movieGrid article').count()>0,'existing search clears without losing collection '+viewport.width+'/'+delay);
  await page.screenshot({path:path.join(out,'library-'+viewport.width+'-'+delay+'.png'),fullPage:true});
  await page.evaluate(()=>activateDestination('home'));await page.reload();await ready();s=await inspect();
  check(s.home&&!s.library&&!s.loader,'reload returns coherent Home '+viewport.width+'/'+delay);
  check(await page.evaluate(()=>fixtureRestored&&fixtureAuthChecks>=2&&currentUser==='N'&&isAppAuthorized()),'real Auth restore path verifies saved synthetic session '+viewport.width+'/'+delay);
  check(await page.evaluate(()=>fixtureCalls.every(n=>['read_app_protocol','get_app_runtime_context','get_person_group_snapshot'].includes(n))),'no writer RPC during UI smoke '+viewport.width+'/'+delay);
  check(errors.length===0,'zero console/page errors '+viewport.width+'/'+delay+': '+errors.join(';'));
  await context.close();
 }
 const report={checks,results,liveAccess:false,productionChanges:false};fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));console.log('TARGET UI HTTP '+checks+'/'+checks+' PASS');
 }finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
