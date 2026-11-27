// The pure rules of the walk frame budget (scripts/frame-budget.mjs,
// docs/specs/walk-budget.md §4-5). Engine-shared: the forks hold
// byte-identical copies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUALITY_CLASS, stats, angleDiff, spread, judge, computeLimits } from './frame-budget.mjs';

const START = { x: 10, z: -5, yaw: 1.5708 };
const walkOf = (over = {}) => ({
  probe: { path: 'play', runs: 5, start: START, ...over.probe },
  desktop: { quality: 'ultra', calls: 300, tris: 3000000, minCalls: 100, minTris: 1000000, ...over.desktop },
  phone: { quality: 'low', calls: 200, tris: 1500000, minCalls: 60, minTris: 500000, ...over.phone },
});
const runOf = (over = {}) => ({
  profile: 'desktop', want: 'XL', fault: null, errors: [], cls: 'XL', level: 0,
  renderer: 'ANGLE (Apple M1 Max)', tiles: true, pose: { ...START }, metresPerUnit: 4, drift: 0,
  calls: { n: 240, p50: 231, p95: 248, max: 251 },
  tris: { n: 240, p50: 2310000, p95: 2440000, max: 2470000 },
  frames: 240,
  ...over,
});
const fails = (out) => out.filter((e) => e.level === 'FAIL').map((e) => e.msg);

test('QUALITY_CLASS maps the ?quality= modes to the classes', () => {
  assert.deepEqual({ ...QUALITY_CLASS }, { ultra: 'XL', high: 'L', medium: 'M', low: 'S', potato: 'P' });
});

test('stats: the p95 index clamps to the last value', () => {
  assert.deepEqual(stats([7]), { n: 1, p50: 7, p95: 7, max: 7 });
  const v = Array.from({ length: 240 }, (_, i) => 240 - i); // 240 .. 1, unsorted order
  const s = stats(v);
  assert.equal(s.n, 240);
  assert.equal(s.p50, 121); // sorted[120]
  assert.equal(s.p95, 229); // sorted[floor(240 * 0.95)] = sorted[228]
  assert.equal(s.max, 240);
  assert.deepEqual(stats([]), { n: 0, p50: null, p95: null, max: null });
});

test('angleDiff wraps across ±π', () => {
  assert.ok(Math.abs(angleDiff(Math.PI - 0.01, -Math.PI + 0.01) - -0.02) < 1e-9);
  assert.ok(Math.abs(angleDiff(-Math.PI + 0.01, Math.PI - 0.01) - 0.02) < 1e-9);
  assert.ok(Math.abs(angleDiff(0.3, 0.1) - 0.2) < 1e-9);
  assert.ok(Math.abs(angleDiff(4 * Math.PI, 0)) < 1e-9);
});

test('spread: odd and even n', () => {
  assert.equal(spread([100, 102, 101]), 2 / 101);
  assert.equal(spread([100, 104, 101, 102]), 4 / 101.5);
  assert.equal(spread([5]), 0);
  assert.equal(spread([]), null);
});

test('judge: a passing run gives one ok summary line with the exact text', () => {
  const out = judge(runOf(), walkOf(), { record: false, tag: 'desktop' });
  assert.deepEqual(out, [{
    level: 'ok',
    msg: 'budget desktop: calls p50 231 p95 248 max 251 (limit 300, 83 %); triangles p50 2.31 M p95 2.44 M max 2.47 M (limit 3.00 M, 81 %); class XL, governor 0, drift 0.0 m, tiles on, ANGLE (Apple M1 Max)',
  }]);
});

test('judge: a fault ends the verdict after the page-error row', () => {
  const out = judge(runOf({ fault: 'budget desktop: start moved 10.0 m, 0.000 rad (limit 2 m, 0.02 rad)', errors: ['boom', 'bang'], cls: 'M', calls: null, tris: null }), walkOf(), { tag: 'desktop' });
  assert.deepEqual(out, [
    { level: 'FAIL', msg: 'budget desktop: start moved 10.0 m, 0.000 rad (limit 2 m, 0.02 rad)' },
    { level: 'FAIL', msg: 'budget desktop: page error (2): boom' },
  ]);
});

