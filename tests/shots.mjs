// Visual verification: boots the production build in headless Chromium (GPU=1 for the real GPU locally,
// SwiftShader otherwise), drives through every required scenario and saves screenshots to ./screenshots/.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import fs from 'node:fs';

const W = +(process.env.W || 1600), H = +(process.env.H || 900);
const quality = process.env.QUALITY || 'high';
const srv = await serve();
const port = srv.address().port;
const browser = await launch();
const report = { shots: [], errors: [], fps: {} };
const ignore = /CONTEXT_LOST|Context Lost|Context Restored|favicon|AudioContext|GPU stall|GL Driver/i;

async function session(q, fn) {
  const { page, errors } = await openPage(browser, `http://127.0.0.1:${port}/?test&quality=${q}`, { width: W, height: H });
  page.on('console', (m) => { if (m.type() === 'log' && m.text().startsWith('[shot]')) console.log(m.text()); });
  await page.evaluate(() => { AO.game.ui.root.querySelector('.toasts').style.display = 'none'; });
  await fn(page);
  report.errors.push(...errors.filter((e) => !ignore.test(e)));
  await page.close();
}
async function shot(page, name, js = '', settle = 3) {
  if (js) await page.evaluate(js);
  await page.evaluate((n) => AO.render(n), settle);
  const file = path.join(shots, name + '.png');
  await page.screenshot({ path: file });
  report.shots.push(name);
  console.log('  📸', name);
}
async function fps(page, label, sec = 3) {
  const r = await page.evaluate(async (s) => {
    AO.game.manual = false;
    const t0 = performance.now(); let n = 0;
    await new Promise((res) => { const f = () => { n++; if (performance.now() - t0 < s * 1000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    AO.game.manual = true;
    return { fps: n / ((performance.now() - t0) / 1000), ...AO.state() };
  }, sec);
  report.fps[label] = Math.round(r.fps);
  console.log(`  ⏱  ${label}: ${r.fps.toFixed(0)} fps, ${r.calls} draw calls, ${(r.tris / 1e6).toFixed(2)}M tris`);
  return r;
}

console.log('APEX OVERLAND visual verification (' + quality + ')');
await session(quality, async (page) => {
  await page.evaluate(() => { AO.game.manual = true; });
  // 1. Central hub + garage UI with modular upgrades
  await shot(page, '01-hub-overview', `AO.camG(120, 45, 150, -60, 5, 30)`);
  await shot(page, '02-garage-upgrades', `AO.game.profile.coins = 250000; AO.game.ui.openGarage(); for (const k of ['engine','suspension','tires']) AO.game.profile.upgrades[AO.game.player.def.id][k] = 3; AO.game.player.up.plow = 1; AO.game.spawnPlayer('crawler'); AO.game.ui.openGarage(); AO.advance(0.6);`);
  await shot(page, '03-garage-dump-truck-plow', `AO.game.profile.owned.push('dump'); Object.assign(AO.game.profile.upgrades.dump = {...AO.game.profile.upgrades.crawler}, {engine:4, suspension:3, tires:3, plow:3, frame:3}); AO.game.spawnPlayer('dump'); AO.game.ui.openGarage(); AO.game.camYaw = 0.6; AO.advance(0.6);`);
  await page.evaluate(() => AO.game.ui.closePanel());
  // 2. biomes + transition
  await shot(page, '04-biome-desert-canyon', `AO.camG(-60, 40, 1080, 260, 6, 1250)`);
  await shot(page, '05-biome-dense-forest', `AO.camG(905, 6, 30, 1060, 3, -60)`);
  await shot(page, '06-biome-snowy-mountain', `AO.camG(-60, 40, -470, -150, 120, -1300)`);
  await shot(page, '07-biome-industrial-quarry', `AO.camG(-880, 30, -40, -1250, -20, -140)`);
  await shot(page, '08-transition-forest-to-desert', `AO.camG(700, 60, 420, 900, 20, 900)`);
  // 3. vehicles: lineup, dump truck plowing trees, the snake articulating
  await shot(page, '09-vehicle-lineup', `AO.lineup({tires:3, compound:'mud', suspension:3, engine:3, frame:2, plow:2, nitro:1}, ['bike','buggy','sedan','limo','crawler','suv','pickup']); AO.camG(-4, 3.2, 52, 9, 1, 40)`);
  await shot(page, '10-vehicle-lineup-heavy', `AO.lineup({tires:2, suspension:2, engine:2}, ['sixbysix','dakar','semi','eightbyeight','monster','bus','tank']); AO.camG(-6, 6, 60, 17, 1.6, 38)`);
  await page.evaluate(() => AO.game.gfx.scene.getObjectByName('lineup')?.removeFromParent());
  const plow = await page.evaluate(() => {
    const g = AO.game;
    g.spawnPlayer('dump');
    // find a dense stand of trees east of the forest road and drive the plow through it
    g.teleport(1015, 470, Math.PI * 0.62);
    g.player.controls.throttle = 1;
    const before = g.foliage.broken;
    for (let i = 0; i < 60 * 7; i++) { g.input.keys.add('KeyW'); g.update(1 / 60); }
    g.input.keys.delete('KeyW');
    for (let i = 0; i < 30; i++) g.update(1 / 60);
    return { broken: g.foliage.broken - before, logs: g.foliage.logs.length };
  });
  console.log('  🌲 dump truck plowed', plow.broken, 'trees →', plow.logs, 'logs');
  await shot(page, '11-dump-truck-plowing-trees', `(() => { const g = AO.game, p = g.player.v.position(), f = g.player.v.main.forward(); AO.cam(p.x - f.x * 16 + f.z * 14, p.y + 9, p.z - f.z * 16 - f.x * 14, p.x + f.x * 4, p.y + 1, p.z + f.z * 4); })()`);
  const snake = await page.evaluate(() => {
    const g = AO.game; g.profile.owned.push('snake'); g.spawnPlayer('snake'); g.teleport(-650, 1440, 1.2);
    for (let i = 0; i < 60 * 3.5; i++) { g.input.keys.add('KeyW'); if (i > 60) g.input.keys.add('KeyA'); g.update(1 / 60); }
    g.input.keys.delete('KeyW'); g.input.keys.delete('KeyA');
    const yaws = g.player.v.parts.map((p) => { const f = p.forward(); return Math.atan2(f.x, f.z); });
    return { yaws, kmh: g.player.v.kmh() };
  });
  console.log('  🐍 snake module headings', snake.yaws.map((y) => (y * 57.3).toFixed(0)).join('°, ') + '°');
  await shot(page, '12-the-snake-12x12-articulating', `(() => { const g = AO.game, p = g.player.v.parts[1].body.translation(); AO.cam(p.x + 16, p.y + 9, p.z + 14, p.x, p.y + 0.5, p.z); })()`);
  // 4. map + race
  await page.evaluate(() => { AO.game.spawnPlayer('sedan'); AO.game.mode = 'drive'; AO.game.manual = true; });
  await shot(page, '13-teleport-map', `AO.game.ui.toggleMap(); AO.game.ui['hoverRace'] = 'canyon-breakout';`, 1);
  await page.evaluate(() => AO.game.ui.closePanel());
  await page.evaluate(() => { AO.race('canyon-breakout'); AO.advance(4.2); AO.autopilot(); AO.advance(9); });
  await shot(page, '14-race-canyon-breakout', `AO.game.manual = true; AO.advance(0.05);`);
  const rs = await page.evaluate(() => { AO.advance(18); return AO.state(); });
  console.log('  🏁 race state', JSON.stringify(rs.race), 'pos', rs.race?.pos);
  await shot(page, '15-race-canyon-breakout-cliff', `AO.advance(0.05)`);
  await fps(page, quality + ' race');
});
// 5. graphics comparison: Low-Poly vs Ultra from the same viewpoint
for (const q of ['potato', 'ultra']) {
  await session(q, async (page) => {
    await page.evaluate(() => { AO.game.manual = true; AO.game.spawnPlayer('pickup'); AO.game.teleport(-260, 985, 2.2); AO.advance(1); });
    await shot(page, `16-graphics-${q === 'potato' ? 'low-poly' : 'ultra-realism'}`, `(() => { const p = AO.game.player.v.position(); AO.cam(p.x - 14, p.y + 6, p.z - 9, p.x + 40, p.y - 6, p.z + 60); })()`);
    await fps(page, q);
  });
}
fs.writeFileSync(path.join(shots, 'report.json'), JSON.stringify(report, null, 2));
console.log('\nconsole errors:', report.errors.length ? report.errors.slice(0, 10).join('\n') : 'none');
console.log('fps:', JSON.stringify(report.fps));
await browser.close(); srv.close();
process.exit(report.errors.length ? 1 : 0);
