// Procedural world generation. Pure data (no DOM / three) so it runs in a Web Worker and in node tools.
import { Simplex, smoothstep, clamp, lerp } from '../core/noise';
import { WORLD, OFFROAD, PASSES, LAKES, type River, NARROWS, N, V, CELL, HALF, CTRL, RIVERS, PITS, HUB, CANYON_X0, CANYON_X1, CANYON_FLOOR, CANYON_WATER, canyonZ, biomeWeights, hubFactor, LANDMARKS, PEAK, type Landmark, type P2 } from './layout';

export const SEED = 1337;

export interface WorldData {
  height: Float32Array;      // V*V heights (2 m grid, row-major z then x)
  biome: Float32Array;       // CTRL*CTRL*4 biome weights
  water: Float32Array;       // CTRL*CTRL water surface level (NaN = dry)
  wet: Uint8Array;           // CTRL*CTRL mud / wetness 0..255
  rivers: { id: string; pts: P2[]; lvl: number[]; width: number; mud: boolean; depth?: number }[];
}

const sx = new Simplex(SEED), s2 = new Simplex(SEED + 7), s3 = new Simplex(SEED + 21);

function terrace(t: number, steps: number, sharp = 0.3): number {
  const s = t * steps, i = Math.floor(s), f = s - i;
  return (i + smoothstep(0.5 - sharp, 0.5 + sharp, f)) / steps;
}

// corridor mask (8 m grid, blurred) along the off-road race lines: mesas give way to passes there
const CM = WORLD / 8;
let corridor: Float32Array | null = null;
function buildCorridor() {
  const m = new Float32Array(CM * CM);
  for (const lines of Object.values(OFFROAD)) for (const line of lines) for (let k = 0; k < line.length - 1; k++) {
    const [ax, az] = line[k], [bx, bz] = line[k + 1], L = Math.hypot(bx - ax, bz - az);
    for (let t = 0; t <= L; t += 4) { const x = ax + (bx - ax) * t / L, z = az + (bz - az) * t / L; const i = Math.floor((x + HALF) / 8), j = Math.floor((z + HALF) / 8); if (i >= 0 && j >= 0 && i < CM && j < CM) m[j * CM + i] = 1; }
  }
  // dilate (±40 m flat) then blur, so the pass is ~90 m wide with soft shoulders
  for (let pass = 0; pass < 5; pass++) {
    const src = m.slice();
    for (let j = 1; j < CM - 1; j++) for (let i = 1; i < CM - 1; i++) { const k = j * CM + i; m[k] = Math.max(src[k], src[k - 1], src[k + 1], src[k - CM], src[k + CM]); }
  }
  for (let pass = 0; pass < 3; pass++) {
    const src = m.slice();
    for (let j = 1; j < CM - 1; j++) for (let i = 1; i < CM - 1; i++) { const k = j * CM + i; m[k] = (src[k] * 2 + src[k - 1] + src[k + 1] + src[k - CM] + src[k + CM]) / 6; }
  }
  return m;
}
function corridorAt(x: number, z: number) {
  corridor ??= buildCorridor();
  const fx = (x + HALF) / 8 - 0.5, fz = (z + HALF) / 8 - 0.5, i = Math.max(0, Math.min(CM - 2, Math.floor(fx))), j = Math.max(0, Math.min(CM - 2, Math.floor(fz))), u = fx - i, v = fz - j;
  const c = corridor;
  return Math.min(1, (c[j * CM + i] * (1 - u) + c[j * CM + i + 1] * u) * (1 - v) + (c[(j + 1) * CM + i] * (1 - u) + c[(j + 1) * CM + i + 1] * u) * v);
}

