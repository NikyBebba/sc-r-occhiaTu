'use strict';
// Semantic TARGET renderer. No legacy rows, store arrays or legacy selectors.
const TargetShell = (() => {
  function createShell({ session, root = document, lookup = fetchMovieDetails, detailsById = fetchTmdbDetailsById }) {
    let destination = 'home', query = '', genre = '', duration = '', sort = 'title', page = 0, detailId = null, feedback = '', operation = null, matchOperation = null, revealedKey = null, saga = null, recommendation = [], winner = null, editor = null;
    let shared = null, match = null, generation = null;
    const el = id => root.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
    const view = () => session.getState().view;
    const button = (label, handler, parent) => { const b = root.createElement('button'); b.className = 'px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm m-1'; b.textContent = label; const token = session.capture(); b.onclick = () => { if (session.current(token)) return handler(); }; parent.appendChild(b); return b; };
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
    async function finishCreation(details, token) {
      const result=await saveContent(details);if(!session.current(token))return;
      if(result.movieId){detailId=result.movieId;editor=null;render();}
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
    function navigate(next) { const previous = destination; destination = next; page = 0; detailId = null; editor = null; if (next === 'match') session.match(session.capture(), 'enter'); else if (previous === 'match') session.match(session.capture(), 'leave'); render(); }
    function field(form, name, label, type = 'text', value = '') {
      const wrap = root.createElement('label'); wrap.className = 'block text-sm my-3'; wrap.textContent = label;
      const input = root.createElement(type === 'textarea' ? 'textarea' : 'input'); if (type !== 'textarea') input.type = type;
      input.name = name; input.value = value ?? ''; input.className = 'block w-full bg-slate-800 rounded-lg p-2'; wrap.appendChild(input); form.appendChild(wrap); return input;
    }
    function edit(action, id, initial = {}) { editor = { action, id, initial, token: session.capture() }; render(); }
    function drawEditor(parent) {
      const draft = editor;
      if(draft.action==='chooseContent'){for(const candidate of draft.candidates)button('Aggiungi '+candidate.title,async()=>{const details=await detailsById(candidate.id);if(session.current(draft.token))if(draft.updateId)await perform('updateMetadata',draft.updateId,metadata(details));else await finishCreation(details,draft.token);},parent);return;}
      const form = root.createElement('form'); form.className = 'glass-panel p-4 rounded-xl';
      const values = {}, checks = {};
      if (['scheduleNight','quickNight','editNight','completeNow','completeScheduled','scheduleMatch'].includes(draft.action)) {
        if (['scheduleNight','editNight','scheduleMatch'].includes(draft.action) && draft.initial.status !== 'completed') { values.date = field(form,'date','Data','date',draft.initial.date); values.time = field(form,'time','Ora','time',draft.initial.time); }
        values.snack = field(form,'snack','Snack','text',draft.initial.snack); values.location = field(form,'location','Luogo','text',draft.initial.location);
        if (['completeNow','completeScheduled'].includes(draft.action)) for (const person of members()) checks[person.personId] = field(form,person.personId,person.label || 'Partecipante','checkbox');
      } else if (['setMyEvaluation','setGroupEvaluation'].includes(draft.action)) {
        for (const name of ['rating','review',...(draft.action === 'setMyEvaluation' ? ['preference'] : [])]) {
          checks[name] = field(form,'change_'+name,'Modifica '+({rating:'voto',review:'recensione',preference:'preferenza'})[name],'checkbox');
          values[name] = field(form,name,({rating:'Voto (vuoto per rimuovere)',review:'Recensione',preference:'Preferenza: sì / no / vuoto'})[name],name === 'review' ? 'textarea' : 'text',draft.initial[name]);
        }
      } else values.title = field(form,'title','Titolo','text',draft.initial.title);
      form.onsubmit = async event => {
        event.preventDefault(); if (!session.current(draft.token) || draft.saving) return;
        draft.saving = true; submit.disabled = true;
        try {
        const params = {};
        for (const [key,input] of Object.entries(values)) if (!checks[key] || checks[key].checked) {
          if (key === 'rating') { const text = input.value.trim().replace(',','.'); params.rating = text === '' ? null : Number(text); }
          else if (key === 'preference') { const text = input.value.trim().toLowerCase(); if (!['','sì','si','no'].includes(text)) return; params.preference = text === '' ? null : text !== 'no'; }
          else params[key] = input.value || (key === 'review' ? '' : null);
        }
        if (['completeNow','completeScheduled'].includes(draft.action)) params.participants = Object.entries(checks).filter(([,input]) => input.checked).map(([id]) => id);
        if (draft.action === 'scheduleMatch') { const result = await session.scheduleMatchedMovie(draft.id,params); if (session.current(draft.token)) { operation = result; editor = null; feedback = success(result.actionResult) ? 'Serata salvata. Attendi la conferma nella vista, poi chiudi Match.' : 'Programmazione non completata.'; render(); } }
        else if (draft.action === 'createContent' || draft.action === 'updateMetadata') { const candidates = await searchTmdbCandidates(params.title); if (!session.current(draft.token)) return; if(candidates.length){editor={action:'chooseContent',token:draft.token,candidates,updateId:draft.action==='updateMetadata'?draft.id:null};render();}else{const details=await lookup(params.title);if(session.current(draft.token)){if(draft.action==='updateMetadata')await perform('updateMetadata',draft.id,metadata(details));else await finishCreation(details,draft.token);}} }
        else await perform(draft.action,draft.id,params);
        } finally { draft.saving = false; submit.disabled = false; }
      };
      const submit = root.createElement('button'); submit.type = 'submit'; submit.disabled = !!draft.saving; submit.textContent = 'Salva'; submit.className = 'px-4 py-2 bg-indigo-600 rounded-lg'; form.appendChild(submit);
      button('Annulla', () => { editor = null; render(); },form); parent.appendChild(form);
    }
    function card(id, parent) {
      const item = view().getCard(id); if (item.kind !== 'AVAILABLE') return;
      const panel = root.createElement('article'); panel.className = 'glass-card rounded-xl p-4'; panel.dataset.movieId = id;
      const content = item.content;
      if (content.surprise_by_person_id && content.surprise_by_person_id !== view().context.caller.personId) { panel.innerHTML='<h3>Film a sorpresa</h3>'; button('Rivela',()=>perform('setSurprise',id,false),panel); parent.appendChild(panel); return; }
      panel.innerHTML = `<h3 class="font-bold">${escape(content.title)}</h3><p class="text-xs text-slate-400">${escape(content.release_year)} · ${escape(content.duration)}</p><p class="text-sm">${escape(content.overview)}</p>`;
      if (content.collection_id) button('Continua la saga',()=>openSaga(id),panel);
      button('Ticket',()=>downloadTargetTicket(id,'manual',session),panel);
      const judgment = (entry, nullLabel = 'non disponibile') => entry == null ? nullLabel : ['rating','preference','review'].filter(k=>Object.hasOwn(entry,k)&&entry[k]!==null).map(k=>String(entry[k])).join(' · ') || 'Nessun giudizio';
      panel.insertAdjacentHTML('beforeend','<p>Il mio giudizio: '+escape(judgment(item.personal.caller.judgment))+'</p><p>Giudizio condiviso: '+escape(judgment(item.group.judgment.judgment,'Nessun giudizio'))+'</p>');
      if(content.poster){const poster=root.createElement('img');try{const url=new URL(content.poster);if(['https:','http:'].includes(url.protocol)){poster.src=url.href;poster.alt=content.title;poster.loading='lazy';poster.decoding='async';poster.className='rounded-lg w-full';panel.appendChild(poster);}}catch(_){}}
      panel.insertAdjacentHTML('beforeend','<p>'+escape(item.group.candidacy.kind==='AVAILABLE'?(item.group.candidacy.effectiveCandidacy?'Candidato al gruppo':'Nessuna candidatura'):'Candidatura non disponibile')+' · '+escape(item.group.candidacy.kind==='AVAILABLE'?(item.group.candidacy.listVisible?'Nella Lista del gruppo':'Fuori dalla Lista visibile'):'Lista non disponibile')+'</p>');
      button('Dettagli', () => { detailId = id; render(); },panel);
      button('Nella mia Lista', () => perform('addToMyList',id),panel);
      button('L’ho visto anch’io', () => perform('recordSeen',id),panel);
      button('Proponi al gruppo', () => perform('proposeToGroup',id),panel);
      if (item.group.candidacy.effectiveCandidacy) button('Ritira candidatura', () => perform('withdrawGroupCandidacy',id),panel);
      const veto=view().getVetoForMovie(id).veto;
      if(veto?.person_id===view().context.caller.personId)button('Ritira veto',()=>perform('removeVeto',id,veto.veto_id),panel);else if(!veto)button('Veto',()=>perform('addVeto',id),panel);
      button('Sorpresa',()=>perform('setSurprise',id,true),panel);
      button('Programma', () => edit('scheduleNight',id),panel);
      button('Oggi', () => edit('quickNight',id),panel);
      if (detailId === id) {
        panel.insertAdjacentHTML('beforeend', `<p>Visto personalmente: ${item.personal.caller.seen === true ? 'sì' : item.personal.caller.seen === false ? 'no' : 'non disponibile'} · Visioni condivise: ${item.group.events.filter(e => e.event.status === 'completed').length}</p><p>La persona osservata: ${escape(view().context.observedPerson.label || 'non disponibile')}</p>`);
        panel.insertAdjacentHTML('beforeend','<p>'+escape((content.genres||[]).join(', '))+' · '+escape(content.director)+' · IMDb '+escape(content.imdb_rating)+'</p>');
        if(content.trailer_url){try{const url=new URL(content.trailer_url);if(['https:','http:'].includes(url.protocol)){const link=root.createElement('a');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Trailer';panel.appendChild(link);}}catch(_){}}
        panel.insertAdjacentHTML('beforeend','<p>Giudizio della persona osservata: '+escape(item.personal.observed.kind==='AVAILABLE'?judgment(item.personal.observed.judgment):'non disponibile')+'</p>');
        button('Il mio giudizio', () => edit('setMyEvaluation',id,item.personal.caller.judgment ?? {}),panel);
        button('Giudizio N+V', () => edit('setGroupEvaluation',id,item.group.judgment.judgment ?? {}),panel);
        button('Rimuovi dai miei Visti', () => perform('removeSeen',id),panel);
        button('Rimuovi dalla mia Lista', () => perform('removeFromMyList',id),panel);
        button('Visione personale', () => perform('recordPersonalViewing',id),panel);
        button('Visto insieme ora', () => edit('completeNow',id),panel);
        button('Correggi metadati',()=>edit('updateMetadata',id,{title:content.title}),panel);
        button('Cinema / streaming', () => perform('setCinema',id,!content.cinema_watchlist),panel);
        button('Elimina', () => perform('deleteContent',id),panel);
        for (const event of item.group.events) drawEvent(event,panel);
      }
      parent.appendChild(panel);
    }
    function drawEvent(item,parent) {
      const event = item.event, row = root.createElement('section'); row.className = 'my-3 p-3 border border-slate-700 rounded-lg'; row.dataset.nightId = event.night_id;
      const found = view().catalog.getContent(event.movie_id);
      row.innerHTML = `<h3>${escape(found.kind === 'AVAILABLE' ? found.content.title : 'Film non disponibile')}</h3><p>${escape(event.status)} · ${escape(event.date)} ${escape(event.time)} · ${escape(event.snack)} · ${escape(event.location)}</p><p>${item.participants.map(p => escape(view().getIdentity(p.person_id).label || 'Partecipante')).join(', ')}</p>`;
      button('Dettagli film',()=>{detailId=event.movie_id;destination='groupList';render();},row);
      button('Modifica evento',()=>edit('editNight',event.night_id,event),row);
      if (['proposed','confirmed'].includes(event.status)) { button('Conferma',()=>perform('confirmNight',event.night_id),row); button('Annulla',()=>perform('cancelNight',event.night_id),row); button('Concludi',()=>edit('completeScheduled',event.night_id),row); }
      parent.appendChild(row);
    }
    function drawMatch(parent) {
      const state = session.getState().match;
      const pendingKey=state.derived?.pendingMatch?state.derived.pendingMatch.session_id+':'+state.derived.pendingMatch.matched_movie_id:null;
      if(revealedKey&&pendingKey!==revealedKey)el('matchReveal')?.classList.add('hidden');
      parent.insertAdjacentHTML('beforeend', `<p>Match</p><p>${(state.presence||[]).map(id=>escape(view().getIdentity(id).label||'Persona')).join(' · ')||'Nessuno online'}</p><p>${state.derived?.agreement.pct==null?'':state.derived.agreement.pct+'% d’accordo'}</p>`);
      button('Avvia / riprendi',()=>performMatch('start'),parent);
      if (state.derived?.currentCard) { const observed = state.derived.currentCard; const content = view().catalog.getContent(observed.movie_id); const swipeCard = root.createElement('article'); swipeCard.className='match-panel glass-card rounded-xl p-4 max-w-sm mx-auto'; swipeCard.innerHTML='<h3>'+escape(content.content?.title)+'</h3>'; parent.appendChild(swipeCard); const token = session.capture(); matchBindSwipe(swipeCard,observed.movie_id,liked=>{if(session.current(token))performMatch('swipe',observed,liked);}); button('Mi piace',()=>performMatch('swipe',observed,true),parent); button('Passo',()=>performMatch('swipe',observed,false),parent); }
      if (state.derived?.pendingMatch) { const key=state.derived.pendingMatch.session_id+':'+state.derived.pendingMatch.matched_movie_id; if(key!==revealedKey){revealedKey=key;hapticFeedback('match');playSound('match');fireConfetti(); const overlay=el('matchReveal');if(overlay){overlay.innerHTML='<div class="match-panel glass-card rounded-xl p-6 text-center"><h2>Match!</h2></div>';overlay.classList.remove('hidden');const observed=state.derived.pendingMatch;button('Continua a swipare',()=>performMatch('acknowledge',observed),overlay);button('Chiudi',()=>overlay.classList.add('hidden'),overlay);}} const observed = state.derived.pendingMatch; parent.insertAdjacentHTML('beforeend',`<h3>Match: ${escape(view().catalog.getContent(observed.matched_movie_id).content?.title)}</h3>`); button('Continua',()=>performMatch('acknowledge',observed),parent); button('Ticket',()=>downloadTargetTicket(observed.matched_movie_id,'match',session),parent); button('Programma il Match',()=>edit('scheduleMatch',observed),parent); }
      if(matchOperation?.retryHandle){const handle=matchOperation.retryHandle;button('Riprova la stessa operazione Match',()=>performMatch('retry',handle),parent);}
      button('Riallinea',()=>performMatch('reconcile'),parent);
      if (state.observedSession) button('Chiudi sessione',()=>performMatch('close',state.observedSession),parent);
      if (operation?.closeTicket) { const ticket=operation.closeTicket, token=session.capture(); button('Chiudi Match dopo la programmazione',async()=>{ const result = await session.closeScheduledMatch(ticket); if(!session.current(token))return; matchOperation=result; feedback = result.code === 'SCHEDULE_SNAPSHOT_REQUIRED' ? 'Attendi la conferma della serata.' : success(result) ? 'Match chiuso.' : 'Serata salvata; chiusura Match non completata.'; notice(); },parent); }
    }
    function render() {
      const state = session.getState(), value = state.view;
      const grid = el('movieGrid'); if (!grid) return;
      if(destination==='match'&&typeof matchDragging!=='undefined'&&matchDragging){matchPendingRender=true;return;}
      for (const id of ['librarySection','appRoot']) el(id)?.classList.remove('hidden','!hidden');
      for (const id of ['sceltaCta','dashboardSidebar','recommendationSection','segControl','libraryTools','historySwitch','listFiltersBlock']) el(id)?.classList.add('!hidden');
      grid.innerHTML = '';
      const nav = root.createElement('nav'); nav.className = 'col-span-full';
      const destinations = { home:'Home', personalList:'Lista personale', personalSeen:'Visti personali', groupList:'Lista', rewatch:'Rewatch', scheduled:'In programma', together:'Visti e recensioni', memories:'Ricordi', calendar:'Calendario', match:'Match', wheel:'Ruota', recommendations:'Cosa Guardiamo?', search:'Cerca nel catalogo' };
      for (const [key,label] of Object.entries(destinations)) button(label,()=>navigate(key),nav);
      grid.appendChild(nav);
      if (value.kind==='AVAILABLE') nav.setAttribute('aria-label','Persona e gruppo');
      const status = root.createElement('p'); status.id = 'targetFeedback'; status.className = 'col-span-full text-sm'; status.setAttribute('role','status'); grid.appendChild(status); notice();
      if (value.kind !== 'AVAILABLE') { status.textContent = state.phase === 'BLOCKED' ? state.reason?.code==='PROTOCOL_UNSUPPORTED'?'Aggiorna l’app per continuare.':'Servizio momentaneamente non disponibile.' : state.phase === 'AUTH_INVALIDATING' ? 'Accedi di nuovo.' : state.runtime?.controllerStatus==='UNINITIALIZED'&&state.runtime?.phase==='STARTING'?'Dati non disponibili. Riprova la connessione.':'Caricamento…'; button('Riprova',()=>state.phase==='BLOCKED'?session.retryStartup():session.requestRefresh(),nav);return; }
      const freshness=root.createElement('p');freshness.className='col-span-full text-xs text-slate-400';freshness.textContent=value.freshness.source==='CACHE'?'Dati salvati: attendi la verifica online.':state.runtime?.pending.thresholds!==null?'Aggiornamento in corso…':value.freshness.freshness.temporalCurrent?'Verificato online':'Dati da verificare';grid.appendChild(freshness);
      el('syncNotice')?.classList.add('!hidden');
      for (const person of members()) button('Osserva '+(person.label || 'persona'),()=>{ session.setObservedPerson(person.personId); },nav);
      button('Aggiungi',()=>edit('createContent',null),nav);
      if (operation?.retryHandle) { const handle=operation.retryHandle; button('Riprova la stessa operazione',()=>perform('retry',handle),nav); }
      if (editor) { drawEditor(grid); return; }
      if (destination === 'match') { drawMatch(grid); return; }
      if (destination === 'bulk') { const form=root.createElement('form'); const input=field(form,'titles','Un titolo per riga','textarea'); const submit=root.createElement('button');submit.textContent='Aggiungi al catalogo';form.appendChild(submit);const token=session.capture();form.onsubmit=async e=>{e.preventDefault();if(!session.current(token))return;const results=await bulk(input.value.split('\n').map(x=>x.trim()).filter(Boolean));if(session.current(token)){feedback=results.length+' risultati indipendenti';notice();}};grid.appendChild(form);return; }
      if (saga) { drawSaga(grid); return; }
      let contents;
      if (destination === 'personalList' || destination === 'personalSeen') {
        const personal = value.personal.observed;
        if (personal.kind !== 'AVAILABLE') { status.textContent = 'Dati personali non disponibili.'; return; }
        contents = destination === 'personalList' ? personal.list : personal.seen;
      } else if (destination === 'groupList' || destination === 'home') contents = value.group.visibleList;
      else if (destination === 'rewatch') contents = value.group.rewatch;
      else if (destination === 'together') contents = value.group.togetherFilms;
      else if (['scheduled','calendar','memories'].includes(destination)) {
        const events = destination === 'memories' ? value.events.completed : value.events.scheduled;
        status.textContent = `${events.length} eventi · ${value.counts.togetherFilms} film condivisi`;
        if(destination==='memories'){const ratings=value.statistics.groupJudgments.map(j=>j.rating).filter(x=>x!==null);const average=ratings.length?ratings.reduce((sum,x)=>sum+x,0)/ratings.length:null;grid.insertAdjacentHTML('beforeend','<section>Voto medio '+escape(average===null?'—':average.toFixed(1))+' · Film '+value.counts.togetherFilms+' · Eventi '+value.counts.completedEvents+'</section>');}
        for (const item of events) drawEvent(item,grid); return;
      } else if (destination === 'search') contents=query?value.search.contents:[];
      else if (destination === 'recommendations') {
        button('Trova proposte',()=>{ const input = value.getRecommendationInput(); recommendation = input.kind === 'AVAILABLE' ? RecommendationEngine.rerank(RecommendationEngine.recommend(input.input),6) : []; render(); },nav);
        contents = recommendation.map(r=>value.catalog.getContent(r.movieId)).filter(x=>x.kind === 'AVAILABLE').map(x=>x.content);
      } else if (destination === 'wheel') {
        el('dashboardSidebar')?.classList.remove('hidden','!hidden'); syncGenreFilterOptions(); drawWheel();
        contents = value.ruota.eligibleContents;
        button('Gira',()=>{ const pool = filtered(value.ruota.eligibleContents); winner = pool.length ? pool[Math.floor(Math.random()*pool.length)].movie_id : null; render(); },nav);
        if (winner) contents = contents.filter(c=>c.movie_id === winner);
      } else contents = [];
      if (destination === 'home') status.textContent = `Mia Lista ${value.home.personal.caller.kind==='AVAILABLE'?value.home.personal.caller.counts.listFilms:'non disponibile'} · Visti personali ${value.home.personal.caller.kind==='AVAILABLE'?value.home.personal.caller.counts.seenFilms:'non disponibili'} · Lista ${value.counts.groupListFilms} · Rewatch ${value.counts.rewatchFilms} · Serate ${value.counts.scheduledEvents} · Ricordi ${value.counts.completedEvents}`;
      const search = root.createElement('input'); search.id = 'targetCatalogSearch'; search.placeholder = 'Cerca titolo, genere o regista'; search.value = query; search.className = 'col-span-full bg-slate-800 p-3 rounded-lg'; search.oninput = () => { query = search.value; const caret = search.selectionStart; page = 0; render(); const replacement = el('targetCatalogSearch'); replacement?.focus(); if (caret !== null) replacement?.setSelectionRange?.(caret,caret); }; grid.appendChild(search);
      const sortControl=root.createElement('select');sortControl.setAttribute('aria-label','Ordina');sortControl.innerHTML='<option value="title">Titolo</option><option value="release_year">Anno</option><option value="duration">Durata</option>';sortControl.value=sort;sortControl.onchange=()=>{sort=sortControl.value;page=0;render();};nav.appendChild(sortControl);
      const genreControl=root.createElement('select');genreControl.setAttribute('aria-label','Genere');genreControl.innerHTML='<option value="">Tutti i generi</option>'+[...new Set(contents.flatMap(c=>c.genres||[]))].filter(Boolean).sort().map(g=>'<option>'+escape(g)+'</option>').join('');genreControl.value=genre;genreControl.onchange=()=>{genre=genreControl.value;page=0;render();};nav.appendChild(genreControl);
      const rows = detailId ? [value.catalog.getContent(detailId)].filter(x=>x.kind==='AVAILABLE').map(x=>x.content) : filtered(contents);
      for (const c of rows.slice(page*24,(page+1)*24)) card(c.movie_id,grid);
      if (!rows.length) grid.insertAdjacentHTML('beforeend','<p>Nessun film in questa vista.</p>');
      if (page) button('Precedenti',()=>{ page--;render(); },nav);
      if ((page+1)*24<rows.length) button('Altri film',()=>{ page++;render(); },nav);
    }
    async function openSaga(movieId) {
      const token=session.capture(), found=view().catalog.getContent(movieId); if(found.kind!=='AVAILABLE')return;
      const id=found.content.collection_id;if(!Number.isSafeInteger(Number(id)))return;
      const collection=await fetchTmdbCollection(id);if(!session.current(token))return;
      saga={collection,selected:new Set(),token};render();
    }
    function drawSaga(parent) {
      const panel=saga;if(!panel.collection){parent.insertAdjacentHTML('beforeend','<p>Saga non disponibile.</p>');return;}
      for(const part of panel.collection.parts){const input=field(parent,String(part.id),part.title,'checkbox');input.checked=panel.selected.has(part.id);input.onchange=()=>{if(input.checked)panel.selected.add(part.id);else panel.selected.delete(part.id);};}
      button('Aggiungi i selezionati alla Lista del gruppo',async()=>{
        const results=[];for(const id of [...panel.selected]){if(!session.current(panel.token))break;try{const details=await detailsById(id);if(!session.current(panel.token))break;const part=panel.collection.parts.find(p=>p.id===id);const future=typeof part?.release_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(part.release_date)&&part.release_date>view().context.temporal.local_date;results.push(await saveContent(future?{...details,cinema_watchlist:true}:details,'proposeToGroup'));}catch(_){results.push({outcome:'ERROR'});}}
        if(session.current(panel.token)){feedback=results.length+' risultati indipendenti';notice();}
      },parent);button('Indietro',()=>{saga=null;render();},parent);
    }
    function filtered(contents) {
      const metric=c=>sort==='duration'?parseDurationMinutes(c.duration):sort==='release_year'?c.release_year:c.title;
      return contents.filter(c=>(!query||[c.title,c.director,...(c.genres||[])].join(' ').toLocaleLowerCase('it').includes(query.toLocaleLowerCase('it')))&&(!genre||c.genres?.includes(genre))&&(!duration||(parseDurationMinutes(c.duration)!==null&&parseDurationMinutes(c.duration)<=Number(duration))))
        .slice().sort((a,b)=>{const x=metric(a),y=metric(b);return typeof x==='number'&&typeof y==='number'?x-y||a.movie_id.localeCompare(b.movie_id):String(x??'').localeCompare(String(y??''),'it')||a.movie_id.localeCompare(b.movie_id);});
    }

    return Object.freeze({ render, navigate, perform, performMatch, waitFor, saveContent, bulk,
      setFilters(input) { query = input.query ?? query; genre = input.genre ?? genre; duration = input.duration ?? duration; sort = input.sort ?? sort; page = 0; render(); },
      detail(id) { detailId = id; render(); }, edit,
      publication(state) { if(generation!==null&&generation!==state.generation)this.dispose();generation=state.generation; if (['AUTH_INVALIDATING','STOPPED','DISPOSED'].includes(state.phase)) { el('movieGrid').innerHTML = ''; this.dispose(); return; } if (state.view !== shared) { shared = state.view; if(state.runtime?.pending.thresholds===null&&operation?.outcome==='SUCCESS')feedback='Salvato.'; render(); } else if (state.match !== match && destination === 'match') render(); match = state.match; },
      dispose() { el('matchReveal')?.classList.add('hidden'); for (const id of ['sceltaCta','dashboardSidebar','recommendationSection','segControl','libraryTools','historySwitch','listFiltersBlock','syncNotice']) el(id)?.classList.remove('!hidden'); generation = null; detailId = null; query = ''; page = 0; destination = 'home'; editor = null; saga = null; revealedKey = null; operation = null; matchOperation = null; winner = null; recommendation = []; shared = null; match = null; }
    });
  }
  let instance = null;
  const current = () => instance || (instance = createShell({ session: ProductionSession }));
  return Object.freeze({ createShell, render: () => current().render(), publication: state => current().publication(state), saveContent: (...args) => current().saveContent(...args), bulk: (...args) => current().bulk(...args), setFilters: input => current().setFilters(input), navigate: destination => current().navigate(destination), detail: id => current().detail(id), edit: (...args) => current().edit(...args), perform: (...args) => current().perform(...args), performMatch: (...args) => current().performMatch(...args), dispose() { instance?.dispose(); instance = null; } });
})();
