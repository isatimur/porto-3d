// Static GTFS of a city's transit operators -> <data dir>/gtfs/schedule.json
//
//   node scripts/fetch-gtfs.mjs [--city <id>]            download the feeds, then build
//   node scripts/fetch-gtfs.mjs [--city <id>] --offline  build from the cached zips
//
// A city configures its feeds in cities/<id>.json, either as a list
//
//   transit.gtfs_feeds: [{ key, url, operator, operator_long }, ...]
//
// or the single-feed shorthand `transit.gtfs_url`. A city with neither prints
// "no GTFS feed" and exits 0. With more than one feed the ids of every feed are
// namespaced ("<key>:<id>") so routes, stops and shapes can never collide.
//
// Porto: STCP + Metro do Porto, both published on dadosabertos.cm-porto.pt
// (opendata.porto.digital; CKAN, licence CCZero). The raw feeds stay in
// data/.cache/gtfs/ (never shipped).
//
// Output (compact, loaded at run time by src/livebus.js):
//   routes:   [{ id, short, long, color, type, feed }]   colour: from the feed when present
//   shapes:   [[lat, lon, ...], ...]                 flat, 5 decimals, simplified to ~3 m
//   stops:    [[lat, lon, name], ...]
//   services: [{ id, days: 'MTWTF..' mask as 7 digits Mon..Sun }]
//   patterns: [{ r, sh, h, st: [stop idx], d: [m along shape], o: [s from start], trips: [[start s, service idx]] }]
// Trips with the same route, shape, headsign, stops and running times share
// one pattern, so only their start times are stored.
//
// Services can come from calendar.txt (weekly rows) and/or calendar_dates.txt
// (explicit dates + exceptions). STCP ships an empty calendar.txt and puts all
// its services in calendar_dates.txt, so both are read: a weekly service uses
// its calendar row (holiday exceptions only widen the valid range), while a
// service defined only by dated exceptions is reduced to the weekdays it runs.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { CITY, dataPath, cachePath } from './city-lib.mjs';

const slug = (s) => String(s || 'feed').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'feed';

// ---- the feeds: an explicit list, or the single-feed shorthand
const listed = Array.isArray(CITY.transit?.gtfs_feeds) ? CITY.transit.gtfs_feeds.filter((f) => f?.url) : [];
const single = CITY.transit?.gtfs_url
  ? [{ key: slug(CITY.transit.operator), url: CITY.transit.gtfs_url, operator: CITY.transit.operator, operator_long: CITY.transit.operator_long }]
  : [];
const FEEDS = (listed.length ? listed : single).map((f, i) => ({ ...f, key: slug(f.key || `feed${i + 1}`) }));
if (!FEEDS.length) {
  console.log(`no GTFS feed for ${CITY.id}`);
  process.exit(0);
}
// make keys unique (a collision would overwrite another feed's cache and ids)
const usedKeys = new Set();
for (const f of FEEDS) {
  while (usedKeys.has(f.key)) f.key = `${f.key}-${usedKeys.size}`;
  usedKeys.add(f.key);
}
const NS = FEEDS.length > 1;
const nsOf = (f) => (NS ? `${f.key}:` : '');

const offline = process.argv.includes('--offline');
const CACHE = cachePath('gtfs');
const OUT = dataPath('gtfs', 'schedule.json');
mkdirSync(CACHE, { recursive: true });
mkdirSync(dataPath('gtfs'), { recursive: true });

// ---- CSV (quoted fields, header names trimmed: shapes.txt has ", " separators)
function csv(dir, name) {
  const file = resolve(dir, name);
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        f += '"';
        i++;
      } else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(f);
      f = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f);
      f = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else f += c;
  }
  if (f !== '' || row.length) {
    row.push(f);
    rows.push(row);
  }
  if (!rows.length) return [];
  const head = rows.shift().map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

// ---- services: calendar.txt (weekly) + calendar_dates.txt (dated exceptions)
const DOW = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
// 'YYYYMMDD' -> 0 Mon .. 6 Sun
const weekdayOf = (ymd) => {
  const y = +ymd.slice(0, 4);
  const m = +ymd.slice(4, 6);
  const d = +ymd.slice(6, 8);
  if (!y || !m || !d) return -1;
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
};
const extend = (s, date) => {
  if (!date) return;
  if (!s.from || date < s.from) s.from = date;
  if (!s.to || date > s.to) s.to = date;
};
function buildServices(dir, ns) {
  const map = new Map();
  const ensure = (id) => {
    let s = map.get(id);
    if (!s) map.set(id, (s = { id, days: [0, 0, 0, 0, 0, 0, 0], from: null, to: null, weekly: false }));
    return s;
  };
  for (const c of csv(dir, 'calendar.txt')) {
    if (!c.service_id) continue;
    const s = ensure(ns + c.service_id);
    s.weekly = true;
    DOW.forEach((d, i) => {
      if (c[d] === '1') s.days[i] = 1;
    });
    extend(s, c.start_date);
    extend(s, c.end_date);
  }
  for (const c of csv(dir, 'calendar_dates.txt')) {
    if (!c.service_id || !c.date) continue;
    const s = ensure(ns + c.service_id);
    if (s.weekly) {
      // the weekly row already fixes the weekdays; a dated exception (a
      // holiday removal or a one-off) only widens the valid range here
      extend(s, c.date);
      continue;
    }
    const wd = weekdayOf(c.date);
    if (wd < 0) continue;
    if (c.exception_type === '1') s.days[wd] = 1;
    else if (c.exception_type === '2') s.days[wd] = 0;
    extend(s, c.date);
  }
  return [...map.values()].filter((s) => s.days.some(Boolean));
}

