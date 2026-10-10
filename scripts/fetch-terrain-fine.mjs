// Fine core terrain for the Douro gorge: AWS Terrain Tiles (Terrarium PNG,
// https://registry.opendata.aws/terrain-tiles/), resampled to a ~10 m grid over
// the core bbox plus a margin, packed as data/terrain-fine.bin.gz.
// Node 22, no dependencies. Run:
//   node scripts/fetch-terrain-fine.mjs [--city porto] [--compare] [--no-pack]
// --compare prints the Terrarium height against the EU-DEM lattice (data/terrain.json)
// at known points and writes nothing.
//
// Terrarium: height = r * 256 + g + b / 256 - 32768 (metres above sea level).
// Pack format (src/terrain-fine.js): see packFine / unpackFine there. The grid is
// stored as Int16 centimetres above sea level minus an offset, delta coded along
// rows (the DEM is smooth, so gzip then shrinks it by a factor of five or more).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync, gzipSync, inflateSync } from 'node:zlib';
import { CITY, CORE_BBOX, USER_AGENT, dataPath, cachePath } from './geo-lib.mjs';
import { packFine } from '../src/terrain-fine.js';

const Z = 14;
const MARGIN_DEG = 0.004; // beyond the core bbox: a ring the coarse grid blends into
const STEP_M = 12;
const TILE_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

