#!/usr/bin/env node
// Synthetic fixtures only. No network, application globals, personal exports or writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('../js/recommendation/core');
const C = require('../js/recommendation/config');
const A = require('../js/recommendation/adapters');
let checks = 0;
const test = (name, fn) => { fn(); checks++; console.log('PASS ' + name); };
const near = (a, b) => assert(Math.abs(a - b) < 1e-12, `${a} != ${b}`);
const at = '2026-01-15T00:00:00.000Z';
const feature = changes => ({ genres: ['Synthetic Drama'], directors: ['Director One'],
  cast: ['Actor One', 'Actor Two'], runtimeMinutes: 110, releaseYear: 2005, collectionId: null, ...changes });
const candidate = (movieId, changes) => ({ movieId, title: 'Synthetic ' + movieId,
  inSharedList: true, cinema: false, ...changes });
function context() {
  return { users: [{ id: 'alpha' }, { id: 'beta' }], group: { id: 'synthetic-group' }, asOf: at,
    candidates: [candidate('x')], contentFeatures: { x: feature(), a: feature(), b: feature() },
    personalSignals: { alpha: { ratings: [] }, beta: { ratings: [] } }, sharedSignals: {}, constraints: {} };
}
function ratings(ctx, user, values) { ctx.personalSignals[user] = { ...ctx.personalSignals[user],
  ratings: values.map(([contentId, value]) => ({ contentId, value })) }; return ctx; }
const swipe = (contentId, liked, sessionId = 's1', createdAt = at) => ({ contentId, liked, sessionId, createdAt });
const prediction = ctx => E.recommend(ctx)[0].personal.alpha;
function normalized(ctx) { return Object.fromEntries(Object.entries(ctx.contentFeatures).map(([key, f]) => [key, E.normalizeFeatures(f)])); }
const profile = (ctx, user = 'alpha') => E.buildProfile(ctx.personalSignals[user], normalized(ctx), ctx.asOf);
function deepFreeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }

test('Empirical versioned defaults and immutable configuration', () => {
  assert.equal(C.modelVersion, 'B-G4-protected-v1'); assert.equal(C.configVersion, 'v1.0.0');
  assert.equal(C.ratingAnchor, 7); assert.equal(C.ratingCenterShrinkageTau, 12);
  near(Object.values(C.familyWeights).reduce((a,b)=>a+b), 1);
  assert(Object.isFrozen(C)); assert(Object.isFrozen(C.familyWeights));
});
test('Configuration rejects nonfinite, invalid weights, nonzero quality/seen', () => {
  for (const c of [{ ratingScale: 0 }, { matchWeight: NaN }, { familyWeights: { genre: .9 } },
    { qualityPriorWeight: .1 }, { seenPreferenceWeight: .1 }, { diversity: { maxPerCollection: 0 } },
    { observedConfidence: 0 }, { runtimeBoundaries: [120,100,150] }, { ratingCenterShrinkageTau: -1 }])
    assert.throws(()=>E.configuration(c));
});
test('Overflow-scale configuration rejected before arithmetic',()=>assert.throws(()=>E.configuration({...C,ratingWeight:Number.MAX_VALUE})));
test('Nonfinite shared confidence/freshness rejected',()=>{for(const shared of [{confidence:NaN},{freshness:Infinity},{confidence:'high'}])assert.throws(()=>E.aggregateGroup([{internalScore:5,confidence:0},{internalScore:5,confidence:0}],shared),/shared confidence/);});
test('No observations use anchor without mass', () => {
  near(E.ratingCenter([]),7); assert.equal(profile(context()).totalEvidenceMass,0);
});
test('One-rating center and signal exact', () => { near(E.ratingCenter([9]),93/13); near(E.ratingSignal(9,93/13),(9-93/13)/2.5); });
test('Multiple ratings center exact', () => near(E.ratingCenter([7,8,9]),108/15));
test('Rating zero is valid; booleans/strings/nonfinite/out-of-range invalid', () => {
  assert(E.validRating(0)); for (const x of [false,true,'0',null,undefined,NaN,Infinity,-1,10.1,7.55]) assert(!E.validRating(x));
});
test('Rating upper/lower clamp', () => { near(E.ratingSignal(10,0),1); near(E.ratingSignal(0,10),-1); });
test('Tau/anchor/scale are configurable', () => { const c={...C,ratingAnchor:6,ratingCenterShrinkageTau:2,ratingScale:4};
  near(E.ratingCenter([8],c),20/3); near(E.ratingSignal(8,20/3,c),1/3); });
