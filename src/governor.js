// Runtime governor v2: a closed loop on the p95 frame time.
//
// One integer, `pressure` (perf-classes.js MOVES), orders every quality knob
// from the least visible cut (dynamic resolution) to the most visible
// (effects off, no shadows). The loop moves that integer, nothing else:
//
//   - the signal is the 95th percentile of the frame interval over the last
//     2.5 s (never the mean: one stutter per second must count);
//   - over target for two evaluations in a row: pressure up, by more when far
//     over (a 2 s/frame device cannot wait 30 steps);
//   - well under target for 6 s: pressure down by one, but never back onto a
//     level that failed recently: each failure of a level doubles the time it
//     is closed (45 s, 90 s, ... 6 min), so the loop cannot oscillate;
//   - cool-downs after every change (the resize and the shader work after it
//     are part of the next measurement otherwise);
//   - a class that stays overloaded at high pressure is left for the class
//     below (thermal throttling, a weaker device than scored); a class below
//     the detected one is re-entered after a long calm spell;
//   - a hidden tab pauses the loop and clears the window.
//
// The module is pure: perf.js calls feed() every frame and passes `apply`.
// scripts/smoke-perf.mjs drives it with a synthetic load schedule.
import { CLASSES, MAX_PRESSURE, classDown, classUp, knobsFor } from './perf-classes.js';

