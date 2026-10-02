// Fetch the street level of a city from OpenStreetMap (Overpass API):
//   <data dir>/pois.json        cafés, restaurants, shops, museums ... with
//                               their opening hours (src/pois.js; the UI's
//                               search reads it too)
//   <data dir>/streetscape.json pedestrian areas and squares (the calçada),
//                               street trees and tree rows, street lamps,
//                               benches and bollards (src/streetscape.js)
// Node 22, no dependencies.
//   node scripts/fetch-pois.mjs [--city <id>] [--refresh] [--dry-run]
// (default city: braga). The raw responses are cached in <data dir>/.cache/;
// --refresh fetches them again.
//
// pois.json (a contract: src/pois.js and the UI's search read it):
//   { source, fetched, city, bbox, pois: [{ id: "n123" | "w45", name, kind,
//     lat, lon, opening_hours?, cuisine?, website?, phone?, wheelchair?,
//     outdoor_seating? }] }
// `name` is a string; only toilets, ATMs and tourist information may have
// an empty one (an unnamed café is not something to search for).
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CITY, BBOX, overpass, dataPath, cachePath, dataRel, simplifyRing, ringArea } from './geo-lib.mjs';

const REFRESH = process.argv.includes('--refresh');
const OUT_POIS = dataPath('pois.json');
const OUT_STREET = dataPath('streetscape.json');
const MAX_POIS_BYTES = 1.5 * 1024 * 1024;
const b = `${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}`;

const AMENITY = ['cafe', 'restaurant', 'bar', 'pub', 'fast_food', 'ice_cream', 'pharmacy', 'toilets', 'atm', 'bank'];
const SHOP = ['bakery', 'pastry', 'books', 'gift', 'wine', 'supermarket', 'clothes'];
const TOURISM = ['museum', 'gallery', 'information', 'hotel'];
const UNNAMED_OK = new Set(['toilets', 'atm', 'information']);

if (process.argv.includes('--dry-run')) {
  console.log(`city ${CITY.id}; bbox ${b}`);
  console.log(`out ${dataRel('pois.json')}, ${dataRel('streetscape.json')}`);
  process.exit(0);
}

const POI_QUERY = `[out:json][timeout:180];
(
  nwr["amenity"~"^(${AMENITY.join('|')})$"](${b});
  nwr["shop"~"^(${SHOP.join('|')})$"](${b});
  nwr["tourism"~"^(${TOURISM.join('|')})$"](${b});
);
out center tags;`;

const STREET_QUERY = `[out:json][timeout:180];
(
  way["highway"="pedestrian"]["area"="yes"](${b});
  relation["highway"="pedestrian"](${b});
  way["area:highway"="pedestrian"](${b});
  way["place"="square"](${b});
  relation["place"="square"](${b});
  node["place"="square"](${b});
  node["natural"="tree"](${b});
  way["natural"="tree_row"](${b});
  node["highway"="street_lamp"](${b});
  node["amenity"="bench"](${b});
  way["amenity"="bench"](${b});
  node["barrier"="bollard"](${b});
);
out geom;`;

async function cached(name, query, label) {
  const file = cachePath(name);
  if (!REFRESH && existsSync(file)) {
    console.log(`cache: ${dataRel('.cache', name)}`);
    return JSON.parse(readFileSync(file, 'utf8'));
  }
  const els = await overpass(query, { label, allowEmpty: CITY.id !== 'braga' });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(els));
  return els;
}

const r5 = (v) => Math.round(v * 1e5) / 1e5;
const clip = (s, n) => (typeof s === 'string' ? s.trim().slice(0, n) : undefined);

// ------------------------------------------------------------ POIs
function poiKind(t) {
  if (AMENITY.includes(t.amenity)) return t.amenity;
  if (SHOP.includes(t.shop)) return t.shop === 'pastry' ? 'pastry' : t.shop;
  if (TOURISM.includes(t.tourism)) return t.tourism;
  return null;
}

