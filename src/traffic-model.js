// Traffic by the clock: how many vehicles drive, and how fast.
//
//   - an hourly demand profile for weekdays and weekends (rush hours 08-09
//     and 17-19, quiet 01-05), read at the real Lisbon time in live mode
//     («Сейчас в Браге») or at the hour of the time-of-day preset;
//   - the vehicle count follows the demand, up to 600 at peak (300 on
//     phones); primary roads get a larger share, the main axes more still;
//   - on the main axes (Avenida da Liberdade, the EN 101, the A 11 / Circular
//     Sul approaches: data/traffic-axes.json) the flow slows at peak and
//     forms stop-and-go queues: a speed wave that travels against the flow,
//     and a queue before each junction;
//   - optional real flow: with a TomTom key (?tomtom=KEY once, or
//     localStorage.tomtomKey), 12 points on the axes are sampled every 2
//     minutes (Traffic Flow Segment Data) and the measured speed ratio
//     replaces the profile's guess. No key ships with the map.
//
// DOM-free apart from the opt-in key helper; update() runs once a second.
import { CITY } from './city.js';

// <data_dir>/traffic-axes.json (scripts/fetch-traffic-axes.mjs), set by
// main.js from loadData() before createTrafficModel() runs.
let AXES = null;
export function setTrafficAxes(doc) {
  AXES = doc && typeof doc === 'object' ? doc : null;
}

// Preset hours (the four time-of-day presets are looks, not clock times)
export const PRESET_HOUR = { morning: 8.5, day: 13, sunset: 19, night: 23.5 };

// share of the peak flow, hour by hour (value for hh:30)
const WEEKDAY = [0.1, 0.06, 0.04, 0.03, 0.04, 0.09, 0.26, 0.64, 0.98, 0.9, 0.62, 0.58, 0.66, 0.7, 0.6, 0.62, 0.76, 0.96, 1, 0.84, 0.58, 0.4, 0.27, 0.17];
const WEEKEND = [0.17, 0.11, 0.07, 0.05, 0.04, 0.05, 0.09, 0.17, 0.28, 0.4, 0.52, 0.6, 0.64, 0.58, 0.52, 0.52, 0.56, 0.6, 0.62, 0.56, 0.46, 0.36, 0.28, 0.21];

export function demandAt(hour, weekend) {
  const P = weekend ? WEEKEND : WEEKDAY;
  const h = (((hour - 0.5) % 24) + 24) % 24;
  const i = Math.floor(h);
  const u = h - i;
  return P[i] + (P[(i + 1) % 24] - P[i]) * u;
}

