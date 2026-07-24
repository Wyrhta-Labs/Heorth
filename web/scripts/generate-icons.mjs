#!/usr/bin/env node
// One-off generator for the Heorth PWA icon set: a tasteful ember/parchment
// lettermark ("H"), rendered as raw RGBA and hand-encoded to PNG (no image
// library dependency — this repo has none, and pulling one in just to
// rasterize five static files isn't worth the footprint). Run with:
//   node web/scripts/generate-icons.mjs
// Output is committed under web/public/pwa-icons/ — re-run only if the brand
// colours change. (Not named "icons/": a common global gitignore rule for
// macOS custom-icon marker files, `Icon?`, is case-insensitive and its `?`
// wildcard happens to match the trailing "s" in "icons" too.)
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'pwa-icons');

// Brand palette (web/src/index.css @theme).
const EMBER = [0xb5, 0x54, 0x2f];
const PARCHMENT = [0xf3, 0xee, 0xe2];

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** Encode an RGBA pixel buffer (top-to-bottom, row-major) as a PNG file. */
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = chunk('IHDR', ihdrData);

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = chunk('IDAT', deflateSync(raw, { level: 9 }));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

/** Signed distance-ish rounded-rect test: is (x,y) inside a rounded square? */
function insideRoundedRect(x, y, size, radius) {
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/** Draw the ember-on-parchment "H" lettermark into a size x size RGBA buffer. */
function drawIcon({ size, rounded, safeMargin }) {
  const buf = Buffer.alloc(size * size * 4);
  const radius = rounded ? size * 0.22 : 0;
  const margin = size * safeMargin;
  const barW = size * 0.15;
  const left = margin;
  const right = size - margin;
  const top = margin;
  const bottom = size - margin;
  const midY = size / 2;
  const halfBar = barW / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const inBg = rounded ? insideRoundedRect(x + 0.5, y + 0.5, size, radius) : true;
      let [r, g, b, a] = inBg ? [...EMBER, 255] : [0, 0, 0, 0];

      const inLeftBar = x >= left && x <= left + barW && y >= top && y <= bottom;
      const inRightBar = x >= right - barW && x <= right && y >= top && y <= bottom;
      const inCrossBar = x >= left && x <= right && y >= midY - halfBar && y <= midY + halfBar;
      if (inBg && (inLeftBar || inRightBar || inCrossBar)) {
        [r, g, b, a] = [...PARCHMENT, 255];
      }

      buf[idx] = r; buf[idx + 1] = g; buf[idx + 2] = b; buf[idx + 3] = a;
    }
  }
  return buf;
}

const targets = [
  { name: 'icon-192.png', size: 192, rounded: true, safeMargin: 0.22 },
  { name: 'icon-512.png', size: 512, rounded: true, safeMargin: 0.22 },
  // Maskable: fill edge-to-edge (OS applies its own mask shape) and keep the
  // glyph inside the ~80% "safe zone" so no host mask shape clips the H.
  { name: 'icon-maskable-512.png', size: 512, rounded: false, safeMargin: 0.30 },
  { name: 'apple-touch-icon.png', size: 180, rounded: false, safeMargin: 0.20 },
  { name: 'favicon.png', size: 48, rounded: true, safeMargin: 0.2 },
];

for (const t of targets) {
  const rgba = drawIcon(t);
  const png = encodePng(t.size, t.size, rgba);
  writeFileSync(join(OUT_DIR, t.name), png);
  console.log(`wrote ${t.name} (${t.size}x${t.size}, ${png.length} bytes)`);
}
