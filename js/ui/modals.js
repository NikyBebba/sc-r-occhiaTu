// ============================================
// UI — helper condivisi, anti-XSS e modali generici
// ============================================

// Apertura/chiusura modali con stack per la chiusura LIFO (Esc su top).
// openModal sullo stesso id NON duplica mai lo stack: un solo Esc lo chiude.
let modalStack = [];

function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('hidden');
  if (!modalStack.includes(id)) modalStack.push(id);
  wireBackdropClose(el, id);
  // ARIA (Phase 31): ogni modale è un dialog col suo titolo come referente.
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  const heading = el.querySelector('h2, h3');
  if (heading) {
    if (!heading.id) heading.id = id + 'Title';
    el.setAttribute('aria-labelledby', heading.id);
  }
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
  modalStack = modalStack.filter(x => x !== id);
  // Serata dal Match ("Programma"): alla chiusura del modale di programmazione
  // (annullo, X, backdrop, Esc oppure conferma) il pending va azzerato — se
  // restasse attivo, una programmazione dello stesso film dalla lista normale
  // chiuderebbe la sessione Match dal tab sbagliato (e mostrerebbe
  // "Serata creata" fuori dal Match). Guard typeof: modals.js precede match.js.
  if (id === 'scheduleModal' && typeof matchScheduleModalClosed === 'function') {
    matchScheduleModalClosed();
  }
}

function modalStackTop() {
  return modalStack[modalStack.length - 1] || null;
}

function closeTopModal() {
  const id = modalStackTop();
  if (id) closeModal(id);
}

// Chiusura del modale di conferma generica: se il handler "Annulla" è attivo
// lo invoca (così la Promise di showConfirmModal si risolve SEMPRE, con
// false — nessun leak se l'utente chiude via X/Esc/backdrop), altrimenti
// chiude semplicemente il modale.
function cancelConfirmModal() {
  const no = document.getElementById('confirmNo');
  if (no && typeof no.onclick === 'function') no.onclick();
  closeModal('confirmModal');
}

// Backdrop: chiude SOLO se mousedown E click partono entrambi dall'overlay.
// Se si seleziona del testo in un input e si rilascia fuori dal modale il
// click arriva comunque sull'overlay: col flag del mousedown non chiudiamo.
function wireBackdropClose(el, id) {
  let downOnOverlay = false;
  el.onmousedown = e => { downOnOverlay = !!(e && e.target === el); };
  el.onclick = e => {
    if (e && e.target === el && downOnOverlay) {
      if (id === 'confirmModal') cancelConfirmModal();
      else closeModal(id);
    }
  };
}

// Esc chiude l'ultimo modale aperto (LIFO); per la conferma generica il
// comportamento è quello del pulsante "Annulla" (risolve false).
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (modalStackTop() === 'confirmModal') cancelConfirmModal();
  else closeTopModal();
});

// ---- Utilità anti-XSS per testi provenienti dall'utente ----
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Escape per una stringa JS dentro attributo onclick (delimitato da doppie virgolette HTML)
function jsAttrEscape(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function personBadge(code) {
  const p = CONFIG.PEOPLE[code] || { label: code || '?', badgeClass: 'badge-n' };
  return `<span class="badge ${p.badgeClass} person-pill" title="${escapeHtml(p.label)}"><i class="fa-solid fa-circle"></i> ${p.label}</span>`;
}

// ---- Modale conferma generica (sostituisce confirm()) ----
function showConfirmModal(title, message) {
  return new Promise(resolve => {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    openModal('confirmModal');
    const yes = document.getElementById('confirmYes');
    const no = document.getElementById('confirmNo');
    const cleanup = (result) => {
      yes.onclick = null; no.onclick = null;
      closeModal('confirmModal');
      resolve(result);
    };
    yes.onclick = () => cleanup(true);
    no.onclick = () => cleanup(false);
  });
}