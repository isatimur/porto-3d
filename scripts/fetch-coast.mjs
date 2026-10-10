// Fetch the real coast of the city from OpenStreetMap and write <data dir>/coast.json.
// Node 22, no dependencies. Run: node scripts/fetch-coast.mjs [--city porto] [--refresh] [--dry-run]
//
// Sources over the wide bbox (cities/<id>.json): natural=coastline (the sea
// and its islets), natural=beach|sand|bare_rock|reef, man_made=breakwater|
// groyne|pier|quay|lighthouse|jetty, leisure=marina, harbour, landuse=port.
// The raw reply is cached in <data dir>/.cache/coast-raw.json (resume-able:
// --refresh refetches; a failed part is retried on the next run).
//
// Output (data/coast.json), all positions as [lat, lon] rounded to 5 decimals:
//   sea     one closed ring (clockwise: the sea on the right of the line, the
//           coast chains joined end to end, closed along the wide bbox) per sea
//           body, Douglas-Peucker 2 m; holes are the islets (land rings).
//   holes   islet rings inside the sea.
//   walls   breakwaters, groynes, moles: { id, k, n?, p:[[lat,lon]...], w? }
//   piers   piers, jetties, pontoons and quays that stand in the water.
//   lights  lighthouses: { id, n?, lat, lon, h?, r? (range, nm) }
//   beaches, rocks, marinas, ports   closed rings (and names).
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CITY, WIDE_BBOX as WB, overpass, toXY, toLL, dataPath, cachePath, dataRel, simplify, r5, wait } from './geo-lib.mjs';

const OUT = dataPath('coast.json');
const CACHE = cachePath('coast-raw.json');
const REFRESH = process.argv.includes('--refresh');
const TOL_M = 2;

if (process.argv.includes('--dry-run')) {
  console.log(`out ${dataRel('coast.json')}; cache ${dataRel('.cache', 'coast-raw.json')}; bbox ${JSON.stringify(WB)}`);
  process.exit(0);
}

// Three queries so that a slow mirror loses one part, not all of them.
const bb = (b) => `${b.s},${b.w},${b.n},${b.e}`;
// Harbour water that OSM does not draw as water: the outer harbour of Leixoes is a
// landuse polygon ("Porto de Leixoes"), the coastline runs round it, so the sea
// polygon leaves it out. cities/<id>.json `coast_basins` lists those ways; the
// default is Porto's.
const BASIN_WAYS = CITY.coast_basins || ['w972678976'];
const PARTS = {
  basins: `[out:json][timeout:120];(${BASIN_WAYS.map((id) => `way(id:${id.slice(1)});`).join('')});out tags geom;`,
  coast: `[out:json][timeout:180];(way["natural"="coastline"](${bb(WB)}););out tags geom;`,
  structures: `[out:json][timeout:180];(
  nwr["man_made"~"^(breakwater|groyne|pier|quay|lighthouse|jetty)$"](${bb(WB)});
  nwr["seamark:type"~"^(light_minor|light_major|harbour)$"](${bb(WB)});
  nwr["leisure"="marina"](${bb(WB)});
  way["landuse"="port"](${bb(WB)});
  way["harbour"="yes"](${bb(WB)});
  relation["landuse"="port"](${bb(WB)});
);out tags geom;`,
  shore: `[out:json][timeout:180];(
  nwr["natural"~"^(beach|sand|bare_rock|reef|shoal)$"](${bb(WB)});
  way["natural"="cliff"](${bb(WB)});
);out tags geom;`,
};

async function raw() {
  let cache = {};
  if (!REFRESH && existsSync(CACHE)) cache = JSON.parse(readFileSync(CACHE, 'utf8'));
  for (const [name, q] of Object.entries(PARTS)) {
    if (cache[name]) {
      console.log(`cache hit ${name} (${cache[name].length} elements)`);
      continue;
    }
    cache[name] = await overpass(q, { label: name, allowEmpty: true });
    mkdirSync(dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, JSON.stringify(cache));
    await wait(1500);
  }
  return cache;
}

