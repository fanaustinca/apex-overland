// Landmark set pieces (the terrain is shaped in gen.ts): meteorite + ejecta in the Impact Crater, a crashed cargo plane in the
// Aircraft Boneyard, sandstone spires and a drivable natural arch in the Hoodoo Garden, ramps and a container gap in the
// Stunt Park, a viewing deck over the Sinkhole. Everything solid gets a static collider.
import * as THREE from 'three';
import { LANDMARKS, type Landmark } from './layout';
import { SINK, landmarkLevel } from './gen';
import type { Props } from './props';
import { signTexture } from './props';

const hash = (x: number, y: number, z: number) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
let seedN = 0;
/** A lumpy boulder: an icosphere with position-hashed radial displacement (shared vertices move together, so no cracks). */
function rockGeo(r: number, squash = 0.75, rough = 0.28): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 2), p = g.attributes.position, s = ++seedN * 3.17;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + rough * (hash(Math.round(x * 40) / 40 + s, Math.round(y * 40) / 40, Math.round(z * 40) / 40) - 0.5) + 0.18 * Math.sin(x / r * 2.1 + s) * Math.cos(z / r * 1.7 - s);
    p.setXYZ(i, x * n, y * n * squash, z * n);
  }
  g.computeVertexNormals();
  return g;
}

export function buildLandmarks(P: Props, M: Record<string, THREE.Material>) {
  const lm = (id: string) => LANDMARKS.find((l) => l.id === id)!;
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x4a4440, roughness: 0.95, flatShading: true });
  for (const l of LANDMARKS) gateSign(P, M, l);
  crater(P, M, lm('crater'), rockMat);
  boneyard(P, M, lm('boneyard'));
  hoodoos(P, M, lm('hoodoos'));
  stunt(P, M, lm('stunt'));
  sinkhole(P, M, lm('sinkhole'), rockMat);
}

/** A boulder sitting on the ground with a box collider (big ones only). */
function boulder(P: Props, m: THREE.Material, x: number, z: number, r: number, yaw = 0, collide = true) {
  const o = P.add(rockGeo(r), m, x, P.h(x, z) + r * 0.35, z, yaw);
  if (collide && r > 1.2) P.collide(o);
  return o;
}

function gateSign(P: Props, M: Record<string, THREE.Material>, l: Landmark) {
  const d = l.r + (l.id === 'sinkhole' ? 30 : 12), ux = Math.sin(l.dir), uz = Math.cos(l.dir);
  const x = l.x + ux * d + uz * 9, z = l.z + uz * d - ux * 9, y = P.h(x, z);
  for (const s of [-1, 1]) P.collide(P.add(new THREE.CylinderGeometry(0.1, 0.1, 3.6, 8), M.wood, x + uz * s * 1.5, y + 1.8, z - ux * s * 1.5));
  const t = signTexture(l.name.toUpperCase(), l.blurb.split('.')[0].toUpperCase().slice(0, 34), '#3b2412', '#ffd9a0');
  P.add(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.7 }), x, y + 3.1, z, l.dir + Math.PI / 2);
}

