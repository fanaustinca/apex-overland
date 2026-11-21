// Procedural vehicle models: 16 body styles + the 3-module Snake, with every upgrade visible on the mesh.
import * as THREE from 'three';
import type { VehicleDef, Upgrades, Stats } from './defs';
import { vehicleMats, sharedMats, type VehicleMats, type DirtUniforms } from './materials';
import { box, cyl, sphere, tube, tubePath, profileBody, withArches, sidePanel, glassQuad, mergeStatic, mesh, windowTrim, type P } from './parts';
import { liveryTexture, plateTexture } from './livery';
import { dirtify } from './materials';
import { wheelGeos } from './wheels';

export interface WheelVis { group: THREE.Group; steer: THREE.Group; spin: THREE.Group; x: number; z: number; side: number; links: { obj: THREE.Object3D; a: THREE.Vector3; hub: THREE.Vector3; kind: 'coil' | 'arm' }[] }
export interface VehicleVisual {
  root: THREE.Group; body: THREE.Group; wheels: WheelVis[];
  brakeMat: THREE.MeshStandardMaterial; exhausts: THREE.Vector3[]; flames: THREE.Mesh[]; dirt: DirtUniforms;
  tracks?: { tex: THREE.Texture[]; wheels: THREE.Group[][] }; turret?: THREE.Object3D;
  frontZ: number; rearZ: number; plowW: number; bodyBottom: number; bodyTop: number; mats: VehicleMats;
  hinge?: { front?: THREE.Vector3; rear?: THREE.Vector3 };
}

interface Anch { hood: [number, number, number]; cab: [number, number, number, number]; front: number; rear: number; bumperY: number; lightY: number; exhaust: number[][]; stacks?: boolean; nosAt: number[]; snorkelZ: number; roofY: number; open?: boolean }

const RIM_COLORS = [0xbfc3c8, 0x1c1c1e, 0xb08d57, 0x4a4d52];

export function buildVisual(d: VehicleDef, up: Upgrades, st: Stats, module = 0): VehicleVisual {
  const mats = vehicleMats(up.paint ?? d.color, d.color2, d.body === 'snake' ? 0x111214 : RIM_COLORS[up.tires - 1], d.body === 'snake' ? 0.7 : up.tires === 2 ? 0.4 : 0.9);
  const s = sharedMats();
  const root = new THREE.Group(); root.name = d.id;
  const body = new THREE.Group(); root.add(body);
  const y0 = d.ride + st.rideLift;              // body bottom above the wheel-centre plane
  const R = st.wheelR;
  const L = d.len, W = d.wid;
  const wz = d.wheels.map((w) => w.z);
  let a: Anch;
  const style = ({ sedan: 'rally', buggy: 'rally', limo: 'stripe', crawler: 'band', suv: 'band', pickup: 'stripe', monster: 'rally', sixbysix: 'camo', dakar: 'rally', semi: 'stripe', eightbyeight: 'camo', bus: 'plain', tank: 'camo', dump: 'plain', snake: 'snake', bike: 'rally' } as const)[d.body];
  const num = [8, 88, 0, 80, 18, 8, 11, 38, 0, 88, 8, 80, 0, 8, 88, 0][Math.abs(d.id.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7)) % 16];
  const livTex = liveryTexture({ base: up.paint ?? d.color, accent: d.color2, style, num, L: L * 1.15, H: Math.max(1.2, d.hgt + 0.6) });
  const livery = dirtify(new THREE.MeshPhysicalMaterial({ map: livTex, metalness: 0.45, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 2.2 }), mats.dirt);
  const ctx: Ctx = { d, up, st, mats, s, body, y0, R, L, W, wz, livery };
  switch (d.body) {
    case 'bike': a = bike(ctx); break;
    case 'buggy': a = buggy(ctx); break;
    case 'sedan': a = sedan(ctx); break;
    case 'limo': a = limo(ctx); break;
    case 'crawler': a = crawler(ctx); break;
    case 'suv': a = suv(ctx); break;
    case 'pickup': a = pickup(ctx, false); break;
    case 'monster': a = pickup(ctx, true); break;
    case 'sixbysix': a = sixbysix(ctx); break;
    case 'dakar': a = dakar(ctx); break;
    case 'semi': a = semi(ctx); break;
    case 'eightbyeight': a = eightbyeight(ctx); break;
    case 'bus': a = bus(ctx); break;
    case 'tank': a = tank(ctx); break;
    case 'dump': a = dump(ctx); break;
    case 'snake': a = snakeModule(ctx, module); break;
  }
  if (d.body !== 'bike' && d.body !== 'tank') underbody(ctx, a);
  const flames: THREE.Mesh[] = [];
  upgradesVisual(ctx, a, flames);
  // lights
  const brake = mats.brake;
  if (d.body !== 'tank' || true) lights(ctx, a, brake);
  mergeStatic(body);
  // wheels
  const wheels: WheelVis[] = [];
  const tracked = d.special === 'tank';
  const g = wheelGeos(R, d.wheelW * (up.tires >= 3 ? 1.08 : 1), tracked ? 'allterrain' : up.compound, up.tires, d.body === 'monster');
  for (const wd of d.wheels) {
    const group = new THREE.Group(); group.position.set(wd.x, 0, wd.z);
    const steer = new THREE.Group(); group.add(steer);
    const spin = new THREE.Group(); steer.add(spin);
    const side = wd.x >= 0 ? 1 : -1;
    if (tracked) {
      const rw = mesh(new THREE.CylinderGeometry(R, R, d.wheelW * 0.8, 20).rotateZ(Math.PI / 2), mats.rim, spin);
      const hubc = mesh(new THREE.CylinderGeometry(R * 0.35, R * 0.35, d.wheelW * 0.85, 10).rotateZ(Math.PI / 2), s.steel, spin); void rw; void hubc;
    } else {
      const tire = mesh(g.tire, mats.rubber, spin);
      const rim = mesh(g.rim, mats.rim, spin); rim.scale.x = side;
      const disc = mesh(g.disc, s.steel, steer); disc.position.x = -side * d.wheelW * 0.18; void tire;
      if (d.wheelW > 0.2) { const cal = box(steer, mats.brake.clone(), 0.08, R * 0.3, R * 0.35, -side * d.wheelW * 0.22, R * 0.22, 0); (cal.material as THREE.MeshStandardMaterial).emissiveIntensity = 0; (cal.material as THREE.MeshStandardMaterial).color.set(up.engine >= 3 ? 0xd41f1f : 0x333333); }
    }
    root.add(group);
    const wv: WheelVis = { group, steer, spin, x: wd.x, z: wd.z, side, links: [] };
    if (!tracked && d.body !== 'bike') suspensionLinks(ctx, wv, root);
    wheels.push(wv);
  }
  let tracks: VehicleVisual['tracks'];
  if (tracked) tracks = tankTracks(ctx, root, wheels);
  const turret = root.getObjectByName('turret') ?? undefined;
  const exhausts = a.exhaust.map((e) => new THREE.Vector3(e[0], e[1], e[2]));
  for (const f of flames) root.add(f);
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, body, wheels, brakeMat: brake, exhausts, flames, dirt: mats.dirt, tracks, turret, frontZ: a.front, rearZ: a.rear, plowW: W * 1.12, bodyBottom: y0, bodyTop: a.roofY, mats,
    hinge: d.body === 'snake' ? { front: module > 0 ? new THREE.Vector3(0, y0 + 0.4, L / 2 + 0.55) : undefined, rear: module < 2 ? new THREE.Vector3(0, y0 + 0.4, -L / 2 - 0.55) : undefined } : undefined };
}

interface Ctx { d: VehicleDef; up: Upgrades; st: Stats; mats: VehicleMats; s: ReturnType<typeof sharedMats>; body: THREE.Group; y0: number; R: number; L: number; W: number; wz: number[]; livery?: THREE.Material }

// ---------- shared detail builders ----------
function lights(c: Ctx, a: Anch, brake: THREE.MeshStandardMaterial) {
  const { body, s, W } = c;
  const hx = W / 2 - Math.min(0.32, W * 0.18);
  if (c.d.body === 'bike') return;
  for (const side of [-1, 1]) {
    const hl = cyl(body, s.headlight, 0.11 * Math.min(1.4, W / 1.8), 0.05, side * hx, a.lightY, a.front + 0.005, 'z', 18);
    hl.castShadow = false;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.115 * Math.min(1.4, W / 1.8), 0.02, 6, 18), s.chrome); rim.position.set(side * hx, a.lightY, a.front + 0.01); body.add(rim);
    const tl = box(body, brake, 0.26, 0.12, 0.04, side * (W / 2 - 0.2), a.lightY + 0.05, a.rear - 0.01, 0.02); tl.castShadow = false;
    box(body, s.amber, 0.12, 0.06, 0.03, side * (W / 2 - 0.12), a.lightY - 0.13, a.front + 0.004, 0.01);
  }
}

function underbody(c: Ctx, a: Anch) {
  const { body, mats, y0, W, wz, L } = c;
  // frame rails and diffs
  const zf = Math.max(...wz) + 0.3, zr = Math.min(...wz) - 0.3;
  for (const side of [-1, 1]) box(body, mats.under, 0.12, 0.16, zf - zr, side * W * 0.27, y0 - 0.02, (zf + zr) / 2);
  const axles = [...new Set(wz.map((z) => +z.toFixed(2)))];
  for (const z of axles) {
    sphere(body, mats.under, 0.17 + 0.05 * (c.up.axles - 1), 0, Math.max(0.05, y0 - 0.25), z, 1, 0.9, 1);
    box(body, mats.under, W * 0.5, 0.07, 0.08, 0, y0 - 0.06, z);
  }
  void a; void L;
}

