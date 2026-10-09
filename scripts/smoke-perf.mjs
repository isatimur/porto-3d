#!/usr/bin/env node
// Pure-logic checks for the quality system: GPU scoring and class pick, the
// monotone pressure ladder, and the governor against a synthetic load
// schedule (convergence, no oscillation, thermal demotion, recovery).
// No browser, no WebGL: runs in verify and in CI.
import { CLASSES, CLASS_ORDER, MAX_PRESSURE, classify, gpuScore, knobsFor, parseQuality } from '../src/perf-classes.js';
import { createGovernor } from '../src/governor.js';

let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    failed++;
    console.log(`FAIL  ${msg}`);
  }
};

// ------------------------------------------------------------------ classes
const cases = [
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, Unspecified Version)', { cores: 10, memoryGB: 8 }, 'XL'],
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', { cores: 8, memoryGB: 8 }, 'XL'],
  ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)', { cores: 16, memoryGB: 8 }, 'XL'],
  ['ANGLE (AMD, AMD Radeon RX 6600 Direct3D11, D3D11)', { cores: 12, memoryGB: 8 }, 'XL'],
  ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', { cores: 8, memoryGB: 8 }, 'L'],
  ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', { cores: 4, memoryGB: 8 }, 'M'],
  ['ANGLE (Intel, Intel(R) HD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', { cores: 4, memoryGB: 8 }, 'S'],
  ['ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D11 vs_5_0 ps_5_0, D3D11)', { cores: 4, memoryGB: 4 }, 'P'],
  ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', { cores: 8, memoryGB: 8 }, 'P'],
  ['llvmpipe (LLVM 15.0.7, 256 bits)', { cores: 8 }, 'P'],
  ['Apple GPU', { mobile: true, cores: 6, memoryGB: 4, screenW: 390, screenH: 844, dpr: 3 }, 'M'], // iPhone, Safari
  ['Apple GPU', { mobile: false, cores: 8, memoryGB: 8 }, 'L'], // Mac, Safari hides the chip
  ['ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)', { mobile: true, cores: 8, memoryGB: 8 }, 'M'],
  ['ANGLE (Qualcomm, Adreno (TM) 619, OpenGL ES 3.2)', { mobile: true, cores: 8, memoryGB: 4 }, 'S'],
  ['ANGLE (ARM, Mali-G52 MC2, OpenGL ES 3.2)', { mobile: true, cores: 8, memoryGB: 2 }, 'S'],
  ['ANGLE (ARM, Mali-G78, OpenGL ES 3.2)', { mobile: true, cores: 8, memoryGB: 6 }, 'M'],
  ['PowerVR Rogue GE8320', { mobile: true, cores: 8, memoryGB: 2 }, 'P'],
];
for (const [renderer, extra, want] of cases) {
  const r = classify({ renderer, ...extra });
  ok(r.cls === want, `classify ${renderer.slice(0, 60)} => ${r.cls} (${r.score}), wanted ${want}: ${r.reasons.join('; ')}`);
}
ok(gpuScore('').tag === 'no-info', 'empty renderer string is "no-info"');
ok(classify({ renderer: 'ANGLE (Apple, Apple M1, Metal)', cores: 8, lowPower: true }).score < classify({ renderer: 'ANGLE (Apple, Apple M1, Metal)', cores: 8 }).score, 'power saver lowers the score');
ok(parseQuality('high') === 'high' && parseQuality('XL') === 'ultra' && parseQuality('x') === null && parseQuality('potato') === 'potato', 'parseQuality');

