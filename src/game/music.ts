// Generative soundtrack: a look-ahead step sequencer that writes an endless, evolving score per mood
// (one per biome, plus a high-energy race cue). Everything is synthesised; nothing is downloaded.
export type Mood = 'desert' | 'forest' | 'snow' | 'quarry' | 'hub' | 'race' | 'title';

interface MoodDef {
  bpm: number; root: number; scale: number[]; prog: number[]; swing: number;
  kit: 'hand' | 'soft' | 'none' | 'metal' | 'funk' | 'drive';
  lead: 'pluck' | 'bell' | 'saw' | 'marimba'; pad: number; bass: 'pulse' | 'sub' | 'drive' | 'walk'; bright: number;
}
const PHRYG_DOM = [0, 1, 4, 5, 7, 8, 10], MAJOR = [0, 2, 4, 5, 7, 9, 11], AEOL = [0, 2, 3, 5, 7, 8, 10], DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MOODS: Record<Mood, MoodDef> = {
  desert: { bpm: 94, root: 50, scale: PHRYG_DOM, prog: [0, 1, 0, 6], swing: 0.12, kit: 'hand', lead: 'pluck', pad: 0.5, bass: 'pulse', bright: 0.55 },
  forest: { bpm: 104, root: 55, scale: MAJOR, prog: [0, 4, 5, 3], swing: 0.08, kit: 'soft', lead: 'marimba', pad: 0.6, bass: 'walk', bright: 0.7 },
  snow: { bpm: 72, root: 52, scale: AEOL, prog: [0, 5, 2, 6], swing: 0, kit: 'none', lead: 'bell', pad: 1, bass: 'sub', bright: 0.4 },
  quarry: { bpm: 116, root: 45, scale: DORIAN, prog: [0, 0, 6, 3], swing: 0.05, kit: 'metal', lead: 'pluck', pad: 0.45, bass: 'drive', bright: 0.6 },
  hub: { bpm: 110, root: 57, scale: DORIAN, prog: [0, 3, 0, 6], swing: 0.14, kit: 'funk', lead: 'marimba', pad: 0.5, bass: 'walk', bright: 0.8 },
  race: { bpm: 134, root: 52, scale: AEOL, prog: [0, 5, 6, 4], swing: 0, kit: 'drive', lead: 'saw', pad: 0.55, bass: 'drive', bright: 1 },
  title: { bpm: 88, root: 50, scale: AEOL, prog: [0, 5, 3, 6], swing: 0.06, kit: 'soft', lead: 'bell', pad: 0.9, bass: 'sub', bright: 0.5 },
};
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Small seeded RNG so a section's motif repeats exactly when it comes back round. */
function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; }; }