// Lisbon wall clock at an instant, into a reused record:
// { hour (fractional), secs (since midnight), weekday (0 Mon .. 6 Sun), ymd }
// (the city's zone, CITY.timezone: Europe/Lisbon for the Portuguese cities)
let clockFmt = null;
const WD = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
export function lisbonClock(date, out = { hour: 0, secs: 0, weekday: 0, ymd: 0 }) {
  clockFmt ||= new Intl.DateTimeFormat('en-GB', { timeZone: CITY.timezone || 'Europe/Lisbon', hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  let h = 0;
  let m = 0;
  let s = 0;
  let y = 0;
  let mo = 0;
  let d = 0;
  for (const p of clockFmt.formatToParts(date)) {
    if (p.type === 'hour') h = +p.value;
    else if (p.type === 'minute') m = +p.value;
    else if (p.type === 'second') s = +p.value;
    else if (p.type === 'weekday') out.weekday = WD[p.value] ?? 0;
    else if (p.type === 'year') y = +p.value;
    else if (p.type === 'month') mo = +p.value;
    else if (p.type === 'day') d = +p.value;
  }
  const ms = date.getMilliseconds() / 1000;
  out.secs = h * 3600 + m * 60 + s + ms;
  out.hour = out.secs / 3600;
  out.ymd = y * 10000 + mo * 100 + d;
  return out;
}

// ---- axes
export const AXIS_IDS = ['liberdade', 'n101', 'a11'];
// Segments in world units: [x0, z0, x1, z1] per segment, and the axis (1..3)
export function decodeAxes(project) {
  const seg = [];
  const ids = [];
  const ll = [];
  AXIS_IDS.forEach((id, k) => {
    const code = AXES?.axes?.[id];
    if (!code) return;
    // integers in 1e-4 deg from `base` (the old Braga file has none: 41.5 N, -8.5 E)
    const [bLat, bLon] = Array.isArray(AXES.base) ? AXES.base : [41.5, -8.5];
    for (const line of code.split(';')) {
      const pts = line.split(' ').map((q) => {
        const [a, b] = q.split(',');
        return [bLat + +a / 1e4, bLon + +b / 1e4];
      });
      ll.push({ axis: k + 1, pts });
      for (let i = 1; i < pts.length; i++) {
        const p = project(pts[i - 1][0], pts[i - 1][1]);
        const q = project(pts[i][0], pts[i][1]);
        seg.push(p.x, p.z, q.x, q.z);
        ids.push(k + 1);
      }
    }
  });
  return { seg: new Float32Array(seg), ids: new Uint8Array(ids), lines: ll };
}

// The axis a world point lies on (within r world units), or 0.
export function axisAt(axes, x, z, r) {
  const S = axes.seg;
  const r2 = r * r;
  let best = 0;
  let bd = r2;
  for (let i = 0, k = 0; i < S.length; i += 4, k++) {
    const ax = S[i];
    const az = S[i + 1];
    const dx = S[i + 2] - ax;
    const dz = S[i + 3] - az;
    const L = dx * dx + dz * dz || 1e-9;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L));
    const ex = x - ax - u * dx;
    const ez = z - az - u * dz;
    const d = ex * ex + ez * ez;
    if (d < bd) {
      bd = d;
      best = axes.ids[k];
    }
  }
  return best;
}

// ---- opt-in keys: ?param=KEY is moved into localStorage and removed from
// the address bar at once, so a shared link never carries it.
export function optInKey(param, storageKey) {
  let key = null;
  try {
    const url = new URL(location.href);
    const q = url.searchParams.get(param);
    if (q) {
      try {
        localStorage.setItem(storageKey, q);
      } catch {
        // storage blocked: the key lasts for this page only
      }
      url.searchParams.delete(param);
      history.replaceState(history.state, '', url.href);
      key = q;
    }
    key ||= localStorage.getItem(storageKey);
  } catch {
    // no storage, no key
  }
  return key && key.trim() ? key.trim() : null;
}

// ---- the model
const TOMTOM_EVERY = 120e3;
const TOMTOM_FRESH = 6 * 60e3;

