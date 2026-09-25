// ============================================
// Ruota della fortuna — canvas 2D con spin animato
// ============================================

let wheelRotation = 0; // rotazione corrente in radianti, persiste tra i redraw
let wheelSpinning = false;
let durationFilter = 'all'; // 'all' | short | medium | long | epic
let genreFilter = 'all'; // 'all' oppure un genere reale da movies.genres

// parseDurationMinutes è condivisa con filters.js (sort della pagina).

// Bucket di durata per il filtro ruota. null = durata sconosciuta
// (esclusa da ogni bucket specifico, inclusa solo in 'all').
function durationBucket(mins) {
  if (mins === null) return null;
  if (mins < 100) return 'short';
  if (mins < 120) return 'medium';
  if (mins < 150) return 'long';
  return 'epic';
}

// Film disponibili per la ruota: in watchlist, non vietati questa
// settimana, ed eventualmente filtrati per durata e genere reali.
function wheelPool() {
  const vetoed = vetoedMovieIdsThisWeek();
  return movies.filter(m => {
    if (m.status !== 'watchlist' || vetoed.includes(m.id)) return false;
    if (durationFilter !== 'all') {
      const bucket = durationBucket(parseDurationMinutes(m.duration));
      if (bucket === null || bucket !== durationFilter) return false;
    }
    if (genreFilter !== 'all') {
      if (!Array.isArray(m.genres) || !m.genres.includes(genreFilter)) return false;
    }
    return true;
  });
}

function setDurationFilter(value) {
  durationFilter = value;
  drawWheel();
}

function setGenreFilter(value) {
  genreFilter = value;
  drawWheel();
}

// Ricostruisce le opzioni del select genere SOLO se cambiano (preserva la
// selezione dell'utente; torna a 'all' se il genere scelto non esiste più).
// Chiamata da render(): i nuovi film/metadati Realtime arrivano lì.
function syncGenreFilterOptions() {
  const sel = document.getElementById('genreFilterSelect');
  if (!sel) return;
  const counts = {};
  movies.forEach(m => (m.genres || []).forEach(g => {
    if (g) counts[g] = (counts[g] || 0) + 1;
  }));
  const genres = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const key = genres.map(g => g[0]).join('|');
  if (sel.dataset.genresKey === key) return;

  sel.dataset.genresKey = key;
  const chosen = sel.value;
  sel.innerHTML = '<option value="all">🎞️ Qualsiasi genere</option>'
    + genres.map(([g, c]) =>
      `<option value="${jsAttrEscape(g)}">${escapeHtml(g)} (${c})</option>`).join('');
  if (chosen === 'all' || genres.some(([g]) => g === chosen)) {
    sel.value = chosen;
  } else {
    sel.value = 'all';
    genreFilter = 'all';
  }
}

function drawWheel() {
  const canvas = document.getElementById('wheelCanvas');
  const ctx = canvas.getContext('2d');
  const available = wheelPool();
  ctx.clearRect(0, 0, 256, 256);

  ctx.save();
  ctx.translate(128, 128);
  ctx.rotate(wheelRotation);
  ctx.translate(-128, -128);

  if (available.length === 0) {
    ctx.fillStyle = "#334155";
    ctx.beginPath(); ctx.arc(128, 128, 120, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#94a3b8"; ctx.font = "12px system-ui"; ctx.textAlign = "center";
    ctx.fillText("Aggiungi film!", 128, 132);
    ctx.restore();
    return;
  }

  const sliceAngle = (Math.PI * 2) / available.length;
  const colors = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];

  available.forEach((m, i) => {
    const angle = i * sliceAngle;
    ctx.beginPath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.moveTo(128, 128);
    ctx.arc(128, 128, 120, angle, angle + sliceAngle);
    ctx.fill();

    ctx.save();
    ctx.translate(128, 128);
    ctx.rotate(angle + sliceAngle / 2);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 10px system-ui";
    ctx.textAlign = "right";
    ctx.fillText(m.title.substring(0, 14), 110, 4);
    ctx.restore();
  });

  ctx.restore();
}

