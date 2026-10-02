// Fetch a city's nature areas (woods, water, parks, gardens, grass, farmland...) and waterway lines
// from OpenStreetMap (Overpass API) and write <data dir>/nature.json.
// Node 22, no dependencies. Run: node scripts/fetch-nature.mjs [--city <id>] [--refresh] [--dry-run]
// (default city: braga; see cities/<id>.json)
// The raw Overpass response is cached in <data dir>/.cache/nature-raw.json; --refresh refetches it.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CITY, BBOX, ORIGIN, USER_AGENT, dataPath, cachePath, dataRel } from './geo-lib.mjs';

const OUT = dataPath('nature.json');
const CACHE = cachePath('nature-raw.json');
const REFRESH = process.argv.includes('--refresh');
const MAX_BYTES = 3 * 1024 * 1024;

if (process.argv.includes('--dry-run')) {
  console.log(`city ${CITY.id}; data dir ${dataRel()}`);
  console.log('bbox', BBOX, 'origin', ORIGIN);
  console.log('hills', CITY.nature?.hills || []);
  console.log(`out ${dataRel('nature.json')}; cache ${dataRel('.cache', 'nature-raw.json')}`);
  process.exit(0);
}

const MIRRORS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const b = `${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}`;
const AREA_FILTERS = [
  '["natural"~"^(wood|water|scrub|heath|grassland)$"]',
  '["landuse"~"^(forest|grass|meadow|orchard|vineyard|farmland|recreation_ground|village_green|reservoir|basin)$"]',
  '["leisure"~"^(park|garden|golf_course|nature_reserve)$"]',
  '["waterway"="riverbank"]',
  '["water"~"^(river|lake|pond|reservoir)$"]',
];
const QUERY = `[out:json][timeout:180];
(
${AREA_FILTERS.map(f => `  way${f}(${b});\n  relation["type"="multipolygon"]${f}(${b});`).join('\n')}
  way["waterway"~"^(river|stream|canal)$"](${b});
);
out geom;`;

// Kind order is the priority order when an element carries several tags; also the output sort order.
const PRIORITY = ['water', 'forest', 'scrub', 'park', 'garden', 'orchard', 'vineyard', 'grass', 'farmland'];
const COARSE = new Set(['forest', 'scrub', 'farmland', 'grass', 'orchard', 'vineyard']);
const BUMPABLE = new Set(['forest', 'farmland', 'grass']);
const LINE_KINDS = { river: 12, canal: 6, stream: 3 };

const wait = ms => new Promise(res => setTimeout(res, ms));

async function fetchOverpass() {
  let lastErr;
  for (let round = 0; round < 3; round++) {
    for (const url of MIRRORS) {
      try {
        console.log(`Overpass: ${url} (round ${round + 1})`);
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
          body: 'data=' + encodeURIComponent(QUERY),
          signal: AbortSignal.timeout(300000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        // Overpass reports runtime errors (timeouts, memory) as HTTP 200 with a remark and partial data.
        if (j.remark && /error|timed out|timeout|memory/i.test(j.remark)) throw new Error(`remark: ${j.remark}`);
        if (!Array.isArray(j.elements) || j.elements.length === 0) throw new Error('empty response');
        return j;
      } catch (e) {
        lastErr = e;
        console.warn(`  failed: ${e.message}`);
        await wait(5000 * (round + 1));
      }
    }
  }
  throw new Error(`All Overpass mirrors failed: ${lastErr?.message}`);
}

async function loadRaw() {
  if (!REFRESH && existsSync(CACHE)) {
    console.log(`Using cached ${CACHE} (pass --refresh to refetch)`);
    return JSON.parse(readFileSync(CACHE, 'utf8'));
  }
  const j = await fetchOverpass();
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(j));
  return j;
}

// Local equirectangular projection in metres around ORIGIN.
const M_LAT = 110574;
const M_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const toXY = ([lat, lon]) => [(lon - ORIGIN.lon) * M_LON, (lat - ORIGIN.lat) * M_LAT];

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// Iterative Douglas-Peucker on projected points; returns kept indices.
function simplify(pts, tol) {
  if (pts.length <= 2) return pts.map((_, i) => i);
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
  const out = [];
  keep.forEach((v, i) => v && out.push(i));
  return out;
}

const r5 = v => Math.round(v * 1e5) / 1e5;
const EPS = 1e-7;
const same = (a, b) => Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS;

function dedupe(pts) {
  const out = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  while (out.length > 1 && out[0][0] === out.at(-1)[0] && out[0][1] === out.at(-1)[1]) out.pop();
  return out;
}

function kindOf(t) {
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
  return PRIORITY.find(k => has.has(k)) || null;
}

