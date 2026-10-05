// Palette dell'interfaccia: preferenza locale al dispositivo, dati condivisi invariati.
const THEME_KEY = 'scorochiatu_theme';
const THEME_OPTIONS = [
  { id: 'classic', label: 'Cinema', scene: '#0f172a', accent: '#6366f1', detail: '#38bdf8' },
  { id: 'cinema', label: 'Cinema Noir', scene: '#08090d', accent: '#b91c1c', detail: '#fbbf24' },
  { id: 'vhs', label: 'VHS', scene: '#100b1b', accent: '#be185d', detail: '#22d3ee' },
  { id: 'halloween', label: 'Halloween', scene: '#0b0a14', accent: '#ea6a00', detail: '#a855f7' },
  { id: 'natale', label: 'Natale', scene: '#07140f', accent: '#dc2626', detail: '#fde047' },
  { id: 'primavera', label: 'Primavera', scene: '#100b1d', accent: '#8b5cf6', detail: '#f472b6' },
  { id: 'estate', label: 'Estate', scene: '#030f1c', accent: '#0284c7', detail: '#38bdf8' },
  { id: 'autunno', label: 'Autunno', scene: '#150d09', accent: '#c2410c', detail: '#f59e0b' }
];
let currentTheme = 'classic';

function renderThemeOptions() {
  if (typeof document === 'undefined') return;
  const box = document.getElementById('themeOptions');
  if (!box) return;
  box.innerHTML = THEME_OPTIONS.map(option => `
    <button type="button" class="theme-option${option.id === currentTheme ? ' is-selected' : ''}"
      onclick="chooseTheme('${option.id}')" aria-pressed="${option.id === currentTheme}"
      style="--preview-scene:${option.scene};--preview-accent:${option.accent};--preview-detail:${option.detail}">
      <span class="theme-option-art" aria-hidden="true"><i class="fa-solid fa-film"></i></span>
      <span class="theme-option-name">${option.label}</span>
      <i class="fa-solid ${option.id === currentTheme ? 'fa-circle-check' : 'fa-arrow-right'} theme-option-indicator" aria-hidden="true"></i>
    </button>`).join('');
}

function setTheme(name) {
  const option = THEME_OPTIONS.find(item => item.id === name) || THEME_OPTIONS[0];
  currentTheme = option.id;
  if (typeof document !== 'undefined' && document.documentElement) {
    if (currentTheme === 'classic') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', currentTheme);
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      const meta = document.querySelector('meta[name="theme-color"]');
      const surface = window.getComputedStyle(document.documentElement).getPropertyValue('--color-sala').trim();
      if (meta && surface) meta.setAttribute('content', surface);
    }
  }
  const label = typeof document !== 'undefined' ? document.getElementById('themePickerLabel') : null;
  if (label) label.textContent = option.label;
  const button = typeof document !== 'undefined' ? document.getElementById('themePickerBtn') : null;
  if (button) button.title = 'Tema: ' + option.label;
  renderThemeOptions();
  try { localStorage.setItem(THEME_KEY, currentTheme); } catch (_) { /* preferenza facoltativa */ }
  return currentTheme;
}

function loadTheme() {
  let saved = 'classic';
  try { saved = localStorage.getItem(THEME_KEY) || 'classic'; } catch (_) { /* storage non disponibile */ }
  return setTheme(saved);
}

function openThemePicker() {
  renderThemeOptions();
  if (typeof openModal === 'function') openModal('themeModal');
  const selected = typeof document !== 'undefined' ? document.querySelector('.theme-option.is-selected') : null;
  if (selected && typeof selected.focus === 'function') selected.focus();
}

function chooseTheme(name) {
  setTheme(name);
  if (typeof drawWheel === 'function') drawWheel();
  if (typeof closeModal === 'function') closeModal('themeModal');
}

loadTheme();
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', loadTheme);
