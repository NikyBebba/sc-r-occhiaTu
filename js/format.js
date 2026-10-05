// ============================================
// Format helper DOM-free: data serata leggibile.
// Nessun new Date('YYYY-MM-DD') (parsing UTC in certi engine): parsing
// manuale della parte ISO + month-names italiani corti. Se l'input non è
// parserizzabile si ripiega sul dato grezzo. Mai orari inventati: senza
// time si mostra solo la data; date NULL → "Stasera".
// ============================================

const MONTHS_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

// Voti 0–10: una cifra decimale, senza arrotondare input non validi.
function validMovieRating(value) {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= 0 && value <= 10 && Number(value.toFixed(1)) === value;
}

function parseMovieRating(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!/^\d{1,2}(?:[.,]\d)?$/.test(text)) return null;
  const value = Number(text.replace(',', '.'));
  return validMovieRating(value) ? value : null;
}

function formatMovieRating(value) {
  return validMovieRating(value) ? String(value).replace('.', ',') : '';
}

function formatNightDate(date, time) {
  if (!date) return 'Stasera';
  const raw = String(date);
  const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return raw;
  const mo = +m[2], day = +m[3];
  if (mo < 1 || mo > 12 || !day || !MONTHS_SHORT[mo - 1]) return raw;
  let out = `${day} ${MONTHS_SHORT[mo - 1]}`;
  const tm = time ? String(time).match(/^(\d{1,2}):(\d{2})/) : null;
  if (tm) out += ` · ${tm[1].padStart(2, '0')}:${tm[2]}`;
  return out;
}
