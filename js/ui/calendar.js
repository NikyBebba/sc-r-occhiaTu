// ============================================
// UI — Calendario mensile delle serate: logica pura + render
// Solo vista (gestione serate = step 3b). Nessun ICS, nessuna modifica store.
// Le date sono sempre stringhe 'YYYY-MM-DD' costruite da componenti LOCALI
// (mai new Date('YYYY-MM-DD'), che è UTC e provocherebbe off-by-one).
// ============================================

let calendarYear = null;        // anno del mese mostrato
let calendarMonth = null;       // mese 0-based (come Date)
let calendarSelectedKey = null; // 'YYYY-MM-DD' del giorno espanso nel riepilogo

// Mappa esplicita status → classi Tailwind COMPLETE (mai concatenate in JS).
// Ogni entrata è una stringa finita, interpolata così com'è nel template.
const NIGHT_STATUS_UI = {
  proposed:  { label: 'Proposta',   dot: 'bg-amber-400',   chip: 'text-amber-300 bg-amber-500/15 border-amber-500/40' },
  confirmed: { label: 'Confermata', dot: 'bg-indigo-400',  chip: 'text-indigo-300 bg-indigo-500/15 border-indigo-500/40' },
  cancelled: { label: 'Annullata',  dot: 'bg-rose-400',    chip: 'text-rose-300 bg-rose-500/15 border-rose-500/40' },
  completed: { label: 'Fatta',      dot: 'bg-emerald-400', chip: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/40' }
};

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

function nightStatusUI(status) {
  return NIGHT_STATUS_UI[status] || { label: status || '?', dot: 'bg-slate-400', chip: 'text-slate-300 bg-slate-500/15 border-slate-500/40' };
}

// ---- Logica pura (testabile) ----

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Key 'YYYY-MM-DD' da componenti locali già scomposte: nessun parsing UTC.
function dayKey(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function todayKey() {
  const now = new Date();
  return dayKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

// Il mese "a delta mesi di distanza", attraversando l'anno se serve.
function shiftMonth(year, month, delta) {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

// Griglia del mese: settimane che iniziano di lunedì, con le celle dei giorni
// attigui (mese precedente/successivo) marcate inMonth=false. Ogni cella è
// { key, day, inMonth, isToday }. Costruita in locale, quindi TZ-safe.
function monthGrid(year, month) {
  const leading = (new Date(year, month, 1).getDay() + 6) % 7; // lunedì-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = todayKey();
  const cells = [];
  for (let i = leading - 1; i >= 0; i--) {
    const date = new Date(year, month, -i);
    const key = dayKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
    cells.push({ key, day: date.getDate(), inMonth: false, isToday: key === today });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = dayKey(year, month + 1, d);
    cells.push({ key, day: d, inMonth: true, isToday: key === today });
  }
  let next = 1;
  while (cells.length % 7 !== 0) {
    const date = new Date(year, month + 1, next++);
    const key = dayKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
    cells.push({ key, day: date.getDate(), inMonth: false, isToday: key === today });
  }
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// Mappa le serate di un mese per giorno ('YYYY-MM-DD' → [{ night, movie }]).
// Le night con date=NULL (quick "Stasera") non sono agganciabili a un giorno:
// finiscono in `undated` e non rompono la griglia. Il join sul film è
// opzionale: se il film è stato eliminato restiamo comunque in piedi.
function nightsByDayKey(movieNightsList, moviesList, year, month) {
  const byDay = {};
  const undated = [];
  const prefix = dayKey(year, month + 1, 1).slice(0, 7); // 'YYYY-MM'
  movieNightsList.forEach(n => {
    const movie = moviesList.find(m => m.id === n.movie_id) || null;
    const entry = { night: n, movie };
    if (n.date && /^\d{4}-\d{2}-\d{2}$/.test(n.date) && n.date.startsWith(prefix)) {
      (byDay[n.date] = byDay[n.date] || []).push(entry);
    } else if (!n.date) {
      undated.push(entry);
    }
  });
  return { byDay, undated };
}

// ---- Helpers di visuale ----

function dayCellClass(cell, hasNights, selected) {
  if (selected) return 'aspect-square flex flex-col items-center justify-center rounded-lg transition bg-indigo-600/25 ring-1 ring-indigo-400';
  if (cell.isToday) return 'aspect-square flex flex-col items-center justify-center rounded-lg transition ring-1 ring-indigo-500/60 hover:bg-slate-800';
  if (!cell.inMonth) return 'aspect-square flex flex-col items-center justify-center rounded-lg transition opacity-40';
  if (hasNights) return 'aspect-square flex flex-col items-center justify-center rounded-lg transition bg-slate-800/40 hover:bg-slate-700/60';
  return 'aspect-square flex flex-col items-center justify-center rounded-lg transition hover:bg-slate-800';
}

function dayNumClass(cell) {
  if (cell.isToday) return 'w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-bold bg-indigo-600 text-white mx-auto';
  if (!cell.inMonth) return 'w-6 h-6 flex items-center justify-center text-[10px] text-slate-400/70 mx-auto';
  if (cell.key < todayKey()) return 'w-6 h-6 flex items-center justify-center text-[10px] text-slate-400/80 mx-auto';
  return 'w-6 h-6 flex items-center justify-center text-[10px] text-slate-200 mx-auto';
}

function formatDayLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Riga di riepilogo per una night (usata sia nel giorno selezionato sia nel
// footer "Senza data (Stasera)"). Tutti i testi utente passano da escapeHtml.
function nightRowHtml(entry) {
  const ui = nightStatusUI(entry.night.status);
  const title = entry.movie ? entry.movie.title : 'Film rimosso';
  const time = entry.night.time || '21:30';
  const proposer = entry.night.proposed_by
    ? (CONFIG.PEOPLE[entry.night.proposed_by]?.label || entry.night.proposed_by)
    : null;
  const metaHtml = proposer
    ? `<div class="text-[10px] text-slate-400">${escapeHtml(time)} • proposto da ${escapeHtml(proposer)}</div>`
    : `<div class="text-[10px] text-slate-400">${escapeHtml(time)}</div>`;
  return `<div class="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-slate-800/80 last:border-0">
      <div class="min-w-0">
        <div class="text-xs font-semibold text-slate-100 truncate">${escapeHtml(title)}</div>
        ${metaHtml}
      </div>
      <span class="px-2 py-0.5 rounded-md border text-[10px] font-medium ${ui.chip}">${escapeHtml(ui.label)}</span>
    </div>`;
}

function dayCellHtml(cell, nights, selected) {
  const hasNights = Boolean(nights && nights.length);
  const dots = hasNights
    ? `<span class="flex gap-0.5 mt-0.5">${nights.map(e => `<span class="w-1.5 h-1.5 rounded-full ${nightStatusUI(e.night.status).dot}"></span>`).join('')}</span>`
    : '';
  return `<button onclick="calendarSelectDay('${cell.key}')" class="${dayCellClass(cell, hasNights, selected)}">
      <span class="${dayNumClass(cell)}">${cell.day}</span>${dots}
    </button>`;
}

// ---- Render ----

function renderCalendar() {
  if (calendarYear === null || calendarMonth === null) {
    const now = new Date();
    calendarYear = now.getFullYear();
    calendarMonth = now.getMonth();
  }
  const grid = document.getElementById('movieGrid');
  const weeks = monthGrid(calendarYear, calendarMonth);
  const { byDay, undated } = nightsByDayKey(movieNights, movies, calendarYear, calendarMonth);

  // Se dopo un resync (realtime) il giorno selezionato non ha più serate, o il
  // mese è cambiato, chiudiamo il riepilogo senza errori.
  if (calendarSelectedKey && !(byDay[calendarSelectedKey] && byDay[calendarSelectedKey].length)) {
    calendarSelectedKey = null;
  }

  const monthLabel = new Date(calendarYear, calendarMonth, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

  const header = `
    <div class="flex items-center justify-between gap-2 mb-4">
      <button onclick="calendarShift(-1)" class="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition" title="Mese precedente"><i class="fa-solid fa-chevron-left"></i></button>
      <div class="text-sm font-bold text-slate-100 capitalize">${monthLabel}</div>
      <button onclick="calendarShift(1)" class="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition" title="Mese successivo"><i class="fa-solid fa-chevron-right"></i></button>
      <button onclick="calendarToday()" class="px-2 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 rounded-lg text-xs font-medium transition">Oggi</button>
    </div>`;

  const weekdayRow = `
    <div class="grid grid-cols-7 text-center text-[10px] uppercase tracking-wider text-slate-400 mb-1">
      ${WEEKDAY_LABELS.map(d => `<div>${d}</div>`).join('')}
    </div>`;

  const weeksHtml = `<div class="space-y-1">
      ${weeks.map(week => `
        <div class="grid grid-cols-7 gap-1">
          ${week.map(cell => dayCellHtml(cell, byDay[cell.key] || null, calendarSelectedKey === cell.key)).join('')}
        </div>`).join('')}
    </div>`;

  const summary = calendarSelectedKey ? `
    <div class="mt-3 p-3 bg-slate-900/80 rounded-xl border border-slate-800">
      <div class="text-[10px] uppercase tracking-wider text-slate-400 mb-1">${formatDayLabel(calendarSelectedKey)}</div>
      ${byDay[calendarSelectedKey].map(nightRowHtml).join('')}
    </div>` : '';

  // Quick pick "Stasera" senza data: solo le night attive (proposed/confirmed).
  const activeUndated = undated.filter(e => e.night.status === 'proposed' || e.night.status === 'confirmed');
  const undatedHtml = activeUndated.length ? `
    <div class="mt-4 pt-3 border-t border-slate-800">
      <div class="text-[10px] uppercase tracking-wider text-slate-400 mb-1">Senza data (Stasera)</div>
      ${activeUndated.map(nightRowHtml).join('')}
    </div>` : '';

  const emptyHint = (Object.keys(byDay).length === 0 && activeUndated.length === 0)
    ? `<p class="mt-4 text-xs text-slate-400 italic text-center">Nessuna serata in questo mese.</p>`
    : '';

  const legend = `
    <div class="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[10px] text-slate-400">
      ${Object.keys(NIGHT_STATUS_UI).map(k => {
        const ui = NIGHT_STATUS_UI[k];
        return `<span class="inline-flex items-center gap-1"><span class="w-2 h-2 rounded-full ${ui.dot}"></span>${escapeHtml(ui.label)}</span>`;
      }).join('')}
    </div>`;

  grid.innerHTML = `<div class="col-span-full">
      ${header}
      ${weekdayRow}
      ${weeksHtml}
      ${summary}
      ${undatedHtml}
      ${emptyHint}
      ${legend}
    </div>`;
}

// ---- Azioni di navigazione (niente gestione serate: step 3b) ----

function calendarShift(delta) {
  if (calendarYear === null || calendarMonth === null) {
    const now = new Date();
    calendarYear = now.getFullYear();
    calendarMonth = now.getMonth();
  }
  const next = shiftMonth(calendarYear, calendarMonth, delta);
  calendarYear = next.year;
  calendarMonth = next.month;
  calendarSelectedKey = null;
  renderCalendar();
}

function calendarToday() {
  const now = new Date();
  calendarYear = now.getFullYear();
  calendarMonth = now.getMonth();
  calendarSelectedKey = null;
  renderCalendar();
}

// Click su un giorno: toggle del riepilogo minimo (titolo, ora, status).
function calendarSelectDay(key) {
  calendarSelectedKey = calendarSelectedKey === key ? null : key;
  renderCalendar();
}