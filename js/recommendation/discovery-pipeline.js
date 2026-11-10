// Experimental Discovery ordering only. Core defaults and all negative protections remain unchanged.
const DiscoveryPipeline = (() => {
  const core=typeof module!=='undefined'&&module.exports?require('./ranking-v2'):RecommendationCoreV2;
  const quality=typeof module!=='undefined'&&module.exports?require('./cinematic-quality'):CinematicQuality;
  const policy=Object.freeze({version:'discovery-six-fresh-v1.1',qualityWindow:.06,freshnessPenalty:.06,exposureTtlMs:7*86400000});
  function rank({retrieval,profiles,shownIds=[],batchSize=6,explorationSize=1,exposures=[],now=0}) {
    if(retrieval?.contractVersion!=='tmdb-discovery-v1'||!['READY','EMPTY'].includes(retrieval.status))throw new TypeError('Available discovery snapshot required');
    if(!Number.isInteger(explorationSize)||explorationSize<0||explorationSize>batchSize)throw new RangeError('Exploration quota');
    const candidates=retrieval.candidates.filter(c=>c.quality?.eligible!==false&&quality.informative(c.overview));
    const result=core.recommend({profiles,candidates,context:{mode:'discovery'},shownIds,batchSize,...core.experiments.constrainedV1});
    const byId=new Map(candidates.map(c=>[c.id,c])),seen=new Map();
    for(const x of exposures)if(/^tmdb:[1-9]\d*$/.test(x.id)&&Number.isFinite(x.at)&&x.at<=now&&now-x.at<policy.exposureTtlMs)seen.set(x.id,Math.max(seen.get(x.id)||0,x.at));
    const pool=[...result.ranked],batch=[];let exploratoryCount=0;
    const isNiche=r=>byId.get(r.id).quality?.category==='niche';
    while(pool.length&&batch.length<batchSize){
      // Preserve the Core protection tier, then require near personal relevance.
      const protectedTier=pool.every(r=>r.inferredProtected);
      const tier=pool.filter(r=>r.inferredProtected===protectedTier);
      const reference=Math.max(...tier.map(r=>r.score));
      let near=tier.filter(r=>r.score>=reference-result.config.relevanceWindow);
      // A niche reserve is a maximum, not permission to bypass a stronger personal signal.
      const ordinary=near.filter(r=>!isNiche(r));
      if(exploratoryCount>=explorationSize&&ordinary.length)near=ordinary;
      const bestQuality=Math.max(...near.map(r=>byId.get(r.id).quality?.score||0));
      const comparable=near.filter(r=>(byId.get(r.id).quality?.score||0)>=bestQuality-policy.qualityWindow);
      const unusedCollection=comparable.filter(r=>!r.features.collection.some(id=>batch.some(p=>p.features.collection.includes(id))));
      const options=(unusedCollection.length?unusedCollection:comparable).map(row=>{
        const c=byId.get(row.id),q=c.quality?.score||0;
        const freshnessPenalty=seen.has(row.id)?policy.freshnessPenalty*(1-(now-seen.get(row.id))/policy.exposureTtlMs):0;
        let diversityPenalty=0;for(const prev of batch){const f=row.features,p=prev.features,union=new Set([...f.genre,...p.genre]);
          diversityPenalty+=result.config.diversityPenalty*((f.collection.some(x=>p.collection.includes(x))?1:0)+(f.director.some(x=>p.director.includes(x))?1:0)+f.genre.filter(x=>p.genre.includes(x)).length/Math.max(1,union.size));}
        return {row,q,freshnessPenalty,diversityPenalty,value:row.score+q-freshnessPenalty-diversityPenalty};
      }).sort((a,b)=>b.value-a.value||b.row.sharedTieBreak-a.row.sharedTieBreak||(a.row.id<b.row.id?-1:a.row.id>b.row.id?1:0));
      const best=options[0],exploratory=isNiche(best.row)||byId.get(best.row.id).lane==='exploration'&&exploratoryCount<explorationSize;
      if(exploratory)exploratoryCount++;
      batch.push({...best.row,selectionLane:exploratory?'exploration':'relevance',batch:{index:batch.length,referenceScore:reference,relevanceLoss:reference-best.row.score,qualityScore:best.q,diversityPenalty:best.diversityPenalty,freshnessPenalty:best.freshnessPenalty,presentationScore:best.value}});
      pool.splice(pool.findIndex(r=>r.id===best.row.id),1);
    }
    return {...result,discoveryPolicy:policy.version,batch,nextShownIds:[...new Set([...shownIds,...batch.map(c=>c.id)])].sort(),explorationReserve:batch.filter(c=>c.selectionLane==='exploration'),explorationRequested:explorationSize};
  }
  return Object.freeze({rank,policy});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=DiscoveryPipeline;
