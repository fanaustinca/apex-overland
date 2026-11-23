// GPU frame-cost bench: GPU=1 node tests/bench.mjs  → ms/frame per preset and per feature toggle in a forest + a hub view
import { launch, openPage, serve } from './harness.mjs';
const srv = await serve(); const browser = await launch();
const { page } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 1920, height: 1080 });
const res = await page.evaluate(async () => {
  const g = AO.game, gl = g.gfx.renderer.getContext(), px = new Uint8Array(4);
  const views = { forest: [1250, 6, 300, 1350, 2, 420], hub: [-60, 5, 80, 0, 2, 0], mountain: [-150, 4, -1250, -150, 60, -1500] };
  const time = (n = 20) => { AO.render(3); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t = performance.now(); for (let i = 0; i < n; i++) g.render(1 / 60); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return (performance.now() - t) / n; };
  const out = [];
  for (const [vn, v] of Object.entries(views)) {
    AO.camG(...v);
    const row = [vn];
    for (const p of ['potato', 'medium', 'high', 'ultra']) { dev.preset(p); AO.camG(...v); row.push(`${p} ${time().toFixed(1)}ms ${g.gfx.renderer.info.render.calls}dc ${(g.gfx.renderer.info.render.triangles / 1e6).toFixed(1)}Mt`); }
    dev.preset('high'); AO.camG(...v);
    for (const k of ['ssao', 'bloom', 'godrays']) { const s = { ...g.gfx.s, [k]: !g.gfx.s[k] }; g.applySettings(s); AO.camG(...v); row.push(`high ${k}=${s[k]} ${time().toFixed(1)}`); dev.preset('high'); }
    for (const [k, val] of [['shadows', 0], ['foliage', 0.4], ['aa', 'fxaa'], ['terrain', 1], ['drawDist', 0.5]]) { const s = { ...g.gfx.s, [k]: val }; g.applySettings(s); AO.camG(...v); row.push(`high ${k}=${val} ${time().toFixed(1)}`); dev.preset('high'); }
    out.push(row.join('\n   '));
  }
  return out.join('\n');
});
console.log(res);
await browser.close(); process.exit(0);
