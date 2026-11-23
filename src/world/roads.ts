// Road network: authored control points, splined, graded (max slope) and carved into the heightmap.
import { canyonZ, BRIDGES_X, NARROWS, PITS, HALF, CELL, N, V, CTRL, CANYON_X0, CANYON_X1, GARAGES, LAKES, LANDMARKS, PEAK, STATION, SLOT_X, slotPts, type P2 } from './layout';
import { spline, resample, sampleH, carveAlong, distToPolylineFast, type WorldData, APEX, SINK, peakFoot } from './gen';
import { clamp, smoothstep, Simplex } from '../core/noise';

export type RoadKind = 'asphalt' | 'dirt' | 'gravel' | 'snow' | 'trail' | 'haul';
/** bumps: [fraction along road, height, kicker length, table length, landing length] (metres) */
/** ctrl: waypoints. Unless `fixed`, the road between waypoints is routed across the terrain by a grade-aware pathfinder. */
export interface RoadDef { id: string; kind: RoadKind; width: number; ctrl: P2[]; grade: number; bank?: number; earth?: boolean; fixed?: boolean; bumps?: [number, number, number, number, number][]; corridor?: number; pinEnd?: boolean; even?: boolean;
  /** surveyed mountain road: trace a constant-grade line over the natural ground from ctrl[0] up to `to` */
  trace?: { grade: number; stop: number; rev?: boolean; level?: boolean };
  /** a shelf road cut into a canyon wall: climbs steadily from the floor at xa to the rim at xb on the given side */
  ledge?: { xa: number; xb: number; side: 1 | -1; into: number; toD?: number } }
export interface Road extends RoadDef { pts: P2[]; h: Float32Array; len: number; bridged: Uint8Array; raw?: Float32Array }

/** Bridge spans: deck from rim to rim (the canyon below is not carved). */
export interface Bridge { id: string; style: 'truss' | 'trestle' | 'arch' | 'beam' | 'timber'; a: P2; b: P2; width: number; ha: number; hb: number; floor?: number; pts?: P2[] }

const cz = canyonZ;
const RIM = 150;     // bridge ends sit this far from the canyon centreline (out on the plateau, past the strata walls)
export const BRIDGE_DEFS: { id: string; style: Bridge['style']; x: number; width: number }[] = [
  { id: 'trestle', style: 'trestle', x: BRIDGES_X[0], width: 7 },
  { id: 'truss', style: 'truss', x: BRIDGES_X[1], width: 11 },
  { id: 'arch', style: 'arch', x: BRIDGES_X[2], width: 9 },
];
const bN = (x: number): P2 => [x, cz(x) - RIM];
const bS = (x: number): P2 => [x, cz(x) + RIM];
/** approach points lined up with a canyon bridge, so roads arrive straight onto the deck */
const aN = (x: number): P2 => [x, cz(x) - RIM - 75], aS = (x: number): P2 => [x, cz(x) + RIM + 75];

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

/** Summit Station junction: on the south shoulder of Mount Apex, where the three mountain roads meet. */
export const SUMMIT: P2 = [STATION.x, STATION.z];
const MX = hairpins(-1650, -2000, -1650, 500, 135, 4);
/** The spot `out` metres beyond a landmark's edge along its way-in bearing. */
function lmGate(id: string, out: number): P2 { const l = LANDMARKS.find((q) => q.id === id)!; return [l.x + Math.sin(l.dir) * (l.r + out), l.z + Math.cos(l.dir) * (l.r + out)]; }
/** Shelf road up a canyon wall: at each station the road sits where the wall reaches its (steadily climbing) height, a few
 *  metres further in, so it is carved into the rock face with the drop on the open side. */
function ledgePath(H: Float32Array, o: { xa: number; xb: number; side: 1 | -1; into: number; toD?: number }): P2[] {
  const at = (x: number, d: number) => sampleH(H, x, cz(x) + o.side * d);
  let rimD = 60; while (rimD < 260 && at(o.xb, rimD + 10) - at(o.xb, rimD) > 1.5) rimD += 5;   // where the wall tops out
  const h0 = at(o.xa, 0) + 1, h1 = at(o.xb, rimD), out: P2[] = [[o.xa, cz(o.xa) + o.side * 8]];
  for (let x = o.xa + 10; x < o.xb; x += 10) {
    const hs = h0 + (h1 - h0) * ((x - o.xa) / (o.xb - o.xa));
    let d = 8; while (d < 300 && at(x, d) < hs) d += 1;
    out.push([x, cz(x) + o.side * (d + o.into)]);
  }
  out.push([o.xb, cz(o.xb) + o.side * (rimD + 12)]);
  if (o.toD && o.toD > rimD + 24) out.push([o.xb + 18, cz(o.xb + 18) + o.side * o.toD]);   // out across the rim to meet the rim road
  // ease the wiggles (the strata wobble) without pulling the line off the shelf
  for (let pass = 0; pass < 2; pass++) for (let i = 1; i < out.length - 1; i++) out[i] = [out[i][0], (out[i - 1][1] + 2 * out[i][1] + out[i + 1][1]) / 4];
  return out;
}

/** Where the summit road arrives: the plateau edge on Mount Apex's south face. */
const SUMMIT_GATE: P2 = [PEAK.x + Math.sin(PEAK.face) * (PEAK.plateau - 8), PEAK.z + Math.cos(PEAK.face) * (PEAK.plateau - 8)];
/**
 * A surveyed mountain road: from `a`, walk uphill in 5 m steps choosing, among gentle turns, the heading whose climb on the
 * NATURAL ground is closest to `grade` (on smoothed heights, so it follows spurs and gullies rather than noise). Such a
 * line hugs the contours and needs almost no earthworks. It keeps clear of landmarks and of its own earlier turns, and
 * once it is within `stop` of the goal (or level with it) it runs straight in.
 */
