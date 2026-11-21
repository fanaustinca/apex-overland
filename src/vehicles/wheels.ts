// Tyres (lathe-turned carcass + real tread lugs per compound) and rims per tier.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Compound } from './defs';

const cache = new Map<string, { tire: THREE.BufferGeometry; rim: THREE.BufferGeometry; disc: THREE.BufferGeometry }>();

function tireGeo(R: number, W: number, comp: Compound, chunky: boolean): THREE.BufferGeometry {
  // carcass profile in (radius, axial) -> lathe around Y, then rotate so the axle is X
  const r0 = R * 0.64, hw = W / 2, sh = Math.min(R * 0.12, hw * 0.45);
  const prof: THREE.Vector2[] = [];
  prof.push(new THREE.Vector2(r0, -hw * 0.9));
  for (let k = 0; k <= 6; k++) { const a = -Math.PI / 2 + k / 6 * Math.PI / 2; prof.push(new THREE.Vector2(R - sh + Math.cos(a) * sh, -hw + sh + Math.sin(a) * sh)); }
  for (let k = 0; k <= 6; k++) { const a = k / 6 * Math.PI / 2; prof.push(new THREE.Vector2(R - sh + Math.cos(a) * sh, hw - sh + Math.sin(a) * sh)); }
  prof.push(new THREE.Vector2(r0, hw * 0.9));
  const seg = 48;
  const lathe = new THREE.LatheGeometry(prof, seg);
  // UVs: u around, v across -> scale for the tread normal map
  const uv = lathe.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(2, Math.round(R * 6)), uv.getY(i));
  const parts: THREE.BufferGeometry[] = [lathe];
  // tread lugs, built in lathe space: Y = axle, tread circle in the XZ plane
  const n = Math.max(14, Math.min(44, Math.round(R * (comp === 'sand' ? 20 : comp === 'snow' ? 34 : 28))));
  const lugH = Math.min(0.06, comp === 'mud' ? R * 0.06 : comp === 'sand' ? R * 0.08 : comp === 'snow' ? R * 0.022 : R * 0.03);
  const put = (g: THREE.BufferGeometry, a: number) => { g.rotateY(a); parts.push(g); };
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    if (comp === 'sand') {
      const g = new THREE.BoxGeometry(lugH * 2, W * 0.92, Math.min(0.12, R * 0.06)); g.translate(R - lugH * 0.4, 0, 0); put(g, a);
    } else if (comp === 'snow') {
      for (const off of [-0.3, 0, 0.3]) { const g = new THREE.CylinderGeometry(R * 0.016, R * 0.02, lugH * 2.4, 5); g.rotateZ(Math.PI / 2); g.translate(R + lugH * 0.5, off * W + (i % 2 ? 0.08 * W : 0), 0); put(g, a); }
      const g = new THREE.BoxGeometry(lugH * 2.2, W * 0.32, R * 0.12); g.translate(R - lugH * 0.3, (i % 2 ? 0.25 : -0.25) * W, 0); put(g, a);
    } else {
      const big = comp === 'mud' || chunky;
      const lw = big ? W * 0.38 : W * 0.3, ll = Math.min(0.22, R * (big ? 0.16 : 0.12));
      for (const side of [-1, 1]) {
        const g = new THREE.BoxGeometry(lugH * 2, lw, ll);
        g.rotateX(side * (big ? 0.35 : 0.2));
        g.translate(R - lugH * 0.35, side * (W / 2 - lw / 2 + (big ? 0.015 : -0.01)), 0);
        put(g, a + (side > 0 ? 0 : Math.PI / n));
      }
      if (!big) { const g = new THREE.BoxGeometry(lugH * 1.6, W * 0.2, ll * 0.8); g.translate(R - lugH * 0.4, 0, 0); put(g, a + Math.PI / n); }
    }
  }
  const norm = parts.map((g) => { const x = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k); return x; });
  const merged = mergeGeometries(norm, false)!;
  merged.rotateZ(Math.PI / 2);   // axle along X
  merged.computeBoundingSphere();
  return merged;
}

function rimGeo(R: number, W: number, tier: number): THREE.BufferGeometry {
  const rr = R * 0.62, parts: THREE.BufferGeometry[] = [];
  const barrel = new THREE.CylinderGeometry(rr, rr, W * 0.86, 32, 1, true); parts.push(barrel);
  const dish = tier >= 4 ? W * 0.3 : W * 0.12;
  const face = new THREE.CylinderGeometry(rr * 0.98, rr * 0.98, 0.02, 32); face.translate(0, W * 0.43 - dish, 0); parts.push(face);
  const lip = new THREE.TorusGeometry(rr, R * 0.025, 6, 32); lip.rotateX(Math.PI / 2); lip.translate(0, W * 0.43, 0); parts.push(lip);
  const spokes = [5, 6, 8, 10][tier - 1];
  for (let i = 0; i < spokes; i++) {
    const a = i / spokes * Math.PI * 2;
    const s = new THREE.BoxGeometry(rr * 0.18, 0.04 + dish * 0.6, rr * 0.92); s.translate(0, W * 0.44 - dish * 0.5, rr * 0.48); s.rotateY(a); parts.push(s);
  }
  const hub = new THREE.CylinderGeometry(rr * 0.24, rr * 0.28, 0.12 + dish, 16); hub.translate(0, W * 0.45 - dish * 0.5, 0); parts.push(hub);
  if (tier >= 3) {   // beadlock ring with bolts
    const ring = new THREE.TorusGeometry(rr * 0.97, R * 0.035, 6, 36); ring.rotateX(Math.PI / 2); ring.translate(0, W * 0.45, 0); parts.push(ring);
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; const b = new THREE.CylinderGeometry(0.012, 0.012, 0.05, 6); b.translate(Math.cos(a) * rr * 0.97, W * 0.47, Math.sin(a) * rr * 0.97); parts.push(b); }
  }
  // inner face mirrored so the rim reads from both sides
  const norm = parts.map((g) => { const x = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k); if (!x.attributes.uv) x.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2)); return x; });
  const g = mergeGeometries(norm, false)!;
  g.rotateZ(-Math.PI / 2);   // face points +X (outboard on the left side)
  return g;
}

export function wheelGeos(R: number, W: number, comp: Compound, tier: number, chunky = false) {
  const key = `${R.toFixed(3)}:${W.toFixed(3)}:${comp}:${tier}:${chunky}`;
  let g = cache.get(key);
  if (!g) {
    const disc = new THREE.CylinderGeometry(R * 0.42, R * 0.42, 0.04, 24); disc.rotateZ(Math.PI / 2);
    g = { tire: tireGeo(R, W, comp, chunky), rim: rimGeo(R, W, tier), disc };
    cache.set(key, g);
  }
  return g;
}
