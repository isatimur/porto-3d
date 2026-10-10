// Prints triangles and real size (metres) of every landmark model, built on
// its footprint exactly as the app builds it (src/fit.js).
//
// Budgets:
//   - a DETAILED model must be within 4k..40k triangles (moving pieces and
//     glass included), have no NaNs;
//   - a model that still falls back to the generic massing builder (see
//     src/models/porto/block.js, rule.note "generic massing ...") is reported
//     as MASSING / not-yet-detailed and is NOT hard-failed for being tiny: it
//     is expected to be small until its detailed builder lands. It is still
//     failed if it is over the per-model max or has NaNs;
//   - the total (all models) must be <= 900k: a bigger city with 70 detailed
//     models (was 600k at 60 models; the per-model 4k..40k bounds are unchanged;
//     a small city such as Braga keeps its own budget in cities/<id>.json if set).
// The 4k floor is not lowered for massing models; the report just tells the
// two kinds apart.
// Usage: npm run check:models
import { readFileSync, existsSync } from 'node:fs';
import { createProjection } from '../src/geo.js';
import { fitLandmark, setDims } from '../src/fit.js';
import { triangleCount, loadCityModels, builderRule, models } from '../src/models.js';
import { CITY, dataPath } from './city-lib.mjs';
import { loadTerrain } from './terrain-load.mjs';

const MAX_MODEL = 40000;
const MIN_MODEL = 4000;
// Bigger city, more detailed models: 70 models at up to 40k each; the per-model
// bounds (4k..40k) still hold. Raised from 600000 when the roster grew to 70.
const MAX_TOTAL = 900000;

const load = (f) => JSON.parse(readFileSync(f === 'landmarks.json' ? CITY.landmarksPath : dataPath(f), 'utf8'));

// Missing inputs: say so and stop (verify.mjs skips the check before this runs,
// but the script must be honest on its own too).
if (!existsSync(CITY.landmarksPath)) {
  console.log(`no landmarks yet for ${CITY.id} (${CITY.landmarks_file}); nothing to count`);
  process.exit(0);
}
for (const f of ['footprints.json', 'roads.json', 'terrain.json']) {
  if (!existsSync(dataPath(f))) {
    console.log(`no ${f} yet for ${CITY.id}; cannot build the models, nothing to count`);
    process.exit(0);
  }
}

setDims(existsSync(dataPath('dimensions.json')) ? load('dimensions.json') : {});
await loadCityModels(CITY.id);
const list = load('landmarks.json');
const roads = load('roads.json');
const footprints = load('footprints.json');
const proj = createProjection(roads.origin, roads.bbox, list, loadTerrain());
const warn = console.warn;
console.warn = () => {};
const fits = list.map((l) => fitLandmark(l, { project: proj.project, rawAt: proj.terrain.rawAt, footprints, models }));
console.warn = warn;

let total = 0;
let bad = 0;
let badDetailed = 0;
let badMassing = 0;
let massingN = 0;
let detailedN = 0;

fits.forEach((f, i) => {
  const l = list[i];
  const g = f.geometry;
  // A model still on the generic massing builder: tiny on purpose until its
  // detailed builder lands. Read the marker the builder carries with it.
  const massing = /generic massing/i.test(builderRule(l.model, l.id).note || '');
  if (massing) massingN++;
  else detailedN++;

  // moving parts (funicular cars) are separate meshes: they count too
  const pieces = (f.pieces || []).reduce((a, p) => a + triangleCount(p.geometry), 0);
  const glass = f.glass ? triangleCount(f.glass) : 0;
  const tris = triangleCount(g) + pieces + glass; // all triangles, opaque + glass
  const nan = [g, ...(f.pieces || []).map((p) => p.geometry)].some((q) => [...q.attributes.position.array].some((v) => !Number.isFinite(v)));
  const overMax = tris > MAX_MODEL;
  const underMin = tris < MIN_MODEL;
  // massing models are exempt from the floor, never from the ceiling / NaNs
  const ok = !nan && !overMax && (massing || !underMin);
  if (f.pieces?.length || f.markers?.length) {
    console.log(`    ${l.id}: pieces ${f.pieces.map((p) => `${p.name} (${triangleCount(p.geometry)})`).join(', ') || '-'}; markers ${f.markers.length}`);
  }
  if (!ok) {
    bad++;
    if (massing) badMassing++;
    else badDetailed++;
  }
  total += tris;
  const s = f.sizeM;
  const tag = massing ? 'MASSING (not yet detailed)' : ok ? 'ok ' : 'BAD';
  console.log(
    `${ok ? 'ok ' : 'BAD'} ${l.id.padEnd(16)} ${l.model.padEnd(12)} ${String(tris).padStart(6)} tris${f.glass ? ` (+${glass} glass)` : ''}   ${s.x.toFixed(1)} x ${s.z.toFixed(1)} x ${s.height.toFixed(1)} m  ${tag}${nan ? '  NaN!' : ''}`,
  );
});
const totalOk = total <= MAX_TOTAL;
console.log(
  `detailed ${detailedN} (${detailedN - badDetailed} within budget), massing/not-yet-detailed ${massingN}` +
    `${badMassing ? ` (${badMassing} over budget!)` : ''}; ` +
    `${totalOk ? 'ok ' : 'BAD'} total ${total} tris, budget ${MAX_TOTAL}, detailed per model ${MIN_MODEL}..${MAX_MODEL}`,
);
process.exit(bad || !totalOk ? 1 : 0);
