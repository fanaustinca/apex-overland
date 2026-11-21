// Procedural liveries painted onto the body flanks (extrude caps use metre UVs: u = along the body, v = height).
import * as THREE from 'three';

const SPONSORS = ['APEX', 'TERRA', 'DUNE·CO', 'RIDGELINE', 'MUDWORKS', 'NORTHPEAK', 'GRAVEL+', 'OVERLAND', 'IRONCLAW', 'SUMMIT'];
const cache = new Map<string, THREE.Texture>();

export interface LiveryOpts { base: string; accent: string; style: 'rally' | 'stripe' | 'band' | 'camo' | 'snake' | 'plain'; num: number; L: number; H: number }

export function liveryTexture(o: LiveryOpts): THREE.Texture {
  const key = JSON.stringify(o);
  const hit = cache.get(key); if (hit) return hit;
  const W = 2048, Hh = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = Hh;
  const g = c.getContext('2d')!;
  const px = (u: number) => u * W, py = (v: number) => Hh - v * Hh;   // v from the bottom
  g.fillStyle = o.base; g.fillRect(0, 0, W, Hh);
  const sh = g.createLinearGradient(0, 0, 0, Hh); sh.addColorStop(0, 'rgba(255,255,255,0.10)'); sh.addColorStop(0.55, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.18)');
  g.fillStyle = sh; g.fillRect(0, 0, W, Hh);
  const rnd = (k: number) => { const x = Math.sin(o.num * 91.7 + k * 13.1) * 43758.5; return x - Math.floor(x); };
  if (o.style === 'camo') {
    const cols = ['#4a5232', '#2f3524', '#6b6a48', '#3d4630'];
    for (let i = 0; i < 90; i++) { g.fillStyle = cols[i % 4]; g.beginPath(); const x = rnd(i) * W, y = rnd(i + 50) * Hh, r = 30 + rnd(i + 99) * 90; g.ellipse(x, y, r * 1.6, r, rnd(i + 7) * 3, 0, Math.PI * 2); g.fill(); }
  } else if (o.style === 'snake') {
    g.fillStyle = o.accent;
    for (let i = 0; i < 40; i++) { const x = i * W / 40; g.beginPath(); g.moveTo(x, py(0.32)); g.lineTo(x + W / 80, py(0.42)); g.lineTo(x + W / 40, py(0.32)); g.lineTo(x + W / 80, py(0.22)); g.closePath(); g.fill(); }
    g.fillStyle = '#d9f99d'; g.font = `900 ${Hh * 0.16}px "Segoe UI", Arial`; g.textAlign = 'center'; g.fillText('THE SNAKE', W * 0.5, py(0.6));
  } else if (o.style !== 'plain') {
    // lower accent band with a raked cut
    g.fillStyle = o.accent;
    g.beginPath(); g.moveTo(0, py(0)); g.lineTo(0, py(o.style === 'band' ? 0.42 : 0.3)); g.lineTo(W * 0.35, py(o.style === 'band' ? 0.42 : 0.3)); g.lineTo(W * 0.62, py(0.16)); g.lineTo(W, py(0.16)); g.lineTo(W, py(0)); g.closePath(); g.fill();
    // pinstripes
    g.strokeStyle = o.style === 'stripe' ? o.accent : 'rgba(255,255,255,0.85)'; g.lineWidth = 7;
    g.beginPath(); g.moveTo(0, py(0.36)); g.lineTo(W * 0.37, py(0.36)); g.lineTo(W * 0.64, py(0.2)); g.lineTo(W, py(0.2)); g.stroke();
    if (o.style === 'stripe') { g.lineWidth = 22; g.beginPath(); g.moveTo(0, py(0.55)); g.lineTo(W, py(0.55)); g.stroke(); }
    if (o.style === 'rally') {
      // number roundel + sponsors
      const cx = W * 0.52, cy = py(0.55), r = Hh * 0.17;
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#111'; g.lineWidth = 6; g.stroke();
      g.fillStyle = '#111'; g.font = `900 ${r * 1.25}px "Segoe UI", Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(o.num), cx, cy + r * 0.06);
      g.font = `800 ${Hh * 0.075}px "Segoe UI", Arial`;
      for (let i = 0; i < 3; i++) {
        const s = SPONSORS[(o.num + i * 3) % SPONSORS.length];
        const x = W * (0.2 + i * 0.27) + (i === 1 ? W * 0.12 : 0), y = py(i === 1 ? 0.25 : 0.24);
        const tw = g.measureText(s).width + 26;
        g.fillStyle = i % 2 ? '#111' : '#fff'; g.fillRect(x - tw / 2, y - Hh * 0.055, tw, Hh * 0.11);
        g.fillStyle = i % 2 ? '#ffd21a' : '#111'; g.fillText(s, x, y + 2);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.repeat.set(1 / o.L, 1 / o.H); t.offset.set(0.5, 0);
  cache.set(key, t);
  return t;
}

export function plateTexture(text: string): THREE.Texture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f3f1e8'; g.fillRect(0, 0, 256, 64); g.strokeStyle = '#222'; g.lineWidth = 4; g.strokeRect(3, 3, 250, 58);
  g.fillStyle = '#1a3a8a'; g.fillRect(3, 3, 26, 58);
  g.fillStyle = '#111'; g.font = '800 40px "Segoe UI", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 142, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
