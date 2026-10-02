// Validate data/footprints.json, data/buildings.json, data/terrain.json and the
// `osm` field of data/landmarks.json. Prints a summary; exits 1 on any error.
// Node 22, no dependencies. Run: node scripts/check-geo.mjs
import { readFileSync, statSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { CITY, CORE_BBOX, dataPath } from './geo-lib.mjs';
import { loadLandmarks } from './city-lib.mjs';

// --city <id> picks the city (default braga).
const P = f => dataPath(f);
const errors = [], warnings = [];
const err = m => errors.push(m), warn = m => warnings.push(m);
// landmarks.json, or (before the landmark agents merge it) the candidates that have a new/<id>.osm.json.
const load = f => { try { return f === 'landmarks.json' ? loadLandmarks() : JSON.parse(readFileSync(P(f), 'utf8')); } catch (e) { err(`${f}: ${e.message}`); return null; } };
const isLL = p => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
const M_LAT = 111320, M_LON = 111320 * Math.cos((CITY.origin.lat * Math.PI) / 180);
const distM = (a, b) => Math.hypot((a[0] - b[0]) * M_LAT, (a[1] - b[1]) * M_LON);

// A city whose pipeline has not run yet: say so and stop, no errors.
if (CITY.id !== 'braga') {
  const need = ['buildings.json', 'terrain.json', 'footprints.json'].map(P);
  const missing = need.filter(f => !existsSync(f));
  if (!existsSync(CITY.landmarksPath) && !loadLandmarks().length) missing.push(CITY.landmarksPath);
  if (missing.length) {
    console.log(`no data yet for ${CITY.id}; missing: ${missing.map(f => f.replace(`${dataPath()}/`, '')).join(', ')}`);
    process.exit(0);
  }
  if (!existsSync(CITY.landmarksPath)) console.log(`${CITY.id}: no landmarks.json yet; checking the candidates with a ${CITY.data_dir}/new/<id>.osm.json`);
}

const landmarks = load('landmarks.json') || [];
const fp = load('footprints.json') || {};
const bld = load('buildings.json');
const ter = load('terrain.json');

// ---- footprints + landmarks.osm ----
const SOURCES = /^(osm height tag|osm building:levels×3\.2|wikipedia|estimate)$/;
console.log('Landmark footprints');
for (const l of landmarks) {
  const f = fp[l.id];
  if (!f) { err(`footprints: ${l.id} missing`); continue; }
  if (!Array.isArray(f.outline) || f.outline.length < 3 || !f.outline.every(isLL)) err(`${l.id}: outline empty or invalid`);
  if (!(f.bearing_deg >= 0 && f.bearing_deg < 180)) err(`${l.id}: bearing ${f.bearing_deg} not in [0,180)`);
  if (!Array.isArray(f.extent_m) || !(f.extent_m[0] >= f.extent_m[1] && f.extent_m[1] > 0)) err(`${l.id}: bad extent ${f.extent_m}`);
  if (!(f.height_m > 0)) err(`${l.id}: height_m ${f.height_m}`);
  if (!SOURCES.test(f.height_source || '')) err(`${l.id}: height_source "${f.height_source}"`);
  if (/placeholder/i.test(f.height_note || '')) err(`${l.id}: height is still a placeholder`);
  if (!f.parts?.some(p => p.height_m === f.height_m)) err(`${l.id}: no part carries the landmark height`);
  if (!isLL(f.centroid)) err(`${l.id}: bad centroid`);
  else if (distM(f.centroid, [l.lat, l.lon]) > 300) warn(`${l.id}: centroid ${Math.round(distM(f.centroid, [l.lat, l.lon]))} m from landmark coordinate`);
  if (!Array.isArray(f.parts) || !f.parts.length) err(`${l.id}: no parts`);
  else f.parts.forEach((p, i) => {
    if (!p.tag || !Array.isArray(p.pts) || !p.pts.length || !p.pts.every(isLL)) err(`${l.id}: part ${i} invalid`);
    if (!(p.height_m >= 0)) err(`${l.id}: part ${i} height`);
  });
  const o = l.osm;
  if (!o || !['way', 'relation', 'node'].includes(o.type) || !Number.isInteger(o.id)) err(`landmarks.json: ${l.id} osm field missing/invalid`);
  else {
    if (o.id !== f.osm?.id || o.type !== f.osm?.type) err(`${l.id}: landmarks.osm and footprints.osm differ`);
    if (o.height_m !== f.height_m || o.height_source !== f.height_source) err(`${l.id}: landmarks.osm height differs from footprints`);
  }
  console.log(`  ${l.id.padEnd(16)} ${(f.osm?.type || '?')[0]}${f.osm?.id} ${String(f.extent_m?.join('x')).padEnd(12)} m  bearing ${String(f.bearing_deg).padStart(5)}°  h ${String(f.height_m).padStart(5)} m (${f.height_source})  parts ${f.parts?.length}`);
}
const extra = Object.keys(fp).filter(k => !landmarks.some(l => l.id === k));
if (extra.length) warn(`footprints: unknown ids ${extra.join(', ')}`);

// ---- buildings ----
if (bld) {
  const size = statSync(P('buildings.json')).size;
  const B = bld.buildings || [];
  const KINDS = new Set(['residential', 'commercial', 'industrial', 'church', 'public', 'other']);
  let bad = 0, outside = 0;
  const kinds = {};
  const box = { s: CORE_BBOX.s - 0.005, w: CORE_BBOX.w - 0.005, n: CORE_BBOX.n + 0.005, e: CORE_BBOX.e + 0.005 };
  for (const b of B) {
    if (!Array.isArray(b.p) || b.p.length < 3 || !b.p.every(isLL) || !(b.h > 0) || !KINDS.has(b.k)) { bad++; continue; }
    const [la, lo] = b.p[0];
    if (la < box.s || la > box.n || lo < box.w || lo > box.e) outside++;
    kinds[b.k] = (kinds[b.k] || 0) + 1;
  }
  if (!bld.origin || !Number.isFinite(bld.origin.lat)) err('buildings: origin missing');
  // OSM coverage differs per city: Braga's core has ~17k buildings, Guimarães' ~3.8k
  // (the Microsoft layer fills the rest). Braga keeps its historical floor.
  const MIN_BUILDINGS_BY_CITY = { braga: 5000, guimaraes: 3000 };
  const minBuildings = MIN_BUILDINGS_BY_CITY[CITY.id] ?? 1000;
  if (B.length < minBuildings) err(`buildings: only ${B.length} buildings (min ${minBuildings} for ${CITY.id})`);
  if (bad) err(`buildings: ${bad} invalid entries`);
  if (outside) warn(`buildings: ${outside} start more than ~500 m outside the bbox`);
  // Download-size budget, per city: Porto's wide extent and OSM coverage are
  // several times Braga's, so the same byte ceiling does not apply. The 8 MB
  // baseline stays visible as a warning, even under a higher city ceiling.
  const MAX_BUILDINGS_MB_BY_CITY = { braga: 8, guimaraes: 8, porto: 12 };
  const maxMb = MAX_BUILDINGS_MB_BY_CITY[CITY.id] ?? 8;
  const mb = size / 1048576;
  if (mb > maxMb) err(`buildings: file ${mb.toFixed(2)} MB > ${maxMb} MB (${CITY.id})`);
  else if (mb > 8) warn(`buildings: file ${mb.toFixed(2)} MB > 8 MB baseline (within ${CITY.id}'s ${maxMb} MB ceiling)`);
  // Landmark main footprints must not be duplicated in the grey mass.
  let overlap = 0;
  const pip = ([y, x], poly) => { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [yi, xi] = poly[i], [yj, xj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
  const outlines = Object.values(fp).filter(f => f.exclude_outline).map(f => f.outline);
  for (const b of B) {
    const c = [b.p.reduce((s, q) => s + q[0], 0) / b.p.length, b.p.reduce((s, q) => s + q[1], 0) / b.p.length];
    if (outlines.some(o => pip(c, o))) overlap++;
  }
  if (overlap) warn(`buildings: ${overlap} building centroids fall inside a landmark outline`);
  console.log(`Buildings: ${B.length}, ${(size / 1048576).toFixed(2)} MB`, kinds);
}

// ---- terrain ----
if (ter) {
  const { bbox: b, cols, rows, heights } = ter;
  if (!(b && b.s < b.n && b.w < b.e)) err('terrain: bbox not monotone');
  if (!(cols > 1 && rows > 1) || heights?.length !== cols * rows) err(`terrain: ${heights?.length} values for ${cols}x${rows}`);
  if (!heights.every(Number.isFinite)) err('terrain: non-finite heights');
  const mn = Math.min(...heights), mx = Math.max(...heights);
  if (mn !== ter.min_m || mx !== ter.max_m) err(`terrain: min/max fields (${ter.min_m}/${ter.max_m}) differ from data (${mn}/${mx})`);
  const sample = (lat, lon) => {
    const fc = ((lon - b.w) / (b.e - b.w)) * (cols - 1), fr = ((lat - b.s) / (b.n - b.s)) * (rows - 1);
    const c0 = Math.floor(fc), r0 = Math.floor(fr), tc = fc - c0, tr = fr - r0;
    const h = (r, c) => heights[Math.min(rows - 1, r) * cols + Math.min(cols - 1, c)];
    return (h(r0, c0) * (1 - tc) + h(r0, c0 + 1) * tc) * (1 - tr) + (h(r0 + 1, c0) * (1 - tc) + h(r0 + 1, c0 + 1) * tc) * tr;
  };
  // Bom Jesus: the basilica terrace is ~410 m, not the ~560 m of the Monte Espinho summit.
  // EU-DEM gives 410 m and SRTM 414 m at the basilica; both give ~300 m at the stair
  // foot, a ~112 m rise that matches the published 116 m of the staircase.
  // Guimarães: the Toural / Oliveira centre is about 190 m, the castle hill about 230 m; the
  // penha probe sits on the slope below the 613 m summit (pt.wikipedia Santuário da Penha), EU-DEM 555 m.
  // Other cities: probe heights must be finite.
  const RANGES_BY_CITY = {
    braga: { centre: [150, 250], 'bom-jesus': [350, 450], sameiro: [520, 600] },
    guimaraes: { centre: [160, 220], castelo: [200, 260], penha: [500, 620] },
  };
  const ranges = RANGES_BY_CITY[CITY.id] || {};
  const got = {};
  for (const [k, [la, lo]] of Object.entries(CITY.probes)) {
    const v = Math.round(sample(la, lo));
    got[k] = v;
    const r = ranges[k];
    if (r) { if (v < r[0] || v > r[1]) err(`terrain: ${k} = ${v} m, expected ${r[0]}-${r[1]} m`); }
    else if (!Number.isFinite(v)) err(`terrain: ${k} = ${v} m, not finite`);
  }
  console.log(`Terrain: ${cols}x${rows} (${ter.row_order}), ${mn}-${mx} m, source ${ter.source}, samples`, got);
}

for (const w of warnings) console.log(`WARN  ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log(errors.length ? `FAILED: ${errors.length} errors` : `OK (${warnings.length} warnings)`);
process.exit(errors.length ? 1 : 0);
