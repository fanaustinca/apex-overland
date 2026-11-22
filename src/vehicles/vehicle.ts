// Vehicle dynamics on top of Rapier's ray-cast vehicle controller. DOM-free so node tools can simulate it.
import { RAPIER, G, groups, VEH_HITS, type Physics } from '../physics/physics';
import { COMPOUNDS, ROLL, SNAKE_GAP, modsOf, type VehicleDef, type Upgrades, type Stats } from './defs';

export interface Controls { throttle: number; brake: number; steer: number; handbrake: boolean; nitro: boolean; hop: boolean }
export const NO_INPUT: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, hop: false };
export interface Env { surfaceAt(x: number, z: number): number; waterAt(x: number, z: number): number }

type V3 = { x: number; y: number; z: number };
const qRot = (q: { x: number; y: number; z: number; w: number }, v: V3): V3 => {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y, iy = q.w * v.y + q.z * v.x - q.x * v.z, iz = q.w * v.z + q.x * v.y - q.y * v.x, iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return { x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y, y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z, z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x };
};

export interface WheelState { contact: boolean; susp: number; rot: number; steer: number; surface: number; slip: number; x: number; y: number; z: number; water: boolean }

export class Chassis {
  body: RAPIER.RigidBody;
  ctrl: RAPIER.DynamicRayCastVehicleController;
  colliders: RAPIER.Collider[] = [];
  wheels: WheelState[];
  conn: { x: number; y: number; z: number }[] = [];
  driven: boolean[];
  steerF: number[];
  constructor(public phys: Physics, public def: VehicleDef, public st: Stats, pos: V3, yaw: number, mass: number) {
    const W = phys.world, d = def;
    const y0 = d.ride + st.rideLift;
    const h = d.hgt, L = d.len, Wd = d.wid;
    const comY = d.special === 'bike' ? y0 + 0.2 : Math.min(0, y0 * 0.2) - 0.12 - (d.arb ? 0.3 : 0);
    const inertia = { x: mass / 12 * (h * h + L * L) * 1.1, y: mass / 12 * (Wd * Wd + L * L), z: mass / 12 * (Wd * Wd + h * h) * 1.6 };
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      .setAdditionalMassProperties(mass, { x: 0, y: comY, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 })
      .setLinearDamping(0.02).setAngularDamping(d.special === 'bike' ? 1.2 : 0.35).setCanSleep(false).setCcdEnabled(d.special !== 'tank');
    this.body = W.createRigidBody(desc);
    // Snake segments: member SNAKE only, so they hit other vehicles (which filter SNAKE) but never each other
    const grp = groups(d.special === 'snake' ? G.SNAKE : G.VEHICLE, G.TERRAIN | VEH_HITS | G.TREE | G.LOG | G.PROP);
    const mk = (hx: number, hy: number, hz: number, y: number, z = 0) => {
      const c = W.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(0, y, z).setDensity(0).setFriction(0.5).setRestitution(0.1)
        .setCollisionGroups(grp).setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(mass * 4), this.body);
      this.colliders.push(c);
    };
    if (d.special === 'bike') { mk(0.18, 0.3, L * 0.42, y0 + 0.35); mk(0.2, 0.25, 0.3, y0 + 0.95, -0.2); }
    else if (d.special === 'tank') { mk(Wd / 2, 0.55, L / 2, y0 + 0.55); mk(1.2, 0.4, 1.8, y0 + 1.5, -0.2); }
    else { mk(Wd / 2 - 0.05, h * 0.25, L / 2, y0 + h * 0.25); mk(Wd / 2 - 0.12, h * 0.25, L * 0.32, y0 + h * 0.72, 0); }
    this.ctrl = W.createVehicleController(this.body);
    this.ctrl.indexUpAxis = 1;
    this.ctrl.setIndexForwardAxis = 2;
    const rest = d.susp.rest, n = d.wheels.length;
    const sag = 9.81 / (n * st.stiff);
    this.wheels = d.wheels.map((w, i) => {
      const cy = rest - sag;   // wheel centre sits on the nominal plane (y=0) under static load
      this.conn.push({ x: w.x, y: cy, z: w.z });
      this.ctrl.addWheel({ x: w.x, y: cy, z: w.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, rest, st.wheelR);
      this.ctrl.setWheelSuspensionStiffness(i, st.stiff);
      this.ctrl.setWheelSuspensionCompression(i, st.damp * 0.8);
      this.ctrl.setWheelSuspensionRelaxation(i, st.damp);
      this.ctrl.setWheelMaxSuspensionTravel(i, st.travel);
      this.ctrl.setWheelMaxSuspensionForce(i, mass * 9.81 * 6);
      this.ctrl.setWheelFrictionSlip(i, st.grip);
      this.ctrl.setWheelSideFrictionStiffness(i, d.special === 'tank' ? 0.45 : 1.0);
      return { contact: false, susp: rest, rot: 0, steer: 0, surface: 1, slip: 0, x: 0, y: 0, z: 0, water: false };
    });
    this.driven = d.wheels.map((w) => w.drive);
    this.steerF = d.wheels.map((w) => w.steer);
  }
  forward(): V3 { return qRot(this.body.rotation(), { x: 0, y: 0, z: 1 }); }
  up(): V3 { return qRot(this.body.rotation(), { x: 0, y: 1, z: 0 }); }
  right(): V3 { return qRot(this.body.rotation(), { x: -1, y: 0, z: 0 }); }
  speed(): number { const v = this.body.linvel(), f = this.forward(); return v.x * f.x + v.y * f.y + v.z * f.z; }
  destroy() { this.phys.world.removeVehicleController(this.ctrl); this.phys.world.removeRigidBody(this.body); }
}

