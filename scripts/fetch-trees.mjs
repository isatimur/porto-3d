// Fetch the city's mapped trees, tree rows, hedges and park walks from
// OpenStreetMap (Overpass API) and write <data dir>/trees.json, a compact
// file src/nature.js plants from (street trees, avenue rows, hedges, the
// gravel walks of the parks).
// Node 22, no dependencies. Run: node scripts/fetch-trees.mjs --city porto [--refresh] [--stats]
// The raw Overpass response is cached in <data dir>/.cache/trees-raw.json.
//
// Output: positions in units of `q` metres east / north of `origin`
// (scripts/geo-lib.mjs toXY), delta-coded per list so the file compresses
// well; src/street-trees.js turns them back into lat/lon:
//   t: [dx, dy, ...]  single trees (natural=tree)
//   k: [i, kind, ...]  the kind (KINDS index) of tree i where it is not 0
//   r: [[kind, dx, dy, dx, dy, ...], ...]  tree rows (natural=tree_row)
//   h: [[dx, dy, ...], ...]  hedges (barrier=hedge)
//   p: [[dx, dy, ...], ...]  walks in the parks of a hectare and more
//                            (highway=footway|path|track|bridleway)
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { CITY, BBOX, ORIGIN, overpass, dataPath, cachePath, dataRel, toXY, simplify } from './geo-lib.mjs';

const OUT = dataPath('trees.json');
const CACHE = cachePath('trees-raw.json');
const REFRESH = process.argv.includes('--refresh');
const STATS = process.argv.includes('--stats');

const b = `${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}`;
const QUERY = `[out:json][timeout:180];
(
  node["natural"="tree"](${b});
  way["natural"="tree_row"](${b});
  way["barrier"="hedge"](${b});
  way["highway"~"^(footway|path|track|bridleway)$"](${b});
);
out geom qt;`;

// Species classes, in the order src/nature.js reads them (STREET_KINDS there).
//   0 plane / broadleaf (Platanus, Celtis, Acer, Quercus robur, Fraxinus...)
//   1 lime (Tilia)
//   2 jacaranda
//   3 palm (Phoenix, Washingtonia, Trachycarpus...)
//   4 pine (Pinus)
//   5 eucalyptus
//   6 cypress and other conifers (Cupressus, Chamaecyparis, Thuja, Cedrus...)
//   7 evergreen broadleaf (Magnolia, Ligustrum, Olea, Citrus, Quercus ilex, Pittosporum...)
//   8 poplar, 9 willow
export const KINDS = ['broadleaf', 'lime', 'jacaranda', 'palm', 'pine', 'eucalyptus', 'conifer', 'evergreen', 'poplar', 'willow'];
const GENUS = [
  [/^(tilia)/, 1],
  [/^(jacaranda)/, 2],
  [/^(phoenix|washingtonia|trachycarpus|syagrus|butia|chamaerops|archontophoenix|livistona|arecaceae|palm)/, 3],
  [/^(pinus|araucaria)/, 4],
  [/^(eucalyptus|corymbia|acacia)/, 5],
  [/^(cupressus|chamaecyparis|thuja|juniperus|cedrus|taxus|picea|abies|sequoia|cryptomeria|calocedrus|platycladus|x cupressocyparis|cupressocyparis)/, 6],
  [/^(magnolia|ligustrum|olea|citrus|pittosporum|laurus|arbutus|metrosideros|schinus|ceratonia|eriobotrya|photinia|nerium|camellia|grevillea|brachychiton|callistemon|melaleuca|ficus|persea|cinnamomum|quercus ilex|quercus suber)/, 7],
  [/^(populus)/, 8],
  [/^(salix)/, 9],
];
function kindOf(tags = {}) {
  const name = String(tags.species || tags.genus || tags.taxon || tags['species:la'] || tags['genus:la'] || '').toLowerCase().trim();
  if (name) for (const [re, k] of GENUS) if (re.test(name)) return k;
  const pt = String(tags['species:pt'] || tags['genus:pt'] || tags['species:en'] || tags['genus:en'] || '').toLowerCase();
  if (/palm|palmeira/.test(pt)) return 3;
  if (/pinheiro|pine/.test(pt)) return 4;
  if (/eucalipto|eucalyptus/.test(pt)) return 5;
  if (/cipreste|cypress|cedro|cedar/.test(pt)) return 6;
  if (/tília|tilia|lime|linden/.test(pt)) return 1;
  if (/jacarand/.test(pt)) return 2;
  if (/plátano|platano|plane/.test(pt)) return 0;
  if (tags.leaf_type === 'needleleaved') return 6;
  if (tags.leaf_cycle === 'evergreen') return 7;
  return 0;
}

async function loadRaw() {
  if (!REFRESH && existsSync(CACHE)) {
    console.log(`Using cached ${dataRel('.cache', 'trees-raw.json')} (pass --refresh to refetch)`);
    return JSON.parse(readFileSync(CACHE, 'utf8'));
  }
  const elements = await overpass(QUERY, { label: 'trees' });
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(elements));
  return elements;
}

