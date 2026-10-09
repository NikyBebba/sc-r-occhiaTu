// Auth è la sola fonte dell'identità; storage conserva token SDK, mai password.
const AUTH_STORAGE_KEY = 'scorochiatu_auth';
let authRemember = localStorage.getItem(AUTH_STORAGE_KEY) !== null;
let authEpoch = 0;
let authIdentity = null; // { uid, person, expiresAt }, validata online in questa esecuzione
let authBusy = false;
let authListener = null;
let authRefreshTask = null;
const AUTH_RECOVERY_KEY = 'scorochiatu_recovery'; // Solo ID utente recovery, mai password/token.
let authRecoveryRequested = false;
let authRecoverySession = null;
let authRecoveryIdentity = null;
let authRecoveryTask = null;
let authRecoveryBusy = false;
let authReady = false;
let authRecoveryEvent = null;
let resolveAuthRecoveryEvent = null;

// Callback ufficiale del SDK: i parametri sono già interpretati da Supabase.
// Rileva il contesto prima del restore; lo scambio/verifica dei token resta al SDK.
function detectAuthCallback(_url, params) {
  const callback = !!(params.access_token || params.error || params.error_code || params.error_description);
  if (callback && (params.type === 'recovery' || params.error || params.error_code || params.error_description)) {
    authRecoveryRequested = true;
    authRemember = false;
    if (params.type === 'recovery' && params.access_token) {
      authRecoveryEvent = new Promise(resolve => { resolveAuthRecoveryEvent = resolve; });
    }
  }
  return callback;
}

function attachAuthListener() {
  if (authListener) return;
  authListener = sb.auth.onAuthStateChange((event, session) => {
    // Non attendere query Auth dentro il callback SDK.
    if (event === 'PASSWORD_RECOVERY') {
      authRecoveryRequested = true;
      authRecoverySession = session;
      resolveAuthRecoveryEvent?.();
      resolveAuthRecoveryEvent = null;
      authRecoveryIdentity = null;
      authIdentity = null;
      authRemember = false;
      authEpoch++;
      if (session?.user?.id) sessionStorage.setItem(AUTH_RECOVERY_KEY, session.user.id);
      if (authReady) setTimeout(() => preparePasswordRecovery().catch(() => {}), 0);
      return;
    }
    if (authRecoveryRequested) {
      if (event === 'TOKEN_REFRESHED' && session?.user?.id === authRecoverySession?.user?.id) authRecoverySession = session;
      if (event === 'SIGNED_OUT') {
        authEpoch++;
        authRecoverySession = null;
        authRecoveryIdentity = null;
        if (authReady) showRecoveryScreen('Link non valido o scaduto. Richiedi un nuovo link di recupero.');
      }
      return;
    }
    if (event === 'SIGNED_OUT') { if (authReady) lockApp(); return; }
    if (!authReady || authBusy || event === 'INITIAL_SESSION') return;
    const epoch = authEpoch;
    setTimeout(() => {
      if (epoch !== authEpoch || authRecoveryRequested) return;
      refreshAuthConnection(session).catch(() => {});
    }, 0);
  }).data.subscription;
}

