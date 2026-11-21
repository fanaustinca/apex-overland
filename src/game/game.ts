// Game orchestrator: boot, systems, modes (title / drive / garage / map / pause), races, free roam economy.
import * as THREE from 'three';
import { Gfx, PRESETS, type GfxSettings } from '../render/gfx';
import { Terrain } from '../world/terrain';
import type { World } from '../world/finish';
import { SURF_NAMES } from '../world/finish';
import GenWorker from '../world/gen.worker?worker';
import RowsWorker from '../world/rows.worker?worker';
import { VEHICLES, VEH, STOCK, stats, type Upgrades } from '../vehicles/defs';
import { buildVisual } from '../vehicles/models';
import { sampleH } from '../world/gen';
import { CTRL, HALF, V, BIOME_NAMES, biomeWeights, HUB, LAKES } from '../world/layout';
import { Physics, initRapier, type RAPIER } from '../physics/physics';
import { Foliage } from '../world/foliage';
import { Water } from '../world/water';
import { Grass } from '../world/grass';
import { Props, GARAGES, SPEED_TRAPS, JUMP_TRAPS } from '../world/props';
import { CABINS } from '../world/roads';
import { Particles, P } from '../fx/particles';
import { VehicleEntity } from './entity';
import { Input } from './input';
import { Driver } from './ai';
import { buildRaces, type RaceDef } from './races';
import { loadProfile, saveProfile, upgradesOf, type Profile } from './save';
import { UPGRADE_INFO } from '../vehicles/defs';
import { UI } from '../ui/ui';
import { Audio } from './audio';
import { assetUrl } from '../core/assets';

declare global { interface Window { AO: any; dev: any } }

/** World generation across workers: noise rows in parallel, the sequential core in one worker, then shading rows in parallel. */
export async function loadWorld(onLog: (s: string) => void): Promise<World> {
  const K = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
  const pool = Array.from({ length: K }, () => new RowsWorker());
  const run = <T,>(wk: Worker, msg: unknown, transfer: Transferable[] = []) => new Promise<T>((res, rej) => { wk.onmessage = (e) => res(e.data); wk.onerror = rej; wk.postMessage(msg, transfer); });
  const split = (n: number) => Array.from({ length: K }, (_, k) => [Math.floor(n * k / K), Math.floor(n * (k + 1) / K)]);
  let t = performance.now();
  const parts = await Promise.all(split(V).map(([j0, j1], k) => run<{ h: Float32Array }>(pool[k], { stage: 'base', j0, j1 })));
  const rows = new Float32Array(V * V);
  split(V).forEach(([j0], k) => rows.set(parts[k].h, j0 * V));
  onLog(`terrain ${Math.round(performance.now() - t)}ms (${K} workers)`); t = performance.now();
  const wd = await new Promise<World>((resolve, reject) => {
    const w = new GenWorker();
    w.onmessage = (e) => { if (e.data.log) onLog(e.data.log); else if (e.data.world) { const d = e.data.world; d.roads.forEach((r: { h: number[] | Float32Array; bridged: number[] | Uint8Array }) => { r.h = Float32Array.from(r.h); r.bridged = Uint8Array.from(r.bridged); }); resolve(d); w.terminate(); } };
    w.onerror = (e) => reject(e);
    w.postMessage({ rows }, [rows.buffer]);
  });
  t = performance.now();
  const inp = { height: wd.height, normals: wd.normals, wet: wd.wet, water: wd.water, roadMask: wd.roadMask, roadKind: wd.roadKind };
  const sh = await Promise.all(split(CTRL).map(([j0, j1], k) => run<{ bake: Uint8Array; ctrl: Uint8Array; surface: Uint8Array }>(pool[k], { stage: 'shade', w: inp, j0, j1 })));
  wd.bake = new Uint8Array(CTRL * CTRL * 4); wd.ctrl = new Uint8Array(CTRL * CTRL * 12); wd.surface = new Uint8Array(CTRL * CTRL);
  split(CTRL).forEach(([j0, j1], k) => {
    const R = (j1 - j0) * CTRL, s = sh[k];
    wd.bake.set(s.bake, j0 * CTRL * 4); wd.surface.set(s.surface, j0 * CTRL);
    for (let p = 0; p < 3; p++) wd.ctrl.set(s.ctrl.subarray(p * R * 4, (p + 1) * R * 4), (p * CTRL * CTRL + j0 * CTRL) * 4);
  });
  pool.forEach((w) => w.terminate());
  onLog(`light bake + splat ${Math.round(performance.now() - t)}ms`);
  return wd;
}

export type Mode = 'title' | 'drive' | 'garage' | 'map' | 'pause' | 'results';
export interface RaceRacer { e: VehicleEntity; cp: number; finished: number; driver?: Driver; lastCp: THREE.Vector3; lastYaw: number; progress: number; remain: number; idx: number }
export interface RaceState { def: RaceDef; racers: RaceRacer[]; t: number; countdown: number; gates: THREE.Group; player: RaceRacer; done: boolean; penalties: number }

const texCache = new Map<string, Promise<{ diff: THREE.Texture; nor: THREE.Texture; arm?: THREE.Texture }>>();
function loadTex(name: string) {
  let p = texCache.get(name);
  if (!p) {
    const L = new THREE.TextureLoader();
    const get = (k: string) => new Promise<THREE.Texture | undefined>((res) => L.load(assetUrl(`materials/${name}_${k}.webp`), (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; res(t); }, undefined, () => res(undefined)));
    p = Promise.all([get('diff'), get('nor'), get('arm')]).then(([d, n, a]) => { d!.colorSpace = THREE.SRGBColorSpace; return { diff: d!, nor: n!, arm: a }; });
    texCache.set(name, p);
  }
  return p;
}

export class Game {
  gfx: Gfx; terrain!: Terrain; grass!: Grass; phys!: Physics; foliage!: Foliage; water!: Water; props!: Props; particles!: Particles;
  world!: World; input = new Input(); ui!: UI; audio = new Audio();
  profile: Profile = loadProfile();
  player!: VehicleEntity;
  rivals: VehicleEntity[] = [];
  races: RaceDef[] = [];
  race: RaceState | null = null;
  mode: Mode = 'title';
  camMode: 'chase' | 'hood' | 'far' = 'chase';
  camYaw = 0; camPitch = 0.12; camDist = 1; orbitT = 0;
  time = 0; fps = 60; frames = 0; fpsT = 0;
  manual = false;
  private camPos = new THREE.Vector3(); private camLook = new THREE.Vector3();
  private colliderTimer = 0;
  private trapCool = new Map<string, number>();
  private trapEntry = new Map<string, number>();
  private jump = { active: false, start: new THREE.Vector3(), t: 0, name: '' };
  private handleToEntity = new Map<number, VehicleEntity>();
  private handleToTrailer = new Map<number, number>();
  private chimneyT = 0;
  biome = 0;
  test = false;

