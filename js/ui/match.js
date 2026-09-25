// ============================================
// UI — Match tab: lobby, swipe, match, completed, "stasera dal match"
// La UI CHIAMA le funzioni dello store (mai le ridefinisce): enterMatch/
// leaveMatch/ensureActiveSession/closeSession/recordSwipe/continueMatch/
// setQuickTonight vivono in store.js. Vista in #movieGrid come il calendario.
// ============================================

// Stato del gesto touch (nessuna libreria): soglia ~80px, il drag NON ri-render.
let matchDragging = false;
let matchPendingRender = false;
let matchDragStartX = 0;
let matchDragX = 0;
const matchSwipeThreshold = 80;

// Contestuale alla creazione di una serata dal Match. "Programma" apre il
// modale esistente e la sessione si chiude (closeSession) SOLO dopo la
// conferma effettiva (hook in confirmSchedule), mai all'apertura né se l'utente
// annulla.
let matchPendingSchedule = null; // { sessionId, movieId }
let matchNightCreated = null;    // { movieId, title } → vista "Serata creata ✓"
let matchExitTimer = null;       // auto-exit dopo la creazione

function matchViewSession() {
  return swipeSessions[0] || null;
}

function matchPresentUsers() {
  // lobbyPresenceState è GIÀ l'array di chiavi persona deduplicate
  // (presenceUsers rimuove i duplicati del doppio tab). Mai passarlo a
  // presenceUsers (tratterebbe l'array come oggetto → indici numerici).
  if (!lobbyPresenceState) return [];
  const out = lobbyPresenceState.filter(p => p && VALID_PERSONS.includes(p));
  return out.filter((p, i) => out.indexOf(p) === i);
}

function clearMatchState() {
  if (matchExitTimer) { clearTimeout(matchExitTimer); matchExitTimer = null; }
  matchPendingSchedule = null;
  matchNightCreated = null;
  matchPendingRender = false;
  matchDragging = false;
}

// ---- Pill "Match" nello segmented control: segnale stato live (N↔V) ----
// La CTA NON crea un secondo stato: legge SOLO le fonti già esistenti
// (matchChannelStatus + lobbyPresenceState tramite matchPresentUsers) e cambia
// solo classi di aspetto. La visibilità resta a render() (classList 'hidden'),
// mai toccata qui. Limite noto accettato: lo stato si aggiorna a ogni render —
// il riallineo live mentre si naviga altrove richiederebbe un listener presence
// in più (NON aggiunto: toccare store.js è fuori scope dello step).
function renderMatchCta() {
  const btn = document.getElementById('tabMatch');
  if (!btn) return;
  const on = dbMode === 'supabase' && matchChannel && matchChannelStatus === 'subscribed';
  const present = matchPresentUsers();
  const state = on && present.includes('N') && present.includes('V') ? 'live' : on ? 'online' : 'idle';
  btn.classList.remove('match-cta-idle', 'match-cta-online', 'match-cta-live');
  btn.classList.add('match-cta-' + state);
}

// ---- Viste ----
function matchUnavailableHtml() {
  const tech = matchEnterErrorMsg
    ? `<p class="text-slate-400 text-[10px] break-all">${escapeHtml(matchEnterErrorMsg)}</p>`
    : '';
  return `<div class="col-span-full py-12 text-center text-slate-400 text-sm space-y-3">
      <div class="text-3xl">🌀</div>
      <p>Match non disponibile in questo momento.</p>
      ${tech}
      <button onclick="tryMatchAgain()" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition">Riprova</button>
    </div>`;
}

function matchConnectingHtml() {
  return `<div class="col-span-full py-12 text-center text-slate-400 text-sm">
      <div class="text-2xl mb-2"><i class="fa-solid fa-spinner fa-pulse"></i></div>
      <p>Connessione…</p>
    </div>`;
}

// Dopo la creazione: messaggio di conferma, poi esce da sola al tab precedente.
function matchNightCreatedHtml() {
  if (!matchExitTimer) {
    matchExitTimer = setTimeout(() => { matchExitTimer = null; exitMatchView(); }, 1400);
  }
  const title = matchNightCreated && matchNightCreated.title ? matchNightCreated.title : '';
  return `<div class="col-span-full py-12 text-center text-emerald-400 text-sm space-y-3">
      <div class="text-3xl">🎉</div>
      <p class="font-semibold text-base">Serata creata ✓</p>
      ${title ? `<p class="text-slate-400 text-xs">${escapeHtml(title)}</p>` : ''}
    </div>`;
}

