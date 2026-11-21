// Geometry helpers for procedural vehicle construction.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type P = [number, number];
const tmpV = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

export function mesh(g: THREE.BufferGeometry, m: THREE.Material, parent?: THREE.Object3D): THREE.Mesh {
  const o = new THREE.Mesh(g, m); o.castShadow = true; o.receiveShadow = true; parent?.add(o); return o;
}
export function box(p: THREE.Object3D, m: THREE.Material, w: number, h: number, l: number, x: number, y: number, z: number, r = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const g = r > 0 ? new RoundedBoxGeometry(w, h, l, 2, Math.min(r, w / 2, h / 2, l / 2) * 0.999) : new THREE.BoxGeometry(w, h, l);
  const o = mesh(g, m, p); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); return o;
}
/** Cylinder along an axis ('x' | 'y' | 'z'). */
export function cyl(p: THREE.Object3D, m: THREE.Material, r: number, len: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'y', seg = 20, r2 = r): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r2, r, len, seg);
  if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
  const o = mesh(g, m, p); o.position.set(x, y, z); return o;
}
export function sphere(p: THREE.Object3D, m: THREE.Material, r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): THREE.Mesh {
  const o = mesh(new THREE.SphereGeometry(r, 20, 14), m, p); o.position.set(x, y, z); o.scale.set(sx, sy, sz); return o;
}
/** Tube between two points. */
export function tube(p: THREE.Object3D, m: THREE.Material, a: THREE.Vector3 | number[], b: THREE.Vector3 | number[], r: number, seg = 10): THREE.Mesh {
  const A = Array.isArray(a) ? new THREE.Vector3(...a) : a, B = Array.isArray(b) ? new THREE.Vector3(...b) : b;
  const len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
  const o = mesh(g, m, p);
  o.position.copy(A).add(B).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(up, tmpV.copy(B).sub(A).normalize());
  return o;
}
/** Polyline of tubes with rounded joints. */
export function tubePath(p: THREE.Object3D, m: THREE.Material, pts: number[][], r: number) {
  for (let i = 0; i < pts.length - 1; i++) tube(p, m, pts[i], pts[i + 1], r);
  for (let i = 1; i < pts.length - 1; i++) sphere(p, m, r, pts[i][0], pts[i][1], pts[i][2]);
}

/** Side-profile body: outline in (z forward, y up), extruded across the width, with rounded bevels. */
export function profileBody(pts: P[], width: number, bevel: number, m: THREE.Material, parent: THREE.Object3D, yOff = 0, livery?: THREE.Material): THREE.Mesh {
  const s = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
  s.closePath();
  const depth = Math.max(0.01, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.7, bevelSegments: 4, curveSegments: 8 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2);
  g.computeVertexNormals();
  if (livery && g.groups.length >= 2) {
    // split: caps (flanks) get the livery, walls keep plain paint
    const [caps, walls] = [g.groups[0], g.groups[1]];
    const sub = (start: number, count: number, flip: boolean) => {
      const out = new THREE.BufferGeometry();
      for (const name of ['position', 'normal', 'uv'] as const) {
        const a = g.attributes[name] as THREE.BufferAttribute;
        const arr = (a.array as Float32Array).slice(start * a.itemSize, (start + count) * a.itemSize);
        out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
      }
      if (flip) { const p = out.attributes.position as THREE.BufferAttribute, uv = out.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) if (p.getX(i) > 0) uv.setX(i, -uv.getX(i)); }
      return out;
    };
    const cm = mesh(sub(caps.start, caps.count, true), livery, parent); cm.position.y = yOff;
    const wm = mesh(sub(walls.start, walls.count, false), m, parent); wm.position.y = yOff;
    return wm;
  }
  const o = mesh(g, m, parent); o.position.y = yOff; return o;
}