  constructor(canvas: HTMLCanvasElement) {
    this.gfx = new Gfx(canvas);
  }

  env = {
    surfaceAt: (x: number, z: number) => this.world.surface[this.cell(x, z)],
    waterAt: (x: number, z: number) => this.world.water[this.cell(x, z)],
  };
  cell(x: number, z: number) { return Math.max(0, Math.min(CTRL - 1, Math.floor((z + HALF) / 4))) * CTRL + Math.max(0, Math.min(CTRL - 1, Math.floor((x + HALF) / 4))); }
  ground(x: number, z: number) { return sampleH(this.world.height, x, z); }

  async init(progress: (msg: string, f: number) => void) {
    const params = new URLSearchParams(location.search);
    this.test = params.has('test');
    const q = params.get('quality') as keyof typeof PRESETS | null;
    const settings = q && PRESETS[q] ? { ...PRESETS[q] } : this.profile.settings ?? { ...PRESETS[autoPreset(this.gfx.renderer)] };
    progress('Warming up the GPU', 0.02);
    await this.gfx.settle();
    progress('Sculpting 26 km² of terrain', 0.05);
    await initRapier();
    let step = 0;
    this.world = await loadWorld((s) => progress('Generating world: ' + s, 0.08 + 0.05 * ++step));
    progress('Building physics', 0.4);
    this.phys = new Physics(this.world.height);
    this.terrain = new Terrain(this.world, this.gfx.renderer);
    progress('Loading photo-scanned terrain materials', 0.45);
    await this.terrain.loadLayers((f) => progress('Loading photo-scanned terrain materials', 0.45 + f * 0.2));
    this.gfx.scene.add(this.terrain.group);
    progress('Growing forests', 0.68);
    this.races = buildRaces(this.world.roads, this.world.rivers);
    this.foliage = new Foliage(this.world, this.phys, this.races.filter((r) => r.id !== 'timberline-plow').map((r) => r.path));
    await this.foliage.build(loadTex);
    this.gfx.scene.add(this.foliage.group);
    this.foliage.onBreak = (x, y, z) => { for (let i = 0; i < 14; i++) this.particles.emit(P.chips, x, y + Math.random() * 3, z, 0, 0, 0, 1, 1.5); this.particles.emit(P.dust, x, y, z, 0, 0, 0, 6, 2); this.audio.crack(); this.profile.logsSmashed++; };
    this.grass = new Grass(this.world, this.terrain.ctrlTex, this.terrain.roadTex, this.terrain.noiseTex, this.foliage.time);
    this.gfx.scene.add(this.grass.mesh);
    progress('Building bridges, garages and quarries', 0.82);
    this.water = new Water(this.world, this.terrain.noiseTex, new THREE.Vector3().copy(this.gfx.sun.position).normalize());
    this.water.uniforms.uSun.value.set(...(await import('../world/finish')).SUN_DIR).normalize();
    this.gfx.scene.add(this.water.group);
    for (const l of LAKES) if (l.ice) this.water.group.add(Water.ice(l));
    this.props = new Props(this.world, this.phys);
    await this.props.build(loadTex);
    this.gfx.scene.add(this.props.group);
    this.props.trailers.forEach((t, i) => this.handleToTrailer.set(t.col.handle, i));
    this.particles = new Particles(this.gfx.scene);
    progress('Fuelling up', 0.92);
    this.applySettings(settings);
    this.ui = new UI(this);
    this.spawnPlayer(this.profile.current);
    this.teleportGarage('hub');
    this.phys.world.step();
    this.foliage.update(this.gfx.camera, true);
    progress('Ready', 1);
  }

  applySettings(s: GfxSettings) {
    this.gfx.applySettings(s);
    const t = s.terrain;
    this.terrain?.setQuality(t === 0 ? { lowPoly: true, lodScale: 0.6 } : { lowPoly: false, texRes: t === 1 ? 512 : 1024, triplanar: t >= 2, antiTile: t >= 3, lodScale: [0.6, 0.8, 1, 1.35][t] });
    if (this.foliage) { this.foliage.density = s.foliage; this.foliage.drawDist = s.drawDist; this.foliage.nearDist = 70 + 110 * s.drawDist; this.foliage.update(this.gfx.camera, true); }
    if (this.particles) this.particles.rate = s.particles;
    if (this.grass) { const gq = [[0, 20], [30000, 18], [70000, 26], [110000, 32]][s.terrain]; this.grass.setQuality(Math.round(gq[0] * Math.max(0.35, s.foliage)), gq[1]); }
    this.profile.settings = s; saveProfile(this.profile);
  }

