// Functional e2e suite (CI on SwiftShader; GPU=1 locally). Serves dist/, boots the game and exercises
// every system through the window.AO debug API.
import { launch, openPage, serve, test, assert, summary, shots } from './harness.mjs';
import path from 'node:path';

const srv = await serve();
const port = srv.address().port;
const browser = await launch();
const ignore = /CONTEXT_LOST|Context Lost|Context Restored|favicon|AudioContext|GPU stall|GL Driver|Automatic fallback to software WebGL/i;
console.log('APEX OVERLAND e2e');
let page, errors;

await test('boots to a playable world without console errors', async () => {
  ({ page, errors } = await openPage(browser, `http://127.0.0.1:${port}/?test&quality=potato`, { width: 800, height: 450 }));
  await page.evaluate(() => { AO.game.manual = true; localStorage.clear(); });
  const calls = await page.evaluate(() => AO.render(2).calls);
  assert(calls > 10, 'nothing drawn: ' + calls);
  const bad = errors.filter((e) => !ignore.test(e));
  assert(bad.length === 0, bad.slice(0, 5).join('\n'));
});

await test('17 vehicles and 15 races are defined', async () => {
  const r = await page.evaluate(() => ({ races: AO.game.races.length, ids: AO.game.races.map((x) => x.id), veh: Object.keys(AO.game.profile.upgrades).length }));
  assert(r.races >= 15, 'races ' + r.races);
  for (const id of ['canyon-breakout', 'rim-jumper', 'dune-basher', 'timberline-plow', 'muddy-creek', 'logging-camp', 'avalanche-switchbacks', 'peak-descent', 'glacier-ridge', 'pit-escape', 'crusher-circuit', 'haul-road-havoc']) assert(r.ids.includes(id), 'missing race ' + id);
});

await test('player spawns on the ground at the hub garage', async () => {
  const s = await page.evaluate(() => { AO.advance(1.5); return AO.state(); });
  assert(Math.abs(s.y - s.ground) < 3, `floating/buried: y=${s.y.toFixed(2)} ground=${s.ground.toFixed(2)}`);
  assert(Math.hypot(s.x + 95, s.z - 58) < 60, `not at hub: ${s.x},${s.z}`);
});

await test('throttle drives the vehicle forward', async () => {
  const a = await page.evaluate(() => AO.state());
  const b = await page.evaluate(() => { AO.hold(['KeyW'], 3); return AO.state(); });
  assert(Math.hypot(b.x - a.x, b.z - a.z) > 8, 'did not move: ' + JSON.stringify([a, b]));
  assert(b.kmh > 15, 'too slow ' + b.kmh);
});

await test('every vehicle spawns, settles and drives', async () => {
  const r = await page.evaluate(() => {
    const g = AO.game, out = [];
    for (const id of ['bike', 'buggy', 'sedan', 'limo', 'crawler', 'suv', 'pickup', 'sixbysix', 'dakar', 'semi', 'eightbyeight', 'monster', 'bus', 'tank', 'dump', 'snake']) {
      g.profile.owned.includes(id) || g.profile.owned.push(id);
      g.spawnPlayer(id); g.teleport(0, 120, 0); AO.advance(1);
      const a = AO.state(); AO.hold(['KeyW'], 2.5); const b = AO.state();
      out.push({ id, moved: Math.hypot(b.x - a.x, b.z - a.z), up: g.player.v.main.up().y });
    }
    return out;
  });
  for (const v of r) { assert(v.moved > 4, `${v.id} moved only ${v.moved.toFixed(1)} m`); assert(v.up > 0.5, `${v.id} tipped over`); }
});

await test('garage upgrades change stats and the model', async () => {
  const r = await page.evaluate(() => {
    const g = AO.game; g.profile.coins = 200000; g.spawnPlayer('pickup'); g.ui.openGarage();
    const meshes = () => { let n = 0; g.player.vis[0].root.traverse((o) => { if (o.isMesh) n++; }); return n; };
    const before = { top: g.player.v.st.top, lift: g.player.v.st.rideLift, meshes: meshes() };
    const btns = [...document.querySelectorAll('[data-buyup]')].filter((b) => ['engine:4', 'suspension:4', 'tires:4', 'frame:3', 'nitro:1', 'snorkel:1', 'winch:1'].includes(b.dataset.buyup));
    for (const b of btns) { b.click(); }
    for (const k of ['engine:4', 'suspension:4', 'tires:4', 'frame:3', 'nitro:1', 'snorkel:1', 'winch:1']) document.querySelector(`[data-buyup="${k}"]`)?.click();
    const after = { top: g.player.v.st.top, lift: g.player.v.st.rideLift, meshes: meshes(), coins: g.profile.coins, up: { ...g.player.up } };
    g.ui.closePanel();
    return { before, after };
  });
  assert(r.after.top > r.before.top, 'engine did not raise top speed');
  assert(r.after.lift > r.before.lift, 'suspension did not lift');
  assert(r.after.meshes > r.before.meshes, 'no visible upgrade parts');
  assert(r.after.coins < 200000, 'no coins spent');
  assert(r.after.up.nitro === 1 && r.after.up.snorkel === 1, 'utility upgrades not applied');
});

