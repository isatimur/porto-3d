// The city fabric: every OSM building footprint from data/buildings.json,
// extruded to its real height on the real terrain. One BufferGeometry per
// 1 km tile, one shared material, vertex colours; no per-building draws.
// Walls carry wall-aligned coordinates (aWall: metres along the wall,
// metres above the foot, building height, seed), so the shader draws a
// window grid: dark glass by day, a random share lit warm at night.
// Buildings under a landmark (inside its OSM outline or its fitted model
// plan) are skipped, so the grey mass never pokes through a landmark.
// Roofs (pitched or flat with a parapet), the facade style by district and
// the facade shader live in src/facades.js.
import * as THREE from 'three';
import { S } from './geo.js';
import { createFacadeDetailTexture } from './textures.js';
import { setFacadeConfig, facadeStyle, wallBase, roofBase, roofPlan, extrudeRoofed, minRect, centreDist, STYLE, HIST_M, RING_M, FACADE_VERT_PARS, FACADE_VERT, FACADE_FRAG_PARS, FACADE_FRAG } from './facades.js';

const TILE_M = 1000; // 1 km: about 60 draw calls for the city, not 230
const MAX_TRIS = 1_500_000;
const SMALL_M2 = 30; // dropped first if over budget ...
const FAR_M = 2500; // ... when farther than this from the centre
const SKIRT = 0.4; // world units the walls reach below the lowest ground point
const FLAT = { shape: 'flat', planes: [], parapet: false, clutter: 0 }; // far LOD: a plain box
// core tiles farther than this from the camera draw flat caps for their
// pitched roofs (a ridge is a pixel or two out there)
const MID_M = 1400;
// Near-detail tier: only within this range of the camera do the baked
// chimneys, dormers, eaves, balconies, window bays and arcades draw. They
// live in their own index block (T.detail) so the mid and far tiers keep the
// exact triangle count they had (see buildBuildings ranges + updateLod).
const DETAIL_M = 420;

// Braga's fabric by district (src/facades.js): plaster in white, cream,
// ochre, pale pink and blue, granite in the centre, concrete further out;
// terracotta roofs, grey flat roofs on sheds and modern blocks. Picked per
// building from a hash, then varied a little in value.
const CHURCH_WALL = [0xd9, 0xd2, 0xc4].map((c) => Math.pow(c / 255, 2.2));
const WALL_DIM = 0.74; // keeps a sunlit white wall well below bloom threshold

export const BUILDING_UNIFORMS = {
  uNight: { value: 0 },
  // seconds, for the streamed tiles' fade-in (src/tiles.js advances it)
  uClock: { value: 0 },
  // 64 x 64 RGBA data map (src/textures.js), sampled by world position for
  // soiling, render grain and rain streaks on the ordinary facades
  uGrime: { value: null },
};

// Ray-cast point in polygon; poly = [{x, z}].
function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

// Oriented rectangle test; r = {cx, cz, ux, uz, hu, hv}.
function inRect(x, z, r) {
  const dx = x - r.cx;
  const dz = z - r.cz;
  return Math.abs(dx * r.ux + dz * r.uz) <= r.hu && Math.abs(-dx * r.uz + dz * r.ux) <= r.hv;
}

