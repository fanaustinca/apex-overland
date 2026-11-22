// How much of each biome is drivable: npx tsx tools/slopes.ts [base]
// Share of ground (inside the world border) flatter than 25 / 35 / 45 degrees, per biome.
import { generateBase } from '../src/world/gen';
import { generateWorld } from '../src/world/finish';
import { HALF, V, CELL, biomeWeights, BIOME_NAMES } from '../src/world/layout';
const d = process.argv[2] === 'base' ? generateBase() : generateWorld();
const H = d.height, w = [0, 0, 0, 0];
const cnt = [0, 0, 0, 0], ok = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
for (let j = 1; j < V - 1; j += 3) for (let i = 1; i < V - 1; i += 3) {
  const x = -HALF + i * CELL, z = -HALF + j * CELL;
  if (Math.max(Math.abs(x), Math.abs(z)) > HALF - 320) continue;
  biomeWeights(x, z, 0, w); const b = w.indexOf(Math.max(...w));
  const k = j * V + i, gx = (H[k + 1] - H[k - 1]) / (2 * CELL), gz = (H[k + V] - H[k - V]) / (2 * CELL);
  const s = Math.atan(Math.hypot(gx, gz)) * 57.3;
  cnt[b]++; [25, 35, 45].forEach((t, q) => { if (s < t) ok[b][q]++; });
}
for (let b = 0; b < 4; b++) console.log(BIOME_NAMES[b].padEnd(18), ['<25°', '<35°', '<45°'].map((l, q) => `${l} ${(ok[b][q] / cnt[b] * 100).toFixed(0)}%`).join('  '));
