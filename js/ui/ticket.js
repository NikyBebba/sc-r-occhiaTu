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

// Testo adattivo: limita le righe e segnala il taglio senza invadere le altre aree.
function ticketFitText(ctx, text, width, maxLines, size, minSize) {
  let lines;
  do {
    ctx.font = 'bold ' + size + 'px ' + TICKET_FONT;
    lines = ticketWrappedLines(ctx, text, width);
    if (lines.length <= maxLines && lines.every(line => ctx.measureText(line).width <= width)) break;
    size -= 2;
  } while (size >= minSize);
  size = Math.max(size, minSize);
  ctx.font = 'bold ' + size + 'px ' + TICKET_FONT;
  lines = ticketWrappedLines(ctx, text, width);
  const truncated = lines.length > maxLines;
  lines = lines.slice(0, maxLines);
  return { size, lines: lines.map((line, i) => {
    if (ctx.measureText(line).width <= width && !(truncated && i === maxLines - 1)) return line;
    while (line && ctx.measureText(line + '…').width > width) line = line.slice(0, -1);
    return line.trimEnd() + '…';
  }) };
}

function ticketTextBlock(ctx, text, x, y, width, maxLines, size, minSize) {
  const fitted = ticketFitText(ctx, text, width, maxLines, size, minSize);
  fitted.lines.forEach((line, i) => ctx.fillText(line, x, y + i * fitted.size * 1.18));
  return fitted;
}

// Disegno a copertura: conserva le proporzioni anche con poster non standard.
function ticketCoverImage(ctx, img, x, y, width, height) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const scale = Math.max(width / iw, height / ih);
  ctx.drawImage(img, x + (width - iw * scale) / 2, y + (height - ih * scale) / 2,
    iw * scale, ih * scale);
}

