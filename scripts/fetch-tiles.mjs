// Streamed tiles around the core: every OSM building, street and land-cover
// area of the city's wide bbox (Braga: about 20.7 x 18.4 km), cut into
// the 1 km tile grid of geo-lib.mjs (TILE_GRID), written as <data dir>/tiles/<x>_<y>.json
// plus <data dir>/tiles/index.json. The core (roads.json, buildings.json,
// nature.json) is exactly TILE_GRID.coreNx x coreNy tiles of this grid (Braga:
// 11 x 6) and is never written, so nothing doubles.
//
// Node 22, no dependencies. Run: node scripts/fetch-tiles.mjs [--city <id>] [--fetch | --build] [--only x_y,...] [--dry-run]
//   (default city: braga, see cities/<id>.json; default: fetch what is missing, then build)
// Paths below are for Braga; another city writes under its own data dir.
// Two phases:
//   fetch  per-tile Overpass queries (buildings, streets, rails, waterways;
//          bbox padded by ~300 m so long segments are not missed) and 8
//          area chunks (land cover, fetched per 7 x 6-tile chunk, so a large
//          wood that contains a whole tile is still found). Raw replies are
//          cached gzipped in data/.cache/tiles-raw/ with a manifest; a re-run
//          skips what is done. Concurrency 2, 3 mirrors, retries with backoff.
//   build  clip to the tile, simplify (buildings 1 m), round to 5 decimals,
//          delta-encode, keep each tile <= 600 KB (tolerance ladder), write
//          the tiles and the index.
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { cityArg } from './city-lib.mjs';
import { CITY, ORIGIN, CORE_BBOX, WIDE_BBOX, TILE_GRID, USER_AGENT, wait, simplify, simplifyRing, ringArea, tagHeight, toXY, dataPath, cachePath, dataRel } from './geo-lib.mjs';
import { osmExtras } from '../src/facades.js';

const OUT_DIR = dataPath('tiles');
const RAW_DIR = cachePath('tiles-raw');
const MANIFEST = join(RAW_DIR, 'manifest.json');
const args = process.argv.slice(2);
cityArg(args); // city-lib already chose the city; this only strips --city <id> from args
const DO_FETCH = !args.includes('--build');
const DO_BUILD = !args.includes('--fetch');
const ONLY = (() => {
  const i = args.indexOf('--only');
  return i >= 0 ? new Set(args[i + 1].split(',')) : null;
})();

const MIRRORS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const CONCURRENCY = 2;
const PAD = 0.003; // degrees around a tile for the line and building queries
const MAX_TILE_BYTES = 600 * 1024;
const G = TILE_GRID;

// ------------------------------------------------------------ grid
const tileBox = (x, y) => ({ s: G.bbox.s + y * G.dLat, w: G.bbox.w + x * G.dLon, n: G.bbox.s + (y + 1) * G.dLat, e: G.bbox.w + (x + 1) * G.dLon });
const isCoreTile = (x, y) => x >= G.core.x0 && x < G.core.x1 && y >= G.core.y0 && y < G.core.y1;
const TILES = [];
for (let y = 0; y < G.ny; y++) for (let x = 0; x < G.nx; x++) if (!isCoreTile(x, y)) TILES.push({ x, y, key: `${x}_${y}` });
// area chunks: blocks of 7 x 6 tiles (Braga: 3 x 3 blocks, the middle one is
// all core); the last block in a row or column may be smaller
const CHUNK_W = 7, CHUNK_H = 6;
const CHUNKS = [];
for (let cy = 0; cy < Math.ceil(G.ny / CHUNK_H); cy++) {
  for (let cx = 0; cx < Math.ceil(G.nx / CHUNK_W); cx++) {
    const x0 = cx * CHUNK_W, y0 = cy * CHUNK_H, x1 = Math.min(x0 + CHUNK_W, G.nx), y1 = Math.min(y0 + CHUNK_H, G.ny);
    let any = false;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (!isCoreTile(x, y)) any = true;
    if (!any) continue;
    const a = tileBox(x0, y0), b = tileBox(x1 - 1, y1 - 1);
    CHUNKS.push({ key: `areas-${cx}_${cy}`, box: { s: a.s, w: a.w, n: b.n, e: b.e } });
  }
}
if (args.includes('--dry-run')) {
  console.log(`city ${CITY.id}; data dir ${dataRel()}`);
  console.log('core bbox', CORE_BBOX, 'wide bbox', WIDE_BBOX, 'origin', ORIGIN);
  console.log(`tile grid ${G.nx}x${G.ny} (core ${G.coreNx}x${G.coreNy}, ext`, G.ext, `), ${TILES.length} tiles, ${CHUNKS.length} area chunks`);
  console.log(`out ${dataRel('tiles')}/; raw cache ${dataRel('.cache', 'tiles-raw')}/`);
  process.exit(0);
}
const f5 = (v) => v.toFixed(5);
const bstr = (b, pad = 0) => [b.s - pad, b.w - pad, b.n + pad, b.e + pad].map(f5).join(',');

