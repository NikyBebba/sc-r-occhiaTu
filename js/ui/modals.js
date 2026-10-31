// ============================================
// UI — helper condivisi, anti-XSS e modali generici
// ============================================

// Apertura/chiusura modali con stack per la chiusura LIFO (Esc su top).
// openModal sullo stesso id NON duplica mai lo stack: un solo Esc lo chiude.
let modalStack = [];
let memoriesReturnFocus = null;
const modalReturnFocus = new Map();
let modalBodyOverflow = null;

// Nested editors must remain above their originating movie detail.
function syncModalStackOrder() {
  modalStack.forEach((id,index)=>{const node=document.getElementById(id);if(node)node.style.zIndex=String(50+index*10);});
}

// Authentication teardown resets presentation only, including non-route dialogs.
function resetModalPresentation() {
  for(const id of modalStack){const node=document.getElementById(id);if(node)node.style.zIndex='';}
  modalStack = []; modalReturnFocus.clear(); memoriesReturnFocus = null;
  if (document.body?.style && modalBodyOverflow !== null) document.body.style.overflow = modalBodyOverflow;
  modalBodyOverflow = null;
}

function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.classList.contains('hidden')) modalReturnFocus.set(id, document.activeElement);
  if (!modalStack.length && document.body?.style) { modalBodyOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
  if (id === 'statsModal' && el.classList.contains('hidden')) {
    memoriesReturnFocus = document.activeElement;
    if (typeof prepareMemoriesOpening === 'function') prepareMemoriesOpening();
  }
  el.classList.remove('hidden');
  if (!modalStack.includes(id)) modalStack.push(id);
  syncModalStackOrder();
  wireBackdropClose(el, id);
  // ARIA (Phase 31): ogni modale è un dialog col suo titolo come referente.
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  const heading = el.querySelector('h2, h3');
  if (heading) {
    if (!heading.id) heading.id = id + 'Title';
    el.setAttribute('aria-labelledby', heading.id);
  }
  if (typeof syncDestinationNavigation === 'function') syncDestinationNavigation();
  const app = document.getElementById('appRoot');
  if (app) app.inert = true;
  if (id === 'detailModal' || id === 'sagaModal') el.querySelector('button')?.focus();
  if (id === 'statsModal') el.querySelector('.memories-header button')?.focus();
}

function closeModal(id) {
  if (id === 'detailModal' && typeof closeMovieDetailWithTransition === 'function'
      && closeMovieDetailWithTransition(() => closeModalNow(id))) return;
  closeModalNow(id);
}

function closeModalNow(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
  modalStack = modalStack.filter(x => x !== id);
  if(el)el.style.zIndex='';
  syncModalStackOrder();
  const app = document.getElementById('appRoot');
  if (app) app.inert = modalStack.length > 0;
  if (!modalStack.length && document.body?.style && modalBodyOverflow !== null) { document.body.style.overflow = modalBodyOverflow; modalBodyOverflow = null; }
  const returnTo = modalReturnFocus.get(id); modalReturnFocus.delete(id);
  if (returnTo?.isConnected && !returnTo.closest?.('[inert]')) returnTo.focus?.({preventScroll:true});
  else if(returnTo&&modalStack.length){
    // A TARGET resync may replace the originating button while its editor is
    // open. Return to the matching control in the still-open underlying modal.
    const parent=document.getElementById(modalStack[modalStack.length-1]);
    const candidates=[...(parent?.querySelectorAll('button,summary,a,input')||[])];
    const key=returnTo.dataset?.returnFocusKey;
    const replacement=candidates.find(node=>key?node.dataset?.returnFocusKey===key:node.tagName===returnTo.tagName&&node.textContent===returnTo.textContent)||candidates[0];
    replacement?.focus?.({preventScroll:true});
  }
  if (typeof syncDestinationNavigation === 'function') syncDestinationNavigation();
  if (id === 'detailModal' && typeof restoreMovieDetailFocus === 'function') restoreMovieDetailFocus();
  if (id === 'reviewModal' && typeof reviewEditorClosed === 'function') reviewEditorClosed();
  if (id === 'statsModal' && !modalStack.length && isAppAuthorized()) memoriesReturnFocus?.focus?.({ preventScroll: true });
  if (id === 'addSeenModal' && typeof pendingAddSeen !== 'undefined') pendingAddSeen = null;
  if (id === 'themeModal') {
    const trigger = document.getElementById('themePickerBtn');
    if (trigger && typeof trigger.focus === 'function') trigger.focus();
  }
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
function showConfirmModal(title, message, choices = null) {
  return new Promise(resolve => {
    const returnFocus = document.activeElement;
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    openModal('confirmModal');
    const yes = document.getElementById('confirmYes');
    const no = document.getElementById('confirmNo');
    const options = document.getElementById('confirmChoices');
    if (options) { options.innerHTML = ''; options.classList.toggle('hidden', !choices); }
    yes.classList.toggle('hidden', !!choices);
    const cleanup = (result) => {
      yes.onclick = null; no.onclick = null;
      if (options) { options.innerHTML = ''; options.classList.add('hidden'); }
      yes.classList.remove('hidden');
      closeModal('confirmModal');
      if (returnFocus?.isConnected) returnFocus.focus?.({ preventScroll: true });
      resolve(result);
    };
    if (choices && options) choices.forEach(choice => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = choice.label;
      button.dataset.removalChoice = choice.value;
      button.onclick = () => cleanup(choice.value);
      options.appendChild(button);
    });
    yes.onclick = () => cleanup(true);
    no.onclick = () => cleanup(false);
    no.focus?.();
  });
}

// Focus tastiera confinato a Ricordi e conferma; Esc usa lo stack esistente.
document.addEventListener('keydown', event => {
  if (event.key !== 'Tab' || !['statsModal', 'confirmModal', 'seenModal', 'reviewModal', 'addSeenModal', 'listCandidateModal', 'detailModal', 'scheduleModal', 'sagaModal', 'addModal', 'pickerModal'].includes(modalStackTop())) return;
  const items = [...document.getElementById(modalStackTop()).querySelectorAll('button, summary, a[href], input, select, textarea, [tabindex="0"]')]
    .filter(element => !element.disabled && element.getClientRects().length);
  const first = items[0], last = items[items.length - 1];
  if (!first) return;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
