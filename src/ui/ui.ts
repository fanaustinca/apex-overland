// All DOM UI: title, HUD + GPS minimap, race overlay, fast-travel map, garage, settings, pause, results, toasts.
import * as THREE from 'three';
import type { Game } from '../game/game';
import { VEHICLES, VEH, UPGRADE_INFO, COMPOUNDS, stats, modsOf, type UpgradeKey, type Compound, type VehicleDef } from '../vehicles/defs';
import { upgradesOf, saveProfile } from '../game/save';
import { PRESETS, type GfxSettings } from '../render/gfx';
import { GARAGES, SPEED_TRAPS } from '../world/props';
import { CABINS } from '../world/roads';
import { BIOME_LABEL, type RaceDef } from '../game/races';
import { HALF, CTRL, N, WORLD, LANDMARKS } from '../world/layout';

const h = (tag: string, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
const fmtT = (t: number) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`; };
const PAINTS = ['#b3261e', '#e8432a', '#ff7a1a', '#f5b600', '#79c232', '#1f8a5b', '#4c6b3c', '#1d6fd6', '#2b5aa8', '#7a2bd6', '#e8e8e8', '#9ea4aa', '#3a3d42', '#111216', '#b08d57', '#ff3d8b'];

export class UI {
  root = document.getElementById('ui')!;
  hud: HTMLElement; mini: HTMLCanvasElement; miniCtx: CanvasRenderingContext2D;
  mapImg!: HTMLCanvasElement;
  private toasts: HTMLElement;
  private raceBox: HTMLElement;
  private panel: HTMLElement | null = null;
  private countdownEl: HTMLElement;
  private arrow: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private mapOpen = false;
  constructor(private g: Game) {
    this.buildMapImage();
    this.hud = h('div', 'hud hidden');
    this.hud.innerHTML = `
      <div class="speedo"><svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="86" class="trk"/><circle cx="100" cy="100" r="86" class="rpm" id="rpm"/></svg>
        <div class="spd"><b id="spd">0</b><small>KM/H</small></div><div class="gear" id="gear">N</div>
        <div class="bars"><div class="nos"><i id="nos"></i><span>NOS</span></div><div class="dmg"><i id="dmg"></i><span>DMG</span></div></div></div>
      <div class="topleft"><div class="coins">⛁ <b id="coins">0</b></div><div class="where"><b id="biome"></b> · <span id="surf"></span></div><div class="veh" id="veh"></div></div>
      <div class="minimap"><canvas width="240" height="240"></canvas><div class="north">N</div></div>
      <div class="keys">W/S throttle·brake · A/D steer · Space handbrake/hop · Shift nitro · R recover · H horn · C camera · M map · G garage · N music · Esc menu</div>
      <div class="fps" id="fps"></div>`;
    this.root.appendChild(this.hud);
    this.mini = this.hud.querySelector('.minimap canvas')!; this.miniCtx = this.mini.getContext('2d')!;
    for (const id of ['spd', 'gear', 'nos', 'dmg', 'coins', 'biome', 'surf', 'veh', 'rpm', 'fps']) this.els[id] = this.hud.querySelector('#' + id)!;
    this.raceBox = h('div', 'racebox hidden'); this.root.appendChild(this.raceBox);
    this.countdownEl = h('div', 'countdown hidden'); this.root.appendChild(this.countdownEl);
    this.arrow = h('div', 'cparrow hidden', '<svg viewBox="0 0 40 40"><path d="M20 3 L35 34 L20 26 L5 34 Z"/></svg><span></span>'); this.root.appendChild(this.arrow);
    this.toasts = h('div', 'toasts'); this.root.appendChild(this.toasts);
    this.title();
  }

  // ---------------- title ----------------
  private title() {
    const t = h('div', 'title');
    t.innerHTML = `<div class="logo big">APEX<span>OVERLAND</span></div>
      <div class="sub">Open-world offroad point-to-point racing · 4 biomes · 18 vehicles · 27 races · 11 garages · 14 landmarks</div>
      <div class="menu"><button class="go primary">DRIVE</button><button class="races">RACES</button><button class="mp">MULTIPLAYER</button><button class="set">GRAPHICS</button><button class="help">HOW TO PLAY</button></div>
      <div class="foot">Coins: ⛁ ${this.g.profile.coins.toLocaleString()} · Barn finds ${this.g.profile.barns.length}/4 · Terrain textures & rocks: Poly Haven (CC0)</div>`;
    this.root.appendChild(t);
    t.querySelector('.go')!.addEventListener('click', () => this.startGame());
    t.querySelector('.races')!.addEventListener('click', () => { this.startGame(); this.toggleMap(); });
    t.querySelector('.mp')!.addEventListener('click', () => { this.startGame(); this.g.mode = 'drive'; this.multiplayer(); });
    t.querySelector('.set')!.addEventListener('click', () => this.settings());
    t.querySelector('.help')!.addEventListener('click', () => this.help());
    const wake = () => { this.g.audio.start(); window.removeEventListener('pointerdown', wake); window.removeEventListener('keydown', wake); };   // title music on first gesture
    window.addEventListener('pointerdown', wake); window.addEventListener('keydown', wake);
  }
  startGame() {
    this.root.querySelector('.title')?.remove();
    this.g.audio.start();
    this.g.mode = 'drive';
    this.hud.classList.remove('hidden');
    this.g.progress.claimStreak();
    if (!this.g.profile.found.includes('intro')) { this.g.profile.found.push('intro'); saveProfile(this.g.profile); this.toast('Welcome to APEX OVERLAND! Press M for the map: race starts, garages and fast travel.', 'ok', 7); this.toast('Rumours say four old barns hide the parts of a legendary 12x12…', 'info', 9); }
  }

  // ---------------- per-frame ----------------
  update(_dt: number) {
    const g = this.g, v = g.player.v;
    if (g.mode === 'title') return;
    this.els.spd.textContent = v.kmh().toFixed(0);
    this.els.gear.textContent = v.stalled > 0 ? 'STALL' : v.gear < 0 ? 'R' : v.kmh() < 1 && g.player.controls.throttle < 0.1 ? 'N' : String(v.gear);
    this.els.gear.classList.toggle('warn', v.stalled > 0);
    const frac = Math.min(1, v.rpm / 6800);
    (this.els.rpm as unknown as SVGCircleElement).style.strokeDashoffset = String(540 - 405 * frac);
    this.els.rpm.classList.toggle('red', frac > 0.85);
    this.els.nos.style.width = (v.st.nitro ? v.nitro * 100 : 0) + '%';
    (this.els.nos.parentElement as HTMLElement).style.opacity = v.st.nitro ? '1' : '0.25';
    this.els.dmg.style.width = Math.min(100, (v.damage + v.axleDamage * 0.5) * 100) + '%';
    this.els.coins.textContent = g.profile.coins.toLocaleString();
    this.els.biome.textContent = g.biomeName();
    this.els.surf.textContent = g.surfaceName() + (v.inWater > 0.15 ? ` · water ${v.inWater.toFixed(1)} m` : '');
    this.els.veh.textContent = g.player.def.name;
    this.els.fps.textContent = `${g.fps.toFixed(0)} fps · ${g.gfx.s.preset}${g.gfx.dyn < 0.99 ? ` · ${Math.round(g.gfx.dyn * 100)}% res` : ""}`;
    this.drawMinimap();
    this.updateRaceHud();
    if (this.mapOpen) this.drawMapOverlay();
  }

  private updateRaceHud() {
    const R = this.g.race;
    if (!R) { this.raceBox.classList.add('hidden'); this.arrow.classList.add('hidden'); this.countdownEl.classList.add('hidden'); return; }
    this.raceBox.classList.remove('hidden');
    const st = this.g.standings(), ms = this.g.mp.standings(), pos = ms ? ms.findIndex((r) => r.me) + 1 : st.indexOf(R.player) + 1, tot = ms ? ms.length : st.length;
    this.raceBox.innerHTML = `<div class="rname">${R.def.name}</div><div class="rpos"><b>${pos}</b><small>/${tot}</small></div>
      <div class="rtime">${fmtT(R.player.finished || R.t + R.penalties)}</div><div class="rcp">${R.def.strict ? `GATE ${Math.min(R.player.cp + 1, R.def.cps.length)}/${R.def.cps.length}` : `${(R.player.remain / 1000).toFixed(2)} km TO FINISH · any route`}</div>
      <ol class="rlist">${(this.g.mp.standings() ?? st.map((r) => ({ name: r.e.name, me: r === R.player, fin: r.finished, rem: r.remain }))).map((r) => `<li class="${r.me ? 'me' : ''}">${r.name}<span>${r.fin ? fmtT(r.fin) : this.g.mp.raceId ? (r.rem / 1000).toFixed(2) + ' km' : ''}</span></li>`).join('')}</ol>`;
    if (R.countdown > 0) { this.countdownEl.classList.remove('hidden'); this.countdownEl.textContent = R.countdown > 3 ? 'READY' : String(Math.ceil(R.countdown)); }
    else if (R.countdown > -1) { this.countdownEl.textContent = 'GO!'; R.countdown -= 0; setTimeout(() => this.countdownEl.classList.add('hidden'), 700); }
    if (!R.player.finished) {
      const c = this.g.nextWaypoint(R.player);
      const p = this.g.player.v.position(), f = this.g.gfx.camera.getWorldDirection(new THREE.Vector3());
      const ang = Math.atan2(c[0] - p.x, c[1] - p.z) - Math.atan2(f.x, f.z);
      this.arrow.classList.remove('hidden');
      (this.arrow.firstElementChild as HTMLElement).style.transform = `rotate(${-ang}rad)`;
      (this.arrow.lastElementChild as HTMLElement).textContent = `${Math.hypot(c[0] - p.x, c[1] - p.z).toFixed(0)} m`;
    } else this.arrow.classList.add('hidden');
  }

  // ---------------- map image ----------------
  private buildMapImage() {
    const w = this.g.world, S = CTRL;
    const c = document.createElement('canvas'); c.width = S; c.height = S;
    const ctx = c.getContext('2d')!, img = ctx.createImageData(S, S);
    const cols = [[196, 120, 80], [176, 116, 86], [160, 96, 66], [74, 86, 52], [96, 124, 64], [238, 242, 246], [128, 120, 108], [150, 138, 120], [96, 78, 58], [146, 120, 92], [170, 150, 120], [80, 80, 82]];
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const o = j * CTRL + i;
      let r = 0, gg = 0, b = 0;
      for (let k = 0; k < 12; k++) { const wt = w.ctrl[(Math.floor(k / 4) * CTRL * CTRL + o) * 4 + (k % 4)] / 255; r += cols[k][0] * wt; gg += cols[k][1] * wt; b += cols[k][2] * wt; }
      const ni = Math.min(N - 1, i * 2), nj = Math.min(N - 1, j * 2), nk = (nj * N + ni) * 4;
      const nx = w.normals[nk] / 127.5 - 1, nz = w.normals[nk + 1] / 127.5 - 1;
      const shade = Math.max(0.35, Math.min(1.25, 0.95 + nx * 0.9 + nz * 0.7)) * (0.75 + 0.25 * w.bake[o * 4] / 255);
      r *= shade; gg *= shade; b *= shade;
      if (w.roadMask[nj * N + ni] > 120) { r = 236; gg = 214; b = 168; }
      if (!Number.isNaN(w.water[o])) { r = 60; gg = 120; b = 170; }
      const p = (j * S + i) * 4; img.data[p] = r; img.data[p + 1] = gg; img.data[p + 2] = b; img.data[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.mapImg = c;
  }
  private w2m(x: number, z: number, S: number) { return [(x + HALF) / WORLD * S, (z + HALF) / WORLD * S]; }
  private w2mm(x: number, z: number, _S: number) { return this.w2m(x, z, CTRL); }

  private drawMinimap() {
    const ctx = this.miniCtx, S = 240, g = this.g, p = g.player.v.position();
    const f = g.gfx.camera.getWorldDirection(new THREE.Vector3());
    const heading = Math.atan2(f.x, f.z);
    const scale = 1.6;                        // minimap px per map px (map px = 4 m)
    ctx.save(); ctx.clearRect(0, 0, S, S);
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); ctx.clip();
    ctx.translate(S / 2, S / 2); ctx.rotate(Math.PI + heading); ctx.scale(scale, scale);
    const [mx, mz] = this.w2mm(p.x, p.z, 1024);
    ctx.drawImage(this.mapImg, -mx, -mz);
    // race routes (GPS)
    const R = g.race;
    if (R) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(90,220,255,0.9)'; ctx.lineWidth = 2.2 / scale * 1.6;
      for (const a of R.def.alts) { ctx.beginPath(); a.forEach(([x, z], i) => { const [u, v] = this.w2mm(x, z, 1024); i ? ctx.lineTo(u - mx, v - mz) : ctx.moveTo(u - mx, v - mz); }); ctx.stroke(); }
      ctx.setLineDash([]); ctx.strokeStyle = '#ff7a1a'; ctx.lineWidth = 3.2 / scale * 1.6;
      ctx.beginPath(); R.def.path.forEach(([x, z], i) => { if (i % 3) return; const [u, v] = this.w2mm(x, z, 1024); i ? ctx.lineTo(u - mx, v - mz) : ctx.moveTo(u - mx, v - mz); }); ctx.stroke();
      R.def.cps.forEach(([x, z], i) => { if (i < R.player.cp) return; const [u, v] = this.w2mm(x, z, 1024); ctx.fillStyle = i === R.player.cp ? '#fff' : i === R.def.cps.length - 1 ? '#4f8' : '#ffb347'; ctx.beginPath(); ctx.arc(u - mx, v - mz, (i === R.player.cp ? 4 : 2.6) / scale * 1.6, 0, Math.PI * 2); ctx.fill(); });
      for (const r of R.racers) if (r !== R.player) { const q = r.e.v.position(); const [u, v] = this.w2mm(q.x, q.z, 1024); ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(u - mx, v - mz, 2.4, 0, Math.PI * 2); ctx.fill(); }
    }
    for (const q of g.mp.positions()) { const [u, v] = this.w2mm(q.p!.x, q.p!.z, 1024); ctx.fillStyle = '#4da3ff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(u - mx, v - mz, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    if (!R) {
      for (const rd of g.races) { const [u, v] = this.w2mm(rd.path[0][0], rd.path[0][1], 1024); ctx.fillStyle = '#ff7a1a'; ctx.fillRect(u - mx - 2.5, v - mz - 2.5, 5, 5); }
      const pp = g.player.v.position();
      for (const t of g.progress?.tokens ?? []) { if (g.profile.tokens?.includes(t.id) || Math.hypot(t.x - pp.x, t.z - pp.z) > 420) continue; const [u, v] = this.w2mm(t.x, t.z, 1024); ctx.fillStyle = '#ffd23a'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(u - mx, v - mz, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      for (const gp of g.props.garagePads) { const [u, v] = this.w2mm(gp.pos.x, gp.pos.z, 1024); ctx.fillStyle = '#5be0ff'; ctx.beginPath(); ctx.arc(u - mx, v - mz, 3, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
    // player arrow (always up)
    ctx.save(); ctx.translate(S / 2, S / 2);
    const vf = g.player.v.main.forward(); ctx.rotate(Math.atan2(vf.x, vf.z) - heading);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    (this.hud.querySelector('.north') as HTMLElement).style.transform = `rotate(${Math.PI + heading}rad) translateY(-104px) rotate(${-(Math.PI + heading)}rad)`;
  }

  // ---------------- full map / fast travel ----------------
  closeAll() { if (this.mapOpen) this.closePanel(true); else if (this.panel) this.closePanel(true); this.g.mode = 'drive'; }
  toggleMap() {
    if (this.mapOpen) { this.closePanel(); return; }
    if (this.g.mode !== 'drive') return;
    this.g.mode = 'map'; this.mapOpen = true;
    const p = this.openPanel('mapview');
    p.innerHTML = `<div class="maphead"><h2>MAP · FAST TRAVEL</h2><div class="legend"><span class="lg g"></span>Garage <span class="lg r"></span>Race start <span class="lg b"></span>Barn find <span class="lg y"></span>Speed trap</div><button class="x">✕</button></div>
      <div class="mapwrap"><canvas class="mapc" width="1024" height="1024"></canvas><div class="mapinfo"></div></div>
      <div class="racelist"></div>`;
    p.querySelector('.x')!.addEventListener('click', () => this.closePanel());
    const list = p.querySelector('.racelist')!;
    const groups: [string, RaceDef[]][] = [[BIOME_LABEL[0], []], [BIOME_LABEL[1], []], [BIOME_LABEL[2], []], [BIOME_LABEL[3], []], ['Cross-Biome Marathons', []]];
    for (const r of this.g.races) groups[r.biome === 'marathon' ? 4 : r.biome][1].push(r);
    list.innerHTML = `<h3>Fast travel · Garages</h3>` + GARAGES.map((gd) => `<div class="raceitem garitem" data-g="${gd.id}"><b>${gd.name}</b><span>${this.g.profile.found.includes('garage:' + gd.id) || gd.main ? 'visited' : 'not yet visited'}</span><button>TRAVEL</button></div>`).join('') + groups.map(([name, rs]) => `<h3>${name}</h3>` + rs.map((r) => {
      const best = this.g.profile.best[r.id], win = this.g.profile.wins[r.id];
      return `<div class="raceitem" data-id="${r.id}"><b>${r.name}</b><span>${(r.path.length * 3 / 1000).toFixed(1)} km · ⛁ ${r.reward.toLocaleString()}${best ? ` · best ${fmtT(best)}` : ''}${win ? ` · ${['🥇', '🥈', '🥉'][win - 1] ?? '#' + win}` : ''}</span><button>RACE</button></div>`;
    }).join('')).join('');
    list.querySelectorAll('.garitem').forEach((el) => {
      el.querySelector('button')!.addEventListener('click', () => { const id = (el as HTMLElement).dataset.g!; if (this.g.race) this.g.endRace(); this.closePanel(); this.g.teleportGarage(id); this.toast(`Teleported to ${GARAGES.find((x) => x.id === id)!.name}`, 'ok'); });
    });
    list.querySelectorAll('.raceitem:not(.garitem)').forEach((el) => {
      el.querySelector('button')!.addEventListener('click', () => { this.closePanel(); this.g.startRace((el as HTMLElement).dataset.id!); });
      el.addEventListener('mouseenter', () => { this.hoverRace = (el as HTMLElement).dataset.id!; });
      el.addEventListener('mouseleave', () => { this.hoverRace = ''; });
    });
    const cv = p.querySelector('.mapc') as HTMLCanvasElement;
    cv.addEventListener('click', (ev) => {
      const r = cv.getBoundingClientRect();
      const mx = (ev.clientX - r.left) / r.width * 1024, mz = (ev.clientY - r.top) / r.height * 1024;
      const hit = this.mapIcons().find((ic) => Math.hypot(ic.u - mx, ic.v - mz) < 14);
      if (!hit) return;
      if (hit.kind === 'race') { this.closePanel(); this.g.startRace(hit.id); }
      else if (hit.kind === 'landmark') {
        if (!this.g.profile.found.includes('landmark:' + hit.id)) { this.toast('Undiscovered landmark: drive there first', 'warn'); return; }
        if (this.g.race) this.g.endRace();
        this.closePanel(); this.g.teleportLandmark(hit.id); this.toast(`Teleported to ${hit.label}`, 'ok');
      }
      else if (hit.kind === 'garage' || hit.kind === 'barn') {
        if (this.g.race) this.g.endRace();
        this.closePanel();
        if (hit.kind === 'garage') this.g.teleportGarage(hit.id); else { const c = CABINS.find((x) => x.id === hit.id)!; this.g.teleport(c.x + Math.sin(c.yaw) * 22, c.z + Math.cos(c.yaw) * 22, c.yaw + Math.PI); }
        this.toast(`Teleported to ${hit.label}`, 'ok');
      }
    });
    cv.addEventListener('mousemove', (ev) => {
      const r = cv.getBoundingClientRect();
      const mx = (ev.clientX - r.left) / r.width * 1024, mz = (ev.clientY - r.top) / r.height * 1024;
      const hit = this.mapIcons().find((ic) => Math.hypot(ic.u - mx, ic.v - mz) < 14);
      cv.style.cursor = hit ? 'pointer' : 'default';
      const info = p.querySelector('.mapinfo') as HTMLElement;
      info.textContent = hit ? hit.label + (hit.kind === 'race' ? ' — click to race' : hit.kind === 'landmark' ? (this.g.profile.found.includes('landmark:' + hit.id) ? ' — click to fast travel' : ' — undiscovered: drive there to find it') : ' — click to fast travel') : '';
      this.hoverRace = hit?.kind === 'race' ? hit.id : '';
    });
    this.drawMapOverlay();
  }
  private hoverRace = '';
  private mapIcons() {
    const icons: { kind: string; id: string; u: number; v: number; label: string }[] = [];
    for (const gd of GARAGES) {
      const [u, v] = this.w2m(gd.x, gd.z, 1024);
      icons.push({ kind: 'garage', id: gd.id, u, v, label: gd.name });
    }
    for (const r of this.g.races) { const [u, v] = this.w2m(r.path[0][0], r.path[0][1], 1024); icons.push({ kind: 'race', id: r.id, u, v, label: r.name }); }
    for (const c of CABINS) if (this.g.profile.barns.includes(c.id)) { const [u, v] = this.w2m(c.x, c.z, 1024); icons.push({ kind: 'barn', id: c.id, u, v, label: c.name }); }
    for (const l of LANDMARKS) { const [u, v] = this.w2m(l.x, l.z, 1024); const f = this.g.profile.found.includes('landmark:' + l.id); icons.push({ kind: 'landmark', id: l.id, u, v, label: f ? l.name : `??? (${l.reward} reward)` }); }
    return icons;
  }
  private drawMapOverlay() {
    const cv = this.panel?.querySelector('.mapc') as HTMLCanvasElement | null;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(this.mapImg, 0, 0, 1024, 1024);
    const shown = this.g.race?.def ?? this.g.races.find((r) => r.id === this.hoverRace);
    if (shown) {
      ctx.lineCap = 'round'; ctx.setLineDash([8, 6]); ctx.strokeStyle = 'rgba(90,220,255,0.95)'; ctx.lineWidth = 3;
      for (const a of shown.alts) { ctx.beginPath(); a.forEach(([x, z], i) => { const [u, v] = this.w2m(x, z, 1024); i ? ctx.lineTo(u, v) : ctx.moveTo(u, v); }); ctx.stroke(); }
      ctx.setLineDash([]); ctx.strokeStyle = '#ff7a1a'; ctx.lineWidth = 4;
      ctx.beginPath(); shown.path.forEach(([x, z], i) => { const [u, v] = this.w2m(x, z, 1024); i ? ctx.lineTo(u, v) : ctx.moveTo(u, v); }); ctx.stroke();
      for (const [x, z] of shown.cps) { const [u, v] = this.w2m(x, z, 1024); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(u, v, 4, 0, 7); ctx.fill(); }
    }
    ctx.font = 'bold 13px Segoe UI, Arial'; ctx.textAlign = 'center';
    for (const ic of this.mapIcons()) {
      const col = ic.kind === 'garage' ? '#5be0ff' : ic.kind === 'race' ? '#ff7a1a' : '#c084fc';
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(ic.u, ic.v, 10, 0, 7); ctx.fill();
      if (ic.kind === 'landmark') { ctx.fillStyle = this.g.profile.found.includes('landmark:' + ic.id) ? '#ffd21a' : '#8a8a8a'; ctx.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 3.2 : 8; ctx.lineTo(ic.u + Math.cos(a) * r, ic.v + Math.sin(a) * r); } ctx.closePath(); ctx.fill(); }
      else { ctx.fillStyle = col; ctx.beginPath(); if (ic.kind === 'race') { ctx.moveTo(ic.u - 6, ic.v + 6); ctx.lineTo(ic.u - 6, ic.v - 7); ctx.lineTo(ic.u + 6, ic.v - 3); ctx.lineTo(ic.u - 4, ic.v + 1); } else ctx.arc(ic.u, ic.v, 6, 0, 7); ctx.fill(); }
      if (ic.kind !== 'race' || ic.id === this.hoverRace) { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeText(ic.label, ic.u, ic.v - 15); ctx.fillText(ic.label, ic.u, ic.v - 15); }
    }
    for (const s of SPEED_TRAPS) { const [u, v] = this.w2m(s.x, s.z, 1024); ctx.fillStyle = '#ffd21a'; ctx.fillRect(u - 4, v - 4, 8, 8); }
    const p = this.g.player.v.position(), f = this.g.player.v.main.forward();
    const [u, v] = this.w2m(p.x, p.z, 1024);
    ctx.save(); ctx.translate(u, v); ctx.rotate(Math.atan2(-f.x, f.z) + Math.PI);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(8, 9); ctx.lineTo(0, 4); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }

  // ---------------- panels ----------------
  private openPanel(cls: string) { this.closePanel(true); this.panel = h('div', 'panel ' + cls); this.root.appendChild(this.panel); return this.panel; }
  closePanel(keepMode = false) {
    this.panel?.remove(); this.panel = null; this.mapOpen = false;
    if (!keepMode && this.g.mode !== 'title') { if (this.g.mode === 'garage') this.leaveGarage(); this.g.mode = 'drive'; }
  }
  escape() {
    if (this.panel) { this.closePanel(); return; }
    if (this.g.mode === 'drive') this.pause();
  }
  private pause() {
    this.g.mode = 'pause';
    const p = this.openPanel('pause small');
    const R = this.g.race;
    p.innerHTML = `<h2>PAUSED</h2><div class="menu"><button class="resume primary">RESUME</button>${R ? '<button class="restart">RESTART RACE</button><button class="quit">QUIT RACE</button>' : ''}<button class="mapb">MAP & RACES</button><button class="mpb">MULTIPLAYER${this.g.mp.active ? ` · ${this.g.mp.remotes.size + 1} ONLINE` : ''}</button><button class="gar">GARAGE (nearest)</button><button class="set">GRAPHICS</button><button class="help">HOW TO PLAY</button></div>`;
    p.querySelector('.resume')!.addEventListener('click', () => this.closePanel());
    p.querySelector('.restart')?.addEventListener('click', () => { const id = R!.def.id; this.closePanel(); this.g.startRace(id); });
    p.querySelector('.quit')?.addEventListener('click', () => { this.closePanel(); this.g.endRace(); });
    p.querySelector('.mapb')!.addEventListener('click', () => { this.closePanel(); this.toggleMap(); });
    p.querySelector('.mpb')!.addEventListener('click', () => this.multiplayer());
    p.querySelector('.gar')!.addEventListener('click', () => { this.closePanel(); if (this.g.race) this.g.endRace(); const n = this.g.nearestGarage(); this.g.teleportGarage(n.id); this.openGarage(); });
    p.querySelector('.set')!.addEventListener('click', () => this.settings());
    p.querySelector('.help')!.addEventListener('click', () => this.help());
  }
  // ---------------- multiplayer ----------------
  multiplayer() {
    const mp = this.g.mp, back = this.g.mode;
    this.g.mode = 'pause';
    const p = this.openPanel('pause mp');
    const esc = (t: string) => t.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
    const render = () => {
      const players = [`${esc(mp.name)} (you${mp.isHost ? ', host' : ''})`, ...[...mp.remotes.values()].map((r) => esc(r.name))];
      p.innerHTML = `<h2>MULTIPLAYER</h2>
        <label class="row"><span>Your name</span><input class="mpname" maxlength="16" value="${esc(mp.name)}"></label>
        ${mp.active ? `<div class="mpstat">${esc(mp.status)}</div>
          <div class="mpcode">Lobby code <b>${mp.code}</b><button class="copy">COPY</button></div>
          <h3>Drivers (${players.length}/8)</h3><ul class="mplist">${players.map((n) => `<li>${n}</li>`).join('')}</ul>
          <p class="hint">${mp.isHost ? 'You are the host: any race you start from the map starts for everyone in the lobby.' : 'The host picks the races. Free-roam together anywhere in the world.'} Press <b>T</b> to chat.</p>
          <div class="menu"><button class="leave">LEAVE LOBBY</button><button class="primary done">PLAY</button></div>`
        : `<p class="hint">Drive the same world with up to 7 friends. Host a lobby and share the 5-letter code, or join a friend's.</p>
          <div class="menu"><button class="primary host">HOST A LOBBY</button></div>
          <div class="joinrow"><input class="code" maxlength="5" placeholder="CODE" autocomplete="off"><button class="join">JOIN</button></div>
          <div class="mpstat err"></div><div class="menu"><button class="done">BACK</button></div>`}`;
      const nameIn = p.querySelector('.mpname') as HTMLInputElement;
      nameIn.addEventListener('change', () => { mp.setName(nameIn.value.trim()); });
      const err = (e: unknown) => { const el = p.querySelector('.err'); if (el) el.textContent = (e as Error).message || String(e); else this.toast(String((e as Error).message || e), 'warn'); };
      p.querySelector('.host')?.addEventListener('click', async (ev) => { (ev.target as HTMLButtonElement).disabled = true; (ev.target as HTMLButtonElement).textContent = 'OPENING…'; try { await mp.host(); render(); } catch (e) { render(); err(e); } });
      const joinBtn = p.querySelector('.join') as HTMLButtonElement | null, codeIn = p.querySelector('.code') as HTMLInputElement | null;
      const doJoin = async () => { if (!codeIn || codeIn.value.trim().length < 5) { err(new Error('Enter the 5-letter code')); return; } joinBtn!.disabled = true; joinBtn!.textContent = '…'; try { await mp.join(codeIn.value); render(); } catch (e) { render(); err(e); } };
      joinBtn?.addEventListener('click', doJoin); codeIn?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
      p.querySelector('.copy')?.addEventListener('click', () => { navigator.clipboard?.writeText(mp.code); this.toast('Code copied', 'ok', 1.5); });
      p.querySelector('.leave')?.addEventListener('click', () => { mp.leave(); render(); });
      p.querySelector('.done')!.addEventListener('click', () => { mp.setName(nameIn.value.trim()); this.closePanel(true); this.g.mode = back === 'title' ? 'drive' : back === 'pause' || back === 'map' ? 'drive' : back; });
    };
    render();
    const iv = setInterval(() => { if (!p.isConnected) { clearInterval(iv); return; } const list = p.querySelector('.mplist'); if (list && list.children.length !== mp.remotes.size + 1) render(); }, 1000);
  }
  /** T: one-line chat box. */
  openChat() {
    if (!this.g.mp.active || this.root.querySelector('.chatbox')) return;
    const box = h('div', 'chatbox', '<input maxlength="120" placeholder="Say something… (Enter to send, Esc to cancel)">');
    this.root.appendChild(box);
    const inp = box.querySelector('input')!; inp.focus();
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { this.g.mp.chat(inp.value); box.remove(); } else if (e.key === 'Escape') box.remove(); });
    inp.addEventListener('blur', () => setTimeout(() => box.remove(), 100));
  }
  help() {
    const back = this.g.mode;
    const p = this.openPanel('help');
    p.innerHTML = `<h2>HOW TO PLAY</h2><div class="cols">
      <div><h3>Driving</h3><p><b>W / ↑</b> throttle · <b>S / ↓</b> brake & reverse · <b>A D</b> steer<br><b>Space</b> handbrake (bike: bunny-hop) · <b>Shift</b> nitrous · <b>R</b> recover<br><b>H</b> horn · <b>N</b> music on/off · <b>T</b> chat (multiplayer)<br><b>C</b> chase / far / hood camera · drag mouse to look around · wheel to zoom<br>Gamepad: RT/LT throttle/brake, stick steer, A handbrake, B nitro.</p>
      <h3>Progression</h3><p>Drift, catch air or go flat-out to build a <b>skill chain</b>. Its multiplier grows while you keep it alive, and it banks into coins and XP when you ease off (crash and it's gone). Hunt the <b>50 Apex Tokens</b> (light beams), clear the <b>three daily challenges</b> and keep your daily streak going.</p>
      <h3>Multiplayer</h3><p>Menu → Multiplayer: host a lobby and share the code, or join a friend's. The host's races start for everyone.</p>
      <h3>World</h3><p>One seamless 5 × 5 km world: Desert Canyon (south), Dense Forest (east), Snowy Mountain (north) and Industrial Quarry (west), meeting at the Central Hub Garage. There are no invisible walls — cut through dunes, forests and cliffs.</p></div>
      <div><h3>Earning coins</h3><p>Races are point to point: waypoints show the GPS route, but only the finish counts — take any line you dare (the frozen-lake slalom and the MX track make you take every gate). Win races, blast through <b>speed traps</b> (yellow on the map), land <b>big jumps</b> (the canyon narrows pay triple) and discover outpost garages.</p>
      <h3>Garage & upgrades</h3><p>Press <b>G</b> near any garage. Engine, suspension, tyres (and compounds for sand, mud and snow), frame/cage, front plow, axles/skid plates, nitrous, snorkel and winch all change both handling and the 3-D model. A <b>Heavy Steel Dozer Plow</b> on a heavyweight or juggernaut lets you carve straight through forests.</p>
      <h3>The Snake</h3><p>Somewhere off the main trails four weathered barns hide the parts of a 12×12 articulated monster. Look for faint tyre ruts, broken fences, old signposts and chimney smoke.</p></div></div>
      <button class="primary back">BACK</button>`;
    p.querySelector('.back')!.addEventListener('click', () => { this.closePanel(true); if (back === 'title') { this.g.mode = 'title'; } else this.g.mode = back === 'pause' ? 'drive' : back; });
  }

  // ---------------- settings ----------------
  settings() {
    const prevMode = this.g.mode;
    const p = this.openPanel('settings');
    const s: GfxSettings = { ...this.g.gfx.s };
    const render = () => {
      p.innerHTML = `<h2>GRAPHICS</h2>
        <div class="presets">${(['potato', 'medium', 'high', 'ultra'] as const).map((k) => `<button data-p="${k}" class="${s.preset === k ? 'on' : ''}">${{ potato: 'LOW-POLY / POTATO', medium: 'MEDIUM', high: 'HIGH', ultra: 'ULTRA REALISM' }[k]}</button>`).join('')}</div>
        <div class="sliders">
          ${slider('terrain', 'Terrain mesh & texture detail', s.terrain, 0, 3, 1, ['Low-poly faceted', 'Textured', 'PBR + triplanar', 'PBR + triplanar + anti-tiling'])}
          ${slider('shadows', 'Shadow quality', s.shadows, 0, 3, 1, ['Off', '1024 PCF', '2048 PCF', '4096 PCF soft'])}
          ${slider('shadowDist', 'Shadow distance', s.shadowDist, 40, 220, 10)}
          ${slider('foliage', 'Foliage & tree density', s.foliage, 0.2, 1, 0.05, null, true)}
          ${slider('drawDist', 'Draw distance', s.drawDist, 0.35, 1, 0.05, null, true)}
          ${slider('particles', 'Dust / mud / snow particles', s.particles, 0, 1, 0.05, null, true)}
          ${slider('resScale', 'Render resolution', s.resScale, 0.5, 1, 0.05, null, true)}
          <label class="row"><span>Anti-aliasing</span><select data-k="aa">${['off', 'fxaa', 'msaa', 'msaa+fxaa'].map((a) => `<option ${s.aa === a ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
          <div class="toggles">${(['tonemap', 'ssao', 'bloom', 'godrays', 'motionBlur'] as const).map((k) => `<label><input type="checkbox" data-t="${k}" ${s[k] ? 'checked' : ''}> ${{ tonemap: 'ACES filmic tone mapping', ssao: 'SSAO (GTAO)', bloom: 'Bloom', godrays: 'Volumetric sun god-rays', motionBlur: 'Motion blur' }[k]}</label>`).join('')}</div>
          <label class="row"><span>Master volume</span><input type="range" min="0" max="1" step="0.05" value="${this.g.audio.volume}" data-vol></label>
          <label class="row"><span>Music volume (N toggles)</span><input type="range" min="0" max="1" step="0.05" value="${this.g.audio.musicVol}" data-mus></label>
        </div><button class="primary back">DONE</button>`;
      p.querySelectorAll('.presets button').forEach((b) => b.addEventListener('click', () => { Object.assign(s, PRESETS[(b as HTMLElement).dataset.p as keyof typeof PRESETS]); this.g.applySettings({ ...s }); render(); }));
      p.querySelectorAll('input[type=range][data-k]').forEach((el) => el.addEventListener('change', () => { const k = (el as HTMLInputElement).dataset.k as keyof GfxSettings; (s as unknown as Record<string, number>)[k] = +(el as HTMLInputElement).value; s.preset = 'custom'; this.g.applySettings({ ...s }); render(); }));
      p.querySelectorAll('input[type=checkbox]').forEach((el) => el.addEventListener('change', () => { const k = (el as HTMLInputElement).dataset.t as 'ssao'; s[k] = (el as HTMLInputElement).checked; s.preset = 'custom'; this.g.applySettings({ ...s }); }));
      p.querySelector('select')!.addEventListener('change', (e) => { s.aa = (e.target as HTMLSelectElement).value as GfxSettings['aa']; s.preset = 'custom'; this.g.applySettings({ ...s }); });
      p.querySelector('[data-vol]')!.addEventListener('input', (e) => { this.g.audio.setVolume(+(e.target as HTMLInputElement).value); this.g.profile.volume = this.g.audio.volume; saveProfile(this.g.profile); });
      p.querySelector('[data-mus]')!.addEventListener('input', (e) => { this.g.audio.setMusic(+(e.target as HTMLInputElement).value, true); this.g.profile.musicVol = this.g.audio.musicVol; this.g.profile.musicOn = true; saveProfile(this.g.profile); });
      p.querySelector('.back')!.addEventListener('click', () => { this.closePanel(true); this.g.mode = prevMode === 'pause' ? 'drive' : prevMode; if (prevMode === 'title') this.g.mode = 'title'; });
    };
    render();
  }

  // ---------------- garage ----------------
  openGarage() {
    const g = this.g;
    if (g.race) g.endRace();
    g.mode = 'garage';
    g.camYaw = -0.35; g.camPitch = 0.16; g.camDist = 1.05;   // sun behind the camera
    const near = g.nearestGarage();
    if (near.d > 40) g.teleportGarage(near.id);
    const pad = g.props.garagePads.find((x) => x.id === g.nearestGarage().id)!;
    g.place(g.player, pad.pos.x, pad.pos.z, pad.yaw + Math.PI);
    this.hud.classList.add('hidden');
    const p = this.openPanel('garage');
    let tab: 'vehicles' | 'upgrades' | 'paint' = 'upgrades';
    const render = () => {
      const prof = g.profile, cur = g.player.def, up = upgradesOf(prof, cur.id), st = stats(cur, up);
      const bar = (label: string, v: number) => `<div class="stat"><span>${label}</span><i><b style="width:${Math.max(4, Math.min(100, v * 100)).toFixed(0)}%"></b></i></div>`;
      const offroad = (st.rideLift * 2 + st.travel + cur.wheelR) / 2.4;
      const statBlock = bar('Top speed', st.top / 52) + bar('Acceleration', Math.min(1, st.power / cur.mass * 4.5)) + bar('Grip', st.grip / 2.0) + bar('Offroad', offroad) + bar('Durability', (1 / st.damageMul) / 2.6 + cur.mass / 120000) + bar('Weight', Math.min(1, Math.log10(cur.mass) / 4.8));
      p.innerHTML = `<div class="gtop"><div><div class="gname">${g.props.garagePads.length ? (GARAGES.find((x) => x.id === g.nearestGarage().id)?.name ?? 'Garage') : 'Garage'}</div><h2>${cur.name}</h2><div class="gcls">${cur.cls} · ${(cur.mass * modsOf(cur) / 1000).toFixed(1)} t · ${cur.wheels.length * modsOf(cur)} wheels</div></div><div class="coins big">⛁ ${prof.coins.toLocaleString()}</div></div>
        <div class="tabs">${(['upgrades', 'vehicles', 'paint'] as const).map((t) => `<button data-tab="${t}" class="${tab === t ? 'on' : ''}">${t.toUpperCase()}</button>`).join('')}</div>
        <div class="gbody">${tab === 'vehicles' ? this.vehicleList() : tab === 'paint' ? this.paintList(up.paint ?? cur.color) : this.upgradeList(cur, up)}</div>
        <div class="stats">${statBlock}</div>
        <div class="gfoot"><span>Drag to orbit · wheel to zoom</span><button class="primary leave">DRIVE ▶</button></div>`;
      p.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = (b as HTMLElement).dataset.tab as typeof tab; render(); }));
      p.querySelector('.leave')!.addEventListener('click', () => this.closePanel());
      p.querySelectorAll('[data-buyup]').forEach((b) => b.addEventListener('click', () => {
        const [k, tier] = (b as HTMLElement).dataset.buyup!.split(':'); const key = k as UpgradeKey, t = +tier;
        const info = UPGRADE_INFO[key];
        const owned = (up as unknown as Record<string, number>)[key];
        const cost = t > owned ? info.cost.slice(owned, t).reduce((a, c) => a + c, 0) : 0;
        if (cost > prof.coins) { this.toast('Not enough coins', 'warn'); return; }
        prof.coins -= cost; (up as unknown as Record<string, number>)[key] = t; saveProfile(prof);
        g.spawnPlayer(cur.id); g.place(g.player, pad.pos.x, pad.pos.z, pad.yaw + Math.PI); g.audio.coin(); render();
      }));
      p.querySelectorAll('[data-comp]').forEach((b) => b.addEventListener('click', () => {
        const c = (b as HTMLElement).dataset.comp as Compound;
        const key = 'comp:' + cur.id + ':' + c;
        if (!prof.found.includes(key) && c !== 'allterrain') { if (COMPOUNDS[c].cost > prof.coins) { this.toast('Not enough coins', 'warn'); return; } prof.coins -= COMPOUNDS[c].cost; prof.found.push(key); }
        up.compound = c; saveProfile(prof); g.spawnPlayer(cur.id); g.place(g.player, pad.pos.x, pad.pos.z, pad.yaw + Math.PI); render();
      }));
      p.querySelectorAll('[data-veh]').forEach((b) => b.addEventListener('click', () => {
        const id = (b as HTMLElement).dataset.veh!, d = VEH[id];
        if (!prof.owned.includes(id)) {
          if (id === 'snake') { this.toast(`The Snake: find all four barn parts first (${prof.barns.length}/4)`, 'warn'); return; }
          if (d.price > prof.coins) { this.toast('Not enough coins', 'warn'); return; }
          prof.coins -= d.price; prof.owned.push(id); g.audio.coin();
        }
        saveProfile(prof); g.spawnPlayer(id); g.place(g.player, pad.pos.x, pad.pos.z, pad.yaw + Math.PI); render();
      }));
      p.querySelectorAll('[data-paint]').forEach((b) => b.addEventListener('click', () => { up.paint = (b as HTMLElement).dataset.paint!; saveProfile(prof); g.spawnPlayer(cur.id); g.place(g.player, pad.pos.x, pad.pos.z, pad.yaw + Math.PI); render(); }));
      p.querySelector('[data-wash]')?.addEventListener('click', () => { g.player.dirt = 0; g.player.snow = 0; g.player.v.damage = 0; g.player.v.axleDamage = 0; this.toast('Washed & repaired', 'ok'); });
    };
    render();
  }
  private leaveGarage() { this.hud.classList.remove('hidden'); this.g.camYaw = 0; this.g.camPitch = 0.12; }
  private vehicleList() {
    const prof = this.g.profile;
    const order = ['Featherweight', 'Lightweight', 'Mid-Weight', 'Heavyweight', 'Juggernaut', 'Secret'];
    return order.map((cls) => `<h3>${cls}</h3>` + VEHICLES.filter((v) => v.cls === cls).map((v) => {
      const owned = prof.owned.includes(v.id), cur = this.g.player.def.id === v.id;
      const lock = v.id === 'snake' && !owned;
      return `<div class="vitem ${cur ? 'cur' : ''}"><div><b>${v.name}</b><small>${v.blurb}</small></div><button data-veh="${v.id}" ${cur ? 'disabled' : ''}>${cur ? 'DRIVING' : owned ? 'SELECT' : lock ? `🔒 ${prof.barns.length}/4 PARTS` : `BUY ⛁ ${v.price.toLocaleString()}`}</button></div>`;
    }).join('')).join('');
  }
  private paintList(cur: string) {
    return `<h3>Paint (metallic clear-coat)</h3><div class="swatches">${PAINTS.map((c) => `<button data-paint="${c}" class="${c === cur ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div><h3>Service</h3><button data-wash class="wide">Wash, de-mud & repair (free)</button>`;
  }
  private upgradeList(d: VehicleDef, up: ReturnType<typeof upgradesOf>) {
    const sections: [string, UpgradeKey[]][] = [['Engine & Drivetrain', ['engine']], ['Suspension', ['suspension']], ['Tires & Wheels', ['tires']], ['Split 4x4 Chassis & Armor', ['frame', 'plow', 'axles']], ['Utility / Auxiliaries', ['nitro', 'snorkel', 'winch']]];
    return sections.map(([name, keys]) => `<div class="usec"><h3>${name}</h3>` + keys.map((k) => {
      const info = UPGRADE_INFO[k];
      if (k === 'plow' && !d.plowable) return `<div class="uitem dis"><b>${info.name}</b><small>Heavyweights & Juggernauts only</small></div>`;
      const cur = (up as unknown as Record<string, number>)[k];
      const tiers = Array.from({ length: info.max + (info.max === 1 ? 1 : 0) }, (_, i) => (info.max === 1 ? i : i + 1));
      return `<div class="uitem"><div class="uh"><b>${info.name}</b><small>${info.desc[Math.max(0, cur - (info.max === 1 ? 0 : 1))] ?? ''}</small></div><div class="tiers">${tiers.map((t) => {
        const owned = t <= cur; const cost = t > cur ? info.cost.slice(info.max === 1 ? cur : cur, t + (info.max === 1 ? 0 : 0)).reduce((a, c) => a + c, 0) : 0;
        const label = info.max === 1 ? (t ? 'FIT' : 'NONE') : 'T' + t;
        return `<button data-buyup="${k}:${t}" class="${t === cur ? 'on' : owned ? 'own' : ''}" title="${info.desc[info.max === 1 ? t : t - 1] ?? ''}">${label}${!owned && cost ? `<small>⛁${(cost / 1000).toFixed(1)}k</small>` : ''}</button>`;
      }).join('')}</div></div>` + (k === 'tires' ? `<div class="uitem"><div class="uh"><b>Tire compound</b><small>Grip per surface: asphalt / dirt / sand / mud / snow / ice</small></div><div class="tiers">${(Object.keys(COMPOUNDS) as Compound[]).map((c) => `<button data-comp="${c}" class="${up.compound === c ? 'on' : ''}">${COMPOUNDS[c].name}${c !== 'allterrain' && !this.g.profile.found.includes('comp:' + d.id + ':' + c) ? `<small>⛁${(COMPOUNDS[c].cost / 1000).toFixed(1)}k</small>` : ''}</button>`).join('')}</div></div>` : '');
    }).join('') + '</div>').join('');
  }

  // ---------------- race overlays ----------------
  raceStart(def: RaceDef) { this.closePanel(true); this.hud.classList.remove('hidden'); this.toast(`${def.name}: ${def.desc}`, 'info', 6); }
  raceEnd() { this.toast('Race abandoned', 'warn'); }
  flashCp(n: number, total: number) { if (n < total) this.toast(`Checkpoint ${n}/${total}`, 'cp', 1.5); }
  results(def: RaceDef, place: number, time: number, reward: number, best: boolean, order: { e: { name: string }; finished: number }[]) {
    const g = this.g, race = g.race;
    setTimeout(() => {
      if (!race || g.race !== race) return;   // quit, restarted or teleported away in the meantime
      g.mode = 'results';
      const p = this.openPanel('results small');
      p.innerHTML = `<h2>${place === 1 ? '🏆 VICTORY' : place <= 3 ? 'PODIUM!' : 'FINISHED'}</h2><div class="rbig">${['1ST', '2ND', '3RD'][place - 1] ?? place + 'TH'}</div>
        <div class="rmeta">${def.name} · ${fmtT(time)}${best ? ' · <b>NEW BEST</b>' : ''}</div><div class="reward">+ ⛁ ${reward.toLocaleString()}</div>
        <ol class="rlist">${order.map((r) => `<li>${r.e.name}<span>${r.finished ? fmtT(r.finished) : 'DNF'}</span></li>`).join('')}</ol>
        <div class="menu row"><button class="again">RACE AGAIN</button><button class="primary ok">CONTINUE</button></div>`;
      p.querySelector('.ok')!.addEventListener('click', () => { this.closePanel(); g.endRace(true); });
      p.querySelector('.again')!.addEventListener('click', () => { this.closePanel(); g.startRace(def.id); });
    }, 1200);
  }
  barnFound(name: string, prize: string, n: number, all: boolean) {
    const g = this.g; g.mode = 'results';
    const p = this.openPanel('results small barn');
    p.innerHTML = `<h2>BARN FIND!</h2><div class="rmeta">${name}</div><div class="prize">${prize}</div><div class="reward">+ ⛁ 2,000</div>
      <div class="parts">${[0, 1, 2, 3].map((i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div>
      <p>${all ? '<b>All four parts recovered! THE SNAKE 12x12 is waiting in every garage.</b>' : `${n}/4 parts found. Keep looking for faint ruts, broken fences and chimney smoke.`}</p>
      <div class="menu row">${all ? '<button class="gar primary">ASSEMBLE IN GARAGE</button>' : ''}<button class="ok">CONTINUE</button></div>`;
    p.querySelector('.ok')!.addEventListener('click', () => this.closePanel());
    p.querySelector('.gar')?.addEventListener('click', () => { this.closePanel(); g.teleportGarage('hub'); this.openGarage(); });
  }
  toast(msg: string, kind = 'info', sec = 3.5) {
    const t = h('div', 'toast ' + kind, msg);
    this.toasts.appendChild(t);
    setTimeout(() => t.classList.add('out'), sec * 1000);
    setTimeout(() => t.remove(), sec * 1000 + 500);
    while (this.toasts.children.length > 5) this.toasts.firstElementChild!.remove();
  }
}

function slider(k: string, label: string, v: number, min: number, max: number, step: number, names: string[] | null = null, pct = false) {
  const shown = names ? names[Math.round(v)] : pct ? Math.round(v * 100) + '%' : String(v);
  return `<label class="row"><span>${label}</span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v}"><em>${shown}</em></label>`;
}
