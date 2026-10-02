// Prints triangles and real size (metres) of every landmark model, built on
// its footprint exactly as the app builds it (src/fit.js), and fails if a
// model is outside 4k..40k triangles (moving pieces included), has NaNs,
// or the total is over 600k (30 landmarks).
// Usage: npm run check:models
import { readFileSync } from 'node:fs';
import { createProjection } from '../src/geo.js';
import { existsSync } from 'node:fs';
import { fitLandmark, setDims } from '../src/fit.js';
import { triangleCount, loadCityModels } from '../src/models.js';
import { CITY, dataPath } from './city-lib.mjs';

const MAX_MODEL = 40000;
const MIN_MODEL = 4000;
const MAX_TOTAL = 600000;

// --city <id> picks the city (default braga).
const load = (f) => JSON.parse(readFileSync(f === 'landmarks.json' ? CITY.landmarksPath : dataPath(f), 'utf8'));
if (!existsSync(CITY.landmarksPath)) {
  console.log(`no landmarks yet for ${CITY.id} (${CITY.landmarks_file}); nothing to count`);
  process.exit(0);
}
setDims(existsSync(dataPath('dimensions.json')) ? load('dimensions.json') : {});
await loadCityModels(CITY.id);
const list = load('landmarks.json');
const roads = load('roads.json');
const footprints = load('footprints.json');
const proj = createProjection(roads.origin, roads.bbox, list, load('terrain.json'));
const warn = console.warn;
console.warn = () => {};
const fits = list.map((l) => fitLandmark(l, { project: proj.project, rawAt: proj.terrain.rawAt, footprints }));
console.warn = warn;

let total = 0;
let glassTotal = 0;
let bad = 0;
fits.forEach((f, i) => {
  const l = list[i];
  const g = f.geometry;
  // moving parts (funicular cars) are separate meshes: they count too
  const pieces = (f.pieces || []).reduce((a, p) => a + triangleCount(p.geometry), 0);
  const tris = triangleCount(g) + pieces;
  const glass = f.glass ? triangleCount(f.glass) : 0;
  const nan = [g, ...(f.pieces || []).map((p) => p.geometry)].some((q) => [...q.attributes.position.array].some((v) => !Number.isFinite(v)));
  const ok = tris + glass <= MAX_MODEL && tris >= MIN_MODEL && !nan;
  if (f.pieces?.length || f.markers?.length) {
    console.log(`    ${l.id}: pieces ${f.pieces.map((p) => `${p.name} (${triangleCount(p.geometry)})`).join(', ') || '-'}; markers ${f.markers.length}`);
  }
  if (!ok) bad++;
  total += tris;
  glassTotal += glass;
  const s = f.sizeM;
  console.log(
    `${ok ? 'ok ' : 'BAD'} ${l.id.padEnd(16)} ${l.model.padEnd(12)} ${String(tris).padStart(6)} tris${glass ? ` +${glass} glass` : ''}   ${s.x.toFixed(1)} x ${s.z.toFixed(1)} x ${s.height.toFixed(1)} m${f.legacy ? '  (legacy)' : ''}${nan ? '  NaN!' : ''}`,
  );
});
const totalOk = total + glassTotal <= MAX_TOTAL;
console.log(`${totalOk ? 'ok ' : 'BAD'} total ${total + glassTotal} tris (${total} opaque, ${glassTotal} glass), budget ${MAX_TOTAL}, per model ${MIN_MODEL}..${MAX_MODEL}`);
process.exit(bad || !totalOk ? 1 : 0);
