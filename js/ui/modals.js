// ============================================
// UI — helper condivisi, anti-XSS e modali generici
// ============================================

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// ---- Utilità anti-XSS per testi provenienti dall'utente ----
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Escape per una stringa JS dentro attributo onclick (delimitato da doppie virgolette HTML)
function jsAttrEscape(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

const MOOD_LABELS = {
  romantico: '💕 Romantico', risata: '😂 Risata', paura: '👻 Paura',
  nostalgia: '🕰️ Nostalgia', azione: '💥 Azione', altro: '🎞️ Altro'
};

function personBadge(code) {
  const p = CONFIG.PEOPLE[code] || { label: code || '?', badgeClass: 'badge-n' };
  return `<span class="badge ${p.badgeClass}">${p.label}</span>`;
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