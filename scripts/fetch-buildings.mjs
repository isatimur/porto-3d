// Fetch every OSM building footprint in the city's core bbox and write <data dir>/buildings.json.
// Node 22, no dependencies. Run after fetch-footprints.mjs (it reads <data dir>/footprints.json
// to exclude the landmark objects). Run: node scripts/fetch-buildings.mjs [--city <id>] [--dry-run]
// (default city: braga; see cities/<id>.json)
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CITY, BBOX, ORIGIN, overpass, wait, simplifyRing, ringArea, centroid, toXY, r5, tagHeight, dataPath, cachePath, dataRel } from './geo-lib.mjs';
import { osmExtras, HIST_M } from '../src/facades.js';

const OUT = dataPath('buildings.json');
const FOOT = dataPath('footprints.json');
const CACHE_DIR = cachePath();
const GRID = 3;
const TOL_M = 1;
const MAX_BYTES = 8 * 1024 * 1024;
const CENTRAL_R_M = 2000;
const SMALL_M2 = 25;

if (process.argv.includes('--dry-run')) {
  console.log(`city ${CITY.id}; data dir ${dataRel()}`);
  console.log('bbox', BBOX, 'origin', ORIGIN, `grid ${GRID}x${GRID}`);
  console.log(`out ${dataRel('buildings.json')}; footprints ${dataRel('footprints.json')}; cache ${dataRel('.cache')}/buildings-r<i>c<j>.json`);
  process.exit(0);
}

// ---- 1. Download a 3x3 grid of tiles (cached, so a re-run does not hit Overpass) ----
mkdirSync(CACHE_DIR, { recursive: true });
const tiles = [];
for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
  const s = BBOX.s + ((BBOX.n - BBOX.s) * i) / GRID, n = BBOX.s + ((BBOX.n - BBOX.s) * (i + 1)) / GRID;
  const w = BBOX.w + ((BBOX.e - BBOX.w) * j) / GRID, e = BBOX.w + ((BBOX.e - BBOX.w) * (j + 1)) / GRID;
  tiles.push({ name: `r${i}c${j}`, b: [s, w, n, e].map(v => v.toFixed(5)).join(',') });
}

const byKey = new Map(); // "w123" / "r456" -> element (dedup across tile borders)
for (const t of tiles) {
  const file = join(CACHE_DIR, `buildings-${t.name}.json`);
  let els;
  if (existsSync(file)) {
    els = JSON.parse(readFileSync(file, 'utf8'));
  } else {
    const q = `[out:json][timeout:180];(way["building"](${t.b});relation["building"]["type"="multipolygon"](${t.b}););out geom;`;
    els = await overpass(q, { label: t.name, allowEmpty: true });
    writeFileSync(file, JSON.stringify(els));
    await wait(2000);
  }
  for (const el of els) byKey.set(el.type[0] + el.id, el);
  console.log(`tile ${t.name}: ${els.length} elements (total unique ${byKey.size})`);
}

// ---- 2. Landmark exclusion list ----
const excludeIds = new Set();
const excludeOutlines = [];
if (existsSync(FOOT)) {
  const fp = JSON.parse(readFileSync(FOOT, 'utf8'));
  for (const v of Object.values(fp)) {
    for (const id of v.osm_ids || []) excludeIds.add(id);
    if (v.exclude_outline) excludeOutlines.push(v.outline.map(toXY));
  }
} else {
  console.warn(`WARNING: ${dataRel('footprints.json')} missing; landmarks are NOT excluded. Run fetch-footprints.mjs first.`);
}

