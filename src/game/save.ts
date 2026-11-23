// Player profile: coins, garage, upgrades, barn finds, best times, settings. Persisted to localStorage.
import { STOCK, type Upgrades } from '../vehicles/defs';
import type { GfxSettings } from '../render/gfx';
import type { Daily } from './progress';

export interface Profile {
  v: number; coins: number; owned: string[]; current: string; upgrades: Record<string, Upgrades>;
  barns: string[]; snake: boolean; best: Record<string, number>; wins: Record<string, number>; found: string[];
  trapBest: Record<string, number>; settings?: GfxSettings; logsSmashed: number; distance: number; volume: number; musicVol?: number; musicOn?: boolean;
  name?: string; level?: number; xp?: number; tokens?: number[]; daily?: Daily; driftTotal?: number; chainBest?: number;
}
const KEY = 'apex-overland-save-v1';
export function loadProfile(): Profile {
  const def: Profile = { v: 1, coins: 6000, owned: ['crawler'], current: 'crawler', upgrades: {}, barns: [], snake: false, best: {}, wins: {}, found: [], trapBest: {}, logsSmashed: 0, distance: 0, volume: 0.7 };
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...def, ...JSON.parse(raw) }; } catch { /* private mode */ }
  return def;
}
export function saveProfile(p: Profile) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ } }
export function upgradesOf(p: Profile, id: string): Upgrades { return (p.upgrades[id] ??= { ...STOCK }); }