// Poster protagonista, titolo in sovrimpressione e talloncino chiaro staccabile.
// Le coordinate separano titolo, origine e serata; nessun dato viene inventato.
function drawTicketCanvas(movie, origin, pct, img) {
  const canvas = document.createElement('canvas');
  canvas.width = TICKET_W;
  canvas.height = TICKET_H;
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!ctx) return canvas;

  const bg = ctx.createLinearGradient(0, 0, TICKET_W, TICKET_H);
  bg.addColorStop(0, '#080c1c');
  bg.addColorStop(0.5, '#20204a');
  bg.addColorStop(1, '#071f30');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, TICKET_W, TICKET_H);
  // Piccole perforazioni da pellicola, distinte dal bordo del biglietto.
  ctx.fillStyle = 'rgba(148,163,184,0.16)';
  for (let y = 54; y < TICKET_H; y += 72) {
    for (const x of [20, 1040]) {
      ticketRoundRect(ctx, x, y, 20, 36, 5);
      ctx.fill();
    }
  }

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 45;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = '#11172b';
  ticketRoundRect(ctx, 72, 80, 936, 1760, 36);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ticketRoundRect(ctx, 72, 80, 936, 1760, 36);
  ctx.clip();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 48px ' + TICKET_FONT;
  ctx.fillText('sc(r)occhiaTu', 120, 165);
  ctx.fillStyle = '#b5b9dd';
  ctx.font = '24px ' + TICKET_FONT;
  ctx.fillText('IL NOSTRO CINEMA', 120, 214);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#f5cf80';
  ctx.font = 'bold 26px ' + TICKET_FONT;
  ctx.fillText('DUE POSTI', 960, 161);
  ctx.font = '24px ' + TICKET_FONT;
  ctx.fillStyle = '#b5b9dd';
  ctx.fillText('Una serata insieme', 960, 205);

  const posterY = 260, posterH = 920;
  const fallback = ctx.createLinearGradient(72, posterY, 1008, 1180);
  fallback.addColorStop(0, '#433878');
  fallback.addColorStop(1, '#0b4262');
  ctx.fillStyle = fallback;
  ctx.fillRect(72, posterY, 936, posterH);
  ctx.save();
  ctx.beginPath();
  ctx.rect(72, posterY, 936, posterH);
  ctx.clip();
  if (img) ticketCoverImage(ctx, img, 72, posterY, 936, posterH);
  else {
    // Una pellicola geometrica come fallback, senza dipendere da font emoji.
    ctx.strokeStyle = 'rgba(226,232,240,0.24)';
    ctx.lineWidth = 6;
    ticketRoundRect(ctx, 360, 425, 360, 300, 24);
    ctx.stroke();
    for (let y = 450; y < 710; y += 55) {
      ctx.fillStyle = 'rgba(226,232,240,0.3)';
      ctx.fillRect(380, y, 26, 28);
      ctx.fillRect(674, y, 26, 28);
    }
    ctx.fillStyle = 'rgba(226,232,240,0.25)';
    ctx.beginPath();
    ctx.moveTo(510, 505); ctx.lineTo(510, 645); ctx.lineTo(605, 575); ctx.closePath(); ctx.fill();
  }
  const scrim = ctx.createLinearGradient(0, 620, 0, 1180);
  scrim.addColorStop(0, 'rgba(8,12,28,0)');
  scrim.addColorStop(0.45, 'rgba(8,12,28,0.72)');
  scrim.addColorStop(1, '#080c1c');
  ctx.fillStyle = scrim;
  ctx.fillRect(72, posterY, 936, posterH);
  ctx.restore();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#f5cf80';
  ctx.font = 'bold 24px ' + TICKET_FONT;
  ctx.fillText('IL FILM DELLA NOSTRA SERATA', 120, 852);
  ctx.fillStyle = '#ffffff';
  const title = ticketFitText(ctx, movie.title || 'Un film', 840, 3, 76, 48);
  title.lines.forEach((line, i) => ctx.fillText(line, 120, 1080 - (title.lines.length - 1 - i) * title.size * 1.18));
  const meta = [movie.release_year, movie.duration, movie.platform].filter(Boolean).join('  ·  ');
  ctx.fillStyle = '#cbd5e1';
  ticketTextBlock(ctx, meta, 120, 1144, 840, 1, 28, 24);

  ctx.fillStyle = '#f4efdf';
  ctx.fillRect(72, 1180, 936, 660);
  ctx.strokeStyle = '#b6ad96';
  ctx.lineWidth = 2;
  ctx.setLineDash([12, 10]);
  ctx.beginPath(); ctx.moveTo(110, 1180); ctx.lineTo(970, 1180); ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#6b5e46';
  ctx.font = 'bold 22px ' + TICKET_FONT;
  ctx.fillText('LA SCELTA', 120, 1235);
  ctx.fillStyle = '#25233c';
  let stamp = ticketStampText(origin, pct);
  if (origin === 'match' && (pct === null || pct === undefined)) stamp = { main: 'Match Live', sub: '' };
  if (origin === 'manual') {
    const person = movie.proposed_by || movie.added_by;
    const label = CONFIG.PEOPLE[person]?.label;
    if (label) stamp = { main: 'Proposto da ' + label, sub: '' };
  }
  if (!origin) stamp = { main: 'Una serata insieme', sub: '' };
  const stampLabel = stamp.sub ? 'Match Live · ' + stamp.main + ' ' + stamp.sub : stamp.main;
  ticketTextBlock(ctx, stampLabel, 120, 1294, 840, 1, 42, 28);
  ctx.strokeStyle = '#d1c7b0';
  ctx.beginPath(); ctx.moveTo(120, 1333); ctx.lineTo(960, 1333); ctx.stroke();

  ctx.fillStyle = '#6b5e46';
  ctx.font = 'bold 22px ' + TICKET_FONT;
  ctx.fillText('QUANDO', 120, 1390);
  // Un film scelto ma non programmato non è automaticamente una serata oggi.
  const date = movie.scheduled_date
    ? formatNightDate(movie.scheduled_date, movie.scheduled_time)
    : (movie.status === 'tonight' ? formatNightDate(null, movie.scheduled_time) : 'Da programmare');
  ctx.fillStyle = '#25233c';
  ticketTextBlock(ctx, date, 120, 1444, 840, 1, 40, 28);
  ctx.fillStyle = '#6b5e46';
  ctx.font = 'bold 22px ' + TICKET_FONT;
  ctx.fillText('SNACK', 120, 1510);
  ctx.fillStyle = '#25233c';
  ticketTextBlock(ctx, movie.snack || 'Da scegliere insieme', 120, 1563, 840, 2, 36, 28);

  ctx.strokeStyle = '#d1c7b0';
  ctx.beginPath(); ctx.moveTo(120, 1650); ctx.lineTo(960, 1650); ctx.stroke();
  // Due posti, senza numeri di prenotazione o codici fittizi.
  for (let i = 0; i < 2; i++) {
    const x = 120 + i * 86;
    ctx.fillStyle = i === 0 ? '#514c87' : '#336480';
    ticketRoundRect(ctx, x + 8, 1693, 52, 46, 12); ctx.fill();
    ticketRoundRect(ctx, x, 1726, 68, 28, 8); ctx.fill();
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = '#25233c';
  ctx.font = 'bold 30px ' + TICKET_FONT;
  ctx.fillText('Due posti, una storia.', 960, 1720);
  ctx.fillStyle = '#6b5e46';
  ctx.font = '24px ' + TICKET_FONT;
  ctx.fillText('Da scegliere insieme.', 960, 1764);
  ctx.restore();

  // Tacche laterali del talloncino.
  for (const x of [72, 1008]) {
    ctx.fillStyle = '#11172b';
    ctx.beginPath(); ctx.arc(x, 1180, 24, 0, Math.PI * 2); ctx.fill();
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
  // Attende il font usato dall'interfaccia prima di misurare le righe del PNG.
  if (document.fonts && typeof document.fonts.load === 'function') {
    await Promise.race([document.fonts.load('bold 76px ' + TICKET_FONT).catch(() => {}),
      new Promise(resolve => setTimeout(resolve, 1500))]);
  }
  const img = await loadTicketPoster(movie.poster);
  const canvas = drawTicketCanvas(movie, origin, pct, img);
  downloadTicketCanvas(canvas, ticketFileName(movie));
}