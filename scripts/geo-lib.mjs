// Shared helpers for the geodata scripts: Overpass client with mirror fallback,
// local metric projection, Douglas-Peucker, polygon area and minimum-area rectangle.
// Node 22, no dependencies.

// Every place-specific value comes from cities/<id>.json (--city <id>,
// default braga; see city-lib.mjs). Braga's config carries the historical
// grids, so its constants are exactly the old hard-coded ones.
import { CITY, DATA_DIR, dataPath, cachePath, dataRel, landmarksPath } from './city-lib.mjs';

export { CITY, DATA_DIR, dataPath, cachePath, dataRel, landmarksPath };
export const BBOX = CITY.core_bbox;
export const ORIGIN = CITY.origin;
export const WIDE_BBOX = CITY.wide_bbox;
export const USER_AGENT = CITY.userAgent;

// The core: the area the first load draws (roads.json, buildings.json,
// nature.json). The streamed tiles (scripts/fetch-tiles.mjs) cover the ring
// around it.
export const CORE_BBOX = BBOX;

// Tile grid of the streamed area. The core is an exact number of tiles
// (Braga: 11 x 6), so a tile is either all core (never written) or all
// outside it. A Braga tile is 0.13/11 deg lon x 0.055/6 deg lat: about
// 985 m x 1013 m. Tile (x, y): x counts east from the wide west edge, y
// north from the wide south edge. { dLon, dLat, ext, nx, ny, bbox, core }.
export const TILE_GRID = CITY.tileGrid;

// The terrain lattice (data/terrain.json): the core grid (Braga: 90 x 60)
// extended by whole steps (~121 m lon, ~103 m lat) past the tile grid.
export const TERRAIN_LATTICE = CITY.terrainLattice;

// maps.mail.ru answered last time; the others often return 504. Try it first.
export const MIRRORS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export const wait = ms => new Promise(res => setTimeout(res, ms));

// POST a query; cycle through mirrors for `rounds` rounds with growing back-off.
// `allowEmpty` lets a query legitimately return zero elements.
export async function overpass(query, { rounds = 4, allowEmpty = false, label = '' } = {}) {
  let lastErr;
  for (let round = 0; round < rounds; round++) {
    for (const url of MIRRORS) {
      try {
        console.log(`Overpass${label ? ' ' + label : ''}: ${url} (round ${round + 1})`);
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(240000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const text = await r.text();
        const j = JSON.parse(text);
        if (j.remark && /error|timed out|runtime/i.test(j.remark)) throw new Error(`remark: ${j.remark}`);
        if (!Array.isArray(j.elements)) throw new Error('no elements array');
        if (!allowEmpty && j.elements.length === 0) throw new Error('empty response');
        return j.elements;
      } catch (e) {
        lastErr = e;
        console.warn(`  failed: ${e.message}`);
        await wait(4000 * (round + 1));
      }
    }
  }
  throw new Error(`All Overpass mirrors failed: ${lastErr?.message}`);
}

// Local equirectangular projection in metres around ORIGIN. x = east, y = north.
export const M_LAT = 111320;
export const M_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
export const toXY = ([lat, lon]) => [(lon - ORIGIN.lon) * M_LON, (lat - ORIGIN.lat) * M_LAT];
export const toLL = ([x, y]) => [ORIGIN.lat + y / M_LAT, ORIGIN.lon + x / M_LON];
export const r5 = v => Math.round(v * 1e5) / 1e5;
export const r6 = v => Math.round(v * 1e6) / 1e6;

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// Iterative Douglas-Peucker on [lat,lon] points; tolerance in metres. Returns kept points.
export function simplify(pts, tol) {
  if (pts.length <= 3) return pts.slice();
  const xy = pts.map(toXY);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let max = 0, idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = segDist(xy[k], xy[i], xy[j]);
      if (d > max) { max = d; idx = k; }
    }
    if (max > tol && idx > 0) { keep[idx] = 1; stack.push([i, idx], [idx, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// Closed ring simplification: split at the farthest point so DP keeps the shape.
export function simplifyRing(ring, tol) {
  let pts = ring.slice();
  if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
  if (pts.length <= 3) return pts;
  const xy = pts.map(toXY);
  let far = 0, fd = -1;
  for (let i = 1; i < xy.length; i++) {
    const d = Math.hypot(xy[i][0] - xy[0][0], xy[i][1] - xy[0][1]);
    if (d > fd) { fd = d; far = i; }
  }
  const a = simplify(pts.slice(0, far + 1), tol);
  const b = simplify([...pts.slice(far), pts[0]], tol);
  const out = [...a, ...b.slice(1, -1)];
  return out.length >= 3 ? out : pts;
}

// Signed area in m² of a [lat,lon] ring (positive = counter-clockwise).
export function ringArea(ring) {
  const xy = ring.map(toXY);
  let a = 0;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) a += (xy[j][0] * xy[i][1] - xy[i][0] * xy[j][1]);
  return a / 2;
}

export function centroid(ring) {
  const xy = ring.map(toXY);
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
    const f = xy[j][0] * xy[i][1] - xy[i][0] * xy[j][1];
    a += f; cx += (xy[j][0] + xy[i][0]) * f; cy += (xy[j][1] + xy[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const m = xy.reduce((s, p) => [s[0] + p[0] / xy.length, s[1] + p[1] / xy.length], [0, 0]);
    return toLL(m);
  }
  return toLL([cx / (3 * a), cy / (3 * a)]);
}

function hull(xy) {
  const p = xy.map(q => q.slice()).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

// Minimum-area bounding rectangle (rotating calipers over hull edges).
// Returns bearing of the long side as a compass bearing in [0,180): 0 = north-south, 90 = east-west.
export function minAreaRect(pointsLL) {
  const h = hull(pointsLL.map(toXY));
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(ang), s = Math.sin(ang);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of h) {
      const u = p[0] * c + p[1] * s, v = -p[0] * s + p[1] * c;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) best = { area, ang, w: maxU - minU, h: maxV - minV };
  }
  if (!best) return { bearing: 0, long: 0, short: 0 };
  // Long axis direction as math angle (from +x, counter-clockwise).
  let axis = best.w >= best.h ? best.ang : best.ang + Math.PI / 2;
  // Convert to compass bearing (from north, clockwise), fold to [0,180).
  let bearing = (90 - (axis * 180) / Math.PI) % 180;
  if (bearing < 0) bearing += 180;
  if (bearing >= 179.95) bearing = 0;
  return { bearing: Math.round(bearing * 10) / 10, long: Math.max(best.w, best.h), short: Math.min(best.w, best.h) };
}

// Height from OSM tags. Returns {h, src} or null if no tag gives one.
export function tagHeight(tags = {}) {
  const num = v => {
    if (v == null) return NaN;
    const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/);
    if (!m) return NaN;
    let n = parseFloat(m[0]);
    if (/ft|'/.test(String(v))) n *= 0.3048;
    return n;
  };
  const h = num(tags.height) || num(tags['building:height']);
  if (h > 0) return { h: Math.round(h * 10) / 10, src: 'osm height tag' };
  const lv = num(tags['building:levels']);
  if (lv > 0) return { h: Math.round(lv * 3.2 * 10) / 10, src: 'osm building:levels×3.2' };
  return null;
}
