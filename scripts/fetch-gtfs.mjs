// Static GTFS of the city's operator -> <data dir>/gtfs/schedule.json
// (Braga: TUB, Transportes Urbanos de Braga -> data/gtfs/schedule.json)
//
//   node scripts/fetch-gtfs.mjs [--city <id>]            download the feed, then build
//   node scripts/fetch-gtfs.mjs [--city <id>] --offline  build from the cached zip
//   A city with no transit.gtfs_url in cities/<id>.json: prints "no GTFS feed" and exits 0.
//
// Braga source: https://www.tub.pt/developer/gtfs/feed/tub.zip, listed on
// dados.gov.pt («GTFS | Transportes Urbanos de Braga», licence "not
// specified"). The raw feed stays in data/.cache/gtfs/ (never shipped).
//
// Output (compact, loaded at run time by src/livebus.js):
//   routes:   [{ id, short, long, color }]           colour: hashed, the feed has none
//   shapes:   [[lat, lon, ...], ...]                 flat, 5 decimals, simplified to ~3 m
//   stops:    [[lat, lon, name], ...]
//   services: [{ id, days: 'MTWTF..' mask as 7 digits Mon..Sun }]
//   patterns: [{ r, sh, h, st: [stop idx], d: [m along shape], o: [s from start], trips: [[start s, service idx]] }]
// Trips with the same route, shape, headsign, stops and running times share
// one pattern, so only their start times are stored.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { CITY, dataPath, cachePath } from './city-lib.mjs';

// --city <id> picks the city (default braga); the feed comes from cities/<id>.json transit.gtfs_url.
const URL = CITY.transit?.gtfs_url;
if (!URL) {
  console.log(`no GTFS feed for ${CITY.id}`);
  process.exit(0);
}
const CACHE = cachePath('gtfs');
const OUT = dataPath('gtfs', 'schedule.json');
const offline = process.argv.includes('--offline');
const feedName = (CITY.transit.operator || 'feed').toLowerCase();

mkdirSync(CACHE, { recursive: true });
mkdirSync(dataPath('gtfs'), { recursive: true });
const zip = resolve(CACHE, `${feedName}.zip`);
if (!offline || !existsSync(zip)) {
  console.log(`[gtfs] downloading ${URL}`);
  const r = await fetch(URL);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${URL}`);
  writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
}
const dir = resolve(CACHE, feedName);
rmSync(dir, { recursive: true, force: true });
execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);

// ---- CSV (quoted fields, header names trimmed: shapes.txt has ", " separators)
function csv(name) {
  const text = readFileSync(resolve(dir, name), 'utf8').replace(/^﻿/, '');
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
  const head = rows.shift().map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const routesRaw = csv('routes.txt');
const tripsRaw = csv('trips.txt');
const stopsRaw = csv('stops.txt');
const timesRaw = csv('stop_times.txt');
const shapesRaw = csv('shapes.txt');
const calRaw = csv('calendar.txt');

// ---- geometry
// the map's own projection (src/geo.js, origin 41.5503 N): distances along a
// shape here equal the app's world lengths x 4 m
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

// shapes
const snapErr = []; // metres, every snapped stop (a quality report)
const shapePts = new Map();
for (const r of shapesRaw) {
  if (!shapePts.has(r.shape_id)) shapePts.set(r.shape_id, []);
  shapePts.get(r.shape_id).push([+r.shape_pt_sequence, +r.shape_pt_lat, +r.shape_pt_lon]);
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
  for (let k = 0; k < n; k++) snapErr.push(proj(stopXY[k], seg[k])[0]);
  const d = seg.map((s, k) => proj(stopXY[k], s)[1]);
  for (let k = 1; k < n; k++) d[k] = Math.max(d[k], d[k - 1]);
  return d.map((v) => Math.round(v));
}

// ---- routes, colours
const PALETTE = ['#e0a948', '#d9534f', '#3f8fd2', '#4caf7a', '#9b6bd3', '#e07b39', '#2bb3b1', '#c94f8a', '#8a9a3b', '#5a6fd6', '#d4b13f', '#3aa35e'];
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const routeIdx = new Map();
const routes = routesRaw.map((r, i) => {
  routeIdx.set(r.route_id, i);
  const color = r.route_color ? `#${r.route_color}` : PALETTE[hash(r.route_short_name || r.route_id) % PALETTE.length];
  return { id: r.route_id, short: r.route_short_name, long: r.route_long_name, color };
});

