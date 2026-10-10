// Landmark pads, measured: per landmark, the pad rectangle, the cut (ground
// removed) and fill (ground added) it makes against the raw terrain, the
// steepest slope it leaves, and the height step at its outer border.
// Usage: node scripts/pad-report.mjs [--city porto] [--all]   (--all: every row, not only the worst)
import { readFileSync, existsSync } from 'node:fs';
import { createProjection, S } from '../src/geo.js';
import { fitLandmark, padFor, setDims } from '../src/fit.js';
import { loadCityModels, models } from '../src/models.js';
import { CITY, dataPath } from './city-lib.mjs';
import { loadTerrain } from './terrain-load.mjs';

const load = (f) => JSON.parse(readFileSync(f === 'landmarks.json' ? CITY.landmarksPath : dataPath(f), 'utf8'));
setDims(existsSync(dataPath('dimensions.json')) ? load('dimensions.json') : {});
await loadCityModels(CITY.id);
const landmarks = load('landmarks.json');
const roads = load('roads.json');
const footprints = load('footprints.json');
const proj = createProjection(roads.origin, roads.bbox, landmarks, loadTerrain());
const T = proj.terrain;
const warn = console.warn;
console.warn = () => {};
const fits = landmarks.map((l) => fitLandmark(l, { project: proj.project, rawAt: T.rawAt, footprints, models }));
console.warn = warn;
// Each pad is measured alone (the others removed): its own cut, fill and slope.
// --together measures with every pad in place instead (overlaps count).
const together = process.argv.includes('--together');
const own = [];
for (const f of fits) {
  const pad = f.fallback ? null : padFor(f);
  if (pad) own.push({ f, pad });
}
if (together) for (const o of own) o.p = T.addPad(o.pad);
const rows = [];
for (const o of own) {
  const { f } = o;
  let p = o.p;
  if (!together) {
    T.pads.length = 0;
    T.heightAt(0, 0); // the pad lookup rebuilds when the count changes
    p = T.addPad(o.pad);
    T.heightAt(0, 0);
  }
  // sample the whole influence square on a ~4 m grid
  const R = p.r;
  const step = 1; // world units (4 m)
  let cut = 0;
  let fill = 0;
  let maxSlope = 0;
  let rawMaxSlope = 0;
  let edgeStep = 0;
  let cutArea = 0;
  let n = 0;
  const h = (x, z) => T.heightAt(x, z);
  const r = (x, z) => T.rawAt(x, z);
  for (let x = p.cx - R; x <= p.cx + R; x += step) {
    for (let z = p.cz - R; z <= p.cz + R; z += step) {
      if ((x - p.cx) ** 2 + (z - p.cz) ** 2 > R * R) continue;
      const d = h(x, z) - r(x, z);
      if (d < -0.02) { cut = Math.max(cut, -d); cutArea += 1; }
      if (d > 0.02) fill = Math.max(fill, d);
      const sl = Math.hypot(h(x + step, z) - h(x, z), h(x, z + step) - h(x, z)) / step;
      const rs = Math.hypot(r(x + step, z) - r(x, z), r(x, z + step) - r(x, z)) / step;
      maxSlope = Math.max(maxSlope, sl);
      rawMaxSlope = Math.max(rawMaxSlope, rs);
      n++;
    }
  }
  // the step at the outer border: along the circle of radius r the pad's own pull is zero
  for (let a = 0; a < 64; a++) {
    const x = p.cx + Math.cos((a / 64) * Math.PI * 2) * (R - 0.01);
    const z = p.cz + Math.sin((a / 64) * Math.PI * 2) * (R - 0.01);
    edgeStep = Math.max(edgeStep, Math.abs(h(x, z) - r(x, z)));
  }
  rows.push({
    id: f.id,
    'pad m (long x short)': `${((p.hu * 2) / S).toFixed(0)} x ${((p.hv * 2) / S).toFixed(0)}`,
    'cut limit m': p.cutMax === undefined ? 'whole' : (p.cutMax / S).toFixed(1),
    'fall m': (p.fall / S).toFixed(0),
    'cut m': (cut / S).toFixed(1),
    'fill m': (fill / S).toFixed(1),
    'cut area m2': Math.round((cutArea * 16)),
    'slope deg': (Math.atan(maxSlope) * 180 / Math.PI).toFixed(0),
    'raw slope deg': (Math.atan(rawMaxSlope) * 180 / Math.PI).toFixed(0),
    'edge step m': (edgeStep / S).toFixed(2),
  });
}
rows.sort((a, b) => Math.max(+b['cut m'], +b['fill m']) - Math.max(+a['cut m'], +a['fill m']));
const shown = process.argv.includes('--all') ? rows : rows.slice(0, 20);
console.table(shown);
const worst = (k) => Math.max(...rows.map((r) => +r[k]));
console.log(`pads ${rows.length}; worst cut ${worst('cut m')} m, worst fill ${worst('fill m')} m, worst edge step ${worst('edge step m')} m, worst slope ${worst('slope deg')} deg`);
