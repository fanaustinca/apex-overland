// Long-term progression: driver XP + levels, skill chains (drift / air / speed, with a multiplier that builds while you
// keep it going and drops if you crash), 50 hidden Apex Tokens with light beams, and three daily challenges with a
// login streak. Everything persists in the profile.
import * as THREE from 'three';
import type { Game } from './game';
import { saveProfile } from './save';
import { LANDMARKS, HALF } from '../world/layout';
import { CABINS } from '../world/roads';

export interface Daily { day: string; ch: { kind: ChKind; target: number; prog: number; done: boolean; param?: string }[]; streak: number; claimed: boolean }
type ChKind = 'km' | 'chain' | 'race' | 'podium' | 'tokens' | 'air' | 'speed' | 'drift';
const CH_TEXT: Record<ChKind, (t: number, p?: string) => string> = {
  km: (t) => `Drive ${t} km`,
  chain: (t) => `Bank a ${t.toLocaleString()}-point skill chain`,
  race: (t) => `Finish ${t} race${t > 1 ? 's' : ''}`,
  podium: (_t, p) => `Win a race${p ? ' in the ' + p : ''}`,
  tokens: (t) => `Collect ${t} Apex Token${t > 1 ? 's' : ''}`,
  air: (t) => `Hang ${t.toFixed(1)} s of air in one jump`,
  speed: (t) => `Hit ${t} km/h`,
  drift: (t) => `Drift ${t} m in total`,
};
const CH_REWARD: Record<ChKind, number> = { km: 1500, chain: 2000, race: 1500, podium: 2500, tokens: 1500, air: 1500, speed: 1200, drift: 1800 };
const BIOMES = ['Desert Canyon', 'Dense Forest', 'Snowy Mountain', 'Industrial Quarry'];
export const TOKEN_COUNT = 50;
export const xpForLevel = (l: number) => 600 + 300 * l;   // XP needed to go from level l to l+1

function seeded(seed: number) { let s = seed >>> 0 || 7; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e6) / 1e6; }; }
const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

export class Progress {
  tokens: { x: number; y: number; z: number; id: number }[] = [];
  private tokMesh?: THREE.InstancedMesh; private beamMesh?: THREE.InstancedMesh;
  private hud!: HTMLElement; private chainEl!: HTMLElement; private lvlEl!: HTMLElement; private xpBar!: HTMLElement; private dailyEl!: HTMLElement;
  // skill chain state
  chain = 0; mult = 1; private chainT = 0; private idle = 0; private kind = ''; private driftM = 0;
  private airStart = -1; private dummy = new THREE.Object3D(); private spin = 0;
  constructor(private g: Game) {}

  get p() { return this.g.profile; }
  get level() { return this.p.level ?? 1; }

  init() {
    const p = this.p;
    p.level ??= 1; p.xp ??= 0; p.tokens ??= []; p.driftTotal ??= 0;
    this.placeTokens();
    this.buildTokenMeshes();
    this.buildHud();
    this.rollDaily();
  }

