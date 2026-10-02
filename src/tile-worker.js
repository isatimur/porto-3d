// Tile worker (src/tiles.js starts one or two): fetches a streamed tile
// (data/tiles/<x>_<y>.json, scripts/fetch-tiles.mjs), decodes it and builds
// its geometry as transferable typed arrays:
//   near LOD  every footprint extruded exactly like the core (buildings.js
//             extrudeBuilding: walls with the window coordinates, the roof),
//             street ribbons at their real widths, water surfaces;
//   far LOD   one oriented box per building with the same colours, the main
//             streets only, water;
//   extras    (once per tile) the main streets and rivers as line segments,
//             a 64 x 64 land-cover patch for the ground shader, the trees.
// Everything is draped on the ground mesh's own triangles (scene.js
// groundAxes), so a streamed house stands where the ground is drawn.
import { ShapeUtils } from 'three';
import { createProjection, S } from './geo.js';
import { extrudeBuilding } from './buildings.js';
import { setFacadeConfig } from './facades.js';

const FAR = { far: true }; // extrudeBuilding: a flat box (far LOD)
// tile format: optional `bx` = [[i, roof shape, roof colour, wall colour,
// material, roof orientation], ...] for the buildings b[i] that carry OSM
// roof or facade tags (scripts/fetch-tiles.mjs)
function extrasOf(tile) {
  const m = new Map();
  if (!Array.isArray(tile.bx)) return m;
  for (const r of tile.bx) if (Array.isArray(r)) m.set(r[0], { r: r[1] || null, rc: r[2] || null, wc: r[3] || null, m: r[4] || null, ro: r[5] || null });
  return m;
}

let P = null; // projection
let ground = null; // groundAt(x, z)
let cfg = null;
const cache = new Map(); // key -> decoded tile JSON (LRU, for LOD switches)
const CACHE_MAX = 48;

// ------------------------------------------------------------ ground
// The ground mesh surface: bilinear DEM heights at its grid nodes, two
// triangles per quad split along the (i+1, j) - (i, j+1) diagonal, exactly
// as createGround indexes them.
function makeGround(heightAt, xs, zs) {
  const nx = xs.length;
  const nz = zs.length;
  const H = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) H[j * nx + i] = heightAt(xs[i], zs[j]);
  const find = (arr, v) => {
    let lo = 0;
    let hi = arr.length - 2;
    if (v <= arr[0]) return 0;
    if (v >= arr[hi]) return hi;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid] <= v) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  return (x, z) => {
    const i = find(xs, x);
    const j = find(zs, z);
    let u = (x - xs[i]) / (xs[i + 1] - xs[i]);
    let v = (z - zs[j]) / (zs[j + 1] - zs[j]);
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    const a = H[j * nx + i];
    const b = H[j * nx + i + 1];
    const c = H[(j + 1) * nx + i];
    const d = H[(j + 1) * nx + i + 1];
    if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
    return d + (c - d) * (1 - u) + (b - d) * (1 - v);
  };
}

// ------------------------------------------------------------ helpers
function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const newT = (wall) => ({ pos: [], nor: [], col: [], wall: wall ? [] : null, idx: [] });

// plain arrays -> typed arrays, with the bounds for the bounding volumes
function pack(T) {
  if (!T.idx.length) return null;
  const n = T.pos.length / 3;
  const pos = new Float32Array(T.pos);
  const nor = new Int8Array(T.nor.length);
  for (let i = 0; i < T.nor.length; i++) nor[i] = Math.round(T.nor[i] * 127);
  const col = new Uint8Array(T.col.length);
  for (let i = 0; i < T.col.length; i++) {
    const c = T.col[i] * 255;
    col[i] = c < 0 ? 0 : c > 255 ? 255 : Math.round(c);
  }
  const idx = n > 65535 ? new Uint32Array(T.idx) : new Uint16Array(T.idx);
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = pos[i + k];
      if (v < box[k]) box[k] = v;
      if (v > box[k + 3]) box[k + 3] = v;
    }
  }
  const out = { pos, nor, col, idx, box, verts: n, tris: T.idx.length / 3 };
  if (T.wall) out.wall = new Float32Array(T.wall);
  return out;
}
const buffersOf = (g) => (g ? [g.pos.buffer, g.nor.buffer, g.col.buffer, g.idx.buffer, ...(g.wall ? [g.wall.buffer] : [])] : []);

