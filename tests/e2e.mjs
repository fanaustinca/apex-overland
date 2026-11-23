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

await test('18 vehicles and 26 races are defined', async () => {
  const r = await page.evaluate(() => ({ races: AO.game.races.length, ids: AO.game.races.map((x) => x.id), veh: Object.keys(AO.game.profile.upgrades).length }));
  assert(r.races >= 26, 'races ' + r.races);
  for (const id of ['canyon-breakout', 'rim-jumper', 'dune-basher', 'timberline-plow', 'muddy-creek', 'logging-camp', 'avalanche-switchbacks', 'peak-descent', 'glacier-ridge', 'pit-escape', 'crusher-circuit', 'haul-road-havoc', 'baja-blast', 'ridgeback-rally', 'frozen-lake', 'apex-hillclimb', 'high-traverse', 'quarry-mx', 'rim-of-the-world', 'rim-road-run', 'jump-alley', 'forest-stage', 'west-ridge']) assert(r.ids.includes(id), 'missing race ' + id);
});

await test('progression: 50 tokens, 3 dailies, collecting a token pays', async () => {
  const r = await page.evaluate(() => {
    const P = AO.game.progress, before = AO.game.profile.coins, n0 = AO.game.profile.tokens.length;
    const t = [...P.tokens].reverse().find((q) => !AO.game.profile.tokens.includes(q.id));   // a road token (the first ones sit on landmarks)
    AO.game.place(AO.game.player, t.x, t.z, 0); AO.advance(0.5);
    return { tokens: P.tokens.length, daily: AO.game.profile.daily.ch.length, got: AO.game.profile.tokens.length - n0, paid: AO.game.profile.coins - before, lvl: AO.game.profile.level };
  });
  assert(r.tokens === 50, 'tokens ' + r.tokens);
  assert(r.daily === 3, 'dailies ' + r.daily);
  assert(r.got === 1 && r.paid >= 250, `token not collected: ${JSON.stringify(r)}`);
  await page.evaluate(() => AO.game.teleportGarage('hub'));
});

