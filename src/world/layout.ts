// Static world layout: map extents, biome partition and the hand-placed macro features (canyon, rivers, quarry pits).
// x = east, z = south, y = up. The hub sits at the origin where all four biomes meet.
import { smoothstep } from '../core/noise';

export const WORLD = 5120;           // metres per side
export const HALF = WORLD / 2;
export const N = 2560;               // height cells per side
export const CELL = WORLD / N;       // 2 m
export const V = N + 1;              // height vertices per side
export const CTRL = 1280;            // splat-control resolution (4 m)

export const enum Biome { Desert = 0, Forest = 1, Snow = 2, Quarry = 3 }
export const BIOME_NAMES = ['Desert Canyon', 'Dense Forest', 'Snowy Mountain', 'Industrial Quarry'];

export type P2 = [number, number];

/** Canyon centreline through the southern desert, west -> east. */
export function canyonZ(x: number): number { return 1170 + 110 * Math.sin(x / 260 + 0.4) + 45 * Math.sin(x / 93 + 1.3); }
export const CANYON_X0 = -1320, CANYON_X1 = 1320;
/** x positions where the canyon pinches to a jumpable gap (rock ramps sit on the north rim). */
export const NARROWS = [-350, 560];
export const BRIDGES_X = [-700, 150, 1000];
export const CANYON_FLOOR = 3.6, CANYON_WATER = 3.9;

/** Rivers: polylines (x,z) through broad carved valleys. Water level follows the smoothed valley floor downhill. */
export interface River { id: string; pts: P2[]; width: number; depth: number; mud: boolean; plain: number; startH?: number; endH?: number }
export const RIVERS: River[] = [
  // Muddy Creek: snowmelt from the north-east foothills, winding south through the forest into the canyon's east end
  { id: 'creek', width: 18, depth: 1.1, mud: true, plain: 26, endH: CANYON_WATER + 0.6, pts: [[1090, -860], [1150, -560], [1230, -220], [1180, 120], [1260, 430], [1430, 700], [1520, 900], [1420, 1040], [1260, 1080], [1120, cz0(1120)]] },
];
function cz0(x: number) { return canyonZ(x); }

/** Mountain passes: valleys cut through ranges so roads can cross them at sane grades. */
export interface Pass { id: string; pts: P2[]; floor: number; slope: number; smooth: number; maxH?: number }
export const PASSES: Pass[] = [
  // north-west: from the peak-descent foot over the shoulder into the lowland where the Pass Hut sits
  { id: 'alpine', pts: [[-694, -950], [-880, -1060], [-1100, -1120], [-1350, -1210], [-1600, -1300]], floor: 16, slope: 0.75, smooth: 220 },
  // the hidden high valley above the Pass Hut (barn-find trail)
  { id: 'outpost', pts: [[-1600, -1300], [-1630, -1500], [-1600, -1700], [-1480, -1860]], floor: 9, slope: 0.8, smooth: 160 },
  // north-east: from the Ridgeback lowland up to the frozen lake
  { id: 'lake', pts: [[1760, -1330], [1600, -1470], [1440, -1620], [1290, -1730]], floor: 16, slope: 0.7, smooth: 220 },
];

/** Lakes: flattened basins. Frozen ones are ice sheets (snow-white, ice physics). */
export interface Lake { id: string; x: number; z: number; r: number; h: number; ice: boolean }
export const LAKES: Lake[] = [
  { id: 'frozen', x: 1180, z: -1830, r: 175, h: 143, ice: true },
];

export interface Pit { x: number; z: number; r: number; tiers: number; tierH: number; tierW: number }
export const PITS: Pit[] = [
  { x: -1250, z: -120, r: 330, tiers: 6, tierH: 8, tierW: 26 },
  { x: -1060, z: 560, r: 210, tiers: 4, tierH: 7, tierW: 24 },
];

export const HUB = { x: 0, z: 0, r: 190, h: 24 };

/** Garages. yaw: the doors face (sin yaw, cos yaw); the apron in front of the doors meets a road. */
export const GARAGES = [
  { id: 'hub', name: 'Central Hub Garage', x: -95, z: 58, yaw: Math.PI / 2, main: true },
  { id: 'desert', name: 'Dune Outpost Garage', x: 245, z: 1560, yaw: -Math.PI / 2, main: false },
  { id: 'forest', name: 'Logging Camp Garage', x: 1560, z: 360, yaw: Math.PI, main: false },
  { id: 'snow', name: 'Summit Station Garage', x: 330, z: -1392, yaw: Math.PI, main: false },
  { id: 'quarry', name: 'Quarry Works Garage', x: -905, z: -300, yaw: Math.PI / 2, main: false },
  { id: 'baja', name: 'Baja Base Garage', x: -1975, z: 1560, yaw: 0.25, main: false },
  { id: 'ridgeback', name: 'Ridgeback Lodge Garage', x: 2075, z: -160, yaw: -Math.PI / 2, main: false },
  { id: 'lake', name: 'Icefield Lodge Garage', x: 1440, z: -1770, yaw: -Math.PI / 2, main: false },
  { id: 'west', name: 'West Pit Depot Garage', x: -1640, z: 430, yaw: -Math.PI / 2, main: false },
  { id: 'pass', name: 'Pass Hut Garage', x: -1660, z: -1225, yaw: Math.PI * 0.75, main: false },
  { id: 'canyon', name: 'Canyon Mouth Garage', x: -1440, z: 820, yaw: Math.PI / 2, main: false },
];

const cz = (x: number) => canyonZ(x);
/** Off-road racing lines: mesas are eroded out of a corridor along these so every race is drivable. */
export const OFFROAD: Record<string, P2[][]> = {
  'rim-jumper': [
    [[-900, cz(-900) - 120], [-650, cz(-650) - 110], [-560, cz(-560) - 150], [-450, cz(-450) - 150], [-350, cz(-350) - 75], [-350, cz(-350) - 30]],
    [[-350, cz(-350) + 60], [-200, cz(-200) + 110], [40, cz(40) + 120], [125, cz(125) + 150], [150, cz(150) + 125], [150, cz(150) + 100]],
    [[150, cz(150) - 100], [150, cz(150) - 125], [190, cz(190) - 150], [300, cz(300) - 140], [470, cz(470) - 110], [560, cz(560) - 75], [560, cz(560) - 30]],
    [[560, cz(560) + 60], [700, cz(700) + 125], [860, cz(860) + 160]],
  ],
  'dune-basher': [[[-1100, 1555], [-780, 1560], [-500, 1640], [-250, 1580], [50, 1560], [300, 1640], [600, 1580], [900, 1640], [1250, 1600]]],
  'canyon-breakout': [[[600, cz(600) + 130], [590, 1450], [585, 1550], [640, 1640], [760, 1700]]],
};

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