function matchNewSessionBtn() {
  return `<button onclick="newMatchSession()" class="flex-1 py-2.5 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 rounded-xl text-sm font-medium transition">Nuova sessione</button>`;
}

// LOBBY_SOLO: attesa con chip di chi è online. "Nuova sessione" è ammessa qui.
function matchLobbyHtml(state) {
  const present = matchPresentUsers();
  const chips = present.length
    ? present.map(p => personBadge(p)).join(' ')
    : '<span class="text-slate-400 text-xs">Nessuno online</span>';
  const missing = VALID_PERSONS.filter(p => !present.includes(p));
  const waiting = missing.length > 0
    ? `In attesa di ${missing.map(m => (CONFIG.PEOPLE[m] ? CONFIG.PEOPLE[m].label : escapeHtml(m))).join(' e ')}`
    : 'Siete entrambi online!';
  const sessionStarted = Boolean(state);
  return `<div class="col-span-full py-10 text-center text-sm space-y-4">
      <div class="text-3xl">👀</div>
      <p class="font-semibold text-slate-100 text-base">Chi c'è?</p>
      <div class="flex items-center justify-center gap-2">${chips}</div>
      <p class="text-slate-400 text-xs">${waiting}${sessionStarted ? '' : ' per iniziare lo swipe insieme.'}</p>
      <div class="flex justify-center gap-2">${matchNewSessionBtn()}</div>
    </div>`;
}

// Meta "{anno} • {durata}": sempre scalare (mai un "•" isolato su nullable).
function matchMovieMeta(movie) {
  const parts = [];
  if (movie.release_year) parts.push(String(movie.release_year));
  if (movie.duration) parts.push(String(movie.duration));
  if (movie.platform) parts.push(String(movie.platform));
  return parts.join(' • ');
}

function matchPoster(movie) {
  return `<img src="${movie.poster || 'https://via.placeholder.com/300x450/1e293b/64748b?text=No+Cover'}" alt="${escapeHtml(movie.title)}" class="w-full h-full object-cover">`;
}

// SWIPE: card del film corrente + Nope/Like grandi. Bottoni e gesto usano la
// STESSA swipeCard(). Se ho già risposto e l'altro no: "In attesa di X" senza
// rivelare la direzione (niente bottoni). Il card non avanza finché l'altro
// non risponde (currentIndex derivato).
function matchSwipeHtml(state) {
  const movie = resolveDeckMovie(movies, state.movieId);
  if (!movie) {
    return `<div class="col-span-full py-12 text-center text-slate-400 text-sm">Film rimosso dalla lista.</div>`;
  }
  const answers = swipesForCard(swipes, state.movieId);
  const iAnswered = answers[currentUser] !== undefined;
  const missing = VALID_PERSONS.find(p => answers[p] === undefined);
  const meta = matchMovieMeta(movie);
  const genres = (Array.isArray(movie.genres) && movie.genres.length)
    ? movie.genres.join(', ')
    : '';
  const deckLength = Array.isArray(swipeSessions[0] && swipeSessions[0].deck) ? swipeSessions[0].deck.length : 0;

  let actionsHtml;
  if (iAnswered) {
    const who = missing && CONFIG.PEOPLE[missing] ? CONFIG.PEOPLE[missing].label : '…';
    actionsHtml = `<div class="text-center text-[11px] text-indigo-300 border border-indigo-500/30 bg-indigo-500/10 rounded-xl py-3">In attesa di ${escapeHtml(who)}</div>`;
  } else {
    actionsHtml = `<div class="flex gap-3">
        <button onclick="swipeCard('${jsAttrEscape(movie.id)}', false)" class="flex-1 py-3 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 rounded-xl text-base font-bold transition" style="min-height:44px"><i class="fa-solid fa-xmark mr-1"></i> Nope</button>
        <button onclick="swipeCard('${jsAttrEscape(movie.id)}', true)" class="flex-1 py-3 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 rounded-xl text-base font-bold transition" style="min-height:44px"><i class="fa-solid fa-heart mr-1"></i> Like</button>
      </div>`;
  }

  return `<div class="col-span-full max-w-sm mx-auto space-y-3">
      <div class="text-center text-[10px] uppercase tracking-wider text-slate-400">Swipe a due — card ${state.index + 1} di ${deckLength}</div>
      <div id="matchCard" class="swipe-card glass-card rounded-2xl border border-slate-800 overflow-hidden">
        <div class="aspect-[2/3] bg-slate-900">${matchPoster(movie)}</div>
        <div class="p-4 space-y-1">
          <div class="font-bold text-slate-100 text-lg leading-snug">${escapeHtml(movie.title)}</div>
          ${meta ? `<div class="text-xs text-slate-400">${escapeHtml(meta)}</div>` : ''}
          ${genres ? `<div class="text-xs text-slate-400"><i class="fa-solid fa-tags mr-1"></i>${escapeHtml(genres)}</div>` : ''}
        </div>
      </div>
      ${actionsHtml}
    </div>`;
}