// decode [x0, y0, dx, dy, ...] (1e-5 deg, tile origin o) from index `from`
function decode(arr, from, o) {
  const pts = [];
  let x = 0;
  let y = 0;
  for (let i = from; i + 1 < arr.length; i += 2) {
    x += arr[i];
    y += arr[i + 1];
    pts.push(P.project((o[0] + y) / 1e5, (o[1] + x) / 1e5));
  }
  return pts;
}

// Ribbon quads along a polyline (world {x,z} points), draped, lengthened by
// half the width at the joints like roads.js. Pushed into T.
function ribbon(T, pts, halfW, col, lift, maxSeg) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const A = pts[i];
    const B = pts[i + 1];
    const L = Math.hypot(B.x - A.x, B.z - A.z);
    if (L < 1e-4) continue;
    const n = Math.max(1, Math.ceil(L / maxSeg));
    const dx = (B.x - A.x) / L;
    const dz = (B.z - A.z) / L;
    const nx = -dz * halfW;
    const nz = dx * halfW;
    const ex = dx * halfW;
    const ez = dz * halfW;
    for (let s = 0; s < n; s++) {
      const ax = A.x + ((B.x - A.x) * s) / n;
      const az = A.z + ((B.z - A.z) * s) / n;
      const bx = A.x + ((B.x - A.x) * (s + 1)) / n;
      const bz = A.z + ((B.z - A.z) * (s + 1)) / n;
      // lengthen only at the polyline's joints, not between subdivisions
      const e0 = s === 0 ? 1 : 0;
      const e1 = s === n - 1 ? 1 : 0;
      const c = [
        [ax - ex * e0 + nx, az - ez * e0 + nz],
        [ax - ex * e0 - nx, az - ez * e0 - nz],
        [bx + ex * e1 - nx, bz + ez * e1 - nz],
        [bx + ex * e1 + nx, bz + ez * e1 + nz],
      ];
      const v = T.pos.length / 3;
      for (const [x, z] of c) {
        T.pos.push(x, ground(x, z) + lift, z);
        T.nor.push(0, 1, 0);
        T.col.push(col[0], col[1], col[2]);
        if (T.wall) T.wall.push(0, -1, 0, 0);
      }
      // counter-clockwise from above: (c0, c1, c2) has the normal side on the left
      const up = (c[1][1] - c[0][1]) * (c[2][0] - c[0][0]) - (c[1][0] - c[0][0]) * (c[2][1] - c[0][1]);
      if (up >= 0) T.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      else T.idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
    }
  }
}

// line segments (x, y, z pairs) along a polyline, draped
function segments(out, pts, lift, maxSeg, merge) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const A = pts[i];
    const B = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(B.x - A.x, B.z - A.z) / maxSeg));
    // ground heights at the n + 1 sub-points; a run of them is one segment
    // while every point between stays within LINE_TOL of the chord (a
    // straight street on a slope needs no 24 m pieces: ~4x fewer instances)
    const hs = [];
    for (let s = 0; s <= n; s++) hs.push(ground(A.x + ((B.x - A.x) * s) / n, A.z + ((B.z - A.z) * s) / n) + lift);
    let s0 = 0;
    while (s0 < n) {
      let s1 = s0 + 1;
      while (s1 < n) {
        const t = s1 + 1;
        let ok = true;
        for (let m = s0 + 1; m <= s1; m++) {
          const yc = hs[s0] + ((hs[t] - hs[s0]) * (m - s0)) / (t - s0);
          if (!merge || Math.abs(hs[m] - yc) > LINE_TOL) {
            ok = false;
            break;
          }
        }
        if (!ok) break;
        s1 = t;
      }
      out.push(A.x + ((B.x - A.x) * s0) / n, hs[s0], A.z + ((B.z - A.z) * s0) / n, A.x + ((B.x - A.x) * s1) / n, hs[s1], A.z + ((B.z - A.z) * s1) / n);
      s0 = s1;
    }
  }
}
const LINE_TOL = 0.1; // world units (0.4 m)

// densify a closed ring so a draped polygon follows the ground
function densify(ring, step) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  return out;
}

const signedArea = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
};

