// Fetch a real elevation grid for a city and its surroundings and write <data dir>/terrain.json.
// Source: OpenTopoData (EU-DEM 25 m, fallback SRTM 30 m), fallback Open-Elevation.
// Node 22, no dependencies. Run: node scripts/fetch-terrain.mjs [--city <id>] [--dry-run]
// (default city: braga; see cities/<id>.json). A city without a terrain file
// or core cache has its core nodes fetched too.
// Public OpenTopoData limits: 100 locations per request, 1 request per second,
// 1000 requests per day. The full grid takes about 310 requests (5 to 6 minutes).
//
// The grid is the original 90 x 60 core lattice (bbox s 41.52 w -8.49 n 41.575
// e -8.36, ~110 m spacing) extended outward by whole lattice steps to the wide
// streaming area (data/tiles, scripts/fetch-tiles.mjs). The core nodes keep
// their old heights bit for bit (read from the old cache or the old file), so
// the datum (189.4 m at the centre) and every core height stay the same.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CITY, CORE_BBOX, TERRAIN_LATTICE, USER_AGENT, dataPath, cachePath, dataRel } from './geo-lib.mjs';

const SRC = dataPath('terrain.json');
// TERRAIN_OUT=<path> writes elsewhere (a trial run that leaves the app alone)
const OUT = process.env.TERRAIN_OUT || SRC;
const CORE_CACHE = cachePath('terrain-raw.json');
const CACHE = cachePath('terrain-wide-raw.json');

const { coreCols: CC, coreRows: CR, ext: EXT } = TERRAIN_LATTICE;
const COLS = CC + EXT.w + EXT.e; // along longitude, west -> east
const ROWS = CR + EXT.s + EXT.n; // along latitude, south -> north
const dLon = (CORE_BBOX.e - CORE_BBOX.w) / (CC - 1);
const dLat = (CORE_BBOX.n - CORE_BBOX.s) / (CR - 1);
const BATCH = 100;
const PACE_MS = 1100;
const DATASETS = ['eudem25m', 'srtm30m'];

const wait = ms => new Promise(res => setTimeout(res, ms));
const lonAt = c => CORE_BBOX.w + (c - EXT.w) * dLon;
const latAt = r => CORE_BBOX.s + (r - EXT.s) * dLat;
const BBOX = { s: latAt(0), w: lonAt(0), n: latAt(ROWS - 1), e: lonAt(COLS - 1) };
const isCore = (r, c) => r >= EXT.s && r < EXT.s + CR && c >= EXT.w && c < EXT.w + CC;

// ---- core heights: the old file first, then the old cache
function coreHeights() {
  if (existsSync(SRC)) {
    const t = JSON.parse(readFileSync(SRC, 'utf8'));
    if (t.cols === CC && t.rows === CR && t.heights?.length === CC * CR) return { h: t.heights, src: t.source, sanity: t.sanity };
    if (t.core && t.cols === COLS && t.rows === ROWS) {
      // already wide: cut the core back out
      const h = [];
      for (let r = 0; r < CR; r++) for (let c = 0; c < CC; c++) h.push(t.heights[(r + EXT.s) * COLS + c + EXT.w]);
      return { h, src: t.core.source || t.source, sanity: t.sanity };
    }
  }
  if (existsSync(CORE_CACHE)) {
    const cache = JSON.parse(readFileSync(CORE_CACHE, 'utf8'));
    const h = [];
    for (let b = 0; b < Math.ceil((CC * CR) / BATCH); b++) h.push(...cache.batches[b].values.map(v => Math.round(v * 10) / 10));
    if (h.length === CC * CR) return { h, src: cache.batches[0].source, sanity: null };
  }
  return null; // a new city: the core is fetched with the ring
}

async function openTopo(dataset, pts) {
  const loc = pts.map(([la, lo]) => `${la.toFixed(6)},${lo.toFixed(6)}`).join('|');
  const url = `https://api.opentopodata.org/v1/${dataset}?locations=${loc}`;
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j.status !== 'OK' || !Array.isArray(j.results) || j.results.length !== pts.length) {
    throw new Error(`bad reply: ${j.status} ${j.error || ''}`);
  }
  return j.results.map(x => x.elevation);
}

async function openElevation(pts) {
  const r = await fetch('https://api.open-elevation.com/api/v1/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ locations: pts.map(([latitude, longitude]) => ({ latitude, longitude })) }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return j.results.map(x => x.elevation);
}

// Fetch one batch; try each source in order, with retries. Returns {values, source}.
async function fetchBatch(pts) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const ds of DATASETS) {
      try {
        const v = await openTopo(ds, pts);
        if (v.every(x => typeof x === 'number')) return { values: v, source: `opentopodata/${ds}` };
        throw new Error(`null elevations in ${ds}`);
      } catch (e) {
        lastErr = e;
        console.warn(`  ${ds} failed: ${e.message}`);
        await wait(PACE_MS * (attempt + 1) * (/429/.test(e.message) ? 5 : 1));
      }
    }
    try {
      return { values: await openElevation(pts), source: 'open-elevation' };
    } catch (e) {
      lastErr = e;
      console.warn(`  open-elevation failed: ${e.message}`);
      await wait(3000 * (attempt + 1));
    }
  }
  throw new Error(`All elevation sources failed: ${lastErr?.message}`);
}

