// Walk frame budget (docs/specs/walk-budget.md): the pure rules and the page
// steps that scripts/check-walk.mjs uses to measure the draw calls and
// triangles of a walk frame at the /play start, with a fixed clock, a frozen
// governor and a settled scene.
//
// Engine-shared: the forks hold byte-identical copies (change Braga first).
// No imports: the page functions take a Playwright `page`, so `npm test`
// loads this file without a browser. The app object is found as
// window.__braga || window.__porto || window.__city.

// ?quality=<mode> pins this class (src/perf-classes.js QUALITY_MODES)
export const QUALITY_CLASS = Object.freeze({ ultra: 'XL', high: 'L', medium: 'M', low: 'S', potato: 'P' });

const STREET_MS = 60000; // the wait for walk.state.lanes > 0
const POLL_MS = 250; // settle(): one poll in the page
const SAMPLE_MS = 60000; // sampleFrames(): the longest sampling time
const START_M = 2; // start check: metres
const YAW_RAD = 0.02; // start and view checks: radians
const SPREAD_MAX = 0.03; // computeLimits(): the largest p95 spread

// { n, p50, p95, max } of a list of numbers; the index of Porto
// scripts/perf-page.js: min(n - 1, floor(n * p)) in the sorted list
export function stats(values) {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  if (!n) return { n: 0, p50: null, p95: null, max: null };
  const at = (p) => v[Math.min(n - 1, Math.floor(n * p))];
  return { n, p50: at(0.5), p95: at(0.95), max: v[n - 1] };
}

