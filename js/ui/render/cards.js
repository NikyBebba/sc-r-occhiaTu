// Card della libreria e frammenti condivisi con dettaglio, storico e form.
// Dipende da store/viewing, modals, sagas e dalle azioni proiezione.

// Chip generi reali della card: massimo 3, dedup, null-safe, sempre escapati.
// Un film senza generi (o con value corrotto) non mostra chip: mai "undefined".
function genreChips(m) {
  const gs = Array.isArray(m && m.genres) ? m.genres : [];
  const uniq = [];
  gs.forEach(g => { if (g && typeof g === 'string' && uniq.indexOf(g) === -1) uniq.push(g); });
  return uniq.slice(0, 3).map(g =>
    `<span class="px-1.5 py-0.5 bg-slate-800/80 border border-slate-700/60 rounded text-[10px] text-slate-300">${escapeHtml(g)}</span>`
  ).join('');
}

function externalRatingsHtml(m, showEmpty = false) {
  if (showEmpty) return `<div class="rating-holo flex gap-2 external-ratings mt-1 px-2 py-1 rounded text-[10px] text-slate-400">
    <span><i class="fa-solid fa-star text-amber-400" aria-hidden="true"></i> IMDb ${m.imdb_rating ? escapeHtml(m.imdb_rating) : 'n.d.'}</span>
    <span class="text-rose-400">RT ${m.rt_rating ? escapeHtml(m.rt_rating) : 'n.d.'}</span>
    <span class="text-emerald-400">MC ${m.metacritic_rating ? escapeHtml(m.metacritic_rating) : 'n.d.'}</span>
  </div>`;
  if (!m.imdb_rating && !m.rt_rating && !m.metacritic_rating) return '';
  return `<div class="rating-holo flex gap-2 external-ratings mt-1 px-2 py-1 rounded text-[10px] text-slate-400">
    ${m.imdb_rating ? `<span><i class="fa-solid fa-star text-amber-400" aria-hidden="true"></i> IMDb ${escapeHtml(m.imdb_rating)}</span>` : ''}
    ${m.rt_rating ? `<span class="text-rose-400">RT ${escapeHtml(m.rt_rating)}</span>` : ''}
    ${m.metacritic_rating ? `<span class="text-emerald-400">MC ${escapeHtml(m.metacritic_rating)}</span>` : ''}
  </div>`;
}

function sharedPeopleLabel() {
  return ['N', 'V'].map(person => CONFIG.PEOPLE[person]?.label || person).join('+');
}

function sharedVoteButtonHtml(movie) {
  if (movie.surprise_by && movie.surprise_by !== currentUser) return '';
  const label = (reviewTextFor(movie, 'both') || togetherRating(movie) !== null) ? 'Modifica voto' : 'Vota';
  return `<button onclick="addReview('${jsAttrEscape(movie.id)}')" class="shared-vote-action w-full min-h-11 px-3 py-2 rounded-lg font-medium">${label} ${escapeHtml(sharedPeopleLabel())}</button>`;
}

function judgmentValueHtml(judgment, empty = 'Valuta') {
  if (judgment?.rating !== null && judgment?.rating !== undefined) return '<i class="fa-solid fa-star" aria-hidden="true"></i> '+formatMovieRating(judgment.rating)+'/10';
  if (judgment?.preference === true) return '<i class="fa-solid fa-thumbs-up" aria-hidden="true"></i><span class="sr-only">Mi è piaciuto</span>';
  if (judgment?.preference === false) return '<i class="fa-solid fa-thumbs-down" aria-hidden="true"></i><span class="sr-only">Non mi è piaciuto</span>';
  return escapeHtml(empty);
}

function judgmentIdentityHtml(name, together = false) {
  return '<span class="judgment-identity'+(together?' is-together':'')+'">'+escapeHtml(name)+'</span>';
}