export function desertH(x: number, z: number): number {
  let h = 36 + 5 * sx.fbm(x / 520, z / 520, 4);
  const field = smoothstep(0.0, 0.35, s2.fbm(x / 900 + 5, z / 900 - 2, 3));
  const u = (x * 0.83 + z * 0.55) / 44 + 2.4 * s2.fbm(x / 280, z / 280, 3);
  const dune = 0.5 + 0.5 * Math.sin(u + 0.55 * Math.sin(u));   // rounded, slightly skewed rollers (no knife crests)
  h += field * (dune * 13 + 2.5 * s3.fbm(x / 60, z / 60, 2));
  const m = s3.fbm(x / 460 + 11, z / 460 - 3, 4);
  const plate = smoothstep(0.28, 0.33, m) * (1 - corridorAt(x, z));
  if (plate > 0) h += plate * (34 + 22 * terrace(clamp((m - 0.28) * 4, 0, 1), 3, 0.2)) * (1 - field * 0.6);
  return h;
}
export function forestH(x: number, z: number): number {
  return 34 + 42 * sx.fbm(x / 820 + 3, z / 820 + 1, 5) + 9 * s2.ridged(x / 260, z / 260, 4) + 2.5 * s3.fbm(x / 50, z / 50, 2);
}
export const APEX = { x: -150, z: -1560, h: 500 };
/** Ridged multifractal like Simplex.ridged, but each octave's crest is rounded (smoothed |n|): mountain ridges with
 *  drivable shoulders instead of knife edges. `round` widens the rounding (fine octaves stay crisp-ish). */
function softRidge(nz: typeof s2, x: number, z: number, oct: number, round = 0.12): number {
  let a = 1, f = 1, s = 0, norm = 0, w = 1;
  for (let o = 0; o < oct; o++) {
    const n = nz.n(x * f + o * 31.7, z * f + o * 7.7), r = round / (1 + o);
    let v = 1 - Math.sqrt(n * n + r * r) + r;
    v *= v; v *= w; w = Math.min(1, v * 1.6);
    s += v * a; norm += a; a *= 0.5; f *= 2.1;
  }
  return s / norm;
}
export function snowH(x: number, z: number): number {
  const m = smoothstep(80, 1400, -z);
  const base = 50 + m * 70 + 10 * sx.fbm(x / 300, z / 300, 4);
  // Mount Apex: a broad massif whose smooth south face carries the switchbacks
  const dm = Math.hypot(x - APEX.x, (z - APEX.z) * 1.15);
  const cone = Math.max(0, 1 - Math.max(dm, 55) / 1150);
  const rug = softRidge(s3, x / 460, z / 460, 4);
  let massif = APEX.h * Math.pow(cone, 1.45) * (0.86 + 0.26 * rug * smoothstep(0.05, 0.5, 1 - cone));
  // the summit pyramid: a steep rock horn above the summit station
  const dp = Math.hypot(x - APEX.x, (z - APEX.z - 40) * 1.1);
  massif += 270 * Math.pow(Math.max(0, 1 - dp / 430), 1.7) * (0.85 + 0.3 * s2.ridged(x / 160, z / 160, 4));
  // Glacier Ridge running east from the summit
  const ax = APEX.x, az = APEX.z, bx = 1150, bz = -1320;
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  let u = ((x - ax) * dx + (z - az) * dz) / L2; u = clamp(u, 0, 1);
  const dr = Math.hypot(ax + dx * u - x, az + dz * u - z);
  // (its east end tapers into a long spur that runs down into the forest, instead of stopping in a 200 m cliff)
  const ridge = (330 - 120 * u) * (1 - 0.82 * smoothstep(0.45, 1, u)) * Math.pow(Math.max(0, 1 - dr / 300), 1.3) * (0.9 + 0.15 * s2.fbm(x / 150, z / 150, 3));
  // jagged background ranges, flattened along the switchback corridor on the south face
  const corridor = (1 - smoothstep(260, 520, Math.abs(x + 40))) * (1 - smoothstep(-1250, -1150, -z - 0) * 0) ;
  // broad ranges with rounded shoulders (few octaves: big landforms, drivable flanks), a little fine rock on top
  const r = Math.pow(softRidge(s2, x / 1250 - 4, z / 1250 + 2, 4, 0.2), 1.4);
  // ...that die down toward the forest / quarry seams (deep inside the north they stand tall), so the mountains roll down
  // into the neighbouring biomes instead of ending in a kilometre-long scarp
  const warp = sx.fbm(x / 1100 + 40, z / 1100 - 40, 3), wx = x + warp * 160, wz = z - warp * 140;   // as biomeWeights
  const deep = 0.1 + 0.9 * smoothstep(0, 800, -wz - Math.abs(wx));
  const ranges = (r * (30 + 250 * m * m) + 2.5 * m * s3.fbm(x / 70, z / 70, 3)) * deep * (1 - 0.5 * corridor * smoothstep(-1500, -1350, z));
  const k = 60; // smooth max
  const smax = (a: number, b: number) => { const hh = clamp(0.5 + 0.5 * (a - b) / k, 0, 1); return lerp(b, a, hh) + k * hh * (1 - hh) * 0.5; };
  return base + smax(smax(massif, ridge), ranges);
}
export function quarryH(x: number, z: number): number {
  return 46 + 7 * sx.fbm(x / 420 - 7, z / 420, 4) + 1.5 * s3.fbm(x / 40, z / 40, 2);
}