export function hash(i) {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Facade style, wall and roof colour of one building (linear rgb arrays)
// and the aWall.w its walls carry: style * 2 + seed (churches: -1, no
// windows). x, z: its centre (world); hM: wall height (m); a: OSM extras;
// groundM: ground height under it (m, 0 at the centre's terrain), which
// picks the riverfront arcades.
export function buildingColors(seed, k, areaM2, x = 0, z = 0, hM = 7, a = null, groundM = null) {
  const h1 = hash(seed);
  const h2 = hash(seed + 7919);
  const h4 = hash(seed + 31337);
  const tint = 0.9 + h2 * 0.2;
  const church = k === 'church';
  const style = church ? STYLE.LEGACY : facadeStyle(x, z, k, areaM2, hM, a, h1, groundM);
  const shed = k === 'industrial' || style === STYLE.IND || style === STYLE.MODERN || (k === 'commercial' && areaM2 > 300) || areaM2 > 1600;
  const wb = church ? CHURCH_WALL : wallBase(style, h4, a, x, z);
  const wk = tint * WALL_DIM;
  const rb = roofBase(shed, h2, a);
  const rk = 0.92 + h1 * 0.16;
  return {
    wc: [wb[0] * wk, wb[1] * wk, wb[2] * wk],
    rc: [rb[0] * rk, rb[1] * rk, rb[2] * rk],
    win: church ? -1 : style * 2 + Math.min(h1, 0.999),
    style,
    h1,
    h2,
  };
}

// One building, extruded into T = { pos, nor, col, wall, idx } (plain
// arrays). pts: [{x, z}] world units, counter-clockwise seen from above
// (positive area), no closing duplicate; h metres; heightAt(x, z) the ground.
// The core (below), the streamed tiles (src/tile-worker.js) and the
// Microsoft footprints (src/buildings-ms.js) all call it.
// attrs (optional): the OSM extras { r roof:shape, rc roof colour, wc wall
// colour, m material, ro roof:orientation, sf Set of shop-front edge
// indices (in pts order) }; { far: true } for the far LOD boxes (flat, as
// cheap as before).
const contour = [];
export const lastPlan = { plan: null, style: 0 };
// roofOnly: the very far LOD (beyond ~6 km, a house is a few pixels): the
// flat roof at the same height and colour, without the walls (2 triangles
// for a box instead of 10).
export function extrudeBuilding(T, pts, h, k, areaM2, seedIndex, heightAt, roofOnly = false, attrs = null, detailLevel = 0) {
  const n = pts.length;
  // building:levels (where tagged): OSM storeys x the 3.3 m grid the facade
  // shader draws, so the roofline and the number of window rows agree with
  // the tag rather than the often-rounder `height`
  if (attrs?.lv > 0) h = attrs.lv * 3.3;
  const gs = pts.map((p) => heightAt(p.x, p.z));
  const gmin = Math.min(...gs);
  const gmax = Math.max(...gs);
  const base = gmin - SKIRT;
  const top = Math.max(gmin + h * S, gmax + 0.5);
  // metres, for the window grid
  const hM = (top - gmin) / S;
  const footM = (gmin - base) / S;
  let cx = 0;
  let cz = 0;
  for (const p of pts) {
    cx += p.x;
    cz += p.z;
  }
  cx /= n;
  cz /= n;
  const { wc, rc, win: seed, style, h2 } = buildingColors(seedIndex, k, areaM2, cx, cz, hM, attrs, gmin / S);

  if (!roofOnly) {
    const plan = attrs?.far ? FLAT : roofPlan(pts, areaM2, k, hM, style, top, attrs, h2, hash(seedIndex + 104729));
    // roof:height (m): scale the roof planes about the eave line so the rise
    // above the walls matches the tag, when the pipeline provides it
    if (plan.planes.length && attrs?.rh > 0) {
      const rise = maxRise(plan.planes, pts, top);
      if (rise > 1e-4) {
        const kk = (attrs.rh * S) / rise;
        if (kk > 0.3 && kk < 3) plan.planes = plan.planes.map((P) => ({ ax: P.ax * kk, az: P.az * kk, c: top + (P.c - top) * kk }));
      }
    }
    lastPlan.plan = plan; // tests (count the roof kinds)
    lastPlan.style = style;
    const sf = attrs?.sf;
    extrudeRoofed(T, pts, plan, { base, gmin, top, footM, hM, wc, rc, w: seed, seed: seedIndex, shop: sf && sf.size ? (i) => sf.has(i) : null });
    // near detail: only when the caller selected this building and the tile
    // carries the detail block (core tiles; the streamed worker does not, so
    // its near/far cost stays exactly as it was)
    if (detailLevel > 0 && T.detail) {
      extrudeDetail(T.detail, { pts, gmin, top, hM, footM, base, wc, rc, w: seed, style, plan, seedIndex, areaM2, attrs, level: detailLevel });
    }
    return top;
  }

  // roof-only: the flat roof
  contour.length = 0;
  for (const p of pts) contour.push(new THREE.Vector2(p.x, p.z));
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  const v0 = T.pos.length / 3;
  // roof-only: the missing walls were ~35 % of the house's pixels seen from
  // above at an angle, and lighter than the roof: blend their colour in
  const W = 0.35;
  const cr = rc[0] * (1 - W) + wc[0] * 0.81 * W;
  const cg = rc[1] * (1 - W) + wc[1] * 0.81 * W;
  const cb = rc[2] * (1 - W) + wc[2] * 0.81 * W;
  for (const p of pts) {
    T.pos.push(p.x, top, p.z);
    T.nor.push(0, 1, 0);
    T.col.push(cr, cg, cb);
    T.wall.push(0, -1, 0, seed);
  }
  for (const [a, b, c] of faces) {
    const A = pts[a];
    const B = pts[b];
    const C = pts[c];
    const up = (B.z - A.z) * (C.x - A.x) - (B.x - A.x) * (C.z - A.z);
    if (up >= 0) T.idx.push(v0 + a, v0 + b, v0 + c);
    else T.idx.push(v0 + a, v0 + c, v0 + b);
  }
  return top;
}

// ------------------------------------------------------------ near detail
// Real geometry for the buildings the camera comes close to: chimneys,
// dormers and eave fascia on pitched roofs; projecting balconies, stone
// sills and jamb reveals on the historic facades; piers for the riverfront
// arcades; recessed frames on tagged shop fronts. It all lands in the
// T.detail block, whose index range buildBuildings only draws within
// DETAIL_M of the camera, so the mid and far tiers keep their triangle count.
const MAX_BALCONY_COLS = 3;
const C_STONE = [0.44, 0.42, 0.37];
const C_IRON = [0.018, 0.018, 0.02];
const C_FRAME = [0.02, 0.05, 0.03];
const frac = (v) => v - Math.floor(v);

function planeY(P, x, z) {
  return P.ax * x + P.az * z + P.c;
}
function envelope(planes, x, z) {
  let y = Infinity;
  for (const P of planes) {
    const v = planeY(P, x, z);
    if (v < y) y = v;
  }
  return y;
}
function maxRise(planes, pts, top) {
  let m = 0;
  for (const p of pts) {
    const v = envelope(planes, p.x, p.z) - top;
    if (v > m) m = v;
  }
  return m;
}

// a quad p0..p3 with normal n; winding is corrected so n is the front face
function bitri(T, p0, p1, p2, p3, n, col, w) {
  const nl = Math.hypot(n[0], n[1], n[2]) || 1;
  const n0 = n[0] / nl, n1 = n[1] / nl, n2 = n[2] / nl;
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  const q = cx * n0 + cy * n1 + cz * n2 >= 0 ? [p0, p1, p2, p3] : [p0, p3, p2, p1];
  const i = T.pos.length / 3;
  for (const p of q) {
    T.pos.push(p[0], p[1], p[2]);
    T.nor.push(n0, n1, n2);
    T.col.push(col[0], col[1], col[2]);
    T.wall.push(0, -1, 0, w);
  }
  T.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
}

// oriented box: axis (ux, uz), half-length hu, half-depth hv, from y0 to y1;
// four sides and (optionally) the top. A slab, a pier, a chimney body.
function dbox(T, cx, cz, ux, uz, hu, hv, y0, y1, col, w, top = true) {
  const nx = -uz, nz = ux;
  const A0 = [cx - ux * hu - nx * hv, y0, cz - uz * hu - nz * hv];
  const B0 = [cx + ux * hu - nx * hv, y0, cz + uz * hu - nz * hv];
  const C0 = [cx + ux * hu + nx * hv, y0, cz + uz * hu + nz * hv];
  const D0 = [cx - ux * hu + nx * hv, y0, cz - uz * hu + nz * hv];
  const A1 = [A0[0], y1, A0[2]], B1 = [B0[0], y1, B0[2]], C1 = [C0[0], y1, C0[2]], D1 = [D0[0], y1, D0[2]];
  bitri(T, A0, B0, B1, A1, [-nx, 0, -nz], col, w);
  bitri(T, B0, C0, C1, B1, [ux, 0, uz], col, w);
  bitri(T, C0, D0, D1, C1, [nx, 0, nz], col, w);
  bitri(T, D0, A0, A1, D1, [-ux, 0, -uz], col, w);
  if (top) bitri(T, A1, B1, C1, D1, [0, 1, 0], col, w);
}

// a thin vertical baluster as two crossed quads (reads as an iron bar)
function post(T, x, z, ux, uz, nx, nz, hu, hv, y0, y1, col, w) {
  const a = [x - ux * hu, z - uz * hu];
  const b = [x + ux * hu, z + uz * hu];
  const c = [x - nx * hv, z - nz * hv];
  const d = [x + nx * hv, z + nz * hv];
  bitri(T, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [nx, 0, nz], col, w);
  bitri(T, [c[0], y0, c[1]], [d[0], y0, d[1]], [d[0], y1, d[1]], [c[0], y1, c[1]], [ux, 0, uz], col, w);
}

// a board hanging under the eave, following the eave polygon
function eaveFascia(T, poly, planes, top, rc, w) {
  const col = [rc[0] * 0.82, rc[1] * 0.82, rc[2] * 0.82];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    const nx = dz / len, nz = -dx / len;
    let ya = envelope(planes, a.x, a.z);
    let yb = envelope(planes, b.x, b.z);
    if (!Number.isFinite(ya)) ya = top;
    if (!Number.isFinite(yb)) yb = top;
    ya = Math.min(ya, top);
    yb = Math.min(yb, top);
    const d = 0.16 * S;
    bitri(T, [a.x, ya - d, a.z], [b.x, yb - d, b.z], [b.x, yb, b.z], [a.x, ya, a.z], [nx, 0, nz], col, w);
  }
}

