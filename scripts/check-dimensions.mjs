// Validate data/dimensions.json: real-world dimensions of the landmarks.
// Node 22, no dependencies. Run: node scripts/check-dimensions.mjs
// Checks:
//  - the landmark ids equal the ids in data/landmarks.json (no missing, no extras);
//  - every numeric leaf under footprint_m, height_m, elements and facade_azimuth_deg is finite and > 0;
//  - height_m.total is the height to the top: no other height_m leaf exceeds it;
//  - every numeric leaf is covered by a sources[] entry (by path);
//  - every source entry has a valid url, or source:"estimate" with a reasoning;
//  - every source path points at a real numeric leaf;
//  - facade_faces agrees with facade_azimuth_deg (8-point compass), confidence is high|medium|low.
// Prints a table and exits 1 on any error.
import { readFileSync } from 'node:fs';
import { CITY, dataPath, loadLandmarks } from './city-lib.mjs';

// --city <id> picks the city (default braga).
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const isStr = v => typeof v === 'string' && v.trim().length > 0;
const isUrl = v => isStr(v) && /^https?:\/\/\S+$/.test(v);

const dims = readJson(dataPath('dimensions.json'));
// landmarks.json, or (before the landmark agents merge it) the candidates that have a new/<id>.osm.json.
const lm = loadLandmarks();
const lmList = Array.isArray(lm) ? lm : lm.landmarks || Object.values(lm);
const wanted = lmList.map(l => l.id);
const ids = Object.keys(dims).filter(k => !k.startsWith('_'));

for (const id of wanted) if (!ids.includes(id)) err(id, 'missing from dimensions.json');
for (const id of ids) if (!wanted.includes(id)) err(id, 'not a landmark id in landmarks.json');

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const NUMERIC_ROOTS = ['footprint_m', 'height_m', 'elements'];

// Collect numeric leaves as "a.b" paths; flag non-finite or non-positive numbers.
function leaves(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'number') out.set(path, v);
    else if (v && typeof v === 'object' && !Array.isArray(v)) leaves(v, path, out);
  }
  return out;
}

const rows = [];
for (const id of ids) {
  const d = dims[id];
  const nums = new Map();
  for (const root of NUMERIC_ROOTS) {
    if (!d[root] || typeof d[root] !== 'object') { err(id, `${root} missing`); continue; }
    leaves(d[root], root, nums);
  }
  if (typeof d.facade_azimuth_deg === 'number') nums.set('facade_azimuth_deg', d.facade_azimuth_deg);
  else err(id, 'facade_azimuth_deg missing or not a number');

  for (const [path, v] of nums) {
    if (!Number.isFinite(v)) err(id, `${path} is not finite`);
    else if (v <= 0) err(id, `${path} = ${v} is not positive`);
  }
  for (const key of ['length', 'width']) if (!Number.isFinite(d.footprint_m?.[key])) err(id, `footprint_m.${key} missing`);
  if (!Number.isFinite(d.height_m?.total)) err(id, 'height_m.total missing');
  else for (const [path, v] of nums)
    if (path.startsWith('height_m.') && v > d.height_m.total) err(id, `${path} = ${v} exceeds height_m.total ${d.height_m.total}`);
  if (typeof d.footprint_m?.matches_osm !== 'boolean') err(id, 'footprint_m.matches_osm must be boolean');

  // Sources: shape, and coverage of every numeric leaf.
  const covered = new Set();
  if (!Array.isArray(d.sources) || d.sources.length === 0) err(id, 'sources[] missing');
  (d.sources || []).forEach((s, i) => {
    const where = `${id}.sources[${i}]`;
    const paths = Array.isArray(s.paths) ? s.paths : isStr(s.path) ? [s.path] : [];
    if (paths.length === 0) err(where, 'no path/paths');
    if (!isStr(s.fact)) err(where, 'fact missing');
    if (s.source === 'estimate') {
      if (!isStr(s.reasoning)) err(where, 'estimate without reasoning');
      if (s.url !== undefined) err(where, 'estimate must not carry a url');
    } else {
      if (!isUrl(s.url)) err(where, 'non-estimate without a valid url');
      if (!isStr(s.value)) err(where, 'non-estimate without the quoted value');
    }
    for (const p of paths) {
      if (!nums.has(p)) err(where, `path ${p} is not a numeric leaf`);
      covered.add(p);
    }
  });
  const estimated = new Set();
  for (const s of d.sources || []) if (s.source === 'estimate') for (const p of s.paths || [s.path]) estimated.add(p);
  for (const path of nums.keys()) if (!covered.has(path)) err(id, `${path} has no source entry`);

  // Facade letter vs azimuth.
  if (d.facade_faces === 'none') {
    if (!isStr(d.facade_note)) err(id, 'facade_faces none needs a facade_note');
  } else if (!COMPASS.includes(d.facade_faces)) err(id, `facade_faces "${d.facade_faces}" not an 8-point compass letter or "none"`);
  else if (Number.isFinite(d.facade_azimuth_deg)) {
    const expect = COMPASS[Math.round((((d.facade_azimuth_deg % 360) + 360) % 360) / 45) % 8];
    if (expect !== d.facade_faces) err(id, `facade_faces ${d.facade_faces} but azimuth ${d.facade_azimuth_deg} is ${expect}`);
  }
  if (!isStr(d.facade_note)) err(id, 'facade_note missing');
  if (!['high', 'medium', 'low'].includes(d.confidence)) err(id, `confidence "${d.confidence}" invalid`);

  rows.push({
    id,
    lw: `${d.footprint_m?.length}x${d.footprint_m?.width}`,
    h: d.height_m?.total,
    face: `${d.facade_faces} ${d.facade_azimuth_deg}`,
    conf: d.confidence,
    est: `${[...nums.keys()].filter(p => estimated.has(p)).length}/${nums.size}`,
  });
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('id', 17)}${pad('L x W (m)', 14)}${pad('total h (m)', 12)}${pad('facade', 10)}${pad('confidence', 11)}estimated`);
for (const r of rows) console.log(`${pad(r.id, 17)}${pad(r.lw, 14)}${pad(r.h, 12)}${pad(r.face, 10)}${pad(r.conf, 11)}${r.est}`);

if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log(`\nOK: ${rows.length} landmarks, all numbers finite, positive and sourced.`);
