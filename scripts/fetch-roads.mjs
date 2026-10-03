// Fetch a city's street network from OpenStreetMap (Overpass API) and write <data dir>/roads.json.
// Node 22, no dependencies.
//   node scripts/fetch-roads.mjs            (use the cached raw reply if there is one)
//   node scripts/fetch-roads.mjs --fetch    (always ask Overpass again)
//   --city <id>   the city (default braga; see cities/<id>.json)
//   --dry-run     print the city, bbox and paths, then exit
//
// data/roads.json (Braga; another city: its data dir), v2:
//   { v: 2, origin, bbox, nodes: n, features: [{ kind, pts, t?, j? }] }
//   kind  primary | secondary | minor | foot | rail | water (the draw buckets)
//   pts   [[lat, lon], ...] simplified to 5 m (roundabouts and links 1.5 m)
//   t     the tags that matter for drawing and traffic (only those present):
//           hw  highway class (motorway, trunk_link, residential ...)
//           name, ref
//           ow  1 = one way along pts, -1 = one way against pts (OSM oneway,
//               implied for motorway, motorway_link and roundabouts)
//           ln, lf, lb  lanes, lanes:forward, lanes:backward (integers)
//           br  bridge value (yes, viaduct ...), bs bridge:structure
//           tu  tunnel value (yes, building_passage, culvert ...)
//           cv  covered value (yes: a cut-and-cover section with no tunnel tag)
//           tn  tunnel:name, ly layer (integer), ms maxspeed (km/h), sf surface, jn junction
//   j     junctions: flat [pointIndex, nodeId, ...]. nodeId is a dense index
//         shared by every feature through the same OSM node: the traffic
//         graph joins streets there. Every feature end is listed too.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { dirname } from 'node:path';
import { CITY, BBOX, ORIGIN, overpass, simplify, r5, dataPath, cachePath, dataRel } from './geo-lib.mjs';

const OUT = dataPath('roads.json');
const RAW = cachePath('roads-raw.json.gz');
// bump when the Overpass query changes (currently v3: Metro do Porto
// light_rail and covered=yes captured)
const CACHE_V = 3;

if (process.argv.includes('--dry-run')) {
  console.log(`city ${CITY.id}; data dir ${dataRel()}`);
  console.log('bbox', BBOX, 'origin', ORIGIN);
  console.log(`out ${dataRel('roads.json')}; cache ${dataRel('.cache', 'roads-raw.json.gz')}, ${dataRel('.cache', 'bridges-raw.json.gz')}`);
  process.exit(0);
}

const ROADS = 'motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|unclassified|residential|living_street|pedestrian';
const FOOT = 'footway|path|cycleway|steps|service|track|bridleway';
const b = `${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}`;
// `light_rail` is the Metro do Porto (its tunnels are tunnel=yes /
// tunnel=building_passage); it is fetched whole so the line is drawn up to
// the portals. CP mainline rail is `railway=rail`.
const QUERY = `[out:json][timeout:240];
(
  way["highway"~"^(${ROADS})$"](${b});
  way["highway"~"^(${FOOT})$"]["bridge"]["bridge"!="no"](${b});
  way["waterway"~"^(river|stream)$"](${b});
  way["railway"="rail"](${b});
  way["railway"~"^(light_rail|subway)$"](${b});
);
out body geom;`;

// draw bucket per highway class
const KIND = {
  motorway: 'primary', trunk: 'primary', primary: 'primary',
  motorway_link: 'primary', trunk_link: 'primary', primary_link: 'primary',
  secondary: 'secondary', tertiary: 'secondary', secondary_link: 'secondary', tertiary_link: 'secondary',
  unclassified: 'minor', residential: 'minor', living_street: 'minor', pedestrian: 'minor',
};
const kindOf = (t) => (t.waterway ? 'water' : t.railway ? 'rail' : KIND[t.highway] || (t.highway ? 'foot' : null));