export class Music {
  out: GainNode;
  private verb: ConvolverNode; private wet: GainNode; private dry: GainNode; private noise: AudioBuffer;
  private mood: Mood = 'title'; private want: Mood = 'title';
  private step = 0; private next = 0; private bar = 0; private timer = 0;
  private level = 1; private motif: (number | null)[] = []; private arp: number[] = []; private bassPat: (number | null)[] = [];
  private seed = 1; private fill = false;
  constructor(private c: AudioContext, dest: AudioNode, noise: AudioBuffer) {
    this.noise = noise;
    this.out = c.createGain(); this.out.gain.value = 0.5;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
    this.dry = c.createGain(); this.wet = c.createGain(); this.wet.gain.value = 0.32;
    this.verb = c.createConvolver(); this.verb.buffer = this.impulse(2.6);
    this.dry.connect(comp); this.wet.connect(this.verb).connect(comp); const makeup = c.createGain(); makeup.gain.value = 2.4;   // sits level with the engine on laptop speakers
    comp.connect(makeup).connect(this.out).connect(dest);
    this.section();
  }
  private impulse(sec: number) {
    const c = this.c, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2); }
    return b;
  }
  setMood(m: Mood) { this.want = m; }
  get current() { return this.mood; }
  start() { this.next = this.c.currentTime + 0.1; if (!this.timer) this.timer = window.setInterval(() => this.pump(), 50); }
  stop() { clearInterval(this.timer); this.timer = 0; }

  /** Pick the section's intensity and write its motifs. */
  private section() {
    const M = MOODS[this.mood], r = rng(this.seed++ * 7919 + this.mood.length * 131);
    const lv = this.mood === 'race' ? 2 + Math.round(r()) : this.mood === 'title' ? 1 : [1, 2, 2, 3, 3][Math.floor(r() * 5)];
    this.level = this.bar === 0 && this.mood === 'title' ? 1 : Math.max(2, lv);   // the sparse intro level was near-silent on small speakers
    // melody: 2-bar motif in scale steps (null = rest) built from a random walk that leans on chord tones
    let deg = Math.floor(r() * 5);
    this.motif = Array.from({ length: 32 }, (_, i) => {
      const strong = i % 4 === 0, dens = M.lead === 'bell' ? 0.18 : M.lead === 'saw' ? 0.55 : 0.38;
      if (r() > (strong ? dens + 0.3 : dens)) return null;
      deg += Math.round((r() - 0.5) * 4); deg = Math.max(-2, Math.min(9, deg));
      return deg;
    });
    const arps = [[0, 2, 4, 7], [0, 4, 2, 4], [4, 2, 0, 2], [0, 2, 4, 2, 7, 4, 2, 4]];
    this.arp = arps[Math.floor(r() * arps.length)];
    const bp: Record<MoodDef['bass'], (number | null)[][]> = {
      pulse: [[0, null, null, 0, null, null, 0, null, 0, null, null, 0, null, 4, null, null]],
      sub: [[0, null, null, null, null, null, null, null, 4, null, null, null, null, null, null, null]],
      drive: [[0, 0, 7, 0, 0, 0, 7, 0, 0, 0, 7, 0, 0, 5, 7, 0], [0, null, 0, 0, 7, null, 0, 0, 0, null, 0, 0, 7, null, 5, 7]],
      walk: [[0, null, null, 2, null, null, 4, null, 0, null, 5, null, 4, null, 2, null], [0, null, 7, null, 4, null, null, 2, 0, null, null, 4, 5, null, 4, 2]],
    };
    const pats = bp[M.bass]; this.bassPat = pats[Math.floor(r() * pats.length)];
  }

  private pump() {
    const c = this.c;
    if (c.state !== 'running') { this.next = c.currentTime + 0.1; return; }
    if (this.next < c.currentTime - 0.5) this.next = c.currentTime + 0.05;   // tab was asleep: don't machine-gun the backlog
    while (this.next < c.currentTime + 0.25) {
      const M = MOODS[this.mood], spb = 60 / M.bpm / 4;
      const s = this.step % 16;
      const t = this.next + (s % 2 === 1 ? M.swing * spb : 0);
      this.play(M, s, t, spb);
      this.next += spb; this.step++;
      if (this.step % 16 === 0) {
        this.bar++;
        if (this.want !== this.mood && this.bar % 2 === 0) { this.mood = this.want; this.bar = 0; this.step = 0; this.section(); this.fill = false; continue; }
        if (this.bar % 8 === 7) this.fill = true;
        if (this.bar % 8 === 0) { this.fill = false; this.section(); }
      }
    }
  }

  private chordAt(M: MoodDef, bar: number) {
    const deg = M.prog[bar % M.prog.length], sc = M.scale;
    const note = (d: number) => M.root + sc[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
    return { deg, note, tones: [note(deg), note(deg + 2), note(deg + 4)] };
  }

  private play(M: MoodDef, s: number, t: number, spb: number) {
    const ch = this.chordAt(M, this.bar), lv = this.level, fill = this.fill && s >= 8;
    // pad: a new chord each bar
    if (s === 0 && M.pad > 0) this.pad(ch.tones.map((n) => n + 12), t, spb * 16, 0.05 * M.pad, M.bright);
    // bass
    if (lv >= 2 || M.bass === 'sub') {
      const b = this.bassPat[s];
      if (b !== null && b !== undefined) this.bass(mtof(ch.note(ch.deg + b) - 12), t, spb * (M.bass === 'sub' ? 7 : 1.6), M.bass);
    }
    // drums
    this.drums(M.kit, s, t, lv, fill);
    // arpeggio / lead
    if (lv >= 2 && (M.lead !== 'bell' || s % 4 === 0) && s % 2 === 0) {
      const a = this.arp[(s / 2) % this.arp.length];
      const n = ch.note(ch.deg + a) + 12;
      if (M.lead !== 'saw' || lv >= 2) this.voice(M.lead === 'saw' ? 'pluck' : M.lead, mtof(n), t, spb * 1.8, 0.045, M.bright);
    }
    if (lv >= 3 || M.lead === 'bell') {
      const i = (this.bar % 2) * 16 + s, d = this.motif[i];
      if (d !== null && d !== undefined) this.voice(M.lead, mtof(ch.note(d) + 24 - (M.lead === 'saw' ? 12 : 0)), t, spb * (M.lead === 'bell' ? 8 : 2.5), M.lead === 'bell' ? 0.06 : 0.055, M.bright);
    }
  }

  // ---------------- instruments ----------------
  private env(g: GainNode, t: number, a: number, peak: number, dec: number) {
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  private send(n: AudioNode, wet = 1) { n.connect(this.dry); if (wet > 0) { const w = this.c.createGain(); w.gain.value = wet; n.connect(w).connect(this.wet); } }
  private pad(notes: number[], t: number, dur: number, vol: number, bright: number) {
    const c = this.c, f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'lowpass'; f.frequency.setValueAtTime(500 + 900 * bright, t); f.frequency.linearRampToValueAtTime(900 + 1600 * bright, t + dur * 0.5); f.frequency.linearRampToValueAtTime(500, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.3); g.gain.setValueAtTime(vol, t + dur * 0.75); g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.05);
    f.connect(g); this.send(g, 1.4);
    for (const n of notes) for (const det of [-7, 7]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur * 1.1);
    }
  }
  private bass(freq: number, t: number, dur: number, kind: MoodDef['bass']) {
    const c = this.c, o = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = kind === 'sub' ? 'sine' : 'sawtooth'; o2.type = 'sine'; o.frequency.value = freq; o2.frequency.value = freq / 2;
    f.type = 'lowpass'; f.Q.value = kind === 'drive' ? 6 : 2;
    f.frequency.setValueAtTime(kind === 'drive' ? 1200 : 700, t); f.frequency.exponentialRampToValueAtTime(140, t + dur);
    this.env(g, t, 0.008, kind === 'sub' ? 0.22 : 0.13, dur);
    const g2 = c.createGain(); g2.gain.value = 0.6;
    o.connect(f); o2.connect(g2).connect(f); f.connect(g); this.send(g, 0.1);
    // octave-up 'growl' through a fixed mid band so the bass line is heard on speakers with no low end
    const o3 = c.createOscillator(), f3 = c.createBiquadFilter(), g3 = c.createGain();
    o3.type = kind === 'sub' ? 'triangle' : 'sawtooth'; o3.frequency.value = freq * 2;
    f3.type = 'bandpass'; f3.frequency.value = 420; f3.Q.value = 0.8;
    this.env(g3, t, 0.008, kind === 'sub' ? 0.09 : 0.07, dur);
    o3.connect(f3).connect(g3); this.send(g3, 0.1);
    o.start(t); o2.start(t); o3.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05); o3.stop(t + dur + 0.05);
  }
  private voice(kind: MoodDef['lead'], freq: number, t: number, dur: number, vol: number, bright: number) {
    const c = this.c, g = c.createGain();
    if (kind === 'bell') {   // two-operator FM bell
      const car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain();
      car.frequency.value = freq; mod.frequency.value = freq * 3.5; mg.gain.setValueAtTime(freq * 2, t); mg.gain.exponentialRampToValueAtTime(freq * 0.05, t + dur);
      mod.connect(mg).connect(car.frequency); car.connect(g); this.env(g, t, 0.004, vol, dur);
      car.start(t); mod.start(t); car.stop(t + dur + 0.1); mod.stop(t + dur + 0.1);
      this.send(g, 1.6); return;
    }
    if (kind === 'marimba') {
      const o = c.createOscillator(), o2 = c.createOscillator(), g2 = c.createGain();
      o.type = 'sine'; o.frequency.value = freq; o2.type = 'sine'; o2.frequency.value = freq * 4; g2.gain.setValueAtTime(0.4, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      o.connect(g); o2.connect(g2).connect(g); this.env(g, t, 0.003, vol * 1.3, Math.min(dur, 0.45));
      o.start(t); o2.start(t); o.stop(t + 0.6); o2.stop(t + 0.1);
      this.send(g, 0.7); return;
    }
    // pluck (guitar-ish) and saw lead share a filtered-saw voice with different envelopes
    const o = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter();
    o.type = kind === 'saw' ? 'sawtooth' : 'triangle'; o2.type = kind === 'saw' ? 'square' : 'sawtooth';
    o.frequency.value = freq; o2.frequency.value = freq; o2.detune.value = kind === 'saw' ? 9 : 3;
    f.type = 'lowpass'; f.Q.value = kind === 'saw' ? 3 : 1;
    const top = (kind === 'saw' ? 3000 : 2400) * (0.5 + bright);
    f.frequency.setValueAtTime(top, t); f.frequency.exponentialRampToValueAtTime(kind === 'saw' ? 600 : 250, t + Math.min(dur, kind === 'saw' ? 0.5 : 0.3));
    const g2 = c.createGain(); g2.gain.value = kind === 'saw' ? 0.5 : 0.25;
    o.connect(f); o2.connect(g2).connect(f); f.connect(g);
    this.env(g, t, 0.004, vol, kind === 'saw' ? dur : Math.min(dur, 0.6));
    o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
    this.send(g, kind === 'saw' ? 0.6 : 0.9);
  }
  private hit(t: number, type: BiquadFilterType, freq: number, q: number, vol: number, dec: number, wet = 0.2) {
    const c = this.c, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; s.playbackRate.value = 1; f.type = type; f.frequency.value = freq; f.Q.value = q;
    this.env(g, t, 0.001, vol, dec); s.connect(f).connect(g); this.send(g, wet);
    s.start(t, Math.random() * 1.5); s.stop(t + dec + 0.05);
  }
  private tom(t: number, f0: number, f1: number, vol: number, dec: number, wet = 0.15) {
    const c = this.c, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dec * 0.6);
    this.env(g, t, 0.001, vol, dec); o.connect(g); this.send(g, wet); o.start(t); o.stop(t + dec + 0.05);
  }
  private kick(t: number, vol = 0.5) { this.tom(t, 150, 42, vol, 0.42, 0); this.hit(t, 'bandpass', 1800, 1.2, vol * 0.35, 0.025, 0); this.tom(t, 320, 180, vol * 0.3, 0.06, 0); }   // + beater click and knock for small speakers
  private snare(t: number, vol = 0.22) { this.hit(t, 'bandpass', 1900, 0.8, vol, 0.18, 0.35); this.tom(t, 240, 170, vol * 0.5, 0.1); }
  private hat(t: number, vol = 0.05, open = false) { this.hit(t, 'highpass', 7500, 0.7, vol, open ? 0.22 : 0.045, 0.1); }
  private drums(kit: MoodDef['kit'], s: number, t: number, lv: number, fill: boolean) {
    if (kit === 'none') { if (lv >= 2 && s === 0) this.tom(t, 70, 40, 0.25, 1.2, 0.6); return; }
    if (fill && s >= 12) { this.tom(t, 220 - (s - 12) * 30, 90, 0.22, 0.2, 0.3); if (s === 15) this.hat(t, 0.08, true); return; }
    switch (kit) {
      case 'hand':   // doumbek-ish: low dum, high tek, shaker
        if (s === 0 || s === 6 || (lv >= 2 && s === 10)) this.tom(t, 120, 70, 0.32, 0.3);
        if (s === 4 || s === 12 || (lv >= 3 && s === 14)) this.hit(t, 'bandpass', 2600, 3, 0.16, 0.07, 0.4);
        if (lv >= 2 && s % 2 === 1) this.hit(t, 'highpass', 5200, 0.6, 0.025, 0.06);
        break;
      case 'soft':
        if (lv >= 2 && (s === 0 || s === 10)) this.kick(t, 0.32);
        if (lv >= 2 && (s === 4 || s === 12)) this.hit(t, 'bandpass', 1500, 1, 0.08, 0.12, 0.6);
        if (s % 2 === 0) this.hit(t, 'highpass', 6000, 0.5, lv >= 2 ? 0.03 : 0.018, 0.05);
        break;
      case 'metal':   // industrial: anvil clinks and a stomping kick
        if (s % 4 === 0) this.kick(t, 0.45);
        if (s === 4 || s === 12) { this.snare(t, 0.18); this.tom(t, 1250, 1180, 0.05, 0.25, 0.5); }
        if (lv >= 2 && (s === 3 || s === 11 || s === 14)) this.tom(t, 2100, 2050, 0.035, 0.18, 0.5);
        if (lv >= 2 && s % 2 === 0) this.hat(t, 0.04);
        break;
      case 'funk':
        if (s === 0 || s === 7 || s === 10) this.kick(t, 0.42);
        if (s === 4 || s === 12) this.snare(t, 0.2);
        if (lv >= 2 && s === 15) this.snare(t, 0.06);
        this.hat(t, s % 2 === 0 ? 0.045 : 0.02, lv >= 3 && s === 14);
        break;
      case 'drive':
        if (s % 4 === 0) this.kick(t, 0.5);
        if (s === 4 || s === 12) this.snare(t, 0.24);
        if (lv >= 3 && (s === 14 || s === 15)) this.snare(t, 0.08);
        this.hat(t, s % 2 === 0 ? 0.05 : 0.03, s % 4 === 2);
        break;
    }
  }
}