// ---------------- Impact Crater ----------------
function crater(P: Props, M: Record<string, THREE.Material>, l: Landmark, rockMat: THREE.Material) {
  // the meteorite: a glowing core showing through the cracks of a charred shell
  const y = P.h(l.x, l.z);
  const glow = new THREE.MeshStandardMaterial({ color: 0x200500, emissive: 0xff4200, emissiveIntensity: 2.2, roughness: 0.6 });
  P.add(new THREE.IcosahedronGeometry(6.4, 2), glow, l.x, y + 3.6, l.z);
  const shell = P.add(rockGeo(7.4, 0.85, 0.34), new THREE.MeshStandardMaterial({ color: 0x1d1a19, roughness: 0.85, metalness: 0.35, flatShading: true }), l.x, y + 3.9, l.z, 0.7);
  P.collide(shell);
  // scorched shards around it
  for (let k = 0; k < 10; k++) { const a = k * 0.63 + 0.3, r = 9 + hash(k, 1, 2) * 10; boulder(P, rockMat, l.x + Math.cos(a) * r, l.z + Math.sin(a) * r, 0.6 + hash(k, 3, 1) * 1.4, a); }
  // ejecta: boulders thrown over the rim and down the apron
  for (let k = 0; k < 46; k++) {
    const a = hash(k, 7, 3) * Math.PI * 2, gate = Math.abs(Math.atan2(Math.sin(a - (Math.PI / 2 - l.dir)), Math.cos(a - (Math.PI / 2 - l.dir))));
    if (gate < 0.25) continue;   // keep the trail's way in clear
    const r = l.r * (0.92 + hash(k, 2, 9) * 0.6), s = 0.7 + Math.pow(hash(k, 5, 5), 2) * 3.2;
    boulder(P, rockMat, l.x + Math.cos(a) * r, l.z + Math.sin(a) * r, s, a);
  }
  // a little science camp on the rim by the trail: tent, instrument mast, crates
  const ux = Math.sin(l.dir), uz = Math.cos(l.dir), cx = l.x + ux * (l.r + 8) + uz * 22, cz = l.z + uz * (l.r + 8) - ux * 22, cy = P.h(cx, cz);
  P.collide(P.add(new THREE.ConeGeometry(2.6, 2.8, 4), M.orange, cx, cy + 1.4, cz, l.dir + 0.785));
  P.collide(P.add(new THREE.CylinderGeometry(0.07, 0.09, 7, 6), M.steel, cx + 5, cy + 3.5, cz + 1));
  P.add(new THREE.SphereGeometry(0.35, 12, 8), M.white, cx + 5, cy + 7.1, cz + 1);
  for (let k = 0; k < 3; k++) P.solid(1.2, 0.9, 1.2, M.planks, cx - 4 + k * 0.4, cy + 0.45 + (k === 2 ? 0.9 : 0), cz + 3 + (k === 2 ? -0.6 : k * 1.3), k * 0.4);
}

