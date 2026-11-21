// Renders the generated world as a top-down hillshade PNG for layout authoring: npx tsx tools/map.ts out.png [base]
// Grid lines every 256 m (thicker every 1024 m, the origin lines are white). Roads tan, bridges red, water blue,
// garages cyan, cabins purple, race starts orange, finishes green.
import sharp from 'sharp';
import { generateBase } from '../src/world/gen';
import { generateWorld } from '../src/world/finish';
import { GARAGES, V, N, HALF, CTRL, WORLD } from '../src/world/layout';
import { CABINS } from '../src/world/roads';
import { buildRaces } from '../src/game/races';
const base = process.argv[3] === 'base';
const t0 = performance.now();
const d: any = base ? generateBase() : generateWorld();
console.log('gen ms', Math.round(performance.now() - t0));
const S = CTRL, img = Buffer.alloc(S * S * 3);
let mn = 1e9, mx = -1e9; for (const h of d.height) { mn = Math.min(mn, h); mx = Math.max(mx, h); }
console.log('height range', mn.toFixed(1), mx.toFixed(1));
const px = (x: number, z: number, r: number, g: number, b: number, rad = 0) => {
  const cx = Math.round((x + HALF) / WORLD * S), cz = Math.round((z + HALF) / WORLD * S);
  for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) { const X = cx + dx, Z = cz + dz; if (X < 0 || Z < 0 || X >= S || Z >= S) continue; const k = (Z * S + X) * 3; img[k] = r; img[k + 1] = g; img[k + 2] = b; }
};
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const i = x * 2, j = y * 2;
  const h = d.height[j * V + i];
  const hx = d.height[j * V + Math.min(i + 2, N)] - h, hz = d.height[Math.min(j + 2, N) * V + i] - h;
  const shade = Math.max(0.25, Math.min(1, 0.7 - (hx * 0.7 + hz * 0.5) / 10));
  const t = (h - mn) / (mx - mn);
  let r = 60 + 190 * t, g = 90 + 150 * t, b = 70 + 160 * t;
  if (!Number.isNaN(d.water[y * CTRL + x])) { r = 40; g = 90; b = 200; }
  const c = (Math.floor(h / 10) !== Math.floor((h + Math.max(Math.abs(hx), Math.abs(hz))) / 10)) ? 0.75 : 1;
  if (d.roadMask) { const rm = d.roadMask[j * N + i]; if (rm > 120) { r = 230; g = 200; b = 120; } }
  const k = (y * S + x) * 3;
  img[k] = Math.min(255, r * shade * c * 1.3); img[k + 1] = Math.min(255, g * shade * c * 1.3); img[k + 2] = Math.min(255, b * shade * c * 1.3);
}
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const wx = x * 4 - HALF, wz = y * 4 - HALF;
  if (wx % 256 === 0 || wz % 256 === 0) { const k = (y * S + x) * 3; const strong = wx === 0 || wz === 0; img[k] = 255; img[k + 1] = strong ? 255 : img[k + 1] >> 1; img[k + 2] = strong ? 255 : img[k + 2] >> 1; }
}
if (!base) {
  for (const b of d.bridges) for (let t = 0; t <= 1; t += 0.02) px(b.a[0] + (b.b[0] - b.a[0]) * t, b.a[1] + (b.b[1] - b.a[1]) * t, 255, 40, 40, 1);
  try { for (const r of buildRaces(d.roads, d.rivers)) { r.path.forEach(([x, z], i) => { if (i % 4 === 0) px(x, z, 255, 140, 0); }); px(r.path[0][0], r.path[0][1], 255, 120, 0, 4); const e = r.path[r.path.length - 1]; px(e[0], e[1], 60, 255, 90, 4); } } catch (e) { console.log('races:', (e as Error).message); }
  for (const g of GARAGES) px(g.x, g.z, 60, 230, 255, 5);
  for (const c of CABINS) px(c.x, c.z, 200, 90, 255, 4);
}
await sharp(img, { raw: { width: S, height: S, channels: 3 } }).png().toFile(process.argv[2] ?? 'map.png');
