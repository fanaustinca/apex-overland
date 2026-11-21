// Road network: authored control points, splined, graded (max slope) and carved into the heightmap.
import { canyonZ, BRIDGES_X, NARROWS, PITS, HALF, CELL, N, V, CTRL, CANYON_X0, CANYON_X1, GARAGES, type P2 } from './layout';
import { spline, sampleH, carveAlong, distToPolylineFast, type WorldData, APEX } from './gen';
import { clamp, smoothstep } from '../core/noise';

export type RoadKind = 'asphalt' | 'dirt' | 'gravel' | 'snow' | 'trail' | 'haul';
/** bumps: [fraction along road, height, kicker length, table length, landing length] (metres) */
export interface RoadDef { id: string; kind: RoadKind; width: number; ctrl: P2[]; grade: number; bank?: number; earth?: boolean; bumps?: [number, number, number, number, number][] }
export interface Road extends RoadDef { pts: P2[]; h: Float32Array; len: number; bridged: Uint8Array }

/** Bridge spans: deck from rim to rim (the canyon below is not carved). */
export interface Bridge { id: string; style: 'truss' | 'trestle' | 'arch' | 'beam' | 'timber'; a: P2; b: P2; width: number; ha: number; hb: number; floor?: number; pts?: P2[] }

const cz = canyonZ;
const RIM = 100;     // bridge ends sit this far from the canyon centreline
export const BRIDGE_DEFS: { id: string; style: Bridge['style']; x: number; width: number }[] = [
  { id: 'trestle', style: 'trestle', x: BRIDGES_X[0], width: 7 },
  { id: 'truss', style: 'truss', x: BRIDGES_X[1], width: 11 },
  { id: 'arch', style: 'arch', x: BRIDGES_X[2], width: 9 },
];
const bN = (x: number): P2 => [x, cz(x) - RIM];
const bS = (x: number): P2 => [x, cz(x) + RIM];

/** Switchback legs along x joined by wide semicircular hairpins. Legs step by dz in z. */
function hairpins(x0: number, xa: number, xb: number, z0: number, dz: number, legs: number): P2[] {
  const pts: P2[] = [];
  let x = x0, dir = Math.abs(x0 - xa) < Math.abs(x0 - xb) ? 1 : -1;   // head for the farther end first
  for (let k = 0; k < legs; k++) {
    const z = z0 + k * dz, xe = dir > 0 ? xb : xa;
    for (let t = 0; t <= 1.0001; t += 0.25) pts.push([x + (xe - x) * t, z]);
    if (k < legs - 1) {
      const r = Math.abs(dz) / 2, cz2 = z + dz / 2;
      for (let a = 1; a < 12; a++) { const th = -Math.PI / 2 + a / 12 * Math.PI; pts.push([xe + dir * Math.cos(th) * r * 0.9, cz2 + Math.sign(dz) * Math.sin(th) * r]); }
    }
    x = xe; dir = -dir;
  }
  return pts;
}
function switchbacks(): P2[] {
  return [[-20, -250], [-60, -430], ...hairpins(-60, -330, 70, -500, -100, 9), [APEX.x + 30, APEX.z + 175]];
}
function spiral(p: { x: number; z: number; r: number; tiers: number; tierW: number }, a0: number, turns: number): P2[] {
  const out: P2[] = [];
  const steps = Math.ceil(turns * 24);
  for (let k = 0; k <= steps; k++) {
    const t = k / steps, a = a0 + t * turns * Math.PI * 2;
    const r = p.r - 8 - t * (p.r - (p.r - p.tiers * p.tierW) * 0.6 - 8);
    out.push([p.x + Math.cos(a) * r, p.z + Math.sin(a) * r]);
  }
  return out;
}