// ---- download + unzip each feed
for (const feed of FEEDS) {
  const zip = resolve(CACHE, `${feed.key}.zip`);
  if (!offline || !existsSync(zip)) {
    console.log(`[gtfs] downloading ${feed.operator || feed.key}: ${feed.url}`);
    const r = await fetch(feed.url, { headers: { 'User-Agent': CITY.userAgent } });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${feed.url}`);
    writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
  }
  if (!existsSync(zip) || statSync(zip).size === 0) throw new Error(`empty or missing GTFS zip for ${feed.key}: ${zip}`);
  const dir = resolve(CACHE, feed.key);
  rmSync(dir, { recursive: true, force: true });
  execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
  feed.dir = dir;
}

const parsed = FEEDS.map((feed) => ({
  ...feed,
  ns: nsOf(feed),
  routes: csv(feed.dir, 'routes.txt'),
  trips: csv(feed.dir, 'trips.txt'),
  stops: csv(feed.dir, 'stops.txt'),
  times: csv(feed.dir, 'stop_times.txt'),
  shapes: csv(feed.dir, 'shapes.txt'),
  services: buildServices(feed.dir, nsOf(feed)),
}));

// ---- geometry
// the map's own projection (src/geo.js, origin 41.5503 N for Braga; the active
// city's origin here): distances along a shape equal the app's world lengths x 4 m
const K = Math.cos((CITY.origin.lat * Math.PI) / 180) * 111320;
const toXY = (lat, lon) => [lon * K, lat * 110574];

function simplify(pts, tol) {
  // Douglas-Peucker on local metres
  const xy = pts.map((p) => toXY(p[0], p[1]));
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1;
    let bd = tol;
    const [ax, ay] = xy[a];
    const [bx, by] = xy[b];
    const dx = bx - ax;
    const dy = by - ay;
    const L2 = dx * dx + dy * dy || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      const u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
      const d = Math.hypot(px - ax - u * dx, py - ay - u * dy);
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// shapes, from every feed
const snapErr = []; // metres, every snapped stop (a quality report)
const shapePts = new Map();
for (const fd of parsed) {
  for (const r of fd.shapes) {
    const id = fd.ns + r.shape_id;
    if (!shapePts.has(id)) shapePts.set(id, []);
    shapePts.get(id).push([+r.shape_pt_sequence, +r.shape_pt_lat, +r.shape_pt_lon]);
  }
}
const shapeIdx = new Map();
const shapes = [];
const shapeGeo = []; // { xy, cum }
for (const [id, list] of shapePts) {
  list.sort((a, b) => a[0] - b[0]);
  const pts = simplify(
    list.map((p) => [p[1], p[2]]),
    3,
  ).map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)]);
  const xy = pts.map((p) => toXY(p[0], p[1]));
  const cum = [0];
  for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  shapeIdx.set(id, shapes.length);
  shapes.push(pts.flat());
  shapeGeo.push({ xy, cum });
}

// Stops snapped onto a shape, monotonic along it: a dynamic programme over
// (stop, segment) that minimises the total snap distance with the segment
// index never going back, so a looped shape keeps its order.
function snapStops(sh, stopXY) {
  const { xy, cum } = shapeGeo[sh];
  const m = xy.length - 1;
  const n = stopXY.length;
  if (m < 1) return stopXY.map(() => 0);
  const proj = (p, j) => {
    const [ax, ay] = xy[j];
    const [bx, by] = xy[j + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const L2 = dx * dx + dy * dy || 1e-9;
    const u = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2));
    return [Math.hypot(p[0] - ax - u * dx, p[1] - ay - u * dy), cum[j] + u * Math.sqrt(L2)];
  };
  const cost = [];
  const from = [];
  let prev = null;
  for (let k = 0; k < n; k++) {
    const c = new Float64Array(m);
    const f = new Int32Array(m);
    let bestPrev = Infinity;
    let bestJ = 0;
    for (let j = 0; j < m; j++) {
      if (prev && prev[j] < bestPrev) {
        bestPrev = prev[j];
        bestJ = j;
      }
      c[j] = proj(stopXY[k], j)[0] + (prev ? bestPrev : 0);
      f[j] = bestJ;
    }
    cost.push(c);
    from.push(f);
    prev = c;
  }
  let j = 0;
  for (let q = 1; q < m; q++) if (prev[q] < prev[j]) j = q;
  const seg = new Array(n);
  for (let k = n - 1; k >= 0; k--) {
    seg[k] = j;
    j = from[k][j];
  }
  let maxErr = 0;
  for (let k = 0; k < n; k++) {
    const e = proj(stopXY[k], seg[k])[0];
    snapErr.push(e);
    if (e > maxErr) maxErr = e;
  }
  const d = seg.map((s, k) => proj(stopXY[k], s)[1]);
  for (let k = 1; k < n; k++) d[k] = Math.max(d[k], d[k - 1]);
  return { d: d.map((v) => Math.round(v)), maxErr };
}

// ---- routes, colours
const PALETTE = ['#e0a948', '#d9534f', '#3f8fd2', '#4caf7a', '#9b6bd3', '#e07b39', '#2bb3b1', '#c94f8a', '#8a9a3b', '#5a6fd6', '#d4b13f', '#3aa35e'];
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const routeIdx = new Map();
const routes = [];
for (const fd of parsed) {
  for (const r of fd.routes) {
    const id = fd.ns + r.route_id;
    routeIdx.set(id, routes.length);
    const color = r.route_color ? `#${r.route_color}` : PALETTE[hash(r.route_short_name || r.route_id) % PALETTE.length];
    routes.push({ id, short: r.route_short_name, long: r.route_long_name, color, type: +r.route_type || 0, feed: fd.key });
  }
}

