// Renderer, sky, lighting and the post-processing pipeline (AO, bloom, god rays, motion blur, aerial perspective, ACES).
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { SUN_DIR } from '../world/finish';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { assetUrl } from '../core/assets';

export interface GfxSettings {
  preset: 'potato' | 'medium' | 'high' | 'ultra' | 'custom';
  terrain: number;       // 0 low-poly .. 3 ultra
  shadows: number;       // 0 off, 1 1024, 2 2048, 3 4096
  shadowDist: number;    // metres covered by the shadow map (half extent)
  foliage: number;       // 0.2 .. 1
  drawDist: number;      // 0.35 .. 1
  aa: 'off' | 'fxaa' | 'msaa' | 'msaa+fxaa';
  tonemap: boolean; ssao: boolean; bloom: boolean; godrays: boolean; motionBlur: boolean; particles: number; // 0..1
  resScale: number;
}

export const PRESETS: Record<'potato' | 'medium' | 'high' | 'ultra', GfxSettings> = {
  potato: { preset: 'potato', terrain: 0, shadows: 0, shadowDist: 60, foliage: 0.2, drawDist: 0.4, aa: 'fxaa', tonemap: true, ssao: false, bloom: false, godrays: false, motionBlur: false, particles: 0.25, resScale: 0.85 },
  medium: { preset: 'medium', terrain: 1, shadows: 1, shadowDist: 70, foliage: 0.5, drawDist: 0.65, aa: 'fxaa', tonemap: true, ssao: false, bloom: true, godrays: false, motionBlur: false, particles: 0.6, resScale: 1 },
  high: { preset: 'high', terrain: 2, shadows: 2, shadowDist: 100, foliage: 0.8, drawDist: 0.85, aa: 'msaa', tonemap: true, ssao: false, bloom: true, godrays: true, motionBlur: false, particles: 0.85, resScale: 1 },
  ultra: { preset: 'ultra', terrain: 3, shadows: 3, shadowDist: 150, foliage: 1, drawDist: 1, aa: 'msaa+fxaa', tonemap: true, ssao: true, bloom: true, godrays: true, motionBlur: true, particles: 1, resScale: 1 },
};

export const sunDir = new THREE.Vector3(...SUN_DIR).normalize();

