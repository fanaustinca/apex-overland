// Landmark set pieces (the terrain is shaped in gen.ts): meteorite + ejecta in the Impact Crater, a crashed cargo plane in the
// Aircraft Boneyard, sandstone spires and a drivable natural arch in the Hoodoo Garden, ramps and a container gap in the
// Stunt Park, a viewing deck over the Sinkhole, a summit cairn, lookout deck and radio mast on top of Mount Apex, a stranded
// sailing ship in the dunes, a ring of standing stones in the forest and a Cold War radar station on a snowy hilltop. Everything solid gets a static collider.
import * as THREE from 'three';
import { LANDMARKS, PEAK, type Landmark } from './layout';
const PEAK_FACE = PEAK.face;
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
  summit(P, M, lm('summit'), rockMat);
  shipwreck(P, M, lm('shipwreck'));
  stones(P, M, lm('stones'));
  radar(P, M, lm('radar'));
  ski(P, M, lm('ski'));
  lookout(P, M, lm('lookout'));
  dwellings(P, M, lm('dwellings'));
  mine(P, M, lm('mine'), rockMat);
  ufo(P, M, lm('ufo'));
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

// ---------------- Apex Summit ----------------
function summit(P: Props, M: Record<string, THREE.Material>, l: Landmark, rockMat: THREE.Material) {
  const at = (bear: number, r: number): [number, number] => [l.x + Math.sin(bear) * r, l.z + Math.cos(bear) * r];
  const y0 = P.h(l.x, l.z);
  // summit cairn + flag + marker (the race loop runs round it)
  for (let k = 0; k < 9; k++) { const a = k * 2.4, r = k < 5 ? 1.6 : 0.7; boulder(P, rockMat, l.x + Math.cos(a) * r, l.z + Math.sin(a) * r, k < 5 ? 1.3 : 0.9, a, false); }
  const cairn = P.add(rockGeo(1.1, 1.1, 0.3), rockMat, l.x, y0 + 2.0, l.z); void cairn;
  P.collide(P.add(new THREE.CylinderGeometry(2.4, 2.8, 2.4, 10), rockMat, l.x, y0 + 0.9, l.z)).visible = false;
  P.add(new THREE.CylinderGeometry(0.07, 0.09, 9, 8), M.steel, l.x, y0 + 6.5, l.z);
  const flag = P.add(new THREE.PlaneGeometry(2.4, 1.4), new THREE.MeshStandardMaterial({ color: 0xff7a1a, side: THREE.DoubleSide, roughness: 0.8 }), l.x + 1.25, y0 + 10.2, l.z, 0.4);
  flag.rotation.z = -0.05;
  const mark = signTexture('APEX SUMMIT', '600 M · THE ROOF OF THE MAP', '#1b2a35', '#ffffff');
  const [mx, mz] = at(PEAK_FACE + 0.5, 6.5), my = P.h(mx, mz);
  for (const s of [-1, 1]) P.collide(P.add(new THREE.CylinderGeometry(0.08, 0.08, 2.6, 8), M.steel, mx + Math.cos(PEAK_FACE + 0.5) * s * 1.1, my + 1.3, mz - Math.sin(PEAK_FACE + 0.5) * s * 1.1));
  P.add(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshStandardMaterial({ map: mark, side: THREE.DoubleSide, roughness: 0.6 }), mx, my + 2.2, mz, PEAK_FACE + 0.5 + Math.PI / 2);
  // the lookout: a deck cantilevered off the north rim, looking out over the northern ranges
  const bear = PEAK_FACE + Math.PI + 0.9, [dx, dz] = at(bear, l.r - 6), dy = Math.max(P.h(dx, dz), y0 - 0.3);
  const g = new THREE.Group(); g.position.set(dx, dy, dz); g.rotation.y = bear; P.group.add(g);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.35, 12), M.planks); floor.position.set(0, 0.3, 4); g.add(floor); P.collide(floor);
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 12), M.steel); rail.position.set(s * 4.45, 1.45, 4); g.add(rail); P.collide(rail);
    const rail2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 12), M.steel); rail2.position.set(s * 4.45, 0.95, 4); g.add(rail2);
    for (let k = 0; k < 6; k++) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), M.steel); post.position.set(s * 4.45, 0.9, -1.8 + k * 2.3); g.add(post); }
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 12, 8), M.steel); strut.position.set(s * 3.6, -4.2, 5.5); strut.rotation.x = 0.8; g.add(strut);
  }
  const end = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 0.1), M.steel); end.position.set(0, 1.45, 10); g.add(end); P.collide(end);
  for (let k = 0; k < 5; k++) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), M.steel); post.position.set(-4 + k * 2, 0.9, 10); g.add(post); }
  // coin-op binoculars, a bench and a panorama board
  for (const s of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.1, 8), M.dark); pole.position.set(s * 2.2, 1.0, 9); g.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.5), M.yellow); head.position.set(s * 2.2, 1.65, 9.05); g.add(head);
    for (const e of [-1, 1]) { const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.3, 10), M.dark); lens.rotation.x = Math.PI / 2; lens.position.set(s * 2.2 + e * 0.12, 1.68, 9.4); g.add(lens); }
  }
  const seat = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.5), M.wood); seat.position.set(0, 0.95, 1.6); g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 0.06), M.wood); back.position.set(0, 1.25, 1.35); g.add(back);
  for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.45), M.steel); leg.position.set(s * 1.15, 0.7, 1.6); g.add(leg); }
  const pano = signTexture('PANORAMA', 'THE HUB · FOUR BIOMES · 2.5 KM EACH WAY', '#22313b', '#ffd9a0');
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.7), new THREE.MeshStandardMaterial({ map: pano, roughness: 0.6 })); board.position.set(0, 1.2, 9.6); board.rotation.x = -0.6; board.rotation.y = Math.PI; g.add(board);
  // weather station on the back of the summit: a lattice mast with a red beacon and a hut
  const [hx, hz] = at(PEAK_FACE + Math.PI - 0.5, 27), hy = P.h(hx, hz);
  P.solid(4.4, 2.8, 3.4, M.concrete, hx, hy + 1.3, hz, PEAK_FACE - 0.5);
  P.solid(5.0, 0.25, 4.0, M.corr, hx, hy + 2.85, hz, PEAK_FACE - 0.5, 2, 0.08);
  const [tx, tz] = at(PEAK_FACE + Math.PI - 0.9, 25), ty = P.h(tx, tz);
  for (let k = 0; k < 3; k++) { const a = k * 2.094; P.add(new THREE.CylinderGeometry(0.06, 0.12, 22, 6), M.white, tx + Math.cos(a) * 0.7, ty + 11, tz + Math.sin(a) * 0.7); }
  for (let y = 2; y < 22; y += 2.5) P.add(new THREE.TorusGeometry(0.7, 0.035, 4, 3), M.white, tx, ty + y, tz).rotation.x = Math.PI / 2;
  P.collide(P.add(new THREE.CylinderGeometry(0.9, 0.9, 22, 6), M.white, tx, ty + 11, tz)).visible = false;
  P.add(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff2010, emissive: 0xff1000, emissiveIntensity: 3 }), tx, ty + 22.3, tz);
  P.add(new THREE.BoxGeometry(0.9, 0.5, 0.12), M.steel, tx, ty + 18, tz + 0.75);
  // reflector posts round the rim (not across the road's way in)
  for (let k = 0; k < 22; k++) {
    const a = k / 22 * Math.PI * 2; let dd = a - PEAK_FACE; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
    if (Math.abs(dd) < 0.45 || Math.abs(Math.atan2(Math.sin(a - bear), Math.cos(a - bear))) < 0.32) continue;
    const [px, pz] = at(a, l.r - 1.5), py = P.h(px, pz);
    P.add(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6), M.white, px, py + 0.6, pz); P.add(new THREE.BoxGeometry(0.18, 0.18, 0.05), M.orange, px, py + 1.05, pz, a);
  }
}