test('judge: a class mismatch FAILs and the summary turns info', () => {
  const out = judge(runOf({ cls: 'L' }), walkOf(), { tag: 'desktop' });
  assert.deepEqual(fails(out), ['budget desktop: class L, not the pinned XL']);
  assert.equal(out.at(-1).level, 'info');
});

test('judge: null limits give only the rule 4 FAIL, and "(limit not set)"', () => {
  const walk = walkOf({ probe: { start: null }, desktop: { calls: null, tris: null, minCalls: null, minTris: null } });
  const out = judge(runOf(), walk, { tag: 'desktop' });
  assert.deepEqual(fails(out), ['budget desktop: budget not set (null: probe.start, calls, tris, minCalls, minTris)']);
  assert.equal(out.at(-1).level, 'info');
  assert.match(out.at(-1).msg, /calls p50 231 p95 248 max 251 \(limit not set\); triangles .* \(limit not set\);/);
});

test('judge: record mode skips rules 4 to 6 and adds the start', () => {
  const walk = walkOf({ probe: { start: null }, desktop: { calls: 1, tris: 1, minCalls: 1e9, minTris: 1e12 } });
  const out = judge(runOf(), walk, { record: true, tag: 'desktop run 1/5' });
  assert.equal(out.length, 1);
  assert.equal(out[0].level, 'ok');
  assert.match(out[0].msg, /^budget desktop run 1\/5: /);
  assert.match(out[0].msg, /, start x 10\.000 z -5\.000 yaw 1\.5708$/);
});

test('judge: limit and floor FAILs, exact strings, one line per metric', () => {
  const tight = judge(runOf(), walkOf({ desktop: { calls: 240, tris: 2400000 } }), { tag: 'desktop' });
  assert.deepEqual(fails(tight), [
    'budget desktop: calls p95 248 > limit 240',
    'budget desktop: triangles p95 2.44 M > limit 2.40 M',
  ]);
  const floor = judge(runOf(), walkOf({ desktop: { minCalls: 300, minTris: 2500000 } }), { tag: 'desktop' });
  assert.deepEqual(fails(floor), [
    'budget desktop: scene is broken (calls p50 231 < floor 300)',
    'budget desktop: scene is broken (triangles p50 2.31 M < floor 2.50 M)',
  ]);
  assert.equal(floor.at(-1).level, 'info');
});

test('judge: a page error alone FAILs with the first error', () => {
  const out = judge(runOf({ errors: ['TypeError: x is undefined'] }), walkOf(), { tag: 'phone' });
  assert.deepEqual(fails(out), ['budget phone: page error (1): TypeError: x is undefined']);
});

const fiveRuns = (profile, want, calls95, tris95, calls50 = 200, tris50 = 2000000) =>
  calls95.map((c, i) => runOf({ profile, want, cls: want, calls: { n: 240, p50: calls50 + i, p95: c, max: c + 1 }, tris: { n: 240, p50: tris50 + i * 1000, p95: tris95[i], max: tris95[i] } }));

test('computeLimits: rounding of limits and floors', () => {
  const runs = [
    ...fiveRuns('desktop', 'XL', [246, 247, 248, 247, 246], [2440000, 2441234, 2442000, 2440500, 2441000], 231, 2311111),
    ...fiveRuns('phone', 'S', [150, 150, 151, 150, 150], [1000001, 1000000, 1000000, 1000000, 1000000], 120, 900000),
  ];
  const r = computeLimits(runs, walkOf({ probe: { start: null } }));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.ok, { desktop: 5, phone: 5 });
  // ceil(1.2 * 248) = 298; 1.2 * 2442000 = 2930400 -> 2940000
  // floor(231 / 2) = 115; 2311111 / 2 = 1155555.5 -> 1150000
  assert.deepEqual(r.limits.desktop, { calls: 298, tris: 2940000, minCalls: 115, minTris: 1150000 });
  // ceil(1.2 * 151) = ceil(181.2) = 182; 1.2 * 1000001 -> 1210000; 1.2 * 1000000 is exact
  assert.deepEqual(r.limits.phone, { calls: 182, tris: 1210000, minCalls: 60, minTris: 450000 });
  assert.deepEqual(r.start, START); // the first ok desktop run
  assert.ok(Math.abs(r.spread.desktop.calls - 2 / 247) < 1e-12);
  // exact multiples stay put: 1.2 * 250 = 300
  const exact = computeLimits(fiveRuns('desktop', 'XL', [250, 250, 250, 250, 250], [2500000, 2500000, 2500000, 2500000, 2500000]), walkOf());
  assert.equal(exact.limits.desktop.calls, 300);
  assert.equal(exact.limits.desktop.tris, 3000000);
});

