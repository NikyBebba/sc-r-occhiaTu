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
let authRecoveryReceived = false;
let authRecoveryRevision = 0;
let authRecoveryError = null;
let authRecoverySession = null;
let authRecoveryIdentity = null;
let authRecoveryTask = null;
let authRecoveryTaskRevision = -1;
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
      authRecoveryReceived = true;
      authRecoveryRevision++;
      authRecoveryError = null;
      authRecoverySession = session;
      resolveAuthRecoveryEvent?.();
      resolveAuthRecoveryEvent = null;
      authRecoveryIdentity = null;
      authIdentity = null;
      authRemember = false;
      authEpoch++;
      if (session?.user?.id) sessionStorage.setItem(AUTH_RECOVERY_KEY, session.user.id);
      if (authReady) {
        showRecoveryScreen();
        setTimeout(() => preparePasswordRecovery().catch(() => {}), 0);
      }
      return;
    }
    if (authRecoveryRequested) {
      if (event === 'TOKEN_REFRESHED' && session?.user?.id === authRecoverySession?.user?.id) {
        authRecoverySession = session;
        authRecoveryIdentity = null;
        authRecoveryRevision++;
        if (authReady) {
          showRecoveryScreen();
          setTimeout(() => preparePasswordRecovery().catch(() => {}), 0);
        }
      }
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN' && authRecoveryReceived
          && session?.user?.id !== authRecoverySession?.user?.id) {
        authEpoch++;
        authRecoveryRevision++;
        authRecoverySession = null;
        authRecoveryIdentity = null;
        if (authReady) showRecoveryFailure(new Error('AUTH_REQUIRED'), 'session');
      }
      return;
    }
    if (event === 'SIGNED_OUT') { if (authReady) lockApp(); return; }
    if (!authReady || authBusy || event === 'INITIAL_SESSION'
        || sessionStorage.getItem(AUTH_RECOVERY_KEY) && !authRecoveryReceived) return;
    const epoch = authEpoch;
    setTimeout(() => {
      if (epoch !== authEpoch || authRecoveryRequested) return;
      refreshAuthConnection(session).catch(() => {});
    }, 0);
  }).data.subscription;
}

// Diagnostica solo per categorie/fasi: nessun errore SDK, token o password conservato.
function recoveryFailure(error, stage) {
  let category;
  if (error?.recoveryCategory) return error;
  if (['AUTH_EXPIRED', 'AUTH_CHANGED'].includes(error?.message)
      || ['AuthSessionMissingError', 'AuthImplicitGrantRedirectError', 'AuthInvalidJwtError'].includes(error?.name)
      || ['otp_expired', 'bad_jwt', 'session_not_found', 'refresh_token_not_found', 'refresh_token_already_used'].includes(error?.code)
      || stage !== 'membership' && [401, 403].includes(error?.status)) category = 'INVALID_SESSION';
  else if (error?.status === 0 || error?.status === 429 || error?.status >= 500
      || error?.name === 'AuthRetryableFetchError' || error?.name === 'TypeError') category = 'SERVICE_UNAVAILABLE';
  else if (stage === 'membership') category = error?.message === 'AUTH_NOT_MEMBER'
      || [401, 403].includes(error?.status) || error?.code === '42501'
      ? 'MEMBERSHIP_UNAUTHORIZED' : 'SERVICE_UNAVAILABLE';
  else if (stage === 'user') category = 'USER_UNVERIFIABLE';
  else category = 'INVALID_SESSION';
  const failure = new Error(category);
  failure.recoveryCategory = category;
  failure.recoveryStage = stage;
  return failure;
}

function showRecoveryFailure(error, stage) {
  const failure = recoveryFailure(error, stage);
  authRecoveryError = { category: failure.recoveryCategory, stage: failure.recoveryStage };
  const messages = {
    INVALID_SESSION: 'Sessione di recupero non valida o scaduta. Richiedi un nuovo link.',
    USER_UNVERIFIABLE: 'Impossibile verificare l’account per il recupero. Richiedi un nuovo link.',
    MEMBERSHIP_UNAUTHORIZED: 'Account non autorizzato al recupero in questa app.',
    SERVICE_UNAVAILABLE: 'Recupero non verificabile: connessione o servizio non disponibile. Riprova quando la connessione è disponibile.'
  };
  showRecoveryScreen(messages[failure.recoveryCategory]);
}

