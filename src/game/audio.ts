// Synthesised audio. Engines are pre-rendered firing-pulse loops (per cylinder layout: V8 burble, straight-six diesel,
// single-cylinder thumper, flat-four, V12) played back at an RPM-tracking rate with an on/off-load crossfade.
// On top: turbo, blow-off and exhaust crackle, tyre squeal / gravel crunch per surface, wind, water, landings,
// biome ambience (birds, hawks, mountain wind) and the generative soundtrack (music.ts).
import type { VehicleDef } from '../vehicles/defs';
import type { VehicleEntity } from './entity';
import { Music, type Mood } from './music';

interface EngineVoice { on: AudioBufferSourceNode; off: AudioBufferSourceNode; gOn: GainNode; gOff: GainNode; f: BiquadFilterNode; g: GainNode; r0: number; scale: number;
  osc: OscillatorNode; lp: BiquadFilterNode; lp2: BiquadFilterNode; mod: GainNode; cyl: number }
type Layout = { cyl: number; uneven: number; tone: [number, number]; tau: number; grit: number; scale: number; r0: number };
const LAYOUTS: Record<string, Layout> = {
  thumper: { cyl: 1, uneven: 0, tone: [180, 420], tau: 0.014, grit: 0.5, scale: 1, r0: 3000 },
  flat4: { cyl: 4, uneven: 0.06, tone: [210, 520], tau: 0.006, grit: 0.35, scale: 1, r0: 3000 },
  v6: { cyl: 6, uneven: 0, tone: [260, 640], tau: 0.005, grit: 0.25, scale: 1, r0: 3000 },
  v8: { cyl: 8, uneven: 0.22, tone: [150, 380], tau: 0.007, grit: 0.3, scale: 1, r0: 2500 },
  diesel: { cyl: 6, uneven: 0.03, tone: [95, 260], tau: 0.011, grit: 0.6, scale: 0.5, r0: 1800 },
  v12: { cyl: 12, uneven: 0.05, tone: [120, 300], tau: 0.006, grit: 0.45, scale: 0.55, r0: 2000 },
};
function layoutOf(d: VehicleDef): string {
  if (d.special === 'bike') return 'thumper';
  if (d.body === 'buggy') return 'flat4';
  if (d.special === 'tank') return 'v12';
  if (d.heavy || ['semi', 'bus', 'dump', 'eightbyeight'].includes(d.body)) return 'diesel';
  if (d.body === 'sedan' || d.body === 'limo' || d.cls === 'Lightweight') return 'v6';
  return 'v8';
}