function suspensionLinks(c: Ctx, w: WheelVis, root: THREE.Group) {
  const { s, mats, y0, st, up, d } = c;
  const side = w.side;
  const inner = side * Math.max(0.2, Math.abs(w.x) - Math.max(0.35, d.wheelW * 0.5 + 0.18));
  // lower control arm from frame to hub
  const armGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 8);
  const arm = new THREE.Mesh(armGeo, mats.frame); arm.castShadow = true; root.add(arm);
  w.links.push({ obj: arm, a: new THREE.Vector3(inner, Math.max(-0.05, y0 - 0.15), w.z), hub: new THREE.Vector3(side * Math.max(0.05, d.wheelW * 0.1), -0.08, 0), kind: 'arm' });
  // coilovers: count grows with the suspension tier
  const n = up.suspension >= 3 ? 2 : 1;
  for (let k = 0; k < n; k++) {
    const zoff = n === 2 ? (k ? 0.13 : -0.13) : 0;
    const grp = new THREE.Group();
    const springMat = s.spring[up.suspension - 1];
    const body2 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 10), s.shock); grp.add(body2);
    const coils = 7;
    const helix: THREE.Vector3[] = [];
    for (let i = 0; i <= coils * 12; i++) { const t = i / (coils * 12), an = t * coils * Math.PI * 2; helix.push(new THREE.Vector3(Math.cos(an) * 0.065, t - 0.5, Math.sin(an) * 0.065)); }
    const spring = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix), coils * 12, up.suspension >= 2 ? 0.016 : 0.012, 5), springMat);
    spring.scale.set(1, 0.7, 1); spring.position.y = 0.1; grp.add(spring);
    root.add(grp);
    grp.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
    w.links.push({ obj: grp, a: new THREE.Vector3(side * Math.max(0.15, Math.abs(w.x) - d.wheelW * 0.65 - 0.12), y0 + 0.35 + st.rideLift * 0.5, w.z + zoff), hub: new THREE.Vector3(-side * d.wheelW * 0.25, 0.08, zoff), kind: 'coil' });
  }
}

function rider(c: Ctx, x: number, y: number, z: number, lean = 0) {
  const { body, s } = c;
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.x = lean; body.add(g);
  box(g, s.suit, 0.38, 0.55, 0.26, 0, 0.3, 0, 0.1);
  sphere(g, s.helmet, 0.15, 0, 0.72, 0.02, 1, 1.05, 1.1);
  sphere(g, s.visor, 0.12, 0, 0.73, 0.1, 1.1, 0.6, 0.7);
  for (const sd of [-1, 1]) { tube(g, s.suit, [sd * 0.2, 0.5, 0], [sd * 0.24, 0.25, 0.35], 0.06); }
  return g;
}

function upgradesVisual(c: Ctx, a: Anch, flames: THREE.Mesh[]) {
  const { body, s, mats, up, W, d, st } = c;
  const [hz, hy, hl] = a.hood;
  // engine tiers
  if (up.engine >= 2 && d.body !== 'bike' && d.body !== 'tank') box(body, mats.paint2, Math.min(0.7, W * 0.35), 0.12, Math.min(0.9, hl * 0.5), 0, hy + 0.06, hz, 0.04, -0.05);
  if (up.engine >= 3 && d.body !== 'tank') {
    const bw = Math.min(0.62, W * 0.32);
    box(body, s.chrome, bw, 0.22, 0.5, 0, hy + 0.2, hz + 0.05, 0.05);
    box(body, s.chrome, bw * 0.8, 0.16, 0.3, 0, hy + 0.38, hz + 0.1, 0.04);
    for (const sd of [-1, 1]) cyl(body, s.chrome, 0.06, 0.06, sd * 0.12, hy + 0.48, hz + 0.1, 'y', 14);
    // big stacks
    if (a.stacks || d.cls === 'Heavyweight' || d.cls === 'Juggernaut') {
      for (const sd of [-1, 1]) {
        const x = sd * (W / 2 - 0.12), z = a.cab[1] - 0.15;
        cyl(body, s.chrome, 0.09, a.roofY + 0.6 - c.y0, x, (a.roofY + 0.6 + c.y0) / 2, z, 'y', 16);
        a.exhaust.push([x, a.roofY + 0.62, z]);
      }
    } else {
      for (const e of a.exhaust) cyl(body, s.chrome, 0.075, 0.25, e[0], e[1], e[2] - 0.06, 'z', 14);
    }
  }
  if (up.engine >= 4 && d.body !== 'tank') {
    for (const sd of [-1, 1]) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.07, 10, 18), s.chrome); t.position.set(sd * Math.min(W / 2 - 0.15, 0.55), hy + 0.12, hz + hl * 0.32); t.rotation.y = Math.PI / 2; body.add(t);
      cyl(body, s.chrome, 0.06, 0.4, sd * Math.min(W / 2 - 0.15, 0.55), hy + 0.12, hz + hl * 0.32 + 0.22, 'z', 12);
      tube(body, s.chrome, [sd * Math.min(W / 2 - 0.15, 0.55), hy + 0.12, hz + hl * 0.32 - 0.1], [sd * 0.15, hy + 0.3, hz], 0.045);
    }
    box(body, s.steel, Math.min(W * 0.7, 1.4), 0.3, 0.06, 0, a.bumperY + 0.25, a.front + 0.02, 0.02);
  }
  // frame / cage
  const [cz0, cz1, cTop, cw] = a.cab;
  if (up.frame >= 2 && !a.open && d.body !== 'bike') {
    for (const sd of [-1, 1]) tubePath(body, s.steel, [[sd * cw * 0.42, cTop + 0.02, cz0 + 0.1], [sd * cw * 0.42, cTop + 0.1, cz0 + 0.2], [sd * cw * 0.42, cTop + 0.1, cz1 - 0.2], [sd * cw * 0.42, cTop + 0.02, cz1 - 0.1]], 0.025);
    const bar = box(body, s.headlight, cw * 0.6, 0.06, 0.06, 0, cTop + 0.12, cz1 - 0.15, 0.02); bar.castShadow = false;
    box(body, s.steel, cw * 0.66, 0.1, 0.1, 0, cTop + 0.07, cz1 - 0.15, 0.02);
  }
  if (up.frame >= 3 && d.body !== 'bike') {
    const x = cw / 2 + 0.06, r = 0.045;
    for (const sd of [-1, 1]) {
      tubePath(body, s.steel, [[sd * x, c.y0 + 0.35, cz1 + 0.35], [sd * x, cTop + 0.12, cz1 - 0.15], [sd * x, cTop + 0.14, cz0 + 0.12], [sd * x, c.y0 + 0.4, cz0 - 0.05]], r);
      tube(body, s.steel, [sd * x, cTop + 0.13, (cz0 + cz1) / 2], [sd * x, c.y0 + 0.4, (cz0 + cz1) / 2], r);
      tube(body, s.steel, [sd * x, c.y0 + 0.35, cz1 + 0.35], [sd * x, c.y0 + 0.4, cz0 - 0.05], r);
    }
    for (const z of [cz1 - 0.15, cz0 + 0.12, (cz0 + cz1) / 2]) tube(body, s.steel, [-x, cTop + 0.13, z], [x, cTop + 0.13, z], r);
    tube(body, s.steel, [-x, cTop + 0.13, cz1 - 0.15], [x, cTop + 0.13, cz0 + 0.12], r * 0.8);
  }
  // front: bumper / bull bar / dozer plow
  const fz = a.front, by = a.bumperY;
  if (st.plow <= 1 || !d.plowable) {
    if (d.body !== 'bike' && d.body !== 'buggy') box(body, mats.trim, W * 0.98, 0.22, 0.22, 0, by, fz + 0.06, 0.05);
  } else if (st.plow === 2) {
    box(body, s.steel, W * 1.0, 0.26, 0.24, 0, by, fz + 0.1, 0.05);
    const tz = fz + 0.3;
    tubePath(body, s.steel, [[-W * 0.36, by + 0.1, fz + 0.2], [-W * 0.32, by + 0.55, tz], [W * 0.32, by + 0.55, tz], [W * 0.36, by + 0.1, fz + 0.2]], 0.05);
    for (const x of [-0.18, 0.18]) tube(body, s.steel, [x * W, by + 0.12, fz + 0.22], [x * W, by + 0.55, tz], 0.04);
  } else {
    const bw = W * 1.12, bh = Math.max(0.9, (a.roofY - c.y0) * 0.42), bz = fz + 0.55;
    const curve = new THREE.Shape();
    curve.moveTo(0, 0);
    for (let k = 0; k <= 10; k++) { const t = k / 10, an = -0.2 + t * 1.5; curve.lineTo(-Math.sin(an) * bh * 0.45 + bh * 0.1, t * bh); }
    curve.lineTo(-0.12, bh); curve.lineTo(-0.12, 0); curve.closePath();
    const g = new THREE.ExtrudeGeometry(curve, { depth: bw, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 });
    g.translate(0, 0, -bw / 2); g.rotateY(-Math.PI / 2);
    const blade = mesh(g, s.blade, body); blade.position.set(0, Math.max(0.05 - c.R, c.y0 - c.R * 0.9), bz);
    box(body, s.steel, bw, 0.08, 0.1, 0, blade.position.y + 0.03, bz + 0.12, 0.02);   // cutting edge
    for (const x of [-0.3, 0.3]) {
      box(body, s.steel, 0.14, 0.14, 0.8, x * W, by, fz + 0.2, 0.03);
      tube(body, s.shock, [x * W * 0.6, by + 0.25, fz - 0.1], [x * W * 0.8, blade.position.y + bh * 0.7, bz - 0.05], 0.06);
      tube(body, s.chrome, [x * W * 0.6, by + 0.25, fz - 0.1], [x * W * 0.7, by + 0.5, fz + 0.15], 0.035);
    }
  }
  // skid plates / axles
  if (up.axles >= 3 && d.body !== 'bike') box(body, s.blade, W * 0.8, 0.04, Math.min(2.0, c.L * 0.35), 0, c.y0 - 0.05, fz - Math.min(1.0, c.L * 0.2), 0.02);
  // winch
  if (up.winch && d.body !== 'bike') { cyl(body, s.steel, 0.1, W * 0.35, 0, by + 0.02, fz + 0.18, 'x', 14); box(body, s.chrome, 0.2, 0.1, 0.05, 0, by + 0.02, fz + 0.3, 0.02); sphere(body, s.amber, 0.04, 0, by + 0.02, fz + 0.34); }
  // snorkel
  if (up.snorkel && d.body !== 'bike' && !a.open) {
    const sx = W / 2 + 0.04, z0 = a.snorkelZ;
    tubePath(body, mats.trim, [[sx, hy - 0.05, z0 + 0.25], [sx, hy + 0.1, z0], [sx, a.roofY + 0.25, z0 - 0.2]], 0.065);
    box(body, mats.trim, 0.18, 0.16, 0.26, sx - 0.02, a.roofY + 0.3, z0 - 0.15, 0.05);
  }
  // nitrous bottles + flames
  if (up.nitro) {
    const [nx, ny, nz] = a.nosAt;
    for (const sd of [-1, 1]) {
      const b = cyl(body, s.nos, 0.09, 0.75, nx + sd * 0.12, ny, nz, 'z', 16);
      sphere(body, s.nos, 0.09, nx + sd * 0.12, ny, nz + 0.37); void b;
      cyl(body, s.chrome, 0.03, 0.08, nx + sd * 0.12, ny, nz - 0.42, 'z', 8);
    }
    for (const e of a.exhaust) {
      const m = new THREE.MeshBasicMaterial({ color: 0x7fb4ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.9, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.45), m);
      f.position.set(e[0], e[1], e[2]);
      if (e[1] > a.roofY) { f.rotation.x = -Math.PI / 2; }
      f.visible = false; f.userData.keep = true; f.castShadow = false;
      flames.push(f);
    }
  }
}

