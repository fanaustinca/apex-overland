// A vehicle in the world: physics + visuals (+ optional AI driver), with render interpolation.
import * as THREE from 'three';
import { Vehicle, type Controls, NO_INPUT, type Env } from '../vehicles/vehicle';
import { buildVisual, type VehicleVisual } from '../vehicles/models';
import { stats, type VehicleDef, type Upgrades , modsOf} from '../vehicles/defs';
import type { Physics } from '../physics/physics';
import type { Driver } from './ai';
import { stretch } from '../vehicles/parts';

const DIRT_COLORS = [[0.24, 0.23, 0.22], [0.36, 0.27, 0.18], [0.45, 0.4, 0.33], [0.66, 0.42, 0.28], [0.26, 0.19, 0.12], [0.86, 0.88, 0.92], [0.8, 0.85, 0.9], [0.3, 0.28, 0.18], [0.42, 0.38, 0.34]];

export class VehicleEntity {
  v: Vehicle;
  vis: VehicleVisual[] = [];
  controls: Controls = { ...NO_INPUT };
  driver?: Driver;
  name = 'You';
  isPlayer = false;
  prev: { p: THREE.Vector3; q: THREE.Quaternion }[] = [];
  cur: { p: THREE.Vector3; q: THREE.Quaternion }[] = [];
  dirt = 0; snow = 0;
  private trackOff = [0, 0];
  private tmpA = new THREE.Vector3(); private tmpB = new THREE.Vector3();
  constructor(public phys: Physics, public def: VehicleDef, public up: Upgrades, pos: { x: number; y: number; z: number }, yaw: number, public scene: THREE.Object3D) {
    const st = stats(def, up);
    this.v = new Vehicle(phys, def, up, st, pos, yaw);
    const mods = modsOf(def);
    for (let m = 0; m < mods; m++) {
      const vis = buildVisual(def, up, st, m);
      scene.add(vis.root);
      this.vis.push(vis);
    }
    this.snapshot(); this.snapshot();
  }
  /** Called after each physics step. */
  snapshot() {
    this.v.parts.forEach((p, i) => {
      const t = p.body.translation(), r = p.body.rotation();
      if (!this.cur[i]) { this.cur[i] = { p: new THREE.Vector3(), q: new THREE.Quaternion() }; this.prev[i] = { p: new THREE.Vector3(t.x, t.y, t.z), q: new THREE.Quaternion(r.x, r.y, r.z, r.w) }; }
      else { this.prev[i].p.copy(this.cur[i].p); this.prev[i].q.copy(this.cur[i].q); }
      this.cur[i].p.set(t.x, t.y, t.z); this.cur[i].q.set(r.x, r.y, r.z, r.w);
    });
  }
  step(dt: number, env: Env) {
    this.v.update(dt, this.controls, env);
  }
  /** Interpolated visual sync + cosmetic state. */
  sync(alpha: number, dt: number, particles?: (e: VehicleEntity, wi: number, world: THREE.Vector3, surf: number, slip: number) => void) {
    const v = this.v;
    this.vis.forEach((vis, i) => {
      const part = v.parts[i];
      vis.root.position.lerpVectors(this.prev[i].p, this.cur[i].p, alpha);
      vis.root.quaternion.slerpQuaternions(this.prev[i].q, this.cur[i].q, alpha);
      vis.root.updateMatrixWorld();
      vis.wheels.forEach((w, k) => {
        const ws = part.wheels[k], conn = part.conn[k];
        w.group.position.set(conn.x, conn.y - ws.susp, conn.z);
        w.steer.rotation.y = ws.steer;
        w.spin.rotation.x = ws.rot;
        for (const l of w.links) {
          this.tmpB.copy(l.hub).add(w.group.position);
          stretch(l.obj, l.a, this.tmpB);
        }
      });
      vis.brakeMat.emissiveIntensity = v.brakeOn ? 3.2 : 0.35;
      for (const f of vis.flames) { f.visible = v.boosting; if (v.boosting) f.scale.setScalar(0.8 + Math.random() * 0.5); }
      if (vis.tracks) {
        const spd = part.speed();
        const turn = this.controls.steer;
        for (let s = 0; s < 2; s++) {
          const sv = spd + (s === 0 ? -1 : 1) * turn * 2.5;
          this.trackOff[s] -= sv * dt * 1.3;
          vis.tracks.tex[s].offset.y = this.trackOff[s];
          for (const wg of vis.tracks.wheels[s]) wg.rotation.x += sv * dt / v.st.wheelR;
        }
      }
      // dirt / mud / snow accumulation from the surfaces the tyres touch
      let surf = -1, sum = 0;
      part.wheels.forEach((ws, k) => {
        if (!ws.contact) return;
        surf = ws.surface;
        const slip = Math.abs(part.speed()) > 3 || this.controls.throttle > 0.5 ? 1 : 0;
        sum += slip;
        if (particles && slip && (k % 2 === 0 || part.wheels.length <= 4)) particles(this, k, this.tmpA.set(ws.x, ws.y, ws.z), ws.surface, Math.abs(part.speed()));
      });
      if (surf >= 0 && i === 0) {
        const spd = Math.abs(v.speed());
        const dirty = [0.002, 0.012, 0.008, 0.01, 0.04, 0.0, 0.0, 0.006, 0.004][surf];
        this.dirt = Math.min(1, this.dirt + dirty * spd * dt * 0.06 * (sum ? 1 : 0.2));
        if (surf === 5 || surf === 6) this.snow = Math.min(1, this.snow + spd * dt * 0.004); else this.snow = Math.max(0, this.snow - dt * 0.01);
        if (v.inWater > 0.3) this.dirt = Math.max(0, this.dirt - dt * 0.05);
        const target = DIRT_COLORS[surf];
        const col = vis.dirt.uDirtCol.value;
        if (dirty > 0.004) col.lerp(new THREE.Color(target[0], target[1], target[2]), dt * 0.05 * spd * 0.1);
      }
      vis.dirt.uDirt.value = this.dirt;
      vis.dirt.uSnow.value = this.snow;
    });
  }
  setVisible(b: boolean) { for (const v of this.vis) v.root.visible = b; }
  dispose() {
    this.v.destroy();
    for (const vis of this.vis) { vis.root.removeFromParent(); vis.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }); }
  }
}
