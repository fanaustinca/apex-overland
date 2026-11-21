// Keyboard + gamepad input with smoothed steering.
import type { Controls } from '../vehicles/vehicle';

export class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  steer = 0;
  enabled = true;
  mouse = { dx: 0, dy: 0, down: false, wheel: 0 };
  constructor() {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    const c = document.getElementById('c')!;
    c.addEventListener('mousedown', () => (this.mouse.down = true));
    window.addEventListener('mouseup', () => (this.mouse.down = false));
    window.addEventListener('mousemove', (e: MouseEvent) => { if (this.mouse.down) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; } });
    c.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
  }
  take(code: string) { const p = this.pressed.has(code); this.pressed.delete(code); return p; }
  endFrame() { this.pressed.clear(); this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0; }
  down(...codes: string[]) { return codes.some((c) => this.keys.has(c)); }
  controls(dt: number, out: Controls) {
    const pad = navigator.getGamepads?.()[0];
    let thr = this.down('KeyW', 'ArrowUp') ? 1 : 0, brk = this.down('KeyS', 'ArrowDown') ? 1 : 0;
    let st = (this.down('KeyA', 'ArrowLeft') ? 1 : 0) - (this.down('KeyD', 'ArrowRight') ? 1 : 0);
    let hb = this.down('Space'), nos = this.down('ShiftLeft', 'ShiftRight', 'KeyN'), hop = this.down('Space');
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      if (Math.abs(ax) > 0.12) st = -ax;
      thr = Math.max(thr, pad.buttons[7]?.value ?? 0); brk = Math.max(brk, pad.buttons[6]?.value ?? 0);
      hb = hb || !!pad.buttons[0]?.pressed; nos = nos || !!pad.buttons[1]?.pressed; hop = hop || !!pad.buttons[0]?.pressed;
    }
    if (!this.enabled) { thr = 0; brk = 0; st = 0; hb = false; nos = false; hop = false; }
    // steering ramps like a real wheel; returns to centre faster
    const rate = st === 0 || Math.sign(st) !== Math.sign(this.steer) ? 5 : 2.6;
    this.steer += Math.max(-rate * dt, Math.min(rate * dt, st - this.steer));
    out.throttle = thr; out.brake = brk; out.steer = this.steer; out.handbrake = hb; out.nitro = nos; out.hop = hop;
  }
}
