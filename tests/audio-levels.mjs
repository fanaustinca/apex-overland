// Audio mix check: loudness and energy above 300 Hz (laptop speakers) at idle / throttle / with music: GPU=1 node tests/audio-levels.mjs
import { launch, openPage, serve } from './harness.mjs';
const srv = await serve(); const browser = await launch();
const { page, errors } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?quality=medium`, { width: 960, height: 540 });
const res = await page.evaluate(async () => {
  const g = AO.game; g.ui.startGame(); const a = g.audio; a.start(); await a.ctx.resume();
  const an = a.ctx.createAnalyser(); an.fftSize = 4096; a.master.connect(an);
  const td = new Float32Array(4096), fd = new Float32Array(2048), out = [], sr = a.ctx.sampleRate;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const phase = async (name, ms) => { let r = 0, hi = 0, n = 0; const t = performance.now(); while (performance.now() - t < ms) { await wait(120); an.getFloatTimeDomainData(td); an.getFloatFrequencyData(fd); let s = 0; for (const v of td) s += v * v; r += Math.sqrt(s / td.length); let eAll = 0, eHi = 0; fd.forEach((db, i) => { const e = 10 ** (db / 10), f = i * sr / 4096; eAll += e; if (f > 300) eHi += e; }); hi += eHi / eAll; n++; } out.push(`${name}: rms(pre-makeup) ${(r / n).toFixed(3)}  energy>300Hz ${(100 * hi / n).toFixed(0)}%  rpm ${g.player.v.rpm.toFixed(0)}`); };
  a.setMusic(0, false); await wait(800); await phase('idle', 1200); const og = a.eng.g; a.eng.g = a.ctx.createGain(); og.gain.cancelScheduledValues(0); og.gain.value = 0; await phase('idle no engine', 1200); a.eng.g = og;
  g.input.keys.add('KeyW'); await phase('throttle', 2500); g.input.keys.delete('KeyW');
  a.setMusic(0.55, true); g.input.keys.add('KeyS'); await phase('music + braking', 3000);
  return out;
});
console.log(res.join('\n')); console.log('errors', errors.slice(0, 3));
await browser.close(); process.exit(0);
