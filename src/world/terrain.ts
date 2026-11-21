// Terrain rendering: LOD chunks + a height-blended 12-layer PBR splat shader injected into MeshStandardMaterial.
import * as THREE from 'three';
import { N, V, CELL, HALF, WORLD, CTRL } from './layout';
import { LAYERS, type World } from './finish';
import { assetUrl } from '../core/assets';

const CHUNK = 256;
const CHUNKS = WORLD / CHUNK;
export const TILE = [7, 9, 16, 5, 5, 7, 13, 6, 5, 6, 13, 6];          // metres per texture repeat
const TRIPLANAR = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0];
// average colours for the low-poly faceted look
const FLAT = ['#b9734a', '#a86b4f', '#9a5c3c', '#4f5432', '#5f7a3a', '#eef2f6', '#7d7466', '#8d8378', '#5b4a37', '#8a7358', '#a59276', '#4a4a4c'];

export interface TerrainQuality { lowPoly: boolean; texRes: number; triplanar: boolean; antiTile: boolean; lodScale: number; parallax: boolean }

export class Terrain {
  group = new THREE.Group();
  material!: THREE.MeshStandardMaterial;
  uniforms: Record<string, THREE.IUniform> = {};
  private chunks: { mesh: THREE.Mesh; lod: number; cx: number; cz: number; minY: number; maxY: number }[] = [];
  private geoCache = new Map<string, THREE.BufferGeometry>();
  private texAH?: THREE.DataArrayTexture; private texNR?: THREE.DataArrayTexture;
  private layerPixels?: { ah: Uint8Array[]; nr: Uint8Array[]; size: number };
  q: TerrainQuality = { lowPoly: false, texRes: 1024, triplanar: true, antiTile: true, lodScale: 1, parallax: false };

