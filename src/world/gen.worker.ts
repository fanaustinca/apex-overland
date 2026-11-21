import { generateWorld } from './finish';

self.onmessage = () => {
  const w = generateWorld((s) => (self as unknown as Worker).postMessage({ log: s }));
  const { height, biome, water, wet, rivers, roads, bridges, roadMask, roadKind, normals, ctrl, bake, surface } = w;
  const roadsOut = roads.map((r) => ({ ...r, h: Array.from(r.h) }));
  (self as unknown as Worker).postMessage({ world: { height, biome, water, wet, rivers, roads: roadsOut, bridges, roadMask, roadKind, normals, ctrl, bake, surface } },
    [height.buffer, biome.buffer, water.buffer, wet.buffer, roadMask.buffer, roadKind.buffer, normals.buffer, ctrl.buffer, bake.buffer, surface.buffer]);
};