// chimneys near the ridge of a pitched roof
function chimney(T, pts, planes, wc, w, rnd) {
  const R = minRect(pts);
  if (!R) return;
  const { ux, uz } = R;
  const len = R.u1 - R.u0;
  const wid = R.v1 - R.v0;
  if (len < 1.2 * S || wid < 1.2 * S) return;
  const count = 1;
  const body = [wc[0] * 0.98, wc[1] * 0.98, wc[2] * 0.98];
  const cap = [C_STONE[0] * 0.8, C_STONE[1] * 0.8, C_STONE[2] * 0.8];
  for (let c = 0; c < count; c++) {
    const u = R.u0 + (0.22 + 0.56 * rnd()) * len;
    const v = R.v0 + (0.3 + 0.4 * rnd()) * wid;
    const x = u * ux - v * uz;
    const z = u * uz + v * ux;
    const yy = envelope(planes, x, z);
    if (!Number.isFinite(yy)) continue;
    const y0 = yy - 0.3 * S;
    const y1 = y0 + (0.7 + 0.7 * rnd()) * S;
    dbox(T, x, z, ux, uz, 0.42 * S, 0.42 * S, y0, y1, body, w);
    dbox(T, x, z, ux, uz, 0.54 * S, 0.54 * S, y1, y1 + 0.16 * S, cap, w);
  }
}