// ---- services, stops (across every feed)
const serviceIdx = new Map();
const services = [];
for (const fd of parsed) {
  for (const s of fd.services) {
    serviceIdx.set(s.id, services.length);
    services.push(s);
  }
}
const cleanName = (s) => {
  const ok = (v) => v && v !== '.';
  return ok(s.stop_name) ? s.stop_name : ok(s.stop_code) ? s.stop_code : ok(s.stop_id) ? s.stop_id : '';
};
const stopById = new Map();
for (const fd of parsed) {
  for (const s of fd.stops) stopById.set(fd.ns + s.stop_id, { ...s, _name: cleanName(s) });
}
const stopIdx = new Map();
const stops = [];
const useStop = (id) => {
  if (!stopIdx.has(id)) {
    const s = stopById.get(id);
    stopIdx.set(id, stops.length);
    stops.push([+(+s.stop_lat).toFixed(5), +(+s.stop_lon).toFixed(5), s._name]);
  }
  return stopIdx.get(id);
};

// ---- trips -> patterns
const hms = (t) => {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
};
const timesByTrip = new Map();
for (const fd of parsed) {
  for (const r of fd.times) {
    const id = fd.ns + r.trip_id;
    if (!timesByTrip.has(id)) timesByTrip.set(id, []);
    timesByTrip.get(id).push([+r.stop_sequence, fd.ns + r.stop_id, hms(r.departure_time || r.arrival_time)]);
  }
}
const patterns = [];
const patternKey = new Map();
const snapCache = new Map();
const SNAP_MAX = 600; // m: a stop this far off its shape is a broken feed pair
let skipped = 0;
let badSnap = 0;
for (const fd of parsed) {
  for (const t of fd.trips) {
    const tripId = fd.ns + t.trip_id;
    const st = timesByTrip.get(tripId);
    const sh = shapeIdx.get(fd.ns + t.shape_id);
    if (!st || st.length < 2 || sh === undefined || !serviceIdx.has(fd.ns + t.service_id) || !stopById.size) {
      skipped++;
      continue;
    }
    st.sort((a, b) => a[0] - b[0]);
    const start = st[0][2];
    const ids = st.map((x) => x[1]);
    const offs = st.map((x) => x[2] - start);
    const routeIdxV = routeIdx.get(fd.ns + t.route_id);
    const key = [routeIdxV, sh, t.trip_headsign, ids.join('.'), offs.join('.')].join('|');
    let p = patternKey.get(key);
    if (!p) {
      const sk = `${sh}|${ids.join('.')}`;
      if (!snapCache.has(sk)) {
        const xy = ids.map((id) => {
          const s = stopById.get(id);
          return toXY(+s.stop_lat, +s.stop_lon);
        });
        snapCache.set(sk, snapStops(sh, xy));
      }
      const snap = snapCache.get(sk);
      if (snap.maxErr > SNAP_MAX) {
        // a stop sits kilometres off the shape: a corrupt feed pair, not a route
        badSnap++;
        continue;
      }
      p = { r: routeIdxV, sh, h: t.trip_headsign, st: ids.map(useStop), d: snap.d, o: offs, trips: [] };
      patternKey.set(key, p);
      patterns.push(p);
    }
    p.trips.push([start, serviceIdx.get(fd.ns + t.service_id)]);
  }
}
for (const p of patterns) p.trips.sort((a, b) => a[0] - b[0]);