// One judgment slot: quantitative rating or manual preference, never both.
function personalJudgmentSlotHtml(movie, person, context = null, { allowPrompt = true } = {}) {
  if (context ? context.hidden(movie) : movie.surprise_by && movie.surprise_by !== (context ? context.callerLabel : currentUser)) return '';
  const name=context?context.personLabel(person):person;
  if (context && context.personalState(movie,person).kind !== 'AVAILABLE') return '';
  const rating = (context ? context.personalRating : personalRating)(movie, person), value = (context ? context.personalPreference : personalPreference)(movie, person);
  const classes = 'viewing-score viewing-score-' + (context?context.personTone(person):person.toLowerCase());
  const editable = context ? context.isCaller(person) : person === currentUser;
  const hasReview=!!(context ? context.reviewTextFor : reviewTextFor)(movie, person);
  const eligible = (context ? context.viewingState : viewingState)(movie)[person] || (context ? context.togetherSeen : togetherSeen)(movie) || hasReview;
  const prompt=editable&&allowPrompt&&(context?context.shouldPromptPersonal(movie):eligible);
  if (rating === null && value === null && !prompt && !hasReview) return '';
  const state = rating !== null ? 'rating' : value === true ? 'like' : value === false ? 'dislike' : 'unknown';
  const content = (editable?'':judgmentIdentityHtml(name))+'<span class="judgment-value">'+judgmentValueHtml({rating,preference:value},editable?'Valuta':'Recensione')+'</span>';
  const description = rating !== null ? `voto ${formatMovieRating(rating)}/10` : value === true ? 'Mi è piaciuto' : value === false ? 'Non mi è piaciuto' : hasReview ? 'recensione senza voto' : 'non ancora espresso';
  const label = `${state === 'unknown' ? 'Valuta' : 'Modifica il giudizio di'} ${name}: ${description} · ${movie.title}`;
  if (context && editable) return context.action(content,()=>context.edit('setMyEvaluation',movie.id,context.personalState(movie,person).judgment),classes+' personal-judgment-slot'+(state==='unknown'?' is-unknown':''),{'data-judgment':state,'data-judgment-movie':movie.id,'data-judgment-context':person,'aria-label':label,'aria-haspopup':'dialog'});
  return editable
    ? `<button type="button" class="${classes} personal-judgment-slot${state === 'unknown' ? ' is-unknown' : ''}" data-judgment="${state}" data-judgment-movie="${escapeHtml(movie.id)}" data-judgment-context="${person}" aria-label="${escapeHtml(label)}" aria-haspopup="dialog" onclick="addPersonalReview('${jsAttrEscape(movie.id)}', this)">${content}</button>`
    : `<span class="${classes}" data-judgment="${state}" data-judgment-context="${person}" aria-label="${escapeHtml(`${name}: ${description} · ${movie.title}`)}">${content}</span>`;
}
function togetherJudgmentSlotHtml(movie, context = null) {
  if (!(context ? context.callerPresent : ['N','V'].includes(currentUser)) || (context ? context.hidden(movie) : movie.surprise_by && movie.surprise_by !== currentUser)) return '';
  const completed = (context ? context.togetherSeen : togetherSeen)(movie);
  if (!completed && (context ? !context.due(context.active(movie.id)) : !nightIsDue(activeNightForMovie(movie.id)))) return '';
  const rating = completed ? (context ? context.togetherRating : togetherRating)(movie) : null;
  const label = rating !== null || (context ? context.reviewTextFor : reviewTextFor)(movie,'both') ? 'Modifica' : 'Aggiungi';
  const content = rating !== null
    ? judgmentIdentityHtml('Insieme',true)+'<span class="judgment-value">'+judgmentValueHtml({rating})+'</span>'
    : '<span class="judgment-value">Valuta insieme</span>';
  if (context) return context.action(content,()=>context.edit('setGroupEvaluation',movie.id,context.view.getCard(movie.id).group.judgment.judgment),'viewing-score viewing-score-together personal-judgment-slot',{'data-judgment':rating!==null?'rating':'unknown','data-judgment-context':'both','data-judgment-movie':movie.id,'aria-label':label+' il giudizio Insieme','aria-haspopup':'dialog'});
  return `<button type="button" class="viewing-score viewing-score-together personal-judgment-slot" data-judgment="${rating !== null ? 'rating' : 'unknown'}" data-judgment-movie="${escapeHtml(movie.id)}" data-judgment-context="both" aria-label="${label} il giudizio Insieme · ${escapeHtml(movie.title)}" aria-haspopup="dialog" onclick="addReview('${jsAttrEscape(movie.id)}', this)">${content}</button>`;
}

