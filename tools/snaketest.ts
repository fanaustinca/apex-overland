// Flat-ground Snake handling check: npx tsx tools/snaketest.ts [steer]  (prints every segment's position, height and uprightness)
import { initRapier, RAPIER, G, groups } from '/home/austin/apex-overland/src/physics/physics';
import { VEH, STOCK, stats } from '/home/austin/apex-overland/src/vehicles/defs';
import { Vehicle } from '/home/austin/apex-overland/src/vehicles/vehicle';
await initRapier();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); world.timestep = 1 / 60;
const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
world.createCollider(RAPIER.ColliderDesc.cuboid(500, 1, 500).setTranslation(0, -1, 0).setCollisionGroups(groups(G.TERRAIN, 0xffff)), ground);
const phys: any = { world, castDown: () => 0 };
const d = VEH.snake, st = stats(d, STOCK);
const v = new Vehicle(phys, d, STOCK, st, { x: 0, y: st.wheelR + d.susp.rest + 0.3, z: 0 }, 0);
const env = { surfaceAt: () => 0, waterAt: () => NaN };
const steer = +(process.argv[2] ?? 0);
for (let k = 0; k < 60 * 8; k++) {
  v.update(1 / 60, { throttle: k > 60 ? 1 : 0, brake: 0, steer: k > 180 ? steer : 0, handbrake: false, nitro: false, hop: false }, env);
  world.step();
  if (k % 30 === 0) console.log((k / 60).toFixed(1), v.parts.map((p) => { const t = p.body.translation(); return `${t.x.toFixed(1)},${t.z.toFixed(1)} y${t.y.toFixed(2)} u${p.up().y.toFixed(2)}`; }).join(' | '), 'kmh', v.kmh().toFixed(0));
}