/** single-axle snake segments steer their axle by this fraction of the yaw difference to the segment ahead */
export let SNAKE_FOLLOW = 1.0, SNAKE_PITCH_K = 6;
export const setSnakePitch = (k: number) => { SNAKE_PITCH_K = k; };
export const setSnakeFollow = (k: number) => { SNAKE_FOLLOW = k; };
export class Vehicle {
  /** ground height lookup (set by the game / tools) so every module of an articulated vehicle spawns on its own patch of ground */
  static groundAt: ((x: number, z: number) => number) | null = null;
  private static modY(pos: V3, x: number, z: number) { const g = Vehicle.groundAt; return g ? pos.y - g(pos.x, pos.z) + Math.max(g(x, z), g(x + 1.2, z), g(x - 1.2, z), g(x, z + 1.2), g(x, z - 1.2)) + (x !== pos.x || z !== pos.z ? 0.35 : 0) : pos.y; }
  parts: Chassis[] = [];
  joints: RAPIER.ImpulseJoint[] = [];
  rpm = 900; gear = 1; nitro = 1; boosting = false; damage = 0; stalled = -2; airTime = 0; lastLandV = 0;
  plowHits = 0; inWater = 0; onGround = false; flippedT = 0; throttle = 0; brakeOn = false; mass: number;
  lastLanding = 0; axleDamage = 0; lastAir = 0;
  constructor(public phys: Physics, public def: VehicleDef, public up: Upgrades, public st: Stats, pos: V3, yaw: number) {
    const mods = modsOf(def);
    this.mass = def.mass * mods;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    for (let m = 0; m < mods; m++) {
      const off = m * (def.len + SNAKE_GAP);
      const x = pos.x - fx * off, z = pos.z - fz * off;
      this.parts.push(new Chassis(phys, def, st, { x, y: Vehicle.modY(pos, x, z), z }, yaw, def.mass));
    }
    for (let m = 0; m < mods - 1; m++) {
      const a = this.parts[m], b = this.parts[m + 1];
      const y = def.ride + st.rideLift + 0.4;
      const jd = RAPIER.JointData.spherical({ x: 0, y, z: -def.len / 2 - SNAKE_GAP / 2 }, { x: 0, y, z: def.len / 2 + SNAKE_GAP / 2 });
      const j = phys.world.createImpulseJoint(jd, a.body, b.body, true);
      j.setContactsEnabled(false);
      this.joints.push(j);
    }
  }
  get main() { return this.parts[0]; }
  get body() { return this.parts[0].body; }
  position(): V3 { return this.main.body.translation(); }
  speed(): number { return this.main.speed(); }
  kmh(): number { return Math.abs(this.speed()) * 3.6; }

