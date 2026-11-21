// Vegetation + rocks: deterministic placement, instanced LOD rendering with CPU culling, wind,
// streamed physics colliders, and destructible trees that fall as physical logs (sleeping, 60-log cap).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { HALF, CTRL, N, biomeWeights, HUB, PITS } from './layout';
import { Simplex, hash2, smoothstep } from '../core/noise';
import { sampleH, SEED } from './gen';
import type { World } from './finish';
import { conifer, redwood, broadleaf, saguaro, needleTexture, leafTexture, type TreeGeo } from './treegeo';
import { RAPIER, G, groups, type Physics } from '../physics/physics';
import { assetUrl } from '../core/assets';

export const enum TK { Pine, Fir, Redwood, Broad, Saguaro }
const KINDS = 5, VARS = 3;
const BREAKABLE = [true, true, false, true, true];
const CELL = 64, GRID = 4096 / CELL;

interface Batch { near: THREE.InstancedMesh[]; far: THREE.InstancedMesh[]; geo: TreeGeo }
interface Log { body: RAPIER.RigidBody; kind: number; v: number; scale: number; rest: number; born: number; tree: number; off: number }

const MODELS = ['namaqualand_boulder_02', 'namaqualand_boulder_05', 'boulder_01', 'rock_07', 'rock_09', 'quiver_tree_01', 'dead_tree_trunk', 'shrub_02', 'wild_rooibos_bush', 'fern_02', 'tree_stump_01'] as const;
const ROCKS = 5;          // first five models are rocks (they get colliders)

export class Foliage {
  group = new THREE.Group();
  // tree instances
  tx: Float32Array; tz: Float32Array; ty: Float32Array; ts: Float32Array; tr: Float32Array; tk: Uint8Array; tv: Uint8Array; alive: Uint8Array; hsel: Float32Array;
  count = 0;
  cells: number[][] = [];
  // model (rock / shrub) instances
  mx: Float32Array; mz: Float32Array; my: Float32Array; ms: Float32Array; mr: Float32Array; mk: Uint8Array; mcount = 0; mcells: number[][] = [];
  private batches: Batch[][] = [];
  private modelMeshes: { near: THREE.InstancedMesh; geo: THREE.BufferGeometry; size: THREE.Vector3 }[] = [];
  private logMeshes: THREE.InstancedMesh[][][] = [];
  private mats: { bark: THREE.MeshStandardMaterial[]; leaf: THREE.MeshStandardMaterial[] } = { bark: [], leaf: [] };
  private colliders = new Map<number, RAPIER.Collider>();
  private rockColliders = new Map<number, RAPIER.Collider>();
  private fixedBody: RAPIER.RigidBody;
  logs: Log[] = [];
  readonly MAX_LOGS = 60;
  density = 1; drawDist = 1; nearDist = 140; time = { value: 0 };
  private lastCam = new THREE.Vector3(1e9, 0, 0); private lastDir = new THREE.Vector3();
  private frustum = new THREE.Frustum(); private pm = new THREE.Matrix4();
  broken = 0;
  onBreak?: (x: number, y: number, z: number, kind: number) => void;

  constructor(private w: World, private phys: Physics) {
    const cap = 260000;
    this.tx = new Float32Array(cap); this.tz = new Float32Array(cap); this.ty = new Float32Array(cap); this.ts = new Float32Array(cap); this.tr = new Float32Array(cap);
    this.tk = new Uint8Array(cap); this.tv = new Uint8Array(cap); this.alive = new Uint8Array(cap); this.hsel = new Float32Array(cap);
    const mcap = 80000;
    this.mx = new Float32Array(mcap); this.mz = new Float32Array(mcap); this.my = new Float32Array(mcap); this.ms = new Float32Array(mcap); this.mr = new Float32Array(mcap); this.mk = new Uint8Array(mcap);
    for (let i = 0; i < GRID * GRID; i++) { this.cells.push([]); this.mcells.push([]); }
    this.fixedBody = phys.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.place();
  }

