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
function listContext(n, changes={}) { const ctx=context();ctx.candidates=Array.from({length:n},(_,i)=>candidate('c'+i));ctx.contentFeatures=Object.fromEntries(ctx.candidates.map(m=>[m.movieId,feature(changes)]));return ctx; }
for(const n of [0,1,3,8])test('Diversity size/pool '+n,()=>{const r=E.recommend(listContext(n));assert.equal(E.rerank(r).length,Math.min(n,5));assert.equal(E.rerank(r,0).length,0);});
test('Collection cap never automatically relaxed',()=>{const r=E.recommend(listContext(8,{collectionId:100}));assert.equal(E.rerank(r).length,1);});
test('Missing collections do not form one artificial franchise',()=>assert.equal(E.rerank(E.recommend(listContext(8))).length,5));
test('Genre/director penalties, preserved suitability, distinct presentation',()=>{const r=E.recommend(listContext(8));const before=JSON.stringify(r);const out=E.rerank(r);assert.equal(JSON.stringify(r),before);assert.equal(out[0].diversityAdjustment,0);assert(out[1].diversityAdjustment<0);for(const row of out){near(row.group.score,r.find(x=>x.movieId===row.movieId).group.score);near(row.presentationScore,row.group.score+row.diversityAdjustment);assert(row.reasons.some(x=>x.code==='DIVERSITY_SELECTION'));}assert.equal(new Set(out.map(x=>x.movieId)).size,out.length);});
test('Diversity does not accumulate duplicates',()=>{const r=E.recommend(listContext(3));assert.equal(E.rerank([...r,...r]).length,3);});
test('Rerank respects pool size',()=>{const r=E.recommend(listContext(8));assert.equal(E.rerank(r,5,{...C,diversity:{...C.diversity,rerankPoolSize:2}}).length,2);});

for(const [input,expected] of [['110 min',110],['110',110],[110,110],['-10 min',null],['1h 50min',null],['N/A',null],[Infinity,null]])test('Adapter strict duration '+input,()=>assert.equal(A.runtimeMinutes(input),expected));

const movie = (movieId, changes={}) => ({ id:movieId,title:'Synthetic '+movieId,in_shared_list:true,genres:['Synthetic Drama'],director:'Director One',cast_names:['Actor One','Actor Two'],duration:'110 min',release_year:2005,...changes });