function flares(c: Ctx, zs: number[], scale = 1) {
  const ar = arches(c);
  const r = ar.r + 0.04, a0 = Math.asin(Math.max(-1, Math.min(1, -ar.y / r)));
  for (const z of [...new Set(zs.map((q) => +q.toFixed(2)))]) for (const sd of [-1, 1]) {
    const g = new THREE.TorusGeometry(r, 0.075 * scale, 6, 20, Math.PI - 2 * a0);
    g.rotateZ(a0); g.scale(1, 1, 1.6); g.rotateY(Math.PI / 2);
    const m = mesh(g, c.mats.trim, c.body); m.position.set(sd * (c.W / 2 + 0.03), c.y0 + ar.y, z);
  }
}
function seams(c: Ctx, zs: number[], y0: number, y1: number) {
  for (const z of zs) for (const sd of [-1, 1]) box(c.body, c.mats.trim, 0.006, y1 - y0, 0.012, sd * (c.W / 2 + 0.004), c.y0 + (y0 + y1) / 2, z);
}
function plates(c: Ctx, front: number, rear: number, y: number) {
  const t = plateTexture(['AO-88', 'OVR 4X4', 'DUNE 01', 'APEX 7', 'MUD 42'][c.d.id.length % 5]);
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.4, metalness: 0.2 });
  for (const [z, ry] of [[front + 0.012, 0], [rear - 0.012, Math.PI]] as const) { const p = mesh(new THREE.PlaneGeometry(0.52, 0.13), m, c.body); p.position.set(0, y, z); p.rotation.y = ry; }
}

// ---------- body styles ----------
function arches(c: Ctx) { return { r: c.R + 0.08 + c.st.rideLift * 0.2, y: -c.y0 }; }

function sedan(c: Ctx): Anch {
  const { body, mats, s, W, y0, wz, L } = c;
  const k = L / 4.4;
  const top: P[] = [[-2.2, 0.12], [-2.27, 0.45], [-2.2, 0.74], [-1.6, 0.8], [-1.05, 1.3], [0.3, 1.36], [1.0, 0.86], [2.02, 0.72], [2.25, 0.5], [2.2, 0.12]].map(([z, y]) => [z * k, y] as P);
  const ar = arches(c);
  profileBody(withArches(top, wz, ar.r, ar.y), W, 0.12, mats.paint, body, y0, c.livery);
  windowTrim([[-1.45, 0.84], [-1.0, 1.25], [0.27, 1.3], [0.88, 0.88]].map(([z, y]) => [z * k, y] as P), W - 0.08, s.glass, mats.trim, body, y0);
  glassQuad([0.3 * k, 1.36], [1.0 * k, 0.86], W * 0.84, s.glass, body, y0);
  glassQuad([-1.6 * k, 0.8], [-1.05 * k, 1.3], W * 0.8, s.glass, body, y0);
  box(body, mats.paint, 0.06, 0.48, 0.1, W / 2 - 0.05, y0 + 1.05, -0.38 * k, 0.02); box(body, mats.paint, 0.06, 0.48, 0.1, -W / 2 + 0.05, y0 + 1.05, -0.38 * k, 0.02);
  // rally kit: wing, hood light pod, mud flaps, grille, mirrors, livery stripe
  box(body, mats.paint2, W * 0.9, 0.04, 0.32, 0, y0 + 1.0, -2.05 * k, 0.015, 0.08);
  for (const sd of [-1, 1]) box(body, mats.trim, 0.04, 0.22, 0.14, sd * W * 0.36, y0 + 0.88, -2.05 * k);
  box(body, mats.trim, W * 0.55, 0.14, 0.05, 0, y0 + 0.44, 2.24 * k, 0.03);
  box(body, mats.trim, 0.5, 0.1, 0.18, 0, y0 + 0.82, 1.85 * k, 0.03);
  for (const x of [-0.18, -0.06, 0.06, 0.18]) cyl(body, s.headlight, 0.055, 0.04, x, y0 + 0.83, 1.95 * k, 'z', 12);
  for (const sd of [-1, 1]) { box(body, mats.trim, 0.12, 0.08, 0.14, sd * (W / 2 + 0.05), y0 + 0.95, 0.85 * k, 0.02); box(body, mats.trim, 0.3, 0.28, 0.02, sd * (W / 2 - 0.2), y0 + 0.1, -1.6 * k); }
  flares(c, wz); seams(c, [-0.35 * k, 0.88 * k], 0.15, 0.84); plates(c, 2.26 * k, -2.28 * k, y0 + 0.3);
  return { hood: [1.5 * k, y0 + 0.76, 1.0 * k], cab: [-1.6 * k, 1.0 * k, y0 + 1.36, W], front: 2.26 * k, rear: -2.28 * k, bumperY: y0 + 0.3, lightY: y0 + 0.6, exhaust: [[0.5, y0 + 0.15, -2.3 * k]], nosAt: [0, y0 + 0.9, -1.7 * k], snorkelZ: 1.0 * k, roofY: y0 + 1.36 };
}

function stripe(c: Ctx, yMid: number, h: number, z0: number, z1: number) {
  // accent stripes down both flanks
  const m = c.mats.paint2;
  for (const sd of [-1, 1]) box(c.body, m, 0.012, 0.08 * h, z1 - z0, sd * (c.W / 2 + 0.004), c.y0 + yMid * 0.62, (z0 + z1) / 2);
}

function limo(c: Ctx): Anch {
  const { body, mats, s, W, y0, wz } = c;
  const top: P[] = [[-3.5, 0.12], [-3.56, 0.45], [-3.48, 0.74], [-2.9, 0.8], [-2.4, 1.3], [1.55, 1.36], [2.25, 0.86], [3.3, 0.72], [3.54, 0.5], [3.5, 0.12]];
  const ar = arches(c);
  profileBody(withArches(top, wz, ar.r, ar.y), W, 0.12, mats.paint, body, y0, c.livery);
  for (const poly of [[[-2.75, 0.84], [-2.35, 1.25], [-1.0, 1.28], [-1.0, 0.84]], [[-0.85, 0.84], [-0.85, 1.29], [0.6, 1.29], [0.6, 0.84]], [[0.75, 0.84], [0.75, 1.3], [1.52, 1.3], [2.12, 0.88]]] as P[][])
    windowTrim(poly, W - 0.08, s.glass, mats.trim, body, y0);
  glassQuad([1.55, 1.36], [2.25, 0.86], W * 0.84, s.glass, body, y0);
  glassQuad([-2.9, 0.8], [-2.4, 1.3], W * 0.8, s.glass, body, y0);
  for (const sd of [-1, 1]) { box(body, s.chrome, 0.02, 0.03, 6.6, sd * (W / 2 + 0.005), y0 + 0.8, 0); box(body, s.chrome, 0.02, 0.05, 6.4, sd * (W / 2 + 0.005), y0 + 0.2, 0); box(body, mats.trim, 0.12, 0.08, 0.14, sd * (W / 2 + 0.05), y0 + 0.95, 2.1, 0.02); }
  box(body, s.chrome, W * 0.6, 0.2, 0.05, 0, y0 + 0.48, 3.54, 0.03);
  for (let i = 0; i < 7; i++) box(body, s.chrome, 0.02, 0.18, 0.02, -0.27 + i * 0.09, y0 + 0.48, 3.57);
  sphere(body, s.chrome, 0.05, 0, y0 + 0.76, 3.25);
  flares(c, wz); plates(c, 3.56, -3.58, y0 + 0.3);
  return { hood: [2.8, y0 + 0.76, 1.0], cab: [-2.9, 2.25, y0 + 1.36, W], front: 3.56, rear: -3.58, bumperY: y0 + 0.3, lightY: y0 + 0.6, exhaust: [[0.5, y0 + 0.15, -3.6], [-0.5, y0 + 0.15, -3.6]], nosAt: [0, y0 + 0.9, -3.0], snorkelZ: 2.2, roofY: y0 + 1.36 };
}

