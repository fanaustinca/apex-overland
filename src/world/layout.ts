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
  { id: 'alpine', pts: [[-694, -950], [-880, -1060], [-1100, -1120], [-1350, -1210], [-1600, -1300]], floor: 16, slope: 0.55, smooth: 220 },
  // the hidden high valley above the Pass Hut (barn-find trail)
  { id: 'outpost', pts: [[-1600, -1300], [-1630, -1500], [-1600, -1700], [-1480, -1860]], floor: 9, slope: 0.58, smooth: 160 },
  // north-east: from the Ridgeback lowland up to the frozen lake
  { id: 'lake', pts: [[1760, -1330], [1600, -1470], [1440, -1620], [1290, -1730]], floor: 16, slope: 0.55, smooth: 220 },
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
  { id: 'snow', name: 'Summit Station Garage', x: -300, z: -1205, yaw: 1.2, main: false },
  { id: 'quarry', name: 'Quarry Works Garage', x: -905, z: -300, yaw: Math.PI / 2, main: false },
  { id: 'baja', name: 'Baja Base Garage', x: -1975, z: 1560, yaw: 0.25, main: false },
  { id: 'ridgeback', name: 'Ridgeback Lodge Garage', x: 2075, z: -160, yaw: -Math.PI / 2, main: false },
  { id: 'lake', name: 'Icefield Lodge Garage', x: 1440, z: -1770, yaw: -Math.PI / 2, main: false },
  { id: 'west', name: 'West Pit Depot Garage', x: -1640, z: 430, yaw: -Math.PI / 2, main: false },
  { id: 'pass', name: 'Pass Hut Garage', x: -1660, z: -1225, yaw: Math.PI * 0.75, main: false },
  { id: 'canyon', name: 'Canyon Mouth Garage', x: -1440, z: 820, yaw: Math.PI / 2, main: false },
];

/** Landmarks: set-piece terrain (and props) out in the open country, worth a detour. Discovering one pays out. */
export type LandmarkKind = 'crater' | 'boneyard' | 'hoodoos' | 'stunt' | 'sinkhole' | 'summit' | 'shipwreck' | 'stones' | 'radar' | 'ski' | 'lookout' | 'dwellings' | 'mine' | 'ufo';
/** The Apex summit: Mount Apex's top is reshaped into a flat-topped summit with a long, even south face (bearing `face`)
 *  that rises straight out of the Summit Station; the summit road switchbacks up it. The other flanks stay steep and
 *  rugged. `base` is the ground level the face runs down to. */