/** Window with a black rubber surround (slightly larger trim polygon behind the glass). */
export function windowTrim(pts: P[], width: number, glass: THREE.Material, trim: THREE.Material, parent: THREE.Object3D, yOff = 0) {
  const cz = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const grow = (k: number): P[] => pts.map(([z, y]) => { const dz = z - cz, dy = y - cy, l = Math.hypot(dz, dy) || 1; return [z + dz / l * k, y + dy / l * k]; });
  sidePanel(grow(0.05), width + 0.004, trim, parent, yOff);
  sidePanel(pts, width + 0.03, glass, parent, yOff);
}
/** Bottom edge with wheel-arch cut-outs. `top` runs rear-bottom -> over the roof -> front-bottom. */
export function withArches(top: P[], wheelZ: number[], archR: number, archY: number): P[] {
  const out = [...top];
  const zs = [...new Set(wheelZ.map((z) => +z.toFixed(3)))].sort((a, b) => b - a);
  for (const z of zs) {
    if (archR <= -archY) continue;
    const a0 = Math.asin(Math.max(-1, Math.min(1, -archY / archR)));
    for (let k = 0; k <= 14; k++) { const a = a0 + (Math.PI - 2 * a0) * k / 14; out.push([z + archR * Math.cos(a), archY + archR * Math.sin(a)]); }
  }
  return out;
}
/** Flat polygon (side window etc.) extruded across the full width so it shows on both flanks. */
export function sidePanel(pts: P[], width: number, m: THREE.Material, parent: THREE.Object3D, yOff = 0): THREE.Mesh {
  const s = new THREE.Shape(); pts.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y))); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false });
  g.translate(0, 0, -width / 2); g.rotateY(-Math.PI / 2);
  const o = mesh(g, m, parent); o.position.y = yOff; o.castShadow = false; return o;
}
/** Glass quad between two profile points spanning the width (windscreens). */
export function glassQuad(a: P, b: P, width: number, m: THREE.Material, parent: THREE.Object3D, yOff = 0, out = 0.012): THREE.Mesh {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const g = new THREE.PlaneGeometry(width, len * 0.94);
  const o = mesh(g, m, parent); o.castShadow = false;
  const mz = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 + yOff;
  const dz = (b[0] - a[0]) / len, dy = (b[1] - a[1]) / len;
  // normal points away from the body: perpendicular to the edge in the (z,y) plane, choose +y side
  let nz = -dy, ny = dz; if (ny < 0) { nz = -nz; ny = -ny; }
  o.position.set(0, my + ny * out, mz + nz * out);
  o.lookAt(o.position.x, o.position.y + ny, o.position.z + nz);
  o.rotateZ(0);
  // align plane's local Y with the edge direction
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, dy, dz).normalize(), new THREE.Vector3(0, ny, nz)));
  o.quaternion.copy(q);
  return o;
}

/** Bake all static meshes under `g` into one mesh per material (draw-call reduction). */
export function mergeStatic(g: THREE.Group): THREE.Group {
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const shadowless = new Set<THREE.Material>();
  const remove: THREE.Object3D[] = [];
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || o.userData.keep) return;
    const mat = m.material as THREE.Material;
    let geo = m.geometry.clone();
    if (geo.index) geo = geo.toNonIndexed();
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    if (!m.castShadow) shadowless.add(mat);
    (buckets.get(mat) ?? buckets.set(mat, []).get(mat)!).push(geo);
    remove.push(o);
  });
  for (const o of remove) o.parent?.remove(o);
  const out = new THREE.Group();
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const o = new THREE.Mesh(merged, mat);
    o.castShadow = !shadowless.has(mat); o.receiveShadow = true;
    out.add(o);
  }
  g.add(out);
  return g;
}

/** Orient + stretch a unit-Y object between two local points (suspension links, coilovers). */
export function stretch(o: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  const len = a.distanceTo(b);
  o.position.copy(a).add(b).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(up, tmpV.copy(b).sub(a).normalize());
  o.scale.set(1, Math.max(1e-3, len), 1);
}