function crawler(c: Ctx): Anch {
  const { body, mats, s, W, y0, wz } = c;
  const top: P[] = [[-2.0, 0.1], [-2.02, 0.95], [-1.92, 1.72], [0.55, 1.75], [0.72, 1.0], [1.85, 0.95], [2.0, 0.78], [2.0, 0.1]];
  const ar = arches(c);
  profileBody(withArches(top, wz, ar.r * 1.03, ar.y), W - 0.1, 0.06, mats.paint, body, y0, c.livery);
  windowTrim([[-1.75, 1.02], [-1.75, 1.64], [0.48, 1.67], [0.66, 1.05]], W - 0.16, s.glass, mats.trim, body, y0);
  glassQuad([0.55, 1.73], [0.72, 1.02], W * 0.82, s.glass, body, y0);
  box(body, mats.paint2, W - 0.06, 0.06, 2.5, 0, y0 + 1.76, -0.7, 0.03);
  // flat fender flares
  for (const z of [...new Set(wz)]) for (const sd of [-1, 1]) {
    box(body, mats.trim, 0.2, 0.08, c.R * 2.3, sd * (W / 2 + 0.02), y0 + Math.max(0.15, c.R - c.y0 + 0.12) + 0.0, z, 0.03);
  }
  // seven-slot grille, round lamps, spare tyre
  box(body, mats.trim, W * 0.55, 0.42, 0.04, 0, y0 + 0.6, 2.0, 0.02);
  for (let i = 0; i < 7; i++) box(body, mats.paint, 0.05, 0.36, 0.03, -0.27 + i * 0.09, y0 + 0.6, 2.03);
  const sp = wheelGeos(c.R * 0.95, c.d.wheelW, c.up.compound, c.up.tires);
  const spare = mesh(sp.tire, mats.rubber, body); spare.position.set(0, y0 + 1.05, -2.2); spare.rotation.y = Math.PI / 2;
  const rr = mesh(sp.rim, mats.rim, body); rr.position.copy(spare.position); rr.rotation.y = -Math.PI / 2;
  for (const sd of [-1, 1]) box(body, mats.trim, 0.1, 0.08, 0.12, sd * (W / 2 + 0.03), y0 + 1.1, 0.6, 0.02);
  return { hood: [1.3, y0 + 0.97, 1.1], cab: [-1.92, 0.72, y0 + 1.75, W - 0.1], front: 2.02, rear: -2.03, bumperY: y0 + 0.25, lightY: y0 + 0.66, exhaust: [[-0.6, y0 + 0.12, -2.05]], nosAt: [0, y0 + 1.95, -0.6], snorkelZ: 0.75, roofY: y0 + 1.78 };
}

function suv(c: Ctx): Anch {
  const { body, mats, s, W, y0, wz } = c;
  const top: P[] = [[-2.4, 0.12], [-2.45, 0.5], [-2.42, 1.0], [-2.3, 1.8], [0.45, 1.85], [1.25, 1.12], [2.2, 0.98], [2.42, 0.6], [2.4, 0.12]];
  const ar = arches(c);
  profileBody(withArches(top, wz, ar.r, ar.y), W, 0.13, mats.paint, body, y0, c.livery);
  windowTrim([[-2.2, 1.08], [-2.15, 1.72], [0.42, 1.76], [1.15, 1.14]], W - 0.1, s.glass, mats.trim, body, y0);
  for (const z of [-1.2, 0.05]) for (const sd of [-1, 1]) box(body, mats.trim, 0.012, 0.66, 0.08, sd * (W / 2 + 0.002), y0 + 1.42, z);
  glassQuad([0.45, 1.85], [1.25, 1.12], W * 0.86, s.glass, body, y0);
  glassQuad([-2.42, 1.08], [-2.3, 1.76], W * 0.8, s.glass, body, y0);
  // roof rack
  for (const sd of [-1, 1]) box(body, s.steel, 0.05, 0.06, 2.4, sd * W * 0.4, y0 + 1.92, -0.9, 0.02);
  for (const z of [-1.8, -0.9, 0.0]) box(body, s.steel, W * 0.82, 0.04, 0.05, 0, y0 + 1.95, z, 0.01);
  box(body, mats.trim, W * 0.98, 0.25, 0.12, 0, y0 + 0.28, 0, 0.04);
  box(body, mats.trim, W * 0.5, 0.3, 0.04, 0, y0 + 0.75, 2.42, 0.03);
  for (let i = 0; i < 4; i++) box(body, s.chrome, W * 0.46, 0.02, 0.02, 0, y0 + 0.65 + i * 0.07, 2.45);
  for (const sd of [-1, 1]) box(body, mats.trim, 0.12, 0.1, 0.15, sd * (W / 2 + 0.06), y0 + 1.16, 1.12, 0.02);
  flares(c, wz); seams(c, [-1.2, 0.05, 1.18], 0.25, 1.06); plates(c, 2.44, -2.46, y0 + 0.36);
  return { hood: [1.75, y0 + 1.02, 1.0], cab: [-2.3, 1.25, y0 + 1.85, W], front: 2.44, rear: -2.46, bumperY: y0 + 0.32, lightY: y0 + 0.78, exhaust: [[0.6, y0 + 0.15, -2.48]], nosAt: [0, y0 + 2.08, -0.9], snorkelZ: 1.2, roofY: y0 + 1.92 };
}

function pickup(c: Ctx, monster: boolean): Anch {
  const { body, mats, s, W, y0, wz, L } = c;
  const k = L / 5.6;
  const bw = monster ? 2.1 : W;               // monster bodies are narrower than the track
  const top: P[] = [[-0.6, 0.12], [-0.62, 1.82], [0.7, 1.86], [1.35, 1.15], [2.6, 1.02], [2.82, 0.65], [2.8, 0.12]].map(([z, y]) => [z * k, y] as P);
  const ar = arches(c);
  const cabPts = monster ? top : withArches(top, wz.filter((z) => z > 0), ar.r, ar.y);
  profileBody(cabPts, bw, 0.1, mats.paint, body, y0, c.livery);
  windowTrim([[-0.48, 1.18], [-0.48, 1.74], [0.66, 1.78], [1.25, 1.18]].map(([z, y]) => [z * k, y] as P), bw - 0.1, s.glass, mats.trim, body, y0);
  glassQuad([0.7 * k, 1.86], [1.35 * k, 1.15], bw * 0.86, s.glass, body, y0);
  glassQuad([-0.62 * k, 1.2], [-0.62 * k, 1.75], bw * 0.7, s.glass, body, y0, -0.02);
  // bed
  const bz0 = -2.8 * k, bz1 = -0.66 * k;
  const bedPts: P[] = withArches([[bz0, 0.12], [bz0, 1.08], [bz1, 1.08], [bz1, 0.12]], monster ? [] : wz.filter((z) => z < 0), ar.r, ar.y);
  for (const sd of [-1, 1]) {
    const side = profileBody(bedPts, 0.08, 0.02, mats.paint, body, y0, c.livery); side.position.x = sd * (bw / 2 - 0.04);
    box(body, mats.trim, 0.1, 0.05, bz1 - bz0, sd * (bw / 2 - 0.04), y0 + 1.1, (bz0 + bz1) / 2, 0.02);
  }
  box(body, mats.paint, bw - 0.1, 0.8, 0.07, 0, y0 + 0.68, bz0 + 0.04, 0.02);
  box(body, mats.trim, bw - 0.1, 0.06, bz1 - bz0, 0, y0 + 0.45, (bz0 + bz1) / 2);
  box(body, mats.trim, bw, 0.22, 0.2, 0, y0 + 0.3, bz0 - 0.05, 0.05);
  // grille + mirrors
  box(body, mats.trim, bw * 0.6, 0.42, 0.05, 0, y0 + 0.72, 2.81 * k, 0.03);
  for (let i = 0; i < 3; i++) box(body, s.chrome, bw * 0.58, 0.04, 0.03, 0, y0 + 0.58 + i * 0.13, 2.84 * k);
  for (const sd of [-1, 1]) box(body, mats.trim, 0.14, 0.18, 0.08, sd * (bw / 2 + 0.08), y0 + 1.2, 1.2 * k, 0.02);
  if (!monster) { flares(c, wz); seams(c, [0.62 * k, -0.6 * k], 0.25, 1.15); plates(c, 2.84 * k, bz0 - 0.1, y0 + 0.36); }
  if (monster) {
    // exposed tube chassis, ladder bars and big fender flares
    for (const sd of [-1, 1]) {
      tubePath(body, s.steel, [[sd * 0.55, y0 - 0.1, 2.6], [sd * 0.55, y0 - 0.3, 1.75], [sd * 0.55, y0 - 0.3, -1.75], [sd * 0.55, y0 - 0.1, -2.6]], 0.07);
      for (const z of [1.75, -1.75]) {
        tube(body, s.chrome, [sd * 0.55, y0 - 0.25, z], [sd * 1.15, y0 - 0.3, z], 0.06);
        for (const dz of [-0.35, -0.12, 0.12, 0.35]) { tube(body, s.shock, [sd * 0.75, y0 + 0.25, z + dz], [sd * 1.0, -0.15, z + dz * 0.6], 0.055); tube(body, s.spring[c.up.suspension - 1], [sd * 0.78, y0 + 0.15, z + dz], [sd * 0.94, 0.15, z + dz * 0.6], 0.075); }
      }
    }
    for (const z of [1.75, -1.75]) box(body, s.steel, 2.3, 0.18, 0.2, 0, -0.05, z, 0.04);
  }
  return { hood: [2.0 * k, y0 + 1.06, 1.2 * k], cab: [-0.62 * k, 1.35 * k, y0 + 1.86, bw], front: 2.84 * k, rear: bz0 - 0.1, bumperY: y0 + 0.32, lightY: y0 + 0.78, exhaust: [[0.55, y0 + 0.15, bz0 - 0.1]], nosAt: [0, y0 + 0.68, -1.75 * k], snorkelZ: 1.3 * k, roofY: y0 + 1.86, stacks: monster };
}