// TARGET: the personal face reports Seen and Judgment. A completed Together
// replaces those faces with one shared gold surface, without changing data.
function targetPersonalTokenHtml(movie, key, context) {
  const state=context.personalState(movie,key), identity=context.personLabel(key);
  if(state.kind!=='AVAILABLE')return '';
  const own=context.isCaller(key), seen=state.seen===true, judgment=state.judgment||{};
  const hasJudgment=judgment.rating!=null||judgment.preference!=null||!!judgment.review;
  const value=judgment.rating!=null?'<i class="fa-solid fa-star" aria-hidden="true"></i> '+formatMovieRating(judgment.rating)
    :judgment.preference===true?'<i class="fa-solid fa-thumbs-up" aria-hidden="true"></i>'
    :judgment.preference===false?'<i class="fa-solid fa-thumbs-down" aria-hidden="true"></i>':'';
  const initial=Array.from(identity||key)[0]||'•';
  const content='<span class="person-token-face"><span class="person-token-initial">'+escapeHtml(initial)+'</span>'+(value?'<span class="person-token-value">'+value+'</span>':'')+'</span>';
  const classes='person-token person-token-'+context.personTone(key)+(seen?' is-seen':' is-outline')+(value?' has-value':'')+(judgment.rating!=null?' has-rating':judgment.preference!=null?' has-preference':'');
  const spoken=identity+': '+(seen?'visto personalmente':'non registrato nei Visti')+(judgment.rating!=null?', voto '+formatMovieRating(judgment.rating):judgment.preference===true?', gradimento positivo':judgment.preference===false?', gradimento negativo':'');
  if(own)return context.action(content,node=>context.openPersonalStatus(movie.id,node),classes,
    {'aria-label':'Apri il tuo Visto e giudizio · '+movie.title,'aria-description':spoken,'aria-haspopup':'dialog'});
  if(hasJudgment)return context.action(content,node=>context.openOtherJudgment(movie.id,key,node),classes,
    {'aria-label':'Leggi il giudizio di '+identity+' · '+movie.title,'aria-description':spoken,'aria-haspopup':'dialog'});
  return '<span class="'+classes+'" aria-label="'+escapeHtml(spoken)+'">'+content+'</span>';
}
function targetViewingStatusHtml(movie, context) {
  const keys=context.judgmentPeople, tokens=keys.map(key=>targetPersonalTokenHtml(movie,key,context)).filter(Boolean);
  const together=context.togetherSeen(movie);
  const star=together?context.action('<i class="fa-solid fa-users" aria-hidden="true"></i>'+(context.togetherRating(movie)!=null?'<span class="together-rating"><i class="fa-solid fa-star" aria-hidden="true"></i> '+formatMovieRating(context.togetherRating(movie))+'</span>':''),
    node=>context.openTogether(movie.id,node),'together-star',{'aria-label':'Apri Insieme e le serate di '+movie.title,'aria-haspopup':'dialog'}):'';
  const middle=Math.ceil(tokens.length/2), content=together?[...tokens.slice(0,middle),star,...tokens.slice(middle)].join(''):tokens.join('');
  return '<div class="personal-tokens'+(together?' together-cluster':'')+'" role="group" aria-label="'+escapeHtml(together?'Visti personali e visioni insieme':'Visti e giudizi personali')+'">'+content+'</div>';
}