// dormers on a roof slope with a shed roof over them
function dormer(T, pts, planes, wc, w, rnd, count) {
  const R = minRect(pts);
  if (!R) return;
  const { ux, uz } = R;
  const len = R.u1 - R.u0;
  const wid = R.v1 - R.v0;
  if (len < 3 * S || wid < 2.2 * S) return;
  const body = [wc[0] * 0.9, wc[1] * 0.9, wc[2] * 0.9];
  const roofC = [wc[0] * 0.5, wc[1] * 0.5, wc[2] * 0.5];
  const wx = (px, pz, du, dv) => px + du * ux - dv * uz;
  const wz = (px, pz, du, dv) => pz + du * uz + dv * ux;
  for (let c = 0; c < count; c++) {
    const u = R.u0 + (0.3 + 0.4 * rnd()) * len;
    const v = R.v0 + 0.16 * wid;
    const px = u * ux - v * uz;
    const pz = u * uz + v * ux;
    const yy = envelope(planes, px, pz);
    if (!Number.isFinite(yy)) continue;
    const hw = 0.5 * S, hd = 0.45 * S;
    const y0 = yy - 0.15 * S, y1 = yy + 0.8 * S;
    dbox(T, px, pz, ux, uz, hw, hd, y0, y1, body, w, false);
    // shed roof: the eave edge over the opening, rising to the back
    const FL = [wx(px, pz, -hw, -hd), y1, wz(px, pz, -hw, -hd)];
    const FR = [wx(px, pz, hw, -hd), y1, wz(px, pz, hw, -hd)];
    const BL = [wx(px, pz, -hw, hd), y1 + 0.45 * S, wz(px, pz, -hw, hd)];
    const BR = [wx(px, pz, hw, hd), y1 + 0.45 * S, wz(px, pz, hw, hd)];
    bitri(T, FL, FR, BR, BL, [ux * 0.3 - uz, 1.4, uz * 0.3 + ux], roofC, w);
  }
}

// historic facade: a stone sill under every first-floor window and, where
// the shader draws them, real projecting balconies with iron railings
function facadeDetail(T, pts, i, gmin, hM, bSd, w, level) {
  const a = pts[i];
  const b = pts[(i + 1) % pts.length];
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return;
  const ux = dx / len, uz = dz / len;
  const nx = uz, nz = -ux;
  const LM = len / S;
  const cw = 2.5 + 0.7 * bSd; // as the shader's historic grid
  const fh = 3.3, g0 = 4.0;
  const cols = Math.floor(LM / cw);
  if (cols < 1) return;
  if (0.84 * fh + g0 > hM + 0.05) return; // no first-floor window row
  const hasBalcony = bSd < 0.8; // shader: step(bSd, 0.8) at id.y == 0
  const floorY = gmin + g0 * S;
  const ys = gmin + (g0 + 0.1 * fh) * S;
  const winW = 0.38 * cw;
  let balc = 0;
  for (let j = 0; j < cols; j++) {
    const tc = (j + 0.5) * cw;
    const px = a.x + ux * tc * S;
    const pz = a.z + uz * tc * S;
    dbox(T, px + nx * 0.07 * S, pz + nz * 0.07 * S, ux, uz, (winW / 2 + 0.06) * S, 0.08 * S, ys - 0.08 * S, ys, C_STONE, w);
    if (!hasBalcony || balc >= MAX_BALCONY_COLS) continue;
    balc++;
    const bw = 0.31 * cw; // half width, as the shader's balcony span
    const sd = 0.55;
    dbox(T, px + nx * (sd / 2) * S, pz + nz * (sd / 2) * S, ux, uz, bw * S, (sd / 2) * S, floorY, floorY + 0.14 * S, C_STONE, w);
    const fx = px + nx * sd * S;
    const fz = pz + nz * sd * S;
    const fy0 = floorY + 0.14 * S;
    const fy1 = floorY + 1.0 * S;
    dbox(T, fx, fz, ux, uz, bw * S, 0.03 * S, fy1 - 0.05 * S, fy1, C_IRON, w);
    const nb = 4;
    for (let q = 0; q < nb; q++) {
      const off = (q / (nb - 1) - 0.5) * 2 * (bw - 0.06) * S;
      post(T, fx + ux * off, fz + uz * off, ux, uz, nx, nz, 0.02 * S, 0.02 * S, fy0, fy1, C_IRON, w);
    }
  }
}

