// Azioni UI per sorpresa e veto settimanali.
// Riusa store/movies e store/choices, poi il refetch esistente.

// ---- Modalità sorpresa ----
function openSurprisePicker() {
  const list = movies.filter(m => m.status === 'watchlist' && !m.surprise_by);
  const container = document.getElementById('surpriseList');
  if (list.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400 italic">Nessun film disponibile da scegliere a sorpresa.</p>`;
  } else {
    container.innerHTML = list.map(m => `
      <button onclick="pickSurprise('${m.id}')" class="w-full text-left p-3 bg-slate-900/80 rounded-lg border border-slate-800 hover:border-indigo-500 transition text-sm text-slate-200">
        ${escapeHtml(m.title)}
      </button>
    `).join('');
  }
  openModal('surpriseModal');
}

async function pickSurprise(id) {
  await setSurprise(id, currentUser);
  closeModal('surpriseModal');
  loadMovies();
}

async function revealSurpriseUI(id) {
  await revealSurprise(id);
  loadMovies();
}

// ---- Veto settimanale ----
async function vetoMovie(id, title) {
  const ok = await addVeto(currentUser, id);
  if (!ok) {
    await showConfirmModal('Veto già usato', 'Hai già usato il tuo veto per questa settimana.');
    return;
  }
  loadMovies();
}

// Toglie il veto: nessuna conferma (azione reversibile, come il voto).
async function unvetoMovie(id) {
  const v = vetoForMovieThisWeek(id);
  if (!v || v.person !== currentUser) return;
  await removeVeto(currentUser, id); // 0 righe o errore => nothing to do (già rimosso)
  loadMovies();
}