/** An invisible static box collider (world-space centre, size, yaw / pitch / roll). */
function blockCollider(P: Props, w: number, h: number, d: number, x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0) {
  const o = P.add(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial(), x, y, z);
  o.rotation.set(pitch, yaw, roll, 'YXZ'); P.collide(o); o.visible = false; return o;
}

// ---------------- Desert Shipwreck ----------------
/** A hull: stations along its length with a rounded-V section, a pointed bow, a fuller transom stern; open at the top. */
function hullGeo(L: number, B: number, D: number): THREE.BufferGeometry {
  const NU = 28, NV = 12, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let a = 0; a <= NU; a++) {
    const u = a / NU, zz = (u - 0.5) * L;
    const bow = u > 0.5 ? Math.pow(1 - (u - 0.5) * 2, 0.55) : 0.72 + 0.28 * Math.pow(u * 2, 0.4);   // u = 1: bow
    const half = B / 2 * bow, deep = D * (0.55 + 0.45 * Math.min(1, bow * 1.3)), sheer = 0.6 * Math.pow(Math.abs(u - 0.45) * 2, 2) * D * 0.5;
    for (let b = 0; b <= NV; b++) {
      const v = -Math.PI / 2 + b / NV * Math.PI;
      pos.push(Math.sin(v) * half, -Math.pow(Math.cos(v), 0.8) * deep + sheer, zz);
      uv.push(u * L / 3, b / NV * 3);
    }
  }
  for (let a = 0; a < NU; a++) for (let b = 0; b < NV; b++) { const i = a * (NV + 1) + b, j = i + NV + 1; idx.push(i, i + 1, j, i + 1, j + 1, j); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function shipwreck(P: Props, M: Record<string, THREE.Material>, l: Landmark) {
  const ux = Math.sin(l.dir), uz = Math.cos(l.dir), lvl = landmarkLevel(l);
  // the hull lies across the way in, keel buried, listing toward the dune bank on its far side
  const L = 48, B = 12, D = 7, yaw = l.dir + Math.PI / 2, roll = -0.21;
  const g = new THREE.Group(); g.position.set(l.x, lvl + 4.6, l.z); g.rotation.set(0.04, yaw, roll, 'YXZ'); P.group.add(g);
  const wood = M.darkPlanks;
  const hullMat = (M.planks as THREE.MeshStandardMaterial).clone(); hullMat.side = THREE.DoubleSide; hullMat.color.set(0xb09a80);
  const hull = new THREE.Mesh(hullGeo(L, B, D), hullMat); g.add(hull);
  // deck (with a gaping hole amidships), rails, cabin, bowsprit, rudder
  for (const [z0, z1] of [[-L / 2 + 2, -4], [4, L / 2 - 7]]) { const dk = new THREE.Mesh(new THREE.BoxGeometry(B * 0.86, 0.3, z1 - z0), M.planks); dk.position.set(0, 0.2, (z0 + z1) / 2); g.add(dk); }
  for (const s of [-1, 1]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.9, L * 0.82), wood); rail.position.set(s * B * 0.45, 0.8, -1); g.add(rail); }
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 6), wood); cabin.position.set(0, 1.6, -L / 2 + 6); g.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.3, 6.6), M.planks); roof.position.set(0, 3.0, -L / 2 + 6); g.add(roof);
  const sprit = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 12, 8), M.log); sprit.rotation.x = Math.PI / 2 - 0.35; sprit.position.set(0, 2.6, L / 2 + 3.5); g.add(sprit);
  const rud = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4, 2.2), wood); rud.position.set(0, -1.8, -L / 2 - 0.6); g.add(rud);
  // masts: the main still stands (with a crow's nest and a yard), the fore snapped, the mizzen a stump
  const mast = (z: number, h: number, tilt = 0) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, h, 10), M.log); m.position.set(0, h / 2, z); m.rotation.z = tilt; g.add(m); return m; };
  mast(1, 22);
  const nest = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.9, 1.0, 10, 1, true), wood); nest.position.set(0, 17, 1); g.add(nest);
  const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 13, 8), M.log); yard.rotation.z = Math.PI / 2 + 0.12; yard.position.set(0, 13, 1); g.add(yard);
  const sail = new THREE.Mesh(new THREE.PlaneGeometry(9, 6, 6, 4), new THREE.MeshStandardMaterial({ color: 0xc9b896, roughness: 0.95, side: THREE.DoubleSide }));
  { const p = sail.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) / 9 + 0.5) * Math.PI) * 0.8 * (0.5 - p.getY(i) / 6)); sail.geometry.computeVertexNormals(); }
  sail.position.set(0.2, 9.8, 1.6); sail.rotation.set(0.05, 0, 0.18); g.add(sail);
  mast(13, 8, 0.15); mast(-12, 3);
  for (const s of [-1, 1]) for (const [z, top] of [[1, 18], [13, 7.5]]) { const len = Math.hypot(top, B * 0.45); const st = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, len, 4), M.dark); st.position.set(s * B * 0.22, top / 2, z - 1.5); st.rotation.z = s * Math.atan2(B * 0.45, top); g.add(st); }
  // exposed ribs where the planking has rotted away at the stern quarter
  for (let k = 0; k < 6; k++) { const rib = new THREE.Mesh(new THREE.TorusGeometry(B * 0.42, 0.18, 5, 12, Math.PI * 0.5), M.log); rib.rotation.set(0, Math.PI / 2, -Math.PI * 0.75); rib.position.set(-B * 0.05, -0.5, -L / 2 + 9 + k * 1.6); g.add(rib); }
  // colliders: the hull body and the two deck sections (so you can drive up the dune and onto her)
  g.updateMatrixWorld(true);
  const col = (w: number, h: number, d: number, lx: number, ly: number, lz: number) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial()); o.position.set(lx, ly, lz); g.add(o); o.visible = false; P.collide(o); };
  col(B * 0.86, 0.6, L / 2 - 5, 0, 0.05, -L / 4 - 1); col(B * 0.86, 0.6, L / 2 - 10, 0, 0.05, L / 4 - 2.5); col(B * 0.7, D * 0.8, L * 0.8, 0, -D * 0.45, 0);
  col(6, 2.6, 6, 0, 1.6, -L / 2 + 6); col(0.8, 22, 0.8, 0, 11, 1);
  // flotsam: barrels, crates, the anchor and a ship's wheel half buried
  for (let k = 0; k < 10; k++) {
    const a = hash(k, 4, 1) * 6.28, r = 16 + hash(k, 2, 7) * 26, x = l.x + Math.cos(a) * r, z = l.z + Math.sin(a) * r, y = P.h(x, z);
    if (k % 2) P.collide(P.add(new THREE.CylinderGeometry(0.45, 0.45, 1.2, 10), M.wood, x, y + 0.4, z, a));
    else P.collide(P.add(new THREE.BoxGeometry(1.1, 0.9, 1.1), M.planks, x, y + 0.3, z, a));
  }
  const ax = l.x - ux * 24 + uz * 14, az = l.z - uz * 24 - ux * 14, ay = P.h(ax, az);
  P.add(new THREE.CylinderGeometry(0.16, 0.16, 3.2, 8), M.rust, ax, ay + 1.0, az).rotation.z = 0.5;
  P.add(new THREE.TorusGeometry(1.0, 0.16, 6, 14, Math.PI), M.rust, ax - 0.6, ay + 0.0, az, l.dir).rotation.z = Math.PI + 0.5;
  const wheel = P.add(new THREE.TorusGeometry(0.9, 0.08, 6, 16), M.wood, l.x + ux * 20, P.h(l.x + ux * 20, l.z + uz * 20) + 0.6, l.z + uz * 20, l.dir); wheel.rotation.x = 0.4;
}