// ---------------- Aircraft Boneyard ----------------
function boneyard(P: Props, M: Record<string, THREE.Material>, l: Landmark) {
  const alu = new THREE.MeshStandardMaterial({ color: 0xc4c8cc, metalness: 0.8, roughness: 0.38 });
  const paint = new THREE.MeshStandardMaterial({ color: 0xe9e6df, metalness: 0.25, roughness: 0.5 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0x1f4fa0, metalness: 0.2, roughness: 0.5 });
  const R = 2.7;
  /** A fuselage section along local +z, lying on the ground (optionally nosed in / listing). */
  const fuselage = (x: number, z: number, yaw: number, len: number, opts: { nose?: boolean; tail?: boolean; roll?: number; pitch?: number; rust?: boolean } = {}) => {
    const g = new THREE.Group(); g.position.set(x, P.h(x, z) + R * 0.82, z); g.rotation.set(opts.pitch ?? 0, yaw, opts.roll ?? 0, 'YXZ'); P.group.add(g);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, len, 28, 1, true).rotateX(Math.PI / 2), opts.rust ? M.rust : paint); g.add(body);
    body.material = opts.rust ? M.rust : paint; (body.material as THREE.Material).side = THREE.DoubleSide;
    const st = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.02, R + 0.02, len, 28, 1, true, Math.PI * 0.42, Math.PI * 0.16).rotateX(Math.PI / 2), stripe); g.add(st);
    for (let w = -len / 2 + 1.5; w < len / 2 - 1; w += 1.3) for (const s of [-1, 1]) { const win = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.34), M.dark); win.position.set(s * R * 0.93, 0.9, w); g.add(win); }
    if (opts.nose) { const n = new THREE.Mesh(new THREE.SphereGeometry(R, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 1.6), paint); n.position.z = len / 2; g.add(n);
      for (const s of [-1, 1]) { const cw = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.06), M.dark); cw.position.set(s * 0.6, 1.25, len / 2 + 2.6); cw.rotation.x = -0.6; g.add(cw); } }
    if (opts.tail) {
      const t = new THREE.Mesh(new THREE.ConeGeometry(R, 7, 28, 1, true).rotateX(-Math.PI / 2), paint); t.position.set(0, 0.6, -len / 2 - 3.5); t.scale.set(1, 0.8, 1); g.add(t);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.35, 6.5, 4.6), paint); fin.position.set(0, 4.2, -len / 2 - 4.6); fin.rotation.x = -0.45; g.add(fin);
      const logo = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.2, 2.0), stripe); logo.position.set(0, 4.8, -len / 2 - 5.0); logo.rotation.x = -0.45; g.add(logo);
      for (const s of [-1, 1]) { const st2 = new THREE.Mesh(new THREE.BoxGeometry(6, 0.25, 2.4), paint); st2.position.set(s * 3, 1.2, -len / 2 - 5.2); g.add(st2); }
    }
    // collider: a box around the tube
    const c = new THREE.Mesh(new THREE.BoxGeometry(R * 1.9, R * 1.9, len + (opts.nose ? 3 : 0)), M.dark); c.visible = false; c.position.z = opts.nose ? 1.5 : 0; g.add(c); P.collide(c); c.removeFromParent();
    return g;
  };
  const ux = Math.sin(l.dir), uz = Math.cos(l.dir), yaw = l.dir + Math.PI;   // the crash came in from the far side, heading toward the trail
  // the crashed freighter: nose section ploughed in at the end of its gouge, tail section broken off behind it
  fuselage(l.x, l.z, yaw, 18, { nose: true, pitch: 0.05, roll: 0.12 });
  fuselage(l.x - ux * 26 + uz * 4, l.z - uz * 26 - ux * 4, yaw + 0.35, 12, { tail: true, roll: -0.25 });
  // the broken left wing lies against the fuselage: tip on the ground, root on the roof line. Drive up it.
  const sx = -uz, sz = ux;      // left of the plane's heading
  const span = 17, rise = 3.6, ang = Math.atan2(rise, span);
  const wx = l.x + sx * (R + span / 2 * Math.cos(ang) - 0.5) - ux * 3, wz = l.z + sz * (R + span / 2 * Math.cos(ang) - 0.5) - uz * 3;
  const wy = P.h(wx, wz) + rise / 2 + 0.05;
  const wing = P.solid(6, 0.5, span, alu, wx, wy, wz, Math.atan2(sx, sz) + Math.PI, 3, -ang);
  void wing;
  const eng = P.add(new THREE.CylinderGeometry(1.15, 1.0, 4.2, 18).rotateX(Math.PI / 2), M.steel, wx + sx * 3 - ux * 0.5, P.h(wx, wz) + 1.0, wz + sz * 3 - uz * 0.5, yaw + 0.2); P.collide(eng);
  // the right wing is gone: a stub and a scatter of panels and debris along the gouge
  P.solid(4, 0.45, 5, alu, l.x - sx * (R + 2) - ux * 3, P.h(l.x - sx * (R + 2), l.z - sz * (R + 2)) + 2.1, l.z - sz * (R + 2) - uz * 3, yaw + Math.PI / 2, 3, 0.08);
  for (let k = 0; k < 18; k++) { const s = 15 + k * 7, o = (hash(k, 4, 4) - 0.5) * 14, px = l.x - ux * s + sx * o, pz = l.z - uz * s + sz * o;
    const w = 0.8 + hash(k, 1, 7) * 2.5; P.solid(w, 0.12 + hash(k, 2, 2) * 0.5, 0.8 + hash(k, 9, 1) * 2, k % 3 ? alu : M.rust, px, P.h(px, pz) + 0.15, pz, hash(k, 3, 3) * 6, 2, (hash(k, 6, 6) - 0.5) * 0.5, P.group, w > 1.6); }
  // the boneyard proper: retired airliners parked in a row, stripped and rusting
  for (let k = 0; k < 3; k++) {
    const off = 55 + k * 17, px = l.x + sx * off + ux * 20, pz = l.z + sz * off + uz * 20;
    fuselage(px, pz, yaw + 0.05 * k, 22 - k * 3, { nose: k !== 1, tail: k !== 2, rust: k === 2 });
  }
  // stacked tyres and a fuel bowser
  for (let k = 0; k < 6; k++) P.collide(P.add(new THREE.TorusGeometry(0.6, 0.3, 8, 16).rotateX(Math.PI / 2), M.dark, l.x - sx * 30 + (k % 3) * 1.4, P.h(l.x - sx * 30, l.z - sz * 30) + 0.3 + Math.floor(k / 3) * 0.6, l.z - sz * 30 + 4));
  const bx = l.x - sx * 38 + ux * 15, bz = l.z - sz * 38 + uz * 15, by = P.h(bx, bz);
  P.collide(P.add(new THREE.CylinderGeometry(1.2, 1.2, 7, 16).rotateZ(Math.PI / 2), M.white, bx, by + 2.0, bz, 0.4));
  P.solid(2.4, 0.4, 8, M.dark, bx, by + 0.6, bz, Math.PI / 2 + 0.4);
}