// ---- geometry helpers (all in [lat, lon]; metres through toXY)
const geomOf = (el) => (el.geometry || []).map((g) => [g.lat, g.lon]);
const inBox = ([lat, lon]) => lat >= WB.s && lat <= WB.n && lon >= WB.w && lon <= WB.e;
const key = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
const closedPts = (p) => p.length > 3 && key(p[0]) === key(p.at(-1));
const tagNum = (v) => {
  if (v == null) return null;
  const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

// Liang-Barsky: clip a segment (planar lon/lat) to the wide bbox; null when outside.
function clipSeg(a, b) {
  let t0 = 0;
  let t1 = 1;
  const dx = b[1] - a[1];
  const dy = b[0] - a[0];
  const test = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!test(-dx, a[1] - WB.w) || !test(dx, WB.e - a[1]) || !test(-dy, a[0] - WB.s) || !test(dy, WB.n - a[0])) return null;
  return [
    [a[0] + dy * t0, a[1] + dx * t0, t0 > 0],
    [a[0] + dy * t1, a[1] + dx * t1, t1 < 1],
  ];
}

// join way pieces end to end by shared endpoints (direction kept: land on the left)
function joinChains(ways) {
  const starts = new Map();
  for (const w of ways) {
    const k = key(w[0]);
    if (!starts.has(k)) starts.set(k, []);
    starts.get(k).push(w);
  }
  const used = new Set();
  const chains = [];
  const endsAt = new Set(ways.map((w) => key(w.at(-1))));
  // start from pieces that nothing leads into, then the remaining loops
  const order = [...ways.filter((w) => !endsAt.has(key(w[0]))), ...ways];
  for (const w of order) {
    if (used.has(w)) continue;
    let chain = w.slice();
    used.add(w);
    for (;;) {
      if (key(chain[0]) === key(chain.at(-1)) && chain.length > 3) break;
      const next = (starts.get(key(chain.at(-1))) || []).find((n) => !used.has(n));
      if (!next) break;
      used.add(next);
      chain = chain.concat(next.slice(1));
    }
    chains.push(chain);
  }
  return chains;
}

// perimeter parameter of a point on the wide bbox edge, clockwise from the SW corner:
// west edge going north, north edge going east, east edge going south, south edge going west
function perim(p) {
  const w = WB.n - WB.s;
  const h = WB.e - WB.w;
  const eps = 1e-9;
  if (Math.abs(p[1] - WB.w) < eps) return (p[0] - WB.s) / w; // west: 0..1
  if (Math.abs(p[0] - WB.n) < eps) return 1 + (p[1] - WB.w) / h; // north: 1..2
  if (Math.abs(p[1] - WB.e) < eps) return 2 + (WB.n - p[0]) / w; // east: 2..3
  return 3 + (WB.e - p[1]) / h; // south: 3..4
}
const CORNERS = [
  [1, [WB.n, WB.w]],
  [2, [WB.n, WB.e]],
  [3, [WB.s, WB.e]],
  [4, [WB.s, WB.w]],
];

// Sea rings: land on the left of the coast (OSM), so the sea lies to the right
// and the ring runs clockwise, closing along the bbox clockwise as well.
function buildSea(coastWays) {
  // clip the chains to the bbox: runs inside it, entry/exit on the edge
  const runs = [];
  const islets = [];
  for (const chain of joinChains(coastWays)) {
    if (closedPts(chain) && chain.every(inBox)) {
      islets.push(chain);
      continue;
    }
    let cur = null;
    for (let i = 0; i + 1 < chain.length; i++) {
      const c = clipSeg(chain[i], chain[i + 1]);
      if (!c) {
        if (cur) runs.push(cur);
        cur = null;
        continue;
      }
      const [a, b] = c;
      if (!cur || a[2]) {
        if (cur) runs.push(cur);
        cur = [[a[0], a[1]]];
      }
      cur.push([b[0], b[1]]);
      if (b[2]) {
        runs.push(cur);
        cur = null;
      }
    }
    if (cur) runs.push(cur);
  }
  const open = runs.filter((r) => r.length >= 2);
  console.log(`coast: ${coastWays.length} ways, ${open.length} runs across the bbox, ${islets.length} closed islets`);
  if (!open.length) throw new Error('no open coastline run: cannot close the sea');
  const rings = [];
  const entries = open.map((r, i) => ({ i, t: perim(r[0]) })).sort((a, b) => a.t - b.t);
  const taken = new Set();
  for (const e0 of entries) {
    if (taken.has(e0.i)) continue;
    const ring = [];
    let cur = e0.i;
    for (let guard = 0; guard < 100; guard++) {
      taken.add(cur);
      const run = open[cur];
      ring.push(...run);
      const tEnd = perim(run.at(-1));
      // next entry clockwise (increasing t, wrapping at 4)
      let best = null;
      for (const e of entries) {
        const d = (e.t - tEnd + 4) % 4;
        if (!best || d < best.d) best = { e, d };
      }
      const nxt = best.e;
      // corners between tEnd and the next entry
      const span = (nxt.t - tEnd + 4) % 4;
      const between = CORNERS.map(([ct, cp]) => ({ dc: (ct - tEnd + 4) % 4, cp }))
        .filter((c) => c.dc > 1e-9 && c.dc < span)
        .sort((a, b) => a.dc - b.dc);
      for (const c of between) ring.push(c.cp);
      if (nxt.i === e0.i) break;
      if (taken.has(nxt.i)) break;
      cur = nxt.i;
    }
    rings.push(ring);
  }
  return { rings, islets };
}