  update(dt: number, c: Controls, env: Env) {
    const d = this.def, st = this.st;
    const speed = this.speed(), aspd = Math.abs(speed);
    const nParts = this.parts.length;
    // ---- engine / gearbox ----
    const healthMul = 1 - Math.min(0.45, this.damage * 0.45) - Math.min(0.15, this.axleDamage * 0.15);
    let wantNitro = c.nitro && st.nitro && this.nitro > 0.02 && c.throttle > 0.1 && this.stalled <= 0;
    this.boosting = wantNitro;
    if (wantNitro) this.nitro = Math.max(0, this.nitro - dt * 0.22); else this.nitro = Math.min(1, this.nitro + dt * (st.nitro ? 0.045 : 0));
    const top = st.top * (wantNitro ? 1.18 : 1) * (1 - this.axleDamage * 0.12);
    const power = st.power * 1000 * healthMul * (wantNitro ? 1.65 : 1) * (this.stalled > 0 ? 0 : 1);
    const reversing = c.brake > 0.1 && speed < 1.0 && c.throttle < 0.1;
    let drive = 0;
    if (c.throttle > 0.01 && !reversing) {
      const vEff = Math.max(aspd, 4);
      drive = Math.min(power / vEff, this.mass * 9.81 * (d.special === 'bike' ? 0.75 : 1.25)) * c.throttle;
      if (d.torque) {
        // extra torque: pull up grades and through mud without changing flat-ground acceleration
        const climb = Math.max(0, this.main.forward().y);
        drive += (d.torque - 1) * this.mass * 9.81 * (climb + ROLL[this.main.wheels[0].surface]) * c.throttle;
      }
      drive *= Math.max(0, Math.min(1, (top - speed) / (top * 0.12)));
    } else if (reversing) {
      drive = -Math.min(power / Math.max(aspd, 4), this.mass * 9.81 * 0.7) * c.brake * 0.55;
      drive *= Math.max(0, Math.min(1, (12 + speed) / 2));
    }
    this.throttle = c.throttle;
    const gears = [0, 0.16, 0.3, 0.46, 0.63, 0.8, 1.0];
    const frac = aspd / top;
    let g = 1; while (g < 6 && frac > gears[g] * 0.97) g++;
    this.gear = speed < -0.5 ? -1 : g;
    const lo = gears[g - 1], hi = gears[g];
    const target = 900 + (Math.min(1, Math.max(0, (frac - lo) / Math.max(0.01, hi - lo))) * 0.75 + 0.25 * c.throttle) * 5600;
    this.rpm += (target - this.rpm) * Math.min(1, dt * 8);
    // ---- brakes ----
    const braking = c.brake > 0.05 && speed > 0.5;
    this.brakeOn = braking || c.handbrake;
    // ---- per-chassis ----
    let anyContact = false;
    const totalDriven = this.parts.reduce((s, p) => s + p.driven.filter(Boolean).length, 0);
    for (let pi = 0; pi < nParts; pi++) {
      const p = this.parts[pi];
      const ctrl = p.ctrl, n = p.wheels.length;
      const pspd = p.speed();
      // steering softens with speed
      // speed-sensitive steering: never ask for more lateral grip than the tyres have (plus a little for drifts)
      const wb = Math.max(1.2, Math.max(...d.wheels.map((w) => w.z)) - Math.min(...d.wheels.map((w) => w.z)));
      const latCap = 1.35 * Math.atan(wb * st.grip * 9.81 * 0.95 / Math.max(1, pspd * pspd));
      const steerAmt = c.steer * Math.min(d.steerMax, Math.max(d.steerMax * 0.1, latCap));
      const isTank = d.special === 'tank';
      for (let i = 0; i < n; i++) {
        const w = p.wheels[i];
        let sf = pi === 0 ? p.steerF[i] : 0;
        w.steer = steerAmt * sf;
        if (pi > 0) {
          // articulated modules steer their axles to follow the hitch ahead (front axle toward it, rear axle counter-steers)
          const fa = this.parts[pi - 1].forward(), fb = p.forward();
          let yd = Math.atan2(fa.x, fa.z) - Math.atan2(fb.x, fb.z);
          if (yd > Math.PI) yd -= Math.PI * 2; if (yd < -Math.PI) yd += Math.PI * 2;
          w.steer = Math.max(-0.6, Math.min(0.6, d.wheels.length <= 2 ? yd * SNAKE_FOLLOW : d.wheels[i].z > 0 ? yd * 1.1 : -yd * 0.6));
          sf = 1;
        }
        ctrl.setWheelSteering(i, w.steer);
        let f = p.driven[i] ? drive / totalDriven : 0;
        if (isTank) {
          const side = d.wheels[i].x > 0 ? 1 : -1;      // +x = left
          const pivot = Math.abs(c.throttle) < 0.1 && !reversing;
          const base = Math.min(power / Math.max(aspd, 3), this.mass * 9.81) / n;
          const turn = c.steer * base * (pivot ? 0.9 : 0.55);
          f = (pivot ? 0 : drive / n) + side * -turn;
        }
        ctrl.setWheelEngineForce(i, f);
        const bf = braking ? c.brake * this.mass * 1.4 / n : 0;
        const hb = c.handbrake && (d.wheels[i].z < 0 || isTank) ? this.mass * 1.6 / n : 0;
        ctrl.setWheelBrake(i, (bf + hb) / 60);
        // surface grip
        let grip = st.grip * COMPOUNDS[this.up.compound].grip[w.surface];
        if (c.handbrake && d.wheels[i].z < 0) grip *= 0.55;
        if (w.water) grip *= 0.8;
        ctrl.setWheelFrictionSlip(i, grip * (this.st.lockDiff ? 1.05 : 1));
      }
      ctrl.updateVehicle(dt, undefined, groups(G.WHEELRAY, G.TERRAIN | G.LOG | G.PROP | VEH_HITS), (col) => !this.parts.some((pp) => pp.colliders.includes(col)));
      // read wheel state, surfaces, rolling resistance, water
      const b = p.body, lv = b.linvel();
      let contacts = 0, rollF = 0, waterDepth = 0;
      for (let i = 0; i < n; i++) {
        const w = p.wheels[i];
        w.contact = ctrl.wheelIsInContact(i);
        w.susp = ctrl.wheelSuspensionLength(i) ?? d.susp.rest;
        w.rot = ctrl.wheelRotation(i) ?? 0;
        if (w.contact) {
          const cp = ctrl.wheelContactPoint(i);
          if (cp) {
            w.x = cp.x; w.y = cp.y; w.z = cp.z;
            w.surface = env.surfaceAt(cp.x, cp.z);
            const wl = env.waterAt(cp.x, cp.z);
            w.water = !Number.isNaN(wl) && wl > cp.y + 0.05;
            if (w.water) waterDepth = Math.max(waterDepth, wl - cp.y);
          }
          contacts++;
          rollF += ROLL[w.surface] * (w.water ? 1.6 : 1);
        } else w.water = false;
      }
      if (contacts) {
        anyContact = true;
        const v = Math.hypot(lv.x, lv.z);
        if (v > 0.3) {
          const m = d.mass * 9.81 * rollF / n;
          const s = Math.min(m * dt, b.mass() * v * 0.5) / v;
          b.applyImpulse({ x: -lv.x * s, y: 0, z: -lv.z * s }, true);
        }
      }
      // water: drag + engine stall when the intake goes under
      if (waterDepth > 0.15) {
        const k = Math.min(1, waterDepth / 1.2) * 0.9;
        b.applyImpulse({ x: -lv.x * d.mass * k * dt, y: 0, z: -lv.z * d.mass * k * dt }, true);
        if (pi === 0 && !st.snorkel && waterDepth > d.intake * 0.85 + st.rideLift && this.stalled <= -1.5) this.stalled = 2.0;   // stall, re-fire, maybe stall again
      }
      if (pi === 0) this.inWater = waterDepth;
      // stability: keep it on its wheels (arcade anti-roll), air control
      const upv = p.up(), fw = p.forward(), av = b.angvel();
      const I = b.mass();
      if (d.special === 'bike') {
        // keep the bike up and lean into turns (positive steer = left turn = lean left = positive roll)
        const right = p.right();
        const roll = Math.asin(Math.max(-1, Math.min(1, right.y)));
        const wRoll = -(av.x * fw.x + av.y * fw.y + av.z * fw.z);
        const target = c.steer * Math.min(1, Math.abs(pspd) / 10) * 0.6;
        const Iroll = d.mass / 12 * (d.wid * d.wid + d.hgt * d.hgt) * 1.6;
        const acc = 70 * (target - roll) - 14 * wRoll;
        const tq = -Iroll * acc * dt;
        b.applyTorqueImpulse({ x: fw.x * tq, y: fw.y * tq, z: fw.z * tq }, true);
        if (c.hop && contacts >= 1 && this.airTime === 0) { b.applyImpulse({ x: 0, y: I * 4.6, z: 0 }, true); }
        // wheelie control: nose-down torque when only the rear wheel is down, pitch-rate damping always
        const r = p.right();
        const pitchRate = av.x * r.x + av.y * r.y + av.z * r.z;
        const Ipitch = d.mass / 12 * (d.hgt * d.hgt + d.len * d.len);
        const wheelie = !p.wheels[0].contact && p.wheels[1].contact ? 1 : 0;
        const pt = (-pitchRate * (contacts ? 6 : 1.5) + wheelie * Math.max(0, fw.y) * 25) * Ipitch * dt;
        b.applyTorqueImpulse({ x: r.x * pt, y: r.y * pt, z: r.z * pt }, true);
      } else if (upv.y > 0.2 && contacts > 0) {
        // anti-roll: oppose roll rate proportional to mass
        const rollRate = av.x * fw.x + av.y * fw.y + av.z * fw.z;
        const k = -rollRate * I * dt * 1.2;
        b.applyTorqueImpulse({ x: fw.x * k, y: fw.y * k, z: fw.z * k }, true);
      }
      if (!contacts && pi === 0 && d.special !== 'bike') {
        // gentle air control (pitch with throttle/brake, roll with steer) like every good arcade racer
        const r = p.right();
        const pitch = (c.throttle - c.brake) * I * dt * 1.4, rollC = -c.steer * I * dt * 0.9;
        b.applyTorqueImpulse({ x: r.x * pitch + fw.x * rollC, y: r.y * pitch + fw.y * rollC, z: r.z * pitch + fw.z * rollC }, true);
      }
      if (isTank && contacts) {
        // track steering: a yaw-rate controller on the real yaw inertia (the 12 road wheels' side grip fights a pivot hard).
        // ~70 deg/s on the spot, easing to ~30 deg/s at full speed; reversing turns the way the hull points.
        const Iy = d.mass / 12 * (d.wid * d.wid + d.len * d.len);
        const want = c.steer * (1.25 - 0.7 * Math.min(1, Math.abs(pspd) / 18)) * (pspd < -0.5 ? -1 : 1);
        const wy = av.x * upv.x + av.y * upv.y + av.z * upv.z;
        const yawT = (want - wy) * Iy * Math.min(1, dt * 14) * (Math.abs(c.steer) > 0.05 ? 1 : 0.5);
        b.applyTorqueImpulse({ x: upv.x * yawT, y: upv.y * yawT, z: upv.z * yawT }, true);
      }
      if (d.arb && contacts >= 2 && upv.y > 0.2) {
        // anti-roll bars: resist the left/right suspension difference on every axle (keeps the body flat over bumps and in turns)
        let diff = 0;
        for (let i = 0; i + 1 < n; i += 2) if (p.wheels[i].contact || p.wheels[i + 1].contact) diff += p.wheels[i].susp - p.wheels[i + 1].susp;
        const k = -diff / (n / 2) * d.mass * 9.81 * d.arb * dt;     // wheel i = left (+x): shorter = compressed; +torque about forward lifts the left side
        b.applyTorqueImpulse({ x: fw.x * k, y: fw.y * k, z: fw.z * k }, true);
        // extra roll-rate damping
        const rr = av.x * fw.x + av.y * fw.y + av.z * fw.z, kd = -rr * I * dt * 2.5;
        b.applyTorqueImpulse({ x: fw.x * kd, y: fw.y * kd, z: fw.z * kd }, true);
      }
      if (d.stab && contacts >= 2 && pi === 0 && Math.abs(pspd) > 4 && !c.handbrake) {
        // yaw stability: let the truck rotate as fast as the steering asks (plus a margin), bleed off anything beyond that
        const wy = av.x * upv.x + av.y * upv.y + av.z * upv.z;
        const ask = Math.abs(pspd * Math.tan(Math.abs(steerAmt)) / wb) * 1.2 + 0.15;
        const over = Math.sign(wy) * Math.max(0, Math.abs(wy) - ask);
        const Iy = d.mass / 12 * (d.wid * d.wid + d.len * d.len);
        const yt = -over * Iy * Math.min(1, dt * 10) * d.stab;
        b.applyTorqueImpulse({ x: upv.x * yt, y: upv.y * yt, z: upv.z * yt }, true);
        // and pull the velocity back toward the heading (kills slides)
        const lat = { x: lv.x - fw.x * pspd, z: lv.z - fw.z * pspd };
        const kk = Math.min(1, dt * 3 * d.stab) * b.mass();
        b.applyImpulse({ x: -lat.x * kk * 0.5, y: 0, z: -lat.z * kk * 0.5 }, true);
      }
    }
    // snake: hydraulic hinges. Yaw is free (damped), pitch is a stiff spring so the chain flexes over crests but no
    // single-axle segment can somersault, roll is held firm.
    for (let m = 1; m < nParts; m++) {
      const pa = this.parts[m - 1], pb = this.parts[m], a = pa.body, b = pb.body;
      const ua = pa.up(), ub = pb.up(), fa = pa.forward(), fb = pb.forward(), ra = pa.right();
      const cr = (p: V3, q: V3) => ({ x: p.y * q.z - p.z * q.y, y: p.z * q.x - p.x * q.z, z: p.x * q.y - p.y * q.x });
      const dot = (p: V3, q: V3) => p.x * q.x + p.y * q.y + p.z * q.z;
      const rollErr = dot(cr(ub, ua), fa), pitchErr = dot(cr(fb, fa), ra);
      const wa = a.angvel(), wb = b.angvel(), dw = { x: wb.x - wa.x, y: wb.y - wa.y, z: wb.z - wa.z };
      const I = d.mass * (d.len * d.len + d.hgt * d.hgt) / 12;
      const kr = (rollErr * d.mass * 9.81 * 3.0 - dot(dw, fa) * I * 8) * dt;
      const kp = (pitchErr * d.mass * 9.81 * SNAKE_PITCH_K - dot(dw, ra) * I * 6) * dt;
      const t = { x: fa.x * kr + ra.x * kp, y: fa.y * kr + ra.y * kp, z: fa.z * kr + ra.z * kp };
      b.applyTorqueImpulse(t, true); a.applyTorqueImpulse({ x: -t.x, y: -t.y, z: -t.z }, true);
      // fold limit: past ~50 deg the hydraulics stiffen so a tight U-turn can't jackknife the chain into itself
      let yerr = Math.atan2(fa.x, fa.z) - Math.atan2(fb.x, fb.z);
      if (yerr > Math.PI) yerr -= Math.PI * 2; if (yerr < -Math.PI) yerr += Math.PI * 2;
      const lim = 0.87, ex = Math.sign(yerr) * Math.max(0, Math.abs(yerr) - lim);
      if (ex) { const ky = ex * d.mass * 9.81 * 4 * dt; b.applyTorqueImpulse({ x: 0, y: ky, z: 0 }, true); a.applyTorqueImpulse({ x: 0, y: -ky, z: 0 }, true); }
      const dyaw = (wb.y - wa.y) * d.mass * dt * 0.8;
      b.applyTorqueImpulse({ x: 0, y: -dyaw, z: 0 }, true); a.applyTorqueImpulse({ x: 0, y: dyaw, z: 0 }, true);
    }
    // numerical guard: a constraint blow-up must never fling modules across the map
    for (const p of this.parts) { const v = p.body.linvel(), sp = Math.hypot(v.x, v.y, v.z); if (sp > 75) { const k = 20 / sp; p.body.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true); p.body.setAngvel({ x: 0, y: 0, z: 0 }, true); } }
    // airtime + landings
    const vy = this.body.linvel().y;
    if (!anyContact) { this.airTime += dt; this.lastLandV = Math.min(this.lastLandV, vy); }
    else {
      if (this.airTime > 0.35 && -this.lastLandV > st.landing) { this.axleDamage = Math.min(1, this.axleDamage + (-this.lastLandV - st.landing) * 0.05); this.lastLanding = -this.lastLandV; }
      if (this.airTime > 0) this.lastAir = this.airTime;
      this.airTime = 0; this.lastLandV = 0;
    }
    this.onGround = anyContact;
    if (this.stalled > -1.5) this.stalled -= dt;
    const upv = this.main.up();
    this.flippedT = upv.y < 0.3 && aspd < 3 ? this.flippedT + dt : 0;
  }

  addDamage(impulse: number) {
    const dmg = impulse / (this.mass * 18) * this.st.damageMul;
    if (dmg > 0.01) this.damage = Math.min(1, this.damage + dmg * 0.3);
  }

  /** Place the vehicle (and trailing modules) on the ground facing `yaw`. */
  reset(pos: V3, yaw: number) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    this.parts.forEach((p, m) => {
      const off = m * (this.def.len + SNAKE_GAP);
      const x = pos.x - fx * off, z = pos.z - fz * off;
      p.body.setTranslation({ x, y: Vehicle.modY(pos, x, z), z }, true);
      p.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
      p.body.setLinvel({ x: 0, y: 0, z: 0 }, true); p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    });
    this.flippedT = 0; this.stalled = -2; this.airTime = 0; this.lastLandV = 0;
  }
  destroy() { for (const j of this.joints) this.phys.world.removeImpulseJoint(j, true); for (const p of this.parts) p.destroy(); }
}
