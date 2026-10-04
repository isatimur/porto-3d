#!/usr/bin/env node
// Headless smoke test for the river traffic in src/life.js.
//
//   node scripts/smoke-life.mjs
//
// Loads the real module through Vite's SSR transform (life.js imports Vite
// features such as i18n's import.meta.glob), builds the boats against the
// real terrain projection and data/life.json, and checks that every boat
// follows its path, stays on the river (inside an OSM water polygon), and
// produces finite geometry. No browser needed. Exits 1 on any failure.
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
const nature = j('data/nature.json');

const { project, heightAt } = createProjection(city.origin, null, [], terrain);

// point in polygon (lat, lon), OSM water areas
function inRing(lat, lon, ring) {
  let c = false;
  for (let i = 0, j2 = ring.length - 1; i < ring.length; j2 = i++) {
    const yi = ring[i][0];
    const xi = ring[i][1];
    const yj = ring[j2][0];
    const xj = ring[j2][1];
    if (yj > lat !== yi > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const waterAreas = nature.areas.filter((a) => a.k === 'water' && a.r);
const inWater = (lat, lon) => waterAreas.some((a) => a.r.some((r) => inRing(lat, lon, r)));

function fail(msg) {
  console.error(`FAIL  ${msg}`);
  process.exitCode = 1;
}

// ---- data contract
const boats = life.boats;
if (!boats || !Array.isArray(boats.items) || boats.items.length < 6) fail('life.json: boats.items missing or too few');
if (!Array.isArray(boats.moored) || boats.moored.length < 1) fail('life.json: boats.moored missing');
for (const it of boats.items) {
  if (!Array.isArray(it.path) || it.path.length < 2) fail(`boat ${it.id}: bad path`);
  if (!(it.speed_mps > 0)) fail(`boat ${it.id}: bad speed`);
  for (const [la, lo] of it.path) if (!inWater(la, lo)) fail(`boat ${it.id}: path point ${la},${lo} is not on OSM water`);
}
for (const m of boats.moored) if (!inWater(m.p[0], m.p[1])) fail(`moored ${m.type}: ${m.p} is not on water`);

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
try {
  const mod = await server.ssrLoadModule('/src/life.js');
  mod.setLifeData(life);
  result = mod.buildBoats({ project, heightAt, mobile: false, lite: false });
} catch (e) {
  fail(`buildBoats threw: ${e.message}`);
} finally {
  await server.close();
}
if (!result) {
  console.error('FAIL  buildBoats returned null');
  process.exit(1);
}

// a camera stub: update() only needs position.distanceToSquared()
const cam = { position: { distanceToSquared: () => 0 } };

// ---- advance a few seconds and check each boat is finite and moving
const samples = [];
for (let f = 0; f < 300; f++) {
  result.update(1 / 30, cam, null);
  if (f % 100 === 99) {
    const p = result.position(0);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) fail(`boat position not finite at frame ${f}`);
    samples.push(p);
  }
  for (const mesh of result.object.children) {
    if (mesh.isInstancedMesh) {
      for (const v of mesh.instanceMatrix.array) if (!Number.isFinite(v)) fail(`NaN in instanceMatrix of ${mesh.name}`);
    }
  }
}
if (samples.length > 1) {
  const moved = Math.hypot(samples[1].x - samples[0].x, samples[2].x - samples[1].x);
  if (moved < 0.01) fail('the first boat did not move along its path');
}

const s = result.stats;
const byType = (t) => boats.items.filter((it) => it.type === t).length;
console.log(`PASS  smoke-life: ${s.items} moving (${byType('rabelo')} rabelo, ${byType('cruiser')} cruiser, ${byType('ferry')} ferry) + ${s.moored} moored rabelo`);
console.log(`      routes ${s.routes}, boats triangles ${s.triangles}, wake ${s.wakeTriangles} tris / ${s.wakeSegments} segments`);
console.log(process.exitCode ? 'smoke-life: FAILED' : 'smoke-life: OK');
