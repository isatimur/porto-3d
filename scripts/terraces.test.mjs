// Quay terraces (src/terraces.js) and polygon pads (src/terrain.js addPad poly).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTerrain } from '../src/terrain.js';
import { terracePads, terraceLevelAt, nearTerrace } from '../src/terraces.js';

const S = 0.25; // world units per metre
const DEG_M = 111195; // metres per degree of latitude (and of longitude here: a flat test frame)
const toMetres = (lat, lon) => ({ x: lon * DEG_M, z: -lat * DEG_M });
const project = (lat, lon) => {
  const m = toMetres(lat, lon);
  return { x: m.x * S, z: m.z * S };
};

// A bank rising north from the river: 0.5 m at lat 0 to 40.5 m at lat 0.002 (222 m),
// 18 % everywhere, like the DEM ramp over the Ribeira. 21 x 21 nodes.
function bank() {
  const cols = 21;
  const rows = 21;
  const heights = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) heights.push(0.5 + 2 * r);
  return { cols, rows, heights, bbox: { s: 0, w: 0, n: 0.002, e: 0.002 }, min_m: 0.5, max_m: 40.5, source: 'test' };
}

// lat/lon of a point in metres north / east of the grid's south-west corner
const ll = (north, east) => [north / DEG_M, east / DEG_M];
// the quay: 80 m along the river, from 20 m to 60 m north of it
const OUTLINE = [ll(20, 60), ll(20, 140), ll(60, 140), ll(60, 60)];
const DEF = { id: 'q', level_m: 5, fall_m: 6, fall_max_m: 40, batter: 3, outline: OUTLINE };

function setup() {
  const terrain = createTerrain(bank(), toMetres, S);
  for (const p of terracePads([DEF], { project, terrain, S })) terrain.addPad(p);
  const at = (north, east) => {
    const [lat, lon] = ll(north, east);
    const w = project(lat, lon);
    return { w, m: terrain.elevationAt(w.x, w.z) };
  };
  return { terrain, at };
}

test('a terrace is level at its height inside the outline, both on the cut and on the fill side', () => {
  const { at } = setup();
  for (const [n, e] of [[22, 70], [40, 100], [58, 130]]) {
    assert.ok(Math.abs(at(n, e).m - 5) < 0.05, `inside at ${n} m north: ${at(n, e).m.toFixed(2)} m`);
  }
});

test('a terrace fills low ground by the water inside the outline (shore) but not the river outside it', () => {
  const { terrain, at } = setup();
  // the bank at 20 m north is 4.5 m above sea level, under 5 m: the low-ground rule would ease the fill
  assert.ok(Math.abs(at(20.5, 100).m - 5) < 0.05);
  // 25 m out in the river (ground under 1.5 m) nothing is filled
  const [lat, lon] = ll(-5, 100);
  const w = project(lat, lon);
  assert.ok(Math.abs(terrain.elevationAt(w.x, w.z) - terrain.rawMetres(w.x / S, w.z / S)) < 1e-6);
});

test('the feather climbs back to the ground no steeper than the batter allows, and stops at fall_max', () => {
  const { terrain, at } = setup();
  let prev = at(60, 100).m;
  for (let d = 2; d <= 40; d += 2) {
    const cur = at(60 + d, 100).m;
    // ground slope 18 % plus the cut taken back over the feather; never a cliff
    assert.ok((cur - prev) / 2 < 1.2, `slope ${(cur - prev) / 2} at ${d} m`);
    prev = cur;
  }
  const [lat, lon] = ll(105, 100);
  const w = project(lat, lon);
  assert.equal(terrain.elevationAt(w.x, w.z), terrain.rawMetres(w.x / S, w.z / S));
});

test('terraceLevelAt finds the level inside the outline and null outside', () => {
  const { terrain } = setup();
  const [lat, lon] = ll(40, 100);
  const w = project(lat, lon);
  assert.ok(Math.abs(terraceLevelAt(terrain.pads, w.x, w.z) - (5 - terrain.datum) * S) < 1e-9);
  const [lat2, lon2] = ll(80, 100);
  const w2 = project(lat2, lon2);
  assert.equal(terraceLevelAt(terrain.pads, w2.x, w2.z), null);
});

test('nearTerrace holds the paving and a margin round its outline, nothing further out', () => {
  const { terrain } = setup();
  const w = (n, e) => project(...ll(n, e));
  const near = (n, e, m) => nearTerrace(terrain.pads, w(n, e).x, w(n, e).z, m * S);
  assert.equal(near(40, 100, 0), true); // on the paving
  assert.equal(near(66, 100, 0), false); // 6 m inland of the edge, no margin
  assert.equal(near(66, 100, 8), true); // within an 8 m margin
  assert.equal(near(70, 100, 8), false); // 10 m out
  assert.equal(near(40, 150, 8), false); // 10 m past the east end
});

test('no or malformed terrace definitions give no pads', () => {
  const terrain = createTerrain(bank(), toMetres, S);
  assert.deepEqual(terracePads(undefined, { project, terrain, S }), []);
  assert.deepEqual(terracePads([{ id: 'x', level_m: 5, outline: [ll(0, 0)] }], { project, terrain, S }), []);
  assert.deepEqual(terracePads([{ id: 'x', outline: OUTLINE }], { project, terrain, S }), []);
});
