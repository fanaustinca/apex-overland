// Point-to-point race definitions built on the road network, plus suggested alternative GPS routes.
import type { Road } from '../world/roads';
import type { P2 } from '../world/layout';
import { canyonZ as cz, PITS, OFFROAD } from '../world/layout';
import { resample } from '../world/gen';

export interface RaceDef { id: string; name: string; biome: number | 'marathon'; desc: string; reward: number; path: P2[]; alts: P2[][]; cps: P2[]; rivals: number }

type Seg = string | P2[];
function roadPts(roads: Road[], spec: string): P2[] {
  // "id", "-id" (reversed), "id@a:b" fraction range, "-id@a:b"
  const rev = spec.startsWith('-');
  let [id, range] = (rev ? spec.slice(1) : spec).split('@');
  const r = roads.find((x) => x.id === id);
  if (!r) throw new Error('road ' + id);
  let pts = r.pts.slice();
  if (range) { const [a, b] = range.split(':').map(Number); pts = pts.slice(Math.floor(a * (pts.length - 1)), Math.ceil(b * (pts.length - 1)) + 1); }
  return rev ? pts.reverse() : pts;
}
function build(roads: Road[], segs: Seg[]): P2[] {
  const out: P2[] = [];
  for (const s of segs) {
    const pts = typeof s === 'string' ? roadPts(roads, s) : s;
    for (const p of pts) { const l = out[out.length - 1]; if (!l || Math.hypot(l[0] - p[0], l[1] - p[1]) > 1.5) out.push(p); }
  }
  return resample(out, 3);
}
function checkpoints(path: P2[], spacing: number): P2[] {
  const cps: P2[] = [];
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    acc += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    if (acc >= spacing && i < path.length - 30) { cps.push(path[i]); acc = 0; }
  }
  cps.push(path[path.length - 1]);
  return cps;
}
/** Straight-line "shortcut" suggestions between checkpoints that are far apart along the road. */
function shortcuts(path: P2[], cps: P2[], minSave: number): P2[][] {
  const out: P2[][] = [];
  const idx = (p: P2) => path.findIndex((q) => q[0] === p[0] && q[1] === p[1]);
  const all = [path[0], ...cps];
  for (let k = 0; k < all.length - 1; k++) {
    const a = all[k], b = all[k + 1];
    const ia = Math.max(0, idx(a)), ib = idx(b);
    const roadLen = (ib - ia) * 3, direct = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (roadLen - direct > minSave) out.push([a, b]);
  }
  return out;
}

