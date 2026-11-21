// Drives every race headless with the AI (bridges included as colliders): npx tsx tools/racesim.ts [raceIds...]
// Env VEH=pickup,buggy picks the vehicles; V=1 prints resets.
import { generateWorld } from '../src/world/finish';
import { sampleH } from '../src/world/gen';
import { CTRL, HALF } from '../src/world/layout';
import { Physics, initRapier, RAPIER, G, groups } from '../src/physics/physics';
import { VEH, STOCK, stats, type Upgrades } from '../src/vehicles/defs';
import { Vehicle } from '../src/vehicles/vehicle';
import { Driver } from '../src/game/ai';
import { buildRaces } from '../src/game/races';
await initRapier();
const w = generateWorld();
const cell = (x: number, z: number) => Math.max(0, Math.min(CTRL - 1, Math.floor((z + HALF) / 4))) * CTRL + Math.max(0, Math.min(CTRL - 1, Math.floor((x + HALF) / 4)));
const env = { surfaceAt: (x: number, z: number) => w.surface[cell(x, z)], waterAt: (x: number, z: number) => w.water[cell(x, z)] };
const phys = new Physics(w.height);
const fixed = phys.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
for (const b of w.bridges) {
  const pts = b.pts ?? [b.a, b.b];
  const segs = b.pts ? pts.length - 1 : Math.ceil(Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1]) / 8);
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const p = b.pts ? pts[i] : [b.a[0] + (b.b[0] - b.a[0]) * t0, b.a[1] + (b.b[1] - b.a[1]) * t0];
    const q = b.pts ? pts[i + 1] : [b.a[0] + (b.b[0] - b.a[0]) * t1, b.a[1] + (b.b[1] - b.a[1]) * t1];
    const y0 = b.pts ? b.ha : b.ha + (b.hb - b.ha) * t0, y1 = b.pts ? b.ha : b.ha + (b.hb - b.ha) * t1;
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]), yaw = Math.atan2(q[0] - p[0], q[1] - p[1]), pitch = -Math.atan2(y1 - y0, L);
    const qq = { x: 0, y: 0, z: 0, w: 1 }; { const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2); qq.x = cy * sp; qq.y = sy * cp; qq.z = -sy * sp; qq.w = cy * cp; }
    phys.world.createCollider(RAPIER.ColliderDesc.cuboid(b.width / 2, 0.3, L / 2 + 0.2).setTranslation((p[0] + q[0]) / 2, (y0 + y1) / 2 - 0.3, (p[1] + q[1]) / 2).setRotation(qq).setCollisionGroups(groups(G.PROP, 0xffff)), fixed);
  }
}
const races = buildRaces(w.roads, w.rivers).filter((r) => process.argv.length < 3 || process.argv.slice(2).includes(r.id));
const vehs = (process.env.VEH ?? 'pickup,buggy').split(',');
let fails = 0;
for (const race of races) {
  for (const id of vehs) {
    const d = VEH[id];
    const up: Upgrades = { ...STOCK, engine: 2, suspension: 2, tires: 2, compound: race.biome === 2 ? 'snow' : race.biome === 0 ? 'sand' : race.biome === 1 ? 'mud' : 'allterrain', snorkel: 1 };
    const st = stats(d, up);
    const [x, z] = race.path[2], [x2, z2] = race.path[6];
    const v = new Vehicle(phys, d, up, st, { x, y: sampleH(w.height, x, z) + st.wheelR + d.susp.rest + 0.4, z }, Math.atan2(x2 - x, z2 - z));
    const drv = new Driver(race.path);
    const fin = race.path[race.path.length - 1];
    let resets = 0, t = 0, done = false; const where: string[] = [];
    const limit = 60 * Math.max(240, race.len / 6);
    for (let k = 0; k < limit; k++) {
      t = k / 60;
      const c = drv.control(v, 1 / 60);
      const p = v.position();
      const lost = p.y < sampleH(w.height, p.x, p.z) - 4 || !Number.isFinite(p.y);
      if (drv.resetReq || lost) { drv.resetReq = false; resets++; where.push(`${p.x.toFixed(0)},${p.z.toFixed(0)}`); const r = drv.resetPose(); v.reset({ x: r.x, y: Math.max(sampleH(w.height, r.x, r.z), (phys.castDown?.(r.x, r.z, sampleH(w.height, r.x, r.z) + 30) ?? -1e9)) + st.wheelR + d.susp.rest + 0.6, z: r.z }, r.yaw); }
      if (process.env.TRACE && k % 30 === 0) { const q = v.position(); console.log('   t', (k / 60).toFixed(1), q.x.toFixed(0), q.z.toFixed(0), 'kmh', v.kmh().toFixed(0), 'idx', drv.idx, 'steer', c.steer.toFixed(2), 'thr', c.throttle.toFixed(2), 'brk', c.brake.toFixed(2), 'up', v.main.up().y.toFixed(2)); }
      v.update(1 / 60, c, env);
      phys.world.step(phys.events);
      phys.events.drainContactForceEvents(() => {});
      if (Math.hypot(p.x - fin[0], p.z - fin[1]) < 18 && drv.progress > drv.length * 0.6) { done = true; break; }
    }
    const ok = done && resets <= 3;
    if (!ok) fails++;
    console.log(`${ok ? '✓' : '✗'} ${race.id.padEnd(22)} ${id.padEnd(8)} ${done ? 'finished' : 'DNF    '} ${t.toFixed(0).padStart(4)}s  ${(race.len / 1000).toFixed(1)}km avg ${(drv.progress / t * 3.6).toFixed(0)}km/h  resets ${resets}${resets && process.env.V ? ' @ ' + where.join(' ') : ''}`);
    v.destroy();
  }
}
console.log(fails ? `${fails} failing run(s)` : 'all races completed');
process.exit(0);