// Ring helpers. Rings are open arrays of [lat, lon] (closing point not repeated).
function pointInRing([lat, lon], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function areaM2(ring) {
  const xy = ring.map(toXY);
  let s = 0;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) s += xy[j][0] * xy[i][1] - xy[i][0] * xy[j][1];
  return Math.abs(s) / 2;
}

// Sutherland-Hodgman clip of an open ring against the BBOX rectangle.
function clipRing(ring) {
  const edges = [
    [p => p[0] >= BBOX.s, (a, c) => cutLat(a, c, BBOX.s)],
    [p => p[0] <= BBOX.n, (a, c) => cutLat(a, c, BBOX.n)],
    [p => p[1] >= BBOX.w, (a, c) => cutLon(a, c, BBOX.w)],
    [p => p[1] <= BBOX.e, (a, c) => cutLon(a, c, BBOX.e)],
  ];
  let out = ring;
  for (const [inside, cut] of edges) {
    if (out.length === 0) break;
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i + input.length - 1) % input.length];
      const ci = inside(cur), pi = inside(prev);
      if (ci) {
        if (!pi) out.push(cut(prev, cur));
        out.push(cur);
      } else if (pi) {
        out.push(cut(prev, cur));
      }
    }
  }
  return out;
}
function cutLat(a, c, lat) {
  const t = (lat - a[0]) / (c[0] - a[0]);
  return [lat, a[1] + t * (c[1] - a[1])];
}
function cutLon(a, c, lon) {
  const t = (lon - a[1]) / (c[1] - a[1]);
  return [a[0] + t * (c[0] - a[0]), lon];
}

// Join way segments into closed rings; ways may run in either direction.
function assembleRings(segs) {
  const rings = [];
  let dropped = 0;
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
    else dropped++;
  }
  return { rings, dropped };
}

// Simplify an open ring; keep at least 4 points where the input has them.
function simplifyRing(ring, tol) {
  const closed = [...ring, ring[0]];
  let t = tol;
  for (let n = 0; n < 10; n++) {
    const idx = simplify(closed, t);
    const pts = dedupe(idx.map(i => [r5(closed[i][0]), r5(closed[i][1])]));
    if (pts.length >= 4) return pts;
    t /= 2;
  }
  return dedupe(ring.map(p => [r5(p[0]), r5(p[1])]));
}

// Overpass returns whole ways, which can run km past the bbox. Split each way into
// runs of in-bbox points; keep one outside neighbour on each side so lines reach the edge.
const inBox = ([lat, lon]) => lat >= BBOX.s && lat <= BBOX.n && lon >= BBOX.w && lon <= BBOX.e;
function clip(pts) {
  const runs = [];
  let cur = null;
  for (let i = 0; i < pts.length; i++) {
    if (inBox(pts[i])) {
      if (!cur) { cur = i > 0 ? [pts[i - 1]] : []; }
      cur.push(pts[i]);
    } else if (cur) {
      cur.push(pts[i]);
      runs.push(cur);
      cur = null;
    }
  }
  if (cur) runs.push(cur);
  return runs.filter(r => r.length >= 2);
}

const geomPts = g => (Array.isArray(g) && g.every(p => p && Number.isFinite(p.lat)) ? g.map(p => [p.lat, p.lon]) : null);

// ---------------------------------------------------------------------------------------------
const raw = await loadRaw();
const elements = raw.elements;
const stats = { ringsUnclosed: 0, innerUnassigned: 0, dedupRings: 0, relations: 0, ways: 0 };

// 1. Raw polygons: { k, id, outer, holes, name }
const polys = [];
const lines = [];
const standalone = new Map(); // way id -> kind, for closed ways with their own area tags
const extraHoles = new Map(); // way id -> holes moved over from a relation duplicate

for (const el of elements) {
  if (el.type !== 'way') continue;
  const t = el.tags || {};
  const k = kindOf(t);
  const pts = geomPts(el.geometry);
  if (!k || !pts || pts.length < 4) continue;
  const closed = (el.nodes && el.nodes[0] === el.nodes.at(-1)) || same(pts[0], pts.at(-1));
  if (closed) standalone.set(el.id, k);
}

