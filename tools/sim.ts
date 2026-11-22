// Headless vehicle tuning: npx tsx tools/sim.ts <road> [ids...]   (AI drives each vehicle along a road)
import { generateWorld } from '../src/world/finish';
import { sampleH } from '../src/world/gen';
import { CTRL, HALF } from '../src/world/layout';
import { Physics, initRapier } from '../src/physics/physics';
import { VEHICLES, VEH, STOCK, stats } from '../src/vehicles/defs';
import { Vehicle } from '../src/vehicles/vehicle';
import { Driver } from '../src/game/ai';
await initRapier();
const w = generateWorld();
const cell = (x: number, z: number) => Math.max(0, Math.min(CTRL - 1, Math.floor((z + HALF) / 4))) * CTRL + Math.max(0, Math.min(CTRL - 1, Math.floor((x + HALF) / 4)));
const env = { surfaceAt: (x: number, z: number) => w.surface[cell(x, z)], waterAt: (x: number, z: number) => w.water[cell(x, z)] };
const [roadId = 'hub-east', ...rest] = process.argv.slice(2);
const ids = rest.length ? rest : VEHICLES.map((v) => v.id);
const road = w.roads.find((r) => r.id === roadId)!;
const phys = new Physics(w.height);
Vehicle.groundAt = (x, z) => sampleH(w.height, x, z);
for (const id of ids) {
  const d = VEH[id], st = stats(d, STOCK);
  const [x, z] = road.pts[2], [x2, z2] = road.pts[6];
  const yaw = Math.atan2(x2 - x, z2 - z);
  const v = new Vehicle(phys, d, STOCK, st, { x, y: sampleH(w.height, x, z) + st.wheelR + d.susp.rest + 0.3, z }, yaw);
  const drv = new Driver(road.pts);
  let resets = 0, maxS = 0, t = 0, minUp = 1, flips = 0;
  const T = 60 * 60 * 6;
  for (let k = 0; k < T; k++) {
    t = k / 60;
    const c = drv.control(v, 1 / 60);
    if (drv.resetReq) { drv.resetReq = false; resets++; if (process.env.V) { const q = v.position(); console.log('  reset at', q.x.toFixed(0), q.z.toFixed(0), 'prog', drv.progress.toFixed(0)); } const r = drv.resetPose(); v.reset({ x: r.x, y: sampleH(w.height, r.x, r.z) + st.wheelR + d.susp.rest + 0.5, z: r.z }, r.yaw); }
    v.update(1 / 60, c, env);
    phys.world.step(phys.events);
    phys.events.drainContactForceEvents(() => {});
    maxS = Math.max(maxS, v.kmh()); const u = v.main.up().y; if (u < 0.2 && minUp >= 0.2) { flips++; const q = v.position(); if (process.env.V) console.log('  flip at', q.x.toFixed(0), q.z.toFixed(0), 'prog', drv.progress.toFixed(0), 'kmh', v.kmh().toFixed(0), 't', t.toFixed(1)); } minUp = Math.min(minUp, u);
    if (process.env.V && k % 300 === 0) { const q = v.position(); console.log('   t', t.toFixed(0), q.x.toFixed(0), q.z.toFixed(0), 'kmh', v.kmh().toFixed(0), 'prog', drv.progress.toFixed(0), 'contacts', v.main.wheels.map((w) => +w.contact).join('')); }
    if (drv.progress > drv.length - 15) break;
  }
  console.log(`${id.padEnd(13)} ${roadId} ${Math.round(drv.length)}m in ${t.toFixed(1)}s  avg ${(drv.progress / t * 3.6).toFixed(0)} km/h  max ${maxS.toFixed(0)}  resets ${resets} flips ${flips} dmg ${v.axleDamage.toFixed(2)}`);
  v.destroy();
}
