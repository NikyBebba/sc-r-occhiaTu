'use strict';
// Actual classic-script app + TARGET coordinator. Every command uses the existing
// synthetic server fixture. Same HTTP page can be opened in native Safari.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),arg=n=>process.argv.find(x=>x.startsWith('--'+n+'='))?.slice(n.length+3);
const {fixtureData,runChecks}=require('./verify-production-shell.cjs'),data=fixtureData();data.raw=data.recommendationSet;data.raw.contract_version=2;
const shared=runChecks.toString(),finish=shared.slice(shared.indexOf('  function finish(w)'),shared.indexOf('  async function make('));
const command=shared.slice(shared.indexOf('    function bump('),shared.indexOf('    if (options.cached)'));
const bootSource=read('scripts/verify-target-ui-http.cjs');let boot=bootSource.slice(bootSource.indexOf('function installFixture('),bootSource.indexOf('\nconst config='));
boot=boot.replace('async rpc(name){','async rpc(name,args={}){').replace("throw Error('Unexpected writer RPC '+name)","if(name==='execute_app_command'){fixtureCommands.push(JSON.parse(JSON.stringify(args.p_request)));return envelope(fixtureCommand(args.p_request));}throw Error('Unexpected RPC '+name)");
const synthetic=`const copy=x=>JSON.parse(JSON.stringify(x)),uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');const controls={wire:data.raw},receipts=new Map();let contentSerial=95000,nightSerial=40000;${finish}${command}window.fixtureCommands=[];window.fixtureCommand=body=>{const result=commandServer(body,data.N,data.G);for(const n of data.raw.nights){n.retrospective=!!n.retrospective;n.night_memory??=null;}return result;};`;
let report=null;
function setup(data){
 const nativeFetch=window.fetch.bind(window);window.fetch=(input,options)=>{const u=new URL(typeof input==='string'||input instanceof URL?String(input):input.url,location.href);if(u.hostname.includes('themoviedb.org'))return nativeFetch('/fixture-tmdb?path='+encodeURIComponent(u.pathname)+'&page='+u.searchParams.get('page'));if(u.hostname.includes('omdbapi.com'))return nativeFetch('/fixture-omdb?i='+u.searchParams.get('i'));if(u.origin!==location.origin)return Promise.reject(Error('External I/O blocked by synthetic gate'));return nativeFetch(input,options);};
 const OD=Date;window.Date=class extends OD{constructor(...a){super(...(a.length?a:[data.at]));}static now(){return new OD(data.at).getTime();}};
 if(navigator.serviceWorker)navigator.serviceWorker.register=async()=>({addEventListener(){}});
 window.fixtureReport=async value=>{document.getElementById('v76-test-report').textContent=JSON.stringify(value);await nativeFetch('/fixture-result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});window.fixtureReported=true;};
}
async function runFlow(){
 let checks=0;const check=(v,m)=>{if(!v)throw Error(m);checks++;};const wait=async(fn,msg)=>{for(let i=0;i<160;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('Timeout '+msg);};
 try{
 await wait(()=>ProductionSession.getState().phase==='READY','bootstrap');openRecommendationView();await wait(()=>document.querySelector('#discoveryResults article'),'Discovery');
 const modes=['proposeToGroup','addToMyList','recordSeen'];
 for(const mode of modes){
  const card=document.querySelector('#discoveryResults article');check(!!card,'candidate');const external=card.dataset.externalId;card.click();await wait(()=>document.querySelector('[data-discovery-action="'+mode+'"]')&&!document.querySelector('[data-discovery-action="'+mode+'"]').disabled,'detail metadata');
  const before=fixtureCommands.length;document.querySelector('[data-discovery-action="'+mode+'"]').click();await wait(()=>document.getElementById('detailBody').dataset.movieId,'persisted transition');
  const id=document.getElementById('detailBody').dataset.movieId,view=ProductionSession.getState().view,m=view.catalog.getContent(id).content;
  check(m.tmdb_id===external.slice(5),'TMDb identity');check(m.director==='Synthetic Director'&&m.collection_name==='Synthetic saga','metadata persisted');check(m.trailer_url==='https://www.youtube.com/watch?v=abcdefghijk','trailer persisted');
  check(document.querySelector('#detailBody .external-ratings').textContent.includes('IMDb 8.2'),'ratings rendered after acquisition');
  const state=view.getCard(id);check(mode==='proposeToGroup'?state.group.candidacy.effectiveCandidacy:!state.group.candidacy.effectiveCandidacy,'independent native relation');
  const writes=fixtureCommands.slice(before);check(writes.filter(c=>c.intent==='CONTENT_CREATE').length===1,'one content acquisition');check(writes.length===2,'only acquisition and chosen relation');closeModal('detailModal');
 }
 const view=ProductionSession.getState().view,id=view.catalog.contents.find(c=>c.tmdb_id)?.movie_id;
 TargetShell.edit('completeNow',id);document.querySelectorAll('#targetParticipants input').forEach(n=>n.checked=true);document.getElementById('scheduleConfirm').click();
 await wait(()=>!document.getElementById('pastNightEditModal').classList.contains('hidden'),'confirmed post-watch');
 check(document.getElementById('pastEditTitle').textContent==='Com’è andata?','existing post-watch');document.getElementById('pastEditMemory').value='Synthetic event memory';document.getElementById('pastEditSnack').value='Popcorn';document.getElementById('pastEditLocation').value='Casa';
 const rating=document.getElementById('pastEditTogetherRating');rating.value='8,3';rating.dispatchEvent(new Event('input'));const review=document.getElementById('pastEditTogetherReview');review.value='Synthetic shared review';review.dispatchEvent(new Event('input'));document.getElementById('pastEditSave').click();
 await wait(()=>document.getElementById('pastNightEditModal').classList.contains('hidden'),'post-watch saved');const current=ProductionSession.getState().view,n=current.events.completed.find(e=>e.movieId===id)||current.events.completed[0],event=current.getEvent(n.eventId).event.event;
 check(event.night_memory==='Synthetic event memory'&&event.snack==='Popcorn'&&event.location==='Casa','event fields');check(current.getCard(id).group.judgment.judgment.rating===8.3,'Together film rating');check(fixtureCommands.filter(c=>c.intent==='COMPLETE_NOW').length===1,'no repeated completion');closeModal('nightDetailModal');
 document.getElementById('discoveryLista').click();await wait(()=>document.querySelector('#recommendationResults article'),'List');check(!document.getElementById('discoveryRefresh'),'no duplicate upper command');check(!document.getElementById('recommendationMore').classList.contains('hidden'),'bottom batch action');
 check(document.body.dataset.clientBuild==='protocol-v1-v76','build marker');await fixtureReport({ok:true,checks,commands:fixtureCommands.length,engine:navigator.userAgent});
 }catch(e){await fixtureReport({ok:false,checks,error:e.message,diagnostic:{saveError:document.getElementById('scheduleSaveError').textContent,phase:ProductionSession.getState().phase,intents:fixtureCommands.map(c=>c.intent),modal:typeof modalStackTop==='function'?modalStackTop():null},engine:navigator.userAgent});throw e;}
}
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost'),file=u.pathname.slice(1)||'index.html';res.setHeader('Cache-Control','no-store');
 const send=(body,type='text/javascript')=>{res.setHeader('Content-Type',type+'; charset=utf-8');res.end(body);};
 if(file==='fixture-result'&&req.method==='POST'){let body='';req.on('data',b=>body+=b);req.on('end',()=>{report=JSON.parse(body);console.log('INTEGRATED_RESULT '+JSON.stringify(report));send('ok','text/plain');});return;}
 if(file==='fixture-tmdb'){const id=Number(u.searchParams.get('path').split('/').pop()),page=Number(u.searchParams.get('page'))||1;const row=id=>({id,title:'Synthetic Discovery '+id,release_date:'2001-01-01',genres:[{id:18,name:'Dramma'}],genre_ids:[18],vote_count:2000,vote_average:7.5,overview:'Una restauratrice torna nella città natale e scopre il segreto custodito dalla sua famiglia.',adult:false,imdb_id:'tt'+String(id).padStart(7,'0'),runtime:110,credits:{crew:[{job:'Director',name:'Synthetic Director'}],cast:[{name:'Synthetic Actor'}]},belongs_to_collection:{id:723,name:'Synthetic saga'},videos:{results:[{site:'YouTube',type:'Trailer',key:'abcdefghijk'}]}});send(JSON.stringify(Number.isFinite(id)&&id>0?row(id):{results:Array.from({length:20},(_,i)=>row(page*100+i)),total_pages:4}),'application/json');return;}
 if(file==='fixture-omdb'){send(JSON.stringify({Response:'True',imdbID:u.searchParams.get('i'),imdbRating:'8.2',Ratings:[{Source:'Rotten Tomatoes',Value:'91%'},{Source:'Metacritic',Value:'84'}]}),'application/json');return;}
 if(file==='fixture-start.js'){send(`const data=${JSON.stringify(data)};${synthetic}${boot};window.addEventListener('load',()=>{installFixture(data,0);document.getElementById('v76-run').onclick=runFlow;${arg('autorun')==='true'?'runFlow();':''}});${runFlow.toString()}`);return;}
 if(file==='fixture-prelude.js'){send(`window.tailwind={config:{}};(${setup.toString()})(${JSON.stringify(data)});`);return;}
 if(file==='fixture-style.js'){send(fs.readFileSync(arg('tailwind')||'/tmp/sc-v74-tailwind-shim.js','utf8'));return;}
 if(file==='js/config.js'){send("const CONFIG={SUPABASE_URL:'',SUPABASE_ANON_KEY:'',TMDB_API_KEY:'synthetic',OMDB_API_KEY:'synthetic',PEOPLE:{N:{label:'N',badgeClass:''},V:{label:'V',badgeClass:''}},AUTH_EMAILS:{N:'n@example.test',V:'v@example.test'}};");return;}
 try{if(file==='index.html'){send(read(file).replace(/<script src="https:[^"]*"><\/script>/g,'').replace(/<link[^>]*https:[^>]*>/g,'').replace('<head>','<head><script src="/fixture-prelude.js"></script><script src="/fixture-style.js"></script>').replace('</body>','<button id="v76-run" style="position:fixed;top:0;left:0;z-index:99999">Run local v76 gate</button><pre id="v76-test-report"></pre><script src="/fixture-start.js"></script></body>'),'text/html');return;}
 if(!/^(js\/[a-z0-9_/-]+\.js|css\/style\.css|manifest\.json)$/.test(file)){res.writeHead(404).end();return;}send(read(file),file.endsWith('.css')?'text/css':'text/javascript');}catch(_){res.writeHead(404).end();}
});
(async()=>{await new Promise(r=>server.listen(Number(arg('port')||0),'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/';console.log('LOCAL_INTEGRATED_GATE '+url);if(process.argv.includes('--serve'))return;
 const engine=arg('engine')||'chromium',pw=require(arg('playwright')||'playwright'),browser=await pw[engine].launch({headless:true,...(arg('executable')?{executablePath:arg('executable')}:{})});
 try{const page=await browser.newPage();await page.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());await page.goto(url);await page.locator('#v76-run').click();await page.waitForFunction(()=>window.fixtureReported===true,{timeout:30000});assert(report?.ok,JSON.stringify(report));console.log('V76 integrated '+engine+' PASS');}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.stack);server.close();process.exitCode=1;});
