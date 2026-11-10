// Local-only TMDb retrieval. Explicit transport owns authentication; no app globals.
const DiscoveryTmdb = (() => {
  const catalogPolicy=typeof module!=='undefined'&&module.exports?require('./discovery-catalog'):DiscoveryCatalog;
  const mapMetadata=typeof module!=='undefined'&&module.exports?require('../api/tmdb').tmdbMetadataFromDetail:tmdbMetadataFromDetail;
  const quality=typeof module!=='undefined'&&module.exports?require('./cinematic-quality'):CinematicQuality;
  const genres={28:'Azione',12:'Avventura',16:'Animazione',35:'Commedia',80:'Crime',99:'Documentario',18:'Dramma',10751:'Famiglia',14:'Fantasy',36:'Storia',27:'Horror',10402:'Musica',9648:'Mistero',10749:'Romance',878:'Fantascienza',10770:'televisione film',53:'Thriller',10752:'Guerra',37:'Western'};
  const cmp=(a,b)=>a<b?-1:a>b?1:0, norm=x=>typeof x==='string'?x.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim():'';
  const clone=x=>JSON.parse(JSON.stringify(x)), id=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):null;
  const defaults={maxRequests:16,concurrency:2,maxRetries:1,enrichLimit:4,maxPages:20,queryTtlMs:300000,detailTtlMs:3600000,cacheLimit:100,maxRetryWaitMs:30000};
  // Independent public segments. Persisted progress is injected by the presentation boundary.
  function plan(page=1,asOf=new Date().toISOString().slice(0,10)){if(!Number.isInteger(page)||page<1||page>20||!/^\d{4}-\d{2}-\d{2}$/.test(asOf))throw new TypeError('Page/date bounds');const c=catalogPolicy.normalize(null,Date.parse(asOf+'T00:00:00Z'));Object.values(c.tracks).forEach(r=>r.page=page);return catalogPolicy.plan(c,asOf);}
  function movie(raw, pools=[]){if(!id(raw?.id)||raw.adult===true||raw.video===true||!norm(raw.title))return null;
    const year=/^\d{4}-\d{2}-\d{2}$/.test(raw.release_date||'')?Number(raw.release_date.slice(0,4)):null;
    const gs=Array.isArray(raw.genres)?raw.genres.map(g=>g?.id):Array.isArray(raw.genre_ids)?raw.genre_ids:[];
    return {id:'tmdb:'+Number(raw.id),tmdbId:Number(raw.id),title:raw.title.trim(),originalTitle:typeof raw.original_title==='string'?raw.original_title:null,
      overview:typeof raw.overview==='string'?raw.overview:null,posterPath:typeof raw.poster_path==='string'?raw.poster_path:null,
      voteCount:Number.isFinite(raw.vote_count)?raw.vote_count:0,voteAverage:Number.isFinite(raw.vote_average)?raw.vote_average:null,releaseDate:raw.release_date||null,originalLanguage:raw.original_language||null,popularity:Number.isFinite(raw.popularity)?raw.popularity:0,
      format:catalogPolicy.classify(raw),inCatalog:false,inSharedList:false,completedTogether:false,activeNight:false,seenBy:[],exposure:'UNKNOWN',pools:[...new Set(pools)].sort(cmp),enriched:false,
      features:{genres:[...new Set(gs.map(g=>Object.prototype.hasOwnProperty.call(genres,g)?genres[g]:null).filter(Boolean))].sort(cmp),directors:[],cast:[],runtimeMinutes:null,releaseYear:year,collectionId:null}};}
  function enrich(base,raw){const full=movie(raw,base.pools);if(!full||full.tmdbId!==base.tmdbId)return null;
    const crew=Array.isArray(raw.credits?.crew)?raw.credits.crew.filter(Boolean):[],cast=Array.isArray(raw.credits?.cast)?raw.credits.cast.filter(Boolean):[];
    return {...full,enriched:true,metadata:mapMetadata(raw,base.title),features:{...full.features,
      directors:[...new Set(crew.filter(x=>x.job==='Director'&&typeof x.name==='string').map(x=>x.name))].sort(cmp),
      cast:[...cast].sort((a,b)=>(a.order??999)-(b.order??999)||(id(a.id)||0)-(id(b.id)||0)||cmp(a.name||'',b.name||'')).slice(0,8).map(x=>x.name).filter(x=>typeof x==='string'),
      runtimeMinutes:typeof raw.runtime==='number'&&raw.runtime>0?raw.runtime:null,collectionId:id(raw.belongs_to_collection?.id)}};}
  function localLanes(candidates,profiles){const people=Object.values(profiles?.people||{});return candidates.map(c=>{
    const names=c.features.genres.map(norm),specific={director:c.features.directors.map(norm),cast:c.features.cast.map(norm),collection:c.features.collectionId==null?[]:[String(c.features.collectionId)]};const supported=people.length===2&&people.every(p=>(p.features||[]).some(f=>specific[f.family]?.includes(f.id)&&f.direction>0&&!f.supportInsufficient));
    const pair=people.length===2&&people.every(p=>(p.features||[]).some(f=>f.family==='genre_pair'&&f.direction>0&&!f.supportInsufficient&&names.some((a,i)=>names.slice(i+1).some(b=>[a,b].sort(cmp).join('|')===f.id))));
    return {...c,lane:pair?'combination':supported?'supported':'exploration'};});}
  function create({transport,now=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),config={},cursor=null,persistCursor=()=>{}}={}) {
    if(typeof transport!=='function')throw new TypeError('Inject transport({path,query,signal})');
    const cfg={...defaults,...config};for(const [k,v] of Object.entries(cfg))if(!(k in defaults)||!Number.isInteger(v)||v<0)throw new TypeError('Invalid option: '+k);
    if(cfg.maxRequests<1||cfg.maxRequests>40||cfg.concurrency<1||cfg.concurrency>4||cfg.maxRetries>2||cfg.maxPages<1||cfg.maxPages>20||cfg.enrichLimit>10||cfg.cacheLimit<1)throw new RangeError('Budget/concurrency/page bounds');
    const cache=new Map(),queue=[];let active=0,generation=0,controller=null,session={cursor:catalogPolicy.normalize(cursor,now()),shown:new Set()};
    function slot(){return new Promise(resolve=>{queue.push(resolve);pump();});}
    function pump(){while(active<cfg.concurrency&&queue.length){active++;queue.shift()();}}
    async function load({catalog=[],nights=[],profiles=null,requestBudget=cfg.maxRequests,enrichLimit=cfg.enrichLimit,fillTarget=0,queryCount=6}={}) {
      if(!Number.isInteger(requestBudget)||requestBudget<0||requestBudget>cfg.maxRequests||!Number.isInteger(enrichLimit)||enrichLimit<0||enrichLimit>cfg.enrichLimit)throw new RangeError('Load budget');if(!Number.isInteger(queryCount)||queryCount<1||queryCount>6)throw new RangeError('Query count');
      const token=++generation;if(controller)controller.abort();controller=new AbortController();const signal=controller.signal;
      const current=()=>token===generation&&!signal.aborted,stats={requests:0,reserved:0,cacheHits:0,queryRequests:0,detailRequests:0,retries:0},diagnostics=[];
      const progress=catalogPolicy.normalize(session.cursor,now()),shown=new Set(session.shown),source=clone(catalog),events=clone(nights),taste=profiles?clone(profiles):null,asOf=new Date(now()).toISOString().slice(0,10);
      const reserve=()=>{if(stats.reserved+1+cfg.maxRetries>requestBudget)return false;stats.reserved+=1+cfg.maxRetries;return true;};
      async function request(spec,validator,ttl){const key=JSON.stringify([spec.path,spec.query]),hit=cache.get(key);
        if(hit&&now()-hit.at<ttl){stats.cacheHits++;return {body:clone(hit.body)};}
        if(!reserve())return {error:'BUDGET'};
        let spent=0;try{for(let attempt=0;attempt<=cfg.maxRetries;attempt++){
          if(!current())return {error:'STALE'};await slot();let response;
          try{if(!current())return {error:'STALE'};stats.requests++;spent++;stats[spec.path==='/discover/movie'?'queryRequests':'detailRequests']++;if(attempt)stats.retries++;response=await transport({...clone(spec),signal});}catch(_){response={status:0};}finally{active--;pump();}
          if(!current())return {error:'STALE'};
          if(response?.status===200){if(!validator(response.body))return {error:'INVALID_RESPONSE'};cache.delete(key);cache.set(key,{at:now(),body:clone(response.body)});while(cache.size>cfg.cacheLimit)cache.delete(cache.keys().next().value);return {body:clone(response.body)};}
          const status=response?.status||0,retryable=status===0||status===429||status>=500;
          const header=response?.headers?.['retry-after']??response?.headers?.['Retry-After'];let wait=250*2**attempt;
          if(status===429&&header!=null){const seconds=Number(header);wait=Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(header)-now());if(!Number.isFinite(wait))wait=250*2**attempt;}
          if(!retryable||attempt===cfg.maxRetries||wait>cfg.maxRetryWaitMs)return {error:status===401||status===403?'UNAVAILABLE':retryable?'UNAVAILABLE':'HTTP_ERROR',status,retryAfterMs:wait};
          await sleep(wait);
        }}finally{stats.reserved-=1+cfg.maxRetries-spent;}
      }
      const capacity=Math.floor(requestBudget/(1+cfg.maxRetries)),specs=catalogPolicy.plan(progress,asOf,{count:Math.min(queryCount,capacity),limit:cfg.maxPages});
      if(!capacity)return {contractVersion:'tmdb-discovery-v1',status:'EMPTY',candidates:[],diagnostics:[{code:'BUDGET'}],stats,hasMore:catalogPolicy.status(progress,cfg.maxPages).remainingTracks>0,exploration:catalogPolicy.status(progress,cfg.maxPages),poolStats:[]};
      if(!specs.length)return {contractVersion:'tmdb-discovery-v1',status:'EMPTY',candidates:[],diagnostics:[catalogPolicy.status(progress,cfg.maxPages)],stats,hasMore:false,exploration:catalogPolicy.status(progress,cfg.maxPages),poolStats:[]};
      const poolStats=specs.map(s=>({pool:s.pool,track:s.track,page:s.query.page,offset:s.offset,windowSize:s.windowSize,sort:s.query.sort_by,from:s.query['primary_release_date.gte'],to:s.query['primary_release_date.lte'],language:s.query.with_original_language||null,raw:0,valid:0,notShown:0,canonical:0,afterEligibility:0,afterFormat:0,afterQuality:0,afterInformation:0,final:0}));
      const responses=await Promise.all(specs.map(s=>request(s,b=>Array.isArray(b?.results)&&Number.isInteger(b.total_pages)&&b.total_pages>=0,cfg.queryTtlMs)));
      if(!current())return {status:'STALE',candidates:[],stats};
      const byId=new Map(),conflicts=new Set();
      const countStage=(stage,rows)=>poolStats.forEach(p=>p[stage]=rows.filter(c=>c.pools.includes(p.pool)).length);
      responses.forEach((r,i)=>{const spec=specs[i];if(r.error){diagnostics.push({pool:spec.pool,code:r.error,...(r.retryAfterMs==null?{}:{retryAfterMs:r.retryAfterMs})});return;}catalogPolicy.advance(progress,spec,r.body.total_pages,now(),Math.min(20,r.body.results.length));poolStats[i].raw=r.body.results.slice(0,20).length;
        for(const raw of r.body.results.slice(spec.offset,spec.offset+spec.windowSize)){const c=movie(raw,[spec.pool]);if(!c)continue;poolStats[i].valid++;
          if(shown.has(c.id))continue;poolStats[i].notShown++;const prev=byId.get(c.id);
          if(prev){if(JSON.stringify({...prev,pools:[]})!==JSON.stringify({...c,pools:[]})){conflicts.add(c.id);continue;}prev.pools=[...new Set([...prev.pools,...c.pools])].sort(cmp);}else byId.set(c.id,c);
        }});
      const ids=new Set(source.map(x=>id(x.tmdbId??x.tmdb_id)).filter(Boolean));
      const blockedIds=new Set(events.filter(n=>['completed','proposed','confirmed'].includes(n.status)).map(n=>id(n.tmdbId??n.tmdb_id)).filter(Boolean));
      function filter(c){if(ids.has(c.tmdbId)||blockedIds.has(c.tmdbId)){diagnostics.push({id:c.id,code:ids.has(c.tmdbId)?'IN_CATALOG':'NIGHT_OR_TOGETHER'});return false;}
        const possible=source.some(x=>Number(x.release_year??x.features?.releaseYear)===c.features.releaseYear&&[x.title,x.original_title].some(t=>norm(t)&&[norm(c.title),norm(c.originalTitle)].includes(norm(t))));
        if(possible){diagnostics.push({id:c.id,code:'POSSIBLE_DUPLICATE'});return false;}return true;}
      let candidates=[...byId.values()].filter(c=>!conflicts.has(c.id)).sort((a,b)=>a.tmdbId-b.tmdbId);countStage('canonical',candidates);candidates=candidates.filter(filter);countStage('afterEligibility',candidates);
      candidates=candidates.filter(c=>{if(c.format.eligible||c.format.needsVerification)return true;diagnostics.push({id:c.id,code:c.format.code});return false;});countStage('afterFormat',candidates);
      conflicts.forEach(id=>diagnostics.push({id,code:'CONFLICTING_TMDB_RESULT'}));
      // Public quality only. No profile-derived identifiers or scores reach the transport.
      candidates=candidates.map(c=>({...c,quality:quality.evaluate(c,asOf,{allowSynopsisRecovery:true,allowDetailRecovery:true})})).filter(c=>{if(c.quality.eligible||c.quality.needsVerification)return true;diagnostics.push({id:c.id,code:c.quality.code});return false;});
      countStage('afterQuality',candidates);
      const missing=candidates.filter(c=>!quality.informative(c.overview)).sort((a,b)=>b.quality.score-a.quality.score||a.tmdbId-b.tmdbId).slice(0,2);
      const recovered=new Map();
      // Recheck the localized detail before requesting an English synopsis.
      for(const language of ['it-IT','en-US']){
        const pending=missing.filter(c=>!recovered.has(c.id));
        const responses=await Promise.all(pending.map(c=>request({path:'/movie/'+c.tmdbId,query:{language,append_to_response:'credits,keywords,videos,watch/providers'}},b=>id(b?.id)===c.tmdbId&&typeof b.title==='string',cfg.detailTtlMs)));
        if(!current())return {status:'STALE',candidates:[],stats};
        responses.forEach((r,i)=>{const c=pending[i];if(r.error){diagnostics.push({id:c.id,code:'SYNOPSIS_'+r.error});return;}
          const d=enrich(c,r.body);if(d&&quality.informative(d.overview))recovered.set(c.id,{...d,title:c.title,originalTitle:c.originalTitle,overviewLanguage:language==='it-IT'?'it':'en',quality:quality.evaluate(d,asOf)});});
      }
      candidates=candidates.map(c=>recovered.get(c.id)||{...c,overviewLanguage:'it'}).filter(c=>{if(quality.informative(c.overview))return true;diagnostics.push({id:c.id,code:'NO_INFORMATIVE_SYNOPSIS'});return false;});
      countStage('afterInformation',candidates);
      const ordered=[...candidates].sort((a,b)=>b.quality.score-a.quality.score||a.tmdbId-b.tmdbId),balanced=[];
      for(const category of ['established','classic','recent','niche']){const row=ordered.find(c=>c.quality.category===category);if(row)balanced.push(row);}
      const uncertain=ordered.filter(c=>c.format.needsVerification||c.quality.needsVerification);
      const promising=[...uncertain,...balanced.filter(c=>!uncertain.includes(c)),...ordered.filter(c=>!uncertain.includes(c)&&!balanced.some(x=>x.id===c.id))].filter(c=>!c.enriched).slice(0,candidates.filter(c=>c.format.eligible).length<fillTarget&&catalogPolicy.status(progress,cfg.maxPages).remainingTracks>0?Math.min(2,enrichLimit):enrichLimit);
      const details=await Promise.all(promising.map(c=>request({path:'/movie/'+c.tmdbId,query:{language:'it-IT',append_to_response:'credits,keywords,videos,watch/providers'}},b=>id(b?.id)===c.tmdbId&&typeof b.title==='string',cfg.detailTtlMs)));
      if(!current())return {status:'STALE',candidates:[],stats};
      const replacements=new Map();details.forEach((r,i)=>{const c=promising[i];if(r.error){diagnostics.push({id:c.id,code:'DETAIL_'+r.error});return;}const d=enrich(c,r.body);if(d)replacements.set(c.id,{...d,overview:quality.informative(d.overview)?d.overview:c.overview,overviewLanguage:quality.informative(d.overview)?'it':c.overviewLanguage});else {replacements.set(c.id,null);diagnostics.push({id:c.id,code:'DETAIL_REJECTED'});}});
      candidates=candidates.map(c=>replacements.has(c.id)?replacements.get(c.id):c).filter(Boolean).filter(filter).map(c=>({...c,quality:quality.evaluate(c,asOf)})).filter(c=>{if(c.format.eligible){if(!c.quality.eligible)diagnostics.push({id:c.id,code:c.quality.code});return c.quality.eligible&&quality.informative(c.overview);}diagnostics.push({id:c.id,code:c.format.code});return false;});countStage('final',candidates);
      candidates=localLanes(candidates,taste);diagnostics.sort((a,b)=>cmp(JSON.stringify(a),JSON.stringify(b)));
      // Commit each successful track independently; failures retry the same page, stale loads commit nothing.
      session.cursor=progress;try{persistCursor(clone(progress));}catch(_){}
      const exploration=catalogPolicy.status(progress,cfg.maxPages),hasMore=exploration.remainingTracks>0,page=Math.max(...specs.map(s=>s.query.page));
      const failures=diagnostics.filter(d=>d.pool),status=candidates.length?'READY':failures.some(d=>d.code==='UNAVAILABLE')?'UNAVAILABLE':failures.length?'ERROR':'EMPTY';
      return {contractVersion:'tmdb-discovery-v1',status,partial:failures.length>0||diagnostics.some(d=>d.code.startsWith('DETAIL_')),
        availability:{searchPartial:failures.length>0,optionalDetailsSkipped:diagnostics.filter(d=>d.code==='DETAIL_BUDGET').length,optionalDetailsFailed:diagnostics.filter(d=>d.code.startsWith('DETAIL_')&&d.code!=='DETAIL_BUDGET').length},
        candidates,diagnostics,stats,page,hasMore,exploration,poolStats,lanes:{supported:candidates.filter(c=>c.lane==='supported').map(c=>c.id),combination:candidates.filter(c=>c.lane==='combination').map(c=>c.id),exploration:candidates.filter(c=>c.lane==='exploration').map(c=>c.id)}};
    }
    function markShown(ids){if(!Array.isArray(ids)||ids.some(value=>!/^tmdb:[1-9]\d*$/.test(value)))throw new TypeError('External IDs required');for(const value of ids)session.shown.add(value);}
    function reset({restart=false}={}){generation++;controller?.abort();session={cursor:catalogPolicy.normalize(restart?null:session.cursor,now()),shown:new Set()};}
    return Object.freeze({load,markShown,reset,getCursor:()=>clone(catalogPolicy.normalize(session.cursor,now()))});
  }
  return Object.freeze({create,plan,genres:Object.freeze(genres)});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=DiscoveryTmdb;
