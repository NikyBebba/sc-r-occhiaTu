'use strict';
// Presentation dependencies for the existing product components. This is not a
// Store: the captured TARGET view is the only source, callbacks the only writer.
const ProductContext = (() => {
  const esc = value => escapeHtml(String(value ?? ''));
  function create({ view, session, destination, perform, edit, detail, openSaga, ticket, isCurrent = () => true }) {
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
    const homeNightPick=()=>tonightPick()||pick(activeNights().filter(n=>n.date&&!due(n)).sort((a,b)=>(a.date+(a.time||'')).localeCompare(b.date+(b.time||'')))[0]);
    const callbacks = new Map();let serial=0;
    function action(text, fn, classes='min-h-11 px-3 py-2 rounded-lg bg-slate-800 text-slate-200 text-sm',attributes={}) {
      const id='product-'+(++serial);callbacks.set(id,fn);
      return `<button type="button" data-product-action="${id}" class="${classes}" ${Object.entries(attributes).map(([k,v])=>`${k}="${esc(v)}"`).join(' ')}>${text}</button>`;
    }
    function bind(parent) {
      parent.querySelectorAll('[data-product-action]').forEach(node=>{
        const fn=callbacks.get(node.dataset.productAction);node.onclick=e=>{e.stopPropagation();if(current()&&fn)fn(node);};
      });
      // The reusable product template's surprise controls get TARGET callbacks.
      parent.querySelectorAll('[onclick^="revealSurpriseUI"]').forEach(node=>{node.removeAttribute('onclick');node.onclick=e=>{e.stopPropagation();if(current())perform('setSurprise',node.closest('[data-movie-id]').dataset.movieId,false);};});
    }
    const viewingState = m => ({N:state(m,'N').kind==='AVAILABLE'?state(m,'N').seen:null,V:state(m,'V').kind==='AVAILABLE'?state(m,'V').seen:null,together:together(m)});
    const sagaButtonHtml = m => !hidden(m)&&m.collection_id?action('<i class="fa-solid fa-layer-group" aria-hidden="true"></i> Continua la saga',()=>openSaga(m.id),'saga-entry'):'';
    function personalActions(m) {
      const own=view.context.observedPerson.personId===view.context.caller.personId,s=state(m,callerLabel);
      if(destination==='personalList')return own?action('Rimuovi dalla mia Lista',()=>perform('removeFromMyList',m.id)):s.list?.active?'<span class="text-xs text-slate-400">Già nella mia Lista</span>':action('Anche nella mia Lista',()=>perform('addToMyList',m.id));
      if(destination==='personalSeen'&&!own&&s.seen!==true)return action('L’ho visto anch’io',()=>perform('recordSeen',m.id));
      return '';
    }
    const scheduleInitial = m => view.getCard(m.id).group.candidacy.effectiveCandidacy ? {selectCandidate:true,selectionView:view} : {};
    const scheduleActions = m => action('Oggi',()=>edit('quickNight',m.id,scheduleInitial(m)),'flex-1 min-h-11 px-3 py-2 bg-indigo-600/20 text-indigo-300 rounded')+action('Programma',()=>edit('scheduleNight',m.id,scheduleInitial(m)),'flex-1 min-h-11 px-3 py-2 bg-slate-800 rounded text-slate-300');
    function cardOperationsHtml(m) {
      if(hidden(m))return '';
      let primary=personalActions(m),programming='',management='';
      if(destination==='scheduled')return projectionInfoHtml(m,ctx);
      if(['groupList','rewatch'].includes(destination))programming=`<div class="flex gap-2">${scheduleActions(m)}</div>`;
      if(destination==='rewatch'&&!view.getCard(m.id).group.candidacy.effectiveCandidacy)primary+=action('Proponi al gruppo',()=>perform('proposeToGroup',m.id));
      if(['personalList','personalSeen','together'].includes(destination))management+=action('Proponi al gruppo',()=>perform('proposeToGroup',m.id));
      if(destination==='personalSeen'&&view.context.observedPerson.personId===view.context.caller.personId)management+=action('Rimuovi dai miei Visti',()=>perform('removeSeen',m.id));
      if(m.matched===false)management+=action('Correggi titolo e ricerca di nuovo',()=>edit('updateMetadata',m.id));
      if(view.getCard(m.id).group.candidacy.effectiveCandidacy)management+=action('Ritira candidatura',()=>perform('withdrawGroupCandidacy',m.id));
      return primary+`<div class="movie-card-sections pt-2 border-t border-slate-800/80 text-xs">${cardSectionHtml('Programmazione',programming)}${cardSectionHtml('Gestione',management)}</div>`;
    }
    function eventHistory(m) {
      return view.getCard(m.id).group.events.map(item=>{
        const n=nights.find(n=>n.id===item.event.night_id);
        const date=n.status==='completed'?completedNightLabel({night:n,timelineDate:nightTimelineDate(n)}):formatNightDate(n.date,n.time);
        const participants=item.participants.map(p=>view.getIdentity(p.person_id).label||'Partecipante').join(', ');
        return `<div class="projection-card-info" data-night-id="${esc(n.id)}"><p>${esc(date)}</p>${n.snack?`<p>🍿 ${esc(n.snack)}</p>`:''}${n.location?`<p>${esc(n.location)}</p>`:''}${participants?`<p>${esc(participants)}</p>`:''}<div class="projection-actions">${eventActions(n)}</div></div>`;
      }).join('');
    }
    function detailActions(m) {
      if(hidden(m))return '';
      const s=state(m,callerLabel),g=view.getCard(m.id).group;
      let mine=action(s.list?.active?'Rimuovi dalla mia Lista':'Nella mia Lista',()=>perform(s.list?.active?'removeFromMyList':'addToMyList',m.id));
      mine+=s.seen?action('Nuova visione personale',()=>perform('recordPersonalViewing',m.id)):action('L’ho visto anch’io',()=>perform('recordSeen',m.id));
      mine+=action('Il mio giudizio',()=>edit('setMyEvaluation',m.id,s.judgment));
      const group=action(g.candidacy.effectiveCandidacy?'Ritira candidatura':'Proponi al gruppo',()=>perform(g.candidacy.effectiveCandidacy?'withdrawGroupCandidacy':'proposeToGroup',m.id));
      const veto=view.getVetoForMovie(m.id).veto;
      const vetoAction=veto?(veto.person_id===view.context.caller.personId?action('Togli il veto',()=>perform('removeVeto',m.id,veto.veto_id)):''):action('Vieta questa settimana',()=>perform('addVeto',m.id));
      return `<section class="detail-section"><h4>Il mio percorso</h4><div class="flex gap-2 flex-wrap">${mine}</div></section><section class="detail-section"><h4>Il gruppo</h4><div class="flex gap-2 flex-wrap">${group}${scheduleActions(m)}${together(m)?action('Modifica voto N+V',()=>edit('setGroupEvaluation',m.id,groupJudgment(m))):''}${action('Visto insieme ora',()=>edit('completeNow',m.id))}</div></section>`+cardSectionHtml('Serate',eventHistory(m))+cardSectionHtml('Gestione',vetoAction+action(m.cinema_watchlist?'Sposta in Streaming':'Sposta al cinema',()=>perform('setCinema',m.id,!m.cinema_watchlist))+action(m.surprise_by_person_id?'Annulla sorpresa':'Sorpresa',()=>perform('setSurprise',m.id,!m.surprise_by_person_id))+action('Correggi metadati',()=>edit('updateMetadata',m.id))+action('Elimina film',async()=>{if(await showConfirmModal('Rimuovere il film dal catalogo?','Questa azione è definitiva.'))if(current())perform('deleteContent',m.id);}));
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
    const ctx={movies,nights,callerLabel,tab:destination==='scheduled'?'tonight':'watchlist',view,personBadge,viewingState,
      personalRating:rating,personalPreference:preference,personalState:state,togetherSeen:together,togetherRating,reviewTextFor:review,edit,viewingStatusHtml:(m,o)=>viewingStatusHtml(m,o,ctx),
      participated:(m,code)=>view.getCard(m.id).group.events.some(x=>x.event.status==='completed'&&x.participants.some(p=>p.person_id===person(code)?.personId)),
      cardReviewsHtml:m=>cardReviewsHtml(m,ctx),reviewCardsHtml:m=>reviewCardsHtml(m,ctx),sagaButtonHtml,cardOperationsHtml,detailActions,movieProjection,
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
