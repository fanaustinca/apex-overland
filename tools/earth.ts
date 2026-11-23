// Per-road earthworks report: how far each road's surface sits from the natural ground (h - raw): max cut/fill, mean |Δ|.
// npx tsx tools/earth.ts [roadIds...]
import { generateWorld } from '../src/world/finish';
const w: any = generateWorld(), ids = process.argv.slice(2);
const rows: [string, number, number, number, number, string][] = [];
for (const r of w.roads) {
  if (ids.length && !ids.includes(r.id)) continue;
  if (!r.raw) continue;
  let cut = 0, fill = 0, sum = 0, n = 0, at = '';
  for (let i = 0; i < r.pts.length; i++) { if (r.bridged[i]) continue; const d = r.h[i] - r.raw[i]; if (-d > cut) { cut = -d; at = r.pts[i].map((v: number) => v.toFixed(0)).join(','); } fill = Math.max(fill, d); sum += Math.abs(d); n++; }
  rows.push([r.id, cut, fill, sum / Math.max(1, n), r.len, at]);
}
rows.sort((a, b) => b[3] - a[3]);
for (const [id, c, f, m, l, at] of rows) console.log(id.padEnd(16), `len ${(l / 1000).toFixed(2)}km  mean|Δ| ${m.toFixed(1)}m  cut ${c.toFixed(1)}m (${at})  fill ${f.toFixed(1)}m`);
