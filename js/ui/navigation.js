// ============================================
// UI — navigazione tab (Watchlist / Stasera / Visti)
// ============================================

let currentTab = 'watchlist';

function setTab(tab) {
  currentTab = tab;
  ['Watchlist', 'Tonight', 'Watched'].forEach(t => {
    const btn = document.getElementById('tab' + t);
    const key = t.toLowerCase();
    btn.className = key === tab
      ? "flex-1 py-2 rounded-lg font-medium transition bg-indigo-600 text-white relative"
      : "flex-1 py-2 rounded-lg font-medium transition text-slate-400 hover:text-white relative";
  });
  render();
}