  // ---------------- vehicles ----------------
  spawnPlayer(id: string, at?: { x: number; z: number; yaw: number }) {
    const prev = this.player;
    const p = at ?? (prev ? { x: prev.v.position().x, z: prev.v.position().z, yaw: this.yawOf(prev) } : { x: 0, z: 0, yaw: 0 });
    if (prev) { this.unregister(prev); prev.dispose(); }
    const def = VEH[id];
    const up = upgradesOf(this.profile, id);
    const st = stats(def, up);
    const e = new VehicleEntity(this.phys, def, up, { x: p.x, y: this.ground(p.x, p.z) + st.wheelR + def.susp.rest + 0.4, z: p.z }, p.yaw, this.gfx.scene);
    e.isPlayer = true; e.name = 'You';
    this.player = e; this.register(e);
    this.profile.current = id; saveProfile(this.profile);
    this.audio.setVehicle(def);
    return e;
  }
  register(e: VehicleEntity) { for (const part of e.v.parts) for (const c of part.colliders) this.handleToEntity.set(c.handle, e); }
  unregister(e: VehicleEntity) { for (const part of e.v.parts) for (const c of part.colliders) this.handleToEntity.delete(c.handle); }
  yawOf(e: VehicleEntity) { const f = e.v.main.forward(); return Math.atan2(f.x, f.z); }
  place(e: VehicleEntity, x: number, z: number, yaw: number) {
    const st = e.v.st;
    const top = Math.max(this.ground(x, z), this.phys.castDown(x, z, this.ground(x, z) + 60) ?? -1e9);
    e.v.reset({ x, y: top + st.wheelR + e.def.susp.rest + 0.6, z }, yaw); e.snapshot(); e.snapshot();
  }
  teleport(x: number, z: number, yaw: number) {
    this.place(this.player, x, z, yaw);
    this.foliage.streamColliders([{ x, z }]);
    this.camPos.set(x - Math.sin(yaw) * 12, this.ground(x, z) + 6, z - Math.cos(yaw) * 12);
    this.foliage.update(this.gfx.camera, true);
  }
  teleportGarage(id: string) {
    const pad = this.props.garagePads.find((g) => g.id === id)!;
    this.teleport(pad.pos.x, pad.pos.z, pad.yaw);
  }
  nearestGarage(): { id: string; d: number } {
    const p = this.player.v.position();
    let best = { id: 'hub', d: 1e9 };
    for (const g of this.props.garagePads) { const d = Math.hypot(g.pos.x - p.x, g.pos.z - p.z); if (d < best.d) best = { id: g.id, d }; }
    return best;
  }
  /** Flip upright where we are (winch = free; in races without it costs a 2 s penalty). */
  recover() {
    if (this.race) { const r = this.race.player, path = this.race.def.path, i = Math.min(path.length - 2, r.idx), a = path[i], b = path[i + 1]; this.place(this.player, a[0], a[1], Math.atan2(b[0] - a[0], b[1] - a[1])); if (!this.player.v.st.winch) { this.race.penalties += 2; this.ui.toast('Recovered onto the route (+2 s)', 'warn'); } else this.ui.toast('Winched back on track', 'ok'); return; }
    const p = this.player.v.position();
    this.place(this.player, p.x, p.z, this.yawOf(this.player));
  }

