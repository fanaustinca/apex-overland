// Shared vehicle materials: clear-coat paint with dynamic dirt/mud/snow accumulation, glass, rubber, metals.
import * as THREE from 'three';

export interface DirtUniforms { uDirt: { value: number }; uDirtCol: { value: THREE.Color }; uSnow: { value: number } }
export function makeDirtUniforms(): DirtUniforms { return { uDirt: { value: 0 }, uDirtCol: { value: new THREE.Color(0.32, 0.24, 0.16) }, uSnow: { value: 0 } }; }

const DIRT_COMMON = /* glsl */`
uniform float uDirt, uSnow; uniform vec3 uDirtCol;
varying vec3 vObjP; varying vec3 vObjN;
float dHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float dNoise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dHash(i), dHash(i + vec3(1,0,0)), f.x), mix(dHash(i + vec3(0,1,0)), dHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(dHash(i + vec3(0,0,1)), dHash(i + vec3(1,0,1)), f.x), mix(dHash(i + vec3(0,1,1)), dHash(i + vec3(1,1,1)), f.x), f.y), f.z); }
float dirtMask() {
  float n = dNoise(vObjP * 3.1) * 0.55 + dNoise(vObjP * 9.7) * 0.3 + dNoise(vObjP * 27.0) * 0.15;
  float low = 1.0 - smoothstep(-0.2, 1.4, vObjP.y);                 // splash line: lower body gets it first
  float side = 1.0 - abs(vObjN.y) * 0.6;
  float m = uDirt * (0.35 + low * 0.9) * side + uDirt * uDirt * 0.25;
  return smoothstep(0.35, 0.75, m + (n - 0.5) * 0.7);
}
`;

/** Patch any standard/physical material so it collects dirt with the vehicle's shared uniforms. */
export function dirtify<T extends THREE.MeshStandardMaterial>(m: T, u: DirtUniforms, strength = 1): T {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObjP; varying vec3 vObjN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjP = position; vObjN = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + DIRT_COMMON)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float dm = dirtMask() * ${strength.toFixed(2)};
        float snowM = uSnow * smoothstep(0.55, 0.85, vObjN.y + (dNoise(vObjP * 6.0) - 0.5) * 0.5);
        diffuseColor.rgb = mix(diffuseColor.rgb, uDirtCol * (0.75 + 0.5 * dNoise(vObjP * 13.0)), dm);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.98), snowM);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.92, max(dm, snowM * 0.6));')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - dm;');
    if (sh.fragmentShader.includes('#include <lights_physical_fragment>'))
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= 1.0 - dm;\n#endif');
  };
  m.customProgramCacheKey = () => 'dirt' + strength;
  return m;
}

let shared: ReturnType<typeof buildShared> | null = null;
function buildShared() {
  // tyre tread normal map (procedural blocks)
  const W = 256, H = 64;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgb(128,128,255)'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 16; i++) {
    const x = i * W / 16;
    for (const [y0, y1, off] of [[4, 28, 0], [36, 60, 8]] as const) {
      const gr = g.createLinearGradient(x + off, 0, x + off + 10, 0);
      gr.addColorStop(0, 'rgb(40,128,255)'); gr.addColorStop(0.5, 'rgb(128,128,255)'); gr.addColorStop(1, 'rgb(215,128,255)');
      g.fillStyle = gr; g.fillRect(x + off, y0, 10, y1 - y0);
    }
  }
  const tread = new THREE.CanvasTexture(c); tread.wrapS = tread.wrapT = THREE.RepeatWrapping; tread.colorSpace = THREE.NoColorSpace;
  return {
    tread,
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0b1118, metalness: 0.2, roughness: 0.03, transparent: true, opacity: 0.82, envMapIntensity: 3.0, clearcoat: 1, clearcoatRoughness: 0.02 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.1, envMapIntensity: 2.6 }),
    headlight: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3dc, emissiveIntensity: 2.2, roughness: 0.1 }),
    lens: new THREE.MeshPhysicalMaterial({ color: 0xdfe8f0, metalness: 0, roughness: 0.02, transmission: 0, transparent: true, opacity: 0.35, clearcoat: 1 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xff9a1a, emissive: 0xff7a00, emissiveIntensity: 0.6, roughness: 0.3 }),
    exhaust: new THREE.MeshStandardMaterial({ color: 0x3a3634, metalness: 0.85, roughness: 0.45 }),
    nos: new THREE.MeshPhysicalMaterial({ color: 0x1d5cff, metalness: 0.7, roughness: 0.25, clearcoat: 1 }),
    spring: [0x888888, 0xffd21a, 0xff2a2a, 0x1aa3ff].map((c2) => new THREE.MeshStandardMaterial({ color: c2, metalness: 0.5, roughness: 0.35 })),
    shock: new THREE.MeshStandardMaterial({ color: 0x1c1c1e, metalness: 0.8, roughness: 0.3 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x3b3d40, metalness: 0.8, roughness: 0.5 }),
    blade: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.85, roughness: 0.38 }),
    track: new THREE.MeshStandardMaterial({ color: 0x2a2826, metalness: 0.6, roughness: 0.75 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.85 }),
    helmet: new THREE.MeshPhysicalMaterial({ color: 0xf2f2f2, roughness: 0.25, clearcoat: 1 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x101820, metalness: 0.6, roughness: 0.05 }),
    suit: new THREE.MeshStandardMaterial({ color: 0x24324a, roughness: 0.8 }),
  };
}
export function sharedMats() { return (shared ??= buildShared()); }

export interface VehicleMats {
  paint: THREE.MeshPhysicalMaterial; paint2: THREE.MeshPhysicalMaterial; trim: THREE.MeshStandardMaterial; frame: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial; rim: THREE.MeshStandardMaterial; brake: THREE.MeshStandardMaterial; under: THREE.MeshStandardMaterial;
  dirt: DirtUniforms;
}
export function vehicleMats(color: string, color2: string, rimColor: number, rimMetal = 0.9): VehicleMats {
  const dirt = makeDirtUniforms();
  const s = sharedMats();
  const paint = dirtify(new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 2.4 }), dirt);
  const paint2 = dirtify(new THREE.MeshPhysicalMaterial({ color: color2, metalness: 0.4, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.06, envMapIntensity: 2.0 }), dirt);
  const trim = dirtify(new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.62, metalness: 0.1 }), dirt);
  const frame = dirtify(new THREE.MeshStandardMaterial({ color: 0x232426, roughness: 0.5, metalness: 0.7 }), dirt, 1.2);
  const under = dirtify(new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8, metalness: 0.3 }), dirt, 1.6);
  const rubber = dirtify(new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.93, metalness: 0, normalMap: s.tread, normalScale: new THREE.Vector2(1.2, 1.2) }), dirt, 1.8);
  const rim = dirtify(new THREE.MeshStandardMaterial({ color: rimColor, metalness: rimMetal, roughness: 0.28 }), dirt, 0.8);
  const brake = new THREE.MeshStandardMaterial({ color: 0x5a0a0a, emissive: 0xff1a10, emissiveIntensity: 0.4, roughness: 0.3 });
  return { paint, paint2, trim, frame, rubber, rim, brake, under, dirt };
}
