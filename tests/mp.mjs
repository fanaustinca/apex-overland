// Local multiplayer check: two tabs over BroadcastChannel (?localnet), host + join + race together: GPU=1 node tests/mp.mjs
// Two tabs in one browser over the BroadcastChannel transport: host + join, see each other, race together.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
const srv = await serve(); const browser = await launch();
const url = `http://127.0.0.1:${srv.address().port}/?test&localnet&quality=${process.env.QQ || 'medium'}`;
const A = await openPage(browser, url, { width: 1280, height: 720 });
const B = await openPage(browser, url, { width: 1280, height: 720 });
const code = await A.page.evaluate(async () => { await AO.game.mp.host(); return AO.game.mp.code; });
await B.page.evaluate(async (c) => { AO.game.mp.setName('Bravo'); await AO.game.mp.join(c); }, code);
// put B next to A, let both run in real time a bit
await B.page.evaluate(() => { const p = AO.game.player.v.position(); AO.game.place(AO.game.player, p.x + 8, p.z + 6, 0); });
for (let i = 0; i < 25; i++) { await A.page.evaluate(() => AO.advance(0.1)); await B.page.evaluate(() => AO.advance(0.1)); await new Promise((r) => setTimeout(r, 60)); }
const sa = await A.page.evaluate(() => [...AO.game.mp.remotes.values()].map((r) => ({ name: r.name, veh: r.vehId, p: r.pos()?.toArray().map((v) => +v.toFixed(1)) })));
const sb = await B.page.evaluate(() => [...AO.game.mp.remotes.values()].map((r) => ({ name: r.name, veh: r.vehId, p: r.pos()?.toArray().map((v) => +v.toFixed(1)) })));
console.log('A sees', JSON.stringify(sa)); console.log('B sees', JSON.stringify(sb));
await A.page.evaluate(() => AO.game.startRace('jump-alley'));
for (let i = 0; i < 60; i++) { await A.page.evaluate(() => AO.advance(0.1)); await B.page.evaluate(() => { AO.game.input.keys.add('KeyW'); AO.advance(0.1); }); await new Promise((r) => setTimeout(r, 30)); }
console.log('A race', await A.page.evaluate(() => JSON.stringify(AO.state().race)), await A.page.evaluate(() => AO.game.mp.raceSlot));
console.log('B race', await B.page.evaluate(() => JSON.stringify(AO.state().race)), await B.page.evaluate(() => AO.game.mp.raceSlot));
console.log('A standings', await A.page.evaluate(() => JSON.stringify(AO.game.mp.standings())));
await A.page.evaluate(() => { const r = [...AO.game.mp.remotes.values()][0]; const p = r.pos(); AO.cam(p.x + 9, p.y + 4, p.z - 10, p.x, p.y + 1, p.z); AO.render(3); }); await A.page.screenshot({ path: path.join(shots, 'mp-A.png') });
console.log('errors A', A.errors.slice(0, 3), 'B', B.errors.slice(0, 3));
await browser.close(); process.exit(0);
