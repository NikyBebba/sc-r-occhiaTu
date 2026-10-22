#!/usr/bin/env node
'use strict';
// Real worker lifecycle in a disposable browser profile and loopback origin.
// Both release shells come from Git/worktree; all runtime credentials are replaced.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),cp=require('node:child_process'),assert=require('node:assert/strict');
const {chromium}=require(process.argv.find(x=>x.startsWith('--playwright='))?.slice(13)||'playwright');
const root=path.resolve(__dirname,'..'),baseline='0f6ba4fc50777edfa975d51282d27fbed667a679';
let version='old',failAsset=false,failedRequests=0,checks=0;
const config=`const CONFIG={SUPABASE_URL:'',SUPABASE_ANON_KEY:'',TMDB_API_KEY:'',OMDB_API_KEY:'',PEOPLE:{N:{label:'Nicholas',badgeClass:''},V:{label:'Valeria',badgeClass:''}},AUTH_EMAILS:{N:'n@example.test',V:'v@example.test'}};`;
const raw=(file,which=version)=>which==='old'?cp.execFileSync('git',['show',baseline+':'+file]):fs.readFileSync(path.join(root,file));
const html=()=>raw('index.html').toString().replace(/<script src="https:[^"]*"><\/script>/g,'').replace(/<link[^>]*https:[^>]*>/g,'').replace('<head>','<head><script>window.tailwind={config:{}};</script>');
const server=http.createServer((req,res)=>{
 let file=req.url==='/'?'index.html':req.url.slice(1);
 if(!/^(index\.html|service-worker\.js|manifest\.json|js\/[a-z0-9_/-]+\.js|css\/style\.css|icons\/[a-z0-9-]+\.png)$/.test(file)){res.writeHead(404).end();return;}
 res.setHeader('Cache-Control','no-store');
 if(failAsset&&file==='js/runtime/production-host.js'){failedRequests++;res.writeHead(503).end();return;}
 try{const body=file==='index.html'?html():file==='js/config.js'?config:raw(file);res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'application/json');res.end(body);}catch(_){res.writeHead(404).end();}
});
const check=(value,name)=>{assert(value,name);checks++;console.log('PASS '+name);};
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({serviceWorkers:'allow'}),page=await context.newPage();
  await page.goto(origin);await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  check(await page.evaluate(async()=>(await caches.keys()).includes('scorochiatu-shell-v62')),'old shell controlled');
  check(await page.evaluate(()=>typeof ProductionHost==='undefined'),'old shell has no target modules');
  version='new';await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});
  await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting);
  check(true,'new worker waits for old clients');
  check(await page.evaluate(()=>typeof ProductionHost==='undefined'),'waiting worker does not mix target scripts into old document');
  const second=await context.newPage();await second.goto(origin);
  check(await second.evaluate(()=>typeof ProductionHost==='undefined'),'second tab stays on complete old shell');
  await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.evaluate(()=>{setTimeout(()=>applySwUpdate(),0);})]);
  check(await page.evaluate(()=>typeof ProductionHost==='undefined'),'update/reload remains coherent while old clients exist');
  await context.setOffline(true);await second.reload();
  check(await second.evaluate(()=>typeof render==='function'&&typeof ProductionHost==='undefined'),'old offline shell stays coherent');
  await context.setOffline(false);await page.close();await second.close();
  const worker=context.serviceWorkers().at(-1);
  await worker.evaluate(async()=>{for(let i=0;i<200;i++){if(!(await caches.keys()).includes('scorochiatu-shell-v62'))return;await new Promise(r=>setTimeout(r,25));}throw Error('Waiting worker did not activate');});
  const fresh=await context.newPage();const errors=[];fresh.on('pageerror',e=>errors.push(e.message));await fresh.goto(origin);await fresh.waitForFunction(()=>typeof ProductionHost!=='undefined');
  check(await fresh.evaluate(()=>!ProductionSession.isTarget()),'new production entry remains LEGACY only');
  check(await fresh.evaluate(async()=>(await caches.keys()).includes('scorochiatu-shell-v63')&&!(await caches.keys()).includes('scorochiatu-shell-v62')),'controlled update retires old cache');
  check(await fresh.evaluate(()=>['SnapshotCore','SnapshotProjection','ProductionHost','TargetShell'].every(name=>{try{return !!(0,eval)(name);}catch(_){return false;}})),'complete new module graph loads');
  await context.setOffline(true);await fresh.reload();
  check(await fresh.evaluate(()=>Object.isFrozen(ProductionHost)&&Object.isFrozen(TargetIntegrationHost)&&!ProductionSession.isTarget()),'all target dependencies available in new offline shell');
  check(errors.length===0,'new online/offline shell has zero JavaScript errors');
  await context.close();
  version='new';const clean=await browser.newContext({serviceWorkers:'allow'});const install=await clean.newPage();await install.goto(origin);await install.evaluate(()=>navigator.serviceWorker.ready);await install.waitForFunction(()=>!!navigator.serviceWorker.controller);
  check(await install.evaluate(async()=>{const cache=await caches.open('scorochiatu-shell-v63');return !!(await cache.match('/js/runtime/production-host.js'))&&!!(await cache.match('/js/ui/target-shell.js'));}),'clean install precaches complete target shell');
  await clean.close();
  version='old';const failure=await browser.newContext({serviceWorkers:'allow'}),old=await failure.newPage();await old.goto(origin);await old.evaluate(()=>navigator.serviceWorker.ready);await old.waitForFunction(()=>!!navigator.serviceWorker.controller);
  version='new';failAsset=true;await old.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});
  for(let i=0;i<100&&!failedRequests;i++)await new Promise(r=>setTimeout(r,50));check(failedRequests>0,'failed target asset exercised');
  await old.waitForFunction(async()=>{const r=await navigator.serviceWorker.getRegistration();return !r.installing&&!r.waiting&&!(await caches.keys()).includes('scorochiatu-shell-v63');});
  check(await old.evaluate(async()=>!(await caches.keys()).includes('scorochiatu-shell-v63')),'failed precache removes partial new cache');
  await old.reload();check(await old.evaluate(()=>typeof ProductionHost==='undefined'&&typeof render==='function'),'failed update preserves complete old shell');
  await failure.close();console.log('PWA production-shell: '+checks+'/'+checks+' PASS; real worker/multiple-tabs/offline/update; no live Supabase.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.stack);server.close();process.exitCode=1;});