export function createGovernor({
  cls,
  ceiling = cls, // the best class this device may use (detection or the user's pick)
  auto = true, // false: pressure moves, the class never does
  apply = () => {},
  log = () => {},
  tuning = {},
} = {}) {
  const T = {
    windowMs: 2500,
    minFrames: 8,
    evalMs: 500,
    overFactor: 1.05, // p95 above target * this counts as over
    underFactor: 0.7, // p95 below target * this counts as headroom
    overEvals: 2, // consecutive evaluations over target before a step (broad overload)
    hitchEvals: 12, // the same when only the tail is long (12 x 0.5 s: a 6 s flight with tiles landing does not count)
    underMs: 4000,
    coolDownMs: 3000,
    coolUpMs: 6000,
    badLockMs: 45000,
    badLockMaxMs: 360000,
    demoteAt: 18, // pressure at which a still overloaded class is left
    promoteCalmMs: 60000,
    promoteCooldownMs: 120000,
    stallMs: 400, // a single interval this long is a load hitch, not a rate: not sampled
    ...tuning,
  };
  const s = {
    cls,
    ceiling,
    pressure: 0,
    over: 0,
    underSince: 0,
    lastChange: -1e9,
    lastEval: 0,
    lastDemote: -1e9,
    calmSince: 0,
    paused: false,
    promotions: 0,
    demotions: 0,
    changes: [],
    window: [], // [t, dt]
    badUntil: new Array(MAX_PRESSURE + 2).fill(0),
    badCount: new Array(MAX_PRESSURE + 2).fill(0),
    p95: 0,
    p50: 0,
    frames: 0,
  };
  let targetMs = CLASSES[ceiling].targetMs;
  let knobs = knobsFor(s.cls, 0);

  const pct = (arr, p) => {
    const a = arr.slice().sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
  };
  const record = (t, why) => {
    s.changes.push({ t: Math.round(t), cls: s.cls, pressure: s.pressure, why });
    if (s.changes.length > 400) s.changes.shift();
  };
  function commit(t, why) {
    knobs = knobsFor(s.cls, s.pressure);
    s.lastChange = t;
    s.window.length = 0;
    s.over = 0;
    s.underSince = 0;
    record(t, why);
    log(`governor: ${why} -> class ${s.cls}, pressure ${s.pressure}`);
    apply(knobs, why);
  }

  return {
    state: s,
    get knobs() {
      return knobs;
    },
    get targetMs() {
      return targetMs;
    },
    // the display's own cadence (perf.js measures it): a 30 Hz power-saver
    // screen or a 120 Hz panel moves the target, not the quality
    setRefreshMs(ms) {
      s.refreshMs = ms;
    },
    setTargetFloor(ms) {
      s.targetFloor = ms;
    },
    // user pick or class change from outside; resets the loop
    force(clsNew, pressure = 0, t = 0) {
      s.cls = clsNew;
      s.pressure = Math.max(0, Math.min(MAX_PRESSURE, pressure));
      commit(t, 'forced');
    },
    setCeiling(c, autoMode) {
      s.ceiling = c;
      targetMs = CLASSES[c].targetMs;
      if (autoMode != null) auto = autoMode;
    },
    setHidden(hidden, t) {
      s.paused = hidden;
      s.window.length = 0;
      s.over = 0;
      s.underSince = 0;
      s.lastChange = hidden ? s.lastChange : t; // a cool-down after the tab returns
    },
    // t: ms on a monotonic clock; dt: this frame's interval in ms
    feed(t, dt) {
      if (s.paused) return;
      s.frames++;
      // a load hitch (a tile batch, a shader compile, a tab coming back) is an
      // outlier against the recent rate; a device that is slow all the time
      // has no outliers, so its 2 s frames are samples like any other
      const typical = s.window.length >= 5 ? pct(s.window.map((w) => w[1]), 50) : 0;
      const hitch = dt > T.stallMs && (dt > 5000 || (typical > 0 && dt > typical * 8));
      if (!hitch) s.window.push([t, dt]);
      // the last 2.5 s, but never fewer than the last 8 frames
      while (s.window.length > T.minFrames && t - s.window[0][0] > T.windowMs) s.window.shift();
      if (t - s.lastEval < T.evalMs) return;
      s.lastEval = t;
      if (t - s.lastChange < (s.lastDir > 0 ? T.coolDownMs : T.coolUpMs)) return;
      if (s.window.length < 3) return;
      if (s.window.length < T.minFrames && t - s.window[0][0] < T.windowMs * 0.8) return;
      const dts = s.window.map((w) => w[1]);
      s.p95 = pct(dts, 95);
      s.p50 = pct(dts, 50);
      // The goal belongs to the device, not to the class it has fallen to: it
      // is the detected class's target, and never tighter than the display can
      // deliver (a 60 Hz panel cannot show 12 ms frames, a power-saver 30 Hz
      // panel cannot show 20 ms frames). A frame train sitting on the refresh
      // interval is the best a capped display can report, so that counts as calm.
      const refresh = s.refreshMs || 1000 / 60;
      const target = Math.max(targetMs, s.targetFloor || 0, refresh * 1.15);
      const over = s.p95 > target * T.overFactor;
      const calm = s.p95 < Math.max(target * T.underFactor, refresh * 1.12);

      if (over) {
        s.underSince = 0;
        s.calmSince = 0;
        // Two kinds of overload. Broad: the median frame misses the refresh,
        // every frame is slow, and fewer pixels or less geometry cure it.
        // Hitchy: the median is fine and a few frames are long (tile batches
        // landing during a flight, a shader compile): cutting resolution does
        // not touch those, so only a long run of them counts.
        const broad = s.p50 > refresh * 1.25;
        if (++s.over < (broad ? T.overEvals : T.hitchEvals)) return;
        s.over = 0;
        // far over: step by more (a 2 s/frame device cannot take 28 single steps)
        const ratio = s.p95 / target;
        const step = ratio > 3 ? 6 : ratio > 1.8 ? 3 : ratio > 1.3 ? 2 : 1;
        // a level that failed is remembered: the loop will not come back to it soon
        const from = s.pressure;
        s.badCount[from]++;
        s.badUntil[from] = t + Math.min(T.badLockMaxMs, T.badLockMs * 2 ** (s.badCount[from] - 1));
        // still over at high pressure: this class is too much for the device
        // right now (thermal throttling, or a weaker device than scored)
        if (auto && from >= T.demoteAt && s.cls !== 'P') {
          s.cls = classDown(s.cls);
          s.pressure = Math.min(6, s.pressure);
          s.demotions++;
          s.lastDemote = t;
          s.lastDir = 1;
          s.badUntil.fill(0);
          s.badCount.fill(0);
          commit(t, 'demote');
          return;
        }
        if (s.pressure >= MAX_PRESSURE) return;
        s.pressure = Math.min(MAX_PRESSURE, s.pressure + step);
        s.lastDir = 1;
        commit(t, `over ${s.p95.toFixed(1)} ms > ${target} ms`);
        return;
      }

      s.over = 0;
      if (!calm) {
        s.underSince = 0;
        s.calmSince = 0;
        return;
      }
      if (!s.underSince) s.underSince = t;
      if (!s.calmSince) s.calmSince = t;
      // pressure down: sustained headroom, and not onto a recently failed level
      if (s.pressure > 0 && t - s.underSince >= T.underMs) {
        const to = s.pressure - 1;
        if (t < s.badUntil[to]) return;
        s.pressure = to;
        s.lastDir = -1;
        commit(t, `headroom ${s.p95.toFixed(1)} ms`);
        return;
      }
      // class up: only back toward the detected class, after a long calm
      if (auto && s.pressure === 0 && s.cls !== s.ceiling && t - s.calmSince >= T.promoteCalmMs && t - s.lastDemote >= T.promoteCooldownMs && s.promotions < 2) {
        s.cls = classUp(s.cls);
        s.pressure = 8;
        s.promotions++;
        s.lastDir = -1;
        commit(t, 'promote');
      }
    },
    // changes in the last minute, for the stats overlay and the oscillation test
    changesPerMinute(t) {
      return s.changes.filter((c) => t - c.t <= 60000).length;
    },
  };
}
