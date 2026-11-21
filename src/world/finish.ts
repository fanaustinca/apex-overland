// Second generation pass: everything the renderer and physics derive from the final heightmap.
import { N, V, CELL, HALF, CTRL, HUB, GARAGES, LAKES, type P2 } from './layout';
import { Simplex, smoothstep, clamp } from '../core/noise';
import { biomeWeights } from './layout';
import { generateBase, carveRivers, SEED, type WorldData } from './gen';
import { buildRoads, CABINS, type Road, type Bridge, type Pad } from './roads';

/** Terrain texture layers (index = texture-array layer). Keep in sync with tools/fetch-assets.mjs TERRAIN. */
export const LAYERS = ['red_sand', 'cracked_red_ground', 'cliff_side', 'forest_ground_04', 'forrest_ground_01', 'snow_02',
  'dry_riverbed_rock', 'gravel_floor', 'muddy_tracks', 'stony_dirt_path', 'rock_face_03', 'worn_asphalt'] as const;
export const enum L { Sand, Cracked, Cliff, ForestFloor, Grass, Snow, MtnRock, Gravel, Mud, Dirt, QuarryRock, Asphalt }

/** Physics surfaces. */
export const enum Surf { Asphalt, Dirt, Gravel, Sand, Mud, Snow, Ice, Grass, Rock }
export const SURF_NAMES = ['Asphalt', 'Dirt', 'Gravel', 'Sand', 'Mud', 'Snow', 'Ice', 'Grass', 'Rock'];

// direction TOWARDS the sun: low golden sun in the south-west
const SUN_EL = 27 * Math.PI / 180, SUN_AZ = 220 * Math.PI / 180;   // azimuth from north, clockwise
export const SUN_DIR: [number, number, number] = [Math.sin(SUN_AZ) * Math.cos(SUN_EL), Math.sin(SUN_EL), -Math.cos(SUN_AZ) * Math.cos(SUN_EL)];

export interface World extends WorldData {
  roads: Road[]; bridges: Bridge[];
  garages: { id: string; x: number; z: number; yaw: number }[];   // final (auto-sited) garage placements
  roadMask: Uint8Array;   // N*N
  roadKind: Uint8Array;   // CTRL*CTRL
  normals: Uint8Array;    // N*N*4 (nx, nz, slope, unused) packed
  ctrl: Uint8Array;       // CTRL*CTRL*12 (three RGBA textures, interleaved per texture)
  bake: Uint8Array;       // CTRL*CTRL*4 (sun visibility, ao, cavity, unused)
  surface: Uint8Array;    // CTRL*CTRL
}

const sn = new Simplex(SEED + 99), sm = new Simplex(SEED + 123);

export function generateWorld(log: (s: string) => void = () => {}, rows?: Float32Array, shade = true): World {
  let t = performance.now();
  const lap = (s: string) => { const n = performance.now(); log(`${s} ${Math.round(n - t)}ms`); t = n; };
  const base = generateBase(rows); lap('terrain');
  const pads = levelPads(base as World);
  const r = buildRoads(base, pads); lap('roads + earthworks');
  const w = base as World;
  Object.assign(w, r);
  carveRivers(base); lap('river channels');
  w.garages = GARAGES.map((g) => ({ id: g.id, x: g.x, z: g.z, yaw: g.yaw }));
  w.normals = computeNormals(w.height); lap('normals');
  if (shade) { const s = shadeRows(w, 0, CTRL); w.bake = s.bake; w.ctrl = s.ctrl; w.surface = s.surface; lap('light bake + splat'); }
  return w;
}

/** Light bake + splat for texel rows j0..j1-1 (independent per row, so it parallelises across workers). */
export function shadeRows(w: Pick<World, 'height' | 'normals' | 'wet' | 'water' | 'roadMask' | 'roadKind'>, j0: number, j1: number) {
  const bake = bakeLight(w.height, j0, j1);
  const { ctrl, surface } = splat(w, j0, j1);
  return { bake, ctrl, surface };
}