  constructor(private w: World, private renderer: THREE.WebGLRenderer) {
    const nTex = new THREE.DataTexture(w.normals, N, N, THREE.RGBAFormat);
    nTex.magFilter = THREE.LinearFilter; nTex.minFilter = THREE.LinearMipmapLinearFilter; nTex.generateMipmaps = true; nTex.needsUpdate = true;
    const ctrl = [0, 1, 2].map((k) => {
      const t = new THREE.DataTexture(w.ctrl.subarray(k * CTRL * CTRL * 4, (k + 1) * CTRL * CTRL * 4), CTRL, CTRL, THREE.RGBAFormat);
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t;
    });
    const bake = new THREE.DataTexture(w.bake, CTRL, CTRL, THREE.RGBAFormat);
    bake.magFilter = THREE.LinearFilter; bake.minFilter = THREE.LinearMipmapLinearFilter; bake.generateMipmaps = true; bake.needsUpdate = true;
    // road mask (R) + road kind (G) at 2 m
    const road = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i; road[k * 4] = w.roadMask[k]; road[k * 4 + 1] = w.roadKind[(j >> 1) * CTRL + (i >> 1)] * 36; road[k * 4 + 3] = 255;
      if (road[k * 4 + 1] === 0 && road[k * 4] > 0) {   // kind lost at the 4 m sampling edge: borrow a neighbour
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = (i + di * 2) >> 1, jj = (j + dj * 2) >> 1; if (ii >= 0 && jj >= 0 && ii < CTRL && jj < CTRL && w.roadKind[jj * CTRL + ii]) { road[k * 4 + 1] = w.roadKind[jj * CTRL + ii] * 36; break; } }
      }
    }
    const rTex = new THREE.DataTexture(road, N, N, THREE.RGBAFormat);
    rTex.magFilter = THREE.LinearFilter; rTex.minFilter = THREE.LinearMipmapLinearFilter; rTex.generateMipmaps = true; rTex.needsUpdate = true;
    // tiling value noise for macro variation
    const NS = 256, nd = new Uint8Array(NS * NS * 4);
    const rnd = (i: number, j: number, s: number) => { let h = (i * 374761393 + j * 668265263 + s * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
    for (let j = 0; j < NS; j++) for (let i = 0; i < NS; i++) for (let c = 0; c < 4; c++) {
      let v = 0, a = 0.5, f = 8;
      for (let o = 0; o < 4; o++) {
        const x = i * f / NS, y = j * f / NS, xi = Math.floor(x), yi = Math.floor(y), u = x - xi, t = y - yi;
        const su = u * u * (3 - 2 * u), st = t * t * (3 - 2 * t);
        const g = (a2: number, b2: number) => rnd(((a2 % f) + f) % f, ((b2 % f) + f) % f, c * 10 + o);
        v += a * ((g(xi, yi) * (1 - su) + g(xi + 1, yi) * su) * (1 - st) + (g(xi, yi + 1) * (1 - su) + g(xi + 1, yi + 1) * su) * st);
        a *= 0.5; f *= 2;
      }
      nd[(j * NS + i) * 4 + c] = Math.round(v / 0.9375 * 255);
    }
    const noise = new THREE.DataTexture(nd, NS, NS, THREE.RGBAFormat);
    noise.wrapS = noise.wrapT = THREE.RepeatWrapping; noise.magFilter = THREE.LinearFilter; noise.minFilter = THREE.LinearMipmapLinearFilter; noise.generateMipmaps = true; noise.needsUpdate = true;
    this.noiseTex = noise;
    this.ctrlTex = ctrl; this.roadTex = rTex;
    this.uniforms = {
      tNormalMap: { value: nTex }, tCtrl0: { value: ctrl[0] }, tCtrl1: { value: ctrl[1] }, tCtrl2: { value: ctrl[2] }, tBake: { value: bake }, tRoad: { value: rTex }, tNoise: { value: noise },
      tAH: { value: null }, tNR: { value: null }, uTile: { value: TILE.map((t) => 1 / t) }, uTri: { value: TRIPLANAR }, uFlat: { value: FLAT.map((c) => new THREE.Color(c)) },
      uWet: { value: 0 }, uTime: { value: 0 },
    };
    this.material = this.makeMaterial();
    for (let cz = 0; cz < CHUNKS; cz++) for (let cx = 0; cx < CHUNKS; cx++) {
      let minY = 1e9, maxY = -1e9;
      const s = CHUNK / CELL;
      for (let j = cz * s; j <= (cz + 1) * s; j += 2) for (let i = cx * s; i <= (cx + 1) * s; i += 2) { const h = w.height[j * V + i]; if (h < minY) minY = h; if (h > maxY) maxY = h; }
      const mesh = new THREE.Mesh(undefined, this.material);
      mesh.position.set(-HALF + cx * CHUNK, 0, -HALF + cz * CHUNK);
      mesh.receiveShadow = true; mesh.castShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      this.chunks.push({ mesh, lod: -1, cx, cz, minY, maxY });
      this.group.add(mesh);
    }
  }
  noiseTex: THREE.DataTexture;
  ctrlTex!: THREE.DataTexture[]; roadTex!: THREE.DataTexture;

  /** Load the photo-scanned layer images (albedo+height, normal+rough+ao) into two texture arrays. */
  async loadLayers(onProgress?: (f: number) => void) {
    const size = 1024;
    const ah: Uint8Array[] = [], nr: Uint8Array[] = [];
    const cvs = new OffscreenCanvas(size, size);
    const ctx = cvs.getContext('2d', { willReadFrequently: true })!;
    let done = 0;
    const load = async (name: string) => {
      const res = await fetch(assetUrl(`terrain/${name}.webp`));
      const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      return bmp;
    };
    const bitmaps = await Promise.all(LAYERS.map(async (l) => { const r = [await load(l + '_ah'), await load(l + '_nr')]; onProgress?.(++done / LAYERS.length); return r; }));
    for (const [a, n] of bitmaps) {
      for (const [bmp, arr] of [[a, ah], [n, nr]] as const) {
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(bmp, 0, 0, size, size);
        arr.push(new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer));
        bmp.close();
      }
    }
    this.layerPixels = { ah, nr, size };
    this.applyTexRes(this.q.texRes);
  }

  private applyTexRes(res: number) {
    if (!this.layerPixels) return;
    const { ah, nr, size } = this.layerPixels;
    const step = Math.max(1, Math.round(size / res)), S = size / step;
    const pack = (arr: Uint8Array[]) => {
      const out = new Uint8Array(S * S * 4 * arr.length);
      arr.forEach((src, l) => {
        if (step === 1) { out.set(src, l * S * S * 4); return; }
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) for (let c = 0; c < 4; c++) {
          let s = 0; for (let dy = 0; dy < step; dy++) for (let dx = 0; dx < step; dx++) s += src[((y * step + dy) * size + x * step + dx) * 4 + c];
          out[((l * S + y) * S + x) * 4 + c] = s / (step * step);
        }
      });
      return out;
    };
    this.texAH?.dispose(); this.texNR?.dispose();
    const mk = (data: Uint8Array, srgb: boolean) => {
      const t = new THREE.DataArrayTexture(data, S, S, ah.length);
      t.format = THREE.RGBAFormat; t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
      t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true; return t;
    };
    this.texAH = mk(pack(ah), true); this.texNR = mk(pack(nr), false);
    this.uniforms.tAH.value = this.texAH; this.uniforms.tNR.value = this.texNR;
  }

  setQuality(q: Partial<TerrainQuality>) {
    const prev = { ...this.q };
    Object.assign(this.q, q);
    if (q.texRes && q.texRes !== prev.texRes) this.applyTexRes(q.texRes);
    if (prev.lowPoly !== this.q.lowPoly || prev.triplanar !== this.q.triplanar || prev.antiTile !== this.q.antiTile || prev.parallax !== this.q.parallax) {
      const old = this.material; this.material = this.makeMaterial();
      for (const c of this.chunks) c.mesh.material = this.material;
      old.dispose();
    }
    if (prev.lowPoly !== this.q.lowPoly || prev.lodScale !== this.q.lodScale) for (const c of this.chunks) c.lod = -1;
  }

  private makeMaterial(): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, flatShading: false });
    const q = this.q;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.defines = sh.defines || {};
      if (q.lowPoly) sh.defines.LOWPOLY = '';
      if (q.triplanar) sh.defines.TRIPLANAR = '';
      if (q.antiTile) sh.defines.ANTITILE = '';
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTW;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + TERRAIN_COMMON)
        .replace('#include <map_fragment>', TERRAIN_MAP)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
        .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(tNw, 0.0)).xyz);')
        .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= tAO; reflectedLight.indirectSpecular *= tAO * mix(0.4, 1.0, tSun);')
        .replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= tSun;');
    };
    m.customProgramCacheKey = () => `terrain-${q.lowPoly}-${q.triplanar}-${q.antiTile}`;
    return m;
  }

  private geometry(lod: number, cx: number, cz: number): THREE.BufferGeometry {
    const key = `${lod}:${cx}:${cz}`;
    let g = this.geoCache.get(key);
    if (g) return g;
    const step = 1 << lod;                 // in 2 m cells
    const n = (CHUNK / CELL) / step;       // quads per side
    const vpr = n + 1;
    const skirt = 4 * vpr;
    const pos = new Float32Array((vpr * vpr + skirt) * 3), nor = new Float32Array((vpr * vpr + skirt) * 3);
    const i0 = cx * (CHUNK / CELL), j0 = cz * (CHUNK / CELL);
    const H = this.w.height;
    const put = (k: number, li: number, lj: number, drop: number) => {
      const gi = i0 + li * step, gj = j0 + lj * step;
      const h = H[gj * V + gi];
      pos[k * 3] = li * step * CELL; pos[k * 3 + 1] = h - drop; pos[k * 3 + 2] = lj * step * CELL;
      const hl = H[gj * V + Math.max(0, gi - 1)], hr = H[gj * V + Math.min(N, gi + 1)], hd = H[Math.max(0, gj - 1) * V + gi], hu = H[Math.min(N, gj + 1) * V + gi];
      const nx = (hl - hr) / (2 * CELL), nz = (hd - hu) / (2 * CELL), l = Math.hypot(nx, 1, nz);
      nor[k * 3] = nx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = nz / l;
    };
    for (let j = 0; j < vpr; j++) for (let i = 0; i < vpr; i++) put(j * vpr + i, i, j, 0);
    const idx: number[] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = j * vpr + i, b = a + 1, c = a + vpr, d = c + 1;
      idx.push(a, c, b, b, c, d);       // diagonal b-c matches Rapier's heightfield
    }
    // skirts
    const drop = 3 * step;
    let k = vpr * vpr;
    const edge = (list: [number, number][], flip: boolean) => {
      const start = k;
      for (const [li, lj] of list) put(k++, li, lj, drop);
      for (let e = 0; e < list.length - 1; e++) {
        const a = list[e][1] * vpr + list[e][0], b = list[e + 1][1] * vpr + list[e + 1][0], c = start + e, d = start + e + 1;
        if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
      }
    };
    edge(Array.from({ length: vpr }, (_, i) => [i, 0] as [number, number]), false);
    edge(Array.from({ length: vpr }, (_, i) => [i, n] as [number, number]), true);
    edge(Array.from({ length: vpr }, (_, j) => [0, j] as [number, number]), true);
    edge(Array.from({ length: vpr }, (_, j) => [n, j] as [number, number]), false);
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(idx);
    g.computeBoundingBox(); g.computeBoundingSphere();
    if (this.geoCache.size > 400) { const first = this.geoCache.keys().next().value!; this.geoCache.get(first)!.dispose(); this.geoCache.delete(first); }
    this.geoCache.set(key, g);
    return g;
  }

  update(cam: THREE.Vector3) {
    const s = this.q.lodScale, lp = this.q.lowPoly;
    for (const c of this.chunks) {
      const mx = -HALF + (c.cx + 0.5) * CHUNK, mz = -HALF + (c.cz + 0.5) * CHUNK;
      const dx = Math.max(0, Math.abs(cam.x - mx) - CHUNK / 2), dz = Math.max(0, Math.abs(cam.z - mz) - CHUNK / 2);
      const dy = Math.max(0, cam.y - c.maxY, c.minY - cam.y);
      const d = Math.hypot(dx, dz, dy * 0.5);
      let lod = d < 120 * s ? 0 : d < 420 * s ? 1 : d < 1000 * s ? 2 : d < 2000 * s ? 3 : 4;
      if (lp) lod = Math.max(lod + 1, 1);
      lod = Math.min(lod, 4);
      if (lod !== c.lod) { c.lod = lod; c.mesh.geometry = this.geometry(lod, c.cx, c.cz); }
    }
  }
}

