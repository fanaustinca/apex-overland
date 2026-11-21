// The sequential middle of world generation: erosion, valleys, roads + earthworks, rivers, normals.
import { generateWorld } from './finish';

self.onmessage = (e: MessageEvent) => {
  const w = generateWorld((s) => (self as unknown as Worker).postMessage({ log: s }), e.data.rows, false);
  const { height, water, wet, rivers, roads, bridges, roadMask, roadKind, normals } = w;
  const roadsOut = roads.map((r) => ({ ...r, h: Array.from(r.h), bridged: Array.from(r.bridged) }));
  (self as unknown as Worker).postMessage({ world: { height, water, wet, rivers, roads: roadsOut, bridges, roadMask, roadKind, normals } },
    [height.buffer, water.buffer, wet.buffer, roadMask.buffer, roadKind.buffer, normals.buffer]);
};
