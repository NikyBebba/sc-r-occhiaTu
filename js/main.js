// ============================================
// Login: landing screen -> scelta persona -> PIN individuale
// ============================================

let currentUser = null;  // 'N' o 'V', chi ha fatto login in questa sessione
let pendingUser = null;  // persona scelta nella landing, in attesa del PIN

async function checkLoginState() {
  await initializeAuth();
}

function showLanding() {
  if (typeof resetWatchForms === 'function') resetWatchForms();
  if (typeof resetMemoriesState === 'function') resetMemoriesState();
  modalStack = [];
  document.getElementById('appRoot').inert = false;
  document.getElementById('landingScreen').classList.remove('hidden');
  document.getElementById('pinGate').classList.add('hidden');
  document.getElementById('appRoot').classList.add('hidden');
}

function selectUser(code) {
  if (authBusy || !CONFIG.PEOPLE[code]) return;
  pendingUser = code;
  document.getElementById('authNotice').classList.add('hidden');
  document.getElementById('authUsername').value = CONFIG.AUTH_EMAILS?.[code] || '';
  document.getElementById('landingScreen').classList.add('hidden');
  const gate = document.getElementById('pinGate');
  gate.dataset.person = code;
  gate.classList.remove('hidden');
  document.getElementById('pinPersonMark').textContent = code;
  document.getElementById('pinGateLabel').textContent = `«Accesso riservato, agente ${CONFIG.PEOPLE[code].label}. Senza codice segreto non si passa.»`;
  document.getElementById('pinError').classList.add('hidden');
  const input = document.getElementById('pinInput');
  input.value = '';
  input.setAttribute('aria-invalid', 'false');
  input.focus();
}

function backToLanding() {
  if (authBusy) return;
  const previous = pendingUser;
  pendingUser = null;
  showLanding();
  const choice = document.getElementById('landingUser' + previous);
  if (choice) choice.focus();
}

async function submitPin() {
  if (authBusy || !pendingUser) return;
  const pin = document.getElementById('pinInput');
  const errorEl = document.getElementById('pinError');
  const button = document.getElementById('pinSubmit');
  const input = pin.value.trim();
  if (!/^[0-9]{8}$/.test(input)) {
    errorEl.textContent = 'Inserisci il PIN di 8 cifre.';
    errorEl.classList.remove('hidden');
    pin.setAttribute('aria-invalid', 'true');
    return;
  }
  button.disabled = true;
  errorEl.classList.add('hidden');
  try {
    await signInPerson(pendingUser, input, document.getElementById('rememberDevice').checked);
    pin.value = '';
    pin.setAttribute('aria-invalid', 'false');
    document.getElementById('pinGate').classList.add('hidden');
    showApp();
  } catch (error) {
    if (error.message === 'AUTH_CHANGED') return;
    const message = error.message === 'AUTH_NOT_CONFIGURED' ? 'Accesso non ancora configurato.'
      : error.status === 429 ? 'Troppi tentativi. Attendi e riprova.'
      : isAuthFailure(error) || error.message === 'AUTH_NOT_MEMBER' ? 'PIN errato o accesso non autorizzato.'
      : 'Accesso non riuscito. Controlla la connessione e riprova.';
    if (pendingUser) selectUser(pendingUser);
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
    pin.value = '';
    pin.setAttribute('aria-invalid', 'true');
    pin.focus();
  } finally { button.disabled = false; }
}

async function logout() {
  await signOutApp();
  location.reload();
}

function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' })
    .then(function (reg) {
      reg.addEventListener('updatefound', function () {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', function () {
          // Nuova versione pronta: prompt solo se esiste già un SW attivo
          // (al primissimo install `controller` è null → niente toast).
          if (sw.state === 'installed' && navigator.serviceWorker.controller) showSwToast();
        });
      });
    })
    .catch(function (err) { console.error('Service worker: registrazione fallita', err); });
}

function showSwToast() {
  const t = document.getElementById('swUpdateToast');
  if (t) t.classList.remove('hidden');
}

function dismissSwToast() {
  const t = document.getElementById('swUpdateToast');
  if (t) t.classList.add('hidden');
}

function applySwUpdate() {
  dismissSwToast();
  location.reload();
}

function showApp() {
  requireAppIdentity();
  const entryEpoch = authEpoch;
  document.getElementById('landingScreen').classList.add('hidden');
  document.getElementById('pinGate').classList.add('hidden');
  dashboardView = 'home';
  document.getElementById('appRoot').classList.remove('hidden');
  loadHapticsPreference();
  loadAudioPreference();
  const badge = document.getElementById('currentUserBadge');
  const person = CONFIG.PEOPLE[currentUser];
  badge.innerHTML = `<span class="badge ${person.badgeClass}">${person.label}</span>`;
  beginInitialLoading();
  subscribeRealtime();
  loadMovies().catch(() => {
    if (!isAppAuthorized() || entryEpoch !== authEpoch) return;
    // Una richiesta che rigetta (anziché restituire un errore Supabase)
    // usa comunque il mirror locale, come gli altri errori di rete.
    dbMode = 'local';
    lastSupabaseFailAt = Date.now();
    console.error('[sc(r)occhiaTu] Caricamento non riuscito: uso i dati salvati sul telefono.');
    try { loadLocal(); }
    catch (error) { movies = []; votes = []; vetoes = []; movieNights = []; }
    render();
  });
}

document.addEventListener('DOMContentLoaded', function () {
  checkLoginState();
  registerServiceWorker();
});
