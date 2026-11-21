import { generateBase, sampleH } from '../src/world/gen';
import { Physics, initRapier } from '../src/physics/physics';
import { VEH, STOCK, stats } from '../src/vehicles/defs';
import { Vehicle } from '../src/vehicles/vehicle';
await initRapier();
const w = generateBase(); const phys = new Physics(w.height);
const env = { surfaceAt: () => 0, waterAt: () => NaN };
const d = VEH.bike, st = stats(d, STOCK);
const v = new Vehicle(phys, d, STOCK, st, { x: 0, y: sampleH(w.height, 0, 60) + 1.0, z: 60 }, 0);
const p = v.main;
for (let k = 0; k < 240; k++) {
  v.update(1 / 60, { throttle: k > 60 ? 1 : 0, brake: 0, steer: k > 150 ? 0.5 : 0, handbrake: false, nitro: false, hop: false }, env);
  phys.world.step();
  if (k % 10 === 0) { const r = p.right(), u = p.up(); console.log(k, 'right.y', r.y.toFixed(3), 'up.y', u.y.toFixed(3), 'contacts', p.wheels.map((x) => +x.contact).join(''), 'kmh', v.kmh().toFixed(0)); }
}
