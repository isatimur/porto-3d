// Street trees, avenue rows and hedges from OpenStreetMap (data/trees.json,
// written by scripts/fetch-trees.mjs). src/nature.js plants them into its
// own instanced tree meshes and billboards, so they cost no draw call of
// their own: they sway, turn with the seasons and switch to billboards
// like every other tree.
//
// What goes in:
//   - every mapped tree (natural=tree) that stands clear of the carriageway,
//     the buildings, the water and the landmarks;
//   - the mapped tree rows (natural=tree_row), one tree every ROW_M;
//   - the main avenues where OSM maps few trees (Boavista, the Foz
//     seafront, Marechal Gomes da Costa...): a row on each pavement;
//   - the mapped hedges (barrier=hedge), as clipped evergreen blocks.
// OSM names a genus for one tree in ten, so the species of the rest follows
// the street and the district: plane trees on the Avenida da Boavista,
// palms along the Foz seafront, limes on the Aliados, evergreen privet and
// magnolia in the side streets, jacaranda accents in the centre.
import { assetUrl } from './data.js';
import { dataPath } from './city.js';
import { CLASS } from './road-network.js';
import { S } from './geo.js';

// species indices of src/nature.js (SPECIES there)
const PINE = 0;
const EUCALYPTUS = 1;
const BROAD = 2; // plane, hackberry, oak, maple
const CYPRESS = 5;
const LIME = 6;
const PALM = 7;
const WILLOW = 9;
const POPLAR = 10;
const JACARANDA = 12;
const HEDGE_SP = 14; // a clipped hedge block
// tree flags (nature.js aTint.w): an evergreen crown, a stiff clipped hedge
export const EVERGREEN = 1;
export const HEDGE = 2;

// scripts/fetch-trees.mjs KINDS -> [species, flag]
const KIND_SPECIES = [
  [BROAD, 0], // broadleaf (or untagged)
  [LIME, 0],
  [JACARANDA, 0],
  [PALM, 0],
  [PINE, 0],
  [EUCALYPTUS, 0],
  [CYPRESS, 0],
  [BROAD, EVERGREEN], // magnolia, privet, olive, holm oak
  [POPLAR, 0],
  [WILLOW, 0],
];
// Mature street-tree heights in metres, by [species, flag]
const HEIGHT = {
  [BROAD]: [11, 21],
  [LIME]: [9, 16],
  [JACARANDA]: [7, 12],
  [PALM]: [8, 16],
  [PINE]: [10, 17],
  [EUCALYPTUS]: [16, 26],
  [CYPRESS]: [8, 14],
  [POPLAR]: [14, 22],
  [WILLOW]: [8, 13],
};
const EVERGREEN_H = [6, 11];

// Avenues: the species the street is planted with, and whether to plant a
// row on each pavement where OSM maps no trees there. `[species, flag, w]`.
const E = EVERGREEN;
const AVENUES = [
  // plane trees the whole way from the Rotunda to the sea
  { re: /^Avenida da Boavista$/, mix: [[BROAD, 0, 0.88], [LIME, 0, 0.12]], rows: 11 },
  // the Foz seafront: palms, with pohutukawa and tamarisk (evergreen)
  { re: /^(Avenida do Brasil|Avenida de Montevideu|Avenida Dom Carlos I|Rua do Passeio Alegre|Esplanada do Castelo|Rua do Coronel Raúl Peres)$/, mix: [[PALM, 0, 0.7], [BROAD, E, 0.3]], rows: 13 },
  { re: /^Avenida (d[oa] )?(Marechal Gomes da Costa|Boa Nova)$/, mix: [[BROAD, 0, 0.55], [LIME, 0, 0.45]], rows: 12 },
  { re: /^Avenida dos Aliados$|^Praça da Liberdade$|^Praça do General Humberto Delgado$/, mix: [[LIME, 0, 0.7], [BROAD, 0, 0.3]] },
  { re: /^Avenida da República$/, mix: [[BROAD, 0, 0.6], [BROAD, E, 0.25], [JACARANDA, 0, 0.15]], rows: 12 },
  { re: /^Avenida de (França|Fernão de Magalhães|Rodrigues de Freitas)$|^Rua de Júlio Dinis$/, mix: [[BROAD, 0, 0.55], [JACARANDA, 0, 0.25], [LIME, 0, 0.2]] },
  { re: /^Avenida da Anémona$|^Avenida Norton de Matos$/, mix: [[PALM, 0, 0.4], [PINE, 0, 0.25], [BROAD, E, 0.35]] },
];
// Districts, for the trees beside an unnamed or ordinary street.
const DISTRICTS = [
  // Foz and Nevogilde: palms, pohutukawa, cypress
  { lat: 41.153, lon: -8.674, r: 1500, mix: [[PALM, 0, 0.32], [BROAD, E, 0.33], [BROAD, 0, 0.25], [CYPRESS, 0, 0.1]] },
  // Gaia south bank: plane, evergreen privet and magnolia, a few cypress
  { lat: 41.131, lon: -8.612, r: 2200, mix: [[BROAD, 0, 0.45], [BROAD, E, 0.33], [CYPRESS, 0, 0.12], [JACARANDA, 0, 0.1]] },
];
const DEFAULT_MIX = [[BROAD, 0, 0.55], [LIME, 0, 0.17], [BROAD, E, 0.18], [JACARANDA, 0, 0.1]];

