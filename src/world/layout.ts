// Static world layout: map extents, biome partition and the hand-placed macro features (canyon, rivers, quarry pits).
// x = east, z = south, y = up. The hub sits at the origin where all four biomes meet.
import { smoothstep } from '../core/noise';

export const WORLD = 4096;           // metres per side
export const HALF = WORLD / 2;
export const N = 2048;               // height cells per side
export const CELL = WORLD / N;       // 2 m
export const V = N + 1;              // height vertices per side
export const CTRL = 1024;            // splat-control resolution (4 m)

export const enum Biome { Desert = 0, Forest = 1, Snow = 2, Quarry = 3 }
export const BIOME_NAMES = ['Desert Canyon', 'Dense Forest', 'Snowy Mountain', 'Industrial Quarry'];

export type P2 = [number, number];

/** Canyon centreline through the southern desert, west -> east. */
export function canyonZ(x: number): number { return 1170 + 110 * Math.sin(x / 260 + 0.4) + 45 * Math.sin(x / 93 + 1.3); }
export const CANYON_X0 = -1320, CANYON_X1 = 1320;
/** x positions where the canyon pinches to a jumpable gap (rock ramps sit on the north rim). */
export const NARROWS = [-350, 560];
export const BRIDGES_X = [-700, 150, 1000];
export const CANYON_FLOOR = 3.0, CANYON_WATER = 3.9;

/** Rivers as polylines (x,z), width at water surface, water level is computed from the carved bed. */
export interface River { id: string; pts: P2[]; width: number; depth: number; mud: boolean }
export const RIVERS: River[] = [
  // Muddy Creek: snowmelt from the north-east, winding south through the forest
  { id: 'creek', width: 14, depth: 1.0, mud: true, pts: [[640, -1500], [820, -1180], [1010, -900], [1150, -560], [1230, -220], [1180, 120], [1260, 430], [1430, 700], [1560, 980], [1700, 1250], [1900, 1420]] },
];

export interface Pit { x: number; z: number; r: number; tiers: number; tierH: number; tierW: number }
export const PITS: Pit[] = [
  { x: -1250, z: -120, r: 330, tiers: 6, tierH: 8, tierW: 26 },
  { x: -1060, z: 560, r: 210, tiers: 4, tierH: 7, tierW: 24 },
];

export const HUB = { x: 0, z: 0, r: 190, h: 24 };

/** Soft-max biome weights with organic, noise-warped 300 m transition belts. */
export function biomeWeights(x: number, z: number, warp: number, out: Float32Array | number[]): void {
  // warp: precomputed low-frequency noise value in [-1,1]
  const wx = x + warp * 160, wz = z - warp * 140;
  const sS = wz, sE = wx, sN = -wz, sW = -wx;
  const T = 72;
  const m = Math.max(sS, sE, sN, sW);
  const a = Math.exp((sS - m) / T), b = Math.exp((sE - m) / T), c = Math.exp((sN - m) / T), d = Math.exp((sW - m) / T);
  const s = a + b + c + d;
  out[0] = a / s; out[1] = b / s; out[2] = c / s; out[3] = d / s;
}

export function hubFactor(x: number, z: number): number {
  return 1 - smoothstep(HUB.r, HUB.r + 260, Math.hypot(x - HUB.x, z - HUB.z));
}

export function distToPolyline(px: number, pz: number, pts: P2[]): { d: number; t: number; seg: number; u: number } {
  let best = 1e9, bt = 0, bs = 0, bu = 0, acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, L = Math.sqrt(L2);
    let u = ((px - ax) * dx + (pz - az) * dz) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u;
    const qx = ax + dx * u - px, qz = az + dz * u - pz, d = qx * qx + qz * qz;
    if (d < best) { best = d; bt = acc + u * L; bs = i; bu = u; }
    acc += L;
  }
  return { d: Math.sqrt(best), t: bt, seg: bs, u: bu };
}
