// Point-to-point race definitions built on the road network.
// Waypoints are GPS guidance only: any line to the finish counts (cut across country if you dare). Races whose start and
// finish are close together (lake slalom, MX track) are `strict`: their gates must be taken in order.
import type { Road } from '../world/roads';
import type { P2 } from '../world/layout';
import { canyonZ as cz, OFFROAD, LAKES } from '../world/layout';
import { resample } from '../world/gen';

export interface RaceDef { id: string; name: string; biome: number | 'marathon'; desc: string; reward: number; path: P2[]; alts: P2[][]; cps: P2[]; rivals: number; strict: boolean; rem: Float32Array; len: number }
interface RiverLike { id: string; pts: P2[] }

/** A slice of a road between the samples nearest to `from` and `to` (either may be omitted = road end). */
type Slice = { r: string; from?: P2; to?: P2 };
type Seg = Slice | P2[];
function nearestIdx(pts: P2[], p: P2) { let b = 0, bd = 1e18; pts.forEach((q, i) => { const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (d < bd) { bd = d; b = i; } }); return b; }
function slice(roads: Road[], s: Slice): P2[] {
  const r = roads.find((x) => x.id === s.r);
  if (!r) throw new Error('road ' + s.r);
  const a = s.from ? nearestIdx(r.pts, s.from) : 0, b = s.to ? nearestIdx(r.pts, s.to) : r.pts.length - 1;
  return a <= b ? r.pts.slice(a, b + 1) : r.pts.slice(b, a + 1).reverse();
}
function build(roads: Road[], segs: Seg[]): P2[] {
  const out: P2[] = [];
  for (const s of segs) {
    const pts = Array.isArray(s) ? s : slice(roads, s);
    for (const p of pts) { const l = out[out.length - 1]; if (!l || Math.hypot(l[0] - p[0], l[1] - p[1]) > 1.5) out.push(p); }
  }
  return resample(out, 3);
}
/** Evenly spaced waypoints (few of them: they're guidance, not a fence), always ending at the finish. */
function waypoints(path: P2[], spacing: number): P2[] {
  const len = path.length * 3, n = Math.max(1, Math.round(len / spacing));
  const cps: P2[] = [];
  for (let k = 1; k < n; k++) cps.push(path[Math.round(k / n * (path.length - 1))]);
  cps.push(path[path.length - 1]);
  return cps;
}
/** Straight-line shortcut suggestions where the road wanders far from the direct line. */
function shortcuts(path: P2[], cps: P2[], minSave: number): P2[][] {
  const out: P2[][] = [];
  const all = [path[0], ...cps];
  for (let k = 0; k < all.length - 1; k++) {
    const ia = nearestIdx(path, all[k]), ib = nearestIdx(path, all[k + 1]);
    const roadLen = (ib - ia) * 3, direct = Math.hypot(all[k + 1][0] - all[k][0], all[k + 1][1] - all[k][1]);
    if (roadLen - direct > minSave) out.push([all[k], all[k + 1]]);
  }
  return out;
}