// flat water polygon (outer + holes), draped per vertex
function waterPoly(T, rings, col, step) {
  const outer = densify(rings[0], step);
  const holes = rings.slice(1).map((r) => densify(r, step));
  if (outer.length < 3) return;
  const contour = outer.map((p) => ({ x: p.x, y: p.z }));
  const hs = holes.map((h) => h.map((p) => ({ x: p.x, y: p.z })));
  let faces;
  try {
    faces = ShapeUtils.triangulateShape(contour, hs);
  } catch {
    return;
  }
  const all = [...outer, ...holes.flat()];
  const v0 = T.pos.length / 3;
  for (const p of all) {
    T.pos.push(p.x, ground(p.x, p.z) + 0.15, p.z);
    T.nor.push(0, 1, 0);
    T.col.push(col[0], col[1], col[2]);
    if (T.wall) T.wall.push(0, -1, 0, 0);
  }
  for (const [a, b, c] of faces) {
    const A = all[a];
    const B = all[b];
    const C = all[c];
    const up = (B.z - A.z) * (C.x - A.x) - (B.x - A.x) * (C.z - A.z);
    if (up >= 0) T.idx.push(v0 + a, v0 + b, v0 + c);
    else T.idx.push(v0 + a, v0 + c, v0 + b);
  }
}

// ------------------------------------------------------------ rasters
// Even-odd scanline fill of world rings into a w x h raster over rect
// (x0, zN, x1, zS); row 0 is the north edge. fn(index) is called per pixel.
function fillRings(rings, R, fn) {
  const { w, h, x0, zN, sx, sz } = R;
  const edges = [];
  let zmin = Infinity;
  let zmax = -Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const ay = (a.z - zN) * sz;
      const by = (b.z - zN) * sz;
      if (ay === by) continue;
      edges.push([(a.x - x0) * sx, ay, (b.x - x0) * sx, by]);
      zmin = Math.min(zmin, ay, by);
      zmax = Math.max(zmax, ay, by);
    }
  }
  const r0 = Math.max(0, Math.floor(zmin));
  const r1 = Math.min(h - 1, Math.ceil(zmax));
  const xsx = [];
  for (let r = r0; r <= r1; r++) {
    const y = r + 0.5;
    xsx.length = 0;
    for (const [ax, ay, bx, by] of edges) {
      if (ay > y !== by > y) xsx.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
    }
    if (xsx.length < 2) continue;
    xsx.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xsx.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xsx[k] - 0.5));
      const c1 = Math.min(w - 1, Math.floor(xsx[k + 1] - 0.5));
      for (let c = c0; c <= c1; c++) fn(r * w + c);
    }
  }
}
// a thick polyline as quads
function strokeLine(pts, halfW, R, fn) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const A = pts[i];
    const B = pts[i + 1];
    const L = Math.hypot(B.x - A.x, B.z - A.z);
    if (L < 1e-6) continue;
    const nx = (-(B.z - A.z) / L) * halfW;
    const nz = ((B.x - A.x) / L) * halfW;
    const ex = ((B.x - A.x) / L) * halfW;
    const ez = ((B.z - A.z) / L) * halfW;
    fillRings([[{ x: A.x - ex + nx, z: A.z - ez + nz }, { x: B.x + ex + nx, z: B.z + ez + nz }, { x: B.x + ex - nx, z: B.z + ez - nz }, { x: A.x - ex - nx, z: A.z - ez - nz }]], R, fn);
  }
}

// ------------------------------------------------------------ one tile
function footprint(pts) {
  // drop zero-length edges; counter-clockwise from above (positive area)
  let p = pts.filter((q, i) => {
    const n = pts[(i + 1) % pts.length];
    return Math.hypot(n.x - q.x, n.z - q.z) > 1e-4;
  });
  if (p.length < 3) return null;
  const a = signedArea(p);
  if (Math.abs(a) < 1e-6) return null;
  if (a < 0) p = p.reverse();
  return { pts: p, areaM2: Math.abs(a) / (S * S) };
}