function sixbysix(c: Ctx): Anch {
  const { body, mats, s, W, y0, wz } = c;
  const top: P[] = [[1.0, 0.12], [1.0, 2.2], [2.0, 2.25], [2.35, 1.45], [3.15, 1.35], [3.22, 0.75], [3.2, 0.12]];
  const ar = arches(c);
  profileBody(withArches(top, wz.filter((z) => z > 1), ar.r, ar.y), W, 0.08, mats.paint, body, y0, c.livery);
  windowTrim([[1.12, 1.4], [1.12, 2.1], [1.95, 2.14], [2.25, 1.45]], W - 0.08, s.glass, mats.trim, body, y0);
  glassQuad([2.0, 2.24], [2.35, 1.46], W * 0.84, s.glass, body, y0);
  // bed floor + canvas canopy
  box(body, mats.under, W, 0.18, 4.2, 0, y0 + 0.5, -1.15, 0.03);
  for (const sd of [-1, 1]) box(body, mats.paint, 0.07, 0.55, 4.2, sd * (W / 2 - 0.035), y0 + 0.85, -1.15, 0.02);
  const can = new THREE.Shape(); can.moveTo(-W / 2, 0); can.lineTo(-W / 2, 0.9); can.quadraticCurveTo(-W / 2, 1.5, 0, 1.55); can.quadraticCurveTo(W / 2, 1.5, W / 2, 0.9); can.lineTo(W / 2, 0); can.closePath();
  const cg = new THREE.ExtrudeGeometry(can, { depth: 4.1, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
  cg.translate(0, 0, -4.1 / 2);
  const cm = mesh(cg, mats.paint2, body); cm.position.set(0, y0 + 0.6, -1.15);
  for (let i = 0; i < 5; i++) box(body, mats.trim, W + 0.04, 0.04, 0.05, 0, y0 + 2.14, -3.0 + i * 0.92);
  box(body, mats.trim, W * 0.7, 0.55, 0.05, 0, y0 + 0.85, 3.22, 0.03);
  for (let i = 0; i < 6; i++) box(body, mats.paint, 0.05, 0.5, 0.03, -W * 0.3 + i * W * 0.12, y0 + 0.85, 3.25);
  for (const sd of [-1, 1]) { box(body, mats.trim, 0.14, 0.3, 0.06, sd * (W / 2 + 0.1), y0 + 1.6, 2.2, 0.02); box(body, mats.under, 0.4, 0.5, 0.9, sd * (W / 2 - 0.25), y0 + 0.15, 0.3, 0.06); }
  return { hood: [2.75, y0 + 1.38, 0.8], cab: [1.0, 2.35, y0 + 2.25, W], front: 3.24, rear: -3.25, bumperY: y0 + 0.35, lightY: y0 + 1.0, exhaust: [[W / 2 - 0.1, y0 + 2.4, 0.9]], nosAt: [0, y0 + 0.75, -0.2], snorkelZ: 2.3, roofY: y0 + 2.25, stacks: true };
}

function dakar(c: Ctx): Anch {
  const { body, mats, s, W, y0, wz } = c;
  const top: P[] = [[1.6, 0.15], [1.6, 2.9], [3.0, 2.95], [3.55, 2.05], [3.62, 1.2], [3.6, 0.15]];
  const ar = arches(c);
  profileBody(withArches(top, wz.filter((z) => z > 0), ar.r, ar.y), W, 0.12, mats.paint, body, y0, c.livery);
  windowTrim([[1.85, 1.75], [1.85, 2.75], [2.95, 2.8], [3.45, 2.05]], W - 0.1, s.glass, mats.trim, body, y0);
  glassQuad([3.0, 2.92], [3.55, 2.08], W * 0.86, s.glass, body, y0);
  // service box with sloped tail
  const bx: P[] = withArches([[-3.6, 0.35], [-3.55, 2.2], [-3.0, 2.6], [1.45, 2.6], [1.45, 0.35]], wz.filter((z) => z < 0), ar.r, ar.y);
  profileBody(bx, W, 0.1, mats.paint2, body, y0);
  stripe(c, 2.2, 1.5, -3.4, 3.4);
  for (const sd of [-1, 1]) for (let i = 0; i < 2; i++) { const sp = wheelGeos(c.R * 0.95, c.d.wheelW * 0.9, 'allterrain', 1); const t = mesh(sp.tire, mats.rubber, body); t.position.set(sd * (W / 2 + 0.12), y0 + 1.5, -2.0 + i * 1.5); }
  box(body, mats.trim, W * 1.02, 0.35, 0.35, 0, y0 + 0.4, 3.6, 0.08);
  for (let i = 0; i < 4; i++) cyl(body, s.headlight, 0.1, 0.06, -0.45 + i * 0.3, y0 + 3.05, 2.6, 'z', 14);
  box(body, mats.trim, 1.5, 0.15, 0.15, 0, y0 + 3.05, 2.55, 0.04);
  box(body, mats.trim, W * 0.8, 0.1, 0.6, 0, y0 + 2.98, 2.0, 0.04, 0.1);
  flares(c, wz, 1.4); seams(c, [2.95], 1.0, 2.6);
  return { hood: [3.3, y0 + 1.25, 0.6], cab: [1.6, 3.55, y0 + 2.95, W], front: 3.66, rear: -3.62, bumperY: y0 + 0.4, lightY: y0 + 1.1, exhaust: [[W / 2 - 0.05, y0 + 1.0, -1.5]], nosAt: [0, y0 + 2.75, 0.4], snorkelZ: 3.0, roofY: y0 + 2.95, stacks: false };
}

function semi(c: Ctx): Anch {
  const { body, mats, s, W, y0, wz } = c;
  const top: P[] = [[-0.9, 0.3], [-0.9, 3.25], [0.3, 3.3], [0.45, 2.9], [1.45, 2.85], [1.85, 1.75], [3.55, 1.65], [3.75, 1.2], [3.72, 0.3]];
  const ar = arches(c);
  profileBody(withArches(top, wz.filter((z) => z > 0), ar.r, ar.y), W, 0.14, mats.paint, body, y0, c.livery);
  windowTrim([[0.55, 1.85], [0.55, 2.7], [1.42, 2.75], [1.78, 1.85]], W - 0.1, s.glass, mats.trim, body, y0);
  glassQuad([1.45, 2.84], [1.85, 1.8], W * 0.86, s.glass, body, y0);
  box(body, s.chrome, W * 0.66, 1.05, 0.06, 0, y0 + 1.0, 3.74, 0.04);
  for (let i = 0; i < 9; i++) box(body, mats.trim, W * 0.6, 0.04, 0.03, 0, y0 + 0.58 + i * 0.105, 3.78);
  // frame, fifth wheel, chrome tanks and stacks
  for (const sd of [-1, 1]) {
    box(body, mats.under, 0.14, 0.32, 4.6, sd * 0.5, y0 + 0.2, -1.5);
    cyl(body, s.chrome, 0.32, 1.3, sd * (W / 2 - 0.3), y0 + 0.35, -0.3, 'z', 24);
    cyl(body, s.chrome, 0.1, 3.0, sd * (W / 2 - 0.1), y0 + 2.2, -0.95, 'y', 16);
    box(body, mats.paint, 0.5, 0.06, 1.4, sd * (W / 2 - 0.25), c.R - 0.1 + 0.05, -2.08, 0.03);
  }
  cyl(body, mats.under, 0.85, 0.12, 0, y0 + 0.42, -2.1, 'y', 28);
  box(body, mats.paint, W, 0.08, 1.2, 0, c.R + 0.25, 2.6, 0.03);
  return { hood: [2.7, y0 + 1.7, 1.6], cab: [-0.9, 1.85, y0 + 3.3, W], front: 3.8, rear: -3.75, bumperY: y0 + 0.4, lightY: y0 + 0.9, exhaust: [[W / 2 - 0.1, y0 + 3.72, -0.95], [-W / 2 + 0.1, y0 + 3.72, -0.95]], nosAt: [0, y0 + 0.6, -1.0], snorkelZ: 1.8, roofY: y0 + 3.3, stacks: true };
}

function eightbyeight(c: Ctx): Anch {
  const { body, mats, s, W, y0, wz } = c;
  const top: P[] = [[2.0, 0.2], [2.0, 2.6], [3.3, 2.65], [3.95, 1.75], [4.3, 1.2], [4.3, 0.2]];
  const ar = arches(c);
  profileBody(withArches(top, wz.filter((z) => z > 1.8), ar.r, ar.y), W, 0.12, mats.paint, body, y0, c.livery);
  windowTrim([[2.2, 1.6], [2.2, 2.45], [3.25, 2.5], [3.8, 1.75]], W - 0.1, s.glass, mats.trim, body, y0);
  glassQuad([3.3, 2.62], [3.95, 1.78], W * 0.84, s.glass, body, y0);
  const bx: P[] = withArches([[-4.3, 0.3], [-4.3, 2.9], [1.85, 2.9], [1.85, 0.3]], wz.filter((z) => z < 1.8), ar.r, ar.y);
  profileBody(bx, W, 0.12, mats.paint, body, y0, c.livery);
  for (const sd of [-1, 1]) for (let i = 0; i < 4; i++) sidePanel([[-3.6 + i * 1.3, 1.9], [-3.6 + i * 1.3, 2.5], [-2.8 + i * 1.3, 2.5], [-2.8 + i * 1.3, 1.9]], W + 0.01, s.glass, body, y0), void sd;
  for (let i = 0; i < 6; i++) box(body, s.steel, W * 0.9, 0.05, 0.05, 0, y0 + 3.0, -3.8 + i * 1.0);
  for (const sd of [-1, 1]) box(body, s.steel, 0.06, 0.12, 5.6, sd * W * 0.43, y0 + 2.98, -1.2);
  box(body, mats.under, W * 1.02, 0.45, 0.4, 0, y0 + 0.5, 4.3, 0.06);
  for (let i = 0; i < 6; i++) box(body, mats.trim, 0.06, 0.6, 0.04, -0.75 + i * 0.3, y0 + 0.95, 4.31);
  box(body, mats.trim, 0.6, 1.2, 0.05, -W * 0.3, y0 + 1.2, -4.31, 0.02);
  return { hood: [3.95, y0 + 1.25, 0.6], cab: [2.0, 3.95, y0 + 2.65, W], front: 4.42, rear: -4.35, bumperY: y0 + 0.45, lightY: y0 + 1.05, exhaust: [[W / 2 - 0.1, y0 + 3.0, 1.9]], nosAt: [0, y0 + 3.15, -2.5], snorkelZ: 3.9, roofY: y0 + 2.95, stacks: true };
}

function bus(c: Ctx): Anch {
  const { body, mats, s, W, y0, wz } = c;
  const top: P[] = [[-5.5, 0.15], [-5.55, 2.75], [-5.3, 3.0], [4.2, 3.0], [4.45, 2.75], [4.52, 1.38], [5.45, 1.25], [5.52, 0.15]];
  const ar = arches(c);
  profileBody(withArches(top, wz, ar.r, ar.y), W, 0.14, mats.paint, body, y0, c.livery);
  for (let i = 0; i < 9; i++) sidePanel([[-4.9 + i * 1.0, 1.72], [-4.9 + i * 1.0, 2.55], [-4.1 + i * 1.0, 2.55], [-4.1 + i * 1.0, 1.72]], W + 0.01, s.glass, body, y0);
  glassQuad([4.44, 2.72], [4.5, 1.5], W * 0.88, s.glass, body, y0);
  glassQuad([-5.55, 1.8], [-5.55, 2.6], W * 0.6, s.glass, body, y0, -0.02);
  for (const sd of [-1, 1]) for (const yy of [0.62, 1.12, 1.6]) box(body, mats.trim, 0.02, 0.06, 10.6, sd * (W / 2 + 0.004), y0 + yy, -0.3);
  box(body, mats.trim, W, 0.12, 10.9, 0, y0 + 0.08, 0, 0.04);
  box(body, mats.trim, W * 0.9, 0.3, 0.05, 0, y0 + 2.82, 4.42, 0.02);
  for (const sd of [-1, 1]) { cyl(body, s.amber, 0.08, 0.05, sd * 0.85, y0 + 2.86, 4.46, 'z'); box(body, mats.trim, 0.16, 0.28, 0.08, sd * (W / 2 + 0.12), y0 + 2.0, 4.4, 0.02); }
  box(body, mats.trim, 0.8, 0.5, 0.04, 0, y0 + 0.85, 5.53, 0.02);
  return { hood: [5.0, y0 + 1.3, 0.9], cab: [-5.3, 4.2, y0 + 3.0, W], front: 5.56, rear: -5.6, bumperY: y0 + 0.35, lightY: y0 + 0.9, exhaust: [[-W / 2 + 0.2, y0 + 0.1, -5.5]], nosAt: [0, y0 + 3.12, 0], snorkelZ: 4.4, roofY: y0 + 3.0 };
}

function tank(c: Ctx): Anch {
  const { body, mats, s, W, y0 } = c;
  const hull: P[] = [[-3.9, 0.0], [-3.95, 0.92], [-3.6, 1.15], [2.4, 1.15], [3.95, 0.55], [3.7, 0.0]];
  profileBody(hull, W * 0.86, 0.06, mats.paint, body, y0, c.livery);
  // fenders over the tracks
  for (const sd of [-1, 1]) box(body, mats.paint, 0.66, 0.05, 7.6, sd * (W / 2 - 0.33), y0 + 0.95, 0.0, 0.02);
  // turret
  const tur = new THREE.Group(); tur.name = 'turret'; tur.position.set(0, y0 + 1.15, -0.2); body.parent!.add(tur);
  const tp: P[] = [[-1.8, 0.0], [-1.9, 0.6], [-1.5, 0.85], [1.2, 0.85], [2.0, 0.35], [1.8, 0.0]];
  profileBody(tp, 2.6, 0.08, mats.paint, tur, 0);
  cyl(tur, mats.paint, 0.2, 1.0, 0, 0.42, 2.3, 'z', 18);
  cyl(tur, mats.paint2, 0.12, 4.6, 0, 0.42, 4.6, 'z', 18);
  cyl(tur, mats.paint2, 0.17, 0.6, 0, 0.42, 6.6, 'z', 18);
  cyl(tur, mats.paint, 0.35, 0.25, 0.6, 0.98, -0.5, 'y', 18);
  cyl(tur, s.steel, 0.04, 0.9, 0.6, 1.35, -0.4, 'z', 8);
  for (const sd of [-1, 1]) box(tur, mats.under, 0.35, 0.3, 1.2, sd * 1.35, 0.4, -1.0, 0.04);
  tur.traverse((o) => (o.userData.keep = true));
  return { hood: [-2.9, y0 + 1.2, 1.4], cab: [-1.8, 1.4, y0 + 2.0, 2.6], front: 3.95, rear: -3.95, bumperY: y0 + 0.4, lightY: y0 + 0.75, exhaust: [[1.0, y0 + 0.95, -3.95], [-1.0, y0 + 0.95, -3.95]], nosAt: [0, y0 + 1.3, -3.0], snorkelZ: -2.0, roofY: y0 + 2.0 };
}

function tankTracks(c: Ctx, root: THREE.Group, wheels: WheelVis[]): NonNullable<VehicleVisual['tracks']> {
  const { mats, d } = c;
  const W = d.wheelW, R = c.R;
  const zs = d.wheels.map((w) => w.z), z0 = Math.min(...zs) - R * 1.2, z1 = Math.max(...zs) + R * 1.2;
  const texs: THREE.Texture[] = [];
  const wheelsBySide: THREE.Group[][] = [[], []];
  for (const side of [1, -1]) {
    const cnv = document.createElement('canvas'); cnv.width = 64; cnv.height = 256;
    const g = cnv.getContext('2d')!; g.fillStyle = '#2c2a27'; g.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 8; i++) { g.fillStyle = '#4b4741'; g.fillRect(2, i * 32 + 2, 60, 22); g.fillStyle = '#1a1917'; g.fillRect(28, i * 32 + 8, 8, 10); }
    const tex = new THREE.CanvasTexture(cnv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, metalness: 0.5 });
    // loop: top run, bottom run, two half-cylinders
    const len = z1 - z0;
    tex.repeat.set(1, len * 1.3);
    const x = side * Math.abs(d.wheels[0].x);
    const top = mesh(new THREE.BoxGeometry(W, 0.08, len), m, root); top.position.set(x, R * 0.85 + 0.1, (z0 + z1) / 2);
    const bot = mesh(new THREE.BoxGeometry(W, 0.08, len - R), m, root); bot.position.set(x, -R - 0.04, (z0 + z1) / 2); bot.userData.bottom = true;
    for (const [zz, rr] of [[z1, 1], [z0, -1]] as const) {
      const sp = mesh(new THREE.CylinderGeometry(R * 0.9, R * 0.9, W, 16).rotateZ(Math.PI / 2), mats.under, root); sp.position.set(x, 0.05, zz - rr * R * 0.15);
      const cap = mesh(new THREE.CylinderGeometry(R * 0.98, R * 0.98, W * 0.98, 16, 1, true, rr > 0 ? 0 : Math.PI, Math.PI).rotateZ(Math.PI / 2), m, root); cap.position.copy(sp.position);
    }
    texs.push(tex);
    wheelsBySide[side > 0 ? 0 : 1] = wheels.filter((w) => w.side === side).map((w) => w.spin);
  }
  return { tex: texs, wheels: wheelsBySide };
}

