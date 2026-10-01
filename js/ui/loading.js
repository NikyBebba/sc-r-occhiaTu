// Phase 28 — loader della libreria al primo ingresso. Il ritardo evita un
// flash dello skeleton quando il mirror locale o Supabase rispondono subito.
let initialLoadingTimer = null;
let initialLoadingPending = false;

function initialLoadingHtml() {
  const card = `<div class="loading-movie-card" aria-hidden="true">
    <div class="loading-poster"></div>
    <div class="loading-card-body"><div class="loading-line loading-line-title"></div><div class="loading-line"></div><div class="loading-line loading-line-short"></div></div>
  </div>`;
  return card + card;
}

function showInitialLoading() {
  if (!initialLoadingPending || currentTab === 'match' || currentTab === 'calendar') return;
  const grid = document.getElementById('movieGrid');
  if (!grid) return;
  grid.innerHTML = initialLoadingHtml();
  const banner = document.getElementById('initialLoadingBanner');
  if (banner) banner.classList.remove('hidden');
  const library = document.getElementById('librarySection');
  if (library) library.setAttribute('aria-busy', 'true');
}

function beginInitialLoading() {
  finishInitialLoading();
  initialLoadingPending = true;
  initialLoadingTimer = setTimeout(() => {
    initialLoadingTimer = null;
    showInitialLoading();
  }, 160);
}

function finishInitialLoading() {
  initialLoadingPending = false;
  if (initialLoadingTimer) clearTimeout(initialLoadingTimer);
  initialLoadingTimer = null;
  const banner = document.getElementById('initialLoadingBanner');
  if (banner) banner.classList.add('hidden');
  const library = document.getElementById('librarySection');
  if (library) library.setAttribute('aria-busy', 'false');
}
