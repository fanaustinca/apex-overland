// Row-parallel generation stages: raw noise terrain, and the light bake + splat once the heightmap is final.
import { baseRows } from './gen';
import { shadeRows } from './finish';

self.onmessage = (e: MessageEvent) => {
  const m = e.data, post = (d: unknown, t: Transferable[]) => (self as unknown as Worker).postMessage(d, t);
  if (m.stage === 'base') { const h = baseRows(m.j0, m.j1); post({ h }, [h.buffer]); }
  else { const r = shadeRows(m.w, m.j0, m.j1); post(r, [r.bake.buffer, r.ctrl.buffer, r.surface.buffer]); }
};
