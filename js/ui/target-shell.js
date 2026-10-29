'use strict';
// Semantic TARGET renderer. No legacy rows, store arrays or legacy selectors.
const TargetShell = (() => {
  function createShell({ session, root = document, lookup = fetchMovieDetails, detailsById = fetchTmdbDetailsById }) {
    let destination = 'home', query = '', genre = '', duration = '', sort = 'added', sortDir = 'desc', platform = '', proposer = '', availability = 'streaming', page = 0, feedback = '', operation = null, matchOperation = null, revealedKey = null, recommendation = [];
    let shared = null, match = null, generation = null, uiEpoch = 0, closingMatchTicket = null, createdTitle = null, matchExit = null, scheduledMatchTitle = null;
    const el = id => root.getElementById(id);
    const bindings = new Map();
    function bind(id, property, handler) {
      const node = el(id); if (!node) return;
      if (!bindings.has(node)) bindings.set(node, new Map());
      if (!bindings.get(node).has(property)) bindings.get(node).set(property, node[property]);
      node[property] = handler;
    }
    const show = (id, visible) => { const node = el(id); if (node) { node.classList.toggle('!hidden', !visible); if (visible) node.classList.remove('hidden'); } };
    const text = (id, value) => { const node = el(id); if (node) node.textContent = value; };
    const personalDestination = () => ['personalList','personalSeen'].includes(destination);
    function syncLayout(value) {
      if (typeof syncTargetNavigation === 'function') syncTargetNavigation(destination);
      const home = destination === 'home', wheel = destination === 'wheel', proposals = destination === 'recommendations';
      const personal = personalDestination(), group = ['groupList','rewatch','scheduled'].includes(destination);
      const titles = {groupList:'Libreria',rewatch:'Rewatch',scheduled:'In programma',personalList:'Lista personale',personalSeen:'Visti personali',together:'Visti e recensioni',memories:'Ricordi',calendar:'Calendario',search:'Cerca nel catalogo',bulk:'Aggiungi film'};
      show('appRoot',true); show('sceltaCta',home); show('dashboardSidebar',wheel); show('recommendationSection',proposals);
      show('librarySection',!home && !wheel && !proposals); show('nextMovieHero',false); show('scheduledPanel',false);
      show('libraryHeader',destination!=='match'); show('matchViewHeader',destination==='match'); show('libraryBack',destination!=='match');
      for (const id of ['segControl','libraryViewSelect']) el(id)?.classList.toggle('!hidden',!group);
      el('tabAll')?.classList.add('!hidden');
      const all = el('libraryViewSelect')?.querySelector?.('option[value="all"]'); if (all) { all.hidden = true; all.disabled = true; }
      show('historySwitch',personal); show('targetPersonalCollections',personal); show('historySearch',personal);
      show('libraryTools',(group || ['together','search'].includes(destination)));
      show('listFiltersBlock',!personal); show('syncNotice',false);
      text('libraryPageTitle',titles[destination] || '');
      text('libraryPageEyebrow',personal?'IL PERCORSO PERSONALE':destination==='memories'?'TITOLI DI CODA':destination==='calendar'?'IL CARTELLONE':'LO SCAFFALE DEI FILM');
      for (const [id,key] of [['targetPersonalList','personalList'],['targetPersonalSeen','personalSeen']]) el(id)?.setAttribute('aria-pressed',String(destination===key));
      for (const member of members()) {
        const code = member.legacyLabel;
        const node = el('historySwitch'+code); if (!node) continue;
        node.textContent = member.label || code; node.setAttribute('aria-pressed',String(value.context.observedPerson.personId===member.personId));
        bind('historySwitch'+code,'onclick',()=>session.setObservedPerson(member.personId));
      }
      const input = el('movieSearchInput'); if (input) input.value = query;
      bind('movieSearchInput','oninput',()=>{query=input.value;page=0;render();});
      const historyInput=el('historySearchInput');if(historyInput)historyInput.value=query;
      bind('historySearchInput','oninput',()=>{query=historyInput.value;page=0;render();});
      const select = (id,values,chosen,label,onchange) => {
        const node=el(id);if(!node)return;
        const options='<option value="all">'+escape(label)+'</option>'+values.map(v=>'<option value="'+escape(v)+'">'+escape(v)+'</option>').join('');
        if(node.innerHTML!==options)node.innerHTML=options;node.value=chosen||'all';bind(id,'onchange',()=>{onchange(node.value==='all'?'':node.value);page=0;render();});
      };
      const contents=value.catalog.contents;
      select('genreListFilterSelect',[...new Set(contents.flatMap(c=>c.genres||[]))].sort(),genre,'Tutti i generi',v=>genre=v);
      select('platformFilterSelect',[...new Set(contents.map(c=>c.platform).filter(Boolean))].sort(),platform,'Tutte le piattaforme',v=>platform=v);
      // No proposer inferred from legacy added_by: use only explicit content identity.
      select('proposerFilterSelect',members().filter(m=>contents.some(c=>c.added_by_person_id===m.personId)).map(m=>m.label),proposer,'Tutti i propositori',v=>proposer=v);
      if(el('sortKeySelect'))el('sortKeySelect').value=sort;
      bind('sortKeySelect','onchange',()=>{sort=el('sortKeySelect').value;page=0;render();});
      bind('sortDirBtn','onclick',()=>{sortDir=sortDir==='asc'?'desc':'asc';render();});
      for(const [id,key] of [['availabilityStreaming','streaming'],['availabilityCinema','cinema']]) {el(id)?.setAttribute('aria-pressed',String(availability===key));bind(id,'onclick',()=>{availability=key;page=0;render();});}
      for(const [id,count]of [['pillCountWatchlist',value.counts.groupListFilms],['pillCountTonight',value.counts.scheduledEvents],['pillCountRewatch',value.counts.rewatchFilms]])text(id,count);
      text('homeWatchlistCount',value.counts.groupListFilms+' film in attesa del ciak.');
      text('homeWatchedCount',value.counts.togetherFilms+' film visti.');
      const greeting=el('sceltaTitle');if(greeting)greeting.textContent=value.context.caller.label?'Ciao, '+value.context.caller.label+'.':'Benvenuti in sala.';
      show('tabMatch',true);
      if(typeof renderResultsPager==='function')renderResultsPager(null);
    }
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
    const view = () => session.getState().view;
    const button = (label, handler, parent) => { const b = root.createElement('button'); b.className = 'min-h-11 px-3 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-100 text-sm m-1'; b.textContent = label; const token = session.capture(); b.onclick = () => { if (session.current(token)) return handler(); }; parent.appendChild(b); return b; };
    function notice() { const box = el('targetFeedback'); if (box) box.textContent = feedback; }
    async function perform(name, ...args) {
      const token = session.capture(); feedback = 'Salvataggio…'; notice();
      const result = await session.action(token, name, ...args);
      if (!session.current(token)) return result;
      operation = result;
      feedback = result.outcome === 'SUCCESS' ? 'Salvato. Aggiornamento della vista in corso…' : result.outcome === 'ALREADY_IN_TARGET_STATE' ? 'Già aggiornato.' : result.outcome === 'STALE' ? 'I dati sono cambiati. Attendi l’aggiornamento e riprova.' : result.outcome === 'TRANSPORT_UNCERTAIN' ? 'Esito da verificare. Puoi riprovare la stessa operazione.' : result.outcome === 'NOT_READY' ? 'Attendi la verifica online.' : 'Non siamo riusciti a completare l’operazione.';
      notice(); // Feedback only; retry controls reuse the unchanged committed view.
      if (result.retryHandle || name === 'retry') render();
      return result;
    }
    async function performMatch(name, ...args) {
      const token=session.capture(), result=await session.match(token,name,...args);
      if(!session.current(token))return result;
      matchOperation=result;
      if(name==='swipe'&&result.outcome==='SUCCESS'){hapticFeedback('swipe');playSound(args[1]?'like':'nope');}
      feedback=result.category==='TRANSPORT_UNCERTAIN'?'Esito Match da verificare. Riallinea o riprova la stessa operazione.':result.category==='SEMANTIC_RESULT'?'Match aggiornato.':'Non siamo riusciti ad aggiornare Match.';
      render();return result;
    }
    function waitFor(token, predicate) {
      return new Promise(resolve => {
        let off = () => {};
        const check = () => {
          if (!session.current(token)) { off(); resolve(false); return true; }
          const state = session.getState();
          if (state.phase === 'BLOCKED' || state.phase === 'AUTH_INVALIDATING') { off(); resolve(false); return true; }
          if (state.view.kind === 'AVAILABLE' && state.runtime?.source === 'ONLINE' && predicate(state.view)) { off(); resolve(true); return true; }
          return false;
        };
        if (!check()) { off = session.subscribe(check); check(); }
      });
    }
    const success = result => ['SUCCESS','ALREADY_IN_TARGET_STATE'].includes(result.outcome);
    function metadata(details) {
      const out = {};
      for (const k of ['title','duration','platform','poster','overview','genres','director','release_year','collection_name','cast_names']) if (Object.hasOwn(details,k)) out[k] = details[k];
      for (const k of ['tmdb_id','collection_id']) if (details[k] != null) { if (!Number.isSafeInteger(details[k]) && typeof details[k] !== 'string') throw Error('Identificativo non valido'); out[k] = String(details[k]); }
      for (const [from,to] of [['trailerUrl','trailer_url'],['imdbRating','imdb_rating'],['rtRating','rt_rating'],['metacriticRating','metacritic_rating']]) if (Object.hasOwn(details,from)) out[to] = details[from];
      if (typeof details.matched === 'boolean') out.matched = details.matched;
      if (typeof details.cinema_watchlist === 'boolean') out.cinema_watchlist = details.cinema_watchlist;
      return out;
    }
    async function saveContent(details, relation = null) {
      const token = session.capture(), before = view();
      if (before.kind !== 'AVAILABLE') return { outcome: 'NOT_READY' };
      let id = before.catalog.contents.find(c => details.tmdb_id != null && c.tmdb_id === String(details.tmdb_id))?.movie_id;
      let created = null;
      if (!id) {
        created = await perform('createContent', metadata(details));
        if (!success(created)) return { content: created, relation: null };
        if (!session.current(token)) return Object.freeze({ outcome: 'OBSOLETE' });
        id = created.result.movie_id;
        if (view().catalog.getContent(id).kind !== 'AVAILABLE') session.requestRefresh();
        if (!await waitFor(token, v => v.catalog.getContent(id).kind === 'AVAILABLE')) return { content: created, relation: { outcome: 'OBSOLETE' } };
      }
      const result = relation ? await session.action(token, relation, id) : null;
      return Object.freeze({ movieId: id, content: created, relation: result });
    }
    async function bulk(titles, relation = null) {
      const token = session.capture(), results = [];
      for (const title of titles) {
        if (!session.current(token)) break;
        try { const details = await lookup(title); if (!session.current(token)) break; results.push(await saveContent(details, relation)); }
        catch (_) { results.push(Object.freeze({ outcome: 'ERROR' })); }
      }
      return Object.freeze(results);
    }
    function members() {
      const input = view().getRecommendationInput();
      return input.kind === 'AVAILABLE' ? input.input.users.map(p => view().getIdentity(p.id)) : [];
    }
    function navigate(next) { uiEpoch++;if(matchExit)clearTimeout(matchExit);matchExit=null;createdTitle=null;if(!el('confirmModal')?.classList.contains('hidden'))cancelConfirmModal(); for(const id of ['detailModal','statsModal','sagaModal','reviewModal','scheduleModal','addModal','pickerModal','importModal'])if(!el(id)?.classList.contains('hidden'))closeModal(id); if (!['home','personalList','personalSeen','groupList','rewatch','scheduled','together','memories','calendar','match','wheel','recommendations','search','bulk'].includes(next)) return; const previous = destination; if(previous==='wheel'&&next!=='wheel')closeWheelWinner(); if(previous==='match'&&next!=='match'){revealedKey=null;el('matchReveal')?.classList.add('hidden');} if(personalDestination()!==['personalList','personalSeen'].includes(next)){query='';genre='';duration='';platform='';proposer='';} destination = next; page = 0; if (next === 'match') session.match(session.capture(), 'enter'); else if (previous === 'match') session.match(session.capture(), 'leave'); render(); }
    function edit(action, id, initial = {}) {
      if(!initial||!Object.keys(initial).length){
        if(action==='setMyEvaluation')initial=view().getCard(id).personal.caller.judgment??{};
        else if(action==='setGroupEvaluation')initial=view().getCard(id).group.judgment.judgment??{};
        else if(action==='editNight'||action==='completeScheduled')initial=view().getEvent(id).event?.event??{};
      }
      if(['setMyEvaluation','setGroupEvaluation','scheduleNight','quickNight','editNight','completeNow','completeScheduled','scheduleMatch','quickMatch'].includes(action))
        return ProductEditors.open({action,id,initial,context:product(),perform,session,onMatchScheduled:result=>{const movie=product().getMovie(id.matched_movie_id);scheduledMatchTitle=movie?(product().hidden(movie)?'Film a sorpresa':movie.title):'La serata';operation=result;if(result.closeTicket)finishScheduledMatch();}});
      if(action==='createContent'||action==='updateMetadata'){
        const context=product(),relation=destination==='personalList'?'addToMyList':destination==='personalSeen'?'recordSeen':['home','groupList'].includes(destination)?'proposeToGroup':null;
        return ProductEditors.catalog({context,session,lookup,detailsById,search:searchTmdbCandidates,initial:action==='updateMetadata'?context.getMovie(id):null,label:action==='updateMetadata'?'Correggi i metadati':relation==='proposeToGroup'?'Proponi alla Lista del gruppo':relation==='addToMyList'?'Aggiungi alla mia Lista':relation==='recordSeen'?'Aggiungi ai miei Visti':'Aggiungi al catalogo',
          save:async details=>{if(!context.current())return false;const result=action==='updateMetadata'?await perform('updateMetadata',id,metadata(details)):await saveContent(details,relation);return action==='updateMetadata'?success(result):!!result.movieId&&(!relation||success(result.relation));},bulk:titles=>bulk(titles,relation)});
      }
      throw new TypeError('Unsupported product editor');
    }
    function product() {
      const epoch=uiEpoch;
      return ProductContext.create({view:view(),session,destination,perform,edit,isCurrent:()=>epoch===uiEpoch,
        detail:(id,source)=>openMovieDetail(id,source,product()),openSaga,
        ticket:id=>downloadTargetTicket(id,destination==='match'?'match':'wheel',session)});
    }
    function card(id,parent,context) {
      const movie=context.getMovie(id);if(!movie)return;
      parent.appendChild(createMovieCard(movie,view().getVetoForMovie(id).veto?[id]:[],context));
    }
    function drawMatch(parent) {
      const state=session.getState().match,derived=state.derived,context=product().matchContext(state);
      if(createdTitle){parent.innerHTML=matchNightCreatedHtml({createdTitle});return;}
      const card=derived?.currentCard,pending=derived?.pendingMatch,row=state.authoritative?.session;
      const model={movieId:pending?.matched_movie_id||card?.movie_id,index:row?.deck.indexOf(card?.movie_id)??0,matches:derived?.matches??0};
      parent.innerHTML=!derived?matchConnectingHtml():pending?matchMatchHtml(model,context):derived.view==='DONE'||derived.view==='CLOSED'?matchDoneHtml(model,context):context.matchPresentUsers().length<2||!card?matchLobbyHtml(row,context):matchSwipeHtml(model,context);
      bindMatchProduct(parent,state,context);
      if(card&&el('matchCard')){const token=session.capture();matchBindSwipe(el('matchCard'),card.movie_id,liked=>{if(context.current())performMatch('swipe',card,liked);});}
      const key=pending?pending.session_id+':'+pending.matched_movie_id:null;
      if(!key)el('matchReveal')?.classList.add('hidden');
      else if(key!==revealedKey){revealedKey=key;const overlay=el('matchReveal');overlay.innerHTML=matchRevealHtml(model,context);bindMatchProduct(overlay,state,context);overlay.classList.remove('hidden');hapticFeedback('match');playSound('match');fireConfetti();}
      if(matchOperation?.retryHandle){const handle=matchOperation.retryHandle;button('Riprova la stessa operazione',()=>performMatch('retry',handle),parent);}
    }
    function finishScheduledMatch() {
      const ticket=operation?.closeTicket;if(!ticket||closingMatchTicket===ticket)return;
      const token=session.capture(),title=scheduledMatchTitle||'La serata';
      closingMatchTicket=ticket;
      queueMicrotask(async()=>{
        if(!session.current(token))return;
        const result=await session.closeScheduledMatch(ticket);if(!session.current(token))return;
        if(result.code==='SCHEDULE_SNAPSHOT_REQUIRED'){closingMatchTicket=null;return;}
        if(success(result)){operation=null;createdTitle=title;render();matchExit=setTimeout(()=>{matchExit=null;createdTitle=null;navigate('scheduled');},1400);}
        else{matchOperation=result;feedback='Serata salvata. Chiusura Match da verificare.';notice();}
      });
    }
    function bindMatchProduct(parent,state,context) {
      const token=session.capture();
      parent.querySelectorAll('[onclick]').forEach(node=>{
        const code=node.getAttribute('onclick');node.removeAttribute('onclick');let handler;
        if(code.startsWith('swipeCard('))handler=()=>performMatch('swipe',state.derived.currentCard,code.includes(', true)'));
        else if(code.startsWith('newMatchSession(')||code.startsWith('tryMatchAgain('))handler=async()=>{
          if(state.observedSession&&['open','matched'].includes(state.authoritative?.session?.status)){
            const closed=await performMatch('close',state.observedSession);if(!success(closed)||!session.current(token))return;
          }
          return performMatch('start');
        };
        else if(code.startsWith('continueFromMatch('))handler=()=>performMatch('acknowledge',state.derived.pendingMatch);
        else if(code.startsWith('createMatchNight('))handler=()=>edit(code.includes("'tonight'")?'quickMatch':'scheduleMatch',state.derived.pendingMatch,context.scheduleInitial(context.getMovie(state.derived.pendingMatch.matched_movie_id)));
        else if(code.startsWith('downloadTicket('))handler=()=>downloadTargetTicket(state.derived.pendingMatch.matched_movie_id,'match',session);
        else if(code.startsWith('exitMatchView('))handler=()=>navigate('home');
        else if(code.startsWith('closeMatchReveal('))handler=()=>el('matchReveal').classList.add('hidden');
        else throw Error('Unbound product Match action');
        node.onclick=()=>{if(context.current())handler();};
      });context.bind(parent);
    }
    function render() {
      const state = session.getState(), value = state.view;
      const grid = el('movieGrid'); if (!grid) return;
      if(destination==='match'&&typeof matchDragging!=='undefined'&&matchDragging){matchPendingRender=true;return;}
      if (value.kind === 'AVAILABLE' && typeof finishInitialLoading === 'function') finishInitialLoading();
      grid.innerHTML = '';
      // Reuse the existing app chrome; there is no second navigation in the grid.
      if (value.kind === 'AVAILABLE') {
        syncLayout(value);
        if(!el('detailModal')?.classList.contains('hidden')){
          const context=product(),movie=context.getMovie(el('detailBody').dataset.movieId);
          if(!movie||context.hidden(movie))closeModal('detailModal');else renderMovieDetail(movie,context);
        }
      }
      const status = root.createElement('p'); status.id = 'targetFeedback'; status.className = 'col-span-full text-sm'; status.setAttribute('role','status'); grid.appendChild(status); notice();
      if (value.kind !== 'AVAILABLE') { for(const id of ['detailModal','statsModal','sagaModal','reviewModal','scheduleModal','addModal','pickerModal','importModal'])if(!el(id)?.classList.contains('hidden'))closeModal(id); status.textContent = state.phase === 'BLOCKED' ? 'Servizio momentaneamente non disponibile.' : 'Caricamento…'; button('Riprova',()=>state.phase==='BLOCKED'?session.retryStartup():session.requestRefresh(),status);return; }
      if(value.freshness.source==='CACHE') {status.textContent='Dati salvati: attendi la verifica online.';text('syncNotice','Stai vedendo i dati salvati. Attendi la verifica online per modificare.');show('syncNotice',true);}
      if (operation?.retryHandle) { const handle=operation.retryHandle; button('Riprova la stessa operazione',()=>perform('retry',handle),status); }

      const context=product();
      if (destination === 'match') { const panel=root.createElement('section');panel.className='col-span-full match-panel glass-panel p-4 rounded-xl';grid.appendChild(panel);drawMatch(panel);return; }
      if (destination === 'home') {
        const context=product();renderNextMovieBox(new Date(),context);renderScheduled(new Date(),context);
        return;
      }
      if(destination==='calendar'){renderCalendar(product());return;}
      if(destination==='memories'){
        show('librarySection',false);show('sceltaCta',true);
        if(el('statsModal').classList.contains('hidden'))openModal('statsModal');
        renderStats(product());return;
      }
      if (destination==='bulk') {edit('createContent');return;}
      let contents;
      if (destination === 'personalList' || destination === 'personalSeen') {
        const personal = value.personal.observed;
        if (personal.kind !== 'AVAILABLE') { status.textContent = 'Dati personali non disponibili.'; return; }
        contents = destination === 'personalList' ? personal.list : personal.seen;
      } else if (destination === 'groupList') contents = value.group.visibleList;
      else if (destination === 'rewatch') contents = value.group.rewatch;
      else if (destination === 'together') contents = value.group.togetherFilms;
      else if (destination==='scheduled') {
        const context=product();
        const scheduledContents=[...new Map(value.events.scheduled.filter(item=>item.content.kind==='AVAILABLE').map(item=>[item.movieId,item.content.content])).values()];
        const rank=new Map(filtered(scheduledContents).map((content,index)=>[content.movie_id,index]));
        const entries=value.events.scheduled.filter(item=>rank.has(item.movieId)).map(item=>context.movieProjection(context.getMovie(item.movieId),context.nights.find(n=>n.id===item.eventId)))
          .sort((a,b)=>rank.get(a.id)-rank.get(b.id)||(a.scheduled_date||'').localeCompare(b.scheduled_date||'')||a.nightId.localeCompare(b.nightId));
        text('libraryCount',entries.length+' serate');
        renderScheduled(new Date(),context,grid,entries);if(!entries.length)grid.innerHTML='<p>'+ (value.events.scheduled.length?'Nessuna serata corrisponde ai filtri.':'Nessuna serata in programma.') +'</p>';
        return;
      } else if (destination === 'search') contents=query?value.search.contents:[];
      else if (destination === 'recommendations') {
        if(!recommendation.length){const input=value.getRecommendationInput();recommendation=input.kind==='AVAILABLE'?RecommendationEngine.rerank(RecommendationEngine.recommend(input.input),6):[];}
        contents = recommendation.map(r=>value.catalog.getContent(r.movieId)).filter(x=>x.kind === 'AVAILABLE').map(x=>x.content);
      } else if (destination === 'wheel') {
        el('dashboardSidebar')?.classList.remove('hidden','!hidden'); syncGenreFilterOptions(); drawWheel();
        contents = value.ruota.eligibleContents;


      } else contents = [];
      const rows = filtered(contents);
      const container = destination==='recommendations'?el('recommendationResults'):grid;
      if(container!==grid)container.innerHTML='';
      text('libraryCount',rows.length+' film');
      const model=typeof paginateResults==='function'?paginateResults(rows,page):null;
      if(model)page=model.pageIndex;
      for (const c of (model?.items || rows.slice(page*24,(page+1)*24))) card(c.movie_id,container,context);
      if (!rows.length) container.insertAdjacentHTML('beforeend','<p>Nessun film in questa vista.</p>');
      if(model&&destination!=='recommendations'&&typeof renderResultsPager==='function')renderResultsPager(model);
      if(destination==='wheel')show('librarySection',false);

    }
    async function openSaga(movieId) {
      const token=session.capture(),context=product(),movie=context.getMovie(movieId);if(!movie||context.hidden(movie)||!movie.collection_id)return;
      const panel={movieId,user:context.callerLabel,loading:true,collection:null,selected:new Set(),busy:false,message:''};
      const draw=()=>renderSagaPanel({...product(),bindSaga},panel);
      function bindSaga(box) {
        context.bind(box);
        box.querySelectorAll('[onchange]').forEach(input=>{input.removeAttribute('onchange');input.onchange=()=>{if(!context.current())return;const id=Number(input.value);if(input.checked)panel.selected.add(id);else panel.selected.delete(id);draw();};});
        box.querySelectorAll('[onclick]').forEach(node=>{const code=node.getAttribute('onclick');node.removeAttribute('onclick');node.onclick=async()=>{
          if(!context.current()||panel.busy)return;
          if(code.startsWith('retryMovieSaga(')){openSaga(movieId);return;}
          if(!code.startsWith('addSagaChapters('))return;
          panel.busy=true;draw();let failed=false;
          try{for(const id of [...panel.selected]){const details=await detailsById(id);if(!context.current())return;const part=panel.collection.parts.find(p=>p.id===id);const future=typeof part?.release_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(part.release_date)&&part.release_date>context.view.context.temporal.local_date;const result=await saveContent(future?{...details,cinema_watchlist:true}:details,'proposeToGroup');if(!context.current())return;if(result.movieId&&(!result.relation||success(result.relation)))panel.selected.delete(id);else failed=true;}}
          catch(_){failed=true;}
          finally{if(context.current()){panel.busy=false;panel.message=failed?'Alcune proposte non sono state completate.':'Proposte salvate.';draw();}}
        };});
      }
      draw();openModal('sagaModal');
      try{const collection=await fetchTmdbCollection(movie.collection_id);if(!context.current())return;panel.collection=collection;}
      catch(_){if(!context.current())return;panel.collection=null;}
      panel.loading=false;draw();
    }
    function filtered(contents) {
      const context=view();
      const sortKey=personalDestination()?'title':sort;
      const metric=c=>sortKey==='duration'?parseDurationMinutes(c.duration):sortKey==='release_year'||sortKey==='year'?c.release_year:sortKey==='added'?c.created_at:sortKey==='imdb'?c.imdb_rating:sortKey==='proposer'?(c.added_by_person_id?context.getIdentity(c.added_by_person_id).label:null):sortKey==='rating'?context.getCard(c.movie_id).personal.caller.judgment?.rating:c.title;
      const sign=personalDestination()?1:sortDir==='desc'?-1:1;
      return contents.filter(c=>(!query||[c.title,c.director,...(c.genres||[])].join(' ').toLocaleLowerCase('it').includes(query.toLocaleLowerCase('it')))&&(!genre||c.genres?.includes(genre))&&(!platform||c.platform===platform)&&(!proposer||(c.added_by_person_id?context.getIdentity(c.added_by_person_id).label:null)===proposer)&&(personalDestination()||(availability==='cinema'?c.cinema_watchlist:!c.cinema_watchlist))&&(!duration||(parseDurationMinutes(c.duration)!==null&&parseDurationMinutes(c.duration)<=Number(duration))))
        .slice().sort((a,b)=>{const x=metric(a),y=metric(b);if(x==null||y==null)return x==null?(y==null?0:1):-1;return sign*(typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),'it'))||a.movie_id.localeCompare(b.movie_id);});
    }
    return Object.freeze({ render, navigate, getDestination:()=>destination, changePage(delta){page=Math.max(0,page+delta);render();}, perform, performMatch, waitFor, saveContent, bulk,
      setFilters(input) { query = input.query ?? query; genre = input.genre ?? genre; duration = input.duration ?? duration; sort = input.sort ?? sort; page = 0; render(); },
      detail(id,source) { const context=product();openMovieDetail(id,source,context); }, edit,
      presentation:product,
      refreshCalendar(){renderCalendar(product());}, refreshMemories(){renderStats(product());},
      publication(state) { if(generation!==null&&generation!==state.generation)this.dispose();generation=state.generation; if (['AUTH_INVALIDATING','STOPPED','DISPOSED'].includes(state.phase)) { el('movieGrid').innerHTML = ''; this.dispose(); return; } if (state.view !== shared) { shared = state.view; if(state.view.kind==='AVAILABLE'&&!el('reviewModal')?.classList.contains('hidden'))ProductEditors.refresh(product()); if(operation?.closeTicket)finishScheduledMatch(); if(state.runtime?.pending.thresholds===null&&operation?.outcome==='SUCCESS')feedback='Salvato.'; render(); } else if (state.match !== match && destination === 'match') render(); match = state.match; },
      dispose() { uiEpoch++;if(!el('confirmModal')?.classList.contains('hidden'))cancelConfirmModal();if(matchExit)clearTimeout(matchExit);matchExit=null;createdTitle=null;closingMatchTicket=null; for(const id of ['detailModal','statsModal','sagaModal','reviewModal','scheduleModal','addModal','pickerModal','importModal'])if(!el(id)?.classList.contains('hidden'))closeModal(id); for(const id of ['nextMovieBox','recommendationResults'])if(el(id))el(id).innerHTML='';for(const [node,properties] of bindings)for(const [key,handler] of properties)node[key]=handler;bindings.clear();el('tabAll')?.classList.remove('!hidden');const all=el('libraryViewSelect')?.querySelector?.('option[value="all"]');if(all){all.hidden=false;all.disabled=false;}show('targetPersonalCollections',false); el('matchReveal')?.classList.add('hidden'); for (const id of ['sceltaCta','dashboardSidebar','recommendationSection','segControl','libraryTools','historySwitch','listFiltersBlock','syncNotice']) el(id)?.classList.remove('!hidden'); generation = null; query = ''; genre=''; duration=''; sort='added'; sortDir='desc'; platform=''; proposer=''; availability='streaming'; page = 0; destination = 'home'; revealedKey = null; operation = null; matchOperation = null; recommendation = []; shared = null; match = null; }
    });
  }
  let instance = null;
  const current = () => instance || (instance = createShell({ session: ProductionSession }));
  return Object.freeze({ createShell, render: () => current().render(), getDestination:()=>current().getDestination(), changePage:delta=>current().changePage(delta), publication: state => current().publication(state), saveContent: (...args) => current().saveContent(...args), bulk: (...args) => current().bulk(...args), setFilters: input => current().setFilters(input), navigate: destination => current().navigate(destination), detail: (id,source) => current().detail(id,source), edit: (...args) => current().edit(...args), presentation:()=>current().presentation(), refreshCalendar:()=>current().refreshCalendar(), refreshMemories:()=>current().refreshMemories(), perform: (...args) => current().perform(...args), performMatch: (...args) => current().performMatch(...args), dispose() { instance?.dispose(); instance = null; } });
})();
