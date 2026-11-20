/**
 * Ikony aplikace pro telefon (PWA) – vykreslí logo Slotivy do PNG.
 *
 *   npm run ikony
 *
 * Logo je stejné jako v public/favicon.svg: zakulacený čtverec s přechodem a tři pruhy.
 * Vykresluje se ručně, aby projekt nepotřeboval žádnou knihovnu na obrázky.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT } from '../src/config.js';

const OUT_DIR = path.join(ROOT, 'public', 'icons');

/* ───────── logo v soustavě 48 × 48 (stejná čísla jako favicon.svg) ───────── */

const GRADIENT = { x1: 6, y1: 4, x2: 44, y2: 46, from: [0x1e, 0xc8, 0xbf], to: [0x0a, 0x7c, 0x80] };
const CORNER = 14;
const BARS = [
  { x: 11, y: 11.5, w: 18, h: 7, r: 3.5, alpha: 0.38 },
  { x: 11, y: 20.5, w: 26, h: 7, r: 3.5, alpha: 1 },
  { x: 19, y: 29.5, w: 18, h: 7, r: 3.5, alpha: 0.38 },
];
const SAMPLES = 4; // vzorků na pixel v každé ose – kvůli hladkým hranám

/** Vzdálenost bodu od zakulaceného čtverce (negativní = uvnitř). */
function roundedRectDistance(px, py, { x, y, w, h, r }) {
  const cx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const cy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  const outside = Math.hypot(Math.max(cx, 0), Math.max(cy, 0));
  return outside + Math.min(Math.max(cx, cy), 0) - r;
}

/** Podíl plochy pixelu, který tvar zabírá (0–1). */
const coverage = (distance, pixelSize) => Math.min(1, Math.max(0, 0.5 - distance / pixelSize));

function gradientColor(px, py) {
  const { x1, y1, x2, y2, from, to } = GRADIENT;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.min(1, Math.max(0, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return from.map((channel, i) => channel + (to[i] - channel) * t);
}

/**
 * Vykreslí ikonu.
 *   size      velikost strany v pixelech
 *   rounded   true = zakulacené rohy (běžná ikona), false = přes celou plochu
 *             (potřebuje to Android pro „maskable“ a iPhone si rohy zakulatí sám)
 */
function drawIcon(size, rounded) {
  const scale = size / 48;
  const pixel = 1 / scale; // velikost pixelu v soustavě loga
  const data = Buffer.alloc(size * size * 4);

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = (col + (sx + 0.5) / SAMPLES) * pixel;
          const py = (row + (sy + 0.5) / SAMPLES) * pixel;

          const inBackground = rounded
            ? roundedRectDistance(px, py, { x: 0, y: 0, w: 48, h: 48, r: CORNER }) <= 0
            : true;
          if (!inBackground) continue;

          let [cr, cg, cb] = gradientColor(px, py);
          for (const bar of BARS) {
            if (roundedRectDistance(px, py, bar) > 0) continue;
            cr += (255 - cr) * bar.alpha;
            cg += (255 - cg) * bar.alpha;
            cb += (255 - cb) * bar.alpha;
          }
          r += cr;
          g += cg;
          b += cb;
          a += 1;
        }
      }

      const total = SAMPLES * SAMPLES;
      const offset = (row * size + col) * 4;
      if (a > 0) {
        data[offset] = Math.round(r / a);
        data[offset + 1] = Math.round(g / a);
        data[offset + 2] = Math.round(b / a);
        data[offset + 3] = Math.round((a / total) * 255);
      }
    }
  }
  return data;
}

/* ───────── zápis PNG ───────── */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** Zabalí pixely RGBA do souboru PNG. */
function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8 bitů na kanál
  header[9] = 6; // RGBA
  // zbytek (komprese, filtr, prokládání) zůstává 0

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let row = 0; row < size; row++) {
    raw[row * (stride + 1)] = 0; // řádek bez filtru
    rgba.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ───────── výstup ───────── */

const ICONS = [
  { file: 'icon-192.png', size: 192, rounded: true },
  { file: 'icon-512.png', size: 512, rounded: true },
  { file: 'icon-maskable-512.png', size: 512, rounded: false },
  { file: 'apple-touch-icon.png', size: 180, rounded: false },
];

fs.mkdirSync(OUT_DIR, { recursive: true });
console.log('');
for (const { file, size, rounded } of ICONS) {
  const png = encodePng(size, drawIcon(size, rounded));
  fs.writeFileSync(path.join(OUT_DIR, file), png);
  console.log(`  ✔ ${file.padEnd(24)} ${size}×${size} px, ${(png.length / 1024).toFixed(1)} kB`);
}
console.log('');
console.log(`  Ikony jsou v ${path.relative(ROOT, OUT_DIR)}. Po změně loga spusťte znovu: npm run ikony`);
console.log('');