const TERRAIN_COMMON = /* glsl */`
precision highp sampler2DArray;
varying vec3 vTW;
uniform sampler2D tNormalMap, tCtrl0, tCtrl1, tCtrl2, tBake, tRoad, tNoise;
uniform sampler2DArray tAH, tNR;
uniform float uTile[12];
uniform float uTri[12];
uniform vec3 uFlat[12];
uniform float uWet;
float tRough, tAO, tSun;
vec3 tNw;
const float T_HALF = ${HALF.toFixed(1)};
const float T_WORLD = ${WORLD.toFixed(1)};

vec2 gdx, gdy, gdxS, gdyS, gdxF, gdyF;
vec4 sampleL(int i, vec2 uv, vec2 dx, vec2 dy) { return textureGrad(tAH, vec3(uv, float(i)), dx * uTile[i], dy * uTile[i]); }
vec4 sampleN(int i, vec2 uv, vec2 dx, vec2 dy) { return textureGrad(tNR, vec3(uv, float(i)), dx * uTile[i], dy * uTile[i]); }
`;

const TERRAIN_MAP = /* glsl */`
vec2 wuv = (vTW.xz + T_HALF) / T_WORLD;
vec3 nb = texture(tNormalMap, wuv).xyz * 2.0 - 1.0;
vec3 Nw = normalize(vec3(nb.x, sqrt(max(0.0, 1.0 - nb.x * nb.x - nb.y * nb.y)), nb.y));
float camDist = length(vTW - cameraPosition);
vec4 macro = texture(tNoise, vTW.xz / 640.0);
vec4 micro = texture(tNoise, vTW.xz / 37.0);
// splat weights, jittered so the 4 m control grid never reads as a grid
vec2 jit = (texture(tNoise, vTW.xz / 9.0).xy - 0.5) * (5.0 / T_WORLD);
vec4 c0 = texture(tCtrl0, wuv + jit), c1 = texture(tCtrl1, wuv + jit), c2 = texture(tCtrl2, wuv + jit);
float W[12];
W[0]=c0.r; W[1]=c0.g; W[2]=c0.b; W[3]=c0.a; W[4]=c1.r; W[5]=c1.g; W[6]=c1.b; W[7]=c1.a; W[8]=c2.r; W[9]=c2.g; W[10]=c2.b; W[11]=c2.a;
vec4 rd = texture(tRoad, wuv);
float road = smoothstep(0.25, 0.75, rd.r + (micro.z - 0.5) * 0.35);
int kind = int(rd.g * 255.0 / 36.0 + 0.5);
// road layer: 1 asphalt, 2 dirt, 3 gravel, 4 snow, 5 trail, 6 haul
int rl = kind == 1 ? 11 : kind == 3 || kind == 6 ? 7 : kind == 4 ? 5 : 9;
float icy = kind == 4 ? road : 0.0;
for (int i = 0; i < 12; i++) W[i] *= (1.0 - road);
W[rl] += road;
if (kind == 2 || kind == 5) { float m = road * smoothstep(0.45, 0.7, macro.y) * 0.8; W[9] -= m; W[8] += m; }
// steep faces always show rock, whatever the splat says
float slopeY = Nw.y;
float rockiness = smoothstep(0.82, 0.62, slopeY) * (1.0 - road);
if (rockiness > 0.0) {
  int rk = W[0] + W[1] + W[2] > 0.4 ? 2 : W[7] + W[10] > 0.4 ? 10 : 6;
  for (int i = 0; i < 12; i++) W[i] *= (1.0 - rockiness);
  W[rk] += rockiness;
}
#ifdef LOWPOLY
  vec3 fN = normalize(cross(dFdx(vTW), dFdy(vTW)));
  vec3 acc = vec3(0.0); float ws = 0.0;
  for (int i = 0; i < 12; i++) { acc += uFlat[i] * W[i]; ws += W[i]; }
  vec3 albedo = acc / max(ws, 1e-3);
  albedo *= 0.92 + 0.16 * macro.x;
  tNw = fN; tRough = 0.95; tAO = 1.0;
  vec4 bk = texture(tBake, wuv);
  tSun = mix(1.0, bk.r, 0.8);
#else
  gdx = dFdx(vTW.xz); gdy = dFdy(vTW.xz); gdxS = dFdx(vTW.zy); gdyS = dFdy(vTW.zy); gdxF = dFdx(vTW.xy); gdyF = dFdy(vTW.xy);
  float detailFade = 1.0 - smoothstep(250.0, 900.0, camDist);
  vec3 bl = abs(Nw); bl = pow(bl, vec3(6.0)); bl /= (bl.x + bl.y + bl.z);
  float far = smoothstep(18.0, 90.0, camDist);
  // pass 1: heights for height-based blending
  float Hs[12]; float hmax = -10.0;
  vec4 A[12];
  for (int i = 0; i < 12; i++) {
    A[i] = vec4(0.0); Hs[i] = -10.0;
    if (W[i] < 0.015) continue;
    vec2 uv = vTW.xz * uTile[i];
    vec4 a = sampleL(i, uv, gdx, gdy);
#ifdef ANTITILE
    vec4 a2 = sampleL(i, uv * 0.213 + 0.37, gdx * 0.213, gdy * 0.213);
    a = mix(a, mix(a, a2, 0.5), far);
#endif
#ifdef TRIPLANAR
    if (uTri[i] > 0.5 && bl.y < 0.92) {
      vec4 ax = sampleL(i, vTW.zy * uTile[i] * vec2(1.0, -1.0), gdxS * vec2(1.0, -1.0), gdyS * vec2(1.0, -1.0));
      vec4 az = sampleL(i, vTW.xy * uTile[i] * vec2(1.0, -1.0), gdxF * vec2(1.0, -1.0), gdyF * vec2(1.0, -1.0));
      a = a * bl.y + ax * bl.x + az * bl.z;
    }
#endif
    A[i] = a;
    Hs[i] = a.a + W[i] * 1.6;
    hmax = max(hmax, Hs[i]);
  }
  vec3 albedo = vec3(0.0); vec4 nrA = vec4(0.0); float ws = 0.0;
  for (int i = 0; i < 12; i++) {
    if (Hs[i] < -5.0) continue;
    float b = max(Hs[i] - hmax + 0.28, 0.0);
    if (b <= 0.0) continue;
    vec2 uv = vTW.xz * uTile[i];
    vec4 n = sampleN(i, uv, gdx, gdy);
#ifdef TRIPLANAR
    if (uTri[i] > 0.5 && bl.y < 0.92) {
      vec4 nx = sampleN(i, vTW.zy * uTile[i] * vec2(1.0, -1.0), gdxS * vec2(1.0, -1.0), gdyS * vec2(1.0, -1.0));
      vec4 nz = sampleN(i, vTW.xy * uTile[i] * vec2(1.0, -1.0), gdxF * vec2(1.0, -1.0), gdyF * vec2(1.0, -1.0));
      n = n * bl.y + nx * bl.x + nz * bl.z;
    }
#endif
    albedo += A[i].rgb * b; nrA += n * b; ws += b;
  }
  albedo /= max(ws, 1e-4); nrA /= max(ws, 1e-4);
  // macro colour variation keeps kilometre-scale ground from looking uniform
  albedo *= 0.86 + 0.28 * macro.x;
  albedo *= mix(vec3(1.0), vec3(1.45, 1.32, 1.18), road * float(kind == 2 || kind == 5));
  albedo = mix(albedo, albedo * vec3(1.05, 0.98, 0.92), macro.z - 0.5);
  vec2 dn = (nrA.xy * 2.0 - 1.0) * detailFade * 1.15;
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - Nw * Nw.x);
  vec3 B = normalize(cross(T, Nw));
  tNw = normalize(Nw + T * dn.x - B * dn.y);
  tRough = mix(0.97, nrA.z, detailFade);
  tRough = mix(tRough, 0.22, icy * 0.85);
  tAO = mix(1.0, nrA.w, 0.85);
  vec4 bk = texture(tBake, wuv);
  tSun = bk.r;
  tAO *= mix(0.35, 1.0, bk.g) * mix(0.8, 1.05, bk.b);
  // wet mud sheen
  float wetness = W[8] * (1.0 - road) * smoothstep(0.3, 0.7, micro.y);
  tRough = mix(tRough, 0.28, wetness * 0.7);
  albedo *= 1.0 - wetness * 0.25;
#endif
diffuseColor.rgb = albedo;
`;
