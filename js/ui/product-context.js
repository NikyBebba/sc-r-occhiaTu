'use strict';
// Presentation dependencies for the existing product components. This is not a
// Store: the captured TARGET view is the only source, callbacks the only writer.
const ProductContext = (() => {
  const esc = value => escapeHtml(String(value ?? ''));
  function create({ view, session, destination, perform, edit, detail, openSaga, ticket, feedback = '', feedbackZone = null, onActionSource = () => {}, isCurrent = () => true }) {
    if (view.kind !== 'AVAILABLE') throw new TypeError('Committed TARGET view required');
    const token = session.capture(), current=()=>session.current(token)&&isCurrent(), identities = view.getRecommendationInput();
    const people = identities.kind === 'AVAILABLE' ? identities.input.users.map(p => view.getIdentity(p.id)) : [];
    const person = code => people.find(p => p.legacyLabel === code);
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
    const viewingState = m => ({N:state(m,'N').kind==='AVAILABLE'?state(m,'N').seen:null,V:state(m,'V').kind==='AVAILABLE'?state(m,'V').seen:null,together:together(m)});
    const sagaButtonHtml = m => !hidden(m)&&m.collection_id?action('<i class="fa-solid fa-layer-group" aria-hidden="true"></i> Continua la saga',()=>openSaga(m.id),'saga-entry'):'';
    const personalCollection=['personalList','personalSeen'].includes(destination);
    function personalActions(m) {
      const own=view.context.observedPerson.personId===view.context.caller.personId,s=state(m,callerLabel);
      if(destination==='personalList')return own?'':s.list?.active?'<span class="text-xs text-slate-400">Anche nella tua Lista</span>':action('Anche nella mia Lista',()=>perform('addToMyList',m.id),'movie-list-secondary');
      if(destination==='personalSeen'&&!own&&s.seen!==true)return action('L’ho visto anch’io',()=>perform('recordSeen',m.id),'movie-list-secondary');
      return '';
    }
    function personalStatus(m) {
      const observed=view.context.observedPerson,own=observed.personId===view.context.caller.personId;
      const text=destination==='personalList'?(own?'Nella tua Lista':'Nella Lista di '+observed.label):(own?'Visto personalmente':'Visto da '+observed.label);
      return '<div class="personal-cinema-state"><span>'+esc(text)+'</span>'+personalJudgmentSlotHtml(m,observed.legacyLabel,ctx)+'</div>';
    }
    function personalReview(m) {
      if(hidden(m))return '';
      const text=review(m,view.context.observedPerson.legacyLabel);
      return text?'<p class="personal-cinema-review">'+esc(text)+'</p>':'';
    }
    const scheduleInitial = m => view.getCard(m.id).group.candidacy.effectiveCandidacy ? {selectCandidate:true,selectionView:view} : {};
    const scheduleActions = (m, list = false) => action(list?'<i class="fa-solid fa-ticket" aria-hidden="true"></i> Guardiamolo':'Oggi',()=>edit('quickNight',m.id,scheduleInitial(m)),list?'movie-list-primary':'flex-1 min-h-11 px-3 py-2 bg-indigo-600/20 text-indigo-300 rounded')+action(list?'<i class="fa-solid fa-calendar-days" aria-hidden="true"></i> Pianifica':'Programma',()=>edit('scheduleNight',m.id,scheduleInitial(m)),list?'movie-list-secondary':'flex-1 min-h-11 px-3 py-2 bg-slate-800 rounded text-slate-300');
    function cardOperationsHtml(m) {
      if(hidden(m))return '';
      if(['groupList','rewatch'].includes(destination)){
        const group=view.getCard(m.id).group, events=group.events.filter(item=>['proposed','confirmed'].includes(item.event.status));
        let controls;
        if(events.length){
          const n=events.length===1?events[0].event:null;
          const title=!n?events.length+' serate aperte':n.status==='proposed'?'Proposta in attesa':n.date?'Serata aperta':'FILM SCELTO';
          const description=n?(n.date?formatNightDate(n.date,n.time):n.status==='confirmed'?'Da vedere insieme':''):'';
          controls=`<div class="movie-list-state"><strong>${esc(title)}</strong>${description?`<p>${esc(description)}</p>`:''}</div>`+action('Apri In programma',()=>setTab('tonight'),'movie-list-secondary');
        }else controls=`<div class="movie-list-actions">${scheduleActions(m,true)}</div>`;
        let secondary='';
        if(group.candidacy.effectiveCandidacy)secondary+=action('Togli dalla Lista',async node=>{
          if(node.disabled)return;node.disabled=true;
          try{await perform('withdrawGroupCandidacy',m.id);}finally{if(current()&&node.isConnected)node.disabled=false;}
        },'movie-list-remove')+'<p class="movie-list-note">Il film resta nel catalogo, con le visioni e i giudizi.</p>';
        else if(destination==='rewatch')secondary+=action('Aggiungi alla Lista',()=>perform('proposeToGroup',m.id),'movie-list-remove');
        if(m.matched===false)secondary+=action('Correggi titolo e ricerca di nuovo',()=>edit('updateMetadata',m.id),'movie-list-remove');
        return `<div class="movie-list-choices">${controls}${secondary?`<details class="movie-list-overflow"><summary aria-label="Altre azioni per ${esc(m.title)}"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i><span class="sr-only">Altre azioni</span></summary><div class="movie-list-overflow-body">${secondary}</div></details>`:''}</div>`;
      }
      if(personalCollection){
        const own=view.context.observedPerson.personId===view.context.caller.personId;
        const remove=own?action(destination==='personalList'?'Rimuovi dalla mia Lista':'Rimuovi dai miei Visti',()=>perform(destination==='personalList'?'removeFromMyList':'removeSeen',m.id),'movie-list-remove'):'';
        return '<div class="movie-list-choices">'+personalActions(m)+(remove?'<details class="movie-list-overflow"><summary aria-label="Altre azioni per '+esc(m.title)+'"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i><span class="sr-only">Altre azioni</span></summary><div class="movie-list-overflow-body">'+remove+'<p class="movie-list-note">Il giudizio e le serate insieme restano.</p></div></details>':'')+'</div>';
      }
      let primary=personalActions(m),programming='',management='';
      if(destination==='scheduled')return projectionInfoHtml(m,ctx);
      if(['personalList','personalSeen','together'].includes(destination))management+=action('Proponi al gruppo',()=>perform('proposeToGroup',m.id));
      if(destination==='personalSeen'&&view.context.observedPerson.personId===view.context.caller.personId)management+=action('Rimuovi dai miei Visti',()=>perform('removeSeen',m.id));
      if(m.matched===false)management+=action('Correggi titolo e ricerca di nuovo',()=>edit('updateMetadata',m.id));
      if(view.getCard(m.id).group.candidacy.effectiveCandidacy)management+=action('Ritira candidatura',()=>perform('withdrawGroupCandidacy',m.id));
      return primary+`<div class="movie-card-sections pt-2 border-t border-slate-800/80 text-xs">${cardSectionHtml('Programmazione',programming)}${cardSectionHtml('Gestione',management)}</div>`;
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
    function eventHistory(m) {
      return view.getCard(m.id).group.events.map(item=>{
        const n=nights.find(n=>n.id===item.event.night_id);
        const date=n.status==='completed'?completedNightLabel({night:n,timelineDate:nightTimelineDate(n)}):n.date?formatNightDate(n.date,n.time):'Data non fissata';
        const participants=item.participants.map(p=>view.getIdentity(p.person_id).label||'Partecipante').join(', ');
        return `<details class="detail-night" data-night-id="${esc(n.id)}"><summary><span>${esc(detailNightLabel(n))}<small>${esc(date)}</small></span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary><div class="detail-night-body" data-feedback-zone="night-${esc(n.id)}">${n.snack?`<p>🍿 ${esc(n.snack)}</p>`:''}${n.location?`<p>${esc(n.location)}</p>`:''}${participants?`<p>Partecipanti: ${esc(participants)}</p>`:''}<div class="detail-secondary-actions">${detailNightActions(n)}</div><p class="detail-feedback" data-action-feedback="night-${esc(n.id)}" role="status">${feedbackZone==='night-'+n.id?esc(feedback):''}</p></div></details>`;
      }).join('');
    }
    function openDetailNights(id=null) {
      const box=document.getElementById('detailBody'),list=box?.querySelector('[data-detail-nights]');
      if(!list||!current())return;list.open=true;
      const row=id?[...list.querySelectorAll('[data-night-id]')].find(node=>node.dataset.nightId===id):null;
      if(row)row.open=true;
      const summary=(row||list).querySelector('summary');summary?.focus();summary?.scrollIntoView({block:'nearest'});
    }
    function detailActions(m) {
      if(hidden(m))return '';
      const s=state(m,callerLabel),g=view.getCard(m.id).group,available=s.kind==='AVAILABLE';
      const open=g.events.filter(x=>['proposed','confirmed'].includes(x.event.status)),completed=g.events.filter(x=>x.event.status==='completed');
      const other=people.filter(p=>p.personId!==view.context.caller.personId).map(p=>({person:p,state:state(m,p.legacyLabel)}));
      const judgment=g.judgment.judgment;
      const status=zone=>'<p class="detail-feedback" data-action-feedback="'+zone+'" role="status">'+(feedbackZone===zone?esc(feedback):'')+'</p>';
      let primary,secondary='';
      if(open.length>1)primary={text:'Scegli la serata',fn:()=>openDetailNights(),kind:'nights'};
      else if(open.length===1){
        const n=nights.find(n=>n.id===open[0].event.night_id);
        primary=n.status==='confirmed'&&n.date&&due(n)?{text:'Concludi questa serata',fn:()=>edit('completeScheduled',n.id,n),kind:'complete'}:{text:'Apri la serata',fn:()=>openDetailNights(n.id),kind:'nights'};
      }else if((available&&s.list.active)||g.candidacy.effectiveCandidacy){
        primary={text:'Guardiamolo',fn:()=>edit('quickNight',m.id,scheduleInitial(m)),kind:'choose'};
        secondary+=action('<i class="fa-solid fa-calendar-days" aria-hidden="true"></i> Pianifica',()=>edit('scheduleNight',m.id,scheduleInitial(m)),'movie-list-secondary');
      }else if(completed.length>1)primary={text:'Apri le '+completed.length+' serate',fn:()=>openDetailNights(),kind:'nights'};
      else if(g.hasTogetherHistory)primary={text:'Il giudizio N+V',fn:()=>edit('setGroupEvaluation',m.id,judgment),kind:'groupJudgment'};
      else if(available&&s.seen&&other.some(x=>x.state.kind==='AVAILABLE'&&x.state.seen))primary={text:'Aggiungi alla Lista N+V',fn:()=>perform('proposeToGroup',m.id),kind:'shared'};
      else if(available&&s.seen)primary={text:'Il mio giudizio',fn:()=>edit('setMyEvaluation',m.id,s.judgment),kind:'myJudgment'};
      else if(available&&other.some(x=>x.state.kind==='AVAILABLE'&&x.state.seen))primary={text:'L’ho visto anch’io',fn:()=>perform('recordSeen',m.id),kind:'seen'};
      else primary={text:'Aggiungi alla Lista N+V',fn:()=>perform('proposeToGroup',m.id),kind:'shared'};
      if(available&&!s.list.active&&primary.kind!=='choose')secondary+=action('Aggiungi alla mia Lista',()=>perform('addToMyList',m.id),'detail-text-action');
      const judgmentHtml=(j,caption,editable,fn)=>{
        const parts=[];
        if(j?.rating!==null&&j?.rating!==undefined)parts.push('★ '+formatMovieRating(j.rating)+'/10');
        else if(j?.preference===true)parts.push('Mi è piaciuto');else if(j?.preference===false)parts.push('Non mi è piaciuto');
        const content=esc(caption)+(parts.length?' · '+esc(parts.join(' · ')):'');
        return (editable?action(content,fn,'detail-judgment',{'data-return-focus-key':caption}):(parts.length?'<p class="detail-judgment-readonly">'+content+'</p>':''))+(j?.review?'<p class="detail-review">'+esc(j.review)+'</p>':'');
      };
      const mine=available?'<div class="detail-relation-status">'+(s.list.active?'<span>Nella tua Lista</span>':'')+(s.seen?'<span>Nei tuoi Visti</span>':'')+(!s.seen&&g.hasTogetherHistory?'<span>Nessuna visione personale registrata</span>':'')+'</div>'+judgmentHtml(s.judgment,'Il mio giudizio',primary.kind!=='myJudgment',()=>edit('setMyEvaluation',m.id,s.judgment)):'<p>Dati personali non disponibili.</p>';
      const otherHtml=other.filter(x=>x.state.kind==='AVAILABLE'&&(x.state.seen||x.state.judgment?.rating!==null&&x.state.judgment?.rating!==undefined||x.state.judgment?.preference!=null||x.state.judgment?.review)).map(({person:p,state:q})=>'<div class="detail-other-person"><p>'+esc(p.label)+(q.seen?' · Nei suoi Visti':'')+'</p>'+judgmentHtml(q.judgment,'Giudizio di '+p.label,false)+'</div>').join('');
      let shared=(g.candidacy.effectiveCandidacy?'<p>Nella Lista N+V</p>':'')+(g.hasTogetherHistory?'<p class="detail-together"><i class="fa-solid fa-film" aria-hidden="true"></i> Visti insieme · '+completed.length+(completed.length===1?' serata':' serate')+'</p>':'');
      if(open.length){const n=open.length===1?open[0].event:null;shared+='<p>'+(n?esc(detailNightLabel(n))+(n.date?' · '+esc(formatNightDate(n.date,n.time)):n.status==='confirmed'?' · Da vedere insieme':' · Data non fissata'):open.length+' serate aperte')+'</p>';}
      if(g.hasTogetherHistory||judgment?.rating!=null||judgment?.review)shared+=judgmentHtml(judgment,'Il giudizio N+V',primary.kind!=='groupJudgment',()=>edit('setGroupEvaluation',m.id,judgment));
      let personalControls='',groupControls='',filmControls='';
      if(available&&!s.list.active&&primary.kind==='choose')personalControls+=action('Aggiungi alla mia Lista',()=>perform('addToMyList',m.id),'detail-text-action');
      if(available&&!s.seen&&primary.kind!=='seen')personalControls+=action('Aggiungi ai miei Visti',()=>perform('recordSeen',m.id),'detail-text-action');
      if(available&&s.list.active)personalControls+=action('Rimuovi dalla mia Lista',()=>perform('removeFromMyList',m.id),'detail-text-action');
      if(available&&s.seen)personalControls+=action('Rimuovi dai miei Visti',()=>perform('removeSeen',m.id),'detail-text-action');
      if(g.candidacy.effectiveCandidacy)groupControls+=action('Togli dalla Lista N+V',()=>perform('withdrawGroupCandidacy',m.id),'detail-text-action');
      filmControls+=action(m.cinema_watchlist?'Sposta in Streaming':'Sposta al cinema',()=>perform('setCinema',m.id,!m.cinema_watchlist),'detail-text-action');
      const veto=view.getVetoForMovie(m.id).veto;
      if(veto?.person_id===view.context.caller.personId)filmControls+=action('Togli il mio veto',()=>perform('removeVeto',m.id,veto.veto_id),'detail-text-action');
      if(m.surprise_by_person_id===view.context.caller.personId)filmControls+=action('Annulla la mia sorpresa',()=>perform('setSurprise',m.id,false),'detail-text-action');
      const danger=action('Rimuovi film',async()=>{if(await showConfirmModal('Rimuovere il film dal catalogo?','Questa azione è definitiva.'))if(current())perform('deleteContent',m.id);},'detail-danger');
      const main=action(primary.kind==='choose'?'<i class="fa-solid fa-ticket" aria-hidden="true"></i> Guardiamolo':esc(primary.text),async node=>{if(node.disabled)return;const pending=primary.fn();if(!pending?.then)return;node.disabled=true;try{await pending;}finally{if(current()&&node.isConnected)node.disabled=false;}},primary.kind==='choose'?'movie-list-primary':'movie-list-primary detail-primary',{'data-detail-primary':primary.kind,'data-return-focus-key':'detail-primary'});
      const menuGroup=(title,controls,zone)=>(controls||feedbackZone===zone&&feedback)?'<section class="detail-menu-group" data-feedback-zone="'+zone+'"><h5>'+title+'</h5><div class="detail-menu-controls">'+controls+'</div>'+status(zone)+'</section>':'';
      return '<div class="detail-film-relations"><section class="detail-personal-summary" data-feedback-zone="personal-judgment"><h4>Il mio cinema</h4>'+mine+status('personal-judgment')+otherHtml+'</section>'+(shared?'<section class="detail-shared-summary" data-feedback-zone="shared-judgment"><h4>N+V</h4>'+shared+status('shared-judgment')+'</section>':'')+'</div><div class="detail-next-action" data-feedback-zone="primary">'+(primary.kind==='choose'?'<div class="movie-list-actions detail-choice-actions">'+main+secondary+'</div>':main+'<div class="detail-secondary-actions">'+secondary+'</div>')+status('primary')+'</div>'+(g.events.length?'<details class="detail-nights" data-detail-nights><summary>Le serate · '+g.events.length+'</summary>'+eventHistory(m)+'</details>':'')+'<details class="detail-more" data-detail-disclosure="more"><summary>Altre azioni</summary>'+menuGroup('Personali',personalControls,'personal-actions')+menuGroup('N+V',groupControls,'group-actions')+menuGroup('Film',filmControls,'film-actions')+'<div class="detail-danger-area" data-feedback-zone="danger">'+danger+status('danger')+'</div></details>';

    }
    const movieProjection = (m, selectedNight = null) => {const n=selectedNight || active(m.id);return {...m,nightId:n?.id,scheduled_date:n?.date,scheduled_time:n?.time,snack:n?.snack,location:n?.location,night_confirmed:n?.status==='confirmed',proposed_by:n?.proposed_by};};
    const personBadge = code => code ? `<span class="badge badge-${esc(code.toLowerCase())}">${esc(label(code))}</span>`:'';
    function eventActions(n) {
      const args=n.id;let html='';
      if(['proposed','confirmed'].includes(n.status)) {
        if(n.status==='proposed'&&n.proposed_by!==callerLabel)html+=action('Accetta proposta',()=>perform('confirmNight',args),'next-movie-action next-movie-primary');
        if(due(n))html+=action('Completa serata',()=>edit('completeScheduled',args,n),'next-movie-action next-movie-primary');
        html+=action(n.status==='proposed'?(n.proposed_by===callerLabel?'Annulla proposta':'Rifiuta'):'Annulla proiezione',()=>perform('cancelNight',args),'next-movie-action next-movie-secondary');
      }
      if(!['cancelled','skipped'].includes(n.status))html+=action('Snack e luogo',()=>edit('editNight',args,n),'next-movie-action next-movie-secondary');
      return html;
    }
    const ctx={movies,nights,callerLabel,feedback,feedbackZone,tab:destination==='scheduled'?'tonight':'watchlist',view,personBadge,viewingState,
      personalRating:rating,personalPreference:preference,personalState:state,togetherSeen:together,togetherRating,reviewTextFor:review,edit,viewingStatusHtml:(m,o)=>personalCollection&&!hidden(m)?personalStatus(m):viewingStatusHtml(m,o,ctx),
      participated:(m,code)=>view.getCard(m.id).group.events.some(x=>x.event.status==='completed'&&x.participants.some(p=>p.person_id===person(code)?.personId)),
      cardReviewsHtml:m=>personalCollection?personalReview(m):cardReviewsHtml(m,ctx),reviewCardsHtml:m=>reviewCardsHtml(m,ctx),sagaButtonHtml,cardOperationsHtml,detailActions,movieProjection,
      detail,bind,action,eventActions,active,due,hidden,session,token,current,scheduleInitial,activeNights,tonightPick,homeNightPick,
      bindHistory(parent){
        parent.querySelectorAll('[data-history-movie], [data-projection-movie]').forEach(node=>{
          const id=node.dataset.historyMovie||node.dataset.projectionMovie;if(!byId.has(id)||hidden(byId.get(id)))return;
          const heading=node.querySelector('h5, h3');if(heading){const b=document.createElement('button');b.type='button';b.textContent=heading.textContent;b.className='text-left hover:underline';b.setAttribute('aria-haspopup','dialog');b.onclick=()=>{if(current())detail(id,b);};heading.replaceChildren(b);}
          node.onclick=e=>{if(!e.target.closest('button,a,input,select,textarea,details,summary')&&current())detail(id,heading?.querySelector('button')||node);};
        });
      },
      bindCalendar(parent){parent.querySelectorAll('[data-calendar-movie]').forEach(node=>{if(!byId.has(node.dataset.calendarMovie))return;node.tabIndex=0;node.setAttribute('role','button');const open=()=>{if(current())detail(node.dataset.calendarMovie,node);};node.onclick=open;node.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();open();}};});},
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
