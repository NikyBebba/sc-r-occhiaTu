// ============================================
// Login: landing screen -> scelta persona -> password personale
// ============================================

let currentUser = null;  // 'N' o 'V', chi ha fatto login in questa sessione
let pendingUser = null;  // persona scelta nella landing, in attesa della password

async function checkLoginState() {
  await initializeAuth();
}

function showLanding() {
  if (typeof resetWatchForms === 'function') resetWatchForms();
  if (typeof resetMemoriesState === 'function') resetMemoriesState();
  modalStack = [];
  document.getElementById('appRoot').inert = false;
  document.getElementById('landingScreen').classList.remove('hidden');
  document.getElementById('loginGate').classList.add('hidden');
  document.getElementById('recoveryGate').classList.add('hidden');
  document.getElementById('newPassword').value = '';
  document.getElementById('confirmPassword').value = '';
  document.getElementById('newPassword').disabled = true;
  document.getElementById('confirmPassword').disabled = true;
  document.getElementById('appRoot').classList.add('hidden');
}

function showRecoveryScreen(message = '') {
  pendingUser = null;
  document.getElementById('landingScreen').classList.add('hidden');
  document.getElementById('loginGate').classList.add('hidden');
  document.getElementById('appRoot').classList.add('hidden');
  document.getElementById('recoveryGate').classList.remove('hidden');
  document.getElementById('passwordInput').value = '';
  document.getElementById('newPassword').value = '';
  document.getElementById('confirmPassword').value = '';
  document.getElementById('newPassword').disabled = true;
  document.getElementById('confirmPassword').disabled = true;
  document.getElementById('recoverySubmit').disabled = true;
  const error = document.getElementById('recoveryError');
  error.textContent = message;
  error.classList.toggle('hidden', !message);
}

async function submitRecoveryPassword() {
  if (authRecoveryBusy || !authRecoveryRequested || !authRecoveryIdentity) return;
  const password = document.getElementById('newPassword');
  const confirmation = document.getElementById('confirmPassword');
  const errorEl = document.getElementById('recoveryError');
  if (!password.value || !confirmation.value || password.value !== confirmation.value) {
    errorEl.textContent = !password.value || !confirmation.value
      ? 'Inserisci e conferma la nuova password.' : 'Le password non coincidono.';
    errorEl.classList.remove('hidden');
    return;
  }
  const revision = authRecoveryRevision;
  authRecoveryBusy = true;
  document.getElementById('recoverySubmit').disabled = true;
  document.getElementById('recoveryExit').disabled = true;
  errorEl.classList.add('hidden');
  try {
    await updateRecoveryPassword(password.value);
    await leavePasswordRecovery('Password aggiornata. Scegli la tua persona e accedi con la nuova password.');
  } catch (error) {
    if (revision !== authRecoveryRevision) return;
    password.value = '';
    confirmation.value = '';
    const passwordRejected = ['weak_password', 'same_password', 'validation_failed'].includes(error.code);
    if (passwordRejected) {
      errorEl.textContent = 'Password non aggiornata. Verifica i requisiti della password, poi riprova.';
    } else {
      const failure = recoveryFailure(error, 'update');
      if (failure.recoveryCategory !== 'SERVICE_UNAVAILABLE') authRecoveryIdentity = null;
      showRecoveryFailure(failure, 'update');
    }
    errorEl.classList.remove('hidden');
  } finally {
    authRecoveryBusy = false;
    document.getElementById('recoverySubmit').disabled = !authRecoveryIdentity;
    password.disabled = !authRecoveryIdentity;
    confirmation.disabled = !authRecoveryIdentity;
    document.getElementById('recoveryExit').disabled = false;
  }
}

function selectUser(code) {
  if (authRecoveryRequested || authBusy || !CONFIG.PEOPLE[code]) return;
  pendingUser = code;
  document.getElementById('authNotice').classList.add('hidden');
  document.getElementById('authUsername').value = CONFIG.AUTH_EMAILS?.[code] || '';
  document.getElementById('landingScreen').classList.add('hidden');
  const gate = document.getElementById('loginGate');
  gate.dataset.person = code;
  gate.classList.remove('hidden');
  document.getElementById('loginPersonMark').textContent = code;
  document.getElementById('loginGateLabel').textContent = `«Accesso riservato, agente ${CONFIG.PEOPLE[code].label}. Senza codice segreto non si passa.»`;
  document.getElementById('loginError').classList.add('hidden');
  const input = document.getElementById('passwordInput');
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

async function submitLogin() {
  if (authRecoveryRequested || authBusy || !pendingUser) return;
  const password = document.getElementById('passwordInput');
  const errorEl = document.getElementById('loginError');
  const button = document.getElementById('loginSubmit');
  const account = document.getElementById('authUsername').value.trim().toLowerCase();
  const expectedAccount = (CONFIG.AUTH_EMAILS?.[pendingUser] || '').trim().toLowerCase();
  if (account !== expectedAccount) {
    errorEl.textContent = "L'account non corrisponde alla persona scelta. Usa Cambia persona.";
    errorEl.classList.remove('hidden');
    return;
  }
  const input = password.value;
  if (input.length === 0) {
    errorEl.textContent = 'Inserisci la password.';
    errorEl.classList.remove('hidden');
    password.setAttribute('aria-invalid', 'true');
    return;
  }
  button.disabled = true;
  errorEl.classList.add('hidden');
  try {
    await signInPerson(pendingUser, input, document.getElementById('rememberDevice').checked);
    password.value = '';
    password.setAttribute('aria-invalid', 'false');
    document.getElementById('loginGate').classList.add('hidden');
    showApp();
  } catch (error) {
    if (error.message === 'AUTH_CHANGED') return;
    const message = error.message === 'AUTH_NOT_CONFIGURED' ? 'Accesso non ancora configurato.'
      : error.status === 429 ? 'Troppi tentativi. Attendi e riprova.'
      : isAuthFailure(error) || error.message === 'AUTH_NOT_MEMBER' ? 'Password errata o accesso non autorizzato.'
      : 'Accesso non riuscito. Controlla la connessione e riprova.';
    if (pendingUser) selectUser(pendingUser);
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
    password.value = '';
    password.setAttribute('aria-invalid', 'true');
    password.focus();
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
  document.getElementById('loginGate').classList.add('hidden');
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
