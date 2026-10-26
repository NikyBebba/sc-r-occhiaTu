'use strict';
// Loopback-only real-browser gate. No real configuration or external requests.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {runChecks}=require('./verify-production-protocol.cjs'),{fixtureData}=require('./verify-production-shell.cjs');
const root=path.resolve(__dirname,'..'),data=fixtureData();
const config=`const CONFIG={SUPABASE_URL:'',SUPABASE_ANON_KEY:'',TMDB_API_KEY:'',OMDB_API_KEY:'',PEOPLE:{N:{label:'Nicholas',badgeClass:''},V:{label:'Valeria',badgeClass:''}},AUTH_EMAILS:{N:'n@example.test',V:'v@example.test'}};`;
const prelude=`window.tailwind={config:{}};const OriginalDate=Date;window.Date=class extends OriginalDate{constructor(...a){super(...(a.length?a:[${JSON.stringify(data.at)}]));}static now(){return new OriginalDate(${JSON.stringify(data.at)}).getTime();}};document.addEventListener('visibilitychange',e=>e.stopImmediatePropagation(),true);window.addEventListener('online',e=>e.stopImmediatePropagation(),true);`;
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script src="https:[^"]*"><\/script>/g,'').replace(/<link[^>]*https:[^>]*>/g,'').replace('<head>','<head><script src="/protocol-prelude.js"></script><style>.hidden,.\\!hidden{display:none!important}</style>').replace('</body>','<pre id="protocolTestResult"></pre><script src="/protocol-checks.js"></script></body>');
const checks=`window.addEventListener('load',()=>{(${runChecks.toString()})(${JSON.stringify(data)}).then(result=>({...result,ok:true,userAgent:navigator.userAgent})).catch(error=>({ok:false,error:error.stack})).then(async result=>{window.protocolTestResult=result;document.getElementById('protocolTestResult').textContent=JSON.stringify(result);await fetch('/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});});});`;
const server=http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'");
 const reply=(mime,body,code=200)=>{res.writeHead(code,{'Content-Type':mime});res.end(body);};
 if(req.method==='POST'&&req.url==='/result'){let body='';req.on('data',b=>{body+=b;if(body.length>20000)req.destroy();});req.on('end',()=>{const r=JSON.parse(body);console.log('BROWSER RESULT '+JSON.stringify(r));reply('text/plain','Recorded');});return;}
 if(req.method!=='GET')return reply('text/plain','Method not allowed',405);
 if(req.url==='/')return reply('text/html',html);
 if(req.url==='/protocol-prelude.js')return reply('text/javascript',prelude);
 if(req.url==='/protocol-checks.js')return reply('text/javascript',checks);
 if(req.url==='/js/config.js')return reply('text/javascript',config);
 const file=req.url.slice(1);
 if(!/^(?:js\/[a-z0-9_/-]+\.js|service-worker\.js|css\/style\.css|manifest\.json|icons\/[a-z0-9-]+\.png)$/.test(file))return reply('text/plain','Not found',404);
 try{reply(file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'application/json',fs.readFileSync(path.join(root,file)));}catch(_){reply('text/plain','Not found',404);}
});
server.listen(0,'127.0.0.1',()=>console.log('PROTOCOL BROWSER GATE http://127.0.0.1:'+server.address().port+'/'));
process.on('SIGINT',()=>server.close());
