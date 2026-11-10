'use strict';
// CAP-1 presentation. All writes go through the online TARGET action surface.
const Cap1Nights = (() => {
  const historyAutocomplete=typeof HistoryAutocomplete!=='undefined'?HistoryAutocomplete:(typeof require==='function'?require('./history-autocomplete.js'):null);
  const esc = value => escapeHtml(String(value ?? ''));
  const rankHistorySuggestions=(nights,field,query)=>historyAutocomplete.rank(nights,field,query);
  function create({root=document,session,context,perform,waitFor}) {
    const el=id=>root.getElementById(id);
    let selectedMovieId=null, detailNightId=null, pending=false, formEpoch=0;
    let ratingTouched=false,reviewTouched=false,selectedReview='',editState=null;
    const postWatchShown=new Set(),editOperations=new Map();
    const state=()=>session.getState();
    const ready=()=>{const s=state();return s.phase==='READY'&&s.view.kind==='AVAILABLE'&&
      s.view.context.contractVersion===2&&s.view.freshness.source==='ONLINE'&&s.runtime?.source==='ONLINE';};
    const personIds=()=>context().view.getRecommendationInput().input.users.map(p=>p.id);
    const movie=id=>context().getMovie(id);
    const completed=id=>context().nights.filter(n=>n.movie_id===id&&n.status==='completed');
    function bindAutocomplete(prefix,field){const name=field[0].toUpperCase()+field.slice(1);historyAutocomplete.bind(el(prefix+name),el(prefix+name+'Suggestions'),field,()=>context().nights);}
    function dateLabel(raw) {
      if(!raw)return null;
      const [year,month,day]=raw.split('-').map(Number);
      const date=new Date(year,month-1,day);
      return date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day
        ? date.toLocaleDateString('it-IT',{day:'numeric',month:'long',year:'numeric'}):null;
    }
    const poster=m=>m?.poster?`<img src="${esc(m.poster)}" alt="Locandina di ${esc(m.title)}" loading="lazy">`:
      '<i class="fa-solid fa-film" aria-hidden="true"></i>';
    function showError(id,message,retry) {
      const box=el(id);box.replaceChildren();box.textContent=message;box.classList.remove('hidden');
      if(retry){const button=root.createElement('button');button.type='button';button.className='cap1-secondary mt-2 block';button.textContent='Riprova la stessa operazione';button.onclick=retry;box.appendChild(button);}
    }
    function clearError(id){const box=el(id);box.textContent='';box.classList.add('hidden');}
    function setUnknown(prefix) {
      const checked=el(prefix+'Unknown').checked,date=el(prefix+'Date');
      if(checked)date.value='';date.disabled=checked;
    }
    function count(prefix){el(prefix+'Count').textContent=[...el(prefix+'Memory').value].length+'/1000';}
    function validDate(prefix) {
      if(el(prefix+'Unknown').checked)return null;
      const raw=el(prefix+'Date').value;
      if(!raw)throw Error('Indica una data oppure seleziona «Non ricordo la data».');
      if(!dateLabel(raw)||raw>context().view.context.temporal.local_date)throw Error('Scegli una data reale, non futura.');
      return raw;
    }
    function fields(prefix) {
      const memory=el(prefix+'Memory').value;
      if([...memory].length>1000)throw Error('Il ricordo può contenere al massimo 1.000 caratteri.');
      return {date:validDate(prefix),location:el(prefix+'Location').value.trim()||null,
        snack:el(prefix+'Snack').value.trim()||null,nightMemory:memory.trim()||null};
    }
    function filmPreview(m) {return poster(m)+'<span><strong>'+esc(m.title)+'</strong><small>'+esc(m.release_year||'Anno non disponibile')+'</small></span>';}
    function duplicates() {
      const box=el('pastNightDuplicates'),entries=selectedMovieId?completed(selectedMovieId):[];
      box.classList.toggle('hidden',!entries.length);
      box.textContent=entries.length?'Già registrate '+entries.length+' visioni di questo film: '+entries.slice(0,3)
        .map(n=>dateLabel(n.date)||'data non registrata').join(' · ')+(entries.length>3?' · …':'')+'. Puoi aggiungerne un’altra.':'';
    }
    function renderSearch() {
      const term=el('pastNightSearch').value.trim().toLocaleLowerCase('it'),box=el('pastNightResults');box.replaceChildren();
      if(!term){box.textContent='Cerca un film già presente nel catalogo.';return;}
      const hits=context().movies.filter(m=>!context().hidden(m)&&[m.title,m.release_year].join(' ').toLocaleLowerCase('it').includes(term)).slice(0,20);
      if(!hits.length){box.textContent='Nessun film trovato nel catalogo.';return;}
      for(const m of hits){const button=root.createElement('button');button.type='button';button.setAttribute('role','option');button.setAttribute('aria-selected',String(m.id===selectedMovieId));
        button.innerHTML=filmPreview(m);button.onclick=()=>{selectedMovieId=m.id;el('pastNightSelected').innerHTML=filmPreview(m);el('pastNightSelected').classList.remove('hidden');box.replaceChildren();el('pastNightSearch').value='';duplicates();renderEvaluation();el('pastNightDate').focus();};box.appendChild(button);}
    }
    function openRegistration() {
      if(!ready())return;
      formEpoch++;selectedMovieId=null;pending=false;
      el('pastNightEvaluation').open=false;el('pastNightDetails').open=true;
      for(const id of ['pastNightSearch','pastNightDate','pastNightLocation','pastNightSnack','pastNightMemory'])el(id).value='';
      el('pastNightUnknown').checked=false;setUnknown('pastNight');count('pastNight');clearError('pastNightError');
      el('pastNightDate').max=context().view.context.temporal.local_date;
      el('pastNightSelected').classList.add('hidden');el('pastNightDuplicates').classList.add('hidden');
      el('pastNightPeople').textContent=personIds().map(id=>context().view.getIdentity(id).label).join(' e ')+' · partecipano entrambi';
      el('pastNightSearch').oninput=renderSearch;el('pastNightUnknown').onchange=()=>setUnknown('pastNight');
      el('pastNightTogetherRating').oninput=()=>{ratingTouched=true;};
      el('pastNightTogetherReview').oninput=()=>{reviewTouched=true;};
      bindAutocomplete('pastNight','location');bindAutocomplete('pastNight','snack');
      el('pastNightMemory').oninput=()=>count('pastNight');el('pastNightSave').onclick=()=>saveRegistration();
      renderEvaluation();
      el('pastNightSave').disabled=false;renderSearch();openModal('pastNightModal');el('pastNightSearch').focus();
    }
    async function saveRegistration(retryHandle=null) {
      if(pending||!ready()||!selectedMovieId)return;
      const epoch=formEpoch,token=session.capture(),save=el('pastNightSave');
      let input;
      try{
        input=fields('pastNight');input.participants=personIds();
        const evaluation={};
        if(ratingTouched){const raw=el('pastNightTogetherRating').value.trim();const rating=raw===''?null:parseMovieRating(raw);
          if(raw!==''&&rating===null)throw Error('Inserisci un voto da 0 a 10, con un decimale.');
          evaluation.rating=rating;
        }
        if(reviewTouched){const review=el('pastNightTogetherReview').value;
          evaluation.review=review===''&&selectedReview!==''?null:review;
        }
        if(Object.keys(evaluation).length)input.evaluation=evaluation;
        clearError('pastNightError');
      }
      catch(error){showError('pastNightError',error.message);return;}
      pending=true;save.disabled=true;
      let result;
      try{result=retryHandle?await perform('retry',retryHandle):await perform('recordPastTogether',selectedMovieId,input);}
      finally{if(epoch===formEpoch){pending=false;save.disabled=false;}}
      if(epoch!==formEpoch||!session.current(token))return;
      if(result.outcome!=='SUCCESS'){
        showError('pastNightError',result.outcome==='STALE'?'I dati sono cambiati. Riapri il ricordo e riprova.':
          result.outcome==='TRANSPORT_UNCERTAIN'?'Esito da verificare. Riprova la stessa operazione.':'Non siamo riusciti a registrare la serata.',
          result.retryHandle?()=>saveRegistration(result.retryHandle):null);return;
      }
      const nightId=result.result?.night_id;
      closeModal('pastNightModal');
      if(nightId){await session.requestRefresh();if(await waitFor(token,v=>v.getEvent(nightId).kind==='AVAILABLE'))openNight(nightId);}
    }
    function night(id) {
      const found=context().view.getEvent(id);
      if(found.kind!=='AVAILABLE')return null;
      const event=found.event.event,participants=found.event.participants;
      return {...event,id:event.night_id,participants};
    }
    function timing(n) {
      if(n.retrospective)return n.date?'Visione del '+dateLabel(n.date):'Data della visione non ricordata';
      if(['proposed','confirmed'].includes(n.status))return n.date?'Programmato per '+formatNightDate(n.date,n.time):'Data da scegliere';
      if(n.status==='completed')return completedNightLabel({night:n,timelineDate:nightTimelineDate(n)});
      return n.date?formatNightDate(n.date,n.time):'Data non indicata';
    }
    function renderDetail() {
      if(!detailNightId||el('nightDetailModal').classList.contains('hidden'))return;
      const n=night(detailNightId),body=el('nightDetailBody');
      if(!n){closeModal('nightDetailModal');return;}
      const ctx=context(),m=movie(n.movie_id),hidden=m&&ctx.hidden(m);
      const names=n.participants.map(p=>ctx.view.getIdentity(p.person_id).label||'Partecipante').join(', ');
      const status={proposed:'Proposta in attesa',confirmed:'Confermata',completed:'Conclusa',cancelled:'Annullata',skipped:'Non effettuata'}[n.status];
      body.innerHTML='<div class="cap1-film">'+(hidden?'':poster(m))+'<span><strong>'+esc(hidden?'Film a sorpresa':m?.title||'Film non disponibile')+'</strong><small>'+esc(hidden?'':m?.release_year||'')+'</small></span></div>'+
        '<dl class="cap1-night-facts"><div><dt>Stato</dt><dd>'+esc(status)+'</dd></div><div><dt>Quando</dt><dd>'+esc(timing(n))+'</dd></div>'+
        '<div><dt>Partecipanti</dt><dd><i class="fa-solid fa-users-round" aria-hidden="true"></i> '+esc(names||'Non indicati')+'</dd></div>'+
        (n.location?'<div><dt>Luogo</dt><dd>'+esc(n.location)+'</dd></div>':'')+(n.snack?'<div><dt>Snack</dt><dd>'+esc(n.snack)+'</dd></div>':'')+
        (n.night_memory?'<div><dt>Ricordo della serata</dt><dd class="cap1-night-memory">'+esc(n.night_memory)+'</dd></div>':n.status==='completed'?'<div><dt>Ricordo della serata</dt><dd class="cap1-hint">'+'Aggiungi un ricordo da Modifica serata.'+'</dd></div>':'')+'</dl>'+
        (n.status==='completed'&&ready()?'<button id="nightDetailEdit" type="button" class="cap1-secondary">Modifica serata</button>':
          !n.retrospective?'<div class="cap1-actions">'+ctx.eventActions(n)+'</div>':'');
      ctx.bind(body);
      const edit=el('nightDetailEdit');if(edit)edit.onclick=()=>openEdit(n.id);
    }
    function openNight(id) {
      if(state().view.kind!=='AVAILABLE'||!night(id))return;
      detailNightId=id;openModal('nightDetailModal');renderDetail();el('nightDetailModal').querySelector('.cap1-close')?.focus({preventScroll:true});
    }
    function openEdit(id,{postWatch=false}={}) {
      const n=night(id);if(!ready()||n?.status!=='completed')return;
      formEpoch++;const existing=editOperations.get(id);
      const retained=existing&&['PENDING','UNCERTAIN'].includes(existing.status)?existing:null;if(!retained)editOperations.delete(id);
      editState={nightId:id,initial:n,operation:retained};
      el('pastEditTitle').textContent=postWatch?"Com’è andata?":'Modifica serata';el('pastEditCancel').textContent=postWatch?'Più tardi':'Annulla';
      el('pastEditTiming').textContent=timing(n);
      el('pastEditDate').value=n.date||'';el('pastEditUnknown').checked=!n.date;setUnknown('pastEdit');
      el('pastEditDate').disabled=!n.retrospective||!n.date;el('pastEditUnknown').disabled=!n.retrospective;
      el('pastEditDate').max=context().view.context.temporal.local_date;
      el('pastEditLocation').value=n.location||'';el('pastEditSnack').value=n.snack||'';el('pastEditMemory').value=n.night_memory||'';
      el('pastEditMemory').disabled=false;
      el('pastEditMemoryHint').textContent='Il ricordo riguarda questa serata. Voto e recensione Together riguardano il film.';
      for(const field of ['pastEditLocation','pastEditSnack','pastEditTogetherRating','pastEditTogetherReview'])el(field).disabled=false;
      el('pastEditEvaluation').open=postWatch;
      renderEvaluation('pastEdit',n.movie_id);
      el('pastEditTogetherRating').oninput=()=>{ratingTouched=true;};el('pastEditTogetherReview').oninput=()=>{reviewTouched=true;};
      count('pastEdit');clearError('pastEditError');el('pastEditSave').disabled=false;
      bindAutocomplete('pastEdit','location');bindAutocomplete('pastEdit','snack');
      el('pastEditUnknown').onchange=()=>setUnknown('pastEdit');el('pastEditMemory').oninput=()=>count('pastEdit');
      el('pastEditSave').onclick=()=>saveEdit(id);if(retained)paintEditOperation(retained);openModal('pastNightEditModal');if(postWatch){el('pastEditTitle').focus({preventScroll:true});el('pastNightEditModal').querySelector('.cap1-panel').scrollTop=0;}else el('pastEditLocation').focus();
    }
    function openPostWatch(id) {
      if(!ready()||night(id)?.status!=='completed'||postWatchShown.has(id))return;
      postWatchShown.add(id);openNight(id);openEdit(id,{postWatch:true});
    }
    function renderEvaluation(prefix='pastNight',id=selectedMovieId){const m=id&&movie(id),ctx=m&&context(),rating=m?ctx.togetherRating(m):null;
      ratingTouched=false;reviewTouched=false;selectedReview=m?ctx.reviewTextFor(m,'both'):'';
      el(prefix+'TogetherRating').value=rating==null?'':formatMovieRating(rating);
      el(prefix+'TogetherReview').value=selectedReview;
    }
    function paintEditOperation(op) {
      if(editState?.operation!==op)return;
      for(const field of ['pastEditDate','pastEditUnknown','pastEditLocation','pastEditSnack','pastEditMemory','pastEditTogetherRating','pastEditTogetherReview'])el(field).disabled=true;
      el('pastEditSave').disabled=true;
      if(op.status==='PENDING'){showError('pastEditError','Salvataggio in corso…');return;}
      showError('pastEditError',op.status==='UNCERTAIN'?'Esito da verificare. Le operazioni già confermate non saranno ripetute.':op.status==='STALE'?'I dati sono cambiati. Riapri la serata prima di modificarli.':'Salvataggio non completato. Le modifiche già confermate restano salvate.',op.retryHandle?()=>saveEdit(op.nightId,true):null);
    }
    async function saveEdit(id,retry=false) {
      if(!ready()||editState?.nightId!==id||editState.operation?.status==='PENDING')return;
      const token=session.capture(),save=el('pastEditSave'),n=night(id);
      if(n?.status!=='completed')return;
      try {
        if(!editState.operation){
          const initial=editState.initial,patch={};
          for(const field of ['location','snack']){const value=el('pastEdit'+field[0].toUpperCase()+field.slice(1)).value.trim()||null;if(value!==(initial[field]||null))patch[field]=value;}
          const memory=el('pastEditMemory').value.trim()||null;
          if(memory!==(initial.night_memory||null)){if([...(memory||'')].length>1000)throw Error('Il ricordo può contenere al massimo 1.000 caratteri.');patch.nightMemory=memory;}
          if(n.retrospective){const date=validDate('pastEdit');if(date!==initial.date)patch.date=date;}
          const evaluation={};
          if(ratingTouched){const raw=el('pastEditTogetherRating').value.trim(),rating=raw===''?null:parseMovieRating(raw);if(raw!==''&&rating===null)throw Error('Inserisci un voto da 0 a 10, con un decimale.');evaluation.rating=rating;}
          if(reviewTouched){const review=el('pastEditTogetherReview').value;evaluation.review=review===''&&selectedReview!==''?null:review;}
          const steps=[];if(Object.keys(patch).length)steps.push({action:'editPastTogether',id,input:patch});
          if(Object.keys(evaluation).length)steps.push({action:'setGroupEvaluation',id:n.movie_id,input:evaluation});
          editState.operation={nightId:id,steps,index:0,retryHandle:null,status:'IDLE'};editOperations.set(id,editState.operation);
        }
        const op=editState.operation;
        if(op.status==='UNCERTAIN'&&(!retry||!op.retryHandle))return;
        clearError('pastEditError');op.status='PENDING';paintEditOperation(op);
        while(op.index<op.steps.length){
          const step=op.steps[op.index];let result;
          try{result=op.retryHandle?await perform('retry',op.retryHandle):await perform(step.action,step.id,step.input);}catch(_){result={outcome:'TRANSPORT_UNCERTAIN'};}
          if(!session.current(token))return;
          if(!['SUCCESS','ALREADY_IN_TARGET_STATE'].includes(result.outcome)){
            op.retryHandle=result.retryHandle||null;op.status=result.outcome==='TRANSPORT_UNCERTAIN'||result.outcome==='ERROR'&&!result.error?'UNCERTAIN':result.outcome;
            paintEditOperation(op);return;
          }
          op.retryHandle=null;op.index++;
        }
        op.status='SUCCESS';editOperations.delete(id);
        if(editState?.operation===op)closeModal('pastNightEditModal');
        await session.requestRefresh();if(session.current(token))renderDetail();
      }catch(error){showError('pastEditError',error.message);save.disabled=false;}
    }
    function refresh() {
      historyAutocomplete.refreshAll();
      const entry=el('addPastNight');entry.classList.toggle('hidden',!ready());entry.onclick=()=>openRegistration();
      if(!ready())for(const id of ['pastNightModal','pastNightEditModal'])if(!el(id).classList.contains('hidden'))closeModal(id);
      renderDetail();if(!el('pastNightModal').classList.contains('hidden')&&selectedMovieId)duplicates();
    }
    function dispose(){formEpoch++;pending=false;editOperations.clear();detailNightId=null;selectedMovieId=null;for(const id of ['pastNightEditModal','pastNightModal','nightDetailModal'])if(!el(id).classList.contains('hidden'))closeModal(id);}
    return Object.freeze({ready,refresh,openRegistration,openNight,openEdit,openPostWatch,dispose});
  }
  return Object.freeze({create,rankHistorySuggestions});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=Cap1Nights;