/** Summit Station: the col at Mount Apex's south foot where the mountain roads meet. */
export const STATION = { x: -200, z: -1150, h: 326 };
export const PEAK = { x: -150, z: -1560, h: 600, base: 335, plateau: 26, face: -0.12, rFace: 430, rBack: 430 };
/** Lookout Hill: a forested hill north of the Forest Cabin with a fire lookout tower on top. */
export const HILL = { x: 1450, z: -1035, r: 360, h: 120 };
/** The side slot canyon off the main canyon's south wall that winds back to the Cliff Dwellings' alcove. */
export const SLOT_X = 850, SLOT: P2[] = [[0, 0], [12, 50], [-18, 105], [18, 160], [-12, 215], [22, 268], [10, 310]];
export const slotPts = (): P2[] => SLOT.map(([dx, o]) => [SLOT_X + dx, canyonZ(SLOT_X) + 26 + o] as P2);
export interface Landmark { id: LandmarkKind; name: string; x: number; z: number; r: number; reward: number; blurb: string; dir: number }
export const LANDMARKS: Landmark[] = [
  // dir: the bearing (radians, atan2(dx, dz)) of the way in: a trail, ramp or notch faces that way
  { id: 'crater', name: 'Impact Crater', x: -1560, z: -830, r: 175, reward: 1500, dir: 0.9, blurb: 'A 350 m meteor crater with a glowing heart. Drop in, climb out.' },
  { id: 'boneyard', name: 'Aircraft Boneyard', x: -1930, z: 1240, r: 120, reward: 1200, dir: 0, blurb: 'A crashed cargo plane and its scrapped cousins. The broken wing is a ramp.' },
  { id: 'hoodoos', name: 'Hoodoo Garden', x: -330, z: 1360, r: 140, reward: 1200, dir: 0, blurb: 'Rock spires, balanced caprocks and a natural arch you can drive through.' },
  { id: 'stunt', name: 'Stunt Park', x: 470, z: -380, r: 115, reward: 1000, dir: 0, blurb: 'Kickers, tabletops, a bowl and a container gap. Send it.' },
  { id: 'summit', name: 'Apex Summit', x: PEAK.x, z: PEAK.z, r: PEAK.plateau, reward: 2500, dir: PEAK.face, blurb: 'The top of Mount Apex: a viewing deck 600 m up. Switchback your way there from the Summit Station.' },
  { id: 'shipwreck', name: 'Desert Shipwreck', x: -880, z: 2130, r: 62, reward: 1400, dir: Math.PI, blurb: 'An old three-master stranded in the dune sea, half buried. The dune bank runs right up onto her deck.' },
  { id: 'stones', name: 'Standing Stones', x: 1350, z: -420, r: 46, reward: 1100, dir: 0.32, blurb: 'A ring of mossy monoliths deep in the woods, with two great trilithon gates to drive through.' },
  { id: 'radar', name: 'Radar Station', x: -850, z: -1400, r: 56, reward: 1500, dir: 0.9, blurb: 'Abandoned early-warning station on a snowy hilltop: radomes, a giant dish and the best view of Mount Apex.' },
  { id: 'ski', name: 'Apex Ski Club', x: -150, z: -1945, r: 42, reward: 1300, dir: 1.57, blurb: 'A ski area on the north face of Mount Apex: a chairlift, slalom gates and a ski jump you can launch a truck off.' },
  { id: 'lookout', name: 'Fire Lookout', x: HILL.x, z: HILL.z, r: 22, reward: 1400, dir: 2.6, blurb: 'A fire lookout tower on top of Lookout Hill. Wind your way up the forest trail and climb the stairs for the view.' },
  { id: 'dwellings', name: 'Cliff Dwellings', x: SLOT_X + 10, z: canyonZ(SLOT_X) + 26 + 340, r: 34, reward: 1700, dir: Math.PI, blurb: 'Ancient stone rooms built into an alcove at the end of a hidden slot canyon off the south wall.' },
  { id: 'mine', name: 'Old Gold Mine', x: -2160, z: -80, r: 40, reward: 1500, dir: Math.PI / 2, blurb: 'An abandoned gold mine in the western hills: a timber portal, ore carts and a creaking headframe.' },
  { id: 'ufo', name: 'Crash Site', x: 1630, z: 1290, r: 48, reward: 2000, dir: -2.2, blurb: 'Something came down hard in the woods. Follow the scorched furrow to whatever it was.' },
  { id: 'sinkhole', name: 'The Sinkhole', x: 1910, z: -1640, r: 72, reward: 1800, dir: -0.45, blurb: 'A 35 m deep cenote with a turquoise pool. One ramp down, one way out.' },
];

const cz = (x: number) => canyonZ(x);
/** Off-road racing lines: mesas are eroded out of a corridor along these so every race is drivable. */
export const OFFROAD: Record<string, P2[][]> = {
  'rim-jumper': [
    [[-900, cz(-900) - 175], [-650, cz(-650) - 170], [-560, cz(-560) - 165], [-450, cz(-450) - 150], [-350, cz(-350) - 75], [-350, cz(-350) - 30]],
    [[-350, cz(-350) + 60], [-200, cz(-200) + 160], [40, cz(40) + 170], [125, cz(125) + 190], [150, cz(150) + 175], [150, cz(150) + 150]],
    [[150, cz(150) - 150], [150, cz(150) - 175], [190, cz(190) - 190], [300, cz(300) - 175], [470, cz(470) - 140], [560, cz(560) - 75], [560, cz(560) - 30]],
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