const int = (v) => {
  const m = String(v ?? '').match(/^-?\d+/);
  return m ? parseInt(m[0], 10) : null;
};
function maxspeed(v) {
  if (v == null) return null;
  const s = String(v);
  if (/^PT:urban$/i.test(s)) return 50;
  if (/^PT:rural$/i.test(s)) return 90;
  if (/^PT:motorway$/i.test(s)) return 120;
  if (/^PT:trunk$/i.test(s)) return 100;
  const n = parseFloat(s);
  if (!(n > 0)) return null;
  return Math.round(/mph/.test(s) ? n * 1.609 : n);
}
function oneway(t) {
  const o = String(t.oneway ?? '').toLowerCase();
  if (o === 'yes' || o === 'true' || o === '1') return 1;
  if (o === '-1' || o === 'reverse') return -1;
  if (o === 'no' || o === 'false' || o === '0') return 0;
  if (o === 'reversible' || o === 'alternating') return 0;
  if (t.highway === 'motorway' || t.highway === 'motorway_link') return 1;
  if (t.junction === 'roundabout' || t.junction === 'circular') return 1;
  return 0;
}
function tagsOf(t) {
  const o = {};
  if (t.highway) o.hw = t.highway;
  if (t.railway) o.rw = t.railway;
  if (t.waterway) o.ww = t.waterway;
  if (t.name) o.name = t.name;
  if (t.ref) o.ref = t.ref;
  if (t.highway) {
    const ow = oneway(t);
    if (ow) o.ow = ow;
    const ln = int(t.lanes);
    if (ln > 0 && ln < 10) o.ln = ln;
    const lf = int(t['lanes:forward']);
    if (lf > 0 && lf < 8) o.lf = lf;
    const lb = int(t['lanes:backward']);
    if (lb > 0 && lb < 8) o.lb = lb;
    const ms = maxspeed(t.maxspeed);
    if (ms) o.ms = ms;
    if (t.surface) o.sf = t.surface;
    if (t.junction) o.jn = t.junction;
    if (t.access === 'no' || t.motor_vehicle === 'no' || t.motorcar === 'no') o.nocar = 1;
  }
  if (t.bridge && t.bridge !== 'no') o.br = t.bridge;
  if (t['bridge:structure']) o.bs = t['bridge:structure'];
  if (t['bridge:name']) o.bn = t['bridge:name'];
  if (t.tunnel && t.tunnel !== 'no') o.tu = t.tunnel;
  if (t['tunnel:name']) o.tn = t['tunnel:name'];
  // covered=yes is a cut-and-cover section with no tunnel tag (the VCI under
  // the centre, metro station boxes, arcades); the engine draws it as covered
  if (t.covered && t.covered !== 'no') o.cv = t.covered;
  const ly = int(t.layer);
  if (ly) o.ly = ly;
  return o;
}

async function load() {
  if (!process.argv.includes('--fetch') && existsSync(RAW)) {
    const cached = JSON.parse(gunzipSync(readFileSync(RAW)).toString('utf8'));
    if (cached?.v === CACHE_V && Array.isArray(cached.els)) {
      console.log(`using cached ${RAW}`);
      return cached.els;
    }
    console.log('roads cache predates the current query; refetching');
  }
  const els = await overpass(QUERY, { label: 'roads', rounds: 4 });
  mkdirSync(dirname(RAW), { recursive: true });
  writeFileSync(RAW, gzipSync(JSON.stringify({ v: CACHE_V, els })));
  return els;
}

// Overpass returns whole ways, which can run km past the bbox. Split each way into
// runs of in-bbox points; keep one outside neighbour on each side so lines reach the edge.
const inBox = ([lat, lon]) => lat >= BBOX.s && lat <= BBOX.n && lon >= BBOX.w && lon <= BBOX.e;
function clipRuns(pts) {
  const runs = [];
  let cur = null;
  for (let i = 0; i < pts.length; i++) {
    if (inBox(pts[i])) {
      if (!cur) cur = i > 0 ? [i - 1] : [];
      cur.push(i);
    } else if (cur) {
      cur.push(i);
      runs.push(cur);
      cur = null;
    }
  }
  if (cur) runs.push(cur);
  return runs.filter((r) => r.length >= 2);
}

const elements = await load();
const ways = elements.filter((e) => e.type === 'way' && e.geometry?.length >= 2 && e.nodes?.length === e.geometry.length && kindOf(e.tags || {}));

// how many street ways use each OSM node: 2+ is a junction
const use = new Map();
for (const w of ways) {
  if (!w.tags.highway) continue;
  const seen = new Set();
  for (const id of w.nodes) {
    if (seen.has(id)) continue; // a closed way touches its first node twice
    seen.add(id);
    use.set(id, (use.get(id) || 0) + 1);
  }
}
const dense = new Map();
const nodeId = (osm) => {
  let v = dense.get(osm);
  if (v === undefined) dense.set(osm, (v = dense.size));
  return v;
};

