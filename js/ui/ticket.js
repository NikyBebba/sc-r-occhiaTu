// ============================================
// UI — Step4 phase18 · Final Ticket Generator
// Export "immagine high-res formato Instagram Stories" (1080×1920) disegnata
// su canvas nativo, nessuna libreria esterna. Il ticket mostra la Match %
// SOLO se l'origine è Match Live; altrimenti un timbro d'origine ("Scelto con
// la Ruota" / "Proposto da N/V"). Origine passata dal chiamante, MAI
// ricostruita da altrove: il dato non la traccia (nessun campo nuovo).
//
// Poster: crossOrigin="anonymous" (stesso pattern di Phase 9.2, verificato
// ACAO:* su TMDb/OMDb). Poster assente o CORS fallito → disegno comunque il
// ticket con gradiente (fallback silenzioso, mai errori in console).
// Export: canvas.toBlob → Blob URL su link <a download>, revokeObjectURL dopo.
// Script classico, globals richiamate da onclick (funzioni globale).
// ============================================

const TICKET_W = 1080;
const TICKET_H = 1920;

// Origine della serata appena creata IN QUESTA SESSIONE DI NAVIGAZIONE
// (in-memory, MAI persistito). Quando il winner della ruota parte
// "Programma" (scheduleMovie) mette wheelScheduleFor = id così confirmSchedule
// sa di marcare 'wheel' e non 'manual'.
let wheelScheduleFor = null;
let ticketOrigin = {}; // { [movieId]: 'match' | 'wheel' | 'manual' }

function markTicketOrigin(id, origin) {
  if (!id) return;
  if (origin) ticketOrigin[id] = origin;
  else delete ticketOrigin[id];
}

function ticketOriginOf(id) {
  return ticketOrigin[id] || null;
}

// Font-family coerente col resto dell'app (Plus Jakarta Sans con fallback).
const TICKET_FONT = '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", sans-serif';

// Rounded rect helper (roundRect non è ovunque).
function ticketRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function ticketWrappedLines(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Decisione del "timbro" (testabile: funzione pura). Match Live → percentuale
// (+ "d'accordo"), altrimenti il timbro d'origine. pct è il risultato di
// sessionAgreement (null se non c'è un totale condiviso).
function ticketStampText(origin, pct) {
  if (origin === 'match' && pct !== null && pct !== undefined) {
    return { main: pct + '%', sub: "d'accordo" };
  }
  if (origin === 'wheel') return { main: 'Scelto con la Ruota', sub: '' };
  return { main: 'Proposto da N/V', sub: '' };
}

// Milestones: funzioni che disegnano l'M-POST (la percentuale) sul canvas.
// I parametri sono passati dal content builder.
function ticketDrawStamp(ctx, text) {
  ctx.save();
  ctx.rotate(-0.06);
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.9)';
  ctx.lineWidth = 8;
  const w = ctx.measureText(text).width + 60;
  ctx.font = 'bold 56px ' + TICKET_FONT;
  ticketRoundRect(ctx, (TICKET_W - w) / 2, 912, w, 110, 18);
  ctx.stroke();
  ctx.rotate(0.06);
  ctx.rotate(-0.06);
  ctx.fillStyle = '#fbbf24';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 46px ' + TICKET_FONT;
  ctx.fillText(text, TICKET_W / 2, 973);
  ctx.restore();
}

