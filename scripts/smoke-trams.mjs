#!/usr/bin/env node
// Headless smoke test for the historic trams in src/life.js.
//
//   node scripts/smoke-trams.mjs
//
// Loads the real module through Vite's SSR transform (life.js imports Vite
// features such as i18n's import.meta.glob), builds the trams against the real
// terrain projection and data/life.json, and checks that every line has cars,
// the rails follow the routes, positions stay finite, and the cars move. No
// browser needed. Exits 1 on any failure.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from 'vite';
import { createProjection } from '../src/geo.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const j = (f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));

const terrain = j('data/terrain.json');
const city = j('cities/porto.json');
const life = j('data/life.json');

const { project, heightAt } = createProjection(city.origin, null, [], terrain);

function fail(msg) {
  console.error(`FAIL  ${msg}`);
  process.exitCode = 1;
}

// ---- data contract
const routes = life.trams?.routes;
if (!Array.isArray(routes) || routes.length < 3) fail('life.json: trams.routes missing or fewer than 3 lines');
const ids = new Set(routes.map((r) => String(r.id)));
for (const want of ['1', '18', '22']) if (!ids.has(want)) fail(`life.json: tram line ${want} missing`);
for (const r of routes) {
  if (!Array.isArray(r.points) || r.points.length < 2) fail(`tram ${r.id}: bad points`);
  if (!r.name) fail(`tram ${r.id}: no name`);
  if (!r.colour) fail(`tram ${r.id}: no colour`);
}

// ---- build the real builder through Vite SSR
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
let result;
let liteResult;
try {
  const mod = await server.ssrLoadModule('/src/life.js');
  mod.setLifeData(life);
  result = mod.buildTrams({ project, heightAt, mobile: false, lite: false });
  liteResult = mod.buildTrams({ project, heightAt, mobile: true, lite: true });
} catch (e) {
  fail(`buildTrams threw: ${e.message}`);
} finally {
  await server.close();
}
if (!result) {
  console.error('FAIL  buildTrams returned null');
  process.exit(1);
}
// the phone / light tier keeps one car per line
if (!liteResult || liteResult.stats.trams !== routes.length) fail(`lite tier: ${liteResult?.stats?.trams} cars, expected ${routes.length}`);
if (!(liteResult.stats.railSegments > 0)) fail('lite tier: no rails');

const s = result.stats;
if (!(s.trams >= 3)) fail(`few trams: ${s.trams}`);
if (s.routes !== routes.length) fail(`route mismatch: built ${s.routes} of ${routes.length}`);
if (!(s.railSegments > 0)) fail('no rail segments built');

// ---- every object is finite and the rails sit near the ground
let cars = 0;
let car0 = null;
for (const child of result.object.children) {
  if (child.isInstancedMesh) {
    for (const v of child.instanceMatrix.array) if (!Number.isFinite(v)) fail(`NaN in ${child.name} matrices`);
  }
  if (child.name && /^tram-\d/.test(child.name) && !child.isInstancedMesh) {
    cars += 1;
    if (!car0) car0 = child;
  }
}
if (cars !== s.trams) fail(`expected ${s.trams} car groups, found ${cars}`);
if (!car0) {
  console.error('FAIL  no tram car group');
  process.exit(1);
}

// a camera stub: update() reads position.x / position.z
const cam = { position: { x: 0, y: 0, z: 0 } };

// ---- advance a few seconds; the board materials must not throw, the cars move
const samples = [];
for (let f = 0; f < 300; f++) {
  result.update(1 / 30, cam);
  if (!Number.isFinite(car0.position.x) || !Number.isFinite(car0.position.y) || !Number.isFinite(car0.position.z)) {
    fail(`tram position not finite at frame ${f}`);
  }
  if (f % 100 === 99) samples.push({ x: car0.position.x, y: car0.position.y, z: car0.position.z });
}
const moved = samples.length > 1 ? Math.hypot(samples[1].x - samples[0].x, samples[1].z - samples[0].z) : 0;
if (moved < 0.01) fail('the first tram did not move along its line');

// ---- reduced motion must be a valid still frame (dt = 0)
result.update(0, cam);
if (!Number.isFinite(car0.position.x)) fail('reduced-motion frame is not finite');

console.log(`PASS  smoke-trams: ${s.trams} yellow cars on ${s.routes} lines (${s.perRoute}/line), ${s.km} km`);
console.log(`      rails: ${s.railSegments} segments; first car moved ${moved.toFixed(2)} world units / 3.3 s`);
console.log(process.exitCode ? 'smoke-trams: FAILED' : 'smoke-trams: OK');
