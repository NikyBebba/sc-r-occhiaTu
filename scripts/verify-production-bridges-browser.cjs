#!/usr/bin/env node
'use strict';
// VM classic-script semantics by default; --serve adds the REAL browser gate.
// Generated pages only, fixed loopback resources, no production HTML or SDK.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {fixtureData,runChecks}=require('./verify-production-bridges.cjs');
const root=path.resolve(__dirname,'..');
const files=['js/recommendation/config.js','js/recommendation/core.js','js/recommendation/adapters.js',
 'js/snapshot/core.js','js/snapshot/projection.js','js/snapshot/cache.js','js/snapshot/controller.js','js/snapshot/invalidation.js','js/snapshot/transport.js','js/runtime/target-runtime.js','js/runtime/consumer-facade.js','js/runtime/action-adapter.js','js/runtime/match-adapter.js','js/runtime/target-integration-host.js','js/runtime/consumer-view-adapter.js','js/runtime/production-host.js'];
const source=p=>fs.readFileSync(path.join(root,p),'utf8');
const forbidden=['fetch','XMLHttpRequest','WebSocket','localStorage','sessionStorage','setTimeout','setInterval','requestAnimationFrame','supabase'];
const checks=`'use strict'; (async()=>{
 if(typeof require!=='undefined'||typeof module!=='undefined')throw Error('CommonJS leaked into classic environment');
 if(!Object.isFrozen(ProductionHost)||!Object.isFrozen(ConsumerViewAdapter)||typeof ProductionHost.createProductionHost!=='function')throw Error('Namespace invalid');
 const result=await (${runChecks.toString()})({Production:ProductionHost,Views:ConsumerViewAdapter,Core:SnapshotCore,Cache:SnapshotCache,Engine:RecommendationEngine},${JSON.stringify(fixtureData())});
 if(HarnessIO.accesses()!==0)throw Error('Module I/O');
 if(Reflect.ownKeys(globalThis).some(k=>!HarnessIO.keys.includes(k)))throw Error('Global property leak');
 return {...result,moduleIO:HarnessIO.accesses()};
})()`;
function automated(){
 const forbiddenSources=/localStorage|sessionStorage|supabase|fetchAll|loadMovies|loadLocal|loadMatchLocal|scorochiatu_(movies|movie_nights|vetoes|swipes|swipe_sessions)|\b(document|window)\b/;
 for(const f of ['js/runtime/production-host.js','js/runtime/consumer-view-adapter.js'])assert(!forbiddenSources.test(source(f)),f+' forbidden dependency');
 const I=require('../js/runtime/production-host');assert(Object.isFrozen(I));
 assert.deepEqual(Object.keys(I),['createProductionHost']);
 assert.throws(()=>vm.runInNewContext(source('js/runtime/production-host.js'),{}),/requires TargetIntegrationHost and ConsumerViewAdapter/);
 const collision=vm.createContext({ProductionHost:Object.freeze({existing:true})});
 vm.runInContext(source('js/snapshot/core.js'),collision);
 assert.throws(()=>vm.runInContext(source('js/runtime/production-host.js'),collision),/namespace already installed/);
 assert(collision.ProductionHost.existing);
 let accesses=0;const context=vm.createContext({});
 for(const key of [...forbidden,'window','document'])Object.defineProperty(context,key,{get(){accesses++;throw Error('Module I/O '+key);}});
 context.HarnessIO=Object.freeze({accesses:()=>accesses,keys:vm.runInContext('Reflect.ownKeys(globalThis)',context).concat('HarnessIO')});
 for(const f of files)vm.runInContext(source(f),context,{filename:f});
 assert.throws(()=>vm.runInContext(source('js/runtime/production-host.js'),context),e=>e.name==='SyntaxError');
 return vm.runInContext(checks,context).then(r=>{
  assert(r.cases>=121);assert.equal(r.moduleIO,0);
  for(const f of ['index.html','js/main.js','js/store.js','js/auth.js','service-worker.js'])assert(!/ProductionHost|ConsumerViewAdapter|runtime\/(production-host|consumer-view-adapter)/.test(source(f)));
  console.log('PRODUCTION BRIDGES CLASSIC VM: '+r.cases+' integration groups; '+r.assertions+' assertions; module I/O 0. Not Safari.');
 });
}
function serve(){
 const http=require('node:http');let report=null;
 const prelude=`'use strict'; const HarnessIO=(()=>{let n=0;const send=globalThis.fetch.bind(globalThis);for(const k of ${JSON.stringify(forbidden)})Object.defineProperty(globalThis,k,{configurable:true,get(){n++;throw Error('Module I/O '+k);}});return Object.freeze({send,accesses:()=>n,keys:Reflect.ownKeys(globalThis)});})();`;
 const page='<!doctype html><meta charset="utf-8"><title>4A8-A isolated production bridges gate</title><pre id="result">Running…</pre>'+['prelude.js',...files,'checks.js'].map(f=>'<script src="/'+f+'"></script>').join('\n');
 const browserChecks=checks+`.then(r=>({...r,ok:true,userAgent:navigator.userAgent})).catch(e=>({ok:false,error:e.message,userAgent:navigator.userAgent})).then(async r=>{document.getElementById('result').textContent=JSON.stringify(r,null,2);await HarnessIO.send('/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(r)});});`;
 const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'");
  const reply=(type,body,status=200)=>{res.writeHead(status,{'Content-Type':type+'; charset=utf-8'});res.end(body);};
  if(req.method==='POST'&&req.url==='/result'){
   let body='';req.on('data',c=>{body+=c;if(body.length>8192)req.destroy();});req.on('end',()=>{
    try{report=JSON.parse(body);console.log('REAL BROWSER RESULT '+JSON.stringify(report));reply('text/plain','Recorded');}catch(_){reply('text/plain','Invalid',400);}
   });return;
  }
  if(req.method!=='GET'){reply('text/plain','Method not allowed',405);return;}
  if(req.url==='/')reply('text/html',page);
  else if(req.url==='/prelude.js')reply('text/javascript',prelude);
  else if(req.url==='/checks.js')reply('text/javascript',browserChecks);
  else if(files.some(f=>req.url==='/'+f))reply('text/javascript',source(req.url.slice(1)));
  else reply('text/plain','Not found',404);
 });
 server.listen(0,'127.0.0.1',()=>console.log('REAL BROWSER GATE http://127.0.0.1:'+server.address().port+'/'));
 process.once('SIGINT',()=>server.close(()=>console.log(report?.ok?'Real browser gate recorded PASS':'Real browser gate NOT PASSED')));
}
if(require.main===module)automated().then(()=>{if(process.argv.includes('--serve'))serve();}).catch(e=>{console.error(e.stack);process.exitCode=1;});
