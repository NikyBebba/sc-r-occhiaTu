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
  document.getElementById('pinGate').classList.remove('hidden');
  document.getElementById('pinGateLabel').textContent = `Ciao ${CONFIG.PEOPLE[code].label}, inserisci il tuo PIN`;
  document.getElementById('pinError').classList.add('hidden');
  document.getElementById('pinInput').value = '';
  document.getElementById('pinInput').focus();
}

function backToLanding() {
  pendingUser = null;
  showLanding();
}

function submitPin() {
  const input = document.getElementById('pinInput').value.trim();
  const errorEl = document.getElementById('pinError');
  const expectedPin = CONFIG.PEOPLE[pendingUser]?.pin;

  if (expectedPin && input === expectedPin) {
    currentUser = pendingUser;
    sessionStorage.setItem('scorochiatu_user', currentUser);
    document.getElementById('pinGate').classList.add('hidden');
    showApp();
  } else {
    errorEl.classList.remove('hidden');
    document.getElementById('pinInput').value = '';
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
  document.getElementById('appRoot').classList.remove('hidden');
  const badge = document.getElementById('currentUserBadge');
  const person = CONFIG.PEOPLE[currentUser];
  badge.innerHTML = `<span class="badge ${person.badgeClass}">${person.label}</span>`;
  subscribeRealtime();
  loadMovies();
}

document.addEventListener('DOMContentLoaded', function () {
  checkLoginState();
  registerServiceWorker();
});