// oriented box of a footprint (along its longest edge), counter-clockwise
function orientedBox(pts) {
  let best = 0;
  let ux = 1;
  let uz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L > best) {
      best = L;
      ux = (b.x - a.x) / L;
      uz = (b.z - a.z) / L;
    }
  }
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const p of pts) {
    const u = p.x * ux + p.z * uz;
    const v = -p.x * uz + p.z * ux;
    if (u < u0) u0 = u;
    if (u > u1) u1 = u;
    if (v < v0) v0 = v;
    if (v > v1) v1 = v;
  }
  const at = (u, v) => ({ x: u * ux - v * uz, z: u * uz + v * ux });
  const box = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
  return signedArea(box) < 0 ? box.reverse() : box;
}

function buildTile(tile, key, lod, extras) {
  const o = tile.o;
  const K = cfg.kinds;
  const seedBase = (tile.x * 131 + tile.y * 7919) * 100003;
  const stats = { buildings: 0, trees: 0 };
  const out = { b: null, s: null, w: null };
  const near = lod === 'near';

  // ---- buildings
  const B = newT(true);
  // far LOD: also the roof-only variant for the very far blocks (tiles.js VFAR_M)
  const Bv = near ? null : newT(true);
  const foot = []; // world footprints, for the rasters
  const bx = extrasOf(tile);
  for (let i = 0; i < tile.b.length; i++) {
    const rec = tile.b[i];
    const f = footprint(decode(rec, 2, o));
    if (!f) continue;
    foot.push(f.pts);
    if (!near && f.areaM2 < 20) continue;
    const pts = near ? f.pts : orientedBox(f.pts);
    // near: roofs and facades from the tags; far: plain boxes, as before
    const ex = near ? bx.get(i) || null : FAR;
    extrudeBuilding(B, pts, rec[0] / 10, K.b[rec[1]] || 'other', f.areaM2, seedBase + i, ground, false, ex);
    if (Bv) extrudeBuilding(Bv, pts, rec[0] / 10, K.b[rec[1]] || 'other', f.areaM2, seedBase + i, ground, true, bx.get(i) || null);
    stats.buildings++;
  }

  // ---- streets (near: own mesh, all kinds; far: main streets in the building mesh)
  const lines = tile.r.map((rec) => ({ kind: K.r[rec[0]], pts: decode(rec, 1, o) }));
  const Sx = near ? newT(false) : B;
  const RW = cfg.roadWidths;
  for (const l of lines) {
    if (!near && l.kind !== 'primary' && l.kind !== 'secondary') continue;
    ribbon(Sx, l.pts, (RW[l.kind] * S) / 2, cfg.roadColors[l.kind], near ? 0.14 : 0.2, near ? 3 : 8);
    if (Bv) ribbon(Bv, l.pts, (RW[l.kind] * S) / 2, cfg.roadColors[l.kind], 0.2, 8);
  }

  // ---- water: rivers and lakes
  const W = newT(false);
  const rivers = tile.w.map((rec) => ({ w: rec[0], pts: decode(rec, 1, o) }));
  for (const r of rivers) if (near || r.w >= 6) ribbon(W, r.pts, (r.w * S) / 2, cfg.waterColor, 0.16, near ? 3 : 8);
  const areas = tile.a.map((rec) => ({ k: K.a[rec[0]], rings: rec.slice(1).map((ring) => decode(ring, 0, o)) }));
  for (const a of areas) if (a.k === 'water') waterPoly(W, a.rings, cfg.waterColor, near ? 6 : 20);

  out.b = pack(B);
  if (Bv) out.bv = pack(Bv);
  if (near) out.s = pack(Sx);
  out.w = pack(W);

  let ex = null;
  if (extras) {
    // ---- line segments for the constant-width street lines
    const lp = [];
    const ls = [];
    const lw = [];
    for (const l of lines) {
      if (l.kind === 'primary') segments(lp, l.pts, 0.35, 6, false); // additive glow: the overlaps at the joints are part of its look
      else if (l.kind === 'secondary') segments(ls, l.pts, 0.35, 6, true);
    }
    for (const r of rivers) if (r.w >= 6) segments(lw, r.pts, 0.35, 6, true);

    // ---- rasters over the tile: land cover 64 x 64, occupancy 512 x 512
    const [s, w, n, e] = tile.bbox;
    const sw = P.project(s, w);
    const ne = P.project(n, e);
    const rect = { x0: sw.x, x1: ne.x, zN: ne.z, zS: sw.z };
    const LN = cfg.landPx;
    const RL = { w: LN, h: LN, x0: rect.x0, zN: rect.zN, sx: LN / (rect.x1 - rect.x0), sz: LN / (rect.zS - rect.zN) };
    const ON = 512;
    const RO = { w: ON, h: ON, x0: rect.x0, zN: rect.zN, sx: ON / (rect.x1 - rect.x0), sz: ON / (rect.zS - rect.zN) };
    const land = new Uint8Array(LN * LN * 4);
    const put = (ch, v) => (i) => {
      if (land[i * 4 + ch] < v) land[i * 4 + ch] = v;
    };
    const LV = { forest: [0, 255], scrub: [0, 150], grass: [1, 200], park: [1, 225], garden: [1, 235], orchard: [2, 85], vineyard: [2, 170], farmland: [2, 255], urban: [3, 110], industrial: [3, 140] };
    for (const a of areas) {
      const lv = LV[a.k];
      if (lv) fillRings(a.rings, RL, put(lv[0], lv[1]));
    }
    // occupancy: buildings, streets with a verge, water
    const occ = new Uint8Array(ON * ON);
    const mark = (i) => {
      occ[i] = 1;
    };
    for (const f of foot) fillRings([f], RO, mark);
    const VERGE = { primary: 16, secondary: 11, minor: 8, service: 7, track: 6, rail: 9 };
    for (const l of lines) strokeLine(l.pts, ((VERGE[l.kind] || 8) * S) / 2, RO, mark);
    for (const r of rivers) strokeLine(r.pts, ((r.w + 6) * S) / 2, RO, mark);
    for (const a of areas) if (a.k === 'water') fillRings(a.rings, RO, mark);
    // built-up share per land pixel from the building footprints (8 x 8 occupancy pixels)
    const bld = new Uint8Array(ON * ON);
    for (const f of foot) fillRings([f], RO, (i) => (bld[i] = 1));
    const k = ON / LN;
    const urb = new Float32Array(LN * LN);
    for (let r = 0; r < ON; r++) for (let c = 0; c < ON; c++) if (bld[r * ON + c]) urb[((r / k) | 0) * LN + ((c / k) | 0)] += 1 / (k * k);
    for (let r = 0; r < LN; r++) {
      for (let c = 0; c < LN; c++) {
        let sum = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = Math.min(LN - 1, Math.max(0, r + dr));
          const cc = Math.min(LN - 1, Math.max(0, c + dc));
          sum += urb[rr * LN + cc] * (dr || dc ? 1 : 2);
        }
        const v = Math.min(255, Math.round((sum / 10) * 255 * 3.2));
        const i = (r * LN + c) * 4 + 3;
        if (land[i] < v) land[i] = v;
      }
    }

    // ---- trees in the woods and parks (same kinds and mixes as nature.js)
    const TT = cfg.trees;
    const rnd = lcg(seedBase ^ 0x5bd1e995);
    const tr = [];
    const blocked = (x, z) => {
      const c = Math.floor((x - RO.x0) * RO.sx);
      const r = Math.floor((z - RO.zN) * RO.sz);
      if (c < 0 || r < 0 || c >= ON || r >= ON) return false;
      return occ[r * ON + c] === 1;
    };
    const inRings = (x, z, rings) => {
      let inside = false;
      for (const poly of rings) {
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const a = poly[i];
          const b = poly[j];
          if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
        }
      }
      return inside;
    };
    for (const a of areas) {
      const dens = TT.density[a.k];
      const mix = TT.mix[a.k];
      if (!dens || !mix) continue;
      const areaU = Math.max(0, Math.abs(signedArea(a.rings[0])) - a.rings.slice(1).reduce((q, r) => q + Math.abs(signedArea(r)), 0));
      const want = (areaU / (S * S)) * dens * cfg.treesPerM2;
      let cnt = Math.floor(want) + (rnd() < want % 1 ? 1 : 0);
      if (!cnt) continue;
      let bx0 = Infinity;
      let bx1 = -Infinity;
      let bz0 = Infinity;
      let bz1 = -Infinity;
      for (const p of a.rings[0]) {
        bx0 = Math.min(bx0, p.x);
        bx1 = Math.max(bx1, p.x);
        bz0 = Math.min(bz0, p.z);
        bz1 = Math.max(bz1, p.z);
      }
      const minD = Math.sqrt(areaU / cnt) * 0.62;
      const cell = minD / Math.SQRT2;
      const grid = new Map();
      const gk = (i, j) => (i * 73856093) ^ (j * 19349663);
      let tries = cnt * 14;
      while (cnt > 0 && tries-- > 0 && tr.length < cfg.treesPerTile * 9) {
        const x = bx0 + rnd() * (bx1 - bx0);
        const z = bz0 + rnd() * (bz1 - bz0);
        if (!inRings(x, z, a.rings)) continue;
        const gi = Math.floor(x / cell);
        const gj = Math.floor(z / cell);
        let close = false;
        for (let di = -2; di <= 2 && !close; di++) {
          for (let dj = -2; dj <= 2 && !close; dj++) {
            const q = grid.get(gk(gi + di, gj + dj));
            if (q && Math.hypot(q.x - x, q.z - z) < minD) close = true;
          }
        }
        if (close) continue;
        let sp = 2;
        let acc = 0;
        const r0 = rnd();
        for (let q = 0; q < mix.length; q++) {
          acc += mix[q];
          if (r0 < acc) {
            sp = q;
            break;
          }
        }
        const hr = TT.heights[sp];
        const hM = hr[0] + rnd() * (hr[1] - hr[0]);
        const reach = hM * S * (sp === 4 ? 0.62 : sp === 3 ? 0.4 : 0.25);
        if (blocked(x, z) || blocked(x + reach, z) || blocked(x - reach, z) || blocked(x, z + reach) || blocked(x, z - reach)) continue;
        grid.set(gk(gi, gj), { x, z });
        tr.push(x, ground(x, z) - Math.min(0.35, hM * S * 0.12), z, hM * S, sp, rnd() * Math.PI * 2, rnd() * 6.283, rnd(), rnd());
        cnt--;
      }
    }
    stats.trees = tr.length / 9;
    ex = { lines: { primary: new Float32Array(lp), secondary: new Float32Array(ls), water: new Float32Array(lw) }, land, trees: new Float32Array(tr) };
  }
  return { mesh: out, extras: ex, stats };
}