/** Secret barn-find cabins (remote; reached by faint rut trails branching off main roads). */
export const CABINS = [
  { id: 'quarry', name: 'Quarry Shack', biome: 3, x: -1960, z: -760, yaw: 0.5, prize: 'Snake Module 1 — Front Cab & Engine', from: [-1640, -400] as P2, via: [[-1760, -520], [-1880, -640]] as P2[] },
  { id: 'forest', name: 'Forest Cabin', biome: 1, x: 1660, z: -720, yaw: -0.4, prize: 'Snake Module 2 — Middle Articulated 4x4', from: [955, -620] as P2, via: [[1120, -700], [1330, -760], [1520, -735]] as P2[] },
  { id: 'desert', name: 'Desert Adobe', biome: 0, x: -1560, z: 1560, yaw: 2.2, prize: 'Snake Module 3 — Rear Articulated 4x4', from: [-1010, 1625] as P2, via: [[-1180, 1540], [-1330, 1470], [-1470, 1500]] as P2[] },
  { id: 'snow', name: 'Snowy Mountain Outpost', biome: 2, x: -1470, z: -1885, yaw: 2.6, prize: 'The Master Assembly Blueprint', from: [-1600, -1300] as P2, via: [[-1630, -1500], [-1600, -1700]] as P2[] },
];

