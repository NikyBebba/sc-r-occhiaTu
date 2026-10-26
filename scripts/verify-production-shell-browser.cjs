#!/usr/bin/env node
'use strict';
// VM classic-script semantics by default; --serve adds the REAL browser gate.
// Real index.html with synthetic configuration and loopback vendor scripts.
// --serve --tailwind=/path/to/tailwind.js --supabase-sdk=/path/to/sdk.js
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {fixtureData,runChecks}=require('./verify-production-shell.cjs');
const root=path.resolve(__dirname,'..');
const files=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script src="(js\/[^\"]+)"/g)].map(m=>m[1]);
const source=p=>p==='js/config.js'?`const CONFIG={SUPABASE_URL:'',SUPABASE_ANON_KEY:'',TMDB_API_KEY:'',OMDB_API_KEY:'',PEOPLE:{N:{label:'Nicholas',badgeClass:''},V:{label:'Valeria',badgeClass:''}},AUTH_EMAILS:{N:'n@example.test',V:'v@example.test'}};`:fs.readFileSync(path.join(root,p),'utf8');
const forbidden=['fetch','XMLHttpRequest','WebSocket','localStorage','sessionStorage','setTimeout','setInterval','requestAnimationFrame','supabase'];
const checks=`'use strict'; (async()=>{
 if(!Object.isFrozen(ProductionHost)||!Object.isFrozen(TargetShell))throw Error('Namespace invalid');
 const result=await (${runChecks.toString()})({Core:SnapshotCore,Cache:SnapshotCache,Engine:RecommendationEngine,Shell:TargetShell,originalSession:ProductionSession,createCoordinator:ProductionSession.createCoordinator,productionDependencies:ProductionSession.productionDependencies,install: app=>{ProductionSession=app;TargetShell.dispose();},html:()=>document.getElementById('movieGrid').innerHTML},${JSON.stringify(fixtureData())});
 return {...result,moduleIO:HarnessIO.accesses()};
})()`;
function automated(){
 const cp=require('node:child_process');const r=cp.spawnSync(process.execPath,[path.join(__dirname,'verify-production-shell.cjs')],{encoding:'utf8'});assert.equal(r.status,0,r.stderr+r.stdout);console.log(r.stdout.trim().split('\n').at(-1));
 for(const f of files)assert(fs.existsSync(path.join(root,f)),f);assert.equal(new Set(files).size,files.length);
 const entry=source('js/production-session.js');assert(entry.includes('Protocol.create(') && entry.includes("rpc('read_app_protocol'"));assert(!/location\.search|URLSearchParams|localStorage\.getItem\([^)]*mode/.test(entry));
 assert(files.indexOf('js/recommendation/adapters.js')<files.indexOf('js/snapshot/projection.js'));
 return Promise.resolve();
}
function serve(){
 const http=require('node:http');let report=null;
 const vendor=flag=>{const arg=process.argv.find(a=>a.startsWith(flag+'='));if(!arg)throw Error('Required '+flag+'=/path/to/public/vendor.js');return fs.readFileSync(path.resolve(arg.slice(flag.length+1)),'utf8');};
 const tailwind=vendor('--tailwind'),sdk=vendor('--supabase-sdk');
 const prelude=`'use strict';
 // Native focus/online delivery is controlled while deterministic fixtures run.
 // Auth refresh itself is exercised through the actual production function.
 document.addEventListener('visibilitychange',e=>e.stopImmediatePropagation(),true);
 window.addEventListener('online',e=>e.stopImmediatePropagation(),true);
 const HarnessIO=(()=>{let n=0;const saved=new Map();const send=globalThis.fetch.bind(globalThis);return Object.freeze({send,accesses:()=>n,arm(){for(const k of ${JSON.stringify(forbidden)}){const d=Object.getOwnPropertyDescriptor(globalThis,k);if(d&&!d.configurable)continue;saved.set(k,d);Object.defineProperty(globalThis,k,{configurable:true,get(){n++;throw Error('Module I/O '+k);}});}},restore(){for(const [k,d]of saved){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}}});})();`;

 const original=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const page=original.replace('https://cdn.tailwindcss.com','/vendor/tailwind.js').replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2','/vendor/supabase.js').replace(/<script src="https:[^\"]*"><\/script>/g,'').replace(/<link[^>]*https:[^>]*>/g,'').replace('<head>','<head><script src="/prelude.js"></script>').replace('</body>','<pre id="result"></pre><script src="/checks.js"></script></body>');
 const browserChecks="window.addEventListener('load',()=>{"+checks+`.then(r=>({...r,ok:true,userAgent:navigator.userAgent})).catch(e=>({ok:false,error:e.message,userAgent:navigator.userAgent})).then(async r=>{document.getElementById('result').textContent=JSON.stringify(r,null,2);await HarnessIO.send('/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(r)});});});`;
 const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; worker-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'");
  const reply=(type,body,status=200)=>{res.writeHead(status,{'Content-Type':type+'; charset=utf-8'});res.end(body);};
  if(req.method==='POST'&&req.url==='/result'){
   let body='';req.on('data',c=>{body+=c;if(body.length>8192)req.destroy();});req.on('end',()=>{
    try{report=JSON.parse(body);console.log('REAL BROWSER RESULT '+JSON.stringify(report));reply('text/plain','Recorded');}catch(_){reply('text/plain','Invalid',400);}
   });return;
  }
  if(req.method!=='GET'){reply('text/plain','Method not allowed',405);return;}
  if(req.url==='/')reply('text/html',page);
  else if(req.url==='/prelude.js')reply('text/javascript',prelude);
  else if(req.url==='/vendor/tailwind.js')reply('text/javascript',tailwind);
  else if(req.url==='/vendor/supabase.js')reply('text/javascript',sdk);
  else if(req.url==='/arm.js')reply('text/javascript','HarnessIO.arm();');
  else if(req.url==='/restore.js')reply('text/javascript','HarnessIO.restore();');
  else if(req.url==='/checks.js')reply('text/javascript',browserChecks);
  else if(files.some(f=>req.url==='/'+f)){const f=req.url.slice(1),guard=/^js\/(snapshot|runtime)\//.test(f)||['js/production-session.js','js/ui/target-shell.js'].includes(f);reply('text/javascript',guard?"'use strict';HarnessIO.arm();\n"+source(f)+'\nHarnessIO.restore();':source(f));}
  else if(['/service-worker.js','/css/style.css','/manifest.json'].includes(req.url))reply(req.url.endsWith('.js')?'text/javascript':req.url.endsWith('.css')?'text/css':'application/json',fs.readFileSync(path.join(root,req.url.slice(1)),'utf8'));
  else if(/^\/icons\/[a-z0-9-]+\.png$/.test(req.url)){res.writeHead(200,{'Content-Type':'image/png'});res.end(fs.readFileSync(path.join(root,req.url.slice(1))));}
  else reply('text/plain','Not found',404);
 });
 server.listen(0,'127.0.0.1',()=>console.log('REAL BROWSER GATE http://127.0.0.1:'+server.address().port+'/'));
 process.once('SIGINT',()=>server.close(()=>console.log(report?.ok?'Real browser gate recorded PASS':'Real browser gate NOT PASSED')));
}
if(require.main===module)automated().then(()=>{if(process.argv.includes('--serve'))serve();}).catch(e=>{console.error(e.stack);process.exitCode=1;});