export class Audio {
  ctx?: AudioContext;
  master?: GainNode;
  private sfx?: GainNode;
  music?: Music;
  private noiseBuf?: AudioBuffer; private grainBuf?: AudioBuffer;
  private engines = new Map<string, AudioBuffer[]>();
  private eng?: EngineVoice;
  private loops?: { rumble: GainNode; turbo: OscillatorNode; tg: GainNode; road: GainNode; rdf: BiquadFilterNode; squeal: GainNode; sqf: BiquadFilterNode; grit: GainNode; gritF: BiquadFilterNode; grain: AudioBufferSourceNode; wind: GainNode; wf: BiquadFilterNode; water: GainNode; amb: GainNode; af: BiquadFilterNode };
  private def?: VehicleDef;
  private lastGear = 1; private lastThrottle = 0; private wasAir = 0; private ambT = 2; private shiftDip = 0;
  volume = 0.8; musicVol = 0.55; musicOn = true;
  biome = 4; racing = false;

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    try { this.ctx = new AudioContext({ latencyHint: 'interactive' }); } catch { return; }
    const c = this.ctx;
    // master: volume → glue compressor → makeup gain (laptop speakers need the level; the compressor keeps crashes from clipping)
    this.master = c.createGain(); this.master.gain.value = this.volume;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -22; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    const makeup = c.createGain(); makeup.gain.value = 2.2;
    this.master.connect(comp).connect(makeup).connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    const len = c.sampleRate * 2; this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // gravel grains: sparse decaying clicks, looped and pitched by speed
    this.grainBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const gd = this.grainBuf.getChannelData(0);
    for (let k = 0; k < 420; k++) { const at = Math.floor(Math.random() * (gd.length - 400)), a = 0.3 + Math.random() * 0.7, tau = 30 + Math.random() * 90; for (let i = 0; i < 400; i++) gd[at + i] += a * Math.exp(-i / tau) * (Math.random() * 2 - 1); }
    const loop = (buf: AudioBuffer, rate = 1) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(0, Math.random() * buf.duration); return s; };
    const chain = (src: AudioNode, type: BiquadFilterType, freq: number, q = 0.7) => { const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = c.createGain(); g.gain.value = 0; src.connect(f).connect(g).connect(this.sfx!); return { f, g }; };
    const rumble = chain(loop(this.noiseBuf), 'lowpass', 90);
    const road = chain(loop(this.noiseBuf, 0.7), 'bandpass', 500, 0.6);
    const squeal = chain(loop(this.noiseBuf), 'bandpass', 1150, 9);
    const grain = loop(this.grainBuf);
    const grit = chain(grain, 'bandpass', 2200, 0.8);
    const wind = chain(loop(this.noiseBuf, 0.5), 'bandpass', 400, 0.5);
    const water = chain(loop(this.noiseBuf, 0.8), 'lowpass', 900);
    const amb = chain(loop(this.noiseBuf, 0.3), 'bandpass', 300, 1.2);
    const turbo = c.createOscillator(); turbo.type = 'sine';
    const tg = c.createGain(); tg.gain.value = 0; turbo.connect(tg).connect(this.sfx); turbo.start();
    this.loops = { rumble: rumble.g, turbo, tg, road: road.g, rdf: road.f, squeal: squeal.g, sqf: squeal.f, grit: grit.g, gritF: grit.f, grain, wind: wind.g, wf: wind.f, water: water.g, amb: amb.g, af: amb.f };
    this.music = new Music(c, this.master, this.noiseBuf);
    this.music.out.gain.value = this.musicOn ? this.musicVol : 0;
    this.music.start();
    if (this.def) this.buildEngine(this.def);
  }

  /** Render a looping engine cycle: N firing pulses per two crank revolutions, each a damped exhaust resonance plus grit. */
  private engineBuffers(name: string): AudioBuffer[] {
    const got = this.engines.get(name); if (got) return got;
    const c = this.ctx!, L = LAYOUTS[name], sr = c.sampleRate, cycle = 120 / L.r0, cycles = 16;
    const n = Math.round(cycle * cycles * sr);
    const make = (load: number) => {
      const b = c.createBuffer(1, n, sr), d = b.getChannelData(0);
      const bias = Array.from({ length: L.cyl }, (_, k) => 1 + (L.uneven * (k % 2 ? -1 : 1)) + (Math.random() - 0.5) * 0.1);
      const pl = Math.floor(sr * L.tau * 7);
      for (let cy = 0; cy < cycles; cy++) for (let k = 0; k < L.cyl; k++) {
        const jitter = L.uneven * ((k * 5) % L.cyl === 1 ? 0.35 : 0) * (cycle / L.cyl);
        const at = Math.floor((cy * cycle + (k * cycle) / L.cyl + jitter) * sr);
        const a = bias[k] * (0.85 + Math.random() * 0.3) * (load ? 1 : 0.55);
        const f1 = L.tone[0] * (0.96 + Math.random() * 0.08), f2 = L.tone[1] * (0.95 + Math.random() * 0.1);
        for (let i = 0; i < pl; i++) {
          const t = i / sr, e = Math.exp(-t / (L.tau * (load ? 1.2 : 0.8)));
          const v = Math.sin(2 * Math.PI * f1 * t) * 0.7 + Math.sin(2 * Math.PI * f2 * t) * (load ? 0.45 : 0.15) + (Math.random() * 2 - 1) * L.grit * (load ? 0.7 : 0.3);
          d[(at + i) % n] += a * e * v;
        }
      }
      let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
      for (let i = 0; i < n; i++) d[i] = Math.tanh((d[i] / peak) * 1.6) * 0.8;
      return b;
    };
    const bufs = [make(1), make(0)];
    this.engines.set(name, bufs);
    return bufs;
  }
  /** Engine-order spectrum for one 4-stroke cycle (fundamental = rpm/120): strong firing orders (every cyl-th harmonic), a
   *  half-order burble for uneven engines (cross-plane V8 lope) and a little low-order roughness. Random phases keep it from
   *  sounding like a buzzing pulse train; the timbre comes from fixed filters afterwards, like a real exhaust. */
  private engineWave(L: Layout) {
    const N = 256, re = new Float32Array(N), im = new Float32Array(N), half = Math.max(1, L.cyl / 2);
    for (let k = 1; k < N; k++) {
      let w = 0;
      if (k % L.cyl === 0) w += 1 / Math.pow(k / L.cyl, 0.75);
      else if (L.cyl >= 2 && k % half === 0) w += (0.12 + L.uneven * 1.8) / Math.pow(k / half, 0.9);
      w += (0.05 + L.uneven * 0.25) / Math.pow(k, 0.6) * (0.5 + Math.random() * 0.5);
      const ph = Math.random() * Math.PI * 2; re[k] = w * Math.cos(ph); im[k] = w * Math.sin(ph);
    }
    return this.ctx!.createPeriodicWave(re, im);
  }
  private buildEngine(d: VehicleDef) {
    const c = this.ctx!, name = layoutOf(d), L = LAYOUTS[name], [bOn, bOff] = this.engineBuffers(name);
    if (this.eng) { const old = this.eng; old.g.gain.setTargetAtTime(0, c.currentTime, 0.05); setTimeout(() => { old.on.stop(); old.off.stop(); old.osc.stop(); old.g.disconnect(); }, 400); }
    const deep = name === 'diesel' || name === 'v12';
    const g = c.createGain(); g.gain.value = 0;
    // main voice: engine orders → two low-passes that open with load (muffled at part throttle, raw on full) → body resonance
    const osc = c.createOscillator(); osc.setPeriodicWave(this.engineWave(L)); osc.frequency.value = 8;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8; lp.frequency.value = 500;
    const lp2 = c.createBiquadFilter(); lp2.type = 'lowpass'; lp2.Q.value = 0.5; lp2.frequency.value = 900;
    const body = c.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = deep ? 90 : 120; body.Q.value = 1; body.gain.value = 2;
    const chest = c.createBiquadFilter(); chest.type = 'peaking'; chest.frequency.value = deep ? 260 : 340; chest.Q.value = 0.9; chest.gain.value = 4;   // what small speakers can play
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = deep ? 35 : 45; hp.Q.value = 0.5;
    const og = c.createGain(); og.gain.value = 0.9;
    osc.connect(lp).connect(lp2).connect(body).connect(chest).connect(hp).connect(og).connect(g);
    // combustion roughness: noise amplitude-modulated by the engine wave itself, so it pulses with the firing
    const nz = c.createBufferSource(); nz.buffer = this.noiseBuf!; nz.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = deep ? 500 : 700; nf.Q.value = 0.6;
    const ng = c.createGain(); ng.gain.value = 0;
    const mod = c.createGain(); mod.gain.value = 0.05;
    osc.connect(mod).connect(ng.gain);
    nz.connect(nf).connect(ng).connect(g);
    nz.start(0, Math.random() * 1.5); osc.start();
    // texture: the pre-rendered firing-pulse loop, quiet and well filtered (cycle-to-cycle variation, mechanical clatter)
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.7;
    const gOn = c.createGain(), gOff = c.createGain(), tg = c.createGain(); tg.gain.value = 0.35;
    const on = c.createBufferSource(), off = c.createBufferSource();
    on.buffer = bOn; off.buffer = bOff; on.loop = off.loop = true;
    on.connect(gOn).connect(f); off.connect(gOff).connect(f); f.connect(tg).connect(g);
    on.start(); off.start(0, bOff.duration * 0.37);
    g.connect(this.sfx!);
    const stopOsc = osc.stop.bind(osc); osc.stop = ((w?: number) => { stopOsc(w); nz.stop(w); }) as typeof osc.stop;
    this.eng = { on, off, gOn, gOff, f, g, r0: L.r0, scale: L.scale, osc, lp, lp2, mod, cyl: L.cyl };
  }
  setVehicle(d: VehicleDef) { const changed = !this.def || layoutOf(this.def) !== layoutOf(d); this.def = d; if (this.ctx && (changed || !this.eng)) this.buildEngine(d); }
  setVolume(v: number) { this.volume = v; if (this.master) this.master.gain.value = v; }
  setMusic(v: number, on = this.musicOn) { this.musicVol = v; this.musicOn = on; if (this.music && this.ctx) this.music.out.gain.setTargetAtTime(on ? v : 0, this.ctx.currentTime, 0.3); }

  update(e: VehicleEntity, dt: number, active: boolean) {
    if (!this.ctx || !this.loops) return;
    const c = this.ctx, t = c.currentTime, X = this.loops, d = this.def ?? e.def, v = e.v;
    // ---- music mood ----
    if (this.music) this.music.setMood(this.racing ? 'race' : !active ? 'title' : (['desert', 'forest', 'snow', 'quarry', 'hub'] as Mood[])[this.biome] ?? 'hub');
    // ---- engine ----
    const E = this.eng, thr = e.controls.throttle, load = 0.3 + 0.7 * thr;
    if (E) {
      const rate = Math.max(0.25, (v.rpm / E.r0) * E.scale);
      E.on.playbackRate.setTargetAtTime(rate, t, 0.025); E.off.playbackRate.setTargetAtTime(rate, t, 0.025);
      E.gOn.gain.setTargetAtTime(0.15 + 0.85 * thr, t, 0.05); E.gOff.gain.setTargetAtTime(1 - 0.8 * thr, t, 0.05);
      E.f.frequency.setTargetAtTime(500 + v.rpm * (0.15 + 0.25 * thr), t, 0.05);
      const r = v.rpm * E.scale;
      E.osc.frequency.setTargetAtTime(r / 120, t, 0.03);
      const open = 480 + r * 0.05 + 1000 * thr;   // load opens the exhaust note; revs alone only a little
      E.lp.frequency.setTargetAtTime(open, t, 0.06); E.lp2.frequency.setTargetAtTime(open * 1.7, t, 0.06);
      E.mod.gain.setTargetAtTime(0.02 + 0.09 * thr, t, 0.06);
      if (v.gear !== this.lastGear && v.gear > this.lastGear && v.gear > 1) { this.shiftDip = 0.13; if (d.heavy || e.up.engine >= 4) this.blowoff(); }
      this.lastGear = v.gear;
      this.shiftDip = Math.max(0, this.shiftDip - dt);
      const vol = active && v.stalled <= 0 ? (0.085 + 0.075 * load) * (this.shiftDip > 0 ? 0.35 : 1) : 0;
      E.g.gain.setTargetAtTime(vol, t, this.shiftDip > 0 ? 0.015 : 0.06);
      // exhaust crackle on a sharp lift at high revs
      if (active && this.lastThrottle > 0.7 && thr < 0.15 && v.rpm > 3600 && !d.heavy) for (let i = 0; i < 3 + Math.floor(Math.random() * 4); i++) setTimeout(() => this.pop(), 40 + i * (50 + Math.random() * 90));
    }
    this.lastThrottle = thr;
    X.rumble.gain.setTargetAtTime(active && d.heavy ? 0.22 * load : 0, t, 0.1);
    const turbo = e.up.engine >= 4 || d.heavy ? 1 : 0;
    X.turbo.frequency.setTargetAtTime(1600 + v.rpm * 0.8, t, 0.15); X.tg.gain.setTargetAtTime(active ? turbo * 0.01 * thr * Math.min(1, v.rpm / 4000) : 0, t, 0.15);
    // ---- tyres ----
    const b = v.main.body, lv = b.linvel(), f = v.main.forward(), spd = Math.hypot(lv.x, lv.z);
    const fl = Math.hypot(f.x, f.z) || 1, lat = Math.abs((lv.x * f.z - lv.z * f.x) / fl);
    const contact = v.main.wheels.filter((w) => w.contact);
    const surf = contact.length ? contact[0].surface : -1;
    const hard = surf === 0 || surf === 8, ice = surf === 6, loose = surf >= 1 && surf <= 5 || surf === 7;
    const spin = thr > 0.8 && spd < 6 && v.rpm > 4000 ? 1 : 0;
    const slide = Math.max(0, Math.min(1, (lat - 2.5) / 6)) + spin * 0.6 + (e.controls.handbrake && spd > 5 ? 0.5 : 0);
    const on = active && v.onGround;
    X.road.gain.setTargetAtTime(on ? Math.min(0.2, spd * 0.0045) * (loose ? 1.4 : 0.55) : 0, t, 0.1);
    X.rdf.frequency.setTargetAtTime(loose ? 800 : 380 + spd * 4, t, 0.2);
    X.squeal.gain.setTargetAtTime(on && (hard || ice) ? Math.min(0.16, slide * 0.14) : 0, t, 0.06);
    X.sqf.frequency.setTargetAtTime((ice ? 1600 : 1050) + lat * 18, t, 0.1);
    const gritK = surf === 3 ? 0.5 : surf === 4 ? 0.7 : surf === 5 ? 0.8 : 1;
    X.grit.gain.setTargetAtTime(on && loose ? Math.min(0.35, (spd * 0.006 + slide * 0.25) * gritK) : 0, t, 0.08);
    X.gritF.frequency.setTargetAtTime(surf === 4 ? 700 : surf === 5 ? 1500 : surf === 3 ? 3200 : 2300, t, 0.2);
    X.grain.playbackRate.setTargetAtTime(0.6 + Math.min(1.6, spd / 20) + slide * 0.4, t, 0.1);
    // ---- wind, water ----
    const air = Math.hypot(lv.x, lv.y, lv.z), y = b.translation().y;
    X.wind.gain.setTargetAtTime(active ? Math.min(0.22, air * air * 0.00011) : 0, t, 0.2);
    X.wf.frequency.setTargetAtTime(250 + air * 14, t, 0.2);
    X.water.gain.setTargetAtTime(active && v.inWater > 0.15 ? Math.min(0.35, 0.05 + spd * 0.02) : 0, t, 0.1);
    // ---- landings ----
    if (v.airTime > 0.3) this.wasAir = v.airTime;
    else if (this.wasAir > 0 && v.onGround) { if (active) this.land(Math.min(1, this.wasAir / 1.5)); this.wasAir = 0; }
    // ---- ambience ----
    const snowy = this.biome === 2 || y > 330;
    X.amb.gain.setTargetAtTime((snowy ? 0.05 + Math.min(0.06, Math.max(0, y - 300) * 0.0003) : this.biome === 0 ? 0.03 : 0.015), t, 1);
    X.af.frequency.setTargetAtTime(snowy ? 380 + 160 * Math.sin(t * 0.37) + 90 * Math.sin(t * 1.13) : 260 + 60 * Math.sin(t * 0.2), t, 0.5);
    this.ambT -= dt;
    if (this.ambT < 0) {
      this.ambT = 2 + Math.random() * 6;
      if (this.biome === 1 || (this.biome === 4 && Math.random() < 0.4)) this.birdsong();
      else if (this.biome === 0 && Math.random() < 0.35) this.hawk();
      else if (this.biome === 3 && Math.random() < 0.3) this.clank();
    }
  }

  // ---------------- one-shots ----------------
  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.2, slide = 0, at = 0) {
    if (!this.ctx || !this.sfx) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime + at;
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + dur);
  }
  private burst(dur: number, vol: number, freq: number, type: BiquadFilterType = 'lowpass', q = 0.7, at = 0) {
    if (!this.ctx || !this.sfx || !this.noiseBuf) return;
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime + at;
    s.buffer = this.noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random()); s.stop(t + dur);
  }
  private pop() { this.burst(0.06, 0.25 + Math.random() * 0.2, 1400 + Math.random() * 1500, 'bandpass', 1.2); this.tone(90 + Math.random() * 40, 0.05, 'square', 0.08); }
  private blowoff() { this.burst(0.35, 0.09, 3500, 'highpass', 0.8); }
  private land(k: number) { this.tone(80, 0.25 + k * 0.2, 'sine', 0.25 + 0.35 * k, 0.45); this.burst(0.2 + k * 0.2, 0.15 + 0.25 * k, 300); if (k > 0.4) this.burst(0.12, 0.12, 2200, 'bandpass', 3, 0.03); }
  private birdsong() {
    const base = 2400 + Math.random() * 1800, n = 2 + Math.floor(Math.random() * 5), gap = 0.08 + Math.random() * 0.1;
    for (let i = 0; i < n; i++) this.tone(base * (0.9 + Math.random() * 0.25), 0.06 + Math.random() * 0.05, 'sine', 0.025, Math.random() < 0.5 ? 1.35 : 0.75, i * gap);
  }
  private hawk() { this.tone(2300, 0.9, 'sine', 0.02, 0.62); this.tone(2310, 0.9, 'triangle', 0.008, 0.6); }
  private clank() { this.tone(1300 + Math.random() * 600, 0.4, 'triangle', 0.02, 0.98); this.tone(2700 + Math.random() * 400, 0.3, 'sine', 0.012); }
  beep(go: boolean) { this.tone(go ? 880 : 440, go ? 0.6 : 0.25, 'square', 0.12); }
  checkpoint() { this.tone(988, 0.12, 'triangle', 0.15); this.tone(1318, 0.2, 'triangle', 0.15, 0, 0.09); }
  coin() { this.tone(1046, 0.1, 'square', 0.07); this.tone(1568, 0.25, 'square', 0.07, 0, 0.08); }
  token() { [1318, 1568, 2093, 2637].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.1, 0, i * 0.06)); }
  levelUp() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.12, 0, i * 0.09)); this.tone(2093, 0.9, 'sine', 0.06, 0, 0.45); }
  combo(n: number) { this.tone(600 + Math.min(n, 12) * 80, 0.08, 'triangle', 0.06); }
  impact(k: number) { this.burst(0.25 + k * 0.3, 0.3 * k + 0.1, 400 + 800 * k); this.tone(60 + 30 * k, 0.2, 'sine', 0.2 * k, 0.6); }
  crack() { this.burst(0.5, 0.35, 1800); this.tone(90, 0.6, 'sawtooth', 0.12, 0.5); }
  crunch() { this.burst(0.7, 0.5, 900); }
  horn() { this.tone(370, 0.5, 'sawtooth', 0.06); this.tone(466, 0.5, 'sawtooth', 0.05); }
  finish(win: boolean) { [523, 659, 784, win ? 1046 : 698].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.14, 0, i * 0.14)); }
}