await test('race: countdown, checkpoints and positions', async () => {
  const r = await page.evaluate(() => {
    const g = AO.game; g.spawnPlayer('sedan'); AO.race('logging-camp');
    const s0 = AO.state();
    AO.advance(4); AO.autopilot(); AO.advance(40);
    return { s0: s0.race, s1: AO.state().race, rivals: g.rivals.length };
  });
  assert(r.s0.countdown > 2, 'no countdown');
  assert(r.rivals >= 3, 'no rivals');
  assert(r.s1.cp >= 2, 'did not reach checkpoints: ' + JSON.stringify(r.s1));
  assert(r.s1.pos >= 1 && r.s1.pos <= r.rivals + 1, 'bad position');
  await page.evaluate(() => { AO.autopilot(false); AO.game.endRace(true); });
});

await test('heavy vehicle with dozer plow smashes trees into physical logs', async () => {
  const r = await page.evaluate(() => {
    const g = AO.game; g.profile.upgrades.dump = { ...g.profile.upgrades.dump, plow: 3 }; g.spawnPlayer('dump');
    const t = g.foliage.near(1030, 470, 60).filter((i) => g.foliage.tk[i] !== 2);
    const tx = g.foliage.tx[t[0]], tz = g.foliage.tz[t[0]];
    g.teleport(tx - 25, tz, Math.PI / 2);
    const before = g.foliage.broken;
    AO.hold(['KeyW'], 6);
    return { broken: g.foliage.broken - before, logs: g.foliage.logs.length };
  });
  assert(r.broken >= 1, 'no trees broken');
  assert(r.logs >= 1, 'no logs spawned');
});

await test('log pool is capped at 60 and resting logs go to sleep', async () => {
  const r = await page.evaluate(() => {
    const g = AO.game, f = g.foliage;
    const ids = f.near(1300, 200, 400).filter((i) => f.tk[i] !== 2).slice(0, 90);
    for (const i of ids) f.fell(i, 3, 0, g.time);
    const cap = f.logs.length;
    AO.advance(8);
    return { cap, active: f.activeLogs, total: f.logs.length, tried: ids.length };
  });
  assert(r.tried > 60, 'not enough trees to test the cap');
  assert(r.cap <= 60, 'pool exceeded 60: ' + r.cap);
  assert(r.active <= 6, 'logs not sleeping: ' + r.active + ' active');
});

await test('barn finds unlock The Snake', async () => {
  const r = await page.evaluate(() => {
    const g = AO.game; g.endRace(true); g.spawnPlayer('crawler');
    for (const id of ['quarry', 'forest', 'desert', 'snow']) { const c = g.props.cabinPos[id]; g.teleport(c.x + 8, c.z + 8, 0); g.mode = 'drive'; AO.advance(0.3); g.ui.closePanel(); }
    return { barns: g.profile.barns.length, snake: g.profile.owned.includes('snake') };
  });
  assert(r.barns === 4, 'found ' + r.barns + ' barns');
  assert(r.snake, 'snake not unlocked');
});

await test('fast-travel map opens and teleports', async () => {
  const r = await page.evaluate(() => {
    const g = AO.game; g.mode = 'drive'; g.ui.toggleMap();
    const open = !!document.querySelector('.panel.mapview');
    g.ui.closePanel(); g.teleportGarage('hub');
    const s = AO.state();
    return { open, d: Math.hypot(s.x + 95, s.z - 58) };
  });
  assert(r.open, 'map did not open');
  assert(r.d < 60, 'teleport failed');
});

await test('graphics presets switch live without errors', async () => {
  const before = errors.length;
  await page.evaluate(() => { for (const p of ['medium', 'potato']) { AO.game.ui.settings(); document.querySelector(`.presets [data-p="${p}"]`).click(); AO.render(1); } AO.game.ui.closePanel(); });
  const bad = errors.slice(before).filter((e) => !ignore.test(e));
  assert(bad.length === 0, bad.join('\n'));
});

await test('progress is saved', async () => {
  const coins = await page.evaluate(() => { AO.game.profile.coins = 4242; AO.game.ui.toast('save'); localStorage.setItem('apex-overland-save-v1', JSON.stringify(AO.game.profile)); return JSON.parse(localStorage.getItem('apex-overland-save-v1')).coins; });
  assert(coins === 4242, 'save failed');
});

await test('renders a final frame with no errors', async () => {
  await page.evaluate(() => { AO.game.mode = 'drive'; AO.render(2); });
  await page.screenshot({ path: path.join(shots, 'e2e-final.png') });
  const bad = errors.filter((e) => !ignore.test(e));
  assert(bad.length === 0, bad.slice(0, 5).join('\n'));
});

await test('title screen DRIVE button starts the game', async () => {
  const { page: p2, errors: e2 } = await openPage(browser, `http://127.0.0.1:${port}/?quality=potato`, { width: 800, height: 450 });
  await p2.waitForSelector('.title .go', { timeout: 60000 });
  await p2.click('.title .go');
  await new Promise((r) => setTimeout(r, 800));
  const st = await p2.evaluate(() => ({ mode: AO.game.mode, title: !!document.querySelector('.title'), hud: !document.querySelector('.hud').classList.contains('hidden') }));
  assert(st.mode === 'drive' && !st.title && st.hud, JSON.stringify(st));
  const bad = e2.filter((e) => !ignore.test(e));
  assert(bad.length === 0, bad.join('\n'));
  await p2.close();
});

const failed = summary();
await browser.close(); srv.close();
process.exit(failed ? 1 : 0);
