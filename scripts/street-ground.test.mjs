// The street ground (src/street-ground.js, porto-041) on a small made-up network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStreetGround, CELL_M, EDGE_M } from '../src/street-ground.js';

const S = 0.25;
// a straight street along x at z = 0, from x = -40 to 40 (world units), 6 m wide,
// at y = 2 (world units); the plain ground is a slope rising 0.3 per unit to +z
function setup({ paved = true, district = { x0: -60, x1: 60, z0: -60, z1: 60 }, padInside } = {}) {
  const X = [], Z = [], Y = [];
  for (let x = -40; x <= 40; x += 1.5) {
    X.push(x);
    Z.push(0);
    Y.push(2);
  }
  const n = X.length;
  const net = {
    X: Float32Array.from(X),
    Z: Float32Array.from(Z),
    Y: Float32Array.from(Y),
    HID: new Uint8Array(n),
    ways: [{ start: 0, n, widthM: 6, kind: paved ? 'minor' : 'foot', hw: paved ? 'residential' : 'footway', tunnel: false, bridge: false }],
  };
  const baseAt = (x, z) => 2 + 0.3 * z;
  const f = buildStreetGround(net, district, { baseAt, padInside, S, lift: 0.08, pavedHalf: (w) => (w.kind === 'foot' ? 0 : 3 * S) });
  const at = (x, z) => {
    const c = Math.round((x - f.x0) / f.cell);
    const r = Math.round((z - f.z0) / f.cell);
    const k = r * f.nx + c;
    return { T: f.T[k], W: f.W[k], h: baseAt(x, z) + f.W[k] * (f.T[k] - baseAt(x, z)) };
  };
  return { f, at };
}

test('under the paving the ground is the street, level across (within the lift: the margin is smoothed in)', () => {
  const { at } = setup();
  for (const z of [-0.5, 0, 0.5]) {
    const q = at(0, z);
    assert.equal(q.W, 1);
    assert.ok(q.T >= 2 - 1e-6 && q.T <= 2.08 + 1e-6, `T ${q.T} at z ${z}`);
  }
});

test('the margin beyond the paving meets the paving top (street + lift)', () => {
  const { at } = setup();
  const q = at(0, 3 * S + 1 * S); // 1 m beyond the 3 m half width
  assert.equal(q.W, 1);
  assert.ok(Math.abs(q.T - 2.08) < 1e-6);
});

test('the feather returns to the plain ground, no steeper than the batter', () => {
  const { at } = setup();
  const far = at(0, 40);
  assert.equal(far.W, 0);
  let prev = at(0, 1.5).h;
  for (let z = 1.5 + CELL_M * S; z < 12; z += CELL_M * S) {
    const h = at(0, z).h;
    assert.ok(Math.abs(h - prev) / (CELL_M * S) < 1.2, `slope ${(h - prev) / (CELL_M * S)} at z ${z}`);
    prev = h;
  }
});

test('a footway: the ground is the path at its own height, no lift', () => {
  const { at } = setup({ paved: false });
  const q = at(0, 0);
  assert.equal(q.W, 1);
  assert.ok(Math.abs(q.T - 2) < 1e-6);
});

test('no weight at the district edge, nor inside a quay terrace', () => {
  const { at } = setup({ district: { x0: -30, x1: 30, z0: -30, z1: 30 } });
  assert.equal(at(-30, 0).W, 0);
  assert.ok(at(-30 + EDGE_M * S * 0.5, 0).W < 1);
  const t = setup({ padInside: (x) => x > 10 });
  assert.equal(t.at(20, 0).W, 0);
  assert.equal(t.at(-20, 0).W, 1);
});