function traceGrade(H: Float32Array, a: P2, goal: P2, grade: number, stop: number, level = false): P2[] {
  const at = (x: number, z: number) => (sampleH(H, x, z) * 2 + sampleH(H, x + 6, z) + sampleH(H, x - 6, z) + sampleH(H, x, z + 6) + sampleH(H, x, z - 6)) / 6;
  const hGoal = sampleH(H, goal[0], goal[1]), STEP = 5, avoid = LANDMARKS.filter((l) => l.id !== 'summit');
  const dg = (x: number, z: number) => Math.hypot(goal[0] - x, goal[1] - z);
  // beam search (a greedy walk follows contours into gully heads it can't climb out of)
  type S = { x: number; z: number; hd: number; h: number; c: number; p: number; hb: number[] };
  const h0 = at(a[0], a[1]), all: S[] = [{ x: a[0], z: a[1], hd: Math.atan2(goal[0] - a[0], goal[1] - a[1]), h: h0, c: 0, p: -1, hb: [h0, h0, h0] }];
  let beam = [0], end = -1;
  for (let it = 0; it < 1500 && end < 0; it++) {
    const next: S[] = [];
    for (const si of beam) {
      const st = all[si];
      for (let k = -6; k <= 6; k++) {
        // grade over a 20 m baseline (single 5 m steps are dominated by the ground's small bumps)
        const th = st.hd + k * 0.055, qx = st.x + Math.sin(th) * STEP, qz = st.z + Math.cos(th) * STEP, qh = at(qx, qz), g = (qh - st.hb[0]) / (STEP * 4);
        let c = (g - grade) ** 2 * 900 + (k * 0.055) ** 2 * 40 + (g < -0.01 ? 300 * (-0.01 - g) : 0) + 0.22 * (dg(qx, qz) - dg(st.x, st.z)) / STEP;
        for (const l of avoid) { const dl = Math.hypot(qx - l.x, qz - l.z) - l.r - 35; if (dl < 0) c += -dl * 2; }
        next.push({ x: qx, z: qz, hd: th, h: qh, c: st.c + c, p: si, hb: [st.hb[1], st.hb[2], st.h] });
      }
    }
    next.sort((u, v) => u.c - v.c);
    const seen = new Set<number>(); beam = [];
    for (const n of next) {
      const key = Math.round(n.x / 7) * 100000 + Math.round(n.z / 7);   // keep the beam diverse
      if (seen.has(key)) continue; seen.add(key);
      // arriving only counts for the cheapest route; a costlier one that got there first was cutting corners up the slope
      const arrived = level ? n.h > hGoal - 5 && dg(n.x, n.z) < stop * 3 : dg(n.x, n.z) < stop || n.h > hGoal - 6;
      if (arrived && beam.length) continue;
      all.push(n); beam.push(all.length - 1);
      if (arrived) { end = all.length - 1; break; }
      if (beam.length >= 40) break;
    }
  }
  if (end < 0) end = beam[0];
  if ((globalThis as { TRACE_DBG?: boolean }).TRACE_DBG) { let n = 0, g = 0; for (let i = end; all[i].p >= 0; i = all[i].p) { n++; g += Math.abs(all[i].h - all[all[i].p].h) / STEP; } const ch: S[] = []; for (let i = end; i >= 0; i = all[i].p) ch.push(all[i]); ch.reverse(); console.log(ch.filter((_, i) => i % 20 === 0).map((q, i, A) => i ? `${((q.h - A[i - 1].h) / 100).toFixed(2)}@${Math.round(Math.hypot(q.x - PEAK.x, q.z - PEAK.z))}` : '').join(' ')); console.log('trace steps', n, 'mean |g|', (g / n).toFixed(3), 'h', all[0].h.toFixed(0), '->', all[end].h.toFixed(0)); }
  const out: P2[] = [];
  for (let i = end; i >= 0; i = all[i].p) out.push([all[i].x, all[i].z]);
  out.reverse();
  // run in to the goal
  const lx = out[out.length - 1], n = Math.max(2, Math.ceil(dg(lx[0], lx[1]) / 8));
  for (let i = 1; i <= n; i++) out.push([lx[0] + (goal[0] - lx[0]) * (i / n), lx[1] + (goal[1] - lx[1]) * (i / n)]);
  return out;
}
export const ROAD_DEFS: RoadDef[] = [
  // hub spokes
  { id: 'hub-south', kind: 'asphalt', width: 11, grade: 0.09, ctrl: [[0, 40], [30, 300], [-30, 560], [60, 820], aN(BRIDGES_X[1]), bN(BRIDGES_X[1])] },
  { id: 'hub-east', kind: 'dirt', width: 9, grade: 0.12, ctrl: [[40, 0], [300, -40], [520, 60], [720, -30], [900, 40], [1080, -70], [1230, -150], [1420, -210], [1650, -120], [1840, -60], [2000, -60]],
    bumps: [[0.3, 1.5, 14, 6, 18], [0.55, 1.8, 14, 8, 20], [0.82, 1.6, 14, 6, 18]] },
  { id: 'hub-west', kind: 'haul', width: 15, grade: 0.08, ctrl: [[-40, 0], [-300, 20], [-560, -20], [-820, -60], [-900, -60], spiral(PITS[0], 0.25, 1.15)[0]] },
  { id: 'hub-north', kind: 'snow', width: 8, grade: 0.14, ctrl: [[0, -40], [-20, -250], [-60, -700], [-120, -860], [-180, -1000], SUMMIT] },
  // desert outer: the Baja run along the far south, everything in the desert drains into it
  { id: 'baja-run', kind: 'gravel', width: 11, grade: 0.2, ctrl: [[-1960, 1640], [-1760, 1840], [-1420, 1880], [-1080, 2000], [-720, 1910], [-360, 2010], [0, 1960], [360, 2030], [800, 1940], [1120, 2010], [1440, 1910], [1760, 1720], [1940, 1480]],
    bumps: [[0.13, 2.2, 14, 12, 22], [0.3, 2.6, 16, 14, 24], [0.47, 2.2, 14, 10, 22], [0.62, 2.8, 16, 14, 26], [0.8, 2.4, 14, 12, 24]] },
  { id: 'south-desert', kind: 'asphalt', width: 11, grade: 0.13, ctrl: [bS(BRIDGES_X[1]), aS(BRIDGES_X[1]), [190, 1420], [140, 1640], [60, 1820], [10, 1955]] },
  // forest
  { id: 'forest-loop', kind: 'dirt', width: 8, grade: 0.13, ctrl: [[720, -30], [800, 250], [1000, 420], [1260, 380], [1520, 300], [1700, 500], [1650, 800], [1400, 900], [1100, 800], [800, 620], [500, 400], [260, 160], [60, 30]],
    bumps: [[0.12, 1.6, 14, 6, 18], [0.33, 1.8, 14, 6, 20], [0.56, 1.6, 14, 6, 18], [0.78, 1.9, 14, 8, 20]] },
  { id: 'forest-north', kind: 'dirt', width: 8, grade: 0.14, ctrl: [[900, 40], [860, -300], [960, -600], [870, -915]] },
  // the Ridgeback: a fast gravel rally road along the eastern ridge line, lake pass to the Baja run
  { id: 'ridgeback', kind: 'gravel', width: 10, grade: 0.12, ctrl: [[1290, -1730], [1440, -1620], [1600, -1470], [1760, -1330], [1960, -1120], [2030, -850], [1940, -560], [2030, -260], [2000, -60], [1930, 240], [2040, 540], [1960, 850], [2030, 1150], [1940, 1480]],
    bumps: [[0.42, 2.0, 14, 10, 22], [0.58, 2.4, 14, 12, 22], [0.74, 2.2, 14, 10, 22], [0.88, 2.6, 16, 12, 24]] },
  { id: 'timber-trail', kind: 'trail', width: 6, grade: 0.16, ctrl: [[1080, -70], [1330, 80], [1420, 330], [1600, 560], [1800, 650], [1900, 760], [1960, 850]] },
  // desert
  { id: 'desert-west', kind: 'dirt', width: 8, grade: 0.16, ctrl: [[-30, 560], [-350, 780], aN(BRIDGES_X[0]), bN(BRIDGES_X[0])] },
  { id: 'desert-west-s', kind: 'dirt', width: 8, grade: 0.16, ctrl: [bS(BRIDGES_X[0]), aS(BRIDGES_X[0]), [-820, 1450], [-1000, 1620], [-1200, 1760], [-1420, 1880]],
    bumps: [[0.45, 1.8, 14, 8, 20], [0.75, 2.0, 14, 8, 22]] },
  { id: 'desert-east', kind: 'dirt', width: 9, grade: 0.16, ctrl: [[60, 820], [480, 870], [760, 880], aN(BRIDGES_X[2]), bN(BRIDGES_X[2])] },
  { id: 'desert-east-s', kind: 'dirt', width: 9, grade: 0.16, ctrl: [bS(BRIDGES_X[2]), aS(BRIDGES_X[2]), [1080, 1380], [1250, 1600], [1300, 1800], [1440, 1910]] },
  { id: 'canyon-floor', kind: 'trail', width: 7, grade: 0.2, bank: 4, earth: false, fixed: true, ctrl: [...Array.from({ length: 33 }, (_, i) => -1150 + i * 40).map((x) => [x, cz(x) + 7 * Math.sin(x / 75)] as P2), [200, cz(200) + 6]] },
  { id: 'cliff-trail', kind: 'trail', width: 7, grade: 0.2, bank: 3, fixed: true, ctrl: [[200, cz(200) + 6], [600, 0]], ledge: { xa: 200, xb: 600, side: 1, into: 3 } },
  { id: 'dune-track', kind: 'trail', width: 8, grade: 0.16, ctrl: [[600, cz(600) + 72], [590, 1450], [585, 1550], [640, 1640], [760, 1760], [800, 1940]] },
  // quarry + west
  { id: 'pitA-spiral', kind: 'haul', width: 14, grade: 0.1, fixed: true, ctrl: spiral(PITS[0], 0.25, 1.15) },
  { id: 'pitB-road', kind: 'haul', width: 13, grade: 0.09, ctrl: [[-760, -52], [-725, 90], [-760, 280], [-820, 430], [PITS[1].x + PITS[1].r - 5, PITS[1].z - 40]] },
  { id: 'pitB-spiral', kind: 'haul', width: 12, grade: 0.1, fixed: true, ctrl: spiral(PITS[1], -0.19, 0.95) },
  { id: 'haul-south', kind: 'haul', width: 14, grade: 0.09, ctrl: [[-852, 540], [-875, 700], [-1000, 795], [-1180, 795], [-1330, 880]] },
  { id: 'canyon-entry', kind: 'trail', width: 8, grade: 0.15, bank: 6, fixed: true, ctrl: [[-1330, 880], [-1300, 1040], [-1150, cz(-1150)]] },
  { id: 'quarry-north', kind: 'gravel', width: 10, grade: 0.17, ctrl: [[-820, -60], [-860, -400], [-780, -700], [-720, -900], [-694, -950]] },
  { id: 'west-haul', kind: 'haul', width: 13, grade: 0.1, ctrl: [[-860, -410], [-1080, -490], [-1350, -520], [-1640, -400], [-1800, -170], [-1830, 120], [-1700, 380], [-1650, 500]] },
  { id: 'mx-track', kind: 'dirt', width: 10, grade: 0.2, fixed: true, ctrl: MX,
    bumps: [[0.06, 2.4, 12, 8, 16], [0.16, 2.8, 12, 10, 16], [0.33, 2.4, 12, 8, 16], [0.43, 3.0, 13, 10, 18], [0.6, 2.4, 12, 8, 16], [0.7, 2.8, 12, 10, 16], [0.87, 2.6, 12, 8, 16], [0.95, 3.0, 13, 10, 18]] },
  { id: 'mx-link', kind: 'dirt', width: 9, grade: 0.12, ctrl: [MX[MX.length - 1], [-1580, 960], [-1460, 900], [-1330, 880]] },
  // mountain
  { id: 'peak-descent', kind: 'snow', width: 8, grade: 0.16, ctrl: [SUMMIT, [-330, -1160], [-520, -1140], [-694, -950]] },
  { id: 'glacier-ridge', kind: 'snow', width: 8, grade: 0.16, ctrl: [SUMMIT, [250, -1220], [650, -1330], [1000, -1300], [870, -915]] },
  { id: 'alpine-pass', kind: 'snow', width: 9, grade: 0.13, ctrl: [[-694, -950], [-880, -1060], [-1100, -1120], [-1350, -1210], [-1600, -1300]] },
  // the northern ranges: the High Traverse runs the whole way across the north, from the outpost valley behind the Pass Hut
  // round the back of Mount Apex to the frozen lake; two cols tie it to the Radar Station and the Glacier Ridge
  { id: 'high-traverse', kind: 'gravel', width: 9, grade: 0.14, ctrl: [[-1600, -1700], [-1250, -1960], [-850, -2050], [-420, -2000], [0, -1960], [420, -1900]] },
  // down to the frozen lake: surveyed along the valley side at a steady grade (traced up from the lake, driven down)
  { id: 'lake-descent', kind: 'gravel', width: 9, grade: 0.15, fixed: true, ctrl: [[420, -1900], [1290, -1730]], trace: { grade: 0.1, stop: 30, rev: true, level: true } },
  { id: 'radar-col', kind: 'gravel', width: 8, grade: 0.15, ctrl: [lmGate('radar', 6), [-900, -1700], [-850, -2050]] },
  { id: 'north-spur', kind: 'gravel', width: 8, grade: 0.15, ctrl: [[650, -1330], [520, -1600], [420, -1900]] },
  // landmark trails (each starts on a waypoint of an existing road, so it joins it wherever that road now runs)
  { id: 'lm-crater', kind: 'trail', width: 6, grade: 0.15, ctrl: [[-1350, -520], lmGate('crater', 25)] },
  { id: 'lm-boneyard', kind: 'trail', width: 6, grade: 0.15, ctrl: [[-1960, 1640], lmGate('boneyard', 15)] },
  { id: 'lm-stunt', kind: 'dirt', width: 8, grade: 0.14, ctrl: [[300, -40], lmGate('stunt', 8)] },
  // Apex summit road: from the Summit Station junction, switchbacking up Mount Apex's south face to the top
  // ---- fun roads: flowing rim gravel, a tight forest rally stage, a desert jump alley, the quarry-to-snow ridge climb ----
  { id: 'rim-road', kind: 'gravel', width: 10, grade: 0.12, corridor: 90, ctrl: [aN(BRIDGES_X[0]), ...[-560, -420, -260, -100, 40].map((x) => [x, cz(x) - 165] as P2), aN(BRIDGES_X[1]), ...[300, 440, 600, 760, 880].map((x) => [x, cz(x) - 165] as P2), aN(BRIDGES_X[2])],
    bumps: [[0.2, 1.8, 16, 8, 22], [0.44, 2.0, 16, 8, 24], [0.71, 1.8, 16, 8, 22], [0.88, 2.2, 16, 10, 24]] },
  { id: 'forest-stage', kind: 'dirt', width: 7, grade: 0.15, corridor: 70, ctrl: [[1230, -150], [1200, -300], [1300, -380], [1250, -480], [1380, -545], [1480, -450], [1440, -330], [1580, -270], [1690, -380], [1790, -290], [1850, -430], [1900, -520], [1940, -560]],
    bumps: [[0.15, 1.6, 12, 4, 16], [0.36, 1.9, 13, 5, 18], [0.58, 1.6, 12, 4, 16], [0.8, 2.0, 13, 6, 18]] },
  { id: 'ledge-road', kind: 'gravel', width: 7, grade: 0.18, bank: 3, fixed: true, ctrl: [[-250, 0], [470, 0]], ledge: { xa: -250, xb: 470, side: -1, into: 4, toD: 188 } },
  { id: 'jump-alley', kind: 'dirt', width: 10, grade: 0.12, corridor: 60, ctrl: [[-300, 20], [-325, 200], [-285, 380], [-345, 560], [-350, 780]],
    bumps: [[0.1, 1.2, 7, 0, 7], [0.16, 1.2, 7, 0, 7], [0.22, 1.2, 7, 0, 7], [0.36, 3.0, 16, 12, 26], [0.52, 1.3, 7, 0, 7], [0.58, 1.3, 7, 0, 7], [0.64, 1.3, 7, 0, 7], [0.78, 2.6, 18, 12, 26]] },
  { id: 'west-ridge', kind: 'gravel', width: 8, grade: 0.15, corridor: 80, ctrl: [[-1350, -520], [-1500, -690], [-1420, -870], [-1570, -1010], [-1470, -1150], [-1600, -1300]] },
  { id: 'summit-road', kind: 'asphalt', width: 9, grade: 0.13, pinEnd: true, fixed: true, ctrl: [SUMMIT, SUMMIT_GATE], trace: { grade: 0.095, stop: 30 } },
  { id: 'lm-shipwreck', kind: 'trail', width: 6, grade: 0.15, ctrl: [[-720, 1910], lmGate('shipwreck', 10)] },
  { id: 'lm-stones', kind: 'trail', width: 6, grade: 0.15, ctrl: [[1420, -210], lmGate('stones', 6)] },
  { id: 'lm-radar', kind: 'trail', width: 6, grade: 0.15, ctrl: [[-520, -1140], lmGate('radar', 6)] },
  { id: 'lm-ski', kind: 'snow', width: 7, grade: 0.15, ctrl: [[0, -1960], lmGate('ski', 6)] },
  // ---- secret trails to the new landmarks: faint, narrow and winding, like the barn-find ruts ----
  { id: 'canyon-floor-east', kind: 'trail', width: 7, grade: 0.2, bank: 4, earth: false, fixed: true, ctrl: [...Array.from({ length: 17 }, (_, i) => 200 + i * 40).map((x) => [x, cz(x) + 6 * Math.sin(x / 70 + 1)] as P2), [SLOT_X, cz(SLOT_X) + 8]] },
  { id: 'lm-dwellings', kind: 'trail', width: 4.5, grade: 0.3, bank: 3, earth: false, fixed: true, ctrl: [[SLOT_X, cz(SLOT_X) + 8], ...slotPts(), lmGate('dwellings', -8)] },
  { id: 'lm-lookout', kind: 'trail', width: 4, grade: 0.2, bank: 3, fixed: true, ctrl: [[1330, -760], lmGate('lookout', 3)], trace: { grade: 0.115, stop: 16 } },
  { id: 'lm-mine', kind: 'trail', width: 3.8, grade: 0.3, bank: 4, ctrl: [[-1830, 120], [-1905, 60], [-1960, 115], [-2025, 45], [-2050, -40], lmGate('mine', 10)] },
  { id: 'lm-ufo', kind: 'trail', width: 3.8, grade: 0.3, bank: 4, ctrl: [[1940, 1480], [1870, 1440], [1835, 1370], [1760, 1395], lmGate('ufo', 6)] },
  { id: 'lm-sinkhole', kind: 'trail', width: 6, grade: 0.15, ctrl: [[1760, -1330], lmGate('sinkhole', SINK.rampRun)] },
  ...CABINS.map((c) => ({ id: 'ruts-' + c.id, kind: 'trail' as RoadKind, width: 3.4, grade: 0.3, bank: 4, ctrl: [c.from, ...c.via, [c.x + Math.sin(c.yaw) * 13, c.z + Math.cos(c.yaw) * 13] as P2] })),
];