function dump(c: Ctx): Anch {
  const { body, mats, s, W, y0 } = c;
  // main frame + deck
  for (const sd of [-1, 1]) box(body, mats.under, 0.35, 0.8, 9.2, sd * 0.8, y0 + 0.3, 0, 0.05);
  box(body, mats.paint, W * 0.92, 0.18, 2.4, 0, y0 + 2.5, 4.0, 0.04);
  // engine bay + huge grille
  box(body, mats.paint, 2.0, 2.2, 2.2, 0, y0 + 1.4, 4.1, 0.12);
  box(body, mats.trim, 1.8, 1.5, 0.05, 0, y0 + 1.5, 5.22, 0.03);
  for (let i = 0; i < 10; i++) box(body, s.steel, 1.7, 0.04, 0.04, 0, y0 + 0.85 + i * 0.14, 5.25);
  // bumper / deck rails / ladder
  box(body, mats.paint, W * 0.95, 0.5, 0.5, 0, y0 + 0.7, 5.05, 0.06);
  for (let i = 0; i < 12; i++) box(body, s.steel, W * 0.9 / 12 * 0.15, 0.9, 0.05, -W * 0.45 + i * W * 0.9 / 11, y0 + 3.05, 5.15);
  box(body, s.steel, W * 0.92, 0.06, 0.06, 0, y0 + 3.5, 5.15);
  for (let i = 0; i < 8; i++) box(body, s.steel, 0.9, 0.05, 0.25, -W * 0.3, y0 + 0.4 + i * 0.3, 5.3 - i * 0.12, 0.01);
  tube(body, s.steel, [-W * 0.3 - 0.45, y0 + 0.4, 5.35], [-W * 0.3 - 0.45, y0 + 2.6, 4.5], 0.03);
  // cab on the left of the deck
  const cab = new THREE.Group(); cab.position.set(W * 0.27, y0 + 2.6, 4.2); body.add(cab);
  box(cab, mats.paint, 1.7, 1.9, 1.9, 0, 0.95, 0, 0.1);
  for (const [w, h, x, y, z] of [[1.5, 0.95, 0, 1.3, 0.96], [0.02, 0.95, 0.86, 1.3, 0], [0.02, 0.95, -0.86, 1.3, 0]] as number[][]) { const gq = box(cab, s.glass, w || 0.02, h, z === 0 ? 1.6 : 0.02, x, y, z); gq.castShadow = false; }
  // dump bed with canopy over the cab
  const bed: P[] = [[-5.4, 1.2], [-5.6, 3.6], [-5.2, 4.3], [2.4, 4.3], [2.4, 4.7], [5.3, 4.9], [5.3, 4.55], [2.6, 4.0], [2.2, 1.3], [-1.0, 0.8]];
  profileBody(bed, W * 0.98, 0.12, mats.paint, body, y0, c.livery);
  for (let i = 0; i < 6; i++) for (const sd of [-1, 1]) box(body, mats.paint, 0.08, 2.6, 0.18, sd * (W * 0.49 + 0.03), y0 + 2.7, -4.8 + i * 1.4, 0.02);
  for (const sd of [-1, 1]) tube(body, s.chrome, [sd * 1.2, y0 + 0.5, 0.5], [sd * 1.35, y0 + 2.4, -0.8], 0.14);
  return { hood: [4.1, y0 + 2.6, 1.6], cab: [3.25, 5.15, y0 + 4.5, 1.8], front: 5.3, rear: -5.6, bumperY: y0 + 0.7, lightY: y0 + 1.25, exhaust: [[-0.6, y0 + 5.2, 2.9], [0.6, y0 + 5.2, 2.9]], nosAt: [-W * 0.27, y0 + 2.75, 3.6], snorkelZ: 4.0, roofY: y0 + 4.9, stacks: false };
}

