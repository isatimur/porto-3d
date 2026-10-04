#!/usr/bin/env node
// Headless smoke test for the rail rolling stock in src/life.js (the Metro do
// Porto Linha D across the Luís I upper deck, and CP mainline trains on the
// Ponte de São João).
//
//   node scripts/smoke-rail.mjs
//
// Loads the real module through Vite's SSR transform, fits the two bridge
// landmarks exactly as the app does (src/fit.js) so the builders get the real
// deck anchors and footprints, builds the trains against the real terrain
// projection and data/life.json, then checks the data contract, the deck
// height on the bridges, terrain following off them, finite motion and the
// light tier. No browser needed. Exits 1 on any failure.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from 'vite';
import { createProjection, S } from '../src/geo.js';
import { fitLandmark, setDims } from '../src/fit.js';
import { loadCityModels } from '../src/models.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const j = (f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));

const terrain = j('data/terrain.json');
const city = j('cities/porto.json');
const roads = j('data/roads.json');
const footprints = j('data/footprints.json');
const landmarks = j('data/landmarks.json');
const life = j('data/life.json');

const proj = createProjection(city.origin, roads.bbox, landmarks, terrain);
const { project, heightAt } = proj;
const T = proj.terrain;

function fail(msg) {
  console.error(`FAIL  ${msg}`);
  process.exitCode = 1;
}

// ---- data contract
const rail = life.rail;
if (!rail || !Array.isArray(rail.items) || rail.items.length < 2) fail('life.json: rail.items missing');
const byId = Object.fromEntries((rail?.items ?? []).map((r) => [r.id, r]));
for (const id of ['metro-d', 'cp-norte']) if (!byId[id]) fail(`life.json: rail service ${id} missing`);
for (const it of rail?.items ?? []) {
  if (!Array.isArray(it.path) || it.path.length < 2) fail(`rail ${it.id}: bad path`);
  if (!(it.speed_mps > 0)) fail(`rail ${it.id}: bad speed`);
  if (!(it.count >= 1)) fail(`rail ${it.id}: bad count`);
  if (!it.bridge?.site || !(it.bridge.deck_m > 0)) fail(`rail ${it.id}: bad bridge metadata`);
  for (const [la, lo] of it.path) if (!(la > 41.0 && la < 41.3 && lo > -8.8 && lo < -8.4)) fail(`rail ${it.id}: point ${la},${lo} off Porto`);
}
if (byId['metro-d']?.service !== 'metro') fail('rail metro-d: wrong service');
if (byId['cp-norte']?.service !== 'mainline') fail('rail cp-norte: wrong service');

// ---- fit the bridge landmarks (real deck anchor + footprint), as the app does
setDims(j('data/dimensions.json'));
await loadCityModels('porto');
const fitById = {};
for (const id of ['ponte-luis-i', 'ponte-sao-joao']) {
  const l = landmarks.find((x) => x.id === id);
  const f = fitLandmark(l, { project, rawAt: T.rawAt, footprints });
  f.geometry.computeBoundingBox();
  fitById[id] = f;
}
const items = (rail?.items ?? []).map((it) => ({
  data: { id: it.bridge.site },
  meshes: [{ position: fitById[it.bridge.site].pivot, geometry: fitById[it.bridge.site].geometry }],
}));

// ---- build the real builder through Vite SSR
// One-shot SSR load: no listening server, no HMR / file watching, no dep
// pre-bundling scan — deterministic and it leaves no open handles behind.
const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
});
let result;
let liteResult;
try {
  const mod = await server.ssrLoadModule('/src/life.js');
  mod.setLifeData(life);
  result = mod.buildTrains({ project, heightAt, items, mobile: false, lite: false });
  liteResult = mod.buildTrains({ project, heightAt, items, mobile: true, lite: true });
} catch (e) {
  fail(`buildTrains threw: ${e.message}`);
} finally {
  await server.close();
}
if (!result) {
  console.error('FAIL  buildTrains returned null');
  process.exit(1);
}
if (!liteResult) {
  console.error('FAIL  buildTrains (lite) returned null');
  process.exit(1);
}