const ROW_M = 9; // metres between trees in a tree row
const M_LAT = 111320; // scripts/geo-lib.mjs toXY

// The file, or null (a missing file only means no street trees).
export function loadStreetTrees() {
  return fetch(assetUrl(dataPath('trees.json')))
    .then((r) => (r.ok && (r.headers.get('content-type') || '').includes('json') ? r.json() : null))
    .catch(() => null);
}

function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const hash2 = (x, y) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};
function pick(mix, r) {
  let total = 0;
  for (const m of mix) total += m[2];
  let acc = 0;
  for (const m of mix) {
    acc += m[2] / total;
    if (r < acc) return m;
  }
  return mix[mix.length - 1];
}

// The carriageway width of a road feature in metres (road-network.js CLASS).
function carriagewayM(f) {
  const c = CLASS[f.t?.hw];
  if (!c) return f.kind === 'foot' ? 2 : f.kind === 'rail' ? 4 : 5;
  const lanes = f.t?.ln || (f.t?.ow ? c.oneWay : c.lanes);
  return c.laneM * lanes + c.extraM;
}

// Plant the file. ctx: { doc, project, heightAt, roads, inside(x, z),
// blocked(x, z) (carriageway, buildings, water, landmarks), mobile }.
// Returns tree records in nature.js form, without the tint:
//   { x, y, z, h, s, rot, phase, f, st: 1, sx?, sz? }
export function plantStreetTrees(ctx) {
  const { doc, project, heightAt, roads, inside, blocked, mobile } = ctx;
  const out = { trees: [], hedges: [], walks: [], stats: { mapped: 0, rows: 0, avenue: 0, hedges: 0, rejected: 0 } };
  if (!doc || !Array.isArray(doc.t)) return out;
  const q = doc.q || 1;
  const o = doc.origin;
  const mLon = M_LAT * Math.cos((o.lat * Math.PI) / 180);
  const toWorld = (qx, qy) => project(o.lat + (qy * q) / M_LAT, o.lon + (qx * q) / mLon);
  const line = (arr, from = 0) => {
    const pts = [];
    let x = 0;
    let y = 0;
    for (let i = from; i + 1 < arr.length; i += 2) {
      x += arr[i];
      y += arr[i + 1];
      pts.push(toWorld(x, y));
    }
    return pts;
  };
  const rnd = lcg(20261010);

  // ---- named roads in a grid, for the street a tree stands beside
  const CELL = 12; // world units (48 m)
  const grid = new Map();
  const gkey = (i, j) => i * 73856093 ^ j * 19349663;
  const segs = [];
  for (const f of roads?.features || []) {
    if (!Array.isArray(f.pts) || f.pts.length < 2 || f.kind === 'rail' || f.kind === 'water') continue;
    const name = f.t?.name || '';
    const avenue = name ? AVENUES.find((a) => a.re.test(name)) || null : null;
    const pts = f.pts.map((p) => project(p[0], p[1]));
    const half = (carriagewayM(f) / 2) * S;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const seg = { a, b, avenue, half, f };
      const k = segs.push(seg) - 1;
      const i0 = Math.floor(Math.min(a.x, b.x) / CELL);
      const i1 = Math.floor(Math.max(a.x, b.x) / CELL);
      const j0 = Math.floor(Math.min(a.z, b.z) / CELL);
      const j1 = Math.floor(Math.max(a.z, b.z) / CELL);
      for (let gi = i0; gi <= i1; gi++) {
        for (let gj = j0; gj <= j1; gj++) {
          const key = gkey(gi, gj);
          let list = grid.get(key);
          if (!list) grid.set(key, (list = []));
          list.push(k);
        }
      }
    }
  }
  const segDist = (s, x, z) => {
    const dx = s.b.x - s.a.x;
    const dz = s.b.z - s.a.z;
    const l2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - s.a.x) * dx + (z - s.a.z) * dz) / l2));
    return Math.hypot(x - s.a.x - dx * t, z - s.a.z - dz * t);
  };
  // the nearest road within `reach` world units
  const nearestRoad = (x, z, reach) => {
    let best = null;
    let bd = reach;
    const gi = Math.floor(x / CELL);
    const gj = Math.floor(z / CELL);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const k of grid.get(gkey(gi + di, gj + dj)) || []) {
          const d = segDist(segs[k], x, z);
          if (d < bd) {
            bd = d;
            best = segs[k];
          }
        }
      }
    }
    return best;
  };
  const districts = DISTRICTS.map((d) => ({ ...project(d.lat, d.lon), r: d.r * S, mix: d.mix }));
  const mixAt = (x, z) => {
    const road = nearestRoad(x, z, 6);
    if (road?.avenue) return road.avenue.mix;
    for (const d of districts) if (Math.hypot(x - d.x, z - d.z) < d.r) return d.mix;
    return DEFAULT_MIX;
  };

  // ---- placed trees, in a grid for the spacing tests
  const TC = 4;
  const tgrid = new Map();
  const near = (x, z, d) => {
    const gi = Math.floor(x / TC);
    const gj = Math.floor(z / TC);
    const n = Math.ceil(d / TC);
    for (let di = -n; di <= n; di++) {
      for (let dj = -n; dj <= n; dj++) {
        for (const p of tgrid.get(gkey(gi + di, gj + dj)) || []) if (Math.hypot(p.x - x, p.z - z) < d) return true;
      }
    }
    return false;
  };
  // a mapped point may sit a metre or two into the kerb: try it, then
  // nudged off it by about a metre and a half in four directions
  const NUDGE = 1.5 * S;
  const settle = (x, z) => {
    if (!inside(x, z)) return null;
    if (!blocked(x, z)) return { x, z };
    for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + ax * NUDGE;
      const nz = z + az * NUDGE;
      if (!blocked(nx, nz)) return { x: nx, z: nz };
    }
    return null;
  };
  const add = (p, sp, flag, kindStat, young = 0.18) => {
    const hr = flag === EVERGREEN ? EVERGREEN_H : HEIGHT[sp] || HEIGHT[BROAD];
    // a street of mixed ages: a few young trees, the odd old giant
    const r = rnd();
    const age = r < young ? 0.55 + rnd() * 0.2 : r > 0.94 ? 1.15 + rnd() * 0.15 : 1;
    const hM = (hr[0] + rnd() * (hr[1] - hr[0])) * age;
    const rec = {
      x: p.x,
      y: heightAt(p.x, p.z) - Math.min(0.35, hM * S * 0.12),
      z: p.z,
      h: hM * S,
      s: sp,
      rot: rnd() * Math.PI * 2,
      phase: rnd() * 6.283,
      f: flag,
      st: 1,
    };
    out.trees.push(rec);
    const key = gkey(Math.floor(p.x / TC), Math.floor(p.z / TC));
    let list = tgrid.get(key);
    if (!list) tgrid.set(key, (list = []));
    list.push(p);
    out.stats[kindStat]++;
  };
  // light mode keeps half of every kind of street planting
  const keep = (x, z) => !mobile || hash2(x * 0.37 + 1.3, z * 0.29 - 2.1) < 0.5;

  // ---- 1. mapped single trees
  const kinds = new Map();
  for (let i = 0; i + 1 < (doc.k || []).length; i += 2) kinds.set(doc.k[i], doc.k[i + 1]);
  {
    let x = 0;
    let y = 0;
    for (let i = 0, n = 0; i + 1 < doc.t.length; i += 2, n++) {
      x += doc.t[i];
      y += doc.t[i + 1];
      const w = toWorld(x, y);
      if (!keep(w.x, w.z)) continue;
      const p = settle(w.x, w.z);
      if (!p) {
        out.stats.rejected++;
        continue;
      }
      if (near(p.x, p.z, 0.6)) continue; // a duplicate node
      const kind = kinds.get(n) || 0;
      let sp;
      let flag;
      if (kind) [sp, flag] = KIND_SPECIES[kind] || KIND_SPECIES[0];
      else [sp, flag] = pick(mixAt(p.x, p.z), rnd());
      add(p, sp, flag, 'mapped');
    }
  }

  // ---- 2. mapped tree rows: a tree every ROW_M, clear of the mapped ones
  const step = ROW_M * S * (mobile ? 1.5 : 1);
  for (const row of doc.r || []) {
    const kind = row[0] || 0;
    const pts = line(row, 1);
    if (pts.length < 2) continue;
    // a row is one species, planted together
    const mid = pts[Math.floor(pts.length / 2)];
    const [sp, flag] = kind ? KIND_SPECIES[kind] || KIND_SPECIES[0] : pick(mixAt(mid.x, mid.z), rnd());
    let d = step * 0.5; // distance along the current segment
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      for (; d < len; d += step) {
        const t = d / len;
        const p = settle(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
        if (!p) {
          out.stats.rejected++;
          continue;
        }
        if (near(p.x, p.z, step * 0.6)) continue;
        add(p, sp, flag, 'rows', 0.1);
      }
      d -= len;
    }
  }

  // ---- 3. avenue rows where OSM maps none: one row on each pavement
  for (const s of segs) {
    const av = s.avenue;
    if (!av?.rows || !(s.f.kind === 'primary' || s.f.kind === 'secondary' || s.f.kind === 'minor')) continue;
    if (s.f.t?.br || s.f.t?.tu) continue; // not on bridges or in tunnels
    const dx = s.b.x - s.a.x;
    const dz = s.b.z - s.a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) continue;
    const nx = -dz / len;
    const nz = dx / len;
    const off = s.half + 3 * S; // the kerb, then the tree pits
    const sp0 = av.rows * S * (mobile ? 1.5 : 1);
    for (let d = sp0 * 0.5; d < len; d += sp0) {
      for (const side of [1, -1]) {
        const x = s.a.x + (dx * d) / len + nx * off * side;
        const z = s.a.z + (dz * d) / len + nz * off * side;
        if (!inside(x, z) || blocked(x, z) || near(x, z, sp0 * 0.7)) continue;
        // the pavement must be clear of every other street too
        const other = nearestRoad(x, z, off * 0.9);
        if (other && other !== s && other.avenue !== av) continue;
        const [sp, flag] = pick(av.mix, rnd());
        add({ x, z }, sp, flag, 'avenue', 0.08);
      }
    }
  }

  // ---- 4. hedges: clipped blocks (nature.js species 14), one per piece of
  // up to 8 m, end to end; one height along a hedge
  const HEDGE_PIECE = 8 * S;
  for (const h of doc.h || []) {
    const pts = line(h);
    const hU = (1.5 + rnd() * 0.6) * S;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.5 * S) continue;
      const n = Math.max(1, Math.ceil(len / HEDGE_PIECE));
      const piece = len / n;
      const rot = -Math.atan2(b.z - a.z, b.x - a.x);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        if (!inside(x, z) || blocked(x, z)) continue;
        // the unit block is 1 x 1 x 1: stretch it to the piece and 1.2 m thick
        out.hedges.push({
          x,
          y: heightAt(x, z) - 0.08,
          z,
          h: hU,
          s: HEDGE_SP,
          rot,
          phase: 0,
          f: HEDGE,
          st: 2,
          sx: (piece + 0.3 * S) / hU,
          sz: (1.2 * S) / hU,
        });
        out.stats.hedges++;
      }
    }
  }

  // ---- 5. walks in the parks (painted into the land cover by nature.js)
  for (const w of doc.p || []) out.walks.push(line(w));
  return out;
}
