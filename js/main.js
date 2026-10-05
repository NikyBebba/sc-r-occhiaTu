// ============================================
// Login: landing screen -> scelta persona -> PIN individuale
// ============================================

let currentUser = null;  // 'N' o 'V', chi ha fatto login in questa sessione
let pendingUser = null;  // persona scelta nella landing, in attesa del PIN

function checkLoginState() {
  const saved = sessionStorage.getItem('scorochiatu_user');
  if (saved && CONFIG.PEOPLE[saved]) {
    currentUser = saved;
    showApp();
    return;
  }
  showLanding();
}

function showLanding() {
  document.getElementById('landingScreen').classList.remove('hidden');
  document.getElementById('pinGate').classList.add('hidden');
  document.getElementById('appRoot').classList.add('hidden');
}

function selectUser(code) {
  pendingUser = code;
  document.getElementById('landingScreen').classList.add('hidden');
  const gate = document.getElementById('pinGate');
  gate.dataset.person = code;
  gate.classList.remove('hidden');
  document.getElementById('pinPersonMark').textContent = code;
  document.getElementById('pinGateLabel').textContent = `${CONFIG.PEOPLE[code].label}, il PIN e si entra.`;
  document.getElementById('pinError').classList.add('hidden');
  const input = document.getElementById('pinInput');
  input.value = '';
  input.setAttribute('aria-invalid', 'false');
  input.focus();
}

function backToLanding() {
  const previous = pendingUser;
  pendingUser = null;
  showLanding();
  const choice = document.getElementById('landingUser' + previous);
  if (choice) choice.focus();
}

function submitPin() {
  const input = document.getElementById('pinInput').value.trim();
  const errorEl = document.getElementById('pinError');
  const expectedPin = CONFIG.PEOPLE[pendingUser]?.pin;

  if (expectedPin && input === expectedPin) {
    document.getElementById('pinInput').setAttribute('aria-invalid', 'false');
    currentUser = pendingUser;
    sessionStorage.setItem('scorochiatu_user', currentUser);
    document.getElementById('pinGate').classList.add('hidden');
    showApp();
  } else {
    errorEl.classList.remove('hidden');
    const pin = document.getElementById('pinInput');
    pin.value = '';
    pin.setAttribute('aria-invalid', 'true');
    pin.focus();
  }
}

function logout() {
  unsubscribeRealtime();
  leaveMatch(true);   // logout = rimozione COMPLETA del canale Match (persistente solo tra tab)
  sessionStorage.removeItem('scorochiatu_user');
  currentUser = null;
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