/** Level building pads (garages, barns) so foundations neither float nor sink; roads then treat them as formation. */
export function padList(): { x: number; z: number; r: number }[] {
  return CABINS.map((c) => ({ x: c.x + Math.sin(c.yaw) * 4, z: c.z + Math.cos(c.yaw) * 4, r: 14 }));
}
function levelPads(w: World): Pad[] {
  return padList().map((p) => {
    // pad height: the median of the ground under it, so cut and fill balance
    const hs: number[] = [];
    for (let a = 0; a < 16; a++) for (const f of [0, 0.5, 1]) hs.push(hAt(w.height, p.x + Math.cos(a / 16 * Math.PI * 2) * p.r * f, p.z + Math.sin(a / 16 * Math.PI * 2) * p.r * f));
    hs.sort((a, b) => a - b);
    return { ...p, h: hs[hs.length >> 1] };
  });
}

function computeNormals(h: Float32Array): Uint8Array {
  const out = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    // normal at cell centre from the four corners
    const a = h[j * V + i], b = h[j * V + i + 1], c = h[(j + 1) * V + i], d = h[(j + 1) * V + i + 1];
    const dx = ((b - a) + (d - c)) / (2 * CELL), dz = ((c - a) + (d - b)) / (2 * CELL);
    const l = Math.hypot(dx, 1, dz);
    const k = (j * N + i) * 4;
    out[k] = Math.round((-dx / l * 0.5 + 0.5) * 255); out[k + 1] = Math.round((-dz / l * 0.5 + 0.5) * 255);
    out[k + 2] = Math.round(clamp(1 - 1 / l, 0, 1) * 255); out[k + 3] = 255;
  }
  return out;
}

function hAt(h: Float32Array, x: number, z: number): number {
  const fx = clamp((x + HALF) / CELL, 0, N - 1e-3), fz = clamp((z + HALF) / CELL, 0, N - 1e-3);
  const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j;
  const a = h[j * V + i], b = h[j * V + i + 1], c = h[(j + 1) * V + i], d = h[(j + 1) * V + i + 1];
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Soft sun visibility (horizon march toward the sun) and horizon-based ambient occlusion, at 4 m. */
function bakeLight(h: Float32Array, j0 = 0, j1 = CTRL): Uint8Array {
  const out = new Uint8Array((j1 - j0) * CTRL * 4);
  const [sx, sy, sz] = SUN_DIR;
  const hl = Math.hypot(sx, sz), tanS = sy / hl, dx = sx / hl, dz = sz / hl;
  const dirs = 8;
  const DX = Array.from({ length: dirs }, (_, k) => Math.cos(k * Math.PI * 2 / dirs)), DZ = Array.from({ length: dirs }, (_, k) => Math.sin(k * Math.PI * 2 / dirs));
  const R = [6, 14, 28, 52, 96];
  let maxH = -1e9; for (let k = 0; k < h.length; k += 7) if (h[k] > maxH) maxH = h[k];
  maxH += 4;
  // 32 m max-height blocks let the sun march skip open air quickly
  const B = 16, NB = Math.ceil(V / B), blk = new Float32Array(NB * NB).fill(-1e9);
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) { const b = ((j / B) | 0) * NB + ((i / B) | 0); if (h[j * V + i] > blk[b]) blk[b] = h[j * V + i]; }
  const blockMax = (x: number, z: number) => { const i = clamp(((x + HALF) / CELL / B) | 0, 0, NB - 1), j = clamp(((z + HALF) / CELL / B) | 0, 0, NB - 1); return blk[j * NB + i]; };
  for (let j = j0; j < j1; j++) for (let i = 0; i < CTRL; i++) {
    const x = -HALF + (i + 0.5) * 4, z = -HALF + (j + 0.5) * 4;
    const h0 = hAt(h, x, z) + 0.3;
    // sun: track the minimum clearance angle along the ray for a penumbra
    let vis = 1, d = 4;
    while (d < 1600) {
      const px = x + dx * d, pz = z + dz * d, ray = h0 + d * tanS;
      // well clear of everything in this block: penumbra can't tighten here, so stride across it
      if ((ray - blockMax(px, pz)) / d * 14 + 0.5 >= vis) { d += 12 + d * 0.05; if (ray > maxH) break; continue; }
      const hh = hAt(h, px, pz);
      const clear = (ray - hh) / d;           // tan of clearance
      vis = Math.min(vis, clamp(clear * 14 + 0.5, 0, 1));
      if (vis <= 0) break;
      d += 3 + d * 0.06;
      if (ray > maxH) break;
    }
    // ambient occlusion
    let occ = 0;
    for (let k = 0; k < dirs; k++) {
      let m = 0;
      for (const r of R) { const s = (hAt(h, x + DX[k] * r, z + DZ[k] * r) - h0) / r; if (s > m) m = s; }
      occ += Math.atan(m) / (Math.PI / 2);
    }
    const ao = clamp(1 - occ / dirs * 1.25, 0, 1);
    // cavity: local concavity for detail darkening / dust accumulation
    const lap = (hAt(h, x - 4, z) + hAt(h, x + 4, z) + hAt(h, x, z - 4) + hAt(h, x, z + 4)) / 4 - h0 + 0.3;
    const k = ((j - j0) * CTRL + i) * 4;
    out[k] = Math.round(vis * 255); out[k + 1] = Math.round(ao * 255); out[k + 2] = Math.round(clamp(0.5 + lap * 0.25, 0, 1) * 255); out[k + 3] = 255;
  }
  return out;
}

