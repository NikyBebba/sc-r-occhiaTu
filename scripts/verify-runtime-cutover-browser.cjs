#!/usr/bin/env node
'use strict';
// Default: automated classic-script VM semantics, not a real browser claim.
// --serve: loopback-only manual browser gate; generated HTML, no production entry changes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const F = require('./fixtures/snapshot-v1.cjs');
const root = path.resolve(__dirname, '..');
const files = ['js/recommendation/config.js', 'js/recommendation/core.js', 'js/recommendation/adapters.js',
  'js/snapshot/core.js', 'js/snapshot/projection.js', 'js/snapshot/cache.js', 'js/snapshot/controller.js'];
const names = ['SnapshotProjection', 'SnapshotCache', 'SnapshotController'];
const source = f => fs.readFileSync(path.join(root, f), 'utf8');
const fixtures = { context: F.context(), raw: F.relationless(), cached: F.selfList(), at: F.AT, nextGroup: F.uid(3900) };
const forbidden = ['fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'setTimeout', 'setInterval',
  'requestAnimationFrame', 'supabase', 'Realtime', 'window', 'document'];
function sandbox() {
  let accesses = 0;
  const context = vm.createContext({});
  for (const key of forbidden) Object.defineProperty(context, key, { configurable: false, get() { accesses++; throw Error('Unexpected module I/O: ' + key); } });
  return { context, accesses: () => accesses };
}
const load = (context, f) => vm.runInContext(source(f), context, { filename: f });
function full() { const s = sandbox(); for (const f of files) load(s.context, f); return s; }
function probeSucceeded(errors, spec) {
  // Native redeclaration messages differ between Safari, Chromium and Node.
  return errors.some(error => spec.namespace && !spec.collision ? error.name === 'SyntaxError' : error.message.includes(spec.error));
}

// One shared test implementation executes in VM and in the optional real browser.
// It has no Node dependencies, no transport, no real timers/storage and no runtime imports.
async function classicChecks(data) {
  'use strict';
  let count = 0;
  const check = (condition, name) => { if (!condition) throw Error(name); count++; };
  const drain = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
  check(typeof require === 'undefined' && typeof module === 'undefined', 'Browser/CommonJS separation');
  check(Object.isFrozen(SnapshotCore) && Object.isFrozen(SnapshotProjection) && Object.isFrozen(SnapshotCache) && Object.isFrozen(SnapshotController), 'Frozen namespaces');
  check(Object.keys(SnapshotProjection).join() === 'createProjection' && Object.keys(SnapshotCache).join() === 'createCacheAdapter' &&
    Object.keys(SnapshotController).join() === 'createShadowController', 'Exact namespace APIs');
  function harness(withCache = false) {
    const records = new Map(), reads = [], events = [], tasks = new Map(); let next = 0;
    const storage = { getItem: k => records.get(k) ?? null, setItem: (k,v) => records.set(k,v), removeItem: k => records.delete(k) };
    if (withCache) {
      const decoded = SnapshotCore.decodeSnapshotEnvelope(data.cached, data.context);
      const accepted = SnapshotCore.evaluateAcceptance({ decoded, current: null, expectedContext: data.context,
        requestMeta: { context: data.context, requestSequence: 1 }, latestRequestSequence: 1, thresholds: null, nowInstant: data.at });
      check(accepted.outcome === 'ACCEPT', 'Synthetic cache seed accepted');
      SnapshotCache.createCacheAdapter(storage).write(accepted.nextRoot, data.at);
    }
    const controller = SnapshotController.createShadowController({ storage,
      provider: { read(args) { return new Promise((resolve,reject) => reads.push({args,resolve,reject})); } },
      clock: { nowInstant: () => data.at }, scheduler: { scheduleAt(at, fn) { const id = ++next; tasks.set(id,{at,fn}); return id; }, cancel: id => tasks.delete(id) } });
    controller.subscribe(event => events.push(event)); controller.setContext(data.context);
    return { controller, events, reads, tasks };
  }
  const h = harness();
  check(h.reads.length === 0 && h.tasks.size === 0, 'Construction/context starts no read');
  h.controller.requestRefresh('INITIAL'); await drain();
  check(h.reads.length === 1, 'Injected fake provider'); h.reads[0].resolve(data.raw); await drain();
  const commits = h.events.filter(e => e.type === 'VIEW_COMMITTED'), event = commits[0];
  check(commits.length === 1 && event.state.view.source === 'ONLINE', 'One online publication');
  check(Object.isFrozen(event) && Object.isFrozen(event.state) && Object.isFrozen(event.state.view.root.snapshot), 'Immutable publication');
  check(event.state === h.controller.getState() && event.state.view.selectors === event.state.view.projection.selectors &&
    event.state.view.root.context === event.state.view.projection.context, 'Atomic classic bundle');
  check(SnapshotProjection.createProjection(event.state.view.root).legacy.movies.length === data.raw.catalog.length, 'Classic projection');
  h.controller.requestRefresh(); await drain();
  h.controller.setContext({ ...data.context, groupId: data.nextGroup }); const afterSwitch = h.events.length;
  h.reads[1].resolve(data.raw); await drain();
  check(h.events.length === afterSwitch && h.controller.getState().view === null, 'Late context response blocked');
  const clear = h.events.filter(e => e.type === 'VIEW_CLEARED').at(-1);
  check(clear.state.view === null && clear.state.context === null, 'Clear boundary');
  const cached = harness(true);
  check(cached.events.filter(e => e.type === 'VIEW_COMMITTED').length === 1 && cached.controller.getState().view.source === 'CACHE' &&
    cached.controller.getState().status === 'STALE' && !cached.controller.getState().freshness.validatedOnline, 'Cache is stale, not online');
  cached.controller.requestRefresh(); await drain(); cached.reads[0].resolve(data.cached); await drain();
  check(cached.events.filter(e => e.type === 'VIEW_COMMITTED').map(e => e.state.view.source).join() === 'CACHE,ONLINE', 'Cache to online publication');
  cached.controller.subscribe(() => { throw Error('Observer failure'); });
  cached.controller.requestRefresh(); await drain(); cached.reads[1].resolve(data.cached); await drain();
  check(cached.controller.getState().status === 'READY', 'Listener errors isolated');
  cached.controller.dispose(); h.controller.dispose();
  check(cached.tasks.size === 0 && h.tasks.size === 0, 'Dispose clears scheduled tasks');
  return count;
}

