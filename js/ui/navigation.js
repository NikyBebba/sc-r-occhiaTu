// ============================================
// UI — navigazione pill (Tutti / Da Vedere / Stasera / Visti / Calendario)
// ============================================

let currentTab = 'watchlist'; // 'all' | 'watchlist' | 'tonight' | 'watched' | 'calendar'

const TAB_KEYS = ['all', 'watchlist', 'tonight', 'watched', 'calendar'];
const TAB_ID = k => 'tab' + k[0].toUpperCase() + k.slice(1);

function setTab(tab) {
  if (!TAB_KEYS.includes(tab)) return;
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