if (process.argv.includes('--dry-run')) {
  console.log(`city ${CITY.id}; data dir ${dataRel()}`);
  console.log('core bbox', CORE_BBOX, `lattice ${CC}x${CR} core, ${COLS}x${ROWS} total, ext`, EXT);
  console.log('probes', CITY.probes);
  console.log(`source ${dataRel('terrain.json')}${process.env.TERRAIN_OUT ? `; out ${OUT}` : ''}`);
  console.log(`cache ${dataRel('.cache', 'terrain-raw.json')}, ${dataRel('.cache', 'terrain-wide-raw.json')}`);
  console.log(`core heights: ${coreHeights() ? 'found (only the ring is fetched)' : 'none (the core is fetched too)'}`);
  process.exit(0);
}

const core = coreHeights();

// Only the nodes outside the core are fetched (all nodes for a new city),
// row-major, row 0 = south edge.
const todo = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (!core || !isCore(r, c)) todo.push([r, c]);

// Resumable cache of raw batch results keyed by batch index.
mkdirSync(dirname(CACHE), { recursive: true });
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const key = `${COLS}x${ROWS}:${EXT.w},${EXT.e},${EXT.s},${EXT.n}`;
if (cache.key !== key) { cache.key = key; cache.batches = {}; }

const nBatches = Math.ceil(todo.length / BATCH);
for (let b = 0; b < nBatches; b++) {
  if (cache.batches[b]) continue;
  const pts = todo.slice(b * BATCH, (b + 1) * BATCH).map(([r, c]) => [latAt(r), lonAt(c)]);
  const res = await fetchBatch(pts);
  cache.batches[b] = res;
  writeFileSync(CACHE, JSON.stringify(cache));
  console.log(`batch ${b + 1}/${nBatches} ok (${res.source})`);
  await wait(PACE_MS);
}

const heights = new Array(COLS * ROWS);
const sources = core ? { [core.src]: CC * CR } : {};
if (core) for (let r = 0; r < CR; r++) for (let c = 0; c < CC; c++) heights[(r + EXT.s) * COLS + c + EXT.w] = core.h[r * CC + c];
for (let b = 0; b < nBatches; b++) {
  const { values, source } = cache.batches[b];
  sources[source] = (sources[source] || 0) + values.length;
  values.forEach((v, i) => {
    const [r, c] = todo[b * BATCH + i];
    heights[r * COLS + c] = Math.round(v * 10) / 10;
  });
}
if (heights.some(v => !Number.isFinite(v))) throw new Error('grid has holes');

let min = Infinity, max = -Infinity;
for (const v of heights) { if (v < min) min = v; if (v > max) max = v; }

// Bilinear sample for sanity checks.
function sample(lat, lon) {
  const fc = ((lon - BBOX.w) / (BBOX.e - BBOX.w)) * (COLS - 1);
  const fr = ((lat - BBOX.s) / (BBOX.n - BBOX.s)) * (ROWS - 1);
  const c0 = Math.floor(fc), r0 = Math.floor(fr), tc = fc - c0, tr = fr - r0;
  const h = (r, c) => heights[Math.min(ROWS - 1, r) * COLS + Math.min(COLS - 1, c)];
  return (h(r0, c0) * (1 - tc) + h(r0, c0 + 1) * tc) * (1 - tr) + (h(r0 + 1, c0) * (1 - tc) + h(r0 + 1, c0 + 1) * tc) * tr;
}
const probes = CITY.probes;
const sanity = {};
for (const [k, p] of Object.entries(probes)) sanity[k] = { point_m: core?.sanity?.[k]?.point_m ?? null, grid_m: Math.round(sample(...p)) };

const out = {
  bbox: BBOX,
  cols: COLS,
  rows: ROWS,
  row_order: 'south_to_north',
  col_order: 'west_to_east',
  spacing_deg: { lat: dLat, lon: dLon },
  source: Object.keys(sources).join(', '),
  min_m: min,
  max_m: max,
  // the original 90 x 60 grid inside this one: its bbox and first column / row
  core: { bbox: CORE_BBOX, c0: EXT.w, r0: EXT.s, cols: CC, rows: CR, source: core ? core.src : null },
  sanity,
  heights,
};
writeFileSync(OUT, JSON.stringify(out));
console.log(`Wrote ${OUT}: ${COLS}x${ROWS}, bbox`, BBOX, `min ${min} m, max ${max} m, sources`, sources);
console.log('sanity', sanity);
