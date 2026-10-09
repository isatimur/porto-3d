#!/usr/bin/env node
// Bakes the model-derived half of every landmark fit into data/fits.json, so
// the browser can fit all 70 landmarks (frame, base, pads, masks, boxes)
// without building a single model, and build the detailed models later, in a
// worker, when a camera comes near (src/model-client.js).
//
//   node scripts/bake-fits.mjs               write data/fits.json
//   node scripts/bake-fits.mjs --if-stale    write it only when the inputs changed (npm run build)
//   node scripts/bake-fits.mjs --check       verify, write nothing (npm run verify):
//       1. the file's input hash is current (builders, fit.js, terrain, footprints, dimensions);
//       2. every cached entry equals a live eager fit of the model (tolerance 1e-6);
//       3. a fit made from the cache alone equals the live fit in every number the app
//          reads (pivot, boxes, plan, pad, base, sizes, deviation, markers);
//       4. the never-shrink check gives the same answer on both;
//       5. every landmark has one builder group, and the groups hold no stray id.
//
// What is cached per landmark (see bakedFit() in src/fit.js): the model's local
// box, the placed box, the named group boxes (main / height / mask ...), glass,
// draped, markers, piece names, the bounding sphere and the triangle count. The
// fit rule is cached too (RegExp as { $re }); the four big bridges carry
// pad.level functions that cannot be, so the app takes those rules from the
// bridges group (src/model-meta.js).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createProjection } from '../src/geo.js';
import { fitLandmark, bakedFit, setDims, shrinkCheck } from '../src/fit.js';
import { models, GROUPS } from '../src/models.js';
import { FITS_VERSION, createMeta, serializeRule } from '../src/model-meta.js';
import { CITY, ROOT, dataPath } from './city-lib.mjs';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const IF_STALE = args.includes('--if-stale');
const OUT = dataPath('fits.json');

const load = (f) => JSON.parse(readFileSync(f === 'landmarks.json' ? CITY.landmarksPath : dataPath(f), 'utf8'));

// ------------------------------------------------------------ input hash
function walk(dir, out = []) {
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}
function inputsHash(landmarks) {
  const h = createHash('sha256');
  const files = [...walk(join(ROOT, 'src/models')), ...['fit.js', 'geo.js', 'terrain.js', 'model-build.js', 'model-meta.js', 'models.js'].map((f) => join(ROOT, 'src', f))];
  for (const f of files) {
    h.update(relative(ROOT, f));
    h.update(readFileSync(f));
  }
  for (const f of ['terrain.json', 'footprints.json', 'dimensions.json']) {
    h.update(f);
    h.update(readFileSync(dataPath(f)));
  }
  const roads = load('roads.json');
  h.update(JSON.stringify([roads.origin, roads.bbox, landmarks.map((l) => [l.id, l.lat, l.lon, l.model])]));
  return h.digest('hex').slice(0, 16);
}

const landmarks = load('landmarks.json');
const hash = inputsHash(landmarks);

if (IF_STALE && existsSync(OUT)) {
  const cur = JSON.parse(readFileSync(OUT, 'utf8'));
  if (cur.v === FITS_VERSION && cur.inputs === hash) {
    console.log(`bake-fits: ${relative(ROOT, OUT)} is current (${hash})`);
    process.exit(0);
  }
}

// ------------------------------------------------------------ groups
const groupOf = {};
let bad = 0;
for (const [group, builders] of Object.entries(GROUPS)) {
  for (const id of Object.keys(builders)) {
    if (groupOf[id]) {
      console.error(`FAIL  ${id} is in two groups: ${groupOf[id]} and ${group}`);
      bad++;
    }
    groupOf[id] = group;
  }
}
const ids = new Set(landmarks.map((l) => l.id));
for (const l of landmarks) {
  if (!groupOf[l.id]) {
    console.error(`FAIL  ${l.id} has no builder group (src/models/groups, src/models/loader.js)`);
    bad++;
  }
}
for (const id of Object.keys(groupOf)) {
  if (!ids.has(id)) console.warn(`warn  builder ${id} (group ${groupOf[id]}) is not a landmark of ${CITY.id}`);
}

// ------------------------------------------------------------ live fits
setDims(existsSync(dataPath('dimensions.json')) ? load('dimensions.json') : {});
const roads = load('roads.json');
const footprints = load('footprints.json');
const terrain = load('terrain.json');
const proj = createProjection(roads.origin, roads.bbox, landmarks, terrain);
const T = proj.terrain;
const ctx = { project: proj.project, rawAt: T.rawAt, footprints, models };

const warn = console.warn;
console.warn = () => {}; // deviation warnings belong to check-fit
const live = landmarks.map((l) => fitLandmark(l, ctx));
console.warn = warn;

const entries = {};
for (let i = 0; i < landmarks.length; i++) {
  const l = landmarks[i];
  const f = live[i];
  const { rule, fn } = serializeRule(models.builderRule(l.model, l.id));
  entries[l.id] = {
    spec: models.specFor(l.id, l.model),
    rule,
    ...(fn ? { fn: true } : {}),
    metric: models.isMetric(l.model, l.id),
    ...bakedFit(f),
  };
}
const doc = { v: FITS_VERSION, inputs: hash, city: CITY.id, groups: groupOf, models: entries };

