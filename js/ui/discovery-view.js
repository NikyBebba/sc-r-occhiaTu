// Discovery presentation only. Dependencies and write boundary are explicit.
const DiscoveryView = (() => {
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=x=>String(x??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  function movieModel(c) {
    const f=c.features||{},cached=typeof TmdbDetailCache!=='undefined'?TmdbDetailCache.read(c.tmdbId):null,d={...cached,...c.metadata},fallback={title:c.title,poster:/^\/[\w./-]+$/.test(c.posterPath||'')?'https://image.tmdb.org/t/p/w342'+c.posterPath:'',overview:c.overview,genres:f.genres||[],duration:f.runtimeMinutes?f.runtimeMinutes+' min':null,release_year:f.releaseYear,director:(f.directors||[]).join(', ')||null,cast_names:f.cast?.length?f.cast:null,collection_id:f.collectionId??null};
    for(const [k,v] of Object.entries(d))if(v!==null&&v!==''&&(!Array.isArray(v)||v.length))fallback[k]=v;
    return {...fallback,title:c.title,externalId:c.id,tmdb_id:c.tmdbId,trailer_url:d.trailer_url??d.trailerUrl??null,tmdb_rating:typeof d.tmdbRating==='number'?d.tmdbRating:c.voteAverage,imdb_rating:d.imdb_rating??d.imdbRating??null,rt_rating:d.rt_rating??d.rtRating??null,metacritic_rating:d.metacritic_rating??d.metacriticRating??null,matched:true};
  }
  function transport(){return async ({path,query,signal})=>{
    if(typeof CONFIG==='undefined'||!CONFIG.TMDB_API_KEY)return {status:401};
    const url=new URL('https://api.themoviedb.org/3'+path);for(const [k,v] of Object.entries(query))url.searchParams.set(k,String(v));url.searchParams.set('api_key',CONFIG.TMDB_API_KEY);
    const abort=new AbortController(),cancel=()=>abort.abort();signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();const timer=setTimeout(cancel,10000);
    try{const res=await fetch(url,{signal:abort.signal,credentials:'omit'});let body=null;if(res.ok)try{body=await res.json();}catch(_){}return {status:res.status,body,headers:{'retry-after':res.headers.get('Retry-After')}};}
    finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);}
  };}
  function create({root=document,getSource,save,requestRefresh=()=>{},openPersisted=()=>{},onChange=()=>{},onListRefresh=()=>{},isCurrent=()=>true,request=transport(),now=Date.now,storage,detailsById=(id,options)=>typeof fetchTmdbDetailsById==='function'?fetchTmdbDetailsById(id,options):Promise.resolve(null)}) {
    const el=id=>root.getElementById(id);
    if(storage===undefined)try{storage=localStorage;}catch(_){}
    let cursor=null;try{cursor=JSON.parse(storage?.getItem(DiscoveryCatalog.cursorKey)||'null');}catch(_){}
    const client=DiscoveryTmdb.create({transport:request,now,cursor,persistCursor:value=>{try{storage?.setItem(DiscoveryCatalog.cursorKey,JSON.stringify(value));}catch(_){}}});
    const exposures=DiscoveryExposures.create({storage,now});
    let mode='discover',state={status:'idle'},source=null,signature=null,revision=0,disposed=false,shown=[],pool=[],hasMore=true,opened=null,origin=null,painting=false,poolAt=null,expiryTimer=null;
    const valid=()=>!disposed&&isCurrent();
    const sign=s=>JSON.stringify([s.input.users,s.input.candidates,s.input.contentFeatures,Object.entries(s.input.personalSignals||{}).map(([id,x])=>[id,x.ratings,x.preferences]),s.input.sharedSignals?.ratings,s.input.sharedSignals?.events,s.catalog.map(c=>[c.movie_id??c.id,c.tmdb_id])]);
    const poster=c=>/^\/[\w./-]+$/.test(c.posterPath||'')?'https://image.tmdb.org/t/p/w342'+c.posterPath:'';
    const saves=DiscoverySave.create({save,getSource,refresh:requestRefresh,changed:()=>{if(valid()){render();paintSave();}}});
    const relations=['proposeToGroup','addToMyList','recordSeen'];
    const savedText={proposeToGroup:'Aggiunto a Da vedere insieme.',addToMyList:'Aggiunto ai tuoi Da vedere.',recordSeen:'Aggiunto ai miei Visti.'};
    let selectedRelation=null,detailPending=null,detailFailure=false;
    function paintSave(){if(!valid()||!opened||el('detailModal').classList.contains('hidden')||el('detailBody').dataset.externalId!==opened.id)return;
      const records=relations.map(r=>saves.inspect(opened.tmdbId,r)),pending=saves.busy(opened.tmdbId),status=el('discoverySaveStatus');if(!status)return;
      for(const relation of relations){const button=el('detailBody').querySelector('[data-discovery-action="'+relation+'"]'),r=records.find(r=>r.relation===relation);if(button){button.disabled=!!pending||detailPending===opened.id||r.status==='CONFIRMED';button.setAttribute('aria-busy',String(r.status==='PENDING'));}}
      const r=records.find(r=>r.relation===selectedRelation)||pending||records.find(r=>r.status!=='IDLE');
      const verify=el('discoveryVerify');verify.hidden=r?.status!=='UNCERTAIN';verify.onclick=()=>saves.verify();
      status.textContent=detailPending===opened.id?'Caricamento della scheda…':r?.status==='CONFIRMED'?savedText[r.relation]+(r.projected?'':' Aggiornamento della scheda…'):r?.status==='PENDING'?'Salvataggio…':r?.status==='UNCERTAIN'?'Esito da verificare. Non serve ripetere il salvataggio.':r?.status==='READY_TO_PROPOSE'?'Film riconosciuto nel catalogo. Scegli l’azione da completare.':r?.status==='ERROR'?'Non siamo riusciti a completare l’operazione. Puoi riprovare.':detailFailure?'Altri dettagli non disponibili. Puoi usare le informazioni già presenti.':'';
      const confirmed=records.find(r=>r.status==='CONFIRMED'&&(!selectedRelation||r.relation===selectedRelation));
      if(confirmed){pool=pool.filter(c=>c.id!==opened.id);state.batch=(state.batch||[]).filter(c=>c.id!==opened.id);if(confirmed.projected){opened=null;openPersisted(confirmed.movieId);}}
    }
    function closeExternal(){if(opened&&el('detailBody').dataset.externalId===opened.id&&!el('detailModal').classList.contains('hidden'))closeModal('detailModal');opened=null;}
    function setMode(next){if(next===mode||!valid())return;if(state.status==='loading'){revision++;client.reset();state={status:'idle'};}mode=next;closeExternal();onChange();}
    function reset(){revision++;client.reset();shown=[];pool=[];hasMore=true;state={status:'idle'};signature=null;source=null;}
    async function advance(){if(!valid()||mode!=='discover'||state.status==='loading')return;
      const ticket=++revision;try{source=getSource();if(!source?.input)throw Error('NOT_READY');signature=sign(source);state={status:'loading'};render();
        if(poolAt!==null&&now()-poolAt>=300000){pool=[];client.reset();client.markShown(shown);hasMore=true;poolAt=null;}
        const profiles=TasteProfiles.build(source.input),liveIds=new Set(source.catalog.map(c=>Number(c.tmdb_id)).filter(Boolean));pool=pool.filter(c=>!liveIds.has(c.tmdbId));let partial=false,remainingBudget=16,totalRequests=0,rounds=0;
        while(DiscoveryPipeline.rank({retrieval:{contractVersion:'tmdb-discovery-v1',status:'READY',candidates:pool},profiles,shownIds:shown,exposures:exposures.read(),now:now()}).batch.length<6&&hasMore&&remainingBudget>=2&&rounds<3){rounds++;const byId=new Map(source.catalog.map(c=>[String(c.movie_id??c.id),c.tmdb_id]));const retrieval=await client.load({fillTarget:6,requestBudget:remainingBudget,catalog:source.catalog,nights:(source.input.sharedSignals?.events||[]).map(n=>({...n,tmdb_id:byId.get(n.movieId)})),profiles});
          if(!valid()||ticket!==revision||mode!=='discover')return;
          remainingBudget-=retrieval.stats?.reserved||0;totalRequests+=retrieval.stats?.requests||0;
          if(!['READY','EMPTY'].includes(retrieval.status)){if(pool.some(c=>!shown.includes(c.id))){partial=true;break;}state={status:retrieval.status==='UNAVAILABLE'?'unavailable':'error'};render();return;}
          // The live snapshot may have changed while the transport was pending.
          const latest=getSource();if(sign(latest)!==signature){source=latest;signature=sign(latest);}
          poolAt=now();clearTimeout(expiryTimer);expiryTimer=setTimeout(()=>{expiryTimer=null;if(valid())render();},300001);hasMore=retrieval.hasMore;partial=partial||!!retrieval.availability?.searchPartial;const merged=new Map(pool.map(c=>[c.id,c]));for(const c of retrieval.candidates)merged.set(c.id,c);pool=[...merged.values()];
        }
        const latestIds=new Set(source.catalog.map(c=>Number(c.tmdb_id)).filter(Boolean));pool=pool.filter(c=>!latestIds.has(c.tmdbId));
        const result=DiscoveryPipeline.rank({retrieval:{contractVersion:'tmdb-discovery-v1',status:'READY',candidates:pool},profiles:TasteProfiles.build(source.input),shownIds:shown,exposures:exposures.read(),now:now()});
        if(!valid()||ticket!==revision)return;shown=[...new Set([...shown,...result.batch.map(c=>c.id)])];client.markShown(result.batch.map(c=>c.id));
        exposures.record(result.batch.map(c=>c.id));
        state={status:result.batch.length?'ready':'empty',batch:result.batch,partial,requests:totalRequests};if(!result.batch.length)pool=pool.filter(c=>shown.includes(c.id));render();
      }catch(_){if(valid()&&ticket===revision){state={status:'error'};render();}}
    }
    function openExternal(id,node){const c=pool.find(x=>x.id===id);if(!c||!valid())return;const already=saves.inspect(c.tmdbId);if(already.projected){openPersisted(already.movieId);return;}
      const known=getSource().catalog.find(m=>String(m.tmdb_id)===String(c.tmdbId));if(known&&!saves.busy(c.tmdbId)){openPersisted(String(known.movie_id??known.id));return;}
      const cached=typeof TmdbDetailCache!=='undefined'?TmdbDetailCache.read(c.tmdbId):null;
      const metadataCurrent=poolAt!==null&&now()-poolAt<3600000;
      const available=metadataCurrent&&c.metadata?{...cached,...c.metadata}:cached;
      if(available&&typeof TmdbDetailCache!=='undefined')TmdbDetailCache.remember(available,{preserveAge:true});
      opened={...c,metadata:available};selectedRelation=saves.busy(c.tmdbId)?.relation??null;origin=node;detailFailure=false;
      function draw(first=false){if(!opened||opened.id!==id||!valid())return;
        const callbacks=new Map();let serial=0;
        const action=(text,fn,classes,attrs={})=>{const key=String(++serial);callbacks.set(key,fn);return `<button type="button" class="${esc(classes)}" data-external-action="${key}" ${Object.entries(attrs).map(([k,v])=>`${k}="${esc(v)}"`).join(' ')}>${text}</button>`;};
        const submit=async relation=>{if(!opened||detailPending===id)return;const selected=opened;selectedRelation=relation;await saves.submit(selected.tmdbId,movieModel(selected),relation);if(valid()){render();paintSave();}};
        const context={viewingStatusHtml:()=>'',personBadge:()=>'',detailActions:()=>ProductContext.externalDetailActions({action,onAction:submit}),bind:body=>{body.querySelectorAll('[data-external-action]').forEach(b=>b.onclick=()=>callbacks.get(b.dataset.externalAction)?.());}};
        const model=movieModel(opened);if(first)openExternalMovieDetail(model,node,context);else renderMovieDetail(model,context,{external:true});paintSave();
      }
      detailPending=opened.metadata&&(typeof tmdbRatingsFresh!=='function'||tmdbRatingsFresh(opened.metadata))?null:id;draw(true);
      if(detailPending===id)Promise.resolve(detailsById(c.tmdbId)).then(details=>{
        if(!valid()||opened?.id!==id||el('detailModal').classList.contains('hidden'))return;
        if(details?.matched===true&&String(details.tmdb_id)===String(c.tmdbId)){opened={...opened,metadata:details};const index=pool.findIndex(x=>x.id===id);if(index>=0)pool[index]={...pool[index],metadata:details};}
        else detailFailure=true;
      }).catch(()=>{if(opened?.id===id)detailFailure=true;}).finally(()=>{if(opened?.id===id){detailPending=null;draw();}});
    }
    function reconcileVisible(live){const ids=new Set(live.catalog.map(c=>Number(c.tmdb_id)).filter(Boolean));pool=pool.filter(c=>!ids.has(c.tmdbId)||opened?.id===c.id);
      if(signature&&signature!==sign(live)&&state.status!=='loading'){
        source=live;signature=sign(live);
        const profiles=TasteProfiles.build(live.input),current=(state.batch||[]).map(r=>r.id),available=pool.filter(c=>current.includes(c.id)&&!ids.has(c.tmdbId));
        const rank=DiscoveryPipeline.rank({retrieval:{contractVersion:'tmdb-discovery-v1',status:'READY',candidates:available},profiles,batchSize:6,exposures:exposures.read(),now:now()});state.batch=rank.batch;
      }
      saves.reconcile();
    }
    function render(){if(!valid()||painting)return mode==='discover';painting=true;try{
      const live=getSource();reconcileVisible(live);paintSave();
      el('discoveryModeSwitch')?.classList.remove('hidden');el('discoveryScopri').setAttribute('aria-pressed',String(mode==='discover'));el('discoveryLista').setAttribute('aria-pressed',String(mode==='list'));
      el('discoveryPanel').classList.toggle('hidden',mode!=='discover');
      const eyebrow=el('recommendationSection').querySelector('.dashboard-eyebrow');if(eyebrow)eyebrow.textContent=mode==='discover'?'NUOVE IDEE':'DALLA LISTA CONDIVISA';
      if(mode!=='discover')return false;
      for(const id of ['recommendationResults','recommendationStatus','recommendationEmpty','recommendationError','recommendationStale','discoveryChanged'])el(id)?.classList.add('hidden');
      if(state.status==='idle'){Promise.resolve().then(()=>{if(valid()&&state.status==='idle')advance();});return true;}
      const busy=state.status==='loading',more=el('recommendationMore');el('recommendationSection').setAttribute('aria-busy',String(busy));more.classList.remove('hidden');more.disabled=busy||(!hasMore&&!(poolAt!==null&&now()-poolAt>=300000)&&!pool.some(c=>!shown.includes(c.id))&&!['error','unavailable'].includes(state.status));more.setAttribute('aria-busy',String(busy));more.querySelector('i')?.classList.toggle('fa-spin',busy);
      const messages={loading:'Stiamo cercando nuove proposte…',ready:state.partial?(state.batch?.length<6?'Ecco le '+state.batch.length+' proposte disponibili. ':'')+'La ricerca è parziale. Puoi chiedere altri suggerimenti.':state.batch?.length<6?'Ecco le '+state.batch.length+' proposte disponibili.':'Nuove idee per la prossima visione.',empty:hasMore?'Nessun film in questo gruppo. Puoi chiedere altri suggerimenti.':'Non ci sono altri titoli nei percorsi esplorati per ora.',unavailable:'TMDb non è disponibile. Riprova oppure scegli Dalla Lista.',error:'Non riusciamo a cercare i film. Riprova.'};
      el('discoveryStatus').textContent=messages[state.status]||'';el('discoveryStatus').setAttribute('role',['error','unavailable'].includes(state.status)?'alert':'status');
      const markup=busy?'':(state.batch||[]).map((row,index)=>{const c=pool.find(c=>c.id===row.id);if(!c)return '';const f=c.features,m=movieModel(c),img=m.poster,copy=DiscoveryCopy.describe(c,row,source,index);
        return `<article class="recommendation-card is-target-card" role="button" tabindex="0" aria-haspopup="dialog" data-external-id="${esc(c.id)}" aria-label="Apri scheda di ${esc(c.title)}">${img?`<img class="recommendation-poster" src="${esc(img)}" alt="" loading="lazy">`:'<span class="recommendation-poster" aria-hidden="true"></span>'}<div class="min-w-0"><h3 class="recommendation-title">${esc(c.title)}</h3><p class="recommendation-meta">${esc([f.releaseYear,...f.genres,f.runtimeMinutes?f.runtimeMinutes+' min':''].filter(Boolean).join(' · '))}</p>${m.director?`<p class="card-director">Regia di ${esc(m.director)}</p>`:''}${externalRatingsHtml(m,true)}<p class="recommendation-meta">${esc(m.platform||'Streaming')}</p><p class="recommendation-reason">${esc(copy.text)}</p></div><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></article>`;}).join('');
      const results=el('discoveryResults');if(results.innerHTML!==markup)results.innerHTML=markup;
      results.querySelectorAll('[data-external-id]').forEach(card=>{card.onclick=()=>openExternal(card.dataset.externalId,card);card.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();openExternal(card.dataset.externalId,card);}};});return true;
    }finally{painting=false;}}
    const more=e=>{if(mode==='discover'){e.preventDefault();e.stopImmediatePropagation();advance();}};el('recommendationMore').addEventListener('click',more,true);
    el('discoveryScopri').onclick=()=>setMode('discover');el('discoveryLista').onclick=()=>{setMode('list');for(const id of ['recommendationResults','recommendationStatus'])el(id).classList.remove('hidden');};
    const observer=new MutationObserver(()=>{if(opened&&el('detailModal').classList.contains('hidden')){opened=null;if(valid()&&(root.activeElement===root.body||el('detailModal').contains(root.activeElement)))(origin?.isConnected?origin:el('recommendationMore'))?.focus();}});observer.observe(el('detailModal'),{attributes:true,attributeFilter:['class']});
    return Object.freeze({render,advance,refresh:advance,getMode:()=>mode,dispose(){disposed=true;clearTimeout(expiryTimer);revision++;client.reset();saves.dispose();observer.disconnect();closeExternal();el('recommendationMore').removeEventListener('click',more,true);el('discoveryModeSwitch').classList.add('hidden');el('discoveryPanel').classList.add('hidden');for(const id of ['recommendationResults','recommendationStatus'])el(id).classList.remove('hidden');}});
  }
  return Object.freeze({create,transport,movieModel});
})();

if(typeof module!=='undefined'&&module.exports)module.exports=DiscoveryView;