for (const el of elements) {
  if (el.type !== 'relation') continue;
  const t = el.tags || {};
  const k = kindOf(t);
  if (!k) continue;
  stats.relations++;
  const outerSegs = [], innerSegs = [];
  for (const m of el.members || []) {
    if (m.type !== 'way') continue;
    const pts = geomPts(m.geometry);
    if (!pts || pts.length < 2) continue;
    (m.role === 'inner' ? innerSegs : outerSegs).push({ id: m.ref, pts });
  }
  const outer = assembleRings(outerSegs);
  const inner = assembleRings(innerSegs);
  stats.ringsUnclosed += outer.dropped + inner.dropped;
  const outs = outer.rings.map(r => ({ ...r, holes: [] }));
  for (const h of inner.rings) {
    const o = outs.find(o => pointInRing(h.pts[0], o.pts));
    if (o) o.holes.push(h.pts);
    else stats.innerUnassigned++;
  }
  for (const o of outs) {
    // De-duplicate: an outer ring that is one closed way already emitted with the same kind
    // stays with the way; the relation's holes move over to it.
    if (o.ids.length === 1 && standalone.get(o.ids[0]) === k) {
      stats.dedupRings++;
      if (!extraHoles.has(o.ids[0])) extraHoles.set(o.ids[0], []);
      extraHoles.get(o.ids[0]).push(...o.holes);
      continue;
    }
    polys.push({ k, id: `r${el.id}`, outer: o.pts, holes: o.holes, name: t.name });
  }
}

for (const el of elements) {
  if (el.type !== 'way') continue;
  const t = el.tags || {};
  const pts = geomPts(el.geometry);
  if (!pts) continue;
  if (LINE_KINDS[t.waterway]) {
    lines.push({ el, pts });
    continue;
  }
  const k = standalone.get(el.id);
  if (!k) continue;
  stats.ways++;
  polys.push({ k, id: `w${el.id}`, outer: pts.slice(0, -1), holes: extraHoles.get(el.id) || [], name: t.name });
}

// 2-5. Clip, simplify, filter, round.
function buildAreas(bigTol) {
  const out = [];
  for (const p of polys) {
    const tol = COARSE.has(p.k) ? (BUMPABLE.has(p.k) ? bigTol : 4) : 2;
    const oc = clipRing(p.outer);
    if (oc.length < 3) continue;
    const o = simplifyRing(oc, tol);
    if (o.length < 3) continue;
    const oa = areaM2(o);
    if (oa < (p.k === 'water' ? 100 : 300)) continue;
    const rings = [o];
    let net = oa;
    for (const h of p.holes) {
      const hc = clipRing(h);
      if (hc.length < 3) continue;
      const hs = simplifyRing(hc, tol);
      if (hs.length < 3) continue;
      const ha = areaM2(hs);
      if (ha < 150) continue;
      rings.push(hs);
      net -= ha;
    }
    out.push({ k: p.k, id: p.id, r: rings, _a: Math.max(0, net), _n: p.name });
  }
  out.sort((a, b) => PRIORITY.indexOf(a.k) - PRIORITY.indexOf(b.k) || b._a - a._a);
  return out;
}

function buildLines() {
  const out = [];
  for (const { el, pts } of lines) {
    const t = el.tags;
    let w = LINE_KINDS[t.waterway];
    const tw = String(t.width || '').trim();
    if (/^\d+(\.\d+)?$/.test(tw) && +tw >= 1 && +tw <= 60) w = +tw;
    for (const run of clip(pts)) {
      const s = simplify(run, 2).map(i => [r5(run[i][0]), r5(run[i][1])]);
      const p = s.filter((q, i) => i === 0 || q[0] !== s[i - 1][0] || q[1] !== s[i - 1][1]);
      if (p.length < 2) continue;
      const line = { k: t.waterway, id: `w${el.id}`, w };
      if (t.name) line.n = t.name;
      line.p = p;
      out.push(line);
    }
  }
  return out;
}

const lineOut = buildLines();
let areas, json, usedTol;
for (const tol of [4, 6, 8, 10]) {
  areas = buildAreas(tol);
  json = JSON.stringify({
    source: '© OpenStreetMap contributors, ODbL 1.0 (Overpass API)',
    fetched: raw.osm3s?.timestamp_osm_base || new Date().toISOString(),
    bbox: BBOX,
    areas: areas.map(({ k, id, r }) => ({ k, id, r })),
    lines: lineOut,
  });
  usedTol = tol;
  const size = Buffer.byteLength(json);
  if (size <= MAX_BYTES) break;
  console.log(`  ${(size / 1024 / 1024).toFixed(2)} MB at ${tol} m for forest/farmland/grass: too big, raising tolerance`);
}
if (areas.length === 0) throw new Error('No areas after conversion');
if (Buffer.byteLength(json) > MAX_BYTES) throw new Error(`Output still > 3 MB at 10 m tolerance (${Buffer.byteLength(json)} bytes); not written`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, json);