function pointInPoly([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---- 3. Geometry: ways are rings; multipolygons keep outer rings, holes dropped ----
function joinRings(ways) {
  const rings = [];
  const open = ways.map(w => w.slice());
  while (open.length) {
    let cur = open.shift();
    let guard = 0;
    while ((cur[0][0] !== cur.at(-1)[0] || cur[0][1] !== cur.at(-1)[1]) && guard++ < 1000) {
      const end = cur.at(-1);
      const k = open.findIndex(o => (o[0][0] === end[0] && o[0][1] === end[1]) || (o.at(-1)[0] === end[0] && o.at(-1)[1] === end[1]));
      if (k < 0) break;
      const nxt = open.splice(k, 1)[0];
      cur = cur.concat(nxt[0][0] === end[0] && nxt[0][1] === end[1] ? nxt.slice(1) : nxt.reverse().slice(1));
    }
    if (cur.length >= 4) rings.push(cur);
  }
  return rings;
}

function ringsOf(el) {
  if (el.type === 'way') return el.geometry && el.geometry.length >= 4 ? [el.geometry.map(g => [g.lat, g.lon])] : [];
  const outers = (el.members || []).filter(m => m.type === 'way' && m.role !== 'inner' && m.geometry?.length >= 2)
    .map(m => m.geometry.map(g => [g.lat, g.lon]));
  return joinRings(outers);
}

const HOUSE = new Set(['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'residential', 'farm', 'yes', 'cabin', 'static_caravan']);
const SMALL = new Set(['garage', 'garages', 'shed', 'hut', 'carport', 'roof', 'kiosk', 'toilets', 'greenhouse']);
const KIND = {
  residential: ['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'residential', 'apartments', 'dormitory', 'farm', 'cabin', 'static_caravan'],
  commercial: ['commercial', 'retail', 'office', 'supermarket', 'hotel', 'kiosk', 'mall'],
  industrial: ['industrial', 'warehouse', 'factory', 'manufacture', 'hangar', 'storage_tank', 'service', 'barn', 'farm_auxiliary'],
  church: ['church', 'chapel', 'cathedral', 'basilica', 'religious', 'monastery', 'convent', 'mosque', 'temple', 'shrine', 'synagogue'],
  public: ['public', 'civic', 'government', 'school', 'university', 'college', 'hospital', 'kindergarten', 'townhall', 'train_station', 'transportation', 'stadium', 'sports_hall', 'sports_centre', 'museum', 'fire_station', 'library'],
};
const kindMap = new Map();
for (const [k, list] of Object.entries(KIND)) for (const v of list) kindMap.set(v, k);

const R_CENTRE = CENTRAL_R_M;
const all = [];
let excludedById = 0, excludedByOutline = 0, badGeom = 0;
for (const [key, el] of byKey) {
  if (excludeIds.has(key)) { excludedById++; continue; }
  const tags = el.tags || {};
  const bval = tags.building || 'yes';
  const th = tagHeight(tags);
  const h = th ? th.h : SMALL.has(bval) ? 3.5 : HOUSE.has(bval) ? 7 : 12;
  const k = kindMap.get(bval) || (tags.amenity === 'place_of_worship' ? 'church' : 'other');
  for (const ring of ringsOf(el)) {
    const c = centroid(ring);
    const cxy = toXY(c);
    if (excludeOutlines.some(p => pointInPoly(cxy, p))) { excludedByOutline++; continue; }
    const simp = simplifyRing(ring, TOL_M).map(([a, b]) => [r5(a), r5(b)]);
    const pts = simp.filter((p, i) => i === 0 || p[0] !== simp[i - 1][0] || p[1] !== simp[i - 1][1]);
    if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
    if (pts.length < 3) { badGeom++; continue; }
    const area = Math.abs(ringArea(ring));
    // roof:shape, roof:colour, building:colour, building:material,
    // roof:orientation, normalised (src/facades.js osmExtras)
    const ex = osmExtras(tags);
    all.push({ b: ex ? { p: pts, h, k, ...ex } : { p: pts, h, k }, area, dist: Math.hypot(cxy[0], cxy[1]) });
  }
}

// ---- 3b. Shop fronts: the walls that face a main street (and any street in
// the historic centre) get ground-floor shop openings (src/facades.js).
// b.s lists them as edge indices into b.p (edge i: p[i] -> p[i + 1]).
// The historic centre is cities/<id>.json ms_centre, else the origin.
const HIST = CITY.ms_centre || [ORIGIN.lat, ORIGIN.lon];
const histXY = toXY(HIST);
const ROADS = dataPath('roads.json');
const SHOP_MAIN = new Set(['primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'pedestrian', 'living_street']);
const SHOP_CENTRE = new Set(['residential', 'unclassified', 'service']);
let shopWalls = 0;
if (existsSync(ROADS)) {
  const roads = JSON.parse(readFileSync(ROADS, 'utf8'));
  const CELL = 50;
  const grid = new Map();
  for (const f of roads.features || []) {
    const hw = f.t?.hw;
    const main = SHOP_MAIN.has(hw);
    if (!main && !SHOP_CENTRE.has(hw)) continue;
    const xy = (f.pts || []).map(toXY);
    for (let i = 0; i + 1 < xy.length; i++) {
      const a = xy[i], c = xy[i + 1];
      const centre = Math.hypot((a[0] + c[0]) / 2 - histXY[0], (a[1] + c[1]) / 2 - histXY[1]) <= HIST_M;
      if (!main && !centre) continue;
      const seg = { a, c, reach: main ? 14 : 9 };
      const x0 = Math.floor(Math.min(a[0], c[0]) / CELL), x1 = Math.floor(Math.max(a[0], c[0]) / CELL);
      const y0 = Math.floor(Math.min(a[1], c[1]) / CELL), y1 = Math.floor(Math.max(a[1], c[1]) / CELL);
      for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
        const key = gx * 100003 + gy;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(seg);
      }
    }
  }
  const near = (x, y) => grid.get(Math.floor(x / CELL) * 100003 + Math.floor(y / CELL)) || [];
  for (const { b } of all) {
    if (b.k === 'industrial' || b.k === 'church') continue;
    const xy = b.p.map(toXY);
    const n = xy.length;
    let a2 = 0;
    for (let i = 0; i < n; i++) a2 += xy[i][0] * xy[(i + 1) % n][1] - xy[(i + 1) % n][0] * xy[i][1];
    const sgn = a2 >= 0 ? 1 : -1; // counter-clockwise (x east, y north): outward = (dy, -dx)
    const s = [];
    for (let i = 0; i < n; i++) {
      const p = xy[i], q = xy[(i + 1) % n];
      const dx = q[0] - p[0], dy = q[1] - p[1];
      const L = Math.hypot(dx, dy);
      if (L < 2.5) continue;
      const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
      const ox = (sgn * dy) / L, oy = (-sgn * dx) / L;
      let hit = false;
      for (const g of near(mx, my)) {
        const ex = g.c[0] - g.a[0], ey = g.c[1] - g.a[1];
        const EL = Math.hypot(ex, ey);
        if (EL < 1e-6) continue;
        if (Math.abs((dx * ex + dy * ey) / (L * EL)) < 0.8) continue; // not along the street
        const t = Math.max(0, Math.min(1, ((mx - g.a[0]) * ex + (my - g.a[1]) * ey) / (EL * EL)));
        const cx = g.a[0] + ex * t - mx, cy = g.a[1] + ey * t - my;
        const d = Math.hypot(cx, cy);
        if (d > g.reach || cx * ox + cy * oy <= 0) continue; // too far, or behind the wall
        hit = true;
        break;
      }
      if (hit) s.push(i);
    }
    if (s.length) {
      b.s = s;
      shopWalls += s.length;
    }
  }
} else {
  console.warn(`${dataRel('roads.json')} missing: no shop fronts (run fetch-roads.mjs first)`);
}

// ---- 4. Size budget: drop < 25 m² outside the central 2 km only if needed ----
// hist: the historic centre the facade zones count from (src/facades.js)
const build = list => JSON.stringify({ origin: ORIGIN, bbox: BBOX, hist: HIST, buildings: list.map(x => x.b) });
let kept = all, json = build(kept), dropped = 0;
if (json.length > MAX_BYTES) {
  kept = all.filter(x => !(x.area < SMALL_M2 && x.dist > R_CENTRE));
  dropped = all.length - kept.length;
  json = build(kept);
  console.log(`Size over 8 MB: dropped ${dropped} buildings < ${SMALL_M2} m² outside ${R_CENTRE} m`);
}
writeFileSync(OUT, json);
const kinds = {};
for (const x of kept) kinds[x.b.k] = (kinds[x.b.k] || 0) + 1;
console.log(`Wrote ${OUT}: ${kept.length} buildings, ${(json.length / 1024 / 1024).toFixed(2)} MB`);
console.log(`excluded landmark ids ${excludedById}, excluded inside landmark outlines ${excludedByOutline}, bad geometry ${badGeom}, dropped small ${dropped}`);
console.log('kinds', kinds);
const tagged = { r: 0, rc: 0, wc: 0, m: 0, ro: 0 };
for (const x of kept) for (const key of Object.keys(tagged)) if (x.b[key]) tagged[key]++;
console.log('OSM extras', tagged, `shop-front walls ${shopWalls} on ${kept.filter(x => x.b.s).length} buildings; hist centre ${HIST}`);
if (json.length > MAX_BYTES) console.warn('WARNING: file still larger than 8 MB');