function spinWheel() {
  const available = wheelPool();
  if (available.length === 0 || wheelSpinning) return;

  wheelSpinning = true;
  const resultDiv = document.getElementById('wheelWinner');
  resultDiv.classList.add('hidden');

  const winnerIndex = Math.floor(Math.random() * available.length);
  const winner = available[winnerIndex];
  const sliceAngle = (Math.PI * 2) / available.length;

  // Angolo finale: il centro dello spicchio vincente deve fermarsi sotto la freccia (in alto, -90°)
  const targetSliceCenter = winnerIndex * sliceAngle + sliceAngle / 2;
  const fullSpins = 5 * Math.PI * 2;
  const finalRotation = fullSpins - targetSliceCenter - Math.PI / 2;

  const duration = 3200;
  const start = performance.now();
  const startRotation = wheelRotation % (Math.PI * 2);

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function frame(now) {
    const elapsed = now - start;
    const t = Math.min(elapsed / duration, 1);
    const eased = easeOutCubic(t);
    wheelRotation = startRotation + (finalRotation - startRotation) * eased;
    drawWheel();

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      wheelSpinning = false;
      resultDiv.classList.remove('hidden');
      // Step4 phase15 — ruota programmabile: propone, l'utente crea la serata.
      // Stesso flusso della card (quickTonightUI/scheduleMovie), nessun
      // aggancio automatico. "Stasera" chiude subito il box; "Programma" apre
      // la modale e il box si chiude al confirm (hook in confirmSchedule).
      resultDiv.innerHTML = `
        <div class="flex items-center justify-between gap-2">
          <span>🎉 Stasera si guarda: <span class="text-white font-bold">${escapeHtml(winner.title)}</span></span>
          <button onclick="closeWheelWinner()" class="ml-2 inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-800 text-slate-400 hover:text-white transition shrink-0" aria-label="Chiudi" title="Chiudi"><i class="fa-solid fa-xmark text-[10px]"></i></button>
        </div>
        <div class="flex items-center gap-2 mt-2">
          <button onclick="quickTonightUI('${jsAttrEscape(winner.id)}', 'wheel'); closeWheelWinner()" class="flex-1 py-2 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 rounded-lg text-sm font-medium transition">Stasera</button>
          <button onclick="wheelScheduleFor='${jsAttrEscape(winner.id)}'; scheduleMovie('${jsAttrEscape(winner.id)}')" class="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition">Programma</button>
        </div>
        <div class="flex items-center gap-2 mt-1">
          <button onclick="downloadTicket('${jsAttrEscape(winner.id)}', 'wheel')" class="flex-1 py-2 bg-slate-900/60 hover:bg-slate-800 text-slate-400 hover:text-indigo-300 rounded-lg text-sm font-medium transition">🎟️ Ticket</button>
        </div>`;
      fireConfetti();
    }
  }
  requestAnimationFrame(frame);
}

// Chiude il box del risultato ruota: nasconde SOLO il box, senza toccare
// spin/confetti in corso (un nuovo giro lo riapre al termine).
function closeWheelWinner() {
  const el = document.getElementById('wheelWinner');
  if (el) el.classList.add('hidden');
}

// ---- Confetti leggero in puro DOM/CSS, nessuna libreria esterna ----
function fireConfetti() {
  const container = document.getElementById('confettiLayer');
  if (!container) return;
  const colors = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
  const pieces = 60;
  for (let i = 0; i < pieces; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.left = (45 + Math.random() * 10) + '%';
    el.style.background = colors[i % colors.length];
    el.style.setProperty('--dx', (Math.random() * 300 - 150) + 'px');
    el.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
    el.style.animationDuration = (1.4 + Math.random() * 1.2) + 's';
    el.style.animationDelay = (Math.random() * 0.2) + 's';
    container.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }
}