async function preparePasswordRecovery() {
  if (authRecoveryTask) return authRecoveryTask;
  authRecoveryIdentity = null;
  lockApp();
  showRecoveryScreen();
  const epoch = authEpoch;
  authRecoveryTask = (async () => {
    try {
      if (!authRecoverySession) throw new Error('AUTH_REQUIRED');
      const identity = await verifyAuthSession(authRecoverySession);
      // Il marker locale conserva la schermata, non autorizza il cambio password.
      const { data: assurance, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel(authRecoverySession.access_token);
      if (error) throw error;
      if (!assurance?.currentAuthenticationMethods?.some(method => (typeof method === 'string' ? method : method.method) === 'recovery')) throw new Error('AUTH_REQUIRED');
      if (epoch !== authEpoch || !authRecoveryRequested) return;
      authRecoveryIdentity = identity;
      document.getElementById('newPassword').disabled = false;
      document.getElementById('confirmPassword').disabled = false;
      document.getElementById('recoverySubmit').disabled = false;
      document.getElementById('newPassword').focus();
    } catch (_) {
      if (epoch === authEpoch) showRecoveryScreen('Link non valido, scaduto o non verificabile. Richiedi un nuovo link di recupero.');
    }
  })();
  try { await authRecoveryTask; } finally { authRecoveryTask = null; }
}

async function updateRecoveryPassword(password) {
  if (!password || !authRecoveryRequested || !authRecoveryIdentity || !authRecoverySession) throw new Error('AUTH_REQUIRED');
  const epoch = authEpoch;
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  const identity = await verifyAuthSession(data?.session);
  if (epoch !== authEpoch || !authRecoveryRequested || identity.uid !== authRecoveryIdentity.uid
      || data.session.access_token !== authRecoverySession.access_token) throw new Error('AUTH_CHANGED');
  const result = await sb.auth.updateUser({ password });
  if (result.error) throw result.error;
  if (epoch !== authEpoch || !authRecoveryRequested) throw new Error('AUTH_CHANGED');
}

async function leavePasswordRecovery(message = '') {
  authRecoveryRequested = false;
  authRecoverySession = null;
  authRecoveryIdentity = null;
  resolveAuthRecoveryEvent?.();
  resolveAuthRecoveryEvent = null;
  authRecoveryEvent = null;
  sessionStorage.removeItem(AUTH_RECOVERY_KEY);
  await signOutApp();
  if (message) {
    document.getElementById('authNotice').textContent = message;
    document.getElementById('authNotice').classList.remove('hidden');
  }
}

const authStorage = {
  getItem(key) {
    const temporary = sessionStorage.getItem(key);
    return temporary === null ? localStorage.getItem(key) : temporary;
  },
  setItem(key, value) {
    const target = authRemember ? localStorage : sessionStorage;
    const other = authRemember ? sessionStorage : localStorage;
    target.setItem(key, value);
    other.removeItem(key);
  },
  removeItem(key) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
};

function isAppAuthorized() {
  return !!authIdentity && authIdentity.person === currentUser && authIdentity.expiresAt > Date.now();
}

function requireAppIdentity() {
  if (!isAppAuthorized()) {
    if (authIdentity) lockApp('Sessione scaduta. Accedi di nuovo.');
    throw new Error('AUTH_REQUIRED');
  }
}

function assertAuthEpoch(epoch) {
  requireAppIdentity();
  if (epoch !== authEpoch) throw new Error('AUTH_CHANGED');
}

function isAuthFailure(error) {
  return !!error && ([401, 403].includes(error.status)
    || ['42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(error.code)
    || error.name === 'AuthSessionMissingError'
    || error.name === 'AuthApiError' && error.status !== 429 && error.status !== 0 && error.status < 500);
}

function handleDataAuthError(error) {
  if (!isAuthFailure(error)) return;
  lockApp('Sessione non valida o accesso negato. Accedi di nuovo.');
  throw new Error('AUTH_DENIED');
}

function clearSensitiveData() {
  for (const key of ['movies', 'movie_nights', 'votes', 'vetoes', 'swipes', 'swipe_sessions', 'mirror_owner', 'user']) {
    localStorage.removeItem('scorochiatu_' + key);
    sessionStorage.removeItem('scorochiatu_' + key);
  }
  movies = []; movieNights = []; vetoes = []; votes = [];
  swipeSessions = []; swipes = [];
  if (resyncTimer) { clearTimeout(resyncTimer); resyncTimer = null; }
  if (matchResyncTimer) { clearTimeout(matchResyncTimer); matchResyncTimer = null; }
}

function lockApp(message = '') {
  authEpoch++;
  authIdentity = null;
  currentUser = null;
  unsubscribeRealtime();
  leaveMatch(true);
  clearSensitiveData();
  document.querySelectorAll('[id$="Modal"]').forEach(modal => modal.classList.add('hidden'));
  showLanding();
  if (message) {
    document.getElementById('authNotice').textContent = message;
    document.getElementById('authNotice').classList.remove('hidden');
  }
}

// Un fallimento Auth non è mai convertito in fallback offline. Un accesso
// offline è ammesso solo dopo verifica online nello stesso runtime, con JWT non scaduto.
async function verifyAuthSession(session) {
  if (!session?.access_token || !session.user?.id) throw new Error('AUTH_REQUIRED');
  const { data: userData, error: userError } = await sb.auth.getUser(session.access_token);
  if (userError) throw userError;
  const uid = userData?.user?.id;
  if (!uid || uid !== session.user.id) throw new Error('AUTH_REQUIRED');
  const { data: member, error } = await sb.from('app_members').select('user_id,person').eq('user_id', uid).maybeSingle();
  if (error) throw error;
  if (!member || member.user_id !== uid || !['N', 'V'].includes(member.person)) throw new Error('AUTH_NOT_MEMBER');
  const expiresAt = Number(session.expires_at) * 1000;
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('AUTH_EXPIRED');
  return { uid, person: member.person, expiresAt };
}

async function establishAuth(session, expectedPerson = null) {
  if (authRecoveryRequested) throw new Error('AUTH_RECOVERY');
  const epoch = authEpoch;
  const identity = await verifyAuthSession(session);
  if (epoch !== authEpoch) throw new Error('AUTH_CHANGED');
  if (expectedPerson && identity.person !== expectedPerson) throw new Error('AUTH_NOT_MEMBER');
  await sb.realtime.setAuth(session.access_token);
  if (epoch !== authEpoch) throw new Error('AUTH_CHANGED');
  if (authIdentity && authIdentity.uid !== identity.uid) lockApp();
  if (!authIdentity) {
    if (localStorage.getItem('scorochiatu_mirror_owner') !== identity.uid) clearSensitiveData();
    authEpoch++;
  }
  authIdentity = identity;
  currentUser = identity.person;
  // Supabase Auth aggiorna già il token SDK; setAuth esplicita il contratto
  // del trasporto privato, senza ricreare canali a ogni refresh.
  return identity;
}

async function validateCurrentAuth() {
  requireAppIdentity();
  const epoch = authEpoch;
  const { data, error } = await sb.auth.getSession();
  assertAuthEpoch(epoch);
  if (error) { handleDataAuthError(error); throw error; }
  try {
    const identity = await verifyAuthSession(data?.session);
    assertAuthEpoch(epoch);
    if (identity.uid !== authIdentity.uid || identity.person !== currentUser) throw new Error('AUTH_CHANGED');
    authIdentity = identity;
  } catch (error) {
    if (epoch !== authEpoch) throw new Error('AUTH_CHANGED');
    if (String(error.message).startsWith('AUTH_') || isAuthFailure(error)) {
      lockApp('Sessione non valida o accesso negato. Accedi di nuovo.');
      throw new Error('AUTH_REQUIRED');
    }
    // Solo errori di rete/server possono conservare un'identità già verificata.
    assertAuthEpoch(epoch);
    throw error;
  }
}

async function initializeAuth() {
  showLanding();
  sessionStorage.removeItem('scorochiatu_user');
  localStorage.removeItem('scorochiatu_user');
  authRemember = !authRecoveryRequested && localStorage.getItem(AUTH_STORAGE_KEY) !== null;
  if (!sb?.auth) { lockApp('Accesso non disponibile. Controlla la connessione.'); return; }
  authReady = true;
  attachAuthListener();
  const epoch = authEpoch;
  try {
    const initialized = await sb.auth.initialize();
    if (initialized.error) {
      if (authRecoveryRequested) {
        lockApp();
        showRecoveryScreen('Link non valido o scaduto. Richiedi un nuovo link di recupero.');
        return;
      }
      throw initialized.error;
    }
    // Il SDK emette PASSWORD_RECOVERY dopo aver salvato la sessione.
    // Attendiamo l'evento, senza inferire l'autorizzazione dai parametri URL.
    if (authRecoveryEvent) {
      showRecoveryScreen();
      await authRecoveryEvent;
      authRecoveryEvent = null;
    }
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    const recoveryOwner = sessionStorage.getItem(AUTH_RECOVERY_KEY);
    if (recoveryOwner) authRecoveryRequested = true;
    if (authRecoveryRequested) {
      if (recoveryOwner && recoveryOwner === data?.session?.user?.id) authRecoverySession = data.session;
      await preparePasswordRecovery();
      return;
    }
    if (!data?.session) { lockApp(); return; }
    await establishAuth(data.session);
    showApp();
  } catch (_) {
    if (epoch === authEpoch) lockApp('Accedi online per verificare la sessione.');
  }
}

async function refreshAuthConnection(session = null) {
  if (authRecoveryRequested) return;
  if (authRefreshTask) return authRefreshTask;
  authRefreshTask = (async () => {
    const hadIdentity = isAppAuthorized();
    const refreshEpoch = authEpoch;
    try {
      if (!session) {
        const result = await sb.auth.getSession();
        if (result.error) throw result.error;
        session = result.data?.session;
      }
      await establishAuth(session);
      if (!hadIdentity) showApp();
      else {
        subscribeRealtime();
        await resyncQuiet();
        if (currentTab === 'match' && !matchChannel) await enterMatch();
      }
    } catch (error) {
      if (refreshEpoch !== authEpoch) return;
      if (isAuthFailure(error) || String(error.message).startsWith('AUTH_') || !isAppAuthorized()) lockApp('Accedi online per verificare la sessione.');
      // Un guasto di rete con identità valida non apre l'app a utenti nuovi.
    }
  })();
  try { await authRefreshTask; } finally { authRefreshTask = null; }
}

async function signInPerson(person, password, remember) {
  if (authRecoveryRequested) throw new Error('AUTH_RECOVERY');
  if (!sb?.auth || !CONFIG.AUTH_EMAILS?.[person]) throw new Error('AUTH_NOT_CONFIGURED');
  authBusy = true;
  authEpoch++;
  const loginEpoch = authEpoch;
  try {
    authRemember = !!remember;
    authStorage.removeItem(AUTH_STORAGE_KEY);
    const { data, error } = await sb.auth.signInWithPassword({ email: CONFIG.AUTH_EMAILS[person], password });
    if (error) throw error;
    if (loginEpoch !== authEpoch) throw new Error('AUTH_CHANGED');
    await establishAuth(data.session, person);
  } catch (error) {
    lockApp();
    authStorage.removeItem(AUTH_STORAGE_KEY);
    await sb.auth.signOut({ scope: 'local' }).catch(() => {});
    throw error;
  } finally { authBusy = false; }
}

async function signOutApp() {
  lockApp();
  authStorage.removeItem(AUTH_STORAGE_KEY);
  if (sb?.auth) await sb.auth.signOut({ scope: 'local' }).catch(() => {});
  authStorage.removeItem(AUTH_STORAGE_KEY);
  // Assicura che la socket non conservi il JWT dopo il logout locale.
  if (sb?.realtime) sb.realtime.disconnect();
}

window.addEventListener('online', () => {
  if (authIdentity) refreshAuthConnection().catch(() => {});
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && authIdentity) refreshAuthConnection().catch(() => {});
});
