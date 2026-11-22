// River surfaces: flow-aligned ribbons with procedural ripples, fresnel sky reflection, sun glint, depth tint and foam.
import * as THREE from 'three';
import { sampleH } from './gen';
import type { World } from './finish';

export class Water {
  group = new THREE.Group();
  uniforms: Record<string, THREE.IUniform>;
  constructor(w: World, noise: THREE.Texture, sun: THREE.Vector3) {
    this.uniforms = {
      uTime: { value: 0 }, tNoise: { value: noise }, uSun: { value: sun }, uSunCol: { value: new THREE.Color(1.0, 0.86, 0.66) },
      uZenith: { value: new THREE.Color(0.18, 0.36, 0.7) }, uHorizon: { value: new THREE.Color(0.62, 0.72, 0.84) },
    };
    for (const r of w.rivers) {
      const n = r.pts.length;
      const pos: number[] = [], uv: number[] = [], depth: number[] = [], idx: number[] = [];
      let along = 0;
      const half = r.width / 2 + 4;
      for (let i = 0; i < n; i++) {
        const a = r.pts[Math.max(0, i - 1)], b = r.pts[Math.min(n - 1, i + 1)];
        let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        if (i > 0) along += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
        const y = r.lvl[i];
        for (let s = -1; s <= 1; s += 0.5) {
          const x = r.pts[i][0] - dz * half * s, z = r.pts[i][1] + dx * half * s;
          pos.push(x, y, z); uv.push(s * half, along);
          depth.push(y - sampleH(w.height, x, z));
        }
      }
      for (let i = 0; i < n - 1; i++) for (let s = 0; s < 4; s++) {
        const a = i * 5 + s, b = a + 1, c = a + 5, d = c + 1;
        idx.push(a, b, c, b, d, c);   // counter-clockwise from above
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('depth', new THREE.Float32BufferAttribute(depth, 1));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const m = new THREE.ShaderMaterial({
        uniforms: { ...this.uniforms, uMud: { value: r.mud ? 1 : 0 }, uFlow: { value: r.id === 'canyon' ? 0.6 : r.id.startsWith('pond') ? 0.0 : 1.1 } },
        vertexShader: /* glsl */`
          attribute float depth; varying float vDepth; varying vec2 vUv; varying vec3 vW;
          void main() { vDepth = depth; vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: /* glsl */`
          uniform float uTime, uMud, uFlow; uniform sampler2D tNoise; uniform vec3 uSun, uSunCol, uZenith, uHorizon;
          varying float vDepth; varying vec2 vUv; varying vec3 vW;
          float h(vec2 p) { return texture2D(tNoise, p).x; }
          void main() {
            vec2 p1 = vec2(vUv.x * 0.11, vUv.y * 0.07 - uTime * 0.09 * uFlow);
            vec2 p2 = vec2(vUv.x * 0.23 + 0.3, vUv.y * 0.17 - uTime * 0.16 * uFlow);
            float e = 0.004;
            float hx = (h(p1 + vec2(e, 0.0)) - h(p1 - vec2(e, 0.0))) + 0.6 * (h(p2 + vec2(e, 0.0)) - h(p2 - vec2(e, 0.0)));
            float hz = (h(p1 + vec2(0.0, e)) - h(p1 - vec2(0.0, e))) + 0.6 * (h(p2 + vec2(0.0, e)) - h(p2 - vec2(0.0, e)));
            vec3 N = normalize(vec3(-hx * 5.0, 1.0, -hz * 5.0));
            vec3 V = normalize(cameraPosition - vW);
            float fres = (0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 4.0)) * 0.9;
            vec3 R = reflect(-V, N);
            vec3 sky = mix(uHorizon * 0.8, uZenith, pow(max(R.y, 0.0), 0.5)) * 1.25;
            float spec = pow(max(dot(R, uSun), 0.0), 350.0) * 40.0 + pow(max(dot(R, uSun), 0.0), 24.0) * 0.6;
            float d = clamp(vDepth, 0.0, 3.0);
            vec3 deep = mix(vec3(0.015, 0.07, 0.1), vec3(0.05, 0.09, 0.08), uMud);
            vec3 shallow = mix(vec3(0.1, 0.27, 0.3), vec3(0.2, 0.26, 0.2), uMud);
            float sunL = max(dot(vec3(0.0, 1.0, 0.0), uSun), 0.0) * 0.8 + 0.4;
            vec3 body = mix(shallow, deep, smoothstep(0.0, 1.6, d)) * sunL * 1.6;
            float foam = smoothstep(0.3, 0.0, d) * smoothstep(0.3, 0.7, h(vUv * 0.3 + vec2(0.0, -uTime * 0.2)));
            // flow streaks: white water lines dragged downstream make the surface read as moving water from afar
            foam += 0.35 * smoothstep(0.62, 0.8, h(vec2(vUv.x * 0.06, vUv.y * 0.012 - uTime * 0.05 * uFlow))) * smoothstep(0.1, 0.6, d);
            vec3 col = mix(body, sky, fres) + uSunCol * spec;
            col = mix(col, vec3(1.6), foam * 0.7);
            float a = mix(0.72, 0.96, smoothstep(0.05, 1.0, d)) * smoothstep(-0.05, 0.06, d);
            gl_FragColor = vec4(col, max(a, fres * 0.9) * smoothstep(-0.05, 0.05, d));
          }`,
        transparent: true, depthWrite: true,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = 1; mesh.receiveShadow = false;
      this.group.add(mesh);
    }
  }
  update(t: number) { this.uniforms.uTime.value = t; }

  /** Frozen lakes: a glossy ice sheet with snow drifts and pressure cracks, a hair above the (ice-physics) ground. */
  static ice(l: { x: number; z: number; r: number; h: number }): THREE.Mesh {
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const g = c.getContext('2d')!;
    g.fillStyle = '#b9d4e2'; g.fillRect(0, 0, 1024, 1024);
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 260; i++) { const x = rnd() * 1024, y = rnd() * 1024, r = 20 + rnd() * 120; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(250,253,255,${0.25 + rnd() * 0.45})`); gr.addColorStop(1, 'rgba(250,253,255,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r, r * (0.3 + rnd() * 0.5), rnd() * 3, 0, 7); g.fill(); }
    for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '70,110,135'},${0.25 + rnd() * 0.4})`; g.lineWidth = 0.6 + rnd() * 1.6; g.beginPath(); let x = rnd() * 1024, y = rnd() * 1024; g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (rnd() - 0.5) * 120; y += (rnd() - 0.5) * 120; g.lineTo(x, y); } g.stroke(); }
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(l.r / 60, l.r / 60); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const m = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.2 });
    const geo = new THREE.CircleGeometry(l.r + 1, 96).rotateX(-Math.PI / 2);
    // uv in metres-ish for the repeat
    const uv = geo.attributes.uv as THREE.BufferAttribute, pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / (2 * l.r) + 0.5, pos.getZ(i) / (2 * l.r) + 0.5);
    const mesh = new THREE.Mesh(geo, m); mesh.position.set(l.x, l.h + 0.05, l.z); mesh.receiveShadow = true;
    return mesh;
  }
}