test('Genre, cast, directors normalized/deduplicated', () => {
  const f=E.normalizeFeatures(feature({genres:[' Dráma ','DRAMA'],cast:['Actor',' actor '],directors:'Jane Doe, John Doe, JANE DOE'}));
  assert.deepEqual(f.genre,['drama']);assert.deepEqual(f.cast,['actor']);assert.deepEqual(f.director,['jane doe','john doe']);
});
for (const [minutes,bucket] of [[99,0],[100,1],[119,1],[120,2],[149,2],[150,3]]) test('Runtime boundary '+minutes,()=>
  assert.deepEqual(E.normalizeFeatures(feature({runtimeMinutes:minutes})).runtime,[String(bucket)]));
for (const value of [null,0,-1,NaN,Infinity,'110 min']) test('Missing/invalid runtime '+String(value),()=>
  assert.deepEqual(E.normalizeFeatures(feature({runtimeMinutes:value})).runtime,[]));
test('Decade and missing metadata',()=>{
  assert.deepEqual(E.normalizeFeatures(feature()).era,['2000']);
  const f=E.normalizeFeatures({});for(const k of Object.keys(C.familyWeights)) assert.deepEqual(f[k],[]);
  assert.deepEqual(E.normalizeFeatures({collectionId:0}).collection,[]);
});
test('Zero data public unknown, internal neutral',()=>{const p=prediction(context());assert.equal(p.score,null);assert.equal(p.internalScore,5);assert.equal(p.confidence,0);assert.equal(p.state,'unknown');});
test('One positive rating gives weak affinity',()=>{const p=prediction(ratings(context(),'alpha',[['a',9]]));assert(p.score>5);assert(p.confidence>0&&p.confidence<.2);assert.equal(p.state,'weak');});
test('Rating below relative center gives negative affinity',()=>{const p=prediction(ratings(context(),'alpha',[['a',0]]));assert(p.score<5);});
test('Observed zero rating retains factual evidence',()=>{const p=prediction(ratings(context(),'alpha',[['x',0]]));assert.equal(p.state,'observed');assert.equal(p.score,0);assert.equal(p.confidence,C.observedConfidence);assert.equal(p.reasons[0].code,'PERSONAL_RATING_OBSERVED');});
test('Observed score uses same normalization',()=>{const p=prediction(ratings(context(),'alpha',[['x',9]]));near(p.score,5+5*(9-93/13)/2.5);});
test('Estimated threshold configurable',()=>{const ctx=ratings(context(),'alpha',[['a',9]]);assert.equal(E.recommend(ctx,{...C,estimatedConfidenceThreshold:.001})[0].personal.alpha.state,'estimated');});
test('Unseen features produce no affinity/confidence',()=>{const ctx=ratings(context(),'alpha',[['a',9]]);ctx.contentFeatures.x={genres:['New'],directors:['New'],cast:['New'],collectionId:900};assert.equal(prediction(ctx).score,null);});
test('Missing families not reweighted',()=>{const ctx=ratings(context(),'alpha',[['a',9]]);ctx.contentFeatures.x={genres:['Synthetic Drama']};const p=prediction(ctx);near(p.internalScore,5+5*.3*((9-93/13)/2.5)/(1+3));});
test('Eight cast tokens distribute one observation mass',()=>{const ctx=ratings(context(),'alpha',[['a',9]]);ctx.contentFeatures.a.cast=Array.from({length:8},(_,i)=>'Actor '+i);const p=profile(ctx);near([...p.stats.cast.values()].reduce((s,x)=>s+x.evidenceMass,0),1);near(p.stats.cast.get('actor 0').evidenceMass,1/8);});
test('Duplicate rating and tokens do not inflate evidence',()=>{const ctx=ratings(context(),'alpha',[['a',9],['a',9]]);ctx.contentFeatures.a.genres.push('Synthetic Drama');near(profile(ctx).totalEvidenceMass,1);near(profile(ctx).stats.genre.get('synthetic drama').evidenceMass,1);});
test('Conflicting duplicate rating rejected independently of order',()=>{const ctx=ratings(context(),'alpha',[['a',9],['a',8]]);assert.throws(()=>E.recommend(ctx));ctx.personalSignals.alpha.ratings.reverse();assert.throws(()=>E.recommend(ctx));});
test('Seen-only neutral even with large history',()=>{const ctx=context();ctx.personalSignals.alpha.seen=Array.from({length:350},(_,i)=>'seen-'+i);assert.equal(prediction(ctx).score,null);assert.equal(prediction(ctx).confidence,0);});
test('Seen modifications leave all output unchanged',()=>{const ctx=ratings(context(),'alpha',[['a',9]]);const before=E.recommend(ctx);ctx.personalSignals.alpha.seen=['x','a','b'];assert.deepEqual(E.recommend(ctx),before);});
test('Match absent supported',()=>assert.equal(E.recommend(context()).length,1));
for(const liked of [true,false]) test('Contextual Match '+liked,()=>{const ctx=context();ctx.personalSignals.alpha.match=[swipe('a',liked)];const p=prediction(ctx);assert(liked?p.score>5:p.score<5);near(profile(ctx).totalEvidenceMass,.25);});
test('Freshness halves after 14 days',()=>{const ctx=context();ctx.personalSignals.alpha.match=[swipe('a',true,'s','2026-01-01T00:00:00Z')];near(profile(ctx).totalEvidenceMass,.125);});
test('Explicit asOf mandatory, timezone-less rejected',()=>{const ctx=context();delete ctx.asOf;assert.throws(()=>E.recommend(ctx));ctx.asOf='2026-01-15';assert.throws(()=>E.recommend(ctx));});
test('Invalid Match timestamps never invent evidence',()=>{const ctx=context();ctx.personalSignals.alpha.match=[swipe('a',true,'s','invalid')];assert.equal(prediction(ctx).score,null);});
test('Rating prevails over Match same content',()=>{const ctx=ratings(context(),'alpha',[['a',9]]);const before=prediction(ctx);ctx.personalSignals.alpha.match=[swipe('a',false)];assert.deepEqual(prediction(ctx),before);near(profile(ctx).totalEvidenceMass,1);});
test('Repeated sessions bounded; exact duplicates collapse',()=>{const ctx=context();ctx.personalSignals.alpha.match=Array.from({length:20},(_,i)=>swipe('a',true,'s'+i));ctx.personalSignals.alpha.match.push({...ctx.personalSignals.alpha.match[0]});near(profile(ctx).totalEvidenceMass,.25);assert.equal(profile(ctx).observations.length,1);});
test('Mixed sessions collapse deterministically',()=>{const ctx=context();ctx.personalSignals.alpha.match=[swipe('a',true,'s1'),swipe('a',false,'s2')];near(profile(ctx).observations[0].signal,0);const before=E.recommend(ctx);ctx.personalSignals.alpha.match.reverse();assert.deepEqual(E.recommend(ctx),before);});
test('Conflicting duplicate session response rejected',()=>{const ctx=context();ctx.personalSignals.alpha.match=[swipe('a',true),swipe('a',false)];assert.throws(()=>E.recommend(ctx));});
test('Future timestamps capped at freshness one',()=>{const ctx=context();ctx.personalSignals.alpha.match=[swipe('a',true,'s','2027-01-01T00:00:00Z')];near(profile(ctx).totalEvidenceMass,.25);});
for(const [n,v,cn,cv,expected] of [[8,8,.9,.9,7.7],[9.5,3,.9,.9,3.2],[7,9,.5,.5,6],[9,5,.9,0,5],[5,9,0,.9,5],[3,5,.9,0,3.2],[5,3,0,.9,3.2],[5,5,0,0,5],[8,8,.15,.15,5.45]])
  test('G4 protected '+[n,v,cn,cv].join('/'),()=>{
    const p=[{internalScore:n,confidence:cn},{internalScore:v,confidence:cv}];near(E.aggregateGroup(p).score,expected);near(E.aggregateGroup(p.slice().reverse()).score,expected);
  });