const features = [];
const counts = {};
const structures = { bridges: [], tunnels: [] };
for (const w of ways) {
  const tags = w.tags;
  const kind = kindOf(tags);
  const t = tagsOf(tags);
  const pts = w.geometry.map((g) => [g.lat, g.lon]);
  const fine = tags.junction === 'roundabout' || tags.junction === 'circular' || /_link$/.test(tags.highway || '') || t.br || t.tu;
  const tol = fine ? 1.5 : 5;
  const isStreet = !!tags.highway;
  for (const run of clipRuns(pts)) {
    // simplify piecewise between the points that must stay: the run's ends
    // and every junction node, so shared nodes survive in both ways
    const keep = [0];
    for (let k = 1; k < run.length - 1; k++) if (isStreet && (use.get(w.nodes[run[k]]) || 0) > 1) keep.push(k);
    keep.push(run.length - 1);
    const outPts = [];
    const outIds = [];
    for (let s = 0; s < keep.length - 1; s++) {
      const a = keep[s];
      const bb = keep[s + 1];
      const piece = [];
      for (let k = a; k <= bb; k++) piece.push(k);
      const sub = simplify(piece.map((k) => pts[run[k]]), tol);
      // map simplified points back to their run indices (simplify keeps order)
      let q = 0;
      const idx = [];
      for (const k of piece) {
        if (q < sub.length && pts[run[k]] === sub[q]) {
          idx.push(k);
          q++;
        }
      }
      for (let m = s === 0 ? 0 : 1; m < idx.length; m++) {
        outPts.push(pts[run[idx[m]]]);
        outIds.push(w.nodes[run[idx[m]]]);
      }
    }
    const P = [];
    const J = [];
    for (let k = 0; k < outPts.length; k++) {
      const p = [r5(outPts[k][0]), r5(outPts[k][1])];
      const osm = outIds[k];
      const end = k === 0 || k === outPts.length - 1;
      // every feature end keeps its OSM node id (rail and light_rail have no
      // highway, but their tunnel pieces still join end to end: the engine
      // chains them with these ids so a portal is drawn only at the open air)
      const junction = end || (isStreet && (use.get(osm) || 0) > 1);
      if (P.length && P.at(-1)[0] === p[0] && P.at(-1)[1] === p[1]) {
        // rounded onto the previous point: the junction id moves there
        if (junction) {
          if (J.length && J.at(-2) === P.length - 1) J[J.length - 1] = nodeId(osm);
          else J.push(P.length - 1, nodeId(osm));
        }
        continue;
      }
      if (junction) J.push(P.length, nodeId(osm));
      P.push(p);
    }
    if (P.length < 2) continue;
    // a closed way (roundabout) ends where it starts: same node id both ends
    const f = { kind, pts: P };
    if (Object.keys(t).length) f.t = t;
    if (J.length) f.j = J;
    features.push(f);
    counts[kind] = (counts[kind] || 0) + 1;
    if (t.br || (t.ly > 0 && !t.tu)) structures.bridges.push(f);
    if (t.tu || t.cv || t.ly < 0) structures.tunnels.push(f);
  }
}
if (features.length === 0) throw new Error('No features after conversion');

// every street piece must know the nodes at both its ends
let loose = 0;
for (const f of features) {
  if (!f.t?.hw) continue;
  const j = f.j || [];
  const has = (i) => j.some((v, k) => k % 2 === 0 && v === i);
  if (!has(0) || !has(f.pts.length - 1)) loose++;
}
console.log(`street pieces without both end nodes: ${loose}`);
if (loose) throw new Error('junction ids lost');

// the named bridges of OSM (man_made=bridge outlines), for the report
const BR_RAW = cachePath('bridges-raw.json.gz');
let named = [];
try {
  if (!process.argv.includes('--fetch') && existsSync(BR_RAW)) named = JSON.parse(gunzipSync(readFileSync(BR_RAW)).toString('utf8'));
  else {
    named = await overpass(`[out:json][timeout:90];(way["man_made"="bridge"](${b});relation["man_made"="bridge"](${b}););out tags center;`, { label: 'bridges', rounds: 2, allowEmpty: true });
    writeFileSync(BR_RAW, gzipSync(JSON.stringify(named)));
  }
} catch (e) {
  console.warn(`man_made=bridge query failed: ${e.message}`);
}
if (process.argv.includes('--list')) for (const e of named) if (e.tags?.name) console.log('  NAMED', e.tags.name, e.center?.lat, e.center?.lon, e.tags['bridge:structure'] || '', e.tags.material || '');

mkdirSync(dirname(OUT), { recursive: true });
const json = JSON.stringify({ v: 2, source: '© OpenStreetMap contributors, ODbL 1.0', origin: ORIGIN, bbox: BBOX, nodes: dense.size, features });
writeFileSync(OUT, json);
console.log(`Wrote ${OUT}: ${features.length} features, ${dense.size} junction nodes, ${(json.length / 1024 / 1024).toFixed(2)} MB`, counts);
const label = (f) => `${f.kind}/${f.t.hw || f.t.rw || f.t.ww} ${f.t.name || f.t.bn || f.t.tn || ''} ${f.t.ref || ''} br=${f.t.br || ''} tu=${f.t.tu || ''} cv=${f.t.cv || ''} ly=${f.t.ly ?? ''}`.replace(/\s+/g, ' ');
const roadT = features.filter((f) => f.t?.hw && f.t.tu && f.t.tu !== 'building_passage' && f.t.tu !== 'covered');
const coveredT = features.filter((f) => f.t?.hw && ((f.t.tu === 'building_passage' || f.t.tu === 'covered') || (!f.t.tu && f.t.cv)));
const metroT = features.filter((f) => f.kind === 'rail' && f.t?.rw === 'light_rail' && (f.t.tu || f.t.cv));
const railT = features.filter((f) => f.kind === 'rail' && f.t?.rw !== 'light_rail' && f.t?.tu);
console.log(`bridges ${structures.bridges.length}, tunnel-tagged ways ${structures.tunnels.length}`);
console.log(`  road tunnels (bored) ${roadT.length}, covered/cut-and-cover ${coveredT.length}, metro (light_rail) ${metroT.length}, CP rail ${railT.length}`);
if (process.argv.includes('--list')) {
  for (const f of structures.bridges) console.log('  B', label(f), f.pts[0]);
  for (const f of structures.tunnels) console.log('  T', label(f), f.pts[0]);
}
