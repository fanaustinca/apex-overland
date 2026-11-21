// Scans every race route for impassable grade spikes (bridges excluded): npx tsx tools/routes.ts
import { generateWorld } from '../src/world/finish';
import { sampleH } from '../src/world/gen';
import { buildRaces } from '../src/game/races';
const w = generateWorld(); const races = buildRaces(w.roads);
const onBridge = (x: number, z: number) => w.bridges.some((b) => { const dx = b.b[0] - b.a[0], dz = b.b[1] - b.a[1], L2 = dx * dx + dz * dz; const u = ((x - b.a[0]) * dx + (z - b.a[1]) * dz) / L2; if (u < -0.05 || u > 1.05) return false; return Math.hypot(b.a[0] + dx * u - x, b.a[1] + dz * u - z) < 12; });
for (const r of races) {
  const bad: string[] = [];
  for (let i = 4; i < r.path.length; i += 2) {
    const [x, z] = r.path[i], [px, pz] = r.path[i - 4];
    if (onBridge(x, z) || onBridge(px, pz)) continue;
    const g = (sampleH(w.height, x, z) - sampleH(w.height, px, pz)) / Math.max(1, Math.hypot(x - px, z - pz));
    if (Math.abs(g) > 0.55) bad.push(`${i}@(${x.toFixed(0)},${z.toFixed(0)}) ${g.toFixed(2)}`);
  }
  console.log(r.id.padEnd(22), (r.path.length * 3 / 1000).toFixed(1) + 'km', bad.length ? 'STEEP: ' + bad.slice(0, 6).join(' | ') + (bad.length > 6 ? ` (+${bad.length - 6})` : '') : 'ok');
}