export const RAMPS: { x: number; z: number; dir: number; h: number; len: number; w: number }[] = [
  // rock ramps on the north rim facing south across the canyon narrows
  ...NARROWS.map((x) => ({ x, z: cz(x) - 34, dir: Math.PI / 2, h: 6, len: 30, w: 12 })),
];

export interface Pad { x: number; z: number; r: number; h: number }

/**
 * Grade-aware road routing (A* on an 8 m lattice with 16 move directions). Steps steeper than the road's ruling grade
 * are heavily penalised, so roads follow the contours, wind round mesas and zig-zag up mountains on their own,
 * instead of being bulldozed straight through them.
 */
const RG = 8, RN = Math.floor((HALF * 2) / RG) + 1;
class Router {
  h = new Float32Array(RN * RN); mult = new Float32Array(RN * RN); relief = new Float32Array(RN * RN); conf = new Float32Array(RN * RN);
  private g = new Float32Array(RN * RN * 16).fill(Infinity); private from = new Int32Array(RN * RN * 16).fill(-1); private closed = new Uint8Array(RN * RN * 16);
  private touched: number[] = [];
  private turn = new Float32Array(16 * 16);
  constructor(data: WorldData) {
    for (let j = 0; j < RN; j++) for (let i = 0; i < RN; i++) {
      const x = -HALF + i * RG, z = -HALF + j * RG, k = j * RN + i;
      this.h[k] = sampleH(data.height, x, z);
      let m = 1;
      if (x > CANYON_X0 && x < CANYON_X1 && Math.abs(z - cz(x)) < 90) m = 60;               // only bridges cross the canyon
      for (const p of PITS) if (Math.hypot(x - p.x, z - p.z) < p.r - 10) m = Math.max(m, 25);
      for (const l of LAKES) if (Math.hypot(x - l.x, z - l.z) < l.r + 10) m = Math.max(m, 25);
      for (const l of LANDMARKS) if (Math.hypot(x - l.x, z - l.z) < l.r * 0.95) m = Math.max(m, 25);
      if (Math.max(Math.abs(x), Math.abs(z)) > HALF - 300) m = Math.max(m, 30);
      for (const g of GARAGES) { if (!g.main) continue; const px = g.x + Math.sin(g.yaw) * (g.main ? 10 : 7), pz = g.z + Math.cos(g.yaw) * (g.main ? 10 : 7); if (Math.hypot(x - px, z - pz) < (g.main ? 42 : 26) + 10) m = Math.max(m, 40); }
      this.mult[k] = m;
    }
    // river channels: crossable, but cross once and square-on
    for (const r of data.rivers) { const R = Math.ceil((r.width / 2 + 16) / RG); for (let k = 0; k < r.pts.length; k += 2) { const [x, z] = r.pts[k], ci = Math.round((x + HALF) / RG), cj = Math.round((z + HALF) / RG); for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) { const ii = ci + di, jj = cj + dj; if (ii >= 0 && jj >= 0 && ii < RN && jj < RN && Math.hypot(di, dj) * RG < r.width / 2 + 16) this.mult[jj * RN + ii] = Math.max(this.mult[jj * RN + ii], 3); } } }
    // plan on terrain blurred to ~40 m: roads ride over dune ripples and rocks, but respect hills and mountains
    for (let pass = 0; pass < 3; pass++) {
      const src = this.h.slice();
      for (let j = 2; j < RN - 2; j++) for (let i = 2; i < RN - 2; i++) { let sum = 0; for (let d = -2; d <= 2; d++) sum += src[j * RN + i + d] + src[(j + d) * RN + i]; this.h[j * RN + i] = sum / 10; }
    }
    // relief: how far the real ground stands proud of (or sinks below) the planning surface = earthworks needed here
    for (let j = 0; j < RN; j++) for (let i = 0; i < RN; i++) { const k = j * RN + i; this.relief[k] = Math.max(0, Math.abs(sampleH(data.height, -HALF + i * RG, -HALF + j * RG) - this.h[k]) - 2.5); }
    // confinement: ground rising steeply on BOTH sides within ~50 m (a slot, gully or ravine). Driving the bottom of one is
    // a trench with no view, so slots cost extra; open valleys, hillsides and ridges don't.
    const raw = (i: number, j: number) => sampleH(data.height, -HALF + i * RG, -HALF + j * RG);
    for (let j = 6; j < RN - 6; j++) for (let i = 6; i < RN - 6; i++) {
      const c = raw(i, j); let conf = 0;
      for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        let a = -1e9, b = -1e9;
        for (const s of [2, 4, 6]) { a = Math.max(a, raw(i + di * s, j + dj * s) - c); b = Math.max(b, raw(i - di * s, j - dj * s) - c); }
        conf = Math.max(conf, Math.min(a, b));
      }
      this.conf[j * RN + i] = Math.max(0, conf - 10);
    }
  }
  /** A* over (node, heading) states: a turning cost makes it build long switchback legs with real hairpins. */
  route(a: P2, b: P2, gmax: number, inHeading?: number, corridor = 260): P2[] {
    const node = (p: P2) => clamp(Math.round((p[1] + HALF) / RG), 0, RN - 1) * RN + clamp(Math.round((p[0] + HALF) / RG), 0, RN - 1);
    const s0 = node(a), t = node(b), ti = t % RN, tj = (t / RN) | 0;
    const ND = 16;
    for (const k of this.touched) { this.g[k] = Infinity; this.from[k] = -1; this.closed[k] = 0; }
    this.touched = [];
    const D: [number, number, number, number][] = [];
    for (const [di, dj] of [[1, 0], [2, 1], [1, 1], [1, 2], [0, 1], [-1, 2], [-1, 1], [-2, 1], [-1, 0], [-2, -1], [-1, -1], [-1, -2], [0, -1], [1, -2], [1, -1], [2, -1]]) D.push([di, dj, Math.hypot(di, dj) * RG, Math.atan2(dj, di)]);
    const hf: number[] = [], hn: number[] = [];
    const push = (f: number, n: number) => { let i = hf.length; hf.push(f); hn.push(n); while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; hf[i] = hf[p]; hn[i] = hn[p]; i = p; } hf[i] = f; hn[i] = n; };
    const pop = () => { const n = hn[0], lf = hf.pop()!, ln = hn.pop()!; if (hf.length) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= hf.length) break; if (c + 1 < hf.length && hf[c + 1] < hf[c]) c++; if (hf[c] >= lf) break; hf[i] = hf[c]; hn[i] = hn[c]; i = c; } hf[i] = lf; hn[i] = ln; } return n; };
    // turn penalty table (metres-equivalent) between headings
    const turn = this.turn;
    for (let x = 0; x < ND; x++) for (let y = 0; y < ND; y++) { let d = Math.abs(D[x][3] - D[y][3]); if (d > Math.PI) d = 2 * Math.PI - d; turn[x * ND + y] = d < 0.5 ? 2 + d * 14 : Infinity; }   // ≤ ~25° per step: hairpins keep a ~20 m radius
    const DI = new Int32Array(ND), DJ = new Int32Array(ND), DL = new Float32Array(ND);
    for (let d = 0; d < ND; d++) { DI[d] = D[d][0]; DJ[d] = D[d][1]; DL[d] = D[d][2]; }
    const H = this.h, M = this.mult, REL = this.relief, CF = this.conf, G = this.g, F = this.from, C = this.closed, ht = H[t], inv = 1 / gmax;
    // stay within a corridor around the leg: no kilometre-long detours through neighbouring valleys
    const ax = (a[0] + HALF) / RG, az = (a[1] + HALF) / RG, bx = (b[0] + HALF) / RG, bz = (b[1] + HALF) / RG;
    const lx = bx - ax, lz = bz - az, l2 = lx * lx + lz * lz || 1, corr = Math.max(corridor, 0.45 * Math.sqrt(l2) * RG) / RG;
    const inCorr = (i: number, j: number) => { let u = ((i - ax) * lx + (j - az) * lz) / l2; u = u < 0 ? 0 : u > 1 ? 1 : u; const dx = ax + lx * u - i, dz = az + lz * u - j; return dx * dx + dz * dz < corr * corr; };
    for (let d = 0; d < ND; d++) {
      // continue the previous leg's heading through a waypoint (no kinks where two legs meet)
      let c0 = 0;
      if (inHeading !== undefined) { let dd = Math.abs(D[d][3] - inHeading); if (dd > Math.PI) dd = 2 * Math.PI - dd; if (dd > 0.5) continue; c0 = 2 + dd * 14; }
      const st = s0 * ND + d; G[st] = c0; this.touched.push(st); push(c0, st);
    }
    let end = -1, iter = 0;
    while (hf.length && iter++ < 6_000_000) {
      const cs = pop();
      const c = (cs / ND) | 0, cd = cs - c * ND;
      if (c === t) { end = cs; break; }
      if (C[cs]) continue;
      C[cs] = 1;
      const ci = c % RN, cj = (c / RN) | 0, hc = H[c], gc = G[cs], tb = cd * ND;
      for (let nd = 0; nd < ND; nd++) {
        const tc = c === s0 && inHeading === undefined ? 0 : turn[tb + nd];
        if (tc === Infinity) continue;
        const ni = ci + DI[nd], nj = cj + DJ[nd];
        if (ni < 0 || nj < 0 || ni >= RN || nj >= RN || !inCorr(ni, nj)) continue;
        const n = nj * RN + ni, ns = n * ND + nd;
        if (C[ns]) continue;
        const L = DL[nd], dh = H[n] - hc, gr = (dh < 0 ? -dh : dh) / L;
        const over = gr > gmax ? (gr - gmax) * inv : 0;
        const ng = gc + L * (1 + 0.5 * gr * inv + (over > 0 ? 3 + 30 * over * over : 0) + 0.12 * REL[n] + 0.16 * CF[n]) * M[n] + tc;
        if (ng < G[ns]) {
          if (G[ns] === Infinity) this.touched.push(ns);
          G[ns] = ng; F[ns] = cs;
          const dx = ni - ti, dy = nj - tj, dv = ht - H[n];
          push(ng + 1.3 * Math.max(Math.sqrt(dx * dx + dy * dy) * RG, (dv < 0 ? -dv : dv) * inv), ns);
        }
      }
    }
    if ((globalThis as { process?: { env: Record<string, string> } }).process?.env?.ROUTE_DEBUG) console.log('route', a.map(Math.round), b.map(Math.round), end < 0 ? 'FAILED' : 'ok', iter);
    if (end < 0) return inHeading !== undefined ? this.route(a, b, gmax, undefined, corridor) : gmax < 0.5 ? this.route(a, b, gmax * 1.6, undefined, corridor) : [a, b];
    const out: P2[] = [];
    for (let st = end; st !== -1 && out.length < 100000; st = this.from[st]) { const n = (st / ND) | 0; out.push([-HALF + (n % RN) * RG, -HALF + ((n / RN) | 0) * RG]); }
    out.reverse();
    out[0] = a; out[out.length - 1] = b;
    // round the lattice corners off (light: legs and hairpins keep their shape)
    let p = out;
    for (let it = 0; it < 3; it++) { const q = p.map((v) => [v[0], v[1]] as P2); for (let i = 1; i < p.length - 1; i++) { q[i][0] = (p[i - 1][0] + p[i][0] * 2 + p[i + 1][0]) / 4; q[i][1] = (p[i - 1][1] + p[i][1] * 2 + p[i + 1][1]) / 4; } p = q; }
    return p;
  }
}

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
const EW_NOISE = new Simplex(4242);
function earthworks(H: Float32Array, core: Float32Array, noFill: Uint8Array, noEmbank?: Uint8Array): Float32Array {
  const n = V * V, hi = new Float32Array(n);
  // fills: every cell remembers the road height and distance of the embankment that constrains it. The batter starts at
  // 1:2.5 at the road and steepens with distance, so an embankment stays local instead of fanning out for hundreds of metres
  // over everything below it (that is what walled lower switchback legs in, and buried the lake).
  const srcC = new Float32Array(n), srcD = new Float32Array(n), lo = new Float32Array(n);
  const fill = (d: number) => 0.4 * d + 0.012 * d * d;
  for (let k = 0; k < n; k++) { const c = core[k]; if (c === c) { srcC[k] = noEmbank?.[k] ? -1e9 : c; hi[k] = c; } else { srcC[k] = -1e9; hi[k] = 1e9; } srcD[k] = 0; lo[k] = srcC[k]; }
  const SC = 2.0, ca = SC * CELL, cb = SC * CELL * Math.SQRT2, sa = CELL, sb = CELL * Math.SQRT2;
  const offer = (k: number, q: number, step: number) => { const c = srcC[q]; if (c < -1e8) return; const d = srcD[q] + step, v = c - fill(d); if (v > lo[k]) { lo[k] = v; srcC[k] = c; srcD[k] = d; } };
  // two-pass chamfer propagation (6.5 M cells)
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < V; j++) {
      const row = j * V, up = row - V;
      for (let i = 0; i < V; i++) {
        const k = row + i; let h = hi[k], q: number;
        if (i > 0) { q = k - 1; offer(k, q, sa); if (hi[q] + ca < h) h = hi[q] + ca; }
        if (j > 0) {
          q = up + i; offer(k, q, sa); if (hi[q] + ca < h) h = hi[q] + ca;
          if (i > 0) { q = up + i - 1; offer(k, q, sb); if (hi[q] + cb < h) h = hi[q] + cb; }
          if (i < V - 1) { q = up + i + 1; offer(k, q, sb); if (hi[q] + cb < h) h = hi[q] + cb; }
        }
        hi[k] = h;
      }
    }
    for (let j = V - 1; j >= 0; j--) {
      const row = j * V, dn = row + V;
      for (let i = V - 1; i >= 0; i--) {
        const k = row + i; let h = hi[k], q: number;
        if (i < V - 1) { q = k + 1; offer(k, q, sa); if (hi[q] + ca < h) h = hi[q] + ca; }
        if (j < V - 1) {
          q = dn + i; offer(k, q, sa); if (hi[q] + ca < h) h = hi[q] + ca;
          if (i < V - 1) { q = dn + i + 1; offer(k, q, sb); if (hi[q] + cb < h) h = hi[q] + cb; }
          if (i > 0) { q = dn + i - 1; offer(k, q, sb); if (hi[q] + cb < h) h = hi[q] + cb; }
        }
        hi[k] = h;
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
    // no engineered-perfect batters: let 15-55 % of the original relief show through, varying along the slope
    const x = (k % V) * CELL, z = ((k / V) | 0) * CELL;
    const keep = 0.15 + 0.4 * (0.5 + 0.5 * EW_NOISE.fbm(x / 70, z / 70, 3));
    h += clamp((H[k] - h) * keep, -2.5, 2.5) + 0.8 * EW_NOISE.fbm(x / 9, z / 9, 2);
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
  return lo;
}

/**
 * Apex summit: re-lay the mountain's flanks through the finished summit road, so the slope between one switchback leg and
 * the next is a smooth hillside (no cut-and-fill crevices, no gullies), easing back into the natural rock away from the road.
 */
function fitPeak(H: Float32Array, r: Road | undefined, core: Float32Array, others: Road[]) {
  if (!r) return;
  // other roads' samples nearby: the fit fades out well before it reaches them
  const R1 = PEAK.rFace + 200, oth: P2[] = [];
  // (the roads that merely start at the summit road's own junction don't count: the face behind it is the summit road's)
  for (const o of others) if (o !== r) for (let i = 0; i < o.pts.length; i += 3) if (Math.hypot(o.pts[i][0] - PEAK.x, o.pts[i][1] - PEAK.z) < R1 && Math.hypot(o.pts[i][0] - r.pts[0][0], o.pts[i][1] - r.pts[0][1]) > 70) oth.push(o.pts[i]);
  const S = 4, sx: number[] = [], sz: number[] = [], sh: number[] = [], top = r.h[r.h.length - 1];
  for (let i = 0; i < r.pts.length; i += S) { sx.push(r.pts[i][0]); sz.push(r.pts[i][1]); sh.push(r.h[i]); }
  // bucket the samples (32 m cells) for neighbour search
  const B = 32, buckets = new Map<number, number[]>();
  const bk = (x: number, z: number) => Math.floor((x + HALF) / B) * 4096 + Math.floor((z + HALF) / B);
  sx.forEach((x, k) => { const q = bk(x, sz[k]); let a = buckets.get(q); if (!a) buckets.set(q, (a = [])); a.push(k); });
  const REACH = 170, RB = Math.ceil(REACH / B);
  const R0 = PEAK.rFace + 160;
  for (let j = Math.floor((PEAK.z - R0 + HALF) / CELL); j <= Math.ceil((PEAK.z + R0 + HALF) / CELL); j++) for (let i = Math.floor((PEAK.x - R0 + HALF) / CELL); i <= Math.ceil((PEAK.x + R0 + HALF) / CELL); i++) {
    if (i < 0 || j < 0 || i >= V || j >= V) continue;
    const k = j * V + i; if (core[k] === core[k]) continue;
    const x = -HALF + i * CELL, z = -HALF + j * CELL;
    const dp = Math.hypot(x - PEAK.x, z - PEAK.z);
    const bi = Math.floor((x + HALF) / B), bj = Math.floor((z + HALF) / B);
    // nearest road sample, and the nearest one on a different leg (far along the road but close in space)
    let dmin = 1e9, n0 = -1;
    for (let a = -RB; a <= RB; a++) for (let b = -RB; b <= RB; b++) {
      const list = buckets.get((bi + a) * 4096 + bj + b); if (!list) continue;
      for (const s of list) { const d2 = (sx[s] - x) ** 2 + (sz[s] - z) ** 2; if (d2 < dmin) { dmin = d2; n0 = s; } }
    }
    if (n0 < 0 || dmin > REACH * REACH) continue;
    dmin = Math.sqrt(dmin);
    let d1 = 1e9, n1 = -1;
    for (let a = -RB; a <= RB; a++) for (let b = -RB; b <= RB; b++) {
      const list = buckets.get((bi + a) * 4096 + bj + b); if (!list) continue;
      for (const s of list) { const sep = Math.hypot(sx[s] - sx[n0], sz[s] - sz[n0]); if (Math.abs(s - n0) * S * 3 < 2.2 * sep + 30) continue; const d2 = (sx[s] - x) ** 2 + (sz[s] - z) ** 2; if (d2 < d1) { d1 = d2; n1 = s; } }
    }
    d1 = Math.sqrt(d1);
    // a plane from this leg's bench to the next leg's (just the bench, beyond the outermost leg)
    // (blend smoothly between 'between two turns' and 'outside the outermost turn' as the other turn drifts out of reach: no seams)
    const w1 = n1 >= 0 ? 1 - smoothstep(REACH - 60, REACH, d1) : 0;
    const tFit = w1 > 0 ? sh[n0] + (sh[n1] - sh[n0]) * smoothstep(0, 1, clamp((dmin - 6) / Math.max(1, dmin + d1 - 12), 0, 1)) * w1 : sh[n0];
    const sw = 1, swh = tFit;
    // the fitted surface owns the ground between the legs; toward the reach it hands back to the natural slope
    const foot = peakFoot(x, z).R;
    let b = ((1 - smoothstep(120, REACH, dmin)) * w1 + (1 - smoothstep(40, 130, dmin)) * (1 - w1)) * (1 - smoothstep(foot + 30, foot + 130, dp));
    for (const l of LAKES) b *= smoothstep(l.r + 30, l.r + 120, Math.hypot(x - l.x, z - l.z));
    if (b <= 0) continue;
    let dOther = 1e9; for (const q of oth) { const d2 = (q[0] - x) ** 2 + (q[1] - z) ** 2; if (d2 < dOther) dOther = d2; }
    b *= smoothstep(30, 90, Math.sqrt(dOther));
    if (b <= 0) continue;
    const t = swh / sw, nn = EW_NOISE.fbm(x / 50 + 3, z / 50 - 9, 3);
    H[k] = H[k] + (t + 1.2 * nn + clamp((H[k] - t) * 0.12, -3, 3) - H[k]) * b;
    // the very top is level with where the road arrives (the cairn, the deck, a lap round them), easing into the slope
    const crown = 1 - smoothstep(PEAK.plateau * 0.6, PEAK.plateau + 22, dp);
    if (crown > 0) H[k] += (top + 0.3 * nn - H[k]) * crown;
  }
}

/** Talus pass: no artificial walls. Anywhere in the region steeper than `slope` between neighbouring cells, material slides
 *  from the high cell to the low one (mass-conserving) until it settles; road cores and water never move. */
function relaxSteps(H: Float32Array, core: Float32Array, noFill: Uint8Array, cx: number, cz: number, R: number, slope: number, iters: number) {
  const m = slope * CELL, i0 = Math.max(1, Math.floor((cx - R + HALF) / CELL)), i1 = Math.min(V - 2, Math.ceil((cx + R + HALF) / CELL));
  const j0 = Math.max(1, Math.floor((cz - R + HALF) / CELL)), j1 = Math.min(V - 2, Math.ceil((cz + R + HALF) / CELL));
  const fixedCell = (k: number) => core[k] === core[k] || noFill[k] === 1;
  for (let it = 0; it < iters; it++) {
    let moved = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * V + i, fk = fixedCell(k);
      for (const n of [k + 1, k + V]) {
        const d = H[k] - H[n]; if (Math.abs(d) <= m) continue;
        const fn = fixedCell(n); if (fk && fn) continue;
        const ex = (Math.abs(d) - m) * 0.45 * Math.sign(d);
        if (fk) H[n] += ex * 2; else if (fn) H[k] -= ex * 2; else { H[k] -= ex; H[n] += ex; }
        moved++;
      }
    }
    if (!moved) break;
  }
}

