#!/usr/bin/env node
// ============================================
// Generatore icone PWA — PNG pure-Node (nessuna dipendenza: solo zlib built-in).
// Motivo "pellicola": sfondo Nero Sala, barra a gradiente indigo→sky (gli
// stessi colori di .gradient-text), fori di perforazione e 3 fotogrammi.
// Render 2x + box-filter per l'anti-aliasing, CRC32 implementato a mano.
//
//   node scripts/generate-icons.js   → scrive in /icons/
// Deterministico e riproducibile: nessun asset binario generato a mano.
// ============================================

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.resolve(__dirname, '..', 'icons');
const CC = 'sc(r)occhiaTu'; // intestazione non usata dal codice, solo commento

// ---------- colori (da css/style.css :root · Cinema Classic) ----------
const NERO = [15, 23, 42];        // --color-sala #0f172a
const INDIGO = [129, 140, 248];   // --color-dettaglio #818cf8 (gradiente alto)
const SKY = [56, 189, 248];       // sky-400 #38bdf8 (gradiente basso, .gradient-text)
const BIANCO = [255, 255, 255];

// ---------- PNG encoder minimale (RGBA 8bit, colortype 6) ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // bit depth 8, colortype RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtro None
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------- raster: buffer RGBA size×size ----------
function canvas(size) {
  return Buffer.alloc(size * size * 4);
}
function put(buf, size, x, y, [r, g, b], a) {
  const i = (y * size + x) * 4;
  const aa = a === undefined ? 255 : a;
  const outA = aa;
  const src = 255 - aa;
  buf[i] = Math.round((buf[i] * src + r * aa) / 255);
  buf[i + 1] = Math.round((buf[i + 1] * src + g * aa) / 255);
  buf[i + 2] = Math.round((buf[i + 2] * src + b * aa) / 255);
  buf[i + 3] = Math.min(255, buf[i + 3] + outA);
}
// copre ogni pixel con colore (blend alpha): utile per sfondo full-bleed
function fillAll(buf, size, rgb) {
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = rgb[0]; buf[i * 4 + 1] = rgb[1]; buf[i * 4 + 2] = rgb[2]; buf[i * 4 + 3] = 255;
  }
}

// rounded-rect "coverage" (0..1 mastica antialias via supersampling esterno)
function rrectCover(x, y, cx, cy, w, h, r) {
  const dx = Math.max(Math.abs(x - cx) - (w / 2 - r), 0);
  const dy = Math.max(Math.abs(y - cy) - (h / 2 - r), 0);
  const d = Math.hypot(dx, dy);
  return d <= r ? 1 : 0;
}
function frameCover(x, y, cx, cy, w, h) {
  const dx = Math.abs(x - cx) - w / 2;
  const dy = Math.abs(y - cy) - h / 2;
  return dx <= 0 && dy <= 0 ? 1 : 0;
}

function drawMotif(buf, size, scale, fullBleed) {
  const s = size * scale;            // dimensione "design" a risoluzione 2x
  const cx = s / 2, cy = s / 2;

  // sfondo
  if (fullBleed) {
    fillAll(buf, s, NERO);
  } else {
    const rBack = s * 0.22;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      if (rrectCover(x, y, cx, cy, s - 2, s - 2, rBack)) put(buf, s, x, y, NERO);
    }
  }

  // barra pellicola a gradiente verticale
  const barW = s * 0.60, barH = s * 0.30, barR = barH * 0.28;
  const hole = s * 0.045, holeGap = s * 0.052;
  const nHoles = 4;
  const holesW = nHoles * hole + (nHoles - 1) * holeGap;
  const frameH = barH * 0.52, frameW = frameH * 0.72;
  const frameGap = (barW - 3 * frameW) / 4;

  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const coverBar = rrectCover(x, y, cx, cy, barW, barH, barR);
    if (coverBar > 0) {
      const t = (y - (cy - barH / 2)) / barH;
      const col = [
        Math.round(INDIGO[0] + (SKY[0] - INDIGO[0]) * t),
        Math.round(INDIGO[1] + (SKY[1] - INDIGO[1]) * t),
        Math.round(INDIGO[2] + (SKY[2] - INDIGO[2]) * t)
      ];
      put(buf, s, x, y, col, 255);
    }
  }
  // fotogrammi scuri dentro la barra
  for (let f = 0; f < 3; f++) {
    const fx = cx - barW / 2 + frameGap + frameW / 2 + f * (frameW + frameGap);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      if (frameCover(x, y, fx, cy, frameW, frameH)) put(buf, s, x, y, NERO);
    }
  }
  // fori di perforazione sopra e sotto la barra
  const holeTop = cy - barH / 2 - hole * 1.6;
  const holeBot = cy + barH / 2 + hole * 1.6;
  for (let h = 0; h < nHoles; h++) {
    const hx = cx - holesW / 2 + hole / 2 + h * (hole + holeGap);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      if (frameCover(x, y, hx, holeTop, hole, hole)) put(buf, s, x, y, BIANCO, 235);
      if (frameCover(x, y, hx, holeBot, hole, hole)) put(buf, s, x, y, BIANCO, 235);
    }
  }
}

// downsample 2x (box filter) → anti-aliasing
function downsample(buf2, size2) {
  const size = size2 / 2;
  const b = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, bl = 0, a = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const i = ((y * 2 + dy) * size2 + (x * 2 + dx)) * 4;
      r += buf2[i]; g += buf2[i + 1]; bl += buf2[i + 2]; a += buf2[i + 3];
    }
    const j = (y * size + x) * 4;
    b[j] = Math.round(r / 4); b[j + 1] = Math.round(g / 4); b[j + 2] = Math.round(bl / 4); b[j + 3] = Math.round(a / 4);
  }
  return b;
}

function render(size, fullBleed) {
  const s2 = size * 2;
  const buf2 = canvas(s2);
  drawMotif(buf2, s2, 1, fullBleed);
  return downsample(buf2, s2);
}

try {
  fs.mkdirSync(OUT, { recursive: true });
  const out = render(192, false);
  fs.writeFileSync(path.join(OUT, 'icon-192.png'), encodePng(192, out));
  fs.writeFileSync(path.join(OUT, 'icon-512.png'), encodePng(512, render(512, false)));
  fs.writeFileSync(path.join(OUT, 'icon-maskable-512.png'), encodePng(512, render(512, true)));
  fs.writeFileSync(path.join(OUT, 'apple-touch-icon-180.png'), encodePng(180, render(180, true)));
  console.log('Icone generate in', OUT);
} catch (e) {
  console.error('Errore generazione icone:', e);
  process.exit(1);
}