test('Shared positive cannot hide strong negative; negative retained',()=>{const p=[{internalScore:3,confidence:.9},{internalScore:8,confidence:.9}];const g=E.aggregateGroup(p,{together:.1,match:.03,confidence:.5});near(g.score,3.2);assert(g.sharedPositiveSuppressed);near(E.aggregateGroup(p,{together:-.1,match:-.04}).score,3.06);});
test('Together profile separate from personal users',()=>{const ctx=context();ctx.sharedSignals.ratings=[{contentId:'a',value:9},{contentId:'b',value:9}];const r=E.recommend(ctx)[0];assert.equal(r.personal.alpha.score,null);assert.equal(r.personal.beta.score,null);assert(r.group.score>5);assert(r.reasons.some(x=>x.code==='TOGETHER_RATING_AFFINITY'));});
test('Together completed exposure alone does not create taste',()=>{const ctx=context();ctx.sharedSignals.events=[{movieId:'a',status:'completed'}];assert.equal(E.recommend(ctx)[0].group.score,5);});
for (const liked of [true,false]) test('Shared double response '+liked,()=>{const ctx=context();for(const u of ['alpha','beta'])ctx.personalSignals[u].match=[swipe('x',liked)];const r=E.recommend(ctx)[0];near(r.group.contributions.match,liked?.03:-.04);assert(r.reasons.some(x=>x.code===(liked?'DOUBLE_MATCH_LIKE':'DOUBLE_MATCH_NOPE')));});
test('Disagreement has no shared bonus',()=>{const ctx=context();ctx.personalSignals.alpha.match=[swipe('x',true)];ctx.personalSignals.beta.match=[swipe('x',false)];near(E.recommend(ctx)[0].group.contributions.match,0);});
test('Different sessions never produce artificial Double Like',()=>{const ctx=context();ctx.personalSignals.alpha.match=[swipe('x',true,'s1')];ctx.personalSignals.beta.match=[swipe('x',true,'s2')];near(E.recommend(ctx)[0].group.contributions.match,0);});
test('Latest complete shared session wins deterministically',()=>{const ctx=context();for(const u of ['alpha','beta'])ctx.personalSignals[u].match=[swipe('x',true,'s1','2026-01-01T00:00:00Z'),swipe('x',false,'s2')];near(E.recommend(ctx)[0].group.contributions.match,-.04);});
test('Together cap and suppression reasons match applied contribution',()=>{const ctx=ratings(context(),'alpha',[['x',0]]);ctx.sharedSignals.ratings=[{contentId:'x',value:10}];for(const u of ['alpha','beta'])ctx.personalSignals[u].match=[swipe('x',true)];const r=E.recommend(ctx)[0];near(r.group.contributions.together,0);near(r.group.contributions.match,0);assert(r.reasons.filter(x=>x.suppressed).every(x=>x.scoreContribution===0));});
for(const status of ['completed','proposed','confirmed','cancelled','skipped'])test('Eligibility event '+status,()=>{const ctx=context();ctx.sharedSignals.events=[{movieId:'x',status}];assert.equal(E.recommend(ctx).length,['completed','proposed','confirmed'].includes(status)?0:1);});
test('Completed IDs block candidate',()=>{const ctx=context();ctx.sharedSignals.completedMovieIds=['x'];assert.equal(E.recommend(ctx).length,0);});
test('Shared list false excluded',()=>{const ctx=context();ctx.candidates[0].inSharedList=false;assert.equal(E.recommend(ctx).length,0);});
for(const seen of [['x'],[],['a','x']])test('Personal seen eligibility '+seen.join(','),()=>{const ctx=context();for(const u of ['alpha','beta'])ctx.personalSignals[u].seen=seen;assert.equal(E.recommend(ctx).length,1);});
for(const mode of ['streaming','cinema','all'])test('Cinema context '+mode,()=>{const ctx=context();ctx.candidates.push(candidate('y',{cinema:true}));ctx.contentFeatures.y=feature();ctx.constraints.context=mode;assert.deepEqual(E.recommend(ctx).map(x=>x.movieId),mode==='all'?['x','y']:mode==='cinema'?['y']:['x']);});
test('Explicit genre OR constraint on normalized names',()=>{const ctx=context();ctx.constraints.genres=['new',' SYNTHETIC DRAMA '];assert.equal(E.recommend(ctx).length,1);ctx.constraints.genres=['new'];assert.equal(E.recommend(ctx).length,0);});
test('Explicit duration boundaries and factual context',()=>{const ctx=context();ctx.constraints={minRuntimeMinutes:110,maxRuntimeMinutes:110};assert(E.recommend(ctx)[0].reasons.some(r=>r.code==='RUNTIME_CONTEXT'));ctx.constraints.maxRuntimeMinutes=109;assert.throws(()=>E.recommend(ctx));ctx.constraints.minRuntimeMinutes=90;assert.equal(E.recommend(ctx).length,0);});
test('Missing metadata never declared compatible with requested constraint',()=>{const ctx=context();ctx.contentFeatures.x={};ctx.constraints={maxRuntimeMinutes:120};assert.equal(E.recommend(ctx).length,0);ctx.constraints={genres:['Synthetic Drama']};assert.equal(E.recommend(ctx).length,0);});
test('Explicit exclusion and candidate deduplication',()=>{const ctx=context();ctx.candidates.push({...ctx.candidates[0]});assert.equal(E.recommend(ctx).length,1);ctx.constraints.excludeMovieIds=['x'];assert.equal(E.recommend(ctx).length,0);});
test('Conflicting candidate duplicate rejected',()=>{const ctx=context();ctx.candidates.push(candidate('x',{inSharedList:false}));assert.throws(()=>E.recommend(ctx));});
test('Reasons require entity-specific support and actual provenance',()=>{const ctx=ratings(context(),'alpha',[['a',9]]);ctx.contentFeatures.a.directors=['One'];ctx.contentFeatures.b.directors=['Two'];ctx.contentFeatures.x.directors=['One','Two'];ctx.personalSignals.alpha.ratings.push({contentId:'b',value:9});const r=prediction(ctx);assert(!r.reasons.some(x=>x.code==='DIRECTOR_RELATIVE_AFFINITY'));assert(r.reasons.some(x=>x.code==='GENRE_RELATIVE_AFFINITY'));for(const reason of r.reasons){assert(reason.evidenceMovieIds.length>=2);assert.equal(new Set(reason.evidenceMovieIds).size,reason.evidenceMovieIds.length);}});
test('Supported named director/cast; no collection preference from seen',()=>{const ctx=ratings(context(),'alpha',[['a',9],['b',9]]);const p=prediction(ctx);assert(p.reasons.some(x=>x.code==='DIRECTOR_RELATIVE_AFFINITY'&&x.token==='director one'));assert(p.reasons.some(x=>x.code==='CAST_RELATIVE_AFFINITY'&&x.token==='actor one'));assert(!p.reasons.some(x=>x.code==='COLLECTION_RATED_AFFINITY'));});
test('Insignificant/zero-weight inferred contributions do not emit reasons',()=>{const ctx=ratings(context(),'alpha',[['a',9],['b',9]]);const c={...C,reasonMinContribution:10};assert.equal(E.recommend(ctx,c)[0].personal.alpha.reasons.length,0);});
test('Collection rated reason cannot be inferred from contextual Match alone',()=>{const ctx=context();for(const f of Object.values(ctx.contentFeatures))f.collectionId=100;ctx.personalSignals.alpha.match=[swipe('a',true),swipe('b',true)];assert(!prediction(ctx).reasons.some(r=>r.code==='COLLECTION_RATED_AFFINITY'));});
test('Collection rated reason has two attributed rated contents',()=>{const ctx=ratings(context(),'alpha',[['a',9],['b',9]]);for(const f of Object.values(ctx.contentFeatures))f.collectionId=100;assert(prediction(ctx).reasons.some(r=>r.code==='COLLECTION_RATED_AFFINITY'&&r.ratingSupport===2));});
test('Shared freshness never becomes taste confidence',()=>{const ctx=context();for(const u of ['alpha','beta'])ctx.personalSignals[u].match=[swipe('x',true)];const r=E.recommend(ctx)[0];assert.equal(r.group.sharedEvidenceConfidence,0);assert.equal(r.group.sharedContextFreshness,1);});
test('Direct Together reason factual, never personal evidence',()=>{const ctx=context();ctx.sharedSignals.ratings=[{contentId:'x',value:9}];const r=E.recommend(ctx)[0];const reason=r.reasons.find(r=>r.code==='TOGETHER_RATING_AFFINITY');assert.equal(reason.kind,'factual');assert(reason.evidence.every(r=>r.code!=='PERSONAL_RATING_OBSERVED'));assert.equal(r.personal.alpha.state,'unknown');});
test('Zero Match weights remove all valenced Match contributions',()=>{const ctx=context();for(const u of ['alpha','beta'])ctx.personalSignals[u].match=[swipe('x',true)];const r=E.recommend(ctx,{...C,matchWeight:0,doubleLikeContribution:0,doubleNopeContribution:0})[0];assert.equal(r.personal.alpha.score,null);assert.equal(r.group.score,5);assert(!r.reasons.some(r=>r.code.includes('MATCH')));});

