// Static world props with colliders: bridges, garages, quarry plant + crushable trailers, logging camp,
// summit station, barn-find cabins with clues, signposts, speed/jump traps.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { sampleH } from './gen';
import type { World } from './finish';
import { CABINS } from './roads';
import { PITS, CANYON_FLOOR, type P2 } from './layout';
import { RAPIER, G, groups, type Physics } from '../physics/physics';
import { assetUrl } from '../core/assets';

export const GARAGES = [
  { id: 'hub', name: 'Central Hub Garage', x: -95, z: 58, yaw: Math.PI / 2, main: true },
  { id: 'desert', name: 'Dune Outpost Garage', x: 245, z: 1560, yaw: -Math.PI / 2, main: false },
  { id: 'forest', name: 'Logging Camp Garage', x: 1560, z: 360, yaw: Math.PI, main: false },
  { id: 'snow', name: 'Summit Station Garage', x: -160, z: -1340, yaw: 0, main: false },
  { id: 'quarry', name: 'Quarry Works Garage', x: -905, z: -300, yaw: Math.PI / 2, main: false },
];
export const SPEED_TRAPS = [
  { name: 'Hub Highway Radar', x: 35, z: 420, r: 14 }, { name: 'Haul Road Radar', x: -430, z: 6, r: 16 }, { name: 'Dune Flats Radar', x: 165, z: 1520, r: 16 },
  { name: 'Forest Straight Radar', x: 610, z: 20, r: 12 }, { name: 'Ridge Run Radar', x: 300, z: -1435, r: 12 },
];
export const JUMP_TRAPS = [
  { name: 'Narrows West Gap', x: -350, z: 0, r: 16 }, { name: 'Narrows East Gap', x: 560, z: 0, r: 16 },
];

type Tex = { diff: THREE.Texture; nor: THREE.Texture; arm?: THREE.Texture };

function boxUV(w: number, h: number, d: number, tile: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute, n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    const [a, b] = nx > 0.5 ? [d, h] : ny > 0.5 ? [w, d] : [w, h];
    uv.setXY(i, uv.getX(i) * a / tile, uv.getY(i) * b / tile);
  }
  return g;
}

export interface Trailer { body: RAPIER.RigidBody; col: RAPIER.Collider; mesh: THREE.Object3D; crushed: number; x: number; z: number; yaw: number; w: number; h: number; l: number }

export class Props {
  group = new THREE.Group();
  body: RAPIER.RigidBody;
  trailers: Trailer[] = [];
  chimneys: THREE.Vector3[] = [];
  garagePads: { id: string; pos: THREE.Vector3; yaw: number }[] = [];
  cabinPos: Record<string, THREE.Vector3> = {};
  private mats!: Record<string, THREE.Material>;
  constructor(private w: World, private phys: Physics) {
    this.body = phys.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  }
  h(x: number, z: number) { return sampleH(this.w.height, x, z); }

