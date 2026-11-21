// Renders the generated world as a top-down hillshade PNG for layout authoring: npx tsx tools/map.ts out.png
import sharp from 'sharp';
import { generateBase } from '../src/world/gen';
import { buildRoads } from '../src/world/roads';
import { V, N, HALF, CELL } from '../src/world/layout';
const t0 = performance.now();
const d = generateBase();
const rd = buildRoads(d);
console.log(rd.roads.map((r) => `${r.id} ${Math.round(r.len)}m h ${r.h[0].toFixed(0)}->${r.h[r.h.length-1].toFixed(0)}`).join('\n'));
console.log(rd.bridges);
console.log('gen ms', Math.round(performance.now() - t0));
const S = 1024, img = Buffer.alloc(S * S * 3);
let mn = 1e9, mx = -1e9; for (const h of d.height) { mn = Math.min(mn, h); mx = Math.max(mx, h); }
console.log('height range', mn.toFixed(1), mx.toFixed(1));
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const i = x * 2, j = y * 2;
  const h = d.height[j * V + i];
  const hx = d.height[j * V + Math.min(i + 2, N)] - h, hz = d.height[Math.min(j + 2, N) * V + i] - h;
  const shade = Math.max(0.25, Math.min(1, 0.7 - (hx * 0.7 + hz * 0.5) / 10));
  const t = (h - mn) / (mx - mn);
  let r = 60 + 190 * t, g = 90 + 150 * t, b = 70 + 160 * t;
  if (!Number.isNaN(d.water[y * 1024 + x])) { r = 40; g = 90; b = 200; }
  const c = (Math.floor(h / 10) !== Math.floor((h + Math.max(Math.abs(hx), Math.abs(hz))) / 10)) ? 0.75 : 1;
  const rm = rd.roadMask[j * N + i]; if (rm > 120) { r = 230; g = 200; b = 120; }
  const k = (y * S + x) * 3;
  img[k] = r * shade * c * 1.3; img[k + 1] = g * shade * c * 1.3; img[k + 2] = b * shade * c * 1.3;
}
// grid every 256 m
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (x % 64 === 0 || y % 64 === 0) { const k = (y * S + x) * 3; img[k] = 255; img[k + 1] = img[k + 1] >> 1; img[k + 2] = img[k + 2] >> 1; }
await sharp(img, { raw: { width: S, height: S, channels: 3 } }).png().toFile(process.argv[2] ?? 'map.png');
