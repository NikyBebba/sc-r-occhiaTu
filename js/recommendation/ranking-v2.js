// recommendation-core-v2: local, pure, deterministic. No consumer or network access.
const RecommendationCoreV2 = (() => {
  const cmp = (a,b) => a < b ? -1 : a > b ? 1 : 0;
  const stable = x => JSON.stringify(x, (_,v) => v && !Array.isArray(v) && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort(cmp).map(k=>[k,v[k]])) : v);
  const defaults = Object.freeze({ minSupport:2, shrinkage:3, strongNegativeIntensity:.5,
    inferredNegativeThreshold:-.2, inferredConfidence:.3, diversityPenalty:.06, noveltyBonus:.02, relevanceWindow:.02 });
  const experiments=Object.freeze({legacyV1:Object.freeze({diversityVersion:'unbounded-v1'}),
    constrainedV1:Object.freeze({diversityVersion:'near-relevance-v1',config:Object.freeze({relevanceWindow:.02})})});
  const weights = { genre:.3, director:.2, cast:.1, runtime:.15, decade:.1, collection:.15 };
  const text = s => typeof s === 'string' ? s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim() : '';
  const tokens = a => [...new Set((Array.isArray(a)?a:[]).map(text).filter(Boolean))].sort(cmp);
  function features(raw={}) {
    const g=tokens(raw.genres), pairs=[];
    for(let i=0;i<g.length;i++)for(let j=i+1;j<g.length;j++)pairs.push(g[i]+'|'+g[j]);
    return {genre:g,genre_pair:pairs,director:tokens(Array.isArray(raw.directors)?raw.directors:typeof raw.directors==='string'?raw.directors.split(','):[]),cast:tokens(raw.cast),
      runtime:typeof raw.runtimeMinutes==='number'&&Number.isFinite(raw.runtimeMinutes)&&raw.runtimeMinutes>0?[String([100,120,150].filter(n=>raw.runtimeMinutes>=n).length)]:[],
      decade:Number.isInteger(raw.releaseYear)&&raw.releaseYear>0?[String(Math.floor(raw.releaseYear/10)*10)]:[],
      collection:raw.collectionId!=null&&String(raw.collectionId).trim()?[String(raw.collectionId).trim()]:[]};
  }
  const validRating = n => typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=10&&Math.abs(n*10-Math.round(n*10))<1e-9;
  function direct(signal) {
    if(signal?.ratingConflict)return {state:'CONFLICT'};
    if(validRating(signal?.rating)) {const r=signal.rating,p=r<5.5?'negative':r<7?'neutral':'positive';return {polarity:p,intensity:p==='negative'?(5.5-r)/5.5:p==='positive'?(r-6.5)/3.5:0,source:'rating'};}
    if(signal?.preferenceConflict)return {state:'CONFLICT'};
    return typeof signal?.preference==='boolean'?{polarity:signal.preference?'positive':'negative',intensity:1,source:'preference'}:null;
  }
  function estimate(profile, movie, personId, config, supplied, shared=false) {
    const reasons=[], conflicts=profile?.conflicts||[];
    if(conflicts.includes(movie.id)) return {affinity:0,confidence:0,support:0,state:'CONFLICT',reasons:[{code:'CONFLICT',personId,evidenceMovieIds:[movie.id]}]};
    const records=(profile?.features||[]).flatMap(f=>f.provenance||[]).filter(p=>p.movieId===movie.id);
    let observed=supplied===undefined?(records[0]||null):direct(shared?{rating:supplied?.rating,ratingConflict:supplied?.ratingConflict}:supplied);
    if(supplied===undefined&&new Set(records.map(stable)).size>1)observed={state:'CONFLICT'};
    if(observed?.state==='CONFLICT')return {affinity:0,confidence:0,support:0,state:'CONFLICT',reasons:[{code:'CONFLICT',personId,evidenceMovieIds:[movie.id]}]};
    if(observed) {const affinity=observed.polarity==='negative'?-observed.intensity:observed.polarity==='positive'?observed.intensity:0;
      return {affinity,confidence:1,support:1,state:'OBSERVED',polarity:observed.polarity,intensity:observed.intensity,
        reasons:[{code:'DIRECT_JUDGMENT',personId,direction:affinity,support:1,source:observed.source,evidenceMovieIds:[movie.id]}]};}
    const f=movie.normalized;let affinity=0,confidence=0;const supporting=new Set();
    for(const [family,weight] of Object.entries(weights)) {
      // Genre pairs replace the genre family only with sufficient support; never add a second genre budget.
      const pairRows=(profile?.features||[]).filter(x=>x.family==='genre_pair'&&f.genre_pair.includes(x.id)&&x.observationCount>=config.minSupport);
      const actual=family==='genre'&&pairRows.length?'genre_pair':family;
      const rows=(profile?.features||[]).filter(x=>x.family===actual&&f[actual].includes(x.id)&&x.observationCount>=config.minSupport);
      const denominator=Math.max(1,f[actual].length);let familyAffinity=0,familyConfidence=0;
      for(const row of rows) {const support=new Set(row.movieIds).size, reliability=support/(support+config.shrinkage);
        const contribution=weight*row.direction*reliability/denominator;
        familyAffinity+=contribution;familyConfidence+=weight*reliability/denominator;
        row.movieIds.forEach(id=>supporting.add(id));
        reasons.push({code:'FEATURE_AFFINITY',personId,family:actual,featureId:row.id,direction:row.direction,support,
          contribution,evidenceMovieIds:[...new Set(row.movieIds)].sort(cmp)});
      }
      affinity+=familyAffinity;confidence+=familyConfidence;
    }
    if(!reasons.length)reasons.push({code:'INSUFFICIENT_EVIDENCE',personId,evidenceMovieIds:[]});
    return {affinity,confidence,support:supporting.size,state:reasons[0].code==='INSUFFICIENT_EVIDENCE'?'UNKNOWN':'INFERRED',reasons};
  }
  function recommend({profiles,candidates,context,config:overrides={},shownIds=[],batchSize=5,diversityVersion='unbounded-v1'}) {
    if(!['unbounded-v1','near-relevance-v1'].includes(diversityVersion))throw new TypeError('Unknown diversity version');
    if(profiles?.contractVersion!=='taste-profile-v1'||Object.keys(profiles.people||{}).length!==2)throw new TypeError('Two taste-profile-v1 personal profiles required');
    if(!['list','discovery'].includes(context?.mode)||!Array.isArray(candidates))throw new TypeError('Explicit list/discovery context and candidates required');
    const config={...defaults,...overrides};
    for(const k of Object.keys(overrides))if(!(k in defaults))throw new TypeError('Unknown config: '+k);
    for(const [k,v] of Object.entries(config))if(!Number.isFinite(v)||(k!=='inferredNegativeThreshold'&&v<0))throw new TypeError('Invalid config: '+k);
    if(config.shrinkage===0||!Number.isInteger(config.minSupport)||config.minSupport<1||config.strongNegativeIntensity>1||config.inferredConfidence>1||config.inferredNegativeThreshold>0||config.inferredNegativeThreshold< -1)throw new RangeError('Invalid thresholds');
    if(!Number.isInteger(batchSize)||batchSize<0)throw new TypeError('Invalid batch size');
    const people=Object.keys(profiles.people).sort(cmp),map=new Map(),duplicateConflicts=new Set();
    for(const c of candidates){if(typeof c.id!=='string'||!c.id.trim())throw new TypeError('Stable candidate string ID required');const row={id:c.id,normalized:features(c.features),inSharedList:c.inSharedList===true,inCatalog:c.inCatalog===true,
      completedTogether:c.completedTogether===true,activeNight:c.activeNight===true,seenBy:[...new Set(c.seenBy||[])].sort(cmp),judgments:c.judgments||{},togetherJudgment:c.togetherJudgment};
      if(map.has(row.id)&&stable(map.get(row.id))!==stable(row))duplicateConflicts.add(row.id);else map.set(row.id,row);}
    const ranked=[],excluded=[];
    for(const movie of [...map.values()].sort((a,b)=>cmp(a.id,b.id))) {
      const codes=[];
      if(duplicateConflicts.has(movie.id))codes.push('CONFLICTING_CANDIDATE');
      if(movie.completedTogether)codes.push('ALREADY_TOGETHER');if(movie.activeNight)codes.push('ACTIVE_NIGHT');
      if(context.mode==='list'&&!movie.inSharedList)codes.push('NOT_IN_LIST');
      if(context.mode==='discovery'&&movie.inCatalog)codes.push('ALREADY_IN_CATALOG');
      if(shownIds.includes(movie.id))codes.push('ALREADY_SHOWN');
      const personal=Object.fromEntries(people.map(id=>[id,estimate(profiles.people[id],movie,id,config,movie.judgments[id])]));
      const together=estimate(profiles.together,movie,'Together',config,movie.togetherJudgment,true);
      for(const [id,p] of Object.entries(personal))p.reasons=p.reasons.map(r=>({...r,scope:'personal',personId:id}));
      together.reasons=together.reasons.map(({personId,...r})=>({...r,scope:'together'}));
      for(const id of people) {const p=personal[id];if(p.state==='OBSERVED'&&p.polarity==='negative'&&p.intensity>=config.strongNegativeIntensity)codes.push('STRONG_NEGATIVE:'+id);}
      if(codes.length){excluded.push({id:movie.id,codes:codes.sort(cmp),personal,together});continue;}
      const values=Object.values(personal),supported=values.filter(p=>p.state!=='UNKNOWN'&&p.state!=='CONFLICT');
      // Unknown remains zero: an asymmetric profile never fabricates the peer's affinity.
      const base=Math.min(...values.map(p=>p.state==='INFERRED'&&p.affinity<0&&p.confidence<config.inferredConfidence?0:p.affinity));
      const inferredProtected=values.some(p=>p.state==='INFERRED'&&p.confidence>=config.inferredConfidence&&p.affinity<=config.inferredNegativeThreshold);
      const negative=values.some(p=>p.affinity<0), sharedTieBreak=negative?Math.min(0,together.affinity):together.affinity;
      ranked.push({id:movie.id,personal,together,score:base,confidence:Math.min(...values.map(p=>p.confidence)),supportedPeople:supported.length,
        sharedTieBreak,inferredProtected,novel:movie.seenBy.length===0,features:movie.normalized,
        metadataCoverage:Object.keys(weights).filter(f=>movie.normalized[f].length).length/6,
        directEvidenceComplete:people.every(id=>Object.prototype.hasOwnProperty.call(movie.judgments,id)),
        reasons:[...values.flatMap(p=>p.reasons),...together.reasons]});
    }
    const compare=(a,b)=>b.score-a.score||b.sharedTieBreak-a.sharedTieBreak||cmp(a.id,b.id);ranked.sort(compare);
    const pool=[...ranked],batch=[];
    while(pool.length&&batch.length<batchSize){const options=pool.map(row=>{let penalty=0;
      for(const prior of batch){const collection=row.features.collection.some(x=>prior.features.collection.includes(x));const director=row.features.director.some(x=>prior.features.director.includes(x));const union=new Set([...row.features.genre,...prior.features.genre]);const overlap=row.features.genre.filter(x=>prior.features.genre.includes(x)).length/Math.max(1,union.size);penalty+=config.diversityPenalty*((collection?1:0)+(director?1:0)+overlap);}
      return {row,penalty,presentationScore:row.score-penalty+(row.novel?config.noveltyBonus:0)};});
      // Confident inferred negative candidates cannot leap over nonnegative ones through diversity.
      options.sort((a,b)=>Number(a.row.inferredProtected)-Number(b.row.inferredProtected)||b.presentationScore-a.presentationScore||compare(a.row,b.row));
      let best=options[0],referenceScore=null;
      if(diversityVersion==='near-relevance-v1') {
        const tier=options.filter(x=>x.row.inferredProtected===options[0].row.inferredProtected);
        referenceScore=Math.max(...tier.map(x=>x.row.score));
        best=tier.find(x=>x.row.score>=referenceScore-config.relevanceWindow);
      }
      batch.push({...best.row,batch:{index:batch.length,diversityPenalty:best.penalty,presentationScore:best.presentationScore,
        ...(referenceScore===null?{}:{referenceScore,relevanceLoss:referenceScore-best.row.score})}});pool.splice(pool.findIndex(x=>x.id===best.row.id),1);
    }
    return {contractVersion:'recommendation-core-v2',diversityVersion,config,ranked,excluded,batch,nextShownIds:[...new Set([...shownIds,...batch.map(x=>x.id)])].sort(cmp)};
  }
  return Object.freeze({recommend,features,defaults,experiments});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=RecommendationCoreV2;