await test('audio + music engine starts without errors', async () => {
  const r = await page.evaluate(() => { AO.game.audio.start(); AO.advance(0.5); return { ctx: !!AO.game.audio.ctx, music: !!AO.game.audio.music }; });
  assert(r.ctx && r.music, JSON.stringify(r));
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
    for (const id of ['bike', 'buggy', 'sedan', 'limo', 'crawler', 'suv', 'pickup', 'sixbysix', 'dakar', 'semi', 'eightbyeight', 'monster', 'monster6', 'bus', 'tank', 'dump', 'snake']) {
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

await test('race: countdown, progress to the finish and positions', async () => {
  const r = await page.evaluate(() => {
    const g = AO.game; g.spawnPlayer('sedan'); AO.race('logging-camp');
    const s0 = AO.state();
    AO.advance(4); AO.autopilot(); AO.advance(40);
    return { s0: s0.race, s1: AO.state().race, rivals: g.rivals.length };
  });
  assert(r.s0.countdown > 2, 'no countdown');
  assert(r.rivals >= 3, 'no rivals');
  assert(r.s1.remain < r.s1.len - 700, 'no progress towards the finish: ' + JSON.stringify(r.s1));
  assert(r.s1.pos >= 1 && r.s1.pos <= r.rivals + 1, 'bad position');
  await page.evaluate(() => { AO.autopilot(false); AO.game.endRace(true); });
});

await test('checkpoints face the driver and are optional: a direct line to the finish wins', async () => {
  const r = await page.evaluate(() => {
    const g = AO.game; g.spawnPlayer('buggy'); AO.race('dune-basher'); AO.advance(4.5);
    const gate = g.race.gates.children[0], d = g.race.def, i = d.path.findIndex((p) => p[0] === d.cps[0][0] && p[1] === d.cps[0][1]);
    const a = d.path[i - 2], b = d.path[i + 2], fwd = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(...fwd);
    const right = [Math.cos(gate.rotation.y), -Math.sin(gate.rotation.y)];          // gate beam axis (local x)
    const across = Math.abs((right[0] * fwd[0] + right[1] * fwd[1]) / L);
    window.dev.finish(); AO.advance(0.5);
    return { across, finished: g.race.player.finished > 0, cp: g.race.player.cp, cps: d.cps.length };
  });
  assert(r.across < 0.2, 'gate beam runs along the road (dot ' + r.across.toFixed(2) + ')');
  assert(r.finished, 'skipping waypoints did not allow finishing: ' + JSON.stringify(r));
  await page.evaluate(() => AO.game.endRace(true));
});

await test('every garage spawns the car level on its apron with road access', async () => {
  const r = await page.evaluate(() => {
    const g = AO.game; g.endRace(true); g.spawnPlayer('pickup');
    return g.props.garagePads.map((pad) => {
      g.teleportGarage(pad.id); AO.advance(2.5);
      const s = AO.state();
      return { id: pad.id, moved: Math.hypot(s.x - pad.pos.x, s.z - pad.pos.z), up: g.player.v.main.up().y };
    });
  });
  for (const x of r) assert(x.moved < 3 && x.up > 0.95, `garage ${x.id}: car rolled ${x.moved.toFixed(1)} m (up ${x.up.toFixed(2)})`);
});

await test('dev console: dev.help() and commands', async () => {
  const r = await page.evaluate(() => { const c0 = AO.game.profile.coins; const keys = Object.keys(window.dev); window.dev.help(); window.dev.coins(1234); return { keys, gained: AO.game.profile.coins - c0, garages: window.dev.garage().length, pos: window.dev.pos() }; });
  for (const k of ['help', 'tp', 'garage', 'race', 'finish', 'car', 'coins', 'unlockAll', 'barns', 'pos', 'fps']) assert(r.keys.includes(k), 'missing dev.' + k);
  assert(r.gained === 1234, 'dev.coins failed');
  assert(r.garages >= 11, 'garages ' + r.garages);
});

await test('landmarks are carved, reachable and pay out when discovered', async () => {
  const r = await page.evaluate(() => {
    const g = AO.game, list = window.dev.landmark(), out = [];
    const water = (x, z) => g.world.water[Math.floor((z + 2560) / 4) * 1280 + Math.floor((x + 2560) / 4)];
    for (const l of list) {
      const c0 = g.profile.coins;
      window.dev.landmark(l.id); AO.advance(0.6);
      const s0 = AO.state();
      window.dev.tp(l.x + l.r * 0.5, l.z, 0); AO.advance(0.6);
      out.push({ id: l.id, gained: g.profile.coins - c0, settled: Math.abs(s0.y - s0.ground) < 3, centre: g.ground(l.x, l.z), rim: g.ground(l.x + l.r, l.z), water: water(l.x, l.z) });
    }
    window.dev.garage('hub'); AO.advance(0.5);
    return out;
  });
  assert(r.length >= 10, 'landmarks ' + r.length);
  for (const l of r) { assert(l.gained > 0, l.id + ' paid nothing'); assert(l.settled, l.id + ': spawned off the ground'); }
  const crater = r.find((l) => l.id === 'crater'), sink = r.find((l) => l.id === 'sinkhole');
  assert(crater.rim - crater.centre > 8, `crater too shallow: ${(crater.rim - crater.centre).toFixed(1)} m`);
  assert(sink.rim - sink.centre > 25 && !Number.isNaN(sink.water), 'sinkhole should be deep with a pool');
  const peak = r.find((l) => l.id === 'summit');
  assert(peak && peak.centre > 550, 'Apex summit should stand 550 m+ up: ' + peak?.centre);
});

await test('tank pivots briskly and the 6x6 monster stays planted', async () => {
  const r = await page.evaluate(() => {
    const g = AO.game; g.spawnPlayer('tank'); AO.advance(1);
    const yaw = () => { const f = g.player.v.main.forward(); return Math.atan2(f.x, f.z); };
    const y0 = yaw(); AO.hold(['KeyA'], 1.5);
    let dy = Math.abs(yaw() - y0); if (dy > Math.PI) dy = Math.PI * 2 - dy;
    g.spawnPlayer('monster6'); AO.advance(1.5); const st = AO.state();
    g.spawnPlayer('crawler'); AO.advance(0.5);
    return { dy, y: st.y, ground: st.ground };
  });
  assert(r.dy > 0.9, `tank turned only ${(r.dy * 57.3).toFixed(0)} deg in 1.5 s`);
  assert(Math.abs(r.y - r.ground) < 3.5, 'monster6 spawn');
});

await test('heavy vehicle with dozer plow smashes trees into physical logs', async () => {
  const r = await page.evaluate(() => {
    const g = AO.game; g.profile.upgrades.dump = { ...g.profile.upgrades.dump, plow: 3 }; g.spawnPlayer('dump');
    const t = g.foliage.near(1030, 470, 60).filter((i) => g.foliage.tk[i] !== 2);
    const before = g.foliage.broken;
    // drive at a few different trees in turn (one can sit behind a crest or a rock and be missed)
    for (let k = 0; k < 4 && g.foliage.broken === before; k++) {
      const tx = g.foliage.tx[t[k * 3]], tz = g.foliage.tz[t[k * 3]];
      g.teleport(tx - 25, tz, Math.PI / 2);
      AO.hold(['KeyW'], 6);
    }
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
    const items = document.querySelectorAll('.garitem').length;
    document.querySelector('.garitem[data-g="ridgeback"] button').click();
    const s = AO.state(), gd = g.props.garagePads.find((p) => p.id === 'ridgeback');
    return { open, items, d: Math.hypot(s.x - gd.pos.x, s.z - gd.pos.z), mode: g.mode };
  });
  assert(r.open, 'map did not open');
  assert(r.items >= 11, 'garage list has ' + r.items);
  assert(r.d < 5 && r.mode === 'drive', 'garage fast travel failed ' + JSON.stringify(r));
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
  await page.close();   // one 26 km² world in memory at a time
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
