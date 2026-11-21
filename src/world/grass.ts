// GPU grass: world-stable blades toroidally wrapped around the camera. Heights come from a float heightmap
// (sampled with the physics triangulation), density from the splat maps, lighting/shadows from MeshStandardMaterial.
import * as THREE from 'three';
import { V, HALF, WORLD, CELL } from './layout';
import type { World } from './finish';
import { GARAGES } from './props';
import { CABINS } from './roads';

export class Grass {
  mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private uniforms: Record<string, THREE.IUniform>;
  constructor(w: World, ctrl: THREE.Texture[], road: THREE.Texture, noise: THREE.Texture, time: { value: number }) {
    const hTex = new THREE.DataTexture(w.height, V, V, THREE.RedFormat, THREE.FloatType);
    hTex.minFilter = hTex.magFilter = THREE.NearestFilter; hTex.needsUpdate = true;
    // blade: 5-segment tapered strip
    // a tuft of three blades; position.z carries the blade index for per-blade variation
    const seg = 4, pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let b = 0; b < 3; b++) {
      const base = pos.length / 3;
      for (let i = 0; i <= seg; i++) { const t = i / seg, wdt = 0.5 * (1 - t * 0.9); pos.push(-wdt, t, b, wdt, t, b); uv.push(0, t, 1, t); }
      for (let i = 0; i < seg; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const MAX = 110000;
    const off = new Float32Array(MAX * 4);
    for (let i = 0; i < MAX; i++) {
      // stratified jitter on a disc-ish square
      const h1 = fract(Math.sin(i * 12.9898) * 43758.5453), h2 = fract(Math.sin(i * 78.233) * 12543.123), h3 = fract(Math.sin(i * 39.425) * 9876.54), h4 = fract(Math.sin(i * 91.17) * 3456.7);
      off[i * 4] = h1; off[i * 4 + 1] = h2; off[i * 4 + 2] = h3 * Math.PI * 2; off[i * 4 + 3] = h4;
    }
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    g.instanceCount = 60000;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = g;
    this.uniforms = { tH: { value: hTex }, tC0: { value: ctrl[0] }, tC1: { value: ctrl[1] }, tC2: { value: ctrl[2] }, tR: { value: road }, tN: { value: noise }, uCam: { value: new THREE.Vector3() }, uR: { value: 55 }, uTime: time,
      uClear: { value: [...GARAGES.map((g) => new THREE.Vector3(g.x + Math.sin(g.yaw) * (g.main ? 16 : 6), g.z + Math.cos(g.yaw) * (g.main ? 16 : 6), g.main ? 42 : 20)), ...CABINS.map((c) => new THREE.Vector3(c.x, c.z, 11))] } };
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
        attribute vec4 aOff; uniform sampler2D tH, tC0, tC1, tC2, tR, tN; uniform vec3 uCam; uniform float uR, uTime; uniform vec3 uClear[9];
        varying vec3 vGCol; varying float vGy;
        float hAt(vec2 p) {
          vec2 f = (p + ${HALF.toFixed(1)}) / ${CELL.toFixed(1)}; ivec2 i = ivec2(floor(f)); vec2 u = f - vec2(i);
          float a = texelFetch(tH, i, 0).r, b = texelFetch(tH, i + ivec2(1, 0), 0).r, c = texelFetch(tH, i + ivec2(0, 1), 0).r, d = texelFetch(tH, i + ivec2(1, 1), 0).r;
          return u.x + u.y < 1.0 ? a + (b - a) * u.x + (c - a) * u.y : d + (c - d) * (1.0 - u.x) + (b - d) * (1.0 - u.y);
        }`)
        .replace('#include <begin_vertex>', `
          float S = uR * 2.0;
          vec2 local = (aOff.xy - 0.5) * S;
          vec2 wp = local + S * floor((uCam.xz - local) / S + 0.5);
          vec2 muv = (wp + ${HALF.toFixed(1)}) / ${WORLD.toFixed(1)};
          vec4 c0 = texture2D(tC0, muv), c1 = texture2D(tC1, muv), c2 = texture2D(tC2, muv);
          float road = texture2D(tR, muv).r;
          float lush = c1.r + c0.a * 0.55;                  // grass + forest floor
          float dry = c0.g * 0.5 + c1.a * 0.25 + c2.g * 0.3;   // cracked ground, gravel, dirt
          float dens = (lush + dry * 0.35) * (1.0 - smoothstep(0.05, 0.3, road)) * (1.0 - c1.g) * (1.0 - smoothstep(0.12, 0.4, c2.r));
          vec4 nz = texture2D(tN, wp / 23.0);
          dens *= smoothstep(0.15, 0.6, nz.x + 0.25);
          float dist = length(wp - uCam.xz);
          float fade = 1.0 - smoothstep(uR * 0.7, uR, dist);
          for (int ci = 0; ci < 9; ci++) dens *= smoothstep(uClear[ci].z, uClear[ci].z + 4.0, length(wp - uClear[ci].xy));
          float keep = step(aOff.w, dens * 1.25) * fade;
          float bi = position.z;
          float hb = fract(sin(dot(vec2(aOff.w, bi), vec2(12.9898, 78.233))) * 43758.5453);
          float hgt = (0.22 + 0.38 * nz.y + 0.25 * hb) * keep * (0.75 + lush * 0.45);
          float wdt = 0.035 + 0.025 * nz.z;
          float yaw = aOff.z + bi * 2.1;
          vec3 transformed = vec3(position.x * wdt, position.y * hgt, 0.0);
          wp += vec2(cos(yaw * 3.0 + bi), sin(yaw * 2.0 - bi)) * 0.09 * bi;
          float cs = cos(yaw), sn = sin(yaw);
          transformed.xz = vec2(transformed.x * cs, transformed.x * sn);
          float t = position.y;
          float wind = (sin(uTime * 1.8 + wp.x * 0.35 + wp.y * 0.2) * 0.6 + sin(uTime * 3.1 + wp.x * 0.9) * 0.25) * 0.18 + 0.12;
          vec2 lean = vec2(cos(yaw * 1.7), sin(yaw * 1.7)) * 0.15 + vec2(wind, wind * 0.4);
          transformed.xz += lean * t * t * hgt;
          transformed.y -= dot(lean, lean) * t * t * hgt * 0.35;
          transformed += vec3(wp.x, hAt(wp) - 0.02, wp.y);
          vec3 base = mix(vec3(0.16, 0.24, 0.07), vec3(0.3, 0.28, 0.12), clamp(dry / max(lush + dry, 0.01), 0.0, 1.0));
          vec3 tip = mix(vec3(0.42, 0.52, 0.18), vec3(0.62, 0.55, 0.3), clamp(dry / max(lush + dry, 0.01) + nz.w * 0.3, 0.0, 1.0));
          vGCol = mix(base, tip, t) * (0.85 + 0.3 * nz.z);
          vGy = t;`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4(transformed, 1.0); gl_Position = projectionMatrix * mvPosition;')
        .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(transformed, 1.0);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGCol; varying float vGy;')
        .replace('#include <map_fragment>', 'diffuseColor.rgb = vGCol;')
        .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= mix(0.45, 1.0, vGy); reflectedLight.directDiffuse *= mix(0.6, 1.1, vGy);');
    };
    m.customProgramCacheKey = () => 'grass';
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false; this.mesh.receiveShadow = true; this.mesh.castShadow = false;
  }
  setQuality(n: number, radius: number) { this.geo.instanceCount = n; this.uniforms.uR.value = radius; this.mesh.visible = n > 0; }
  update(cam: THREE.Vector3) { this.uniforms.uCam.value.copy(cam); }
}
function fract(x: number) { return x - Math.floor(x); }
