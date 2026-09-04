#!/usr/bin/env node
/**
 * Generates the extension icons as PNGs.
 *
 * Chrome will not accept SVG for extension icons, and adding an image library
 * for four flat shapes is not worth it, so this writes the PNG bytes directly.
 * The mark is a rounded portrait card (the 9:16 of a short video) with a play
 * triangle knocked out of it.
 *
 * Regenerate with `npm run build:icons`.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const SIZES = [16, 32, 48, 128];

// Matches --accent in the panel stylesheet.
const INK = [180, 83, 31];
const HOLE = [255, 255, 255];

/** Signed distance to a rounded rectangle, for cheap antialiasing. */
function roundedRectSDF(x, y, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(x - cx) - (halfW - r);
  const qy = Math.abs(y - cy) - (halfH - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - r;
}

/** Signed distance to a triangle, via half-plane tests. */
function triangleSDF(px, py, a, b, c) {
  const sign = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const d1 = sign([px, py], a, b);
  const d2 = sign([px, py], b, c);
  const d3 = sign([px, py], c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return hasNeg && hasPos ? 1 : -1;   // inside when all signs agree
}

function render(size, opts = {}) {
  const px = new Uint8Array(size * size * 4);
  const s = size;
  // A launch thumbnail sits on someone else's page, so it needs its own ground
  // and a mark that fills more of the frame to stay legible small.
  const bg = opts.background ?? null;
  const pad = s * (bg ? 0.24 : 0.14);
  const cardHalfW = (s - pad * 2) * 0.34;
  const cardHalfH = (s - pad * 2) * 0.5;
  const cx = s / 2;
  const cy = s / 2;
  const radius = Math.max(1, s * 0.11);

  // Play triangle, centred, sized against the card rather than the canvas so
  // the proportions hold at any padding.
  const t = cardHalfW * 0.61;
  const a = [cx - t * 0.75, cy - t];
  const b = [cx - t * 0.75, cy + t];
  const c = [cx + t * 0.95, cy];

  // Supersample so small sizes stay crisp rather than jagged.
  const SS = 3;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      let cov = 0;
      let hole = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;
          if (roundedRectSDF(fx, fy, cx, cy, cardHalfW, cardHalfH, radius) <= 0) cov++;
          if (triangleSDF(fx, fy, a, b, c) < 0) hole++;
        }
      }
      const total = SS * SS;
      const alpha = cov / total;
      const holeAmt = hole / total;
      const i = (y * s + x) * 4;
      const mark = [
        INK[0] + (HOLE[0] - INK[0]) * holeAmt,
        INK[1] + (HOLE[1] - INK[1]) * holeAmt,
        INK[2] + (HOLE[2] - INK[2]) * holeAmt,
      ];
      if (bg) {
        // Composite the mark over an opaque ground.
        px[i] = Math.round(bg[0] + (mark[0] - bg[0]) * alpha);
        px[i + 1] = Math.round(bg[1] + (mark[1] - bg[1]) * alpha);
        px[i + 2] = Math.round(bg[2] + (mark[2] - bg[2]) * alpha);
        px[i + 3] = 255;
      } else {
        px[i] = Math.round(mark[0]);
        px[i + 1] = Math.round(mark[1]);
        px[i + 2] = Math.round(mark[2]);
        px[i + 3] = Math.round(alpha * 255);
      }
    }
  }
  return px;
}

/* ------------------------------------------------------------- PNG writer */

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function toPng(px, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  // 10..12 stay zero: deflate, adaptive filtering, no interlace

  // Each scanline is prefixed with its filter byte; 0 means "none".
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, rowStart + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT, `icon${size}.png`);
  writeFileSync(file, toPng(render(size), size));
  console.log(`  wrote icons/icon${size}.png`);
}

// The store listing needs a 128 too; it is the same asset.
console.log(`  (icon128.png doubles as the Chrome Web Store icon)`);

// Product Hunt wants 240x240, and an opaque ground so it reads on any page.
const GROUND = [23, 22, 26];
writeFileSync(join(OUT, 'product-hunt-240.png'), toPng(render(240, { background: GROUND }), 240));
console.log('  wrote icons/product-hunt-240.png  (Product Hunt thumbnail)');