// ------------------------------------------------------------ queries
const HIGHWAY = 'motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|residential|pedestrian|living_street|unclassified|service|track';
const lineQuery = (b) => `[out:json][timeout:180];
(
  way["building"](${b});
  relation["building"]["type"="multipolygon"](${b});
  way["highway"~"^(${HIGHWAY})$"](${b});
  way["railway"="rail"](${b});
  way["waterway"~"^(river|stream|canal)$"](${b});
);
out geom;`;
const AREA_FILTERS = [
  '["natural"~"^(wood|water|scrub|heath|grassland)$"]',
  '["landuse"~"^(forest|grass|meadow|orchard|vineyard|farmland|recreation_ground|village_green|reservoir|basin|residential|commercial|retail|industrial)$"]',
  '["leisure"~"^(park|garden|golf_course|nature_reserve)$"]',
  '["waterway"="riverbank"]',
  '["water"~"^(river|lake|pond|reservoir)$"]',
];
const areaQuery = (b) => `[out:json][timeout:300];
(
${AREA_FILTERS.map((f) => `  way${f}(${b});\n  relation["type"="multipolygon"]${f}(${b});`).join('\n')}
);
out geom;`;

// POST with mirror rotation and exponential backoff. Returns the elements.
let mirrorTurn = 0;
async function overpass(query, label) {
  let lastErr;
  for (let attempt = 0; attempt < 9; attempt++) {
    const url = MIRRORS[(mirrorTurn + attempt) % MIRRORS.length];
    const t0 = Date.now();
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(330000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = JSON.parse(await r.text());
      if (j.remark && /error|timed out|runtime|memory/i.test(j.remark)) throw new Error(`remark: ${j.remark.slice(0, 120)}`);
      if (!Array.isArray(j.elements)) throw new Error('no elements array');
      return { elements: j.elements, mirror: url, ms: Date.now() - t0, osmBase: j.osm3s?.timestamp_osm_base };
    } catch (e) {
      lastErr = e;
      // the mirror that failed goes to the back of the line for everyone
      if (MIRRORS[mirrorTurn % MIRRORS.length] === url) mirrorTurn++;
      const back = Math.min(120000, 3000 * 2 ** attempt);
      console.warn(`  ${label}: ${new URL(url).host} failed (${e.message}); retry in ${Math.round(back / 1000)} s`);
      await wait(back);
    }
  }
  throw new Error(`${label}: all mirrors failed: ${lastErr?.message}`);
}

// ------------------------------------------------------------ fetch phase
function loadManifest() {
  return existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { grid: null, done: {} };
}
const rawFile = (key) => join(RAW_DIR, `${key}.json.gz`);
const readRaw = (key) => JSON.parse(gunzipSync(readFileSync(rawFile(key))).toString('utf8'));

async function fetchAll() {
  mkdirSync(RAW_DIR, { recursive: true });
  const man = loadManifest();
  const gridKey = `${G.nx}x${G.ny}:${f5(G.bbox.s)},${f5(G.bbox.w)}`;
  if (man.grid !== gridKey) {
    man.grid = gridKey;
    man.done = {};
  }
  const save = () => writeFileSync(MANIFEST, JSON.stringify(man, null, 1));
  const jobs = [
    ...CHUNKS.map((c) => ({ key: c.key, q: areaQuery(bstr(c.box)) })),
    ...TILES.filter((t) => !ONLY || ONLY.has(t.key)).map((t) => ({ key: t.key, q: lineQuery(bstr(tileBox(t.x, t.y), PAD)) })),
  ].filter((j) => !(man.done[j.key]?.ok && existsSync(rawFile(j.key))));
  const total = CHUNKS.length + TILES.length;
  console.log(`fetch: ${jobs.length} queries to run (${total - jobs.length} of ${total} cached)`);
  let next = 0;
  let failed = 0;
  const t0 = Date.now();
  async function runner(id) {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        const res = await overpass(job.q, job.key);
        const gz = gzipSync(JSON.stringify(res.elements));
        writeFileSync(rawFile(job.key), gz);
        man.done[job.key] = { ok: true, elements: res.elements.length, gz: gz.length, ms: res.ms, mirror: new URL(res.mirror).host, osm: res.osmBase, at: new Date().toISOString() };
        save();
        const n = Object.values(man.done).filter((d) => d.ok).length;
        const rate = (Date.now() - t0) / 1000 / Math.max(1, n - (total - jobs.length));
        console.log(`[${id}] ${job.key}: ${res.elements.length} elements, ${(gz.length / 1024).toFixed(0)} KB gz, ${(res.ms / 1000).toFixed(1)} s via ${new URL(res.mirror).host}  (${n}/${total}, ~${Math.round(((total - n) * rate) / 60)} min left)`);
      } catch (e) {
        failed++;
        man.done[job.key] = { ok: false, error: e.message, at: new Date().toISOString() };
        save();
        console.error(`[${id}] ${job.key}: GAVE UP (${e.message})`);
      }
      await wait(1500);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => runner(i)));
  console.log(`fetch done: ${failed} failed`);
}