// ---------------- Standing Stones ----------------
function stones(P: Props, M: Record<string, THREE.Material>, l: Landmark) {
  const mossy = new THREE.MeshStandardMaterial({ color: 0x6f7468, roughness: 0.95, flatShading: true });
  const lichen = new THREE.MeshStandardMaterial({ color: 0x5c6b4a, roughness: 1, flatShading: true });
  const R = 22, N = 16;
  const stone = (x: number, z: number, h: number, w: number, yaw: number, lean = 0, m: THREE.Material = mossy) => {
    const y = P.h(x, z), g = rockGeo(1, 1, 0.22); g.scale(w, h / 2, w * 0.55);
    const o = P.add(g, m, x, y + h / 2 - 0.6, z, yaw); o.rotation.z = lean;
    blockCollider(P, w * 1.4, h, w * 0.8, x, y + h / 2 - 0.6, z, yaw); return o;
  };
  for (let k = 0; k < N; k++) {
    const a = k / N * Math.PI * 2 + 0.1; let dd = Math.atan2(Math.sin(a - (Math.PI / 2 - l.dir)), Math.cos(a - (Math.PI / 2 - l.dir)));
    const x = l.x + Math.cos(a) * R, z = l.z + Math.sin(a) * R;
    if (Math.abs(dd) < 0.3 || Math.abs(Math.abs(dd) - Math.PI) < 0.3) continue;                 // the two gateways
    if (k % 5 === 3) { // fallen
      const g = rockGeo(1, 1, 0.22); g.scale(1.1, 0.7, 3); P.add(g, lichen, x + Math.cos(a) * 3, P.h(x, z) + 0.3, z + Math.sin(a) * 3, a);
      continue;
    }
    stone(x, z, 4.2 + hash(k, 3, 3) * 2.6, 1.2 + hash(k, 1, 9) * 0.5, -a + Math.PI / 2, (hash(k, 7, 2) - 0.5) * 0.12);
  }
  // trilithon gates where the way in crosses the ring, on both sides
  for (const s of [1, -1]) {
    const gx = l.x + Math.sin(l.dir) * R * s, gz = l.z + Math.cos(l.dir) * R * s, px = Math.cos(l.dir), pz = -Math.sin(l.dir);
    for (const e of [-1, 1]) stone(gx + px * e * 4.2, gz + pz * e * 4.2, 6.5, 1.6, l.dir, 0, lichen);
    const y = Math.max(P.h(gx + px * 4.2, gz + pz * 4.2), P.h(gx - px * 4.2, gz - pz * 4.2));
    const lg = rockGeo(1, 1, 0.15); lg.scale(6.2, 0.75, 1.1); const lint = P.add(lg, mossy, gx, y + 6.4, gz, l.dir + Math.PI / 2); void lint;
    blockCollider(P, 11, 1.4, 2, gx, y + 6.4, gz, l.dir + Math.PI / 2);
  }
  // the altar stone and a scatter of offerings
  const ay = P.h(l.x, l.z), alt = rockGeo(1, 1, 0.18); alt.scale(3.2, 0.9, 1.8); P.add(alt, mossy, l.x, ay + 0.7, l.z, l.dir + 0.6);
  blockCollider(P, 6, 1.6, 3.4, l.x, ay + 0.7, l.z, l.dir + 0.6);
  for (let k = 0; k < 7; k++) { const a = k * 0.9; P.add(new THREE.CylinderGeometry(0.06, 0.07, 0.3, 6), M.white, l.x + Math.cos(a) * 1.6, ay + 1.6, l.z + Math.sin(a) * 0.8); }
  const sg = signTexture('STANDING STONES', 'C. 2500 BC · PLEASE DO NOT CLIMB', '#2a3322', '#e8efd8');
  const bx = l.x + Math.sin(l.dir) * (R + 10) + Math.cos(l.dir) * 7, bz = l.z + Math.cos(l.dir) * (R + 10) - Math.sin(l.dir) * 7, by = P.h(bx, bz);
  P.collide(P.add(new THREE.BoxGeometry(0.12, 1.2, 0.12), M.wood, bx, by + 0.6, bz));
  P.add(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshStandardMaterial({ map: sg, side: THREE.DoubleSide }), bx, by + 1.25, bz, l.dir + Math.PI / 2).rotation.x = -0.4;
}

