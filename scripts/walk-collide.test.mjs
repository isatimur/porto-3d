// Walk mode collision (src/walk-collide.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollider, gatePiers } from '../src/walk-collide.js';

// two houses with a 4-unit street between them, and one far house
const A = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];
const B = [[14, 0], [24, 0], [24, 10], [14, 10]]; // array points work too
const FAR = [{ x: 100, z: 100 }, { x: 103, z: 100 }, { x: 103, z: 103 }, { x: 100, z: 103 }];
const c = createCollider([A, B, FAR, null, [{ x: 1, z: 1 }]], 8);

test('counts only real outlines', () => {
  assert.equal(c.count, 3);
});

test('inside: houses yes, street no', () => {
  assert.equal(c.inside(5, 5), true);
  assert.equal(c.inside(20, 5), true);
  assert.equal(c.inside(12, 5), false);
  assert.equal(c.inside(101, 101), true);
  assert.equal(c.inside(-50, -50), false);
});

test('blocked uses the body radius', () => {
  assert.equal(c.blocked(10.05, 5, 0), false);
  assert.equal(c.blocked(10.05, 5, 0.1), true);
  assert.equal(c.blocked(12, 5, 0.1), false);
});

test('a walk down the street is free', () => {
  const r = c.move(12, -5, 0, 20, 0.1);
  assert.equal(r.hit, false);
  assert.ok(Math.abs(r.x - 12) < 1e-9 && Math.abs(r.z - 15) < 1e-9);
});

test('a walk into a wall stops at the wall', () => {
  const r = c.move(12, 5, -5, 0, 0.1);
  assert.equal(r.hit, true);
  assert.equal(c.blocked(r.x, r.z, 0.1), false);
  assert.ok(r.x > 10 && r.x < 10.3, `x ${r.x}`);
});

test('a diagonal step slides along the wall', () => {
  const r = c.move(10.2, 2, -1, 3, 0.1);
  assert.equal(r.hit, true);
  assert.equal(c.blocked(r.x, r.z, 0.1), false);
  assert.ok(r.z > 4.5, `z ${r.z}`); // it kept going along the street
  assert.ok(r.x > 10, `x ${r.x}`);
});

test('a long step does not jump through a house', () => {
  const r = c.move(-2, 5, 40, 0, 0.1);
  assert.ok(r.x < 0, `x ${r.x}`);
});

test('a walker slides along a wall at any angle', () => {
  // pushed at 45 degrees into a long wall: at least 90 % of the ideal
  // progress along it, and never into it
  for (const deg of [0, 20, 45, 60, 75, 90]) {
    const a = (deg * Math.PI) / 180;
    const ux = Math.cos(a), uz = Math.sin(a), nx = -uz, nz = ux;
    const P = (s, d) => [ux * s + nx * d, uz * s + nz * d];
    const w = createCollider([[P(-100, 0), P(100, 0), P(100, 10), P(-100, 10)]]);
    let x = nx * -0.3, z = nz * -0.3;
    const dx = (ux + nx) * Math.SQRT1_2 * 0.006, dz = (uz + nz) * Math.SQRT1_2 * 0.006;
    for (let k = 0; k < 600; k++) ({ x, z } = w.move(x, z, dx, dz, 0.1125));
    const along = (x * ux + z * uz) / (600 * 0.006 * Math.SQRT1_2);
    assert.ok(along > 0.9, `${deg} degrees: ${along.toFixed(2)} of the ideal`);
    assert.ok(x * nx + z * nz < -0.1, `${deg} degrees: inside the wall`);
  }
});

test('freeNear leaves a house by the short way', () => {
  const p = c.freeNear(9, 5, 0.1);
  assert.ok(p);
  assert.equal(c.blocked(p.x, p.z, 0.1), false);
  assert.ok(Math.hypot(p.x - 9, p.z - 5) < 2, JSON.stringify(p));
  assert.deepEqual(c.freeNear(12, 5, 0.1), { x: 12, z: 5 });
});

test('a gate blocks at its piers and lets the walker through the middle', () => {
  // an arch 8 long (across the street, along z) and 3 deep (along x), turned 20 degrees
  const t = (20 * Math.PI) / 180, rot = ([x, z]) => [x * Math.cos(t) - z * Math.sin(t), x * Math.sin(t) + z * Math.cos(t)];
  const gate = [[0, 0], [3, 0], [3, 8], [0, 8]].map(rot);
  const piers = gatePiers(gate, 0.5);
  assert.equal(piers.length, 2);
  const g = createCollider(piers, 8);
  assert.equal(g.inside(...rot([1.5, 1])), true); // a pier
  assert.equal(g.inside(...rot([1.5, 7])), true); // the other pier
  assert.equal(g.blocked(...rot([1.5, 4]), 0.3), false); // the passage
  // walk through the arch, along x
  const [sx, sz] = rot([-2, 4]), [ex, ez] = rot([5, 4]);
  const end = g.move(sx, sz, ex - sx, ez - sz, 0.3);
  assert.ok(Math.hypot(end.x - ex, end.z - ez) < 1e-6 && !end.hit, JSON.stringify(end));
});
