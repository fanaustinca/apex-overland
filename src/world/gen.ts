// Procedural world generation. Pure data (no DOM / three) so it runs in a Web Worker and in node tools.
import { Simplex, smoothstep, clamp, lerp } from '../core/noise';
import { NARROWS, N, V, CELL, HALF, CTRL, RIVERS, PITS, HUB, CANYON_X0, CANYON_X1, CANYON_FLOOR, CANYON_WATER, canyonZ, biomeWeights, hubFactor, type P2 } from './layout';

export const SEED = 1337;

export interface WorldData {
  height: Float32Array;      // V*V heights (2 m grid, row-major z then x)
  biome: Float32Array;       // CTRL*CTRL*4 biome weights
  water: Float32Array;       // CTRL*CTRL water surface level (NaN = dry)
  wet: Uint8Array;           // CTRL*CTRL mud / wetness 0..255
  rivers: { id: string; pts: P2[]; lvl: number[]; width: number; mud: boolean }[];
}

const sx = new Simplex(SEED), s2 = new Simplex(SEED + 7), s3 = new Simplex(SEED + 21);

function terrace(t: number, steps: number, sharp = 0.3): number {
  const s = t * steps, i = Math.floor(s), f = s - i;
  return (i + smoothstep(0.5 - sharp, 0.5 + sharp, f)) / steps;
}

export function desertH(x: number, z: number): number {
  let h = 36 + 5 * sx.fbm(x / 520, z / 520, 4);
  const field = smoothstep(0.0, 0.35, s2.fbm(x / 900 + 5, z / 900 - 2, 3));
  const u = (x * 0.83 + z * 0.55) / 44 + 2.4 * s2.fbm(x / 280, z / 280, 3);
  const dune = Math.pow(1 - Math.abs(Math.sin(u)), 2.2);
  h += field * (dune * 13 + 2.5 * s3.fbm(x / 60, z / 60, 2));
  const m = s3.fbm(x / 460 + 11, z / 460 - 3, 4);
  const plate = smoothstep(0.28, 0.33, m);
  if (plate > 0) h += plate * (34 + 22 * terrace(clamp((m - 0.28) * 4, 0, 1), 3, 0.2)) * (1 - field * 0.6);
  return h;
}
export function forestH(x: number, z: number): number {
  return 34 + 42 * sx.fbm(x / 820 + 3, z / 820 + 1, 5) + 9 * s2.ridged(x / 260, z / 260, 4) + 2.5 * s3.fbm(x / 50, z / 50, 2);
}
export const APEX = { x: -150, z: -1560, h: 500 };
export function snowH(x: number, z: number): number {
  const m = smoothstep(80, 1400, -z);
  const base = 50 + m * 70 + 10 * sx.fbm(x / 300, z / 300, 4);
  // Mount Apex: a broad massif whose smooth south face carries the switchbacks
  const dm = Math.hypot(x - APEX.x, (z - APEX.z) * 1.15);
  const cone = Math.max(0, 1 - Math.max(dm, 55) / 1150);
  const rug = s3.ridged(x / 380, z / 380, 6);
  const massif = APEX.h * Math.pow(cone, 1.45) * (0.8 + 0.34 * rug * smoothstep(0.05, 0.5, 1 - cone) * (1 - 0.7 * (1 - smoothstep(200, 420, Math.abs(x + 40))) * smoothstep(-1500, -1300, z)));
  // Glacier Ridge running east from the summit
  const ax = APEX.x, az = APEX.z, bx = 1150, bz = -1320;
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  let u = ((x - ax) * dx + (z - az) * dz) / L2; u = clamp(u, 0, 1);
  const dr = Math.hypot(ax + dx * u - x, az + dz * u - z);
  const ridge = (330 - 120 * u) * Math.pow(Math.max(0, 1 - dr / 300), 1.3) * (0.9 + 0.15 * s2.fbm(x / 150, z / 150, 3));
  // jagged background ranges, flattened along the switchback corridor on the south face
  const corridor = (1 - smoothstep(260, 520, Math.abs(x + 40))) * (1 - smoothstep(-1250, -1150, -z - 0) * 0) ;
  const r = Math.pow(s2.ridged(x / 760 - 4, z / 760 + 2, 6), 1.25);
  const ranges = r * (40 + 330 * m * m) * (1 - 0.85 * corridor * smoothstep(-1500, -1350, z));
  const k = 60; // smooth max
  const smax = (a: number, b: number) => { const hh = clamp(0.5 + 0.5 * (a - b) / k, 0, 1); return lerp(b, a, hh) + k * hh * (1 - hh) * 0.5; };
  return base + smax(smax(massif, ridge), ranges);
}
export function quarryH(x: number, z: number): number {
  return 46 + 7 * sx.fbm(x / 420 - 7, z / 420, 4) + 1.5 * s3.fbm(x / 40, z / 40, 2);
}