// the parks of a hectare and more, from nature.json, in local metres (the
// walks of a small garden do not show at 8 m per land-cover pixel)
const PARK_MIN_M2 = 10000;
function greenRings() {
  const p = dataPath('nature.json');
  if (!existsSync(p)) return [];
  const nat = JSON.parse(readFileSync(p, 'utf8'));
  const area = (ring) => {
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
    return Math.abs(a) / 2;
  };
  return (nat.areas || [])
    .filter((a) => a.k === 'park')
    .map((a) => {
      const rings = a.r.map((ring) => ring.map(toXY));
      const xs = rings[0].map((q) => q[0]);
      const ys = rings[0].map((q) => q[1]);
      return { rings, area: area(rings[0]), x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    })
    .filter((g) => g.area >= PARK_MIN_M2);
}
function inRings(x, y, rings) {
  let inside = false;
  for (const poly of rings) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const c = poly[j];
      if (a[1] > y !== c[1] > y && x < ((c[0] - a[0]) * (y - a[1])) / (c[1] - a[1]) + a[0]) inside = !inside;
    }
  }
  return inside;
}
function inGreen(x, y, green) {
  for (const g of green) if (x >= g.x0 && x <= g.x1 && y >= g.y0 && y <= g.y1 && inRings(x, y, g.rings)) return true;
  return false;
}

const elements = await loadRaw();
const green = greenRings();
const round = (v) => Math.round(v);
const trees = [];
const rows = [];
const hedges = [];
const walks = [];
const kindCount = new Array(KINDS.length).fill(0);
const genusSeen = {};
for (const e of elements) {
  const tg = e.tags || {};
  if (e.type === 'node' && tg.natural === 'tree') {
    const [x, y] = toXY([e.lat, e.lon]);
    const k = kindOf(tg);
    kindCount[k]++;
    const gname = String(tg.genus || tg.species || tg.leaf_type || '?').split(' ')[0];
    genusSeen[gname] = (genusSeen[gname] || 0) + 1;
    trees.push([round(x), round(y), k]);
    continue;
  }
  if (e.type !== 'way' || !Array.isArray(e.geometry) || e.geometry.length < 2) continue;
  const ll = e.geometry.map((g) => [g.lat, g.lon]);
  const pts = ll.map(toXY);
  // geo-lib simplify works on [lat, lon] points (tolerance in metres)
  const simple = (tol) => simplify(ll, tol).map(toXY);
  if (tg.natural === 'tree_row') {
    rows.push([kindOf(tg), simple(1)]);
  } else if (tg.barrier === 'hedge') {
    hedges.push(simple(0.8));
  } else if (tg.highway) {
    // walks: keep the ones whose middle lies in a park, garden or wood
    const mid = pts[Math.floor(pts.length / 2)];
    const a = pts[0];
    if (!inGreen(mid[0], mid[1], green) && !inGreen(a[0], a[1], green)) continue;
    if (tg.indoor === 'yes' || tg.tunnel || tg.bridge) continue;
    walks.push(simple(2.5));
  }
}

// Quantise to Q metres (a world unit is 4 m, so 2 m is well below what
// shows) and delta-code. The single trees are sorted in 100 m bands, west to
// east, so neighbours follow each other and the deltas stay small.
const Q = 2;
const qz = (v) => Math.round(v / Q);
const cells = trees.map(([x, y, k]) => [qz(x), qz(y), k]);
cells.sort((p, q) => Math.floor(p[1] / (100 / Q)) - Math.floor(q[1] / (100 / Q)) || p[0] - q[0]);
const t = [];
const k = []; // sparse: [index, kind] for the trees whose kind is not 0
let px = 0;
let py = 0;
cells.forEach(([x, y, kind], i) => {
  t.push(x - px, y - py);
  if (kind) k.push(i, kind);
  px = x;
  py = y;
});
const lineLength = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
const line = (pts) => {
  const out = [];
  let lx = 0;
  let ly = 0;
  for (const [x, y] of pts) {
    const rx = qz(x);
    const ry = qz(y);
    out.push(rx - lx, ry - ly);
    lx = rx;
    ly = ry;
  }
  return out;
};
const doc = {
  source: '© OpenStreetMap contributors, ODbL 1.0 (Overpass API)',
  fetched: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  origin: ORIGIN,
  q: Q,
  kinds: KINDS,
  t,
  k,
  r: rows.filter(([, pts]) => lineLength(pts) >= 8).map(([kind, pts]) => [kind, ...line(pts)]),
  h: hedges.filter((pts) => lineLength(pts) >= 4).map(line),
  p: walks.filter((pts) => lineLength(pts) >= 25).map(line),
};
const text = JSON.stringify(doc);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, text);
const gz = gzipSync(Buffer.from(text), { level: 9 }).length;
console.log(`${CITY.id}: ${trees.length} trees, ${rows.length} rows, ${hedges.length} hedges, ${walks.length} park walks`);
console.log(`kinds: ${KINDS.map((k, i) => `${k} ${kindCount[i]}`).join(', ')}`);
console.log(`wrote ${dataRel('trees.json')}: ${(text.length / 1024).toFixed(1)} KB, gzip ${(gz / 1024).toFixed(1)} KB`);
if (STATS) console.log(Object.entries(genusSeen).sort((a, b2) => b2[1] - a[1]).slice(0, 40));