// Draw del ticket completo. `movie` = oggetto film in memoria; `origin` =
// 'match'|'wheel'|'manual'; `pct` = numero o null (Math % per il Match Live).
// `img` (opzionale) = poster già caricato con crossOrigin; se null/poster
// assente disegna il gradiente di fallback. Ritorna il canvas (mai throw).
function drawTicketCanvas(movie, origin, pct, img) {
  const canvas = document.createElement('canvas');
  canvas.width = TICKET_W;
  canvas.height = TICKET_H;
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!ctx) return canvas;

  // Sfondo: dark cinema con vena indigo→sky (stessa palette dell'app).
  const bg = ctx.createLinearGradient(0, 0, 0, TICKET_H);
  bg.addColorStop(0, '#0f172a');
  bg.addColorStop(0.5, '#1e1b4b');
  bg.addColorStop(1, '#0c4a6e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, TICKET_W, TICKET_H);

  // Bordo "biglietto" con perforazioni laterali (pattern visivo di .movie-ticket).
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = 4;
  ticketRoundRect(ctx, 40, 40, TICKET_W - 80, TICKET_H - 80, 28);
  ctx.stroke();

  // Titolo in alto.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 76px ' + TICKET_FONT;
  const titleLines = ticketWrappedLines(ctx, movie.title || 'Un film', TICKET_W - 180);
  let ty = 280;
  for (const line of titleLines) {
    if (ty > 460) break;
    ctx.fillText(line, TICKET_W / 2, ty);
    ty += 84;
  }

  // Meta ("anno • durata • piattaforma", scalare come le card).
  const metaParts = [];
  if (movie.release_year) metaParts.push(String(movie.release_year));
  if (movie.duration) metaParts.push(String(movie.duration));
  if (movie.platform) metaParts.push(String(movie.platform));
  if (metaParts.length) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '36px ' + TICKET_FONT;
    ctx.fillText(metaParts.join(' • '), TICKET_W / 2, ty + 10);
  }

  // Poster (2/3 ratio: 540×810, centrato).
  const ph = 810, pw = 540, px = (TICKET_W - pw) / 2, py = 620;
  if (img) {
    ctx.save();
    ticketRoundRect(ctx, px, py, pw, ph, 18);
    ctx.clip();
    ctx.drawImage(img, px, py, pw, ph);
    ctx.restore();
  } else {
    const g = ctx.createLinearGradient(px, py, px + pw, py + ph);
    g.addColorStop(0, '#312e81');
    g.addColorStop(1, '#0e7490');
    ctx.fillStyle = g;
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 4;
    ticketRoundRect(ctx, px, py, pw, ph, 18);
    ctx.stroke();
    ctx.fillStyle = 'rgba(248,250,252,0.35)';
    ctx.font = '160px ' + TICKET_FONT;
    ctx.fillText('🎬', TICKET_W / 2, py + ph / 2);
  }

  // Timbro d'origine / Match %.
  const stamp = ticketStampText(origin, pct);
  if (stamp.main.slice(-1) === '%') {
    // Percentuale (Match Live): numero grande + "d'accordo".
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#34d399';
    ctx.font = 'bold 90px ' + TICKET_FONT;
    ctx.fillText(stamp.main, TICKET_W / 2, 1560);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 44px ' + TICKET_FONT;
    ctx.fillText(stamp.sub, TICKET_W / 2, 1635);
  } else {
    ticketDrawStamp(ctx, stamp.main);
  }

  // Paternità / persona.
  const supporter = movie.added_by && CONFIG.PEOPLE[movie.added_by] ? CONFIG.PEOPLE[movie.added_by].label : '';
  const bottom = supporter ? 'Il nostro cinema · ' + supporter : 'Il nostro cinema';
  ctx.fillStyle = '#64748b';
  ctx.font = '34px ' + TICKET_FONT;
  ctx.fillText(bottom, TICKET_W / 2, 1780);

  // Data serata se disponibile (mai inventata: solo se il campo esiste).
  if (movie.scheduled_date) {
    const d = formatNightDate(movie.scheduled_date, movie.scheduled_time);
    if (d) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '38px ' + TICKET_FONT;
      ctx.fillText(d, TICKET_W / 2, 1720);
    }
  }

  return canvas;
}

// Carica il poster con crossOrigin (stesso pattern di Phase 9.2). Rilascia
// onload/onerror dopo l'uso. Restituisce Promise<Image|null>: mai throw, mai
// errori in console (fallback = null).
function loadTicketPoster(posterUrl) {
  return new Promise(resolve => {
    if (!posterUrl || typeof Image === 'undefined') { resolve(null); return; }
    const img = new Image();
    let done = false;
    const finish = v => { if (done) return; done = true; img.onload = null; img.onerror = null; resolve(v); };
    img.crossOrigin = 'anonymous';
    img.onload = () => finish(img);
    img.onerror = () => finish(null);
    img.src = posterUrl;
    // Timeout di sicurezza: un server lento non deve bloccare il download.
    setTimeout(() => finish(null), 8000);
  });
}

function ticketFileName(movie) {
  const safe = String(movie.title || 'ticket').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return 'scrocciatu-ticket-' + (safe || 'film') + '.png';
}

// Export via Blob + link <a download>, revocando l'URL dopo il download.
function downloadTicketCanvas(canvas, fileName) {
  const blob = new Promise(resolve => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob(b => resolve(b), 'image/png');
    } else {
      resolve(null); // toBlob assente (sandbox): fallback sotto con toDataURL
    }
  });
  blob.then(b => {
    const url = b
      ? URL.createObjectURL(b)
      : (canvas.toDataURL ? canvas.toDataURL('image/png') : '');
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
}

// Entry point globale per i bottoni Ticket (onclick). L'origine della scelta
// (match/wheel/manual) è passata ESPLICITAMENTE dal chiamante: il dato non la
// traccia, questo è l'unico punto vero di decisione sul timbro/percentuale.
async function downloadTicket(movieId, origin) {
  const movie = movies.find(m => m && m.id === movieId);
  if (!movie) return;
  let pct = null;
  if (origin === 'match') {
    const a = sessionAgreement(swipes, movies);
    pct = a.pct;
  }
  const img = await loadTicketPoster(movie.poster);
  const canvas = drawTicketCanvas(movie, origin, pct, img);
  downloadTicketCanvas(canvas, ticketFileName(movie));
}