const s = result.stats;
const wantTrains = (rail?.items ?? []).reduce((n, r) => n + r.count, 0);
if (s.trains !== wantTrains) fail(`trains: ${s.trains}, expected ${wantTrains}`);
if (!(s.triangles > 0 && s.triangles < 4000)) fail(`triangles out of budget: ${s.triangles}`);
if (liteResult.stats.trains !== (rail?.items ?? []).length) fail(`lite tier: ${liteResult.stats.trains} trains, expected ${rail?.items?.length}`);

// ---- finite matrices
for (const child of result.object.children) {
  if (child.isInstancedMesh) for (const v of child.instanceMatrix.array) if (!Number.isFinite(v)) fail(`NaN in ${child.name} matrices`);
}

// ---- a camera stub: update() reads position.x / position.z
const cam = { position: { x: 0, y: 0, z: 0 } };

// collect the y range over a long run (several ping-pong cycles)
const range = { 'metro-d': { min: Infinity, max: -Infinity }, 'cp-norte': { min: Infinity, max: -Infinity } };
for (let f = 0; f < 6000; f++) {
  result.update(1 / 30, cam);
  if (f % 5) continue;
  for (const id of Object.keys(range)) {
    const p = result.position(id);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
      fail(`rail ${id}: position not finite at frame ${f}`);
      continue;
    }
    range[id].min = Math.min(range[id].min, p.y);
    range[id].max = Math.max(range[id].max, p.y);
  }
}

// the metro deck: base + 60 m (the Luís I upper deck), reached on the bridge
const metroDeck = fitById['ponte-luis-i'].pivot.y + 60 * S;
if (Math.abs(range['metro-d'].min - metroDeck) > 0.9) {
  fail(`metro deck not reached: min y ${range['metro-d'].min.toFixed(2)} vs deck ${metroDeck.toFixed(2)}`);
}
const metroMid = project(41.14, -8.6095);
if (metroDeck - heightAt(metroMid.x, metroMid.z) < 8) fail('metro deck is not well above the terrain on the bridge');

// CP: crosses the São João deck (base + 66 m) but leaves it for the terrain on
// the approach ramps. The 6 m drop proves terrain-following off the bridge; it
// happens first on the Campanhã approach, where the deck ends at the model's
// Porto abutment (the real bridge is ~1147 m, not the full Campanhã corridor).
const cpDeck = fitById['ponte-sao-joao'].pivot.y + 66 * S;
const cpReached = range['cp-norte'].min <= cpDeck + 0.9 && range['cp-norte'].max >= cpDeck - 0.9;
if (!cpReached) fail(`mainline never reaches the São João deck ${cpDeck.toFixed(2)} (y ${range['cp-norte'].min.toFixed(2)}..${range['cp-norte'].max.toFixed(2)})`);
if (!(range['cp-norte'].min < cpDeck - 1.5)) fail('mainline does not drop to the terrain off the São João deck on its approach');
const cpMid = project(41.1384, -8.59629);
if (cpDeck - heightAt(cpMid.x, cpMid.z) < 12) fail('mainline deck is not well above the terrain on the São João span');

// ---- movement and reduced motion
const a = result.position('cp-norte');
for (let f = 0; f < 30; f++) result.update(1 / 30, cam);
const b = result.position('cp-norte');
if (Math.hypot(b.x - a.x, b.z - a.z) < 0.01) fail('the mainline train did not move along its line');
result.update(0, cam);
if (!Number.isFinite(result.position('metro-d').x)) fail('reduced-motion frame is not finite');

console.log(`PASS  smoke-rail: ${s.trains} trains on ${s.services} services (${s.metro} metro, ${s.mainline} mainline)`);
console.log(`      ${s.km} km of alignment, ${s.onDeck} with a bridge deck; ${s.triangles} triangles`);
console.log(`      metro deck ${metroDeck.toFixed(2)} (y range ${range['metro-d'].min.toFixed(2)}..${range['metro-d'].max.toFixed(2)})`);
console.log(`      CP deck ${cpDeck.toFixed(2)} (y range ${range['cp-norte'].min.toFixed(2)}..${range['cp-norte'].max.toFixed(2)})`);
console.log(process.exitCode ? 'smoke-rail: FAILED' : 'smoke-rail: OK');
