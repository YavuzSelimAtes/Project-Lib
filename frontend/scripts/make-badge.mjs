// Android bildirim rozeti: seffaf zeminde beyaz acik-kitap silueti (96x96). Calistir: node scripts/make-badge.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
const N = 96, SS = 4;
const poly = (pts, x, y) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const L = [[10, 24], [45, 31], [45, 72], [10, 65]];
const R = L.map(([x, y]) => [96 - x, y]);
const base = [[10, 72], [45, 79], [51, 79], [86, 72], [86, 78], [51, 85], [45, 85], [10, 78]];
const shapes = [L, R, base];
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0;
  for (let x = 0; x < N; x++) {
    let hit = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) { const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS; if (shapes.some((s) => poly(s, px, py))) hit++; }
    const o = y * (N * 4 + 1) + 1 + x * 4;
    raw[o] = raw[o + 1] = raw[o + 2] = 255; raw[o + 3] = Math.round((hit / (SS * SS)) * 255);
  }
}
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
writeFileSync(new URL('../public/badge-96.png', import.meta.url), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
