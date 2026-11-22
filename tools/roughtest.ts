// Rough-ground tumble test: npx tsx tools/roughtest.ts <ids...>. Full throttle weaving over random bumps, whoops and side slopes for 60 s, 6 seeds.
import { initRapier, RAPIER, G, groups } from '/home/austin/apex-overland/src/physics/physics';
import { VEH, STOCK, stats } from '/home/austin/apex-overland/src/vehicles/defs';
import { Vehicle } from '/home/austin/apex-overland/src/vehicles/vehicle';
await initRapier();
const env = { surfaceAt: () => 1, waterAt: () => NaN };
const N = 257, S = 2;
for (const id of process.argv.slice(2)) {
  let rolls = 0, dist = 0, maxSpd = 0;
  for (let seed = 1; seed <= 6; seed++) {
    let r = seed * 9301; const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
    const bumps = Array.from({ length: 160 }, () => [rnd() * N * S - N, rnd() * N * S - N, 0.6 + rnd() * 1.8, 4 + rnd() * 10]);
    const H = (x: number, z: number) => { let h = 0.35 * Math.sin(x * 0.35) * Math.sin(z * 0.31) + 1.2 * Math.sin(x * 0.05 + seed) ; for (const b of bumps) { const d = ((x - b[0]) ** 2 + (z - b[1]) ** 2) / (b[3] * b[3]); if (d < 4) h += b[2] * Math.exp(-d * 2); } return h; };
    const hts = new Float32Array(N * N);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) hts[i * N + j] = H(-N + j * S, -N + i * S);  // column-major: x index = i
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); world.timestep = 1 / 60;
    const gb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const h2 = new Float32Array(N * N); for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) h2[j * N + i] = H(-N + j * S, -N + i * S);
    world.createCollider(RAPIER.ColliderDesc.heightfield(N - 1, N - 1, h2, { x: (N - 1) * S, y: 1, z: (N - 1) * S }).setFriction(0.9).setCollisionGroups(groups(G.TERRAIN, 0xffff)), gb);
    const d = VEH[id], st = stats(d, STOCK);
    const v = new Vehicle({ world, castDown: () => 0 } as any, d, STOCK, st, { x: 0, y: H(0, 0) + st.wheelR + d.susp.rest + 0.5, z: -200 }, 0);
    Vehicle.groundAt = H;
    let last = v.position(), upT = 0;
    for (let k = 0; k < 60 * 60; k++) {
      const p = v.position();
      if (Math.abs(p.z) > 230 || Math.abs(p.x) > 230) v.reset({ x: 0, y: H(0, -200) + 2.5, z: -200 }, 0);
      v.update(1 / 60, { throttle: 1, brake: 0, steer: Math.sin(k / 60 * 0.9 + seed) * 0.7, handbrake: false, nitro: false, hop: false }, env);
      world.step();
      const q = v.position(); dist += Math.min(5, Math.hypot(q.x - last.x, q.z - last.z)); last = { ...q }; maxSpd = Math.max(maxSpd, v.kmh());
      if (v.main.up().y < 0.25) { upT++; if (upT === 20) { rolls++; v.reset({ x: q.x, y: H(q.x, q.z) + 3, z: q.z }, Math.atan2(v.main.forward().x, v.main.forward().z)); upT = 0; } } else upT = 0;
    }
    v.destroy();
  }
  console.log(`${id.padEnd(10)} rollovers ${rolls} in 6 min | avg ${(dist / 360 * 3.6).toFixed(0)} km/h`);
}