// ---------------------------------------------------------------------------------------------
// Summary
const size = Buffer.byteLength(json);
console.log(`\nWrote ${OUT}: ${areas.length} areas, ${lineOut.length} lines, ${(size / 1024 / 1024).toFixed(2)} MB (${size} bytes)`);
console.log(`Tolerance for forest/farmland/grass: ${usedTol} m (scrub/orchard/vineyard 4 m, water/park/garden 2 m)`);
console.log(`Input: ${stats.ways} area ways, ${stats.relations} multipolygon relations; dropped ${stats.ringsUnclosed} unclosed rings, ${stats.innerUnassigned} unassigned inner rings; ${stats.dedupRings} relation rings de-duplicated to their way`);
// Outer members of relations that are also emitted as standalone ways (possible double areas).
const dupOuter = [];
for (const el of elements) {
  if (el.type !== 'relation' || !kindOf(el.tags || {})) continue;
  for (const m of el.members || []) {
    if (m.type === 'way' && m.role !== 'inner' && standalone.has(m.ref)) dupOuter.push(`w${m.ref}(${standalone.get(m.ref)}) in r${el.id}(${kindOf(el.tags)})`);
  }
}
console.log(`Relation outer members also emitted standalone: ${dupOuter.length ? dupOuter.join(', ') : 'none'}`);
const tri = areas.flatMap(a => a.r).filter(r => r.length < 4).length;
console.log(`Rings with fewer than 4 points (source has < 4 unique points after clip + rounding): ${tri}`);

console.log('\nAreas per kind:');
for (const k of PRIORITY) {
  const list = areas.filter(a => a.k === k);
  const km2 = list.reduce((s, a) => s + a._a, 0) / 1e6;
  console.log(`  ${k.padEnd(9)} ${String(list.length).padStart(5)}  ${km2.toFixed(3)} km²`);
}
console.log('Lines per kind:');
for (const k of Object.keys(LINE_KINDS)) console.log(`  ${k.padEnd(9)} ${lineOut.filter(l => l.k === k).length}`);

// Coverage within 1.2 km of the two hills, sampled on a 20 m grid in projected metres.
function coverage(lat, lon, radius = 1200, step = 20) {
  const c = toXY([lat, lon]);
  const byKind = {};
  const polysXY = areas.map(a => {
    const rings = a.r.map(r => r.map(toXY));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of rings[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { k: a.k, rings, box: [x0, y0, x1, y1] };
  }).filter(p => p.box[2] >= c[0] - radius && p.box[0] <= c[0] + radius && p.box[3] >= c[1] - radius && p.box[1] <= c[1] + radius);
  const inXY = ([x, y], ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  let total = 0;
  for (let dx = -radius; dx <= radius; dx += step) {
    for (let dy = -radius; dy <= radius; dy += step) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const p = [c[0] + dx, c[1] + dy];
      if (!inBox([ORIGIN.lat + p[1] / M_LAT, ORIGIN.lon + p[0] / M_LON])) continue; // no data outside the bbox
      total++;
      const hit = new Set();
      for (const q of polysXY) {
        if (p[0] < q.box[0] || p[0] > q.box[2] || p[1] < q.box[1] || p[1] > q.box[3]) continue;
        if (inXY(p, q.rings[0]) && !q.rings.slice(1).some(h => inXY(p, h))) hit.add(q.k);
      }
      for (const k of hit) byKind[k] = (byKind[k] || 0) + 1;
    }
  }
  const cell = step * step / 1e6;
  return { circle: total * cell, byKind: Object.fromEntries(Object.entries(byKind).map(([k, n]) => [k, n * cell])) };
}
console.log('\nCoverage within 1.2 km (20 m grid):');
for (const { name, lat, lon } of CITY.nature?.hills || []) {
  const { circle, byKind } = coverage(lat, lon);
  const forest = byKind.forest || 0;
  console.log(`  ${name}: forest ${forest.toFixed(3)} km² of ${circle.toFixed(3)} km² in bbox circle (${((forest / circle) * 100).toFixed(1)}%)`);
  const rest = Object.entries(byKind).filter(([k]) => k !== 'forest').map(([k, v]) => `${k} ${v.toFixed(3)}`).join(', ');
  if (rest) console.log(`    other kinds (km²): ${rest}`);
}

console.log('\nNamed "Este":');
const esteAreas = areas.filter(a => a.k === 'water' && /este/i.test(a._n || ''));
for (const a of esteAreas) console.log(`  water area ${a.id} "${a._n}" ${(a._a / 1e6).toFixed(4)} km²`);
const esteLines = new Map();
for (const l of lineOut) if (/este/i.test(l.n || '')) {
  const key = `${l.k} "${l.n}" w=${l.w}`;
  const e = esteLines.get(key) || { ways: new Set(), runs: 0, m: 0 };
  e.ways.add(l.id);
  e.runs++;
  const xy = l.p.map(toXY);
  for (let i = 1; i < xy.length; i++) e.m += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
  esteLines.set(key, e);
}
for (const [key, e] of esteLines) console.log(`  line ${key}: ${e.ways.size} ways, ${e.runs} runs, ${(e.m / 1000).toFixed(2)} km`);
if (esteAreas.length === 0 && esteLines.size === 0) console.log('  none');