export function buildRaces(roads: Road[]): RaceDef[] {
  const B = (segs: Seg[]) => build(roads, segs);
  const races: RaceDef[] = [];
  const add = (id: string, name: string, biome: RaceDef['biome'], desc: string, reward: number, path: P2[], spacing: number, extraAlts: P2[][] = [], rivals = 4, minSave = 60) => {
    const cps = checkpoints(path, spacing);
    races.push({ id, name, biome, desc, reward, path, cps, alts: [...extraAlts, ...shortcuts(path, cps, minSave)].slice(0, 3), rivals });
  };
  // ---------------- Desert Canyon ----------------
  add('canyon-breakout', 'Canyon Breakout', 0, 'Start on the canyon floor, splash through the river, claw up the cliff trail and sprint across the dunes.', 2600,
    B(['canyon-floor@0.45:1', 'cliff-trail', OFFROAD['canyon-breakout'][0]]), 300,
    [[[200, cz(200) + 6], [330, cz(330) + 20], [585, 1550]]]);
  add('rim-jumper', 'Rim Jumper', 0, 'Hug the north rim and launch the rock ramps across the canyon narrows. Come up short and you will be climbing out.', 3000,
    B(OFFROAD['rim-jumper']), 260, [[[-560, cz(-560) - 150], [-80, cz(-80) - 100], [150, cz(150) - 100]]], 3);
  add('dune-basher', 'Dune Basher', 0, 'No roads, no rules: flat-out across the southern dune sea.', 2200,
    B(OFFROAD['dune-basher']), 330, [[[-1100, 1555], [1250, 1600]]]);
  // ---------------- Dense Forest ----------------
  add('timberline-plow', 'Timberline Plow', 1, 'A narrow trail through the thickest woods. Bring a dozer plow and carve your own line.', 2800,
    B(['timber-trail']), 260, [], 4, 40);
  add('muddy-creek', 'Muddy Creek Run', 1, 'Race down the creek bed itself. Deep pools stall engines without a snorkel.', 2600,
    B([[[1010, -900], [1150, -560], [1230, -220], [1180, 120], [1260, 430], [1430, 700], [1560, 980]]]), 280, [B(['forest-loop@0.1:0.45'])], 4, 9999);
  add('logging-camp', 'Logging Camp Sprint', 1, 'From the hub to the logging camp on winding dirt. Short, fast, brutal.', 2000,
    B(['hub-east@0.02:0.38', 'forest-loop@0:0.36']), 300);
  // ---------------- Snowy Mountain ----------------
  add('avalanche-switchbacks', 'Avalanche Switchbacks', 2, 'Eight icy hairpins up the face of Mount Apex. Spiked tyres recommended.', 3000,
    B(['hub-north@0.05:1']), 320, [], 4, 120);
  add('peak-descent', 'Peak Descent', 2, 'Drop off the summit down the west face. The snow chutes are faster... if you survive them.', 2800,
    B(['peak-descent', '-quarry-north@0.25:1']), 300, [[[-120, -1385], [-500, -1050], [-760, -700]]]);
  add('glacier-ridge', 'Glacier Ridge', 2, 'Ride the knife-edge ridge east from the summit with a drop on both sides.', 2900,
    B(['glacier-ridge@0:0.72']), 300);
  // ---------------- Industrial Quarry ----------------
  add('pit-escape', 'Pit Escape', 3, 'Start at the bottom of Pit A and spiral up the haul ramp to daylight.', 2400,
    B(['-pitA-spiral', '-hub-west@0:0.55']), 260, [], 4, 80);
  add('crusher-circuit', 'Crusher Circuit', 3, 'Round the crusher plant, past the site trailers (crushable!) to the quarry works.', 2300,
    B(['-pitB-road@0.2:1', 'hub-west@0.6:0.95', 'quarry-north@0:0.45']), 250);
  add('haul-road-havoc', 'Haul Road Havoc', 3, 'Out of Pit B and down the haul road into the canyon mouth.', 2500,
    B(['-pitB-spiral', 'haul-south', 'canyon-entry']), 280);
  // ---------------- Cross-biome marathons ----------------
  add('summit-to-sands', 'Summit to Sands', 'marathon', 'Snow to sand: down the switchbacks, through the hub, over the steel bridge into the desert.', 7000,
    B(['-hub-north', 'hub-south', [[150, cz(150) - 100], [150, cz(150) + 100]], 'south-desert']), 450, [], 5, 200);
  add('quarry-to-glacier', 'Quarry to Glacier', 'marathon', 'Pit A rim to the glacier foothills via the hub and the deep forest.', 6500,
    B(['-hub-west', [[0, 0]], 'hub-east@0.02:0.45', 'forest-north']), 450, [], 5, 150);
  add('timber-to-canyon', 'Timber to Canyon', 'marathon', 'Logging camp to the far side of the stone arch: forest, hub, desert and one very old bridge.', 6800,
    B(['forest-loop@0.36:1', 'hub-south@0:0.7', 'desert-east', [[1000, cz(1000) - 100], [1000, cz(1000) + 100]], 'desert-east-s']), 450, [], 5, 150);
  return races;
}
export const BIOME_LABEL = ['Desert Canyon', 'Dense Forest', 'Snowy Mountain', 'Industrial Quarry'];