/** Base terrain before roads: biome blend, hub valley, canyon, pits, rivers, border mountains. */
export function generateBase(rows?: Float32Array): WorldData {
  const height = rows ?? baseRows(0, V);
  erode(height);
  const data: WorldData = { height, biome: new Float32Array(0), water: new Float32Array(CTRL * CTRL).fill(NaN), wet: new Uint8Array(CTRL * CTRL), rivers: [] };
  carveValleys(data);
  return data;
}

/** Raw noise terrain for rows j0..j1-1 (pure function of position, so it can run on several workers at once). */
export function baseRows(j0: number, j1: number): Float32Array {
  const height = new Float32Array((j1 - j0) * V);
  const w = [0, 0, 0, 0];
  for (let j = j0; j < j1; j++) {
    const z = -HALF + j * CELL;
    for (let i = 0; i < V; i++) {
      const x = -HALF + i * CELL;
      let h = biomeH(x, z, w);
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
          if (ch < 1.4) floor = Math.min(floor, CANYON_WATER - 0.6 + Math.min(1, ch * ch) * 0.9);
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
      { const dx = x - PEAK.x, dz = z - PEAK.z; if (dx * dx + dz * dz < (PEAK.rFace * 1.12) ** 2) h = peakH(x, z, h); }
      for (const l of LANDMARKS) { const dx = x - l.x, dz = z - l.z; if (dx * dx + dz * dz < (l.r + 220) ** 2) h = landmarkH(l, x, z, h); }
      // world border mountains
      const e = smoothstep(HALF - 420, HALF, Math.max(Math.abs(x), Math.abs(z)));
      if (e > 0) h += e * e * (150 + 90 * s2.fbm(x / 420, z / 420, 4)) + e * 25 * s3.ridged(x / 160, z / 160, 3);
      height[(j - j0) * V + i] = h;
    }
  }
  return height;
}