  // ---------------- races ----------------
  startRace(id: string) {
    this.endRace(true);
    const def = this.races.find((r) => r.id === id)!;
    const path = def.path;
    // grid follows the road backwards from the start line, two abreast
    const s0 = Math.min(path.length - 2, 6 + Math.ceil((def.rivals + 1) / 2) * 4);
    const yawAt = (i: number) => { const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)]; return Math.atan2(b[0] - a[0], b[1] - a[1]); };
    const yaw0 = yawAt(s0);
    const grid = (k: number) => { const row = Math.floor(k / 2), col = k % 2 ? 1 : -1, i = Math.max(0, s0 - row * 4), y = yawAt(i); return { x: path[i][0] + Math.cos(y) * col * 2.6, z: path[i][1] - Math.sin(y) * col * 2.6, yaw: y }; };
    const ps = grid(0);
    this.place(this.player, ps.x, ps.z, ps.yaw);
    const playerRacer: RaceRacer = { e: this.player, cp: 0, finished: 0, lastCp: new THREE.Vector3(ps.x, 0, ps.z), lastYaw: ps.yaw, progress: 0, remain: def.len, idx: 0 };
    const racers: RaceRacer[] = [playerRacer];
    const cls = this.player.def.cls;
    const pool = VEHICLES.filter((v) => v.id !== 'snake' && v.id !== this.player.def.id && (v.cls === cls || Math.abs(v.top - this.player.def.top) < 9));
    const names = ['Rex "Gravel" Duarte', 'Mika Sandvik', 'Juno Okafor', 'Tess Ramirez', 'Kai Brennan', 'Ola Lindqvist'];
    for (let k = 0; k < def.rivals; k++) {
      const vd = pool[(k * 7 + id.length) % pool.length] ?? VEH.pickup;
      const up: Upgrades = { ...STOCK, engine: 1 + Math.min(3, Math.floor(k / 2) + (this.player.up.engine > 2 ? 1 : 0)), suspension: 2, tires: 2, compound: def.biome === 2 ? 'snow' : def.biome === 0 ? 'sand' : def.biome === 1 ? 'mud' : 'allterrain', snorkel: def.id === 'muddy-creek' ? 1 : 0 };
      const g = grid(k + 1);
      const e = new VehicleEntity(this.phys, vd, up, { x: g.x, y: this.ground(g.x, g.z) + stats(vd, up).wheelR + vd.susp.rest + 0.5, z: g.z }, g.yaw, this.gfx.scene);
      e.name = names[k % names.length];
      e.driver = new Driver(path, 0.92 + k * 0.03);
      this.rivals.push(e); this.register(e);
      racers.push({ e, cp: 0, finished: 0, driver: e.driver, lastCp: new THREE.Vector3(g.x, 0, g.z), lastYaw: g.yaw, progress: 0, remain: def.len, idx: 0 });
    }
    const gates = this.buildGates(def);
    this.race = { def, racers, t: 0, countdown: 3.5, gates, player: playerRacer, done: false, penalties: 0 };
    this.mode = 'drive';
    this.ui.raceStart(def);
    this.foliage.streamColliders(racers.map((r) => { const p = r.e.v.position(); return { x: p.x, z: p.z }; }));
  }
  endRace(silent = false) {
    if (!this.race) return;
    for (const r of this.rivals) { this.unregister(r); r.dispose(); }
    this.rivals = [];
    this.race.gates.removeFromParent();
    this.race = null;
    if (!silent) this.ui.raceEnd();
  }
  private buildGates(def: RaceDef) {
    const g = new THREE.Group(); g.name = 'gates';
    const post = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.6 });
    const glow = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff6a00, emissiveIntensity: 2.4 });
    const fin = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x44ff88, emissiveIntensity: 2.0 });
    def.cps.forEach((c, i) => {
      const last = i === def.cps.length - 1;
      const pi = def.path.findIndex((p) => p[0] === c[0] && p[1] === c[1]);
      const a = def.path[Math.max(0, pi - 2)], b = def.path[Math.min(def.path.length - 1, pi + 2)];
      const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
      const y = this.ground(c[0], c[1]);
      const gg = new THREE.Group(); gg.position.set(c[0], y, c[1]); gg.rotation.y = yaw; g.add(gg);
      const half = last ? 9 : 8;
      for (const s of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 7, 10), post); p.position.set(s * half, 3.5 + (this.ground(c[0] + Math.cos(yaw + Math.PI / 2) * 0, c[1]) - y), 0); gg.add(p);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.6, 10), last ? fin : glow); band.position.set(s * half, 6.2, 0); gg.add(band);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.6, 0.9, 0.3), last ? fin : glow); beam.position.y = 7.1; gg.add(beam);
      gg.userData.cp = i;
      gg.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
    });
    this.gfx.scene.add(g);
    return g;
  }
  private updateRace(dt: number) {
    const R = this.race!;
    if (R.countdown > 0) {
      const before = Math.ceil(R.countdown);
      R.countdown -= dt;
      if (Math.ceil(R.countdown) !== before && R.countdown > 0) this.audio.beep(false);
      if (R.countdown <= 0) this.audio.beep(true);
      return;
    }
    if (!R.done) R.t += dt;
    const cps = R.def.cps;
    for (const r of R.racers) {
      if (r.finished) continue;
      const p = r.e.v.position();
      // waypoints are optional guidance unless the race is strict: reaching the finish is what counts
      const fin = cps[cps.length - 1];
      if (!R.def.strict && r.cp < cps.length - 1 && Math.hypot(p.x - fin[0], p.z - fin[1]) < 18) r.cp = cps.length - 1;
      else if (!R.def.strict) for (let k = r.cp + 1; k < cps.length - 1; k++) if (Math.hypot(p.x - cps[k][0], p.z - cps[k][1]) < 22) r.cp = k;
      const c = cps[r.cp];
      const rad = r.cp === cps.length - 1 ? 18 : 22;
      if (Math.hypot(p.x - c[0], p.z - c[1]) < rad) {
        r.lastCp.set(c[0], 0, c[1]); r.lastYaw = this.yawOf(r.e);
        r.cp++;
        if (r === R.player) { this.audio.checkpoint(); this.ui.flashCp(r.cp, cps.length); }
        if (r.cp >= cps.length) {
          r.finished = R.t + (r === R.player ? R.penalties : 0);
          if (r === R.player) this.finishRace();
        }
      }
      // positions: distance still to go, via the best point on the route (shortcuts count)
      this.trackRacer(R.def, r, p.x, p.z);
      r.progress = R.def.strict ? r.cp * 1e5 - r.remain : -r.remain;
      if (r.driver) {
        // rubber band: keep the pack honest but beatable
        const ahead = r.progress - R.player.progress;
        r.driver.skill = Math.max(0.86, Math.min(1.08, 1 - ahead / 1e6 * 0 - Math.sign(ahead) * Math.min(0.12, Math.abs(ahead) % 1e5 / 2500)));
      }
    }
    if (R.done && R.racers.every((r) => r.finished || !r.driver)) { /* everyone in */ }
  }
  /** Distance to go = min over route samples of (route left from there + straight line to it); remembers the nearest sample. */
  trackRacer(def: RaceDef, r: RaceRacer, x: number, z: number) {
    const path = def.path; let best = 1e18, bi = r.idx, near = 1e18;
    for (let k = 0; k < path.length; k += 3) {
      const d = Math.hypot(path[k][0] - x, path[k][1] - z);
      const v = def.rem[k] + d;
      if (v < best) best = v;
      if (d < near && Math.abs(k - r.idx) < 400) { near = d; bi = k; }
    }
    r.remain = Math.min(best, Math.hypot(path[path.length - 1][0] - x, path[path.length - 1][1] - z) * 1.15 + 0);
    r.idx = bi;
  }
  /** Where the GPS arrow points: the next gate (strict races) or the next waypoint ahead of the racer. */
  nextWaypoint(r: RaceRacer): [number, number] {
    const def = this.race!.def;
    if (def.strict) return def.cps[Math.min(r.cp, def.cps.length - 1)];
    const ahead = Math.min(def.path.length - 1, r.idx + 60);
    for (const c of def.cps) { const ci = def.path.findIndex((p) => p[0] === c[0] && p[1] === c[1]); if (ci >= ahead) return c; }
    return def.cps[def.cps.length - 1];
  }
  standings() {
    const R = this.race!;
    return [...R.racers].sort((a, b) => (a.finished && b.finished ? a.finished - b.finished : a.finished ? -1 : b.finished ? 1 : b.progress - a.progress));
  }
  private finishRace() {
    const R = this.race!;
    R.done = true;
    const order = this.standings();
    const place = order.indexOf(R.player) + 1;
    const mult = [1, 0.6, 0.38, 0.22, 0.15, 0.12][place - 1] ?? 0.1;
    const reward = Math.round(R.def.reward * mult / 10) * 10;
    this.profile.coins += reward;
    const time = R.player.finished;
    const prevBest = this.profile.best[R.def.id];
    if (!prevBest || time < prevBest) this.profile.best[R.def.id] = time;
    if (!this.profile.wins[R.def.id] || place < this.profile.wins[R.def.id]) this.profile.wins[R.def.id] = place;
    saveProfile(this.profile);
    this.ui.results(R.def, place, time, reward, !prevBest || time < prevBest, order);
    this.audio.finish(place === 1);
  }

  // ---------------- free roam economy ----------------
  private freeRoam(dt: number) {
    const v = this.player.v, p = v.position(), kmh = v.kmh();
    for (const s of SPEED_TRAPS) {
      const d = Math.hypot(p.x - s.x, p.z - s.z);
      const cool = this.trapCool.get(s.name) ?? 0;
      if (d < s.r && this.time > cool && kmh > 40) {
        this.trapCool.set(s.name, this.time + 20);
        const coins = Math.round(Math.max(0, kmh - 40) * 3 / 10) * 10 + 50;
        const best = this.profile.trapBest[s.name] ?? 0;
        if (kmh > best) this.profile.trapBest[s.name] = kmh;
        this.profile.coins += coins; saveProfile(this.profile);
        this.ui.toast(`📸 ${s.name}: ${kmh.toFixed(0)} km/h  +${coins} coins${kmh > best ? '  NEW BEST' : ''}`, 'coin');
        this.audio.coin();
      }
    }
    // jumps: any big airtime pays, the canyon gaps pay extra
    if (!v.onGround && v.airTime > 0.05 && !this.jump.active) { this.jump.active = true; this.jump.start.set(p.x, p.y, p.z); this.jump.name = ''; for (const j of JUMP_TRAPS) { const jx = j.x; if (Math.abs(p.x - jx) < 40 && Math.abs(p.z - this.canyonRimZ(jx)) < 80) this.jump.name = j.name; } }
    if (this.jump.active && v.onGround) {
      this.jump.active = false;
      const dist = Math.hypot(p.x - this.jump.start.x, p.z - this.jump.start.z);
      const air = v.lastAir;
      if (air > 1.2 && dist > 20) {
        const bonus = this.jump.name ? 3 : 1;
        const coins = Math.round(dist * 4 * bonus / 10) * 10;
        this.profile.coins += coins; saveProfile(this.profile);
        this.ui.toast(`🚀 ${this.jump.name || 'Big air'}: ${dist.toFixed(0)} m, ${air.toFixed(1)} s  +${coins} coins`, 'coin');
        this.audio.coin();
      }
    }
    // exploration: discover garages and cabins
    for (const g of GARAGES) {
      const key = 'garage:' + g.id;
      if (!this.profile.found.includes(key) && Math.hypot(p.x - g.x, p.z - g.z) < 45) { this.profile.found.push(key); if (!g.main) { this.profile.coins += 500; this.ui.toast(`🏁 Discovered ${g.name} (fast travel unlocked)  +500`, 'coin'); } saveProfile(this.profile); }
    }
    for (const c of CABINS) {
      if (this.profile.barns.includes(c.id)) continue;
      const cp = this.props.cabinPos[c.id];
      if (Math.hypot(p.x - cp.x, p.z - cp.z) < 16) {
        this.profile.barns.push(c.id); this.profile.coins += 2000;
        const all = this.profile.barns.length === 4;
        if (all) this.profile.owned.includes('snake') || this.profile.owned.push('snake');
        saveProfile(this.profile);
        this.ui.barnFound(c.name, c.prize, this.profile.barns.length, all);
        this.audio.finish(true);
      }
    }
  }
  canyonRimZ(x: number) { return 1170 + 110 * Math.sin(x / 260 + 0.4) + 45 * Math.sin(x / 93 + 1.3); }

  // ---------------- physics interactions ----------------
  private prePhysics(dt: number) {
    const ents = [this.player, ...this.rivals];
    const tmp: number[] = [];
    for (const e of ents) {
      const v = e.v, st = v.st;
      for (const part of v.parts) {
        const b = part.body, lv = b.linvel(), spd = Math.hypot(lv.x, lv.z);
        const plow = st.plow >= 3 && e.def.plowable;
        const canBreak = plow ? spd > 1.5 : e.def.heavy ? spd > 6.5 : spd > 5;
        if (!canBreak) continue;
        const p = b.translation(), f = part.forward();
        const fx = f.x, fz = f.z, fl = Math.hypot(fx, fz) || 1;
        const front = e.def.len / 2 + (plow ? 0.9 : 0.2);
        this.foliage.near(p.x + fx / fl * front, p.z + fz / fl * front, e.def.wid + 3, tmp);
        for (const t of tmp) {
          const kind = this.foliage.tk[t];
          const breakable = plow || e.def.heavy || kind === 4;
          if (!breakable) continue;
          const dx = this.foliage.tx[t] - p.x, dz = this.foliage.tz[t] - p.z;
          const lz = (dx * fx + dz * fz) / fl, lx = (dx * -fz + dz * fx) / fl;
          const halfW = (plow ? e.def.wid * 0.56 : e.def.wid / 2) + this.foliage.radiusOf(t);
          if (lz > 0 && lz < front + spd * dt * 3 + 1 && Math.abs(lx) < halfW) {
            if (this.foliage.fell(t, lv.x, lv.z, this.time)) {
              const slow = plow ? 0.97 : e.def.heavy ? 0.86 : 0.9;
              b.setLinvel({ x: lv.x * slow, y: lv.y, z: lv.z * slow }, true);
              if (e.isPlayer) this.gfx.camera.userData.shake = 0.35;
            }
          }
        }
      }
    }
  }
  private postPhysics() {
    this.phys.events.drainContactForceEvents((ev) => {
      const h1 = ev.collider1(), h2 = ev.collider2(), f = ev.totalForceMagnitude();
      const e1 = this.handleToEntity.get(h1), e2 = this.handleToEntity.get(h2);
      const tr = this.handleToTrailer.get(h1) ?? this.handleToTrailer.get(h2);
      const e = e1 ?? e2;
      if (tr !== undefined && e && (e.v.mass >= 4500 || e.def.body === 'monster') && Math.abs(e.v.speed()) > 3) {
        const t = this.props.trailers[tr];
        this.handleToTrailer.delete(t.col.handle);
        if (this.props.crush(t)) { this.particles.emit(P.dust, t.x, this.ground(t.x, t.z) + 1, t.z, 0, 0, 0, 10, 4); this.audio.crunch(); if (e.isPlayer) this.ui.toast('Trailer crushed!', 'ok'); }
        return;
      }
      const impulse = f * this.phys.dt;
      if (e1) e1.v.addDamage(impulse); if (e2 && e2 !== e1) e2.v.addDamage(impulse);
      if ((e1?.isPlayer || e2?.isPlayer) && impulse > 3000) { this.audio.impact(Math.min(1, impulse / 40000)); this.gfx.camera.userData.shake = Math.min(0.6, impulse / 60000); }
    });
  }

  // ---------------- frame ----------------
  update(dt: number) {
    this.time += dt;
    const inp = this.input;
    if (this.mode === 'drive' || this.mode === 'garage') {
      inp.enabled = this.mode === 'drive' && !(this.race && this.race.countdown > 0);
      inp.controls(dt, this.player.controls);
      if (this.player.driver && (!this.race || this.race.countdown <= 0)) {
        this.player.controls = this.player.driver.control(this.player.v, dt);
        if (this.player.driver.resetReq) { this.player.driver.resetReq = false; const rp = this.player.driver.resetPose(); this.place(this.player, rp.x, rp.z, rp.yaw); }
      }
    }
    const ents = [this.player, ...this.rivals];
    const simulate = this.mode !== 'pause' && this.mode !== 'title';
    if (simulate) {
      // AI
      if (this.race && this.race.countdown <= 0) for (const r of this.race.racers) if (r.driver && !r.finished) {
        r.e.controls = r.driver.control(r.e.v, dt);
        if (r.driver.resetReq) { r.driver.resetReq = false; const rp = r.driver.resetPose(); this.place(r.e, rp.x, rp.z, rp.yaw); }
      } else if (this.race) for (const r of this.race.racers) if (r.driver) r.e.controls = { throttle: 0, brake: 1, steer: 0, handbrake: true, nitro: false, hop: false };
      for (const r of this.race?.racers ?? []) if (r.finished && r.driver) r.e.controls = { throttle: 0, brake: 0.6, steer: 0, handbrake: false, nitro: false, hop: false };
      this.phys.step(dt, (h) => { this.prePhysics(h); for (const e of ents) e.step(h, this.env); }, () => { for (const e of ents) e.snapshot(); this.postPhysics(); });
      this.colliderTimer -= dt;
      if (this.colliderTimer <= 0) { this.colliderTimer = 0.25; this.foliage.streamColliders(ents.map((e) => { const p = e.v.position(); return { x: p.x, z: p.z }; })); }
      this.foliage.updateLogs(dt, this.time);
      this.props.update(dt);
      if (this.race) this.updateRace(dt);
      else if (this.mode === 'drive') this.freeRoam(dt);
      if (this.player.v.flippedT > 4 && !this.race) { this.recover(); this.ui.toast('Flipped back onto your wheels', 'warn'); }
      // safety net: nothing may tunnel under the heightfield or run away numerically
      for (const e of ents) {
        const p = e.v.position(), lv = e.v.body.linvel();
        if (p.y < this.ground(p.x, p.z) - 4 || Math.hypot(lv.x, lv.y, lv.z) > 110 || !Number.isFinite(p.y)) {
          if (e.driver) { const rp = e.driver.resetPose(); this.place(e, rp.x, rp.z, rp.yaw); }
          else if (this.race && e === this.player) { const r = this.race.player, path = this.race.def.path, i = Math.min(path.length - 2, r.idx); this.place(e, path[i][0], path[i][1], Math.atan2(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1])); }
          else this.place(e, Number.isFinite(p.x) ? p.x : 0, Number.isFinite(p.z) ? p.z : 0, this.yawOf(e));
        }
      }
      this.profile.distance += Math.abs(this.player.v.speed()) * dt;
    }
    const alpha = this.phys.alpha;
    const wheelFx = (e: VehicleEntity, _wi: number, w: THREE.Vector3, surf: number, spd: number) => {
      if (spd < 4 || Math.random() > 0.35) return;
      const k = e.v.inWater > 0.1 ? P.splash : [P.dust, P.dust, P.gravel, P.sand, P.mud, P.snow, P.snow, P.dust, P.gravel][surf];
      const f = e.v.main.forward();
      this.particles.emit(k, w.x - f.x * 0.5, w.y + 0.2, w.z - f.z * 0.5, -f.x * spd * 0.15, 0, -f.z * spd * 0.15, Math.min(2, spd / 12), 0.6);
    };
    for (const e of ents) {
      e.sync(alpha, dt, wheelFx);
      // exhaust smoke (black puffs under load for the big diesels)
      for (const [i, vis] of e.vis.entries()) {
        if (i > 0 && e.def.body !== 'snake') break;
        if (Math.random() < 0.3 + e.controls.throttle * 0.5) for (const ex of vis.exhausts) { const wp = ex.clone().applyMatrix4(vis.root.matrixWorld); this.particles.emit(e.def.heavy && e.controls.throttle > 0.6 ? P.black : P.exhaust, wp.x, wp.y, wp.z, 0, 0.5, 0, 0.6, 0.1); }
      }
    }
    this.chimneyT -= dt;
    if (this.chimneyT < 0) { this.chimneyT = 0.35; for (const c of this.props.chimneys) if (c.distanceTo(this.gfx.camera.position) < 1500) this.particles.emit(P.smoke, c.x, c.y, c.z, 1.0, 0.8, 0.4, 1, 0.3); }
    this.particles.update(dt, 1);
    this.updateCamera(dt);
    const p = this.player.v.position();
    const bw = [0, 0, 0, 0]; biomeWeights(p.x, p.z, 0, bw); this.biome = bw.indexOf(Math.max(...bw));
    if (Math.hypot(p.x - HUB.x, p.z - HUB.z) < HUB.r + 60) this.biome = 4;
    this.foliage.time.value = this.time; this.water.update(this.time);
    this.terrain.update(this.gfx.camera.position);
    this.grass.update(this.gfx.camera.position);
    this.foliage.update(this.gfx.camera);
    this.gfx.updateShadow(this.camLook.clone().lerp(this.gfx.camera.position, 0.3));
    this.audio.update(this.player, dt, this.mode === 'drive' || this.mode === 'garage');
    this.ui.update(dt);
    if (inp.take('KeyM') && (this.mode === 'drive' || this.mode === 'map')) this.ui.toggleMap();
    if (inp.take('Escape') || inp.take('KeyP')) this.ui.escape();
    if (inp.take('KeyR') && this.mode === 'drive') this.recover();
    if (inp.take('KeyC') && this.mode === 'drive') this.camMode = this.camMode === 'chase' ? 'far' : this.camMode === 'far' ? 'hood' : 'chase';
    if (inp.take('KeyG') && this.mode === 'drive' && !this.race) { const g = this.nearestGarage(); if (g.d < 60) this.ui.openGarage(); else this.ui.toast('Drive to a garage (or use the map, M) to upgrade', 'warn'); }
    inp.endFrame();
  }

  private updateCamera(dt: number) {
    const cam = this.gfx.camera, e = this.player, vis = e.vis[0];
    const inp = this.input;
    if (this.mode === 'title') {
      this.orbitT += dt * 0.04;
      const cx = 160 * Math.cos(this.orbitT) - 40, cz = 160 * Math.sin(this.orbitT) + 1180;
      cam.position.set(cx, Math.max(this.ground(cx, cz) + 25, 55), cz);
      cam.lookAt(60, 18, 1250);
      return;
    }
    const pos = vis.root.position, q = vis.root.quaternion;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q); fwd.y *= 0.3; fwd.normalize();
    const size = Math.max(4, e.def.len * (e.def.body === 'snake' ? 2.2 : 1), e.def.hgt * 2.2);
    if (this.mode === 'garage') {
      this.camYaw += inp.mouse.dx * 0.005 + dt * (inp.mouse.down ? 0 : 0.05); this.camPitch = Math.max(0.02, Math.min(0.8, this.camPitch + inp.mouse.dy * 0.003));
      this.camDist = Math.max(0.6, Math.min(2.2, this.camDist + inp.mouse.wheel * 0.08));
      const d = size * 1.35 * this.camDist;
      const target = pos.clone().add(new THREE.Vector3(0, e.def.hgt * 0.5 + 0.4, 0));
      cam.position.set(target.x + Math.sin(this.camYaw) * Math.cos(this.camPitch) * d, target.y + Math.sin(this.camPitch) * d, target.z + Math.cos(this.camYaw) * Math.cos(this.camPitch) * d);
      cam.position.y = Math.max(cam.position.y, this.ground(cam.position.x, cam.position.z) + 0.6);
      cam.lookAt(target);
      this.camLook.copy(target);
      return;
    }
    if (inp.mouse.down) { this.camYaw += inp.mouse.dx * 0.006; this.camPitch = Math.max(-0.1, Math.min(0.9, this.camPitch + inp.mouse.dy * 0.003)); }
    else { this.camYaw *= Math.exp(-dt * 1.5); this.camPitch += (0.12 - this.camPitch) * (1 - Math.exp(-dt * 1.5)); }
    this.camDist = Math.max(0.6, Math.min(2.0, this.camDist + inp.mouse.wheel * 0.08));
    if (this.camMode === 'hood') {
      const p = new THREE.Vector3(0, vis.bodyTop + 0.15, Math.min(vis.frontZ - 0.6, e.def.len * 0.25)).applyQuaternion(q).add(pos);
      cam.position.copy(p);
      cam.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0)));
      cam.rotateX(-0.05);
      this.camLook.copy(p);
      return;
    }
    const spd = Math.abs(e.v.speed());
    const dist = (size * (this.camMode === 'far' ? 2.6 : 1.75) + 2.5) * this.camDist + spd * 0.05;
    const height = size * 0.34 * (this.camMode === 'far' ? 1.5 : 1) + 1.4;
    const back = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.camYaw);
    const want = pos.clone().addScaledVector(back, -dist).add(new THREE.Vector3(0, height + this.camPitch * dist * 0.8, 0));
    const gy = this.ground(want.x, want.z) + 1.2;
    if (want.y < gy) want.y = gy;
    const k = 1 - Math.exp(-dt * 7);
    if (this.camPos.distanceTo(want) > 60) this.camPos.copy(want); else this.camPos.lerp(want, k);
    const look = pos.clone().addScaledVector(fwd, 2 + spd * 0.1).add(new THREE.Vector3(0, e.def.hgt * 0.45 + 0.6, 0));
    this.camLook.lerp(look, Math.min(1, k * 1.6));
    cam.position.copy(this.camPos);
    const shake = cam.userData.shake ?? 0;
    if (shake > 0) { cam.position.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake)); cam.userData.shake = Math.max(0, shake - dt * 1.5); }
    cam.lookAt(this.camLook);
    const fovT = 62 + Math.min(14, spd * 0.22) + (e.v.boosting ? 6 : 0);
    cam.fov += (fovT - cam.fov) * k; cam.updateProjectionMatrix();
  }

  render(dt: number) { this.gfx.resize(); this.gfx.render(dt, this.time); }

  surfaceName() { const p = this.player.v.position(); return SURF_NAMES[this.env.surfaceAt(p.x, p.z)]; }
  biomeName() { return this.biome === 4 ? 'Central Hub' : BIOME_NAMES[this.biome]; }
}

