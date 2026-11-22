// Flat-ground handling benchmark: npx tsx tools/vtest.ts <vehicle ids...>
// 0-60/0-100 km/h, top speed, full-lock yaw rate at 30 km/h and standstill, sustained full-lock cornering at speed (rolled? drift angle), U-turn self-tangle for the Snake.
import { initRapier, RAPIER, G, groups } from '/home/austin/apex-overland/src/physics/physics';
import { VEH, STOCK, stats } from '/home/austin/apex-overland/src/vehicles/defs';
import { Vehicle, type Controls } from '/home/austin/apex-overland/src/vehicles/vehicle';
await initRapier();
const env = { surfaceAt: () => +(process.env.SURF ?? 1), waterAt: () => NaN };
function mk(id: string) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); world.timestep = 1 / 60;
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(3000, 1, 3000).setTranslation(0, -1, 0).setFriction(0.9).setCollisionGroups(groups(G.TERRAIN, 0xffff)), ground);
  const d = VEH[id], st = stats(d, STOCK);
  const v = new Vehicle({ world, castDown: () => 0 } as any, d, STOCK, st, { x: 0, y: st.wheelR + d.susp.rest + 0.2, z: 0 }, 0);
  return { world, v };
}
const C = (o: Partial<Controls>): Controls => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, hop: false, ...o });
for (const id of process.argv.slice(2)) {
  // straight line
  let { world, v } = mk(id);
  let t60 = NaN, t100 = NaN, top = 0;
  for (let k = 0; k < 60 * 40; k++) { if (k > 30) v.update(1 / 60, C({ throttle: 1 }), env); else v.update(1 / 60, C({}), env); world.step(); const s = v.kmh(); top = Math.max(top, s); const t = (k - 30) / 60; if (isNaN(t60) && s >= 60) t60 = t; if (isNaN(t100) && s >= 100) t100 = t; }
  v.destroy();
  // pivot / low-speed yaw
  ({ world, v } = mk(id));
  for (let k = 0; k < 60; k++) { v.update(1 / 60, C({}), env); world.step(); }
  let yaw0 = 0, yawStand = 0;
  for (let k = 0; k < 240; k++) { v.update(1 / 60, C({ steer: 1, throttle: VEH[id].special === 'tank' ? 0 : 0.35 }), env); world.step(); if (k >= 120) yawStand += Math.abs(v.body.angvel().y) / 120; }
  v.destroy();
  // sustained full lock from 60 km/h with throttle: does it roll / spin?
  ({ world, v } = mk(id));
  let rolled = false, maxDrift = 0, minUp = 1, yawFast = 0;
  for (let k = 0; k < 60 * 14; k++) {
    const s = v.kmh(); const ph = k > 60 * 6;
    v.update(1 / 60, C(ph ? { throttle: 1, steer: Math.sin(k / 60 * 2.2) > 0 ? 1 : -1 } : { throttle: s < 70 ? 1 : 0 }), env); world.step();
    if (ph) { const lv = v.body.linvel(), f = v.main.forward(); const sp = Math.hypot(lv.x, lv.z); if (sp > 3) { const ang = Math.acos(Math.max(-1, Math.min(1, (lv.x * f.x + lv.z * f.z) / sp / Math.hypot(f.x, f.z)))); maxDrift = Math.max(maxDrift, ang * 57.3); } minUp = Math.min(minUp, ...v.parts.map((p) => p.up().y)); yawFast = Math.max(yawFast, Math.abs(v.body.angvel().y)); }
    if (v.parts.some((p) => p.up().y < 0.3)) rolled = true;
  }
  v.destroy();
  let tangle = '';
  if (VEH[id].special === 'snake') {
    ({ world, v } = mk(id));
    let stuck = 0, dist = 0, last = v.position();
    for (let k = 0; k < 60 * 30; k++) { v.update(1 / 60, C({ throttle: 0.7, steer: k > 120 ? 1 : 0 }), env); world.step(); const p = v.position(); dist += Math.hypot(p.x - last.x, p.z - last.z); last = { ...p }; if (k > 300 && v.kmh() < 2) stuck++; }
    tangle = ` | U-turn circle 30s: travelled ${dist.toFixed(0)} m, stuck ${(stuck / 60).toFixed(1)} s`;
    v.destroy();
  }
  console.log(`${id.padEnd(13)} 0-60 ${t60.toFixed(1)}s 0-100 ${t100.toFixed(1)}s top ${top.toFixed(0)} | yaw@crawl ${yawStand.toFixed(2)} rad/s | slalom ${rolled ? 'ROLLED' : 'ok'} minUp ${minUp.toFixed(2)} drift ${maxDrift.toFixed(0)}° yaw ${yawFast.toFixed(2)}${tangle}`);
}