// ---------------- Hoodoo Garden ----------------
function hoodoos(P: Props, M: Record<string, THREE.Material>, l: Landmark) {
  const sand = M.sandstone, cap = new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.9, flatShading: true });
  const ux = Math.sin(l.dir), uz = Math.cos(l.dir);
  // spires: lathed, wasp-waisted columns with a hard caprock, placed in clusters away from the lane through the arch
  let placed = 0;
  for (let k = 0; k < 140 && placed < 34; k++) {
    const a = hash(k, 1, 1) * Math.PI * 2, r = 25 + Math.sqrt(hash(k, 2, 2)) * (l.r - 15);
    const x = l.x + Math.cos(a) * r, z = l.z + Math.sin(a) * r;
    const lat = Math.abs((x - l.x) * uz - (z - l.z) * ux);
    if (lat < 16) continue;   // lane
    placed++;
    const H = 7 + hash(k, 3, 3) * 17, B = 1.6 + hash(k, 4, 4) * 2.2, seg = 10;
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= seg; i++) { const t = i / seg; prof.push(new THREE.Vector2(B * (1.15 - 0.55 * t + 0.18 * Math.sin(t * 9 + k) + 0.1 * Math.sin(t * 23 + k * 2)), t * H)); }
    const y = P.h(x, z) - 0.6;
    P.add(new THREE.LatheGeometry(prof, 12), sand, x, y, z, k);
    const c = P.add(rockGeo(B * 1.25, 0.45, 0.3), cap, x, y + H + B * 0.2, z, k);
    void c;
    const col = P.add(new THREE.CylinderGeometry(B * 0.85, B * 1.05, H, 8), M.dark, x, y + H / 2, z); col.visible = false; P.collide(col); col.removeFromParent();
  }
  // the natural arch: an eroded sandstone span you can drive through, across the lane
  const span = 26, rise = 15, th = 4.2;
  const ax = l.x, az = l.z, ay = P.h(ax, az) - 1;
  const arch = new THREE.Group(); arch.position.set(ax, ay, az); arch.rotation.y = l.dir; P.group.add(arch);
  const tor = new THREE.Mesh(new THREE.TorusGeometry(span / 2, th, 12, 40, Math.PI), sand); tor.scale.set(1, rise / (span / 2), 1.5); arch.add(tor);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(rockGeo(th * 1.7, 1.3, 0.25), sand); leg.position.set(s * span / 2, 1.5, 0); arch.add(leg);
    const cm = new THREE.Mesh(new THREE.BoxGeometry(th * 2.4, 9, th * 3), M.dark); cm.position.set(s * (span / 2 + 0.3), 3.5, 0); arch.add(cm); cm.visible = false; P.collide(cm); cm.removeFromParent();
  }
  // collider boxes along the top of the arch (for anyone who jumps it)
  for (let k = 1; k < 8; k++) {
    const t = k / 8 * Math.PI, cm = new THREE.Mesh(new THREE.BoxGeometry(5.5, th * 1.4, th * 3), M.dark);
    cm.position.set(Math.cos(t) * span / 2, Math.sin(t) * rise, 0); cm.rotation.z = t - Math.PI / 2; arch.add(cm); cm.visible = false; P.collide(cm); cm.removeFromParent();
  }
  // fallen caprocks and scree
  for (let k = 0; k < 24; k++) { const a = hash(k, 8, 8) * 6.28, r = 20 + hash(k, 9, 9) * l.r; const x = l.x + Math.cos(a) * r, z = l.z + Math.sin(a) * r; if (Math.abs((x - l.x) * uz - (z - l.z) * ux) < 10) continue; boulder(P, cap, x, z, 0.6 + hash(k, 5, 1) * 2, a); }
}