export class Gfx {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: Sky;
  s: GfxSettings = { ...PRESETS.high };
  private sceneRT!: THREE.WebGLRenderTarget;
  private aoRT!: THREE.WebGLRenderTarget;
  private ldrRT!: THREE.WebGLRenderTarget;
  private rayA!: THREE.WebGLRenderTarget; private rayB!: THREE.WebGLRenderTarget;
  private bloom?: UnrealBloomPass;
  private gtao?: GTAOPass;
  private composite: THREE.ShaderMaterial;
  private rayMask: THREE.ShaderMaterial; private rayBlur: THREE.ShaderMaterial;
  private fxaa: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  private prevVP = new THREE.Matrix4();
  private size = new THREE.Vector2();
  exposure = 1.0;
  hazeColor = new THREE.Color(0.62, 0.72, 0.86);
  focus = new THREE.Vector3();
  hdr?: THREE.DataTexture;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;   // done in the composite
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.3, 6000);
    this.scene.add(this.camera);

    // sky
    this.sky = new Sky();
    this.sky.scale.setScalar(5000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 3.2; u.rayleigh.value = 1.25; u.mieCoefficient.value = 0.0045; u.mieDirectionalG.value = 0.86;
    u.sunPosition.value.copy(sunDir).multiplyScalar(4000);
    this.sky.material.depthWrite = false;
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffe0b8, 4.2);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x6b5a44, 0.18);
    this.scene.add(this.hemi);

    canvas.addEventListener('webglcontextrestored', () => this.buildEnv());
    // haze colour = sky near the horizon, away from the sun
    this.hazeColor.setRGB(0.66, 0.74, 0.86);

    this.composite = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, tRays: { value: null },
        uInvVP: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() },
        uSun: { value: sunDir }, uHaze: { value: this.hazeColor }, uSunCol: { value: new THREE.Color(1.0, 0.82, 0.6) },
        uFogDensity: { value: 0.00032 }, uFogFalloff: { value: 0.0085 }, uExposure: { value: 1 }, uTonemap: { value: 1 },
        uRays: { value: 0 }, uBlur: { value: 0 }, uNear: { value: 0.3 }, uFar: { value: 6000 }, uTime: { value: 0 }, uVignette: { value: 0.22 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: COMPOSITE, depthTest: false, depthWrite: false,
    });
    this.rayMask = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, tDepth: { value: null }, uSunUV: { value: new THREE.Vector2() }, uAspect: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tColor, tDepth; uniform vec2 uSunUV; uniform float uAspect; varying vec2 vUv;
        void main(){ float d = texture2D(tDepth, vUv).x; float sky = step(0.99999, d);
          vec3 c = texture2D(tColor, vUv).rgb; float l = dot(c, vec3(0.3, 0.5, 0.2));
          vec2 dd = (vUv - uSunUV) * vec2(uAspect, 1.0); float disc = exp(-dot(dd, dd) * 30.0);
          gl_FragColor = vec4(sky * (clamp(l - 9.0, 0.0, 6.0) * 0.08 + disc * 1.6) * vec3(1.0, 0.86, 0.66), 1.0); }`,
      depthTest: false, depthWrite: false,
    });
    this.rayBlur = new THREE.ShaderMaterial({
      uniforms: { tIn: { value: null }, uSunUV: { value: new THREE.Vector2() }, uStep: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tIn; uniform vec2 uSunUV; uniform float uStep; varying vec2 vUv;
        void main(){ vec2 d = (uSunUV - vUv) * (uStep / 40.0); vec2 p = vUv; vec3 acc = vec3(0.0); float w = 1.0, ws = 0.0;
          for (int i = 0; i < 40; i++) { acc += texture2D(tIn, p).rgb * w; ws += w; w *= 0.965; p += d; }
          gl_FragColor = vec4(acc / ws, 1.0); }`,
      depthTest: false, depthWrite: false,
    });
    this.fxaa = new THREE.ShaderMaterial({ ...FXAAShader, uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms), depthTest: false, depthWrite: false });
    this.applySettings(this.s);
  }

  /** Image based lighting from the sky (rebuilt if the GL context is ever restored). */
  buildEnv() {
    const u = this.sky.material.uniforms;
    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const sky2 = new Sky(); sky2.scale.setScalar(1000);
    for (const k of Object.keys(u)) (sky2.material.uniforms as Record<string, THREE.IUniform>)[k].value = (u as Record<string, THREE.IUniform>)[k].value;
    envScene.add(sky2);
    // dim ground hemisphere so reflections are not sky-blue from below
    const ground = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16, 0, Math.PI * 2, Math.PI / 2 + 0.02, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4a3d31, side: THREE.BackSide }));
    envScene.add(ground);
    const old = this.scene.environment;
    this.scene.environment = this.hdr ? pm.fromEquirectangular(this.hdr).texture : pm.fromScene(envScene, 0.02, 1, 3000).texture;
    old?.dispose();
    this.scene.environmentIntensity = this.hdr ? 0.42 : 0.45;
    // align the HDRI's bright sky roughly with our sun azimuth
    this.scene.environmentRotation.set(0, 2.2, 0);
    pm.dispose();
  }

  /** Some drivers (headless ANGLE/Vulkan) drop and restore a brand-new context; let it settle before uploading. */
  async settle() {
    const gl = this.renderer.getContext();
    await new Promise((r) => setTimeout(r, 120));
    if (gl.isContextLost()) await new Promise((r) => this.renderer.domElement.addEventListener('webglcontextrestored', r, { once: true }));
    await new Promise((r) => requestAnimationFrame(r));
    try { this.hdr = await new HDRLoader().loadAsync(assetUrl('hdri/kloofendal_43d_clear_1k.hdr')); this.hdr.mapping = THREE.EquirectangularReflectionMapping; } catch { this.hdr = undefined; }
    this.buildEnv();
  }

  applySettings(s: GfxSettings) {
    this.s = s;
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2) * s.resScale);
    r.shadowMap.enabled = s.shadows > 0;
    this.sun.castShadow = s.shadows > 0;
    const ms = [0, 1024, 2048, 4096][s.shadows] || 1024;
    if (this.sun.shadow.mapSize.x !== ms) { this.sun.shadow.mapSize.set(ms, ms); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget; }
    const e = s.shadowDist;
    const cam = this.sun.shadow.camera;
    cam.left = -e; cam.right = e; cam.top = e; cam.bottom = -e; cam.near = 1; cam.far = 1600; cam.updateProjectionMatrix();
    this.sun.shadow.radius = s.shadows >= 3 ? 2.5 : 1.5;
    this.camera.far = 1800 + 4200 * s.drawDist; this.camera.updateProjectionMatrix();
    (this.composite.uniforms.uFar.value as number) = this.camera.far;
    this.resize(true);
    r.shadowMap.needsUpdate = true;
  }

  resize(force = false) {
    const w = window.innerWidth, h = window.innerHeight;
    const r = this.renderer;
    if (!force && this.size.x === w && this.size.y === h) return;
    this.size.set(w, h);
    r.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    const pr = r.getPixelRatio(), W = Math.floor(w * pr), H = Math.floor(h * pr);
    this.sceneRT?.dispose(); this.aoRT?.dispose(); this.ldrRT?.dispose(); this.rayA?.dispose(); this.rayB?.dispose();
    const msaa = this.s.aa === 'msaa' || this.s.aa === 'msaa+fxaa';
    const depth = new THREE.DepthTexture(W, H); depth.type = THREE.UnsignedIntType;
    this.sceneRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: msaa ? 4 : 0, depthTexture: depth, depthBuffer: true });
    this.aoRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false });
    this.ldrRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.rayA = new THREE.WebGLRenderTarget(W >> 2, H >> 2, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rayB = this.rayA.clone();
    this.bloom?.dispose(); this.bloom = undefined;
    if (this.s.bloom) { this.bloom = new UnrealBloomPass(new THREE.Vector2(W >> 1, H >> 1), 0.22, 0.5, 14.0); }
    this.gtao?.dispose(); this.gtao = undefined;
    if (this.s.ssao) {
      this.gtao = new GTAOPass(this.scene, this.camera, W, H);
      this.gtao.setGBuffer(depth);
      this.gtao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.4, thickness: 2.5, scale: 1.0, samples: 12, distanceFallOff: 0.6 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.gtao.blendIntensity = 0.85;
    }
    (this.fxaa.uniforms.resolution.value as THREE.Vector2).set(1 / W, 1 / H);
  }

  /** Keep the shadow frustum centred on the action, snapped to texels so edges don't crawl. */
  updateShadow(focus: THREE.Vector3) {
    this.focus.copy(focus);
    const e = this.s.shadowDist, ms = this.sun.shadow.mapSize.x || 1024;
    const texel = (2 * e) / ms;
    const light = this.sun;
    // project focus into light space to snap
    const lightRot = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), sunDir.clone().negate(), new THREE.Vector3(0, 1, 0));
    const inv = lightRot.clone().invert();
    const p = focus.clone().applyMatrix4(inv);
    p.x = Math.round(p.x / texel) * texel; p.y = Math.round(p.y / texel) * texel;
    p.applyMatrix4(lightRot);
    light.target.position.copy(p);
    light.position.copy(p).addScaledVector(sunDir, 800);
    light.target.updateMatrixWorld();
  }

  render(dt: number, time: number) {
    const r = this.renderer, cam = this.camera, s = this.s;
    r.info.reset();
    cam.updateMatrixWorld();
    // sky follows the camera
    this.sky.position.copy(cam.position);
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(this.scene, cam);
    let color: THREE.Texture = this.sceneRT.texture;
    if (this.gtao) {
      this.gtao.render(r, this.aoRT, this.sceneRT, dt, false);
      color = this.aoRT.texture;
    }
    if (this.bloom) {
      const src = color === this.aoRT.texture ? this.aoRT : this.sceneRT;
      this.bloom.render(r, null as unknown as THREE.WebGLRenderTarget, src, dt, false);
      color = src.texture;
    }
    // sun screen position for god rays
    const sp = cam.position.clone().addScaledVector(sunDir, 3000).project(cam);
    const sunUV = new THREE.Vector2(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
    const facing = cam.getWorldDirection(new THREE.Vector3()).dot(sunDir);
    let rays = 0;
    if (s.godrays && facing > 0.05 && sp.z < 1) {
      rays = THREE.MathUtils.smoothstep(facing, 0.05, 0.5) * (1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(sp.x), Math.abs(sp.y)), 1.0, 1.8));
      if (rays > 0.01) {
        this.rayMask.uniforms.tColor.value = color; this.rayMask.uniforms.tDepth.value = this.sceneRT.depthTexture;
        this.rayMask.uniforms.uSunUV.value.copy(sunUV); this.rayMask.uniforms.uAspect.value = cam.aspect;
        this.blit(this.rayMask, this.rayA);
        this.rayBlur.uniforms.uSunUV.value.copy(sunUV);
        this.rayBlur.uniforms.tIn.value = this.rayA.texture; this.rayBlur.uniforms.uStep.value = 1.0; this.blit(this.rayBlur, this.rayB);
        this.rayBlur.uniforms.tIn.value = this.rayB.texture; this.rayBlur.uniforms.uStep.value = 0.35; this.blit(this.rayBlur, this.rayA);
      }
    }
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const cu = this.composite.uniforms;
    cu.tColor.value = color; cu.tDepth.value = this.sceneRT.depthTexture; cu.tRays.value = this.rayA.texture;
    cu.uInvVP.value.copy(vp).invert(); cu.uPrevVP.value.copy(this.prevVP); cu.uCam.value.copy(cam.position);
    cu.uRays.value = rays * 0.18; cu.uBlur.value = s.motionBlur ? Math.min(1, 0.016 / Math.max(dt, 1e-3)) * 0.55 : 0;
    cu.uExposure.value = this.exposure; cu.uTonemap.value = s.tonemap ? 1 : 0; cu.uNear.value = cam.near; cu.uFar.value = cam.far; cu.uTime.value = time;
    const fxaa = s.aa === 'fxaa' || s.aa === 'msaa+fxaa';
    this.blit(this.composite, fxaa ? this.ldrRT : null);
    if (fxaa) { this.fxaa.uniforms.tDiffuse.value = this.ldrRT.texture; this.blit(this.fxaa, null); }
    this.prevVP.copy(vp);
  }

  private blit(mat: THREE.Material, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }
}