const MX = hairpins(-1650, -2000, -1650, 500, 135, 4);
export const ROAD_DEFS: RoadDef[] = [
  // hub spokes
  { id: 'hub-south', kind: 'asphalt', width: 11, grade: 0.09, ctrl: [[0, 40], [30, 300], [-30, 560], [60, 820], [150, 1000], bN(BRIDGES_X[1])] },
  { id: 'hub-east', kind: 'dirt', width: 9, grade: 0.12, ctrl: [[40, 0], [300, -40], [520, 60], [720, -30], [900, 40], [1080, -70], [1230, -150], [1420, -210], [1650, -120], [1840, -60], [2000, -60]] },
  { id: 'hub-west', kind: 'haul', width: 15, grade: 0.08, ctrl: [[-40, 0], [-300, 20], [-560, -20], [-820, -60], [-900, -60], spiral(PITS[0], 0.25, 1.15)[0]] },
  { id: 'hub-north', kind: 'snow', width: 8, grade: 0.12, ctrl: [[0, -40], ...switchbacks()] },
  // desert outer: the Baja run along the far south, everything in the desert drains into it
  { id: 'baja-run', kind: 'gravel', width: 11, grade: 0.11, ctrl: [[-1960, 1640], [-1760, 1840], [-1420, 1880], [-1080, 2000], [-720, 1910], [-360, 2010], [0, 1960], [360, 2030], [800, 1940], [1120, 2010], [1440, 1910], [1760, 1720], [1940, 1480]],
    bumps: [[0.13, 2.2, 14, 12, 22], [0.3, 2.6, 16, 14, 24], [0.47, 2.2, 14, 10, 22], [0.62, 2.8, 16, 14, 26], [0.8, 2.4, 14, 12, 24]] },
  { id: 'south-desert', kind: 'asphalt', width: 11, grade: 0.09, ctrl: [bS(BRIDGES_X[1]), [190, 1420], [140, 1640], [60, 1820], [10, 1955]] },
  // forest
  { id: 'forest-loop', kind: 'dirt', width: 8, grade: 0.13, ctrl: [[720, -30], [800, 250], [1000, 420], [1260, 380], [1520, 300], [1700, 500], [1650, 800], [1400, 900], [1100, 800], [800, 620], [500, 400], [260, 160], [60, 30]] },
  { id: 'forest-north', kind: 'dirt', width: 8, grade: 0.14, ctrl: [[900, 40], [860, -300], [960, -600], [870, -915]] },
  // the Ridgeback: a fast gravel rally road along the eastern ridge line, lake pass to the Baja run
  { id: 'ridgeback', kind: 'gravel', width: 10, grade: 0.12, ctrl: [[1290, -1730], [1440, -1620], [1600, -1470], [1760, -1330], [1960, -1120], [2030, -850], [1940, -560], [2030, -260], [2000, -60], [1930, 240], [2040, 540], [1960, 850], [2030, 1150], [1940, 1480]],
    bumps: [[0.42, 2.0, 14, 10, 22], [0.58, 2.4, 14, 12, 22], [0.74, 2.2, 14, 10, 22], [0.88, 2.6, 16, 12, 24]] },
  { id: 'timber-trail', kind: 'trail', width: 6, grade: 0.16, ctrl: [[1080, -70], [1330, 80], [1420, 330], [1600, 560], [1800, 650], [1900, 760], [1960, 850]] },
  // desert
  { id: 'desert-west', kind: 'dirt', width: 8, grade: 0.12, ctrl: [[-30, 560], [-350, 780], [-640, 900], bN(BRIDGES_X[0])] },
  { id: 'desert-west-s', kind: 'dirt', width: 8, grade: 0.12, ctrl: [bS(BRIDGES_X[0]), [-820, 1450], [-1000, 1620], [-1200, 1760], [-1420, 1880]] },
  { id: 'desert-east', kind: 'dirt', width: 9, grade: 0.12, ctrl: [[60, 820], [480, 870], [760, 880], [920, 860], [995, 895], bN(BRIDGES_X[2])] },
  { id: 'desert-east-s', kind: 'dirt', width: 9, grade: 0.12, ctrl: [bS(BRIDGES_X[2]), [1080, 1380], [1250, 1600], [1300, 1800], [1440, 1910]] },
  { id: 'canyon-floor', kind: 'trail', width: 7, grade: 0.2, bank: 4, earth: false, ctrl: [...Array.from({ length: 33 }, (_, i) => -1150 + i * 40).map((x) => [x, cz(x) + 7 * Math.sin(x / 75)] as P2), [200, cz(200) + 6]] },
  { id: 'cliff-trail', kind: 'trail', width: 7, grade: 0.15, bank: 5, earth: false, ctrl: [[200, cz(200) + 6], [250, cz(250) + 24], [330, cz(330) + 42], [430, cz(430) + 60], [520, cz(520) + 86], [600, cz(600) + 130]] },
  { id: 'dune-track', kind: 'trail', width: 8, grade: 0.16, ctrl: [[600, cz(600) + 130], [590, 1450], [585, 1550], [640, 1640], [760, 1760], [800, 1940]] },
  // quarry + west
  { id: 'pitA-spiral', kind: 'haul', width: 14, grade: 0.1, ctrl: spiral(PITS[0], 0.25, 1.15) },
  { id: 'pitB-road', kind: 'haul', width: 13, grade: 0.09, ctrl: [[-760, -52], [-725, 90], [-760, 280], [-820, 430], [PITS[1].x + PITS[1].r - 5, PITS[1].z - 40]] },
  { id: 'pitB-spiral', kind: 'haul', width: 12, grade: 0.1, ctrl: spiral(PITS[1], -0.19, 0.95) },
  { id: 'haul-south', kind: 'haul', width: 14, grade: 0.09, ctrl: [[-852, 540], [-875, 700], [-1000, 795], [-1180, 795], [-1330, 880]] },
  { id: 'canyon-entry', kind: 'trail', width: 8, grade: 0.15, bank: 6, ctrl: [[-1330, 880], [-1300, 1040], [-1150, cz(-1150)]] },
  { id: 'quarry-north', kind: 'gravel', width: 10, grade: 0.17, ctrl: [[-820, -60], [-860, -400], [-780, -700], [-720, -900], [-694, -950]] },
  { id: 'west-haul', kind: 'haul', width: 13, grade: 0.1, ctrl: [[-860, -410], [-1080, -490], [-1350, -520], [-1640, -400], [-1800, -170], [-1830, 120], [-1700, 380], [-1650, 500]] },
  { id: 'mx-track', kind: 'dirt', width: 10, grade: 0.2, ctrl: MX,
    bumps: [[0.06, 2.4, 12, 8, 16], [0.16, 2.8, 12, 10, 16], [0.33, 2.4, 12, 8, 16], [0.43, 3.0, 13, 10, 18], [0.6, 2.4, 12, 8, 16], [0.7, 2.8, 12, 10, 16], [0.87, 2.6, 12, 8, 16], [0.95, 3.0, 13, 10, 18]] },
  { id: 'mx-link', kind: 'dirt', width: 9, grade: 0.12, ctrl: [MX[MX.length - 1], [-1580, 960], [-1460, 900], [-1330, 880]] },
  // mountain
  { id: 'peak-descent', kind: 'snow', width: 7, grade: 0.18, ctrl: [[APEX.x + 30, APEX.z + 175], [-250, -1440], [-430, -1405], ...hairpins(-440, -690, -440, -1330, 95, 5)] },
  { id: 'glacier-ridge', kind: 'snow', width: 8, grade: 0.2, ctrl: [[APEX.x + 30, APEX.z + 175], [150, -1420], [450, -1440], [750, -1390], [1000, -1330], [1160, -1230], [1150, -1080], [1020, -1000], [870, -915]] },
  { id: 'alpine-pass', kind: 'snow', width: 9, grade: 0.13, ctrl: [[-694, -950], [-880, -1060], [-1100, -1120], [-1350, -1210], [-1600, -1300]] },
  ...CABINS.map((c) => ({ id: 'ruts-' + c.id, kind: 'trail' as RoadKind, width: 3.4, grade: 0.22, bank: 4, ctrl: [c.from, ...c.via, [c.x + Math.sin(c.yaw) * 13, c.z + Math.cos(c.yaw) * 13] as P2] })),
];

