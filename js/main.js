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
  sessionStorage.removeItem('scorochiatu_user');
  currentUser = null;
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

document.addEventListener('DOMContentLoaded', checkLoginState);