const COMPOSITE = /* glsl */`
uniform sampler2D tColor, tDepth, tRays;
uniform mat4 uInvVP, uPrevVP;
uniform vec3 uCam, uSun, uHaze, uSunCol;
uniform float uFogDensity, uFogFalloff, uExposure, uTonemap, uRays, uBlur, uNear, uFar, uTime, uVignette;
varying vec2 vUv;

vec3 ACESFilmic(vec3 x) {
  // Narkowicz fit with the usual pre-exposure
  x *= 0.6;
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
vec3 worldFromDepth(vec2 uv, float d) {
  vec4 p = uInvVP * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  float d = texture2D(tDepth, vUv).x;
  vec3 col = texture2D(tColor, vUv).rgb;
  bool sky = d >= 0.99999;
  vec3 wp = worldFromDepth(vUv, sky ? 0.9999 : d);
  vec3 rd = wp - uCam; float dist = length(rd); rd /= dist;
  // camera motion blur from reprojected depth
  if (uBlur > 0.0) {
    vec4 prev = uPrevVP * vec4(wp, 1.0);
    vec2 puv = prev.xy / prev.w * 0.5 + 0.5;
    vec2 vel = (vUv - puv) * uBlur;
    float len = length(vel);
    if (len > 0.0015) {
      vel *= min(1.0, 0.04 / len);
      vec3 acc = col; float n = 1.0;
      float jit = hash(vUv * 731.0 + uTime) - 0.5;
      for (int i = 1; i < 9; i++) { vec2 o = vel * ((float(i) + jit) / 8.0 - 0.5); acc += texture2D(tColor, vUv + o).rgb; n += 1.0; }
      col = acc / n;
    }
  }
  // aerial perspective: exponential height fog with sun in-scattering
  if (!sky) {
    float h0 = uCam.y;
    float fall = uFogFalloff;
    float rdy = abs(rd.y) < 1e-4 ? 1e-4 : rd.y;
    float fog = uFogDensity * exp(-max(h0, 0.0) * fall) * (1.0 - exp(-dist * rdy * fall)) / (rdy * fall);
    fog = 1.0 - exp(-fog);
    float sunAmt = pow(max(dot(rd, uSun), 0.0), 10.0);
    vec3 fogCol = mix(uHaze, uSunCol * 1.05, sunAmt * 0.22);
    col = mix(col, fogCol, clamp(fog, 0.0, 0.92));
  }
  col += texture2D(tRays, vUv).rgb * uRays;
  col *= uExposure;
  if (uTonemap > 0.5) col = ACESFilmic(col);
  else col = clamp(col / (1.0 + col), 0.0, 1.0);
  // gentle grade: lift shadows to cool, warm highlights
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, col * vec3(0.96, 0.99, 1.05), (1.0 - l) * 0.35);
  col = mix(vec3(l), col, 1.08);
  vec2 q = vUv - 0.5; col *= 1.0 - uVignette * dot(q, q) * 2.0;
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  col += (hash(vUv * 1000.0 + uTime) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;