function autoPreset(r: THREE.WebGLRenderer): keyof typeof PRESETS {
  const gl = r.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
  if (/swiftshader|llvmpipe|software/i.test(name)) return 'potato';
  if (/intel|mali|adreno|powervr|apple gpu/i.test(name) || /Mobi|Android/i.test(navigator.userAgent)) return 'medium';
  return 'high';
}

export async function boot() {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const game = new Game(canvas);
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.innerHTML = `<div class="logo">APEX<span>OVERLAND</span></div><div class="bar"><i></i></div><div class="msg">Starting…</div><div class="tip">Tip: heavy trucks with a dozer plow drive straight through forests.</div>`;
  document.getElementById('ui')!.appendChild(loading);
  const bar = loading.querySelector('.bar i') as HTMLElement, msg = loading.querySelector('.msg') as HTMLElement;
  try {
    await game.init((m, f) => { msg.textContent = m; bar.style.width = (f * 100).toFixed(0) + '%'; });
  } catch (e) { msg.textContent = 'Failed to start: ' + (e as Error).message; console.error(e); throw e; }
  loading.classList.add('done'); setTimeout(() => loading.remove(), 800);
  const api = {
    ready: true, game, THREE,
    get gfx() { return game.gfx; },
    cam(x: number, y: number, z: number, lx: number, ly: number, lz: number) { game.manual = true; game.gfx.camera.position.set(x, y, z); game.gfx.camera.lookAt(lx, ly, lz); },
    camG(x: number, y: number, z: number, lx: number, ly: number, lz: number) { api.cam(x, game.ground(x, z) + y, z, lx, game.ground(lx, lz) + ly, lz); },
    render(n = 1) { const cam = game.gfx.camera; for (let i = 0; i < n; i++) { game.terrain.update(cam.position); game.grass.update(cam.position); game.foliage.update(cam, true); game.gfx.updateShadow(cam.position.clone().add(cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(30))); game.render(1 / 60); } return game.gfx.renderer.info.render; },
    /** Simulate n seconds without real time (deterministic headless tests). */
    advance(sec: number) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) game.update(1 / 60); },
    hold(keys: string[], sec: number) { for (const k of keys) game.input.keys.add(k); api.advance(sec); for (const k of keys) game.input.keys.delete(k); },
    drive() { game.ui.startGame(); },
    autopilot(on = true) { game.player.driver = on ? new Driver(game.race ? game.race.def.path : game.world.roads.find((r) => r.id === 'hub-south')!.pts, 1) : undefined; },
    race(id: string) { game.startRace(id); },
    state() { const p = game.player.v.position(); const R = game.race; return { mode: game.mode, x: p.x, y: p.y, z: p.z, kmh: game.player.v.kmh(), ground: game.ground(p.x, p.z), coins: game.profile.coins, race: R ? { id: R.def.id, cp: R.player.cp, cps: R.def.cps.length, remain: R.player.remain, len: R.def.len, t: R.t, countdown: R.countdown, finished: R.player.finished, pos: game.standings().indexOf(R.player) + 1 } : null, logs: game.foliage.logs.length, activeLogs: game.foliage.activeLogs, broken: game.foliage.broken, fps: game.fps, calls: game.gfx.renderer.info.render.calls, tris: game.gfx.renderer.info.render.triangles }; },
    lineup(upg: Partial<Upgrades> & { dirt?: number } = {}, ids?: string[]) {
      const list = VEHICLES.filter((v) => !ids || ids.includes(v.id));
      game.gfx.scene.getObjectByName('lineup')?.removeFromParent();
      const grp = new THREE.Group(); grp.name = 'lineup';
      let x = 0;
      list.forEach((d) => {
        const u = { ...STOCK, ...upg } as Upgrades; const st = stats(d, u);
        (d.body === 'snake' ? [0, 1, 2] : [0]).forEach((m) => {
          const v = buildVisual(d, u, st, m);
          const z = 40 - m * (d.len + 1.3), wx = x + d.wid / 2;
          v.root.position.set(wx, game.ground(wx, z) + st.wheelR, z);
          v.wheels.forEach((w) => { w.group.position.set(w.x, 0, w.z); for (const l of w.links) { const hub = l.hub.clone().add(w.group.position); import('../vehicles/parts').then((m2) => m2.stretch(l.obj, l.a, hub)); } });
          v.dirt.uDirt.value = upg.dirt ?? 0;
          grp.add(v.root);
        });
        x += Math.max(d.wid, 1.2) + 1.6;
      });
      game.gfx.scene.add(grp);
      return x;
    },
  };
  window.AO = api;
  window.dev = makeDev(game, api);
  console.info('%cAPEX OVERLAND%c dev console: type dev.help()', 'color:#ff7a1a;font-weight:bold', 'color:inherit');
  let last = performance.now();
  const loop = () => {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!game.manual) { game.update(dt); game.render(dt); }
    game.frames++; game.fpsT += dt; if (game.fpsT > 0.5) { game.fps = game.frames / game.fpsT; game.frames = 0; game.fpsT = 0; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  if (game.test) game.ui.startGame();
}