function buggy(c: Ctx): Anch {
  const { body, mats, s, W, y0 } = c;
  // floor tub + nose
  const tub: P[] = [[-1.6, 0.0], [-1.65, 0.35], [-0.2, 0.45], [1.2, 0.42], [1.75, 0.28], [1.7, 0.0]];
  profileBody(tub, W * 0.78, 0.05, mats.paint, body, y0, c.livery);
  box(body, mats.paint2, W * 0.6, 0.06, 1.1, 0, y0 + 0.5, 1.15, 0.03, 0.18);
  // cage
  const r = 0.035, x = W * 0.36, h = 1.25;
  for (const sd of [-1, 1]) {
    tubePath(body, s.steel, [[sd * x, y0 + 0.4, 1.5], [sd * x * 0.92, y0 + h, 0.45], [sd * x * 0.92, y0 + h, -0.55], [sd * x, y0 + 0.4, -1.55]], r);
    tube(body, s.steel, [sd * x * 0.92, y0 + h, -0.55], [sd * x, y0 + 0.4, -0.55], r);
    tube(body, s.steel, [sd * x * 0.92, y0 + h, 0.45], [sd * x, y0 + 0.4, 0.45], r);
  }
  for (const z of [0.45, -0.55]) tube(body, s.steel, [-x * 0.92, y0 + h, z], [x * 0.92, y0 + h, z], r);
  tube(body, s.steel, [-x * 0.92, y0 + h, 0.45], [x * 0.92, y0 + h, -0.55], r);
  // rear engine, exhaust, seats + driver
  box(body, s.steel, 0.6, 0.45, 0.6, 0, y0 + 0.55, -1.15, 0.06);
  box(body, mats.trim, 0.5, 0.18, 0.4, 0, y0 + 0.88, -1.15, 0.04);
  for (const sd of [-1, 1]) box(body, s.seat, 0.45, 0.7, 0.12, sd * 0.28, y0 + 0.75, -0.35, 0.05, -0.2);
  rider(c, 0.28, y0 + 0.35, -0.1, -0.15);
  const sp = wheelGeos(c.R * 0.9, c.d.wheelW * 0.9, c.up.compound, c.up.tires);
  const spare = mesh(sp.tire, mats.rubber, body); spare.position.set(0, y0 + 0.75, -1.7); spare.rotation.y = Math.PI / 2; spare.rotation.z = 0.3;
  return { hood: [1.2, y0 + 0.55, 0.8], cab: [-0.55, 0.45, y0 + h, W * 0.72], front: 1.75, rear: -1.75, bumperY: y0 + 0.2, lightY: y0 + 0.4, exhaust: [[0.25, y0 + 0.7, -1.55]], nosAt: [0, y0 + 0.62, -0.75], snorkelZ: 0, roofY: y0 + h, open: true };
}

function bike(c: Ctx): Anch {
  const { body, mats, s, y0 } = c;
  const fz = c.d.wheels[0].z, rz = c.d.wheels[1].z;
  const r = 0.03;
  // frame tubes
  tubePath(body, s.steel, [[0, y0 + 0.75, fz - 0.28], [0, y0 + 0.45, -0.05], [0, y0 + 0.2, -0.25], [0, y0 + 0.6, -0.45], [0, y0 + 0.75, fz - 0.28]], r);
  // tank, seat, side plates, fenders
  box(body, mats.paint, 0.3, 0.22, 0.5, 0, y0 + 0.85, 0.1, 0.1);
  box(body, s.seat, 0.22, 0.1, 0.8, 0, y0 + 0.88, -0.35, 0.05);
  box(body, mats.paint, 0.26, 0.25, 0.35, 0, y0 + 0.72, -0.55, 0.06, 0.2);
  box(body, mats.paint, 0.16, 0.04, 0.55, 0, c.R + 0.12, fz + 0.05, 0.02, 0.25);
  box(body, mats.paint, 0.16, 0.04, 0.6, 0, y0 + 0.7, -0.95, 0.02, -0.3);
  box(body, mats.paint2, 0.28, 0.2, 0.06, 0, y0 + 0.8, fz - 0.15, 0.03, -0.3);
  // engine + exhaust
  box(body, s.steel, 0.24, 0.3, 0.35, 0, y0 + 0.35, -0.05, 0.05);
  tubePath(body, s.exhaust, [[0.05, y0 + 0.4, 0.05], [0.14, y0 + 0.3, -0.2], [0.16, y0 + 0.55, -0.6], [0.16, y0 + 0.7, -0.95]], 0.035);
  // fork + bars
  for (const sd of [-1, 1]) tube(body, s.chrome, [sd * 0.08, y0 + 0.95, fz - 0.3], [sd * 0.08, 0.05, fz], 0.025);
  tube(body, s.steel, [-0.38, y0 + 1.05, fz - 0.4], [0.38, y0 + 1.05, fz - 0.4], 0.016);
  // swing arm
  for (const sd of [-1, 1]) tube(body, s.steel, [sd * 0.07, y0 + 0.25, -0.15], [sd * 0.07, 0.0, rz], 0.022);
  rider(c, 0, y0 + 0.55, -0.25, 0.35);
  return { hood: [0.1, y0 + 0.95, 0.4], cab: [-0.6, 0.3, y0 + 1.3, 0.5], front: fz + 0.35, rear: rz - 0.35, bumperY: y0 + 0.2, lightY: y0 + 0.8, exhaust: [[0.16, y0 + 0.7, -0.98]], nosAt: [0, y0 + 0.7, -0.75], snorkelZ: 0, roofY: y0 + 1.3, open: true };
}

/**
 * THE SNAKE: three modules styled as one predator. Head: a long wedge nose with slanted glowing eyes, ivory fangs, slit
 * windows and a roof light bar. Body: an armoured hull under overlapping dorsal scale plates with a spine of fins and
 * venom-green vents. Tail: a tapering hull, rear wing and a segmented rattle. Rubber bellows close every joint.
 */
