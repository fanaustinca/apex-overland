// Instanced billboard particles: tyre dust / mud / snow / spray, exhaust, chimney smoke, debris.
import * as THREE from 'three';

export interface PKind { col: [number, number, number]; size: [number, number]; grow: number; life: [number, number]; grav: number; drag: number; alpha: number; up: number }
export const P: Record<string, PKind> = {
  sand: { col: [0.78, 0.52, 0.36], size: [1.0, 2.0], grow: 2.4, life: [1.2, 2.6], grav: -0.2, drag: 1.6, alpha: 0.42, up: 1.2 },
  dust: { col: [0.6, 0.5, 0.4], size: [0.8, 1.6], grow: 2.0, life: [1.0, 2.2], grav: -0.15, drag: 1.8, alpha: 0.38, up: 1.0 },
  gravel: { col: [0.62, 0.58, 0.52], size: [0.7, 1.3], grow: 1.6, life: [0.8, 1.6], grav: 0.2, drag: 1.8, alpha: 0.35, up: 1.0 },
  mud: { col: [0.22, 0.16, 0.1], size: [0.18, 0.4], grow: 0.1, life: [0.5, 1.1], grav: 9.0, drag: 0.4, alpha: 0.95, up: 4.0 },
  snow: { col: [0.95, 0.97, 1.0], size: [0.7, 1.5], grow: 2.2, life: [0.9, 2.0], grav: 0.3, drag: 1.4, alpha: 0.6, up: 1.6 },
  splash: { col: [0.82, 0.88, 0.92], size: [0.3, 0.8], grow: 1.2, life: [0.4, 0.9], grav: 9.0, drag: 0.5, alpha: 0.7, up: 4.5 },
  exhaust: { col: [0.35, 0.35, 0.36], size: [0.25, 0.45], grow: 1.4, life: [0.6, 1.4], grav: -0.6, drag: 1.2, alpha: 0.25, up: 0.3 },
  smoke: { col: [0.55, 0.55, 0.57], size: [1.5, 2.5], grow: 1.6, life: [5, 8], grav: -1.2, drag: 0.4, alpha: 0.35, up: 0.4 },
  chips: { col: [0.5, 0.36, 0.2], size: [0.1, 0.25], grow: 0, life: [0.8, 1.6], grav: 9.0, drag: 0.3, alpha: 1, up: 4 },
  black: { col: [0.12, 0.12, 0.12], size: [0.6, 1.2], grow: 1.6, life: [1.2, 2.4], grav: -0.8, drag: 1.0, alpha: 0.4, up: 0.6 },
};

const MAX = 4000;
export class Particles {
  mesh: THREE.Mesh;
  private pos = new Float32Array(MAX * 3); private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX); private maxLife = new Float32Array(MAX); private size = new Float32Array(MAX); private grow = new Float32Array(MAX);
  private grav = new Float32Array(MAX); private drag = new Float32Array(MAX); private alpha = new Float32Array(MAX); private rot = new Float32Array(MAX);
  private col = new Float32Array(MAX * 3);
  private aOff: THREE.InstancedBufferAttribute; private aCol: THREE.InstancedBufferAttribute; private aSz: THREE.InstancedBufferAttribute;
  private n = 0; private head = 0;
  rate = 1;
  constructor(scene: THREE.Scene) {
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index; g.setAttribute('position', quad.attributes.position); g.setAttribute('uv', quad.attributes.uv);
    this.aOff = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSz = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aOff', this.aOff); g.setAttribute('aCol', this.aCol); g.setAttribute('aSz', this.aSz);
    g.instanceCount = 0;
    const m = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: new THREE.Vector3(0.5, 0.5, 0.5) } },
      vertexShader: /* glsl */`
        attribute vec3 aOff; attribute vec4 aCol; attribute vec2 aSz;
        varying vec2 vUv; varying vec4 vCol;
        void main() {
          vUv = uv; vCol = aCol;
          vec4 mv = modelViewMatrix * vec4(aOff, 1.0);
          float c = cos(aSz.y), s = sin(aSz.y);
          vec2 p = mat2(c, -s, s, c) * position.xy * aSz.x;
          mv.xy += p;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying vec4 vCol;
        void main() {
          vec2 q = vUv - 0.5; float r = length(q) * 2.0;
          float a = smoothstep(1.0, 0.2, r);
          // cheap volumetric shading: lighter on the upper side
          float shade = 0.75 + 0.35 * (vUv.y);
          gl_FragColor = vec4(vCol.rgb * shade * 1.6, vCol.a * a);
          if (gl_FragColor.a < 0.004) discard;
        }`,
      transparent: true, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }
  emit(kind: PKind, x: number, y: number, z: number, vx = 0, vy = 0, vz = 0, count = 1, spread = 0.5) {
    const n = Math.round(count * this.rate) || (Math.random() < count * this.rate ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const i = this.head; this.head = (this.head + 1) % MAX; if (this.n < MAX) this.n++;
      const r = Math.random;
      this.pos[i * 3] = x + (r() - 0.5) * spread; this.pos[i * 3 + 1] = y + r() * spread * 0.5; this.pos[i * 3 + 2] = z + (r() - 0.5) * spread;
      this.vel[i * 3] = vx + (r() - 0.5) * 2; this.vel[i * 3 + 1] = vy + kind.up * (0.5 + r()); this.vel[i * 3 + 2] = vz + (r() - 0.5) * 2;
      this.maxLife[i] = this.life[i] = kind.life[0] + r() * (kind.life[1] - kind.life[0]);
      this.size[i] = kind.size[0] + r() * (kind.size[1] - kind.size[0]); this.grow[i] = kind.grow;
      this.grav[i] = kind.grav; this.drag[i] = kind.drag; this.alpha[i] = kind.alpha; this.rot[i] = r() * 6.28;
      const v = 0.9 + r() * 0.2;
      this.col[i * 3] = kind.col[0] * v; this.col[i * 3 + 1] = kind.col[1] * v; this.col[i * 3 + 2] = kind.col[2] * v;
    }
  }
  update(dt: number, light: number) {
    const off = this.aOff.array as Float32Array, col = this.aCol.array as Float32Array, sz = this.aSz.array as Float32Array;
    let w = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 2] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      off[w * 3] = this.pos[i * 3]; off[w * 3 + 1] = this.pos[i * 3 + 1]; off[w * 3 + 2] = this.pos[i * 3 + 2];
      const a = this.alpha[i] * Math.min(1, t * 8) * (1 - t) * (1 - t * 0.3);
      col[w * 4] = this.col[i * 3] * light; col[w * 4 + 1] = this.col[i * 3 + 1] * light; col[w * 4 + 2] = this.col[i * 3 + 2] * light; col[w * 4 + 3] = a;
      sz[w * 2] = this.size[i] * (1 + this.grow[i] * t); sz[w * 2 + 1] = this.rot[i] + t * 0.8;
      w++;
    }
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = w;
    this.aOff.needsUpdate = true; this.aCol.needsUpdate = true; this.aSz.needsUpdate = true;
    this.aOff.clearUpdateRanges(); this.aOff.addUpdateRange(0, w * 3);
    this.aCol.clearUpdateRanges(); this.aCol.addUpdateRange(0, w * 4);
    this.aSz.clearUpdateRanges(); this.aSz.addUpdateRange(0, w * 2);
  }
}
