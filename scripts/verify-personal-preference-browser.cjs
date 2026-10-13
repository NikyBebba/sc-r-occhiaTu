#!/usr/bin/env node
// Personal Judgment UI: actual runtime, synthetic Auth and server; no live writes. --playwright=/path/to/playwright
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
   ['reviewModal','detailModal','seenModal','listCandidateModal','confirmModal'].forEach(closeModalNow);
   currentUser=person;authIdentity.person=person;dbMode='supabase';
   window.serverNights=[];window.serverFilm={id:'personal-film',title:'Film personale',seen_n:true,seen_v:true,status:'watchlist',in_shared_list:false,
    seen_rating_n:null,seen_rating_v:null,review_text_n:'',review_text_v:'',personal_liked_n:null,personal_liked_v:null,
    personal_liked_updated_at_n:null,personal_liked_updated_at_v:null};
   movies=[structuredClone(serverFilm)];movieNights=[];vetoes=[];window.writes=[];window.failWrite=null;window.writeDelay=0;window.clock=0;
   sb={...realFixtureClient,auth:{...realFixtureClient.auth,async getUser(){return {data:{user:{id:authIdentity.uid}},error:null};}},from(table){
    const q={patch:null,id:null,async maybeSingle(){return {data:{user_id:authIdentity.uid,person:currentUser},error:null};},select(){return q;},update(patch){q.patch=structuredClone(patch);return q;},eq(k,id){q.id=id;return q;},order(){return q;},
     then(resolve,reject){return (async()=>{
      if(!q.patch)return {data:table==='movies'?[structuredClone(serverFilm)]:table==='movie_nights'?structuredClone(serverNights):[],error:null};
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
 const ownSlot=person=>page.locator('#movieGrid [data-judgment-context="'+person+'"]');
 const open=async person=>{await ownSlot(person).click();await page.locator('#reviewModal').waitFor({state:'visible'});};
 const save=async()=>{await page.locator('#reviewSaveButton').click();await page.locator('#reviewModal').waitFor({state:'hidden'});};
 for(const person of ['N','V'])for(const width of [320,390,768,1280]){
  const label=person+' '+width;await page.setViewportSize({width,height:844});
  for(const [value,rating,state] of [[true,null,'like'],[false,null,'dislike'],[null,8.5,'rating'],[null,null,'unknown']])await check('Own '+state+' → same complete editor '+label,async()=>{
   await reset(person);await page.evaluate(({p,value,rating})=>{serverFilm['personal_liked_'+p.toLowerCase()]=value;serverFilm['seen_rating_'+p.toLowerCase()]=rating;movies=[structuredClone(serverFilm)];render();},{p:person,value,rating});
   assert.equal(await ownSlot(person).evaluate(e=>e.tagName),'BUTTON');assert((await ownSlot(person).getAttribute('aria-label')).includes(state==='rating'?'8,5/10':state==='like'?'Mi è piaciuto':state==='dislike'?'Non mi è piaciuto':'non ancora espresso'));assert(await ownSlot(person).evaluate(e=>parseFloat(getComputedStyle(e).borderTopWidth)===0&&e.getBoundingClientRect().height>=44));
   await ownSlot(person).focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#reviewBy').inputValue(),person);assert(await page.locator('#reviewText').isVisible());assert(await page.locator('#reviewRating').isVisible());assert(await page.locator('#reviewRatingJudgment').isVisible());assert(await page.locator('#detailModal').isHidden());
   await page.keyboard.press('Escape');assert(await ownSlot(person).evaluate(e=>e===document.activeElement));
  });
  for(const [value,rating] of [[true,null],[false,null],[null,8]])await check('Other judgment read-only '+JSON.stringify([value,rating])+' '+label,async()=>{
   await reset(person);const peer=person==='N'?'V':'N';await page.evaluate(({peer,value,rating})=>{serverFilm['personal_liked_'+peer.toLowerCase()]=value;serverFilm['seen_rating_'+peer.toLowerCase()]=rating;movies=[structuredClone(serverFilm)];render();},{peer,value,rating});assert.equal(await ownSlot(peer).evaluate(e=>e.tagName),'SPAN');assert.equal(await ownSlot(peer).getAttribute('onclick'),null);
  });
  await check('Review-only and preference-only unseen reach complete editor '+label,async()=>{
   for(const pref of [null,false]){await reset(person);await page.evaluate(({p,pref})=>{serverFilm['seen_'+p.toLowerCase()]=false;serverFilm['review_text_'+p.toLowerCase()]=pref===null?'Review without rating':'';serverFilm['personal_liked_'+p.toLowerCase()]=pref;movies=[structuredClone(serverFilm)];render();setTab('all');},{p:person,pref});await open(person);assert(await page.locator('#reviewText').isVisible());await page.keyboard.press('Escape');assert.equal(await page.locator('[data-evaluation-context="'+person+'"]').count(),0);}
  });
  await check('Six preference transitions, rating precedence/removal, review independence '+label,async()=>{
   await reset(person);
   for(const [value,expected] of [[true,true],[false,false],[false,null],[false,false],[true,true],[true,null]]){await open(person);await page.locator(value?'#reviewRatingLike':'#reviewRatingDislike').click();await save();assert.equal(await page.evaluate(p=>serverFilm['personal_liked_'+p.toLowerCase()],person),expected);}
   for(const preference of [true,false]){await open(person);await page.locator(preference?'#reviewRatingLike':'#reviewRatingDislike').click();await save();const ts=await page.evaluate(p=>serverFilm['personal_liked_updated_at_'+p.toLowerCase()],person);
    for(const text of ['Review','Edited','']){await open(person);await page.locator('#reviewText').fill(text);await save();assert.equal(await page.evaluate(p=>serverFilm['personal_liked_'+p.toLowerCase()],person),preference);assert.equal(await page.evaluate(p=>serverFilm['personal_liked_updated_at_'+p.toLowerCase()],person),ts);assert.deepEqual(await page.evaluate(()=>Object.keys(writes.at(-1))),['review_text_'+person.toLowerCase()]);}
    await open(person);await page.locator('#reviewRating').fill(preference?'0':'8,5');await save();assert.equal(await ownSlot(person).getAttribute('data-judgment'),'rating');assert.equal(await ownSlot(person).locator('.fa-thumbs-up,.fa-thumbs-down').count(),0);
    await open(person);await page.locator('#reviewRating').fill('');await save();assert.equal(await ownSlot(person).getAttribute('data-judgment'),'unknown');
   }
  });
  await check('Rating+review removal equivalent to old personal bin '+label,async()=>{
   await reset(person);await page.evaluate(p=>{serverFilm['seen_rating_'+p.toLowerCase()]=0;serverFilm['review_text_'+p.toLowerCase()]='Text';movies=[structuredClone(serverFilm)];render();},person);await open(person);await page.locator('#reviewRating').fill('');await page.locator('#reviewText').fill('');await save();assert.equal(await page.evaluate(p=>serverFilm['seen_rating_'+p.toLowerCase()],person),null);assert.equal(await page.evaluate(p=>serverFilm['review_text_'+p.toLowerCase()],person),'');assert(await page.evaluate(p=>serverFilm['seen_'+p.toLowerCase()],person));
  });
  await check('Pending double submit, offline, business rejection, stale rating '+label,async()=>{
   await reset(person);await open(person);await page.locator('#reviewRatingLike').click();await page.evaluate(()=>{writeDelay=200;confirmReview();confirmReview();});assert(await page.locator('#reviewSaveButton').isDisabled());await page.locator('#reviewModal').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>writes.length),1);
   await reset(person);await open(person);await page.locator('#reviewRatingDislike').click();await page.evaluate(()=>dbMode='local');await page.locator('#reviewSaveButton').click();assert(await page.locator('#reviewModal').isVisible());assert.equal(await page.evaluate(()=>writes.length),0);await page.keyboard.press('Escape');
   await reset(person);await open(person);await page.locator('#reviewRatingLike').click();await page.evaluate(()=>failWrite={code:'42501',message:'PERSONAL_OWNER_REQUIRED'});await page.locator('#reviewSaveButton').click();await page.waitForFunction(()=>document.getElementById('reviewError').textContent.includes('non è consentita'));assert.equal(await page.evaluate(()=>dbMode),'supabase');await page.keyboard.press('Escape');
   await reset(person);await open(person);await page.locator('#reviewRatingDislike').click();await page.evaluate(p=>serverFilm['seen_rating_'+p.toLowerCase()]=9,person);await page.locator('#reviewSaveButton').click();assert(await page.locator('#reviewModal').isVisible());await page.waitForFunction(()=>document.getElementById('reviewRatingLike').disabled);assert.equal(await page.evaluate(p=>serverFilm['seen_rating_'+p.toLowerCase()],person),9);assert.equal(await page.evaluate(p=>serverFilm['personal_liked_'+p.toLowerCase()],person),null);await page.keyboard.press('Escape');
  });
  await check('Realtime FALSE/NULL/rating/review and active-form rating update '+label,async()=>{
   await reset(person);for(const v of [true,false,null]){await page.evaluate(async({p,v})=>{serverFilm['personal_liked_'+p.toLowerCase()]=v;await resyncQuiet();},{p:person,v});assert.equal(await ownSlot(person).getAttribute('data-judgment'),v===true?'like':v===false?'dislike':'unknown');}
   await open(person);await page.evaluate(async p=>{serverFilm['seen_rating_'+p.toLowerCase()]=8;serverFilm['review_text_'+p.toLowerCase()]='Remote text';await resyncQuiet();},person);assert.equal(await page.locator('#reviewRating').inputValue(),'8');assert(await page.locator('#reviewRatingLike').isDisabled());assert.equal(await page.locator('#reviewText').inputValue(),'Remote text');await page.keyboard.press('Escape');assert.equal(await ownSlot(person).getAttribute('data-judgment'),'rating');
  });
  await check('Together inline + review-only and exclusive removal survive '+label,async()=>{
   for(const part of ['rating','text','both']){await reset(person);await page.evaluate(()=>{serverNights=[{id:'completed-night',movie_id:'personal-film',status:'completed',completed_at:'2026-10-13T10:00:00Z'}];movieNights=structuredClone(serverNights);serverFilm.seen_rating_together=8;serverFilm.review_text_together='Together';movies=[structuredClone(serverFilm)];setTab('watched');});
    await page.locator('#movieGrid [data-judgment-context="both"]').click();assert.equal(await page.locator('#reviewBy').inputValue(),'both');assert(await page.locator('#reviewRatingJudgment').isHidden());await page.keyboard.press('Escape');
    await page.locator('#movieGrid .movie-card-section').filter({has:page.locator('summary > span:first-child',{hasText:'Gestione'})}).locator('summary').click();await page.getByRole('button',{name:'Rimuovi voto o recensione N+V',exact:true}).click();await page.locator('#confirmChoices button[data-removal-choice="'+part+'"]').click();await page.locator('#confirmModal').waitFor({state:'hidden'});await page.waitForFunction(part=>serverFilm.seen_rating_together===(part==='text'?8:null)&&serverFilm.review_text_together===(part==='rating'?'Together':''),part);
    assert.equal(await page.evaluate(()=>serverFilm.seen_rating_together),part==='text'?8:null);assert.equal(await page.evaluate(()=>serverFilm.review_text_together),part==='rating'?'Together':'');assert.equal(await page.evaluate(()=>serverNights[0].status),'completed');
   }
   await reset(person);await page.evaluate(()=>{serverNights=[{id:'completed-night',movie_id:'personal-film',status:'completed',completed_at:'2026-10-13T10:00:00Z'}];movieNights=structuredClone(serverNights);serverFilm.review_text_together='Review only';movies=[structuredClone(serverFilm)];setTab('watched');});await page.locator('#movieGrid [data-judgment-context="both"]').click();assert.equal(await page.locator('#reviewText').inputValue(),'Review only');await page.locator('#reviewText').fill('Edited');await page.locator('#reviewSaveButton').click();assert(await page.locator('#reviewModal').isVisible());assert.equal(await page.evaluate(()=>writes.length),0);await page.keyboard.press('Escape');
  });
  await check('Unseen final judgment removal returns focus to library control '+label,async()=>{
   await reset(person);await page.evaluate(p=>{serverFilm['seen_'+p.toLowerCase()]=false;serverFilm['personal_liked_'+p.toLowerCase()]=true;movies=[structuredClone(serverFilm)];setTab('all');},person);
   await open(person);await page.locator('#reviewRatingLike').click();await save();assert.equal(await ownSlot(person).count(),0);assert.equal(await page.evaluate(()=>document.activeElement.id),'libraryBack');
  });
  await check('Completed without personal Seen retains Unknown full editor '+label,async()=>{
   await reset(person);await page.evaluate(()=>{serverFilm.seen_n=false;serverFilm.seen_v=false;serverNights=[{id:'completed-night',movie_id:'personal-film',status:'completed',completed_at:'2026-10-13T10:00:00Z'}];movieNights=structuredClone(serverNights);movies=[structuredClone(serverFilm)];setTab('watched');});
   assert.equal(await ownSlot(person).getAttribute('data-judgment'),'unknown');await open(person);assert.equal(await page.locator('#reviewBy').inputValue(),person);await page.keyboard.press('Escape');
  });
  await check('Together Realtime rating/text changes and review-only removal preserve completed '+label,async()=>{
   await reset(person);await page.evaluate(()=>{serverNights=[{id:'completed-night',movie_id:'personal-film',status:'completed',completed_at:'2026-10-13T10:00:00Z'}];movieNights=structuredClone(serverNights);setTab('watched');});
   await page.evaluate(async()=>{serverFilm.seen_rating_together=0;serverFilm.review_text_together='Remote Together';await resyncQuiet();});assert((await page.locator('#movieGrid [data-judgment-context="both"]').textContent()).includes('0/10'));
   await page.evaluate(async()=>{serverFilm.seen_rating_together=null;await resyncQuiet();});assert.equal(await page.locator('#movieGrid [data-judgment-context="both"]').getAttribute('data-judgment'),'unknown');
   await page.locator('#movieGrid summary').filter({hasText:'Gestione'}).click();await page.getByRole('button',{name:'Rimuovi voto o recensione N+V',exact:true}).click();await page.locator('#confirmYes').click();await page.waitForFunction(()=>serverFilm.review_text_together==='');assert.equal(await page.evaluate(()=>serverNights[0].status),'completed');
  });
  await check('Contexts/detail, card propagation, Surprise and responsive '+label,async()=>{
   await reset(person);await page.evaluate(()=>{serverFilm.seen_n=true;serverFilm.seen_v=true;serverFilm.in_shared_list=true;movies=[structuredClone(serverFilm)];setTab('rewatch');});await open(person);assert(await page.locator('#detailModal').isHidden());await page.keyboard.press('Escape');
   await page.locator('#movieGrid h3').click();await page.locator('#detailModal [data-judgment-context="'+person+'"]').click();assert(await page.locator('#reviewText').isVisible());await page.keyboard.press('Escape');
   await page.evaluate(p=>{serverFilm.surprise_by=p==='N'?'V':'N';movies=[structuredClone(serverFilm)];render();},person);assert.equal(await page.locator('#movieGrid [data-judgment-context]').count(),0);
   await reset(person);await page.evaluate(()=>{serverFilm.seen_rating_n=8;serverFilm.personal_liked_v=true;movies=[structuredClone(serverFilm)];render();});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.locator('#personalPreferenceModal').count(),0);
  });
 }
 assert.deepEqual(errors,[]);console.log(`Personal Preference Browser ${engine}: ${checks}/${checks} PASS; consolidated complete editor, synthetic server only.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