function viewingStatusHtml(movie, { showRatings = true, includeTogether = true, promptPersonal = true } = {}, context = null) {
  if (context && context.hidden(movie)) return '';
  if (context) return targetViewingStatusHtml(movie,context);
  const seen = (context ? context.viewingState : viewingState)(movie);
  const label = context ? 'Visti personali e visioni insieme del gruppo' : seen.together ? 'Visto insieme da N e V'
    : seen.N && seen.V ? 'Visto separatamente da N e V'
    : seen.N ? 'Visto da N' : seen.V ? 'Visto da V' : 'Non ancora visto';
  // Together colora entrambi i badge originali, senza cambiare i fatti personali.
  const person = key => {
    const name=context?context.personLabel(key):key, mark=key.length<=2?key:(Array.from(name)[0]||'•');
    return `<span class="viewing-person viewing-person-${key.toLowerCase()}${(context ? context.participated(movie,key) : seen.together) ? ' is-together' : seen[key] ? ' is-seen' : ''}" aria-label="${escapeHtml(name+': '+(seen[key] === null ? 'dato non disponibile' : seen[key] ? 'visto personalmente' : 'non segnato come visto')+((context ? context.participated(movie,key) : seen.together)?'; ha partecipato a una visione insieme':''))}">${escapeHtml(mark)}</span>`;
  };
  const scores = (context ? context.judgmentPeople : ['N', 'V']).map(key => personalJudgmentSlotHtml(movie, key, context, {allowPrompt:promptPersonal})).filter(Boolean);
  const shared = includeTogether ? togetherJudgmentSlotHtml(movie, context) : '';
  if (shared) scores.push(shared);
  return `<div class="viewing-status" role="group" aria-label="${label}"><span class="viewing-label" aria-hidden="true">Visto da</span>${(context?context.judgmentPeople:['N','V']).map(person).join('')}</div>${showRatings && scores.length ? `<div class="viewing-scores" aria-label="Giudizi del film">${scores.join('')}</div>` : ''}`;
}

function reviewCardsHtml(movie, context = null) {
  if (context && context.hidden(movie)) return '';
  return ['N', 'V', 'both'].map(person => {
    const text = (context ? context.reviewTextFor : reviewTextFor)(movie, person);
    if (!text) return '';
    const label = person === 'both' ? 'Insieme' : context ? context.personLabel(person) : person;
    const score = person === 'both' ? (context ? context.togetherRating : togetherRating)(movie) : (context ? context.personalRating : personalRating)(movie, person);
    return `<div class="mt-2 p-2.5 bg-slate-900/80 rounded-lg border border-slate-800 text-xs text-slate-300">
      <span class="text-[11px] font-bold text-indigo-300">Recensione ${escapeHtml(label)}${score !== null ? ` · ★ ${formatMovieRating(score)}/10` : ''}</span>
      <p class="italic mt-1">“${escapeHtml(text)}”</p>
    </div>`;
  }).join('');
}

// Disclosure locale alla card: i form e le guardie dati restano quelli esistenti.
function cardSectionHtml(label, content, summary = '') {
  if (!content.trim()) return '';
  return `<details class="movie-card-section"><summary>${label.startsWith('Recension')?'<i class="fa-regular fa-comment" aria-hidden="true"></i>':''}<span>${label}</span>${summary ? `<span class="movie-card-summary">${escapeHtml(summary)}</span>` : ''}<i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary><div class="movie-card-section-body card-action-row">${content}</div></details>`;
}

function cardReviewsHtml(movie, context = null) {
  if (context && context.hidden(movie)) return '';
  const reviews = (context ? context.judgmentPeople : ['N', 'V', 'both']).filter(person => (context ? context.reviewTextFor : reviewTextFor)(movie, person));
  return cardSectionHtml(reviews.length === 1 ? 'Recensione' : `Recensioni · ${reviews.length}`, reviews.map(person => {
    const label = person === 'both' ? 'Insieme' : context ? context.personLabel(person) : person;
    const score = person === 'both' ? (context ? context.togetherRating : togetherRating)(movie) : (context ? context.personalRating : personalRating)(movie, person);
    return `<div class="movie-card-review"><span class="text-[11px] font-bold text-indigo-300">Recensione ${escapeHtml(label)}${score !== null ? ` · ★ ${formatMovieRating(score)}${context?'':'/10'}` : ''}</span><p class="movie-card-review-text is-clamped">“${escapeHtml((context ? context.reviewTextFor : reviewTextFor)(movie, person))}”</p><button type="button" class="movie-card-review-toggle" aria-expanded="false" hidden>Mostra altro<span class="sr-only"> · Recensione ${escapeHtml(label)}</span></button></div>`;
  }).join(''));
}

