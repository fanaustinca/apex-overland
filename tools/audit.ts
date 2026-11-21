// World QA: npx tsx tools/audit.ts
// Every road: centreline grade, cross-section (knife-edge ridges / sheer drops), dead ends. Every garage: apron
// flatness + road access. Every race: grade spikes along the path, start/finish on a drivable surface.
import { generateWorld } from '../src/world/finish';
import { sampleH } from '../src/world/gen';
import { GARAGES, LAKES } from '../src/world/layout';
import { CABINS } from '../src/world/roads';
import { buildRaces } from '../src/game/races';
const w = generateWorld();
const H = (x: number, z: number) => sampleH(w.height, x, z);
const onBridge = (x: number, z: number, pad = 3) => w.bridges.some((b) => { const dx = b.b[0] - b.a[0], dz = b.b[1] - b.a[1], L2 = dx * dx + dz * dz; const u = ((x - b.a[0]) * dx + (z - b.a[1]) * dz) / L2; if (u < -0.02 || u > 1.02) return false; return Math.hypot(b.a[0] + dx * u - x, b.a[1] + dz * u - z) < b.width / 2 + pad; });
const deckH = (x: number, z: number) => { for (const b of w.bridges) { if (b.pts && b.pts.some((p) => Math.hypot(p[0] - x, p[1] - z) < b.width / 2 + 1)) return b.ha; const dx = b.b[0] - b.a[0], dz = b.b[1] - b.a[1], L2 = dx * dx + dz * dz; const u = ((x - b.a[0]) * dx + (z - b.a[1]) * dz) / L2; if (u < 0 || u > 1) continue; if (Math.hypot(b.a[0] + dx * u - x, b.a[1] + dz * u - z) < b.width / 2 + 1) return b.ha + (b.hb - b.ha) * u; } return null; };
const surfH = (x: number, z: number) => { const d = deckH(x, z), g = H(x, z); return d !== null && d - g < 8 ? d : g; };
let problems = 0;
console.log('=== ROADS ===');
for (const r of w.roads) {
  const half = r.width / 2, n = r.pts.length;
  let maxG = 0, at = '', ridge = 0, drop = 0, ridgeAt = '', dropAt = '';
  const steep: string[] = [];
  for (let i = 2; i < n; i++) {
    const [x, z] = r.pts[i], [px, pz] = r.pts[i - 2];
    const g = Math.abs(surfH(x, z) - surfH(px, pz)) / Math.max(1, Math.hypot(x - px, z - pz));
    if (g > maxG) { maxG = g; at = `(${x.toFixed(0)},${z.toFixed(0)})`; }
    if (g > (r.id.startsWith('ruts-') ? 0.36 : 0.33)) steep.push(`(${x.toFixed(0)},${z.toFixed(0)}) ${g.toFixed(2)}`);
    if (r.bridged[i] || onBridge(x, z, 12)) continue;
    // cross-section
    const a = r.pts[Math.max(0, i - 1)], b = r.pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const c = H(x, z);
    const side = (s: number, o: number) => c - H(x - tz * s * (half + o), z + tx * s * (half + o));
    const o = 10, dl = side(-1, o), dr = side(1, o);
    const lim = o * 0.85;
    if (dl > lim && dr > lim) { ridge++; ridgeAt ||= `(${x.toFixed(0)},${z.toFixed(0)}) L${dl.toFixed(0)} R${dr.toFixed(0)}`; }
    else if (Math.max(dl, dr) > o * 1.1 && r.earth !== false) { drop++; dropAt ||= `(${x.toFixed(0)},${z.toFixed(0)}) ${Math.max(dl, dr).toFixed(0)}m`; }
  }
  const bad = maxG > (r.id.startsWith('ruts-') ? 0.36 : 0.33) || ridge > 0 || drop > 3;
  if (bad) problems++;
  console.log(`${bad ? '✗' : '✓'} ${r.id.padEnd(15)} ${(r.len / 1000).toFixed(2)}km  max grade ${(maxG * 100).toFixed(0)}% ${at}${steep.length ? `  steep×${steep.length}: ${steep.slice(0, 3).join(' ')}` : ''}${ridge ? `  RIDGE×${ridge} ${ridgeAt}` : ''}${drop ? `  drop×${drop} ${dropAt}` : ''}`);
}
console.log('\n=== DEAD ENDS ===');
const dests = [[0, 0, 90], ...w.bridges.flatMap((b) => [[b.a[0], b.a[1], 6], [b.b[0], b.b[1], 6]]), [-1250, -120, 140], [-1060, 560, 90], ...GARAGES.map((g) => [g.x, g.z, 70]), ...CABINS.map((c) => [c.x, c.z, 30]), ...LAKES.map((l) => [l.x, l.z, l.r + 60])] as [number, number, number][];
for (const r of w.roads) for (const [x, z] of [r.pts[0], r.pts[r.pts.length - 1]]) {
  const joined = w.roads.some((o) => o !== r && o.pts.some((p) => Math.hypot(p[0] - x, p[1] - z) < 14)) || dests.some(([dx, dz, rr]) => Math.hypot(dx - x, dz - z) < rr);
  if (!joined) { problems++; console.log(`✗ ${r.id} ends in the middle of nowhere at (${x.toFixed(0)},${z.toFixed(0)})`); }
}
console.log('\n=== GARAGES ===');
for (const g of GARAGES) {
  const D = g.main ? 20 : 12, ax = g.x + Math.sin(g.yaw) * (D / 2 + (g.main ? 18 : 10)), az = g.z + Math.cos(g.yaw) * (D / 2 + (g.main ? 18 : 10));
  let mn = 1e9, mx = -1e9; for (let dx = -10; dx <= 10; dx += 2) for (let dz = -10; dz <= 10; dz += 2) { const h = H(ax + dx, az + dz); mn = Math.min(mn, h); mx = Math.max(mx, h); }
  let rd = 1e9, rid = ''; for (const r of w.roads) for (const p of r.pts) { const d = Math.hypot(p[0] - ax, p[1] - az); if (d < rd) { rd = d; rid = r.id; } }
  const b0 = H(g.x, g.z);
  const bad = mx - mn > 0.8 || rd > 45;
  if (bad) problems++;
  console.log(`${bad ? '✗' : '✓'} ${g.id.padEnd(10)} apron (${ax.toFixed(0)},${az.toFixed(0)}) relief ${(mx - mn).toFixed(2)}m  building ${b0.toFixed(1)} apron ${H(ax, az).toFixed(1)}  nearest road ${rid} ${rd.toFixed(0)}m`);
}
console.log('\n=== RACES ===');
const races = buildRaces(w.roads, w.rivers);
for (const r of races) {
  const bad: string[] = [];
  for (let i = 4; i < r.path.length; i += 2) {
    const [x, z] = r.path[i], [px, pz] = r.path[i - 4];
    // along a bridge deck the path rides the deck; under it, the ground
    const along = (qx: number, qz: number) => { for (const b of w.bridges) { const dx = b.b[0] - b.a[0], dz = b.b[1] - b.a[1], L = Math.hypot(dx, dz); const u = ((qx - b.a[0]) * dx + (qz - b.a[1]) * dz) / (L * L); if (u < -0.03 || u > 1.03 || Math.hypot(b.a[0] + dx * u - qx, b.a[1] + dz * u - qz) > b.width / 2 + 2) continue; const tx = x - px, tz = z - pz; if (Math.abs((tx * dx + tz * dz) / (Math.hypot(tx, tz) * L)) > 0.85) return b.ha + (b.hb - b.ha) * Math.min(1, Math.max(0, u)); } return H(qx, qz); };
    const g = (along(x, z) - along(px, pz)) / Math.max(1, Math.hypot(x - px, z - pz));
    if (Math.abs(g) > 0.5) bad.push(`(${x.toFixed(0)},${z.toFixed(0)}) ${g.toFixed(2)}`);
  }
  if (bad.length && !r.id.includes('rim-jumper')) problems++;
  console.log(`${bad.length ? '✗' : '✓'} ${r.id.padEnd(22)} ${(r.path.length * 3 / 1000).toFixed(1)}km  ${bad.length ? 'STEEP×' + bad.length + ': ' + bad.slice(0, 4).join(' | ') : 'ok'}`);
}
console.log('\n=== BRIDGES ===');
for (const b of w.bridges) { const L = Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1]); console.log(`  ${b.id.padEnd(22)} ${b.style.padEnd(7)} ${L.toFixed(0)}m  deck ${b.ha.toFixed(1)}→${b.hb.toFixed(1)}${b.floor !== undefined ? `  clearance ${(Math.min(b.ha, b.hb) - b.floor - 1.5).toFixed(1)}m above water` : ''}`); }
console.log(`\n${problems} problem(s)`);