// ---- minimal PNG decoder: 8-bit, non-interlaced, colour types 2 and 6
function decodePng(buf) {
  let p = 8;
  let w = 0, h = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      ct = body[9];
      if (body[8] !== 8 || body[12] !== 0) throw new Error('unsupported PNG');
    } else if (type === 'IDAT') idat.push(body);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!bpp) throw new Error(`colour type ${ct}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[y * stride + i - bpp] : 0;
      const b = y ? out[(y - 1) * stride + i] : 0;
      const c = i >= bpp && y ? out[(y - 1) * stride + i - bpp] : 0;
      let v = raw[src + i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + i] = v & 255;
    }
  }
  const H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) H[i] = out[i * bpp] * 256 + out[i * bpp + 1] + out[i * bpp + 2] / 256 - 32768;
  return { w, h, H };
}

async function tile(z, x, y) {
  const file = cachePath('terrarium', `${z}_${x}_${y}.png`);
  let buf;
  if (existsSync(file)) buf = readFileSync(file);
  else {
    for (let a = 0; a < 4 && !buf; a++) {
      try {
        const r = await fetch(TILE_URL(z, x, y), { headers: { 'User-Agent': USER_AGENT } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        buf = Buffer.from(await r.arrayBuffer());
      } catch (e) {
        if (a === 3) throw e;
        await new Promise((res) => setTimeout(res, 800 * (a + 1)));
      }
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, buf);
  }
  return decodePng(buf);
}

const bbox = {
  s: CORE_BBOX.s - MARGIN_DEG,
  n: CORE_BBOX.n + MARGIN_DEG,
  w: CORE_BBOX.w - MARGIN_DEG * 1.3,
  e: CORE_BBOX.e + MARGIN_DEG * 1.3,
};
const tx0 = Math.floor(lon2x(bbox.w, Z)), tx1 = Math.floor(lon2x(bbox.e, Z));
const ty0 = Math.floor(lat2y(bbox.n, Z)), ty1 = Math.floor(lat2y(bbox.s, Z));
const tiles = new Map();
for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) tiles.set(`${x}_${y}`, await tile(Z, x, y));
console.log(`z${Z}: ${tiles.size} tiles, x ${tx0}..${tx1}, y ${ty0}..${ty1}`);

// bilinear height at lon/lat, from the tile pixel lattice (pixel centres)
function terrarium(lat, lon) {
  const px = lon2x(lon, Z) * 256 - 0.5;
  const py = lat2y(lat, Z) * 256 - 0.5;
  const x0 = Math.floor(px), y0 = Math.floor(py);
  const tx = px - x0, ty = py - y0;
  const at = (X, Y) => {
    const t = tiles.get(`${Math.floor(X / 256)}_${Math.floor(Y / 256)}`);
    if (!t) throw new Error('outside the tile set');
    return t.H[(((Y % 256) + 256) % 256) * 256 + (((X % 256) + 256) % 256)];
  };
  return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
}

// EU-DEM lattice (data/terrain.json), bilinear, as the engine reads it (raw)
const T = JSON.parse(readFileSync(dataPath('terrain.json'), 'utf8'));
function eudem(lat, lon) {
  const fc = ((lon - T.bbox.w) / (T.bbox.e - T.bbox.w)) * (T.cols - 1);
  const fr = ((lat - T.bbox.s) / (T.bbox.n - T.bbox.s)) * (T.rows - 1);
  const c0 = Math.min(T.cols - 2, Math.floor(fc)), r0 = Math.min(T.rows - 2, Math.floor(fr));
  const tc = fc - c0, tr = fr - r0;
  const h = (r, c) => T.heights[r * T.cols + c];
  return (h(r0, c0) * (1 - tc) + h(r0, c0 + 1) * tc) * (1 - tr) + (h(r0 + 1, c0) * (1 - tc) + h(r0 + 1, c0 + 1) * tc) * tr;
}

if (process.argv.includes('--compare')) {
  // reference: surveyed ground heights (m above sea level), rounded
  const pts = [
    // landmark points of data/landmarks.json; ref = ground height from the city's
    // published spot heights (Clerigos ~80, Ribeira quay 3-5, Serra do Pilar ~100,
    // Jardim do Morro ~85, Palacio de Cristal ~90, Foz promenade ~8)
    ['Clerigos', 41.14563, -8.61456, 80],
    ['Ribeira quay', 41.14075, -8.61298, 4],
    ['Serra do Pilar', 41.13834, -8.60781, 100],
    ['Jardim do Morro', 41.13714, -8.60923, 85],
    ['Palacio de Cristal', 41.15442, -8.62503, 90],
    ['Foz (S. Joao Baptista)', 41.14901, -8.6688, 8],
    ['Douro mid-river (Luis I)', 41.1400, -8.6095, 0],
  ];
  console.log('point'.padEnd(26), 'ref'.padStart(5), 'EU-DEM'.padStart(8), 'Terrarium'.padStart(10));
  let e1 = 0, e2 = 0;
  for (const [n, la, lo, ref] of pts) {
    const a = eudem(la, lo), b = terrarium(la, lo);
    e1 += Math.abs(a - ref);
    e2 += Math.abs(b - ref);
    console.log(n.padEnd(26), String(ref).padStart(5), a.toFixed(1).padStart(8), b.toFixed(1).padStart(10));
  }
  console.log(`mean abs error: EU-DEM ${(e1 / pts.length).toFixed(1)} m, Terrarium ${(e2 / pts.length).toFixed(1)} m`);
  // cross-section through the gorge at Ribeira -> Gaia (steepness check)
  console.log('profile lat 41.1405, lon -8.6140 .. -8.6040 (every ~14 m): EU-DEM | Terrarium');
  for (let i = 0; i <= 8; i++) {
    const lo = -8.614 + (0.01 * i) / 8;
    console.log(lo.toFixed(5), eudem(41.1405, lo).toFixed(1).padStart(7), terrarium(41.1405, lo).toFixed(1).padStart(7));
  }
  process.exit(0);
}

// ---- the fine grid: regular in metres on the engine's equirectangular frame.
// Rows go south -> north, columns west -> east, like terrain.json, but the step is
// in metres (STEP_M) so the cells are square on the ground.
const KLAT = 111320;
const KLON = KLAT * Math.cos((CITY.origin.lat * Math.PI) / 180);
const dLat = STEP_M / KLAT, dLon = STEP_M / KLON;
const cols = Math.round((bbox.e - bbox.w) / dLon) + 1;
const rows = Math.round((bbox.n - bbox.s) / dLat) + 1;
const heights = new Float32Array(cols * rows);
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) heights[r * cols + c] = terrarium(bbox.s + r * dLat, bbox.w + c * dLon);
// Datum match. Terrarium holds the Douro at 2.5 to 3 m where the EU-DEM lattice
// (and so the water level every module reads, the bridge decks and the quays)
// holds it at 1 m. Pull the river surface band down by 2 m so the water stays
// where it was; ground above ~7 m and the sea (0 m) are left alone.
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
for (let i = 0; i < heights.length; i++) {
  const h = heights[i];
  heights[i] = h - 2.0 * sstep(2.0, 2.6, h) * (1 - sstep(3.5, 7.0, h));
}
let min = Infinity, max = -Infinity;
for (const v of heights) { if (v < min) min = v; if (v > max) max = v; }
const fine = {
  bbox: { s: bbox.s, w: bbox.w, n: bbox.s + (rows - 1) * dLat, e: bbox.w + (cols - 1) * dLon },
  cols, rows, step_m: STEP_M, min_m: min, max_m: max, source: `aws terrarium z${Z}`, heights,
};
console.log(`fine grid ${cols} x ${rows} (${(cols * rows / 1e3).toFixed(0)}k samples), ${min.toFixed(1)}..${max.toFixed(1)} m`);
if (!process.argv.includes('--no-pack')) {
  const bin = packFine(fine);
  const gz = gzipSync(bin, { level: 9 });
  const out = dataPath('terrain-fine.bin.gz');
  writeFileSync(out, gz);
  console.log(`wrote ${out}: ${bin.length} B binary, ${gz.length} B gzip`);
}