export function buildRaces(roads: Road[], rivers: RiverLike[] = []): RaceDef[] {
  const B = (segs: Seg[]) => build(roads, segs);
  const races: RaceDef[] = [];
  const add = (id: string, name: string, biome: RaceDef['biome'], desc: string, reward: number, path: P2[], spacing: number, o: { alts?: P2[][]; rivals?: number; minSave?: number; strict?: boolean } = {}) => {
    const cps = waypoints(path, spacing);
    const rem = new Float32Array(path.length);
    for (let i = path.length - 2; i >= 0; i--) rem[i] = rem[i + 1] + Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
    races.push({ id, name, biome, desc, reward, path, cps, alts: [...(o.alts ?? []), ...(o.strict ? [] : shortcuts(path, cps, o.minSave ?? 150))].slice(0, 3), rivals: o.rivals ?? 4, strict: !!o.strict, rem, len: rem[0] });
  };
  const S = (r: string, from?: P2, to?: P2): Slice => ({ r, from, to });
  const REV = (r: string): Slice => { const p = roads.find((x) => x.id === r)!.pts; return { r, from: p[p.length - 1], to: p[0] }; };
  const HUB_N: P2 = [0, -250], SUMMIT: P2 = [-120, -1385];
  // ---------------- Desert Canyon ----------------
  add('canyon-breakout', 'Canyon Breakout', 0, 'Start on the canyon floor, splash through the river, claw up the cliff trail and blast down the dune track to the Baja road.', 2600,
    B([S('canyon-floor', [-150, cz(-150)]), S('cliff-trail'), S('dune-track')]), 600, { alts: [[[200, cz(200) + 6], [330, cz(330) + 20], [585, 1550]]] });
  add('rim-jumper', 'Rim Jumper', 0, 'Hug the north rim and launch the rock ramps across the canyon narrows. Come up short and you will be climbing out.', 3000,
    B(OFFROAD['rim-jumper']), 700, { alts: [[[-560, cz(-560) - 150], [-80, cz(-80) - 100], [150, cz(150) - 100]]], rivals: 3 });
  add('dune-basher', 'Dune Basher', 0, 'No roads, no rules: flat-out across the southern dune sea.', 2200,
    B(OFFROAD['dune-basher']), 800, { alts: [[[-1100, 1555], [1250, 1600]]] });
  add('baja-blast', 'Baja Blast', 0, 'The full Baja run along the far south: wide gravel, big crests and five tabletop jumps. Keep it pinned.', 3600,
    B([S('baja-run')]), 900);
  // ---------------- Dense Forest ----------------
  add('timberline-plow', 'Timberline Plow', 1, 'A narrow trail through the thickest woods out to the Ridgeback. Bring a dozer plow and carve your own line.', 2800,
    B([S('timber-trail')]), 600, { minSave: 80 });
  const creek = rivers.find((r) => r.id === 'creek');
  if (creek) {
    // weave down the valley floor, criss-crossing the shallow channel and ducking under the bridges
    const pts = creek.pts, a = nearestIdx(pts, [1150, -560]), b = nearestIdx(pts, [1420, 1040]);
    const decks: P2[] = []; for (const r of roads) r.pts.forEach((p, i) => { if (r.bridged[i]) decks.push(p); });
    const line: P2[] = [];
    for (let i = a; i <= b; i += 3) {
      const p = pts[i], q = pts[Math.min(pts.length - 1, i + 2)], r0 = pts[Math.max(0, i - 2)];
      let tx = q[0] - r0[0], tz = q[1] - r0[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      // under a bridge, run the channel itself (the piers stand on the banks)
      let near = 1e9; for (const d of decks) near = Math.min(near, Math.hypot(d[0] - p[0], d[1] - p[1]));
      const off = 13 * Math.sin((i - a) * 4 / 520 * Math.PI * 2) * Math.min(1, Math.max(0, (near - 12) / 30));
      line.push([p[0] - tz * off, p[1] + tx * off]);
    }
    add('muddy-creek', 'Muddy Creek Run', 1, 'Flat-out down the creek valley: weave across the shallows, splash the fords and thread under every bridge.', 2800,
      B([line]), 700, { alts: [B([S('forest-loop', [1260, 380], [1650, 800])])], minSave: 9999 });
  }
  add('logging-camp', 'Logging Camp Sprint', 1, 'From the hub to the logging camp on winding dirt. Short, fast, brutal.', 2000,
    B([S('hub-east', [40, 0], [720, -30]), S('forest-loop', [720, -30], [1520, 300])]), 700);
  add('ridgeback-rally', 'Ridgeback Rally', 1, 'A proper rally stage: from the frozen lake down the eastern ridge line, flowing gravel and four big crests.', 3600,
    B([S('ridgeback')]), 900);
  // ---------------- Snowy Mountain ----------------
  add('avalanche-switchbacks', 'Avalanche Switchbacks', 2, 'Nine icy hairpins up the face of Mount Apex. Spiked tyres recommended.', 3000,
    B([S('hub-north', HUB_N)]), 900, { minSave: 300 });
  add('peak-descent', 'Peak Descent', 2, 'Drop off the summit down the west face, then charge over the alpine pass to the Pass Hut.', 3000,
    B([S('peak-descent'), S('alpine-pass')]), 800, { alts: [[[-120, -1385], [-500, -1050], [-694, -950]]] });
  add('glacier-ridge', 'Glacier Ridge', 2, 'Ride the high glacier ridge east from the summit, then plunge into the forest.', 2900,
    B([S('glacier-ridge')]), 700);
  const lake = LAKES.find((l) => l.id === 'frozen');
  if (lake) {
    // slalom around the ice sheet: one and a half laps of a wavy ring
    const line: P2[] = [];
    for (let t = 0; t <= 1.5; t += 0.004) { const a = -Math.PI / 2 + t * Math.PI * 2, r = lake.r - 55 + 22 * Math.sin(t * Math.PI * 2 * 5); line.push([lake.x + Math.cos(a) * r, lake.z - Math.sin(a) * r]); }
    add('frozen-lake', 'Frozen Lake Drift', 2, 'Ice racing on the frozen lake: a slalom ring, one and a half laps, every gate counts. Spikes or sideways.', 2700,
      B([line]), 260, { strict: true, rivals: 3 });
  }
  // ---------------- Industrial Quarry ----------------
  add('pit-escape', 'Pit Escape', 3, 'Start at the bottom of Pit A and spiral up the haul ramp to daylight and the hub.', 2400,
    B([REV('pitA-spiral'), S('hub-west', [-938, -40], [-300, 20])]), 700, { minSave: 120 });
  add('crusher-circuit', 'Crusher Circuit', 3, 'Out of Pit B past the crusher plant and the site trailers (crushable!), up the haul road to the quarry works.', 2300,
    B([S('pitB-road', [-1060 + 200, 520], [-560, -20]), S('hub-west', [-560, -20], [-820, -60]), S('quarry-north', [-820, -60], [-780, -700])]), 600);
  add('haul-road-havoc', 'Haul Road Havoc', 3, 'Out of Pit B and down the haul road into the canyon mouth.', 2500,
    B([REV('pitB-spiral'), S('haul-south'), S('canyon-entry')]), 700);
  add('quarry-mx', 'Quarry MX', 3, 'The west pit motocross track: four straights, three bermed hairpins and eight tabletops. Every gate counts.', 2600,
    B([S('mx-track')]), 230, { strict: true });
  // ---------------- Cross-biome marathons ----------------
  add('summit-to-sands', 'Summit to Sands', 'marathon', 'Snow to sand: down the switchbacks, through the hub, over the steel bridge and out to the Baja road.', 7000,
    B([S('hub-north', SUMMIT, [0, -40]), S('hub-south'), [[150, cz(150) - 100], [150, cz(150) + 100]], S('south-desert')]), 1200, { rivals: 5, minSave: 300 });
  add('quarry-to-glacier', 'Quarry to Forest', 'marathon', 'Pit A rim to the northern forest via the hub and the deep woods.', 6500,
    B([S('hub-west', [-938, -40], [-40, 0]), [[0, 0]], S('hub-east', [40, 0], [900, 40]), S('forest-north')]), 1200, { rivals: 5, minSave: 250 });
  add('timber-to-canyon', 'Timber to Canyon', 'marathon', 'Logging camp to the Baja road: forest, hub, desert and one very old stone arch.', 6800,
    B([S('forest-loop', [1520, 300]), S('hub-south', [0, 40], [60, 820]), S('desert-east'), [[1000, cz(1000) - 100], [1000, cz(1000) + 100]], S('desert-east-s')]), 1200, { rivals: 5, minSave: 250 });
  add('rim-of-the-world', 'Rim of the World', 'marathon', 'The grand tour of the outer ring: the whole Baja run east, then up the Ridgeback to the frozen lake.', 9000,
    B([S('baja-run'), S('ridgeback', [1940, 1480], [1290, -1730])]), 1400, { rivals: 5, minSave: 400 });
  return races;
}
export const BIOME_LABEL = ['Desert Canyon', 'Dense Forest', 'Snowy Mountain', 'Industrial Quarry'];
