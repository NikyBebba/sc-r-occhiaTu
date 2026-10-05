// Form e azioni delle proiezioni: programmazione, oggi, snack e luogo.
// Dipende da store/nights e dai callback Match/Ticket, invocati a runtime.

// ---- Modale programmazione (sostituisce prompt()) ----
// Un unico popup per programmazione, scelta di oggi e modifica dei dettagli.
let scheduleMode = 'scheduled';
let scheduleOrigin = 'manual';
let scheduleEditingNightId = null;
let scheduleSaving = false;

function openProjectionForm(id, mode, origin = 'manual') {
  if (scheduleSaving) return;
  scheduleMode = mode;
  scheduleOrigin = origin;
  scheduleEditingNightId = null;
  document.getElementById('scheduleMovieId').value = id;
  document.getElementById('scheduleDate').value = localDateKey(new Date());
  document.getElementById('scheduleTime').value = '21:30';
  document.getElementById('scheduleLocation').value = '';
  document.getElementById('scheduleCustomSnack').value = '';
  document.getElementById('scheduleSnackError').classList.add('hidden');
  document.getElementById('scheduleSaveError').classList.add('hidden');
  document.getElementById('scheduleDateField').classList.toggle('hidden', mode !== 'scheduled');
  document.getElementById('scheduleTimeField').classList.toggle('hidden', mode !== 'scheduled');
  document.getElementById('scheduleModalTitle').textContent = mode === 'scheduled' ? 'Programma la proiezione' : mode === 'edit' ? 'Snack e luogo' : 'Oggi si guarda';
  document.getElementById('scheduleHint').textContent = mode === 'scheduled' ? 'Scegli quando: l’altro utente potrà confermare.' : mode === 'edit' ? 'Un cambio di programma per popcorn e poltrone?' : 'Cosa si sgranocchia? E dove parte il film?';
  document.getElementById('scheduleConfirm').textContent = mode === 'scheduled' ? 'Invia proposta' : mode === 'edit' ? 'Salva modifiche' : 'Scegli per oggi';
  document.getElementById('scheduleConfirm').disabled = false;
  syncSnackOptions();
  if (mode === 'scheduled') randomizeSnack();
  else document.getElementById('scheduleSnack').value = '';
  toggleCustomSnack(false);
  openModal('scheduleModal');
}

function scheduleMovie(id) {
  openProjectionForm(id, 'scheduled');
}

function editNightDetailsUI(id, nightId) {
  if (scheduleSaving) return;
  const night = nightId ? activeNights().find(n => n.id === nightId && n.movie_id === id) : activeNightForMovie(id);
  if (!night) return;
  openProjectionForm(id, 'edit');
  scheduleEditingNightId = night.id;
  document.getElementById('scheduleSnack').value = night.snack || '';
  document.getElementById('scheduleLocation').value = night.location || '';
}

const SNACKS = ['🍿 Popcorn dolce', '🍿 Popcorn salato', '🍫 Cioccolato', '🍕 Pizza', '🍦 Gelato', '🍟 Patatine'];
const CUSTOM_SNACK = '__custom_snack__';