/**
 * Stacked switchbacks: where two legs of road (or two roads) at clearly different heights pass within ~60 m of each other,
 * the ground between them is re-laid as one smooth slope from bench to bench (inverse-distance blend of the road heights),
 * instead of the upper leg's embankment and the lower leg's cutting fighting over it and walling the lower one in.
 */
function benchLegs(H: Float32Array, roads: Road[], core: Float32Array, noFill: Uint8Array) {
  const sx: number[] = [], sz: number[] = [], sh: number[] = [], sr: number[] = [], si: number[] = [];
  roads.forEach((r, ri) => { if (r.fixed || r.earth === false || r.id === 'summit-road') return; for (let i = 0; i < r.pts.length; i += 4) { if (r.bridged[i]) continue; sx.push(r.pts[i][0]); sz.push(r.pts[i][1]); sh.push(r.h[i]); sr.push(ri); si.push(i); } });
  const B = 32, buckets = new Map<number, number[]>(), key = (x: number, z: number) => Math.floor((x + HALF) / B) * 4096 + Math.floor((z + HALF) / B);
  sx.forEach((x, k) => { const q = key(x, sz[k]); let a = buckets.get(q); if (!a) buckets.set(q, (a = [])); a.push(k); });
  const REACH = 60, cand = new Uint8Array(V * V), R = Math.ceil(REACH / CELL);
  // candidate cells: near a sample that has a different leg at another height close by
  for (let k = 0; k < sx.length; k++) {
    let stacked = false;
    for (let a = -2; a <= 2 && !stacked; a++) for (let b = -2; b <= 2 && !stacked; b++) for (const o of buckets.get(key(sx[k], sz[k]) + a * 4096 + b) ?? []) {
      const dd = Math.hypot(sx[o] - sx[k], sz[o] - sz[k]);
      if (dd > 70 || Math.abs(sh[o] - sh[k]) < 8 || (sr[o] === sr[k] && Math.abs(si[o] - si[k]) * 3 < 2.2 * dd + 30)) continue;
      stacked = true; break;
    }
    if (!stacked) continue;
    const ci = Math.round((sx[k] + HALF) / CELL), cj = Math.round((sz[k] + HALF) / CELL);
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) { const ii = ci + di, jj = cj + dj; if (ii >= 0 && jj >= 0 && ii < V && jj < V && di * di + dj * dj <= R * R) cand[jj * V + ii] = 1; }
  }
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const k = j * V + i; if (!cand[k] || core[k] === core[k] || noFill[k]) continue;
    const x = -HALF + i * CELL, z = -HALF + j * CELL, bi = Math.floor((x + HALF) / B), bj = Math.floor((z + HALF) / B);
    let sw = 0, swh = 0, d0 = 1e9, n0 = -1;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (const o of buckets.get((bi + a) * 4096 + bj + b) ?? []) {
      const d2 = (sx[o] - x) ** 2 + (sz[o] - z) ** 2; if (d2 > REACH * REACH) continue;
      if (d2 < d0) { d0 = d2; n0 = o; }
      const w = 1 / (d2 * Math.sqrt(d2) + 200); sw += w; swh += w * sh[o];
    }
    if (n0 < 0) continue;
    // only between legs: there must be another leg (different stretch, other height) within reach on the far side
    let d1 = 1e9;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (const o of buckets.get((bi + a) * 4096 + bj + b) ?? []) {
      const dd = Math.hypot(sx[o] - sx[n0], sz[o] - sz[n0]);
      if (Math.abs(sh[o] - sh[n0]) < 8 || (sr[o] === sr[n0] && Math.abs(si[o] - si[n0]) * 3 < 2.2 * dd + 30)) continue;
      const d2 = (sx[o] - x) ** 2 + (sz[o] - z) ** 2; if (d2 < d1) d1 = d2;
    }
    if (d1 > REACH * REACH) continue;
    const b = 1 - smoothstep(30, REACH, Math.sqrt(d1));
    const t = swh / sw + 0.8 * EW_NOISE.fbm(x / 30 + 1, z / 30, 2);
    H[k] += (t - H[k]) * b;
  }
}