export const RAMPS: { x: number; z: number; dir: number; h: number; len: number; w: number }[] = [
  // rock ramps on the north rim facing south across the canyon narrows
  ...NARROWS.map((x) => ({ x, z: cz(x) - 34, dir: Math.PI / 2, h: 6, len: 30, w: 12 })),
];

export interface Pad { x: number; z: number; r: number; h: number }

/** Cells where earthworks may not fill: the canyon interior (bridges span it) and the wet river channels. */
function noFillMask(data: WorldData): Uint8Array {
  const m = new Uint8Array(V * V);
  for (let j = 0; j < V; j++) {
    const z = -HALF + j * CELL;
    for (let i = 0; i < V; i++) {
      const x = -HALF + i * CELL;
      if (x > CANYON_X0 && x < CANYON_X1 && Math.abs(z - cz(x)) < 82) m[j * V + i] = 1;
    }
  }
  for (const r of data.rivers) {
    const half = r.width / 2 + 14;
    for (const [x, z] of r.pts) {
      const ci = Math.round((x + HALF) / CELL), cj = Math.round((z + HALF) / CELL), R = Math.ceil(half / CELL);
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) { const ii = ci + di, jj = cj + dj; if (ii >= 0 && jj >= 0 && ii < V && jj < V && di * di + dj * dj <= R * R) m[jj * V + ii] = 1; }
    }
  }
  return m;
}

/**
 * Road earthworks: every road (and building pad) sits on a proper formation. Embankments fall away at 1:2.5 and cuttings
 * rise at 2:1, computed as a slope-limited distance transform from the road surface, so no road is ever a knife-edge
 * wall with sheer drops on either side, wherever it runs.
 */
