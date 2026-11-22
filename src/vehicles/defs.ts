// Vehicle roster. Local frame: +z forward, +y up, +x left. Units: metres, kg, kW, m/s.
export type VClass = 'Featherweight' | 'Lightweight' | 'Mid-Weight' | 'Heavyweight' | 'Juggernaut' | 'Secret';
export type Special = 'bike' | 'tank' | 'snake' | undefined;
export type Body = 'bike' | 'buggy' | 'sedan' | 'limo' | 'crawler' | 'suv' | 'pickup' | 'sixbysix' | 'dakar' | 'semi' | 'eightbyeight' | 'monster' | 'monster6' | 'bus' | 'tank' | 'dump' | 'snake';

export interface WheelDef { x: number; z: number; steer: number; drive: boolean }
export interface VehicleDef {
  id: string; name: string; cls: VClass; body: Body; special?: Special; price: number; blurb: string;
  mass: number; power: number; top: number;          // kW, m/s
  len: number; wid: number; hgt: number;              // body box (for colliders and the model)
  ride: number;                                       // chassis bottom above wheel centre line
  wheelR: number; wheelW: number;
  wheels: WheelDef[];
  susp: { rest: number; travel: number; stiff: number; damp: number };
  grip: number;                                       // base friction slip
  steerMax: number;                                   // radians
  color: string; color2: string;
  plowable: boolean;                                  // can mount the front dozer plow
  heavy: boolean;                                     // breaks medium trees at speed without a plow
  intake: number;                                     // engine air intake height above ground (stall depth)
  torque?: number;                                    // low-speed / climbing pull multiplier (flat-ground acceleration is unchanged)
  arb?: number;                                       // anti-roll bar stiffness (x mass g per metre of left/right suspension difference)
  stab?: number;                                      // yaw stability: caps yaw rate near what the steering asks for (0 = free to drift)
  cling?: number;                                     // tyre adhesion on steep ground (x mass g pressed into the slope at full steepness): wall-climbing
}

/** The Snake: six single-axle segments on five articulation joints (hinge GAP metres apart, module ends to hinge = GAP/2). */
export const SNAKE_MODS = 6, SNAKE_GAP = 0.48;
export const modsOf = (d: { special?: string }) => (d.special === 'snake' ? SNAKE_MODS : 1);
const axle = (z: number, half: number, steer: number, drive = true): WheelDef[] => [{ x: half, z, steer, drive }, { x: -half, z, steer, drive }];