function cardEvaluationsHtml(movie, projection) {
  if (movie.surprise_by && movie.surprise_by !== currentUser) return '';
  // The complete inline editors replace pencils/personal bins. Together removal
  // remains here because the shared form still requires a valid rating to save.
  if (!togetherSeen(movie) || (togetherRating(movie) === null && !reviewTextFor(movie,'both'))) return '';
  const label = sharedPeopleLabel();
  return `<div class="movie-card-management-group"><h4>Valutazioni</h4><div class="movie-card-evaluation-row" data-evaluation-context="both"><span class="auth-person-initial movie-card-evaluation-badge is-shared" aria-label="Valutazione ${escapeHtml(label)}">${escapeHtml(label)}</span><div><button type="button" onclick="removeEvaluationUI('${jsAttrEscape(movie.id)}', 'both')" class="movie-card-icon-action movie-card-evaluation-remove" aria-label="Rimuovi voto o recensione ${escapeHtml(label)}" title="Rimuovi voto o recensione ${escapeHtml(label)}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button></div></div></div>`;
}

// Il veto resta raggiungibile dalla scheda grande, con le condizioni originali.
function detailVetoActionHtml(movie) {
  if ((movie.surprise_by && movie.surprise_by !== currentUser) || !normalListEligible(movie)) return '';
  const id = jsAttrEscape(movie.id), veto = vetoForMovieThisWeek(movie.id);
  if (veto) return veto.person === currentUser ? `<button onclick="unvetoMovie('${id}')" class="min-h-11 px-3 py-2 rounded-lg text-rose-300 bg-rose-900/50">Togli il veto</button>` : '';
  return `<button onclick="vetoMovie('${id}', '${jsAttrEscape(movie.title)}')" class="min-h-11 px-3 py-2 rounded-lg text-slate-300 bg-slate-800">Vieta questa settimana</button>`;
}

function cardOperationsHtml(m, projection, isSurpriseHidden) {
  const eligible = m.status === 'watchlist' || projection.nightId || m.status === 'watched';
  const id = jsAttrEscape(m.id);
  const title = jsAttrEscape(m.title);
  let programming = '', management = '';
  if (eligible) {
    if (!isSurpriseHidden) {
      management += personalWatchButtonHtml(m) + `<div class="movie-card-management-group"><h4>Lista</h4>${rewatchActionsHtml(m, { compact: true })}</div>`;
      if (!projection.nightId || isRewatch(m)) {
        programming += `<div class="flex gap-2"><button onclick="quickTonightUI('${id}')" class="flex-1 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 rounded font-medium">Oggi</button><button onclick="scheduleMovie('${id}')" aria-label="Programma la serata" class="flex-1 px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded">Programma</button></div>
          <button onclick="toggleCinemaWatchlist('${id}')" class="w-full min-h-9 px-2 py-1.5 text-xs text-amber-200 hover:text-amber-100 underline">${m.cinema_watchlist ? 'Sposta in Streaming' : 'Sposta al cinema / prossimamente'}</button>`;
      }
    }
    if (projection.nightId) {
      programming += projectionInfoHtml(m) + (nightIsDue(activeNightForMovie(m.id)) ? `<button onclick="finishTogetherNightUI('${id}', '${jsAttrEscape(projection.nightId)}')" class="min-h-11 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 rounded font-medium">Completa serata</button>` : '');
    }
    management += cardEvaluationsHtml(m, projection);
  }
  if (m.matched === false) management += `<button onclick="retryMatch('${id}', '${title}')" class="text-amber-400 hover:text-amber-300 underline">Correggi titolo e ricerca di nuovo</button>`;
  management += `<button onclick="deleteMovieConfirm('${id}', '${title}')" class="movie-card-delete min-h-11 text-rose-400 hover:text-rose-300 rounded-lg"><i class="fa-solid fa-trash" aria-hidden="true"></i> Rimuovi film</button>`;
  const summary = projection.nightId ? formatNightDate(projection.scheduled_date, projection.scheduled_time) : '';
  return `<div class="movie-card-sections pt-2 border-t border-slate-800/80 text-xs">${cardSectionHtml('Programmazione', programming, summary)}${cardSectionHtml('Gestione', `<div class="movie-card-management">${management}</div>`)}</div>`;
}