// Gli snack già usati sono condivisi attraverso movie_nights (e il mirror
// legacy movies.snack), senza aggiungere una tabella o uno storage separato.
function snackChoices() {
  const seen = new Set();
  return [...SNACKS, ...movieNights.map(n => n.snack), ...movies.map(m => m.snack)]
    .filter(value => typeof value === 'string' && value.trim() && value.trim() !== CUSTOM_SNACK)
    .map(value => value.trim())
    .filter(value => {
      const key = value.toLocaleLowerCase('it');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function syncSnackOptions() {
  const select = document.getElementById('scheduleSnack');
  const selected = select.value;
  select.innerHTML = '<option value="">Nessuno snack / decidi dopo</option>' + snackChoices().map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')
    + `<option value="${CUSTOM_SNACK}">＋ Aggiungi uno snack…</option>`;
  if (selected === CUSTOM_SNACK || snackChoices().includes(selected)) select.value = selected;
  toggleCustomSnack(false);
}

function toggleCustomSnack(shouldFocus = true) {
  const custom = document.getElementById('scheduleSnack').value === CUSTOM_SNACK;
  const input = document.getElementById('scheduleCustomSnack');
  input.classList.toggle('hidden', !custom);
  document.getElementById('scheduleSnackError').classList.add('hidden');
  if (custom && shouldFocus) input.focus();
}

function randomizeSnack() {
  const choices = snackChoices();
  document.getElementById('scheduleSnack').value = choices[Math.floor(Math.random() * choices.length)];
  toggleCustomSnack(false);
}

// Salva la proiezione o i suoi dettagli, con errori visibili e conferma dal Match solo dopo insert riuscito.
async function confirmSchedule() {
  if (scheduleSaving) return;
  const id = document.getElementById('scheduleMovieId').value;
  const date = document.getElementById('scheduleDate').value;
  const time = document.getElementById('scheduleTime').value;
  if (scheduleMode === 'scheduled' && !date) return;
  const selectedSnack = document.getElementById('scheduleSnack').value;
  const snack = selectedSnack === CUSTOM_SNACK
    ? document.getElementById('scheduleCustomSnack').value.trim()
    : selectedSnack;
  if (selectedSnack === CUSTOM_SNACK && (!snack || snack.length > 80)) {
    const error = document.getElementById('scheduleSnackError');
    error.textContent = snack ? 'Lo snack può avere al massimo 80 caratteri.' : 'Scrivi uno snack oppure scegli “Nessuno snack”.';
    error.classList.remove('hidden');
    return;
  }
  const location = document.getElementById('scheduleLocation').value.trim().slice(0, 120) || null;
  const pending = typeof matchPendingSchedule !== 'undefined' ? matchPendingSchedule : null;
  const fromMatch = !!(pending && pending.movieId === id && currentTab === 'match');
  const fromWheel = scheduleOrigin === 'wheel' || (typeof wheelScheduleFor !== 'undefined' && wheelScheduleFor === id);
  const mode = scheduleMode;
  const error = document.getElementById('scheduleSaveError');
  scheduleSaving = true;
  document.getElementById('scheduleConfirm').disabled = true;
  error.classList.add('hidden');
  try {
    let saved;
    if (mode === 'edit') {
      const night = movieNights.find(n => n.id === scheduleEditingNightId && (n.status === 'proposed' || n.status === 'confirmed'));
      saved = !!night && await updateMovieNight(night.id, { snack: snack || null, location });
      if (saved && activeNightForMovie(id)?.id === night.id) await updateMovie(id, { snack: snack || null });
    } else if (mode === 'quick') {
      saved = await setQuickTonight(id, snack || null, location);
    } else {
      saved = await proposeNight(id, currentUser, date, time, snack || null, location);
    }
    if (!saved) {
      error.textContent = 'La proiezione non è stata salvata. Riprova.';
      error.classList.remove('hidden');
      return;
    }
    closeModal('scheduleModal');
    if (mode !== 'edit') {
      const wheelBox = document.getElementById('wheelWinner');
      if (wheelBox) wheelBox.classList.add('hidden');
      if (typeof wheelScheduleFor !== 'undefined') wheelScheduleFor = null;
      if (typeof markTicketOrigin === 'function') markTicketOrigin(id, fromMatch || scheduleOrigin === 'match' ? 'match' : fromWheel ? 'wheel' : 'manual');
      if (fromMatch) {
        await closeSession(pending.sessionId);
        if (typeof matchNightDone === 'function') matchNightDone(id);
      }
    }
    await loadMovies();
  } catch (_) {
    error.textContent = 'Salvataggio non riuscito. Riprova.';
    error.classList.remove('hidden');
  } finally {
    scheduleSaving = false;
    document.getElementById('scheduleConfirm').disabled = false;
  }
}

// ---- Box "Prossimo Film" — pick veloce, conferma o annullo proposta ----
// (lockWheelWinner rimosso in Phase 15: dead code, lo stesso flusso è coperto
// dal popup di quickTonightUI per "Oggi" e dal confirm di
// scheduleMovie per "Programma".)
async function confirmNightUI(id, nightId) {
  await confirmNight(id, nightId);
  await loadMovies();
}

async function cancelNightUI(id, title, nightId) {
  const ok = await showConfirmModal('Annullare la proiezione?', `"${title}" verrà rimosso da questo appuntamento.`);
  if (!ok) return;
  await cancelNight(id, nightId);
  await loadMovies();
}

// Scelta di oggi: nessuna scrittura finché non si conferma il popup.
function quickTonightUI(id, origin) {
  openProjectionForm(id, 'quick', origin || 'manual');
}
