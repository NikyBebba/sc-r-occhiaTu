// Optional pure bridge from an already loaded v75 projection, no I/O.
const RecommendationCoreV2Input = (() => {
  const taste = typeof module!=='undefined'&&module.exports ? require('./profiles') : TasteProfiles;
  function fromProjection(projection, context={mode:'list'}) {
    const normalized=taste.normalizeProjection(projection),profiles=taste.build(projection);
    const flags=new Map(projection.candidates.map(c=>[String(c.movieId),c]));
    const events=projection.sharedSignals?.events||[];
    return {profiles,context,candidates:normalized.movies.map(row=>({id:row.id,features:row.features,
      inCatalog:true,inSharedList:flags.get(row.id)?.inSharedList===true,
      completedTogether:(projection.sharedSignals?.completedMovieIds||[]).includes(row.id)||events.some(e=>e.movieId===row.id&&e.status==='completed'),
      activeNight:events.some(e=>e.movieId===row.id&&['proposed','confirmed'].includes(e.status)),
      seenBy:projection.users.filter(u=>(projection.personalSignals[u.id]?.seen||[]).includes(row.id)).map(u=>u.id),
      judgments:row.personalSignals,togetherJudgment:{rating:row.togetherRating,ratingConflict:row.togetherConflict}}))};
  }
  return Object.freeze({fromProjection});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=RecommendationCoreV2Input;