// Ribeira-style arcade: real projecting piers along every street wall
function arcadeDetail(T, pts, gmin, w, level) {
  const n = pts.length;
  const pierY1 = gmin + 2.7 * S; // the shader's springing line
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    const LM = len / S;
    if (LM < 3.0) continue;
    const ux = dx / len, uz = dz / len;
    const nx = uz, nz = -ux;
    const bays = Math.max(1, Math.round(LM / 3.0));
    for (let j = 0; j <= bays; j++) {
      const tc = (j / bays) * LM;
      const px = a.x + ux * tc * S;
      const pz = a.z + uz * tc * S;
      dbox(T, px + nx * 0.16 * S, pz + nz * 0.16 * S, ux, uz, 0.24 * S, 0.34 * S, gmin, pierY1, C_STONE, w);
    }
  }
}

// tagged shop front: a projecting fascia over the opening and a jamb at each end
function shopDetail(T, pts, sf, gmin, w) {
  const n = pts.length;
  const top = gmin + 3.0 * S;
  for (const i of sf) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    const ux = dx / len, uz = dz / len;
    const nx = uz, nz = -ux;
    const LM = len / S;
    const cx = (a.x + b.x) / 2 + nx * 0.12 * S;
    const cz = (a.z + b.z) / 2 + nz * 0.12 * S;
    dbox(T, cx, cz, ux, uz, (LM / 2) * S, 0.13 * S, top, top + 0.4 * S, C_FRAME, w);
    for (const e of [a, b]) {
      dbox(T, e.x + nx * 0.12 * S, e.z + nz * 0.12 * S, ux, uz, 0.12 * S, 0.13 * S, gmin, top, C_FRAME, w);
    }
  }
}

// one building's near detail, into its own block
export function extrudeDetail(T, g) {
  const { pts, gmin, top, hM, wc, rc, w, plan, seedIndex, areaM2, attrs, level } = g;
  const bSt = Math.floor(w * 0.5);
  const bSd = w - 2 * bSt;
  const hist = (bSt > 0.5 && bSt < 2.5) || bSt === 7;
  const arcade = bSt === 7;
  const planes = plan && plan.planes ? plan.planes : [];
  let rs = hash(seedIndex + 4321);
  const rnd = () => (rs = frac(rs * 9301 + 0.4927 + Math.sin(rs * 78.233) * 0.5));

  if (planes.length) {
    eaveFascia(T, plan.poly || pts, planes, top, rc, w);
    chimney(T, pts, planes, wc, w, rnd);
    if (hist && level >= 2 && areaM2 >= 160) {
      dormer(T, pts, planes, wc, w, rnd, 1);
    }
  }

  const n = pts.length;
  let bestI = 0, bestL = -1;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L > bestL) {
      bestL = L;
      bestI = i;
    }
  }
  if (hist && level >= 2) facadeDetail(T, pts, bestI, gmin, hM, bSd, w, level);
  if (arcade && level >= 2) arcadeDetail(T, pts, gmin, w, level);
  if (attrs && attrs.sf && attrs.sf.size && level >= 2) shopDetail(T, pts, attrs.sf, gmin, w);
}

// clock time it appeared (aBorn); for 0.6 s after that a growing share of
// its pixels is drawn (ordered dither), so a tile appears without a pop and
// stays opaque (shadows, depth, no sorting).
export const FADE_S = 0.6;
export const FADE_VERT_PARS = /* glsl */ `
#ifdef BRG_FADE
attribute float aBorn;
varying float vBorn;
#endif
`;
export const FADE_VERT = /* glsl */ `
#ifdef BRG_FADE
vBorn = aBorn;
#endif
`;
export const FADE_FRAG_PARS = /* glsl */ `
#ifdef BRG_FADE
uniform float uClock;
varying float vBorn;
#endif
#ifdef BRG_REVEAL
uniform float uReveal;
#endif
`;
export const FADE_FRAG = /* glsl */ `
#include <clipping_planes_fragment>
#ifdef BRG_FADE
{
  float brgK = clamp((uClock - vBorn) / ${FADE_S.toFixed(2)}, 0.0, 1.0);
  // interleaved gradient noise: an even dither without a visible pattern
  float brgB = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (brgK < 1.0 && brgB >= brgK) discard;
}
#endif
#ifdef BRG_REVEAL
{
  // the whole core fades in at the start (main.js fadeIn): the same dither
  float brgR = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (uReveal < 1.0 && brgR >= uReveal) discard;
}
#endif
`;

// The building material: vertex colours, the window grid, night lights.
// fade: the streamed-tile variant (BRG_FADE, aBorn, uClock); a separate
// program, so the core's shader stays exactly as it was.
// Light mode (main.js): the night windows in one tone (BRG_WIN_LITE). Set
// before the first building material is made.
let WIN_LITE = false;
export function setBuildingsLite(on) {
  WIN_LITE = !!on;
  // light mode: roofs yes, parapets and rooftop boxes no (src/facades.js)
  setFacadeConfig({ lite: WIN_LITE });
}

