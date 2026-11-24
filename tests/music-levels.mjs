// Music audibility per mood (engine muted): rms and share of energy above 300 Hz (what laptop speakers can play). GPU=1 node tests/music-levels.mjs
import { launch, openPage, serve } from './harness.mjs';
const srv = await serve(); const browser = await launch();
const { page, errors } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?quality=medium`, { width: 960, height: 540 });
const res = await page.evaluate(async () => {
  const g = AO.game; g.ui.startGame(); const a = g.audio; a.start(); await a.ctx.resume();
  const an = a.ctx.createAnalyser(); an.fftSize = 4096; a.master.connect(an);
  const td = new Float32Array(4096), fd = new Float32Array(2048), out = [], sr = a.ctx.sampleRate;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const phase = async (name, ms) => { let r = 0, hi = 0, n = 0; const t = performance.now(); while (performance.now() - t < ms) { await wait(120); an.getFloatTimeDomainData(td); an.getFloatFrequencyData(fd); let s = 0; for (const v of td) s += v * v; r += Math.sqrt(s / td.length); let eAll = 0, eHi = 0; fd.forEach((db, i) => { const e = 10 ** (db / 10), f = i * sr / 4096; eAll += e; if (f > 300) eHi += e; }); hi += eHi / eAll; n++; } out.push(`${name.padEnd(8)} rms ${(r / n).toFixed(3)}  energy>300Hz ${(100 * hi / n).toFixed(0)}%`); };
  a.update = () => {};   // freeze mood + engine so each mood plays alone
  a.eng.g.gain.cancelScheduledValues(0); a.eng.g.gain.value = 0;
  for (const k of Object.keys(a.loops)) { const n = a.loops[k]; if (n.gain) { n.gain.cancelScheduledValues(0); n.gain.value = 0; } }
  a.setMusic(a.musicVol, true);
  for (const m of ['title', 'hub', 'forest', 'desert', 'snow', 'quarry', 'race']) { a.music.setMood(m); await wait(4500); await phase(m, 4000); }
  return out;
});
console.log(res.join('\n')); console.log('errors', errors.slice(0, 3));
await browser.close(); process.exit(0);