async function preparePasswordRecovery() {
  if (!authRecoveryRequested || !authRecoveryReceived) return;
  const revision = authRecoveryRevision;
  if (authRecoveryTask && authRecoveryTaskRevision === revision) return authRecoveryTask;
  authRecoveryIdentity = null;
  lockApp();
  showRecoveryScreen();
  const epoch = authEpoch;
  const session = authRecoverySession;
  // Un nuovo contesto parte subito, anche se la query precedente è ancora pendente.
  // Solo la risposta della revisione corrente può modificare la schermata.
  const task = (async () => {
    try {
      const identity = await verifyAuthSession(session, true);
      if (revision !== authRecoveryRevision || epoch !== authEpoch || !authRecoveryReceived) return;
      authRecoveryIdentity = identity;
      authRecoveryError = null;
      document.getElementById('newPassword').disabled = false;
      document.getElementById('confirmPassword').disabled = false;
      document.getElementById('recoverySubmit').disabled = authRecoveryBusy;
      document.getElementById('newPassword').focus();
    } catch (error) {
      if (revision === authRecoveryRevision && epoch === authEpoch) showRecoveryFailure(error, 'session');
    }
  })();
  authRecoveryTask = task;
  authRecoveryTaskRevision = revision;
  try { await task; } finally { if (authRecoveryTask === task) authRecoveryTask = null; }
}

async function updateRecoveryPassword(password) {
  if (!password || !authRecoveryReceived || !authRecoveryRequested || !authRecoveryIdentity || !authRecoverySession) throw recoveryFailure(new Error('AUTH_REQUIRED'), 'context');
  const epoch = authEpoch;
  const revision = authRecoveryRevision;
  const preparedIdentity = authRecoveryIdentity;
  const { data, error } = await sb.auth.getSession();
  if (error) throw recoveryFailure(error, 'session');
  const identity = await verifyAuthSession(data?.session, true);
  if (epoch !== authEpoch || revision !== authRecoveryRevision || !authRecoveryReceived
      || identity.uid !== preparedIdentity.uid || identity.person !== preparedIdentity.person
      || data.session.access_token !== authRecoverySession.access_token) throw recoveryFailure(new Error('AUTH_CHANGED'), 'session');
  const result = await sb.auth.updateUser({ password });
  if (result.error) throw result.error;
  if (epoch !== authEpoch || revision !== authRecoveryRevision || !authRecoveryReceived) throw recoveryFailure(new Error('AUTH_CHANGED'), 'session');
}

async function leavePasswordRecovery(message = '') {
  authRecoveryRequested = false;
  authRecoveryReceived = false;
  authRecoveryRevision++;
  authRecoveryError = null;
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
async function verifyAuthSession(session, recovery = false) {
  let stage = 'session';
  try {
    if (!session?.access_token || !session.user?.id) throw new Error('AUTH_REQUIRED');
    stage = 'user';
    const { data: userData, error: userError } = await sb.auth.getUser(session.access_token);
    if (userError) throw userError;
    const uid = userData?.user?.id;
    if (!uid || uid !== session.user.id) throw new Error('AUTH_REQUIRED');
    stage = 'membership';
    const result = await sb.from('app_members').select('user_id,person').eq('user_id', uid).maybeSingle();
    const { data: member, error } = result;
    if (error) {
      if (recovery) throw recoveryFailure({ status: result.status ?? error.status, code: error.code, name: error.name }, stage);
      throw error;
    }
    if (!member || member.user_id !== uid || !['N', 'V'].includes(member.person)) throw new Error('AUTH_NOT_MEMBER');
    stage = 'session';
    const expiresAt = Number(session.expires_at) * 1000;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('AUTH_EXPIRED');
    return { uid, person: member.person, expiresAt };
  } catch (error) {
    if (recovery) throw recoveryFailure(error, stage);
    throw error;
  }
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
        showRecoveryFailure(initialized.error, 'bootstrap');
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
    if (recoveryOwner && !authRecoveryReceived) {
      // Un marker modificabile non può ricreare l'evento SDK dopo un reload.
      await leavePasswordRecovery('Recupero interrotto. Richiedi un nuovo link per impostare la password.');
      return;
    }
    if (authRecoveryRequested) {
      if (authRecoveryReceived && authRecoverySession?.user?.id === data?.session?.user?.id) authRecoverySession = data.session;
      await preparePasswordRecovery();
      return;
    }
    if (!data?.session) { lockApp(); return; }
    await establishAuth(data.session);
    showApp();
  } catch (error) {
    if (authRecoveryRequested) showRecoveryFailure(error, 'bootstrap');
    else if (epoch === authEpoch) lockApp('Accedi online per verificare la sessione.');
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