if (!CHECK) {
  if (bad) process.exit(1);
  writeFileSync(OUT, `${JSON.stringify(doc)}\n`);
  const tris = Object.values(entries).reduce((a, e) => a + e.tris, 0);
  console.log(`bake-fits: wrote ${relative(ROOT, OUT)}: ${landmarks.length} landmarks, ${(tris / 1000).toFixed(0)}k triangles skipped at boot, ${(statSync(OUT).size / 1024).toFixed(1)} KB, inputs ${hash}`);
  process.exit(0);
}

// ------------------------------------------------------------ --check
if (!existsSync(OUT)) {
  console.error(`FAIL  ${relative(ROOT, OUT)} does not exist: run npm run bake:fits`);
  process.exit(1);
}
const file = JSON.parse(readFileSync(OUT, 'utf8'));
if (file.v !== FITS_VERSION || file.inputs !== hash) {
  console.error(`FAIL  ${relative(ROOT, OUT)} is stale (file ${file.inputs}, inputs now ${hash}): run npm run bake:fits`);
  bad++;
}

const TOL = 1e-6;
const diffs = [];
// numbers compared with an absolute + relative tolerance; objects by key;
// functions skipped (padLevel, ground ...: they are rebuilt from the same code)
function cmp(a, b, path) {
  if (typeof a === 'function' || typeof b === 'function' || path.endsWith('.geometry')) return;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return;
    if (Math.abs(a - b) > TOL + TOL * Math.max(Math.abs(a), Math.abs(b))) diffs.push(`${path}: ${a} vs ${b}`);
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) cmp(a[k], b[k], `${path}.${k}`);
    return;
  }
  if (a !== b && !(a == null && b == null)) diffs.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
}

// 2. cached entries against the live model
for (const l of landmarks) {
  const e = file.models?.[l.id];
  if (!e) {
    console.error(`FAIL  ${l.id}: no entry in fits.json`);
    bad++;
    continue;
  }
  const fresh = entries[l.id];
  cmp(JSON.parse(JSON.stringify(fresh)), e, l.id);
}

// 3. a fit from the cache alone against the live fit
const ruleSources = {};
for (const l of landmarks) if (file.models?.[l.id]?.fn) ruleSources[l.id] = models.builderRule(l.model, l.id);
const meta = createMeta(file, ruleSources);
const lazyCtx = { project: proj.project, rawAt: T.rawAt, footprints, models: meta.models, baked: (id) => meta.entry(id) };
console.warn = () => {};
const lazy = landmarks.map((l) => fitLandmark(l, lazyCtx));
console.warn = warn;
const SKIP = new Set(['geometry', 'glass', 'frame', 'footprint', 'rule', 'spec', 'dims', 'lazy', 'bakedSphere']);
let shrinkLive = 0;
let shrinkLazy = 0;
for (let i = 0; i < landmarks.length; i++) {
  const a = live[i];
  const b = lazy[i];
  const before = diffs.length;
  for (const k of Object.keys(a)) if (!SKIP.has(k)) cmp(a[k], b[k], `${a.id}.fit.${k}`);
  // pads must come out the same, since the terrain is shaped by them
  for (const f of [a, b]) f._pad = f.fallback || f.rule.pad === 'none' ? null : { ...f.padPlan };
  cmp(a._pad, b._pad, `${a.id}.fit.pad`);
  if (b.geometry !== null || !b.lazy) diffs.push(`${a.id}: a baked fit must not build a geometry`);
  if (diffs.length > before) bad++;
  if (!shrinkCheck(a).ok) shrinkLive++;
  if (!shrinkCheck(b).ok) shrinkLazy++;
}
if (shrinkLive !== shrinkLazy) {
  console.error(`FAIL  never-shrink: ${shrinkLive} live, ${shrinkLazy} from the cache`);
  bad++;
}
// padLevel (bridges): same ground height at sample points
for (let i = 0; i < landmarks.length; i++) {
  const a = live[i];
  const b = lazy[i];
  if (!a.padLevel) continue;
  const p = a.padPlan;
  for (const [u, v] of [[-0.9, -0.5], [0, 0], [0.7, 0.4], [1.2, 0]]) {
    const x = p.cx + p.ux * p.hu * u + -p.uz * p.hv * v;
    const z = p.cz + p.uz * p.hu * u + p.ux * p.hv * v;
    cmp(a.padLevel(x, z), b.padLevel(x, z), `${a.id}.padLevel(${u},${v})`);
  }
}

if (diffs.length) {
  console.error(`FAIL  ${diffs.length} number(s) differ between the cache and a live fit:`);
  for (const d of diffs.slice(0, 25)) console.error(`  ${d}`);
  bad++;
}
if (bad) {
  console.error(`bake-fits --check: FAILED (${bad})`);
  process.exit(1);
}
console.log(`bake-fits --check: OK — ${landmarks.length} landmarks, cache = live fit (tol ${TOL}), never-shrink ${shrinkLive} failing on both, ${new Set(Object.values(groupOf)).size} builder groups, inputs ${hash}`);