// MATCH: celebrazione. Derivata ESCLUSIVAMENTE da pendingMatch() != null
// (status DB non è prerequisito). Il riconoscimento ("Continua") aggiorna
// matched_movie_id (solo in quel momento), evitando ricelebrazioni anche
// con reconcile in ritardo.
function matchMatchHtml(state) {
  const movie = resolveDeckMovie(movies, state.movieId) || null;
  const title = movie ? movie.title : 'Film rimosso';
  return `<div class="col-span-full max-w-sm mx-auto text-center space-y-4">
      <div class="text-5xl">💘</div>
      <p class="text-xl font-bold text-slate-100">Match!</p>
      <p class="text-sm text-slate-400">Volete vedere <span class="font-semibold text-slate-100">${escapeHtml(title)}</span> insieme.</p>
      <p class="text-xs text-slate-400">Il riconoscimento sincronizza lo stato tra i telefoni: il partner vedrà sparire la celebrazione al prossimo riallineamento (o premendo "Continua a swipare").</p>
      <div class="flex gap-2">
        <button onclick="createMatchNight('${movie ? jsAttrEscape(movie.id) : ''}', 'tonight')" class="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium transition">Stasera</button>
        <button onclick="createMatchNight('${movie ? jsAttrEscape(movie.id) : ''}', 'schedule')" class="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-sm font-medium transition">Programma</button>
      </div>
      <div class="flex gap-2">
        <button onclick="continueFromMatch()" class="flex-1 py-2.5 bg-sky-600/20 hover:bg-sky-600/40 text-sky-300 rounded-xl text-sm font-medium transition">Continua a swipare</button>
        ${matchNewSessionBtn()}
        <button onclick="exitMatchView()" class="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium transition">Esci</button>
      </div>
    </div>`;
}

// DONE: riepilogo "X match" + Nuova sessione / Esci.
function matchDoneHtml(state) {
  return `<div class="col-span-full max-w-sm mx-auto text-center space-y-4">
      <div class="text-5xl">🏁</div>
      <p class="text-xl font-bold text-slate-100">Mazzo finito!</p>
      <p class="text-sm text-slate-400">${state.matches} match in questa sessione.</p>
      <div class="flex gap-2 justify-center">
        ${matchNewSessionBtn()}
        <button onclick="exitMatchView()" class="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium transition">Esci</button>
      </div>
    </div>`;
}

// Decide la vista corrente. Nessun re-render durante il drag: se dragging,
// rimanda a fine drag. Nessuna chiamata se currentTab !== 'match'.
function matchViewHtml() {
  if (!matchAvailable) return matchUnavailableHtml();
  if (matchChannelStatus !== 'subscribed' || !matchChannel) return matchConnectingHtml();
  if (matchNightCreated) return matchNightCreatedHtml();
  const session = matchViewSession();
  const state = session ? evaluateSession(session, swipes, movies) : null;
  if (!state) return matchLobbyHtml(null);
  if (state.view === 'match') return matchMatchHtml(state);
  if (state.view === 'done') return matchDoneHtml(state);
  if (matchPresentUsers().length < 2) return matchLobbyHtml(state); // LOBBY_SOLO
  return matchSwipeHtml(state); // LOBBY_DUE → SWIPE (auto-start)
}

function renderMatch() {
  if (currentTab !== 'match') return;
  if (matchDragging) { matchPendingRender = true; return; }
  const grid = document.getElementById('movieGrid');
  if (!grid) return;
  grid.innerHTML = matchViewHtml();
  if (!matchNightCreated && matchAvailable) {
    const card = document.getElementById('matchCard');
    if (card) matchBindSwipe(card, matchCurrentMovieId());
  }
}

// Il film del card corrente (per agganciare il gesto touch alla card).
function matchCurrentMovieId() {
  const session = matchViewSession();
  const state = session ? evaluateSession(session, swipes, movies) : null;
  if (state && (state.view === 'swipe')) return state.movieId;
  return null;
}