/** Chrome DevTools (F12) console commands. */
function makeDev(game: Game, api: { advance: (s: number) => void; autopilot: (on?: boolean) => void }) {
  const cmds: Record<string, [string, (...a: any[]) => unknown]> = {
    help: ['list every command', () => { console.table(Object.fromEntries(Object.entries(cmds).map(([k, [d]]) => [k, d]))); return 'dev.<command>(...)'; }],
    coins: ['coins(n = 100000): add coins', (n = 100000) => { game.profile.coins += n; saveProfile(game.profile); return game.profile.coins; }],
    tp: ['tp(x, z, yawDeg = 0): teleport the player', (x: number, z: number, yaw = 0) => { game.teleport(x, z, yaw * Math.PI / 180); return game.player.v.position(); }],
    garage: ['garage(id): teleport to a garage (no arg: list them)', (id?: string) => { if (!id) return GARAGES.map((g) => g.id); game.teleportGarage(id); return id; }],
    garages: ['list garages', () => console.table(GARAGES.map((g) => ({ id: g.id, name: g.name, x: g.x, z: g.z })))],
    races: ['list races', () => console.table(game.races.map((r) => ({ id: r.id, name: r.name, km: +(r.len / 1000).toFixed(2), strict: r.strict })))],
    race: ['race(id): start a race', (id: string) => { game.startRace(id); return id; }],
    finish: ['finish(): put the player on the finish line of the current race', () => { const R = game.race; if (!R) return 'no race'; const f = R.def.path[R.def.path.length - 1], b = R.def.path[R.def.path.length - 4]; if (R.def.strict) R.player.cp = R.def.cps.length - 1; game.teleport(f[0], f[1], Math.atan2(f[0] - b[0], f[1] - b[1])); return 'teleported to finish'; }],
    quit: ['quit(): abandon the current race', () => game.endRace()],
    car: ['car(id): switch vehicle (unlocks it; no arg: list)', (id?: string) => { if (!id) return VEHICLES.map((v) => v.id); if (!game.profile.owned.includes(id)) game.profile.owned.push(id); game.spawnPlayer(id); return id; }],
    unlockAll: ['unlock every vehicle and max every upgrade', () => { for (const v of VEHICLES) { if (!game.profile.owned.includes(v.id)) game.profile.owned.push(v.id); const u = upgradesOf(game.profile, v.id) as unknown as Record<string, unknown>; for (const [k, info] of Object.entries(UPGRADE_INFO)) u[k] = info.max; game.profile.upgrades[v.id] = u as unknown as Upgrades; } saveProfile(game.profile); game.spawnPlayer(game.player.def.id); return 'unlocked'; }],
    barns: ['barns(): mark all four barn finds found (unlocks The Snake)', () => { game.profile.barns = CABINS.map((c) => c.id); if (!game.profile.owned.includes('snake')) game.profile.owned.push('snake'); saveProfile(game.profile); return 'the Snake is yours'; }],
    cabin: ['cabin(id): teleport next to a barn find (no arg: list)', (id?: string) => { if (!id) return CABINS.map((c) => c.id); const c = CABINS.find((x) => x.id === id)!; game.teleport(c.x + Math.sin(c.yaw) * 24, c.z + Math.cos(c.yaw) * 24, c.yaw + Math.PI); return c.name; }],
    pos: ['pos(): where am I', () => { const p = game.player.v.position(); return { x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1), ground: +game.ground(p.x, p.z).toFixed(1), surface: game.surfaceName(), biome: game.biomeName() }; }],
    fix: ['fix(): repair damage and refill nitro', () => { game.player.v.damage = 0; game.player.v.axleDamage = 0; game.player.v.nitro = 1; return 'repaired'; }],
    autopilot: ['autopilot(on = true): AI drives the player (current race or road)', (on = true) => { api.autopilot(on); return on; }],
    preset: ['preset(name): graphics preset potato | medium | high | ultra', (n: keyof typeof PRESETS) => { game.applySettings({ ...PRESETS[n] }); return n; }],
    fps: ['fps(): current frame rate and draw stats', () => ({ fps: +game.fps.toFixed(1), calls: game.gfx.renderer.info.render.calls, tris: game.gfx.renderer.info.render.triangles })],
    reset: ['reset(): wipe the save (reloads)', () => { localStorage.clear(); location.reload(); }],
  };
  const dev: Record<string, unknown> = {};
  for (const [k, [, f]] of Object.entries(cmds)) dev[k] = f;
  return dev;
}