function earthworks(H: Float32Array, core: Float32Array, noFill: Uint8Array) {
  const n = V * V, lo = new Float32Array(n), hi = new Float32Array(n);
  for (let k = 0; k < n; k++) { const c = core[k]; if (c === c) { lo[k] = c; hi[k] = c; } else { lo[k] = -1e9; hi[k] = 1e9; } }
  const SF = 0.4, SC = 2.0;
  const fa = SF * CELL, fb = SF * CELL * Math.SQRT2, ca = SC * CELL, cb = SC * CELL * Math.SQRT2;
  // two-pass chamfer propagation (unrolled: this runs over 6.5 M cells)
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < V; j++) {
      const row = j * V, up = row - V;
      for (let i = 0; i < V; i++) {
        const k = row + i; let l = lo[k], h = hi[k], q: number;
        if (i > 0) { q = k - 1; if (lo[q] - fa > l) l = lo[q] - fa; if (hi[q] + ca < h) h = hi[q] + ca; }
        if (j > 0) {
          q = up + i; if (lo[q] - fa > l) l = lo[q] - fa; if (hi[q] + ca < h) h = hi[q] + ca;
          if (i > 0) { q = up + i - 1; if (lo[q] - fb > l) l = lo[q] - fb; if (hi[q] + cb < h) h = hi[q] + cb; }
          if (i < V - 1) { q = up + i + 1; if (lo[q] - fb > l) l = lo[q] - fb; if (hi[q] + cb < h) h = hi[q] + cb; }
        }
        lo[k] = l; hi[k] = h;
      }
    }
    for (let j = V - 1; j >= 0; j--) {
      const row = j * V, dn = row + V;
      for (let i = V - 1; i >= 0; i--) {
        const k = row + i; let l = lo[k], h = hi[k], q: number;
        if (i < V - 1) { q = k + 1; if (lo[q] - fa > l) l = lo[q] - fa; if (hi[q] + ca < h) h = hi[q] + ca; }
        if (j < V - 1) {
          q = dn + i; if (lo[q] - fa > l) l = lo[q] - fa; if (hi[q] + ca < h) h = hi[q] + ca;
          if (i < V - 1) { q = dn + i + 1; if (lo[q] - fb > l) l = lo[q] - fb; if (hi[q] + cb < h) h = hi[q] + cb; }
          if (i > 0) { q = dn + i - 1; if (lo[q] - fb > l) l = lo[q] - fb; if (hi[q] + cb < h) h = hi[q] + cb; }
        }
        lo[k] = l; hi[k] = h;
      }
    }
  }
  const touched = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const c = core[k];
    if (c === c) { H[k] = c; continue; }
    let h = H[k];
    const l = noFill[k] ? -1e9 : lo[k], u = hi[k];
    if (l > u) h = (l + u) / 2; else if (h < l) h = l; else if (h > u) h = u; else continue;
    H[k] = h; touched[k] = 1;
  }
  // soften the toe/crest creases of the new slopes
  const tmp = new Float32Array(n);
  for (let it = 0; it < 2; it++) {
    tmp.set(H);
    for (let j = 1; j < V - 1; j++) for (let i = 1; i < V - 1; i++) {
      const k = j * V + i;
      if (!touched[k] && !touched[k - 1] && !touched[k + 1] && !touched[k - V] && !touched[k + V]) continue;
      if (core[k] === core[k]) continue;
      H[k] = (tmp[k] * 4 + tmp[k - 1] + tmp[k + 1] + tmp[k - V] + tmp[k + V]) / 8;
    }
  }
}