export function createTrafficModel({ max, getNow, isLive, getPreset, project, mobile = false }) {
  const axes = decodeAxes(project);
  const clock = { hour: 0, secs: 0, weekday: 0, ymd: 0 };
  const st = {
    hour: 19,
    weekend: false,
    demand: 0.5,
    count: Math.round(max * 0.5),
    freeK: 1, // speed factor on the other streets
    primaryK: 1,
    axisK: 1, // speed factor on the main axes
    jam: 0, // stop-and-go amplitude on the axes, 0..1
    level: 'обычное движение',
    source: 'profile', // or 'tomtom'
    tomtom: null, // { ratio, points, at } when real flow is in use
    tomtomStatus: 'off',
  };
  const smooth = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  // TomTom (optional)
  const key = typeof location !== 'undefined' ? optInKey('tomtom', 'tomtomKey') : null;
  const samples = [];
  if (key) {
    // 12 points: 4 per axis, spread along the ways nearest the centre
    for (let a = 1; a <= 3; a++) {
      const pts = axes.lines.filter((l) => l.axis === a).flatMap((l) => l.pts);
      const near = pts
        .map((p) => ({ p, d: Math.hypot(p[0] - CITY.origin.lat, (p[1] - CITY.origin.lon) * 0.75) }))
        .filter((q) => q.d < 0.035)
        .sort((x, y) => x.d - y.d);
      const pick = near.length ? near : pts.map((p) => ({ p }));
      for (let k = 0; k < 4 && pick.length; k++) samples.push({ axis: a, p: pick[Math.floor((k * pick.length) / 4)].p });
    }
    st.tomtomStatus = 'waiting';
  }
  let lastTomTom = -Infinity;
  let tomtomBusy = false;
  async function pollTomTom() {
    if (tomtomBusy) return;
    tomtomBusy = true;
    lastTomTom = performance.now();
    try {
      const got = await Promise.all(
        samples.map(async (s) => {
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 8000);
          try {
            const r = await fetch(`https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=${s.p[0].toFixed(5)},${s.p[1].toFixed(5)}&unit=KMPH&key=${encodeURIComponent(key)}`, { signal: ctl.signal });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const f = (await r.json()).flowSegmentData;
            return f && f.freeFlowSpeed > 0 ? { axis: s.axis, ratio: Math.min(1.2, f.currentSpeed / f.freeFlowSpeed) } : null;
          } catch {
            return null;
          } finally {
            clearTimeout(timer);
          }
        }),
      );
      const ok = got.filter(Boolean);
      if (!ok.length) throw new Error('no segment answered');
      const ratio = ok.reduce((s, g) => s + g.ratio, 0) / ok.length;
      st.tomtom = { ratio, points: ok.length, at: Date.now() };
      st.tomtomStatus = `ok (${ok.length}/${samples.length} points)`;
    } catch (e) {
      st.tomtomStatus = `failed: ${e.message}`;
      // after a failure, wait 10 minutes (a bad key must not hammer the API)
      lastTomTom = performance.now() + 8 * 60e3;
      console.info(`[porto] TomTom traffic unavailable (${e.message}); the hourly profile drives the traffic`);
    } finally {
      tomtomBusy = false;
    }
  }

  let lastTick = -Infinity;
  function update(force = false) {
    const tNow = performance.now();
    if (key && isLive() && !document.hidden && tNow - lastTomTom > TOMTOM_EVERY) pollTomTom();
    if (!force && tNow - lastTick < 1000) return st;
    lastTick = tNow;
    lisbonClock(getNow(), clock);
    const live = isLive();
    st.hour = live ? clock.hour : PRESET_HOUR[getPreset()] ?? 19;
    st.weekend = clock.weekday >= 5;
    let demand = demandAt(st.hour, st.weekend);
    // congestion on the axes grows fast above 70 % of the peak flow
    let cong = smooth(0.62, 1, demand);
    const real = live && st.tomtom && Date.now() - st.tomtom.at < TOMTOM_FRESH ? st.tomtom : null;
    st.source = real ? 'tomtom' : 'profile';
    if (real) {
      // measured: speed ratio 1 = free flow; 0.4 = heavy congestion
      cong = smooth(0.92, 0.35, real.ratio);
      demand = Math.max(demand * 0.8, 0.25 + 0.75 * cong);
    }
    st.demand = demand;
    st.count = Math.max(Math.round(max * 0.06), Math.round(max * demand));
    st.axisK = real ? Math.max(0.2, Math.min(1, real.ratio)) : 1 - 0.55 * cong;
    st.jam = cong;
    st.primaryK = 1 - 0.3 * cong;
    st.freeK = 1 - 0.15 * smooth(0.5, 1, demand);
    st.level = cong > 0.6 ? 'час пик' : demand > 0.55 ? 'плотное движение' : demand > 0.25 ? 'обычное движение' : 'свободно';
    return st;
  }
  update(true);

  return {
    state: st,
    axes,
    update,
    clock,
    mobile,
    samples,
    get hasKey() {
      return !!key;
    },
  };
}
