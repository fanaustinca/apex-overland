// Rapier world: terrain heightfield, fixed-step simulation, collision groups.
import RAPIER from '@dimforge/rapier3d-compat';
import { N, V, CELL, WORLD } from '../world/layout';

export { RAPIER };
// collision groups (membership << 16 | filter)
export const G = { TERRAIN: 1, VEHICLE: 2, TREE: 4, LOG: 8, PROP: 16, WHEELRAY: 32, SNAKE: 64 };
/** everything a vehicle body can hit (Snake segments are their own group so the chain never collides with itself) */
export const VEH_HITS = 2 | 64;
export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);

let inited = false;
export async function initRapier() { if (!inited) { await RAPIER.init(); inited = true; } }

export class Physics {
  world: RAPIER.World;
  terrain: RAPIER.Collider;
  readonly dt = 1 / 60;
  private acc = 0;
  events = new RAPIER.EventQueue(true);
  constructor(height: Float32Array) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = this.dt;
    this.world.integrationParameters.numSolverIterations = 6;
    // Rapier's heightfield is column-major: heights[i * (nrows + 1) + j] with i along X (columns) and j along Z (rows).
    const hf = new Float32Array(V * V);
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) hf[i * V + j] = height[j * V + i];
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const desc = RAPIER.ColliderDesc.heightfield(N, N, hf, { x: WORLD, y: 1, z: WORLD })
      .setFriction(0.9).setCollisionGroups(groups(G.TERRAIN, 0xffff));
    this.terrain = this.world.createCollider(desc, body);
    this.world.step();
    void CELL;
  }
  /** Advance by real time, stepping the fixed timestep. Returns number of steps taken. */
  step(realDt: number, before: (dt: number) => void, after?: (dt: number) => void): number {
    this.acc = Math.min(this.acc + realDt, this.dt * 4);
    let n = 0;
    while (this.acc >= this.dt) {
      before(this.dt);
      this.world.step(this.events);
      after?.(this.dt);
      this.acc -= this.dt; n++;
    }
    return n;
  }
  get alpha() { return this.acc / this.dt; }
  castDown(x: number, z: number, from = 1000): number | null {
    const ray = new RAPIER.Ray({ x, y: from, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, 3000, true, undefined, groups(G.WHEELRAY, G.TERRAIN | G.PROP | G.LOG));
    return hit ? from - hit.timeOfImpact : null;
  }
}