// ---------------- Radar Station ----------------
function radar(P: Props, M: Record<string, THREE.Material>, l: Landmark) {
  const at = (bear: number, r: number): [number, number, number] => { const x = l.x + Math.sin(bear) * r, z = l.z + Math.cos(bear) * r; return [x, P.h(x, z), z]; };
  const white = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.55 });
  // two radomes on drum bases
  for (const [bear, r, R] of [[l.dir + 2.2, 26, 8], [l.dir + 3.3, 30, 5.5]] as [number, number, number][]) {
    const [x, y, z] = at(bear, r);
    P.collide(P.add(new THREE.CylinderGeometry(R * 0.95, R, 3, 20), M.concrete, x, y + 1.3, z));
    const dome = P.add(new THREE.SphereGeometry(R, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), white, x, y + 2.8, z);
    const cd = P.add(new THREE.CylinderGeometry(R * 0.7, R * 0.95, R * 0.9, 16), white, x, y + 2.8 + R * 0.45, z); cd.visible = false; P.collide(cd); void dome;
  }
  // the big dish on a pedestal, tilted at the sky
  { const [x, y, z] = at(l.dir + 4.4, 24);
    P.collide(P.add(new THREE.CylinderGeometry(1.6, 2.4, 9, 10), M.concrete, x, y + 4.4, z));
    const dish = new THREE.Mesh(new THREE.SphereGeometry(11, 28, 10, 0, Math.PI * 2, 0, 0.62), new THREE.MeshStandardMaterial({ color: 0xdcdcd6, metalness: 0.5, roughness: 0.35, side: THREE.DoubleSide }));
    dish.position.set(x, y + 19.5, z); dish.rotation.set(Math.PI + 0.75, l.dir + 4.4, 0, 'YXZ'); P.group.add(dish);
    const feed = P.add(new THREE.CylinderGeometry(0.15, 0.15, 7, 6), M.steel, x, y + 14, z); feed.rotation.set(0.75, l.dir + 4.4, 0, 'YXZ');
  }
  // lattice mast with a beacon, the operations block and a perimeter of fence posts
  { const [x, y, z] = at(l.dir + 5.4, 34);
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; P.add(new THREE.CylinderGeometry(0.08, 0.16, 30, 6), M.steel, x + Math.cos(a) * 1.1, y + 15, z + Math.sin(a) * 1.1); }
    for (let yy = 3; yy < 30; yy += 3) P.add(new THREE.TorusGeometry(1.1, 0.04, 4, 4), M.steel, x, y + yy, z).rotation.x = Math.PI / 2;
    blockCollider(P, 2.4, 30, 2.4, x, y + 15, z);
    P.add(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff2010, emissive: 0xff1000, emissiveIntensity: 3 }), x, y + 30.4, z);
  }
  { const [x, y, z] = at(l.dir + 1.2, 28);
    P.solid(14, 4.2, 9, M.concrete, x, y + 1.9, z, l.dir + 1.2);
    P.solid(15, 0.35, 10, M.corr, x, y + 4.15, z, l.dir + 1.2, 3);
    for (let k = -2; k <= 2; k++) P.add(new THREE.BoxGeometry(1.4, 1, 0.1), M.glass, x + Math.cos(l.dir + 1.2) * k * 2.6 + Math.sin(l.dir + 1.2) * 4.56, y + 2.6, z - Math.sin(l.dir + 1.2) * k * 2.6 + Math.cos(l.dir + 1.2) * 4.56, l.dir + 1.2);
    const sg = signTexture('RADAR STATION 7', 'RESTRICTED AREA · DECOMMISSIONED 1991', '#2b2f33', '#ffcf3a');
    P.add(new THREE.PlaneGeometry(5, 1.25), new THREE.MeshStandardMaterial({ map: sg }), x + Math.sin(l.dir + 1.2) * 4.58, y + 3.6, z + Math.cos(l.dir + 1.2) * 4.58, l.dir + 1.2);
  }
  // helipad in the middle of the compound
  { const y = P.h(l.x, l.z); P.add(new THREE.CylinderGeometry(9, 9, 0.12, 32), M.concrete, l.x, y + 0.05, l.z);
    const t = signTexture('H', '', '#3a3d40', '#ffffff'); const hp = P.add(new THREE.PlaneGeometry(6, 6), new THREE.MeshStandardMaterial({ map: t, transparent: false }), l.x, y + 0.13, l.z, l.dir); hp.rotation.x = -Math.PI / 2; }
  for (let k = 0; k < 36; k++) {
    const a = k / 36 * Math.PI * 2; let dd = Math.atan2(Math.sin(a - l.dir), Math.cos(a - l.dir)); if (Math.abs(dd) < 0.25) continue;
    const [x, y, z] = at(a, l.r - 2); P.add(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 5), M.steel, x, y + 1.1, z);
    if (k % 2 === 0) { const [x2, y2, z2] = at(a + Math.PI / 36, l.r - 2); P.add(new THREE.BoxGeometry(0.03, 0.03, Math.hypot(x2 - x, z2 - z)), M.steel, (x + x2) / 2, (y + y2) / 2 + 1.9, (z + z2) / 2, Math.atan2(x2 - x, z2 - z)); }
  }
}