/** Base terrain before roads: biome blend, hub valley, canyon, pits, rivers, border mountains. */
export function generateBase(): WorldData {
  const height = new Float32Array(V * V);
  const w = [0, 0, 0, 0];
  for (let j = 0; j < V; j++) {
    const z = -HALF + j * CELL;
    for (let i = 0; i < V; i++) {
      const x = -HALF + i * CELL;
      const warp = sx.fbm(x / 1100 + 40, z / 1100 - 40, 3);
      biomeWeights(x, z, warp, w);
      let h = 0;
      if (w[0] > 0.002) h += w[0] * desertH(x, z);
      if (w[1] > 0.002) h += w[1] * forestH(x, z);
      if (w[2] > 0.002) h += w[2] * snowH(x, z);
      if (w[3] > 0.002) h += w[3] * quarryH(x, z);
      h /= (w[0] > 0.002 ? w[0] : 0) + (w[1] > 0.002 ? w[1] : 0) + (w[2] > 0.002 ? w[2] : 0) + (w[3] > 0.002 ? w[3] : 0);
      // hub valley
      const hf = hubFactor(x, z);
      if (hf > 0) h = lerp(h, HUB.h + 1.2 * s3.fbm(x / 90, z / 90, 2), hf);
      // canyon
      if (x > CANYON_X0 - 50 && x < CANYON_X1 + 50) {
        const cz = canyonZ(x), dcz = (canyonZ(x + 1) - canyonZ(x - 1)) / 2;
        const d = Math.abs(z - cz) / Math.sqrt(1 + dcz * dcz);
        const n = s2.fbm(x / 140, 3.3, 2);
        const nar = 1 - 0.68 * (Math.exp(-(((x - NARROWS[0]) / 70) ** 2)) + Math.exp(-(((x - NARROWS[1]) / 70) ** 2)));
        const half = (30 + 9 * n) * nar, wall = (44 + 14 * s3.fbm(x / 170, 9.1, 2)) * (0.35 + 0.65 * nar);
        if (d < half + wall) {
          const taper = smoothstep(CANYON_X0, CANYON_X0 + 260, x) * (1 - smoothstep(CANYON_X1 - 260, CANYON_X1, x));
          let floor = CANYON_FLOOR + 0.6 + 0.4 * s3.fbm(x / 30, z / 30, 2);
          const ch = Math.abs(z - cz) / 10;
          if (ch < 1) floor = Math.min(floor, CANYON_WATER - 0.55 + ch * ch * 0.55);
          let target: number;
          if (d < half) target = floor;
          else {
            const t = (d - half) / wall;
            const pr = 0.55 * terrace(t, 4, 0.18) + 0.45 * Math.pow(t, 0.7);
            target = lerp(floor, h, pr);
          }
          const carved = lerp(h, target, taper);
          if (carved < h) h = carved;
        }
      }
      // quarry pits
      for (const p of PITS) {
        const dx = x - p.x, dz = z - p.z, d0 = Math.hypot(dx, dz);
        if (d0 > p.r + 40) continue;
        const d = d0 * (1 + 0.06 * sx.n(dx / d0 * 2 + p.x, dz / (d0 + 1e-3) * 2));
        if (d < p.r) {
          const into = (p.r - d) / p.tierW;
          const k = Math.min(Math.floor(into), p.tiers - 1);
          const f = into - Math.floor(into);
          const depth = into >= p.tiers ? p.tiers * p.tierH : p.tierH * (k + smoothstep(0.0, 0.32, f));
          h = Math.min(h, quarryH(p.x + dx * 0.0, p.z) - depth + 0.4 * s3.fbm(x / 20, z / 20, 2));
        }
      }
      // world border mountains
      const e = smoothstep(1650, 2048, Math.max(Math.abs(x), Math.abs(z)));
      if (e > 0) h += e * e * (150 + 90 * s2.fbm(x / 420, z / 420, 4)) + e * 25 * s3.ridged(x / 160, z / 160, 3);
      height[j * V + i] = h;
    }
  }
  erode(height);
  const data: WorldData = { height, biome: new Float32Array(CTRL * CTRL * 4), water: new Float32Array(CTRL * CTRL).fill(NaN), wet: new Uint8Array(CTRL * CTRL), rivers: [] };
  carveRivers(data);
  return data;
}