const polyM2 = (ring) => {
  const xy = ring.map(toXY);
  let a = 0;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) a += xy[j][0] * xy[i][1] - xy[i][0] * xy[j][1];
  return a / 2;
};

// simplify a closed ring (not splitting at corners; the ring is long, so DP on
// two halves keeps the shape and the bbox corners)
function simplifyClosed(ring, tol) {
  const pts = ring.slice();
  if (key(pts[0]) === key(pts.at(-1))) pts.pop();
  const half = Math.floor(pts.length / 2);
  const a = simplify(pts.slice(0, half + 1), tol);
  const b = simplify([...pts.slice(half), pts[0]], tol);
  return [...a, ...b.slice(1, -1)];
}

const keepName = (t) => t.name || t['name:pt'] || t['name:en'] || undefined;

async function main() {
  const cache = await raw();
  const all = [...(cache.coast || []), ...(cache.structures || []), ...(cache.shore || [])];
  const byId = new Map();
  for (const el of all) byId.set(`${el.type[0]}${el.id}`, el);
  // a multipolygon relation becomes one pseudo way per outer ring (the member
  // ways of role "outer" joined end to end); inner rings are ignored
  const els = [];
  for (const el of byId.values()) {
    if (el.type !== 'relation') {
      els.push(el);
      continue;
    }
    const outer = (el.members || []).filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry?.length >= 2).map((m) => m.geometry.map((g) => [g.lat, g.lon]));
    joinChains(outer).forEach((ring, i) => {
      if (ring.length >= 4) els.push({ type: 'way', id: `${el.id}_${i}`, tags: el.tags, geometry: ring.map(([lat, lon]) => ({ lat, lon })), fromRelation: true });
    });
  }

  // ---- the sea
  const coastWays = els.filter((e) => e.type === 'way' && e.tags?.natural === 'coastline').map(geomOf).filter((g) => g.length >= 2);
  const { rings, islets } = buildSea(coastWays);
  const sea = [];
  for (const r of rings) {
    const s = simplifyClosed(r, TOL_M);
    const area = polyM2(s);
    console.log(`sea ring: ${r.length} -> ${s.length} points, ${(area / 1e6).toFixed(2)} km2 (${area < 0 ? 'clockwise' : 'counter-clockwise'} in x/y)`);
    sea.push(s.map(([a, b]) => [r5(a), r5(b)]));
  }
  const holes = islets
    .map((r) => simplifyClosed(r, TOL_M))
    .filter((r) => r.length >= 4 && Math.abs(polyM2(r)) > 30)
    .map((r) => r.map(([a, b]) => [r5(a), r5(b)]));

  // ---- structures
  const walls = [];
  const piers = [];
  const lights = [];
  const seamarks = [];
  const beaches = [];
  const rocks = [];
  const marinas = [];
  const ports = [];
  const lineOf = (el) => simplify(geomOf(el), 1.2).map(([a, b]) => [r5(a), r5(b)]);
  const ringOf = (el) => {
    const g = geomOf(el);
    if (g.length < 4) return null;
    return simplifyClosed(g, 1.5).map(([a, b]) => [r5(a), r5(b)]);
  };
  for (const el of els) {
    const t = el.tags || {};
    const id = `${el.type[0]}${el.id}`;
    const n = keepName(t);
    const isNode = el.type === 'node';
    const pos = isNode ? [el.lat, el.lon] : el.type === 'way' && el.geometry ? geomOf(el)[0] : null;
    if (!pos || !inBox(pos)) continue;
    if (t.man_made === 'lighthouse' || t['seamark:type'] === 'light_major' || t['seamark:type'] === 'light_minor') {
      const g = isNode ? [el.lat, el.lon] : geomOf(el).reduce((s, p, _, a) => [s[0] + p[0] / a.length, s[1] + p[1] / a.length], [0, 0]);
      const L = { id, n, lat: r5(g[0]), lon: r5(g[1]), h: tagNum(t.height) ?? tagNum(t['seamark:light:height']) ?? undefined, ele: tagNum(t.ele) ?? undefined, r: tagNum(t['seamark:light:range']) ?? undefined, wd: t.wikidata, way: !isNode, mm: t.man_made === 'lighthouse' };
      seamarks.push(L);
      continue;
    }
    if (el.type !== 'way') continue;
    const g = geomOf(el);
    if (t.man_made === 'breakwater' || t.man_made === 'groyne') {
      walls.push({ id, k: t.man_made === 'groyne' ? 'groyne' : 'breakwater', n, p: lineOf(el), closed: closedPts(g) || undefined, w: tagNum(t.width) ?? undefined, ele: tagNum(t.ele) ?? undefined });
    } else if (t.man_made === 'pier' || t.man_made === 'jetty' || t.man_made === 'quay') {
      piers.push({ id, k: t.man_made, n, p: lineOf(el), closed: closedPts(g) || undefined, w: tagNum(t.width) ?? undefined, floating: t.floating === 'yes' || t.pier === 'floating' || undefined });
    } else if (t.natural === 'beach' || t.natural === 'sand') {
      const r = ringOf(el);
      if (r && closedPts(g)) beaches.push({ id, n, r, surface: t.surface });
    } else if (t.natural === 'bare_rock' || t.natural === 'reef' || t.natural === 'shoal') {
      const r = ringOf(el);
      if (r && closedPts(g)) rocks.push({ id, k: t.natural, r });
    } else if (t.leisure === 'marina') {
      const r = ringOf(el);
      if (r) marinas.push({ id, n, r });
    } else if (t.landuse === 'port' || t.harbour === 'yes') {
      const r = ringOf(el);
      if (r) ports.push({ id, n, r });
    }
  }

  // lighthouses: every man_made=lighthouse feature stays (never merged with another one); a
  // seamark-only light folds into a lighthouse within 40 m, else it is a light of its own.
  // A merge only fills what the lighthouse lacks (never a name or a position).
  const near = (a, b) => Math.hypot((a.lat - b.lat) * 111000, (a.lon - b.lon) * 83500);
  const nMm = seamarks.filter((s) => s.mm).length;
  for (const L of seamarks.filter((s) => s.mm)) {
    // the same tower mapped twice (a node inside a way, same name): one feature
    const twin = lights.find((h) => h.n && h.n === L.n && near(h, L) < 60);
    if (twin) {
      for (const k of ['h', 'ele', 'r', 'wd']) if (twin[k] == null && L[k] != null) twin[k] = L[k];
    } else lights.push(L);
  }
  for (const L of seamarks.filter((s) => !s.mm)) {
    const host = lights.find((h) => near(h, L) < 40);
    if (host) {
      for (const k of ['n', 'h', 'ele', 'r', 'wd']) if (host[k] == null && L[k] != null) host[k] = L[k];
    } else lights.push(L);
  }
  for (const L of lights) delete L.mm;
  console.log(`lights: ${nMm} man_made=lighthouse features, ${lights.length} distinct lights in the file`);

  // harbour basins (water the coastline leaves out): the listed ways and the marinas of the
  // Leixoes area, each grown by 25 m so that they overlap the sea at the harbour mouth
  const growRing = (ll, m) => {
    let pts = ll.map(toXY);
    if (pts.length > 1 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 0.01) pts.pop();
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    const sgn = a > 0 ? 1 : -1;
    const nrm = (u, v) => {
      const l = Math.hypot(v[0] - u[0], v[1] - u[1]) || 1;
      return [((v[1] - u[1]) / l) * sgn, (-(v[0] - u[0]) / l) * sgn];
    };
    return pts.map((p, i) => {
      const n1 = nrm(pts[(i + pts.length - 1) % pts.length], p);
      const n2 = nrm(p, pts[(i + 1) % pts.length]);
      const k = Math.max(0.4, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
      let mx = ((n1[0] + n2[0]) / k) * m;
      let my = ((n1[1] + n2[1]) / k) * m;
      const l = Math.hypot(mx, my);
      if (l > 2 * m) {
        mx = (mx / l) * 2 * m;
        my = (my / l) * 2 * m;
      }
      const [lat, lon] = toLL([p[0] + mx, p[1] + my]);
      return [r5(lat), r5(lon)];
    });
  };
  const basins = [];
  for (const el of cache.basins || []) {
    const g = geomOf(el);
    if (g.length >= 4) basins.push({ id: `w${el.id}`, n: keepName(el.tags || {}), r: growRing(g, 25) });
  }
  for (const mr of marinas) {
    const lat = mr.r.reduce((s, p) => s + p[0], 0) / mr.r.length;
    if (lat > 41.165 && lat < 41.215) basins.push({ id: mr.id, n: mr.n, r: growRing(mr.r, 15) });
  }

  // The coast profile the water shader still reads (data/nature.json `coast`,
  // ascending latitude, at most 256 slots): per 0.001 deg latitude band the
  // easternmost point of the real coast (the frame of the bbox is no coast).
  const profile = [];
  {
    const BIN = 0.001;
    const rows = new Map();
    const onFrameLL = ([lat, lon]) => lat <= WB.s + 1e-6 || lat >= WB.n - 1e-6 || lon <= WB.w + 1e-6 || lon >= WB.e - 1e-6;
    for (const [lat, lon] of sea[0]) {
      if (onFrameLL([lat, lon])) continue;
      const k = Math.round(lat / BIN);
      const cur = rows.get(k);
      if (cur == null || lon > cur) rows.set(k, lon);
    }
    const keys = [...rows.keys()].sort((a, b) => a - b);
    let last = null;
    for (let k = keys[0]; k <= keys.at(-1); k++) {
      const lon = rows.get(k) ?? last;
      if (lon == null) continue;
      last = lon;
      profile.push([r5(k * BIN), r5(lon)]);
    }
  }

  const out = {
    source: 'OpenStreetMap contributors (ODbL), Overpass',
    fetched: new Date().toISOString().slice(0, 10),
    bbox: WB,
    sea,
    profile,
    basins,
    holes,
    walls,
    piers,
    lights,
    beaches,
    rocks,
    marinas,
    ports,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  const text = JSON.stringify(out);
  writeFileSync(OUT, text);
  // the sea of data/nature.json (area "sea" and the coast profile) follows the real coast
  const NATURE = dataPath('nature.json');
  if (existsSync(NATURE) && !process.argv.includes('--no-apply')) {
    const nat = JSON.parse(readFileSync(NATURE, 'utf8'));
    const keep = nat.areas.filter((a) => a.id !== 'sea' && !String(a.id).startsWith('basin-'));
    const seaAreas = sea.map((ring, i) => ({ k: 'water', id: 'sea', r: [ring, ...(i === 0 ? holes : [])], o: 1 }));
    const basinAreas = basins.map((b) => ({ k: 'water', id: `basin-${b.id}`, r: [b.r], o: 1 }));
    nat.areas = keep.concat(basinAreas, seaAreas);
    if (profile.length >= 2) nat.coast = profile.slice(0, 256);
    writeFileSync(NATURE, JSON.stringify(nat));
    console.log(`patched ${dataRel('nature.json')}: sea ${sea[0].length} points + ${holes.length} islets + ${basins.length} harbour basins, coast profile ${Math.min(256, profile.length)} bins`);
  }
  const pts = (a) => a.reduce((s, x) => s + (x.p || x.r || []).length, 0);
  console.log(
    `wrote ${dataRel('coast.json')}: ${(text.length / 1024).toFixed(1)} KB; sea ${sea.length} ring(s) ${sea.reduce((s, r) => s + r.length, 0)} pts, holes ${holes.length}, walls ${walls.length} (${pts(walls)} pts), piers ${piers.length} (${pts(piers)} pts), lights ${lights.length}, beaches ${beaches.length}, rocks ${rocks.length}, marinas ${marinas.length}, ports ${ports.length}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