function listContext(n, changes={}) { const ctx=context();ctx.candidates=Array.from({length:n},(_,i)=>candidate('c'+i));ctx.contentFeatures=Object.fromEntries(ctx.candidates.map(m=>[m.movieId,feature(changes)]));return ctx; }
for(const n of [0,1,3,8])test('Diversity size/pool '+n,()=>{const r=E.recommend(listContext(n));assert.equal(E.rerank(r).length,Math.min(n,5));assert.equal(E.rerank(r,0).length,0);});
test('Collection cap never automatically relaxed',()=>{const r=E.recommend(listContext(8,{collectionId:100}));assert.equal(E.rerank(r).length,1);});
test('Missing collections do not form one artificial franchise',()=>assert.equal(E.rerank(E.recommend(listContext(8))).length,5));
test('Genre/director penalties, preserved suitability, distinct presentation',()=>{const r=E.recommend(listContext(8));const before=JSON.stringify(r);const out=E.rerank(r);assert.equal(JSON.stringify(r),before);assert.equal(out[0].diversityAdjustment,0);assert(out[1].diversityAdjustment<0);for(const row of out){near(row.group.score,r.find(x=>x.movieId===row.movieId).group.score);near(row.presentationScore,row.group.score+row.diversityAdjustment);assert(row.reasons.some(x=>x.code==='DIVERSITY_SELECTION'));}assert.equal(new Set(out.map(x=>x.movieId)).size,out.length);});
test('Diversity does not accumulate duplicates',()=>{const r=E.recommend(listContext(3));assert.equal(E.rerank([...r,...r]).length,3);});
test('Rerank respects pool size',()=>{const r=E.recommend(listContext(8));assert.equal(E.rerank(r,5,{...C,diversity:{...C.diversity,rerankPoolSize:2}}).length,2);});