function buildPois(els) {
  const out = [];
  const seen = new Set();
  const dropped = { unnamed: 0, board: 0, nopos: 0 };
  for (const e of els) {
    const t = e.tags || {};
    const kind = poiKind(t);
    if (!kind) continue;
    // tourist information: offices and centres, not the boards and signposts
    if (kind === 'information' && t.information && t.information !== 'office' && t.information !== 'visitor_centre') {
      dropped.board++;
      continue;
    }
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      dropped.nopos++;
      continue;
    }
    const name = clip(t.name || t.brand || (kind === 'atm' || kind === 'bank' ? t.operator : ''), 80) || '';
    if (!name && !UNNAMED_OK.has(kind)) {
      dropped.unnamed++;
      continue;
    }
    const id = `${e.type[0]}${e.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const p = { id, name, kind, lat: r5(lat), lon: r5(lon) };
    const oh = clip(t.opening_hours, 200);
    if (oh) p.opening_hours = oh;
    const cu = clip(t.cuisine, 60);
    if (cu) p.cuisine = cu;
    const web = clip(t.website || t['contact:website'], 160);
    if (web && /^https?:\/\//.test(web)) p.website = web;
    const ph = clip(t.phone || t['contact:phone'], 40);
    if (ph) p.phone = ph;
    if (t.wheelchair) p.wheelchair = clip(t.wheelchair, 12);
    if (t.outdoor_seating) p.outdoor_seating = clip(t.outdoor_seating, 12);
    out.push(p);
  }
  out.sort((a, b2) => a.kind.localeCompare(b2.kind) || a.name.localeCompare(b2.name) || a.id.localeCompare(b2.id));
  return { pois: out, dropped };
}

// ------------------------------------------------------------ streetscape
// closed rings from a relation's outer members (joined end to end)
function outerRings(rel) {
  const parts = (rel.members || []).filter((m) => m.type === 'way' && m.role !== 'inner' && Array.isArray(m.geometry)).map((m) => m.geometry.map((g) => [g.lat, g.lon]));
  const rings = [];
  const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-7 && Math.abs(p[1] - q[1]) < 1e-7;
  while (parts.length) {
    let ring = parts.shift();
    for (let guard = 0; guard < 200 && !same(ring[0], ring.at(-1)); guard++) {
      const k = parts.findIndex((p) => same(p[0], ring.at(-1)) || same(p.at(-1), ring.at(-1)));
      if (k < 0) break;
      const p = parts.splice(k, 1)[0];
      ring = ring.concat(same(p[0], ring.at(-1)) ? p.slice(1) : p.reverse().slice(1));
    }
    if (ring.length >= 4 && same(ring[0], ring.at(-1))) rings.push(ring);
  }
  return rings;
}

function buildStreet(els) {
  const areas = [];
  const squareNodes = [];
  const trees = [];
  const rows = [];
  const lamps = [];
  const benches = [];
  const bollards = [];
  const ll = (g) => [r5(g.lat), r5(g.lon)];
  const pushArea = (e, ring) => {
    const t = e.tags || {};
    const simple = simplifyRing(ring, 0.6);
    const area = Math.abs(ringArea(simple));
    if (simple.length < 3 || area < 30) return;
    areas.push({ id: `${e.type[0]}${e.id}`, name: clip(t.name, 80) || '', k: t.place === 'square' ? 'square' : 'pedestrian', a: Math.round(area), r: simple.map(([la, lo]) => [r5(la), r5(lo)]) });
  };
  for (const e of els) {
    const t = e.tags || {};
    if (e.type === 'node') {
      if (t.natural === 'tree') trees.push([r5(e.lat), r5(e.lon)]);
      else if (t.highway === 'street_lamp') lamps.push([r5(e.lat), r5(e.lon)]);
      else if (t.amenity === 'bench') {
        const dir = Number.parseFloat(t.direction);
        benches.push(Number.isFinite(dir) ? [r5(e.lat), r5(e.lon), Math.round(dir)] : [r5(e.lat), r5(e.lon)]);
      } else if (t.barrier === 'bollard') bollards.push([r5(e.lat), r5(e.lon)]);
      else if (t.place === 'square') squareNodes.push({ id: `n${e.id}`, name: clip(t.name, 80) || '', p: [r5(e.lat), r5(e.lon)] });
      continue;
    }
    if (e.type === 'way') {
      const g = (e.geometry || []).filter(Boolean);
      if (g.length < 2) continue;
      if (t.natural === 'tree_row') {
        rows.push(g.map(ll));
        continue;
      }
      if (t.amenity === 'bench') {
        // a long bench: its middle
        const m = g[g.length >> 1];
        benches.push([r5(m.lat), r5(m.lon)]);
        continue;
      }
      const closed = g.length >= 4 && g[0].lat === g.at(-1).lat && g[0].lon === g.at(-1).lon;
      if (closed && (t.place === 'square' || t.highway === 'pedestrian' || t['area:highway'] === 'pedestrian')) pushArea(e, g.map((q) => [q.lat, q.lon]));
      continue;
    }
    if (e.type === 'relation') for (const ring of outerRings(e)) pushArea(e, ring);
  }
  // the same square mapped as a pedestrian area and as place=square: keep one
  const kept = [];
  for (const a of areas.sort((p, q) => q.a - p.a)) {
    const key = `${a.r[0][0]},${a.r[0][1]},${a.r.length}`;
    if (kept.some((k) => `${k.r[0][0]},${k.r[0][1]},${k.r.length}` === key)) continue;
    kept.push(a);
  }
  return { areas: kept, squares: squareNodes, trees, rows, lamps, benches, bollards };
}

// ------------------------------------------------------------ main
const poiEls = await cached('pois-raw.json', POI_QUERY, 'POIs');
const streetEls = await cached('streetscape-raw.json', STREET_QUERY, 'streetscape');
const fetched = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const source = '© OpenStreetMap contributors, ODbL 1.0 (Overpass API)';

const { pois, dropped } = buildPois(poiEls);
const poiDoc = { source, fetched, city: CITY.id, bbox: BBOX, pois };
const poiText = JSON.stringify(poiDoc).replace(/\},\{"id"/g, '},\n{"id"');
if (poiText.length > MAX_POIS_BYTES) throw new Error(`pois.json would be ${(poiText.length / 1048576).toFixed(2)} MB (limit 1.5 MB)`);
writeFileSync(OUT_POIS, poiText + '\n');

const st = buildStreet(streetEls);
const stDoc = { source, fetched, city: CITY.id, bbox: BBOX, ...st };
writeFileSync(OUT_STREET, JSON.stringify(stDoc) + '\n');

const byKind = {};
const withHours = {};
for (const p of pois) {
  byKind[p.kind] = (byKind[p.kind] || 0) + 1;
  if (p.opening_hours) withHours[p.kind] = (withHours[p.kind] || 0) + 1;
}
console.log(`${dataRel('pois.json')}: ${pois.length} POIs, ${(poiText.length / 1024).toFixed(0)} KB; dropped ${JSON.stringify(dropped)}`);
for (const k of Object.keys(byKind).sort((p, q) => byKind[q] - byKind[p])) console.log(`  ${k.padEnd(12)} ${String(byKind[k]).padStart(4)}  opening_hours ${withHours[k] || 0}`);
console.log(`  with opening_hours: ${pois.filter((p) => p.opening_hours).length}`);
console.log(`${dataRel('streetscape.json')}: ${st.areas.length} areas (${st.areas.filter((a) => a.k === 'square').length} squares), ${st.squares.length} square nodes, ${st.trees.length} trees, ${st.rows.length} tree rows, ${st.lamps.length} lamps, ${st.benches.length} benches, ${st.bollards.length} bollards`);
console.log(`  areas: ${st.areas.slice(0, 25).map((a) => `${a.name || a.id} (${a.a} m²)`).join('; ')}`);
