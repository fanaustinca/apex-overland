// Wall-climb benchmark: npx tsx tools/climbtest.ts <vehicle ids...>
// From a standstill at the foot, a ramp that curves up (10 deg steps every 5 m) into a 40 m face of the given steepness. Reports the height reached.
import { initRapier, RAPIER, G, groups } from '/home/austin/apex-overland/src/physics/physics';
import { VEH, STOCK, stats } from '/home/austin/apex-overland/src/vehicles/defs';
import { Vehicle, type Controls } from '/home/austin/apex-overland/src/vehicles/vehicle';
await initRapier();
const env = { surfaceAt: () => +(process.env.SURF ?? 1), waterAt: () => NaN };
const C = (o: Partial<Controls>): Controls => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, hop: false, ...o });
const angles = (process.env.ANG ?? '45,60,70,80').split(',').map(Number);
for (const id of process.argv.slice(2)) {
  const row: string[] = [];
  for (const deg of angles) {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); world.timestep = 1 / 60;
    const gb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const seg = (z: number, y: number, a: number, len: number) => {
      // slab whose top surface runs from (z,y) for len metres at angle a
      const cz = z + Math.cos(a) * len / 2 + Math.sin(a) * 0.5, cy = y + Math.sin(a) * len / 2 - Math.cos(a) * 0.5;
      world.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.5, len / 2).setTranslation(0, cy, cz).setRotation({ x: -Math.sin(a / 2), y: 0, z: 0, w: Math.cos(a / 2) }).setFriction(0.9).setCollisionGroups(groups(G.TERRAIN, 0xffff)), gb);
      return [z + Math.cos(a) * len, y + Math.sin(a) * len];
    };
    let [z, y] = seg(-60, 0, 0, 100);
    for (let a = 10; a < deg; a += 10) [z, y] = seg(z, y, a * Math.PI / 180, 5);
    const [zt, top] = seg(z, y, deg * Math.PI / 180, 40);
    seg(zt, top, 0, 60);   // a plateau on top
    const d = { ...VEH[id], ...JSON.parse(process.env.OVR ?? '{}') }, st = stats(d, STOCK);
    const v = new Vehicle({ world, castDown: () => 0 } as any, d, STOCK, st, { x: 0, y: st.wheelR + d.susp.rest + 0.2, z: 40 - 6 - d.len / 2 }, 0);
    let maxY = 0;
    for (let k = 0; k < 60 * 25; k++) { v.update(1 / 60, C(k > 30 ? { throttle: 1 } : {}), env); world.step(); maxY = Math.max(maxY, v.position().y); if (process.env.TRACE && k % 20 === 0) { const p = v.position(); console.log((k / 60).toFixed(1), p.x.toFixed(1), p.y.toFixed(1), p.z.toFixed(1), v.kmh().toFixed(0), v.parts.map((q) => q.up().y.toFixed(2) + (q.wheels.filter((w) => w.contact).length)).join(" ")); } }
    const fell = v.position().y < maxY - 5;
    row.push(`${deg}°: ${maxY.toFixed(0)}/${top.toFixed(0)} m end ${v.position().y.toFixed(0)}${maxY > top - 3 ? ' TOP' : fell ? ' fell' : ''}`);
    v.destroy();
  }
  console.log(id.padEnd(10), row.join('  |  '));
}