/** Biome-blended noise terrain (before the hand-placed features). */
function biomeH(x: number, z: number, w: number[] | Float32Array = [0, 0, 0, 0]): number {
  const warp = sx.fbm(x / 1100 + 40, z / 1100 - 40, 3);
  biomeWeights(x, z, warp, w);
  let h = 0;
  if (w[0] > 0.002) h += w[0] * desertH(x, z);
  if (w[1] > 0.002) h += w[1] * forestH(x, z);
  if (w[2] > 0.002) h += w[2] * snowH(x, z);
  if (w[3] > 0.002) h += w[3] * quarryH(x, z);
  return h / ((w[0] > 0.002 ? w[0] : 0) + (w[1] > 0.002 ? w[1] : 0) + (w[2] > 0.002 ? w[2] : 0) + (w[3] > 0.002 ? w[3] : 0));
}
const lmBase = new Map<string, number>();
/** Ground level a landmark is built at (the smoothed natural terrain around its centre). */
export function landmarkLevel(l: Landmark): number {
  let v = lmBase.get(l.id);
  if (v === undefined) { v = 0; let n = 0; for (let a = 0; a < 16; a++) for (const f of [0, 0.4, 0.8]) { v += biomeH(l.x + Math.cos(a * 0.39) * l.r * f, l.z + Math.sin(a * 0.39) * l.r * f); n++; } v /= n; lmBase.set(l.id, v); }
  return v;
}
/** Sinkhole geometry shared with the props and pond code. */
export const SINK = { floorR: 46, depth: 36, poolR: 27, poolDepth: 4.5, rampW: 6, rampRun: 125 };
/** Lookout Peak: a flat-topped summit with a long, even south-west face (the road's switchbacks) and steep ribbed flanks. */
/** Lookout Peak's footprint radius toward (x, z), and how much that bearing faces the road side (1) vs round the back (0). */
export function peakFoot(x: number, z: number): { R: number; fw: number } {
  const bear = Math.atan2(x - PEAK.x, z - PEAK.z);
  let df = bear - PEAK.face; if (df > Math.PI) df -= Math.PI * 2; if (df < -Math.PI) df += Math.PI * 2;
  const fw = Math.pow(Math.max(0, Math.cos(df)), 1.6);
  return { R: (PEAK.rBack + (PEAK.rFace - PEAK.rBack) * fw) * (1 + 0.09 * s2.n(Math.cos(bear) * 1.7 + 11, Math.sin(bear) * 1.7 - 4)), fw };
}
function peakH(x: number, z: number, h: number): number {
  const d = Math.hypot(x - PEAK.x, z - PEAK.z);
  const { R, fw } = peakFoot(x, z);                                          // fw: 1 on the road face, 0 round the back
  if (d >= R) return h;
  const t = clamp((d - PEAK.plateau) / (R - PEAK.plateau), 0, 1);
  // the old ground under the mountain gives way to a smooth apron toward the middle (no stray crags on the road face)
  const apron = lerp(h, 150 + 8 * s3.fbm(x / 140, z / 140, 2), 1 - smoothstep(0.6 * R, R, d));
  const f = 1 - (0.7 * t + 0.3 * smoothstep(0, 1, t));                       // near-even slope, a rounded shoulder and foot
  const ribs = (1 - fw) * 34 * s2.ridged(x / 130 + 5, z / 130, 4) * Math.sin(Math.PI * t);
  const grain = 3 * s3.fbm(x / 45, z / 45, 2) * smoothstep(0, 0.12, t);
  return lerp(apron, PEAK.h, f) + ribs + grain;
}
/** Landmark terrain: crater bowl, flattened boneyard with a crash gouge, sunken badlands, stunt-park earthworks, cenote. */
function landmarkH(l: Landmark, x: number, z: number, h: number): number {
  const dx = x - l.x, dz = z - l.z, d = Math.hypot(dx, dz), R = l.r, hc = landmarkLevel(l);
  const ux = Math.sin(l.dir), uz = Math.cos(l.dir);
  switch (l.id) {
    case 'summit': return h;   // shaped by peakH
    case 'shipwreck': {
      // dune sea levelled around the wreck, a long dune bank the hull leans against (it reaches her deck on the low side)
      let t = lerp(h, hc + 0.7 * s3.fbm(x / 35, z / 35, 2), 1 - smoothstep(R * 0.7, R + 120, d));
      const along = dx * ux + dz * uz, lat = dx * uz - dz * ux;         // hull lies across the way in
      t += 5.8 * Math.exp(-(((lat - 10) / 8) ** 2)) * (1 - smoothstep(20, 34, Math.abs(along)));
      t += 2.2 * Math.exp(-(((lat + 20) / 16) ** 2)) * (1 - smoothstep(10, 45, Math.abs(along + 8)));
      return t;
    }
    case 'stones': return lerp(h, hc + 0.3 * s3.fbm(x / 20, z / 20, 2), 1 - smoothstep(R * 0.75, R + 70, d)) + 1.0 * Math.exp(-((d / 10) ** 2));
    case 'radar': {
      // the hilltop is levelled into a compound, easing back into the natural slopes below it
      const pad = hc + 10 + 0.3 * s3.fbm(x / 25, z / 25, 2);
      return lerp(pad, h, smoothstep(R * 0.65, R + 70, d));
    }
    case 'crater': {
      // bowl with a raised, ragged rim, an ejecta apron and a central uplift. Walls top out near 28 degrees: steep, drivable.
      const ang = Math.atan2(dz, dx), rag = 0.75 + 0.5 * (0.5 + 0.5 * s2.n(Math.cos(ang) * 2.2 + 31, Math.sin(ang) * 2.2));
      const rimH = 15 * rag, D = 26, xr = d / R;
      const base = lerp(h, hc + 0.6 * (h - hc), 1 - smoothstep(R, R + 200, d));
      if (xr < 1) return base + rimH * smoothstep(0.55, 1, xr) - D * (1 - smoothstep(0.1, 0.95, xr)) + 9 * Math.exp(-((xr / 0.14) ** 2)) * (0.9 + 0.2 * s3.fbm(x / 30, z / 30, 2)) + 0.8 * s3.fbm(x / 14, z / 14, 2);
      return base + rimH * Math.exp(-(((d - R) / 70) ** 2));
    }
    case 'boneyard': {
      // a flat dry lake bed, with the gouge the cargo plane ploughed on its way in (along -u, ending at the wreck)
      let t = lerp(h, hc + 0.5 * s3.fbm(x / 40, z / 40, 2), 1 - smoothstep(R * 0.8, R + 140, d));
      const s = -(dx * ux + dz * uz), lat = Math.abs(dx * uz - dz * ux);
      if (s > -10 && s < 150) { const fade = smoothstep(-10, 10, s) * (1 - smoothstep(120, 150, s)); t += fade * (-1.3 * (1 - smoothstep(2.5, 5, lat)) + 0.9 * Math.exp(-(((lat - 6.5) / 1.6) ** 2))); }
      return t;
    }
    case 'hoodoos': {
      // sunken, terraced badlands: the spires (props) stand on a floor 5 m below the surrounding sand
      const f = 1 - smoothstep(R * 0.75, R + 60, d);
      return lerp(h, hc - 5 + 1.4 * terrace(0.5 + 0.5 * s2.fbm(x / 70, z / 70, 3), 3, 0.4) + 0.5 * s3.fbm(x / 16, z / 16, 2), f);
    }
    case 'stunt': {
      // flat park + earth features: a dirt bowl, a tabletop line, a whoops lane and a step-up mound
      let t = lerp(h, hc + 0.3 * s3.fbm(x / 30, z / 30, 2), 1 - smoothstep(R * 0.85, R + 70, d));
      const bowl = Math.hypot(dx + 45, dz - 28); if (bowl < 26) t -= 5.5 * (1 - (bowl / 26) ** 2) ** 1.5;
      if (Math.abs(dz + 60) < 9) { const lane = 1 - smoothstep(5.5, 9, Math.abs(dz + 60)); for (const c of [-48, 0, 48]) { const q = Math.abs(dx - c); t += lane * 3.4 * (q < 6 ? 1 : q < 16 ? smoothstep(16, 6, q) : 0); } }
      if (Math.abs(dx + 82) < 7 && dz > -5 && dz < 70) t += (1 - smoothstep(4, 7, Math.abs(dx + 82))) * 0.9 * (0.5 - 0.5 * Math.cos(dz / 7.5 * Math.PI * 2)) * smoothstep(-5, 5, dz) * (1 - smoothstep(60, 70, dz));
      const m = Math.hypot(dx - 60, dz + 15); if (m < 26) t += 7.5 * smoothstep(26, 9, m) - 2.5 * smoothstep(6, 0, m);
      return t;
    }
    case 'sinkhole': {
      // cenote: sheer limestone walls, a floor ring around a pool, and one ramp cut down from the rim along u
      const { floorR, depth: D, poolR, poolDepth, rampW, rampRun } = SINK;
      const lipNoise = 4 * s2.fbm(x / 13, z / 13, 2);
      let t: number;
      if (d < floorR) t = hc - D + 0.4 * s3.fbm(x / 8, z / 8, 2) - (d < poolR ? poolDepth * (1 - (d / poolR) ** 2) : 0);
      else if (d < R + lipNoise) { const k = (d - floorR) / (R + lipNoise - floorR); t = lerp(hc - D, Math.min(h, hc + 1), Math.pow(smoothstep(0, 1, k), 0.6)); }
      else t = lerp(h, hc + 0.5 * (h - hc), 1 - smoothstep(R, R + 120, d));
      const s = dx * ux + dz * uz, lat = Math.abs(dx * uz - dz * ux), s0 = floorR - 6, s1 = R + rampRun;
      if (s > s0 - 8 && s < s1 + 20 && lat < rampW + 9) {
        const along = clamp((s - s0) / (s1 - s0), 0, 1), ramp = hc - D + 0.2 + along * (D + 0.4);
        const wgt = (1 - smoothstep(rampW, rampW + 9, lat)) * smoothstep(s0 - 8, s0, s) * (1 - smoothstep(s1, s1 + 20, s));
        t = lerp(t, ramp, wgt);
      }
      return t;
    }
  }
  return h;
}

