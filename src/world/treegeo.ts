// Procedural tree geometry + textures (pine, snowy fir, redwood, broadleaf, saguaro).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/noise';

function canvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')!] as const; }

/** Fir branch spray: stem with dense angled needles. */
export function needleTexture(hue: string, hue2: string): THREE.Texture {
  const [c, g] = canvas(256, 256);
  const r = mulberry32(7);
  g.clearRect(0, 0, 256, 256);
  const stems = [[0.08, 0.5, 0.95, 0.5, 1], [0.35, 0.5, 0.7, 0.18, 0.55], [0.35, 0.5, 0.7, 0.82, 0.55], [0.6, 0.5, 0.88, 0.3, 0.45], [0.6, 0.5, 0.88, 0.7, 0.45]];
  for (const [x0, y0, x1, y1, s] of stems) {
    const L = Math.hypot(x1 - x0, y1 - y0) * 256;
    const ang = Math.atan2(y1 - y0, x1 - x0);
    g.strokeStyle = '#3a2a1a'; g.lineWidth = 3 * s; g.beginPath(); g.moveTo(x0 * 256, y0 * 256); g.lineTo(x1 * 256, y1 * 256); g.stroke();
    for (let t = 0; t < L; t += 2.2) {
      const px = x0 * 256 + Math.cos(ang) * t, py = y0 * 256 + Math.sin(ang) * t;
      const taper = 1 - t / L * 0.6;
      for (const side of [-1, 1]) {
        const a = ang + side * (0.9 + r() * 0.35);
        const nl = (16 + r() * 10) * s * taper;
        g.strokeStyle = r() < 0.5 ? hue : hue2; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * nl, py + Math.sin(a) * nl); g.stroke();
      }
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
export function leafTexture(): THREE.Texture {
  const [c, g] = canvas(256, 256);
  const r = mulberry32(11);
  for (let i = 0; i < 70; i++) {
    const x = 30 + r() * 196, y = 30 + r() * 196, a = r() * 6.28, s = 10 + r() * 12;
    const l = 30 + r() * 20;
    g.fillStyle = `hsl(${85 + r() * 30}, ${45 + r() * 20}%, ${l}%)`;
    g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.ellipse(0, 0, s, s * 0.55, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(30,50,10,0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-s, 0); g.lineTo(s, 0); g.stroke(); g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

type G = THREE.BufferGeometry;
function clean(g: G): G { const x = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv', 'snow'].includes(k)) x.deleteAttribute(k); if (!x.attributes.uv) x.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2)); if (!x.attributes.snow) x.setAttribute('snow', new THREE.Float32BufferAttribute(new Float32Array(x.attributes.position.count), 1)); return x; }

/** A card from the trunk outwards (in +x), drooping, rotated about Y by `yaw`. Normals bent outward/up for soft foliage lighting. */
function card(len: number, wid: number, droop: number, yaw: number, y: number, r0: number, tilt: number, snow: number): G {
  const g = new THREE.PlaneGeometry(len, wid, 3, 1);
  g.rotateX(-Math.PI / 2 + tilt);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + len / 2; const t = x / len;
    p.setXYZ(i, x + r0, p.getY(i) - droop * t * t, p.getZ(i));
  }
  g.rotateY(yaw); g.translate(0, y, 0);
  // bent normals: blend face normal with radial-up direction
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) {
    const px = p.getX(i), pz = p.getZ(i); const rl = Math.hypot(px, pz) || 1;
    const v = new THREE.Vector3(px / rl * 0.6, 0.8, pz / rl * 0.6).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  g.setAttribute('snow', new THREE.Float32BufferAttribute(new Float32Array(p.count).fill(snow), 1));
  return g;
}

function trunk(h: number, r0: number, r1: number, seg = 8, flare = 0): G {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 4, true);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) + h / 2; const f = flare * Math.exp(-y * 1.2); const x = p.getX(i), z = p.getZ(i); const l = Math.hypot(x, z) || 1; p.setXYZ(i, x + x / l * f, y, z + z / l * f); }
  const uv = g.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * h / 2);
  g.computeVertexNormals();
  return g;
}

export interface TreeGeo { bark: G; foliage: G; farBark: G; farFoliage: G; height: number; radius: number }

/** Conifer: layered drooping branch cards. `snowy` adds snow on the upper faces. */
export function conifer(seed: number, H: number, snowy: boolean, dense = 1): TreeGeo {
  const r = mulberry32(seed);
  const cards: G[] = [];
  const layers = Math.round(11 * dense);
  const base = H * 0.18;
  for (let l = 0; l < layers; l++) {
    const t = l / (layers - 1);
    const y = base + (H - base) * t * 0.94;
    const reach = (1 - t) * H * 0.26 + 0.5;
    const n = Math.max(4, Math.round((7 - t * 3) * dense));
    for (let k = 0; k < n; k++) {
      const yaw = k / n * Math.PI * 2 + r() * 0.6 + l * 0.7;
      cards.push(card(reach * (0.8 + r() * 0.4), reach * 0.75 + 0.35, reach * 0.28, yaw, y + (r() - 0.5) * 0.3, 0.05, 0.25 + r() * 0.15, snowy ? 0.6 + t * 0.4 : 0));
    }
  }
  // tip
  for (let k = 0; k < 3; k++) cards.push(card(1.1, 0.7, 0.05, k * 2.1, H - 0.6, 0, 1.2, snowy ? 1 : 0));
  const foliage = mergeGeometries(cards.map(clean), false)!;
  const bark = clean(trunk(H, Math.max(0.18, H * 0.018), 0.05, 8, 0.12));
  // far LOD: three stacked cones
  const cones: G[] = [];
  for (let k = 0; k < 3; k++) { const c = new THREE.ConeGeometry((1 - k * 0.28) * H * 0.26, H * (0.5 - k * 0.08), 7, 1, true); c.translate(0, base + H * 0.25 + k * H * 0.22, 0); const s = new Float32Array(c.attributes.position.count).fill(snowy ? 0.45 : 0); c.setAttribute('snow', new THREE.Float32BufferAttribute(s, 1)); cones.push(c); }
  const farFoliage = mergeGeometries(cones.map(clean), false)!;
  const farBark = clean(new THREE.CylinderGeometry(0.06, H * 0.018, H * 0.4, 5, 1, true).translate(0, H * 0.2, 0));
  return { bark, foliage, farBark, farFoliage, height: H, radius: Math.max(0.2, H * 0.02) };
}

export function redwood(seed: number, H: number): TreeGeo {
  const r = mulberry32(seed);
  const cards: G[] = [];
  const start = H * 0.45;
  for (let l = 0; l < 16; l++) {
    const t = l / 15, y = start + (H - start) * t;
    const reach = (1 - t * 0.85) * 4.2 + 0.6;
    for (let k = 0; k < 6; k++) cards.push(card(reach, reach * 0.8, reach * 0.45, k * 1.05 + l * 0.9 + r() * 0.5, y, 0.6 * (1 - t), 0.2, 0));
  }
  const foliage = mergeGeometries(cards.map(clean), false)!;
  const bark = clean(trunk(H, 1.25, 0.25, 12, 0.9));
  const farFoliage = clean(new THREE.ConeGeometry(4.2, H - start, 8, 1, true).translate(0, start + (H - start) / 2, 0));
  const farBark = clean(new THREE.CylinderGeometry(0.4, 1.3, start + 2, 6, 1, true).translate(0, (start + 2) / 2, 0));
  return { bark, foliage, farBark, farFoliage, height: H, radius: 1.3 };
}

export function broadleaf(seed: number, H: number): TreeGeo {
  const r = mulberry32(seed);
  const barks: G[] = [clean(trunk(H * 0.55, 0.32, 0.18, 8, 0.25))];
  const cards: G[] = [];
  const clusters: [number, number, number, number][] = [[0, H * 0.72, 0, 2.6]];
  for (let k = 0; k < 4; k++) {
    const a = k * 1.6 + r(), len = 2.6 + r();
    const ex = Math.cos(a) * len, ez = Math.sin(a) * len, ey = H * 0.55 + 1.2 + r() * 1.5;
    const br = new THREE.CylinderGeometry(0.07, 0.16, len * 1.25, 6, 1, true);
    const dir = new THREE.Vector3(ex, ey - H * 0.5, ez).normalize();
    br.translate(0, len * 0.62, 0); br.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)); br.translate(0, H * 0.5, 0);
    barks.push(clean(br));
    clusters.push([ex, ey + 0.8, ez, 1.9 + r() * 0.6]);
  }
  for (const [cx, cy, cz, cr] of clusters) {
    for (let k = 0; k < 26; k++) {
      const g = new THREE.PlaneGeometry(1.9, 1.9);
      const u = r() * 2 - 1, th = r() * 6.28, rr = Math.cbrt(r()) * cr;
      const px = Math.sqrt(1 - u * u) * Math.cos(th) * rr, py = u * rr * 0.75, pz = Math.sqrt(1 - u * u) * Math.sin(th) * rr;
      g.rotateX(r() * 3); g.rotateY(r() * 6); g.translate(cx + px, cy + py, cz + pz);
      const n = g.attributes.normal as THREE.BufferAttribute;
      const v = new THREE.Vector3(px, py + cr * 0.5, pz).normalize();
      for (let i = 0; i < n.count; i++) n.setXYZ(i, v.x, v.y, v.z);
      cards.push(clean(g));
    }
  }
  const farFoliage = clean(new THREE.IcosahedronGeometry(3.6, 1).scale(1.15, 0.85, 1.15).translate(0, H * 0.75, 0));
  return { bark: mergeGeometries(barks, false)!, foliage: mergeGeometries(cards, false)!, farBark: clean(new THREE.CylinderGeometry(0.15, 0.3, H * 0.6, 5, 1, true).translate(0, H * 0.3, 0)), farFoliage, height: H, radius: 0.35 };
}

