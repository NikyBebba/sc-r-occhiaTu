// Temi locali: automatici per periodo, scelta manuale valida fino al periodo successivo.
const THEME_KEY = 'scorochiatu_theme';
const THEME_OVERRIDE_KEY = 'scorochiatu_theme_override';
const THEME_OPTIONS = [
  // ID storici conservati per compatibilità: cinema = Estate, estate = Inverno.
  { id: 'primavera', icon: 'fa-seedling', label: 'Primavera', scene: '#100b1d', accent: '#8b5cf6', detail: '#f472b6' },
  { id: 'cinema', icon: 'fa-sun', label: 'Estate', scene: '#08090d', accent: '#b91c1c', detail: '#fbbf24' },
  { id: 'autunno', icon: 'fa-leaf', label: 'Autunno', scene: '#150d09', accent: '#c2410c', detail: '#f59e0b' },
  { id: 'estate', icon: 'fa-snowflake', label: 'Inverno', scene: '#030f1c', accent: '#0284c7', detail: '#38bdf8' },
  { id: 'pasqua', icon: 'fa-egg', label: 'Pasqua', scene: '#101a19', accent: '#7c3aed', detail: '#a7f3d0' },
  { id: 'halloween', icon: 'fa-ghost', label: 'Halloween', scene: '#0b0a14', accent: '#ea6a00', detail: '#a855f7' },
  { id: 'natale', icon: 'fa-tree', label: 'Natale', scene: '#07140f', accent: '#dc2626', detail: '#fde047' },
  { id: 'capodanno', icon: 'fa-champagne-glasses', label: 'Capodanno', scene: '#050505', accent: '#936820', detail: '#e7c477' }
];
let currentTheme = 'estate';
let themeIsAutomatic = true;
let themeOverride = null;
let themeCanDrawWheel = false;

// Pasqua gregoriana: algoritmo di Oudin pubblicato dall'US Naval Observatory.
// https://aa.usno.navy.mil/faq/easter — sole operazioni intere, nessuna API.
function themeEasterDate(year) {
  const div = (a, b) => Math.floor(a / b);
  const c = div(year, 100);
  const n = year - 19 * div(year, 19);
  const k = div(c - 17, 25);
  let i = c - div(c, 4) - div(c - k, 3) + 19 * n + 15;
  i -= 30 * div(i, 30);
  i -= div(i, 28) * (1 - div(i, 28) * div(29, i + 1) * div(21 - n, 11));
  let j = year + div(year, 4) + i + 2 - c + div(c, 4);
  j -= 7 * div(j, 7);
  const l = i - j;
  const month = 3 + div(l + 40, 44);
  const day = l + 28 - 31 * div(month, 4);
  return new Date(year, month - 1, day, 12);
}

function automaticThemeFor(date = new Date()) {
  if (!date || !Number.isFinite(date.getTime())) return 'estate';
  const month = date.getMonth() + 1;
  const day = date.getDate();
  // Festività prima delle stagioni; confronto per giorno locale, senza problemi DST.
  if ((month === 12 && day >= 30) || (month === 1 && day <= 2)) return 'capodanno';
  if ((month === 12 && day >= 22) || (month === 1 && day <= 6)) return 'natale';
  if ((month === 10 && day >= 27) || (month === 11 && day <= 2)) return 'halloween';
  const easter = themeEasterDate(date.getFullYear());
  const first = new Date(easter); first.setDate(first.getDate() - 2);
  const last = new Date(easter); last.setDate(last.getDate() + 1);
  const today = new Date(date.getFullYear(), date.getMonth(), day, 12);
  if (today >= first && today <= last) return 'pasqua';
  if (month >= 3 && month <= 5) return 'primavera';
  if (month >= 6 && month <= 8) return 'cinema';
  if (month >= 9 && month <= 11) return 'autunno';
  return 'estate';
}

function themePeriodKey(date, automaticTheme) {
  // Capodanno attraversa il 1° gennaio come un unico periodo.
  const year = date.getFullYear() - (['natale', 'capodanno'].includes(automaticTheme) && date.getMonth() === 0 ? 1 : 0);
  let segment = '';
  if (automaticTheme === 'natale') segment = date.getMonth() === 0 ? ':dopo-capodanno' : ':prima-capodanno';
  // Una festività interrompe la stagione: tornando dopo la festa, una vecchia
  // scelta manuale deve scadere anche se l'app era chiusa per tutto il periodo.
  if (automaticTheme === 'autunno') segment = date.getMonth() === 10 ? ':dopo-halloween' : ':prima-halloween';
  if (automaticTheme === 'primavera') segment = date < themeEasterDate(year) ? ':prima-pasqua' : ':dopo-pasqua';
  if (automaticTheme === 'estate') segment = date.getMonth() === 11 ? ':dicembre' : ':gennaio-febbraio';
  return year + ':' + automaticTheme + segment;
}

