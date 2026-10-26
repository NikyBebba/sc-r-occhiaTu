#!/usr/bin/env node
// Actual store/forms, synthetic server contract. No network or live DB.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
function fixture(person = 'N') {
  const storage = new Map(), elements = new Map(), calls = [];
  const state = { rows: [], error: null, throwError: null, reads: 0, clock: 0, deferred: false, finish: null };
  const el = id => {
    if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '', disabled: false,
      classList: { add() {}, remove() {}, contains: () => true, toggle() {} }, focus() {} });
    return elements.get(id);
  };
  const ctx = vm.createContext({ console, Date, Number, setTimeout, clearTimeout, currentUser: person, authEpoch: 1,
    CONFIG: { PEOPLE: { N: { label: 'N' }, V: { label: 'V' } } }, window: {},
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,String(v)) },
    authIdentity: { uid: 'synthetic-' + person }, document: { getElementById: el },
    requireAppIdentity() { if (!ctx.currentUser) throw Error('AUTH_REQUIRED'); },
    assertAuthEpoch(epoch) { if (!ctx.currentUser || epoch !== ctx.authEpoch) throw Error('AUTH_CHANGED'); },
    handleDataAuthError(error) { if (error && ([401,403].includes(error.status) || error.code === '42501' || error.code === 'PGRST301')) throw Error('AUTH_DENIED'); },
    validateCurrentAuth: async () => {}, isAppAuthorized: () => !!ctx.currentUser,
    render() { state.renders = (state.renders || 0) + 1; }, activeNightForMovie: () => null,
    openModal() {}, closeModal() {}, closeModalNow() {}, sharedPeopleLabel: () => 'N+V',
    escapeHtml: String, completedNightLabel: () => '', nightTimelineDate: () => '',
    showConfirmModal: async () => true, suggestSagaAfterViewing() {}, showActionError() {}
  });
  const run = code => vm.runInContext(code, ctx);
  for (const file of ['js/format.js', 'js/store.js', 'js/store/movies.js', 'js/store/viewing.js', 'js/ui/actions/viewing.js'])
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  const baseline = { id: 'synthetic-film', title: 'Synthetic', in_shared_list: false, seen_n: true, seen_v: false,
    seen_rating_n: null, seen_rating_v: null, review_text_n: 'Text N', review_text_v: 'Text V',
    seen_rating_together: 8, review_text_together: 'Together', status: 'watchlist',
    personal_liked_n: null, personal_liked_v: null, personal_liked_updated_at_n: null, personal_liked_updated_at_v: null };
  state.rows = [structuredClone(baseline)];
  ctx.server = { from(table) {
    const query = { action: 'read', patch: null, id: null,
      update(patch) { this.action='update'; this.patch=structuredClone(patch); return this; },
      insert(rows) { this.action='insert'; this.payload=structuredClone(rows); return this; },
      eq(key,id) { assert.equal(key,'id'); this.id=id; return this; }, order() { return this; },
      select(fields) { this.fields=fields; return this; },
      then(resolve,reject) {
        const perform = () => {
          if (this.action==='read') { state.reads++; return {data:table==='movies'?structuredClone(state.rows):[],error:null}; }
          calls.push({table,patch:this.patch,payload:this.payload,fields:this.fields,id:this.id});
          if (state.throwError) throw state.throwError;
          if (state.error) return {data:null,error:state.error};
          const own=ctx.currentUser.toLowerCase();
          if(this.action==='insert'){
            const row={...structuredClone(baseline),id:'synthetic-insert-'+state.rows.length,seen_n:false,seen_v:false,...this.payload[0]};
            if(row['seen_rating_'+own] !== null){row['personal_liked_'+own]=null;row['personal_liked_updated_at_'+own]=null;}
            else if(row['personal_liked_'+own] !== null)row['personal_liked_updated_at_'+own]='2026-10-13T14:00:'+String(++state.clock).padStart(2,'0')+'Z';
            state.rows.push(row);return {data:[structuredClone(row)],error:null};
          }
          const row=state.rows.find(m=>m.id===this.id);
          if (!row) return {data:[],error:null};
          const next={...row,...this.patch};
          if (Object.hasOwn(this.patch,'seen_rating_'+own)) {
            next['personal_liked_'+own]=null; next['personal_liked_updated_at_'+own]=null;
          } else if (Object.hasOwn(this.patch,'personal_liked_'+own)) {
            if (next['seen_rating_'+own] !== null && next['personal_liked_'+own] !== null)
              return {data:null,error:{code:'23514',message:'movies_personal_feedback_'+own+'_exclusive'}};
            next['personal_liked_updated_at_'+own]=next['personal_liked_'+own]===null?null:
              next['personal_liked_'+own]===row['personal_liked_'+own]?row['personal_liked_updated_at_'+own]:
                '2026-10-13T14:00:'+String(++state.clock).padStart(2,'0')+'Z';
          }
          Object.assign(row,next);
          return {data:[structuredClone(row)],error:null};
        };
        if (state.deferred) return new Promise((res,rej)=>{state.finish=()=>{try{res(perform());}catch(e){rej(e);}};}).then(resolve,reject);
        return Promise.resolve().then(perform).then(resolve,reject);
      }
    }; return query;
  } };
  run("sb=server; dbMode='supabase'");
  const sync = () => { ctx.initial=structuredClone(state.rows); run('movies=initial.map(normalizeMoviePersonalFeedback)'); };
  sync();
  const movie = () => run('movies[0]');
  const copy = value => JSON.parse(JSON.stringify(value));
  return {ctx,run,state,calls,el,storage,sync,movie,copy,baseline};
}
let checks=0;
async function test(name,fn) { await fn(); checks++; console.log('PASS '+name); }
(async()=>{
 for (const person of ['N','V']) {
  const own=person.toLowerCase(),other=own==='n'?'v':'n';
  for (const value of [true,false,null]) await test(person+': exact preference patch '+value+', authoritative timestamp/mirror',async()=>{
    const f=fixture(person); assert.equal(await f.ctx.setPersonalPreference('synthetic-film',person,value),true);
    assert.deepEqual(f.calls[0].patch,{['personal_liked_'+own]:value});
    assert.equal(f.movie()['personal_liked_'+own],value);
    assert.equal(f.movie()['personal_liked_updated_at_'+own],f.state.rows[0]['personal_liked_updated_at_'+own]);
    assert.deepEqual(JSON.parse(f.storage.get('scorochiatu_movies'))[0],f.copy(f.movie()));
    for (const field of ['personal_liked_n','personal_liked_v','personal_liked_updated_at_n','personal_liked_updated_at_v']) assert(f.calls[0].fields.split(',').includes(field));
  });
  await test(person+': invalid values/person rejected before I/O',async()=>{
    const f=fixture(person);for(const v of ['true','false',1,0,undefined,{},[]]) assert.equal(await f.ctx.setPersonalPreference('synthetic-film',person,v),false);
    assert.equal(await f.ctx.setPersonalPreference('synthetic-film',person==='N'?'V':'N',true),false);assert.equal(f.calls.length,0);
  });
  await test(person+': rating 0 blocks preference; NULL removal remains valid',async()=>{
    const f=fixture(person);f.state.rows[0]['seen_rating_'+own]=0;f.sync();
    assert.equal(await f.ctx.setPersonalPreference('synthetic-film',person,false),false);assert.equal(f.calls.length,0);
    assert.equal(await f.ctx.setPersonalPreference('synthetic-film',person,null),true);assert.equal(f.movie()['seen_rating_'+own],0);
  });
  for (const text of ['New review','Edited review','']) await test(person+': review-only '+JSON.stringify(text)+' preserves preference and timestamp',async()=>{
    const f=fixture(person);await f.ctx.setPersonalPreference('synthetic-film',person,false);const before=f.copy(f.movie());f.calls.length=0;
    assert.equal(await f.ctx.savePersonalReviewText('synthetic-film',text),true);assert.deepEqual(f.calls[0].patch,{['review_text_'+own]:text});
    assert.deepEqual(f.copy(f.movie()),{...before,['review_text_'+own]:text});
  });
  for (const rating of [0,8.3,null]) await test(person+': intentional rating '+rating+' clears preference and timestamp',async()=>{
    const f=fixture(person);await f.ctx.setPersonalPreference('synthetic-film',person,true);f.calls.length=0;
    assert.equal(await f.ctx.savePersonalReview('synthetic-film',rating),true);assert.deepEqual(f.calls[0].patch,{['seen_rating_'+own]:rating});
    assert.equal(f.movie()['seen_rating_'+own],rating);assert.equal(f.movie()['personal_liked_'+own],null);assert.equal(f.movie()['personal_liked_updated_at_'+own],null);
    assert.equal(JSON.parse(f.storage.get('scorochiatu_movies'))[0]['personal_liked_'+own],null);
  });
  await test(person+': rating + review / edit / removal stay explicit',async()=>{
    const f=fixture(person);assert(await f.ctx.savePersonalReview('synthetic-film',7,'Both fields'));
    assert.deepEqual(f.calls[0].patch,{['seen_rating_'+own]:7,['review_text_'+own]:'Both fields'});
    assert(await f.ctx.savePersonalReview('synthetic-film',9));assert(await f.ctx.savePersonalReview('synthetic-film',null));
    assert.equal(f.movie()['review_text_'+own],'Both fields');
  });
  await test(person+': undo seen preserves every feedback field',async()=>{
    const f=fixture(person);f.state.rows[0]['seen_'+own]=true;f.sync();await f.ctx.setPersonalPreference('synthetic-film',person,false);
    const before=f.copy(f.movie());f.calls.length=0;assert(await f.ctx.undoMovieSeen('synthetic-film',person));
    assert.deepEqual(f.calls[0].patch,{['seen_'+own]:false});assert.deepEqual(f.copy(f.movie()),{...before,['seen_'+own]:false});
  });
  for (const feedback of [0,6.5,true,false,null]) await test(person+': candidacy '+feedback+' final feedback state',async()=>{
    const f=fixture(person);f.state.rows[0]['seen_'+own]=true;
    if(typeof feedback==='number')f.state.rows[0]['seen_rating_'+own]=feedback;
    else if(feedback!==null){f.state.rows[0]['personal_liked_'+own]=feedback;f.state.rows[0]['personal_liked_updated_at_'+own]='2026-10-13T12:00:00Z';}
    f.sync();assert.equal(await f.ctx.updateMovie('synthetic-film',{in_shared_list:true}),feedback!==null);
    if(feedback===null){assert.equal(f.calls.length,0);assert.equal(f.run('dbMode'),'supabase');assert.match(f.ctx.movieMutationErrorMessage(),/feedback/);}
  });
  await test(person+': rating NULL operation removes feedback before candidacy check',async()=>{
    const f=fixture(person);f.state.rows[0]['seen_'+own]=true;f.sync();await f.ctx.setPersonalPreference('synthetic-film',person,false);f.calls.length=0;
    const patch={in_shared_list:true,['seen_rating_'+own]:null};assert.equal(await f.ctx.updateMovie('synthetic-film',patch),false);assert.equal(f.calls.length,0);assert.equal(f.movie()['personal_liked_'+own],false);
  });
  await test(person+': modal review-only preserves stable feedback even if rating changes remotely',async()=>{
    const f=fixture(person);await f.ctx.setPersonalPreference('synthetic-film',person,false);f.ctx.openReviewFor('synthetic-film',person);
    f.state.rows[0]['seen_rating_'+own]=8;f.state.rows[0]['personal_liked_'+own]=null;f.state.rows[0]['personal_liked_updated_at_'+own]=null;f.sync();
    f.el('reviewText').value='Only text';f.calls.length=0;await f.ctx.confirmReview();
    assert.deepEqual(f.calls[0].patch,{['review_text_'+own]:'Only text'});assert.equal(f.state.rows[0]['seen_rating_'+own],8);
  });
  await test(person+': touched empty rating is NULL -> NULL intentional operation',async()=>{
    const f=fixture(person);await f.ctx.setPersonalPreference('synthetic-film',person,true);f.ctx.openReviewFor('synthetic-film',person);
    f.el('reviewRating').value='';f.el('reviewRating').oninput();f.el('reviewText').value='With rating operation';f.calls.length=0;
    await f.ctx.confirmReview();assert.deepEqual(f.calls[0].patch,{['seen_rating_'+own]:null,['review_text_'+own]:'With rating operation'});assert.equal(f.movie()['personal_liked_'+own],null);
  });
  await test(person+': unchanged prefilled rating does not clobber a newer server rating',async()=>{
    const f=fixture(person);f.state.rows[0]['seen_rating_'+own]=8;f.sync();f.ctx.openReviewFor('synthetic-film',person);
    f.state.rows[0]['seen_rating_'+own]=9;f.sync();f.el('reviewText').value='Only review';await f.ctx.confirmReview();
    assert.deepEqual(f.calls[0].patch,{['review_text_'+own]:'Only review'});assert.equal(f.state.rows[0]['seen_rating_'+own],9);
  });
  await test(person+': modal rating-only leaves a newer server review untouched',async()=>{
    const f=fixture(person);f.ctx.openReviewFor('synthetic-film',person);f.state.rows[0]['review_text_'+own]='Newer remote review';f.sync();
    f.el('reviewRating').value='8';f.el('reviewRating').oninput();await f.ctx.confirmReview();
    assert.deepEqual(f.calls[0].patch,{['seen_rating_'+own]:8});assert.equal(f.movie()['review_text_'+own],'Newer remote review');
  });
  await test(person+': unchanged modal save sends no stale writes',async()=>{
    const f=fixture(person);f.ctx.openReviewFor('synthetic-film',person);f.state.rows[0]['review_text_'+own]='Newer remote review';f.sync();await f.ctx.confirmReview();assert.equal(f.calls.length,0);assert.equal(f.movie()['review_text_'+own],'Newer remote review');
  });
  await test(person+': Seen confirmation with untouched fields is seen-only',async()=>{
    const f=fixture(person);f.state.rows[0]['seen_'+own]=false;f.sync();await f.ctx.setPersonalPreference('synthetic-film',person,false);await f.ctx.markSeenUI('synthetic-film');
    f.state.rows[0]['review_text_'+own]='Newer remote review';f.sync();f.calls.length=0;await f.ctx.confirmSeen();
    assert.deepEqual(f.calls[0].patch,{['seen_'+own]:true});assert.equal(f.movie()['personal_liked_'+own],false);assert.equal(f.movie()['review_text_'+own],'Newer remote review');
  });
  await test(person+': stale form identity cannot write',async()=>{const f=fixture(person);f.ctx.openReviewFor('synthetic-film',person);f.ctx.authEpoch++;await f.ctx.confirmReview();assert.equal(f.calls.length,0);});
  await test(person+': text removal exact patch preserves preference',async()=>{
    const f=fixture(person);await f.ctx.setPersonalPreference('synthetic-film',person,false);const ts=f.movie()['personal_liked_updated_at_'+own];f.calls.length=0;
    assert(await f.ctx.removeEvaluationData('synthetic-film',person,'text'));assert.deepEqual(f.calls[0].patch,{['review_text_'+own]:''});assert.equal(f.movie()['personal_liked_'+own],false);assert.equal(f.movie()['personal_liked_updated_at_'+own],ts);
  });
  await test(person+': raw foreign/timestamp/full-row writes rejected',async()=>{
    const f=fixture(person);for(const patch of [{['personal_liked_'+other]:null},{['personal_liked_updated_at_'+own]:null},{['seen_rating_'+other]:null},{...f.movie()}])assert.equal(await f.ctx.updateMovie('synthetic-film',patch),false);
    assert.equal(f.calls.length,0);
  });
  await test(person+': foreign Dislike protects delete and identity',async()=>{const f=fixture(person);f.state.rows[0]['personal_liked_'+other]=false;f.sync();assert.equal(f.ctx.canDeleteOrChangeIdentity(f.movie()),false);});
 }
 for(const error of [{code:'22023',message:'PERSONAL_FEEDBACK_REQUIRED'},{code:'42501',message:'PERSONAL_OWNER_REQUIRED',status:403},{code:'23514',message:'movies_personal_feedback_n_exclusive'},{code:'22P02',message:'invalid input'},{code:'PGRST204',message:'missing schema field'}])await test('business error '+error.code+' never degrades or produces local success',async()=>{
   const f=fixture();f.state.error=error;const before=f.copy(f.movie());assert.equal(await f.ctx.savePersonalReviewText('synthetic-film','Denied'),false);assert.equal(f.run('dbMode'),'supabase');assert.deepEqual(f.copy(f.movie()),before);assert.equal(f.storage.size,0);
 });
 await test('INSERT receives authoritative Dislike/timestamp; no backfill for ordinary insert',async()=>{
   const f=fixture();const inserted=await f.ctx.insertMovie({title:'Synthetic new',seen_n:true,personal_liked_n:false,in_shared_list:true});
   assert.equal(inserted.personal_liked_n,false);assert.equal(inserted.personal_liked_updated_at_n,f.state.rows[1].personal_liked_updated_at_n);assert(!Object.hasOwn(f.calls[0].payload[0],'personal_liked_updated_at_n'));
   const ordinary=await f.ctx.insertMovie({title:'Synthetic ordinary',seen_n:true});assert.equal(ordinary.personal_liked_n,null);assert.equal(ordinary.personal_liked_updated_at_n,null);
 });
 await test('INSERT rating 0 dominates preference; invalid insert feedback/timestamp rejected',async()=>{
   const f=fixture();const row=await f.ctx.insertMovie({title:'Synthetic rated',seen_n:true,seen_rating_n:0,personal_liked_n:true,in_shared_list:true});assert.equal(row.seen_rating_n,0);assert.equal(row.personal_liked_n,null);assert.equal(row.personal_liked_updated_at_n,null);
   f.calls.length=0;for(const value of [{personal_liked_n:'false'},{personal_liked_v:0},{personal_liked_updated_at_n:null},{seen_rating_n:8.34}])assert.equal(await f.ctx.insertMovie({title:'Synthetic invalid',...value}),false);assert.equal(f.calls.length,0);
 });
 await test('metadata-only update does not overwrite stable feedback',async()=>{
   const f=fixture();await f.ctx.setPersonalPreference('synthetic-film','N',false);const before=f.copy(f.movie());f.calls.length=0;
   assert(await f.ctx.updateMovie('synthetic-film',{director:'Synthetic director',poster:'synthetic.jpg'}));assert.deepEqual(f.calls[0].patch,{director:'Synthetic director',poster:'synthetic.jpg'});assert.deepEqual(f.copy(f.movie()),{...before,director:'Synthetic director',poster:'synthetic.jpg'});
 });
 await test('AUTH_REQUIRED/JWT errors do not enter degraded mode',async()=>{
   for(const error of [{code:'42501',message:'AUTH_REQUIRED'},{code:'PGRST301',status:400,message:'JWT invalid'}]){const f=fixture();f.state.error=error;await assert.rejects(f.ctx.savePersonalReviewText('synthetic-film','Denied'),/AUTH_DENIED/);assert.equal(f.run('dbMode'),'supabase');}
 });
 await test('stale local rating cannot bypass DB preference conflict',async()=>{const f=fixture();f.state.rows[0].seen_rating_n=8;assert.equal(await f.ctx.setPersonalPreference('synthetic-film','N',true),false);assert.equal(f.run('dbMode'),'supabase');assert.equal(f.movie().personal_liked_n,null);});
 await test('generic RLS/Auth remains fail-closed',async()=>{const f=fixture();f.state.error={code:'42501',message:'row-level security'};await assert.rejects(f.ctx.savePersonalReviewText('synthetic-film','Denied'),/AUTH_DENIED/);assert.equal(f.run('dbMode'),'supabase');});
 for(const thrown of [false,true])await test('actual network '+(thrown?'throw':'response')+' keeps fallback without local success',async()=>{
   const f=fixture();if(thrown)f.state.throwError=new TypeError('Failed to fetch');else f.state.error={status:0,message:'Network unavailable'};
   const before=f.copy(f.movie());assert.equal(await f.ctx.savePersonalReviewText('synthetic-film','Not saved'),false);assert.equal(f.run('dbMode'),'local');assert.deepEqual(f.copy(f.movie()),before);
 });
 await test('preference unavailable offline; local rating clearing does not invent timestamps',async()=>{
   const f=fixture();await f.ctx.setPersonalPreference('synthetic-film','N',false);const before=f.copy(f.movie());f.calls.length=0;f.run("sb=null;dbMode='local'");
   assert.equal(await f.ctx.setPersonalPreference('synthetic-film','N',true),false);assert.deepEqual(f.copy(f.movie()),before);assert.equal(f.calls.length,0);
   assert(await f.ctx.savePersonalReviewText('synthetic-film','Offline review'));assert.equal(f.movie().personal_liked_n,false);
   assert(await f.ctx.savePersonalReview('synthetic-film',null));assert.equal(f.movie().personal_liked_n,null);assert.equal(f.movie().personal_liked_updated_at_n,null);
 });
 await test('legacy mirror missing feedback normalizes to unknown, no DB write/backfill',async()=>{
   const f=fixture();f.storage.set('scorochiatu_movies',JSON.stringify([{id:'legacy',seen_n:true,seen_rating_n:8}]));f.ctx.loadLocal();const m=f.movie();
   assert.equal(m.personal_liked_n,null);assert.equal(m.personal_liked_v,null);assert.equal(m.personal_liked_updated_at_n,null);assert.equal(m.personal_liked_updated_at_v,null);assert.equal(f.calls.length,0);
 });
 await test('equivalent missing/NULL feedback does not force a Realtime render',async()=>{
   const f=fixture();f.run("for(const key of PERSONAL_PREFERENCE_FIELDS)delete movies[0][key]");await f.ctx.resyncQuiet();assert.equal(f.state.renders||0,0);assert.equal(f.calls.length,0);
   f.state.rows[0].personal_liked_v=false;f.state.rows[0].personal_liked_updated_at_v='2026-10-13T14:00:00Z';await f.ctx.resyncQuiet();assert.equal(f.state.renders,1);
 });
 await test('Realtime/refetch propagates true/false/null and server-cleared preference',async()=>{
   const f=fixture();for(const v of [true,false,null]){f.state.rows[0].personal_liked_v=v;f.state.rows[0].personal_liked_updated_at_v=v===null?null:'2026-10-13T14:00:00Z';await f.ctx.resyncQuiet();assert.equal(f.movie().personal_liked_v,v);assert.equal(JSON.parse(f.storage.get('scorochiatu_movies'))[0].personal_liked_v,v);}
   f.state.rows[0].personal_liked_n=false;f.state.rows[0].personal_liked_updated_at_n='2026-10-13T14:00:00Z';await f.ctx.loadMovies();
   f.state.rows[0].seen_rating_n=0;f.state.rows[0].personal_liked_n=null;f.state.rows[0].personal_liked_updated_at_n=null;await f.ctx.resyncQuiet();assert.equal(f.movie().seen_rating_n,0);assert.equal(f.movie().personal_liked_n,null);assert.equal(f.movie().personal_liked_updated_at_n,null);
 });
 await test('foreign latest state is not overwritten by an update response',async()=>{
   const f=fixture();f.state.rows[0].personal_liked_v=false;f.state.rows[0].personal_liked_updated_at_v='2026-10-13T14:00:00Z';
   f.run("movies[0].personal_liked_v=true;movies[0].personal_liked_updated_at_v='2026-10-13T15:00:00Z'");
   assert(await f.ctx.savePersonalReviewText('synthetic-film','Own review'));assert.equal(f.movie().personal_liked_v,true);assert.equal(f.movie().personal_liked_updated_at_v,'2026-10-13T15:00:00Z');
 });
 await test('late response after identity change never updates mirror',async()=>{
   const f=fixture();f.state.deferred=true;const pending=f.ctx.setPersonalPreference('synthetic-film','N',true);await new Promise(r=>setImmediate(r));assert.equal(typeof f.state.finish,'function');f.ctx.authEpoch++;f.state.finish();await assert.rejects(pending,/AUTH_CHANGED/);assert.equal(f.movie().personal_liked_n,null);assert.equal(f.storage.size,0);
 });
 console.log(`Personal Preference Store: ${checks}/${checks} PASS; synthetic server, no live I/O.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