// ---------------- Apex Ski Club ----------------
function ski(P: Props, M: Record<string, THREE.Material>, l: Landmark) {
  const red = new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.5 }), blue = new THREE.MeshStandardMaterial({ color: 0x1f56c8, roughness: 0.5 });
  const yellow = M.yellow, up = Math.atan2(PEAK.x - l.x, PEAK.z - l.z);            // bearing up the slope, toward the summit
  const ux = Math.sin(up), uz = Math.cos(up), px = Math.cos(up), pz = -Math.sin(up);
  const at = (s: number, o: number): [number, number, number] => { const x = l.x + ux * s + px * o, z = l.z + uz * s + pz * o; return [x, P.h(x, z), z]; };
  // chalet base lodge: stone footing, timber walls, a steep roof
  { const [x, y, z] = at(-6, -24), yaw = up;
    P.solid(12, 3.4, 9, M.darkPlanks, x, y + 1.6, z, yaw);
    const roof = new THREE.Shape(); roof.moveTo(-7, 0); roof.lineTo(0, 5.2); roof.lineTo(7, 0); roof.closePath();
    const rg = new THREE.ExtrudeGeometry(roof, { depth: 10.5, bevelEnabled: false }); rg.translate(0, 0, -5.25);
    P.add(rg, M.corr, x, y + 3.3, z, yaw + Math.PI / 2);
    blockCollider(P, 10.5, 5, 13, x, y + 5.5, z, yaw);
    const sg = signTexture('APEX SKI CLUB', 'CHAIRLIFT · SLALOM · JUMP · EST. 1968', '#4a1d12', '#ffe0b0');
    P.add(new THREE.PlaneGeometry(5.6, 1.4), new THREE.MeshStandardMaterial({ map: sg }), x - ux * 4.6, y + 3.0, z - uz * 4.6, up + Math.PI);
  }
  // chairlift (fixed-grip double): the haul rope runs in straight spans between the stations, lifted clear of the ground;
  // towers are sized to meet it; bullwheel terminals at both ends; chairs evenly spaced on the up and down lines
  { const L = 250, oX = 14, G = 2.3, s0 = 8, s1 = s0 + L;
    const [bx, by, bz] = at(s0, oX), [tx, ty, tz] = at(s1, oX);
    // rope profile: straight line between terminals, raised wherever the slope would bring the chairs within 7 m of the snow
    const NS = 50, prof: number[] = [];
    for (let i = 0; i <= NS; i++) { const s = s0 + (L * i) / NS, [, gy] = at(s, oX); prof.push(Math.max(by + 6 + ((ty + 6 - by - 6) * i) / NS, gy + 9.5)); }
    for (let pass = 0; pass < 3; pass++) for (let i = 1; i < NS; i++) prof[i] = Math.max(prof[i], (prof[i - 1] + prof[i + 1]) / 2);   // convex: no kinks downward
    const ropeY = (s: number) => { const f = Math.min(NS, Math.max(0, ((s - s0) / L) * NS)), i = Math.min(NS - 1, Math.floor(f)); return prof[i] + (prof[i + 1] - prof[i]) * (f - i); };
    const rope = (s: number, side: number) => { const [x, , z] = at(s, oX + side); return new THREE.Vector3(x, ropeY(s), z); };
    // terminals: concrete base, steel frame, roof canopy and the horizontal bullwheel the rope wraps round
    for (const [s, x, y, z, top] of [[s0, bx, by, bz, false], [s1, tx, ty, tz, true]] as [number, number, number, number, boolean][]) {
      const ry = ropeY(s);
      P.solid(8, 1.2, 7, M.concrete, x, y + 0.6, z, up);
      for (const [e, f] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.add(new THREE.BoxGeometry(0.35, ry - y + 1.2, 0.35), M.steel, x + px * e * 3 + ux * f * 2.4, (y + ry + 1.2) / 2, z + pz * e * 3 + uz * f * 2.4, up);
      P.add(new THREE.BoxGeometry(8.4, 0.35, 6.4), M.corr, x, ry + 1.6, z, up);                                   // roof
      const wheel = P.add(new THREE.TorusGeometry(G, 0.16, 8, 32), M.dark, x + ux * (top ? 1.2 : -1.2), ry, z + uz * (top ? 1.2 : -1.2)); wheel.rotation.x = Math.PI / 2;
      for (let k = 0; k < 6; k++) { const a2 = (k / 6) * Math.PI; P.add(new THREE.BoxGeometry(G * 2, 0.08, 0.12), M.steel, x + ux * (top ? 1.2 : -1.2), ry, z + uz * (top ? 1.2 : -1.2), a2); }
      P.add(new THREE.BoxGeometry(1.6, 1.2, 1.8), top ? M.concrete : red, x - px * 3.6, y + 1.9, z - pz * 3.6, up);   // operator hut
      blockCollider(P, 8, 2.5, 7, x, y + 1.2, z, up);
    }
    // towers every ~42 m: tapered pylon, crossarm, a sheave train under each rope
    const NT = 5;
    for (let k = 1; k <= NT; k++) {
      const s = s0 + (L * k) / (NT + 1), [x, gy, z] = at(s, oX), ry = ropeY(s), hgt = ry - gy + 0.6;
      P.collide(P.add(new THREE.CylinderGeometry(0.28, 0.55, hgt, 10), M.steel, x, gy + hgt / 2, z));
      P.add(new THREE.BoxGeometry(G * 2 + 1.2, 0.3, 0.4), M.steel, x, ry + 0.75, z, up + Math.PI / 2);
      for (const side of [-G, G]) {
        const sx = x + px * side, sz = z + pz * side;
        P.add(new THREE.BoxGeometry(0.18, 0.18, 2.6), M.dark, sx, ry + 0.2, sz, up);
        for (const w of [-0.9, -0.3, 0.3, 0.9]) { const wh = P.add(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 12), M.dark, sx + ux * w, ry + 0.1, sz + uz * w); wh.rotation.z = Math.PI / 2; wh.rotation.y = up; }
        P.add(new THREE.BoxGeometry(0.1, 0.7, 0.1), M.steel, sx, ry + 0.5, sz);
      }
    }
    // haul rope: short straight pieces following the profile (both lines)
    for (const side of [-G, G]) for (let i = 0; i < NS; i++) {
      const a3 = rope(s0 + (L * i) / NS, side), b3 = rope(s0 + (L * (i + 1)) / NS, side), len = a3.distanceTo(b3);
      const c = P.add(new THREE.CylinderGeometry(0.035, 0.035, len, 4), M.dark, (a3.x + b3.x) / 2, (a3.y + b3.y) / 2, (a3.z + b3.z) / 2);
      c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b3.clone().sub(a3).normalize());
    }
    // chairs every 14 m: grip, hanger, seat, back, armrests and a raised safety bar; riders face their direction of travel
    for (const side of [-G, G]) for (let s = s0 + 7; s < s1 - 5; s += 14) {
      const p = rope(s, side), face = side > 0 ? up : up + Math.PI, fx = Math.sin(face), fz = Math.cos(face), m = side > 0 ? red : blue;
      P.add(new THREE.BoxGeometry(0.25, 0.25, 0.5), M.steel, p.x, p.y - 0.1, p.z, face);
      P.add(new THREE.CylinderGeometry(0.035, 0.035, 2.1, 5), M.steel, p.x, p.y - 1.15, p.z);
      P.add(new THREE.BoxGeometry(1.3, 0.1, 0.55), m, p.x + fx * 0.2, p.y - 2.2, p.z + fz * 0.2, face);
      const back = P.add(new THREE.BoxGeometry(1.3, 0.6, 0.08), m, p.x - fx * 0.08, p.y - 1.9, p.z - fz * 0.08); back.rotation.set(-0.15, face, 0, 'YXZ');
      for (const e of [-0.68, 0.68]) P.add(new THREE.BoxGeometry(0.05, 0.05, 0.6), M.steel, p.x + Math.cos(face) * e + fx * 0.2, p.y - 1.9, p.z - Math.sin(face) * e + fz * 0.2, face);
      P.add(new THREE.BoxGeometry(1.36, 0.05, 0.05), M.steel, p.x + fx * 0.5, p.y - 1.45, p.z + fz * 0.5, face);
    }
  }
  // slalom gates down the piste
  for (let k = 0; k < 9; k++) {
    const s = 40 + k * 22, o = -18 + (k % 2 ? 9 : -9), [x, y, z] = at(s, o), m = k % 2 ? red : blue;
    for (const e of [-2, 2]) { const [gx, gy, gz] = at(s, o + e); P.add(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 6), m, gx, gy + 0.9, gz); }
    P.add(new THREE.PlaneGeometry(4, 0.6), new THREE.MeshStandardMaterial({ color: (m as THREE.MeshStandardMaterial).color, side: THREE.DoubleSide, roughness: 0.8 }), x, y + 1.5, z, up + Math.PI / 2);
  }
  // the jump: a timber kicker on the run-out, lip facing down the slope (come down the piste and send it)
  { const [x, y, z] = at(20, -18), len = 14, hgt = 3.2, pitch = Math.atan2(hgt, len);
    const ramp = P.solid(7, 0.5, Math.hypot(len, hgt), M.planks, x, y + hgt / 2, z, up, 2, pitch);
    void ramp;
    for (const e of [-1, 1]) P.solid(0.3, hgt, 0.3, M.wood, x + px * e * 3.2 - ux * (len / 2 - 0.3), y + hgt / 2, z + pz * e * 3.2 - uz * (len / 2 - 0.3), up);
    for (const e of [-1, 1]) P.add(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), yellow, x + px * e * 4.2 - ux * (len / 2), y + hgt + 1.2, z + pz * e * 4.2 - uz * (len / 2));
  }
  // a piste groomer parked by the lodge
  { const [x, y, z] = at(-14, -6);
    P.solid(3.2, 1.8, 4.2, red, x, y + 1.6, z, up + 0.4);
    P.solid(2.6, 1.3, 2, M.glass, x + ux * 0.6, y + 3.0, z + uz * 0.6, up + 0.4);
    for (const e of [-1, 1]) P.solid(0.9, 1.0, 5, M.dark, x + Math.cos(up + 0.4) * e * 1.9, y + 0.55, z - Math.sin(up + 0.4) * e * 1.9, up + 0.4);
    P.solid(4.4, 0.9, 0.4, M.steel, x - Math.sin(up + 0.4) * 2.9, y + 0.6, z - Math.cos(up + 0.4) * 2.9, up + 0.4);
  }
}

