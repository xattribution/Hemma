/**
 * Generates the PWA icon set without any image dependencies: raw RGBA pixel
 * buffers encoded as PNG via node:zlib. Rounded warm-cream tile, coral
 * calendar with binder rings, and a little heart on the page.
 *
 * Run: pnpm --filter @coord/web icons   (outputs are committed)
 */
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public/icons");
fs.mkdirSync(outDir, { recursive: true });

const CREAM = [253, 248, 240, 255];
const CORAL = [224, 93, 93, 255];
const WHITE = [255, 255, 255, 255];
const INK = [58, 51, 48, 255];

function makeCanvas(size) {
  return { size, data: new Uint8Array(size * size * 4) };
}

function set(c, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= c.size || y >= c.size) return;
  const i = (y * c.size + x) * 4;
  c.data[i] = r; c.data[i + 1] = g; c.data[i + 2] = b; c.data[i + 3] = a;
}

function fillRoundedRect(c, x0, y0, w, h, radius, color) {
  x0 = Math.floor(x0); y0 = Math.floor(y0); w = Math.floor(w); h = Math.floor(h);
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const dx = x < x0 + radius ? x0 + radius - x : x > x0 + w - 1 - radius ? x - (x0 + w - 1 - radius) : 0;
      const dy = y < y0 + radius ? y0 + radius - y : y > y0 + h - 1 - radius ? y - (y0 + h - 1 - radius) : 0;
      if (dx * dx + dy * dy <= radius * radius) set(c, x, y, color);
    }
  }
}

function fillCircle(c, cx, cy, radius, color) {
  for (let y = Math.floor(cy - radius); y <= cy + radius; y++) {
    for (let x = Math.floor(cx - radius); x <= cx + radius; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) set(c, x, y, color);
    }
  }
}

function fillHeart(c, cx, cy, s, color) {
  // Two lobes + a point-down triangle.
  fillCircle(c, cx - s * 0.35, cy - s * 0.2, s * 0.42, color);
  fillCircle(c, cx + s * 0.35, cy - s * 0.2, s * 0.42, color);
  const top = cy - s * 0.05, bottom = cy + s * 0.75;
  for (let y = Math.floor(top); y <= bottom; y++) {
    const t = (y - top) / (bottom - top);
    const half = s * 0.75 * (1 - t);
    for (let x = Math.floor(cx - half); x <= cx + half; x++) set(c, x, y, color);
  }
}

function drawIcon(size, { maskable = false } = {}) {
  const c = makeCanvas(size);
  const u = size / 100; // work in a 100-unit grid

  // Background tile (full-bleed square for maskable, rounded otherwise)
  if (maskable) fillRoundedRect(c, 0, 0, size, size, 0.01 * size, CREAM);
  else fillRoundedRect(c, 0, 0, size, size, 22 * u, CREAM);

  // Calendar body
  fillRoundedRect(c, 16 * u, 22 * u, 68 * u, 62 * u, 8 * u, CORAL);
  // Page
  fillRoundedRect(c, 21 * u, 36 * u, 58 * u, 43 * u, 5 * u, WHITE);
  // Binder rings
  fillRoundedRect(c, 30 * u, 14 * u, 6 * u, 16 * u, 3 * u, INK);
  fillRoundedRect(c, 64 * u, 14 * u, 6 * u, 16 * u, 3 * u, INK);
  // Heart on the page
  fillHeart(c, 50 * u, 55 * u, 17 * u, CORAL);

  return c;
}

// ---- Minimal PNG encoder ----
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256).map((_, n) => {
      let value = n;
      for (let k = 0; k < 8; k++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      return value;
    });
  }
  let crc = -1;
  for (const byte of buf) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng({ size, data }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(data.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const [name, size, opts] of [
  ["icon-192.png", 192, {}],
  ["icon-512.png", 512, {}],
  ["icon-512-maskable.png", 512, { maskable: true }],
  ["apple-touch-icon.png", 180, { maskable: true }],
]) {
  fs.writeFileSync(path.join(outDir, name), encodePng(drawIcon(size, opts)));
  console.log(`wrote icons/${name}`);
}
