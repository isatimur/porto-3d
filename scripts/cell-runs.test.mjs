// src/cell-runs.js: a city-wide merged mesh or fat-line set draws only its
// grid cells in view. These checks hold the culling to "never drop a
// primitive that can be seen":
//   - the reorder keeps every triangle (segment) and its dash data;
//   - each cell's box holds every vertex of its primitives;
//   - for random cameras, every primitive whose box meets the view frustum
//     (or the shadow frustum, for a caster) lies inside a drawn run;
//   - over the whole city it is one run, the object's full range.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { createCellCuller } from '../src/cell-runs.js';

// a deterministic random source
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// n small triangles scattered over a city-sized square (half-size R)
function cityMesh(n, R, seed = 1) {
  const r = lcg(seed);
  const pos = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) {
    const x = (r() * 2 - 1) * R;
    const z = (r() * 2 - 1) * R;
    const y = r() * 30;
    for (let k = 0; k < 3; k++) {
      pos[t * 9 + k * 3] = x + (r() - 0.5) * 8;
      pos[t * 9 + k * 3 + 1] = y + r() * 4;
      pos[t * 9 + k * 3 + 2] = z + (r() - 0.5) * 8;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex([...Array(n * 3).keys()]);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  m.name = 'test-mesh';
  return m;
}

function cityLines(n, R, seed = 2) {
  const r = lcg(seed);
  const pos = [];
  for (let i = 0; i < n; i++) {
    const x = (r() * 2 - 1) * R;
    const z = (r() * 2 - 1) * R;
    pos.push(x, 1, z, x + (r() - 0.5) * 40, 1, z + (r() - 0.5) * 40);
  }
  const g = new LineSegmentsGeometry().setPositions(pos);
  const line = new LineSegments2(g, new LineMaterial({ linewidth: 2 }));
  line.computeLineDistances();
  line.name = 'test-lines';
  return line;
}

const triKey = (a, t) => [a[3 * t], a[3 * t + 1], a[3 * t + 2]].join(',');

function camera(r, R) {
  const cam = new THREE.PerspectiveCamera(50, 1.6, 0.5, 4000);
  cam.position.set((r() * 2 - 1) * R, 2 + r() * 300, (r() * 2 - 1) * R);
  cam.lookAt(cam.position.x + (r() - 0.5) * 400, r() * 20, cam.position.z + (r() - 0.5) * 400);
  cam.updateMatrixWorld();
  return cam;
}
const frustumOf = (cam) => new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
// the index ranges the slots draw this frame (mesh: index elements)
const drawnRanges = (obj) => obj.children.filter((s) => s.visible).map((s) => [s.geometry.drawRange.start, s.geometry.drawRange.start + s.geometry.drawRange.count]);

test('mesh: the reorder keeps every triangle', () => {
  const mesh = cityMesh(20000, 1600);
  const before = new Set();
  const a0 = mesh.geometry.index.array;
  for (let t = 0; t < a0.length / 3; t++) before.add(triKey(a0, t));
  createCellCuller().add(mesh, { cell: 250 });
  const a1 = mesh.geometry.index.array;
  assert.equal(a1.length, a0.length);
  for (let t = 0; t < a1.length / 3; t++) assert.ok(before.has(triKey(a1, t)), `triangle ${t} is new`);
  assert.equal(new Set(Array.from({ length: a1.length / 3 }, (_, t) => triKey(a1, t))).size, before.size);
});

test('mesh: a triangle with a broken (NaN) vertex is kept once, not dropped or doubled', () => {
  const mesh = cityMesh(12000, 1600, 21);
  const pos = mesh.geometry.attributes.position.array;
  for (const t of [5, 777, 11999]) pos[t * 9] = NaN; // one vertex x of three triangles
  const before = Array.from({ length: 12000 }, (_, t) => triKey(mesh.geometry.index.array, t)).sort();
  createCellCuller().add(mesh, { cell: 250 });
  const after = Array.from({ length: 12000 }, (_, t) => triKey(mesh.geometry.index.array, t)).sort();
  assert.deepEqual(after, before);
});

test('mesh: no triangle in view is left out, for random cameras', () => {
  const R = 1600;
  const mesh = cityMesh(30000, R, 7);
  const culler = createCellCuller();
  const h = culler.add(mesh, { cell: 250, maxRuns: 3 });
  assert.ok(h, 'a city-wide mesh gets slots');
  const pos = mesh.geometry.attributes.position.array;
  const idx = mesh.geometry.index.array;
  const r = lcg(99);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  let culledSome = false;
  for (let k = 0; k < 40; k++) {
    const cam = camera(r, R);
    culler.update(cam, null);
    const runs = drawnRanges(mesh);
    const inRun = (e) => runs.some(([s, end]) => e >= s && e < end);
    const f = frustumOf(cam);
    let drawn = 0;
    for (const [s, end] of runs) drawn += end - s;
    if (drawn < idx.length) culledSome = true;
    for (let t = 0; t < idx.length / 3; t++) {
      box.makeEmpty();
      for (let j = 0; j < 3; j++) box.expandByPoint(v.fromArray(pos, idx[3 * t + j] * 3));
      if (f.intersectsBox(box)) assert.ok(inRun(3 * t), `camera ${k}: triangle ${t} in view is not drawn`);
    }
    assert.ok(runs.length <= 3);
  }
  assert.ok(culledSome, 'some views draw less than the whole mesh');
});

test('mesh: a caster keeps the cells the shadow camera sees', () => {
  const R = 1600;
  const mesh = cityMesh(20000, R, 3);
  mesh.castShadow = true;
  const culler = createCellCuller();
  culler.add(mesh, { cell: 250 });
  const r = lcg(5);
  const pos = mesh.geometry.attributes.position.array;
  const idx = mesh.geometry.index.array;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let k = 0; k < 10; k++) {
    const cam = camera(r, R);
    const sun = new THREE.OrthographicCamera(-600, 600, 600, -600, 1, 8000);
    sun.position.set(cam.position.x + 2000, 3000, cam.position.z + 1000);
    sun.lookAt(cam.position.x, 0, cam.position.z);
    sun.updateMatrixWorld();
    culler.update(cam, sun);
    const runs = drawnRanges(mesh);
    const fs = frustumOf(sun);
    for (let t = 0; t < idx.length / 3; t++) {
      box.makeEmpty();
      for (let j = 0; j < 3; j++) box.expandByPoint(v.fromArray(pos, idx[3 * t + j] * 3));
      if (fs.intersectsBox(box)) assert.ok(runs.some(([s, e]) => 3 * t >= s && 3 * t < e), `shadow view ${k}: triangle ${t} is not drawn`);
    }
  }
});