export function saguaro(seed: number, H: number): TreeGeo {
  const r = mulberry32(seed);
  const parts: G[] = [];
  const ribbed = (h: number, rad: number) => {
    const g = new THREE.CylinderGeometry(rad * 0.85, rad, h, 24, 8, false);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), l = Math.hypot(x, z); const rib = 1 + 0.08 * Math.cos(a * 12); const top = p.getY(i) > h / 2 - 0.01 ? 0.6 : 1; p.setXYZ(i, x / (l || 1) * l * rib * top, p.getY(i), z / (l || 1) * l * rib * top); }
    g.computeVertexNormals(); return g;
  };
  parts.push(clean(ribbed(H, 0.38).translate(0, H / 2, 0)));
  const arms = 1 + Math.floor(r() * 3);
  for (let k = 0; k < arms; k++) {
    const a = r() * 6.28, y = H * (0.35 + r() * 0.25), out = 0.9 + r() * 0.3, up = H * (0.25 + r() * 0.2);
    const elbow = new THREE.CylinderGeometry(0.24, 0.26, out, 16).rotateZ(Math.PI / 2).translate(out / 2, y, 0).rotateY(a);
    const vert = ribbed(up, 0.26).translate(out, y + up / 2, 0).rotateY(a);
    parts.push(clean(elbow), clean(vert));
  }
  const g = mergeGeometries(parts, false)!;
  return { bark: g, foliage: new THREE.BufferGeometry(), farBark: g, farFoliage: new THREE.BufferGeometry(), height: H, radius: 0.4 };
}