// ---- services
const serviceIdx = new Map();
const services = calRaw.map((c, i) => {
  serviceIdx.set(c.service_id, i);
  return { id: c.service_id, days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => c[d]).join(''), from: c.start_date, to: c.end_date };
});

// ---- stops
const stopById = new Map(stopsRaw.map((s) => [s.stop_id, s]));
const stopIdx = new Map();
const stops = [];
const useStop = (id) => {
  if (!stopIdx.has(id)) {
    const s = stopById.get(id);
    stopIdx.set(id, stops.length);
    stops.push([+(+s.stop_lat).toFixed(5), +(+s.stop_lon).toFixed(5), s.stop_name]);
  }
  return stopIdx.get(id);
};

// ---- trips -> patterns
const hms = (t) => {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
};
const timesByTrip = new Map();
for (const r of timesRaw) {
  if (!timesByTrip.has(r.trip_id)) timesByTrip.set(r.trip_id, []);
  timesByTrip.get(r.trip_id).push([+r.stop_sequence, r.stop_id, hms(r.departure_time || r.arrival_time)]);
}
const patterns = [];
const patternKey = new Map();
const snapCache = new Map();
let skipped = 0;
for (const t of tripsRaw) {
  const st = timesByTrip.get(t.trip_id);
  const sh = shapeIdx.get(t.shape_id);
  if (!st || st.length < 2 || sh === undefined || !serviceIdx.has(t.service_id) || !stopById.size) {
    skipped++;
    continue;
  }
  st.sort((a, b) => a[0] - b[0]);
  const start = st[0][2];
  const ids = st.map((x) => x[1]);
  const offs = st.map((x) => x[2] - start);
  const key = [t.route_id, sh, t.trip_headsign, ids.join('.'), offs.join('.')].join('|');
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
    p = { r: routeIdx.get(t.route_id), sh, h: t.trip_headsign, st: ids.map(useStop), d: snapCache.get(sk), o: offs, trips: [] };
    patternKey.set(key, p);
    patterns.push(p);
  }
  p.trips.push([start, serviceIdx.get(t.service_id)]);
}
for (const p of patterns) p.trips.sort((a, b) => a[0] - b[0]);

// drop shapes no pattern uses, and reindex
const used = [...new Set(patterns.map((p) => p.sh))].sort((a, b) => a - b);
const remap = new Map(used.map((s, i) => [s, i]));
for (const p of patterns) p.sh = remap.get(p.sh);

const out = {
  source: URL,
  catalogue: CITY.transit.catalogue,
  licence: 'not specified by the publisher (dados.gov.pt: "License Not Specified")',
  agency: `${CITY.transit.operator_long} (${CITY.transit.operator})`,
  timezone: CITY.timezone,
  built: new Date().toISOString().slice(0, 10),
  valid: services.length ? { from: services[0].from, to: services[0].to } : null,
  routes,
  services: services.map(({ id, days }) => ({ id, days })),
  stops,
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
  `[gtfs] ${routes.length} routes, ${patterns.length} patterns, ${trips} trips (${skipped} skipped), ${stops.length} stops, ${used.length} shapes -> ${OUT} (${(readFileSync(OUT).length / 1024).toFixed(0)} KB); stop snap distance median ${pct(0.5)} m, p95 ${pct(0.95)} m, max ${pct(1)} m`,
);
