'use strict';
// Presentation dependencies for the existing product components. This is not a
// Store: the captured TARGET view is the only source, callbacks the only writer.
const ProductContext = (() => {
  const esc = value => escapeHtml(String(value ?? ''));
  function create({ view, session, destination, perform, performInline = perform, edit, detail, openTogether, openPersonalStatus, openOtherJudgment, openSaga, ticket, feedback = '', feedbackZone = null, onActionSource = () => {}, isCurrent = () => true }) {
    if (view.kind !== 'AVAILABLE') throw new TypeError('Committed TARGET view required');
    const token = session.capture(), current=()=>session.current(token)&&isCurrent(), identities = view.getRecommendationInput();
    const people = identities.kind === 'AVAILABLE' ? identities.input.users.map(p => view.getIdentity(p.id)) : [];
    const person = code => people.find(p => p.legacyLabel === code || p.personId === code);
    const personKey = p => p.legacyLabel || p.personId;
    const callerLabel = view.context.caller.legacyLabel;
    const label = code => person(code)?.label || code;
    const safeUrl=value=>{if(!value)return null;try{const url=new URL(value,location.href);return ['https:','http:'].includes(url.protocol)?url.href:null;}catch(_){return null;}};
    const movies = view.catalog.contents.map(c => Object.freeze({ ...c, id: c.movie_id,poster:safeUrl(c.poster),trailer_url:safeUrl(c.trailer_url),
      matched: c.metadata_matched, added_by: people.find(p=>p.personId===c.added_by_person_id)?.legacyLabel ?? null,
      surprise_by: people.find(p=>p.personId===c.surprise_by_person_id)?.legacyLabel ?? null }));
    const byId = new Map(movies.map(m => [m.id,m]));
    const events = movies.flatMap(m=>view.getCard(m.id).group.events);
    const nights = events.map(x=>Object.freeze({...x.event,id:x.event.night_id,
      proposed_by:people.find(p=>p.personId===x.event.proposed_by_person_id)?.legacyLabel ?? null,
      participants:x.participants}));
    Object.freeze(movies); Object.freeze(nights);
    const hidden = m => !!m.surprise_by_person_id && m.surprise_by_person_id!==view.context.caller.personId;
    const state = (m,code) => {
      const p=person(code);return p ? view.personal.getState(p.personId,m.id) : {kind:'OUT_OF_COVERAGE'};
    };
    const rating = (m,code) => {const s=state(m,code);return s.kind==='AVAILABLE'?s.judgment?.rating??null:null;};
    const preference = (m,code) => {const s=state(m,code);return s.kind==='AVAILABLE'?s.judgment?.preference??null:null;};
    const together = m => view.getCard(m.id).group.hasTogetherHistory;
    const groupJudgment = m => view.getCard(m.id).group.judgment.judgment;
    const review = (m,code) => code==='both'?groupJudgment(m)?.review??'':state(m,code).judgment?.review??'';
    const togetherRating = m => groupJudgment(m)?.rating??null;
    const completedNights = m => completedNightEntries(ctx).filter(entry => entry.night.movie_id === m.id);
    const active = id => nights.find(n=>n.movie_id===id&&['proposed','confirmed'].includes(n.status));
    const asOf = new Date(view.context.temporal.as_of);
    const localTime = asOf.toLocaleTimeString('en-GB',{timeZone:view.context.temporal.timezone,hour12:false});
    const due = n => !!n && ['proposed','confirmed'].includes(n.status) && (n.date ? n.date<view.context.temporal.local_date || n.date===view.context.temporal.local_date&&(!n.time||n.time.slice(0,5)<=localTime.slice(0,5)) : n.confirmed_at ? Date.parse(n.confirmed_at)<=asOf.getTime() : n.status==='confirmed');
    const activeNights=()=>nights.filter(n=>['proposed','confirmed'].includes(n.status));
    const pick=n=>n?{...byId.get(n.movie_id),...movieProjection(byId.get(n.movie_id)),nightId:n.id,scheduled_date:n.date,scheduled_time:n.time,snack:n.snack,location:n.location,proposed_by:n.proposed_by,night_confirmed:n.status==='confirmed'}:null;
    const tonightPick=()=>pick(activeNights().filter(n=>n.date===view.context.temporal.local_date||!n.date&&n.status==='confirmed'&&n.confirmed_at&&new Date(n.confirmed_at).toLocaleDateString('en-CA',{timeZone:view.context.temporal.timezone})===view.context.temporal.local_date).sort((a,b)=>(a.status==='confirmed'?-1:1)-(b.status==='confirmed'?-1:1)||(b.created_at||'').localeCompare(a.created_at||''))[0]);
    // Presentation priority only. Open events never expire, regardless of
    // schedule or confirmed_at; a newer explicit choice may take the hero.
    const homeNightPick=()=>pick(activeNights().slice().sort((a,b)=>
      (a.status==='confirmed'?0:1)-(b.status==='confirmed'?0:1)||
      (b.created_at||'').localeCompare(a.created_at||'')||a.id.localeCompare(b.id))[0]);
    const callbacks = new Map();let serial=0;
    function action(text, fn, classes='min-h-11 px-3 py-2 rounded-lg bg-slate-800 text-slate-200 text-sm',attributes={}) {
      const id='product-'+(++serial);callbacks.set(id,fn);
      return `<button type="button" data-product-action="${id}" class="${classes}" ${Object.entries(attributes).map(([k,v])=>`${k}="${esc(v)}"`).join(' ')}>${text}</button>`;
    }
    function bind(parent) {
      parent.querySelectorAll('[data-product-action]').forEach(node=>{
        const fn=callbacks.get(node.dataset.productAction);node.onclick=e=>{e.stopPropagation();if(current()&&fn){onActionSource(node);if(node.dataset.returnFocusKey)node.focus({preventScroll:true});fn(node);}};
      });
      // The reusable product template's surprise controls get TARGET callbacks.
      parent.querySelectorAll('[onclick^="revealSurpriseUI"]').forEach(node=>{node.removeAttribute('onclick');node.onclick=e=>{e.stopPropagation();if(current())perform('setSurprise',node.closest('[data-movie-id]').dataset.movieId,false);};});
    }
    const viewingState = m => Object.fromEntries([...people.map(p=>[personKey(p),state(m,personKey(p)).kind==='AVAILABLE'?state(m,personKey(p)).seen:null]),['together',together(m)]]);
    const sagaButtonHtml = (m, variant = 'default') => !hidden(m)&&m.collection_id?action(
      '<i class="fa-solid fa-layer-group" aria-hidden="true"></i> '+(variant==='card'?'Saga':'Continua la saga'),
      ()=>openSaga(m.id),variant==='card'?'saga-entry saga-entry-compact':variant==='detail'?'detail-text-action detail-film-action saga-entry-detail':'saga-entry',
      {'aria-label':variant==='card'?'Apri la saga di '+m.title:'Apri la saga '+(m.collection_name||'di '+m.title)}
    ):'';
    const intentIcon=(kind,seen=false)=>kind==='shared'?'fa-user-plus':seen?'fa-rotate':'fa-plus';
    const intentAction=(kind,seen,fn,classes='')=>action(
      '<i class="fa-solid '+intentIcon(kind,seen)+'" aria-hidden="true"></i> '+(kind==='shared'?'Proponi per noi':seen?'Voglio rivederlo':'Voglio vederlo'),
      fn,'intent-action is-'+kind+(classes?' '+classes:''));
    const personalCollection=['personalList','personalSeen'].includes(destination);
    async function confirmListRemoval(m, relation, listName, node) {
      if(node.disabled)return;
      const confirmed=await showConfirmModal('Togliere «'+m.title+'» dalla '+listName+'?', 'Il film resterà nel catalogo. Visti, giudizi e serate non cambiano.');
      if(!confirmed||!current()||!node.isConnected)return;
      const original=node.innerHTML;
      node.disabled=true;node.setAttribute('aria-busy','true');
      node.innerHTML='<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Attendi…';
      try{await performInline(relation,m.id);}
      finally{if(node.isConnected){node.innerHTML=original;node.disabled=false;node.removeAttribute('aria-busy');}}
    }
    const listRemovalAction=(m,relation,listName,caption)=>action(
      caption,
      node=>confirmListRemoval(m,relation,listName,node),
      'movie-list-withdraw',
      {'data-list-removal':'true','aria-label':caption,'title':caption}
    );
    function personalActions(m) {
      const own=view.context.observedPerson.personId===view.context.caller.personId,s=state(m,callerLabel);
      if(destination==='personalList')return own?'':s.list?.active?'':intentAction('personal',s.seen,()=>perform('addToMyList',m.id),'is-compact');
      if(destination==='personalSeen'&&!own&&s.seen!==true)return action('L’ho visto anch’io',()=>perform('recordSeen',m.id),'movie-list-secondary');
      return '';
    }
    function personalStatus(m) {
      return viewingStatusHtml(m,{},ctx);
    }
    const scheduleInitial = m => view.getCard(m.id).group.candidacy.effectiveCandidacy ? {selectCandidate:true,selectionView:view} : {};
    const scheduleActions = (m, list = false) => action(list?'<i class="fa-solid fa-ticket" aria-hidden="true"></i> Guardiamolo':'Oggi',()=>edit('quickNight',m.id,scheduleInitial(m)),list?'movie-list-primary':'flex-1 min-h-11 px-3 py-2 bg-indigo-600/20 text-indigo-300 rounded')+action(list?'<i class="fa-solid fa-calendar-days" aria-hidden="true"></i> Pianifica':'Programma',()=>edit('scheduleNight',m.id,scheduleInitial(m)),list?'movie-list-secondary':'flex-1 min-h-11 px-3 py-2 bg-slate-800 rounded text-slate-300');
    function cardOperationsHtml(m) {
      if(hidden(m))return '';
      const saga=sagaButtonHtml(m,'card');
      if(['groupList','rewatch'].includes(destination)){
        const group=view.getCard(m.id).group, events=group.events.filter(item=>['proposed','confirmed'].includes(item.event.status));
        let controls;
        if(events.length){
          const n=events.length===1?events[0].event:null;
          const title=!n?events.length+' serate aperte':n.status==='proposed'?'Proposta in attesa':n.date?'Serata aperta':'FILM SCELTO';
          const description=n?(n.date?formatNightDate(n.date,n.time):n.status==='confirmed'?'Da vedere insieme':''):'';
          controls=`<div class="movie-list-state"><strong>${esc(title)}</strong>${description?`<p>${esc(description)}</p>`:''}</div>`+action('Apri In programma',()=>setTab('tonight'),'movie-list-secondary');
        }else controls=`<div class="movie-list-actions">${scheduleActions(m,true)}</div>`;
        let secondary='',withdraw='';
        if(group.candidacy.effectiveCandidacy)withdraw=listRemovalAction(m,'withdrawGroupCandidacy','Da vedere insieme','Togli dai Da vedere insieme');
        else if(destination==='rewatch'&&!events.length)secondary+=action('<i class="fa-solid fa-user-plus" aria-hidden="true"></i> Proponi per noi',()=>perform('proposeToGroup',m.id),'movie-rewatch-propose',{'aria-label':'Proponi per noi · '+m.title});
        return `<div class="movie-list-choices">${controls}<div class="movie-list-secondary-strip${destination==='rewatch'?' movie-rewatch-secondary':''}">${saga}${withdraw}${secondary}</div></div>`;
      }
      if(destination==='personalSeen'){
        const mine=state(m,callerLabel),group=view.getCard(m.id).group;
        const openNight=group.events.some(item=>['proposed','confirmed'].includes(item.event.status));
        const propose=!group.candidacy.effectiveCandidacy&&!openNight
          ?intentAction('shared',false,()=>perform('proposeToGroup',m.id),'movie-seen-primary'):'';
        const personal=mine.kind==='AVAILABLE'&&!mine.list.active
          ?intentAction('personal',mine.seen,()=>perform('addToMyList',m.id),'movie-seen-primary'):'';
        return '<div class="movie-list-choices"><div class="movie-list-actions movie-seen-actions">'+propose+personal+'</div><div class="movie-list-secondary-strip movie-seen-secondary">'+saga+'</div></div>';
      }
      if(personalCollection){
        const own=view.context.observedPerson.personId===view.context.caller.personId;
        const removalControl=own&&destination==='personalList'?listRemovalAction(m,'removeFromMyList','tuoi Da vedere','Togli dai miei Da vedere'):'';
        return '<div class="movie-list-choices">'+personalActions(m)+(saga||removalControl?'<div class="movie-list-secondary-strip">'+saga+removalControl+'</div>':'')+'</div>';
      }
      let primary=personalActions(m),programming='',management='';
      if(destination==='scheduled')return projectionInfoHtml(m,ctx)+saga;
      if(destination==='together')return '<div class="movie-list-choices"><div class="movie-list-secondary-strip movie-together-secondary">'+saga+'<span class="movie-together-label">INSIEME</span></div></div>';
      if(['personalList','personalSeen','together'].includes(destination))management+=action('Proponi al gruppo',()=>perform('proposeToGroup',m.id));
      if(destination==='personalSeen'&&view.context.observedPerson.personId===view.context.caller.personId)management+=action('Rimuovi dai miei Visti',()=>perform('removeSeen',m.id));
      if(view.getCard(m.id).group.candidacy.effectiveCandidacy)management+=action('Ritira candidatura',()=>perform('withdrawGroupCandidacy',m.id));
      return primary+saga+`<div class="movie-card-sections pt-2 border-t border-slate-800/80 text-xs">${cardSectionHtml('Programmazione',programming)}${cardSectionHtml('Gestione',management)}</div>`;
    }
    // Detail is film-centric. Each disclosure below retains its exact nightId;
    // opening it never creates an event or selects another event for the film.
    const detailNightLabel = n => n.status==='completed'?'Visione insieme':n.status==='proposed'?'Proposta in attesa':n.status==='confirmed'?(n.date?'Serata aperta':'FILM SCELTO'):n.status==='cancelled'?'Serata annullata':'Serata non effettuata';
    function detailNightActions(n) {
      let html='';
      if(n.status==='proposed'&&n.proposed_by_person_id!==view.context.caller.personId)html+=action('Accetta proposta',()=>perform('confirmNight',n.id),'detail-secondary');
      if(n.status==='confirmed'&&(!n.date||due(n)))html+=action('Concludi questa serata',()=>edit('completeScheduled',n.id,n),'detail-secondary');
      if(!['cancelled','skipped'].includes(n.status))html+=action('Snack e luogo',()=>edit('editNight',n.id,n),'detail-text-action');
      if(['proposed','confirmed'].includes(n.status))html+=action('Annulla serata',()=>perform('cancelNight',n.id),'detail-text-action');
      return html;
    }
    function eventHistory(m, events=view.getCard(m.id).group.events.filter(item=>item.event.status!=='cancelled')) {
      const completed=completedNights(m).map(entry=>events.find(item=>item.event.night_id===entry.night.id)).filter(Boolean);
      const other=events.filter(item=>item.event.status!=='completed');
      const row=item=>{
        const n=nights.find(n=>n.id===item.event.night_id);
        const date=n.status==='completed'?completedNightLabel({night:n,timelineDate:nightTimelineDate(n)}):n.date?formatNightDate(n.date,n.time):n.status==='confirmed'?'Da vedere insieme':'Data da scegliere';
        const participants=item.participants.map(p=>view.getIdentity(p.person_id).label||'Partecipante').join(', ');
        return `<details class="detail-night" data-night-id="${esc(n.id)}"><summary><span>${esc(detailNightLabel(n))}<small>${esc(date)}</small></span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary><div class="detail-night-body" data-feedback-zone="night-${esc(n.id)}">${n.snack?`<p>🍿 ${esc(n.snack)}</p>`:''}${n.location?`<p>${esc(n.location)}</p>`:''}${participants?`<p>Partecipanti: ${esc(participants)}</p>`:''}<div class="detail-secondary-actions">${detailNightActions(n)}</div><p class="detail-feedback" data-action-feedback="night-${esc(n.id)}" role="status">${feedbackZone==='night-'+n.id?esc(feedback):''}</p></div></details>`;
      };
      return (completed.length?'<div class="detail-completed-nights"><h5>Serate concluse · '+completed.length+'</h5>'+completed.map(row).join('')+'</div>':'')
        +(other.length?'<div class="detail-other-nights"><h5>Altre serate</h5>'+other.map(row).join('')+'</div>':'');
    }
    function togetherPopupHtml(m,{fromDetail=false}={}) {
      const completed=completedNights(m),judgment=groupJudgment(m),hasJudgment=judgment?.rating!=null||!!judgment?.review;
      const rating=judgment?.rating!=null?'★ '+formatMovieRating(judgment.rating):'';
      const editJudgment=action(hasJudgment?'Modifica giudizio':'Valuta insieme',()=>edit('setGroupEvaluation',m.id,judgment),
        hasJudgment?'together-popup-text-action':'together-popup-primary',{'data-return-focus-key':'together-judgment'});
      const nightHtml=entry=>{
        const n=entry.night, key=entry.timelineDate?.key;
        const date=key?(()=>{const [year,month,day]=key.split('-').map(Number);return new Date(year,month-1,day).toLocaleDateString('it-IT',{day:'numeric',month:'long',year:'numeric'});})():'Data non disponibile';
        const names=(n.participants||[]).map(p=>view.getIdentity(p.person_id)?.label||'Partecipante').join(', ');
        const info=[n.location,n.snack?'🍿 '+n.snack:null].filter(Boolean).map(esc).join(' · ');
        const content='<div class="together-night-content">'+(info?'<p class="together-night-context">'+info+'</p>':'')+
          (names?'<p class="together-night-people">Con '+esc(names)+'</p>':'')+
          '<div class="together-night-actions">'+action('Modifica serata',()=>edit('editNight',n.id,n),'together-popup-text-action',{'data-return-focus-key':'night-'+n.id})+
          (fromDetail?'':action('Apri dettaglio film',()=>{closeModal('togetherModal');detail(m.id,null,n.id,true);},'together-popup-text-action'))+'</div></div>';
        return completed.length===1?'<article class="together-night" data-night-id="'+esc(n.id)+'"><h5>'+esc(date)+'</h5>'+content+'</article>'
          :'<details class="together-night" data-night-id="'+esc(n.id)+'"><summary>'+esc(date)+'<i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary>'+content+'</details>';
      };
      return '<header class="together-popup-heading"><span class="together-popup-eyebrow">Insieme</span><h3>'+esc(m.title)+'</h3>'+
        (rating?'<strong>'+esc(rating)+'</strong>':'')+'</header><section class="together-popup-section"><h4>Il nostro giudizio</h4>'+
        (hasJudgment?'<div class="together-popup-judgment">'+(judgment.review?'<p>'+esc(judgment.review)+'</p>':'<p>Nessun commento condiviso.</p>')+'</div>':'<p>Non avete ancora lasciato un giudizio condiviso su questo film.</p>')+
        editJudgment+'</section><section class="together-popup-section"><h4>Le nostre visioni'+(completed.length>1?' · '+completed.length:'')+'</h4>'+
        completed.map(nightHtml).join('')+'</section>';
    }
    function otherJudgmentHtml(m,key) {
      const member=person(key),personal=state(m,key);
      if(!member||member.personId===view.context.caller.personId||personal.kind!=='AVAILABLE')return '';
      const judgment=personal.judgment;
      if(judgment?.rating==null&&judgment?.preference==null&&!judgment?.review)return '';
      const value=judgment.rating!=null?'★ '+formatMovieRating(judgment.rating)
        :judgment.preference===true?'👍 Mi è piaciuto':judgment.preference===false?'👎 Non mi è piaciuto':'';
      return '<header class="personal-judgment-readonly-head"><span>Il giudizio di '+esc(member.label)+'</span><h3>'+esc(m.title)+'</h3></header>'+
        (value?'<p class="personal-judgment-readonly-value">'+esc(value)+'</p>':'')+
        (judgment.review?'<div class="personal-judgment-readonly-review"><h4>Recensione</h4><p>'+esc(judgment.review)+'</p></div>':'');
    }
    function personalStatusHtml(m) {
      const personal=state(m,callerLabel);
      if(personal.kind!=='AVAILABLE')return '';
      const seen=personal.seen===true,judgment=personal.judgment||{};
      const hasJudgment=judgment.rating!=null||judgment.preference!=null||!!judgment.review;
      const seenAction=seen?action('Rimuovi dai miei Visti',async()=>{
        if(await showConfirmModal('Rimuovere «'+m.title+'» dai tuoi Visti?','Il giudizio personale e le serate insieme restano.'))if(current())await perform('removeSeen',m.id);
      },'personal-status-remove')
        :action('Segna come visto',()=>perform('recordSeen',m.id),'personal-status-primary');
      const judgmentAction=action(hasJudgment?'Modifica giudizio':'Valuta il film',()=>edit('setMyEvaluation',m.id,judgment),'personal-status-judgment');
      return '<header class="personal-status-heading"><span>Il mio cinema</span><h3>'+esc(m.title)+'</h3></header>'+
        '<p class="personal-status-state">'+(seen?'Nei tuoi Visti.':'Non è nei tuoi Visti.')+'</p>'+
        (seen?'<div class="personal-status-actions">'+judgmentAction+'</div><div class="personal-status-secondary">'+seenAction+'</div>'
          :'<div class="personal-status-actions">'+seenAction+judgmentAction+'</div>');
    }
    function openDetailNights(id=null) {
      if(!current())return;
      if(id){
        const selected=session.getState().view.getEvent(id);
        if(selected.kind!=='AVAILABLE'||selected.event.event.status==='cancelled')return;
      }
      const box=document.getElementById('detailBody'),list=box?.querySelector('[data-detail-nights]');
      if(!list)return;list.open=true;
      const row=id?[...list.querySelectorAll('[data-night-id]')].find(node=>node.dataset.nightId===id):null;
      if(row)row.open=true;
      const summary=(row||list).querySelector('summary');summary?.focus();summary?.scrollIntoView({block:'nearest'});
    }
    function detailActions(m) {
      if(hidden(m))return '';
      const s=state(m,callerLabel),g=view.getCard(m.id).group,available=s.kind==='AVAILABLE';
      const visibleEvents=g.events.filter(item=>item.event.status!=='cancelled');
      const open=g.events.filter(x=>['proposed','confirmed'].includes(x.event.status));
      const status=zone=>'<p class="detail-feedback" data-action-feedback="'+zone+'" role="status">'+(feedbackZone===zone?esc(feedback):'')+'</p>';
      let primary=null,secondary='';
      if(open.length>1)primary={text:'Scegli la serata',fn:()=>openDetailNights(),kind:'nights'};
      else if(open.length===1){
        const n=nights.find(n=>n.id===open[0].event.night_id);
        primary=n.status==='confirmed'&&n.date&&due(n)?{text:'Concludi questa serata',fn:()=>edit('completeScheduled',n.id,n),kind:'complete'}:{text:'Apri la serata',fn:()=>openDetailNights(n.id),kind:'nights'};
      }else if(g.candidacy.effectiveCandidacy){
        primary={text:'Guardiamolo',fn:()=>edit('quickNight',m.id,scheduleInitial(m)),kind:'choose'};
        secondary+=action('<i class="fa-solid fa-calendar-days" aria-hidden="true"></i> Pianifica',()=>edit('scheduleNight',m.id,scheduleInitial(m)),'movie-list-secondary');
      }
      let filmControls=sagaButtonHtml(m,'detail');
      filmControls+=action(m.cinema_watchlist?'Sposta in Streaming':'Sposta al cinema',()=>perform('setCinema',m.id,!m.cinema_watchlist),'detail-text-action');
      if(m.tmdb_id)filmControls+=action('Aggiorna informazioni da TMDb',()=>edit('refreshMetadata',m.id),'detail-text-action');
      const veto=view.getVetoForMovie(m.id).veto;
      const danger=action('Rimuovi film',async()=>{if(await showConfirmModal('Rimuovere il film dal catalogo?','Questa azione è definitiva.'))if(current())perform('deleteContent',m.id);},'detail-danger',{'data-feedback-zone':'danger'});
      let extraControls='';
      if(veto?.person_id===view.context.caller.personId)extraControls+=action('Togli il mio veto',()=>perform('removeVeto',m.id,veto.veto_id),'detail-text-action');
      if(m.surprise_by_person_id===view.context.caller.personId)extraControls+=action('Annulla la mia sorpresa',()=>perform('setSurprise',m.id,false),'detail-text-action');
      const main=primary?action(primary.kind==='choose'?'<i class="fa-solid fa-ticket" aria-hidden="true"></i> Guardiamolo':esc(primary.text),async node=>{if(node.disabled)return;const pending=primary.fn();if(!pending?.then)return;node.disabled=true;try{await pending;}finally{if(current()&&node.isConnected)node.disabled=false;}},primary.kind==='choose'?'movie-list-primary':'movie-list-primary detail-primary',{'data-detail-primary':primary.kind,'data-return-focus-key':'detail-primary'}):'';
      const personalSection=available?'<section class="detail-intent detail-intent-personal" data-feedback-zone="personal-actions"><h4>Per me</h4>'+
        (s.list.active?'<p>Nei tuoi Da vedere</p>'+action('Togli dai miei Da vedere',node=>confirmListRemoval(m,'removeFromMyList','tuoi Da vedere',node),'detail-intent-remove',{'data-list-removal':'true'})
          :intentAction('personal',s.seen,()=>perform('addToMyList',m.id),'detail-intent-action'))+status('personal-actions')+'</section>':'';
      const groupState=open.length?'<p>'+(open.length===1?esc(detailNightLabel(open[0].event)):open.length+' serate aperte')+'</p>':'';
      const groupAction=g.candidacy.effectiveCandidacy?action('Togli dai Da vedere insieme',node=>confirmListRemoval(m,'withdrawGroupCandidacy','Da vedere insieme',node),'detail-intent-remove',{'data-list-removal':'true'})
        :open.length?'':intentAction('shared',false,()=>perform('proposeToGroup',m.id),'detail-intent-action detail-intent-propose');
      const groupSection='<section class="detail-intent detail-intent-group" data-feedback-zone="group-actions"><h4>Per noi</h4>'+groupState+
        (main?'<div class="detail-next-action">'+(primary.kind==='choose'?'<div class="movie-list-actions detail-choice-actions">'+main+secondary+'</div>':main)+'</div>':'')+
        groupAction+status('group-actions')+'</section>';
      return groupSection+personalSection+
        (visibleEvents.length?'<details class="detail-nights'+(g.hasTogetherHistory?' detail-nights-deeplink':'')+'" data-detail-nights><summary>Le serate · '+visibleEvents.length+'</summary>'+eventHistory(m,visibleEvents)+'</details>':'')+
        '<details class="detail-more" data-detail-disclosure="more"><summary>Altre azioni</summary><div class="detail-menu-controls" data-feedback-zone="film-actions">'+filmControls+danger+extraControls+status('film-actions')+status('danger')+'</div></details>';

    }
    const movieProjection = (m, selectedNight = null) => {const n=selectedNight || active(m.id);return {...m,nightId:n?.id,scheduled_date:n?.date,scheduled_time:n?.time,snack:n?.snack,location:n?.location,night_confirmed:n?.status==='confirmed',proposed_by:n?.proposed_by};};
    const personBadge = code => code ? `<span class="badge badge-${esc(code.toLowerCase())}">${esc(label(code))}</span>`:'';
    function eventActions(n) {
      const args=n.id;let html='';
      if(['proposed','confirmed'].includes(n.status)) {
        if(n.status==='proposed'&&n.proposed_by!==callerLabel)html+=action('Accetta proposta',()=>perform('confirmNight',args),'next-movie-action next-movie-primary');
        if(n.status==='confirmed'&&due(n))html+=action('Completa serata',()=>edit('completeScheduled',args,n),'next-movie-action next-movie-primary');
        html+=action(n.status==='proposed'?(n.proposed_by===callerLabel?'Annulla proposta':'Rifiuta'):'Annulla proiezione',()=>perform('cancelNight',args),'next-movie-action next-movie-secondary');
      }
      if(!['cancelled','skipped'].includes(n.status))html+=action('Snack e luogo',()=>edit('editNight',args,n),'next-movie-action next-movie-secondary');
      return html;
    }
    const ctx={movies,nights,callerLabel,feedback,feedbackZone,destination,tab:destination==='scheduled'?'tonight':'watchlist',view,personBadge,viewingState,
      judgmentPeople:people.map(personKey),personLabel:label,personTone:code=>(person(code)?.legacyLabel||'default').toLowerCase(),
      isCaller:code=>person(code)?.personId===view.context.caller.personId,callerPresent:people.some(p=>p.personId===view.context.caller.personId),
      shouldPromptPersonal:m=>destination==='personalSeen'&&view.context.observedPerson.personId===view.context.caller.personId&&state(m,personKey(view.context.observedPerson)).seen===true,
      personalRating:rating,personalPreference:preference,personalState:state,togetherSeen:together,togetherRating,reviewTextFor:review,edit,openTogether,openPersonalStatus,openOtherJudgment,personalStatusHtml,viewingStatusHtml:(m,o)=>personalCollection&&!hidden(m)?personalStatus(m):viewingStatusHtml(m,o,ctx),
      participated:(m,code)=>view.getCard(m.id).group.events.some(x=>x.event.status==='completed'&&x.participants.some(p=>p.person_id===person(code)?.personId)),
      cardReviewsHtml:()=>'',reviewCardsHtml:m=>reviewCardsHtml(m,ctx),sagaButtonHtml,cardOperationsHtml,detailActions,togetherPopupHtml,otherJudgmentHtml,movieProjection,completedNights,togetherArchive:destination==='together',
      detail,bind,action,eventActions,active,due,hidden,session,token,current,scheduleInitial,activeNights,tonightPick,homeNightPick,
      openDetailNights,
      bindHistory(parent){
        parent.querySelectorAll('[data-history-movie], [data-projection-movie]').forEach(node=>{
          const id=node.dataset.historyMovie||node.dataset.projectionMovie;if(!byId.has(id)||hidden(byId.get(id)))return;
          const open=source=>{if(current())detail(id,source,node.dataset.nightId||null);};
          const heading=node.querySelector('h5, h3');if(heading){const b=document.createElement('button');b.type='button';b.textContent=heading.textContent;b.className='text-left hover:underline';b.setAttribute('aria-haspopup','dialog');b.onclick=()=>open(b);heading.replaceChildren(b);}
          node.onclick=e=>{if(!e.target.closest('button,a,input,select,textarea,details,summary'))open(heading?.querySelector('button')||node);};
        });
      },
      bindCalendar(parent){parent.querySelectorAll('[data-calendar-movie]').forEach(node=>{if(!byId.has(node.dataset.calendarMovie))return;node.tabIndex=0;node.setAttribute('role','button');const open=()=>{if(current())detail(node.dataset.calendarMovie,node,node.dataset.nightId||null);};node.onclick=open;node.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();open();}};});},
      ticket:id=>ticket(id),getMovie:id=>byId.get(id),
      matchContext(match) {
        const swipes=match.authoritative?.swipes||[], sessionRow=match.authoritative?.session;
        return {...ctx,movies:movies.map(m=>hidden(m)?{...m,title:'Film a sorpresa',poster:null,director:null,genres:[],overview:null,_surpriseHidden:true}:m),swipes,swipeSessions:sessionRow?[sessionRow]:[],personLabels:people.map(p=>p.legacyLabel),
          matchPresentUsers:()=>match.presence.map(id=>people.find(p=>p.personId===id)?.legacyLabel).filter(Boolean),
          sessionAgreement:()=>match.derived?.agreement||{total:0,pct:null},
          swipesForCard:(_,id)=>Object.fromEntries(swipes.filter(s=>s.movie_id===id).map(s=>[people.find(p=>p.personId===s.personId)?.legacyLabel,s.liked]))};
      }};
    return Object.freeze(ctx);
  }
  return Object.freeze({create});
})();