// Native details/summary gestiscono tastiera e stato aperto senza handler per ogni CTA.
function bindCardDisclosure(card) {
  const sections = card.querySelectorAll?.('.movie-card-section') || [];
  sections.forEach(section => section.addEventListener('toggle', () => {
    if (!section.open) return;
    sections.forEach(other => { if (other !== section) other.open = false; });
    section.querySelectorAll('.movie-card-review').forEach(review => {
      const text = review.querySelector('p');
      const button = review.querySelector('button');
      if (button.getAttribute('aria-expanded') !== 'true') button.hidden = text.scrollHeight <= text.clientHeight + 1;
    });
  }));
  card.querySelectorAll?.('.movie-card-review-toggle').forEach(button => button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(expanded));
    button.previousElementSibling.classList.toggle('is-clamped', !expanded);
    button.firstChild.textContent = expanded ? 'Mostra meno' : 'Mostra altro';
  }));
}

// ---- Il Nostro Cinema — una card per ogni serata completata, anche rewatch.
// Nessun timbro d'origine: il ticket PNG non viene conservato nel database. ----
// Costruzione della card e binding del dettaglio; il coordinatore la inserisce nella griglia.
function createMovieCard(m, vetoedIds, context = null) {
    const projection = (context ? context.movieProjection : movieProjection)(m);
    const isSurpriseHidden = context ? context.hidden(m) : m.surprise_by && m.surprise_by !== currentUser;
    const poster = m.poster || 'https://via.placeholder.com/300x450/1e293b/64748b?text=No+Cover';
    const isVetoed = vetoedIds.includes(m.id);
    // Meta-blocco "{anno} • {durata}" (step 5b): anno e durata includono
    // SOLO valori non-null, mai un "•" isolato.
    const metaParts = [m.cinema_watchlist ? 'Al cinema / prossimamente' : (m.platform || 'Streaming')];
    if (m.release_year) metaParts.push(String(m.release_year));
    if (m.duration) metaParts.push(m.duration);
    const genres = !isSurpriseHidden ? genreChips(m) : '';
    const contextTags =
      (!context&&m.cinema_watchlist?'<span class="badge bg-amber-600/80">🎬 Al cinema / prossimamente</span>':'')+
      (projection.nightId&&(context?context.tab:currentTab)==='all'?'<span class="badge bg-sky-700/90">in programma</span>':'')+
      (projection.nightId&&(context?context.tab:currentTab)==='tonight'?'<span class="badge bg-indigo-600/90"><i class="fa-regular fa-clock"></i> '+escapeHtml(formatNightDate(projection.scheduled_date,projection.scheduled_time))+'</span>':'');
    const cardTags = genres + contextTags;
    const directorHtml = !isSurpriseHidden && m.director ? (context
      ? `<div class="card-director mt-1 text-[10px] text-slate-400" title="${escapeHtml(m.director)}"><i class="fa-solid fa-user mr-1" aria-hidden="true"></i>${escapeHtml(m.director)}</div>`
      : `<div class="mt-1 text-[10px] text-slate-400 truncate" title="${escapeHtml(m.director)}"><i class="fa-solid fa-user mr-1"></i>${escapeHtml(m.director)}</div>`) : '';
    const genresHtml = genres ? `<div class="card-genres flex items-center gap-2 mt-1 flex-wrap">${genres}</div>` : '';
    const contextTagsHtml = contextTags ? `<div class="card-context-tags flex items-center gap-2 mt-1 flex-wrap">${contextTags}</div>` : '';
    const ratingsHtml = isSurpriseHidden ? '' : externalRatingsHtml(m,!!context);
    const card = document.createElement('div');
    card.className = "movie-ticket flex flex-col" + (context ? ' is-target-card collection-' + context.destination : ' justify-between') + (m.cinema_watchlist ? ' is-cinema-ticket' : '') + (isVetoed ? ' card-vetoed' : '');

    card.innerHTML = `
      <div class="card-poster relative h-48 bg-slate-900 overflow-hidden">
        <img loading="lazy" decoding="async" src="${escapeHtml(poster)}" alt="${isSurpriseHidden ? 'Film a sorpresa' : escapeHtml(m.title)}" class="w-full h-full object-cover ${isSurpriseHidden ? 'surprise-blur' : ''}">
        ${!isSurpriseHidden ? `<div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" aria-hidden="true"></div>` : ''}
        ${isSurpriseHidden ? `
          <div class="surprise-overlay bg-black/40">
            <div class="text-2xl">🎁</div>
            <div class="text-xs text-slate-100 font-semibold">Sorpresa di ${CONFIG.PEOPLE[m.surprise_by]?.label || m.surprise_by || 'un membro del gruppo'}</div>
            <button onclick="revealSurpriseUI('${m.id}')" class="mt-1 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-medium">Rivela</button>
          </div>
        ` : ''}
        <div class="absolute top-2 right-2 flex flex-col gap-1 items-end">
          ${(context ? context.personBadge : personBadge)(m.added_by)}
          ${m.matched === false ? `<span class="badge bg-amber-700/90" title="Nessun riscontro trovato su TMDb/OMDb, titolo forse errato"><i class="fa-solid fa-triangle-exclamation"></i> verifica</span>` : ''}
          ${m.surprise_by === (context ? context.callerLabel : currentUser) ? `<div class="flex items-center gap-1">
            <span class="badge bg-indigo-600/90">🎁 tua sorpresa</span>
            <button onclick="revealSurpriseUI('${m.id}')" class="px-1.5 py-0.5 bg-slate-800 hover:bg-rose-900/60 text-slate-300 hover:text-rose-300 rounded text-[10px] transition" title="Annulla la sorpresa">Annulla sorpresa</button>
          </div>` : ''}
          ${isVetoed ? `<span class="badge bg-rose-700/90">vietato</span>` : ''}
        </div>
        ${!isSurpriseHidden ? `<div class="absolute bottom-4 left-2 px-2 py-1 bg-black/60 rounded text-[10px] text-slate-300 backdrop-blur">
          <i class="fa-solid ${m.cinema_watchlist ? 'fa-ticket' : 'fa-tv'} text-indigo-400"></i> ${metaParts.map(escapeHtml).join(' • ')}
        </div>` : ''}
        ${(m.trailer_url && !isSurpriseHidden) ? `<a href="${escapeHtml(m.trailer_url)}" target="_blank" rel="noopener" class="absolute bottom-4 right-2 px-2 py-1 bg-red-600/80 hover:bg-red-500 rounded text-[10px] text-white backdrop-blur"><i class="fa-solid fa-play"></i> Trailer</a>` : ''}
      </div>
      <div class="card-body p-4 flex-1 flex flex-col ${context ? '' : 'justify-between space-y-3'} ticket-seam">
        <div class="card-film-info">
          <div class="card-title-band flex items-start justify-between gap-2">
            <h3 class="font-bold text-slate-100 text-base leading-snug">${isSurpriseHidden ? '???' : escapeHtml(m.title)}</h3>
          </div>
          ${context
            ? directorHtml + genresHtml + contextTagsHtml + ratingsHtml + context.viewingStatusHtml(m)
            : ratingsHtml + viewingStatusHtml(m) + directorHtml + (cardTags ? '<div class="flex items-center gap-2 mt-1 flex-wrap">' + cardTags + '</div>' : '')}
          ${(context ? context.cardReviewsHtml : cardReviewsHtml)(m)}
          ${context ? '' : sagaButtonHtml(m)}
        </div>
        ${context ? `<div class="card-actions">${context.cardOperationsHtml(m, projection, isSurpriseHidden)}</div>` : cardOperationsHtml(m, projection, isSurpriseHidden)}
      </div>
    `;
    // Step3 phase9 — dettaglio film: il click sulla card apre il modale, ma
    // mai dai controlli interni (visione/azioni/trailer/cestino/retry/sorpresa)
    // né per una sorpresa vista dall'altra persona (click inerte).
    card.addEventListener('click', e => {
      if (isSurpriseHidden) return;
      const t = e && e.target;
      if (t && t.closest && t.closest('button, a, input, select, textarea, details, summary')) return;
      if (context) { if(context.current()) context.detail(m.id, card); } else openMovieDetail(m.id, card);
    });
    if (context) {
      card.dataset.movieId = m.id;
      context.bind(card);
      if (!isSurpriseHidden) {
        const heading = card.querySelector('h3');
        const link = document.createElement('button'); link.type = 'button';
        link.className = 'text-left hover:underline focus-visible:outline focus-visible:outline-2 rounded';
        link.textContent = heading.textContent; link.setAttribute('aria-haspopup','dialog');
        link.onclick = () => { if(context.current()) context.detail(m.id, link); }; heading.replaceChildren(link);
      }
    }
    bindCardDisclosure(card);
    return card;
}

function knownMovieStatusHtml(movie) {
  if (!movie) return '';
  if (movie.surprise_by && movie.surprise_by !== currentUser) return '<div class="text-xs text-amber-300">Già nel catalogo · sorpresa</div>';
  const state = viewingState(movie);
  const label = state.N && state.V ? "Entrambi l’avete già visto" : state.N ? "N l’ha già visto" : state.V ? "V l’ha già visto" : 'Già nel catalogo';
  return `<div class="text-xs text-amber-300">${label}${state.together ? ' · Visto insieme' : ''}${movie.in_shared_list ? ' · In Lista' : ' · Fuori Lista'}</div>`;
}
function rewatchActionsHtml(movie, { compact = false } = {}) {
  const rewatch = isRewatch(movie);
  const badge = movie.in_shared_list ? `<span class="badge bg-indigo-600/80">${rewatch ? 'In gioco' : 'In Lista'}</span>` : '<span class="text-xs text-slate-400">Fuori Lista</span>';
  // Ricandidare titoli già visti insieme è una futura azione; Programma/Oggi restano disponibili.
  const toggle = togetherSeen(movie) && !movie.in_shared_list ? '' : `<button onclick="toggleSharedList('${jsAttrEscape(movie.id)}')" class="min-h-11 px-3 py-2 rounded-lg bg-indigo-600/20 text-indigo-300">${movie.in_shared_list ? 'Togli dalla Lista' : rewatch ? 'Rimetti in gioco' : 'Aggiungi alla nostra Lista'}</button>`;
  if (compact) return `<div class="movie-card-list-row"><span>${rewatch ? 'Rewatch · ' : ''}${badge}</span>${toggle}</div>`;
  return `<div class="text-sm text-slate-300">${rewatch ? 'Rewatch · Entrambi l’avete già visto · ' : ''}${badge}</div>${toggle}`;
}
function personalRemovalButtonsHtml(movie) {
  if (!currentUser || (movie.surprise_by && movie.surprise_by !== currentUser)) return '';
  const id = jsAttrEscape(movie.id);
  return `${personalRating(movie,currentUser) !== null ? `<button onclick="removePersonalRating('${id}')" class="min-h-11 text-slate-400 underline">Rimuovi il tuo voto</button>` : ''}
    ${reviewTextFor(movie,currentUser) ? `<button onclick="removePersonalText('${id}')" class="min-h-11 text-slate-400 underline">Rimuovi la tua recensione</button>` : ''}`;
}

function personalWatchButtonHtml(movie) {
  if (!currentUser || (movie.surprise_by && movie.surprise_by !== currentUser)) return '';
  const ownSeen = movie['seen_' + currentUser.toLowerCase()] === true;
  const id = jsAttrEscape(movie.id);
  return ownSeen
    ? `<button onclick="undoSeenUI('${id}')" class="w-full min-h-11 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium inline-flex items-center justify-center gap-1.5" aria-label="Segna come non visto"><i class="fa-solid fa-eye-slash" aria-hidden="true"></i>Segna come non visto</button>`
    : `<button onclick="markSeenUI('${id}')" class="w-full min-h-11 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-medium inline-flex items-center justify-center gap-1.5"><i class="fa-solid fa-eye" aria-hidden="true"></i>L'ho già visto</button>`;
}