// ---------------- Stunt Park ----------------
function stunt(P: Props, M: Record<string, THREE.Material>, l: Landmark) {
  const deck = new THREE.MeshStandardMaterial({ color: 0x9a9fa6, metalness: 0.7, roughness: 0.4 });
  const ramp = (x: number, z: number, yaw: number, len: number, h: number, w: number, mat: THREE.Material = deck) => {
    // a wedge kicker: a pitched deck whose low edge meets the ground and a vertical back face. +z local = launch direction.
    const ang = Math.atan2(h, len), L = Math.hypot(len, h);
    const g = new THREE.Group(); g.position.set(l.x + x, P.h(l.x + x, l.z + z), l.z + z); g.rotation.y = yaw; P.group.add(g);
    const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, L), mat); top.position.set(0, h / 2 - 0.12, 0); top.rotation.x = -ang; g.add(top);
    const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.3), M.steel); back.position.set(0, h / 2, len / 2); g.add(back);
    for (const s of [-1, 1]) { const side = new THREE.Mesh(new THREE.BoxGeometry(0.12, h * 0.6, len * 0.9), M.yellow); side.position.set(s * w / 2, h * 0.3, len * 0.05); g.add(side); }
    P.collide(top); P.collide(back);
    return g;
  };
  const ux = Math.sin(l.dir), uz = Math.cos(l.dir); void ux; void uz;
  // two kickers launching north into the open middle of the park
  ramp(0, 18, Math.PI, 9, 2.2, 6);
  ramp(16, 18, Math.PI, 11, 3.0, 6, M.orange);
  // container gap on the east side: kicker → two containers → landing ramp, running north
  ramp(80, 70, Math.PI, 11, 3.2, 7);
  const cmats = [M.red, new THREE.MeshStandardMaterial({ color: 0x1f6f8b, roughness: 0.6, metalness: 0.3 })];
  for (let k = 0; k < 2; k++) { const x = l.x + 80, z = l.z + 52 - k * 8; P.solid(6.1, 2.6, 2.44, cmats[k], x, P.h(x, z) + 1.3, z, 0, 2); }
  ramp(80, 30, 0, 14, 3.4, 8);   // landing: high end toward the containers, slope running down northwards
  // quarter pipes on the north edge
  for (const x of [-30, 30]) {
    const g = new THREE.Group(); g.position.set(l.x + x, P.h(l.x + x, l.z - 92), l.z - 92); P.group.add(g);
    for (let k = 0; k < 8; k++) { const t0 = k / 8 * Math.PI / 2, t1 = (k + 1) / 8 * Math.PI / 2, R = 6, c0 = [Math.sin(t0) * R, R - Math.cos(t0) * R], c1 = [Math.sin(t1) * R, R - Math.cos(t1) * R];
      const L = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]), seg = new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, L + 0.1), deck);
      seg.position.set(0, (c0[1] + c1[1]) / 2, -(c0[0] + c1[0]) / 2); seg.rotation.x = Math.atan2(c1[1] - c0[1], c1[0] - c0[0]); g.add(seg); P.collide(seg); }
    const deckTop = new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, 3), M.planks); deckTop.position.set(0, 6, -7.5); g.add(deckTop); P.collide(deckTop);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 0.3), M.steel); wall.position.set(0, 3, -9); g.add(wall); P.collide(wall);
  }
  // tyre walls, flags, a banner gate and floodlights
  for (let a = 0; a < Math.PI * 2; a += 0.09) {
    if (Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2))) < 0.18) continue;   // entrance (south)
    const x = l.x + Math.cos(a) * (l.r - 6), z = l.z + Math.sin(a) * (l.r - 6), y = P.h(x, z);
    const t = P.add(new THREE.TorusGeometry(0.55, 0.28, 8, 14).rotateX(Math.PI / 2), M.dark, x, y + 0.28, z); P.collide(t);
    P.add(new THREE.TorusGeometry(0.55, 0.28, 8, 14).rotateX(Math.PI / 2), (Math.round(a / 0.09) % 2) ? M.white : M.red, x, y + 0.84, z);
  }
  const gx = l.x, gz = l.z + l.r - 4, gy = P.h(gx, gz);
  for (const s of [-1, 1]) P.collide(P.add(new THREE.CylinderGeometry(0.25, 0.25, 7, 10), M.steel, gx + s * 9, gy + 3.5, gz));
  const t = signTexture('STUNT PARK', 'KICKERS · TABLETOPS · BOWL · CONTAINER GAP', '#111317', '#ff7a1a');
  P.add(new THREE.PlaneGeometry(17, 2.6), new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.3 }), gx, gy + 6.2, gz);
  for (const [x, z] of [[-70, -70], [70, -70], [-70, 70], [70, 70]]) { const y = P.h(l.x + x, l.z + z); P.collide(P.add(new THREE.CylinderGeometry(0.2, 0.3, 14, 8), M.steel, l.x + x, y + 7, l.z + z)); P.add(new THREE.BoxGeometry(2.4, 1.2, 0.5), M.emissive, l.x + x, y + 14, l.z + z, Math.atan2(-x, -z)); }
  for (let k = 0; k < 10; k++) { const x = l.x - 95 + k * 21, z = l.z - 104; P.add(new THREE.CylinderGeometry(0.05, 0.05, 6, 6), M.steel, x, P.h(x, z) + 3, z); P.add(new THREE.PlaneGeometry(1.6, 1.0), k % 2 ? M.orange : M.yellow, x + 0.8, P.h(x, z) + 5.4, z); }
  // bleachers on the east side
  for (let k = 0; k < 5; k++) { const x = l.x + 96 + k * 1.1, z = l.z - 10, y = P.h(l.x + 96, z); P.solid(1.1, 0.5 + k * 0.55, 22, M.planks, x, y + (0.5 + k * 0.55) / 2, z, 0, 2); }
}