// ------------------------------------------------------------ geometry helpers
const inBox = (p, b) => p[0] >= b.s && p[0] <= b.n && p[1] >= b.w && p[1] <= b.e;
const insideCore = (p) => p[0] > CORE_BBOX.s && p[0] < CORE_BBOX.n && p[1] > CORE_BBOX.w && p[1] < CORE_BBOX.e;

// Liang-Barsky: the part of segment a-b inside box b, as [t0, t1] or null.
function clipSeg(a, c, b) {
  let t0 = 0, t1 = 1;
  const dy = c[0] - a[0], dx = c[1] - a[1];
  const tests = [[-dx, a[1] - b.w], [dx, b.e - a[1]], [-dy, a[0] - b.s], [dy, b.n - a[0]]];
  for (const [p, q] of tests) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
  }
  return t0 < t1 ? [t0, t1] : null;
}
const lerpP = (a, c, t) => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];

// A polyline clipped to box b: a list of polylines.
function clipLine(pts, b) {
  const out = [];
  let cur = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const r = clipSeg(pts[i], pts[i + 1], b);
    if (!r) {
      if (cur) out.push(cur), (cur = null);
      continue;
    }
    const p0 = r[0] > 0 ? lerpP(pts[i], pts[i + 1], r[0]) : pts[i];
    const p1 = r[1] < 1 ? lerpP(pts[i], pts[i + 1], r[1]) : pts[i + 1];
    if (!cur) cur = [p0];
    cur.push(p1);
    if (r[1] < 1) out.push(cur), (cur = null);
  }
  if (cur) out.push(cur);
  return out.filter((l) => l.length >= 2);
}

// Sutherland-Hodgman clip of an open ring against box b.
function clipRing(ring, b) {
  const cutLat = (a, c, lat) => [lat, a[1] + ((lat - a[0]) / (c[0] - a[0])) * (c[1] - a[1])];
  const cutLon = (a, c, lon) => [a[0] + ((lon - a[1]) / (c[1] - a[1])) * (c[0] - a[0]), lon];
  const edges = [
    [(p) => p[0] >= b.s, (a, c) => cutLat(a, c, b.s)],
    [(p) => p[0] <= b.n, (a, c) => cutLat(a, c, b.n)],
    [(p) => p[1] >= b.w, (a, c) => cutLon(a, c, b.w)],
    [(p) => p[1] <= b.e, (a, c) => cutLon(a, c, b.e)],
  ];
  let out = ring;
  for (const [inside, cut] of edges) {
    if (!out.length) break;
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i + input.length - 1) % input.length];
      const ci = inside(cur), pi = inside(prev);
      if (ci) {
        if (!pi) out.push(cut(prev, cur));
        out.push(cur);
      } else if (pi) out.push(cut(prev, cur));
    }
  }
  return out;
}

