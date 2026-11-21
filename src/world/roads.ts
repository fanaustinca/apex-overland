// Road network: authored control points, splined, graded (max slope) and carved into the heightmap.
import { canyonZ, BRIDGES_X, NARROWS, PITS, HALF, CELL, N, V, CTRL, type P2 } from './layout';
import { spline, sampleH, carveAlong, type WorldData, APEX } from './gen';
import { clamp, smoothstep } from '../core/noise';

export type RoadKind = 'asphalt' | 'dirt' | 'gravel' | 'snow' | 'trail' | 'haul';
export interface RoadDef { id: string; kind: RoadKind; width: number; ctrl: P2[]; grade: number; bank?: number }
export interface Road extends RoadDef { pts: P2[]; h: Float32Array; len: number }

/** Bridge spans: deck from rim to rim (the canyon below is not carved). */
export interface Bridge { id: string; style: 'truss' | 'trestle' | 'arch'; a: P2; b: P2; width: number; ha: number; hb: number }

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
  { id: 'quarry', name: 'Quarry Shack', biome: 3, x: -1640, z: -640, yaw: 0.6, prize: 'Snake Module 1 — Front Cab & Engine', from: [-860, -420] as P2, via: [[-1060, -470], [-1300, -560], [-1500, -600]] as P2[] },
  { id: 'forest', name: 'Forest Cabin', biome: 1, x: 1660, z: -720, yaw: -0.4, prize: 'Snake Module 2 — Middle Articulated 4x4', from: [955, -620] as P2, via: [[1120, -700], [1330, -760], [1520, -735]] as P2[] },
  { id: 'desert', name: 'Desert Adobe', biome: 0, x: -1560, z: 1560, yaw: 2.2, prize: 'Snake Module 3 — Rear Articulated 4x4', from: [-1010, 1625] as P2, via: [[-1180, 1540], [-1330, 1470], [-1470, 1500]] as P2[] },
  { id: 'snow', name: 'Snowy Mountain Outpost', biome: 2, x: 560, z: -1690, yaw: 0.2, prize: 'The Master Assembly Blueprint', from: [450, -1442] as P2, via: [[470, -1520], [520, -1600]] as P2[] },
];

export const ROAD_DEFS: RoadDef[] = [
  // hub spokes
  { id: 'hub-south', kind: 'asphalt', width: 11, grade: 0.09, ctrl: [[0, 40], [30, 300], [-30, 560], [60, 820], [150, 1000], bN(BRIDGES_X[1])] },
  { id: 'south-desert', kind: 'asphalt', width: 11, grade: 0.09, ctrl: [bS(BRIDGES_X[1]), [190, 1420], [140, 1640], [60, 1820]] },
  { id: 'hub-east', kind: 'dirt', width: 9, grade: 0.12, ctrl: [[40, 0], [300, -40], [520, 60], [720, -30], [900, 40], [1080, -70], [1230, -150], [1420, -210], [1650, -120], [1800, 100]] },
  { id: 'hub-west', kind: 'haul', width: 15, grade: 0.08, ctrl: [[-40, 0], [-300, 20], [-560, -20], [-820, -60], [PITS[0].x + PITS[0].r + 10, PITS[0].z + 30]] },
  { id: 'hub-north', kind: 'snow', width: 8, grade: 0.12, ctrl: [[0, -40], ...switchbacks()] },
  // forest
  { id: 'forest-loop', kind: 'dirt', width: 8, grade: 0.13, ctrl: [[720, -30], [800, 250], [1000, 420], [1260, 380], [1520, 300], [1700, 500], [1650, 800], [1400, 900], [1100, 800], [800, 620], [500, 400], [260, 160], [60, 30]] },
  { id: 'forest-north', kind: 'dirt', width: 8, grade: 0.14, ctrl: [[900, 40], [860, -300], [960, -600], [860, -900], [700, -1080], [520, -1200]] },
  { id: 'timber-trail', kind: 'trail', width: 6, grade: 0.16, ctrl: [[1080, -70], [1300, 120], [1350, 520], [1500, 700], [1800, 650], [1880, 900], [1760, 1180]] },
  // desert
  { id: 'desert-west', kind: 'dirt', width: 8, grade: 0.12, ctrl: [[-30, 560], [-350, 780], [-640, 900], bN(BRIDGES_X[0])] },
  { id: 'desert-west-s', kind: 'dirt', width: 8, grade: 0.12, ctrl: [bS(BRIDGES_X[0]), [-820, 1450], [-1000, 1620], [-1250, 1700]] },
  { id: 'desert-east', kind: 'dirt', width: 9, grade: 0.12, ctrl: [[60, 820], [480, 870], [760, 900], bN(BRIDGES_X[2])] },
  { id: 'desert-east-s', kind: 'dirt', width: 9, grade: 0.12, ctrl: [bS(BRIDGES_X[2]), [1080, 1380], [1250, 1600], [1350, 1760]] },
  { id: 'canyon-floor', kind: 'trail', width: 7, grade: 0.2, bank: 4, ctrl: [...Array.from({ length: 33 }, (_, i) => -1150 + i * 40).map((x) => [x, cz(x) + 7 * Math.sin(x / 75)] as P2), [200, cz(200) + 6]] },
  { id: 'cliff-trail', kind: 'trail', width: 7, grade: 0.15, bank: 5, ctrl: [[200, cz(200) + 6], [250, cz(250) + 24], [330, cz(330) + 42], [430, cz(430) + 60], [520, cz(520) + 86], [600, cz(600) + 130]] },
  { id: 'canyon-entry', kind: 'trail', width: 7, grade: 0.16, bank: 6, ctrl: [[-1400, 900], [-1300, 1000], [-1150, cz(-1150)]] },
  // quarry
  { id: 'pitA-spiral', kind: 'haul', width: 14, grade: 0.1, ctrl: spiral(PITS[0], 0.25, 1.15) },
  { id: 'pitB-road', kind: 'haul', width: 13, grade: 0.09, ctrl: [[-560, -20], [-700, 250], [-820, 430], [PITS[1].x + PITS[1].r - 5, PITS[1].z - 40]] },
  { id: 'pitB-spiral', kind: 'haul', width: 12, grade: 0.1, ctrl: spiral(PITS[1], -0.19, 0.95) },
  { id: 'peak-descent', kind: 'snow', width: 7, grade: 0.18, ctrl: [[APEX.x + 30, APEX.z + 175], [-250, -1440], [-430, -1405], ...hairpins(-440, -690, -440, -1330, 95, 5)] },
  { id: 'quarry-north', kind: 'gravel', width: 10, grade: 0.17, ctrl: [[-820, -60], [-860, -400], [-780, -700], [-720, -900], [-694, -950]] },
  { id: 'haul-south', kind: 'haul', width: 14, grade: 0.09, ctrl: [[-852, 540], [-875, 700], [-1000, 795], [-1180, 795], [-1260, 830], [-1400, 980], [-1300, 1000]] },
  // mountain
  ...CABINS.map((c) => ({ id: 'ruts-' + c.id, kind: 'trail' as RoadKind, width: 2.8, grade: 0.3, bank: 3, ctrl: [c.from, ...c.via, [c.x + Math.sin(c.yaw) * 12, c.z + Math.cos(c.yaw) * 12] as P2] })),
  { id: 'glacier-ridge', kind: 'snow', width: 7, grade: 0.19, ctrl: [[APEX.x + 30, APEX.z + 175], [150, -1420], [450, -1440], [750, -1390], [1000, -1330], [1080, -1180], [960, -1010], [870, -915]] },
];