/** Thermal slope limiting on mountains: knife-edge noise ridges relax to natural ~50 degree talus. */
function erode(h: Float32Array) {
  const mask = new Uint8Array(V * V);
  const w = [0, 0, 0, 0];
  for (let j = 0; j < V; j += 1) for (let i = 0; i < V; i += 1) {
    const x = -HALF + i * CELL, z = -HALF + j * CELL;
    biomeWeights(x, z, 0, w);
    const edge = Math.max(Math.abs(x), Math.abs(z)) > 1600;
    mask[j * V + i] = w[2] > 0.25 || edge ? 1 : 0;
  }
  const T = CELL * Math.tan(50 * Math.PI / 180);
  for (let it = 0; it < 14; it++) {
    for (let j = 1; j < V - 1; j++) for (let i = 1; i < V - 1; i++) {
      const k = j * V + i;
      if (!mask[k]) continue;
      const hk = h[k];
      for (const n of [k - 1, k + 1, k - V, k + V]) {
        const d = hk - h[n];
        if (d > T) { const m = (d - T) * 0.25; h[k] -= m; h[n] += m; }
      }
    }
  }
}

export function sampleH(height: Float32Array, x: number, z: number): number {
  const fx = clamp((x + HALF) / CELL, 0, N - 1e-4), fz = clamp((z + HALF) / CELL, 0, N - 1e-4);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const a = height[j * V + i], b = height[j * V + i + 1], c = height[(j + 1) * V + i], d = height[(j + 1) * V + i + 1];
  // match Rapier's heightfield triangulation (diagonal from (i+1,j) to (i,j+1))
  return u + v < 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

/** Resample a polyline at a fixed spacing. */
export function resample(pts: P2[], step: number): P2[] {
  const out: P2[] = [pts[0]];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    let t = step - carry;
    while (t <= L) { out.push([ax + (bx - ax) * t / L, az + (bz - az) * t / L]); t += step; }
    carry = L - (t - step);
  }
  const last = pts[pts.length - 1];
  if (Math.hypot(out[out.length - 1][0] - last[0], out[out.length - 1][1] - last[1]) > step * 0.3) out.push(last);
  return out;
}

/** Catmull-Rom smoothing of control points, then resample. */
export function spline(ctrl: P2[], step: number): P2[] {
  if (ctrl.length < 3) return resample(ctrl, step);
  const dense: P2[] = [];
  const P = (k: number) => ctrl[clamp(k, 0, ctrl.length - 1)];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const segs = Math.max(4, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 3));
    for (let s = 0; s < segs; s++) {
      const t = s / segs, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  dense.push(ctrl[ctrl.length - 1]);
  return resample(dense, step);
}

function carveRivers(data: WorldData) {
  const { height } = data;
  for (const r of RIVERS) {
    const pts = spline(r.pts, 4);
    const n = pts.length;
    const lvl = new Float32Array(n);
    // water level: monotone downstream, a little below the local ground
    let run = 1e9;
    for (let i = 0; i < n; i++) {
      let m = 1e9;
      for (let k = -3; k <= 3; k++) { const p = pts[clamp(i + k, 0, n - 1)]; m = Math.min(m, sampleH(height, p[0], p[1])); }
      run = Math.min(run, m - 1.6);
      lvl[i] = run;
    }
    // ease the steps so the surface reads as a flowing slope
    for (let pass = 0; pass < 6; pass++) for (let i = 1; i < n - 1; i++) lvl[i] = Math.min(lvl[i], (lvl[i - 1] + lvl[i] + lvl[i + 1]) / 3 + 0.02);
    data.rivers.push({ id: r.id, pts, lvl: Array.from(lvl), width: r.width, mud: r.mud });
    const half = r.width / 2, bank = 16;
    carveAlong(data, pts, (i, u) => lvl[i] + (lvl[Math.min(i + 1, n - 1)] - lvl[i]) * u, half, bank, (d, t, level) => {
      const deep = r.depth * (1 + 0.75 * Math.max(0, Math.sin(t / 85 + 1)));
      if (d < half) return level - deep * (1 - (d / half) ** 2) - 0.15;
      return null;
    }, true, r.mud);
  }
  // canyon river: flat-ish level on the canyon floor
  { const pts: P2[] = []; for (let x = CANYON_X0 + 200; x <= CANYON_X1 - 200; x += 6) pts.push([x, canyonZ(x)]); data.rivers.push({ id: 'canyon', pts, lvl: pts.map(() => CANYON_WATER), width: 20, mud: false }); }
  for (let x = CANYON_X0 + 200; x <= CANYON_X1 - 200; x += 4) {
    const cz = canyonZ(x);
    for (let dz = -10; dz <= 10; dz += 4) {
      const ci = Math.round((x + HALF) / 4), cj = Math.round((cz + dz + HALF) / 4);
      if (ci >= 0 && cj >= 0 && ci < CTRL && cj < CTRL) { data.water[cj * CTRL + ci] = CANYON_WATER; data.wet[cj * CTRL + ci] = 200; }
    }
  }
}