function pointInRing([lat, lon], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const EPS = 1e-7;
const same = (a, b) => Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS;
// Join way segments into closed rings; ways may run in either direction.
function assembleRings(segs) {
  const rings = [];
  const used = new Array(segs.length).fill(false);
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let ring = segs[i].pts.slice();
    const ids = [segs[i].id];
    while (ring.length < 2 || !same(ring[0], ring.at(-1))) {
      let found = false;
      for (let j = 0; j < segs.length; j++) {
        if (used[j]) continue;
        const s = segs[j].pts;
        if (same(ring.at(-1), s[0])) ring.push(...s.slice(1));
        else if (same(ring.at(-1), s.at(-1))) ring.push(...s.slice(0, -1).reverse());
        else if (same(ring[0], s.at(-1))) ring = s.slice(0, -1).concat(ring);
        else if (same(ring[0], s[0])) ring = s.slice(1).reverse().concat(ring);
        else continue;
        used[j] = true;
        ids.push(segs[j].id);
        found = true;
        break;
      }
      if (!found) break;
    }
    if (ring.length >= 4 && same(ring[0], ring.at(-1))) rings.push({ pts: ring.slice(0, -1), ids });
  }
  return rings;
}
const geomPts = (g) => (Array.isArray(g) && g.every((p) => p && Number.isFinite(p.lat)) ? g.map((p) => [p.lat, p.lon]) : null);