  // ---------------- tokens ----------------
  private placeTokens() {
    const r = seeded(90210), roads = this.g.world.roads.filter((q) => !q.id.startsWith('drive-') && !q.id.startsWith('ruts-'));
    const total = roads.reduce((s, q) => s + q.len, 0), pick: [number, number][] = [];
    const far = (x: number, z: number, d: number) => pick.every((q) => Math.hypot(q[0] - x, q[1] - z) > d);
    // a few on every landmark and cabin (reward for exploring), the rest along roads (some just off them, behind a crest)
    for (const l of LANDMARKS) pick.push([l.x + Math.sin(l.dir + 2) * l.r * 0.5, l.z + Math.cos(l.dir + 2) * l.r * 0.5]);
    for (const c of CABINS) pick.push([c.x + Math.sin(c.yaw + 1.6) * 14, c.z + Math.cos(c.yaw + 1.6) * 14]);
    let guard = 0;
    while (pick.length < TOKEN_COUNT && guard++ < 5000) {
      let t = r() * total, road = roads[0];
      for (const q of roads) { if (t < q.len) { road = q; break; } t -= q.len; }
      const i = Math.floor(r() * road.pts.length), [x, z] = road.pts[i];
      const j = Math.min(road.pts.length - 1, i + 1), tx = road.pts[j][0] - x, tz = road.pts[j][1] - z, l = Math.hypot(tx, tz) || 1;
      const off = r() < 0.35 ? (r() < 0.5 ? -1 : 1) * (road.width / 2 + 10 + r() * 25) : (r() - 0.5) * road.width * 0.5;
      const px = x - (tz / l) * off, pz = z + (tx / l) * off;
      if (Math.abs(px) > HALF - 60 || Math.abs(pz) > HALF - 60 || !far(px, pz, 160)) continue;
      const w = this.g.world.water[this.g.cell(px, pz)]; if (w === w) continue;
      pick.push([px, pz]);
    }
    this.tokens = pick.map(([x, z], id) => ({ x, z, y: this.g.ground(x, z) + 1.6, id }));
  }
  private buildTokenMeshes() {
    const coin = new THREE.CylinderGeometry(0.95, 0.95, 0.16, 28); coin.rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffc23a, metalness: 1, roughness: 0.22, emissive: 0x6a3d00, emissiveIntensity: 0.9 });
    this.tokMesh = new THREE.InstancedMesh(coin, mat, this.tokens.length);
    const beamGeo = new THREE.CylinderGeometry(0.35, 0.9, 60, 10, 1, true); beamGeo.translate(0, 30, 0);
    const pos = beamGeo.attributes.position, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { const k = 1 - (pos.getY(i) / 60); col[i * 3] = k; col[i * 3 + 1] = k * 0.75; col[i * 3 + 2] = k * 0.25; }
    beamGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const beamMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.beamMesh = new THREE.InstancedMesh(beamGeo, beamMat, this.tokens.length);
    this.tokMesh.frustumCulled = this.beamMesh.frustumCulled = false;
    this.g.gfx.scene.add(this.tokMesh, this.beamMesh);
    this.syncTokens(0);
  }
  private syncTokens(dt: number) {
    if (!this.tokMesh || !this.beamMesh) return;
    this.spin += dt * 2.2;
    const got = this.p.tokens!, cam = this.g.gfx.camera.position, d = this.dummy;
    this.tokens.forEach((t, i) => {
      const hidden = got.includes(t.id);
      d.position.set(t.x, t.y + Math.sin(this.spin + i) * 0.25, t.z); d.rotation.set(0, this.spin + i, 0);
      d.scale.setScalar(hidden ? 0 : 1); d.updateMatrix(); this.tokMesh!.setMatrixAt(i, d.matrix);
      const dist = Math.hypot(t.x - cam.x, t.z - cam.z);
      d.position.y = t.y - 1.5; d.rotation.set(0, 0, 0); d.scale.setScalar(hidden || dist < 12 || dist > 900 ? 0 : 1); d.updateMatrix(); this.beamMesh!.setMatrixAt(i, d.matrix);
    });
    this.tokMesh.instanceMatrix.needsUpdate = true; this.beamMesh.instanceMatrix.needsUpdate = true;
  }
  tokensFound() { return this.p.tokens!.length; }
  nearestToken(x: number, z: number) { let b = null as null | (typeof this.tokens)[0], bd = 1e9; for (const t of this.tokens) { if (this.p.tokens!.includes(t.id)) continue; const d = Math.hypot(t.x - x, t.z - z); if (d < bd) { bd = d; b = t; } } return b ? { t: b, d: bd } : null; }

  // ---------------- XP / levels ----------------
  addXP(n: number, why = '') {
    const p = this.p; p.xp! += Math.round(n);
    let lv = p.level!;
    while (p.xp! >= xpForLevel(lv)) {
      p.xp! -= xpForLevel(lv); lv++;
      const coins = 500 + 250 * lv; p.coins += coins;
      this.g.ui.toast(`🏆 LEVEL ${lv}!  +${coins.toLocaleString()} coins`, 'level', 5);
      this.g.audio.levelUp();
    }
    p.level = lv;
    if (why) void why;
  }

  // ---------------- daily challenges ----------------
  private rollDaily() {
    const p = this.p, day = today();
    if (p.daily && p.daily.day === day) return;
    const prevDay = p.daily?.day, y = new Date(); y.setDate(y.getDate() - 1);
    const yest = `${y.getFullYear()}-${y.getMonth() + 1}-${y.getDate()}`;
    const streak = prevDay === yest ? (p.daily!.streak ?? 0) + 1 : 1;
    const r = seeded(day.split('-').reduce((a, b) => a * 37 + +b, 11));
    const pool: ChKind[] = ['km', 'chain', 'race', 'podium', 'tokens', 'air', 'speed', 'drift'];
    const ch: Daily['ch'] = [];
    while (ch.length < 3) {
      const k = pool.splice(Math.floor(r() * pool.length), 1)[0];
      const lv = Math.min(10, p.level ?? 1);
      const target = { km: 5 + lv, chain: 1500 + lv * 400, race: 2, podium: 1, tokens: 2 + Math.floor(lv / 4), air: 1.6 + lv * 0.08, speed: 120 + lv * 6, drift: 400 + lv * 80 }[k];
      ch.push({ kind: k, target: Math.round(target * 10) / 10, prog: 0, done: false, param: k === 'podium' ? BIOMES[Math.floor(r() * 4)] : undefined });
    }
    p.daily = { day, ch, streak, claimed: false };
    saveProfile(p);
  }
  /** Streak bonus, paid once per day when the player first drives. */
  claimStreak() {
    const d = this.p.daily; if (!d || d.claimed) return;
    d.claimed = true; const bonus = 500 * Math.min(7, d.streak);
    this.p.coins += bonus; saveProfile(this.p);
    this.g.ui.toast(`📅 Day ${d.streak} streak!  +${bonus.toLocaleString()} coins${d.streak < 7 ? ` (come back tomorrow for +${(500 * Math.min(7, d.streak + 1)).toLocaleString()})` : ''}`, 'coin', 6);
  }
  private bump(kind: ChKind, v: number, mode: 'add' | 'max' = 'add', param?: string) {
    const d = this.p.daily; if (!d) return;
    for (const c of d.ch) {
      if (c.done || c.kind !== kind || (c.param && param !== undefined && c.param !== param)) continue;
      if (c.param && param === undefined) continue;
      c.prog = mode === 'add' ? c.prog + v : Math.max(c.prog, v);
      if (c.prog >= c.target) {
        c.done = true; c.prog = c.target;
        const coins = CH_REWARD[kind] + 100 * (this.level - 1);
        this.p.coins += coins; this.addXP(400);
        this.g.ui.toast(`✅ Daily challenge: ${CH_TEXT[kind](c.target, c.param)}  +${coins.toLocaleString()} coins`, 'coin', 5);
        this.g.audio.finish(true);
        if (d.ch.every((q) => q.done)) { this.p.coins += 3000; this.g.ui.toast('🌟 All three dailies done!  +3,000 bonus', 'level', 6); }
      }
      saveProfile(this.p);
    }
  }
  dailyLines() { return (this.p.daily?.ch ?? []).map((c) => ({ text: CH_TEXT[c.kind](c.target, c.param), prog: c.prog, target: c.target, done: c.done, kind: c.kind })); }

  // ---------------- events from the game ----------------
  onRaceFinish(place: number, biome: number | 'marathon', reward: number) {
    this.addXP(250 + reward * 0.12 + (place === 1 ? 300 : 0));
    this.bump('race', 1);
    if (place === 1) { this.bump('podium', 1, 'add', typeof biome === 'number' ? BIOMES[biome] : 'marathon'); }
  }
  onDiscover(xp: number) { this.addXP(xp); }
  onImpact(k: number) { if (this.chain > 0 && k > 0.35) this.dropChain('CRASHED'); }

  // ---------------- per frame ----------------
  update(dt: number, driving: boolean) {
    this.syncTokens(dt);
    if (!driving) return;
    const e = this.g.player, v = e.v, b = v.main.body, lv = b.linvel(), f = v.main.forward(), pos = v.position();
    const spd = Math.hypot(lv.x, lv.z), kmh = spd * 3.6;
    // distance + speed dailies
    this.bump('km', spd * dt / 1000);
    if (kmh > 60) this.bump('speed', Math.floor(kmh), 'max');
    // tokens
    for (const t of this.tokens) {
      if (Math.abs(t.x - pos.x) > 5 || Math.abs(t.z - pos.z) > 5 || Math.abs(t.y - pos.y) > 6) continue;
      if (this.p.tokens!.includes(t.id)) continue;
      this.p.tokens!.push(t.id);
      const n = this.p.tokens!.length, milestone = n % 10 === 0;
      const coins = 250 + (milestone ? 2500 : 0);
      this.p.coins += coins; this.addXP(150); this.bump('tokens', 1);
      this.g.ui.toast(`🪙 Apex Token ${n}/${TOKEN_COUNT}  +${coins.toLocaleString()}${milestone ? '  MILESTONE!' : ''}`, 'coin', 3.5);
      this.g.audio.token(); saveProfile(this.p);
    }
    // ---- skill chain ----
    const fl = Math.hypot(f.x, f.z) || 1;
    const fwd = (lv.x * f.x + lv.z * f.z) / fl, lat = (lv.x * f.z - lv.z * f.x) / fl;
    const angle = Math.atan2(Math.abs(lat), Math.abs(fwd)) * 180 / Math.PI;
    let pts = 0, k = '';
    if (v.onGround && spd > 9 && angle > 12 && angle < 80 && fwd > 0) { pts = spd * (angle - 8) * 0.9 * dt; k = 'DRIFT'; this.driftM += spd * dt; }
    if (!v.onGround) {
      if (this.airStart < 0) this.airStart = this.g.time;
      const air = this.g.time - this.airStart;
      if (air > 0.45 && spd > 6) { pts = 120 * dt * (1 + air); k = 'AIR'; }
    } else if (this.airStart >= 0) { const air = this.g.time - this.airStart; this.airStart = -1; if (air > 0.5) this.bump('air', Math.round(air * 10) / 10, 'max'); }
    if (!k && kmh > 140 && v.onGround) { pts = (kmh - 140) * 1.5 * dt; k = 'SPEED'; }
    if (this.driftM > 1) { this.bump('drift', Math.floor(this.driftM)); this.p.driftTotal! += Math.floor(this.driftM); this.driftM -= Math.floor(this.driftM); }
    if (pts > 0) {
      this.chain += pts * this.mult; this.chainT += dt; this.idle = 0; this.kind = k;
      const m = Math.min(8, 1 + Math.floor(this.chainT / 1.6));
      if (m > this.mult) { this.mult = m; this.g.audio.combo(m); }
    } else if (this.chain > 0) {
      this.idle += dt;
      if (this.idle > 2.2) this.bankChain();
    }
    if (v.flippedT > 0.5 && this.chain > 0) this.dropChain('FLIPPED');
    this.renderHud();
  }
  private bankChain() {
    const pts = Math.round(this.chain);
    if (pts >= 50) {
      const coins = Math.round(pts / 8 / 10) * 10;
      this.p.coins += coins; this.addXP(pts / 4);
      this.bump('chain', pts, 'max');
      this.p.chainBest = Math.max(this.p.chainBest ?? 0, pts);
      this.chainEl.innerHTML = `<b>+${pts.toLocaleString()}</b><small>BANKED · +${coins.toLocaleString()} coins</small>`;
      this.chainEl.className = 'chain banked';
      this.g.audio.coin(); saveProfile(this.p);
      setTimeout(() => { if (this.chain === 0) this.chainEl.className = 'chain hidden'; }, 1600);
    }
    this.chain = 0; this.mult = 1; this.chainT = 0; this.idle = 0;
  }
  private dropChain(why: string) {
    if (this.chain < 30) { this.chain = 0; this.mult = 1; this.chainT = 0; return; }
    this.chainEl.innerHTML = `<b>${why}</b><small>chain of ${Math.round(this.chain).toLocaleString()} lost</small>`;
    this.chainEl.className = 'chain lost';
    this.chain = 0; this.mult = 1; this.chainT = 0; this.idle = 0;
    setTimeout(() => { if (this.chain === 0) this.chainEl.className = 'chain hidden'; }, 1600);
  }

  // ---------------- HUD ----------------
  private buildHud() {
    const hud = this.g.ui.hud;
    this.hud = document.createElement('div'); this.hud.className = 'prog';
    this.hud.innerHTML = `<div class="lvl"><b id="lvl">1</b><div class="xpbar"><i></i></div></div><div class="tok">🪙 <b id="tok">0</b>/${TOKEN_COUNT}</div>`;
    hud.querySelector('.topleft')!.appendChild(this.hud);
    this.lvlEl = this.hud.querySelector('#lvl')!; this.xpBar = this.hud.querySelector('.xpbar i')!;
    this.chainEl = document.createElement('div'); this.chainEl.className = 'chain hidden'; hud.appendChild(this.chainEl);
    this.dailyEl = document.createElement('div'); this.dailyEl.className = 'daily'; hud.appendChild(this.dailyEl);
    this.renderHud();
  }
  private lastDaily = '';
  renderHud() {
    const p = this.p;
    this.lvlEl.textContent = 'LV ' + p.level;
    this.xpBar.style.width = Math.min(100, (p.xp! / xpForLevel(p.level!)) * 100) + '%';
    (this.hud.querySelector('#tok') as HTMLElement).textContent = String(p.tokens!.length);
    if (this.chain > 0) {
      this.chainEl.className = 'chain' + (this.mult >= 4 ? ' hot' : '');
      this.chainEl.innerHTML = `<b>${Math.round(this.chain).toLocaleString()}</b><small>${this.kind} <em>×${this.mult}</em></small>`;
    }
    this.dailyEl.style.display = this.g.race ? 'none' : '';
    const html = this.dailyLines().map((c) => `<div class="${c.done ? 'done' : ''}"><span>${c.done ? '✔' : '○'} ${c.text}</span><i style="width:${Math.min(100, (c.prog / c.target) * 100).toFixed(0)}%"></i></div>`).join('');
    const full = `<h4>DAILY · ${p.daily?.streak ?? 1}-day streak</h4>${html}`;
    if (full !== this.lastDaily) { this.dailyEl.innerHTML = full; this.lastDaily = full; }
  }
}