async function automated() {
  let count = 0;
  const test = async (name, fn) => { await fn(); count++; console.log('PASS BROWSER-VM ' + name); };
  await test('classic load, exact exports, no I/O or global helper leaks', () => {
    const s = sandbox(); const before = vm.runInContext('Reflect.ownKeys(globalThis)',s.context);
    for (const f of files) load(s.context, f);
    assert.deepEqual(vm.runInContext('Reflect.ownKeys(globalThis)',s.context),before); assert.equal(s.accesses(),0);
    for (const key of ['Core','Recommendation','freeze','own','REASONS','createProjection','createCacheAdapter','createShadowController','commonJS'])
      assert.equal(vm.runInContext('typeof '+key,s.context),'undefined',key);
  });
  for (const [file,dependency] of [['projection','SnapshotCore'],['cache','SnapshotCore'],['controller','SnapshotCore']])
    await test(file+' missing Core fails clearly', () => { const s=sandbox();assert.throws(()=>load(s.context,'js/snapshot/'+file+'.js'),new RegExp('requires '+dependency));assert.equal(s.accesses(),0); });
  await test('projection requires Recommendation adapter', () => {
    const s=sandbox();load(s.context,files[3]);assert.throws(()=>load(s.context,files[4]),/requires RecommendationAdapters/);
  });
  for (const missing of ['SnapshotProjection','SnapshotCache']) await test('controller requires '+missing,()=>{
    const s=sandbox();for(const f of files.slice(0,4))load(s.context,f);
    if(missing==='SnapshotCache')load(s.context,files[4]);
    assert.throws(()=>load(s.context,files[6]),new RegExp('requires '+missing));
  });
  for (let i=0;i<names.length;i++) {
    const namespace=names[i],file=files[4+i];
    await test(namespace+' duplicate lexical install preserves original',()=>{
      const s=full(),original=vm.runInContext(namespace,s.context);
      assert.throws(()=>load(s.context,file),/already been declared/);assert.strictEqual(vm.runInContext(namespace,s.context),original);
    });
    await test(namespace+' existing object namespace is not overwritten',()=>{
      const s=sandbox(),marker=Object.freeze({existing:true});s.context[namespace]=marker;
      for(const f of files.slice(0,4+i))load(s.context,f);
      assert.throws(()=>load(s.context,file),/namespace already installed/);assert.strictEqual(s.context[namespace],marker);
    });
  }
  await test('CommonJS exports match intended APIs and are frozen',()=>{
    for(const [name,api] of [['projection','createProjection'],['cache','createCacheAdapter'],['controller','createShadowController']]) {
      const module=require('../js/snapshot/'+name);assert(Object.isFrozen(module));assert.deepEqual(Object.keys(module),[api]);assert.equal(typeof module[api],'function');
    }
  });
  await test('shared classic integration with provider/cache/context/publication',async()=>{
    const s=full();s.context.fixtureJSON=JSON.stringify(fixtures);
    const passed=await vm.runInContext('('+classicChecks.toString()+')(JSON.parse(fixtureJSON))',s.context);
    assert.equal(passed,16);assert.equal(s.accesses(),0);console.log('CLASSIC INTEGRATION assertions:',passed);
  });
  await test('runtime entries remain isolated and core bytes match HEAD',()=>{
    for(const entry of ['index.html','js/main.js','js/store.js','js/auth.js','service-worker.js']) {
      const text=source(entry);assert(!/snapshot\/(?:core|projection|cache|controller)\.js|Snapshot(?:Core|Projection|Cache|Controller)/.test(text));
    }
    const {execFileSync}=require('node:child_process');assert.deepEqual(fs.readFileSync(path.join(root,'js/snapshot/core.js')),execFileSync('git',['show','HEAD:js/snapshot/core.js'],{cwd:root}));
  });
  await test('manual duplicate probes do not depend on engine-specific error wording',()=>{
    const spec={namespace:'SnapshotProjection',error:'unused'};
    for(const message of ['Identifier has already been declared',"Can't create duplicate variable",'redeclaration of const'])
      assert(probeSucceeded([{name:'SyntaxError',message}],spec));
    assert(!probeSucceeded([{name:'TypeError',message:'unrelated'}],spec));
    assert(!probeSucceeded([] ,spec));
  });
  assert.equal(count,17);console.log('Browser/classic automated: '+count+'/17 groups PASS; real-browser gate NOT RUN.');
}

