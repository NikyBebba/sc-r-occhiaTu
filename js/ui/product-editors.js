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
      el('reviewModalTitle').textContent=together?'Giudizio Insieme':'Valuta il film';
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
      const choosing=action==='quickNight', planning=action==='scheduleNight';
      el('scheduleModalTitle').textContent=completed?'Concludi la serata':action==='editNight'?'Dettagli della serata':planning?'Pianifica la serata':choosing?'Guardiamolo':scheduled?'Programma la proiezione':'Oggi si guarda';
      el('scheduleHint').textContent=completed?'Chi ha partecipato alla visione?':action==='editNight'&&historical?'La data e l’ora di una serata conclusa restano quelle registrate. Puoi modificare snack e luogo.':choosing?'Scegliete questo film per vederlo insieme. Snack e luogo sono facoltativi.':planning?'Scegliete quando vederlo. Snack e luogo sono facoltativi.':initial.selectCandidate?'La scelta proviene dalla Lista del gruppo. Snack e luogo sono facoltativi.':'Snack e luogo sono facoltativi.';
      submit.textContent=choosing?'Conferma la scelta':planning?'Proponi la serata':'Conferma';
      submit.classList.toggle('movie-list-confirm',choosing||planning);
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
  function addCatalog({context,search,detailsById,save,bulk,defaultDestination=null}) {
    const serial=++editorSerial, el=id=>document.getElementById(id);
    let activeModal='addModal', searchRevision=0, selected=null, saving=false, saved=false;
    const current=()=>context.current()&&serial===editorSerial&&!el(activeModal).classList.contains('hidden');
    const verbs={groupList:'Vorrei vederlo insieme',personalSeen:'Aggiungi ai miei Visti'};
    const already={personalList:'Il film è già nei tuoi Da vedere.',groupList:'Il film è già nei Da vedere insieme.',personalSeen:'Il film è già nei miei Visti.'};
    const relation={personalList:'addToMyList',groupList:'proposeToGroup',personalSeen:'recordSeen'};
    const destination=el('targetAddDestination'),pickerDestination=el('targetPickerDestination');
    const message=el('targetAddMessage')||document.createElement('p');
    message.id='targetAddMessage';message.className='text-sm text-slate-300';message.setAttribute('role','status');message.textContent='';
    el('addSaveBtn').parentElement.before(message);
    el('addModalTitle').textContent='Cerca un film';el('addTitle').value='';el('addBy').parentElement.classList.add('hidden');
    el('targetAddDestinationWrap').classList.remove('hidden');destination.value=defaultDestination||'';
    el('addCinemaWatchlist').parentElement.classList.add('hidden');
    const importLink=el('targetImportLink')||el('addModal').querySelector('[onclick*="importModal"]');
    importLink.id='targetImportLink';importLink.classList.remove('hidden');importLink.removeAttribute('onclick');
    el('targetPickerSearchAgain').classList.remove('hidden');el('pickerNoneBtn').classList.add('hidden');
    el('targetPickerSelection').classList.add('hidden');el('pickerModalTitle').textContent='Quale film intendevi?';
    const submit=el('addSaveBtn');submit.textContent='Cerca';submit.disabled=false;
    el('addTitle').oninput=()=>{searchRevision++;submit.disabled=false;message.textContent='';};
    destination.onchange=()=>{if(!el('targetPickerSelection').classList.contains('hidden'))pickerDestination.value=destination.value;};
    const selectedStatus=movie=>{
      if(!movie)return '';
      const card=context.view.getCard(movie.id),person=context.view.personal.getState(context.view.context.caller.personId,movie.id);
      const states=['Già nel catalogo'];
      if(card.group.candidacy.effectiveCandidacy)states.push('Da vedere insieme');
      if(person.kind==='AVAILABLE'&&person.list.active)states.push('nei tuoi Da vedere');
      if(person.kind==='AVAILABLE'&&person.seen)states.push('nei miei Visti');
      return states.join(' · ');
    };
    const updateSelection=()=>{
      const target=pickerDestination.value,commit=el('targetPickerCommit');
      const seen=selected?.movie&&context.view.personal.getState(context.view.context.caller.personId,selected.movie.id).seen===true;
      const label=target==='personalList'?(seen?'Voglio rivederlo':'Voglio vederlo'):verbs[target];
      commit.innerHTML=label?'<i class="fa-solid '+(target==='groupList'?'fa-users':target==='personalList'?'fa-user':'fa-check')+'" aria-hidden="true"></i> '+label:'Scegli una destinazione';
      commit.disabled=!target||saving||saved;
      destination.value=target;
    };
    pickerDestination.onchange=updateSelection;
    const choose=(option,button)=>{
      if(!current()||saving||saved)return;
      selected=option;
      el('pickerResults').querySelectorAll('button').forEach(node=>node.setAttribute('aria-pressed',String(node===button)));
      const movie=option.movie,item=movie||option.candidate;
      el('targetPickerSelectedTitle').textContent=item.title+(item.release_year||item.year?' · '+(item.release_year||item.year):'');
      el('targetPickerSelectedStatus').textContent=selectedStatus(movie);
      el('targetPickerMessage').textContent='';pickerDestination.value=destination.value;
      el('targetPickerSelection').classList.remove('hidden');updateSelection();
      el('targetPickerCommit').focus();
    };
    el('targetPickerCommit').onclick=async()=>{
      const target=pickerDestination.value;if(!current()||!selected||!relation[target]||saving||saved)return;
      saving=true;updateSelection();const status=el('targetPickerMessage');status.textContent='Salvataggio in corso…';
      try{
        const details=selected.movie?{movie_id:selected.movie.id}:await detailsById(selected.candidate.id);
        if(!current())return;
        if(!selected.movie&&(!details||String(details.tmdb_id)!==String(selected.candidate.id)||details.matched!==true||details.title==='Errore'))
          throw new Error('Impossibile identificare questo film. Riprova la ricerca.');
        const result=await save(details,relation[target]);if(!current())return;
        if(!result?.movieId||!['SUCCESS','ALREADY_IN_TARGET_STATE'].includes(result.relation?.outcome))
          throw new Error('Aggiunta non completata. Attendi il riallineamento prima di riprovare.');
        saved=true;
        if(result.relation.outcome==='ALREADY_IN_TARGET_STATE')status.textContent=already[target];
        else {status.textContent='';closeModal('pickerModal');}
      }catch(error){if(current())status.textContent=error.message||'Aggiunta non completata. Riprova.';}
      finally{saving=false;if(current())updateSelection();}
    };
    el('targetPickerSearchAgain').onclick=()=>{
      if(!current()||saving)return;closeModal('pickerModal');activeModal='addModal';
      selected=null;saved=false;submit.disabled=false;el('targetPickerSelection').classList.add('hidden');openModal('addModal');el('addTitle').focus();
    };
    submit.onclick=async()=>{
      const title=el('addTitle').value.trim();if(!current()||submit.disabled||!title)return;
      const revision=++searchRevision;submit.disabled=true;message.textContent='Cerco i film…';
      try{
        const candidates=await search(title,{strict:true});
        if(!current()||revision!==searchRevision||el('addTitle').value.trim()!==title)return;
        const known=context.movies.filter(movie=>!context.hidden(movie));
        const options=[],seen=new Set();
        for(const movie of known.filter(movie=>movie.title.toLocaleLowerCase('it').includes(title.toLocaleLowerCase('it')))){
          options.push({movie});seen.add(movie.id);
        }
        for(const candidate of candidates){
          const movie=known.find(row=>row.tmdb_id!=null&&row.tmdb_id===String(candidate.id));
          if(movie){if(!seen.has(movie.id)){options.push({movie});seen.add(movie.id);}}
          else options.push({candidate});
        }
        if(!options.length){message.textContent='Nessun film trovato. Prova un altro titolo.';return;}
        const box=el('pickerResults');box.replaceChildren();
        for(const option of options){
          const item=option.movie||option.candidate,choice=document.createElement('button');
          choice.type='button';choice.className='target-add-choice picker-card text-left glass-card rounded-xl p-3';
          choice.setAttribute('aria-pressed','false');
          const poster=document.createElement('span');poster.className='target-add-poster';
          if(item.poster){const image=document.createElement('img');image.src=item.poster;image.alt='';image.loading='lazy';poster.appendChild(image);}
          else poster.textContent='🎬';
          const caption=document.createElement('span'),name=document.createElement('strong'),year=document.createElement('small'),state=document.createElement('small');
          name.textContent=item.title;year.textContent=item.release_year||item.year||'Anno non disponibile';
          state.textContent=selectedStatus(option.movie);caption.appendChild(name);caption.appendChild(year);caption.appendChild(state);
          choice.appendChild(poster);choice.appendChild(caption);
          choice.onclick=()=>choose(option,choice);box.appendChild(choice);
        }
        selected=null;saved=false;el('targetPickerSelection').classList.add('hidden');
        closeModal('addModal');activeModal='pickerModal';openModal('pickerModal');box.querySelector('button')?.focus();
      }catch(_){if(current()&&revision===searchRevision)message.textContent='Ricerca non disponibile. Controlla la connessione e riprova.';}
      finally{if(current()&&revision===searchRevision)submit.disabled=false;}
    };
    importLink.onclick=()=>{
      if(!current())return;
      const target=destination.value;if(!relation[target]){message.textContent='Scegli prima dove aggiungere i film.';destination.focus();return;}
      activeModal='importModal';closeModal('addModal');openModal('importModal');
      el('importAddedBy').parentElement.classList.add('hidden');const importSubmit=el('importSaveBtn');importSubmit.disabled=false;
      importSubmit.onclick=async()=>{if(!current()||importSubmit.disabled)return;importSubmit.disabled=true;
        try{await bulk(el('importText').value.split('\n').map(t=>t.trim()).filter(Boolean),relation[target]);if(current())closeModal('importModal');}
        finally{if(current())importSubmit.disabled=false;}};
    };
    openModal('addModal');el('addTitle').focus();
  }
  function refreshMetadata({context,session,movieId,detailsById,perform}) {
    const serial=++editorSerial, el=id=>document.getElementById(id), modal='metadataRefreshModal';
    const current=()=>context.current()&&serial===editorSerial&&!el(modal).classList.contains('hidden');
    const original=context.view.catalog.getContent(movieId);
    if(original.kind!=='AVAILABLE'||!original.content.tmdb_id)return;
    const sourceId=String(original.content.tmdb_id),changes=el('metadataRefreshChanges'),status=el('metadataRefreshStatus');
    const apply=el('metadataRefreshApply'),retry=el('metadataRefreshRetry');
    const labels={title:'Titolo',poster:'Locandina',overview:'Trama',cast_names:'Cast',release_year:'Anno',duration:'Durata',
      director:'Regia',genres:'Generi',platform:'Piattaforma',trailer_url:'Trailer',collection_id:'Saga',collection_name:'Nome saga',
      imdb_rating:'IMDb',rt_rating:'Rotten Tomatoes',metacritic_rating:'Metacritic',matched:'Identificazione'};
    const values={title:'title',poster:'poster',overview:'overview',cast_names:'cast_names',release_year:'release_year',
      duration:'duration',director:'director',genres:'genres',platform:'platform',trailer_url:'trailerUrl',
      collection_id:'collection_id',collection_name:'collection_name',imdb_rating:'imdbRating',
      rt_rating:'rtRating',metacritic_rating:'metacriticRating',matched:'matched'};
    const equal=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
    const format=(key,value)=>{
      if(value===null||value===undefined||value==='')return 'non disponibile';
      if(key==='poster'||key==='trailer_url')return 'disponibile';
      if(key==='matched')return value?'identificato':'da verificare';
      const text=Array.isArray(value)?value.join(', '):String(value);
      return text.length>130?text.slice(0,127)+'…':text;
    };
    const candidate=(key,value,before)=>{
      if(key==='matched')return value===true&&before!==true?true:null;
      if(key==='release_year')return Number.isInteger(value)&&value>1800&&value<2200?value:null;
      if(key==='collection_id')return (typeof value==='number'&&Number.isSafeInteger(value)&&value>0)||(typeof value==='string'&&/^\d+$/.test(value))?String(value):null;
      if(key==='genres'||key==='cast_names')return Array.isArray(value)&&value.length&&value.every(item=>typeof item==='string'&&item.trim())?value:null;
      if(typeof value!=='string'||!value.trim()||value==='Errore')return null;
      if(key==='platform'&&value==='Streaming'&&before&&before!=='Streaming')return null;
      return value.trim();
    };
    let revision=0,preview=null,busy=false;
    const latest=()=>session.getState().view;
    const sameFilm=()=>{const view=latest();if(view.kind!=='AVAILABLE')return null;
      const found=view.catalog.getContent(movieId);return found.kind==='AVAILABLE'&&String(found.content.tmdb_id)===sourceId?found.content:null;};
    function stale(message){preview=null;apply.classList.add('hidden');retry.classList.remove('hidden');status.textContent=message;}
    async function loadPreview(){
      const request=++revision;preview=null;changes.replaceChildren();apply.classList.add('hidden');retry.classList.add('hidden');
      status.textContent='Recupero le informazioni dello stesso film…';
      try{
        const details=await detailsById(sourceId);if(!current()||request!==revision)return;
        if(!details||String(details.tmdb_id)!==sourceId||details.matched!==true||!details.title||details.title==='Errore')
          throw new Error('TMDb non ha restituito dati coerenti per questo film. Nessuna modifica effettuata.');
        const movie=sameFilm();if(!movie){stale('Il film è cambiato. Riapri la scheda prima di aggiornare.');return;}
        const patch={},before={};
        for(const [key,from]of Object.entries(values)){
          const old=key==='matched'?movie.metadata_matched:movie[key];
          const value=candidate(key,details[from],old);
          if(value===null||equal(value,old))continue;
          patch[key]=value;before[key]=old??null;
          const row=document.createElement('div'),name=document.createElement('strong'),difference=document.createElement('p');
          row.className='rounded-lg border border-slate-700/70 p-2 text-sm';
          name.className='text-slate-100';name.textContent=labels[key];
          difference.className='mt-1 text-slate-300 break-words';difference.textContent=format(key,old)+' → '+format(key,value);
          row.appendChild(name);row.appendChild(difference);changes.appendChild(row);
        }
        if(!Object.keys(patch).length){status.textContent='Le informazioni sono già aggiornate. Nessuna modifica necessaria.';return;}
        preview={patch,before};status.textContent='Controlla le modifiche prima di applicarle.';
        apply.classList.remove('hidden');
      }catch(error){if(current()&&request===revision)stale(error.message?.startsWith('TMDb non ha restituito')
        ?error.message:'TMDb non disponibile. Nessuna modifica effettuata. Riprova più tardi.');}
    }
    apply.onclick=async()=>{
      if(!current()||!preview||busy)return;
      const movie=sameFilm();
      if(!movie||Object.keys(preview.patch).some(key=>!equal(key==='matched'?movie.metadata_matched:movie[key],preview.before[key]))){
        stale('Le informazioni sono cambiate. Aggiorna l’anteprima prima di applicare.');return;
      }
      busy=true;apply.disabled=true;status.textContent='Applico gli aggiornamenti…';
      try{
        const result=await perform('updateMetadata',movieId,preview.patch);if(!current())return;
        if(['SUCCESS','ALREADY_IN_TARGET_STATE'].includes(result?.outcome)){
          preview=null;apply.classList.add('hidden');el('metadataRefreshCancel').textContent='Chiudi';
          status.textContent=result.outcome==='SUCCESS'?'Informazioni aggiornate da TMDb.':'Informazioni già aggiornate.';
        }else stale('Aggiornamento non completato. I dati potrebbero essere cambiati: aggiorna l’anteprima.');
      }catch(_){if(current())stale('Aggiornamento non riuscito. Aggiorna l’anteprima prima di riprovare.');}
      finally{busy=false;if(current())apply.disabled=false;}
    };
    retry.onclick=()=>{if(current()&&!busy)loadPreview();};
    el('metadataRefreshTitle').textContent=original.content.title;
    el('metadataRefreshCancel').textContent='Annulla';
    openModal(modal);loadPreview();
  }
  function catalog({context,session,lookup,detailsById,search,save,bulk,initial=null,label,retrospective=false}) {
    const serial=++editorSerial, el=id=>document.getElementById(id);let activeModal='addModal';
    const current=()=>context.current()&&serial===editorSerial&&!el(activeModal).classList.contains('hidden');
    el('targetAddDestinationWrap').classList.add('hidden');el('targetPickerSelection').classList.add('hidden');
    el('targetPickerSearchAgain').classList.add('hidden');
    const importLink=el('targetImportLink')||el('addModal').querySelector('[onclick*="importModal"]');
    importLink.classList.toggle('hidden',retrospective);
    el('addCinemaWatchlist').parentElement.classList.toggle('hidden',retrospective);
    if(retrospective){
      el('addModalTitle').textContent=label;el('addTitle').value='';el('addBy').parentElement.classList.add('hidden');
      const submit=el('addSaveBtn');submit.disabled=false;let busy=false;
      const message=el('targetAddMessage')||document.createElement('p');message.id='targetAddMessage';message.className='text-sm text-slate-300';message.setAttribute('role','status');
      message.textContent='Registra un film già visto da te. Liste, giudizio e serate insieme restano come sono.';submit.parentElement.before(message);
      submit.onclick=async()=>{
        const title=el('addTitle').value.trim();if(!current()||submit.disabled||!title)return;submit.disabled=true;
        try{
          const known=context.movies.filter(m=>!context.hidden(m)&&m.title.toLocaleLowerCase('it').includes(title.toLocaleLowerCase('it')));
          let candidates=[],sourceFailed=false;try{candidates=await search(title);}catch(_){sourceFailed=true;}
          if(!current())return;
          const options=[...known.map(movie=>({movie})),...candidates.filter(c=>!known.some(m=>m.tmdb_id===String(c.id))).map(candidate=>({candidate}))];
          if(!options.length){message.textContent=sourceFailed?'Ricerca non disponibile. Riprova più tardi.':'Nessun film trovato. Prova un altro titolo.';return;}
          const box=el('pickerResults');box.replaceChildren();
          const status=document.createElement('p');status.className='col-span-full text-sm text-slate-300';status.setAttribute('role','status');box.appendChild(status);
          el('pickerNoneBtn').classList.add('hidden');
          for(const option of options){
            const item=option.movie||option.candidate,choice=document.createElement('button');choice.type='button';choice.className='personal-seen-choice picker-card text-left glass-card rounded-xl p-3';
            if(item.poster){const img=document.createElement('img');img.src=item.poster;img.alt='';choice.appendChild(img);}
            const caption=document.createElement('span'),name=document.createElement('strong'),hint=document.createElement('small');name.textContent=item.title+((item.release_year||item.year)?' · '+(item.release_year||item.year):'');hint.textContent='Aggiungi ai miei Visti';caption.append(name,hint);choice.appendChild(caption);
            choice.onclick=async()=>{
              if(!current()||busy)return;busy=true;box.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='Salvataggio nei tuoi Visti…';
              try{
                const details=option.movie?{movie_id:item.id}:await detailsById(item.id);if(!current()||el('pickerModal').classList.contains('hidden'))return;
                const done=await save(details);if(!current())return;
                if(done){closeModal('pickerModal');closeModal('addModal');}
                else status.textContent='Aggiunta non completata. Attendi il riallineamento prima di riprovare.';
              }catch(_){if(current())status.textContent='Aggiunta non completata. Riprova più tardi.';}
              finally{busy=false;if(current())box.querySelectorAll('button').forEach(b=>b.disabled=false);}
            };box.appendChild(choice);
          }
          openModal('pickerModal');box.querySelector('button')?.focus();
        }finally{if(current())submit.disabled=false;}
      };
      openModal('addModal');el('addTitle').focus();return;
    }
    el('pickerNoneBtn').classList.remove('hidden');
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
  return Object.freeze({open,catalog,addCatalog,refreshMetadata,refresh:context=>refreshReview?.(context)});
})();