export const VEHICLES: VehicleDef[] = [
  { id: 'bike', name: 'Dirt Bike', cls: 'Featherweight', body: 'bike', special: 'bike', price: 6000, blurb: 'Lean into corners, Space to bunny-hop. Fragile but nimble.',
    mass: 150, power: 48, top: 39, len: 2.1, wid: 0.5, hgt: 0.9, ride: 0.05, wheelR: 0.36, wheelW: 0.12,
    wheels: [{ x: 0, z: 0.74, steer: 1, drive: false }, { x: 0, z: -0.72, steer: 0, drive: true }],
    susp: { rest: 0.42, travel: 0.3, stiff: 34, damp: 3.2 }, grip: 1.49, steerMax: 0.5, color: '#e8432a', color2: '#1c1c1c', plowable: false, heavy: false, intake: 0.6 },
  { id: 'buggy', name: 'Dune Buggy', cls: 'Featherweight', body: 'buggy', price: 9000, blurb: 'Tube-frame sand rocket. Flies far, lands soft.',
    mass: 760, power: 170, top: 45, len: 3.5, wid: 1.85, hgt: 1.3, ride: 0.2, wheelR: 0.42, wheelW: 0.3,
    wheels: [...axle(1.25, 0.86, 1, false), ...axle(-1.15, 0.9, 0)],
    susp: { rest: 0.55, travel: 0.45, stiff: 26, damp: 2.6 }, grip: 1.36, steerMax: 0.55, color: '#ffb020', color2: '#222', plowable: false, heavy: false, intake: 0.8 },
  { id: 'sedan', name: 'Rally Sedan', cls: 'Lightweight', body: 'sedan', price: 12000, blurb: 'Lifted all-wheel-drive rally car. Quick everywhere it can keep its wheels down.',
    mass: 1350, power: 240, top: 50, len: 4.4, wid: 1.82, hgt: 1.4, ride: 0.18, wheelR: 0.36, wheelW: 0.24,
    wheels: [...axle(1.35, 0.78, 1), ...axle(-1.25, 0.78, 0)],
    susp: { rest: 0.45, travel: 0.3, stiff: 32, damp: 3.0 }, grip: 1.43, steerMax: 0.5, color: '#1d6fd6', color2: '#f2f2f2', plowable: false, heavy: false, intake: 0.7 },
  { id: 'limo', name: 'Offroad Limo', cls: 'Lightweight', body: 'limo', price: 15000, blurb: 'Seven metres of lifted luxury. Long wheelbase, glorious sweeping drifts.',
    mass: 2600, power: 270, top: 43, len: 7.0, wid: 1.95, hgt: 1.5, ride: 0.22, wheelR: 0.4, wheelW: 0.26,
    wheels: [...axle(2.45, 0.82, 1), ...axle(-2.35, 0.82, 0)],
    susp: { rest: 0.5, travel: 0.32, stiff: 28, damp: 2.8 }, grip: 1.15, steerMax: 0.5, color: '#111216', color2: '#c9c9c9', plowable: false, heavy: false, intake: 0.8 },
  { id: 'crawler', name: '4x4 Rock Crawler', cls: 'Mid-Weight', body: 'crawler', price: 0, blurb: 'Classic short-wheelbase crawler. Torque for days, climbs anything.',
    mass: 1950, power: 210, top: 37, len: 4.0, wid: 1.9, hgt: 1.75, ride: 0.3, wheelR: 0.48, wheelW: 0.33,
    wheels: [...axle(1.3, 0.85, 1), ...axle(-1.2, 0.85, 0)],
    susp: { rest: 0.6, travel: 0.5, stiff: 26, damp: 2.6 }, grip: 1.49, steerMax: 0.55, color: '#4c6b3c', color2: '#1d1d1d', plowable: false, heavy: false, intake: 1.1 },
  { id: 'suv', name: 'Expedition SUV', cls: 'Mid-Weight', body: 'suv', price: 11000, blurb: 'Comfortable, capable and quick on gravel.',
    mass: 2300, power: 250, top: 44, len: 4.8, wid: 1.98, hgt: 1.85, ride: 0.26, wheelR: 0.44, wheelW: 0.29,
    wheels: [...axle(1.5, 0.86, 1), ...axle(-1.45, 0.86, 0)],
    susp: { rest: 0.55, travel: 0.42, stiff: 28, damp: 2.8 }, grip: 1.36, steerMax: 0.5, color: '#b8b2a5', color2: '#2a2a2a', plowable: false, heavy: false, intake: 1.0 },
  { id: 'pickup', name: 'Pickup Truck', cls: 'Mid-Weight', body: 'pickup', price: 10000, blurb: 'V8 workhorse with a bed full of attitude.',
    mass: 2450, power: 275, top: 45, len: 5.6, wid: 2.0, hgt: 1.85, ride: 0.28, wheelR: 0.46, wheelW: 0.3,
    wheels: [...axle(1.85, 0.88, 1), ...axle(-1.75, 0.88, 0)],
    susp: { rest: 0.58, travel: 0.42, stiff: 28, damp: 2.8 }, grip: 1.36, steerMax: 0.5, color: '#b3261e', color2: '#1d1d1d', plowable: false, heavy: false, intake: 1.0 },
  { id: 'sixbysix', name: '6x6 Luxury Wagon', cls: 'Heavyweight', body: 'sixbysix', price: 24000, blurb: 'A boxy V8 luxury wagon stretched onto a tandem rear axle: portal axles, side pipes and three axles of traction.',
    mass: 4800, power: 420, top: 39, len: 6.4, wid: 2.25, hgt: 2.3, ride: 0.32, wheelR: 0.55, wheelW: 0.36,
    wheels: [...axle(2.2, 0.98, 1), ...axle(-0.9, 0.98, 0), ...axle(-2.3, 0.98, -0.25)],
    susp: { rest: 0.65, travel: 0.48, stiff: 28, damp: 2.9 }, grip: 1.43, steerMax: 0.45, color: '#b7a27a', color2: '#1c1c1c', plowable: true, heavy: true, intake: 1.6 },
  { id: 'dakar', name: 'Dakar Rally Truck', cls: 'Heavyweight', body: 'dakar', price: 32000, blurb: 'A 9-tonne race truck that thinks it is a buggy.',
    mass: 9000, power: 780, top: 45, len: 7.2, wid: 2.5, hgt: 3.0, ride: 0.4, wheelR: 0.66, wheelW: 0.42,
    wheels: [...axle(2.4, 1.05, 1), ...axle(-2.1, 1.05, 0)],
    susp: { rest: 0.75, travel: 0.55, stiff: 26, damp: 2.8 }, grip: 1.43, steerMax: 0.45, color: '#f04e23', color2: '#f7f2e8', plowable: true, heavy: true, intake: 2.0 },
  { id: 'semi', name: 'Semi Truck', cls: 'Heavyweight', body: 'semi', price: 28000, blurb: 'Bobtail tractor unit. Monstrous torque, built like a bridge.',
    mass: 9500, power: 480, top: 37, len: 7.4, wid: 2.5, hgt: 3.3, ride: 0.38, wheelR: 0.55, wheelW: 0.36,
    wheels: [...axle(2.6, 1.05, 1, false), ...axle(-1.4, 1.05, 0), ...axle(-2.75, 1.05, 0)],
    susp: { rest: 0.62, travel: 0.35, stiff: 30, damp: 3.2 }, grip: 1.3, steerMax: 0.42, color: '#2b5aa8', color2: '#d8d8d8', plowable: true, heavy: true, intake: 3.3 },
  { id: 'eightbyeight', name: '8x8 Offroad Beast', cls: 'Juggernaut', body: 'eightbyeight', price: 45000, blurb: 'Four axles, four-wheel steer, zero hesitation.',
    mass: 12500, power: 700, top: 35, len: 8.6, wid: 2.6, hgt: 3.0, ride: 0.42, wheelR: 0.68, wheelW: 0.44,
    wheels: [...axle(3.0, 1.12, 1), ...axle(1.5, 1.12, 0.55), ...axle(-1.6, 1.12, 0), ...axle(-3.1, 1.12, -0.3)],
    susp: { rest: 0.75, travel: 0.55, stiff: 28, damp: 3.0 }, grip: 1.49, steerMax: 0.42, color: '#3e4a3a', color2: '#1b1b1b', plowable: true, heavy: true, intake: 2.4 },
  { id: 'monster', name: 'Monster Truck', cls: 'Juggernaut', body: 'monster', price: 40000, blurb: '66-inch tyres, nitrous and no fear. Crushes cars and trailers.',
    mass: 5200, power: 720, top: 41, len: 5.4, wid: 3.4, hgt: 1.6, ride: 0.75, wheelR: 0.86, wheelW: 0.75,
    wheels: [...axle(1.75, 1.32, 1), ...axle(-1.75, 1.32, -0.6)],
    susp: { rest: 1.05, travel: 0.8, stiff: 22, damp: 2.4 }, grip: 1.55, steerMax: 0.5, color: '#7a2bd6', color2: '#79ff3a', plowable: true, heavy: true, intake: 2.6 },
  { id: 'monster6', name: '6x6 Monster Truck', cls: 'Juggernaut', body: 'monster6', price: 52000, blurb: 'Six 66-inch tyres, a crew cab and a low, wide stance. Same pace as the Monster, but it grips, it pulls and it stays on its wheels.',
    mass: 6900, power: 955, top: 41, len: 7.2, wid: 3.6, hgt: 1.6, ride: 0.7, wheelR: 0.86, wheelW: 0.75,
    wheels: [...axle(2.55, 1.42, 1), ...axle(-0.75, 1.42, 0.1), ...axle(-2.8, 1.42, -0.4)],
    susp: { rest: 1.0, travel: 0.8, stiff: 24, damp: 3.0 }, grip: 1.85, steerMax: 0.5, color: '#d61f3c', color2: '#ffd21a', plowable: true, heavy: true, intake: 2.6,
    torque: 1.6, arb: 2.4, stab: 0.85 },
  { id: 'bus', name: 'School Bus', cls: 'Juggernaut', body: 'bus', price: 30000, blurb: 'Forty seats, one goal. Surprisingly unstoppable.',
    mass: 11000, power: 300, top: 31, len: 11.0, wid: 2.5, hgt: 3.0, ride: 0.3, wheelR: 0.55, wheelW: 0.34,
    wheels: [...axle(3.6, 1.06, 1, false), ...axle(-2.6, 1.06, 0)],
    susp: { rest: 0.6, travel: 0.32, stiff: 30, damp: 3.2 }, grip: 1.24, steerMax: 0.5, color: '#f5b600', color2: '#151515', plowable: true, heavy: true, intake: 1.8 },
  { id: 'tank', name: 'Battle Tank', cls: 'Juggernaut', body: 'tank', special: 'tank', price: 60000, blurb: 'Tracks, neutral pivot steering and 30 tonnes of opinion.',
    mass: 30000, power: 1100, top: 21, len: 7.8, wid: 3.6, hgt: 1.5, ride: 0.18, wheelR: 0.42, wheelW: 0.62,
    wheels: [-2.8, -1.7, -0.6, 0.5, 1.6, 2.7].flatMap((z) => axle(z, 1.45, 0)),
    susp: { rest: 0.55, travel: 0.32, stiff: 34, damp: 4.0 }, grip: 1.61, steerMax: 0, color: '#5d6640', color2: '#2e3324', plowable: true, heavy: true, intake: 1.6 },
  { id: 'dump', name: 'Mining Dump Truck', cls: 'Juggernaut', body: 'dump', price: 75000, blurb: 'A haul truck the size of a house. Fit the dozer plow and the forest becomes a suggestion.',
    mass: 52000, power: 1900, top: 18, len: 10.5, wid: 5.6, hgt: 3.2, ride: 0.6, wheelR: 1.45, wheelW: 1.0,
    wheels: [...axle(3.15, 2.2, 1), ...axle(-2.6, 2.2, 0)],
    susp: { rest: 1.25, travel: 0.6, stiff: 26, damp: 3.4 }, grip: 1.49, steerMax: 0.5, color: '#f2c200', color2: '#2a2a2a', plowable: true, heavy: true, intake: 4.5 },
  { id: 'snake', name: 'THE SNAKE 12x12', cls: 'Secret', body: 'snake', special: 'snake', price: 0, blurb: 'Six single-axle segments on five hydraulic articulation joints: twelve driven wheels that slither over anything. Assembled from four barn finds.',
    mass: 2100, power: 520, top: 37, len: 1.95, wid: 2.3, hgt: 1.9, ride: 0.38, wheelR: 0.56, wheelW: 0.42,
    wheels: [...axle(0, 1.0, 1)],
    susp: { rest: 0.7, travel: 0.55, stiff: 27, damp: 2.8 }, grip: 2.6, steerMax: 0.5, color: '#10261b', color2: '#1d3a28', plowable: true, heavy: true, intake: 2.2, torque: 3.2, cling: 1.6 },
];
export const VEH = Object.fromEntries(VEHICLES.map((v) => [v.id, v])) as Record<string, VehicleDef>;