// ---------------- The Sinkhole ----------------
function sinkhole(P: Props, M: Record<string, THREE.Material>, l: Landmark, rockMat: THREE.Material) {
  const lvl = landmarkLevel(l), ux = Math.sin(l.dir), uz = Math.cos(l.dir);
  // cantilevered viewing deck on the rim opposite the ramp
  const dx = -ux, dz = -uz, x0 = l.x + dx * (l.r + 6), z0 = l.z + dz * (l.r + 6), y0 = Math.max(P.h(x0, z0), lvl + 0.5);
  const yaw = Math.atan2(-dx, -dz);
  const g = new THREE.Group(); g.position.set(x0, y0, z0); g.rotation.y = yaw; P.group.add(g);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(6, 0.3, 16), M.planks); floor.position.set(0, 0.4, 8); g.add(floor); P.collide(floor);
  for (const s of [-1, 1]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 16), M.wood); rail.position.set(s * 3, 1.1, 8); g.add(rail); P.collide(rail); }
  const end = new THREE.Mesh(new THREE.BoxGeometry(6, 1.1, 0.12), M.wood); end.position.set(0, 1.1, 16); g.add(end); P.collide(end);
  for (const s of [-1, 1]) { const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 14, 8), M.steel); strut.position.set(s * 2.6, -4, 5); strut.rotation.x = 0.75; g.add(strut); }
  // boulders on the floor ring, warning signs and reflector posts down the ramp
  for (let k = 0; k < 14; k++) { const a = hash(k, 6, 2) * 6.28, r = SINK.poolR + 4 + hash(k, 1, 3) * (SINK.floorR - SINK.poolR - 6); const x = l.x + Math.cos(a) * r, z = l.z + Math.sin(a) * r; if (Math.abs((x - l.x) * uz - (z - l.z) * ux) < 10 && (x - l.x) * ux + (z - l.z) * uz > 0) continue; boulder(P, rockMat, x, z, 0.8 + hash(k, 2, 8) * 2.2, a); }
  for (let s = SINK.floorR - 4; s < l.r + SINK.rampRun; s += 14) for (const side of [-1, 1]) {
    const x = l.x + ux * s + uz * side * (SINK.rampW + 1.5), z = l.z + uz * s - ux * side * (SINK.rampW + 1.5), y = P.h(x, z);
    P.add(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6), M.white, x, y + 0.6, z); P.add(new THREE.BoxGeometry(0.18, 0.18, 0.05), M.orange, x, y + 1.05, z, l.dir);
  }
  const t = signTexture('DANGER', 'SHEER DROP · NO BARRIERS', '#ffd21a', '#111');
  for (const side of [-1, 1]) { const x = l.x + ux * (l.r + 10) + uz * side * 12, z = l.z + uz * (l.r + 10) - ux * side * 12, y = P.h(x, z); P.collide(P.add(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), M.steel, x, y + 1.2, z)); P.add(new THREE.PlaneGeometry(1.8, 0.45), new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide }), x, y + 2.2, z, l.dir + Math.PI / 2); }
}