export const RAMPS: { x: number; z: number; dir: number; h: number; len: number; w: number }[] = [
  // rock ramps on the north rim facing south across the canyon narrows
  ...NARROWS.map((x) => ({ x, z: cz(x) - 34, dir: Math.PI / 2, h: 6, len: 30, w: 12 })),
];

export function buildRoads(data: WorldData): { roads: Road[]; bridges: Bridge[]; roadMask: Uint8Array; roadKind: Uint8Array } {
  const roads: Road[] = [];
  const roadMask = new Uint8Array(N * N);
  const roadKind = new Uint8Array(CTRL * CTRL);
  const KIND: RoadKind[] = ['asphalt', 'dirt', 'gravel', 'snow', 'trail', 'haul'];
  // bridge deck heights come from the rims before any carving
  const bridges: Bridge[] = BRIDGE_DEFS.map((b) => {
    const a = bN(b.x), c = bS(b.x);
    return { id: b.id, style: b.style, a, b: c, width: b.width, ha: sampleH(data.height, a[0], a[1]) + 0.5, hb: sampleH(data.height, c[0], c[1]) + 0.5 };
  });
  for (const def of ROAD_DEFS) {
    const pts = spline(def.ctrl, 3);
    const n = pts.length;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = sampleH(data.height, pts[i][0], pts[i][1]);
    // pin bridge ends
    const pin: (number | null)[] = new Array(n).fill(null);
    // a road that starts or ends on an already-built road is graded to meet it
    for (const [idx, p] of [[0, pts[0]], [n - 1, pts[n - 1]]] as [number, P2][]) {
      let best = 10, bh: number | null = null;
      for (const rd of roads) for (let k = 0; k < rd.pts.length; k += 1) { const d = Math.hypot(rd.pts[k][0] - p[0], rd.pts[k][1] - p[1]); if (d < best) { best = d; bh = rd.h[k]; } }
      if (bh !== null) pin[idx] = bh;
    }
    for (const b of bridges) for (const [e, h] of [[b.a, b.ha], [b.b, b.hb]] as [P2, number][]) {
      if (Math.hypot(pts[0][0] - e[0], pts[0][1] - e[1]) < 4) pin[0] = h;
      if (Math.hypot(pts[n - 1][0] - e[0], pts[n - 1][1] - e[1]) < 4) pin[n - 1] = h;
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
    const h2 = new Float32Array(n);
    for (let i = 0; i < n; i++) h2[i] = pin[i] ?? (h[clamp(i - 1, 0, n - 1)] + 2 * h[i] + h[clamp(i + 1, 0, n - 1)]) / 4;
    h = h2;
    let len = 0; for (let i = 1; i < n; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const half = def.width / 2;
    carveAlong(data, pts, (i, u) => h[i] + (h[Math.min(i + 1, n - 1)] - h[i]) * u, half + 1.2, def.bank ?? 9, (d, _t, c) => (d < half + 1.2 ? c + 0.12 * (1 - (d / (half + 1.2)) ** 2) : null));
    roads.push({ ...def, pts, h, len });
    // texture mask (2 m) + kind (4 m)
    const kind = KIND.indexOf(def.kind) + 1;
    for (let s = 0; s < n - 1; s++) {
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
  }
  // blend junctions: where independently graded roads meet, relax the heights over the road + shoulder cells
  {
    const H = data.height, mask = new Uint8Array(V * V);
    for (let j = 1; j < N; j++) for (let i = 1; i < N; i++) {
      let m = 0;
      for (let dj = -4; dj <= 4 && !m; dj += 2) for (let di = -4; di <= 4; di += 2) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < N && jj < N && roadMask[jj * N + ii] > 30) { m = 1; break; } }
      mask[j * V + i] = m;
    }
    const tmp = new Float32Array(H.length);
    for (let it = 0; it < 6; it++) {
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