// Keep only the patterns that touch the city's transit bbox (cities/<id>.json
// transit.bbox): STCP and Metro reach far beyond Porto (Póvoa, Vila do Conde)
// and those vehicles are culled anyway. A pattern survives when any of its
// stops lies inside the box, so a route that merely crosses the city is kept.
const BB = CITY.transit?.bbox;
if (BB && patterns.length) {
  const inside = (la, lo) => la >= BB.s && la <= BB.n && lo >= BB.w && lo <= BB.e;
  const kept = patterns.filter((p) => p.st.some((si) => inside(stops[si][0], stops[si][1])));
  if (kept.length) {
    const dropped = patterns.length - kept.length;
    patterns.length = 0;
    patterns.push(...kept);
    console.log(`[gtfs] bbox ${BB.s},${BB.w}..${BB.n},${BB.e}: kept ${kept.length} patterns, dropped ${dropped}`);
  } else {
    console.warn(`[gtfs] bbox dropped every pattern; keeping the full schedule`);
  }
}

// drop unused routes, stops and services, and reindex
const rMap = new Map();
const sMap = new Map();
const vMap = new Map();
const outRoutes = [];
const outStops = [];
const outServices = [];
for (const p of patterns) {
  if (!rMap.has(p.r)) {
    rMap.set(p.r, outRoutes.length);
    outRoutes.push(routes[p.r]);
  }
  for (const si of p.st) {
    if (!sMap.has(si)) {
      sMap.set(si, outStops.length);
      outStops.push(stops[si]);
    }
  }
  for (const t of p.trips) {
    if (!vMap.has(t[1])) {
      vMap.set(t[1], outServices.length);
      outServices.push(services[t[1]]);
    }
  }
}
for (const p of patterns) {
  p.r = rMap.get(p.r);
  p.st = p.st.map((si) => sMap.get(si));
  p.trips = p.trips.map(([start, svc]) => [start, vMap.get(svc)]);
}

// drop shapes no pattern uses, and reindex
const used = [...new Set(patterns.map((p) => p.sh))].sort((a, b) => a - b);
const remap = new Map(used.map((s, i) => [s, i]));
for (const p of patterns) p.sh = remap.get(p.sh);

const validFrom = outServices.reduce((m, s) => (s.from && (!m || s.from < m) ? s.from : m), null);
const validTo = outServices.reduce((m, s) => (s.to && (!m || s.to > m) ? s.to : m), null);
const ymd = (d) => (d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null);

const source = FEEDS.map((f) => f.url).join('\n');
const agencies = FEEDS.map((f) => `${f.operator_long || f.operator || f.key}${f.operator && f.operator_long ? ` (${f.operator})` : ''}`).join(' + ');
const out = {
  source,
  catalogue: CITY.transit.catalogue || 'dadosabertos.cm-porto.pt',
  licence: 'CCZero (dadosabertos.cm-porto.pt)',
  agency: agencies,
  timezone: CITY.timezone,
  built: new Date().toISOString().slice(0, 10),
  valid: validFrom && validTo ? { from: ymd(validFrom), to: ymd(validTo) } : null,
  routes: outRoutes,
  services: outServices.map(({ id, days }) => ({ id, days: days.join('') })),
  stops: outStops,
  // delta-coded integers in 1e-5 degrees: [lat0, lon0, dlat1, dlon1, ...]
  shapeCoding: 'delta-1e5',
  shapes: used.map((s) => {
    const f = shapes[s].map((v) => Math.round(v * 1e5));
    const outS = [f[0], f[1]];
    for (let i = 2; i < f.length; i++) outS.push(f[i] - f[i - 2]);
    return outS;
  }),
  patterns,
};
writeFileSync(OUT, JSON.stringify(out));
const trips = patterns.reduce((s, p) => s + p.trips.length, 0);
snapErr.sort((a, b) => a - b);
const pct = (q) => snapErr[Math.min(snapErr.length - 1, Math.floor(q * snapErr.length))]?.toFixed(1);
console.log(
  `[gtfs] ${outRoutes.length} routes, ${patterns.length} patterns, ${trips} trips (${skipped} skipped, ${badSnap} bad-snap), ${outStops.length} stops, ${used.length} shapes -> ${OUT} (${(readFileSync(OUT).length / 1024).toFixed(0)} KB); stop snap distance median ${pct(0.5)} m, p95 ${pct(0.95)} m, max ${pct(1)} m`,
);
