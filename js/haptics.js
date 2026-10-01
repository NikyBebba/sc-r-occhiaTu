// Vibrazione locale e facoltativa: ogni telefono conserva la propria scelta.
// I browser senza Vibration API continuano senza mostrare il controllo.
const HAPTICS_KEY = 'scorochiatu_haptics';
let hapticsEnabled = false;

function hapticsSupported() {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

function loadHapticsPreference() {
  try { hapticsEnabled = localStorage.getItem(HAPTICS_KEY) === 'on'; }
  catch (error) { hapticsEnabled = false; }
  renderHapticsControl();
}

function renderHapticsControl() {
  const button = document.getElementById('hapticsToggle');
  if (!button) return;
  const supported = hapticsSupported();
  button.classList.toggle('hidden', !supported);
  button.classList.toggle('bg-indigo-600/30', supported && hapticsEnabled);
  button.setAttribute('aria-pressed', String(supported && hapticsEnabled));
  const label = hapticsEnabled ? 'Disattiva vibrazione' : 'Attiva vibrazione';
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  const text = document.getElementById('hapticsLabel');
  if (text) text.textContent = `Vibrazione su questo telefono: ${hapticsEnabled ? 'attiva' : 'spenta'}`;
}

function toggleHaptics() {
  if (!hapticsSupported()) return;
  hapticsEnabled = !hapticsEnabled;
  try { localStorage.setItem(HAPTICS_KEY, hapticsEnabled ? 'on' : 'off'); }
  catch (error) { /* La scelta resta valida fino alla chiusura della pagina. */ }
  renderHapticsControl();
  if (hapticsEnabled) hapticFeedback('tap');
}

function hapticFeedback(kind) {
  if (!hapticsEnabled || !hapticsSupported() || document.visibilityState === 'hidden') return false;
  const patterns = { tap: 12, swipe: 18, wheelStart: 20, wheelWin: [35, 45, 65] };
  if (!Object.prototype.hasOwnProperty.call(patterns, kind)) return false;
  try { return !!navigator.vibrate(patterns[kind]); }
  catch (error) { return false; }
}