// ---------------- Fire Lookout ----------------
function lookout(P: Props, M: Record<string, THREE.Material>, l: Landmark) {
  const y = P.h(l.x, l.z), H = 13, yaw = l.dir, ux = Math.sin(yaw), uz = Math.cos(yaw), px = Math.cos(yaw), pz = -Math.sin(yaw);
  const timber = new THREE.MeshStandardMaterial({ color: 0x6e4a2c, roughness: 0.85 });
  const green = new THREE.MeshStandardMaterial({ color: 0x3f5f3a, roughness: 0.7 });
  const o = (a: number, b: number): [number, number] => [l.x + px * a + ux * b, l.z + pz * a + uz * b];
  // four splayed legs with X bracing on every face
  const legs: [number, number][] = [[-3, -3], [3, -3], [3, 3], [-3, 3]];
  for (const [a, b] of legs) {
    const [bx, bz] = o(a * 1.35, b * 1.35), [tx, tz] = o(a, b), by = P.h(bx, bz), len = Math.hypot(bx - tx, H + y - by, bz - tz);
    const leg = P.add(new THREE.BoxGeometry(0.32, len, 0.32), timber, (bx + tx) / 2, (by + y + H) / 2, (bz + tz) / 2);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(tx - bx, y + H - by, tz - bz).normalize());
    blockCollider(P, 0.6, len, 0.6, (bx + tx) / 2, (by + y + H) / 2, (bz + tz) / 2);
  }
  for (let k = 0; k < 4; k++) for (const lvl of [0.3, 0.65]) {
    const [a1, b1] = legs[k], [a2, b2] = legs[(k + 1) % 4], f = 1.35 - 0.35 * lvl;
    const [x1, z1] = o(a1 * f, b1 * f), [x2, z2] = o(a2 * f, b2 * f), yy = y + H * lvl;
    const br = P.add(new THREE.BoxGeometry(0.14, 0.14, Math.hypot(x2 - x1, z2 - z1)), timber, (x1 + x2) / 2, yy, (z1 + z2) / 2);
    br.rotation.y = Math.atan2(x2 - x1, z2 - z1);
  }
  // cab: deck, glazed room, pyramid roof, catwalk railing
  P.solid(8.4, 0.3, 8.4, M.planks, l.x, y + H, l.z, yaw);
  P.solid(5.6, 1.1, 5.6, green, l.x, y + H + 0.7, l.z, yaw);
  P.add(new THREE.BoxGeometry(5.4, 1.6, 5.4), M.glass, l.x, y + H + 2.05, l.z, yaw);
  for (const [a, b] of [[-2.75, -2.75], [2.75, -2.75], [2.75, 2.75], [-2.75, 2.75]]) { const [cx, cz2] = o(a, b); P.add(new THREE.BoxGeometry(0.16, 1.7, 0.16), M.white, cx, y + H + 2.05, cz2); }
  const roof = new THREE.ConeGeometry(4.6, 1.8, 4); roof.rotateY(Math.PI / 4);
  P.add(roof, green, l.x, y + H + 3.75, l.z, yaw);
  P.add(new THREE.ConeGeometry(0.12, 1.4, 6), M.steel, l.x, y + H + 5.2, l.z);   // lightning rod
  for (let k = 0; k < 4; k++) {
    const [a1, b1] = legs[k], [a2, b2] = legs[(k + 1) % 4], [x1, z1] = o(a1 * 1.38, b1 * 1.38), [x2, z2] = o(a2 * 1.38, b2 * 1.38);
    const rl = P.add(new THREE.BoxGeometry(0.08, 0.08, Math.hypot(x2 - x1, z2 - z1)), M.white, (x1 + x2) / 2, y + H + 1.05, (z1 + z2) / 2); rl.rotation.y = Math.atan2(x2 - x1, z2 - z1);
  }
  // switchback stairs up the way-in side: flights of treads between landings
  for (let f = 0; f < 4; f++) {
    const y0 = y + (H / 4) * f, side = f % 2 ? 1 : -1;
    for (let k = 0; k < 9; k++) { const [sx, sz] = o(side * (2.6 - k * 0.6), 4.6); P.add(new THREE.BoxGeometry(1.1, 0.08, 0.32), M.planks, sx, y0 + (k + 1) * (H / 36), sz, yaw + Math.PI / 2); }
    const [lx, lz] = o(-side * 3.1, 4.6); P.add(new THREE.BoxGeometry(1.3, 0.12, 1.3), M.planks, lx, y0 + H / 4, lz, yaw);
  }
  // picnic table + a fire-danger sign at the foot
  const [tx, tz] = o(-9, 7), ty = P.h(tx, tz);
  P.solid(2.2, 0.1, 0.9, M.planks, tx, ty + 0.78, tz, yaw); for (const e of [-0.65, 0.65]) P.add(new THREE.BoxGeometry(2.2, 0.08, 0.3), M.planks, tx + px * e, ty + 0.45, tz + pz * e, yaw);
  const sg = signTexture('FIRE DANGER TODAY', 'LOW · MODERATE · HIGH · EXTREME', '#5a2a0c', '#ffd27a');
  const [sx, sz] = o(6, 9), sy = P.h(sx, sz);
  for (const e of [-1.1, 1.1]) P.add(new THREE.CylinderGeometry(0.08, 0.08, 2.6, 6), M.wood, sx + px * e, sy + 1.3, sz + pz * e);
  P.add(new THREE.PlaneGeometry(2.4, 1.1), new THREE.MeshStandardMaterial({ map: sg, side: THREE.DoubleSide }), sx, sy + 2.1, sz, yaw);
}

