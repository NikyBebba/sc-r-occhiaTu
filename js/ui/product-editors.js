'use strict';
// Binds the existing product dialogs to captured TARGET callbacks only.
const ProductEditors = (() => {
  let refreshReview = null, editorSerial = 0;
  function open({action,id,initial={},context,perform,session,onMatchScheduled}) {
    const serial=++editorSerial, el=id=>document.getElementById(id);
    const current=()=>context.current()&&serial===editorSerial;
    refreshReview = null;
    const isEvaluation=['setMyEvaluation','setGroupEvaluation'].includes(action);
    const modal=isEvaluation?'reviewModal':'scheduleModal';
    const error=el(isEvaluation?'reviewError':'scheduleSaveError');error.classList.add('hidden');
    const submit=el(isEvaluation?'reviewSaveButton':'scheduleConfirm');submit.disabled=false;
    let save;
    if(isEvaluation) {
      const together=action==='setGroupEvaluation', before={rating:initial?.rating??null,review:initial?.review??null,preference:initial?.preference??null};
      el('reviewModalTitle').textContent=together?'Il giudizio N+V':'Il mio giudizio';
      el('reviewMovieTitle').textContent=context.getMovie(id)?.title||'';
      el('reviewRating').required=false;el('reviewRating').value=before.rating===null?'':formatMovieRating(before.rating);
      el('reviewText').value=before.review??'';el('reviewLocationWrap').classList.add('hidden');
      const box=el('reviewRatingJudgment');box.replaceChildren();box.classList.toggle('hidden',together);
      const draft={id,initialRating:before.rating,preference:before.preference,ratingTouched:false};
      if(!together)bindPersonalJudgment('reviewRating',draft,context.getMovie(id),context);
      let reviewTouched=false;
      el('reviewText').oninput=()=>{reviewTouched=true;};
      if(together)el('reviewRating').oninput=()=>{draft.ratingTouched=true;};
      refreshReview=latest=>{
        if(el('reviewModal').classList.contains('hidden')||!current()){refreshReview=null;return;}
        const movie=latest.getMovie(id);if(!movie){closeModal('reviewModal');refreshReview=null;return;}
        const judgment=together?latest.view.getCard(id).group.judgment.judgment:latest.view.getCard(id).personal.caller.judgment;
        const rating=judgment?.rating??null;
        if(draft.preferenceTouched&&rating!==null){error.textContent='Il voto è cambiato. Riapri il giudizio per modificarlo.';error.classList.remove('hidden');submit.disabled=true;return;}
        if(!draft.ratingTouched){before.rating=rating;draft.initialRating=rating;el('reviewRating').value=rating===null?'':formatMovieRating(rating);}
        if(!draft.preferenceTouched&&!draft.ratingTouched){before.preference=judgment?.preference??null;draft.preference=before.preference;}
        if(!reviewTouched){before.review=judgment?.review??null;el('reviewText').value=before.review??'';}
        draft.presentation=latest;
        if(!together)syncDraftPersonalJudgment('reviewRating',submit.disabled);
      };
      submit.textContent='Salva';
      save=()=>{
        const text=el('reviewRating').value.trim().replace(',','.');
        if(text!==''&&(!/^(?:\d|10)(?:\.\d)?$/.test(text)||Number(text)>10))throw Error('Inserisci un voto da 0 a 10, con un decimale.');
        const patch={},rating=text===''?null:Number(text),review=el('reviewText').value;
        if(rating!==before.rating)patch.rating=rating;
        if(review!==(before.review??''))patch.review=review;
        if(!together&&draft.preferenceTouched&&rating===null)patch.preference=draft.preference;
        return Object.keys(patch).length?perform(action,id,patch):Promise.resolve({outcome:'ALREADY_IN_TARGET_STATE'});
      };
    } else {
      const completed=['completeNow','completeScheduled'].includes(action), historical=initial.status==='completed';
      const scheduled=action==='scheduleNight'||action==='scheduleMatch'||action==='editNight'&&!historical&&initial.date!==null&&initial.date!==undefined;
      el('scheduleModalTitle').textContent=completed?'Concludi la serata':action==='editNight'?'Dettagli della serata':scheduled?'Programma la proiezione':'Oggi si guarda';
      el('scheduleHint').textContent=completed?'Chi ha partecipato alla visione?':initial.selectCandidate?'La scelta proviene dalla Lista del gruppo. Snack e luogo sono facoltativi.':'Snack e luogo sono facoltativi.';
      el('scheduleDateField').classList.toggle('hidden',!scheduled);el('scheduleTimeField').classList.toggle('hidden',!scheduled);
      el('scheduleDate').value=initial.date??'';el('scheduleTime').value=initial.time?.slice(0,5)??'';
      const snacks=el('scheduleSnack');if(![...snacks.options].some(o=>o.value===''))snacks.add(new Option('Nessuno snack',''),0);
      if(initial.snack&&![...snacks.options].some(o=>o.value===initial.snack))snacks.add(new Option(initial.snack,initial.snack),snacks.options.length-1);
      snacks.value=initial.snack??'';el('scheduleCustomSnack').value='';el('scheduleCustomSnack').classList.add('hidden');el('scheduleLocation').value=initial.location??'';
      el('targetParticipants')?.remove();
      if(completed){const fieldset=document.createElement('fieldset');fieldset.id='targetParticipants';fieldset.innerHTML='<legend class="text-sm text-slate-200">Partecipanti</legend>';
        for(const p of context.view.getRecommendationInput().input.users){const identity=context.view.getIdentity(p.id),label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=p.id;input.className='mr-2';label.className='inline-flex items-center min-h-11 mr-4 text-sm';label.append(input,document.createTextNode(identity.label||'Partecipante'));fieldset.appendChild(label);}submit.parentElement.before(fieldset);}
      save=async()=>{
        const snack=snacks.value==='__custom_snack__'?el('scheduleCustomSnack').value.trim():snacks.value;
        if(snacks.value==='__custom_snack__'&&!snack)throw Error('Scrivi lo snack oppure scegli Nessuno snack.');
        const params={snack:snack||null,location:el('scheduleLocation').value.trim()||null};
        if(initial.selectCandidate){if(initial.selectionView!==session.getState().view)throw Error('La Lista è cambiata. Riapri la programmazione.');params.selectCandidate=true;}
        if(scheduled){if(!el('scheduleDate').value)throw Error('Scegli la data della proiezione.');params.date=el('scheduleDate').value;params.time=el('scheduleTime').value||null;}
        if(action==='editNight')for(const key of Object.keys(params))if((params[key]??null)===(key==='time'?initial.time?.slice(0,5)??null:initial[key]??null))delete params[key];
        if(completed){params.participants=[...el('targetParticipants').querySelectorAll('input:checked')].map(x=>x.value);if(!params.participants.length)throw Error('Indica almeno un partecipante.');}
        if(action==='scheduleMatch'||action==='quickMatch'){
          const result=await session.scheduleMatchedMovie(id,params,action==='quickMatch'?'quick':'schedule');
          if(current())onMatchScheduled(result);return result.actionResult;
        }
        return perform(action,id,params);
      };
    }
    submit.onclick=async()=>{
      if(!current()||submit.disabled)return;submit.disabled=true;
      try{const result=await save();if(!current())return;
        if(['SUCCESS','ALREADY_IN_TARGET_STATE'].includes(result?.outcome))closeModal(modal);
        else {error.textContent='Operazione non completata. Attendi il riallineamento prima di riprovare.';error.classList.remove('hidden');}
      }catch(e){if(current()){error.textContent=e.message;error.classList.remove('hidden');}}
      finally{if(current())submit.disabled=false;}
    };
    openModal(modal);el(isEvaluation?'reviewRating':'scheduleSnack').focus();
  }
  function catalog({context,session,lookup,detailsById,search,save,bulk,initial=null,label}) {
    const serial=++editorSerial, el=id=>document.getElementById(id);let activeModal='addModal';
    const current=()=>context.current()&&serial===editorSerial&&!el(activeModal).classList.contains('hidden');
    const button=el('addSaveBtn');button.disabled=false;el('addTitle').value=initial?.title??'';el('addModalTitle').textContent=label;
    el('addBy').parentElement.classList.add('hidden');
    const message=document.getElementById('targetAddMessage')||document.createElement('p');message.id='targetAddMessage';message.className='text-sm text-slate-300';message.textContent='';button.parentElement.before(message);
    el('addCinemaWatchlist').checked=initial?.cinema_watchlist===true;
    const finish=async details=>{if(!current())return;const result=await save({...details,cinema_watchlist:el('addCinemaWatchlist').checked||details.cinema_watchlist===true});if(!current())return;if(result){closeModal('pickerModal');closeModal('addModal');}else message.textContent='Salvataggio non completato. Attendi il riallineamento.';};
    button.onclick=async()=>{
      if(!current()||button.disabled||!el('addTitle').value.trim())return;button.disabled=true;
      try{const title=el('addTitle').value.trim(),candidates=await search(title);if(!current())return;
        if(!candidates.length){await finish(await lookup(title));return;}
        const box=el('pickerResults');box.replaceChildren();
        for(const candidate of candidates){const choice=document.createElement('button');choice.className='picker-card text-left glass-card rounded-xl p-3';choice.type='button';choice.textContent=candidate.title+(candidate.year?' · '+candidate.year:'');choice.onclick=async()=>{if(!current()||choice.disabled)return;choice.disabled=true;try{await finish(await detailsById(candidate.id));}catch(_){message.textContent='Ricerca non disponibile.';}finally{if(current())choice.disabled=false;}};box.appendChild(choice);}
        el('pickerNoneBtn').onclick=()=>{if(current())finish({title});};openModal('pickerModal');
      }catch(_){if(current())message.textContent='Ricerca non disponibile. Riprova più tardi.';}finally{if(current())button.disabled=false;}
    };
    const bulkLink=el('targetImportLink')||el('addModal').querySelector('[onclick*="importModal"]');bulkLink.id='targetImportLink';bulkLink.removeAttribute('onclick');bulkLink.onclick=()=>{
      if(!current())return;activeModal='importModal';closeModal('addModal');openModal('importModal');
      el('importAddedBy').parentElement.classList.add('hidden');el('importSaveBtn').disabled=false;
      el('importSaveBtn').onclick=async()=>{const b=el('importSaveBtn');if(!current()||b.disabled)return;b.disabled=true;try{await bulk(el('importText').value.split('\n').map(t=>t.trim()).filter(Boolean));if(current())closeModal('importModal');}finally{if(current())b.disabled=false;}};
    };
    openModal('addModal');el('addTitle').focus();
  }
  return Object.freeze({open,catalog,refresh:context=>refreshReview?.(context)});
})();