function snakeModule(c: Ctx, m: number): Anch {
  const { body, mats, s, W, y0, wz } = c;
  const ar = arches(c);
  const glow = SNAKE_GLOW(), bone = SNAKE_BONE();
  // joints: hitch casting + hydraulic rams + accordion bellows reaching to the hinge point
  const joint = (dir: number) => {
    const z = dir * 2.3;
    box(body, s.steel, 0.55, 0.38, 0.5, 0, y0 + 0.4, z + dir * 0.2, 0.06);
    for (const sd of [-1, 1]) tube(body, s.chrome, [sd * 0.62, y0 + 0.78, z - dir * 0.25], [sd * 0.3, y0 + 0.5, z + dir * 0.5], 0.05);
    for (let k = 0; k < 6; k++) { const rr = 0.62 - (k % 2) * 0.07; cyl(body, mats.trim, rr, 0.075, 0, y0 + 0.95, z + dir * (0.04 + k * 0.09), 'z', 18); }
  };
  if (m > 0) joint(1);
  if (m < 2) joint(-1);
  // dorsal scales: overlapping plates down the spine, each carrying a fin
  const scales = (z0: number, z1: number, y: number, n: number, w: number) => {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, z = z0 + (z1 - z0) * t, sz = (z1 - z0) / n * 1.18;
      box(body, mats.paint2, w, 0.1, sz, 0, y + 0.04, z, 0.05, 0.16);
      box(body, glow, w * 0.86, 0.02, 0.04, 0, y + 0.02, z - sz * 0.48, 0, 0.16);
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.38, 4), mats.paint2); fin.scale.set(0.35, 1, 1.6); fin.position.set(0, y + 0.27, z - sz * 0.1); fin.rotation.x = -0.45; body.add(fin);
    }
  };
  // side armour: ribbed panels and glowing vents along the flanks, venom underglow strip
  const flanks = (z0: number, z1: number, yTop: number) => {
    for (const sd of [-1, 1]) {
      box(body, mats.trim, 0.06, 0.16, z1 - z0, sd * (W / 2 + 0.02), y0 + 0.3, (z0 + z1) / 2, 0.03);
      box(body, glow, 0.03, 0.035, z1 - z0 - 0.3, sd * (W / 2 + 0.05), y0 + 0.2, (z0 + z1) / 2);
      for (let i = 0; i < 3; i++) box(body, glow, 0.02, 0.05, 0.32, sd * (W / 2 + 0.01), yTop - 0.35, z0 + 0.6 + i * 0.45, 0, 0, 0, sd * 0.0);
    }
  };
  if (m === 0) {
    const top: P[] = [[-2.3, 0.15], [-2.3, 1.75], [-1.75, 1.97], [-0.3, 1.97], [0.7, 1.38], [1.85, 1.05], [2.42, 0.66], [2.45, 0.3], [2.3, 0.15]];
    profileBody(withArches(top, wz, ar.r, ar.y), W, 0.12, mats.paint, body, y0, c.livery);
    windowTrim([[-1.6, 1.5], [-1.6, 1.8], [-0.32, 1.84], [0.45, 1.44]], W - 0.08, s.glass, mats.trim, body, y0);
    glassQuad([-0.28, 1.95], [0.66, 1.4], W * 0.86, s.glass, body, y0);
    // the face: slanted glowing eyes, dark grille "mouth", ivory fangs
    for (const sd of [-1, 1]) {
      box(body, glow, 0.62, 0.075, 0.06, sd * 0.68, y0 + 0.82, 2.33, 0.02, 0, sd * 0.32, sd * 0.32);
      box(body, mats.trim, 0.7, 0.16, 0.05, sd * 0.68, y0 + 0.9, 2.3, 0.02, 0, sd * 0.32, sd * 0.32);
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.7, 12), bone); fang.position.set(sd * 0.42, y0 + 0.12, 2.5); fang.rotation.set(2.75, 0, sd * 0.12); body.add(fang);
    }
    box(body, mats.trim, W * 0.62, 0.32, 0.06, 0, y0 + 0.45, 2.44, 0.03);
    for (let i = 0; i < 9; i++) box(body, s.chrome, 0.035, 0.26, 0.03, -0.56 + i * 0.14, y0 + 0.45, 2.48);
    // hood vents + scales over the cab roof, roof light bar
    for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) box(body, mats.trim, 0.28, 0.025, 0.1, sd * 0.45, y0 + 1.2 - i * 0.05, 1.05 + i * 0.22, 0, -0.32);
    scales(-1.65, -0.35, y0 + 1.97, 3, W * 0.62);
    box(body, mats.trim, W * 0.8, 0.1, 0.18, 0, y0 + 2.06, -0.3);
    for (let i = 0; i < 5; i++) cyl(body, glow, 0.065, 0.05, -0.64 + i * 0.32, y0 + 2.06, -0.2, 'z', 12);
    for (const sd of [-1, 1]) { cyl(body, s.chrome, 0.1, 2.0, sd * (W / 2 - 0.14), y0 + 2.05, -1.95, 'y', 14); cyl(body, mats.trim, 0.13, 0.6, sd * (W / 2 - 0.14), y0 + 1.7, -1.95, 'y', 14); }
    flanks(-2.1, 1.8, y0 + 1.5);
    return { hood: [1.55, y0 + 1.22, 1.0], cab: [-1.6, 1.3, y0 + 1.97, W], front: 2.45, rear: -2.3, bumperY: y0 + 0.3, lightY: y0 + 0.62, exhaust: [[W / 2 - 0.14, y0 + 3.05, -1.95], [-W / 2 + 0.14, y0 + 3.05, -1.95]], nosAt: [0, y0 + 2.2, -1.4], snorkelZ: 1.2, roofY: y0 + 2.1, stacks: true };
  }
  if (m === 1) {
    profileBody(withArches([[-2.3, 0.15], [-2.3, 1.42], [-1.95, 1.72], [1.95, 1.72], [2.3, 1.42], [2.3, 0.15]], wz, ar.r, ar.y), W, 0.14, mats.paint, body, y0, c.livery);
    scales(-2.0, 2.0, y0 + 1.72, 6, W * 0.7);
    // armour bands + jerry cans and a recovery board on the flanks
    for (const z of [-1.95, 1.95]) box(body, mats.trim, W + 0.06, 0.12, 0.1, 0, y0 + 1.42, z, 0.03);
    for (const sd of [-1, 1]) { for (let i = 0; i < 2; i++) box(body, mats.paint2, 0.16, 0.45, 0.34, sd * (W / 2 + 0.1), y0 + 1.0, -0.35 + i * 0.4, 0.03); box(body, glow, 0.04, 0.22, 1.5, sd * (W / 2 + 0.04), y0 + 0.95, 1.0, 0.02); }
    flanks(-2.1, 2.1, y0 + 1.4);
    return { hood: [0, y0 + 1.75, 1.0], cab: [-2.2, 2.2, y0 + 1.72, W], front: 2.3, rear: -2.3, bumperY: y0 + 0.35, lightY: y0 + 0.6, exhaust: [], nosAt: [0, y0 + 1.9, 0], snorkelZ: 0, roofY: y0 + 1.85, open: true };
  }
  // tail: tapering hull, rear wing, segmented rattle, quad exhaust and a full-width tail-light strip
  profileBody(withArches([[-2.45, 0.42], [-2.4, 1.05], [-1.7, 1.48], [1.95, 1.68], [2.3, 1.4], [2.3, 0.15], [-1.9, 0.15]], wz, ar.r, ar.y), W, 0.14, mats.paint, body, y0, c.livery);
  scales(-1.6, 1.9, y0 + 1.6, 5, W * 0.62);
  box(body, c.mats.brake, W * 0.82, 0.07, 0.05, 0, y0 + 0.95, -2.41, 0.02).userData.keep = false;
  for (const sd of [-1, 1]) { box(body, mats.trim, 0.08, 0.55, 0.3, sd * 0.7, y0 + 1.6, -1.75, 0.03, -0.3); }
  box(body, mats.paint2, W * 0.95, 0.07, 0.55, 0, y0 + 1.9, -1.95, 0.03, 0.12);
  for (const sd of [-1, 1]) box(body, glow, 0.02, 0.04, 0.5, sd * W * 0.47, y0 + 1.94, -1.95, 0, 0.12);
  for (let i = 0; i < 4; i++) { const r = 0.2 - i * 0.035; const seg = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.45, 8, 16), i % 2 ? bone : mats.paint2); seg.position.set(0, y0 + 0.75, -2.5 - i * 0.13); body.add(seg); }
  flanks(-2.0, 2.1, y0 + 1.35);
  return { hood: [-1.0, y0 + 1.7, 1.6], cab: [-2.2, 2.2, y0 + 1.68, W], front: 2.3, rear: -2.45, bumperY: y0 + 0.35, lightY: y0 + 0.75, exhaust: [[0.75, y0 + 0.3, -2.42], [0.5, y0 + 0.3, -2.42], [-0.5, y0 + 0.3, -2.42], [-0.75, y0 + 0.3, -2.42]], nosAt: [0, y0 + 1.9, 0], snorkelZ: 0, roofY: y0 + 1.95 };
}
let _glow: THREE.MeshStandardMaterial | undefined, _bone: THREE.MeshStandardMaterial | undefined;
const SNAKE_GLOW = () => (_glow ??= new THREE.MeshStandardMaterial({ color: 0x8dff3a, emissive: 0x7dff2a, emissiveIntensity: 3.2, roughness: 0.4 }));
const SNAKE_BONE = () => (_bone ??= new THREE.MeshStandardMaterial({ color: 0xece3cc, roughness: 0.35, metalness: 0.05 }));