export function buildRoads(data: WorldData, pads: Pad[] = []): { roads: Road[]; bridges: Bridge[]; roadMask: Uint8Array; roadKind: Uint8Array } {
  const roads: Road[] = [];
  const roadMask = new Uint8Array(N * N);
  const roadKind = new Uint8Array(CTRL * CTRL);
  const KIND: RoadKind[] = ['asphalt', 'dirt', 'gravel', 'snow', 'trail', 'haul'];
  const core = new Float32Array(V * V).fill(NaN);
  const noFill = noFillMask(data);
  // building pads are part of the formation
  for (const p of pads) {
    const R = p.r;
    for (let j = Math.floor((p.z - R + HALF) / CELL); j <= Math.ceil((p.z + R + HALF) / CELL); j++) for (let i = Math.floor((p.x - R + HALF) / CELL); i <= Math.ceil((p.x + R + HALF) / CELL); i++) {
      if (i < 0 || j < 0 || i >= V || j >= V) continue;
      if (Math.hypot(-HALF + i * CELL - p.x, -HALF + j * CELL - p.z) <= R) core[j * V + i] = p.h;
    }
  }
  // bridge deck heights come from the rims before any carving
  const bridges: Bridge[] = BRIDGE_DEFS.map((b) => {
    const a = bN(b.x), c = bS(b.x);
    return { id: b.id, style: b.style, a, b: c, width: b.width, ha: sampleH(data.height, a[0], a[1]) + 0.5, hb: sampleH(data.height, c[0], c[1]) + 0.5 };
  });
  // spatial hash of finished road samples (8 m buckets) for junction / crossing pins
  const hash = new Map<number, [number, number, number, number][]>();
  const key = (x: number, z: number) => (Math.floor((x + HALF) / 8) * 4096 + Math.floor((z + HALF) / 8));
  const nearRoad = (x: number, z: number, r: number): number | null => {
    let best = r, bh: number | null = null;
    const ci = Math.floor((x + HALF) / 8), cj = Math.floor((z + HALF) / 8), R = Math.ceil(r / 8);
    for (let di = -R; di <= R; di++) for (let dj = -R; dj <= R; dj++) for (const [px, pz, ph] of hash.get((ci + di) * 4096 + cj + dj) ?? []) { const d = Math.hypot(px - x, pz - z); if (d < best) { best = d; bh = ph; } }
    return bh;
  };
  const addRoad = (def: RoadDef) => {
    const pts = spline(def.ctrl, 3);
    const n = pts.length;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = sampleH(data.height, pts[i][0], pts[i][1]);
    const pin: (number | null)[] = new Array(n).fill(null);
    const bridged = new Uint8Array(n);
    // junctions: ends within 10 m of a built road, and any sample that crosses one, meet it at its height
    for (const idx of [0, n - 1]) { const h = nearRoad(pts[idx][0], pts[idx][1], 10); if (h !== null) pin[idx] = h; }
    for (let i = 1; i < n - 1; i++) { const h = nearRoad(pts[i][0], pts[i][1], 4.5); if (h !== null) pin[i] = h; }
    for (const p of pads) for (let i = 0; i < n; i++) if (Math.hypot(pts[i][0] - p.x, pts[i][1] - p.z) < p.r - 2) pin[i] = p.h;
    for (const b of bridges) for (const [e, h] of [[b.a, b.ha], [b.b, b.hb]] as [P2, number][]) {
      if (Math.hypot(pts[0][0] - e[0], pts[0][1] - e[1]) < 4) pin[0] = h;
      if (Math.hypot(pts[n - 1][0] - e[0], pts[n - 1][1] - e[1]) < 4) pin[n - 1] = h;
    }
    // river crossings become bridges: the deck sits well above the water and the approaches ramp up to it
    for (const r of data.rivers) {
      const span = r.width / 2 + 14;
      for (let i = 0; i < n; i++) {
        const q = distToPolylineFast(pts[i][0], pts[i][1], r.pts);
        if (q.d < span) { bridged[i] = 1; pin[i] = r.lvl[q.i] + 5.6; }
      }
    }
    // a bridge is level: use one deck height per contiguous span
    for (let i = 0; i < n; i++) if (bridged[i] && (i === 0 || !bridged[i - 1])) {
      let e = i; while (e + 1 < n && bridged[e + 1]) e++;
      let m = -1e9; for (let k = i; k <= e; k++) m = Math.max(m, pin[k]!);
      for (let k = Math.max(0, i - 1); k <= Math.min(n - 1, e + 1); k++) { pin[k] = m; }
      i = e;
    }
    // smooth (gaussian ~ 24 m) then grade-limit forwards and backwards
    let h = new Float32Array(n);
    const R = 8;
    for (let i = 0; i < n; i++) { let s = 0, ws = 0; for (let k = -R; k <= R; k++) { const w = Math.exp(-(k * k) / (R * R / 2)); s += raw[clamp(i + k, 0, n - 1)] * w; ws += w; } h[i] = s / ws; }
    for (let i = 0; i < n; i++) if (pin[i] !== null) h[i] = pin[i]!;
    const g = def.grade * 3;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < n; i++) if (pin[i] === null) h[i] = clamp(h[i], h[i - 1] - g, h[i - 1] + g);
      for (let i = n - 2; i >= 0; i--) if (pin[i] === null) h[i] = clamp(h[i], h[i + 1] - g, h[i + 1] + g);
      for (let i = 0; i < n; i++) if (pin[i] !== null) h[i] = pin[i]!;
    }
    // light smoothing so the profile has no kinks
    for (let pass = 0; pass < 2; pass++) {
      const h2 = new Float32Array(n);
      for (let i = 0; i < n; i++) h2[i] = pin[i] ?? (h[clamp(i - 1, 0, n - 1)] + 2 * h[i] + h[clamp(i + 1, 0, n - 1)]) / 4;
      h = h2;
    }
    // jumps: kicker, table, landing on top of the graded profile
    let len = 0; const cum = new Float32Array(n);
    for (let i = 1; i < n; i++) { len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cum[i] = len; }
    for (const [t, bh, up, top, down] of def.bumps ?? []) {
      const c0 = t * len;
      for (let i = 0; i < n; i++) {
        if (pin[i] !== null) continue;
        const s = cum[i] - c0;
        let f = 0;
        if (s > -up && s < 0) f = Math.pow((s + up) / up, 1.4);
        else if (s >= 0 && s <= top) f = 1;
        else if (s > top && s < top + down) { const u = (s - top) / down; f = 1 - u * u * (3 - 2 * u); }
        h[i] += bh * f;
      }
    }
    const half = def.width / 2;
    const earth = def.earth !== false;
    carveAlong(data, pts, (i, u) => h[i] + (h[Math.min(i + 1, n - 1)] - h[i]) * u, half + 1.2, def.bank ?? 9,
      (d, _t, c) => (d < half + 1.2 ? c + 0.12 * (1 - (d / (half + 1.2)) ** 2) : null), false, false, false, bridged, earth ? { h: core, r: half + 2.5 } : undefined);
    roads.push({ ...def, pts, h, len, bridged });
    for (let i = 0; i < n; i++) if (!bridged[i]) { const k = key(pts[i][0], pts[i][1]); let a = hash.get(k); if (!a) hash.set(k, a = []); a.push([pts[i][0], pts[i][1], h[i], roads.length - 1]); }
    // river bridges
    for (let i = 0; i < n; i++) if (bridged[i] && (i === 0 || !bridged[i - 1])) {
      let e = i; while (e + 1 < n && bridged[e + 1]) e++;
      const a0 = Math.max(0, i - 1), b0 = Math.min(n - 1, e + 1);
      const L = cum[b0] - cum[a0];
      const style: Bridge['style'] = def.width < 5 ? 'timber' : def.kind === 'asphalt' || def.kind === 'haul' ? 'beam' : L > 40 ? 'beam' : 'timber';
      let floor = 1e9; for (const r of data.rivers) for (let k = a0; k <= b0; k++) { const q = distToPolylineFast(pts[k][0], pts[k][1], r.pts); if (q.d < r.width / 2 + 12) floor = Math.min(floor, r.lvl[q.i] - 1.5); }
      bridges.push({ id: `${def.id}-x${bridges.length}`, style, a: pts[a0], b: pts[b0], width: def.width + 1.2, ha: h[a0], hb: h[b0], floor, pts: pts.slice(a0, b0 + 1) });
      i = e;
    }
    // texture mask (2 m) + kind (4 m); bridge decks carry no ground texture
    const kind = KIND.indexOf(def.kind) + 1;
    for (let s = 0; s < n - 1; s++) {
      if (bridged[s] && bridged[s + 1]) continue;
      const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      const reach = half + 3;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach + HALF) / CELL)), i1 = Math.min(N - 1, Math.ceil((Math.max(ax, bx) + reach + HALF) / CELL));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach + HALF) / CELL)), j1 = Math.min(N - 1, Math.ceil((Math.max(az, bz) + reach + HALF) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = -HALF + (i + 0.5) * CELL, z = -HALF + (j + 0.5) * CELL;
        let u = ((x - ax) * dx + (z - az) * dz) / L2; u = clamp(u, 0, 1);
        const d = Math.hypot(ax + dx * u - x, az + dz * u - z);
        const v = Math.round(255 * (1 - smoothstep(half - 1.2, half + 1.6, d)));
        if (v > roadMask[j * N + i]) { roadMask[j * N + i] = v; if (v > 100) roadKind[(j >> 1) * CTRL + (i >> 1)] = kind; }
      }
    }
  };
  for (const def of ROAD_DEFS) addRoad(def);
  // garages: a level pad at the height of the road they serve, plus a graded driveway from the apron to that road
  for (const g of GARAGES) {
    const D = g.main ? 20 : 12, fx = Math.sin(g.yaw), fz = Math.cos(g.yaw);
    const A: P2 = [g.x + fx * (D / 2 + 14), g.z + fz * (D / 2 + 14)];
    let best = 1e9, P: P2 = A, ph = 0;
    for (const r of roads) { if (r.id.startsWith('ruts-') || r.id.startsWith('drive-')) continue; for (let i = 0; i < r.pts.length; i++) { if (r.bridged[i]) continue; const d = Math.hypot(r.pts[i][0] - A[0], r.pts[i][1] - A[1]); if (d < best) { best = d; P = r.pts[i]; ph = r.h[i]; } } }
    const pad: Pad = { x: g.x + fx * (g.main ? 10 : 7), z: g.z + fz * (g.main ? 10 : 7), r: g.main ? 42 : 26, h: ph + 0.15 };
    pads.push(pad);
    for (let j = Math.floor((pad.z - pad.r + HALF) / CELL); j <= Math.ceil((pad.z + pad.r + HALF) / CELL); j++) for (let i = Math.floor((pad.x - pad.r + HALF) / CELL); i <= Math.ceil((pad.x + pad.r + HALF) / CELL); i++) {
      if (i < 0 || j < 0 || i >= V || j >= V) continue;
      if (Math.hypot(-HALF + i * CELL - pad.x, -HALF + j * CELL - pad.z) <= pad.r) core[j * V + i] = pad.h;
    }
    if (best < 12) continue;
    const ext = Math.min(18, best * 0.4);
    const B: P2 = [A[0] + fx * ext, A[1] + fz * ext];
    addRoad({ id: 'drive-' + g.id, kind: g.main ? 'asphalt' : 'dirt', width: g.main ? 10 : 8, grade: 0.16, ctrl: [A, B, P] });
  }
  earthworks(data.height, core, noFill);
  // blend junctions: where independently graded roads meet, relax the heights over the road + shoulder cells
  {
    const H = data.height, mask = new Uint8Array(V * V);
    for (let j = 1; j < N; j++) for (let i = 1; i < N; i++) {
      let m = 0;
      for (let dj = -4; dj <= 4 && !m; dj += 2) for (let di = -4; di <= 4; di += 2) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < N && jj < N && roadMask[jj * N + ii] > 30) { m = 1; break; } }
      mask[j * V + i] = m;
    }
    const tmp = new Float32Array(H.length);
    for (let it = 0; it < 4; it++) {
      tmp.set(H);
      for (let j = 1; j < N; j++) for (let i = 1; i < N; i++) {
        const k = j * V + i; if (!mask[k]) continue;
        H[k] = (tmp[k] * 4 + tmp[k - 1] + tmp[k + 1] + tmp[k - V] + tmp[k + V]) / 8;
      }
    }
  }
  // rock ramps
  for (const r of RAMPS) {
    const ca = Math.cos(r.dir), sa = Math.sin(r.dir);
    const reach = r.len + r.w;
    const i0 = Math.floor((r.x - reach + HALF) / CELL), i1 = Math.ceil((r.x + reach + HALF) / CELL);
    const j0 = Math.floor((r.z - reach + HALF) / CELL), j1 = Math.ceil((r.z + reach + HALF) / CELL);
    const base = sampleH(data.height, r.x - ca * r.len, r.z - sa * r.len);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL;
      const lx = (x - r.x) * ca + (z - r.z) * sa, lz = -(x - r.x) * sa + (z - r.z) * ca;   // lx: along ramp (0 = lip)
      if (lx > 0.5 || lx < -r.len - 10) continue;
      const side = 1 - smoothstep(r.w / 2 - 1, r.w / 2 + 6, Math.abs(lz));
      if (side <= 0) continue;
      const t = clamp((lx + r.len) / r.len, 0, 1);
      const prof = base + r.h * Math.pow(t, 1.6);
      const idx = j * V + i;
      data.height[idx] = Math.max(data.height[idx], prof * side + data.height[idx] * (1 - side));
    }
  }
  return { roads, bridges, roadMask, roadKind };
}