// ---------------- Cliff Dwellings ----------------
function dwellings(P: Props, M: Record<string, THREE.Material>, l: Landmark) {
  const stone = new THREE.MeshStandardMaterial({ color: 0xb98a5e, roughness: 0.95 }), stone2 = new THREE.MeshStandardMaterial({ color: 0xa47650, roughness: 0.95 });
  const door = new THREE.MeshBasicMaterial({ color: 0x120c08 });
  const back = l.dir + Math.PI, bx = Math.sin(back), bz = Math.cos(back), px = Math.cos(back), pz = -Math.sin(back);
  const yF = P.h(l.x, l.z);
  // rooms stacked against the back of the alcove, in an arc, three storeys high in the middle
  const room = (a: number, depth: number, lvl: number, w: number, m: THREE.Material) => {
    const x = l.x + px * a + bx * depth, z = l.z + pz * a + bz * depth, yaw = back + a * 0.018, h = 3.2;
    const y = Math.max(P.h(x, z), yF) + lvl * h;
    P.solid(w, h, 4.2, m, x, y + h / 2, z, yaw);
    // T-shaped doorway on the front face, little window, roof beams poking out
    const fx = x - bx * 2.12, fz = z - bz * 2.12;
    P.add(new THREE.PlaneGeometry(0.9, 1.5), door, fx, y + 0.95, fz, yaw + Math.PI);
    P.add(new THREE.PlaneGeometry(1.6, 0.45), door, fx, y + 1.85, fz, yaw + Math.PI);
    if (w > 4) P.add(new THREE.PlaneGeometry(0.45, 0.45), door, fx + px * (w / 2 - 0.9), y + 1.9, fz + pz * (w / 2 - 0.9), yaw + Math.PI);
    for (let k = -1; k <= 1; k++) { const v = P.add(new THREE.CylinderGeometry(0.09, 0.09, 1.2, 6), M.wood, fx - bx * 0.3 + px * k * (w / 3), y + h - 0.25, fz - bz * 0.3 + pz * k * (w / 3)); v.rotation.set(Math.PI / 2, back, 0, 'YXZ'); }
    return y + h;
  };
  const plan: [number, number, number, number][] = [[-16, 22, 0, 5], [-10, 24, 0, 6], [-3.5, 25, 0, 6.5], [3, 25, 0, 6], [9.5, 24, 0, 6], [15.5, 22, 0, 5],
    [-9, 26.5, 1, 5.5], [-3, 27, 1, 6], [3.2, 27, 1, 5.5], [9, 26.5, 1, 5], [-1, 28.5, 2, 5], [5, 28.5, 2, 4.5]];
  plan.forEach(([a, d, lv, w], i) => room(a, d, lv, w, i % 3 ? stone : stone2));
  // a round tower at one end
  { const x = l.x + px * 21 + bx * 19, z = l.z + pz * 21 + bz * 19, y = P.h(x, z); P.collide(P.add(new THREE.CylinderGeometry(2.4, 2.6, 8, 14), stone2, x, y + 4, z)); }
  // ladders between storeys
  for (const [a, d, lv] of [[-6.5, 22.6, 0], [6, 22.6, 0], [2, 24.6, 1]] as [number, number, number][]) {
    const x = l.x + px * a + bx * d, z = l.z + pz * d * 0 + pz * a + bz * d, y = yF + lv * 3.2;
    for (const e of [-0.3, 0.3]) { const r = P.add(new THREE.CylinderGeometry(0.05, 0.05, 4.2, 5), M.wood, x + px * e, y + 2, z + pz * e); r.rotation.set(-0.25, back, 0, 'YXZ'); }
    for (let k = 0; k < 8; k++) P.add(new THREE.CylinderGeometry(0.035, 0.035, 0.66, 4), M.wood, x - bx * (0.45 - k * 0.06), y + 0.3 + k * 0.48, z - bz * (0.45 - k * 0.06), back).rotation.z = Math.PI / 2;
  }
  // the kiva: a sunken round ceremonial chamber in the plaza, ladder poking out of its roof
  { const x = l.x + bx * 8, z = l.z + bz * 8, y = P.h(x, z);
    const ring = new THREE.CylinderGeometry(5, 5, 1.0, 24, 1, true);
    P.add(ring, stone, x, y + 0.3, z).material = new THREE.MeshStandardMaterial({ color: 0xa47650, roughness: 0.95, side: THREE.DoubleSide });
    P.add(new THREE.CylinderGeometry(4.95, 4.95, 0.2, 24), M.darkPlanks, x, y + 0.75, z);
    blockCollider(P, 9, 1.2, 9, x, y + 0.4, z);
    for (const e of [-0.3, 0.3]) P.add(new THREE.CylinderGeometry(0.05, 0.05, 3, 5), M.wood, x + px * e, y + 1.6, z + pz * e);
  }
  // pottery
  for (let k = 0; k < 7; k++) { const a = -12 + k * 4, x = l.x + px * a + bx * (17 + (k % 2) * 1.5), z = l.z + pz * a + bz * (17 + (k % 2) * 1.5); P.add(new THREE.SphereGeometry(0.35 + (k % 3) * 0.08, 10, 8), k % 2 ? M.orange : stone2, x, P.h(x, z) + 0.3, z).scale.y = 1.3; }
}

// ---------------- Old Gold Mine ----------------
function mine(P: Props, M: Record<string, THREE.Material>, l: Landmark, rockMat: THREE.Material) {
  const ux = Math.sin(l.dir), uz = Math.cos(l.dir), px = Math.cos(l.dir), pz = -Math.sin(l.dir), yaw = l.dir;
  const timber = new THREE.MeshStandardMaterial({ color: 0x5a3d24, roughness: 0.9 });
  const at = (a: number, b: number): [number, number, number] => { const x = l.x + px * a + ux * b, z = l.z + pz * a + uz * b; return [x, P.h(x, z), z]; };
  // the portal: square-set timbers framing a black adit driven into the hill face at the back of the yard
  const [mx, , mz] = at(0, -l.r * 0.58), my = P.h(l.x + ux * -l.r * 0.3, l.z + uz * -l.r * 0.3);
  P.add(new THREE.BoxGeometry(4.4, 4.6, 6), new THREE.MeshBasicMaterial({ color: 0x050403 }), mx - ux * 2.6, my + 2.3, mz - uz * 2.6, yaw);
  for (const e of [-2.3, 2.3]) P.solid(0.5, 5, 0.5, timber, mx + px * e, my + 2.5, mz + pz * e, yaw);
  P.solid(5.6, 0.6, 0.7, timber, mx, my + 5.1, mz, yaw);
  for (let k = 1; k <= 2; k++) { for (const e of [-2.3, 2.3]) P.add(new THREE.BoxGeometry(0.4, 4.6, 0.4), timber, mx + px * e - ux * k * 1.6, my + 2.3, mz + pz * e - uz * k * 1.6, yaw); P.add(new THREE.BoxGeometry(5, 0.4, 0.4), timber, mx - ux * k * 1.6, my + 4.7, mz - uz * k * 1.6, yaw); }
  const sg = signTexture('BONANZA No. 3', 'DANGER · UNSAFE WORKINGS · KEEP OUT', '#3a1f0e', '#f4c060');
  P.add(new THREE.PlaneGeometry(4.2, 1.0), new THREE.MeshStandardMaterial({ map: sg }), mx + ux * 0.4, my + 6.0, mz + uz * 0.4, yaw);
  // rail track out of the adit to the tip, sleepers every 0.8 m, and two ore carts
  for (let b = -l.r * 0.6; b < l.r * 0.75; b += 0.8) { const [x, y, z] = at(0, b); P.add(new THREE.BoxGeometry(1.6, 0.12, 0.22), timber, x, y + 0.06, z, yaw); }
  for (const e of [-0.45, 0.45]) { const [x0, y0, z0] = at(e, -l.r * 0.6), [x1, y1, z1] = at(e, l.r * 0.75); const r = P.add(new THREE.BoxGeometry(0.07, 0.1, Math.hypot(x1 - x0, z1 - z0)), M.steel, (x0 + x1) / 2, (y0 + y1) / 2 + 0.17, (z0 + z1) / 2, yaw); void r; }
  for (const [b, tilt] of [[-4, 0], [9, 0.5]] as [number, number][]) {
    const [x, y, z] = at(0, b);
    const cart = P.solid(1.3, 0.9, 1.8, M.rust, x, y + 0.85, z, yaw); cart.rotation.z = tilt * 0.3;
    for (const e of [-0.5, 0.5]) for (const f of [-0.6, 0.6]) { const w = P.add(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 10), M.dark, x + px * e + ux * f, y + 0.3, z + pz * e + uz * f); w.rotation.set(0, yaw, Math.PI / 2, 'YXZ'); }
    const ore = rockGeo(0.55, 0.6, 0.4); P.add(ore, rockMat, x, y + 1.35, z, b);
  }
  // headframe: a timber A-frame with a sheave wheel, over a shaft collar beside the yard
  { const [x, y, z] = at(-12, -4);
    for (const e of [-1.6, 1.6]) { const leg = P.add(new THREE.BoxGeometry(0.35, 13, 0.35), timber, x + px * e, y + 6.3, z + pz * e, yaw); leg.rotation.z = -e * 0.06; P.collide(leg); }
    const strut = P.add(new THREE.BoxGeometry(0.3, 12, 0.3), timber, x + ux * 3.2, y + 5.8, z + uz * 3.2, yaw); strut.rotation.set(0.28, yaw, 0, 'YXZ');
    for (const hh of [4, 8, 11.5]) P.add(new THREE.BoxGeometry(3.4 - hh * 0.06, 0.25, 0.25), timber, x, y + hh, z, yaw);
    const wheel = P.add(new THREE.TorusGeometry(1.1, 0.12, 6, 18), M.rust, x, y + 12.6, z, yaw + Math.PI / 2); void wheel;
    for (let k = 0; k < 4; k++) P.add(new THREE.BoxGeometry(0.06, 2.2, 0.06), M.rust, x, y + 12.6, z, yaw + Math.PI / 2).rotation.z = (k * Math.PI) / 4;
    P.solid(3.2, 0.6, 3.2, timber, x, y + 0.3, z, yaw);
  }
  // the assay shack with a tin roof, a gold pile glinting by its door, lanterns
  { const [x, y, z] = at(13, -2); P.solid(5, 3, 4, M.darkPlanks, x, y + 1.5, z, yaw); const r = P.add(new THREE.BoxGeometry(5.8, 0.15, 4.8), M.corr, x, y + 3.25, z, yaw); r.rotation.set(0.18, yaw, 0, 'YXZ');
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc53a, metalness: 1, roughness: 0.25, emissive: 0x5a3a00, emissiveIntensity: 0.6 });
    for (let k = 0; k < 9; k++) P.add(rockGeo(0.22 + (k % 3) * 0.08, 0.7, 0.5), gold, x - ux * 3 + px * ((k % 3) - 1) * 0.5, y + 0.2 + Math.floor(k / 3) * 0.18, z - uz * 3 + pz * (Math.floor(k / 3) - 1) * 0.5, k);
  }
  for (const e of [-6, 6]) { const [x, y, z] = at(e, l.r * 0.2); P.add(new THREE.CylinderGeometry(0.08, 0.1, 3, 6), timber, x, y + 1.5, z); P.add(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffb04a, emissive: 0xff9a2a, emissiveIntensity: 2 }), x, y + 3.1, z); }
}