// ---- upgrades ----
export type UpgradeKey = 'engine' | 'suspension' | 'tires' | 'frame' | 'plow' | 'axles' | 'nitro' | 'snorkel' | 'winch';
export type Compound = 'allterrain' | 'mud' | 'sand' | 'snow';
export interface Upgrades { engine: number; suspension: number; tires: number; compound: Compound; frame: number; plow: number; axles: number; nitro: number; snorkel: number; winch: number; paint?: string }
export const STOCK: Upgrades = { engine: 1, suspension: 1, tires: 1, compound: 'allterrain', frame: 1, plow: 1, axles: 1, nitro: 0, snorkel: 0, winch: 0 };

export const UPGRADE_INFO: Record<UpgradeKey, { name: string; max: number; cost: number[]; desc: string[] }> = {
  engine: { name: 'Engine & Drivetrain', max: 4, cost: [0, 2500, 6000, 12000], desc: ['Stock', 'Hood scoop + ported heads: +18% power', 'Supercharger + big stacks: +38% power, locking diffs', 'Twin turbos: +60% power, +20% top speed'] },
  suspension: { name: 'Suspension', max: 4, cost: [0, 2000, 4500, 9000], desc: ['Stock', 'Sport coilovers: +lift, better landings', 'Long-travel kit: dual coilovers, +articulation', 'Trophy-spec: max lift, bottomless travel'] },
  tires: { name: 'Tires & Wheels', max: 4, cost: [0, 1800, 4000, 8000], desc: ['Stock', '+6% diameter, +10% grip', '+12% diameter, +20% grip', '+20% diameter, +32% grip'] },
  frame: { name: 'Frame & Roll Cage', max: 3, cost: [0, 3000, 7000], desc: ['Stock', 'Roof rails + seam welding: -30% crash damage', 'External steel exo-cage: -60% crash damage'] },
  plow: { name: 'Front Plow / Dozer Blade', max: 3, cost: [0, 3500, 9000], desc: ['Stock bumper', 'Reinforced bull bar: shove rivals harder', 'Heavy steel dozer plow: smash through forest trees'] },
  axles: { name: 'Axles & Skid Plates', max: 3, cost: [0, 2500, 6000], desc: ['Stock', 'HD axles: survive bigger landings', 'Full skid plates + 1-ton axles: canyon-jump proof'] },
  nitro: { name: 'Nitrous Boost', max: 1, cost: [0, 5000], desc: ['None', 'Twin blue NOS bottles + flame exhaust (Shift / N)'] },
  snorkel: { name: 'Roof Snorkel', max: 1, cost: [0, 1500], desc: ['None', 'Raised air intake: no engine stall in deep rivers'] },
  winch: { name: 'Recovery Winch', max: 1, cost: [0, 2000], desc: ['None', 'Front winch: press R to self-recover instantly, no penalty'] },
};
export const COMPOUNDS: Record<Compound, { name: string; cost: number; grip: number[] }> = {
  //                      Asph  Dirt  Grav  Sand  Mud   Snow  Ice   Grass Rock
  allterrain: { name: 'All-Terrain', cost: 0, grip: [1.0, 0.9, 0.85, 0.68, 0.6, 0.6, 0.32, 0.82, 0.9] },
  mud: { name: 'Mud-Bogger', cost: 2500, grip: [0.84, 0.95, 0.85, 0.66, 0.95, 0.68, 0.3, 0.88, 0.85] },
  sand: { name: 'Sand Paddles', cost: 2500, grip: [0.78, 0.84, 0.8, 1.0, 0.55, 0.58, 0.28, 0.75, 0.75] },
  snow: { name: 'Spiked Snow', cost: 2500, grip: [0.86, 0.86, 0.86, 0.62, 0.62, 0.98, 0.85, 0.78, 0.86] },
};
// rolling resistance per surface (fraction of weight)
export const ROLL = [0.012, 0.025, 0.03, 0.11, 0.13, 0.07, 0.01, 0.035, 0.02];

