'use strict';
// Semantic TARGET renderer. No legacy rows, store arrays or legacy selectors.
const TargetShell = (() => {
  function createShell({ session, root = document, lookup = fetchMovieDetails, detailsById = fetchTmdbDetailsById }) {
    let destination = 'home', query = '', genre = '', duration = '', sort = 'added', sortDir = 'desc', platform = '', proposer = '', availability = 'streaming', page = 0, detailId = null, feedback = '', operation = null, matchOperation = null, revealedKey = null, saga = null, recommendation = [], winner = null, editor = null;
    let shared = null, match = null, generation = null;
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
      const home = destination === 'home' && !editor && !saga, wheel = destination === 'wheel' && !editor, proposals = destination === 'recommendations' && !editor;
      const personal = personalDestination() && !editor && !saga, group = ['groupList','rewatch','scheduled'].includes(destination) && !editor && !saga;
      const titles = {groupList:'Libreria',rewatch:'Rewatch',scheduled:'In programma',personalList:'Lista personale',personalSeen:'Visti personali',together:'Visti e recensioni',memories:'Ricordi',calendar:'Calendario',search:'Cerca nel catalogo',bulk:'Aggiungi film'};
      show('appRoot',true); show('sceltaCta',home); show('dashboardSidebar',wheel); show('recommendationSection',proposals);
      show('librarySection',!home && !wheel && !proposals); show('nextMovieHero',false); show('scheduledPanel',false);
      show('libraryHeader',destination!=='match'); show('matchViewHeader',destination==='match'); show('libraryBack',destination!=='match');
      for (const id of ['segControl','libraryViewSelect']) el(id)?.classList.toggle('!hidden',!group);
      el('tabAll')?.classList.add('!hidden');
      const all = el('libraryViewSelect')?.querySelector?.('option[value="all"]'); if (all) { all.hidden = true; all.disabled = true; }
      show('historySwitch',personal); show('targetPersonalCollections',personal); show('historySearch',personal);
      show('libraryTools',!editor && !saga && (group || ['together','search'].includes(destination)));
      show('listFiltersBlock',!personal); show('syncNotice',false);
      text('libraryPageTitle',editor?'Aggiungi e modifica':titles[destination] || '');
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
    async function finishCreation(details, token) {
      const relation=destination==='personalList'?'addToMyList':destination==='personalSeen'?'recordSeen':destination==='groupList'?'proposeToGroup':null;
      const result=await saveContent(details,relation);if(!session.current(token))return;
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
    function navigate(next) { if (!['home','personalList','personalSeen','groupList','rewatch','scheduled','together','memories','calendar','match','wheel','recommendations','search','bulk'].includes(next)) return; const previous = destination; if(personalDestination()!==['personalList','personalSeen'].includes(next)){query='';genre='';duration='';platform='';proposer='';} destination = next; page = 0; detailId = null; editor = null; saga = null; if (next === 'match') session.match(session.capture(), 'enter'); else if (previous === 'match') session.match(session.capture(), 'leave'); render(); }
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
      const ticket = root.createElement('article'); ticket.className = 'movie-ticket flex flex-col justify-between'; ticket.dataset.movieId = id;
      const cover=root.createElement('div');cover.className='relative h-48 bg-slate-900 overflow-hidden';ticket.appendChild(cover);
      const panel=root.createElement('div');panel.className='p-4 flex-1 flex flex-col space-y-3 ticket-seam';ticket.appendChild(panel);
      const content = item.content;
      if (content.surprise_by_person_id && content.surprise_by_person_id !== view().context.caller.personId) { panel.innerHTML='<h3>Film a sorpresa</h3>'; button('Rivela',()=>perform('setSurprise',id,false),panel); parent.appendChild(ticket); return; }
      panel.innerHTML = `<h3 class="font-bold">${escape(content.title)}</h3><p class="text-xs text-slate-400">${escape([content.cinema_watchlist?'Al cinema / prossimamente':content.platform,content.release_year,content.duration].filter(Boolean).join(' · '))}</p>${detailId===id?'<p class="text-sm">'+escape(content.overview)+'</p>':''}`;
      if (content.collection_id) button('Continua la saga',()=>openSaga(id),panel);
      if(detailId===id)button('Ticket',()=>downloadTargetTicket(id,'manual',session),panel);
      const judgment = (entry, nullLabel = 'non disponibile') => entry == null ? nullLabel : ['rating','preference','review'].filter(k=>Object.hasOwn(entry,k)&&entry[k]!==null).map(k=>String(entry[k])).join(' · ') || 'Nessun giudizio';
      panel.insertAdjacentHTML('beforeend',personalDestination()?'<p class="text-sm">'+escape(judgment(item.personal.observed.kind==='AVAILABLE'?item.personal.observed.judgment:null))+'</p>':'<p class="text-sm">'+escape(judgment(item.group.judgment.judgment,'Nessun giudizio condiviso'))+'</p>');
      if(content.poster){const poster=root.createElement('img');try{const url=new URL(content.poster);if(['https:','http:'].includes(url.protocol)){poster.src=url.href;poster.alt=content.title;poster.loading='lazy';poster.decoding='async';poster.className='w-full h-full object-cover';cover.appendChild(poster);}}catch(_){}}
      button('Dettagli', () => { detailId = id; render(); },panel);
      if(personalDestination()) {
        const own=view().context.observedPerson.personId===view().context.caller.personId;
        if(destination==='personalList'&&!own)button('Anche nella mia Lista',()=>perform('addToMyList',id),panel);
        if(destination==='personalSeen'&&!own)button('L’ho visto anch’io',()=>perform('recordSeen',id),panel);
        if(own&&destination==='personalSeen')button('Il mio giudizio',()=>edit('setMyEvaluation',id,item.personal.caller.judgment??{}),panel);
      } else if(['groupList','rewatch'].includes(destination)) {
        button('Programma',()=>edit('scheduleNight',id),panel);
        button('Oggi',()=>edit('quickNight',id),panel);
      }
      if (detailId === id) {
        button('Nella mia Lista', () => perform('addToMyList',id),panel);
      button('L’ho visto anch’io', () => perform('recordSeen',id),panel);
      button('Proponi al gruppo', () => perform('proposeToGroup',id),panel);
      if (item.group.candidacy.effectiveCandidacy) button('Ritira candidatura', () => perform('withdrawGroupCandidacy',id),panel);
      const veto=view().getVetoForMovie(id).veto;
      if(veto?.person_id===view().context.caller.personId)button('Ritira veto',()=>perform('removeVeto',id,veto.veto_id),panel);else if(!veto)button('Veto',()=>perform('addVeto',id),panel);
      button('Sorpresa',()=>perform('setSurprise',id,true),panel);
      if(!['groupList','rewatch'].includes(destination)){button('Programma', () => edit('scheduleNight',id),panel);button('Oggi', () => edit('quickNight',id),panel);}
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
      parent.appendChild(ticket);
    }
    function drawEvent(item,parent) {
      const event = item.event, row = root.createElement('section'); row.className = 'col-span-full glass-panel my-3 p-4 border border-slate-700 rounded-xl'; row.dataset.nightId = event.night_id;
      const found = view().catalog.getContent(event.movie_id);
      row.innerHTML = `<h3>${escape(found.kind === 'AVAILABLE' ? found.content.title : 'Film non disponibile')}</h3><p>${escape(({completed:'Serata conclusa',cancelled:'Annullata',proposed:'Proposta',confirmed:'Confermata'})[event.status]||'Serata')} · ${escape(formatNightDate(event.date,event.time))} · ${escape(event.snack)} · ${escape(event.location)}</p><p>${item.participants.map(p => escape(view().getIdentity(p.person_id).label || 'Partecipante')).join(', ')}</p>`;
      button('Dettagli film',()=>{detailId=event.movie_id;destination='groupList';render();},row);
      if(event.status!=='cancelled'&&event.status!=='skipped')button('Snack e luogo',()=>edit('editNight',event.night_id,event),row);
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
      if (value.kind === 'AVAILABLE' && typeof finishInitialLoading === 'function') finishInitialLoading();
      grid.innerHTML = '';
      // Reuse the existing app chrome; there is no second navigation in the grid.
      if (value.kind === 'AVAILABLE') syncLayout(value);
      const status = root.createElement('p'); status.id = 'targetFeedback'; status.className = 'col-span-full text-sm'; status.setAttribute('role','status'); grid.appendChild(status); notice();
      if (value.kind !== 'AVAILABLE') { status.textContent = state.phase === 'BLOCKED' ? 'Servizio momentaneamente non disponibile.' : 'Caricamento…'; button('Riprova',()=>state.phase==='BLOCKED'?session.retryStartup():session.requestRefresh(),status);return; }
      if(value.freshness.source==='CACHE') {status.textContent='Dati salvati: attendi la verifica online.';text('syncNotice','Stai vedendo i dati salvati. Attendi la verifica online per modificare.');show('syncNotice',true);}
      if (operation?.retryHandle) { const handle=operation.retryHandle; button('Riprova la stessa operazione',()=>perform('retry',handle),status); }
      if (editor) { show('librarySection',true); drawEditor(grid); return; }
      if (destination === 'match') { const panel=root.createElement('section');panel.className='col-span-full match-panel glass-panel p-4 rounded-xl';grid.appendChild(panel);drawMatch(panel);return; }
      if (destination === 'home') {
        const events=value.events.scheduled;
        if(events.length){show('nextMovieHero',true);const box=el('nextMovieBox');if(box){box.innerHTML='';drawEvent(events[0],box);}}
        return;
      }
      if (destination === 'bulk') { const form=root.createElement('form'); const input=field(form,'titles','Un titolo per riga','textarea'); const submit=root.createElement('button');submit.textContent='Aggiungi al catalogo';form.appendChild(submit);const token=session.capture();form.onsubmit=async e=>{e.preventDefault();if(!session.current(token))return;const results=await bulk(input.value.split('\n').map(x=>x.trim()).filter(Boolean));if(session.current(token)){feedback=results.length+' risultati indipendenti';notice();}};grid.appendChild(form);return; }
      if (saga) { drawSaga(grid); return; }
      let contents;
      if (destination === 'personalList' || destination === 'personalSeen') {
        const personal = value.personal.observed;
        if (personal.kind !== 'AVAILABLE') { status.textContent = 'Dati personali non disponibili.'; return; }
        contents = destination === 'personalList' ? personal.list : personal.seen;
      } else if (destination === 'groupList') contents = value.group.visibleList;
      else if (destination === 'rewatch') contents = value.group.rewatch;
      else if (destination === 'together') contents = value.group.togetherFilms;
      else if (['scheduled','calendar','memories'].includes(destination)) {
        const events = destination === 'memories' ? value.events.completed : value.events.scheduled;
        text('libraryCount',events.length+' eventi');
        if(destination==='memories'){const ratings=value.statistics.groupJudgments.map(j=>j.rating).filter(x=>x!==null);const average=ratings.length?ratings.reduce((sum,x)=>sum+x,0)/ratings.length:null;grid.insertAdjacentHTML('beforeend','<section>Voto medio '+escape(average===null?'—':average.toFixed(1))+' · Film '+value.counts.togetherFilms+' · Eventi '+value.counts.completedEvents+'</section>');}
        for (const item of events) drawEvent(item,grid); return;
      } else if (destination === 'search') contents=query?value.search.contents:[];
      else if (destination === 'recommendations') {
        if(!recommendation.length){const input=value.getRecommendationInput();recommendation=input.kind==='AVAILABLE'?RecommendationEngine.rerank(RecommendationEngine.recommend(input.input),6):[];}
        contents = recommendation.map(r=>value.catalog.getContent(r.movieId)).filter(x=>x.kind === 'AVAILABLE').map(x=>x.content);
      } else if (destination === 'wheel') {
        el('dashboardSidebar')?.classList.remove('hidden','!hidden'); syncGenreFilterOptions(); drawWheel();
        contents = value.ruota.eligibleContents;

        if (winner) contents = contents.filter(c=>c.movie_id === winner);
      } else contents = [];
      const rows = detailId ? [value.catalog.getContent(detailId)].filter(x=>x.kind==='AVAILABLE').map(x=>x.content) : filtered(contents);
      const container = destination==='recommendations'?el('recommendationResults'):grid;
      if(container!==grid)container.innerHTML='';
      text('libraryCount',rows.length+' film');
      const model=typeof paginateResults==='function'?paginateResults(rows,page):null;
      if(model)page=model.pageIndex;
      for (const c of (model?.items || rows.slice(page*24,(page+1)*24))) card(c.movie_id,container);
      if (!rows.length) container.insertAdjacentHTML('beforeend','<p>Nessun film in questa vista.</p>');
      if(model&&destination!=='recommendations'&&typeof renderResultsPager==='function')renderResultsPager(model);
      if(destination==='wheel')show('librarySection',!!editor);

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
      const context=view();
      const sortKey=personalDestination()?'title':sort;
      const metric=c=>sortKey==='duration'?parseDurationMinutes(c.duration):sortKey==='release_year'||sortKey==='year'?c.release_year:sortKey==='added'?c.created_at:sortKey==='imdb'?c.imdb_rating:sortKey==='proposer'?(c.added_by_person_id?context.getIdentity(c.added_by_person_id).label:null):sortKey==='rating'?context.getCard(c.movie_id).personal.caller.judgment?.rating:c.title;
      const sign=personalDestination()?1:sortDir==='desc'?-1:1;
      return contents.filter(c=>(!query||[c.title,c.director,...(c.genres||[])].join(' ').toLocaleLowerCase('it').includes(query.toLocaleLowerCase('it')))&&(!genre||c.genres?.includes(genre))&&(!platform||c.platform===platform)&&(!proposer||(c.added_by_person_id?context.getIdentity(c.added_by_person_id).label:null)===proposer)&&(personalDestination()||(availability==='cinema'?c.cinema_watchlist:!c.cinema_watchlist))&&(!duration||(parseDurationMinutes(c.duration)!==null&&parseDurationMinutes(c.duration)<=Number(duration))))
        .slice().sort((a,b)=>{const x=metric(a),y=metric(b);if(x==null||y==null)return x==null?(y==null?0:1):-1;return sign*(typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),'it'))||a.movie_id.localeCompare(b.movie_id);});
    }
    return Object.freeze({ render, navigate, getDestination:()=>destination, changePage(delta){page=Math.max(0,page+delta);render();}, perform, performMatch, waitFor, saveContent, bulk,
      setFilters(input) { query = input.query ?? query; genre = input.genre ?? genre; duration = input.duration ?? duration; sort = input.sort ?? sort; page = 0; render(); },
      detail(id) { if(['home','wheel','recommendations'].includes(destination))destination='groupList';detailId = id; render(); }, edit,
      publication(state) { if(generation!==null&&generation!==state.generation)this.dispose();generation=state.generation; if (['AUTH_INVALIDATING','STOPPED','DISPOSED'].includes(state.phase)) { el('movieGrid').innerHTML = ''; this.dispose(); return; } if (state.view !== shared) { shared = state.view; if(state.runtime?.pending.thresholds===null&&operation?.outcome==='SUCCESS')feedback='Salvato.'; render(); } else if (state.match !== match && destination === 'match') render(); match = state.match; },
      dispose() { for(const id of ['nextMovieBox','recommendationResults'])if(el(id))el(id).innerHTML='';for(const [node,properties] of bindings)for(const [key,handler] of properties)node[key]=handler;bindings.clear();el('tabAll')?.classList.remove('!hidden');const all=el('libraryViewSelect')?.querySelector?.('option[value="all"]');if(all){all.hidden=false;all.disabled=false;}show('targetPersonalCollections',false); el('matchReveal')?.classList.add('hidden'); for (const id of ['sceltaCta','dashboardSidebar','recommendationSection','segControl','libraryTools','historySwitch','listFiltersBlock','syncNotice']) el(id)?.classList.remove('!hidden'); generation = null; detailId = null; query = ''; genre=''; duration=''; sort='added'; sortDir='desc'; platform=''; proposer=''; availability='streaming'; page = 0; destination = 'home'; editor = null; saga = null; revealedKey = null; operation = null; matchOperation = null; winner = null; recommendation = []; shared = null; match = null; }
    });
  }
  let instance = null;
  const current = () => instance || (instance = createShell({ session: ProductionSession }));
  return Object.freeze({ createShell, render: () => current().render(), getDestination:()=>current().getDestination(), changePage:delta=>current().changePage(delta), publication: state => current().publication(state), saveContent: (...args) => current().saveContent(...args), bulk: (...args) => current().bulk(...args), setFilters: input => current().setFilters(input), navigate: destination => current().navigate(destination), detail: id => current().detail(id), edit: (...args) => current().edit(...args), perform: (...args) => current().perform(...args), performMatch: (...args) => current().performMatch(...args), dispose() { instance?.dispose(); instance = null; } });
})();