  async build(tex: (n: string) => Promise<Tex>) {
    const t = async (n: string, rep = 1, tint = 0xffffff, rough = 1) => { const x = await tex(n); const m = new THREE.MeshStandardMaterial({ map: x.diff, normalMap: x.nor, roughnessMap: x.arm, aoMap: undefined, color: tint, roughness: rough, metalness: n.includes('metal') || n.includes('iron') ? 0.6 : 0 }); void rep; return m; };
    this.mats = {
      planks: await t('weathered_planks'), rust: await t('rusty_metal_02'), corr: await t('rusty_corrugated_iron'), plate: await t('metal_plate', 1, 0xc8c8c8),
      concrete: await t('concrete_floor_painted', 1, 0xd8d4cc), darkPlanks: await t('weathered_planks', 1, 0x8a7a68),
      steel: new THREE.MeshStandardMaterial({ color: 0x5d6064, metalness: 0.75, roughness: 0.45 }),
      red: new THREE.MeshStandardMaterial({ color: 0xa8321e, metalness: 0.3, roughness: 0.6 }),
      orange: new THREE.MeshStandardMaterial({ color: 0xff7a1a, metalness: 0.2, roughness: 0.5 }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xe8b818, metalness: 0.3, roughness: 0.55 }),
      white: new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.6 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.7 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x223344, metalness: 0.3, roughness: 0.05, envMapIntensity: 2 }),
      stone: await t('red_sandstone_wall', 1, 0xd8c0a0), sandstone: await t('red_sandstone_wall', 1, 0xffffff),
      wood: new THREE.MeshStandardMaterial({ color: 0x6b5236, roughness: 0.9 }),
      log: new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.95 }),
      emissive: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe4b0, emissiveIntensity: 2.5 }),
      gravel: new THREE.MeshStandardMaterial({ color: 0x9a8e80, roughness: 1 }),
    };
    this.bridges(); this.garages(); this.quarry(); this.loggingCamp(); this.cabins(); this.signposts(); this.traps();
    this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  }

  // ---- helpers ----
  private add(g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, yaw = 0, parent: THREE.Object3D = this.group) {
    const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.y = yaw; parent.add(o); return o;
  }
  /** Box mesh + matching static collider (world space). */
  private solid(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, yaw = 0, tile = 2, pitch = 0, parent: THREE.Object3D = this.group, collide = true) {
    const o = this.add(boxUV(w, h, d, tile), m, x, y, z, 0, parent);
    o.rotation.set(pitch, yaw, 0, 'YXZ');
    if (collide) {
      o.updateWorldMatrix(true, false);
      const q = new THREE.Quaternion(), p = new THREE.Vector3(); o.matrixWorld.decompose(p, q, new THREE.Vector3());
      this.phys.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(p.x, p.y, p.z).setRotation(q).setFriction(0.9).setCollisionGroups(groups(G.PROP, 0xffff)), this.body);
    }
    return o;
  }
  private cylinder(r: number, h: number, m: THREE.Material, x: number, y: number, z: number, collide = true, seg = 16, parent: THREE.Object3D = this.group) {
    const o = this.add(new THREE.CylinderGeometry(r, r, h, seg), m, x, y, z, 0, parent);
    if (collide) this.phys.world.createCollider(RAPIER.ColliderDesc.cylinder(h / 2, r).setTranslation(x, y, z).setCollisionGroups(groups(G.PROP, 0xffff)), this.body);
    return o;
  }

  // ---- bridges ----
  private bridges() {
    const M = this.mats;
    for (const b of this.w.bridges) {
      const [ax, az] = b.a, [bx, bz] = b.b;
      const L = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(bx - ax, bz - az);
      const seg = Math.ceil(L / 8);
      const dirx = (bx - ax) / L, dirz = (bz - az) / L;
      const deckMat = b.style === 'trestle' ? M.planks : b.style === 'arch' ? M.sandstone : M.concrete;
      for (let i = 0; i < seg; i++) {
        const t0 = i / seg, t1 = (i + 1) / seg, tm = (t0 + t1) / 2;
        const x = ax + (bx - ax) * tm, z = az + (bz - az) * tm;
        const y0 = b.ha + (b.hb - b.ha) * t0, y1 = b.ha + (b.hb - b.ha) * t1;
        const pitch = -Math.atan2(y1 - y0, L / seg);
        const thick = b.style === 'arch' ? 1.2 : 0.6;
        this.solid(b.width, thick, L / seg + 0.05, deckMat, x, (y0 + y1) / 2 - thick / 2 - 0.05, z, yaw, 3, pitch);
        // rails / parapets
        for (const side of [-1, 1]) {
          const ox = Math.cos(yaw) * side * (b.width / 2 + 0.15), oz = -Math.sin(yaw) * side * (b.width / 2 + 0.15);
          if (b.style === 'arch') this.solid(0.5, 1.0, L / seg + 0.05, M.stone, x + ox, (y0 + y1) / 2 + 0.45, z + oz, yaw, 2, pitch);
          else if (b.style === 'trestle') { this.solid(0.18, 0.18, L / seg + 0.05, M.wood, x + ox, (y0 + y1) / 2 + 0.9, z + oz, yaw, 2, pitch); this.add(new THREE.BoxGeometry(0.18, 1.0, 0.18), M.wood, x + ox, (y0 + y1) / 2 + 0.45, z + oz, yaw); }
          else this.solid(0.3, 0.9, L / seg + 0.05, M.steel, x + ox, (y0 + y1) / 2 + 0.45, z + oz, yaw, 2, pitch);
        }
      }
      if (b.style === 'truss') {
        // steel through-truss: top chords, verticals, diagonals; concrete piers
        const H = 6;
        for (const side of [-1, 1]) {
          const ox = Math.cos(yaw) * side * (b.width / 2 + 0.4), oz = -Math.sin(yaw) * side * (b.width / 2 + 0.4);
          const top = (t: number) => b.ha + (b.hb - b.ha) * t + H;
          for (let i = 0; i <= seg; i++) {
            const t = i / seg, x = ax + (bx - ax) * t + ox, z = az + (bz - az) * t + oz, y = b.ha + (b.hb - b.ha) * t;
            this.add(new THREE.BoxGeometry(0.35, H, 0.35), M.red, x, y + H / 2, z, yaw);
            if (i < seg) {
              const t2 = (i + 1) / seg, x2 = ax + (bx - ax) * t2 + ox, z2 = az + (bz - az) * t2 + oz;
              const len = Math.hypot(L / seg, H);
              const diag = this.add(new THREE.BoxGeometry(0.25, len, 0.25), M.red, (x + x2) / 2, y + H / 2, (z + z2) / 2, yaw);
              diag.rotation.set((i % 2 ? 1 : -1) * Math.atan2(L / seg, H), yaw, 0, 'YXZ');
              this.add(new THREE.BoxGeometry(0.45, 0.45, L / seg + 0.4), M.red, (x + x2) / 2, top((t + t2) / 2), (z + z2) / 2, yaw);
            }
          }
        }
        for (let i = 1; i < seg; i += 3) { const t = i / seg; const x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = b.ha + (b.hb - b.ha) * t + H; this.add(new THREE.BoxGeometry(b.width + 1, 0.35, 0.35), M.red, x, y, z, yaw); }
        for (const t of [0.33, 0.67]) { const x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = b.ha + (b.hb - b.ha) * t; const top = y - 0.7, bot = CANYON_FLOOR - 2; this.solid(3, top - bot, 3, M.concrete, x, (top + bot) / 2, z, yaw, 3); }
      } else if (b.style === 'trestle') {
        for (let i = 1; i < seg; i++) {
          const t = i / seg, x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = b.ha + (b.hb - b.ha) * t;
          const ground = this.h(x, z);
          if (y - ground < 1.5) continue;
          const hh = y - ground + 0.5;
          for (const side of [-1, 0.0, 1]) {
            const ox = Math.cos(yaw) * side * (b.width / 2 - 0.3), oz = -Math.sin(yaw) * side * (b.width / 2 - 0.3);
            this.add(new THREE.BoxGeometry(0.3, hh, 0.3), M.wood, x + ox, ground + hh / 2 - 0.6, z + oz, yaw);
          }
          for (let k = 0; k < hh / 4 - 1; k++) {
            const yy = ground + 2 + k * 4;
            const brace = this.add(new THREE.BoxGeometry(0.16, Math.hypot(b.width, 4), 0.16), M.wood, x, yy + 2, z, yaw);
            brace.rotation.set(0, yaw, (k % 2 ? 1 : -1) * Math.atan2(b.width, 4), 'YXZ');
            this.add(new THREE.BoxGeometry(b.width, 0.2, 0.2), M.wood, x, yy, z, yaw);
          }
        }
      } else {
        // stone arch: one solid-spandrel arch, extruded across the deck, springing from both canyon walls
        const sh = new THREE.Shape();
        const deckY = (t: number) => b.ha + (b.hb - b.ha) * t - 1.2;
        const crown = Math.min(b.ha, b.hb) - 4.5, spring = CANYON_FLOOR + 7;
        const N2 = 40;
        sh.moveTo(0, deckY(0));
        for (let i = 1; i <= N2; i++) sh.lineTo(L * i / N2, deckY(i / N2));
        // down the far wall, then the intrados (parabola) back, then up the near wall
        sh.lineTo(L, spring - 6);
        for (let i = N2; i >= 0; i--) { const t = i / N2, u = 0.06 + 0.88 * t; const y = spring + (crown - spring) * (1 - Math.pow(2 * t - 1, 2)); sh.lineTo(L * u, y); }
        sh.lineTo(0, spring - 6);
        sh.closePath();
        const ag = new THREE.ExtrudeGeometry(sh, { depth: b.width - 0.6, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.25, bevelSegments: 2, curveSegments: 4 });
        ag.translate(0, 0, -(b.width - 0.6) / 2);
        // UVs in metres for the stone texture
        const uv = ag.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 4, uv.getY(i) / 4);
        const am = new THREE.Mesh(ag, M.sandstone);
        am.position.set(ax, 0, az); am.rotation.y = yaw - Math.PI / 2;
        this.group.add(am);
      }
      void dirx; void dirz;
    }
  }

  // ---- garages ----
  private garages() {
    const M = this.mats;
    for (const gdef of GARAGES) {
      const g = new THREE.Group(); const y = this.h(gdef.x, gdef.z);
      g.position.set(gdef.x, y, gdef.z); g.rotation.y = gdef.yaw; this.group.add(g);
      const W = gdef.main ? 34 : 16, D = gdef.main ? 20 : 12, H = gdef.main ? 9 : 6;
      const wall = gdef.main ? M.concrete : M.corr;
      // foundation pad
      this.add(boxUV(W + 40, 1.2, D + 34, 4), M.concrete, 8, -0.45, 10, 0, g);
      // walls (front has roller doors)
      const parts: [number, number, number, number, number, number][] = [[W, H, 0.4, 0, H / 2, -D / 2], [0.4, H, D, -W / 2, H / 2, 0], [0.4, H, D, W / 2, H / 2, 0]];
      for (const [w, h, d, x, yy, z] of parts) this.add(boxUV(w, h, d, 3), wall, x, yy, z, 0, g);
      const doors = gdef.main ? 3 : 1, dw = (W - 2) / doors;
      for (let i = 0; i < doors; i++) {
        const x = -W / 2 + 1 + dw * (i + 0.5);
        this.add(boxUV(dw - 1.4, 1.8, 0.3, 2), wall, x, H - 0.9, D / 2, 0, g);
        this.add(boxUV(0.7, H, 0.5, 2), wall, x - dw / 2, H / 2, D / 2, 0, g);
        if (i === doors - 1) this.add(boxUV(0.7, H, 0.5, 2), wall, x + dw / 2, H / 2, D / 2, 0, g);
        const door = this.add(boxUV(dw - 1.4, 1.2, 0.1, 1.2), M.plate, x, H - 2.4, D / 2 - 0.1, 0, g); void door;
      }
      // roof with overhang + sign
      const roof = this.add(boxUV(W + 2, 0.5, D + 4, 3), M.dark, 0, H + 0.25, 1, 0, g); void roof;
      if (gdef.main) {
        const sign = signTexture('APEX OVERLAND', 'CENTRAL GARAGE · UPGRADES · TUNING');
        const sm = new THREE.MeshStandardMaterial({ map: sign, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 0.6 });
        this.add(new THREE.PlaneGeometry(16, 3.2), sm, 0, H + 2.2, D / 2 + 1.0, 0, g);
        this.add(boxUV(16.6, 3.6, 0.4, 2), M.dark, 0, H + 2.2, D / 2 + 0.75, 0, g);
        // fuel pumps + canopy + flag poles
        for (const z of [-6, 0, 6]) { this.add(boxUV(0.6, 2.0, 1.0, 1), M.orange, W / 2 + 16, 1.0, D / 2 + 4 + z, 0, g); this.add(new THREE.CylinderGeometry(0.15, 0.15, 6.4, 8), M.steel, W / 2 + 16, 3.2, D / 2 + 4 + z, 0, g); }
        this.add(boxUV(8, 0.6, 20, 3), M.white, W / 2 + 16, 6.6, D / 2 + 4, 0, g);
        for (const x of [-W / 2 - 4, W / 2 + 4]) { this.add(new THREE.CylinderGeometry(0.1, 0.12, 14, 8), M.steel, x, 7, D / 2 + 4, 0, g); this.add(new THREE.PlaneGeometry(3, 1.8), M.orange, x + 1.55, 12.8, D / 2 + 4, 0, g).material = new THREE.MeshStandardMaterial({ color: 0xff7a1a, side: THREE.DoubleSide }); }
        // car lifts + tyre stacks inside
        for (const x of [-10, 10]) { this.add(boxUV(4, 0.3, 6, 2), M.yellow, x, 1.8, 0, 0, g); for (const zz of [-2.5, 2.5]) this.add(new THREE.CylinderGeometry(0.2, 0.2, 1.8, 10), M.yellow, x - 1.8, 0.9, zz, 0, g); }
        for (let k = 0; k < 6; k++) this.add(new THREE.TorusGeometry(0.42, 0.2, 8, 18).rotateX(Math.PI / 2), M.dark, W / 2 - 2, 0.2 + k * 0.4, -D / 2 + 2, 0, g);
        // showroom turntable in front
        const tt = this.add(new THREE.CylinderGeometry(7.5, 7.8, 0.3, 48), M.dark, 0, 0.15, D / 2 + 18, 0, g);
        const ring = this.add(new THREE.TorusGeometry(7.6, 0.08, 6, 64).rotateX(Math.PI / 2), M.emissive, 0, 0.31, D / 2 + 18, 0, g); void tt; void ring;
      } else {
        const sign = signTexture('GARAGE', gdef.name.toUpperCase());
        const sm = new THREE.MeshStandardMaterial({ map: sign, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 0.5 });
        this.add(new THREE.PlaneGeometry(8, 1.6), sm, 0, H + 1.2, D / 2 + 1.05, 0, g);
        this.add(boxUV(4, 3, 3, 2), M.rust, -W / 2 - 3, 1.5, 2, 0, g);
      }
      // colliders for the building shell (world space)
      g.updateMatrixWorld(true);
      const cos = Math.cos(gdef.yaw), sin = Math.sin(gdef.yaw);
      const toW = (lx: number, lz: number) => [gdef.x + lx * cos + lz * sin, gdef.z - lx * sin + lz * cos];
      for (const [w, h, d, x, yy, z] of parts) {
        const [wx, wz] = toW(x, z);
        this.phys.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(wx, y + yy, wz).setRotation({ x: 0, y: Math.sin(gdef.yaw / 2), z: 0, w: Math.cos(gdef.yaw / 2) }).setCollisionGroups(groups(G.PROP, 0xffff)), this.body);
      }
      const [px, pz] = toW(0, D / 2 + (gdef.main ? 18 : 10));
      this.garagePads.push({ id: gdef.id, pos: new THREE.Vector3(px, this.h(px, pz), pz), yaw: gdef.yaw });
    }
  }

  // ---- quarry ----
  private quarry() {
    const M = this.mats;
    // crusher plant between the pits
    const cx = -900, cz = 230, cy = this.h(cx, cz);
    this.solid(14, 12, 10, M.corr, cx, cy + 6, cz, 0.3, 3);
    this.solid(6, 4, 6, M.rust, cx + 9, cy + 10, cz + 3, 0.3, 2);
    for (let i = 0; i < 3; i++) this.add(new THREE.ConeGeometry(9 + i * 2, 8 + i, 18), M.gravel, cx - 25 + i * 18, cy + 4, cz + 28 - i * 6);
    // conveyors
    for (const [x0, z0, x1, z1, h0, h1] of [[cx + 5, cz + 6, cx - 22, cz + 30, 11, 7], [cx - 6, cz - 6, cx - 40, cz - 40, 9, 2]]) {
      const L = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0), y0 = cy + h0, y1 = cy + h1;
      const belt = this.add(boxUV(1.6, 0.4, L, 2), M.rust, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, yaw);
      belt.rotation.set(-Math.atan2(y1 - y0, L), yaw, 0, 'YXZ');
      for (let k = 0.15; k < 1; k += 0.25) { const x = x0 + (x1 - x0) * k, z = z0 + (z1 - z0) * k, yy = y0 + (y1 - y0) * k; this.add(new THREE.BoxGeometry(0.3, yy - cy, 0.3), M.steel, x, (yy + cy) / 2, z, yaw); }
    }
    // giant excavator on pit A's rim
    const ex = PITS[0].x + 140, ez = PITS[0].z - 260, ey = this.h(ex, ez);
    const exg = new THREE.Group(); exg.position.set(ex, ey, ez); exg.rotation.y = 2.2; this.group.add(exg);
    for (const s of [-1, 1]) this.add(boxUV(2.4, 2.2, 11, 2), M.dark, s * 3.4, 1.1, 0, 0, exg);
    this.add(boxUV(8, 4.5, 9, 2), M.yellow, 0, 4.6, -0.5, 0, exg);
    this.add(boxUV(3, 3, 3, 1), M.yellow, -2.2, 8.2, 2.6, 0, exg);
    const boom = this.add(boxUV(1.6, 1.6, 14, 2), M.yellow, 0, 9.5, 8, 0, exg); boom.rotation.x = -0.5;
    const arm = this.add(boxUV(1.2, 1.2, 9, 2), M.yellow, 0, 9.5, 17, 0, exg); arm.rotation.x = 0.9;
    this.add(boxUV(4, 3, 3, 1), M.rust, 0, 4.5, 20, 0, exg);
    this.phys.world.createCollider(RAPIER.ColliderDesc.cuboid(4.6, 3.5, 6).setTranslation(ex, ey + 3.5, ez).setRotation({ x: 0, y: Math.sin(1.1), z: 0, w: Math.cos(1.1) }).setCollisionGroups(groups(G.PROP, 0xffff)), this.body);
    // crushable site trailers
    const spots: [number, number, number][] = [[-760, -140, 0.2], [-775, -110, 0.2], [-1015, 420, 1.2], [-860, 300, 0.5], [-640, -60, 1.5], [-905, -260, 0.0]];
    for (const [x, z, yaw] of spots) this.trailer(x, z, yaw);
    // drainage trench markers: rusty culvert pipes
    for (const [x, z] of [[-1050, 180], [-760, 520]]) { const yy = this.h(x, z); this.add(new THREE.CylinderGeometry(1.2, 1.2, 8, 20, 1, true).rotateZ(Math.PI / 2), M.rust, x, yy + 0.6, z, 0.7).material = new THREE.MeshStandardMaterial({ map: (M.rust as THREE.MeshStandardMaterial).map, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.7 }); }
  }
  private trailer(x: number, z: number, yaw: number) {
    const M = this.mats, y = this.h(x, z);
    const w = 3, h = 3, l = 9;
    const grp = new THREE.Group(); grp.position.set(x, y, z); grp.rotation.y = yaw; this.group.add(grp);
    const inner = new THREE.Group(); grp.add(inner);
    this.add(boxUV(w, h, l, 2), M.white, 0, h / 2 + 0.6, 0, 0, inner);
    this.add(boxUV(w + 0.05, 0.3, l + 0.05, 2), M.orange, 0, h * 0.75 + 0.6, 0, 0, inner);
    for (const zz of [-2.5, 0, 2.5]) this.add(new THREE.PlaneGeometry(1.4, 0.9), M.glass, w / 2 + 0.03, h * 0.6 + 0.6, zz, Math.PI / 2, inner);
    this.add(boxUV(0.05, 2.1, 0.9, 1), M.dark, -w / 2 - 0.03, 1.65, 1, 0, inner);
    for (const zz of [-3.5, 3.5]) this.add(boxUV(w * 0.9, 0.6, 0.4, 1), M.dark, 0, 0.3, zz, 0, inner);
    const body = this.phys.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const col = this.phys.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, (h + 0.6) / 2, l / 2).setTranslation(x, y + (h + 0.6) / 2, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      .setCollisionGroups(groups(G.PROP, 0xffff)).setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(20000), body);
    this.trailers.push({ body, col, mesh: inner, crushed: 0, x, z, yaw, w, h: h + 0.6, l });
  }
  /** Flatten a trailer (monster trucks and heavyweights crush them). */
  crush(t: Trailer) {
    if (t.crushed) return false;
    t.crushed = 0.001;
    this.phys.world.removeCollider(t.col, false);
    const y = this.h(t.x, t.z);
    t.col = this.phys.world.createCollider(RAPIER.ColliderDesc.cuboid(t.w / 2 + 0.2, 0.45, t.l / 2).setTranslation(t.x, y + 0.45, t.z).setRotation({ x: 0, y: Math.sin(t.yaw / 2), z: 0, w: Math.cos(t.yaw / 2) }).setCollisionGroups(groups(G.PROP, 0xffff)), t.body);
    return true;
  }
  update(dt: number) {
    for (const t of this.trailers) if (t.crushed > 0 && t.crushed < 1) { t.crushed = Math.min(1, t.crushed + dt * 3); t.mesh.scale.set(1 + t.crushed * 0.15, 1 - t.crushed * 0.72, 1); t.mesh.rotation.z = t.crushed * 0.08; }
  }

  // ---- logging camp ----
  private loggingCamp() {
    const M = this.mats, cx = 1500, cz = 300;
    const cy = this.h(cx, cz);
    for (let p = 0; p < 4; p++) {
      const px = cx - 30 + p * 14, pz = cz - 30;
      for (let r = 0; r < 4; r++) for (let k = 0; k < 4 - r; k++) {
        const lg = this.add(new THREE.CylinderGeometry(0.45, 0.5, 9, 12).rotateX(Math.PI / 2), M.log, px + (k - (3 - r) / 2) * 0.95, this.h(px, pz) + 0.5 + r * 0.82, pz);
        void lg;
      }
      this.phys.world.createCollider(RAPIER.ColliderDesc.cuboid(2.2, 1.8, 4.5).setTranslation(px, this.h(px, pz) + 1.8, pz).setCollisionGroups(groups(G.PROP, 0xffff)), this.body);
    }
    this.solid(12, 6, 8, M.darkPlanks, cx + 30, cy + 3, cz - 10, 0.4, 2);
    this.solid(13, 0.4, 9.5, M.corr, cx + 30, cy + 6.3, cz - 10, 0.4, 2);
    // stump field
    for (let i = 0; i < 30; i++) { const a = i * 2.4, r = 20 + (i * 7) % 40; const x = cx + Math.cos(a) * r, z = cz + 20 + Math.sin(a) * r; this.add(new THREE.CylinderGeometry(0.35, 0.45, 0.6, 10), M.log, x, this.h(x, z) + 0.2, z); }
    void cy;
  }

  // ---- barn-find cabins + clues ----
  private cabins() {
    const M = this.mats;
    for (const c of CABINS) {
      const y = this.h(c.x, c.z);
      const g = new THREE.Group(); g.position.set(c.x, y, c.z); g.rotation.y = c.yaw; this.group.add(g);
      const snow = c.biome === 2, adobe = c.biome === 0;
      const wall = adobe ? new THREE.MeshStandardMaterial({ color: 0xb98a62, roughness: 0.95 }) : c.biome === 3 ? M.corr : M.darkPlanks;
      // barn: walls, gable roof, big doors, chimney
      const W = 10, D = 12, H = 4.5;
      for (const [w, h, d, x, z] of [[W, H, 0.4, 0, -D / 2], [0.4, H, D, -W / 2, 0], [0.4, H, D, W / 2, 0], [W * 0.25, H, 0.4, -W * 0.375, D / 2], [W * 0.25, H, 0.4, W * 0.375, D / 2]] as number[][]) this.add(boxUV(w, h, d, 2), wall, x, h / 2, z, 0, g);
      const roofMat = snow ? M.white : adobe ? wall : M.corr;
      for (const s of [-1, 1]) { const r = this.add(boxUV(W / 2 + 1.2, 0.25, D + 1.2, 2), roofMat, s * W / 4, H + 1.3, 0, 0, g); r.rotation.z = -s * 0.5; }
      for (const s of [-1, 1]) { const gable = new THREE.Shape(); gable.moveTo(-W / 2, 0); gable.lineTo(W / 2, 0); gable.lineTo(0, 2.6); gable.closePath(); this.add(new THREE.ShapeGeometry(gable), wall, 0, H, s * D / 2 * 0.98, s > 0 ? 0 : Math.PI, g); }
      const door = this.add(boxUV(W * 0.48, H * 0.9, 0.15, 2), M.darkPlanks, -W * 0.12, H * 0.45, D / 2 + 0.25, 0, g); door.rotation.y = 0.5;
      this.add(boxUV(0.9, 3, 0.9, 1), adobe ? wall : M.stone, W / 2 - 1.5, H + 2.2, -D / 4, 0, g);
      g.updateMatrixWorld(true);
      const chim = new THREE.Vector3(W / 2 - 1.5, H + 3.8, -D / 4).applyMatrix4(g.matrixWorld);
      this.chimneys.push(chim);
      this.cabinPos[c.id] = new THREE.Vector3(c.x, y, c.z);
      // a dusty tarp over the prize inside
      const tarp = this.add(new RoundedBoxGeometry(3.2, 1.8, 4.6, 3, 0.6), new THREE.MeshStandardMaterial({ color: 0x5a6a4a, roughness: 1 }), 0, 0.9, -1, 0, g); void tarp;
      this.phys.world.createCollider(RAPIER.ColliderDesc.cuboid(W / 2, H / 2, D / 2).setTranslation(c.x, y + H / 2, c.z).setRotation({ x: 0, y: Math.sin(c.yaw / 2), z: 0, w: Math.cos(c.yaw / 2) }).setCollisionGroups(groups(G.PROP, 0xffff)), this.body);
      // clues: a broken fence and an old leaning signpost where the ruts leave the road
      const [fx, fz] = c.from;
      const yy = this.h(fx, fz);
      for (let k = 0; k < 6; k++) {
        const px = fx + 6 + k * 2.2, pz = fz + 5;
        const post = this.add(new THREE.BoxGeometry(0.14, 1.3, 0.14), M.wood, px, this.h(px, pz) + 0.55, pz); post.rotation.z = (k % 3 === 1 ? 0.5 : 0.05 * k);
        if (k % 3 !== 2) { const rail = this.add(new THREE.BoxGeometry(2.2, 0.1, 0.06), M.wood, px + 1.1, this.h(px, pz) + 0.95 - (k === 3 ? 0.6 : 0), pz); rail.rotation.z = k === 3 ? 0.4 : 0; }
      }
      const sp = this.add(new THREE.BoxGeometry(0.15, 2.6, 0.15), M.wood, fx - 4, yy + 1.2, fz + 3); sp.rotation.z = 0.2;
      const signTex = signTexture('PRIVATE', 'NO TRESPASSING', '#5b3a1e', '#e9d8b0');
      const board = this.add(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.9, side: THREE.DoubleSide }), fx - 3.75, yy + 2.3, fz + 3.05); board.rotation.set(0, 0.3, 0.2);
    }
  }

  private signposts() {
    const M = this.mats;
    const posts: [number, number, string, string][] = [
      [40, 120, 'DESERT CANYON  ↓', 'BRIDGES · DUNES'], [120, -20, 'DENSE FOREST  →', 'LOGGING CAMP 1.6 km'], [-20, -150, 'MOUNT APEX  ↑', 'SWITCHBACKS · ICE'], [-130, 30, 'QUARRY  ←', 'PIT A · CRUSHER'],
    ];
    for (const [x, z, a, b] of posts) {
      const y = this.h(x, z);
      this.add(new THREE.CylinderGeometry(0.08, 0.08, 3.2, 8), M.steel, x, y + 1.6, z);
      const t = signTexture(a, b, '#14532d', '#ffffff');
      this.add(new THREE.PlaneGeometry(3.2, 1.0), new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.5 }), x, y + 2.8, z, Math.atan2(-x, -z) + Math.PI);
    }
  }
  private traps() {
    const M = this.mats;
    for (const s of SPEED_TRAPS) {
      const y = this.h(s.x + s.r, s.z);
      this.add(new THREE.CylinderGeometry(0.12, 0.12, 4.5, 8), M.steel, s.x + s.r, y + 2.25, s.z);
      this.add(boxUV(0.8, 0.6, 0.6, 1), M.dark, s.x + s.r, y + 4.4, s.z);
      const t = signTexture('SPEED TRAP', s.name.toUpperCase(), '#ff7a1a', '#111');
      this.add(new THREE.PlaneGeometry(2.4, 0.8), new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.25 }), s.x + s.r, y + 3.6, s.z, Math.PI / 2);
    }
  }
}

export function signTexture(a: string, b: string, bg = '#111317', fg = '#ff7a1a'): THREE.Texture {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, 1024, 256);
  g.strokeStyle = fg; g.lineWidth = 10; g.strokeRect(12, 12, 1000, 232);
  g.fillStyle = fg; g.font = 'bold 110px "Segoe UI", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(a, 512, 100);
  g.fillStyle = bg === '#111317' ? '#e8e8e8' : fg; g.font = '600 44px "Segoe UI", Arial, sans-serif'; g.fillText(b, 512, 196);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
export type { P2 };
void assetUrl;
