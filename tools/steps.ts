// Terrain QA: lists sharp height steps (walls) round Mount Apex: npx tsx tools/steps.ts
import { generateWorld } from '../src/world/finish';
import { V, CELL, HALF } from '../src/world/layout';
const w: any = generateWorld(); const H = w.height;
const hits: [number, number, number][] = [];
for (let j = 1; j < V - 1; j++) for (let i = 1; i < V - 1; i++) {
  const x = -HALF + i * CELL, z = -HALF + j * CELL;
  if (x < -800 || x > 700 || z < -2200 || z > -900) continue;
  const k = j * V + i, d = Math.max(Math.abs(H[k + 1] - H[k]), Math.abs(H[k + V] - H[k]));
  if (d > 3.5 * CELL / 2) hits.push([x, z, d]);
}
const cl = new Map<string, number[]>();
for (const [x, z, d] of hits) { const key = Math.round(x / 50) * 50 + ',' + Math.round(z / 50) * 50; const c = cl.get(key) ?? [0, 0]; c[0]++; c[1] = Math.max(c[1], d); cl.set(key, c); }
console.log('CELL', CELL, 'hits', hits.length);
[...cl.entries()].sort((a, b) => b[1][0] - a[1][0]).slice(0, 25).forEach(([k, v]) => console.log(k, v[0], v[1].toFixed(1)));
hits.sort((a, b) => b[2] - a[2]); const seen: number[][] = [];
for (const h of hits) { if (seen.some((s) => Math.hypot(s[0] - h[0], s[1] - h[1]) < 40)) continue; seen.push(h); if (seen.length > 15) break; console.log('max', h.map((v) => v.toFixed(0)).join(' ')); }
