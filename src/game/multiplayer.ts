// Online multiplayer: up to 8 drivers in one world over WebRTC (PeerJS signalling, host relays: star topology).
// Every client simulates its own vehicle and streams its pose at 15 Hz; the others appear as full vehicle models with
// name tags, kinematic bodies you can bump into, minimap dots, and a shared leaderboard in multiplayer races
// (the host starts a race for everyone; each player gets their own grid slot).
import * as THREE from 'three';
import type { Game } from './game';
import { PeerTransport, LocalTransport, lobbyCode, type Transport, type Msg } from './net';
import { VEH, STOCK, stats, modsOf, type Upgrades } from '../vehicles/defs';
import { buildVisual, type VehicleVisual } from '../vehicles/models';
import { RAPIER, G, groups } from '../physics/physics';
import { saveProfile } from './save';

const esc = (t: unknown, n = 24) => String(t ?? '').slice(0, n).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
const SEND_HZ = 15, DELAY = 0.13, MAX_PLAYERS = 8;
type Pose = [number, number, number, number, number, number, number];   // x y z qx qy qz qw
interface Snap { t: number; parts: Pose[]; spd: number; steer: number }
export interface RemoteRace { id: string; rem: number; fin: number; slot: number }

class Remote {
  vis: VehicleVisual[] = []; bodies: RAPIER.RigidBody[] = [];
  buf: Snap[] = []; offset = Infinity; label: HTMLElement; vehId = ''; paint = ''; spin = 0; race?: RemoteRace; lastSeen = 0;
  constructor(public id: string, public name: string, private g: Game) {
    this.label = document.createElement('div'); this.label.className = 'nametag'; this.label.textContent = name;
    g.ui.root.appendChild(this.label);
  }
  setVehicle(vehId: string, paint: string) {
    if (vehId === this.vehId && paint === this.paint) return;
    this.dispose(false);
    const d = VEH[vehId] ?? VEH.pickup, up: Upgrades = { ...STOCK, paint: paint || undefined } as Upgrades, st = stats(d, up);
    this.vehId = vehId; this.paint = paint;
    const W = this.g.phys.world;
    for (let m = 0; m < modsOf(d); m++) {
      const vis = buildVisual(d, up, st, m); this.g.gfx.scene.add(vis.root); this.vis.push(vis);
      // a kinematic box you can bump into (it's driven by the network, not by the collision)
      const y0 = d.ride + st.rideLift;
      const b = W.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -500, 0));
      W.createCollider(RAPIER.ColliderDesc.cuboid(Math.max(0.3, d.wid / 2 - 0.05), Math.max(0.3, d.hgt * 0.4), d.special === 'snake' ? 1.1 : d.len / 2).setTranslation(0, y0 + d.hgt * 0.4, 0)
        .setFriction(0.5).setCollisionGroups(groups(G.VEHICLE, G.VEHICLE | G.SNAKE)), b);
      this.bodies.push(b);
    }
  }
  push(s: Snap, now: number) {
    this.offset = Math.min(this.offset + 0.0005, now - s.t);   // lowest one-way delay seen (slowly forgets, follows drift)
    if (this.buf.length && s.t <= this.buf[this.buf.length - 1].t) return;
    this.buf.push(s); if (this.buf.length > 30) this.buf.shift();
    this.lastSeen = now;
  }
  update(now: number, dt: number, cam: THREE.Camera, w: number, h: number) {
    const b = this.buf; if (!b.length || !this.vis.length) return;
    const rt = now - this.offset - DELAY;
    while (b.length > 2 && b[1].t <= rt) b.shift();
    let a = b[0], c = b[Math.min(1, b.length - 1)], u = 0;
    if (b.length >= 2 && rt > a.t) u = Math.min(1.6, (rt - a.t) / Math.max(1e-3, c.t - a.t));   // up to 60% extrapolation on gaps
    if (rt <= a.t) c = a;
    const qa = new THREE.Quaternion(), qc = new THREE.Quaternion();
    this.vis.forEach((vis, i) => {
      const pa = a.parts[i] ?? a.parts[0], pc = c.parts[i] ?? pa;
      vis.root.position.set(pa[0] + (pc[0] - pa[0]) * u, pa[1] + (pc[1] - pa[1]) * u, pa[2] + (pc[2] - pa[2]) * u);
      qa.set(pa[3], pa[4], pa[5], pa[6]); qc.set(pc[3], pc[4], pc[5], pc[6]);
      vis.root.quaternion.slerpQuaternions(qa, qc, Math.min(1, u));
      vis.root.updateMatrixWorld();
      const body = this.bodies[i];
      body?.setNextKinematicTranslation(vis.root.position); body?.setNextKinematicRotation(vis.root.quaternion);
      const spd = a.spd + (c.spd - a.spd) * Math.min(1, u);
      for (const wv of vis.wheels) { wv.spin.rotation.x += spd * dt / 0.45; wv.steer.rotation.y = c.steer * 0.5 * Math.sign(wv.z); }
    });
    // name tag
    const p = this.vis[0].root.position.clone(); p.y += 3.2;
    const d = p.distanceTo(cam.position); p.project(cam);
    const vis = p.z < 1 && d < 900 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
    this.label.style.display = vis ? '' : 'none';
    if (vis) { this.label.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px) translate(-50%, -100%) scale(${Math.max(0.6, Math.min(1, 80 / d + 0.5))})`; this.label.textContent = `${this.name}${d > 60 ? ` · ${Math.round(d)} m` : ''}`; }
  }
  pos() { return this.vis[0]?.root.position; }
  dispose(label = true) {
    for (const v of this.vis) v.root.removeFromParent();
    for (const b of this.bodies) this.g.phys.world.removeRigidBody(b);
    this.vis = []; this.bodies = [];
    if (label) this.label.remove();
  }
}

export class Multiplayer {
  net: Transport | null = null; code = ''; remotes = new Map<string, Remote>();
  private sendT = 0; status = '';
  /** Slot on the starting grid for the current multiplayer race (0 = pole). */
  raceSlot = -1; raceId = '';
  myFin = 0;
  constructor(private g: Game) {}
  get active() { return !!this.net; }
  get isHost() { return !!this.net?.isHost; }
  get name() { return (this.g.profile.name ||= 'Driver' + Math.floor(1000 + Math.random() * 9000)); }
  setName(n: string) { this.g.profile.name = n.slice(0, 16) || this.name; saveProfile(this.g.profile); }
  private local() { return new URLSearchParams(location.search).has('localnet'); }

  async host() {
    this.leave();
    this.code = lobbyCode(); this.status = 'Opening lobby…';
    this.net = this.local() ? await LocalTransport.host(this.code) : await PeerTransport.host(this.code);
    this.wire();
    this.status = `Hosting · code ${this.code}`;
    this.g.ui.toast(`🌐 Lobby open: code <b>${this.code}</b> · friends join from Menu → Multiplayer`, 'ok', 8);
  }
  async join(code: string) {
    this.leave();
    this.code = code.trim().toUpperCase(); this.status = 'Joining…';
    this.net = this.local() ? await LocalTransport.join(this.code) : await PeerTransport.join(this.code);
    this.wire();
    this.status = `In lobby ${this.code}`;
    this.net.send(this.hostId(), { k: 'hi', n: this.name });
    this.g.ui.toast(`🌐 Joined lobby ${this.code}`, 'ok', 4);
  }
  leave() {
    if (!this.net) return;
    try { this.net.broadcast({ k: 'bye' }); this.net.close(); } catch { /* already gone */ }
    this.net = null; this.code = ''; this.status = '';
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear(); this.raceSlot = -1; this.raceId = '';
  }
  private hostId() { return this.net!.peers()[0]; }
  private wire() {
    const net = this.net!;
    net.onJoin = (peer) => {
      if (net.isHost && this.remotes.size >= MAX_PLAYERS - 1) { net.send(peer, { k: 'full' }); return; }
    };
    net.onLeave = (peer) => { const r = this.remotes.get(peer); if (r) { this.g.ui.toast(`${esc(r.name)} left`, 'warn', 3); r.dispose(); this.remotes.delete(peer); } if (!net.isHost) { this.g.ui.toast('Lost connection to the host', 'warn', 5); this.leave(); } };
    net.onMessage = (from, m) => this.onMsg(from, m);
  }
  private onMsg(from: string, m: Msg) {
    const net = this.net!, now = performance.now() / 1000;
    // host relays everything a client says to everyone else (tagged with who said it)
    const src: string = m.from ?? from;
    if (net.isHost && !m.from && m.k !== 'hi') net.broadcast({ ...m, from }, from);
    switch (m.k) {
      case 'hi': if (net.isHost) { this.g.ui.toast(`🌐 ${esc(m.n)} joined`, 'ok', 3); net.broadcast({ k: 'hi', n: m.n, from }, from); } else this.g.ui.toast(`🌐 ${esc(m.n)} joined`, 'ok', 3); break;
      case 'full': this.g.ui.toast('That lobby is full', 'warn'); this.leave(); break;
      case 'bye': { const r = this.remotes.get(src); if (r) { this.g.ui.toast(`${esc(r.name)} left`, 'warn', 3); r.dispose(); this.remotes.delete(src); } break; }
      case 's': {
        if (src === net.selfId) break;
        let r = this.remotes.get(src);
        if (!r) { r = new Remote(src, m.n, this.g); this.remotes.set(src, r); }
        r.name = String(m.n ?? '').slice(0, 16); r.setVehicle(m.v, m.c);
        r.push({ t: m.t, parts: m.p, spd: m.sp, steer: m.st }, now);
        r.race = m.r;
        break;
      }
      case 'race': {
        // the host started a race for everyone
        const slot = (m.slots as Record<string, number>)[net.selfId];
        if (slot === undefined) break;
        this.startRace(m.id, slot);
        break;
      }
      case 'chat': this.g.ui.toast(`💬 <b>${esc(m.n)}</b>: ${esc(m.text, 120)}`, 'info', 6); break;
    }
  }
  /** Host: start `id` for everyone in the lobby. */
  hostRace(id: string) {
    const net = this.net!; const ids = [net.selfId, ...this.remotes.keys()];
    const slots: Record<string, number> = {}; ids.forEach((p, i) => (slots[p] = i));
    net.broadcast({ k: 'race', id, slots });
    this.startRace(id, 0);
  }
  private startRace(id: string, slot: number) {
    this.raceSlot = slot; this.raceId = id; this.myFin = 0;
    this.g.closeOverlays();
    this.g.startRace(id, { slot, rivals: 0 });
    this.g.ui.toast('🌐 Multiplayer race! Beat your friends to the line.', 'ok', 4);
  }
  chat(text: string) { if (!this.net || !text.trim()) return; const m = { k: 'chat', n: this.name, text: text.trim().slice(0, 120) }; if (this.net.isHost) this.net.broadcast(m); else this.net.send(this.hostId(), m); this.g.ui.toast(`💬 <b>You</b>: ${m.text.replace(/</g, '&lt;')}`, 'info', 4); }

  /** Standings for the multiplayer race panel: me + everyone racing the same event. */
  standings() {
    const R = this.g.race; if (!R || !this.raceId) return null;
    const me = { name: 'You', rem: R.player.remain, fin: R.player.finished, me: true };
    const rows = [me, ...[...this.remotes.values()].filter((r) => r.race?.id === this.raceId).map((r) => ({ name: r.name, rem: r.race!.rem, fin: r.race!.fin, me: false }))];
    return rows.sort((a, b) => (a.fin && b.fin ? a.fin - b.fin : a.fin ? -1 : b.fin ? 1 : a.rem - b.rem));
  }

  update(dt: number) {
    if (!this.net) return;
    const now = performance.now() / 1000, g = this.g, cam = g.gfx.camera, w = window.innerWidth, h = window.innerHeight;
    for (const [id, r] of this.remotes) { if (now - r.lastSeen > 10 && r.lastSeen > 0) { r.dispose(); this.remotes.delete(id); continue; } r.update(now, dt, cam, w, h); }
    this.sendT -= dt;
    if (this.sendT > 0) return;
    this.sendT = 1 / SEND_HZ;
    const e = g.player, R = g.race;
    const parts: Pose[] = e.v.parts.map((p) => { const t = p.body.translation(), q = p.body.rotation(); return [t.x, t.y, t.z, q.x, q.y, q.z, q.w].map((v, i) => Math.round(v * (i < 3 ? 100 : 10000)) / (i < 3 ? 100 : 10000)) as Pose; });
    const msg: Msg = { k: 's', n: this.name, t: now, v: e.def.id, c: e.up.paint ?? '', p: parts, sp: Math.round(e.v.speed() * 10) / 10, st: Math.round(e.controls.steer * 100) / 100 };
    if (R && this.raceId === R.def.id) msg.r = { id: R.def.id, rem: Math.round(R.player.remain), fin: R.player.finished ? Math.round(R.player.finished * 100) / 100 : 0, slot: this.raceSlot };
    if (this.net.isHost) this.net.broadcast(msg); else this.net.send(this.hostId(), msg);
  }
  /** Minimap dots. */
  positions() { return [...this.remotes.values()].map((r) => ({ name: r.name, p: r.pos() })).filter((q) => q.p); }
}
