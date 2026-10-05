// Fetch the Douro quay lines from OpenStreetMap and write <data dir>/quays.json.
// Node 22, no dependencies. Run: node scripts/fetch-quays.mjs [--city porto] [--refresh] [--dry-run]
//
// Sources (core bbox): man_made=quay|pier|embankment, barrier=retaining_wall,
// natural=coastline and the edges of the river polygons (waterway=riverbank,
// natural=water river). A quay line is
//   - an OSM quay / pier / embankment / retaining_wall way next to the water, or
//   - a river-polygon edge that runs along a quayed reach: within QUAY_NEAR_M
//     of such a way, or inside one of the CITY reaches below (Ribeira, Cais de
//     Gaia, Foz), where OSM draws the water edge but not the wall.
// The raw reply is cached in <data dir>/.cache/quays-raw.json (resume-able:
// --refresh refetches). Output is compact: metre polylines, 1 decimal.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CITY, BBOX, overpass, toXY, dataPath, cachePath, dataRel, simplify, toLL } from './geo-lib.mjs';

const OUT = dataPath('quays.json');
const CACHE = cachePath('quays-raw.json');
const REFRESH = process.argv.includes('--refresh');
const QUAY_NEAR_M = 12;
const MIN_RING_M = 1500; // only the Douro and the sea: ponds and fountains get no quay
const MIN_LEN_M = 14;

// Reaches where the water edge is a built quay (south, west, north, east).
// Source: the three signature fronts of the Douro (Cais da Ribeira and Cais
// da Estiva, Cais de Gaia, the Foz promenade). Edit with cities/<id>.json.
const REACHES = CITY.quay_reaches || [
  { id: 'ribeira', bbox: { s: 41.1385, w: -8.6185, n: 41.1432, e: -8.6045 } },
  { id: 'gaia', bbox: { s: 41.1345, w: -8.6195, n: 41.1405, e: -8.6055 } },
  { id: 'foz', bbox: { s: 41.1475, w: -8.6865, n: 41.1525, e: -8.6685 } },
];

if (process.argv.includes('--dry-run')) {
  console.log(`city ${CITY.id}; out ${dataRel('quays.json')}; cache ${dataRel('.cache', 'quays-raw.json')}`);
  console.log('reaches', JSON.stringify(REACHES));
  process.exit(0);
}

const b = `${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}`;
const QUERY = `[out:json][timeout:180];
(
  way["man_made"~"^(quay|pier|embankment)$"](${b});
  way["barrier"="retaining_wall"](${b});
  way["natural"="coastline"](${b});
  way["waterway"="riverbank"](${b});
  way["natural"="water"]["water"~"^(river|lagoon)$"](${b});
  relation["type"="multipolygon"]["waterway"="riverbank"](${b});
  relation["type"="multipolygon"]["natural"="water"](${b});
);
out geom;`;

async function raw() {
  if (!REFRESH && existsSync(CACHE)) {
    console.log(`cache hit ${dataRel('.cache', 'quays-raw.json')}`);
    return JSON.parse(readFileSync(CACHE, 'utf8'));
  }
  const els = await overpass(QUERY, { label: 'quays' });
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(els));
  return els;
}

const ll = (g) => g.filter((p) => p && Number.isFinite(p.lat)).map((p) => toXY([p.lat, p.lon]));
const inReach = (p) => REACHES.some((r) => {
  const [lat, lon] = [CITY.origin.lat + p[1] / 111320, CITY.origin.lon + p[0] / (111320 * Math.cos((CITY.origin.lat * Math.PI) / 180))];
  return lat >= r.bbox.s && lat <= r.bbox.n && lon >= r.bbox.w && lon <= r.bbox.e;
});

function distToLine(p, line) {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)));
  }
  return best;
}

function lengthOf(line) {
  let s = 0;
  for (let i = 0; i < line.length - 1; i++) s += Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
  return s;
}

const els = await raw();
const hints = []; // quay-like ways (metres)
const rings = []; // river polygon rings (metres)
const coast = [];
for (const e of els) {
  const t = e.tags || {};
  if (e.type === 'way' && e.geometry) {
    const line = ll(e.geometry);
    if (t.natural === 'coastline') coast.push(line);
    else if (t.man_made || t.barrier === 'retaining_wall') hints.push({ kind: t.man_made || 'wall', line });
    else rings.push(line);
  } else if (e.type === 'relation') {
    for (const m of e.members || []) if (m.geometry && m.role === 'outer') rings.push(ll(m.geometry));
  }
}
console.log(`ways: ${hints.length} quay/pier/wall hints, ${rings.length} river rings, ${coast.length} coast`);

// Walk each river ring and keep the runs of consecutive points on a quayed
// reach: a point counts when a hint way is within QUAY_NEAR_M or it lies in a reach.
const out = [];
const edges = [...rings, ...coast].filter((r) => lengthOf(r) >= MIN_RING_M);
// walls only: piers are jetties (floating or open), not a river front
const walls = hints.filter((h) => h.kind === 'wall' || h.kind === 'quay' || h.kind === 'embankment');
for (const ring of edges) {
  let run = [];
  const flush = () => {
    if (run.length >= 2 && lengthOf(run) >= MIN_LEN_M) out.push(run);
    run = [];
  };
  // densify to 8 m so a long edge is classified along its length
  const pts = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 8));
    for (let k = 0; k < n; k++) pts.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  pts.push(ring[ring.length - 1]);
  for (const p of pts) {
    const hit = inReach(p) || walls.some((h) => distToLine(p, h.line) < QUAY_NEAR_M);
    if (hit) run.push(p);
    else flush();
  }
  flush();
}

const lines = out.map((l) => simplify(l.map(toLL), 1.2).map(toXY)).filter((l) => l.length >= 2 && lengthOf(l) >= MIN_LEN_M);
const doc = {
  source: 'OpenStreetMap (ODbL): man_made=quay|pier|embankment, barrier=retaining_wall, natural=coastline and river polygon edges on quayed reaches',
  fetched: new Date().toISOString().slice(0, 10),
  origin: CITY.origin,
  unit: 'm east/north of origin',
  reaches: REACHES.map((r) => r.id),
  lines: lines.map((l) => l.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10])),
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(doc));
const total = lines.reduce((s, l) => s + lengthOf(l), 0);
console.log(`wrote ${dataRel('quays.json')}: ${lines.length} lines, ${(total / 1000).toFixed(2)} km`);