// the signed difference a - b of two angles, in -PI..PI
export function angleDiff(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

// (max - min) / median; the median of an even n is the mean of the two
// middle values. null for an empty list
export function spread(values) {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  if (!n) return null;
  const median = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  return (v[n - 1] - v[0]) / median;
}

const num = (x) => typeof x === 'number' && Number.isFinite(x);
const mtris = (t) => (t / 1e6).toFixed(2);
const share = (v, l) => Math.round((100 * v) / l);

// the summary line of a run (spec §4)
function summary(run, lim, record, tag) {
  const c = run.calls, t = run.tris;
  const cl = num(lim.calls) ? `limit ${lim.calls}, ${share(c.p95, lim.calls)} %` : 'limit not set';
  const tl = num(lim.tris) ? `limit ${mtris(lim.tris)} M, ${share(t.p95, lim.tris)} %` : 'limit not set';
  let s = `budget ${tag}: calls p50 ${c.p50} p95 ${c.p95} max ${c.max} (${cl}); ` +
    `triangles p50 ${mtris(t.p50)} M p95 ${mtris(t.p95)} M max ${mtris(t.max)} M (${tl}); ` +
    `class ${run.cls}, governor ${run.level}, drift ${num(run.drift) ? run.drift.toFixed(1) : '?'} m, ` +
    `tiles ${run.tiles ? 'on' : 'none'}, ${run.renderer || 'unknown renderer'}`;
  if (record && run.pose) s += `, start x ${run.pose.x.toFixed(3)} z ${run.pose.z.toFixed(3)} yaw ${run.pose.yaw.toFixed(4)}`;
  return s;
}

// The verdict on one run: [{ level: 'FAIL' | 'ok' | 'info', msg }], in the
// rule order of spec §4. Pure.
export function judge(run, walk, { record = false, tag = run.profile } = {}) {
  const out = [];
  const fail = (msg) => out.push({ level: 'FAIL', msg });
  const lim = walk?.[run.profile] || {};
  const errorsRow = () => {
    if (run.errors?.length) fail(`budget ${tag}: page error (${run.errors.length}): ${run.errors[0]}`);
  };
  // 1. a fault ends the verdict; only the page errors follow
  if (run.fault) {
    fail(run.fault);
    errorsRow();
    return out;
  }
  // 2. page errors
  errorsRow();
  // 3. the pinned class
  if (run.cls !== run.want) fail(`budget ${tag}: class ${run.cls}, not the pinned ${run.want}`);
  if (!record) {
    // 4. every value of the budget is set
    const missing = [];
    if (walk?.probe?.start == null) missing.push('probe.start');
    for (const k of ['calls', 'tris', 'minCalls', 'minTris']) if (!num(lim[k])) missing.push(k);
    if (missing.length) fail(`budget ${tag}: budget not set (null: ${missing.join(', ')})`);
    if (run.calls && run.tris) {
      // 5. the limits, on p95 (the shadow frame)
      if (num(lim.calls) && run.calls.p95 > lim.calls) fail(`budget ${tag}: calls p95 ${run.calls.p95} > limit ${lim.calls}`);
      if (num(lim.tris) && run.tris.p95 > lim.tris) fail(`budget ${tag}: triangles p95 ${mtris(run.tris.p95)} M > limit ${mtris(lim.tris)} M`);
      // 6. the floors, on p50: a scene that draws nothing
      if (num(lim.minCalls) && run.calls.p50 < lim.minCalls) fail(`budget ${tag}: scene is broken (calls p50 ${run.calls.p50} < floor ${lim.minCalls})`);
      if (num(lim.minTris) && run.tris.p50 < lim.minTris) fail(`budget ${tag}: scene is broken (triangles p50 ${mtris(run.tris.p50)} M < floor ${mtris(lim.minTris)} M)`);
    }
  }
  // 7. the summary line
  if (run.calls && run.tris) out.push({ level: out.length ? 'info' : 'ok', msg: summary(run, lim, record, tag) });
  return out;
}

const runOk = (r) => !r.fault && !(r.errors && r.errors.length) && r.cls === r.want;

// The limits proposed by --record (spec §5). Pure.
// { start, limits: { desktop, phone }, spread: { desktop: { calls, tris }, phone }, ok: { desktop, phone }, errors }
export function computeLimits(runs, walk) {
  const want = walk?.probe?.runs;
  const errors = [];
  const good = runs.filter(runOk);
  const of = (p) => good.filter((r) => r.profile === p);
  const ok = {}, limits = {}, spreads = {};
  for (const p of ['desktop', 'phone']) {
    const rs = of(p);
    ok[p] = rs.length;
    if (rs.length < want) errors.push(`record ${p}: ${rs.length} of ${want} runs ok`);
    if (!rs.length) {
      limits[p] = null;
      spreads[p] = null;
      continue;
    }
    const c95 = rs.map((r) => r.calls.p95), t95 = rs.map((r) => r.tris.p95);
    const c50 = rs.map((r) => r.calls.p50), t50 = rs.map((r) => r.tris.p50);
    spreads[p] = { calls: spread(c95), tris: spread(t95) };
    for (const [k, name] of [['calls', 'calls'], ['tris', 'triangles']]) {
      if (spreads[p][k] > SPREAD_MAX) errors.push(`record ${p}: spread of p95 ${name} ${(spreads[p][k] * 100).toFixed(1)} % > 3 %: probe not stable`);
    }
    // integer arithmetic: measured + 20 %, up; half the lowest p50, down
    limits[p] = {
      calls: Math.ceil((Math.max(...c95) * 12) / 10),
      tris: Math.ceil((Math.max(...t95) * 12) / 1e5) * 1e4,
      minCalls: Math.floor(Math.min(...c50) / 2),
      minTris: Math.floor(Math.min(...t50) / 2e4) * 1e4,
    };
  }
  let start = walk?.probe?.start ?? null;
  if (!start) {
    const first = of('desktop')[0] || of('phone')[0];
    start = first?.pose ? { ...first.pose } : null;
  }
  if (start) {
    let dMax = 0, aMax = 0;
    for (const r of good) {
      if (!r.pose) continue;
      dMax = Math.max(dMax, Math.hypot(r.pose.x - start.x, r.pose.z - start.z) * (r.metresPerUnit || 4));
      aMax = Math.max(aMax, Math.abs(angleDiff(r.pose.yaw, start.yaw)));
    }
    if (dMax > START_M || aMax > YAW_RAD) errors.push(`record: runs disagree on the start (${dMax.toFixed(1)} m, ${aMax.toFixed(3)} rad)`);
  }
  return { start, limits, spread: spreads, ok, errors };
}

// ------------------------------------------------------------ page steps
// Each returns { fault: '<text after "budget <tag>: ">' } on a fault.

const timedOut = (e) => e && (e.name === 'TimeoutError' || /Timeout \d+ms exceeded/.test(String(e.message)));

// §3 step 1: fixed clock, load, walk active, ready, street lanes built
export async function waitWalk(page, url, probe) {
  if (typeof page.clock?.setFixedTime !== 'function') return { fault: 'page.clock missing (playwright-core 1.45 or later needed)' };
  await page.clock.setFixedTime(new Date(probe.date));
  await page.goto(url, { waitUntil: 'load' });
  let lanesAtWalk;
  try {
    // Braga starts the walk before ready: take the lane count when it begins
    const h = await page.waitForFunction(() => {
      const A = window.__braga || window.__porto || window.__city;
      return A?.walk?.active ? { lanes: A.walk.state?.lanes ?? null } : false;
    }, null, { timeout: 240000, polling: 50 });
    lanesAtWalk = (await h.jsonValue()).lanes;
  } catch (e) {
    if (timedOut(e)) return { fault: 'walk not active in 240 s' };
    throw e;
  }
  try {
    await page.waitForFunction(() => (window.__braga || window.__porto || window.__city)?.ready === true, null, { timeout: 240000 });
  } catch (e) {
    if (timedOut(e)) return { fault: 'app not ready in 240 s' };
    throw e;
  }
  if (typeof lanesAtWalk !== 'number') return { lanesAtWalk: null }; // a fork without walk.state.lanes
  try {
    await page.waitForFunction(() => (window.__braga || window.__porto || window.__city).walk.state.lanes > 0, null, { timeout: STREET_MS, polling: 250 });
  } catch (e) {
    if (timedOut(e)) return { fault: `street layer not built in ${STREET_MS / 1000} s (walk.state.lanes 0)` };
    throw e;
  }
  return { lanesAtWalk };
}

// the walker's pose and the camera's yaw (the page has no THREE global: the
// Vector3 class comes from the camera; getWorldDirection updates the matrix)
export async function readPose(page) {
  return page.evaluate(() => {
    const A = window.__braga || window.__porto || window.__city;
    const p = A.walk.position;
    const cam = A.camera;
    const d = cam.getWorldDirection(new cam.position.constructor());
    return { x: p.x, z: p.z, yaw: p.yaw, camYaw: Math.atan2(d.x, -d.z), metresPerUnit: A.projection?.metresPerUnit || 4 };
  });
}

// §3 step 3: stub the feed, then force level 0, in one task. The stub, not
// gov.setHidden(): perf.js resets setHidden every frame.
export async function freezeGovernor(page) {
  return page.evaluate(() => {
    const A = window.__braga || window.__porto || window.__city;
    const P = A.perfSystem;
    if (!P?.gov) return { fault: 'no governor (perfSystem.gov missing)' };
    P.gov.feed = () => {};
    A.setGovernorLevel(0);
    const ch = P.gov.state.changes;
    return { cls: P.cls, level: A.governor?.level, lastT: ch.length ? ch[ch.length - 1].t : null, renderer: P.caps?.renderer || null };
  });
}

// §3 step 9: the governor's level and its last change
export async function readGovernor(page) {
  return page.evaluate(() => {
    const A = window.__braga || window.__porto || window.__city;
    const ch = A.perfSystem.gov.state.changes;
    const last = ch[ch.length - 1];
    return { level: A.governor?.level, lastT: last ? last.t : null, why: last ? last.why : 'none' };
  });
}

// §3 step 5: poll every 250 ms until calm polls cover quietMs, or timeoutMs.
// A poll is calm when geometries, textures and tile triangles did not change,
// frames advanced, no tile is pending, and every source has begun and no
// active wave. The first poll has nothing to compare with, so it is not calm.
// A poll with several causes stores the first, in the order of the spec's list.
export async function settle(page, { quietMs, timeoutMs }) {
  return page.evaluate(async ({ quietMs, timeoutMs, POLL_MS }) => {
    const A = window.__braga || window.__porto || window.__city;
    const mem = A.renderer.info.memory;
    const t0 = performance.now();
    let prev = null, lastBad = t0, cause = 'first poll';
    for (;;) {
      const now = performance.now();
      const cur = { g: mem.geometries, x: mem.textures, f: A.frames || 0 };
      if (A.tiles) {
        cur.p = A.tiles.stats.pending;
        cur.q = A.tiles.stats.tris;
      }
      const why = [];
      if (A.tiles && cur.p !== 0) why.push(`tiles pending ${cur.p}`);
      for (const [name, src] of [['tiles', A.tiles], ['ms', A.ms]]) {
        if (!src) continue;
        if (!src.begun) why.push(`${name} not begun`);
        else if (src.wave?.snapshot().active) why.push(`${name} wave active`);
      }
      if (!prev) why.push('first poll');
      else {
        if (cur.g !== prev.g) why.push(`geometries ${prev.g} to ${cur.g}`);
        if (cur.x !== prev.x) why.push(`textures ${prev.x} to ${cur.x}`);
        if (A.tiles && cur.q !== prev.q) why.push('tile triangles changed');
        if (cur.f <= prev.f) why.push('frames not advancing');
      }
      prev = cur;
      if (why.length) {
        lastBad = now;
        cause = why[0];
      } else if (now - lastBad >= quietMs) {
        return { settled: true, ms: Math.round(now - t0), geometries: cur.g, textures: cur.x, tiles: !!A.tiles, cause: null };
      }
      if (now - t0 >= timeoutMs) return { settled: false, ms: Math.round(now - t0), geometries: cur.g, textures: cur.x, tiles: !!A.tiles, cause };
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }, { quietMs, timeoutMs, POLL_MS });
}

// §3 step 7: one sample per drawn app frame (debug.frames changed), so a
// sample is a whole frame and the boot-view writes never count
export async function sampleFrames(page, { frames }) {
  const got = await page.evaluate(({ frames, SAMPLE_MS }) => new Promise((res) => {
    const A = window.__braga || window.__porto || window.__city;
    const out = [];
    let last = A.frames;
    const t0 = performance.now();
    const step = () => {
      if (A.frames !== last) {
        last = A.frames;
        out.push([A.calls, A.triangles]);
      }
      if (out.length >= frames || performance.now() - t0 > SAMPLE_MS) res(out);
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }), { frames, SAMPLE_MS });
  return { calls: stats(got.map((s) => s[0])), tris: stats(got.map((s) => s[1])), frames: got.length };
}