// ------------------------------------------------------------------ ladder
for (const cls of CLASS_ORDER) {
  let prev = knobsFor(cls, 0);
  ok(prev.dpr === CLASSES[cls].dprCap && prev.post === CLASSES[cls].postLevel && prev.count === 1, `${cls}: pressure 0 is the class baseline`);
  for (let p = 1; p <= MAX_PRESSURE; p++) {
    const k = knobsFor(cls, p);
    ok(k.dpr <= prev.dpr + 1e-9, `${cls}: dpr never rises with pressure (p=${p})`);
    ok(k.shadow <= prev.shadow, `${cls}: shadow never rises (p=${p})`);
    ok(k.post >= prev.post, `${cls}: post level never drops (p=${p})`);
    ok(k.count <= prev.count && k.geo <= prev.geo + 1e-9 && k.radius <= prev.radius + 1e-9, `${cls}: counts, geo and radius never rise (p=${p})`);
    prev = k;
  }
}
ok(knobsFor('XL', MAX_PRESSURE).dpr >= 0.99 && knobsFor('XL', MAX_PRESSURE).dpr <= 1.01, 'XL at full pressure renders at 1x DPR (2 x 0.5)');

// ------------------------------------------------------------------ governor
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
// cost of one frame as a fraction of the demand at full quality: a fixed
// CPU part, a pixel-bound part that falls with res^2, a shadow and post part
function costFrac(k, cls) {
  const c = CLASSES[cls];
  const shadow = c.shadow ? 0.12 * (k.shadow / c.shadow) : 0;
  const post = 0.1 * (1 - k.post / 4);
  const counts = 0.18 * k.count * (k.radius / c.tileScale) ** 0.5 * (k.geo / c.geoK) ** 0.5;
  const pixels = 0.45 * (k.dpr / c.dprCap) ** 2;
  return 0.15 + pixels + shadow + post + counts;
}
function simulate({ cls, auto = true, schedule, seconds, refreshMs = 1000 / 60, seed = 7 }) {
  const rand = rng(seed);
  const log = [];
  let k;
  const gov = createGovernor({ cls, ceiling: cls, auto, apply: (kn) => (k = kn) });
  k = gov.knobs;
  let t = 0;
  let n = 0;
  const p95 = [];
  while (t < seconds * 1000) {
    const demand = schedule(t / 1000);
    const cost = demand * costFrac(k, gov.state.cls) * (0.94 + rand() * 0.12) * (rand() < 0.004 ? 3 : 1);
    const dt = Math.max(refreshMs, cost);
    t += dt;
    n++;
    gov.feed(t, dt);
    if (n % 30 === 0) log.push({ t, cls: gov.state.cls, pressure: gov.state.pressure, p95: gov.state.p95, cost });
  }
  return { gov, log, t };
}
const seg = (log, a, b) => log.filter((x) => x.t >= a * 1000 && x.t < b * 1000);
const maxOf = (rows, f) => rows.reduce((m, x) => Math.max(m, f(x)), -Infinity);
const changesIn = (gov, a, b) => gov.state.changes.filter((c) => c.t >= a * 1000 && c.t < b * 1000).length;