test('computeLimits: too few ok runs, and a run that is not ok is ignored', () => {
  const desk = fiveRuns('desktop', 'XL', [246, 247, 248, 247, 246], [2440000, 2441000, 2442000, 2440500, 2441000]);
  desk[1].fault = 'budget desktop run 2/5: walker pushed twice (drift 0.8 m, then 0.9 m)';
  desk[1].calls = { n: 240, p50: 900, p95: 999, max: 999 }; // would raise the limit if it counted
  desk[2].cls = 'L';
  const phone = fiveRuns('phone', 'S', [150, 150, 150, 150, 150], [1e6, 1e6, 1e6, 1e6, 1e6]);
  phone[0].errors = ['boom'];
  const r = computeLimits([...desk, ...phone], walkOf());
  assert.deepEqual(r.errors, ['record desktop: 3 of 5 runs ok', 'record phone: 4 of 5 runs ok']);
  assert.equal(r.limits.desktop.calls, Math.ceil(247 * 1.2));
  assert.deepEqual(r.ok, { desktop: 3, phone: 4 });
  const none = computeLimits(phone.map((x) => ({ ...x, fault: 'f' })), walkOf());
  assert.equal(none.limits.desktop, null);
  assert.equal(none.spread.phone, null);
  assert.ok(none.errors.includes('record desktop: 0 of 5 runs ok'));
});

test('computeLimits: a spread over 3 % is an error, one line per metric', () => {
  const runs = [
    ...fiveRuns('desktop', 'XL', [240, 250, 245, 245, 245], [2.40e6, 2.40e6, 2.40e6, 2.40e6, 2.50e6]),
    ...fiveRuns('phone', 'S', [150, 150, 150, 150, 150], [1e6, 1e6, 1e6, 1e6, 1e6]),
  ];
  const r = computeLimits(runs, walkOf());
  assert.deepEqual(r.errors, [
    'record desktop: spread of p95 calls 4.1 % > 3 %: probe not stable',
    'record desktop: spread of p95 triangles 4.2 % > 3 %: probe not stable',
  ]);
});

test('computeLimits: runs that disagree on the start', () => {
  const runs = [
    ...fiveRuns('desktop', 'XL', [246, 246, 246, 246, 246], [2.44e6, 2.44e6, 2.44e6, 2.44e6, 2.44e6]),
    ...fiveRuns('phone', 'S', [150, 150, 150, 150, 150], [1e6, 1e6, 1e6, 1e6, 1e6]),
  ];
  runs[3].pose = { x: START.x + 1, z: START.z, yaw: START.yaw }; // 4 m
  runs[7].pose = { x: START.x, z: START.z, yaw: START.yaw + 0.05 };
  const r = computeLimits(runs, walkOf({ probe: { start: null } }));
  assert.deepEqual(r.errors, ['record: runs disagree on the start (4.0 m, 0.050 rad)']);
  // with probe.start set, it is the reference
  const set = computeLimits(runs.map((x) => ({ ...x, pose: { ...START } })), walkOf({ probe: { start: { x: 0, z: 0, yaw: START.yaw } } }));
  assert.equal(set.start.x, 0);
  assert.match(set.errors[0], /^record: runs disagree on the start \(44\.7 m, 0\.000 rad\)$/);
});
