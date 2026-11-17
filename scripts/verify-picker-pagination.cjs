#!/usr/bin/env node
'use strict';
// PB-003: public-metadata fetch fixtures + real TARGET picker over loopback.
// No production configuration, real Auth, API requests or writer RPCs.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),http=require('node:http'),assert=require('node:assert/strict');
const arg=n=>process.argv.find(a=>a.startsWith('--'+n+'='))?.slice(n.length+3),root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');let checks=0;
function check(ok,label){assert(ok,label);checks++;}
const row=id=>({id,title:'Omonimo molto lungo '+id+' '.repeat(2)+'titolo cinematografico di prova',release_date:'2001-01-01',poster_path:null});
async function helperChecks(){
 let reply={page:1,total_pages:2,total_results:40,results:Array.from({length:20},(_,i)=>row(i+1))},ok=true,mode='',requested,timeout;
 const ctx=vm.createContext({CONFIG:{TMDB_API_KEY:'synthetic'},AbortController,console:{error(){}},
  setTimeout:fn=>{timeout=fn;return 1;},clearTimeout(){},fetch:async(url,options)=>{requested={url,options};
   if(mode==='stall')return new Promise(()=>{});if(mode==='transport')throw Error('secret-request-url');if(options?.signal.aborted)throw Error('aborted');return {ok,json:async()=>reply};}});
 vm.runInContext(read('js/api/tmdb.js'),ctx);
 const call=options=>ctx.searchTmdbCandidatePage('query',{...options});
 let result=await call();check(result.items.length===20&&result.totalPages===2,'new helper has no five-item cut');
 check(new URL(requested.url).searchParams.get('page')==='1'&&new URL(requested.url).searchParams.get('language')==='it-IT','page and Italian metadata');
 check(Array.isArray(await ctx.searchTmdbCandidates('query'))&&(await ctx.searchTmdbCandidates('query')).length===5,'legacy array capped at five');
 reply={...reply,page:2};result=await call({page:2});check(result.page===2,'explicit API page');
 for(const bad of [{...reply,page:1},{...reply,results:null},{...reply,total_pages:-1},{...reply,results:[{id:0,title:'invalid'}]},{...reply,results:[{id:true,title:'invalid'}]}]){reply=bad;await assert.rejects(call({page:2}));checks++;}
 reply={page:1,total_pages:0,total_results:0,results:[]};result=await call();check(result.items.length===0&&result.totalPages===0,'empty is successful metadata');
 ok=false;await assert.rejects(call());checks++;check((await ctx.searchTmdbCandidates('q')).length===0,'legacy non-strict failure preserved');await assert.rejects(ctx.searchTmdbCandidates('q',{strict:true}));checks++;
 ok=true;mode='transport';await assert.rejects(call(),e=>e.message==='TMDB_SEARCH_FAILED');checks++;
 mode='stall';const held=call();timeout();await assert.rejects(held,e=>e.message==='TMDB_SEARCH_TIMEOUT');checks++;
 mode='';const abort=new AbortController();abort.abort();await assert.rejects(call({signal:abort.signal}),e=>e.message==='TMDB_SEARCH_ABORTED');checks++;
 await assert.rejects(call({page:501}));checks++;
 console.log('PASS helper/legacy '+checks+' checks');
}
async function browserChecks(){
 const {chromium}=require(arg('playwright')||'playwright');
 const data=require('./verify-production-shell.cjs').fixtureData(),F=require('./fixtures/snapshot-v1.cjs');
 data.raw=F.relationless();data.raw.contract_version=2;data.raw.catalog[0].title='Locale Omonimo';data.raw.catalog[0].tmdb_id='1';F.finish(data.raw);
 const bootSource=read('scripts/verify-target-ui-http.cjs'),boot=bootSource.slice(bootSource.indexOf('function installFixture('),bootSource.indexOf('\nconst config='));
 const server=http.createServer((req,res)=>{const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';let body;
  try{if(file==='index.html')body=read(file).replace(/<script src="https:[^"]*"><\/script>/g,'').replace(/<link[^>]*https:[^>]*>/g,'').replace('<head>','<head><script>window.tailwind={config:{}};const OD=Date;window.Date=class extends OD{constructor(...a){super(...(a.length?a:["2027-01-04T12:00:00Z"]));}static now(){return new OD("2027-01-04T12:00:00Z").getTime();}};if(navigator.serviceWorker)navigator.serviceWorker.register=async()=>({addEventListener(){}});</script><script src="/fixture-tailwind.js"></script>').replace('</body>','<script src="/fixture-start.js"></script></body>');
   else if(file==='fixture-tailwind.js')body=fs.readFileSync(arg('tailwind'));
   else if(file==='fixture-start.js')body=boot+`\nwindow.addEventListener('load',()=>installFixture(${JSON.stringify(data)},0));`;
   else if(file==='js/config.js')body="const CONFIG={SUPABASE_URL:'',SUPABASE_ANON_KEY:'',TMDB_API_KEY:'synthetic',OMDB_API_KEY:'',PEOPLE:{N:{label:'N'},V:{label:'V'}},AUTH_EMAILS:{N:'n@example.test',V:'v@example.test'}};";
   else if(/^(js\/[a-z0-9_/-]+\.js|css\/style\.css|manifest\.json|icons\/[a-z0-9-]+\.png)$/.test(file))body=fs.readFileSync(path.join(root,file));else{res.writeHead(404).end();return;}
   res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(body);
  }catch(_){res.writeHead(500).end();}});
 let browser;const out=arg('out')||'/tmp/pb003-browser';fs.mkdirSync(out,{recursive:true});
 try{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(arg('executable')?{executablePath:arg('executable')}:{})});
  for(const width of [320,390,639,640,1280]){
   const context=await browser.newContext({viewport:{width,height:width===320?568:844},serviceWorkers:'block',hasTouch:width<640});
   let requests=[],failPage2=false,releaseSlow;const errors=[];
   await context.route('**/*',async route=>{const url=route.request().url();if(url.startsWith(origin))return route.continue();
    if(url.includes('api.themoviedb.org/3/search/movie')){const u=new URL(url),page=Number(u.searchParams.get('page')),query=u.searchParams.get('query');requests.push({page,query});
     if(query==='Slow')await new Promise(r=>{releaseSlow=r;});
     if((query==='Error'&&page===1)||(page===2&&failPage2)){failPage2=false;return route.fulfill({status:503,body:'{}'});}
     const ids=query==='Empty'?[]:query==='Duplicates'&&page===2?Array.from({length:20},(_,i)=>i+1):Array.from({length:20},(_,i)=>(page-1)*20+i+1);
     return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({page,total_pages:query==='Empty'?0:3,total_results:query==='Empty'?0:60,results:ids.map(row)})});}
    return route.abort();});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
   await page.waitForFunction(()=>ProductionSession.getState().phase==='READY',null,{timeout:8000}).catch(async e=>{throw Error(JSON.stringify(await page.evaluate(()=>({state:ProductionSession.getState().phase,calls:window.fixtureCalls,gate:document.getElementById('protocolGate')?.textContent})))+' '+errors.join(',')+' '+e.message);});
   const cards=()=>page.locator('#pickerResults > button');
   const search=async title=>{await page.evaluate(()=>openAddModal());await page.locator('#addTitle').fill(title);await page.locator('#addSaveBtn').click();};
   const settled=()=>page.waitForFunction(()=>document.getElementById('pickerResults').getAttribute('aria-busy')!=='true');
   const forward=async()=>{await page.locator('#targetPickerNext').click();await settled();};
   const back=async()=>{await page.locator('#targetPickerPrevious').click();await settled();};
   await search('Normal');await cards().first().waitFor();const size=width<640?4:6;
   check(await cards().count()===size,'responsive cap '+width);
   const rects=await cards().evaluateAll(es=>es.map(e=>e.getBoundingClientRect().x));check(new Set(rects).size===(width<640?2:3),'existing columns '+width);
   check(await page.locator('#targetPickerPrevious').isDisabled(),'first disabled '+width);
   check(await page.locator('#targetPickerNext').getAttribute('aria-label')==='Risultati successivi','accessible next '+width);
   const touchRect=await page.locator('#targetPickerNext').boundingBox();check(touchRect.width>=44&&touchRect.height>=44,'44px controls '+width);
   await cards().first().click();await page.locator('#targetPickerDestination').selectOption('personalList');
   check((await page.locator('#targetPickerSelectedTitle').textContent()).includes('Locale Omonimo'),'remote identity retains local film '+width);
   check((await cards().first().textContent()).includes('Già nel catalogo'),'local status retained '+width);
   await page.locator('#targetPickerMessage').evaluate(el=>el.textContent='Feedback da preservare');
   const selectedTitle=await page.locator('#targetPickerSelectedTitle').textContent(),counts=[size];
   const before=await cards().allTextContents();
   // Save a group scroll position, then navigate using real keyboard controls.
   const scroll=await page.locator('#pickerResults').evaluate(el=>{el.parentElement.scrollTop=120;return el.parentElement.scrollTop;});
   await page.locator('#targetPickerNext').evaluate(el=>el.focus({preventScroll:true}));await page.keyboard.press('Enter');await settled();counts.push(await cards().count());
   check(requests.length===1,'cached forward no fetch '+width);
   check(await page.evaluate(()=>document.activeElement.id)==='targetPickerNext','keyboard focus retained '+width);
   check(await page.locator('#targetPickerSelectedTitle').textContent()===selectedTitle&&await page.locator('#targetPickerDestination').inputValue()==='personalList'&&await page.locator('#targetPickerMessage').textContent()==='Feedback da preservare','selection/confirmation survives off-page '+width);
   await back();check(JSON.stringify(await cards().allTextContents())===JSON.stringify(before),'visited group stable '+width);
   check(Math.abs(await page.locator('#pickerResults').evaluate(el=>el.parentElement.scrollTop)-scroll)<2,'visited scroll restored '+width+' expected '+scroll+' actual '+await page.locator('#pickerResults').evaluate(el=>el.parentElement.scrollTop));
   await page.locator('#targetPickerNext').evaluate(el=>el.focus({preventScroll:true}));await page.keyboard.press('Space');await settled();
   while(counts.reduce((a,b)=>a+b,0)<20){await forward();counts.push(await cards().count());}
   check(JSON.stringify(counts)===JSON.stringify(width<640?[4,4,4,4,4]:[6,6,6,2]),'20 results in distinct visual groups '+width);
   check(requests.length===1,'partial group does not fetch to fill '+width);
   const partial=await cards().allTextContents();failPage2=true;
   await forward();check((await page.locator('#targetPickerPageStatus').textContent()).includes('Ricerca non disponibile'),'page error visible '+width);
   check(JSON.stringify(await cards().allTextContents())===JSON.stringify(partial),'error keeps visible group '+width);
   check(!await page.locator('#targetPickerCommit').isDisabled(),'confirm restored after error '+width);
   await page.locator('#targetPickerRetry').click();await settled();
   check(requests.at(-1).page===2&&requests.at(-2).page===2,'retry same API page '+width);
   check((await cards().first().textContent()).includes('21'),'retry advances without skipping '+width);
   await back();check(JSON.stringify(await cards().allTextContents())===JSON.stringify(partial),'partial never refilled '+width);
   const cacheRequests=requests.length;await forward();await back();check(requests.length===cacheRequests,'cached back/forward no fetch '+width);
   check(await page.locator('#targetPickerSelectedTitle').textContent()===selectedTitle,'retry preserves selection '+width);
   check(await page.locator('#targetPickerPageStatus').getAttribute('aria-live')==='polite','announced navigation '+width);
   if(width===390){await page.locator('#targetPickerNext').tap();await settled();await page.locator('#targetPickerPrevious').tap();await settled();check(requests.length===cacheRequests,'touch navigation uses cache');}
   await page.locator('#targetPickerNext').evaluate(el=>el.focus({preventScroll:true}));await page.keyboard.press('Tab');
   check(await page.evaluate(()=>document.getElementById('pickerModal').contains(document.activeElement)&&document.activeElement!==document.body),'Tab keeps valid picker focus '+width);
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no document overflow '+width);
   check(await page.locator('#pickerResults').evaluate(el=>el.parentElement.scrollWidth<=el.parentElement.clientWidth+1),'no modal overflow with confirmation '+width);
   check(await page.evaluate(()=>fixtureCalls.every(n=>['read_app_protocol','get_app_runtime_context','get_person_group_snapshot'].includes(n))),'zero preliminary commands '+width);
   await page.screenshot({path:path.join(out,'picker-'+width+'.png')});
   if(width===639){
    const anchor=await cards().first().textContent();const n=requests.length;
    await page.setViewportSize({width:640,height:568});await page.waitForFunction(()=>document.querySelectorAll('#pickerResults>button').length===6);
    check((await cards().allTextContents()).includes(anchor),'breakpoint retains anchor '+width);
    check(requests.length===n&&await page.locator('#targetPickerSelectedTitle').textContent()===selectedTitle,'breakpoint preserves selection/cache '+width);
    await page.setViewportSize({width:639,height:844});await page.waitForFunction(()=>document.querySelectorAll('#pickerResults>button').length<=4);
   }
   await page.locator('#targetPickerSearchAgain').click();await page.locator('#addTitle').fill('Duplicates');await page.locator('#addSaveBtn').click();await cards().first().waitFor();
   for(let i=1;i<Math.ceil(20/size);i++)await forward();const unchanged=await cards().allTextContents();
   const n=requests.length;await forward();check(JSON.stringify(await cards().allTextContents())===JSON.stringify(unchanged),'duplicate-only page leaves group '+width);
   check(!(await page.locator('#targetPickerNext').isDisabled())&&requests.length===n+1,'duplicates not false end or auto-loop '+width);
   await forward();check(requests.at(-1).page===3,'explicit continue beyond duplicates '+width);
   while(!await page.locator('#targetPickerNext').isDisabled())await forward();
   check((await page.locator('#targetPickerPageStatus').textContent()).includes('Fine risultati'),'real end '+width);
   await page.keyboard.press('Escape');check(await page.locator('#pickerModal').isHidden(),'cancel picker '+width);
   check(await page.locator('#targetPickerPagination').isHidden(),'pager hidden after close '+width);
   await search('Empty');await page.waitForFunction(()=>document.getElementById('targetAddMessage').textContent.includes('Nessun film'));check(await page.locator('#pickerModal').isHidden(),'empty stays in search '+width);
   await page.locator('#addTitle').fill('Error');await page.locator('#addSaveBtn').click();await page.waitForFunction(()=>document.getElementById('targetAddMessage').textContent.includes('Ricerca non disponibile'));check(await page.locator('#pickerModal').isHidden(),'initial error distinct '+width);
   await page.locator('#addTitle').fill('Slow');await page.locator('#addSaveBtn').click();await page.waitForTimeout(30);
   await page.locator('#addTitle').fill('Normal');await page.locator('#addSaveBtn').click();await cards().first().waitFor();releaseSlow?.();await page.waitForTimeout(50);
   check((await cards().first().textContent()).includes('Locale Omonimo'),'obsolete first query ignored '+width);
   await page.locator('#targetPickerSearchAgain').click();await page.locator('#addTitle').fill('Slow');await page.locator('#addSaveBtn').click();await page.waitForTimeout(30);await page.keyboard.press('Escape');releaseSlow?.();await page.waitForTimeout(50);
   check(await page.locator('#pickerModal').isHidden()&&await page.locator('#addModal').isHidden(),'closed search cannot reopen picker '+width);
   // Another editor using the shared picker must not expose TARGET paging controls.
   await page.evaluate(()=>{openModal('pickerModal');});check(await page.locator('#targetPickerPagination').isHidden(),'shared modal pager remains hidden '+width);await page.keyboard.press('Escape');
   check(await page.evaluate(()=>fixtureCalls.every(n=>['read_app_protocol','get_app_runtime_context','get_person_group_snapshot'].includes(n))),'cancel/retry all read-only '+width);
   check(errors.length===0,'no page errors '+width+': '+errors.join(','));console.log('PASS browser '+width);await context.close();
  }
 }finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
(async()=>{await helperChecks();if(!process.argv.includes('--helper-only'))await browserChecks();console.log('PB-003 '+checks+' checks PASS; synthetic only');})().catch(e=>{console.error(e.stack);process.exitCode=1;});
