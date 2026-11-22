// Landmark set pieces (the terrain is shaped in gen.ts): meteorite + ejecta in the Impact Crater, a crashed cargo plane in the
// Aircraft Boneyard, sandstone spires and a drivable natural arch in the Hoodoo Garden, ramps and a container gap in the
// Stunt Park, a viewing deck over the Sinkhole, a summit cairn, lookout deck and radio mast on Lookout Peak, a stranded
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

// ---------------- Lookout Peak ----------------
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
  const mark = signTexture('LOOKOUT PEAK', '440 M · HIGHEST ROAD IN THE NORTH', '#1b2a35', '#ffffff');
  const [mx, mz] = at(PEAK_FACE + 0.5, 6.5), my = P.h(mx, mz);
  for (const s of [-1, 1]) P.collide(P.add(new THREE.CylinderGeometry(0.08, 0.08, 2.6, 8), M.steel, mx + Math.cos(PEAK_FACE + 0.5) * s * 1.1, my + 1.3, mz - Math.sin(PEAK_FACE + 0.5) * s * 1.1));
  P.add(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshStandardMaterial({ map: mark, side: THREE.DoubleSide, roughness: 0.6 }), mx, my + 2.2, mz, PEAK_FACE + 0.5 + Math.PI / 2);
  // the lookout: a deck cantilevered off the north rim, looking out over the ranges toward Mount Apex
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
  const pano = signTexture('PANORAMA', 'FROZEN LAKE · MOUNT APEX · THE SINKHOLE', '#22313b', '#ffd9a0');
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