test('mesh: over the whole city it is one draw of everything', () => {
  const mesh = cityMesh(10000, 1600, 11);
  const culler = createCellCuller();
  culler.add(mesh, { cell: 250 });
  const cam = new THREE.PerspectiveCamera(50, 1.6, 1, 20000);
  cam.position.set(0, 6000, 2500);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  culler.update(cam, null);
  assert.deepEqual(drawnRanges(mesh), [[0, mesh.geometry.index.count]]);
});

test('fat lines: segments and dash distances move together; none in view is left out', () => {
  const R = 1600;
  const line = cityLines(8000, R);
  const P0 = line.geometry.attributes.instanceStart.data.array.slice();
  const D0 = line.geometry.attributes.instanceDistanceStart.data.array.slice();
  const seg = (P, D, i) => [P[6 * i], P[6 * i + 2], P[6 * i + 3], P[6 * i + 5], D[2 * i], D[2 * i + 1]].join(',');
  const before = new Set(Array.from({ length: 8000 }, (_, i) => seg(P0, D0, i)));
  const culler = createCellCuller();
  assert.ok(culler.add(line, { cell: 250, pad: 30 }));
  const P = line.geometry.attributes.instanceStart.data.array;
  const D = line.geometry.attributes.instanceDistanceStart.data.array;
  for (let i = 0; i < 8000; i++) assert.ok(before.has(seg(P, D, i)), `segment ${i} lost its dash distance or moved`);
  const r = lcg(42);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let k = 0; k < 25; k++) {
    const cam = camera(r, R);
    culler.update(cam, null);
    const f = frustumOf(cam);
    // a slot draws the instances [first, first + instanceCount)
    const runs = line.children
      .filter((s) => s.visible)
      .map((s) => {
        const first = s.geometry.attributes.instanceStart.offset / s.geometry.attributes.instanceStart.data.stride;
        return [first, first + s.geometry.instanceCount];
      });
    for (let i = 0; i < 8000; i++) {
      box.makeEmpty().expandByPoint(v.set(P[6 * i], P[6 * i + 1], P[6 * i + 2])).expandByPoint(v.set(P[6 * i + 3], P[6 * i + 4], P[6 * i + 5]));
      if (f.intersectsBox(box)) assert.ok(runs.some(([s, e]) => i >= s && i < e), `camera ${k}: segment ${i} in view is not drawn`);
    }
  }
});
