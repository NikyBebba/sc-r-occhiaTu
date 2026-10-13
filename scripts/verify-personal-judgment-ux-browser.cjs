#!/usr/bin/env node
// Personal Judgment refinement: Seen/Add forms and inline optical balance; actual runtime, synthetic Auth and server; no live writes. --playwright=/path/to/playwright
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.argv.find(a=>a.startsWith('--playwright='))?.slice(13)||'playwright');
const {createTestPassword}=require('./test-password.cjs');
const testPassword=createTestPassword();
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const scripts=[...read('index.html').matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map(m=>m[1]).filter(f=>f!=='js/config.js');
const html=read('index.html').replace(/<script src="js\/[^"]+"><\/script>/g,'').replace(/<script src="https:[^"]*supabase[^"]*"><\/script>/g,'').replace('<link href="css/style.css" rel="stylesheet">','<style>'+read('css/style.css')+'</style>');
const screenshots=process.argv.find(a=>a.startsWith('--screenshots='))?.slice(14);
const runtimeEmails={N:'n@example.invalid',V:'v@example.invalid'};
let checks=0;
(async()=>{
 const engine=process.env.SC_ENGINE || 'chromium';
 const browser=await ({chromium,webkit}[engine]).launch({headless:true});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:engine==='chromium',hasTouch:true});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**/*',r=>r.request().url().startsWith('https://cdn.tailwindcss.com') ? (process.env.SC_TAILWIND ? r.fulfill({contentType:'text/javascript',body:fs.readFileSync(process.env.SC_TAILWIND,'utf8')}) : r.continue()) : r.abort());
 if(screenshots)await page.route('https://cdnjs.cloudflare.com/**',r=>r.continue());
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
 await page.evaluate(()=>{
  window.realFixtureClient=sb;
  window.resetPreferenceFixture=person=>{
   ['detailModal','reviewModal','seenModal','listCandidateModal','confirmModal'].forEach(closeModalNow);
   currentUser=person;authIdentity.person=person;dbMode='supabase';
   window.serverFilm={id:'personal-film',title:'Film personale',seen_n:true,seen_v:true,status:'watchlist',in_shared_list:false,
    seen_rating_n:null,seen_rating_v:null,review_text_n:'',review_text_v:'',personal_liked_n:null,personal_liked_v:null,
    personal_liked_updated_at_n:null,personal_liked_updated_at_v:null};
   movies=[structuredClone(serverFilm)];movieNights=[];vetoes=[];window.writes=[];window.failWrite=null;window.writeDelay=0;window.clock=0;
   sb={...realFixtureClient,auth:{...realFixtureClient.auth,async getUser(){return {data:{user:{id:authIdentity.uid}},error:null};}},from(table){
    const q={patch:null,payload:null,id:null,insert(rows){q.payload=structuredClone(rows[0]);return q;},async maybeSingle(){return {data:{user_id:authIdentity.uid,person:currentUser},error:null};},select(){return q;},update(patch){q.patch=structuredClone(patch);return q;},eq(k,id){q.id=id;return q;},order(){return q;},
     then(resolve,reject){return (async()=>{
      if(q.payload){writes.push(q.payload);await new Promise(r=>setTimeout(r,writeDelay));if(failWrite)return {data:null,error:failWrite};serverFilm={...serverFilm,id:'inserted-film',title:q.payload.title,seen_n:false,seen_v:false,...q.payload};const own=currentUser.toLowerCase();if(serverFilm['seen_rating_'+own]!=null){serverFilm['personal_liked_'+own]=null;serverFilm['personal_liked_updated_at_'+own]=null;}else if(typeof serverFilm['personal_liked_'+own]==='boolean')serverFilm['personal_liked_updated_at_'+own]='2026-10-13T16:00:00Z';return {data:[structuredClone(serverFilm)],error:null};}
      if(!q.patch)return {data:table==='movies'?[structuredClone(serverFilm)]:[],error:null};
      writes.push(q.patch);await new Promise(r=>setTimeout(r,writeDelay));
      if(failWrite)return {data:null,error:failWrite};
      const own=currentUser.toLowerCase(),next={...serverFilm,...q.patch};
      if(Object.hasOwn(q.patch,'seen_rating_'+own)){next['personal_liked_'+own]=null;next['personal_liked_updated_at_'+own]=null;}
      else if(Object.hasOwn(q.patch,'personal_liked_'+own)){
       if(next['seen_rating_'+own]!=null && next['personal_liked_'+own]!=null)return {data:null,error:{code:'23514',message:'movies_personal_feedback_'+own+'_exclusive'}};
       next['personal_liked_updated_at_'+own]=next['personal_liked_'+own]===null?null:next['personal_liked_'+own]===serverFilm['personal_liked_'+own]?serverFilm['personal_liked_updated_at_'+own]:'2026-10-13T15:00:'+String(++clock).padStart(2,'0')+'Z';
      }
      Object.assign(serverFilm,next);return {data:[structuredClone(serverFilm)],error:null};
     })().then(resolve,reject);}};return q;
   }};
   saveLocal();setTab('history_'+person.toLowerCase());
  };
 });
 const reset=person=>page.evaluate(p=>resetPreferenceFixture(p),person);
 for(const person of ['N','V'])for(const width of [320,390,768,1280]){
  await page.setViewportSize({width,height:844});const suffix=person+' '+width;
  for(const flow of ['add','seen'])for(const kind of ['like','dislike','rating','like-rating','dislike-rating','rating-like','none']){
   await check(flow+' judgment '+kind+' '+suffix,async()=>{
    await reset(person);
    if(flow==='add') {await page.evaluate(()=>applyResolvedDetails({title:'Nuovo visto',tmdb_id:99999}));await page.locator('#addSeenModal').getByRole('button',{name:'Sì',exact:true}).click();}
    else await page.evaluate(async p=>{serverFilm['seen_'+p.toLowerCase()]=false;movies=[structuredClone(serverFilm)];await markSeenUI('personal-film');},person);
    const input=flow==='add'?'addSeenRating':'seenRating';const modal=flow==='add'?'addSeenModal':'seenModal';
    if(kind.startsWith('like'))await page.locator('#'+input+'Like').click();
    if(kind.startsWith('dislike'))await page.locator('#'+input+'Dislike').click();
    if(kind.includes('rating')){await page.locator('#'+input).fill('8,5');assert.equal(await page.locator('#'+input+'Like').getAttribute('aria-pressed'),'false');assert.equal(await page.locator('#'+input+'Dislike').getAttribute('aria-pressed'),'false');}
    if(kind==='rating-like'){await page.locator('#'+input+'Like').click();assert.equal(await page.locator('#'+input).inputValue(),'');}
    if(flow==='add')await page.locator('#addSeenSave').click();else await page.locator('#seenSaveButton').click();
    await page.locator('#'+modal).waitFor({state:'hidden'});
    const data=await page.evaluate(()=>({film:serverFilm,patch:writes.at(-1)}));const key=person.toLowerCase();
    const expectedRating=kind.includes('rating')&&kind!=='rating-like';const expectedPreference=kind==='like'||kind==='rating-like'?true:kind==='dislike'?false:null;
    assert.equal(data.film['seen_'+key],true);assert.equal(data.film['seen_rating_'+key],expectedRating?8.5:null);assert.equal(data.film['personal_liked_'+key],expectedPreference);
    assert(!(Object.hasOwn(data.patch,'personal_liked_'+key)&&Object.hasOwn(data.patch,'seen_rating_'+key)));
    if(!expectedRating)assert(!Object.hasOwn(data.patch,'seen_rating_'+key));
   });
  }
  await check('New already-seen candidacy accepts Like/Dislike and rejects Unknown '+suffix,async()=>{
   for(const value of [true,false,null]){await reset(person);await page.evaluate(()=>applyResolvedDetails({title:'Candidato nuovo',tmdb_id:333333}));await page.locator('#addSeenModal').getByRole('button',{name:'Sì',exact:true}).click();await page.locator('#addSeenDestination').selectOption('list');if(value!==null)await page.locator('#addSeenRating'+(value?'Like':'Dislike')).click();await page.locator('#addSeenSave').click();if(value===null){assert(await page.locator('#addSeenModal').isVisible());assert.equal(await page.evaluate(()=>writes.length),0);assert((await page.locator('#addSeenError').textContent()).includes('giudizio'));await page.keyboard.press('Escape');}else{await page.locator('#addSeenModal').waitFor({state:'hidden'});assert(await page.evaluate(()=>serverFilm.in_shared_list));assert.equal(await page.evaluate(p=>serverFilm['personal_liked_'+p.toLowerCase()],person),value);assert.equal(await page.evaluate(()=>writes.length),1);}}
  });
  await check('Known Add explicit rating removal, no stale preference restoration '+suffix,async()=>{
   await reset(person);await page.evaluate(p=>{serverFilm.tmdb_id=7777;serverFilm['seen_rating_'+p.toLowerCase()]=8;movies=[structuredClone(serverFilm)];},person);await page.evaluate(()=>applyResolvedDetails({title:'Film personale',tmdb_id:7777}));await page.locator('#addSeenModal').getByRole('button',{name:'Sì',exact:true}).click();assert(await page.locator('#addSeenRatingLike').isDisabled());await page.locator('#addSeenRating').fill('');await page.locator('#addSeenSave').click();await page.locator('#addSeenModal').waitFor({state:'hidden'});assert.equal(await page.evaluate(p=>serverFilm['seen_rating_'+p.toLowerCase()],person),null);assert.equal(await page.evaluate(p=>serverFilm['personal_liked_'+p.toLowerCase()],person),null);
  });
  await check('Unified review mode, persisted rating safety and explicit removal '+suffix,async()=>{
   await reset(person);await page.evaluate(()=>addPersonalReview('personal-film'));await page.locator('#reviewRatingDislike').click();await page.locator('#reviewSaveButton').click();await page.locator('#reviewModal').waitFor({state:'hidden'});assert.equal(await page.evaluate(p=>serverFilm['personal_liked_'+p.toLowerCase()],person),false);
   await page.evaluate(()=>addPersonalReview('personal-film'));await page.locator('#reviewRating').fill('0');await page.locator('#reviewSaveButton').click();await page.locator('#reviewModal').waitFor({state:'hidden'});
   await page.evaluate(()=>addPersonalReview('personal-film'));assert(await page.locator('#reviewRatingLike').isDisabled());await page.locator('#reviewRating').fill('');assert(await page.locator('#reviewRatingLike').isDisabled());await page.locator('#reviewSaveButton').click();await page.locator('#reviewModal').waitFor({state:'hidden'});assert.equal(await page.evaluate(p=>serverFilm['personal_liked_'+p.toLowerCase()],person),null);
   await page.evaluate(()=>addPersonalReview('personal-film'));assert(await page.locator('#reviewRatingLike').isEnabled());await page.keyboard.press('Escape');
  });
  for(const pair of [[true,false],[false,true],[8,true],[true,8.5],[7,8.5],[true,null],[null,false],[null,null]]){
   await check('Inline layout '+JSON.stringify(pair)+' '+suffix,async()=>{
    await reset(person);await page.evaluate(pair=>{for(const [i,p] of ['n','v'].entries()){const value=pair[i];serverFilm['seen_rating_'+p]=typeof value==='number'?value:null;serverFilm['personal_liked_'+p]=typeof value==='boolean'?value:null;}movies=[structuredClone(serverFilm)];render();},pair);
    const scores=page.locator('#movieGrid .viewing-scores');
    for(const [i,p] of ['n','v'].entries()){
     const value=pair[i],el=scores.locator('.viewing-score-'+p);assert.equal(await el.count(),value===null&&p!==person.toLowerCase()?0:1);
     if(value!==null){assert.equal(await el.getAttribute('data-judgment'),typeof value==='number'?'rating':value?'like':'dislike');assert(await el.evaluate((e,p)=>{const st=getComputedStyle(e),probe=document.createElement('span');probe.style.color='var(--color-persona-'+p+')';e.parentNode.appendChild(probe);const same=st.color===getComputedStyle(probe).color;probe.remove();return same;},p));}
     if(typeof value==='boolean')assert(await el.evaluate(e=>{const st=getComputedStyle(e),icon=getComputedStyle(e.querySelector('i'));return parseFloat(st.borderTopWidth)===0 && st.backgroundColor==='rgba(0, 0, 0, 0)' && Math.abs(parseFloat(icon.fontSize)/parseFloat(st.fontSize)-1.15)<.01;}));
    }
    if(pair.every(v=>v!==null)){const a=await scores.locator('.viewing-score-n').boundingBox(),b=await scores.locator('.viewing-score-v').boundingBox();assert(Math.abs((a.y+a.height/2)-(b.y+b.height/2))<=1);}
    assert.equal(await page.locator('#movieGrid .viewing-person').count(),2);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(screenshots&&person==='N'&&[390,1280].includes(width)&&[JSON.stringify([8,true]),JSON.stringify([true,8.5]),JSON.stringify([true,false]),JSON.stringify([7,8.5])].includes(JSON.stringify(pair))){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(screenshots,'judgment-'+width+'-'+pair.join('-')+'.png'),fullPage:true});}
   });
  }
  await check('Combined Seen/preference pending and offline fail-closed '+suffix,async()=>{
   await reset(person);await page.evaluate(()=>markSeenUI('personal-film'));await page.locator('#seenRatingLike').click();await page.evaluate(()=>writeDelay=150);await page.evaluate(()=>{confirmSeen();confirmSeen();});assert(await page.locator('#seenSaveButton').isDisabled());await page.locator('#seenModal').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>writes.length),1);
   await reset(person);await page.evaluate(()=>markSeenUI('personal-film'));await page.locator('#seenRatingDislike').click();await page.evaluate(()=>dbMode='local');await page.locator('#seenSaveButton').click();assert(await page.locator('#seenModal').isVisible());assert.equal(await page.evaluate(()=>writes.length),0);await page.keyboard.press('Escape');
  });
  await check('Seen rating removal explicit, subsequent quick preference permitted '+suffix,async()=>{
   await reset(person);await page.evaluate(p=>{serverFilm['seen_rating_'+p.toLowerCase()]=8;movies=[structuredClone(serverFilm)];},person);await page.evaluate(()=>markSeenUI('personal-film'));assert(await page.locator('#seenRatingLike').isDisabled());await page.locator('#seenRating').fill('');await page.locator('#seenSaveButton').click();await page.locator('#seenModal').waitFor({state:'hidden'});assert.equal(await page.evaluate(p=>serverFilm['seen_rating_'+p.toLowerCase()],person),null);assert.equal(await page.evaluate(p=>serverFilm['personal_liked_'+p.toLowerCase()],person),null);
  });
  await check('Single lock across Seen and complete editor, final authoritative state '+suffix,async()=>{
   await reset(person);await page.evaluate(()=>markSeenUI('personal-film'));await page.locator('#seenRatingLike').click();await page.evaluate(()=>{writeDelay=300;confirmSeen();});await page.keyboard.press('Escape');await page.locator('#movieGrid .personal-judgment-slot').click();assert(await page.locator('#reviewRatingDislike').isDisabled());await page.evaluate(()=>chooseDraftPersonalPreference('reviewRating',false));await page.waitForFunction(()=>writes.length===1&&serverFilm['personal_liked_'+currentUser.toLowerCase()]===true);await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>writes.length),1);
  });
  await check('New Add offline preference no insert and no local success '+suffix,async()=>{
   await reset(person);await page.evaluate(()=>applyResolvedDetails({title:'Non persistito',tmdb_id:222222}));await page.locator('#addSeenModal').getByRole('button',{name:'Sì',exact:true}).click();await page.locator('#addSeenRatingDislike').click();await page.evaluate(()=>dbMode='local');await page.locator('#addSeenSave').click();assert(await page.locator('#addSeenModal').isVisible());assert.equal(await page.evaluate(()=>writes.length),0);await page.keyboard.press('Escape');
  });
  await check('Seen preference stale rating race atomically rejects whole patch '+suffix,async()=>{
   await reset(person);await page.evaluate(p=>{serverFilm['seen_'+p.toLowerCase()]=false;movies=[structuredClone(serverFilm)];},person);await page.evaluate(()=>markSeenUI('personal-film'));await page.locator('#seenRatingDislike').click();await page.evaluate(p=>serverFilm['seen_rating_'+p.toLowerCase()]=9,person);await page.locator('#seenSaveButton').click();assert(await page.locator('#seenModal').isVisible());assert.equal(await page.evaluate(p=>serverFilm['personal_liked_'+p.toLowerCase()],person),null);assert.equal(await page.evaluate(p=>serverFilm['seen_'+p.toLowerCase()],person),false);assert(await page.locator('#seenRatingLike').isDisabled());await page.keyboard.press('Escape');
  });
  await check('Complete editor draft rating → existing Like preserves final Like intent '+suffix,async()=>{
   await reset(person);await page.evaluate(p=>{serverFilm['personal_liked_'+p.toLowerCase()]=true;serverFilm['personal_liked_updated_at_'+p.toLowerCase()]='2026-10-13T10:00:00Z';movies=[structuredClone(serverFilm)];render();},person);await page.locator('#movieGrid .personal-judgment-slot').click();await page.locator('#reviewRating').fill('8');await page.locator('#reviewRatingLike').click();await page.locator('#reviewSaveButton').click();await page.locator('#reviewModal').waitFor({state:'hidden'});assert.equal(await page.evaluate(p=>serverFilm['personal_liked_'+p.toLowerCase()],person),true);assert.equal(await page.evaluate(p=>serverFilm['seen_rating_'+p.toLowerCase()],person),null);
  });
  await check('Saved slot complete editor exposes rating in same form '+suffix,async()=>{
   await reset(person);await page.locator('#movieGrid .personal-judgment-slot').click();assert(await page.locator('#reviewRating').isVisible());await page.locator('#reviewRatingLike').click();await page.locator('#reviewSaveButton').click();await page.locator('#reviewModal').waitFor({state:'hidden'});
   await page.locator('#movieGrid .personal-judgment-slot').click();await page.locator('#reviewRating').fill('8,5');assert.equal(await page.locator('#reviewRatingLike').getAttribute('aria-pressed'),'false');await page.locator('#reviewSaveButton').click();await page.locator('#reviewModal').waitFor({state:'hidden'});assert.equal(await page.locator('#movieGrid .viewing-score-'+person.toLowerCase()).getAttribute('data-judgment'),'rating');
  });
 }
 assert.deepEqual(errors,[]);console.log(`Personal Judgment UX ${engine}: ${checks}/${checks} PASS; synthetic server only.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