// ------------------------------------------------------------ messages
async function getTile(key, url) {
  if (cache.has(key)) {
    const t = cache.get(key);
    cache.delete(key);
    cache.set(key, t);
    return { tile: t, fetchMs: 0 };
  }
  const t0 = performance.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (!type.includes('json')) throw new Error(`content-type "${type}" is not JSON`);
  const tile = await res.json();
  if (!Array.isArray(tile?.b) || !Array.isArray(tile?.o)) throw new Error('not a tile');
  cache.set(key, tile);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return { tile, fetchMs: performance.now() - t0 };
}

self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.type === 'init') {
    cfg = m;
    // the facade zones and light mode, as the main thread has them (tiles.js)
    if (m.facade) setFacadeConfig(m.facade);
    const t0 = performance.now();
    P = createProjection(m.origin, null, [], { ...m.grid, heights: Array.from(m.grid.heights) });
    // no landmark pads out here: the raw DEM, on the ground mesh's triangles
    ground = makeGround(P.terrain.rawAt, Float64Array.from(m.axes.xs), Float64Array.from(m.axes.zs));
    self.postMessage({ type: 'ready', ms: performance.now() - t0 });
    return;
  }
  if (m.type === 'load') {
    try {
      const { tile, fetchMs } = await getTile(m.key, m.url);
      const t1 = performance.now();
      const r = buildTile(tile, m.key, m.lod, m.extras);
      const buildMs = performance.now() - t1;
      const transfer = [...buffersOf(r.mesh.b), ...buffersOf(r.mesh.bv), ...buffersOf(r.mesh.s), ...buffersOf(r.mesh.w)];
      if (r.extras) transfer.push(r.extras.land.buffer, r.extras.trees.buffer, r.extras.lines.primary.buffer, r.extras.lines.secondary.buffer, r.extras.lines.water.buffer);
      self.postMessage({ type: 'tile', id: m.id, key: m.key, lod: m.lod, mesh: r.mesh, extras: r.extras, stats: { ...r.stats, fetchMs, buildMs } }, transfer);
    } catch (e) {
      self.postMessage({ type: 'error', id: m.id, key: m.key, lod: m.lod, error: String(e?.message || e) });
    }
  }
};
