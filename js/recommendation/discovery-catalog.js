// Public query space and public-format policy. No profiles, storage, network or random state.
const DiscoveryCatalog = (() => {
  const version='discovery-catalog-v2',cursorTtlMs=14*86400000,cursorKey='scorochiatu_discovery_cursors_v2',maxPages=20;
  const segments=[
    {id:'classics',from:'1870-01-01',to:'1979-12-31',votes:30,rating:6.5},
    {id:'eighties_nineties',from:'1980-01-01',to:'1999-12-31',votes:50,rating:6.5},
    {id:'millennium',from:'2000-01-01',to:'2014-12-31',votes:100,rating:6.5},
    {id:'modern',from:'2015-01-01',to:'2022-12-31',votes:100,rating:6.5},
    {id:'recent',from:'2023-01-01',votes:100,rating:6.5,window:4},
    {id:'international',from:'1870-01-01',votes:10,rating:7,languages:['fr','ja','ko','es','it','fa'],mature:true},
    {id:'recognized',from:'1870-01-01',to:'2022-12-31',votes:300,rating:6.5}
  ];
  const tracks=segments.flatMap(s=>(s.languages||['']).flatMap(language=>['vote_count.desc','vote_average.desc'].map(sort=>({key:[s.id,sort,language].join(':'),segment:s,sort,language}))));
  for(const s of segments){if(s.languages)Object.freeze(s.languages);Object.freeze(s);}Object.freeze(segments);tracks.forEach(Object.freeze);Object.freeze(tracks);
  const blank=()=>({page:1,offset:0,totalPages:null,visits:0,lastVisited:null});
  function normalize(input,now){const valid=input?.version===version&&Number.isFinite(input.expiresAt)&&input.expiresAt>now&&input.expiresAt<=now+cursorTtlMs;
    const normalized={version,expiresAt:valid?input.expiresAt:now+cursorTtlMs,tracks:{}};
    for(const t of tracks){const r=valid?input.tracks?.[t.key]:null;normalized.tracks[t.key]=r&&Number.isInteger(r.page)&&r.page>=1&&r.page<=501&&Number.isInteger(r.visits)&&r.visits>=0&&(r.totalPages===null||Number.isInteger(r.totalPages)&&r.totalPages>=0&&r.totalPages<=500)?{page:r.page,offset:Number.isInteger(r.offset)&&r.offset>=0&&r.offset<20?r.offset:0,totalPages:r.totalPages,visits:r.visits,lastVisited:Number.isFinite(r.lastVisited)&&r.lastVisited<=now?r.lastVisited:null}:blank();const current=normalized.tracks[t.key];if(current.totalPages!==null&&current.page>current.totalPages&&current.lastVisited!==null&&now-current.lastVisited>=300000){current.page=1;current.offset=0;current.totalPages=null;}}return normalized;}
  const available=(r,limit)=>r.page<=Math.min(limit,r.totalPages??500);
  function plan(cursor,asOf,{count=6,limit=maxPages}={}){
    if(count<=0)return [];
    const visits=s=>tracks.filter(t=>t.segment.id===s.id).reduce((sum,t)=>sum+cursor.tracks[t.key].visits,0),selected=[];
    const ordered=[...segments].sort((a,b)=>visits(a)-visits(b)||segments.indexOf(a)-segments.indexOf(b));
    for(const s of ordered){const t=tracks.filter(t=>t.segment.id===s.id&&available(cursor.tracks[t.key],limit)).sort((a,b)=>cursor.tracks[a.key].visits-cursor.tracks[b.key].visits||tracks.indexOf(a)-tracks.indexOf(b))[0];if(!t)continue;
      const to=s.to|| (s.mature?(Number(asOf.slice(0,4))-3)+'-12-31':asOf);
      if(to<s.from)continue;
      selected.push({pool:s.id,track:t.key,offset:cursor.tracks[t.key].offset,windowSize:s.window||10,path:'/discover/movie',query:{language:'it-IT',include_adult:false,include_video:false,'primary_release_date.gte':s.from,'primary_release_date.lte':to<asOf?to:asOf,'vote_count.gte':s.votes,'vote_average.gte':s.rating,sort_by:t.sort,page:cursor.tracks[t.key].page,...(t.language?{with_original_language:t.language}:{})}});
      if(selected.length>=count)break;
    }return selected;
  }
  function advance(cursor,spec,totalPages,now,resultCount=20){const r=cursor.tracks[spec.track];r.visits++;r.lastVisited=now;r.totalPages=Math.min(500,Math.max(0,totalPages));if((spec.offset||0)+spec.windowSize>=resultCount){r.page=spec.query.page+1;r.offset=0;}else{r.page=spec.query.page;r.offset=(spec.offset||0)+spec.windowSize;}}
  function status(cursor,limit=maxPages){const pending=tracks.filter(t=>available(cursor.tracks[t.key],limit));if(pending.length)return {code:'MORE_SEGMENTS',remainingTracks:pending.length,scoped:true};
    const capped=tracks.some(t=>cursor.tracks[t.key].page>limit&&(cursor.tracks[t.key].totalPages??500)>limit);
    return {code:capped?'SEARCH_WINDOW_LIMIT':'SEGMENTS_EXHAUSTED',remainingTracks:0,scoped:true};}
  function classify(raw){const gs=Array.isArray(raw.genres)?raw.genres.map(g=>g?.id):[];const ids=new Set([...(Array.isArray(raw.genre_ids)?raw.genre_ids:[]),...gs]);
    const music=ids.has(10402),doc=ids.has(99),tv=ids.has(10770),names=(Array.isArray(raw.keywords?.keywords)?raw.keywords.keywords:[]).filter(k=>typeof k?.name==='string').map(k=>k.name.toLowerCase().trim());
    const title=[raw.title,raw.original_title].filter(x=>typeof x==='string').join(' ').toLowerCase(),overview=typeof raw.overview==='string'?raw.overview.toLowerCase():'';
    const concertKeyword=names.some(k=>['concert film','filmed concert','concert footage','live concert','music video','music video compilation','filmed play','filmed theater','filmed theatre','recorded theatre','recorded theater','filmed stage production'].includes(k));
    const explicit=/\b(film[- ]concerto|concert film|filmed concert|recorded concert|concerto registrato|raccolta di videoclip|compilation (?:di )?videoclip|compilation musical[ei]|music video compilation)\b/.test(title+' '+overview);
    const recordedStage=/\b(?:filmed|recorded|recording of|registrazione|ripresa)\b.{0,80}\b(?:stage show|stage performance|theatrical performance|theatre production|theater production|produzione teatrale|spettacolo teatrale|live musical|stage musical)\b/.test(overview);
    const stageContext=music&&/\b(?:anniversary|anniversario|anniversar[yi])\b/.test(overview)&&/\b(?:performance|production|esibizione|rappresentazione|spettacolo)\b/.test(overview)&&!(/\b(?:story of|story follows|young|dreams|struggles|storia di|giovane|sogna)\b/.test(overview));
    const performance=(music||doc||tv)&&(/\b(live at|live in|in concert|in concerto)\b/.test(title)||/\b(registrazione (?:integrale |dal vivo |del concerto)|riprese del concerto|recording of (?:the |a )?concert)\b/.test(overview));
    if(concertKeyword||explicit||performance||recordedStage)return {eligible:false,kind:'recorded_performance',code:'RECORDED_PERFORMANCE'};
    if((tv&&(/\b(television special|tv special|speciale televisivo)\b/.test(title+' '+overview)||names.includes('stand-up comedy')))||/\bstand-up special\b/.test(title+' '+overview)||names.some(k=>['television special','tv special'].includes(k)))return {eligible:false,kind:'television_special',code:'NON_CINEMATIC_SPECIAL'};
    const documentaryNarrative=/\b(biogra|ritratto|documentario (?:racconta|ripercorre|indaga)|documentary (?:explores|chronicles|follows|about))/.test(overview)||doc&&names.some(k=>['biography','musician','based on true story'].includes(k))&&/\b(discover|investigat\w*|search|trace|indaga\w*|ricostru\w*)\b/.test(overview);
    const ambiguous=stageContext||music&&(doc||tv)&&!documentaryNarrative;
    return {eligible:!ambiguous,needsVerification:ambiguous,kind:doc?'documentary':tv?'television_movie':'film',code:ambiguous?(stageContext?'UNVERIFIED_PERFORMANCE_FORMAT':'UNVERIFIED_MUSIC_FORMAT'):doc?'CINEMATIC_DOCUMENTARY':'CINEMATIC_FORMAT'};
  }
  return Object.freeze({version,cursorTtlMs,cursorKey,maxPages,segments,tracks,normalize,plan,advance,status,classify});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=DiscoveryCatalog;
