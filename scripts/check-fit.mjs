// Prints the 1:1 fit of every landmark model (src/fit.js): the model's real
// size in metres against the OSM extent it stands for, the deviation, the
// front bearing, the base and the pad. Fails when a metric model deviates
// more than 15 % (plan of the site, plan of the main block, or height
// against data/dimensions.json), or when a model is still legacy.
// Never-shrink guard (hard fail): every model's plan must be at least 97 %
// of its OSM extent on both axes, and its height at least 97 % of
// dimensions.json height_m.total (second table).
// Usage: node scripts/check-fit.mjs [--allow-legacy]
import { readFileSync } from 'node:fs';
import { createProjection, S } from '../src/geo.js';
import { fitLandmark, padFor, shrinkCheck, DEVIATION_FAIL, SHRINK_MIN, setDims } from '../src/fit.js';
import { loadCityModels } from '../src/models.js';
import { CITY, dataPath } from './city-lib.mjs';
import { existsSync } from 'node:fs';

// --city <id> picks the city (default braga).
const load = (f) => JSON.parse(readFileSync(f === 'landmarks.json' ? CITY.landmarksPath : dataPath(f), 'utf8'));
if (!existsSync(CITY.landmarksPath)) {
  console.log(`no landmarks yet for ${CITY.id} (${CITY.landmarks_file}); nothing to fit`);
  process.exit(0);
}
setDims(existsSync(dataPath('dimensions.json')) ? load('dimensions.json') : {});
await loadCityModels(CITY.id);
const landmarks = load('landmarks.json');
const roads = load('roads.json');
const footprints = load('footprints.json');
const terrain = load('terrain.json');
const proj = createProjection(roads.origin, roads.bbox, landmarks, terrain);
const T = proj.terrain;
const allowLegacy = process.argv.includes('--allow-legacy');

const warn = console.warn;
console.warn = () => {}; // the guard's warnings are summarised in the table
const fits = landmarks.map((l) => fitLandmark(l, { project: proj.project, rawAt: T.rawAt, footprints }));
console.warn = warn;
for (const f of fits) if (!f.fallback) T.addPad(padFor(f));

const pct = (v) => (v == null ? '-' : `${(v * 100).toFixed(1)}%`);
const f1 = (v) => v.toFixed(1);
let bad = 0;
const rows = fits.map((f) => {
  const d = f.deviation;
  const fail = f.legacy ? !allowLegacy : f.worst > DEVIATION_FAIL;
  if (fail) bad++;
  return {
    id: f.id,
    ok: fail ? 'FAIL' : 'ok',
    'model x*z*h m': `${f1(f.sizeM.x)} x ${f1(f.sizeM.z)} x ${f1(f.sizeM.height)}`,
    'osm x*z m': `${f1(f.extentM.x)} x ${f1(f.extentM.z)}`,
    'main x*z*h m': f.mainM ? `${f1(f.mainM.x)} x ${f1(f.mainM.z)} x ${f1(f.mainM.h)}` : '-',
    'outline x*z': `${f1(f.extentM.outlineX)} x ${f1(f.extentM.outlineZ)}`,
    'h dims': f.dims?.height_m?.total ?? '-',
    'dev site': pct(d.site),
    'dev main': pct(d.main),
    'dev h': pct(d.height),
    front: +f.frontDeg.toFixed(1),
    snap: f.frame.snapped ? `${f.frame.wanted}->${f.frame.snapped.b.toFixed(0)}` : `${f.frame.wanted} (free)`,
    base_m: +(f.baseM + T.datum).toFixed(0),
    pad: `${f1((f.padPlan.hv * 2) / S)} x ${f1((f.padPlan.hu * 2) / S)}`,
    kind: f.legacy ? 'LEGACY' : f.draped ? 'metric, draped' : 'metric',
  };
});
console.table(rows);

// Never-shrink guard: model / real, per axis.
let shrunk = 0;
const shrinkRows = fits.map((f) => {
  const s = shrinkCheck(f);
  if (!s.ok) shrunk++;
  return {
    id: f.id,
    ok: s.ok ? 'ok' : `FAIL ${s.fails.join(',')}`,
    'model x m': f1(f.sizeM.x),
    'osm x m': f1(f.extentM.x),
    'x %': pct(s.ratio.x),
    'model z m': f1(f.sizeM.z),
    'osm z m': f1(f.extentM.z),
    'z %': pct(s.ratio.z),
    'model h m': f1(f.sizeM.height),
    'dims h m': f.dims?.height_m?.total ?? '-',
    'h %': pct(s.ratio.h),
  };
});
console.log(`never-shrink guard: model >= ${SHRINK_MIN * 100} % of the OSM extent (x, z) and of dimensions.json height`);
console.table(shrinkRows);
bad += shrunk;

// Overlap of building masks (separating axis on oriented rectangles).
function corners(p) {
  const vx = -p.uz;
  const vz = p.ux;
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => ({ x: p.cx + p.ux * p.hu * a + vx * p.hv * b, z: p.cz + p.uz * p.hu * a + vz * p.hv * b }));
}
function overlaps(a, b) {
  const ca = corners(a);
  const cb = corners(b);
  for (const p of [a, b]) {
    for (const ax of [{ x: p.ux, z: p.uz }, { x: -p.uz, z: p.ux }]) {
      const pa = ca.map((c) => c.x * ax.x + c.z * ax.z);
      const pb = cb.map((c) => c.x * ax.x + c.z * ax.z);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
}
const clashes = [];
for (let i = 0; i < fits.length; i++) for (let j = i + 1; j < fits.length; j++) if (overlaps(fits[i].plan, fits[j].plan)) clashes.push(`${fits[i].id}~${fits[j].id}`);
console.log(clashes.length ? `building masks overlapping: ${clashes.join(', ')}` : 'no building masks overlap');

const bj = fits.find((f) => f.id === 'bom-jesus');
if (bj?.stair) console.log(`bom-jesus stair: ${bj.stair}`);
console.log(`S = ${S} units/m, 1 unit = ${1 / S} m, datum ${T.datum.toFixed(1)} m; fail above ${DEVIATION_FAIL * 100} %`);
console.log(shrunk ? `never-shrink: ${shrunk} landmark(s) smaller than real` : 'never-shrink: no model smaller than real');
console.log(bad ? `${bad} failure(s)` : 'all landmarks within tolerance');
process.exit(bad ? 1 : 0);
