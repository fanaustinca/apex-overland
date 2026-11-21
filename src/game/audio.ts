// Synthesised audio: RPM-tracking engine (per vehicle class), diesel rumble, turbo whistle, tyre/surface roar, UI cues.
import type { VehicleDef } from '../vehicles/defs';
import type { VehicleEntity } from './entity';

export class Audio {
  ctx?: AudioContext;
  master?: GainNode;
  private eng?: { o1: OscillatorNode; o2: OscillatorNode; f: BiquadFilterNode; g: GainNode; rumble: GainNode; rf: BiquadFilterNode; turbo: OscillatorNode; tg: GainNode; road: GainNode; rdf: BiquadFilterNode };
  private noiseBuf?: AudioBuffer;
  private def?: VehicleDef;
  volume = 0.7;
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    try { this.ctx = new AudioContext(); } catch { return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.volume; this.master.connect(c.destination);
    const len = c.sampleRate * 2; this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const o1 = c.createOscillator(); o1.type = 'sawtooth';
    const o2 = c.createOscillator(); o2.type = 'square';
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
    const g = c.createGain(); g.gain.value = 0;
    const g2 = c.createGain(); g2.gain.value = 0.35;
    o1.connect(f); o2.connect(g2).connect(f); f.connect(g).connect(this.master);
    const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
    const rf = c.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 120;
    const rumble = c.createGain(); rumble.gain.value = 0; n.connect(rf).connect(rumble).connect(this.master);
    const n2 = c.createBufferSource(); n2.buffer = this.noiseBuf; n2.loop = true; n2.playbackRate.value = 0.7;
    const rdf = c.createBiquadFilter(); rdf.type = 'bandpass'; rdf.frequency.value = 600; rdf.Q.value = 0.6;
    const road = c.createGain(); road.gain.value = 0; n2.connect(rdf).connect(road).connect(this.master);
    const turbo = c.createOscillator(); turbo.type = 'sine';
    const tg = c.createGain(); tg.gain.value = 0; turbo.connect(tg).connect(this.master);
    o1.start(); o2.start(); n.start(); n2.start(); turbo.start();
    this.eng = { o1, o2, f, g, rumble, rf, turbo, tg, road, rdf };
  }
  setVehicle(d: VehicleDef) { this.def = d; }
  setVolume(v: number) { this.volume = v; if (this.master) this.master.gain.value = v; }
  update(e: VehicleEntity, _dt: number, active: boolean) {
    if (!this.ctx || !this.eng) return;
    const t = this.ctx.currentTime, E = this.eng, d = this.def ?? e.def, v = e.v;
    const cyl = d.cls === 'Featherweight' ? (d.special === 'bike' ? 1 : 4) : d.cls === 'Lightweight' ? 6 : d.heavy ? 6 : 8;
    const base = (v.rpm / 60) * cyl / 2 * (d.heavy ? 0.5 : 1) * (d.special === 'bike' ? 2 : 1);
    const load = 0.35 + 0.65 * e.controls.throttle;
    E.o1.frequency.setTargetAtTime(base, t, 0.03); E.o2.frequency.setTargetAtTime(base * 0.5, t, 0.03);
    E.f.frequency.setTargetAtTime(300 + v.rpm * 0.35 * load, t, 0.05);
    E.g.gain.setTargetAtTime(active ? (v.stalled > 0 ? 0 : 0.06 + 0.07 * load) : 0, t, 0.08);
    E.rumble.gain.setTargetAtTime(active && d.heavy ? 0.25 * load : 0, t, 0.1);
    E.rf.frequency.setTargetAtTime(60 + v.rpm * 0.02, t, 0.1);
    const turbo = e.up.engine >= 4 ? 1 : 0;
    E.turbo.frequency.setTargetAtTime(1800 + v.rpm * 0.9, t, 0.1); E.tg.gain.setTargetAtTime(active ? turbo * 0.012 * e.controls.throttle : 0, t, 0.1);
    const spd = Math.abs(v.speed());
    const loose = v.main.wheels.some((w) => w.contact && [1, 2, 3, 4, 5].includes(w.surface));
    E.road.gain.setTargetAtTime(active && v.onGround ? Math.min(0.18, spd * 0.004) * (loose ? 1.6 : 0.6) : 0, t, 0.1);
    E.rdf.frequency.setTargetAtTime(loose ? 900 : 450, t, 0.2);
  }
  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.2, slide = 0) {
    if (!this.ctx || !this.master) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq; if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, c.currentTime + dur);
    g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g).connect(this.master); o.start(); o.stop(c.currentTime + dur);
  }
  private burst(dur: number, vol: number, freq: number) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; f.type = 'lowpass'; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    s.connect(f).connect(g).connect(this.master); s.start(); s.stop(c.currentTime + dur);
  }
  beep(go: boolean) { this.tone(go ? 880 : 440, go ? 0.6 : 0.25, 'square', 0.12); }
  checkpoint() { this.tone(988, 0.12, 'triangle', 0.15); setTimeout(() => this.tone(1318, 0.2, 'triangle', 0.15), 90); }
  coin() { this.tone(1046, 0.1, 'square', 0.08); setTimeout(() => this.tone(1568, 0.25, 'square', 0.08), 80); }
  impact(k: number) { this.burst(0.25 + k * 0.3, 0.3 * k + 0.1, 400 + 800 * k); }
  crack() { this.burst(0.5, 0.35, 1800); this.tone(90, 0.6, 'sawtooth', 0.12, 0.5); }
  crunch() { this.burst(0.7, 0.5, 900); }
  finish(win: boolean) { [523, 659, 784, win ? 1046 : 698].forEach((f, i) => setTimeout(() => this.tone(f, 0.35, 'triangle', 0.14), i * 140)); }
}
