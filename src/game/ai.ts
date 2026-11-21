// AI driver: pure-pursuit steering along a polyline with curvature-based speed planning and recovery.
import type { Vehicle, Controls } from '../vehicles/vehicle';
import type { P2 } from '../world/layout';
import { resample } from '../world/gen';

export class Driver {
  pts: P2[];
  cum: Float32Array;
  vmax: Float32Array;       // speed limit from curvature (m/s), before the vehicle's grip scaling
  idx = 0;
  stuckT = 0; reverseT = 0; resetReq = false;
  skill = 1;                 // scales target speeds (rubber band)
  constructor(path: P2[], public aggression = 1) {
    this.pts = resample(path, 3);
    const n = this.pts.length;
    this.cum = new Float32Array(n);
    for (let i = 1; i < n; i++) this.cum[i] = this.cum[i - 1] + Math.hypot(this.pts[i][0] - this.pts[i - 1][0], this.pts[i][1] - this.pts[i - 1][1]);
    this.vmax = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = this.pts[Math.max(0, i - 4)], b = this.pts[i], c = this.pts[Math.min(n - 1, i + 4)];
      const a1 = Math.atan2(b[1] - a[1], b[0] - a[0]), a2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
      let da = Math.abs(a2 - a1); if (da > Math.PI) da = Math.PI * 2 - da;
      const ds = Math.max(1, Math.hypot(c[0] - a[0], c[1] - a[1]));
      const k = da / ds;
      this.vmax[i] = Math.min(60, Math.sqrt(9.81 / Math.max(k, 1e-4)));
    }
  }
  get progress() { return this.cum[this.idx]; }
  get length() { return this.cum[this.cum.length - 1]; }

  control(v: Vehicle, dt: number): Controls {
    const p = v.position(), n = this.pts.length;
    // advance the progress index (search a window ahead)
    let best = this.idx, bd = 1e9;
    for (let i = Math.max(0, this.idx - 5); i < Math.min(n, this.idx + 40); i++) {
      const d = (this.pts[i][0] - p.x) ** 2 + (this.pts[i][1] - p.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    this.idx = best;
    const spd = v.speed();
    const look = Math.max(9, Math.min(40, 7 + Math.abs(spd) * 0.75 + v.def.len * 0.4));
    let ti = this.idx; while (ti < n - 1 && this.cum[ti] - this.cum[this.idx] < look) ti++;
    const t = this.pts[ti];
    const f = v.main.forward(), r = v.main.right();
    const dx = t[0] - p.x, dz = t[1] - p.z;
    const lz = dx * f.x + dz * f.z, lx = -(dx * r.x + dz * r.z);   // lx > 0: target to the left
    const ang = Math.atan2(lx, Math.max(0.1, lz));
    let steer = Math.max(-1, Math.min(1, ang * 2.4));
    // speed planning over the next stretch
    const grip = v.st.grip / 1.4;
    const brakeA = 6.5 * grip;
    let target = v.st.top * 0.98;
    for (let i = this.idx; i < n && this.cum[i] - this.cum[this.idx] < 160; i += 2) {
      const vc = this.vmax[i] * Math.sqrt(grip) * 1.05 * this.aggression;
      const d = this.cum[i] - this.cum[this.idx];
      target = Math.min(target, Math.sqrt(vc * vc + 2 * brakeA * d));
    }
    target *= this.skill;
    if (Math.sqrt(bd) > 14) target = Math.min(target, 14);   // off the line: slow and rejoin
    let throttle = spd < target ? Math.min(1, (target - spd) * 0.5 + 0.35) : 0;
    let brake = spd > target + 1.5 ? Math.min(1, (spd - target) * 0.25) : 0;
    // recovery
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      return { throttle: 0, brake: 1, steer: -steer, handbrake: false, nitro: false, hop: false };
    }
    if (Math.abs(spd) < 1.2 && throttle > 0.3) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 2.5) { this.stuckT = 0; this.reverseT = 1.4; this.stuckCount++; }
    if (this.stuckCount >= 3 || v.flippedT > 1.5 || Math.sqrt(bd) > 60) { this.resetReq = true; this.stuckCount = 0; }
    const nitro = v.st.nitro && spd > 15 && Math.abs(steer) < 0.15 && target > spd + 5;
    return { throttle, brake, steer, handbrake: Math.abs(ang) > 1.2 && spd > 8, nitro, hop: false };
  }
  stuckCount = 0;
  /** Where to put the car back after a reset: a little behind the current progress point, facing along the path. */
  private lastReset = -999;
  resetPose(): { x: number; z: number; yaw: number } {
    // reset again at the same spot (a missed jump, a hole): move on past the obstacle instead of looping
    let i = Math.min(this.pts.length - 2, this.idx + 2);
    if (Math.abs(i - this.lastReset) < 15) i = Math.min(this.pts.length - 2, Math.max(i, this.lastReset) + 25);
    this.lastReset = i; this.idx = i;
    const a = this.pts[i], b = this.pts[i + 1];
    return { x: a[0], z: a[1], yaw: Math.atan2(b[0] - a[0], b[1] - a[1]) };
  }
}
