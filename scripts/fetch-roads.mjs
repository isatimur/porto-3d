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

// ---- open water (data/nature.json areas with `o`: the Douro and the sea)
// Pedestrian areas whose outline runs past the quay edge (Massarelos, Cais da
// Ribeira) are cut at the waterline and the part on the water dropped: their
// ribbon lay on the river. A cut end gets a node id of its own (a dead end),
// so every street piece still knows both its ends. River lines stay whole:
// road-network.js finds the river under a bridge by them.
function cutAtOpenWater() {
  const NATURE = dataPath('nature.json');
  if (!existsSync(NATURE)) {
    console.warn(`no ${NATURE}: quay pedestrian outlines not cut at the waterline (run fetch-nature, then fetch-roads again)`);
    return { ped: 0, pedM: 0 };
  }
  const nature = JSON.parse(readFileSync(NATURE, 'utf8'));
  const MO = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
  const ML = 110574;
  const xy = (p) => [(p[1] - ORIGIN.lon) * MO, (p[0] - ORIGIN.lat) * ML];
  const ll = (q) => [r5(ORIGIN.lat + q[1] / ML), r5(ORIGIN.lon + q[0] / MO)];
  const polys = (nature.areas || [])
    .filter((a) => a.k === 'water' && a.o)
    .map((a) => {
      const rings = a.r.map((r) => r.map(xy));
      const o = rings[0];
      return { rings, x0: Math.min(...o.map((p) => p[0])), x1: Math.max(...o.map((p) => p[0])), z0: Math.min(...o.map((p) => p[1])), z1: Math.max(...o.map((p) => p[1])) };
    });
  const inRing = (r, x, z) => {
    let s = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i];
      const c = r[j];
      if (a[1] > z !== c[1] > z && x < ((c[0] - a[0]) * (z - a[1])) / (c[1] - a[1]) + a[0]) s = !s;
    }
    return s;
  };
  const wet = (x, z) => polys.some((P) => x >= P.x0 && x <= P.x1 && z >= P.z0 && z <= P.z1 && inRing(P.rings[0], x, z) && !P.rings.slice(1).some((h) => inRing(h, x, z)));
  // where segment a-b crosses a ring edge: the parameters along a-b
  const cutsOf = (a, b) => {
    const ts = [];
    const bx0 = Math.min(a[0], b[0]);
    const bx1 = Math.max(a[0], b[0]);
    const bz0 = Math.min(a[1], b[1]);
    const bz1 = Math.max(a[1], b[1]);
    for (const P of polys) {
      if (bx1 < P.x0 || bx0 > P.x1 || bz1 < P.z0 || bz0 > P.z1) continue;
      for (const r of P.rings) {
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const c = r[j];
          const d = r[i];
          if (Math.max(c[0], d[0]) < bx0 || Math.min(c[0], d[0]) > bx1 || Math.max(c[1], d[1]) < bz0 || Math.min(c[1], d[1]) > bz1) continue;
          const rx = b[0] - a[0];
          const rz = b[1] - a[1];
          const sx = d[0] - c[0];
          const sz = d[1] - c[1];
          const den = rx * sz - rz * sx;
          if (Math.abs(den) < 1e-12) continue;
          const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den;
          const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
          if (t > 1e-6 && t < 1 - 1e-6 && u >= 0 && u <= 1) ts.push(t);
        }
      }
    }
    return ts.sort((p, q) => p - q);
  };
  const MIN_M = 3; // a wet or dry stretch shorter than this joins its neighbours
  // runs of a polyline on and off the open water: [{ wet, pts: [{ p, k }] }],
  // k the index in f.pts (-1 for a cut point); neighbouring runs share their cut point
  const runsOf = (pts) => {
    const X = pts.map(xy);
    const seq = [{ p: pts[0], q: X[0], k: 0 }];
    for (let i = 1; i < pts.length; i++) {
      for (const t of cutsOf(X[i - 1], X[i])) {
        const q = [X[i - 1][0] + (X[i][0] - X[i - 1][0]) * t, X[i - 1][1] + (X[i][1] - X[i - 1][1]) * t];
        seq.push({ p: ll(q), q, k: -1 });
      }
      seq.push({ p: pts[i], q: X[i], k: i });
    }
    const runs = [];
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1].q;
      const b = seq[i].q;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-6) continue;
      const w = wet((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      const last = runs.at(-1);
      if (last && last.wet === w) {
        last.pts.push(seq[i]);
        last.m += L;
      } else runs.push({ wet: w, m: L, pts: [seq[i - 1], seq[i]] });
    }
    // short stretches take their neighbours' side, then equal sides join
    for (const r of runs) if (r.m < MIN_M && runs.length > 1) r.wet = !r.wet;
    const out = [];
    for (const r of runs) {
      const last = out.at(-1);
      if (last && last.wet === r.wet) {
        last.pts.push(...r.pts.slice(1));
        last.m += r.m;
      } else out.push({ ...r, pts: [...r.pts] });
    }
    return out;
  };
  // a cut end's node id, shared by the two runs that meet there
  const endIds = new Map();
  const endId = (p) => {
    const key = `${p[0]},${p[1]}`;
    if (!endIds.has(key)) endIds.set(key, nodeId(`cut:${key}`));
    return endIds.get(key);
  };
  const piece = (f, run, t) => {
    const idOf = new Map();
    for (let k = 0; k + 1 < (f.j || []).length; k += 2) idOf.set(f.j[k], f.j[k + 1]);
    const P = [];
    const J = [];
    const last = run.pts.length - 1;
    run.pts.forEach((s, i) => {
      let id = s.k >= 0 ? idOf.get(s.k) : undefined;
      if (id === undefined && (i === 0 || i === last)) id = endId(s.p);
      if (P.length && P.at(-1)[0] === s.p[0] && P.at(-1)[1] === s.p[1]) {
        // rounded onto the previous point: it takes the id if it has none
        if (id !== undefined && J.at(-2) !== P.length - 1) J.push(P.length - 1, id);
        return;
      }
      if (id !== undefined) J.push(P.length, id);
      P.push(s.p);
    });
    if (P.length < 2) return null;
    const g = { kind: f.kind, pts: P };
    if (Object.keys(t).length) g.t = t;
    if (J.length) g.j = J;
    return g;
  };
  const st = { ped: 0, pedM: 0 };
  const out = [];
  for (const f of features) {
    const t = f.t || {};
    const ped = f.kind === 'minor' && t.hw === 'pedestrian' && !t.br && !t.tu && !t.cv && !t.ly;
    const runs = ped ? runsOf(f.pts) : null;
    if (!runs || !runs.some((r) => r.wet)) {
      out.push(f);
      continue;
    }
    for (const r of runs) {
      if (r.wet) {
        st.ped++;
        st.pedM += r.m;
        continue;
      }
      const g = piece(f, r, t);
      if (g) out.push(g);
    }
  }
  features.length = 0;
  features.push(...out);
  return st;
}
const wetCut = cutAtOpenWater();
console.log(`open water: ${wetCut.ped} pedestrian runs (${Math.round(wetCut.pedM)} m) cut off at the waterline`);

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