test('Versioned frozen stable-only config, no active Match parameters',()=>{
 assert.equal(C.modelVersion,'stable-G4-polarity-v2');assert.equal(C.configVersion,'v2.0.0');
 assert(Object.isFrozen(C)&&Object.isFrozen(C.familyWeights));near(Object.values(C.familyWeights).reduce((a,b)=>a+b),1);
 assert.equal(C.preferenceWeight,.5);assert.equal(C.ratingWeight,1);
 for(const k of ['matchWeight','matchHalfLifeDays','matchSignalMagnitude','doubleLikeContribution','doubleNopeContribution']){assert(!Object.hasOwn(C,k));assert.throws(()=>E.configuration({[k]:0}),/Removed/);}
});
for(const invalid of [{ratingScale:0},{preferenceWeight:NaN},{relativeAdjustment:-1},{ratingWeight:Number.MAX_VALUE},{familyWeights:{genre:.9}},{seenPreferenceWeight:.1},{qualityPriorWeight:.1},{negativeProtectionCap:5},{ratingNegativeBoundary:5},{supportedGroupSize:3},{diversity:{maxPerCollection:0}}])test('Invalid config '+JSON.stringify(invalid),()=>assert.throws(()=>E.configuration(invalid)));
for(const value of [false,true,'0',null,undefined,NaN,Infinity,-1,10.1,7.55])test('Invalid rating '+String(value),()=>assert(!E.validRating(value)));
for(const [value,polarity] of [[0,'NEGATIVE'],[5,'NEGATIVE'],[5.4,'NEGATIVE'],[5.5,'NEUTRAL'],[6,'NEUTRAL'],[6.5,'NEUTRAL'],[6.9,'NEUTRAL'],[7,'POSITIVE'],[8,'POSITIVE'],[9.5,'POSITIVE'],[10,'POSITIVE']]){
 test('Boundary/direct semantics '+value,()=>{
  assert(E.validRating(value));assert.equal(E.ratingPolarity(value),polarity);
  const p=prediction(ratings(context(),'alpha',[['x',value]]));assert.equal(p.observedRating,value);assert.equal(p.observedPreference,null);assert.equal(p.absolutePolarity,polarity);assert.equal(p.provenance,'PERSONAL_RATING_'+polarity);assert.equal(p.state,'OBSERVED');assert.equal(p.informationRichness,1);near(p.confidence,.95);
  for(const center of [0,7,9.5,10]){const r=E.ratingSignal(value,center);assert(polarity==='NEUTRAL'?r===0:polarity==='POSITIVE'?r>=0:r<=0);}
 });
}
test('Formula exact and configurable absolute/relative transform',()=>{
 const center=E.ratingCenter([9]);near(center,93/13);near(E.ratingSignal(9,center),(9-6.25)/3.75+.1*(9-center)/2.5);
 near(E.ratingCenter([8],{...C,ratingAnchor:6,ratingCenterShrinkageTau:2}),20/3);
 near(E.ratingSignal(8,8,{...C,ratingAbsoluteAnchor:6,ratingAbsoluteScale:4}),.5);
});
test('F1: 19x9.5 + 8 never negative despite relative below center',()=>{
 const ctx=context();ctx.personalSignals.alpha.ratings=[...Array.from({length:19},(_,i)=>({contentId:'high'+i,value:9.5})),{contentId:'x',value:8}];
 const prof=profile(ctx),p=prediction(ctx),g=E.recommend(ctx)[0].group;
 near(prof.center,8.515625);assert(p.relativeRatingAffinity<0);assert.equal(p.absolutePolarity,'POSITIVE');assert(p.stableSignal>0);assert(p.internalScore>5);assert(!g.negativeProtectionApplied);
 near(p.internalScore,5+5*((8-6.25)/3.75+.1*(8-prof.center)/2.5));
});
for(const value of [true,false,null,undefined])test('Preference tri-state '+String(value),()=>{
 const ctx=context();ctx.personalSignals.alpha.preferences=[{contentId:'x',value}];const p=prediction(ctx),prof=profile(ctx);
 if(typeof value==='boolean'){assert.equal(p.observedRating,null);assert.equal(p.observedPreference,value);assert.equal(p.provenance,value?'EXPLICIT_LIKE':'EXPLICIT_DISLIKE');near(prof.totalEvidenceMass,.5);near(p.internalScore,5+5*(value?1:-1)*(.5/3.5));near(p.confidence,.95*.5/3.5);near(p.observationReliability,.95);}
 else {assert.equal(prof.totalEvidenceMass,0);assert.equal(p.score,null);assert.equal(p.confidence,0);assert.equal(p.state,'UNKNOWN');}
});
for(const rating of [0,6,8.5])for(const value of [true,false])test('Rating wins contradictory fixture '+rating+'/'+value,()=>{
 const ctx=ratings(context(),'alpha',[['x',rating]]),before=E.recommend(ctx);ctx.personalSignals.alpha.preferences=[{contentId:'x',value}];assert.deepEqual(E.recommend(ctx),before);near(profile(ctx).totalEvidenceMass,1);
 // No hidden preference history or restoration exists in the core: removal snapshot is explicit NULL.
 ctx.personalSignals.alpha.ratings=[];ctx.personalSignals.alpha.preferences=[{contentId:'x',value:null}];assert.equal(prediction(ctx).state,'UNKNOWN');
});
test('Duplicate ratings/preferences and conflicts deterministic, rating masks obsolete preference conflict',()=>{
 const ctx=ratings(context(),'alpha',[['a',9],['a',9]]);near(profile(ctx).totalEvidenceMass,1);ctx.personalSignals.alpha.ratings.push({contentId:'a',value:8});assert.throws(()=>profile(ctx));
 const pref=context();pref.personalSignals.alpha.preferences=[{contentId:'a',value:false},{contentId:'a',value:false}];near(profile(pref).totalEvidenceMass,.5);pref.personalSignals.alpha.preferences.push({contentId:'a',value:true});assert.throws(()=>profile(pref));pref.personalSignals.alpha.ratings=[{contentId:'a',value:0}];near(profile(pref).totalEvidenceMass,1);
});
test('Unknown differs structurally from observed neutral and neutral feature support',()=>{
 const unknown=prediction(context()),neutral=prediction(ratings(context(),'alpha',[['x',6]]));assert.equal(unknown.score,null);assert.equal(unknown.confidence,0);assert.equal(neutral.observedRating,6);near(neutral.score,5);assert(neutral.confidence>0);
 const inferred=prediction(ratings(context(),'alpha',Array.from({length:20},(_,i)=>['a'+i,6])));assert.equal(inferred.state,'UNKNOWN'); // No matching feature metadata.
 const ctx=ratings(context(),'alpha',[['a',6],['b',6]]);const p=prediction(ctx);near(p.internalScore,5);assert(p.confidence>0);assert.equal(p.state,'LOW_EVIDENCE');assert.equal(p.score,null);
});
test('Preference feature evidence, collection and support; no synthetic rating',()=>{
 const ctx=context();for(const f of Object.values(ctx.contentFeatures))f.collectionId=100;
 ctx.personalSignals.alpha.preferences=Array.from({length:12},(_,i)=>({contentId:'liked'+i,value:true}));for(let i=0;i<12;i++)ctx.contentFeatures['liked'+i]=feature({collectionId:100});
 const prof=profile(ctx),p=prediction(ctx);assert.equal(prof.center,7);near(prof.totalEvidenceMass,6);assert(p.score>5);assert(p.confidence>.2);assert.equal(p.state,'INFERRED');assert(p.reasons.some(r=>r.code==='FEATURE_AFFINITY'&&r.family==='collection'&&r.preferenceSupport===12));
 assert(prof.observations.every(o=>o.source==='preference'&&typeof o.value==='boolean'));assert(prof.stats.genre.get('synthetic drama').signedMass>0);
});
test('Mass distributed over feature tokens, missing families not reweighted',()=>{
 const ctx=ratings(context(),'alpha',[['a',9]]);ctx.contentFeatures.a.cast=Array.from({length:8},(_,i)=>'Actor '+i);near([...profile(ctx).stats.cast.values()].reduce((s,x)=>s+x.evidenceMass,0),1);
 ctx.contentFeatures.x={genres:['Synthetic Drama']};const p=prediction(ctx);near(p.internalScore,5+5*.3*E.ratingSignal(9,E.ratingCenter([9]))/4);assert.equal(p.score,null);
});
for(const source of ['seen','reviews','votes','vetoes'])test('I1/non-taste '+source,()=>{const ctx=context(),before=E.recommend(ctx);ctx.personalSignals.alpha[source]=Array.from({length:355},(_,i)=>({contentId:'a',value:true,text:'Loved it',id:i}));assert.deepEqual(E.recommend(ctx),before);});
test('I2 candidacy never adds profile evidence',()=>{const ctx=context(),before=profile(ctx);ctx.candidates[0].inSharedList=false;assert.deepEqual(profile(ctx),before);assert.equal(E.recommend(ctx).length,0);});
test('I8 Together completed exposure/text cannot create shared or personal taste',()=>{const ctx=context(),before=E.recommend(ctx);ctx.sharedSignals.events=[{movieId:'a',status:'completed'}];ctx.sharedSignals.reviews=[{contentId:'x',text:'Amazing'}];assert.deepEqual(E.recommend(ctx),before);});
test('Together ratings remain shared, cap ±.2, no personal contamination',()=>{
 const ctx=context();ctx.sharedSignals.ratings=[{contentId:'x',value:10}];const r=E.recommend(ctx)[0];assert.equal(r.personal.alpha.confidence,0);assert.equal(r.personal.beta.confidence,0);near(r.group.contributions.together,.2);assert(r.reasons.some(r=>r.code==='TOGETHER_RATING'));
 ctx.sharedSignals.ratings[0].value=0;near(E.recommend(ctx)[0].group.contributions.together,-.2);
});
test('I9–I11 Match arbitrary Like/Nope, corrupt timestamps, getters are not read',()=>{
 const ctx=ratings(context(),'alpha',[['a',9]]);ctx.personalSignals.beta.preferences=[{contentId:'b',value:false}];ctx.sharedSignals.ratings=[{contentId:'x',value:8}];const before=E.recommend(ctx),prof=profile(ctx),rank=E.rerank(before);
 for(const liked of [true,false]){for(const user of ctx.users)ctx.personalSignals[user.id].match=Array.from({length:200},(_,i)=>swipe(i%2?'a':'x',liked,'s'+i,'bad time'));assert.deepEqual(E.recommend(ctx),before);assert.deepEqual(profile(ctx),prof);assert.deepEqual(E.rerank(E.recommend(ctx)),rank);}
 for(const user of ctx.users)Object.defineProperty(ctx.personalSignals[user.id],'match',{get(){throw Error('Must not read Match');}});
 Object.defineProperty(ctx.sharedSignals,'match',{get(){throw Error('Must not read shared Match');}});assert.deepEqual(E.recommend(ctx),before);
});
test('No decay or asOf clock dependence, frozen inputs deterministic',()=>{const ctx=ratings(context(),'alpha',[['a',9]]);ctx.personalSignals.beta.preferences=[{contentId:'b',value:true,createdAt:'1900-01-01'}];const before=E.recommend(ctx);ctx.asOf='garbage';assert.deepEqual(E.recommend(ctx),before);delete ctx.asOf;assert.deepEqual(E.recommend(deepFreeze(ctx)),before);});
for(const [n,v,cn,cv] of [[8,8,.9,.9],[8,10,.9,.9],[10,8,.9,.9],[9,5,.9,.9],[9,3,.9,.9],[5,9,.9,.9],[5,8,0,.9],[8,5,.9,0]])test('Least misery '+[n,v,cn,cv].join('/'),()=>{
 const p=[{internalScore:n,confidence:cn},{internalScore:v,confidence:cv}];const expected=5+Math.min(cn,cv)*(Math.min(n,v)-5);near(E.aggregateGroup(p).score,expected);near(E.aggregateGroup(p.slice().reverse()).score,expected);
});
test('I13 Dislike remains eligible, moderate protection not veto',()=>{
 const ctx=context();ctx.personalSignals.alpha.preferences=[{contentId:'x',value:false}];ctx.personalSignals.beta.preferences=[{contentId:'x',value:true}];const r=E.recommend(ctx)[0];assert(r);assert.equal(r.group.score,4);assert(r.group.negativeProtectionApplied);assert(r.reasons.some(r=>r.code==='NEGATIVE_PROTECTION'));assert.equal(ctx.candidates[0].inSharedList,true);
});
test('Negative protection uses provenance, not relative index alone',()=>{
 const low={internalScore:3,confidence:.95,state:'OBSERVED',absolutePolarity:'POSITIVE',observationReliability:.95};assert(!E.aggregateGroup([low,{internalScore:8,confidence:.95}]).negativeProtectionApplied);
 const weak={internalScore:3,confidence:.1,state:'LOW_EVIDENCE'};assert(!E.aggregateGroup([weak,{internalScore:8,confidence:.95}]).negativeProtectionApplied);
 const strong={internalScore:3,confidence:.8,state:'INFERRED'};assert(E.aggregateGroup([strong,{internalScore:8,confidence:0}],{together:.2}).negativeProtectionApplied);
});
test('Negative cap configurable, shared suppression reasons zero when suppressed',()=>{
 const ctx=context();ctx.personalSignals.alpha.preferences=[{contentId:'x',value:false}];ctx.sharedSignals.ratings=[{contentId:'x',value:10}];const r=E.recommend(ctx)[0];near(r.group.contributions.together,0);assert(r.reasons.filter(r=>r.suppressed).every(r=>r.scoreContribution===0));near(E.recommend(ctx,{...C,negativeProtectionCap:3.5})[0].group.score,3.5);
});
for(const [dense,sparse] of [[20,7],[100,5],[200,1],[1,200]])test('I12 density/swap symmetry '+dense+'/'+sparse,()=>{
 const ctx=context();for(const [user,count,value] of [['alpha',dense,true],['beta',sparse,false]]){ctx.personalSignals[user].preferences=Array.from({length:count},(_,i)=>({contentId:user+i,value}));for(let i=0;i<count;i++)ctx.contentFeatures[user+i]=feature();}
 const a=E.recommend(ctx)[0];[ctx.personalSignals.alpha,ctx.personalSignals.beta]=[ctx.personalSignals.beta,ctx.personalSignals.alpha];const b=E.recommend(ctx)[0];assert.deepEqual(a.group,b.group);assert.deepEqual({...a.personal.alpha,reasons:a.personal.alpha.reasons.map(r=>({...r,userIds:['same']}))},{...b.personal.beta,reasons:b.personal.beta.reasons.map(r=>({...r,userIds:['same']}))});
});
test('Group aggregation contains no observation-count political weighting',()=>{const p=[{internalScore:8,confidence:.8,evidenceMass:200},{internalScore:6,confidence:.4,evidenceMass:5}];const before=E.aggregateGroup(p);p[0].evidenceMass=1;p[1].evidenceMass=900;assert.deepEqual(E.aggregateGroup(p),before);});
test('Adapter preference mapping, precedence, no Match projection or mutation',()=>{
 const rows=[movie('x',{personal_liked_n:false,seen_rating_v:0,personal_liked_v:true})],before=JSON.stringify(rows);
 const input={movies:rows,asOf:at,userIds:{N:'opaque-N',V:'opaque-V'}};Object.defineProperty(input,'matchHistory',{get(){throw Error('No stable adapter Match read');}});
 const ctx=A.fromMovies(input);assert.deepEqual(ctx.personalSignals['opaque-N'].preferences,[{contentId:'x',value:false}]);assert.equal(ctx.personalSignals['opaque-V'].preferences.length,0);assert(!Object.hasOwn(ctx.personalSignals['opaque-N'],'match'));assert.equal(JSON.stringify(rows),before);assert.equal(E.recommend(ctx)[0].personal['opaque-V'].observedRating,0);
});
test('Opaque IDs, order permutations, browser purity',()=>{
 const ctx=ratings(context(),'alpha',[['a',9],['b',8]]);ctx.users.reverse();const before=E.recommend(ctx);ctx.personalSignals.alpha.ratings.reverse();for(const f of Object.values(ctx.contentFeatures))f.genres.reverse();assert.deepEqual(E.recommend(ctx),before);
 ctx.users=[{id:'__proto__'},{id:'constructor'}];ctx.personalSignals=Object.fromEntries([['__proto__',{preferences:[{contentId:'a',value:true}]}],['constructor',{}]]);assert(E.recommend(ctx)[0].personal.__proto__.internalScore>5);
 const sandbox={};for(const key of ['document','localStorage','currentUser','movies','sb'])Object.defineProperty(sandbox,key,{get(){throw Error('Forbidden global');}});sandbox.Date=class extends Date {static now(){throw Error('clock');}};const vmctx=vm.createContext(sandbox);for(const f of ['config','core','adapters'])vm.runInContext(fs.readFileSync('js/recommendation/'+f+'.js','utf8'),vmctx);vmctx.input=context();assert.equal(vm.runInContext('RecommendationEngine.recommend(input)',vmctx).length,1);
});
test('Named feature reasons require token-specific support; aggregate fallback remains truthful',()=>{
 const ctx=ratings(context(),'alpha',[['a',9],['b',9]]);ctx.contentFeatures.a.directors=['One'];ctx.contentFeatures.b.directors=['Two'];ctx.contentFeatures.x.directors=['One','Two'];const p=prediction(ctx);
 assert(!p.reasons.some(r=>r.family==='director'));assert(p.reasons.some(r=>r.family==='genre'));assert(p.reasons.every(r=>r.code==='FEATURE_AFFINITY'||r.code==='LOW_EVIDENCE'));
 const single=prediction(ratings(context(),'alpha',[['a',9]]));assert(single.reasons.some(r=>r.code==='FEATURE_AFFINITY'&&r.aggregateOnly&&r.evidenceMovieIds.length===1));
 const shared=context();shared.sharedSignals.ratings=[{contentId:'a',value:9}];const r=E.recommend(shared)[0];assert(r.group.contributions.together>0);assert(r.reasons.some(r=>r.code==='TOGETHER_RATING'&&r.evidenceMovieIds[0]==='a'));
});
test('Preference shrinkage is single-pass signal; confidence factors explicit',()=>{
 const ctx=context();ctx.personalSignals.alpha.preferences=[{contentId:'a',value:true}];const p=prediction(ctx);
 near(p.internalScore,5+5*(.3+.2+.15+.1)*(.5/3.5)+5*.1*(.25/3.25));
 near(p.confidence,((.3+.2+.15+.1)*(.5/3.5)+.1*(.25/3.25))*(.5/4.5));assert(p.confidence>0);assert.equal(p.score,null);
});
test('Adapter no hidden fallback from votes, ratings, reviews, Seen or Together',()=>{
 const rows=[movie('x',{seen_n:true,seen_v:true,review_text_n:'Love',seen_rating_together:6,rating:10,watched_by:'both',votes:[{liked:true}]})];const ctx=A.fromMovies({movies:rows});assert.equal(ctx.personalSignals.N.preferences.length,0);assert.equal(ctx.personalSignals.V.preferences.length,0);assert.equal(E.recommend(ctx)[0].personal.N.confidence,0);
});
test('I14 Match history snapshots preserved unmodified, unsupported input ignored',()=>{
 const input={movies:[movie('x')],matchHistory:[{movie_id:'x',person:'N',liked:false}],votes:[{liked:true}],vetoes:[{movie_id:'x'}]};const before=JSON.stringify(input);A.fromMovies(deepFreeze(input));assert.equal(JSON.stringify(input),before);
 const ctx=context(),original=E.recommend(ctx);Object.defineProperty(ctx,'asOf',{get(){throw Error('Clock not consumed');}});assert.deepEqual(E.recommend(ctx),original);
});
test('Two-user group boundary and invalid shared evidence remain guarded',()=>{
 for(const n of [0,1,3]){const ctx=context();ctx.users=Array.from({length:n},(_,i)=>({id:'u'+i}));assert.throws(()=>E.recommend(ctx),/exactly 2/);assert.throws(()=>E.aggregateGroup(Array.from({length:n},()=>({internalScore:5,confidence:0}))),/exactly 2/);}
 for(const shared of [{confidence:NaN},{confidence:2},{together:NaN},{together:Infinity}])assert.throws(()=>E.aggregateGroup([{internalScore:5,confidence:0},{internalScore:5,confidence:0}],shared));
});
test('Opaque content/user IDs preserve whitespace and inherited names',()=>{
 const ctx=context();ctx.users=[{id:' alpha '},{id:'beta'}];ctx.personalSignals={' alpha ':{ratings:[{contentId:' a ',value:9}]},beta:{}};ctx.contentFeatures[' a ']=feature();assert(E.recommend(ctx)[0].personal[' alpha '].internalScore>5);
 ctx.candidates=[candidate('constructor')];ctx.contentFeatures={};assert.equal(E.recommend(ctx)[0].personal[' alpha '].score,null);
 const adapted=A.fromMovies({movies:[movie('x',{personal_liked_n:false})],userIds:{N:' member ',V:'other'}});assert.equal(E.recommend(adapted)[0].personal[' member '].observedPreference,false);
});
test('Diversity frozen inputs, window/cap limitations and conflicting duplicate safety',()=>{
 const ranked=E.recommend(listContext(40));const before=E.rerank(ranked,5);deepFreeze(ranked);assert.deepEqual(E.rerank(ranked.slice().reverse(),5),before);
 assert.equal(E.rerank(ranked,5,{...C,diversity:{...C.diversity,rerankPoolSize:3}}).length,3);
 const other={...ranked[0],group:{...ranked[0].group,score:6}};assert.throws(()=>E.rerank([ranked[0],other]),/Conflicting/);
});
test('Property matrix: bounds, polarity, unique provenance and deterministic ranking',()=>{
 for(let n=0;n<=10;n++)for(const value of [0,5.4,6,7,9.5,10]){const ctx=listContext(n);ctx.contentFeatures.a=feature();ratings(ctx,'alpha',[['a',value]]);const out=E.recommend(ctx);assert.equal(out.length,n);
 for(const r of out){assert(r.group.score>=0&&r.group.score<=10);for(const p of Object.values(r.personal)){assert(p.confidence>=0&&p.confidence<=1);assert(p.score===null||p.score>=0&&p.score<=10);}for(const reason of r.reasons)assert.equal(new Set(reason.evidenceMovieIds).size,reason.evidenceMovieIds.length);}
 const inverse={...ctx,users:ctx.users.slice().reverse()};assert.deepEqual(E.recommend(inverse),out);assert.deepEqual(E.recommend(ctx),out);
 }
});
console.log(`Recommendation: ${checks}/${checks} PASS`);
