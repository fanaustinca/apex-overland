// Finds road stretches walled in on both sides (a trench between slopes): npx tsx tools/trench.ts
import { generateWorld } from '../src/world/finish';
import { sampleH } from '../src/world/gen';
const w = generateWorld();
const H = (x: number, z: number) => sampleH(w.height, x, z);
for (const r of w.roads) {
  const n = r.pts.length; let run = 0, best = 0, at = '', worst = 0;
  for (let i = 1; i < n - 1; i++) {
    const [x, z] = r.pts[i], a = r.pts[i - 1], b = r.pts[i + 1];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const c = r.h[i]; let lmin = 1e9, rmin = 1e9;
    for (const o of [40, 70]) { lmin = Math.min(lmin, H(x - tz * o, z + tx * o) - c); rmin = Math.min(rmin, H(x + tz * o, z - tx * o) - c); }
    const wall = Math.min(lmin, rmin);
    if (wall > 14) { run++; if (run > best) { best = run; } if (wall > worst) { worst = wall; at = `(${x.toFixed(0)},${z.toFixed(0)})`; } } else run = 0;
  }
  if (best * 3 > 60) console.log(`${r.id.padEnd(16)} walled run ${(best * 3).toFixed(0)}m  walls up to ${worst.toFixed(0)}m at ${at}`);
}
