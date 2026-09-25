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
        ? "flex-1 py-2 rounded-lg font-medium transition text-white whitespace-nowrap relative z-10"
        : "flex-1 py-2 rounded-lg font-medium transition text-slate-400 hover:text-white whitespace-nowrap relative z-10";
      btn.setAttribute('aria-selected', String(k === tab));
    });
    // Pillola animata: sposta l'indicatore sotto il tab attivo (e variante
    // gradiente cielo→indigo sul tab Match).
    updateTabIndicator();
    // Entra: sonda (se serve), sessione attiva e canale dedicato. Async: la
    // vista mostra "Connessione…" finché il canale non è subscribed. Se
    // l'ingresso fallisce per un errore reale, enterMatch gestisce tutto da
    // sé; questo catch resta come rete NON silenziosa (mai ReferenceError
    // non gestito: console.error + vista "Match non disponibile").
    enterMatch().catch(e => reportMatchEnterError(e));
    render();
    return;
  }
  // Uscendo dal Match (qualsiasi altro tab): leaveMatch fa SOLO untrack della
  // presence (il canale PERSISTENTE resta aperto e SUBSCRIBED — al rientro un
  // nuovo track + refetch). La sessione resta attiva, premere Match la riprende.
  if (currentTab === 'match') {
    clearMatchState();
    leaveMatch();
  }
  currentTab = tab;
  TAB_KEYS.forEach(k => {
    const btn = document.getElementById(TAB_ID(k));
    if (!btn) return; // mai assumere che l'id esista (guardia id inesistenti)
    btn.className = k === tab
      ? "flex-1 py-2 rounded-lg font-medium transition text-white whitespace-nowrap relative z-10"
      : "flex-1 py-2 rounded-lg font-medium transition text-slate-400 hover:text-white whitespace-nowrap relative z-10";
    btn.setAttribute('aria-selected', String(k === tab));
  });
  updateTabIndicator();
  render();
}

// Pillola animata dello segmented control: #tabIndicator (absolute inside
// #segControl) trasla left/width per stare sotto il tab attivo. La variante
// 'seg-active-match' (gradiente cielo→indigo) si attiva quando la pill Match
// è quella selezionata. Guardie: in ambienti privi di geometrie (stub/harness)
// l'indicatore resta spento, mai errori.
function updateTabIndicator() {
  const seg = document.getElementById('segControl');
  const indicator = document.getElementById('tabIndicator');
  const btn = document.getElementById(TAB_ID(currentTab));
  if (!seg || !indicator || !btn) return;
  indicator.classList.toggle('seg-active-match', currentTab === 'match');
  if (typeof btn.getBoundingClientRect !== 'function' || typeof seg.getBoundingClientRect !== 'function') {
    indicator.style.opacity = '0';
    return;
  }
  indicator.style.opacity = '';
  const segRect = seg.getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  indicator.style.left = (btnRect.left - segRect.left) + 'px';
  indicator.style.width = btnRect.width + 'px';
}

// Riallinea l'indicatore al resize (debounce ~150ms; transition in CSS, mai
// qui) e alle rotazioni mobile. L'ascolto è inerte negli harness (stub).
let tabIndicatorResizeTimer = null;
window.addEventListener('resize', () => {
  if (tabIndicatorResizeTimer) clearTimeout(tabIndicatorResizeTimer);
  tabIndicatorResizeTimer = setTimeout(updateTabIndicator, 150);
});