// ---- Gesto touch: touchstart/move/end, soglia ~80px, niente libreria.
// Bottoni e gesto convergono entrambi su swipeCard(). ----
function matchBindSwipe(node, movieId) {
  node.addEventListener('touchstart', e => {
    matchDragging = true;
    matchDragStartX = (e.touches && e.touches[0] && e.touches[0].clientX) || 0;
    matchDragX = matchDragStartX;
  }, { passive: true });
  node.addEventListener('touchmove', e => {
    if (e.cancelable) e.preventDefault();
    matchDragX = (e.touches && e.touches[0] && e.touches[0].clientX) || matchDragX;
  }, { passive: false });
  node.addEventListener('touchend', () => {
    const dx = matchDragX - matchDragStartX;
    matchDragging = false;
    if (Math.abs(dx) >= matchSwipeThreshold) swipeCard(movieId, dx > 0);
    if (matchPendingRender) { matchPendingRender = false; renderMatch(); }
  });
}

// Azione condivisa (bottoni + gesto). Bloccata se ho già risposto: il mio
// swipe non deve mai avanzare un card che attende la risposta dell'altro.
async function swipeCard(movieId, liked) {
  if (matchDragging || matchPendingRender) { matchPendingRender = true; return; }
  const session = matchViewSession();
  if (!session) return;
  const answers = swipesForCard(swipes, movieId);
  if (answers[currentUser] !== undefined) return;
  await recordSwipe(session, movieId, currentUser, liked);
  renderMatch();
}

async function continueFromMatch() {
  const session = matchViewSession();
  if (!session) return;
  await continueMatch(session);
  renderMatch();
}

// "Nuova sessione": chiude l'attuale (se attiva) e ne crea un'altra.
// DUMP solo in lobby/MATCH/DONE, MAI in SWIPE (il bottone non esiste lì).
async function newMatchSession() {
  const session = matchViewSession();
  if (session && (session.status === 'open' || session.status === 'matched')) {
    await closeSession(session.id);
  }
  await ensureActiveSession();
  renderMatch();
}

// ---- Creare la serata dal match ----
// Stasera → setQuickTonight (serata confirmed senza data).
// Programma → modale esistente: la sessione si chiude SOLO quando la serata è
// stata effettivamente creata (hook in confirmSchedule), mai all'apertura né
// se l'utente annulla.
async function createMatchNight(movieId, mode) {
  const session = matchViewSession();
  if (!session || !movieId) return;
  if (mode === 'tonight') {
    await setQuickTonight(movieId);
    // La serata deve ESISTERE davvero (insert Supabase riuscito e presente in
    // movieNights): se non risulta creata (es. failover a locale) la sessione
    // NON si chiude e la UI NON mostra "Serata creata" — si resta sulla
    // celebrazione e si può ritentare.
    if (!activeNightForMovie(movieId)) {
      console.warn('[sc(r)occhiaTu] Stasera: serata non creata — sessione Match lasciata aperta.');
      return;
    }
    await closeSession(session.id);
    const movie = resolveDeckMovie(movies, movieId);
    matchNightCreated = { movieId, title: movie ? movie.title : '' };
    renderMatch();
    return;
  }
  matchPendingSchedule = { sessionId: session.id, movieId };
  scheduleMovie(movieId);
}

// La modale di programmazione si è chiusa (annullo, X, backdrop, Esc oppure
// conferma): il pending "Programma dal Match" NON deve sopravvivere, altrimenti
// una programmazione dello stesso film dalla lista normale chiuderebbe la
// sessione Match dal tab sbagliato. Guard typeof in modals.js (va in load
// prima di match.js).
function matchScheduleModalClosed() {
  matchPendingSchedule = null;
}

// Chiamato da actions.confirmSchedule dopo che proposeNight è andato a buon
// fine (controllo a posteriori: la serata È stata creata).
function matchNightDone(movieId) {
  const movie = resolveDeckMovie(movies, movieId);
  matchNightCreated = { movieId, title: movie ? movie.title : '' };
  matchPendingSchedule = null;
  renderMatch();
}

// Riprova: azzera la sonda (matchProbeDone) e rientra. Il core non è toccato.
function tryMatchAgain() {
  matchProbeDone = false;
  matchAvailable = false;
  enterMatch().catch(e => reportMatchEnterError(e));
}

// Esci = pausa: chiude il canale (via setTab → leaveMatch), la sessione resta
// attiva. Torna al tab da cui eravamo entrati.
function exitMatchView() {
  clearMatchState();
  setTab(matchPrevTab);
}