// The optional server is test infrastructure only: fixed files, 127.0.0.1,
// restrictive CSP, no app config, SDK, service worker or external resource.
function serve() {
  const http=require('node:http');let report=null;
  const scriptTags=list=>list.map(f=>'<script src="/'+f+'"></script>').join('\n');
  const probes=[];
  for(const name of ['projection','cache','controller'])probes.push({name:'missing-core-'+name,list:['js/snapshot/'+name+'.js'],error:'requires SnapshotCore'});
  probes.push({name:'missing-recommendation',list:[files[3],files[4]],error:'requires RecommendationAdapters'});
  probes.push({name:'missing-controller-projection',list:[...files.slice(0,4),files[6]],error:'requires SnapshotProjection'});
  probes.push({name:'missing-controller-cache',list:files.slice(0,5).concat(files[6]),error:'requires SnapshotCache'});
  names.forEach((name,i)=>{
    probes.push({name:'duplicate-'+name,list:files.concat('probe-capture-'+name+'.js',files[4+i]),error:'already',namespace:name});
    probes.push({name:'collision-'+name,list:files.slice(0,5+i),error:'namespace already installed',namespace:name,collision:true});
  });
  const page='<!doctype html><meta charset="utf-8"><title>4A1 isolated browser gate</title><h1>4A1 browser gate</h1><pre id="result">Running…</pre>'+scriptTags(['/prelude.js',...files,'/checks.js'].map(f=>f.replace(/^\//,'')));
  const prelude=`'use strict'; const HarnessIO = (() => { let accesses=0; const send=globalThis.fetch.bind(globalThis); for (const key of ${JSON.stringify(forbidden.filter(k=>!['window','document'].includes(k)))}) Object.defineProperty(globalThis,key,{configurable:true,get(){accesses++;throw Error('Unexpected module I/O: '+key);}}); return Object.freeze({send,accesses:()=>accesses,keys:Reflect.ownKeys(globalThis)}); })();`;
  const checks=`'use strict'; (${classicChecks.toString()} )(${JSON.stringify(fixtures)}).then(async assertions=>{
    if(HarnessIO.accesses()!==0)throw Error('Module I/O observed');
    const extra=Reflect.ownKeys(globalThis).filter(k=>!HarnessIO.keys.includes(k));if(extra.length)throw Error('Leaked globals: '+extra.join());
    let probes=0;
    for(const spec of ${JSON.stringify(probes)})await new Promise((resolve,reject)=>{
      const frame=document.createElement('iframe');frame.hidden=true;
      const receive=event=>{if(event.source!==frame.contentWindow||event.origin!==location.origin)return;
        globalThis.removeEventListener('message',receive);frame.remove();
        if(!event.data||!event.data.ok)reject(Error('Probe failed: '+spec.name));else{probes++;resolve();}};
      globalThis.addEventListener('message',receive);frame.src='/probe/'+spec.name;document.body.append(frame);
    });
    return {ok:true,integrationAssertions:assertions,probeCases:probes,moduleIO:HarnessIO.accesses(),userAgent:navigator.userAgent};
  }).catch(error=>({ok:false,error:String(error.message)})).then(async result=>{
    document.getElementById('result').textContent=JSON.stringify(result,null,2);
    await HarnessIO.send('/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
  });`;
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'");
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const reply=(type,body,status=200)=>{res.writeHead(status,{'Content-Type':type+'; charset=utf-8'});res.end(body);};
    if(req.method==='POST'&&req.url==='/result') {
      let body='';req.on('data',chunk=>{body+=chunk;if(body.length>16384)req.destroy();});
      req.on('end',()=>{try{report=JSON.parse(body);console.log('REAL BROWSER RESULT',JSON.stringify(report));reply('text/plain','Recorded');}catch(_){reply('text/plain','Invalid result',400);}});return;
    }
    if(req.method!=='GET'){reply('text/plain','Method not allowed',405);return;}
    if(req.url==='/'){reply('text/html',page);return;}
    if(req.url==='/prelude.js'){reply('text/javascript',prelude);return;}
    if(req.url==='/checks.js'){reply('text/javascript',checks);return;}
    const probe=probes.find(p=>req.url==='/probe/'+p.name);
    if(probe){reply('text/html','<!doctype html>'+scriptTags(['probe-init-'+probe.name+'.js',...probe.list,'probe-result-'+probe.name+'.js']));return;}
    const init=probes.find(p=>req.url==='/probe-init-'+p.name+'.js');
    if(init){reply('text/javascript',`'use strict'; const ProbeErrors=[]; globalThis.onerror=(message,source,line,column,error)=>{ProbeErrors.push({message:String(message),name:error?.name});return true;}; ${init.collision?'globalThis.'+init.namespace+'=Object.freeze({existing:true});':''} ${init.namespace&&!init.collision?'let ProbeOriginal;':''}`);return;}
    const capture=names.find(n=>req.url==='/probe-capture-'+n+'.js');
    if(capture){reply('text/javascript','ProbeOriginal='+capture+';');return;}
    const done=probes.find(p=>req.url==='/probe-result-'+p.name+'.js');
    if(done){reply('text/javascript',`'use strict'; parent.postMessage({ok:(${probeSucceeded.toString()})(ProbeErrors,${JSON.stringify(done)})${done.collision?' && globalThis.'+done.namespace+'.existing===true':done.namespace?' && '+done.namespace+'===ProbeOriginal':''}},location.origin);`);return;}
    if(files.some(f=>req.url==='/'+f)){reply('text/javascript',source(req.url.slice(1)));return;}
    reply('text/plain','Not found',404);
  });
  server.listen(0,'127.0.0.1',()=>console.log('MANUAL REAL-BROWSER GATE: open http://127.0.0.1:'+server.address().port+'/ ; Ctrl-C stops only this harness.'));
  process.once('SIGINT',()=>server.close(()=>{console.log(report?.ok?'Real browser gate: PASS':'Real browser gate: NOT PASSED / NOT RUN');}));
}
if(require.main===module)automated().then(()=>{if(process.argv.includes('--serve'))serve();}).catch(e=>{console.error('FAIL classic-script harness:',e.stack);process.exitCode=1;});