function splat(w: Pick<World, 'height' | 'normals' | 'wet' | 'water' | 'roadMask' | 'roadKind'>, j0 = 0, j1 = CTRL): { ctrl: Uint8Array; surface: Uint8Array } {
  const RN = (j1 - j0) * CTRL;
  const ctrl = new Uint8Array(RN * 12);
  const surface = new Uint8Array(RN);
  const bw = [0, 0, 0, 0];
  const L = new Float32Array(12);
  const sx = new Simplex(SEED);
  for (let j = j0; j < j1; j++) for (let i = 0; i < CTRL; i++) {
    const x = -HALF + (i + 0.5) * 4, z = -HALF + (j + 0.5) * 4;
    const warp = sx.fbm(x / 1100 + 40, z / 1100 - 40, 3);
    biomeWeights(x, z, warp, bw);
    const ni = Math.min(N - 1, i * 2), nj = Math.min(N - 1, j * 2);
    const nk = (nj * N + ni) * 4;
    const slope = w.normals[nk + 2] / 255;              // 0 flat .. ~0.3 at 45deg
    const steep = smoothstep(0.1, 0.2, slope), cliff = smoothstep(0.16, 0.3, slope);
    const h = hAt(w.height, x, z);
    const n1 = sn.fbm(x / 90, z / 90, 3), n2 = sm.fbm(x / 35, z / 35, 3), n3 = sn.fbm(x / 400, z / 400, 2);
    const wet = w.wet[j * CTRL + i] / 255;
    const hub = 1 - smoothstep(HUB.r - 20, HUB.r + 200, Math.hypot(x - HUB.x, z - HUB.z));
    L.fill(0);
    // desert
    const dunes = smoothstep(-0.05, 0.3, sm.fbm(x / 900 + 5, z / 900 - 2, 3) + n2 * 0.15);
    L[0] += bw[0] * (1 - cliff) * (0.25 + 0.75 * dunes);
    L[1] += bw[0] * (1 - cliff) * (1 - dunes) * 0.75;
    L[2] += bw[0] * cliff;
    // forest
    const meadow = smoothstep(0.15, 0.45, n3 + n1 * 0.3);
    L[3] += bw[1] * (1 - steep) * (1 - meadow);
    L[4] += bw[1] * (1 - steep) * meadow;
    L[6] += bw[1] * steep * 0.6; L[3] += bw[1] * steep * 0.4;
    // snow: snowline rises with exposure; rock on steep faces
    const snowy = smoothstep(60, 120, h + n1 * 30);
    const outcrop = smoothstep(0.45, 0.7, n2 + n1 * 0.5) * 0.7 + smoothstep(0.11, 0.2, slope);
    const sn2 = snowy * (1 - Math.min(1, outcrop));
    L[5] += bw[2] * (1 - cliff) * sn2;
    L[6] += bw[2] * (1 - cliff) * snowy * Math.min(1, outcrop);
    L[4] += bw[2] * (1 - cliff) * (1 - snowy) * 0.5; L[3] += bw[2] * (1 - cliff) * (1 - snowy) * 0.5;
    L[6] += bw[2] * cliff;
    // quarry
    L[7] += bw[3] * (1 - steep) * (0.45 + 0.4 * smoothstep(-0.2, 0.3, n1));
    L[9] += bw[3] * (1 - steep) * 0.45 * (1 - smoothstep(-0.2, 0.3, n1));
    L[1] += bw[3] * (1 - steep) * 0.2 * smoothstep(0.1, 0.4, n3);
    L[10] += bw[3] * steep;
    // hub: grass with packed dirt
    if (hub > 0) { for (let k = 0; k < 12; k++) L[k] *= 1 - hub; L[4] += hub * (0.65 + 0.35 * smoothstep(-0.3, 0.3, n1)); L[9] += hub * 0.35 * (1 - smoothstep(-0.3, 0.3, n1)); }
    // frozen lakes: wind-polished ice with a dusting of snow
    for (const lk of LAKES) { const dl = Math.hypot(x - lk.x, z - lk.z); if (dl < lk.r + 6) { const f = 1 - smoothstep(lk.r - 4, lk.r + 6, dl); for (let k = 0; k < 12; k++) L[k] *= 1 - f; L[5] += f; } }
    // wet ground -> mud
    if (wet > 0) { for (let k = 0; k < 12; k++) L[k] *= 1 - wet * 0.85; L[8] += wet * 0.85; }
    // roads (sample the 2 m mask at this texel's 4 corners, max)
    const rm = Math.max(w.roadMask[nj * N + ni], w.roadMask[nj * N + Math.min(ni + 1, N - 1)], w.roadMask[Math.min(nj + 1, N - 1) * N + ni]) / 255;
    const kind = w.roadKind[j * CTRL + i];
    // normalise
    let s = 0; for (let k = 0; k < 12; k++) s += L[k];
    for (let k = 0; k < 12; k++) L[k] /= s || 1;
    const o = (j * CTRL + i), ol = (j - j0) * CTRL + i;
    for (let k = 0; k < 12; k++) ctrl[(Math.floor(k / 4) * RN + ol) * 4 + (k % 4)] = Math.round(L[k] * 255);
    // dominant physics surface
    let best = 0; for (let k = 1; k < 12; k++) if (L[k] > L[best]) best = k;
    const MAP = [Surf.Sand, Surf.Dirt, Surf.Rock, Surf.Dirt, Surf.Grass, Surf.Snow, Surf.Rock, Surf.Gravel, Surf.Mud, Surf.Dirt, Surf.Rock, Surf.Asphalt];
    let sf = MAP[best];
    if (rm > 0.5 && kind) sf = [Surf.Asphalt, Surf.Asphalt, Surf.Dirt, Surf.Gravel, Surf.Snow, Surf.Dirt, Surf.Gravel][kind];   // snow roads are packed snow; only the frozen lake is ice
    if (!Number.isNaN(w.water[o])) sf = Surf.Mud;
    for (const lk of LAKES) if (lk.ice && Math.hypot(x - lk.x, z - lk.z) < lk.r) sf = Surf.Ice;
    surface[ol] = sf;
  }
  return { ctrl, surface };
}

export type { P2 };