/** Thermal slope limiting on mountains: knife-edge noise ridges relax to natural ~50 degree talus. */
function erode(h: Float32Array) {
  const mask = new Uint8Array(V * V);
  const w = [0, 0, 0, 0];
  for (let j = 0; j < V; j += 1) for (let i = 0; i < V; i += 1) {
    const x = -HALF + i * CELL, z = -HALF + j * CELL;
    biomeWeights(x, z, 0, w);
    const edge = Math.max(Math.abs(x), Math.abs(z)) > HALF - 450;
    mask[j * V + i] = w[2] > 0.25 || edge ? 1 : 0;
  }
  const T = CELL * Math.tan(42 * Math.PI / 180);
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

/** Nearest point on a densely sampled polyline (vertex distance only; fine for 4 m spacing). */
export function distToPolylineFast(x: number, z: number, pts: P2[]): { d: number; i: number } {
  let best = 1e18, bi = 0;
  for (let i = 0; i < pts.length; i++) { const dx = pts[i][0] - x, dz = pts[i][1] - z, d = dx * dx + dz * dz; if (d < best) { best = d; bi = i; } }
  return { d: Math.sqrt(best), i: bi };
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

/**
 * Broad valleys: river valleys (monotone downstream, ending at a fixed level) and mountain passes. The floor follows a
 * heavily smoothed terrain profile; beyond the floor the sides are cut at `slope` and dips are filled at 1:2, so the
 * valley reads as a natural landform and everything in it is drivable.
 */
function carveValleys(data: WorldData) {
  const all: { id: string; pts: P2[]; floor: number; slope: number; smooth: number; river?: River; endH?: number; maxH?: number; startH?: number }[] = [
    ...RIVERS.map((r) => ({ id: r.id, pts: r.pts, floor: r.width / 2 + r.plain, slope: 0.32, smooth: 160, river: r, endH: r.endH, startH: r.startH })),
    ...PASSES.map((p) => ({ id: p.id, pts: p.pts, floor: p.floor, slope: p.slope, smooth: p.smooth, maxH: p.maxH })),
  ];
  for (const v of all) {
    const pts = spline(v.pts, 4), n = pts.length;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) { let m = 1e9; for (const [ox, oz] of [[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12]]) m = Math.min(m, sampleH(data.height, pts[i][0] + ox, pts[i][1] + oz)); raw[i] = m; }
    const R = Math.max(1, Math.round(v.smooth / 4));
    let p = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0, ws = 0; for (let k = -R * 2; k <= R * 2; k++) { const w = Math.exp(-(k * k) / (R * R)); s += raw[clamp(i + k, 0, n - 1)] * w; ws += w; } p[i] = s / ws; }
    if (v.maxH !== undefined) for (let i = 0; i < n; i++) p[i] = Math.min(p[i], v.maxH);
    if (v.river) {
      if (v.startH !== undefined) p[0] = v.startH;
      for (let i = 1; i < n; i++) p[i] = Math.min(p[i], p[i - 1] - 0.004);          // always flows downhill
      if (v.endH !== undefined) {                                                   // ease into the outlet level over the last 700 m
        const L = Math.min(n - 1, 175), e0 = n - 1 - L, h0 = p[e0];
        for (let i = e0; i < n; i++) { const t = (i - e0) / L; p[i] = Math.min(p[i], h0 + (v.endH - h0) * t * t * (3 - 2 * t)); }
      }
      // relax so the gradient is even rather than stepped
      for (let pass = 0; pass < 40; pass++) for (let i = 1; i < n - 1; i++) p[i] = Math.min(p[i], (p[i - 1] + p[i] * 2 + p[i + 1]) / 4);
    }
    const prof = p;
    carveAlong(data, pts, (i, u) => prof[i] + (prof[Math.min(i + 1, n - 1)] - prof[i]) * u, v.floor, 240, (d, _t, c, h0) => {
      const o = Math.max(0, d - v.floor);
      return clamp(h0, c - o * 0.5, c + o * v.slope);
    });
    if (v.river) {
      const r = v.river;
      data.rivers.push({ id: r.id, pts, lvl: Array.from(prof, (h) => h - 0.45), width: r.width, mud: r.mud, depth: r.depth });
      p = new Float32Array(0);
    }
  }
  for (const l of LAKES) {
    const R = l.r + 440;
    for (let j = Math.max(0, Math.floor((l.z - R + HALF) / CELL)); j <= Math.min(N, Math.ceil((l.z + R + HALF) / CELL)); j++)
      for (let i = Math.max(0, Math.floor((l.x - R + HALF) / CELL)); i <= Math.min(N, Math.ceil((l.x + R + HALF) / CELL)); i++) {
        const x = -HALF + i * CELL, z = -HALF + j * CELL, d = Math.hypot(x - l.x, z - l.z), k = j * V + i;
        if (d > R) continue;
        const o = Math.max(0, d - l.r);
        const capped = d < l.r ? l.h : clamp(data.height[k], l.h - o * 0.5, l.h + 0.1 + o * (0.1 + 0.32 * smoothstep(0, 90, o)));
        data.height[k] += (capped - data.height[k]) * (1 - smoothstep(l.r + 300, R, d));   // fade out at the edge: no cliff ring
      }
  }
}