// reveal: the core's start-up fade (BRG_REVEAL, material.userData.reveal.value
// 0..1, set to 1 when done); a separate program as well.
export function createBuildingMaterial({ fade = false, reveal = false } = {}) {
  if (!BUILDING_UNIFORMS.uGrime.value) BUILDING_UNIFORMS.uGrime.value = createFacadeDetailTexture();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  material.name = fade ? 'buildings-tiles' : 'buildings';
  material.defines = {};
  if (fade) material.defines.BRG_FADE = '';
  if (reveal) material.defines.BRG_REVEAL = '';
  material.userData.reveal = { value: reveal ? 0 : 1 };
  if (WIN_LITE) material.defines.BRG_WIN_LITE = '';
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, BUILDING_UNIFORMS);
    sh.uniforms.uReveal = material.userData.reveal;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${FACADE_VERT_PARS}\n${FADE_VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${FACADE_VERT}\n${FADE_VERT}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FACADE_FRAG_PARS}\n${FADE_FRAG_PARS}`)
      .replace('#include <clipping_planes_fragment>', FADE_FRAG)
      .replace('#include <emissivemap_fragment>', FACADE_FRAG);
  };
  return material;
}

// The OSM extras of a data/buildings.json entry for extrudeBuilding, or
// null. b.s lists shop-front edges by index into b.p (edge i: p[i] ->
// p[i + 1]); pts carry their b.p index (i) and may have been reversed.
export function attrsOf(b, pts, reversed) {
  if (!b.r && !b.rc && !b.wc && !b.m && !b.ro && !b.s && !(b.lv > 0) && !(b.rh > 0)) return null;
  const a = { r: b.r, rc: b.rc, wc: b.wc, m: b.m, ro: b.ro };
  // optional storey / roof-height tags, honoured when the pipeline provides
  // them (building:levels, roof:height); absent tags simply leave them out
  if (b.lv > 0) a.lv = b.lv;
  if (b.rh > 0) a.rh = b.rh;
  if (Array.isArray(b.s) && b.s.length) {
    const want = new Set(b.s);
    const sf = new Set();
    const n = pts.length;
    for (let k = 0; k < n; k++) {
      const o = reversed ? pts[(k + 1) % n].i : pts[k].i;
      if (want.has(o)) sf.add(k);
    }
    a.sf = sf;
  }
  return a;
}

// masks: { outlines: [[{x,z}]], plans: [{cx,cz,ux,uz,hu,hv}] } in world units
export function buildBuildings(data, project, heightAt, masks = { outlines: [], plans: [] }) {
  const group = new THREE.Group();
  group.name = 'buildings';
  const stats = { input: 0, built: 0, skippedOutline: 0, skippedPlan: 0, droppedSmall: 0, degenerate: 0, tiles: 0, triangles: 0, vertices: 0 };
  const list = data?.buildings;
  // `list` is the JSON array, or the packed list of buildings-pack.js (length
  // and at(i), one building made per call); both answer at(i)
  if (!list || !(list.length > 0) || typeof list.at !== 'function') return { group, stats, material: null };
  stats.input = list.length;
  // the historic centre the facade zones count from (scripts/fetch-buildings.mjs
  // writes it; older files: the map origin)
  const hist = Array.isArray(data.hist) ? data.hist : data.origin ? [data.origin.lat, data.origin.lon] : null;
  const centre = hist ? project(hist[0], hist[1]) : null;
  setFacadeConfig({ centre, lite: WIN_LITE, centreGroundM: centre ? heightAt(centre.x, centre.z) / S : 0 });

  const outlineBoxes = masks.outlines.map((poly) => {
    const xs = poly.map((p) => p.x);
    const zs = poly.map((p) => p.z);
    return { poly, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  });

  // --- pass 1: project, clean, classify
  const items = [];
  const skyRects = []; // x0, z0, x1, z1, height (metres) per building
  let tris = 0;
  for (let bi = 0; bi < list.length; bi++) {
    const b = list.at(bi);
    if (!Array.isArray(b.p) || b.p.length < 3 || !(b.h > 0)) {
      stats.degenerate++;
      continue;
    }
    // i: the index in b.p, so the shop-front edges (b.s) survive the clean-up
    let pts = b.p.map((q, i) => ({ ...project(q[0], q[1]), i }));
    // drop a closing duplicate and zero-length edges
    pts = pts.filter((p, i) => {
      const n = pts[(i + 1) % pts.length];
      return Math.hypot(n.x - p.x, n.z - p.z) > 1e-4;
    });
    if (pts.length < 3) {
      stats.degenerate++;
      continue;
    }
    {
      // the skyline grid (tour.js createSkyline) wants every building's box
      // and height; keeping five floats each lets the 9 MB list go
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (const p of pts) {
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
        if (p.z < z0) z0 = p.z;
        if (p.z > z1) z1 = p.z;
      }
      skyRects.push(x0, z0, x1, z1, b.h);
    }
    let area2 = 0;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const c = pts[(i + 1) % pts.length];
      area2 += a.x * c.z - c.x * a.z;
      cx += a.x;
      cz += a.z;
    }
    cx /= pts.length;
    cz /= pts.length;
    if (Math.abs(area2) < 1e-6) {
      stats.degenerate++;
      continue;
    }
    if (outlineBoxes.some((o) => cx >= o.x0 && cx <= o.x1 && cz >= o.z0 && cz <= o.z1 && inPoly(cx, cz, o.poly))) {
      stats.skippedOutline++;
      continue;
    }
    if (masks.plans.some((r) => inRect(cx, cz, r))) {
      stats.skippedPlan++;
      continue;
    }
    if (area2 < 0) pts.reverse(); // positive area: (dz, -dx) is the outward normal
    const areaM2 = Math.abs(area2) / 2 / (S * S);
    const n = pts.length;
    const t = 2 * n + (n - 2);
    tris += t;
    items.push({ pts, cx, cz, h: b.h, k: b.k, areaM2, far: Math.hypot(cx, cz) / S > FAR_M, tris: t, seed: bi, attrs: attrsOf(b, pts, area2 < 0) });
  }

  let keep = items;
  if (tris > MAX_TRIS) {
    keep = items.filter((it) => !(it.far && it.areaM2 < SMALL_M2));
    stats.droppedSmall = items.length - keep.length;
    console.info(`[porto] buildings: ${tris} triangles > ${MAX_TRIS}; dropped ${stats.droppedSmall} buildings < ${SMALL_M2} m² beyond ${FAR_M} m`);
  }

  // --- pass 1b: who gets near detail, under a flat triangle budget. The
  // historic core (facade + roof detail) first, then the ring (roof detail),
  // nearest the centre first, so the detail is concentrated where the camera
  // spends its time. Detail is baked into the tile's own index block, drawn
  // only within DETAIL_M; the mid and far tiers are untouched.
  const DETAIL_FACADE_TRI = 150000;
  const DETAIL_ROOF_TRI = 100000;
  {
    const facade = [];
    const roof = [];
    for (const it of keep) {
      if (it.far || it.k === 'church') continue;
      const d = centreDist(it.cx, it.cz);
      if (d > RING_M) continue;
      const st = facadeStyle(it.cx, it.cz, it.k, it.areaM2, it.h, it.attrs, hash(it.seed), heightAt(it.cx, it.cz) / S);
      if (d <= HIST_M && (st === STYLE.HIST || st === STYLE.AZUL || st === STYLE.ARCADE) && it.areaM2 >= 40 && it.areaM2 <= 1400 && it.h >= 5) facade.push(it);
      else roof.push(it);
    }
    facade.sort((p, q) => centreDist(p.cx, p.cz) - centreDist(q.cx, q.cz) || Math.abs(p.areaM2 - 170) - Math.abs(q.areaM2 - 170));
    let used = 0;
    for (const it of facade) {
      const est = Math.min(220, 80 + it.areaM2 * 0.5);
      if (used + est > DETAIL_FACADE_TRI) break;
      used += est;
      it.detailLevel = 2;
    }
    roof.sort((p, q) => centreDist(p.cx, p.cz) - centreDist(q.cx, q.cz));
    let usedR = 0;
    for (const it of roof) {
      const est = Math.min(50, 20 + it.areaM2 * 0.12);
      if (usedR + est > DETAIL_ROOF_TRI) break;
      usedR += est;
      it.detailLevel = 1;
    }
    stats.detail = { facade: facade.filter((it) => it.detailLevel === 2).length, roof: keep.filter((it) => it.detailLevel === 1).length, budgetTri: used + usedR };
  }

  // --- pass 2: geometry per tile
  const tiles = new Map();
  const tileOf = (it) => {
    const key = `${Math.floor(it.cx / S / TILE_M)},${Math.floor(it.cz / S / TILE_M)}`;
    let t = tiles.get(key);
    if (!t) tiles.set(key, (t = { key, pos: [], nor: [], col: [], wall: [], detail: { pos: [], nor: [], col: [], wall: [], idx: [] }, idx: [], near: [], farCap: [], roofs: { pos: [], nor: [], col: [], wall: [], idx: [] } }));
    return t;
  };
  for (const it of keep) {
    const T = tileOf(it);
    extrudeBuilding(T, it.pts, it.h, it.k, it.areaM2, it.seed, heightAt, false, it.attrs, it.detailLevel || 0);
    extrudeBuilding(T.roofs, it.pts, it.h, it.k, it.areaM2, it.seed, heightAt, true, it.attrs);
    stats.built++;
  }

  const material = createBuildingMaterial({ reveal: true });
  for (const T of tiles.values()) {
    // the near detail is a separate block, appended to the buffers and placed
    // first in the index so its range is contiguous: [detail | pitched roofs |
    // walls and flat roofs | flat caps]. Only the detail range is new; near,
    // mid and the roofs-only mesh keep exactly the triangles they had.
    const baseV = T.pos.length / 3;
    if (T.detail.idx.length) {
      for (let i = 0; i < T.detail.pos.length; i++) {
        T.pos.push(T.detail.pos[i]);
        T.nor.push(T.detail.nor[i]);
        T.col.push(T.detail.col[i]);
      }
      // aWall has 4 floats per vertex (pos, nor, col have 3), so it needs its own loop
      for (let i = 0; i < T.detail.wall.length; i++) T.wall.push(T.detail.wall[i]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(T.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(T.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(T.col, 3));
    g.setAttribute('aWall', new THREE.Float32BufferAttribute(T.wall, 4));
    const nD = T.detail.idx.length;
    const nA = T.near.length;
    const nB = T.idx.length;
    const nC = T.farCap.length;
    const detailIdx = new Array(nD);
    for (let i = 0; i < nD; i++) detailIdx[i] = T.detail.idx[i] + baseV;
    const all = detailIdx.concat(T.near, T.idx, T.farCap);
    g.setIndex(all);
    g.userData.ranges = { detail: [0, nD + nA + nB], near: [nD, nA + nB], mid: [nD + nA, nB + nC] };
    g.setDrawRange(nD, nA + nB);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    const mesh = new THREE.Mesh(g, material);
    mesh.name = `buildings-${T.key}`;
    mesh.userData.full = g;
    if (T.roofs.idx.length) {
      const r = new THREE.BufferGeometry();
      r.setAttribute('position', new THREE.Float32BufferAttribute(T.roofs.pos, 3));
      r.setAttribute('normal', new THREE.Float32BufferAttribute(T.roofs.nor, 3));
      r.setAttribute('color', new THREE.Float32BufferAttribute(T.roofs.col, 3));
      r.setAttribute('aWall', new THREE.Float32BufferAttribute(T.roofs.wall, 4));
      r.setIndex(T.roofs.idx);
      r.boundingSphere = g.boundingSphere;
      r.boundingBox = g.boundingBox;
      mesh.userData.roofs = r;
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    stats.tiles++;
    stats.triangles += (nA + nB) / 3;
    stats.trianglesMid = (stats.trianglesMid || 0) + (nB + nC) / 3;
    stats.trianglesDetail = (stats.trianglesDetail || 0) + nD / 3;
    stats.vertices += T.pos.length / 3;
  }
  // Very far tiles draw their roofs only: a tile wholly beyond 6 km from the
  // camera (`cam`) and 3 km from the focus. Called by src/tiles.js.
  // Tiles beyond MID from the camera draw flat caps instead of the pitched
  // roofs (the same buffers, another index range): as cheap as before.
  const VFAR = 6000 * S;
  const KEEP = 3000 * S;
  const MID = MID_M * S;
  const DETAIL_BASE = DETAIL_M * S;
  const MID_BASE = MID_M * S;
  // The governor's close-range cut: below 1 the facade and roof detail and
  // the pitched-roof tier end nearer to the camera (main.js applyKnobs).
  let lodK = 1;
  group.userData.setLodScale = (k) => {
    lodK = Math.max(0.3, Math.min(1, k));
  };
  group.userData.updateLod = (cam, focus) => {
    const MID = MID_BASE * lodK;
    const DETAIL = DETAIL_BASE * lodK;
    for (const mesh of group.children) {
      const full = mesh.userData.full;
      const bs = full.boundingSphere;
      const dc = Math.hypot(bs.center.x - cam.x, bs.center.y - cam.y, bs.center.z - cam.z) - bs.radius;
      const r = full.userData.ranges;
      if (r) {
        // three tiers with a little hysteresis: detail < DETAIL_M < near <
        // MID_M < mid. A tile with no baked detail has an empty detail range,
        // so it simply falls through to near.
        const cur = mesh.userData.tier || 'near';
        let want = cur;
        if (cur === 'mid') {
          if (dc < MID * 0.9) want = dc < DETAIL * 0.9 && r.detail[1] > r.detail[0] ? 'detail' : 'near';
        } else if (cur === 'detail') {
          if (dc > DETAIL * 0.9) want = dc > MID * 0.9 ? 'mid' : 'near';
        } else if (dc > MID) want = 'mid';
        else if (dc < DETAIL * 0.9 && r.detail[1] > r.detail[0]) want = 'detail';
        if (want !== cur) {
          const [s, c] = r[want];
          full.setDrawRange(s, c);
          mesh.userData.tier = want;
        }
      }
      const roofs = mesh.userData.roofs;
      if (!roofs) continue;
      const df = Math.hypot(bs.center.x - focus.x, bs.center.z - focus.z) - bs.radius;
      const now = mesh.geometry === roofs;
      const want = df > KEEP && dc > (now ? VFAR * 0.9 : VFAR);
      if (want !== now) mesh.geometry = want ? roofs : full;
    }
  };
  // projected footprints, for the nature layer's masks
  const footprints = keep.map((it) => it.pts);
  // `tileOf` and `updateLod` share one closure context, so `tiles` (every
  // tile's vertex buffers as plain arrays, 8 bytes per number: about 500 MB
  // for the core) would stay alive as long as the layer does. The meshes own
  // typed copies; let the plain ones go.
  tiles.clear();
  items.length = 0;
  keep.length = 0;
  return { group, stats, material, footprints, skyRects: new Float32Array(skyRects) };
}