/**
 * Open up slots: wherever a road runs with high ground close on BOTH sides (a deep cutting or a ravine floor) the flanks are
 * laid back to a gentle, concave batter, so it reads as a broad pass with a view instead of a trench. One-sided
 * slopes (hillside benches, switchback stacks, pit spirals) are left alone, as are canyon/river cells and other roads.
 */
function openCuttings(H: Float32Array, roads: Road[], core: Float32Array, noFill: Uint8Array, fillLimit: Float32Array) {
  const at = (x: number, z: number) => sampleH(H, x, z);
  const REACH = 190;
  // concave batter: gentle at the road (1:2.4), steepening with distance so it always runs back into the hills, never a step
  const batter = (u: number) => 0.28 * u + 0.0065 * u * u;
  const stamps: [number, number, number, number][] = [];   // x, z, road height, half width
  for (const r of roads) {
    if ((r.fixed && r.id !== 'summit-road') || r.earth === false) continue;
    const half = r.width / 2, n = r.pts.length;
    const flag = new Uint8Array(n);
    for (let i = 1; i < n - 1; i++) {
      if (r.bridged[i]) continue;
      const [x, z] = r.pts[i], a = r.pts[i - 1], b = r.pts[i + 1];
      if (LANDMARKS.some((l) => Math.hypot(x - l.x, z - l.z) < l.r + 30) || PITS.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 20)) continue;
      let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      let L = -1e9, R = -1e9;
      for (const o of [10, 25, 45]) { L = Math.max(L, at(x - tz * (half + o), z + tx * (half + o))); R = Math.max(R, at(x + tz * (half + o), z - tx * (half + o))); }
      if (Math.min(L, R) - r.h[i] > 9) flag[i] = 1;
    }
    // grow the flagged stretches a little so the opened valley eases in and out
    for (let i = 0; i < n; i++) if (flag[i] === 1) for (let k = Math.max(0, i - 12); k <= Math.min(n - 1, i + 12); k++) if (!flag[k] && !r.bridged[k]) flag[k] = 2;
    for (let i = 0; i < n; i += 2) if (flag[i]) stamps.push([r.pts[i][0], r.pts[i][1], r.h[i], half]);
  }
  if (!stamps.length) return;
  const R = Math.ceil(REACH / CELL);
  const lower = new Float32Array(V * V).fill(Infinity);
  for (const [x, z, h, half] of stamps) {
    const ci = Math.round((x + HALF) / CELL), cj = Math.round((z + HALF) / CELL);
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const ii = ci + di, jj = cj + dj; if (ii < 0 || jj < 0 || ii >= V || jj >= V) continue;
      const d = Math.hypot(di, dj) * CELL; if (d > REACH) continue;
      const k = jj * V + ii;
      const t = h + batter(Math.max(0, d - half - 3));
      if (t < lower[k]) lower[k] = t;
    }
  }
  let moved = 0;
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const k = j * V + i, t = Math.max(lower[k], fillLimit[k] - 5);
    if (lower[k] === Infinity || core[k] === core[k] || noFill[k] || H[k] <= t) continue;
    // keep a quarter of the old relief (no machined batters), and fade out toward the edge of the reach
    const x = -HALF + i * CELL, z = -HALF + j * CELL;
    const nn = 0.5 + 0.5 * EW_NOISE.fbm(x / 60 + 7, z / 60, 3);
    H[k] = t + Math.min((H[k] - t) * (0.18 + 0.14 * nn), 1.5 + 3 * nn); moved++;
  }
  void moved;
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
  const router = new Router(data);
  const addRoad = (def: RoadDef) => {
    const tr = def.trace, c0 = def.ctrl[0], c1 = def.ctrl[def.ctrl.length - 1];
    let path: P2[] = def.ledge ? ledgePath(data.height, def.ledge) : tr ? (tr.rev ? traceGrade(data.height, c1, c0, tr.grade, tr.stop, tr.level).reverse() : traceGrade(data.height, c0, c1, tr.grade, tr.stop)) : def.ctrl;
    if (!def.fixed) {
      // junctions: an end that lands near an already-built road snaps exactly onto it
      const ctrl = def.ctrl.slice();
      // a designed junction (this waypoint is also a waypoint of an earlier road) snaps onto that road wherever it now runs
      const partners = (p: P2) => roads.filter((o) => o.ctrl.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1));
      for (const e of [0, ctrl.length - 1]) {
        const pr = partners(ctrl[e]);
        let best = pr.length ? 400 : 45, bp: P2 | null = null;
        for (const r of pr.length ? pr : roads) for (let i = 0; i < r.pts.length; i++) { if (r.bridged[i]) continue; const d = Math.hypot(r.pts[i][0] - ctrl[e][0], r.pts[i][1] - ctrl[e][1]); if (d < best) { best = d; bp = r.pts[i]; } }
        if (bp && !bridges.some((b) => Math.hypot(b.a[0] - ctrl[e][0], b.a[1] - ctrl[e][1]) < 4 || Math.hypot(b.b[0] - ctrl[e][0], b.b[1] - ctrl[e][1]) < 4)) ctrl[e] = [bp[0], bp[1]];
      }
      path = [ctrl[0]];
      for (let k = 0; k < ctrl.length - 1; k++) {
        const a = ctrl[k], b = ctrl[k + 1];
        let hd: number | undefined;
        if (path.length >= 3) { const p1 = path[path.length - 1], p0 = path[path.length - 3]; hd = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]); }
        const leg = Math.hypot(b[0] - a[0], b[1] - a[1]) < 80 ? [a, b] : router.route(a, b, def.grade * 0.85, hd, def.corridor);
        for (let i = 1; i < leg.length; i++) path.push(leg[i]);
      }
    }
    if (!def.fixed) {
      // trim out-and-back detours (a waypoint perched on a hill): if the path comes back within 14 m of itself, cut the loop
      const out: P2[] = [];
      for (let i = 0; i < path.length; i++) {
        out.push(path[i]);
        for (let k = 0; k < out.length - 6; k++) {
          const q = out[k], arc = (out.length - 1 - k) * 8;
          if (arc > 36 && Math.hypot(q[0] - path[i][0], q[1] - path[i][1]) < 14) { out.length = k + 1; out.push(path[i]); break; }
        }
      }
      // and knock out cusps (a short spike out and straight back, too short for the loop test above)
      for (let pass = 0; pass < 4; pass++) for (let i = 1; i < out.length - 1; i++) {
        const a = out[i - 1], b = out[i], c = out[i + 1];
        const ux = b[0] - a[0], uz = b[1] - a[1], vx = c[0] - b[0], vz = c[1] - b[1];
        if (ux * vx + uz * vz < -0.2 * Math.hypot(ux, uz) * Math.hypot(vx, vz)) { out.splice(i, 1); i--; }
      }
      path = out;
    }
    let pts = def.fixed ? spline(path, 3) : resample(path, 3);
    if (!def.fixed) {
      // where a road's end runs alongside the road it joins, merge there instead of driving in parallel
      const near = (p: P2) => nearRoad(p[0], p[1], 7) !== null;
      const endJoin = (p: P2) => roads.some((r) => Math.hypot(r.pts[0][0] - p[0], r.pts[0][1] - p[1]) < 6 || Math.hypot(r.pts[r.pts.length - 1][0] - p[0], r.pts[r.pts.length - 1][1] - p[1]) < 6);
      let e = pts.length - 1; if (!endJoin(pts[e])) while (e > 10 && near(pts[e]) && near(pts[e - 1])) e--;
      let b0 = 0; if (!endJoin(pts[0])) while (b0 < e - 10 && near(pts[b0]) && near(pts[b0 + 1])) b0++;
      pts = pts.slice(b0, Math.min(pts.length, e + 2));
    }
    const n = pts.length;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = sampleH(data.height, pts[i][0], pts[i][1]);
    const pin: (number | null)[] = new Array(n).fill(null);
    const bridged = new Uint8Array(n);
    // junctions: ends within 10 m of a built road, and any sample that crosses one, meet it at its height
    for (const idx of [0, n - 1]) { const h = nearRoad(pts[idx][0], pts[idx][1], 10); if (h !== null) pin[idx] = h; }
    for (let i = 1; i < n - 1; i++) { const h = nearRoad(pts[i][0], pts[i][1], 4.5); if (h !== null) pin[i] = h; }
    for (const p of pads) for (let i = 0; i < n; i++) if (Math.hypot(pts[i][0] - p.x, pts[i][1] - p.z) < p.r - 2) pin[i] = p.h;
    if (def.pinEnd) pin[n - 1] = raw[n - 1];   // arrive level with the summit, not in a cutting below it
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
    // an authored climb (the ground is fitted to it afterwards): one even grade from its junction to the top
    if (def.even) { const L = (n - 1) * 3, h0 = h[0], h1 = h[n - 1]; for (let i = 1; i < n - 1; i++) h[i] = h0 + (h1 - h0) * (i * 3) / L; }
    // light smoothing so the profile has no kinks
    for (let pass = 0; pass < 2; pass++) {
      const h2 = new Float32Array(n);
      for (let i = 0; i < n; i++) h2[i] = pin[i] ?? (h[clamp(i - 1, 0, n - 1)] + 2 * h[i] + h[clamp(i + 1, 0, n - 1)]) / 4;
      h = h2;
    }
    // unpaved roads are never billiard-table smooth: gentle undulation + washboard
    const rough = ({ asphalt: 0, haul: 0.12, gravel: 0.16, dirt: 0.22, snow: 0.22, trail: 0.32 } as Record<RoadKind, number>)[def.kind];
    if (rough > 0 && !def.fixed) for (let i = 0; i < n; i++) if (pin[i] === null) h[i] += rough * (EW_NOISE.n(i * 3 / 23 + def.id.length * 7, 1.7) + 0.4 * EW_NOISE.n(i * 3 / 7, 9.1));
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
    roads.push({ ...def, pts, h, len, bridged, raw });
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
        const e = half * (1 + 0.1 * EW_NOISE.n(x / 11, z / 11)) + 0.5 * EW_NOISE.n(x / 3, z / 3);
        const v = Math.round(255 * (1 - smoothstep(e - 1.4, e + 1.8, d)));
        if (v > roadMask[j * N + i]) { roadMask[j * N + i] = v; if (v > 100) roadKind[(j >> 1) * CTRL + (i >> 1)] = kind; }
      }
    }
  };
  for (const def of ROAD_DEFS) addRoad(def);
  // garages: outposts are sited automatically beside the road nearest their nominal spot, on whichever side (and a little
  // up or down the road) the ground sits closest to road level and clear of other roads; they face the road across a
  // level apron and get a short driveway. The hub garage keeps its hand-placed plaza.
  const samples: [number, number][] = []; roads.forEach((r, ri) => r.pts.forEach((_, i) => samples.push([ri, i])));
  const clearOf = (x: number, z: number, R: number, skip: Road | null) => { for (const r of roads) { if (r === skip) continue; for (const p of r.pts) if (Math.abs(p[0] - x) < R && Math.abs(p[1] - z) < R && Math.hypot(p[0] - x, p[1] - z) < R) return false; } return true; };
  for (const g of GARAGES) {
    const D = g.main ? 20 : 12;
    if (!g.main) {
      let bestS = 1e9, place: { x: number; z: number; yaw: number } | null = null;
      let road: Road | null = null, i0 = 0, bd = 1e9;
      for (const r of roads) { if (r.id.startsWith('ruts-') || r.id.startsWith('drive-') || r.id === 'summit-road' || r.fixed && r.id !== 'mx-track') continue; r.pts.forEach((p, i) => { if (r.bridged[i]) return; const d = Math.hypot(p[0] - g.x, p[1] - g.z); if (d < bd) { bd = d; road = r; i0 = i; } }); }
      const rd = road as Road | null;
      if (rd) {
        const off = rd.width / 2 + 4 + 26 + 7;   // the level pad (r 26, centred 7 m in front of the doors) stays clear of the road
        for (let di = -60; di <= 60; di += 6) {
          const i = clamp(i0 + di, 2, rd.pts.length - 3), p = rd.pts[i], q = rd.pts[i + 2], o = rd.pts[i - 2];
          if (rd.bridged[i]) continue;
          let tx = q[0] - o[0], tz = q[1] - o[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
          for (const side of [-1, 1]) {
            const nx = -tz * side, nz = tx * side, cx = p[0] + nx * off, cz = p[1] + nz * off;
            if (!clearOf(cx - nx * 7, cz - nz * 7, 33, null)) continue;   // the pad (centred 7 m roadward) clear of every road, this one included
            let dev = 0; for (let a = 0; a < 12; a++) for (const f of [0.4, 1]) dev += Math.abs(sampleH(data.height, cx + Math.cos(a * 0.52) * 24 * f, cz + Math.sin(a * 0.52) * 24 * f) - rd.h[i]);
            const score = dev / 24 + Math.abs(di) * 0.05;
            if (score < bestS) { bestS = score; place = { x: cx, z: cz, yaw: Math.atan2(-nx, -nz) }; }
          }
        }
      }
      if (place) Object.assign(g, place);
    }
    const fx = Math.sin(g.yaw), fz = Math.cos(g.yaw);
    const A: P2 = [g.x + fx * (D / 2 + 14), g.z + fz * (D / 2 + 14)];
    let best = 1e9, P: P2 = A, ph = 0;
    for (const r of roads) { if (r.id.startsWith('ruts-') || r.id.startsWith('drive-') || r.id === 'summit-road') continue; for (let i = 0; i < r.pts.length; i++) { if (r.bridged[i]) continue; const d = Math.hypot(r.pts[i][0] - A[0], r.pts[i][1] - A[1]); if (d < best) { best = d; P = r.pts[i]; ph = r.h[i]; } } }
    const pad: Pad = { x: g.x + fx * (g.main ? 10 : 7), z: g.z + fz * (g.main ? 10 : 7), r: g.main ? 42 : 26, h: ph + 0.15 };
    pads.push(pad);
    for (let j = Math.floor((pad.z - pad.r + HALF) / CELL); j <= Math.ceil((pad.z + pad.r + HALF) / CELL); j++) for (let i = Math.floor((pad.x - pad.r + HALF) / CELL); i <= Math.ceil((pad.x + pad.r + HALF) / CELL); i++) {
      if (i < 0 || j < 0 || i >= V || j >= V) continue;
      if (Math.hypot(-HALF + i * CELL - pad.x, -HALF + j * CELL - pad.z) <= pad.r) core[j * V + i] = pad.h;
    }
    if (best < 12) continue;
    addRoad({ id: 'drive-' + g.id, kind: g.main ? 'asphalt' : 'dirt', width: g.main ? 10 : 8, grade: 0.16, fixed: true, ctrl: [A, P] });
  }
  void samples;
  // then open up slots (never below any road's embankment, so switchback legs stay supported), and fit the Apex summit's
  // face (steeper than a fill batter) to its road
  // The summit road builds no embankments (its face is steeper than a fill batter; fitPeak shapes its shoulders)
  // (the summit road's turns are far enough apart now that it gets ordinary embankments like every other road)
  const fillLimit = earthworks(data.height, core, noFill);
  openCuttings(data.height, roads, core, noFill, fillLimit);
  benchLegs(data.height, roads, core, noFill);
  void fitPeak;   // (retired: the summit road is now traced along the natural mountain, the mountain is no longer fitted to it)
  relaxSteps(data.height, core, noFill, PEAK.x, PEAK.z, PEAK.rFace + 260, 1.25, 60);
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