export interface Stats { power: number; top: number; grip: number; rideLift: number; travel: number; stiff: number; damp: number; wheelR: number; damageMul: number; landing: number; nitro: boolean; snorkel: boolean; winch: boolean; plow: number; lockDiff: boolean }
export function stats(d: VehicleDef, u: Upgrades): Stats {
  const e = u.engine - 1, s = u.suspension - 1, t = u.tires - 1;
  const scale = Math.max(0.5, d.wheelR / 0.45);
  return {
    power: d.power * [1, 1.18, 1.38, 1.6][e],
    top: d.top * [1, 1.04, 1.09, 1.2][e],
    grip: d.grip * [1, 1.1, 1.2, 1.32][t],
    rideLift: [0, 0.07, 0.15, 0.26][s] * scale,
    travel: d.susp.travel * [1, 1.15, 1.32, 1.55][s],
    stiff: d.susp.stiff * [1, 1.05, 1.0, 0.95][s],
    damp: d.susp.damp * [1, 1.12, 1.25, 1.4][s],
    wheelR: d.wheelR * [1, 1.06, 1.12, 1.2][t],
    damageMul: [1, 0.7, 0.4][u.frame - 1],
    landing: [9, 14, 22][u.axles - 1],
    nitro: u.nitro > 0, snorkel: u.snorkel > 0, winch: u.winch > 0, plow: d.plowable ? u.plow : 1, lockDiff: u.engine >= 3,
  };
}