// ---------------- Crash Site ----------------
function ufo(P: Props, M: Record<string, THREE.Material>, l: Landmark) {
  const ux = Math.sin(l.dir), uz = Math.cos(l.dir), px = Math.cos(l.dir), pz = -Math.sin(l.dir);
  const hull = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 1, roughness: 0.22 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x8b929c, metalness: 0.9, roughness: 0.4 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x9bffd8, emissive: 0x38ffb0, emissiveIntensity: 3 });
  const scorch = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 1, transparent: true, opacity: 0.8, depthWrite: false });
  // the saucer: a lathed double-convex hull with a rim band, a cracked glass dome and a ring of lights, nose-down in its crater
  const prof: THREE.Vector2[] = [[0, -1.6], [3, -1.5], [6.5, -1.0], [9.2, -0.25], [9.6, 0], [9.2, 0.3], [6.5, 0.9], [4, 1.3], [0, 1.4]].map(([a, b]) => new THREE.Vector2(a, b));
  const y = P.h(l.x, l.z), tilt = 0.32;
  const g = new THREE.Group(); g.position.set(l.x, y + 2.3, l.z); g.rotation.set(tilt, l.dir + Math.PI, 0.12, 'YXZ'); P.group.add(g);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, yy = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, yy, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
  add(new THREE.LatheGeometry(prof, 48), hull);
  add(new THREE.TorusGeometry(9.4, 0.18, 8, 64), panel).rotation.x = Math.PI / 2;
  const dome = add(new THREE.SphereGeometry(3.6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6fd8c0, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.55 }), 0, 1.3, 0);
  void dome;
  for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; add(new THREE.SphereGeometry(0.28, 10, 8), glow, Math.cos(a) * 8.6, -0.55, Math.sin(a) * 8.6); }
  add(new THREE.CylinderGeometry(2.2, 2.6, 0.5, 24), glow, 0, -1.6, 0);
  blockCollider(P, 17, 3, 17, l.x, y + 0.8, l.z, l.dir, tilt * 0.7);
  // torn-off panels strewn back along the furrow
  for (let k = 0; k < 10; k++) {
    const b = 18 + k * 13 + hash(k, 2, 1) * 6, a = (hash(k, 5, 3) - 0.5) * 12, x = l.x + ux * b + px * a, z = l.z + uz * b + pz * a;
    const p = P.add(new THREE.BoxGeometry(1 + hash(k, 1, 1) * 2.4, 0.08, 0.8 + hash(k, 3, 3) * 1.6), panel, x, P.h(x, z) + 0.15, z, hash(k, 7, 7) * 6);
    p.rotation.x = (hash(k, 9, 1) - 0.5) * 0.8;
  }
  // scorch marks round the crater
  for (let k = 0; k < 6; k++) { const a = k * 1.1, r = 6 + k * 3, x = l.x + Math.cos(a) * r, z = l.z + Math.sin(a) * r; const d = P.add(new THREE.CircleGeometry(4 + k * 0.6, 20), scorch, x, P.h(x, z) + 0.12, z); d.rotation.x = -Math.PI / 2; }
  // the cordon: hazard posts with tape, a floodlight tower, a warning sign
  const R = l.r - 6, posts: THREE.Vector3[] = [];
  for (let k = 0; k <= 18; k++) { const a = l.dir + 0.5 + (k / 18) * (Math.PI * 2 - 1.0), x = l.x + Math.sin(a) * R, z = l.z + Math.cos(a) * R, yy = P.h(x, z); P.add(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 6), M.orange, x, yy + 0.65, z); posts.push(new THREE.Vector3(x, yy + 1.1, z)); }
  for (let k = 0; k < posts.length - 1; k++) { const a = posts[k], b = posts[k + 1], t = P.add(new THREE.BoxGeometry(0.02, 0.08, a.distanceTo(b)), M.yellow, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); t.rotation.y = Math.atan2(b.x - a.x, b.z - a.z); }
  { const x = l.x + px * 20 + ux * 14, z = l.z + pz * 20 + uz * 14, yy = P.h(x, z);
    P.collide(P.add(new THREE.CylinderGeometry(0.12, 0.2, 7, 6), M.steel, x, yy + 3.5, z));
    for (const e of [-0.7, 0.7]) P.add(new THREE.BoxGeometry(0.8, 0.5, 0.3), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 2.5 }), x + px * e, yy + 7.1, z + pz * e, l.dir + Math.PI);
    P.solid(1.6, 0.9, 2.4, M.yellow, x + ux * 1.5, yy + 0.45, z + uz * 1.5, l.dir);
  }
  const sg = signTexture('RESTRICTED SITE', 'NO PHOTOGRAPHY · NOTHING TO SEE HERE', '#202020', '#f2f2f2');
  const sx = l.x + ux * (l.r + 4) - px * 6, sz = l.z + uz * (l.r + 4) - pz * 6, sy = P.h(sx, sz);
  for (const e of [-1.2, 1.2]) P.add(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), M.steel, sx + px * e, sy + 1.2, sz + pz * e);
  P.add(new THREE.PlaneGeometry(2.8, 1.1), new THREE.MeshStandardMaterial({ map: sg, side: THREE.DoubleSide }), sx, sy + 2.0, sz, l.dir);
}
