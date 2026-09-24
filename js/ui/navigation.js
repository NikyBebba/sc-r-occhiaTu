// ============================================
// UI — navigazione pill (Tutti / Da Vedere / Stasera / Visti / Calendario / Match)
// ============================================

let currentTab = 'watchlist'; // 'all' | 'watchlist' | 'tonight' | 'watched' | 'calendar' | 'match'
// Tab da cui si è entrati nel Match (per "Esci" = pausa). Default 'watchlist'.
let matchPrevTab = 'watchlist';

const TAB_KEYS = ['all', 'watchlist', 'tonight', 'watched', 'calendar', 'match'];
const TAB_ID = k => 'tab' + k[0].toUpperCase() + k.slice(1);

function setTab(tab) {
  if (!TAB_KEYS.includes(tab)) return;
  if (tab === 'match') {
    // La pill è visibile solo con Supabase; guardia anche qui (mai entrare offline).
    if (dbMode !== 'supabase') return;
    if (currentTab !== 'match') matchPrevTab = currentTab;
    currentTab = tab;
    TAB_KEYS.forEach(k => {
      const btn = document.getElementById(TAB_ID(k));
      if (!btn) return;
      btn.className = k === tab
        ? "flex-1 py-2 rounded-lg font-medium transition bg-indigo-600 text-white whitespace-nowrap"
        : "flex-1 py-2 rounded-lg font-medium transition text-slate-400 hover:text-white whitespace-nowrap";
    });
    // Entra: sonda (se serve), sessione attiva e canale dedicato. Async: la
    // vista mostra "Connessione…" finché il canale non è subscribed. Se
    // l'ingresso fallisce per un errore reale, enterMatch gestisce tutto da
    // sé; questo catch resta come rete NON silenziosa (mai ReferenceError
    // non gestito: console.error + vista "Match non disponibile").
    enterMatch().catch(e => reportMatchEnterError(e));
    render();
    return;
  }
  // Uscendo dal Match (qualsiasi altro tab): chiude SOLO il canale dello store
  // (leaveMatch) — la sessione resta attiva, premere di nuovo Match la riprende.
  if (currentTab === 'match') {
    clearMatchState();
    leaveMatch();
  }
  currentTab = tab;
  TAB_KEYS.forEach(k => {
    const btn = document.getElementById(TAB_ID(k));
    if (!btn) return; // mai assumere che l'id esista (guardia id inesistenti)
    btn.className = k === tab
      ? "flex-1 py-2 rounded-lg font-medium transition bg-indigo-600 text-white whitespace-nowrap"
      : "flex-1 py-2 rounded-lg font-medium transition text-slate-400 hover:text-white whitespace-nowrap";
  });
  render();
}
