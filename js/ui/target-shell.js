'use strict';
// Semantic TARGET renderer. No legacy rows, store arrays or legacy selectors.
const TargetShell = (() => {
  function createShell({ session, root = document, lookup = fetchMovieDetails, detailsById = fetchTmdbDetailsById }) {
    let destination = 'home', query = '', genre = '', duration = '', sort = 'added', sortDir = 'desc', platform = '', proposer = '', availability = 'streaming', page = 0, feedback = '', operation = null, matchOperation = null, revealedKey = null, recommendation = null;
    let shared = null, match = null, generation = null, uiEpoch = 0, closingMatchTicket = null, createdTitle = null, matchExit = null, scheduledMatchTitle = null, revealInterrupted = false;
    const el = id => root.getElementById(id);
    const bindings = new Map();
    let homeTrigger = null; // DOM keyboard return only; never viewing/session state.
    let lastAction = null, feedbackZone = null, feedbackSerial = 0, feedbackTimer = null, feedbackKind = null, retainOnClose = null;
    const savedMessage = name => ({
      quickNight:'Film scelto. Da vedere insieme.',scheduleNight:'Proposta salvata in In programma.',
      recordSeen:'Aggiunto ai miei Visti.',removeSeen:'Rimosso dai miei Visti. Il giudizio resta.',
      addToMyList:'Aggiunto ai tuoi Da vedere.',removeFromMyList:'Tolto dai tuoi Da vedere.',
      proposeToGroup:'Proposto per voi.',withdrawGroupCandidacy:'Tolto dai Da vedere insieme. Visioni e giudizi restano.',
      setMyEvaluation:'Giudizio personale aggiornato.',setMyRating:'Voto personale aggiornato.',setMyPreference:'Gradimento aggiornato.',setMyReview:'Recensione personale aggiornata.',
      setGroupEvaluation:'Giudizio N+V aggiornato.',setGroupRating:'Voto N+V aggiornato.',setGroupReview:'Recensione N+V aggiornata.',
      confirmNight:'Proposta accettata.',cancelNight:'Serata annullata.',editNight:'Dettagli della serata aggiornati.',completeScheduled:'Serata conclusa.',completeNow:'Visione insieme registrata.',
      createContent:'Film aggiunto al catalogo.',updateMetadata:'Informazioni del film aggiornate.',deleteContent:'Film rimosso dal catalogo.',
      setCinema:'Collocazione del film aggiornata.',setSurprise:'Sorpresa aggiornata.',removeVeto:'Veto rimosso.',addVeto:'Veto aggiunto.',recordPersonalViewing:'Visione personale registrata.'
    }[name] || 'Operazione completata.');
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
      const titles = {groupList:'Da vedere insieme',rewatch:'Rewatch',scheduled:'In programma',personalList:'Il mio cinema',personalSeen:'Il mio cinema',together:'Visti insieme',memories:'Ricordi',calendar:'Calendario',search:'Cerca nel catalogo',bulk:'Aggiungi film'};
      show('appRoot',true); show('sceltaCta',home); show('dashboardSidebar',wheel); show('recommendationSection',proposals);
      show('librarySection',!home && !wheel && !proposals); show('nextMovieHero',false); show('scheduledPanel',false);
      show('libraryHeader',destination!=='match'); show('matchViewHeader',destination==='match'); show('libraryBack',destination!=='match');
      for (const id of ['segControl','libraryViewSelect']) el(id)?.classList.toggle('!hidden',!group);
      el('tabAll')?.classList.add('!hidden');
      const all = el('libraryViewSelect')?.querySelector?.('option[value="all"]'); if (all) { all.hidden = true; all.disabled = true; }
      show('targetPersonalIntro',personal); show('historySwitch',personal); show('targetPersonalCollections',personal); show('historySearch',personal);
      show('libraryTools',(group || ['together','search'].includes(destination)));
      show('listFiltersBlock',!personal); show('syncNotice',false);
      text('libraryPageTitle',titles[destination] || '');
      text('libraryPageEyebrow',personal?'IL CINEMA DI '+value.context.observedPerson.label:destination==='memories'?'TITOLI DI CODA':destination==='calendar'?'IL CARTELLONE':'LO SCAFFALE DEI FILM');
      const own = value.context.caller.personId === value.context.observedPerson.personId;
      text('targetPersonalList',own?'Da vedere':'Da vedere di '+value.context.observedPerson.label);
      text('targetPersonalSeen',own?'I miei Visti':'I Visti di '+value.context.observedPerson.label);
      for (const [id,key] of [['targetPersonalList','personalList'],['targetPersonalSeen','personalSeen']]) el(id)?.setAttribute('aria-pressed',String(destination===key));
      text('targetPersonalHint',own ? (destination==='personalList'?'I film che vuoi vedere o rivedere.':'I film che hai visto personalmente, anche fuori dalle serate insieme.') : 'Stai consultando il cinema di '+value.context.observedPerson.label+'. Le aggiunte restano tue.');
      text('targetPersonalAdd','+ Cerca un film');
      bind('targetPersonalAdd','onclick',()=>edit('createContent'));
      for (const member of members()) {
        const code = member.legacyLabel;
        const node = el('historySwitch'+code); if (!node) continue;
        node.textContent = (member.label || code)+(member.personId===value.context.caller.personId?' · tu':''); node.setAttribute('aria-pressed',String(value.context.observedPerson.personId===member.personId));
        bind('historySwitch'+code,'onclick',()=>{uiEpoch++;page=0;query='';for(const id of ['addModal','pickerModal','reviewModal'])if(!el(id)?.classList.contains('hidden'))closeModal(id);session.setObservedPerson(member.personId);});
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
    function notice() {
      const global=el('targetFeedback');
      const globalMessage=el('targetFeedbackMessage');
      const slots=root.querySelectorAll('[data-action-feedback]');
      let local=false;for(const slot of slots){const selected=slot.dataset.actionFeedback===feedbackZone;slot.textContent=selected?feedback:'';if(selected&&slot.getClientRects?.().length!==0)local=true;else if(selected)slot.textContent='';}
      if(globalMessage)globalMessage.textContent=local?'':feedback;
      if(global)global.hidden=!(globalMessage?.textContent||global.querySelector('button'));
      const fallback=el('detailFeedback');if(fallback)fallback.textContent='';
    }
    function stopFeedbackTimer() {
      if(feedbackTimer){clearTimeout(feedbackTimer);feedbackTimer=null;}
    }
    function clearFeedback() {
      feedbackSerial++;stopFeedbackTimer();feedback='';feedbackZone=null;feedbackKind=null;retainOnClose=null;notice();
    }
    function dismissSuccessAfter(serial) {
      feedbackTimer=setTimeout(()=>{
        if(serial===feedbackSerial&&feedbackKind==='success')clearFeedback();
        feedbackTimer=null;
      },2600);
    }
    function modalChanged(id,phase) {
      if(feedbackKind!=='success')return;
      // The editor closes after a successful save; the toast must remain readable.
      if(phase==='close'&&id===retainOnClose){retainOnClose=null;return;}
      clearFeedback();
    }
    async function runAction(name, args, inlinePending = false) {
      const token = session.capture(),serial=++feedbackSerial, origin=destination;
      stopFeedbackTimer();feedbackKind='pending';retainOnClose=null;
      if(name!=='retry')lastAction=name;
      feedback = inlinePending?'':'Salvataggio…'; notice();
      let result;
      try { result=await session.action(token, name, ...args); }
      catch (_) {
        if(session.current(token)&&serial===feedbackSerial&&(!inlinePending||destination===origin)){feedbackKind='error';feedback='Non siamo riusciti a completare l’operazione.'+(inlinePending?' Riprova dal controllo di rimozione.':'');notice();}
        return {outcome:'ERROR'};
      }
      if (!session.current(token)||serial!==feedbackSerial||(inlinePending&&destination!==origin)) return result;
      operation = result;
      feedback = result.outcome === 'SUCCESS' ? savedMessage(lastAction) : result.outcome === 'ALREADY_IN_TARGET_STATE' ? 'Nessuna modifica necessaria.' : result.outcome === 'STALE' ? 'I dati sono cambiati. Attendi l’aggiornamento e riprova.' : result.outcome === 'TRANSPORT_UNCERTAIN' ? 'Esito da verificare. Puoi riprovare la stessa operazione.' : result.outcome === 'NOT_READY' ? 'Attendi la verifica online.' : 'Non siamo riusciti a completare l’operazione.';
      feedbackKind=['SUCCESS','ALREADY_IN_TARGET_STATE'].includes(result.outcome)?'success':'error';
      if(feedbackKind==='success'&&!el('reviewModal')?.classList.contains('hidden'))retainOnClose='reviewModal';
      if(inlinePending&&!['SUCCESS','ALREADY_IN_TARGET_STATE'].includes(result.outcome)&&!result.retryHandle)feedback+=' Riprova dal controllo di rimozione.';
      notice(); // Feedback only; retry controls reuse the unchanged committed view.
      if (result.retryHandle || name === 'retry') render();
      if(feedbackKind==='success')dismissSuccessAfter(serial);
      return result;
    }
    function perform(name, ...args) { return runAction(name,args); }
    function performInline(name, ...args) { return runAction(name,args,true); }
    async function performMatch(name, ...args) {
      const token=session.capture(), result=await session.match(token,name,...args);
      if(!session.current(token))return result;
      const serial=++feedbackSerial;stopFeedbackTimer();retainOnClose=null;
      matchOperation=result;
      if(name==='swipe'&&result.outcome==='SUCCESS'){hapticFeedback('swipe');playSound(args[1]?'like':'nope');}
      feedback=result.category==='TRANSPORT_UNCERTAIN'?'Esito Match da verificare. Riallinea o riprova la stessa operazione.':result.category==='SEMANTIC_RESULT'?'Match aggiornato.':'Non siamo riusciti ad aggiornare Match.';
      feedbackKind=result.category==='SEMANTIC_RESULT'?'success':'error';
      if(feedbackKind==='success')dismissSuccessAfter(serial);
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
      let id = details.movie_id&&before.catalog.getContent(details.movie_id).kind==='AVAILABLE'?details.movie_id:before.catalog.contents.find(c => details.tmdb_id != null && c.tmdb_id === String(details.tmdb_id))?.movie_id;
      let created = null;
      if (!id) {
        created = await perform('createContent', metadata(details));
        if (!success(created)) return { content: created, relation: null };
        if (!session.current(token)) return Object.freeze({ outcome: 'OBSOLETE' });
        id = created.result.movie_id;
        if (view().catalog.getContent(id).kind !== 'AVAILABLE') session.requestRefresh();
        if (!await waitFor(token, v => v.catalog.getContent(id).kind === 'AVAILABLE')) return { content: created, relation: { outcome: 'OBSOLETE' } };
      }
      if(!session.current(token))return Object.freeze({movieId:id,relation:{outcome:'OBSOLETE'}});
      const result = relation ? await perform(relation,id) : null;
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
    const recommendationInput = value => value.getRecommendationInput({ constraints: { context: 'all' } });
    const recommendationSignature = input => JSON.stringify({ users: input.users, group: input.group,
      candidates: input.candidates, contentFeatures: input.contentFeatures, constraints: input.constraints,
      personalSignals: Object.fromEntries(Object.entries(input.personalSignals || {}).map(([id,signals]) => [id,
        { ratings: signals.ratings, preferences: signals.preferences }])),
      sharedSignals: { ratings: input.sharedSignals?.ratings, events: input.sharedSignals?.events } });
    function nextRecommendationBatch(ranked, shown) {
      const used = new Set(shown);
      return RecommendationEngine.rerank(ranked.filter(row => !used.has(row.movieId)), RecommendationConfig.diversity.defaultShortlistSize);
    }
    function recommendationReason(result, value) {
      const reasons = result.reasons || [], personal = Object.values(result.personal || {});
      const name = reason => {
        const id = reason.userIds?.[0];
        const label = id ? value.getIdentity(id)?.legacyLabel : null;
        return label ? CONFIG.PEOPLE[label]?.label || label : 'Una persona del gruppo';
      };
      const direct = reasons.find(reason => ['EXPLICIT_LIKE','EXPLICIT_DISLIKE','PERSONAL_RATING_POSITIVE','PERSONAL_RATING_NEUTRAL','PERSONAL_RATING_NEGATIVE'].includes(reason.code) && reason.userIds?.length);
      if (direct) return ({ EXPLICIT_LIKE:`A ${name(direct)} è piaciuto.`, EXPLICIT_DISLIKE:`A ${name(direct)} non è piaciuto.`,
        PERSONAL_RATING_POSITIVE:`${name(direct)} gli ha dato un voto positivo.`, PERSONAL_RATING_NEUTRAL:`${name(direct)} gli ha dato un voto nella fascia neutra.`,
        PERSONAL_RATING_NEGATIVE:`Il voto di ${name(direct)} è un segnale negativo.` })[direct.code];
      if (personal.length && personal.every(p => ['UNKNOWN','LOW_EVIDENCE'].includes(p.state)))
        return 'Pochi giudizi disponibili per spiegare questa proposta.';
      if (reasons.some(reason => reason.code === 'FEATURE_AFFINITY' && reason.evidenceMovieIds?.length))
        return 'Alcuni elementi richiamano film già valutati.';
      if (reasons.some(reason => reason.code === 'TOGETHER_RATING' && reason.evidenceMovieIds?.length))
        return 'I giudizi condivisi contribuiscono alla proposta.';
      if (reasons.some(reason => reason.code === 'NEGATIVE_PROTECTION'))
        return 'Un giudizio negativo riduce la priorità di questo film.';
      return 'Pochi giudizi disponibili per spiegare questa proposta.';
    }
    function startRecommendations() {
      const token = session.capture(), epoch = uiEpoch, source = view();
      recommendation = { status:'loading' };
      Promise.resolve().then(() => {
        if (!session.current(token) || epoch !== uiEpoch || destination !== 'recommendations') return;
        try {
          const sourceInput = recommendationInput(source);
          if (sourceInput.kind !== 'AVAILABLE') throw new TypeError('TARGET_RECOMMENDATION_INPUT_REQUIRED');
          const input = sourceInput.input, ranked = RecommendationEngine.recommend(input);
          const batch = nextRecommendationBatch(ranked, []), shown = batch.map(row => row.movieId);
          recommendation = { status:'ready', ranked, batch, shown, hasMore:nextRecommendationBatch(ranked, shown).length > 0,
            signature:recommendationSignature(input), hadSharedCandidates:input.candidates.some(row => row.inSharedList),
            contents:new Map(source.catalog.contents.map(row => [row.movie_id,row])) };
        } catch (error) { recommendation = { status:'error' }; console.error('[sc(r)occhiaTu] TARGET Recommendation consumer failed.',error); }
        render();
      });
    }
    function renderRecommendations(value) {
      if (!recommendation) startRecommendations();
      const state = recommendation, section = el('recommendationSection'), results = el('recommendationResults');
      const status = el('recommendationStatus'), empty = el('recommendationEmpty'), error = el('recommendationError'),
        stale = el('recommendationStale'), more = el('recommendationMore');
      section?.setAttribute('aria-busy',String(state.status === 'loading'));
      empty?.classList.add('hidden'); error?.classList.add('hidden'); stale?.classList.add('hidden'); more?.classList.add('hidden');
      if (state.status !== 'ready') {
        if (results) results.innerHTML='';
        if (status) status.textContent=state.status==='loading'?'Stiamo preparando le proposte…':'';
        if (state.status==='error') error?.classList.remove('hidden');
        return;
      }
      if (status) status.textContent = !state.batch.length ? '' : state.hasMore
        ? state.batch.length+' propost'+(state.batch.length===1?'a':'e')+' · altre disponibili.' : 'Questi sono tutti i suggerimenti disponibili. Aggiorna per ricominciare.';
      if (!state.batch.length) {
        if (empty) { empty.textContent=state.hadSharedCandidates
          ? 'Nessun film della Lista condivisa è ora candidabile. Controlla le serate già aperte.'
          : 'La Lista condivisa è vuota. Aggiungi un film alla Lista per ricevere proposte.'; empty.classList.remove('hidden'); }
      }
      const markup = state.batch.map(result => {
        const content = state.contents.get(result.movieId);
        if (!content) return '';
        const title = result.title || content.title, meta = [content.release_year,content.duration].filter(Boolean).join(' · ');
        const poster = content.poster ? '<img class="recommendation-poster" src="'+escape(content.poster)+'" alt="" loading="lazy">'
          : '<div class="recommendation-poster" aria-hidden="true"><i class="fa-solid fa-film"></i></div>';
        return '<article class="recommendation-card" role="button" tabindex="0" data-recommendation-id="'+escape(result.movieId)+'" aria-label="Apri la scheda di '+escape(title)+'">'
          +poster+'<div class="min-w-0"><h3 class="recommendation-title">'+escape(title)+'</h3>'
          +(meta?'<p class="recommendation-meta">'+escape(meta)+'</p>':'')
          +'<p class="recommendation-reason">'+escape(recommendationReason(result,value))+'</p></div>'
          +'<i class="fa-solid fa-chevron-right text-slate-400" aria-hidden="true"></i></article>';
      }).join('');
      if (results && results.innerHTML!==markup) results.innerHTML=markup;
      results?.querySelectorAll('[data-recommendation-id]').forEach(row => {
        const open = () => { const current=view(),id=row.dataset.recommendationId;
          if (current.kind==='AVAILABLE' && current.catalog.getContent(id).kind==='AVAILABLE') openDetail(id,row); };
        row.onclick=open; row.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}};
      });
      try { const current=recommendationInput(value);stale?.classList.toggle('hidden',current.kind==='AVAILABLE'&&recommendationSignature(current.input)===state.signature); }
      catch (_) { stale?.classList.remove('hidden'); }
      if (state.hasMore) more?.classList.remove('hidden');
    }
    function refreshRecommendations() { if (destination!=='recommendations') return; recommendation=null;render(); }
    function showMoreRecommendations() {
      if(destination!=='recommendations'||recommendation?.status!=='ready'||!recommendation.hasMore)return;
      const batch=nextRecommendationBatch(recommendation.ranked,recommendation.shown);
      recommendation.batch=batch;recommendation.shown.push(...batch.map(row=>row.movieId));
      recommendation.hasMore=nextRecommendationBatch(recommendation.ranked,recommendation.shown).length>0;
      render();
    }
    function navigate(next, source = null) {
      if (!['home','personalList','personalSeen','groupList','rewatch','scheduled','together','memories','calendar','match','wheel','recommendations','search','bulk'].includes(next)) return;
      const previous = destination;
      const origin = source ?? root.activeElement;
      if (previous === 'home' && origin?.closest?.('#sceltaCta, #scheduledPanel')) homeTrigger = origin;
      uiEpoch++; if(matchExit)clearTimeout(matchExit); matchExit=null; createdTitle=null;
      if(!el('confirmModal')?.classList.contains('hidden'))cancelConfirmModal();
      for(const id of ['metadataRefreshModal','personalStatusModal','otherJudgmentModal','togetherModal','detailModal','statsModal','sagaModal','reviewModal','scheduleModal','addModal','pickerModal','importModal'])if(!el(id)?.classList.contains('hidden'))closeModal(id);
      if(previous==='wheel'&&next!=='wheel')closeWheelWinner();
      if(previous==='match'&&next!=='match'){revealedKey=null;revealInterrupted=false;el('matchReveal')?.classList.add('hidden');}
      const scope = route => ['groupList','rewatch','scheduled'].includes(route) ? 'list'
        : ['personalList','personalSeen'].includes(route) ? 'personal' : route;
      if(scope(previous)!==scope(next)){query='';genre='';duration='';platform='';proposer='';availability='streaming';sort='added';sortDir='desc';}
      destination = next; page = 0;
      if(previous!==next){clearFeedback();operation=null;}
      if(next==='recommendations'&&previous!==next)recommendation=null;
      if(next==='match')session.match(session.capture(),'enter');else if(previous==='match')session.match(session.capture(),'leave');
      render();
      if (next !== 'memories') {
        window.scrollTo?.({top:0,behavior:'auto'});
        const heading = next==='home' ? el('sceltaTitle') : next==='wheel' ? el('wheelPanel')?.querySelector?.('h2')
          : next==='recommendations' ? el('recommendationSection')?.querySelector?.('h2') : next==='match' ? el('matchViewHeader')?.querySelector?.('h2') : el('libraryPageTitle');
        const target = next==='home' && homeTrigger?.isConnected ? homeTrigger : heading;
        if(target){if(target===heading){target.setAttribute('tabindex','-1');target.classList.add('destination-heading');}target.focus?.({preventScroll:true});}
      }
    }
    function edit(action, id, initial = {}) {
      if(!initial||!Object.keys(initial).length){
        if(action==='setMyEvaluation')initial=view().getCard(id).personal.caller.judgment??{};
        else if(action==='setGroupEvaluation')initial=view().getCard(id).group.judgment.judgment??{};
        else if(action==='editNight'||action==='completeScheduled')initial=view().getEvent(id).event?.event??{};
      }
      if(['setMyEvaluation','setGroupEvaluation','scheduleNight','quickNight','editNight','completeNow','completeScheduled','scheduleMatch','quickMatch'].includes(action))
        return ProductEditors.open({action,id,initial,context:product(),perform,session,onMatchScheduled:result=>{const movie=product().getMovie(id.matched_movie_id);scheduledMatchTitle=movie?(product().hidden(movie)?'Film a sorpresa':movie.title):'La serata';operation=result;if(result.closeTicket)finishScheduledMatch();}});
      if(action==='createContent'){
        const context=product(),defaultDestination=initial?.entry==='global'?null:destination==='personalList'?'personalList':destination==='personalSeen'?'personalSeen':destination==='groupList'?'groupList':null;
        return ProductEditors.addCatalog({context,search:searchTmdbCandidates,detailsById,defaultDestination,
          save:(details,relation)=>saveContent(details,relation),bulk:(titles,relation)=>bulk(titles,relation)});
      }
      if(action==='refreshMetadata'){
        const context=product();
        return ProductEditors.refreshMetadata({context,session,movieId:id,detailsById,perform});
      }
      throw new TypeError('Unsupported product editor');
    }
    function product() {
      const epoch=uiEpoch,observed=view().context.observedPerson.personId;
      return ProductContext.create({view:view(),session,destination,perform,performInline,edit,feedback,feedbackZone,onActionSource:node=>{const removing=node.dataset.listRemoval==='true';clearFeedback();feedbackZone=removing?null:node.closest?.('[data-feedback-zone]')?.dataset.feedbackZone||null;if(removing){operation=null;el('targetFeedback')?.querySelectorAll('button').forEach(button=>button.remove());}},isCurrent:()=>epoch===uiEpoch&&view().kind==='AVAILABLE'&&view().context.observedPerson.personId===observed,
        detail:openDetail,openTogether,openPersonalStatus,openOtherJudgment,openSaga,
        ticket:id=>downloadTargetTicket(id,destination==='match'?'match':'wheel',session)});
    }
    function openDetail(id,source,nightId=null,openNights=false){clearFeedback();openMovieDetail(id,source,product(),nightId,openNights);}
    function renderTogetherPopup() {
      const body=el('togetherPopupBody'),context=product(),movie=context.getMovie(body?.dataset.movieId);
      if(!body||!movie||context.hidden(movie)||!context.togetherSeen(movie)){closeModal('togetherModal');return;}
      const opened=new Set([...body.querySelectorAll('details[data-night-id][open]')].map(node=>node.dataset.nightId));
      const focused=body.contains?.(root.activeElement)?root.activeElement:null;
      const focusKey=focused?.dataset?.returnFocusKey;
      const focusNight=focused?.closest?.('[data-night-id]')?.dataset.nightId;
      body.innerHTML=context.togetherPopupHtml(movie,{fromDetail:body.dataset.fromDetail==='true'});
      for(const row of body.querySelectorAll('details[data-night-id]'))if(opened.has(row.dataset.nightId))row.open=true;
      context.bind(body);
      if(focused){
        const replacement=focusKey?[...body.querySelectorAll('[data-return-focus-key]')].find(node=>node.dataset.returnFocusKey===focusKey)
          :focusNight?[...body.querySelectorAll('[data-night-id]')].find(node=>node.dataset.nightId===focusNight)?.querySelector('summary'):null;
        (replacement||el('togetherModalClose'))?.focus?.({preventScroll:true});
      }
    }
    function openTogether(id,source) {
      const context=product(),movie=context.getMovie(id),body=el('togetherPopupBody');
      if(!body||!movie||context.hidden(movie)||!context.togetherSeen(movie))return;
      if(source?.focus)source.focus({preventScroll:true});
      body.dataset.movieId=id;
      body.dataset.fromDetail=String(!el('detailModal')?.classList.contains('hidden')&&el('detailBody')?.dataset.movieId===id);
      renderTogetherPopup();openModal('togetherModal');
      el('togetherModalClose')?.focus({preventScroll:true});
    }
    function renderPersonalStatusPopup() {
      const body=el('personalStatusBody'),context=product(),movie=context.getMovie(body?.dataset.movieId);
      if(!body||!movie||context.hidden(movie)||!context.personalStatusHtml(movie)){closeModal('personalStatusModal');return;}
      body.innerHTML=context.personalStatusHtml(movie);context.bind(body);
    }
    function openPersonalStatus(id,source) {
      const context=product(),movie=context.getMovie(id),body=el('personalStatusBody');
      if(!body||!movie||context.hidden(movie))return;
      if(source?.focus)source.focus({preventScroll:true});
      body.dataset.movieId=id;renderPersonalStatusPopup();openModal('personalStatusModal');
      el('personalStatusClose')?.focus({preventScroll:true});
    }
    function renderOtherJudgment() {
      const body=el('otherJudgmentBody'),context=product(),movie=context.getMovie(body?.dataset.movieId);
      const html=movie&&!context.hidden(movie)?context.otherJudgmentHtml(movie,body.dataset.personKey):'';
      if(!body||!html){closeModal('otherJudgmentModal');return;}
      if(body.innerHTML!==html)body.innerHTML=html;
    }
    function openOtherJudgment(id,key,source) {
      const body=el('otherJudgmentBody'),context=product(),movie=context.getMovie(id);
      if(!body||!movie||context.hidden(movie)||!context.otherJudgmentHtml(movie,key))return;
      if(source?.focus)source.focus({preventScroll:true});
      body.dataset.movieId=id;body.dataset.personKey=key;
      renderOtherJudgment();openModal('otherJudgmentModal');
      el('otherJudgmentClose')?.focus({preventScroll:true});
    }
    function card(id,parent,context) {
      const movie=context.getMovie(id);if(!movie)return;
      const node=createMovieCard(movie,view().getVetoForMovie(id).veto?[id]:[],context);
      parent.appendChild(node);
    }
    function drawMatch(parent) {
      const state=session.getState().match,derived=state.derived,context=product().matchContext(state);
      if(createdTitle){parent.innerHTML=matchNightCreatedHtml({createdTitle});return;}
      if(state.phase==='DISCONNECTED'||state.phase==='UNAVAILABLE'){
        parent.innerHTML=matchUnavailableHtml(state.phase);
        const overlay=el('matchReveal');
        if(overlay&&!overlay.classList.contains('hidden'))revealInterrupted=true;
        overlay?.classList.add('hidden');
        if(state.phase==='UNAVAILABLE')bindMatchProduct(parent,state,context);
        return;
      }
      if(state.phase!=='READY'){
        parent.innerHTML=matchConnectingHtml();
        el('matchReveal')?.classList.add('hidden');
        return;
      }
      const card=derived?.currentCard,pending=derived?.pendingMatch,row=state.authoritative?.session;
      const model={movieId:pending?.matched_movie_id||card?.movie_id,index:row?.deck.indexOf(card?.movie_id)??0,matches:derived?.matches??0};
      parent.innerHTML=!derived?matchConnectingHtml():pending?matchMatchHtml(model,context):derived.view==='DONE'||derived.view==='CLOSED'?matchDoneHtml(model,context):context.matchPresentUsers().length<2||!card?matchLobbyHtml(row,context):matchSwipeHtml(model,context);
      bindMatchProduct(parent,state,context);
      if(card&&el('matchCard')){matchBindSwipe(el('matchCard'),card.movie_id,liked=>{if(context.current()&&session.getState().match.phase==='READY')performMatch('swipe',card,liked);});}
      const key=pending?pending.session_id+':'+pending.matched_movie_id:null;
      if(!key){revealInterrupted=false;el('matchReveal')?.classList.add('hidden');}
      else if(key!==revealedKey){revealedKey=key;revealInterrupted=false;const overlay=el('matchReveal');overlay.innerHTML=matchRevealHtml(model,context);bindMatchProduct(overlay,state,context);overlay.classList.remove('hidden');hapticFeedback('match');playSound('match');fireConfetti();}
      else if(revealInterrupted){revealInterrupted=false;const overlay=el('matchReveal');overlay.innerHTML=matchRevealHtml(model,context);bindMatchProduct(overlay,state,context);overlay.classList.remove('hidden');}
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
        else{matchOperation=result;feedbackSerial++;stopFeedbackTimer();feedbackKind='error';feedback='Serata salvata. Chiusura Match da verificare.';notice();}
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
        else if(code.startsWith('reconcileMatch('))handler=()=>performMatch('reconcile');
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
      if(destination==='match'&&typeof matchDragging!=='undefined'&&matchDragging){
        if(session.getState().match.phase==='READY'){matchPendingRender=true;return;}
        matchDragging=false;matchPendingRender=false;
      }
      if (value.kind === 'AVAILABLE' && typeof finishInitialLoading === 'function') finishInitialLoading();
      grid.innerHTML = '';
      // Reuse the existing app chrome; there is no second navigation in the grid.
      if (value.kind === 'AVAILABLE') {
        syncLayout(value);
        if(!el('detailModal')?.classList.contains('hidden')){
          const context=product(),movie=context.getMovie(el('detailBody').dataset.movieId);
          if(!movie||context.hidden(movie))closeModal('detailModal');else renderMovieDetail(movie,context);
        }
        if(!el('togetherModal')?.classList.contains('hidden'))renderTogetherPopup();
        if(!el('personalStatusModal')?.classList.contains('hidden'))renderPersonalStatusPopup();
        if(!el('otherJudgmentModal')?.classList.contains('hidden'))renderOtherJudgment();
      }
      const status=el('targetFeedback');status?.querySelectorAll('button').forEach(node=>node.remove());notice();
      if (value.kind !== 'AVAILABLE') { if(feedbackKind==='success')clearFeedback();for(const id of ['metadataRefreshModal','personalStatusModal','otherJudgmentModal','togetherModal','detailModal','statsModal','sagaModal','reviewModal','scheduleModal','addModal','pickerModal','importModal'])if(!el(id)?.classList.contains('hidden'))closeModal(id); text('targetFeedbackMessage',state.phase === 'BLOCKED' ? 'Servizio momentaneamente non disponibile.' : 'Caricamento…'); button('Riprova',()=>state.phase==='BLOCKED'?session.retryStartup():session.requestRefresh(),status);status.hidden=false;return; }
      if(value.freshness.source==='CACHE') {text('targetFeedbackMessage','Dati salvati: attendi la verifica online.');text('syncNotice','Stai vedendo i dati salvati. Attendi la verifica online per modificare.');show('syncNotice',true);}
      if (operation?.retryHandle) { const handle=operation.retryHandle; button('Riprova la stessa operazione',()=>perform('retry',handle),status);status.hidden=false; }

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
      if (destination==='recommendations') {renderRecommendations(value);return;}
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
      else if (destination === 'wheel') {
        const vetoInfo=el('vetoInfo');if(vetoInfo){vetoInfo.textContent='';vetoInfo.hidden=true;}
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
      if (!rows.length) {
        if(personalDestination()){
          const own=value.context.caller.personId===value.context.observedPerson.personId,seen=destination==='personalSeen';
          const empty=root.createElement('section');empty.className='personal-cinema-empty col-span-full';
          empty.innerHTML='<i class="fa-solid '+(seen?'fa-film':'fa-bookmark')+'" aria-hidden="true"></i><h3>'+escape(query?'Nessun film trovato':own?(seen?'I tuoi titoli di coda iniziano qui':'Il prossimo film ti aspetta'):'Questa raccolta aspetta il primo film')+'</h3><p>'+escape(query?'Prova un altro titolo o regista.':own?(seen?'Conserva qui i film che hai già visto personalmente.':'Salva qui i film che vuoi vedere o rivedere.'): 'Stai consultando '+value.context.observedPerson.label+'. Puoi aggiungere un film alle tue raccolte.')+'</p>';
          container.appendChild(empty);
        }else container.insertAdjacentHTML('beforeend','<p>Nessun film in questa vista.</p>');
      }
      if(model&&destination!=='recommendations'&&typeof renderResultsPager==='function')renderResultsPager(model);
      if(destination==='wheel')show('librarySection',false);
      notice();

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
      return contents.filter(c=>((!query||[c.title,c.director,...(c.genres||[])].join(' ').toLocaleLowerCase('it').includes(query.toLocaleLowerCase('it')))&&(!genre||c.genres?.includes(genre))&&(!platform||c.platform===platform)&&(!proposer||(c.added_by_person_id?context.getIdentity(c.added_by_person_id).label:null)===proposer)&&(personalDestination()||(availability==='cinema'?c.cinema_watchlist:!c.cinema_watchlist))&&(!duration||(parseDurationMinutes(c.duration)!==null&&parseDurationMinutes(c.duration)<=Number(duration)))))
        .slice().sort((a,b)=>{const x=metric(a),y=metric(b);if(x==null||y==null)return x==null?(y==null?0:1):-1;return sign*(typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),'it'))||a.movie_id.localeCompare(b.movie_id);});
    }
    return Object.freeze({ render, navigate, modalChanged, refreshRecommendations, showMoreRecommendations, getDestination:()=>destination, changePage(delta){page=Math.max(0,page+delta);render();}, perform, performMatch, waitFor, saveContent, bulk,
      setFilters(input) { query = input.query ?? query; genre = input.genre ?? genre; duration = input.duration ?? duration; sort = input.sort ?? sort; page = 0; render(); },
      detail:openDetail, together:openTogether, edit,
      presentation:product,
      refreshCalendar(){renderCalendar(product());}, refreshMemories(){renderStats(product());},
      publication(state) { if(generation!==null&&generation!==state.generation)this.dispose();generation=state.generation; if (['AUTH_INVALIDATING','STOPPED','DISPOSED'].includes(state.phase)) { el('movieGrid').innerHTML = ''; this.dispose(); return; } if (state.view !== shared) { shared = state.view; if(state.view.kind==='AVAILABLE'&&!el('reviewModal')?.classList.contains('hidden'))ProductEditors.refresh(product()); if(operation?.closeTicket)finishScheduledMatch(); render(); } else if (state.match !== match && destination === 'match') render(); match = state.match; },
      dispose() { uiEpoch++;if(feedbackTimer)clearTimeout(feedbackTimer);feedbackTimer=null;if(!el('confirmModal')?.classList.contains('hidden'))cancelConfirmModal();if(matchExit)clearTimeout(matchExit);matchExit=null;createdTitle=null;closingMatchTicket=null; for(const id of ['metadataRefreshModal','personalStatusModal','otherJudgmentModal','togetherModal','detailModal','statsModal','sagaModal','reviewModal','scheduleModal','addModal','pickerModal','importModal'])if(!el(id)?.classList.contains('hidden'))closeModal(id); for(const id of ['nextMovieBox','recommendationResults'])if(el(id))el(id).innerHTML='';for(const [node,properties]of bindings)for(const [key,handler]of properties)node[key]=handler;bindings.clear();el('tabAll')?.classList.remove('!hidden');const all=el('libraryViewSelect')?.querySelector?.('option[value="all"]');if(all){all.hidden=false;all.disabled=false;}show('targetPersonalCollections',false); el('matchReveal')?.classList.add('hidden'); for(const id of ['sceltaCta','dashboardSidebar','recommendationSection','segControl','libraryTools','historySwitch','listFiltersBlock','syncNotice']) el(id)?.classList.remove('!hidden'); generation = null; query = ''; genre=''; duration=''; sort='added'; sortDir='desc'; platform=''; proposer=''; availability='streaming'; page = 0; destination = 'home'; revealedKey = null; operation = null; matchOperation = null; recommendation = null; shared = null; match = null; }
    });
  }
  let instance = null;
  const current = () => instance || (instance = createShell({ session: ProductionSession }));
  return Object.freeze({ createShell, modalChanged:(id,phase)=>instance?.modalChanged(id,phase), render: () => current().render(), getDestination:()=>current().getDestination(), refreshRecommendations:()=>current().refreshRecommendations(), showMoreRecommendations:()=>current().showMoreRecommendations(), changePage:delta=>current().changePage(delta), publication: state => current().publication(state), saveContent: (...args) => current().saveContent(...args), bulk: (...args) => current().bulk(...args), setFilters: input => current().setFilters(input), navigate: (destination,source) => current().navigate(destination,source), detail: (id,source,nightId,openNights) => current().detail(id,source,nightId,openNights), together: (id,source) => current().together(id,source), edit: (...args) => current().edit(...args), presentation:()=>current().presentation(), refreshCalendar:()=>current().refreshCalendar(), refreshMemories:()=>current().refreshMemories(), perform: (...args) => current().perform(...args), performMatch: (...args) => current().performMatch(...args), dispose() { instance?.dispose(); instance = null; } });
})();