/**
 * Carve a profile along a resampled polyline. profile(d, t, centreH) returns a target height or null for the
 * shoulder blend. Cells beyond `half` blend back to the terrain over `bank` metres.
 */
export function carveAlong(data: WorldData, pts: P2[], centre: (i: number, u: number) => number, half: number, bank: number,
  profile: (d: number, t: number, c: number) => number | null, water = false, mud = false, onlyLower = false) {
  const { height } = data;
  const reach = half + bank;
  // accumulate per cell the nearest-sample distance so overlapping segments resolve cleanly
  const n = pts.length;
  const cum = new Float32Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9;
  for (const p of pts) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); }
  const i0 = Math.max(0, Math.floor((minX - reach + HALF) / CELL)), i1 = Math.min(N, Math.ceil((maxX + reach + HALF) / CELL));
  const j0 = Math.max(0, Math.floor((minZ - reach + HALF) / CELL)), j1 = Math.min(N, Math.ceil((maxZ + reach + HALF) / CELL));
  const W = i1 - i0 + 1, H = j1 - j0 + 1;
  const bestD = new Float32Array(W * H).fill(1e9), bestT = new Float32Array(W * H), bestC = new Float32Array(W * H);
  for (let s = 0; s < n - 1; s++) {
    const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    const ci0 = Math.max(i0, Math.floor((Math.min(ax, bx) - reach + HALF) / CELL)), ci1 = Math.min(i1, Math.ceil((Math.max(ax, bx) + reach + HALF) / CELL));
    const cj0 = Math.max(j0, Math.floor((Math.min(az, bz) - reach + HALF) / CELL)), cj1 = Math.min(j1, Math.ceil((Math.max(az, bz) + reach + HALF) / CELL));
    for (let j = cj0; j <= cj1; j++) {
      const z = -HALF + j * CELL;
      for (let i = ci0; i <= ci1; i++) {
        const x = -HALF + i * CELL;
        let u = ((x - ax) * dx + (z - az) * dz) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u;
        const qx = ax + dx * u - x, qz = az + dz * u - z, d = Math.sqrt(qx * qx + qz * qz);
        const k = (j - j0) * W + (i - i0);
        if (d < bestD[k]) { bestD[k] = d; bestT[k] = cum[s] + u * (cum[s + 1] - cum[s]); bestC[k] = centre(s, u); }
      }
    }
  }
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = (j - j0) * W + (i - i0), d = bestD[k];
    if (d > reach) continue;
    const idx = j * V + i, h0 = height[idx];
    const tgt = profile(d, bestT[k], bestC[k]);
    let h: number;
    if (tgt !== null) h = tgt;
    else {
      const edge = profile(half - 1e-3, bestT[k], bestC[k]) ?? bestC[k];
      const t = smoothstep(0, 1, (d - half) / bank);
      h = lerp(water ? Math.max(edge, bestC[k] + 0.4) : edge, h0, t);
    }
    height[idx] = onlyLower ? Math.min(h0, h) : h;
    if (water || mud) {
      const ci = i >> 1, cj = j >> 1;
      if (ci < CTRL && cj < CTRL) {
        if (water && d < half + 1) data.water[cj * CTRL + ci] = bestC[k];
        if (mud) data.wet[cj * CTRL + ci] = Math.max(data.wet[cj * CTRL + ci], Math.round(255 * (1 - smoothstep(half * 0.6, half + bank * 0.9, d))));
      }
    }
  }
}