/** Still water in landmark basins (the sinkhole pool): a wide ribbon at a fixed level (terrain hides what's outside the
 * basin), plus the physics water grid. Added after the roads so nothing tries to bridge it. */
export function addPonds(data: WorldData) {
  const l = LANDMARKS.find((q) => q.id === 'sinkhole');
  if (!l) return;
  const lvl = landmarkLevel(l) - SINK.depth - 0.9, R = SINK.poolR + 3;
  const pts: P2[] = []; for (let t = -R; t <= R; t += 3) pts.push([l.x + t, l.z]);
  data.rivers.push({ id: 'pond-sinkhole', pts, lvl: pts.map(() => lvl), width: R * 2, mud: false });
  for (let cj = Math.floor((l.z - R + HALF) / 4); cj <= Math.ceil((l.z + R + HALF) / 4); cj++) for (let ci = Math.floor((l.x - R + HALF) / 4); ci <= Math.ceil((l.x + R + HALF) / 4); ci++) {
    const x = -HALF + (ci + 0.5) * 4, z = -HALF + (cj + 0.5) * 4;
    if (sampleH(data.height, x, z) < lvl) { data.water[cj * CTRL + ci] = lvl; data.wet[cj * CTRL + ci] = 140; }
  }
}

/** Cut the wet channels into the valley floors (after roads, which bridge them). */
export function carveRivers(data: WorldData) {
  for (const r of data.rivers) {
    if (r.id === 'canyon') continue;
    const pts = r.pts, n = pts.length, lvl = r.lvl;
    const half = r.width / 2;
    carveAlong(data, pts, (i, u) => lvl[i] + (lvl[Math.min(i + 1, n - 1)] - lvl[i]) * u, half, 5, (d, t, level) => {
      const deep = (r.depth ?? 1) * (0.5 + 0.9 * smoothstep(0.72, 0.95, Math.sin(t / 110 + 1)));
      if (d < half) return level - deep * (1 - (d / half) ** 2) - 0.12;
      return null;
    }, true, r.mud, true);
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
  profile: (d: number, t: number, c: number, h0: number) => number | null, water = false, mud = false, onlyLower = false, skip?: Uint8Array, core?: { h: Float32Array; r: number }) {
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
  const bestD = new Float32Array(W * H).fill(1e9), bestT = new Float32Array(W * H), bestC = new Float32Array(W * H), bestS = new Uint8Array(skip ? W * H : 0);
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
        if (d < bestD[k]) { bestD[k] = d; bestT[k] = cum[s] + u * (cum[s + 1] - cum[s]); bestC[k] = centre(s, u); if (skip) bestS[k] = skip[s] && skip[s + 1] ? 1 : 0; }
      }
    }
  }
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = (j - j0) * W + (i - i0), d = bestD[k];
    if (d > reach) continue;
    if (skip && bestS[k]) continue;
    const idx = j * V + i, h0 = height[idx];
    if (core && d <= core.r) core.h[idx] = bestC[k];
    const tgt = profile(d, bestT[k], bestC[k], h0);
    let h: number;
    if (tgt !== null) h = tgt;
    else {
      const edge = profile(half - 1e-3, bestT[k], bestC[k], h0) ?? bestC[k];
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