const movie = (movieId, changes={}) => ({ id:movieId,title:'Synthetic '+movieId,in_shared_list:true,
  genres:['Synthetic Drama'],director:'Director One',cast_names:['Actor One','Actor Two'],duration:'110 min',release_year:2005,...changes });
test('Adapter maps opaque users, personal and Together independently',()=>{const ctx=A.fromMovies({movies:[movie('x',{seen_n:true,seen_rating_n:0,seen_rating_together:9})],asOf:at,userIds:{N:'opaque-1',V:'opaque-2'}});assert.equal(ctx.personalSignals['opaque-1'].ratings[0].value,0);assert.equal(ctx.personalSignals['opaque-2'].ratings.length,0);assert.equal(ctx.sharedSignals.ratings[0].value,9);assert.equal(E.recommend(ctx)[0].personal['opaque-1'].state,'observed');});
test('Adapter includes history for profiles but shared list only for candidates',()=>{const ctx=A.fromMovies({movies:[movie('x'),movie('history',{in_shared_list:false,seen_rating_n:9})],asOf:at});assert.equal(E.recommend(ctx).length,1);assert(E.recommend(ctx)[0].personal.N.score>5);});
test('Adapter Match optional and explicit only',()=>{const ctx=A.fromMovies({movies:[movie('x')],asOf:at,matchHistory:[{movie_id:'x',person:'N',liked:true,session_id:'s',created_at:at}]});assert.equal(ctx.personalSignals.N.match.length,1);assert(E.recommend(ctx)[0].personal.N.score>5);});
for(const [input,expected] of [['110 min',110],['110',110],[110,110],['-10 min',null],['1h 50min',null],['N/A',null],[Infinity,null]])test('Adapter strict duration '+input,()=>assert.equal(A.runtimeMinutes(input),expected));
test('Surprise/Veto/external quality and added_by cannot alter v1',()=>{const m=[movie('x'),movie('a',{in_shared_list:false,seen_rating_n:9})];const before=E.recommend(A.fromMovies({movies:m,asOf:at}));for(const row of m)Object.assign(row,{surprise_by:'V',vetoes:['x'],imdb_rating:'0',rt_rating:'0%',metacritic_rating:'0',added_by:'V'});const after=E.recommend(A.fromMovies({movies:m,asOf:at,vetoes:[{movie_id:'x'}]}));assert.deepEqual(after,before);});
test('Adapter dedup equivalent movie rows/token order',()=>{const a=movie('x');const b={...a,genres:a.genres.slice().reverse(),cast_names:a.cast_names.slice().reverse()};assert.equal(E.recommend(A.fromMovies({movies:[a,b],asOf:at})).length,1);});
test('Core ignores deprecated and external fields even without adapter',()=>{const ctx=context();const before=E.recommend(ctx);ctx.vetoes=['x'];ctx.candidates[0].surprise_by='any';ctx.contentFeatures.x.imdb_rating=10;ctx.sharedSignals.vetoes=['x'];assert.deepEqual(E.recommend(ctx),before);});
test('Opaque content ID cannot resolve inherited feature properties',()=>{const ctx=context();ctx.candidates=[candidate('constructor')];ctx.contentFeatures={};assert.equal(E.recommend(ctx)[0].personal.alpha.score,null);});
test('Deterministic output on frozen inputs, config and repeated calls',()=>{const ctx=deepFreeze(ratings(context(),'alpha',[['a',9],['b',8]]));assert.deepEqual(E.recommend(ctx),E.recommend(ctx));});
test('Input permutations preserve exact output',()=>{const ctx=listContext(8);ctx.contentFeatures.a=feature();ctx.contentFeatures.b=feature();ratings(ctx,'alpha',[['a',9],['b',8]]);ctx.personalSignals.beta.match=[swipe('a',true,'z'),swipe('b',false,'y')];const before=E.recommend(ctx);ctx.candidates.reverse();ctx.users.reverse();ctx.personalSignals.alpha.ratings.reverse();ctx.personalSignals.beta.match.reverse();for(const f of Object.values(ctx.contentFeatures)){f.genres.reverse();f.cast.reverse();f.directors.reverse();}assert.deepEqual(E.recommend(ctx),before);});
test('Opaque dangerous property names cannot corrupt user mapping',()=>{const ctx=context();ctx.users=[{id:'__proto__'},{id:'constructor'}];ctx.personalSignals=Object.fromEntries([['__proto__',{ratings:[{contentId:'a',value:9}]}],['constructor',{}]]);assert(E.recommend(ctx)[0].personal.__proto__.score>5);});
test('No implicit environment access in browser-style module loading',()=>{
  const math=Object.create(Math);math.random=()=>{throw Error('random forbidden');};
  class ExplicitDate extends Date { static now(){throw Error('clock forbidden');} }
  const sandbox={Math:math,Date:ExplicitDate};
  for(const key of ['document','localStorage','sessionStorage','currentUser','movies','movieNights','sb'])
    Object.defineProperty(sandbox,key,{get(){throw Error('global forbidden: '+key);}});
  const ctx=vm.createContext(sandbox);
  for(const f of ['config','core','adapters'])vm.runInContext(fs.readFileSync('js/recommendation/'+f+'.js','utf8'),ctx);
  ctx.input=context();const result=vm.runInContext('RecommendationEngine.recommend(input)',ctx);assert.equal(result.length,1);
});
test('Synthetic property matrix: bounds, uniqueness, provenance and symmetry',()=>{
  for(let n=0;n<=10;n++)for(const value of [0,4,7,9,10]){
    const ctx=listContext(n);ctx.contentFeatures.a=feature();ratings(ctx,'alpha',[['a',value]]);
    const results=E.recommend(ctx);assert.equal(new Set(results.map(r=>r.movieId)).size,n);
    for(const r of results){assert(Number.isFinite(r.group.score)&&r.group.score>=0&&r.group.score<=10);for(const p of Object.values(r.personal)){assert(p.confidence>=0&&p.confidence<=1);assert(Number.isFinite(p.internalScore));}for(const reason of r.reasons){assert(reason.evidenceMovieIds.length);assert.equal(new Set(reason.evidenceMovieIds).size,reason.evidenceMovieIds.length);}}
    const swapped={...ctx,users:ctx.users.slice().reverse()};assert.deepEqual(E.recommend(swapped),results);
    assert.equal(E.rerank(results).length,Math.min(n,5));
  }
});
test('Exactly two opaque users required by recommend and group v1',()=>{
  for(const n of [0,1,3]){const ctx=context();ctx.users=Array.from({length:n},(_,i)=>({id:'opaque-'+i}));
    assert.throws(()=>E.recommend(ctx),/exactly 2/);
    assert.throws(()=>E.aggregateGroup(Array.from({length:n},()=>({internalScore:5,confidence:0}))),/exactly 2/);}
  assert.throws(()=>E.configuration({...C,supportedGroupSize:3}),/exactly 2/);
});
test('Opaque user/content keys preserved without silent whitespace aliasing',()=>{
  const ctx=context();ctx.users=[{id:' alpha '},{id:'beta'}];ctx.personalSignals={' alpha ':{ratings:[{contentId:' a ',value:9}]},beta:{}};
  ctx.contentFeatures[' a ']=ctx.contentFeatures.a;delete ctx.contentFeatures.a;
  assert(E.recommend(ctx)[0].personal[' alpha '].score>5);
  const adapted=A.fromMovies({movies:[movie('x'),movie('a',{in_shared_list:false,seen_rating_n:9})],asOf:at,userIds:{N:' member-a ',V:'member-b'}});
  assert(E.recommend(adapted)[0].personal[' member-a '].score>5);
});
test('Runtime numeric-string overflow is missing, never Infinity',()=>assert.equal(A.runtimeMinutes('9'.repeat(400)+' min'),null));
test('Rerank stable before limiting pool, frozen inputs untouched',()=>{
  const r=E.recommend(listContext(40));const config=deepFreeze({...C,diversity:{...C.diversity,rerankPoolSize:3}});
  const before=E.rerank(r,5,config);deepFreeze(r);
  assert.deepEqual(E.rerank(r.slice().reverse(),5,config),before);
  assert.deepEqual(E.rerank(r,5,config),before);
});
test('Conflicting duplicate ranked result rejected in either order',()=>{
  const r=E.recommend(listContext(1));const other={...r[0],group:{...r[0].group,score:6}};
  assert.throws(()=>E.rerank([r[0],other]),/Conflicting duplicate/);
  assert.throws(()=>E.rerank([other,r[0]]),/Conflicting duplicate/);
});
console.log(`Recommendation: ${checks}/${checks} PASS`);