{
  // 1. light load: the loop must stay at pressure 0 and never touch anything
  const { gov } = simulate({ cls: 'XL', seconds: 120, schedule: () => 12 });
  ok(gov.state.changes.length === 0, `light load: no changes (got ${gov.state.changes.length})`);
}
{
  // 2. heavy load (2x the target at full quality), then calm: converge, then recover
  const demand = (s) => (s < 20 ? 14 : s < 140 ? 40 : 14);
  const { gov, log } = simulate({ cls: 'XL', seconds: 400, schedule: demand });
  const loaded = seg(log, 60, 140);
  ok(maxOf(loaded, (x) => x.p95) <= CLASSES.XL.targetMs * 1.4, `heavy load converges: p95 ${maxOf(loaded, (x) => x.p95).toFixed(1)} ms <= ${(CLASSES.XL.targetMs * 1.4).toFixed(1)} ms within 40 s`);
  ok(changesIn(gov, 60, 140) <= 8, `heavy load, settled: at most 8 changes in 80 s (got ${changesIn(gov, 60, 140)})`);
  const end = seg(log, 360, 400);
  ok(maxOf(end, (x) => x.pressure) <= 1, `calm after load: pressure back to 0..1 within 220 s (got ${maxOf(end, (x) => x.pressure)})`);
}
{
  // 3. a square wave around the target: the failed-level lock must stop the flapping
  const demand = (s) => (Math.floor(s / 10) % 2 ? 30 : 14);
  const { gov, log } = simulate({ cls: 'L', seconds: 600, schedule: demand });
  let worst = 0;
  for (let m = 0; m + 60 <= 600; m += 15) worst = Math.max(worst, changesIn(gov, m, m + 60));
  ok(worst <= 8, `square-wave load: at most 8 changes per minute (worst ${worst})`);
  const late = seg(log, 300, 600);
  ok(changesIn(gov, 300, 600) <= 20, `square-wave load, second half: at most 20 changes in 5 min (got ${changesIn(gov, 300, 600)})`);
  ok(gov.state.demotions <= 1, `square-wave load: at most one class demotion (got ${gov.state.demotions})`);
}
{
  // 4. thermal ramp: demand grows 14 -> 60 ms; the class must step down, p95 must stay bounded after
  const demand = (s) => (s < 60 ? 14 : Math.min(60, 14 + (s - 60) * 0.25));
  const { gov, log } = simulate({ cls: 'XL', seconds: 500, schedule: demand });
  ok(gov.state.demotions >= 1, `thermal ramp: class demoted at least once (got ${gov.state.demotions})`);
  const end = seg(log, 420, 500);
  ok(maxOf(end, (x) => x.p95) <= CLASSES[gov.state.cls].targetMs * 1.5, `thermal ramp: p95 ${maxOf(end, (x) => x.p95).toFixed(1)} ms holds after settling (class ${gov.state.cls})`);
}
{
  // 5. a device two orders of magnitude too slow (software GL): reach the floor quickly
  const { gov, log } = simulate({ cls: 'XL', seconds: 900, schedule: () => 1800 });
  ok(gov.state.cls === 'P' || gov.state.pressure >= 20, `potato-like load: class P or deep pressure (got ${gov.state.cls}/${gov.state.pressure})`);
  ok(changesIn(gov, 0, 900) <= 30, `potato-like load: at most 30 changes (got ${changesIn(gov, 0, 900)})`);
  void log;
}
{
  // 7. hitches only (tiles landing in a 5 s flight): the median is fine, so
  // cutting resolution would not help and must not happen
  const gov = createGovernor({ cls: 'XL', apply: () => {} });
  let t = 0;
  let n = 0;
  while (t < 40000) {
    const hitchy = t > 10000 && t < 15000 && n % 16 === 0;
    const dt = hitchy ? 70 : 16.7;
    t += dt;
    n++;
    gov.feed(t, dt);
  }
  ok(gov.state.changes.length === 0, `a 5 s run of hitches with a healthy median changes nothing (got ${gov.state.changes.length})`);
  // ... but a long run of them does count
  const gov2 = createGovernor({ cls: 'XL', apply: () => {} });
  t = 0;
  n = 0;
  while (t < 60000) {
    const dt = t > 10000 && n % 16 === 0 ? 70 : 16.7;
    t += dt;
    n++;
    gov2.feed(t, dt);
  }
  ok(gov2.state.changes.length >= 1, 'a minute of hitches does count');
}
{
  // 6. hidden tab: nothing is judged while hidden, and a cool-down follows
  const gov = createGovernor({ cls: 'XL', apply: () => {} });
  gov.setHidden(true, 1000);
  for (let t = 1000; t < 20000; t += 500) gov.feed(t, 500); // background-throttled frames
  ok(gov.state.changes.length === 0, 'hidden tab: no pressure change from throttled frames');
}

console.log(failed ? `\nsmoke-perf: ${failed} check(s) failed` : 'smoke-perf: all checks passed');
process.exit(failed ? 1 : 0);