function renderThemeOptions() {
  if (typeof document === 'undefined') return;
  const auto = document.getElementById('themeAutoBtn');
  if (auto) {
    auto.setAttribute('aria-pressed', String(themeIsAutomatic));
    auto.classList.toggle('is-selected', themeIsAutomatic);
  }
  const status = document.getElementById('themeModeStatus');
  if (status) status.textContent = themeIsAutomatic
    ? 'Il tema segue le stagioni e le festività.'
    : 'Scelta manuale: il calendario riprende al prossimo cambio di periodo.';
  const box = document.getElementById('themeOptions');
  if (!box) return;
  box.innerHTML = THEME_OPTIONS.map(option => `
    <button type="button" class="theme-option${option.id === currentTheme ? ' is-selected' : ''}"
      onclick="chooseTheme('${option.id}')" aria-pressed="${option.id === currentTheme}"
      style="--preview-scene:${option.scene};--preview-accent:${option.accent};--preview-detail:${option.detail}">
      <span class="theme-option-art" aria-hidden="true"><i class="fa-solid ${option.icon}"></i></span>
      <span class="theme-option-name">${option.label}</span>
      <i class="fa-solid ${option.id === currentTheme ? 'fa-circle-check' : 'fa-arrow-right'} theme-option-indicator" aria-hidden="true"></i>
    </button>`).join('');
}

function setTheme(name) {
  const option = THEME_OPTIONS.find(item => item.id === name) || THEME_OPTIONS.find(item => item.id === 'estate');
  currentTheme = option.id;
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('data-theme', currentTheme);
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      const meta = document.querySelector('meta[name="theme-color"]');
      const surface = window.getComputedStyle(document.documentElement).getPropertyValue('--color-sala').trim();
      if (meta && surface) meta.setAttribute('content', surface);
    }
  }
  const icon = typeof document !== 'undefined' ? document.getElementById('themePickerIcon') : null;
  if (icon) icon.className = 'fa-solid ' + option.icon;
  const label = typeof document !== 'undefined' ? document.getElementById('themePickerLabel') : null;
  if (label) label.textContent = option.label;
  const button = typeof document !== 'undefined' ? document.getElementById('themePickerBtn') : null;
  if (button) button.title = 'Tema: ' + option.label + (themeIsAutomatic ? ' · Automatico' : ' · Manuale');
  renderThemeOptions();
  try { localStorage.setItem(THEME_KEY, currentTheme); } catch (_) { /* preferenza facoltativa */ }
  return currentTheme;
}

function refreshTheme(date = new Date(), force = false) {
  const wasAutomatic = themeIsAutomatic;
  const automatic = automaticThemeFor(date);
  const period = themePeriodKey(date, automatic);
  if (themeOverride && (themeOverride.period !== period
    || !THEME_OPTIONS.some(option => option.id === themeOverride.theme))) {
    themeOverride = null;
    try { localStorage.removeItem(THEME_OVERRIDE_KEY); } catch (_) { /* storage facoltativo */ }
  }
  themeIsAutomatic = !themeOverride;
  const next = themeOverride ? themeOverride.theme : automatic;
  const changed = next !== currentTheme;
  if (changed || force || wasAutomatic !== themeIsAutomatic) setTheme(next);
  if (changed && themeCanDrawWheel && typeof drawWheel === 'function') drawWheel();
  return currentTheme;
}

function loadTheme(date = new Date()) {
  // Il vecchio valore singolo (inclusi VHS e Default) non blocca l'automatismo richiesto.
  try { themeOverride = JSON.parse(localStorage.getItem(THEME_OVERRIDE_KEY) || 'null'); }
  catch (_) { themeOverride = null; }
  return refreshTheme(date, true);
}

function openThemePicker() {
  refreshTheme();
  renderThemeOptions();
  if (typeof openModal === 'function') openModal('themeModal');
  const selected = typeof document !== 'undefined'
    ? document.querySelector(themeIsAutomatic ? '#themeAutoBtn' : '.theme-option.is-selected') : null;
  if (selected && typeof selected.focus === 'function') selected.focus();
}

function chooseTheme(name, date = new Date()) {
  if (!THEME_OPTIONS.some(option => option.id === name)) return;
  themeOverride = { theme: name, period: themePeriodKey(date, automaticThemeFor(date)) };
  try { localStorage.setItem(THEME_OVERRIDE_KEY, JSON.stringify(themeOverride)); } catch (_) { /* preferenza facoltativa */ }
  refreshTheme(date);
  if (typeof closeModal === 'function') closeModal('themeModal');
}

function chooseAutomaticTheme() {
  themeOverride = null;
  try { localStorage.removeItem(THEME_OVERRIDE_KEY); } catch (_) { /* preferenza facoltativa */ }
  refreshTheme();
  if (typeof closeModal === 'function') closeModal('themeModal');
}

loadTheme();
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    themeCanDrawWheel = true;
    loadTheme();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadTheme();
  });
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pageshow', () => loadTheme());
  window.addEventListener('focus', () => loadTheme());
  window.addEventListener('storage', event => {
    if (event.key === THEME_OVERRIDE_KEY || event.key === null) loadTheme();
  });
  // Aggiorna anche una pagina lasciata aperta durante il cambio di giorno.
  if (typeof window.setInterval === 'function') window.setInterval(() => {
    if (typeof document === 'undefined' || !document.hidden) refreshTheme();
  }, 60000);
}