// ------------------------------------------------------------ classification
const BK = ['residential', 'commercial', 'industrial', 'church', 'public', 'other'];
const HOUSE = new Set(['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'residential', 'farm', 'yes', 'cabin', 'static_caravan']);
const SMALL = new Set(['garage', 'garages', 'shed', 'hut', 'carport', 'roof', 'kiosk', 'toilets', 'greenhouse']);
const BKIND = {
  residential: ['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'residential', 'apartments', 'dormitory', 'farm', 'cabin', 'static_caravan'],
  commercial: ['commercial', 'retail', 'office', 'supermarket', 'hotel', 'kiosk', 'mall'],
  industrial: ['industrial', 'warehouse', 'factory', 'manufacture', 'hangar', 'storage_tank', 'service', 'barn', 'farm_auxiliary'],
  church: ['church', 'chapel', 'cathedral', 'basilica', 'religious', 'monastery', 'convent', 'mosque', 'temple', 'shrine', 'synagogue'],
  public: ['public', 'civic', 'government', 'school', 'university', 'college', 'hospital', 'kindergarten', 'townhall', 'train_station', 'transportation', 'stadium', 'sports_hall', 'sports_centre', 'museum', 'fire_station', 'library'],
};
const bkindMap = new Map();
for (const [k, list] of Object.entries(BKIND)) for (const v of list) bkindMap.set(v, k);

// street kinds: the core's five (primary, secondary, minor, rail, water)
// plus service and track, drawn narrower
const RK = ['primary', 'secondary', 'minor', 'service', 'track', 'rail'];
const RKIND = {
  motorway: 0, trunk: 0, primary: 0, motorway_link: 0, trunk_link: 0, primary_link: 0,
  secondary: 1, tertiary: 1, secondary_link: 1, tertiary_link: 1,
  residential: 2, pedestrian: 2, living_street: 2, unclassified: 2,
  service: 3, track: 4,
};
const WATER_W = { river: 12, canal: 6, stream: 3 };
// Street records (tile format v2): [kind, hw, flags, ly, pts, j]
//   hw     index into HW (the OSM highway class, -1 for rail)
//   flags  RF_* bits: one way along / against pts, bridge, tunnel, roundabout,
//          arch bridge
//   ly     OSM layer (integer, 0 if none)
//   pts    [x0, y0, dx, dy, ...] as before
//   j      junctions: flat [pointIndex, nodeId, ...] (pointIndex counts the
//          points in pts). nodeId is dense over all tiles, shared by every
//          street through the same OSM node, as data/roads.json `j` (its own
//          numbering). Cut points on a tile edge carry none: match those by
//          position with the neighbour tile.
// A bridge or tunnel way is not clipped: it is written whole, in the one
// tile that holds its vertex centroid, and left out of the others, so its
// deck (or portals) can be built in one piece (src/tile-worker.js).
const HW = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'residential', 'pedestrian', 'living_street', 'unclassified', 'service', 'track'];
const RF_OW_FWD = 1, RF_OW_BACK = 2, RF_BRIDGE = 4, RF_TUNNEL = 8, RF_ROUNDABOUT = 16, RF_ARCH = 32;
function onewayOf(t) {
  const o = String(t.oneway ?? '').toLowerCase();
  if (o === 'yes' || o === 'true' || o === '1') return 1;
  if (o === '-1' || o === 'reverse') return -1;
  if (o === 'no' || o === 'false' || o === '0' || o === 'reversible' || o === 'alternating') return 0;
  if (t.highway === 'motorway' || t.highway === 'motorway_link') return 1;
  if (t.junction === 'roundabout' || t.junction === 'circular') return 1;
  return 0;
}
// same rules as scripts/fetch-roads.mjs tagsOf (br, tu, ly, ow, jn)
function roadFlags(t) {
  let f = 0;
  if (t.highway) {
    const ow = onewayOf(t);
    if (ow > 0) f |= RF_OW_FWD;
    else if (ow < 0) f |= RF_OW_BACK;
    if (t.junction === 'roundabout' || t.junction === 'circular') f |= RF_ROUNDABOUT;
  }
  if (t.bridge && t.bridge !== 'no') f |= RF_BRIDGE;
  if (t['bridge:structure'] === 'arch') f |= RF_ARCH;
  if (t.tunnel && t.tunnel !== 'no') f |= RF_TUNNEL;
  return f;
}
const layerOf = (t) => {
  const n = parseInt(String(t.layer ?? ''), 10);
  return Number.isFinite(n) ? Math.max(-5, Math.min(5, n)) : 0;
};
// the ways of a tile that have geometry and nodes, deduped by id across tiles
function* streetWays(elements) {
  for (const el of elements) {
    if (el.type !== 'way' || !el.tags?.highway || RKIND[el.tags.highway] == null || !el.nodes) continue;
    yield el;
  }
}

// area kinds: nature.json's nine plus built-up land (the ground's grey where
// OSM has the land use but not yet every house)
const AK = ['water', 'forest', 'scrub', 'park', 'garden', 'orchard', 'vineyard', 'grass', 'farmland', 'urban', 'industrial'];
function areaKind(t) {
  const has = new Set();
  if (t.natural === 'water' || t.landuse === 'reservoir' || t.landuse === 'basin' || t.waterway === 'riverbank' || t.water) has.add('water');
  if (t.natural === 'wood' || t.landuse === 'forest') has.add('forest');
  if (t.natural === 'scrub' || t.natural === 'heath') has.add('scrub');
  if (['park', 'nature_reserve', 'golf_course'].includes(t.leisure) || ['recreation_ground', 'village_green'].includes(t.landuse)) has.add('park');
  if (t.leisure === 'garden') has.add('garden');
  if (t.landuse === 'orchard') has.add('orchard');
  if (t.landuse === 'vineyard') has.add('vineyard');
  if (t.landuse === 'grass' || t.landuse === 'meadow' || t.natural === 'grassland') has.add('grass');
  if (t.landuse === 'farmland') has.add('farmland');
  if (t.landuse === 'residential' || t.landuse === 'commercial' || t.landuse === 'retail') has.add('urban');
  if (t.landuse === 'industrial') has.add('industrial');
  return AK.find((k) => has.has(k)) || null;
}
const COARSE = new Set(['forest', 'scrub', 'farmland', 'grass', 'orchard', 'vineyard', 'urban', 'industrial']);

// ------------------------------------------------------------ area polygons (all chunks)
function loadAreas() {
  const els = new Map();
  for (const c of CHUNKS) {
    if (!existsSync(rawFile(c.key))) {
      console.warn(`areas: chunk ${c.key} missing; its land cover is absent`);
      continue;
    }
    for (const el of readRaw(c.key)) els.set(el.type[0] + el.id, el);
  }
  const polys = [];
  const standalone = new Map();
  for (const el of els.values()) {
    if (el.type !== 'way') continue;
    const k = areaKind(el.tags || {});
    const pts = geomPts(el.geometry);
    if (!k || !pts || pts.length < 4) continue;
    if ((el.nodes && el.nodes[0] === el.nodes.at(-1)) || same(pts[0], pts.at(-1))) standalone.set(el.id, { k, pts: pts.slice(0, -1) });
  }
  const extraHoles = new Map();
  for (const el of els.values()) {
    if (el.type !== 'relation') continue;
    const k = areaKind(el.tags || {});
    if (!k) continue;
    const outerSegs = [], innerSegs = [];
    for (const m of el.members || []) {
      if (m.type !== 'way') continue;
      const pts = geomPts(m.geometry);
      if (!pts || pts.length < 2) continue;
      (m.role === 'inner' ? innerSegs : outerSegs).push({ id: m.ref, pts });
    }
    const outs = assembleRings(outerSegs).map((r) => ({ ...r, holes: [] }));
    for (const h of assembleRings(innerSegs)) {
      const o = outs.find((o) => pointInRing(h.pts[0], o.pts));
      if (o) o.holes.push(h.pts);
    }
    for (const o of outs) {
      // an outer ring that is one closed way with the same kind stays with the way
      if (o.ids.length === 1 && standalone.get(o.ids[0])?.k === k) {
        if (!extraHoles.has(o.ids[0])) extraHoles.set(o.ids[0], []);
        extraHoles.get(o.ids[0]).push(...o.holes);
        continue;
      }
      polys.push({ k, outer: o.pts, holes: o.holes });
    }
  }
  for (const [id, { k, pts }] of standalone) polys.push({ k, outer: pts, holes: extraHoles.get(id) || [] });
  for (const p of polys) {
    let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
    for (const [la, lo] of p.outer) {
      if (la < s) s = la;
      if (la > n) n = la;
      if (lo < w) w = lo;
      if (lo > e) e = lo;
    }
    p.box = { s, w, n, e };
  }
  console.log(`areas: ${polys.length} polygons from ${els.size} elements`);
  return polys;
}

// ------------------------------------------------------------ one tile
const B5 = 1e5;
const q5 = (v) => Math.round(v * B5);
// [lat, lon] points -> [x0, y0, dx, dy, ...] in 1e-5 deg, relative to the
// tile origin o (x: lon, y: lat); zero-length steps dropped
function enc(pts, o) {
  const out = [];
  let px = null, py = null;
  for (const [la, lo] of pts) {
    const x = q5(lo) - o[1];
    const y = q5(la) - o[0];
    if (px === null) out.push(x, y);
    else if (x !== px || y !== py) out.push(x - px, y - py);
    else continue;
    px = x;
    py = y;
  }
  return out;
}

// A street polyline as enc() does, plus its junctions: [pointIndex, nodeId]
// pairs for the points that idOf(p) knows. Points rounded onto the previous
// one are dropped; a junction moves onto the point that stays.
function encRoad(pts, o, idOf) {
  const e = [];
  const j = [];
  let px = null, py = null, n = 0;
  for (const p of pts) {
    const x = q5(p[1]) - o[1];
    const y = q5(p[0]) - o[0];
    const id = idOf(p);
    if (px === null) e.push(x, y);
    else if (x !== px || y !== py) e.push(x - px, y - py);
    else {
      if (id !== undefined) {
        if (j.length && j.at(-2) === n - 1) j[j.length - 1] = id;
        else j.push(n - 1, id);
      }
      continue;
    }
    if (id !== undefined) j.push(n, id);
    n++;
    px = x;
    py = y;
  }
  return { e, j };
}
// Douglas-Peucker that keeps every point `must` holds (the junction nodes,
// so the streets stay joined), piece by piece between them
function simplifyKeep(run, tol, must) {
  const keep = [0];
  for (let k = 1; k < run.length - 1; k++) if (must.has(run[k])) keep.push(k);
  keep.push(run.length - 1);
  const out = [];
  for (let s = 0; s + 1 < keep.length; s++) {
    const sub = simplify(run.slice(keep[s], keep[s + 1] + 1), tol);
    for (let m = s === 0 ? 0 : 1; m < sub.length; m++) out.push(sub[m]);
  }
  return out;
}
// Dense ids for the OSM nodes where street ways meet (2+ ways, or a way's
// end), over every raw tile, so the ids do not depend on --only.
function loadJunctions() {
  const use = new Map();
  const ends = new Set();
  const seenWay = new Set();
  for (const t of TILES) {
    if (!existsSync(rawFile(t.key))) continue;
    for (const el of streetWays(readRaw(t.key))) {
      if (seenWay.has(el.id)) continue;
      seenWay.add(el.id);
      const seen = new Set();
      for (const id of el.nodes) if (!seen.has(id)) (seen.add(id), use.set(id, (use.get(id) || 0) + 1));
      ends.add(el.nodes[0]);
      ends.add(el.nodes.at(-1));
    }
  }
  const dense = new Map();
  for (const [id, n] of use) if (n > 1 || ends.has(id)) dense.set(id, dense.size);
  return dense;
}

function buildTile(t, elements, areaPolys, level, junctions) {
  const box = tileBox(t.x, t.y);
  const o = [q5(box.s), q5(box.w)];
  const tol = [
    { road: 2, fine: 2, coarse: 5, minBld: 0, dropTrack: false },
    { road: 3, fine: 3, coarse: 8, minBld: 0, dropTrack: false },
    { road: 4, fine: 4, coarse: 12, minBld: 20, dropTrack: false },
    { road: 5, fine: 5, coarse: 16, minBld: 30, dropTrack: true },
  ][level];
  const out = { v: 2, x: t.x, y: t.y, bbox: [box.s, box.w, box.n, box.e].map(f5).map(Number), o, b: [], r: [], w: [], a: [] };
  const counts = { buildings: 0, lines: 0, water: 0, areas: 0, skippedCore: 0 };

  for (const el of elements) {
    const tags = el.tags || {};
    if (tags.building) {
      let rings = [];
      if (el.type === 'way') {
        const p = geomPts(el.geometry);
        if (p && p.length >= 4) rings = [p];
      } else {
        rings = assembleRings((el.members || []).filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry?.length >= 2).map((m) => ({ id: m.ref, pts: geomPts(m.geometry) })).filter((s) => s.pts)).map((r) => [...r.pts, r.pts[0]]);
      }
      for (const ring of rings) {
        // the core already has every building with a node inside its bbox
        if (ring.some(insideCore)) {
          counts.skippedCore++;
          continue;
        }
        const open = same(ring[0], ring.at(-1)) ? ring.slice(0, -1) : ring;
        let la = 0, lo = 0;
        for (const p of open) {
          la += p[0];
          lo += p[1];
        }
        la /= open.length;
        lo /= open.length;
        // one tile per building: the one with its vertex centroid
        if (!(la >= box.s && la < box.n && lo >= box.w && lo < box.e)) continue;
        const area = Math.abs(ringArea(open));
        if (area < 4 || area < tol.minBld) continue;
        const pts = simplifyRing(ring, 1);
        const e = enc(pts, o);
        if (e.length < 6) continue;
        const th = tagHeight(tags);
        const bval = tags.building;
        const h = th ? th.h : SMALL.has(bval) ? 3.5 : HOUSE.has(bval) ? 7 : 12;
        const k = bkindMap.get(bval) || (tags.amenity === 'place_of_worship' ? 'church' : 'other');
        out.b.push([Math.round(Math.min(h, 250) * 10), BK.indexOf(k), ...e]);
        counts.buildings++;
        // OSM roof and facade tags (src/facades.js osmExtras):
        // bx = [[index into b, roof shape, roof colour, wall colour, material, roof orientation], ...]
        const ex = osmExtras(tags);
        if (ex) (out.bx ||= []).push([out.b.length - 1, ex.r || 0, ex.rc || 0, ex.wc || 0, ex.m || 0, ex.ro || 0]);
      }
      continue;
    }
    if (el.type !== 'way') continue;
    const pts = geomPts(el.geometry);
    if (!pts || pts.length < 2) continue;
    let kind = -1;
    if (tags.railway === 'rail') kind = 5;
    else if (tags.highway && RKIND[tags.highway] != null) kind = RKIND[tags.highway];
    else if (WATER_W[tags.waterway]) {
      let w = WATER_W[tags.waterway];
      const tw = String(tags.width || '').trim();
      if (/^\d+(\.\d+)?$/.test(tw) && +tw >= 1 && +tw <= 60) w = +tw;
      for (const run of clipLine(pts, box)) {
        const s = simplify(run, tol.fine);
        const e = enc(s, o);
        if (e.length >= 4) {
          out.w.push([w, ...e]);
          counts.water++;
        }
      }
      continue;
    }
    if (kind < 0 || (tol.dropTrack && (kind === 3 || kind === 4))) continue;
    if (tags.area === 'yes') continue; // pedestrian squares drawn as outlines
    const flags = roadFlags(tags);
    const hw = tags.highway ? HW.indexOf(tags.highway) : -1;
    const ly = layerOf(tags);
    // the OSM node of each vertex, where it is a junction (highways only)
    const nodeOf = new Map();
    if (tags.highway && el.nodes?.length === pts.length) pts.forEach((p, i) => junctions.has(el.nodes[i]) && nodeOf.set(p, junctions.get(el.nodes[i])));
    const idOf = (p) => nodeOf.get(p);
    const structure = flags & (RF_BRIDGE | RF_TUNNEL);
    let runs;
    if (structure) {
      // whole, in the tile of its centroid (see the format note above)
      let la = 0, lo = 0;
      for (const p of pts) (la += p[0], lo += p[1]);
      la /= pts.length;
      lo /= pts.length;
      if (!(la >= box.s && la < box.n && lo >= box.w && lo < box.e)) continue;
      runs = [pts];
    } else runs = clipLine(pts, box);
    for (const run of runs) {
      const s = simplifyKeep(run, structure ? Math.min(tol.road, 2) : tol.road, nodeOf);
      const { e, j } = encRoad(s, o, idOf);
      if (e.length >= 4) {
        out.r.push([kind, hw, flags, ly, e, j]);
        counts.lines++;
      }
    }
  }

  for (const p of areaPolys) {
    if (p.box.n < box.s || p.box.s > box.n || p.box.e < box.w || p.box.w > box.e) continue;
    const t2 = COARSE.has(p.k) ? tol.coarse : tol.fine;
    const oc = clipRing(p.outer, box);
    if (oc.length < 3) continue;
    const os = oc.length > 4 ? simplifyRing(oc, t2) : oc;
    if (os.length < 3 || Math.abs(ringArea(os)) < (p.k === 'water' ? 50 : 200)) continue;
    const rings = [enc(os, o)];
    for (const h of p.holes) {
      const hc = clipRing(h, box);
      if (hc.length < 3) continue;
      const hs = hc.length > 4 ? simplifyRing(hc, t2) : hc;
      if (hs.length < 3 || Math.abs(ringArea(hs)) < 100) continue;
      rings.push(enc(hs, o));
    }
    if (rings[0].length < 6) continue;
    out.a.push([AK.indexOf(p.k), ...rings]);
    counts.areas++;
  }
  return { json: JSON.stringify(out), counts, level };
}

function buildAll() {
  mkdirSync(OUT_DIR, { recursive: true });
  const man = loadManifest();
  const areaPolys = loadAreas();
  const junctions = loadJunctions();
  console.log(`street junction nodes: ${junctions.size}`);
  const index = [];
  let total = 0;
  let missing = 0;
  const want = new Set();
  for (const t of TILES) {
    if (ONLY && !ONLY.has(t.key)) continue;
    if (!existsSync(rawFile(t.key))) {
      missing++;
      continue;
    }
    const els = readRaw(t.key);
    let res;
    for (let level = 0; level < 4; level++) {
      res = buildTile(t, els, areaPolys, level, junctions);
      if (res.json.length <= MAX_TILE_BYTES) break;
    }
    if (res.json.length > MAX_TILE_BYTES) console.warn(`${t.key}: ${(res.json.length / 1024).toFixed(0)} KB even at the coarsest level`);
    const empty = !res.counts.buildings && !res.counts.lines && !res.counts.areas && !res.counts.water;
    const file = join(OUT_DIR, `${t.key}.json`);
    if (empty) {
      if (existsSync(file)) unlinkSync(file);
      continue;
    }
    writeFileSync(file, res.json);
    want.add(`${t.key}.json`);
    const bytes = Buffer.byteLength(res.json);
    const gz = gzipSync(res.json).length;
    total += bytes;
    const box = tileBox(t.x, t.y);
    index.push({ x: t.x, y: t.y, bbox: [box.s, box.w, box.n, box.e].map((v) => +v.toFixed(6)), n: { b: res.counts.buildings, r: res.counts.lines, w: res.counts.water, a: res.counts.areas }, bytes, gz, lvl: res.level });
  }
  if (!ONLY) {
    // stale tiles of an older grid
    for (const f of readdirSync(OUT_DIR)) if (/^\d+_\d+\.json$/.test(f) && !want.has(f)) unlinkSync(join(OUT_DIR, f));
  }
  const fetched = TILES.filter((t) => man.done[t.key]?.ok).length;
  const doc = {
    v: 2,
    source: '© OpenStreetMap contributors, ODbL 1.0 (Overpass API)',
    fetched: Object.values(man.done).map((d) => d.osm).filter(Boolean).sort().at(-1) || null,
    origin: ORIGIN,
    core: CORE_BBOX,
    grid: { bbox: G.bbox, nx: G.nx, ny: G.ny, dLat: G.dLat, dLon: G.dLon, core: G.core },
    kinds: { b: BK, r: RK, a: AK, hw: HW },
    coverage: { tiles: TILES.length, fetched, written: index.length, pct: +((100 * fetched) / TILES.length).toFixed(1) },
    bytes: total,
    gz: index.reduce((s, t) => s + t.gz, 0),
    counts: index.reduce((s, t) => ({ b: s.b + t.n.b, r: s.r + t.n.r, w: s.w + t.n.w, a: s.a + t.n.a }), { b: 0, r: 0, w: 0, a: 0 }),
    tiles: index,
  };
  if (!ONLY) writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(doc));
  const big = index.reduce((m, t) => (t.bytes > m.bytes ? t : m), { bytes: 0 });
  console.log(`build: ${index.length} tiles written, ${(total / 1048576).toFixed(1)} MB (${(doc.gz / 1048576).toFixed(1)} MB gzip), largest ${big.x}_${big.y} ${(big.bytes / 1024).toFixed(0)} KB; ${missing} tiles without raw data; coverage ${doc.coverage.pct} %`);
  console.log('counts', doc.counts);
}

if (DO_FETCH) await fetchAll();
if (DO_BUILD) buildAll();
