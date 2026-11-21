// Downloads CC0 assets from Poly Haven (https://polyhaven.com — every asset is CC0) and packs them for the web.
//   node tools/fetch-assets.mjs           fetch anything missing
//   node tools/fetch-assets.mjs --force   re-process everything
// Raw downloads go to assets-src/ (gitignored); optimised output goes to public/assets/ (committed).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'assets-src');
const OUT = path.join(ROOT, 'public', 'assets');
const FORCE = process.argv.includes('--force');
const UA = { 'User-Agent': 'apex-overland-asset-build' };

// Terrain layers, in shader index order (keep in sync with src/world/terrainLayers.ts).
export const TERRAIN = [
  'red_sand', 'cracked_red_ground', 'cliff_side', 'forest_ground_04', 'forrest_ground_01', 'snow_02',
  'dry_riverbed_rock', 'gravel_floor', 'muddy_tracks', 'stony_dirt_path', 'rock_face_03', 'worn_asphalt',
];
// Surface materials for props, cabins and vehicles: diffuse + normal + arm.
export const MATERIALS = ['weathered_planks', 'rusty_metal_02', 'rusty_corrugated_iron', 'pine_bark', 'bark_brown_02', 'metal_plate', 'concrete_floor_painted', 'red_sandstone_wall'];
// id -> simplify ratio
// HDRI for image-based lighting: public/assets/hdri/kloofendal_43d_clear_1k.hdr (https://polyhaven.com/a/kloofendal_43d_clear)
export const MODELS = {
  namaqualand_boulder_02: 0.04, namaqualand_boulder_05: 0.05, boulder_01: 0.05, rock_07: 0.08, rock_09: 0.08,
  quiver_tree_01: 0.25, dead_tree_trunk: 0.08, tree_stump_01: 0.15, shrub_02: 0.5, wild_rooibos_bush: 0.35, fern_02: 1,
  wooden_barrels_01: 0.5, wooden_crate_01: 1, barrel_03: 0.5,
};

async function getJSON(url) {
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(url, { headers: UA }); if (r.ok) return r.json(); } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw new Error('failed ' + url);
}
async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(url, { headers: UA }); if (r.ok) { fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); return; } } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw new Error('failed ' + url);
}
async function texFiles(id) {
  const f = await getJSON(`https://api.polyhaven.com/files/${id}`);
  const pick = (k) => f[k]?.['1k']?.jpg?.url;
  return { diff: pick('Diffuse') ?? pick('col_01') ?? pick('col_1') ?? pick('Color'), nor: pick('nor_gl'), arm: pick('arm'), rough: pick('Rough'), ao: pick('AO'), disp: pick('Displacement') };
}

async function fetchTerrain(id) {
  const a = path.join(OUT, 'terrain', id + '_ah.webp'), n = path.join(OUT, 'terrain', id + '_nr.webp');
  if (fs.existsSync(a) && fs.existsSync(n) && !FORCE) return;
  const u = await texFiles(id);
  const dir = path.join(SRC, 'textures', id);
  const loc = {};
  for (const [k, url] of Object.entries(u)) if (url) { loc[k] = path.join(dir, k + '.jpg'); await download(url, loc[k]); }
  const S = 1024;
  const raw = async (file) => sharp(file).resize(S, S).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const diff = await raw(loc.diff), nor = await raw(loc.nor);
  const disp = loc.disp ? await raw(loc.disp) : null;
  const arm = loc.arm ? await raw(loc.arm) : null;
  const rough = !arm && loc.rough ? await raw(loc.rough) : null;
  const ah = Buffer.alloc(S * S * 4), nr = Buffer.alloc(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const c = diff.info.channels;
    ah[i * 4] = diff.data[i * c]; ah[i * 4 + 1] = diff.data[i * c + 1]; ah[i * 4 + 2] = diff.data[i * c + 2];
    ah[i * 4 + 3] = disp ? disp.data[i * disp.info.channels] : 128;
    const cn = nor.info.channels;
    nr[i * 4] = nor.data[i * cn]; nr[i * 4 + 1] = nor.data[i * cn + 1];
    nr[i * 4 + 2] = arm ? arm.data[i * arm.info.channels + 1] : rough ? rough.data[i * rough.info.channels] : 200;
    nr[i * 4 + 3] = arm ? arm.data[i * arm.info.channels] : 255;
  }
  fs.mkdirSync(path.dirname(a), { recursive: true });
  // lossless keeps the packed alpha (height / ao) exact; near-lossless keeps files small
  await sharp(ah, { raw: { width: S, height: S, channels: 4 } }).webp({ quality: 88, alphaQuality: 100, effort: 5 }).toFile(a);
  await sharp(nr, { raw: { width: S, height: S, channels: 4 } }).webp({ nearLossless: true, quality: 70, effort: 5 }).toFile(n);
  console.log('terrain', id);
}

async function fetchMaterial(id) {
  const base = path.join(OUT, 'materials', id);
  if (fs.existsSync(base + '_diff.webp') && !FORCE) return;
  const u = await texFiles(id);
  const dir = path.join(SRC, 'textures', id);
  fs.mkdirSync(path.dirname(base), { recursive: true });
  for (const k of ['diff', 'nor', 'arm']) {
    if (!u[k]) continue;
    const f = path.join(dir, k + '.jpg');
    await download(u[k], f);
    await sharp(f).resize(1024, 1024).webp({ quality: k === 'diff' ? 86 : 90 }).toFile(`${base}_${k}.webp`);
  }
  console.log('material', id);
}

async function fetchModel(id, ratio) {
  const out = path.join(OUT, 'models', id + '.glb');
  if (fs.existsSync(out) && !FORCE) return;
  const files = await getJSON(`https://api.polyhaven.com/files/${id}`);
  const g = files.gltf['1k'].gltf;
  const dir = path.join(SRC, 'models', id);
  const main = path.join(dir, path.basename(g.url));
  await download(g.url, main);
  await Promise.all(Object.entries(g.include).map(([p, v]) => download(v.url, path.join(dir, p))));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const args = ['optimize', main, out, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '1024',
    '--join', 'true', '--flatten', 'true', '--instance', 'false', '--palette', 'false'];
  if (ratio < 1) args.push('--simplify', 'true', '--simplify-ratio', String(ratio), '--simplify-error', '0.004');
  else args.push('--simplify', 'false');
  execFileSync(path.join(ROOT, 'node_modules/.bin/gltf-transform'), args, { stdio: 'pipe' });
  console.log('model', id, (fs.statSync(out).size / 1e6).toFixed(2) + 'MB');
}

const all = [...TERRAIN.map((t) => () => fetchTerrain(t)), ...MATERIALS.map((m) => () => fetchMaterial(m)), ...Object.entries(MODELS).map(([m, r]) => () => fetchModel(m, r))];
const N = 4; let i = 0;
await Promise.all(Array.from({ length: N }, async () => { while (i < all.length) { const job = all[i++]; try { await job(); } catch (e) { console.error('FAILED', e.message); } } }));
fs.writeFileSync(path.join(OUT, 'CREDITS.txt'), 'All textures and models in this folder are from Poly Haven (https://polyhaven.com) and are licensed CC0.\n\n' + [...TERRAIN, ...MATERIALS, ...Object.keys(MODELS)].map((x) => `- ${x}: https://polyhaven.com/a/${x}`).join('\n') + '\n');
console.log('done');