  private place() {
    const w = this.w, sx = new Simplex(SEED + 5), sc = new Simplex(SEED + 17);
    const bw = [0, 0, 0, 0];
    const STEP = 6;
    const road = (x: number, z: number) => { const i = Math.floor((x + HALF) / 2), j = Math.floor((z + HALF) / 2); return i >= 0 && j >= 0 && i < N && j < N ? w.roadMask[j * N + i] : 0; };
    const nearRoad = (x: number, z: number, r: number) => road(x, z) > 0 || road(x + r, z) > 0 || road(x - r, z) > 0 || road(x, z + r) > 0 || road(x, z - r) > 0;
    const slopeAt = (x: number, z: number) => { const i = Math.min(N - 1, Math.max(0, Math.floor((x + HALF) / 2))), j = Math.min(N - 1, Math.max(0, Math.floor((z + HALF) / 2))); return w.normals[(j * N + i) * 4 + 2] / 255; };
    const wet = (x: number, z: number) => { const i = Math.min(CTRL - 1, Math.max(0, Math.floor((x + HALF) / 4))), j = Math.min(CTRL - 1, Math.max(0, Math.floor((z + HALF) / 4))); return !Number.isNaN(w.water[j * CTRL + i]) ? 255 : w.wet[j * CTRL + i]; };
    for (let gz = -HALF + 40; gz < HALF - 40; gz += STEP) for (let gx = -HALF + 40; gx < HALF - 40; gx += STEP) {
      const h1 = hash2(gx, gz, 1), h2 = hash2(gx, gz, 2), h3 = hash2(gx, gz, 3);
      const x = gx + (h1 - 0.5) * STEP * 0.9, z = gz + (h2 - 0.5) * STEP * 0.9;
      if (Math.hypot(x - HUB.x, z - HUB.z) < HUB.r - 10) continue;
      if (PITS.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 25)) { if (hash2(gx, gz, 21) > 0.04) continue; }
      biomeWeights(x, z, sx.fbm(x / 1100 + 40, z / 1100 - 40, 3), bw);
      const slope = slopeAt(x, z);
      if (wet(x, z) > 90) continue;
      const clearing = sc.fbm(x / 260, z / 260, 3);
      const n2 = sx.fbm(x / 70, z / 70, 2);
      let dens = 0;
      dens += bw[1] * (clearing < -0.28 ? 0.03 : 0.62 + 0.3 * smoothstep(-0.2, 0.3, n2)) * (slope < 0.25 ? 1 : 0.3);
      dens += bw[2] * 0.22 * smoothstep(0.2, -0.1, clearing) * (slope < 0.18 ? 1 : 0);
      dens += bw[3] * 0.025;
      dens += bw[0] * 0.012 * (slope < 0.1 ? 1 : 0);
      const hubEdge = 1 - smoothstep(HUB.r + 40, HUB.r + 320, Math.hypot(x, z));
      dens *= 1 - hubEdge * 0.85;
      const y = sampleH(w.height, x, z);
      if (bw[2] > 0.4 && y > 360) dens *= 0.1;
      if (h3 < dens) {
        if (nearRoad(x, z, 5)) continue;
        let kind: number;
        const pick = hash2(gx, gz, 9);
        if (bw[0] > 0.5) kind = TK.Saguaro;
        else if (bw[2] > Math.max(bw[1], bw[3])) kind = TK.Fir;
        else if (bw[1] > 0.4) kind = pick < 0.1 ? TK.Redwood : pick < 0.27 ? TK.Broad : TK.Pine;
        else kind = pick < 0.4 ? TK.Broad : TK.Pine;
        if (kind === TK.Saguaro && y > 60) continue;
        const i = this.count++;
        this.tx[i] = x; this.tz[i] = z; this.ty[i] = y - 0.15; this.tk[i] = kind; this.tv[i] = Math.floor(hash2(gx, gz, 5) * VARS);
        this.ts[i] = 0.8 + hash2(gx, gz, 6) * 0.45; this.tr[i] = hash2(gx, gz, 7) * Math.PI * 2; this.alive[i] = 1; this.hsel[i] = hash2(gx, gz, 8);
        this.cells[this.cellOf(x, z)].push(i);
        continue;
      }
      // rocks / shrubs / desert models
      const mp = hash2(gx, gz, 11);
      let model = -1, mscale = 1;
      if (bw[0] > 0.5 && mp < 0.012) { model = mp < 0.004 ? 0 : mp < 0.007 ? 1 : mp < 0.009 ? 5 : 6; mscale = 0.7 + hash2(gx, gz, 12) * 1.2; if (model === 5 && y > 60) model = 8; }
      else if (bw[0] > 0.4 && mp < 0.05) { model = 8; mscale = 0.8 + hash2(gx, gz, 12) * 0.6; }
      else if (bw[1] > 0.5 && mp < 0.16) { model = mp < 0.006 ? 2 : mp < 0.012 ? 10 : mp < 0.08 ? 9 : 7; mscale = model === 9 ? 0.35 + hash2(gx, gz, 12) * 0.25 : 0.8 + hash2(gx, gz, 12) * 0.7; }
      else if (bw[2] > 0.5 && mp < 0.01) { model = mp < 0.005 ? 3 : 4; mscale = 1.0 + hash2(gx, gz, 12) * 2.5; }
      else if (bw[3] > 0.5 && mp < 0.02) { model = mp < 0.006 ? 3 : mp < 0.01 ? 4 : 8; mscale = 0.8 + hash2(gx, gz, 12) * 1.6; }
      else if (hubEdge < 0.9 && bw[1] + bw[3] > 0.2 && mp < 0.03) { model = 7; mscale = 0.8 + hash2(gx, gz, 12) * 0.6; }
      if (model >= 0) {
        if (model < ROCKS && nearRoad(x, z, 6)) continue;
        if (model >= ROCKS && road(x, z) > 0) continue;
        const i = this.mcount++;
        this.mx[i] = x; this.mz[i] = z; this.my[i] = sampleH(w.height, x, z) - (model < ROCKS ? 0.35 * mscale : 0.05); this.ms[i] = mscale; this.mr[i] = hash2(gx, gz, 13) * 6.28; this.mk[i] = model;
        this.mcells[this.cellOf(x, z)].push(i);
      }
    }
  }
  cellOf(x: number, z: number) { const i = Math.max(0, Math.min(GRID - 1, Math.floor((x + HALF) / CELL))), j = Math.max(0, Math.min(GRID - 1, Math.floor((z + HALF) / CELL))); return j * GRID + i; }

  async build(textures: (name: string) => Promise<{ diff: THREE.Texture; nor: THREE.Texture; arm?: THREE.Texture }>) {
    const pine = await textures('pine_bark'), brown = await textures('bark_brown_02');
    const barkMat = (t: typeof pine, tint: number) => new THREE.MeshStandardMaterial({ map: t.diff, normalMap: t.nor, roughness: 0.95, color: tint });
    const needles = needleTexture('#2c4a23', '#3f5e2b'), firN = needleTexture('#23402f', '#2f5640'), redN = needleTexture('#38552a', '#4b6a31'), leaves = leafTexture();
    const leafMat = (map: THREE.Texture, snowy: boolean) => {
      const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.85, metalness: 0, alphaToCoverage: true });
      this.windify(m, 1, snowy);
      return m;
    };
    const cactus = new THREE.MeshStandardMaterial({ color: 0x55703a, roughness: 0.7 });
    this.mats.bark = [barkMat(pine, 0xb0a090), barkMat(pine, 0x9a8c80), barkMat(brown, 0xc07a5a), barkMat(brown, 0xb0a898), cactus];
    this.mats.bark.forEach((m, k) => this.windify(m, k === TK.Saguaro ? 0 : 0.3, false));
    this.mats.leaf = [leafMat(needles, false), leafMat(firN, true), leafMat(redN, false), leafMat(leaves, false), leafMat(leaves, false)];
    const farLeaf = this.mats.leaf.map((m, k) => { const f = new THREE.MeshStandardMaterial({ color: [0x263d20, 0x24382c, 0x2e4522, 0x354f22, 0x55703a][k], roughness: 0.95, side: THREE.DoubleSide }); this.windify(f, 0.6, k === TK.Fir); return f; });
    const cap = [9000, 6000, 1500, 3000, 1500], capFar = [60000, 30000, 6000, 15000, 6000];
    for (let k = 0; k < KINDS; k++) {
      this.batches.push([]); this.logMeshes.push([]);
      for (let v = 0; v < VARS; v++) {
        const geo = k === TK.Pine ? conifer(100 + v, 13 + v * 2.5, false) : k === TK.Fir ? conifer(200 + v, 10 + v * 2.2, true, 1.2) : k === TK.Redwood ? redwood(300 + v, 40 + v * 6) : k === TK.Broad ? broadleaf(400 + v, 10 + v * 2) : saguaro(500 + v, 4.5 + v * 1.4);
        const mk = (g: THREE.BufferGeometry, m: THREE.Material, n: number, shadow: boolean) => { const im = new THREE.InstancedMesh(g, m, n); im.count = 0; im.frustumCulled = false; im.castShadow = shadow; im.receiveShadow = true; this.group.add(im); return im; };
        const b: Batch = { geo, near: [mk(geo.bark, this.mats.bark[k], cap[k], true)], far: [mk(geo.farBark, this.mats.bark[k], capFar[k], false)] };
        if (geo.foliage.attributes.position) { b.near.push(mk(geo.foliage, this.mats.leaf[k], cap[k], true)); b.far.push(mk(geo.farFoliage, farLeaf[k], capFar[k], false)); }
        this.batches[k].push(b);
        this.logMeshes[k].push(b.near.map((im) => mk(im.geometry, im.material as THREE.Material, this.MAX_LOGS, true)));
      }
    }
    // scanned models
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    const caps = [2500, 2500, 2500, 2500, 2500, 1500, 1500, 9000, 9000, 12000, 1500];
    for (let m = 0; m < MODELS.length; m++) {
      const gltf = await loader.loadAsync(assetUrl(`models/${MODELS[m]}.glb`));
      let mesh: THREE.Mesh | undefined; gltf.scene.traverse((o) => { if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh; });
      if (!mesh) continue;
      mesh.updateWorldMatrix(true, false);
      const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      geo.computeBoundingBox();
      const bb = geo.boundingBox!; const size = bb.getSize(new THREE.Vector3());
      geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (m >= ROCKS) { mat.side = THREE.DoubleSide; if (mat.map) { mat.alphaTest = 0.4; mat.transparent = false; mat.alphaToCoverage = true; } this.windify(mat, m === 9 || m === 7 || m === 8 ? 0.8 : 0.15, false); }
      const im = new THREE.InstancedMesh(geo, mat, caps[m]); im.count = 0; im.frustumCulled = false; im.castShadow = m < ROCKS || m === 5 || m === 6; im.receiveShadow = true;
      this.group.add(im);
      this.modelMeshes.push({ near: im, geo, size });
    }
  }

  /** Vertex wind sway (and optional snow on the upward faces). */
  private windify(m: THREE.MeshStandardMaterial, amp: number, snowy: boolean) {
    const time = this.time;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = time;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; attribute float snow; varying float vSnow; varying vec3 vWN;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vSnow = ${snowy ? 'snow' : '0.0'};
          #ifdef USE_INSTANCING
            vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
          #else
            vec2 ip = vec2(0.0);
          #endif
          float hh = max(transformed.y, 0.0);
          float sway = (sin(uTime * 1.3 + ip.x * 0.11 + ip.y * 0.07) * 0.6 + sin(uTime * 2.7 + ip.x * 0.3) * 0.25) * ${amp.toFixed(2)} * 0.012 * hh * hh / (8.0 + hh);
          transformed.x += sway; transformed.z += sway * 0.6;`)
        .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vSnow; varying vec3 vWN;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float sn = vSnow * smoothstep(0.25, 0.75, vWN.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.97), sn);`);
    };
    m.customProgramCacheKey = () => `wind${amp}${snowy}`;
  }

  /** Rebuild visible instance lists around the camera (cheap enough every few frames). */
  update(cam: THREE.PerspectiveCamera, force = false) {
    const pos = cam.position, dir = cam.getWorldDirection(new THREE.Vector3());
    if (!force && pos.distanceToSquared(this.lastCam) < 9 && dir.dot(this.lastDir) > 0.995) return;
    this.lastCam.copy(pos); this.lastDir.copy(dir);
    this.pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pm);
    const far = 300 + 1100 * this.drawDist, near = this.nearDist;
    const counts = this.batches.map((b) => b.map(() => [0, 0]));
    const mcount = this.modelMeshes.map(() => 0);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
    const box = new THREE.Box3();
    const r = Math.ceil(far / CELL);
    const ci = Math.floor((pos.x + HALF) / CELL), cj = Math.floor((pos.z + HALF) / CELL);
    for (let j = Math.max(0, cj - r); j <= Math.min(GRID - 1, cj + r); j++) for (let i = Math.max(0, ci - r); i <= Math.min(GRID - 1, ci + r); i++) {
      const x0 = -HALF + i * CELL, z0 = -HALF + j * CELL;
      const dx = Math.max(0, Math.abs(pos.x - (x0 + CELL / 2)) - CELL / 2), dz = Math.max(0, Math.abs(pos.z - (z0 + CELL / 2)) - CELL / 2);
      const cd = Math.hypot(dx, dz);
      if (cd > far) continue;
      const cell = this.cells[j * GRID + i];
      const mc = this.mcells[j * GRID + i];
      if (!cell.length && !mc.length) continue;
      const cy = sampleH(this.w.height, x0 + CELL / 2, z0 + CELL / 2);
      box.min.set(x0, cy - 80, z0); box.max.set(x0 + CELL, cy + 120, z0 + CELL);
      if (cd > 30 && !this.frustum.intersectsBox(box)) continue;
      for (const t of cell) {
        if (!this.alive[t] || this.hsel[t] > this.density) continue;
        const k = this.tk[t], v = this.tv[t];
        const d = Math.hypot(this.tx[t] - pos.x, this.tz[t] - pos.z);
        if (d > far) continue;
        // far trees thin out with distance so the horizon stays light
        if (d > near * 3 && this.hsel[t] > this.density * (1 - (d - near * 3) / far * 0.6)) continue;
        const isNear = d < near;
        const c = counts[k][v];
        const b = this.batches[k][v];
        const list = isNear ? b.near : b.far;
        const idx = isNear ? c[0] : c[1];
        if (idx >= list[0].instanceMatrix.count) continue;
        q.setFromAxisAngle(yAxis, this.tr[t]); s.setScalar(this.ts[t]); p.set(this.tx[t], this.ty[t], this.tz[t]);
        m4.compose(p, q, s);
        for (const im of list) im.setMatrixAt(idx, m4);
        if (isNear) c[0]++; else c[1]++;
      }
      const mfar = Math.min(far, 650);
      for (const t of mc) {
        const k = this.mk[t];
        const d = Math.hypot(this.mx[t] - pos.x, this.mz[t] - pos.z);
        const lim = k < ROCKS || k === 5 || k === 6 ? mfar : k === 9 ? 70 : 220;
        if (d > lim) continue;
        const mm = this.modelMeshes[k]; if (!mm || mcount[k] >= mm.near.instanceMatrix.count) continue;
        q.setFromAxisAngle(yAxis, this.mr[t]); s.setScalar(this.ms[t]); p.set(this.mx[t], this.my[t], this.mz[t]);
        m4.compose(p, q, s); mm.near.setMatrixAt(mcount[k]++, m4);
      }
    }
    this.batches.forEach((bk, k) => bk.forEach((b, v) => {
      for (const im of b.near) { im.count = counts[k][v][0]; im.instanceMatrix.needsUpdate = true; im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, im.count * 16); }
      for (const im of b.far) { im.count = counts[k][v][1]; im.instanceMatrix.needsUpdate = true; im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, im.count * 16); }
    }));
    this.modelMeshes.forEach((mm, k) => { mm.near.count = mcount[k]; mm.near.instanceMatrix.needsUpdate = true; mm.near.instanceMatrix.clearUpdateRanges(); mm.near.instanceMatrix.addUpdateRange(0, mcount[k] * 16); });
  }

  /** Stream static colliders for trees and rocks around the given points. */
  streamColliders(points: { x: number; z: number }[]) {
    const R = 45, R2 = 60;
    const want = new Set<number>(), wantRock = new Set<number>();
    for (const pt of points) {
      const r = Math.ceil(R / CELL) + 1, ci = Math.floor((pt.x + HALF) / CELL), cj = Math.floor((pt.z + HALF) / CELL);
      for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= GRID || j >= GRID) continue;
        for (const t of this.cells[j * GRID + i]) if (this.alive[t] && this.hsel[t] <= this.density && Math.hypot(this.tx[t] - pt.x, this.tz[t] - pt.z) < R) want.add(t);
        for (const t of this.mcells[j * GRID + i]) if (this.mk[t] < ROCKS && Math.hypot(this.mx[t] - pt.x, this.mz[t] - pt.z) < R) wantRock.add(t);
      }
    }
    for (const t of want) if (!this.colliders.has(t)) {
      const rad = this.radiusOf(t), h = 4;
      const c = this.phys.world.createCollider(RAPIER.ColliderDesc.cylinder(h, rad).setTranslation(this.tx[t], this.ty[t] + h, this.tz[t]).setCollisionGroups(groups(G.TREE, G.VEHICLE | G.LOG)).setFriction(0.6), this.fixedBody);
      this.colliders.set(t, c);
    }
    for (const [t, c] of this.colliders) {
      if (want.has(t)) continue;
      if (points.every((pt) => Math.hypot(this.tx[t] - pt.x, this.tz[t] - pt.z) > R2) || !this.alive[t]) { this.phys.world.removeCollider(c, false); this.colliders.delete(t); }
    }
    for (const t of wantRock) if (!this.rockColliders.has(t)) {
      const mm = this.modelMeshes[this.mk[t]]; if (!mm) continue;
      const sz = mm.size.clone().multiplyScalar(this.ms[t] * 0.42);
      const c = this.phys.world.createCollider(RAPIER.ColliderDesc.roundCuboid(Math.max(0.1, sz.x - 0.3), Math.max(0.1, sz.y - 0.3), Math.max(0.1, sz.z - 0.3), 0.3)
        .setTranslation(this.mx[t], this.my[t] + sz.y, this.mz[t]).setRotation({ x: 0, y: Math.sin(this.mr[t] / 2), z: 0, w: Math.cos(this.mr[t] / 2) })
        .setCollisionGroups(groups(G.PROP, 0xffff)).setFriction(0.8), this.fixedBody);
      this.rockColliders.set(t, c);
    }
    for (const [t, c] of this.rockColliders) if (!wantRock.has(t) && points.every((pt) => Math.hypot(this.mx[t] - pt.x, this.mz[t] - pt.z) > R2)) { this.phys.world.removeCollider(c, false); this.rockColliders.delete(t); }
  }
  radiusOf(t: number) { const k = this.tk[t]; return (k === TK.Redwood ? 1.25 : k === TK.Saguaro ? 0.38 : k === TK.Broad ? 0.32 : 0.28) * this.ts[t]; }

  /** Trees within r of (x,z). */
  near(x: number, z: number, r: number, out: number[] = []) {
    out.length = 0;
    const rc = Math.ceil(r / CELL), ci = Math.floor((x + HALF) / CELL), cj = Math.floor((z + HALF) / CELL);
    for (let j = cj - rc; j <= cj + rc; j++) for (let i = ci - rc; i <= ci + rc; i++) {
      if (i < 0 || j < 0 || i >= GRID || j >= GRID) continue;
      for (const t of this.cells[j * GRID + i]) if (this.alive[t] && this.hsel[t] <= this.density && Math.hypot(this.tx[t] - x, this.tz[t] - z) < r) out.push(t);
    }
    return out;
  }

  /** Knock a tree over: it becomes a physical log pushed along (vx, vz). */
  fell(t: number, vx: number, vz: number, now: number) {
    if (!this.alive[t] || !BREAKABLE[this.tk[t]]) return false;
    this.alive[t] = 0; this.broken++;
    const c = this.colliders.get(t); if (c) { this.phys.world.removeCollider(c, false); this.colliders.delete(t); }
    const k = this.tk[t], v = this.tv[t], sc = this.ts[t];
    const H = this.batches[k][v].geo.height * sc;
    const half = H * 0.42;
    const off = H * 0.45;
    const spd = Math.hypot(vx, vz) || 1, dx = vx / spd, dz = vz / spd;
    const body = this.phys.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(this.tx[t] + dx * 0.6, this.ty[t] + off + 0.4, this.tz[t] + dz * 0.6)
      .setRotation({ x: 0, y: Math.sin(this.tr[t] / 2), z: 0, w: Math.cos(this.tr[t] / 2) })
      .setLinvel(vx * 0.45, 1.0, vz * 0.45)
      .setAngvel({ x: dz * (1.4 + spd * 0.05), y: 0, z: -dx * (1.4 + spd * 0.05) })
      .setLinearDamping(0.15).setAngularDamping(0.8).setCanSleep(true));
    const rad = Math.max(0.3, this.radiusOf(t) * 1.6);
    const mass = (k === TK.Saguaro ? 300 : 900) * sc * sc * (H / 14);
    this.phys.world.createCollider(RAPIER.ColliderDesc.capsule(Math.max(0.2, half - rad), rad).setMass(mass).setFriction(0.9).setRestitution(0.05)
      .setCollisionGroups(groups(G.LOG, G.TERRAIN | G.VEHICLE | G.LOG | G.PROP | G.TREE)), body);
    // branch stubs in the crown: felled trees rest on their branches instead of rolling like a pipe
    if (k !== TK.Saguaro) {
      const reach = Math.max(1.2, H * 0.13);
      for (const [y, a] of [[half * 0.15, 0], [half * 0.55, Math.PI / 3], [half * 0.85, -Math.PI / 3]] as const)
        this.phys.world.createCollider(RAPIER.ColliderDesc.cuboid(reach, 0.12, 0.12).setTranslation(0, y, 0).setRotation({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) }).setMass(mass * 0.05).setFriction(1.0)
          .setCollisionGroups(groups(G.LOG, G.TERRAIN | G.LOG | G.PROP)), body);
    }
    this.logs.push({ body, kind: k, v, scale: sc, rest: 0, born: now, tree: t, off });
    // pool cap: gracefully retire the oldest log
    while (this.logs.length > this.MAX_LOGS) { const old = this.logs.shift()!; this.phys.world.removeRigidBody(old.body); }
    this.onBreak?.(this.tx[t], this.ty[t] + 1, this.tz[t], k);
    this.lastCam.set(1e9, 0, 0);
    return true;
  }

  /** Sleep logs that have rested for 2 s; sync the log instances. */
  updateLogs(dt: number, now = 0) {
    const counts = this.logMeshes.map((a) => a.map(() => 0));
    const m4 = new THREE.Matrix4(), off = new THREE.Matrix4(), s = new THREE.Matrix4();
    for (const l of this.logs) {
      const b = l.body;
      if (!b.isSleeping()) {
        const lv = b.linvel(), av = b.angvel();
        const v = Math.hypot(lv.x, lv.y, lv.z), w = Math.hypot(av.x, av.y, av.z);
        // logs (capsules) love to roll: once down, bleed off rolling so they come to rest as hazards
        if (now - l.born > 1.5) { b.setAngularDamping(3.5); b.setLinearDamping(0.8); }
        if (v < 0.35 && w < 0.35) { l.rest += dt; if (l.rest > 2) { b.setLinvel({ x: 0, y: 0, z: 0 }, false); b.setAngvel({ x: 0, y: 0, z: 0 }, false); b.sleep(); l.rest = 0; } }
        else l.rest = 0;
      } else if (l.rest === 0) { b.setAngularDamping(3.5); }
      const t = b.translation(), r = b.rotation();
      m4.makeRotationFromQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w)); m4.setPosition(t.x, t.y, t.z);
      off.makeTranslation(0, -l.off, 0); s.makeScale(l.scale, l.scale, l.scale);
      m4.multiply(off).multiply(s);
      const ims = this.logMeshes[l.kind][l.v]; const i = counts[l.kind][l.v]++;
      for (const im of ims) im.setMatrixAt(i, m4);
    }
    this.logMeshes.forEach((a, k) => a.forEach((ims, v) => { for (const im of ims) { im.count = counts[k][v]; im.instanceMatrix.needsUpdate = true; } }));
  }
  get activeLogs() { return this.logs.filter((l) => !l.body.isSleeping()).length; }
}
