// The gaps in the OSM buildings, filled from the Microsoft Global ML
// Building Footprints (ODbL; scripts/fetch-ms-buildings.mjs already dropped
// every footprint that overlaps an OSM building or a landmark):
//   - data/buildings-ms.json, the core bbox, built once the core is on
//     screen, in 2 km tiles;
//   - data/tiles-ms/<x>_<y>.json, the ring, on the grid of data/tiles,
//     streamed with the radius rule of src/tiles.js: near tiles (within
//     4 km of the camera) one mesh each with shadows, far tiles merged
//     3 x 3 tiles per draw call.
// Every footprint is extruded with buildings.js extrudeBuilding (the same
// walls, window grid, night lights and colours as the OSM ones) on the main
// thread, at most SLICE_MS per frame, and draped on the drawn ground mesh.
// The ML area-class heights are rebuilt as storey counts (2-5, the odd tower)
// and the OSM roof treatment is forced on the compact footprints, so the ring
// reads as the same fabric as the core (see msHeight / msRoofHint below).
// Masks at run time: a footprint is skipped when it touches a landmark
// outline or part (data/footprints.json, as loaded), a fitted landmark
// plan, has its centre inside a core OSM building, or is a road/plaza blob.
// ?ms=0 turns them off; ?ms=debug tints their roofs blue.
import * as THREE from 'three';
import { S } from './geo.js';
import { assetUrl } from './data.js';
import { dataPath } from './city.js';
import { groundAxes } from './scene.js';
import { BUILDING_UNIFORMS, createBuildingMaterial, extrudeBuilding, lastPlan, hash } from './buildings.js';
import { hexLinear, minRect } from './facades.js';

const CORE_TILE_M = 2000;
const GROUP = 3; // far ring tiles per merged block side
const SLICE_MS = 1.5;
const SCHEDULE_S = 0.25;
const MAX_FETCH_HIGH = 4;
// far LOD: smaller footprints are left out. OSM tiles use 20 m²; the ML
// footprints hold many more sheds and annexes, and below 60 m² a box beyond
// 4 km is about a pixel. 60 m² cost ~655k tris in the overview; 100 m²
// costs ~561k and the overview looks the same.
const FAR_MIN_M2 = 100;
const CAST_U = 3000 * S; // shadows while the camera is within 3 km of the focus
const VFAR_U = 6000 * S; // far LOD beyond this from the camera: roof-only houses
const FOCUS_KEEP_U = 3000 * S; // ... and only beyond this from the focus
const DEBUG_ROOF =new THREE.Color(0x2f7dff);
// The pipeline's ML height is an area class, so most ring footprints land at
// 3 m and read as flat slabs beside the OSM fabric. Rebuild a storey count
// from the footprint (Porto: 2-5 storeys residential, the odd tower) and keep
// any taller pipeline estimate. Rooflines get the OSM treatment (pitched on
// compact footprints, flat on big sheds) plus a chimney on some pitched ones.
const STOREY_M = 3.1;
const TOWER_P = 0.025; // share of larger footprints that becomes a tower
const MS_MIN_W_M = 2.2; // a footprint thinner than this is a road/viaduct ribbon
const MS_MAX_M2 = 8000; // a blob this large is a plaza/garden the model misread
const PITCH_MAX_M2 = 320; // forced pitched roofs stay small (cost + real rooflines)
const PITCH_MAX_H_M = 15;
const PITCH_MIN_FILL = 0.55; // footprint area / its min rectangle
const CHIMNEY = hexLinear(0x8a4a34);

// ------------------------------------------------------------ helpers
// horizontal distance from (x, z) to a rectangle (as src/tiles.js)
const rectDist = (r, x, z) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.zN - z, 0, z - r.zS));

// the wanted radius from the camera's height above the ground (as src/tiles.js)
function radiusFor(altM, mobile) {
  if (altM > (mobile ? 6000 : 4500)) return Infinity;
  const r = 3000 * Math.pow(Math.max(altM, 300) / 300, 0.517);
  return (mobile ? r / 2 : r) * S;
}

// The drawn ground mesh surface (as src/tile-worker.js makeGround): heights
// at the mesh nodes, two triangles per quad split along (i+1, j)-(i, j+1).
// Node heights are read lazily.
function makeGround(heightAt, xs, zs) {
  const nx = xs.length;
  const H = new Float32Array(nx * zs.length).fill(NaN);
  const node = (i, j) => {
    const k = j * nx + i;
    let h = H[k];
    if (h !== h) h = H[k] = heightAt(xs[i], zs[j]);
    return h;
  };
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
    const a = node(i, j);
    const b = node(i + 1, j);
    const c = node(i, j + 1);
    const d = node(i + 1, j + 1);
    if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
    return d + (c - d) * (1 - u) + (b - d) * (1 - v);
  };
}

function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
const inRect = (x, z, r) => {
  const dx = x - r.cx;
  const dz = z - r.cz;
  return Math.abs(dx * r.ux + dz * r.uz) <= r.hu && Math.abs(-dx * r.uz + dz * r.ux) <= r.hv;
};
function boxOf(poly) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const p of poly) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.z < z0) z0 = p.z;
    if (p.z > z1) z1 = p.z;
  }
  return { poly, x0, x1, z0, z1 };
}

// counter-clockwise from above, no zero-length edges; null when degenerate
function footprint(pts) {
  let p = pts.filter((q, i) => {
    const n = pts[(i + 1) % pts.length];
    return Math.hypot(n.x - q.x, n.z - q.z) > 1e-4;
  });
  if (p.length < 3) return null;
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i];
    const n = p[(i + 1) % p.length];
    a += q.x * n.z - n.x * q.z;
    cx += q.x;
    cz += q.z;
  }
  if (Math.abs(a) < 1e-6) return null;
  if (a < 0) p = p.reverse();
  return { pts: p, cx: cx / p.length, cz: cz / p.length, areaM2: Math.abs(a) / 2 / (S * S) };
}

// the oriented box of a footprint along its longest edge (far LOD)
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
  return [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
}

// ------------------------------------------------------------ shape, height, roofs
// A stable per-building seed from its centre (the ring tiles and the core use
// different job seeds; the footprint position is the same for both).
export const seedOf = (f) => (Math.floor(f.cx / S) * 73856093) ^ (Math.floor(f.cz / S) * 19349663);

// Residential height (m): 2-5 storeys from the footprint area, an occasional
// tower, never below the pipeline's estimate (which carries a real MS height
// tag or a tall OSM-neighbour mean). Big footprints are sheds/blocks: keep the
// pipeline height, do not turn a warehouse into a six-storey block.
export function msHeight(areaM2, baseH, seed) {
  if (areaM2 > 900) return Math.max(baseH, 6);
  const r = hash(seed ^ 0x51ed2701);
  let storeys;
  if (areaM2 < 40) storeys = 2;
  else if (areaM2 < 90) storeys = 2 + (r > 0.4 ? 1 : 0);
  else if (areaM2 < 180) storeys = 3 + (r > 0.45 ? 1 : 0);
  else storeys = 4 + (r > 0.6 ? 1 : 0);
  if (areaM2 >= 180 && hash(seed ^ 0x2f7d1e5b) < TOWER_P) storeys += 3 + Math.floor(hash(seed ^ 0x7b1d) * 5);
  return Math.max(baseH, Math.min(45, storeys * STOREY_M + 0.3));
}

// The roof hint for extrudeBuilding, or null to let facades.js decide. The ML
// outlines are noisier than OSM, so the generic path flattens many of them for
// irregularity alone: force the roof on compact ones so the ring's roofline
// matches the OSM core (gabled on elongated regular footprints, hipped
// otherwise). Big and irregular ones stay flat, as in the core.
export function msRoofHint(pts, areaM2, hM, seed) {
  if (areaM2 > PITCH_MAX_M2 || hM > PITCH_MAX_H_M || pts.length > 24) return null;
  const R = minRect(pts);
  if (!R || R.area <= 0) return null;
  const fill = (areaM2 * S * S) / R.area;
  if (fill < PITCH_MIN_FILL) return null;
  const len = R.u1 - R.u0;
  const wid = R.v1 - R.v0;
  if (len / Math.max(wid, 1e-6) >= 1.5 && fill >= 0.9 && hash(seed ^ 0x9a3f) > 0.35) return { r: 'gabled' };
  return { r: 'hipped' };
}

// Footprints that read as roads, viaducts or plazas, not buildings. The
// pipeline drops most of these; this is the cheap run-time safety net.
export function badShape(f) {
  if (f.areaM2 < 12 || f.areaM2 > MS_MAX_M2) return true;
  const n = f.pts.length;
  let per = 0;
  for (let i = 0; i < n; i++) {
    const a = f.pts[i];
    const b = f.pts[(i + 1) % n];
    per += Math.hypot(b.x - a.x, b.z - a.z);
  }
  const widthM = (2 * f.areaM2) / Math.max(per / S, 1e-6);
  return widthM < MS_MIN_W_M && f.areaM2 > 50;
}

// A terracotta chimney box at the ridge of a pitched roof, on some of them.
// It goes into T.near (the pitched-roof index block), which the middle LOD
// drops, so a distant tile pays nothing for it. Returns true when added.
export function addChimney(T, pts, plan, seed) {
  if (pts.length > 20 || hash(seed ^ 0x11c4) > 0.25) return false;
  const IDX = T.near || T.idx;
  const R = minRect(pts);
  if (!R) return false;
  const len = R.u1 - R.u0;
  const wid = R.v1 - R.v0;
  if (len < 4 * S || wid < 3 * S) return false;
  const { ux, uz } = R;
  const at = (u, v) => ({ x: u * ux - v * uz, z: u * uz + v * ux });
  const u = R.u0 + len * (0.3 + 0.4 * hash(seed ^ 0x7c3));
  const v = R.v0 + wid * 0.5;
  const c = at(u, v);
  // the roof envelope is the lowest plane; a chimney stands on the highest
  // plane under it (the ridge), so use the max plane height at the centre
  let base = -Infinity;
  for (const P of plan.planes) base = Math.max(base, P.ax * c.x + P.az * c.z + P.c);
  if (!Number.isFinite(base)) return false;
  const half = 0.45 * S;
  const y0 = base - 0.4 * S;
  const y1 = base + 1.2 * S;
  const cs = [at(u - half, v - half), at(u + half, v - half), at(u + half, v + half), at(u - half, v + half)];
  for (let i = 0; i < 4; i++) {
    const A = cs[i];
    const B = cs[(i + 1) % 4];
    const L = Math.hypot(B.x - A.x, B.z - A.z);
    const nx = (B.z - A.z) / L;
    const nz = -(B.x - A.x) / L;
    const v0 = T.pos.length / 3;
    T.pos.push(A.x, y0, A.z, B.x, y0, B.z, B.x, y1, B.z, A.x, y1, A.z);
    for (let q = 0; q < 4; q++) {
      T.nor.push(nx, 0, nz);
      T.col.push(CHIMNEY[0], CHIMNEY[1], CHIMNEY[2]);
      T.wall.push(0, -1, 0, seed);
    }
    IDX.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
  }
  const v0 = T.pos.length / 3;
  for (const p of cs) {
    T.pos.push(p.x, y1, p.z);
    T.nor.push(0, 1, 0);
    T.col.push(CHIMNEY[0], CHIMNEY[1], CHIMNEY[2]);
    T.wall.push(0, -1, 0, seed);
  }
  const up = (cs[1].z - cs[0].z) * (cs[2].x - cs[0].x) - (cs[1].x - cs[0].x) * (cs[2].z - cs[0].z);
  if (up >= 0) IDX.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
  else IDX.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
  return true;
}

// lod: the near/middle index blocks (buildings.js: pitched roofs in
// `near`, their flat caps in `farCap`)
const newT = (lod = false) => (lod ? { pos: [], nor: [], col: [], wall: [], idx: [], near: [], farCap: [] } : { pos: [], nor: [], col: [], wall: [], idx: [] });
const FAR = { far: true }; // extrudeBuilding: a flat box
// near meshes farther than this from the camera draw flat caps for the
// pitched roofs (src/buildings.js MID_M)
const MID_U = 1400 * S;

// plain arrays -> typed arrays with bounds
function pack(T, tint) {
  if (!T.idx.length) return null;
  let ranges = null;
  let list = T.idx;
  if (T.near && (T.near.length || T.farCap.length)) {
    const a = T.near.length;
    const b = T.idx.length;
    const c = T.farCap.length;
    list = T.near.concat(T.idx, T.farCap);
    ranges = { near: [0, a + b], mid: [a, b + c] };
  }
  const n = T.pos.length / 3;
  const pos = new Float32Array(T.pos);
  const nor = new Int8Array(T.nor.length);
  for (let i = 0; i < T.nor.length; i++) nor[i] = Math.round(T.nor[i] * 127);
  const col = new Uint8Array(T.col.length);
  for (let v = 0; v < n; v++) {
    const roof = tint && T.wall[v * 4 + 1] === -1;
    for (let k = 0; k < 3; k++) {
      let c = T.col[v * 3 + k];
      if (roof) c = c * 0.35 + [DEBUG_ROOF.r, DEBUG_ROOF.g, DEBUG_ROOF.b][k] * 0.65;
      c *= 255;
      col[v * 3 + k] = c < 0 ? 0 : c > 255 ? 255 : Math.round(c);
    }
  }
  const idx = new Uint32Array(list);
  const box = new THREE.Box3();
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i] < box.min.x) box.min.x = pos[i];
    if (pos[i] > box.max.x) box.max.x = pos[i];
    if (pos[i + 1] < box.min.y) box.min.y = pos[i + 1];
    if (pos[i + 1] > box.max.y) box.max.y = pos[i + 1];
    if (pos[i + 2] < box.min.z) box.min.z = pos[i + 2];
    if (pos[i + 2] > box.max.z) box.max.z = pos[i + 2];
  }
  return { pos, nor, col, wall: new Float32Array(T.wall), idx, box, verts: n, tris: (ranges ? ranges.near[1] : T.idx.length) / 3, ranges };
}

// near / middle LOD of a mesh with index ranges, by its distance (world units)
function setMid(g, d) {
  const r = g?.userData.ranges;
  if (!r) return;
  const mid = g.drawRange.start > 0;
  const want = d > (mid ? MID_U * 0.9 : MID_U);
  if (want !== mid) g.setDrawRange(...(want ? r.mid : r.near));
}

// one geometry from packed parts [{ p, born }]
function geometryOf(list) {
  let verts = 0;
  let idx = 0;
  for (const { p } of list) {
    verts += p.verts;
    idx += p.idx.length;
  }
  if (!verts) return null;
  const one = list.length === 1;
  const pos = one ? list[0].p.pos : new Float32Array(verts * 3);
  const nor = one ? list[0].p.nor : new Int8Array(verts * 3);
  const col = one ? list[0].p.col : new Uint8Array(verts * 3);
  const wall = one ? list[0].p.wall : new Float32Array(verts * 4);
  const born = new Float32Array(verts);
  const ix = one ? list[0].p.idx : new Uint32Array(idx);
  const box = new THREE.Box3();
  let vo = 0;
  let io = 0;
  for (const { p, born: b } of list) {
    if (!one) {
      pos.set(p.pos, vo * 3);
      nor.set(p.nor, vo * 3);
      col.set(p.col, vo * 3);
      wall.set(p.wall, vo * 4);
      for (let i = 0; i < p.idx.length; i++) ix[io + i] = p.idx[i] + vo;
    }
    born.fill(b, vo, vo + p.verts);
    box.union(p.box);
    vo += p.verts;
    io += p.idx.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
  g.setAttribute('aWall', new THREE.BufferAttribute(wall, 4));
  g.setAttribute('aBorn', new THREE.BufferAttribute(born, 1));
  g.setIndex(new THREE.BufferAttribute(ix, 1));
  if (one && list[0].p.ranges) {
    g.userData.ranges = list[0].p.ranges;
    g.setDrawRange(...list[0].p.ranges.near);
  }
  g.boundingBox = box;
  g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  return g;
}
const bytesOf = (g) => {
  let n = g.index ? g.index.array.byteLength : 0;
  for (const a of Object.values(g.attributes)) n += a.array.byteLength;
  return n;
};

// ------------------------------------------------------------ the layer
// footprints: data/footprints.json as loaded ({ id: { outline, parts } });
// plans: the fitted landmark plans; osm: the core OSM footprints (world).
// lite (light mode, main.js): no far LOD at all. Ring tiles load, as near
// meshes, only within 1.5 km of the camera; a 2 km core block shows only
// while it is within 1.5 km (horizontally) of the camera or the focus.
const LITE_U = 1500 * S;

export function createMsBuildings({ scene, camera, terrain, heightAt, proj, footprints = {}, plans = [], osm = [], mobile = false, lite = false, debug = {} }) {
  const mode = new URLSearchParams(location.search).get('ms');
  const off = mode === '0';
  const tint = mode === 'debug';
  const stats = { enabled: !off, debug: tint, core: 0, coreInput: 0, masked: 0, maskedOsm: 0, thin: 0, pitched: 0, chimneys: 0, coreTiles: 0, ringTotal: 0, ringLoaded: 0, ringNear: 0, ringFar: 0, ringBuildings: 0, tris: 0, meshes: 0, gpuMB: 0, errors: 0, buildMs: 0 };
  debug.msStats = stats;
  const group = new THREE.Group();
  group.name = 'buildings-ms';
  const api = { group, stats, update() {}, prefetch() {}, idle: async () => stats, tiles: new Map() };
  debug.ms = api;
  if (off) {
    // main.js sets debug.stats after the first frames: fill it in then
    api.update = () => {
      if (debug.stats && !debug.stats.ms) debug.stats.ms = { core: 0, ringLoaded: 0, tris: 0 };
    };
    return api;
  }
  scene.add(group);

  const NEAR_M = lite ? LITE_U / S : mobile ? 2000 : 4000;
  // phones fetch fewer tiles at once and hold a smaller ring; the far
  // threshold is larger so the ring costs fewer triangles on a phone
  const MAX_FETCH = mobile ? 2 : MAX_FETCH_HIGH;
  const RING_LOAD_MAX = mobile ? 60 : 180;
  const FAR_MIN = mobile ? 160 : FAR_MIN_M2;
  // light mode: 1 km core blocks, so the 1.5 km limit cuts finely
  const coreTileM = lite ? 1000 : CORE_TILE_M;
  const material = createBuildingMaterial({ fade: true });
  material.name = 'buildings-ms';
  let ground = null;
  let masks = null;
  let clock = 0;
  let frames = 0;
  let started = false;
  let coreDone = false;
  let castNow = true;
  let gpuBytes = 0;
  let sinceSchedule = SCHEDULE_S;
  let quiet = 0;
  let fetching = 0;
  let reqId = 0;
  const jobs = []; // extrusion jobs, highest priority first
  const coreMeshes = [];
  const coreCents = []; // kept centres x, z (world), for countNear

  const tiles = api.tiles;
  const groups = new Map();
  let buildSum = 0;
  // frustum culling for the ring: an off-screen tile only streams when it is
  // close or near the orbit focus (phones), so turning costs nothing
  const _frustum = new THREE.Frustum();
  const _pm = new THREE.Matrix4();

  // ---- masks: landmark outlines and parts, fitted plans, core OSM centres
  function makeMasks() {
    const polys = [];
    for (const v of Object.values(footprints || {})) {
      if (!v || typeof v !== 'object') continue;
      if (Array.isArray(v.outline) && v.outline.length >= 3) polys.push(v.outline);
      for (const p of v.parts || []) if (Array.isArray(p?.pts) && p.pts.length >= 3) polys.push(p.pts);
    }
    const marks = polys.map((ll) => boxOf(ll.map((q) => proj.project(q[0], q[1]))));
    const CELL = 25; // world units (100 m)
    const grid = new Map();
    for (const poly of osm) {
      const b = boxOf(poly);
      for (let i = Math.floor(b.x0 / CELL); i <= Math.floor(b.x1 / CELL); i++) {
        for (let j = Math.floor(b.z0 / CELL); j <= Math.floor(b.z1 / CELL); j++) {
          const k = i * 65536 + j;
          let a = grid.get(k);
          if (!a) grid.set(k, (a = []));
          a.push(b);
        }
      }
    }
    return {
      // 1: landmark, 2: OSM, 0: free
      test(f) {
        const { pts, cx, cz } = f;
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
        for (const m of marks) {
          if (m.x0 > x1 || m.x1 < x0 || m.z0 > z1 || m.z1 < z0) continue;
          if (inPoly(cx, cz, m.poly)) return 1;
          for (const p of pts) if (inPoly(p.x, p.z, m.poly)) return 1;
          for (const q of m.poly) if (inPoly(q.x, q.z, pts)) return 1;
        }
        for (const r of plans) if (r && inRect(cx, cz, r)) return 1;
        const a = grid.get(Math.floor(cx / CELL) * 65536 + Math.floor(cz / CELL));
        if (a) for (const b of a) if (cx >= b.x0 && cx <= b.x1 && cz >= b.z0 && cz <= b.z1 && inPoly(cx, cz, b.poly)) return 2;
        return 0;
      },
    };
  }

  // ---- jobs: extrude a list of footprints in slices
  // job = { prio, recs, i, T, Tfar, decode(rec, i) -> [{x,z}] | null, h(rec, f), seed, done(packed) }
  function runJobs(t0) {
    while (jobs.length && performance.now() - t0 < SLICE_MS) {
      const J = jobs[0];
      if (J.cancelled) {
        jobs.shift();
        continue;
      }
      while (J.i < J.recs.length && performance.now() - t0 < SLICE_MS) {
        const rec = J.recs[J.i];
        const i = J.i++;
        const raw = J.decode(rec);
        if (!raw) continue;
        const f = footprint(raw);
        if (!f) continue;
        const m = masks.test(f);
        if (m) {
          if (m === 1) stats.masked++;
          else stats.maskedOsm++;
          continue;
        }
        if (badShape(f)) {
          stats.thin++;
          continue;
        }
        const h = J.h(rec, f);
        const T = J.tileOf ? J.tileOf(f) : J.T;
        // the OSM roof treatment on the ML footprints (roofPlan from the
        // footprint shape), so the ring's roofline reads like the core's
        const hint = msRoofHint(f.pts, f.areaM2, h, seedOf(f));
        extrudeBuilding(T, f.pts, h, 'ms', f.areaM2, J.seed + i, ground, false, hint);
        const plan = lastPlan.plan;
        if (plan && plan.planes.length) {
          stats.pitched++;
          if (f.areaM2 <= 220 && h >= 6 && h <= 13 && addChimney(T, f.pts, plan, seedOf(f))) stats.chimneys++;
        }
        if (J.Tfar && f.areaM2 >= FAR_MIN) {
          const box = orientedBox(f.pts);
          extrudeBuilding(J.Tfar, box, h, 'ms', f.areaM2, J.seed + i, ground, false, FAR);
          extrudeBuilding(J.Tvf, box, h, 'ms', f.areaM2, J.seed + i, ground, true);
        }
        // the core: the same building, roof only, for the tiles far from view
        if (J.tileOfVf) extrudeBuilding(J.tileOfVf(f), f.pts, h, 'ms', f.areaM2, J.seed + i, ground, true);
        J.n++;
        J.cents.push(f.cx, f.cz);
      }
      if (J.i >= J.recs.length) {
        jobs.shift();
        J.done();
      }
    }
  }

  // ---- the core
  async function startCore() {
    let doc;
    try {
      const res = await fetch(assetUrl(dataPath('buildings-ms.json')));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!(res.headers.get('content-type') || '').includes('json')) throw new Error('not JSON');
      doc = await res.json();
      if (!Array.isArray(doc?.buildings)) throw new Error('no buildings[]');
    } catch (e) {
      stats.errors++;
      console.warn(`[porto] ms: ${dataPath('buildings-ms.json')} unavailable (${e.message}); no MS buildings in the core`);
      coreDone = true;
      return;
    }
    stats.coreInput = doc.buildings.length;
    const cells = new Map();
    const cellsVf = new Map();
    const t0 = performance.now();
    jobs.push({
      prio: Infinity,
      recs: doc.buildings,
      i: 0,
      n: 0,
      cents: coreCents,
      seed: 0x4d5300,
      decode: (b) => (Array.isArray(b.p) && b.p.length >= 3 && b.h > 0 ? b.p.map((q) => proj.project(q[0], q[1])) : null),
      h: (b, f) => msHeight(f.areaM2, b.h, seedOf(f)),
      tileOf(f) {
        const key = `${Math.floor(f.cx / S / coreTileM)},${Math.floor(f.cz / S / coreTileM)}`;
        let T = cells.get(key);
        if (!T) cells.set(key, (T = newT(true)));
        return T;
      },
      tileOfVf(f) {
        const key = `${Math.floor(f.cx / S / coreTileM)},${Math.floor(f.cz / S / coreTileM)}`;
        let T = cellsVf.get(key);
        if (!T) cellsVf.set(key, (T = newT()));
        return T;
      },
      done() {
        stats.core = this.n;
        for (const [key, T] of cells) {
          const p = pack(T, tint);
          if (!p) continue;
          const g = geometryOf([{ p, born: clock }]);
          const pv = pack(cellsVf.get(key), tint);
          const mesh = new THREE.Mesh(g, material);
          mesh.name = `buildings-ms-${key}`;
          mesh.userData.full = g;
          const [kx, kz] = key.split(',').map(Number);
          const cu = coreTileM * S;
          mesh.userData.rect = { x0: kx * cu, x1: (kx + 1) * cu, zN: kz * cu, zS: (kz + 1) * cu };
          if (pv) mesh.userData.roofs = geometryOf([{ p: pv, born: clock }]);
          mesh.matrixAutoUpdate = false;
          mesh.castShadow = castNow;
          mesh.receiveShadow = true;
          group.add(mesh);
          coreMeshes.push(mesh);
          gpuBytes += bytesOf(g);
        }
        stats.coreTiles = coreMeshes.length;
        coreDone = true;
        stats.buildMs = Math.round(performance.now() - t0);
        refreshStats();
      },
    });
  }

  // ---- the ring
  async function startRing() {
    let doc;
    try {
      const res = await fetch(assetUrl(dataPath('tiles-ms/index.json')));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!(res.headers.get('content-type') || '').includes('json')) throw new Error('not JSON');
      doc = await res.json();
      if (!Array.isArray(doc?.tiles)) throw new Error('no tiles[]');
    } catch (e) {
      stats.errors++;
      console.warn(`[porto] ms: ${dataPath('tiles-ms/index.json')} unavailable (${e.message}); no MS buildings in the ring`);
      return;
    }
    for (const t of doc.tiles) {
      const [s, w, n, e] = t.bbox;
      const sw = proj.project(s, w);
      const ne = proj.project(n, e);
      const key = `${t.x}_${t.y}`;
      const rect = { x0: sw.x, x1: ne.x, zN: ne.z, zS: sw.z };
      tiles.set(key, { key, x: t.x, y: t.y, n: t.n, rect, box: new THREE.Box3(new THREE.Vector3(rect.x0, -100, rect.zN), new THREE.Vector3(rect.x1, 400, rect.zS)), url: assetUrl(dataPath(`tiles-ms/${key}.json`)), state: 'idle', lod: null, near: null, far: null, mesh: null, born: 0, reqId: 0, job: null, prio: 0, tries: 0 });
    }
    stats.ringTotal = tiles.size;
  }

  async function load(T) {
    T.state = 'loading';
    const id = (T.reqId = ++reqId);
    fetching++;
    let tile;
    try {
      const res = await fetch(T.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!(res.headers.get('content-type') || '').includes('json')) throw new Error('not JSON');
      tile = await res.json();
      if (!Array.isArray(tile?.b) || !Array.isArray(tile?.o)) throw new Error('not a tile');
    } catch (e) {
      fetching--;
      if (id !== T.reqId) return;
      stats.errors++;
      T.tries++;
      T.state = T.tries >= 3 ? 'failed' : 'idle';
      T.retryAt = clock + 5 * T.tries;
      if (T.tries === 1) console.warn(`[porto] ms: tile ${T.key} failed (${e.message})`);
      return;
    }
    fetching--;
    if (id !== T.reqId) return; // unloaded meanwhile
    const o = tile.o;
    const Tn = newT(true);
    const Tf = newT();
    const Tvf = newT();
    const job = {
      prio: T.prio,
      recs: tile.b,
      i: 0,
      n: 0,
      cents: [],
      seed: (T.x * 131 + T.y * 7919) * 100003 + 0x4d53,
      T: Tn,
      Tfar: Tf,
      Tvf,
      decode(rec) {
        const pts = [];
        let x = 0;
        let y = 0;
        for (let i = 2; i + 1 < rec.length; i += 2) {
          x += rec[i];
          y += rec[i + 1];
          pts.push(proj.project((o[0] + y) / 1e5, (o[1] + x) / 1e5));
        }
        return pts.length >= 3 ? pts : null;
      },
      h: (rec, f) => msHeight(f.areaM2, rec[0] / 10, seedOf(f)),
      done() {
        T.job = null;
        if (id !== T.reqId) return;
        T.near = pack(Tn, tint);
        T.far = pack(Tf, tint);
        T.vfar = pack(Tvf, tint);
        T.count = this.n;
        T.cents = this.cents;
        T.state = 'built';
        T.born = clock;
      },
    };
    T.job = job;
    jobs.push(job);
    jobs.sort((a, b) => b.prio - a.prio);
  }

  function groupOf(T) {
    const key = `${Math.floor(T.x / GROUP)}_${Math.floor(T.y / GROUP)}`;
    let G = groups.get(key);
    if (!G) groups.set(key, (G = { key, members: new Set(), mesh: null, bytes: 0, dirty: false }));
    return G;
  }
  function dropNearMesh(T) {
    if (!T.mesh) return;
    group.remove(T.mesh);
    T.mesh.geometry.dispose();
    gpuBytes -= bytesOf(T.mesh.geometry);
    T.mesh = null;
  }
  function setLod(T, lod) {
    if (T.lod === lod) return;
    if (T.lod === 'near') dropNearMesh(T);
    if (T.lod === 'far') {
      const G = groupOf(T);
      G.members.delete(T);
      G.dirty = true;
    }
    T.lod = lod;
    if (lod === 'near' && T.near) {
      const g = geometryOf([{ p: T.near, born: T.born }]);
      const mesh = new THREE.Mesh(g, material);
      mesh.name = `buildings-ms-tile-${T.key}`;
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = castNow;
      mesh.userData.casts = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      gpuBytes += bytesOf(g);
      T.mesh = mesh;
    } else if (lod === 'far') {
      const G = groupOf(T);
      G.members.add(T);
      G.dirty = true;
    }
  }
  function rebuildGroup(G) {
    G.dirty = false;
    if (G.mesh) {
      group.remove(G.mesh);
      G.mesh.geometry.dispose();
      gpuBytes -= G.bytes;
      G.mesh = null;
      G.bytes = 0;
    }
    // tiles beyond VFAR_U draw the roof-only variant (no walls)
    const list = [...G.members].filter((T) => T.far).map((T) => ({ p: T.vf && T.vfar ? T.vfar : T.far, born: T.born }));
    const g = list.length ? geometryOf(list) : null;
    if (g) {
      const mesh = new THREE.Mesh(g, material);
      mesh.name = `buildings-ms-far-${G.key}`;
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      group.add(mesh);
      G.mesh = mesh;
      G.bytes = bytesOf(g);
      gpuBytes += G.bytes;
    }
    if (!G.members.size) groups.delete(G.key);
  }
  function unload(T) {
    setLod(T, null);
    if (T.job) T.job.cancelled = true;
    T.job = null;
    T.near = T.far = T.vfar = null;
    T.vf = false;
    T.cents = null;
    T.state = 'idle';
    T.reqId++;
  }

  // flight destination: see tiles.js prefetch
  let dest = null;
  const destAltU = 150 * S;
  const maxFetch = () => (dest && clock < dest.until ? MAX_FETCH * 2 : MAX_FETCH);

  function schedule() {
    const cam = camera.position;
    const flyingTo = !!dest && clock < dest.until;
    const focus = camera.userData.focus || cam;
    const altU = Math.max(0, cam.y - heightAt(cam.x, cam.z));
    const R = radiusFor(altU / S, mobile);
    const nearU = NEAR_M * S;
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pm);
    const cands = [];
    let changed = false;
    let builtCount = 0;
    for (const T of tiles.values()) if (T.state === 'built') builtCount++;
    for (const T of tiles.values()) {
      const dCam = rectDist(T.rect, cam.x, cam.z);
      const dFoc = rectDist(T.rect, focus.x, focus.z);
      const dDest = flyingTo ? rectDist(T.rect, dest.x, dest.z) : Infinity;
      const d = Math.min(dCam, dFoc, dDest);
      let d3 = Math.hypot(dCam, altU);
      if (flyingTo) d3 = Math.min(d3, Math.hypot(dDest, destAltU));
      T.prio = 1 / Math.max(d3, 25);
      if (T.job) T.job.prio = T.prio;
      if (T.state !== 'idle' && T.state !== 'failed' && (d > 2 * R || (lite && d3 > nearU * 1.2))) {
        unload(T);
        changed = true;
        continue;
      }
      if (T.state === 'built') {
        // very far: roof-only houses, when the tile is 6 km from the camera
        // and 3 km from the focus (hysteresis of 10 %)
        const vf = dFoc > FOCUS_KEEP_U && d3 > (T.vf ? VFAR_U * 0.9 : VFAR_U);
        if (vf !== !!T.vf) {
          T.vf = vf;
          if (T.lod === 'far') {
            groupOf(T).dirty = true;
            changed = true;
          }
        }
        // light mode: near only (the unload above takes the far ones)
        const want = lite ? 'near' : d3 < nearU ? 'near' : d3 > nearU * 1.2 ? 'far' : T.lod || 'far';
        if (want !== T.lod) {
          setLod(T, want);
          changed = true;
        }
        if (T.mesh) setMid(T.mesh.geometry, d3);
        continue;
      }
      if (T.state !== 'idle' || d >= R || clock < T.retryAt || (lite && d3 > nearU)) continue;
      // off-screen ring tiles only stream when close or near the focus
      const nearFocus = dFoc < FOCUS_KEEP_U;
      const inView = _frustum.intersectsBox(T.box);
      if (mobile && !inView && !nearFocus && d3 > nearU * 1.5) continue;
      // ring cap: keep the loaded tile count inside the tier's budget
      if (builtCount >= RING_LOAD_MAX && d3 > nearU) continue;
      cands.push(T);
    }
    // light mode: a core block shows only within 1.5 km of the camera or the focus
    if (lite) {
      for (const m of coreMeshes) {
        const r = m.userData.rect;
        m.visible = Math.min(rectDist(r, cam.x, cam.z), rectDist(r, focus.x, focus.z)) < (m.visible ? LITE_U * 1.1 : LITE_U);
      }
    }
    // the core's outer 2 km tiles: roof-only when wholly beyond 6 km (camera) and 3 km (focus)
    for (const m of coreMeshes) {
      const full = m.userData.full;
      if (!full.boundingSphere) full.computeBoundingSphere();
      const bs = full.boundingSphere;
      const dc = Math.hypot(bs.center.x - cam.x, bs.center.z - cam.z, altU) - bs.radius;
      setMid(full, dc);
      const roofs = m.userData.roofs;
      if (!roofs) continue;
      const df = Math.hypot(bs.center.x - focus.x, bs.center.z - focus.z) - bs.radius;
      const roofNow = m.geometry === roofs;
      const want = df > FOCUS_KEEP_U && dc > (roofNow ? VFAR_U * 0.9 : VFAR_U);
      if (want !== roofNow) m.geometry = want ? roofs : full;
    }
    jobs.sort((a, b) => b.prio - a.prio);
    cands.sort((a, b) => b.prio - a.prio);
    for (const T of cands) {
      if (fetching >= maxFetch()) break;
      load(T);
      changed = true;
    }
    quiet = !changed && !fetching && !jobs.length ? quiet + 1 : 0;
  }

  function refreshStats() {
    let loaded = 0;
    let near = 0;
    let far = 0;
    let n = 0;
    let tris = 0;
    let meshes = 0;
    for (const T of tiles.values()) {
      if (T.state !== 'built' || !T.lod) continue;
      loaded++;
      n += T.count || 0;
      if (T.lod === 'near') near++;
      else far++;
    }
    group.traverse((m) => {
      if (!m.isMesh) return;
      meshes++;
      tris += Math.min(m.geometry.index.count, m.geometry.drawRange.count) / 3;
    });
    Object.assign(stats, { ringLoaded: loaded, ringNear: near, ringFar: far, ringBuildings: n, tris: Math.round(tris), meshes, gpuMB: +(gpuBytes / 1048576).toFixed(1), pending: fetching + jobs.length });
    if (debug.stats) debug.stats.ms = { core: stats.core, ringLoaded: loaded, tris: stats.tris };
  }

  api.update = function update(dt = 1 / 60) {
    frames++;
    clock = BUILDING_UNIFORMS.uClock.value; // src/tiles.js advances it
    if (!started) {
      // after the first full frames (main.js sets interactive before ready)
      if (!((debug.interactive || debug.ready) && frames > 20)) return;
      started = true;
      const ax = groundAxes(terrain);
      ground = makeGround(heightAt, ax.xs, ax.zs);
      masks = makeMasks();
      startCore();
      startRing();
      return;
    }
    const t0 = performance.now();
    if (coreDone) {
      sinceSchedule += dt;
      if (sinceSchedule >= SCHEDULE_S) {
        sinceSchedule = 0;
        schedule();
      }
    }
    runJobs(t0);
    for (const G of groups.values()) {
      if (performance.now() - t0 >= SLICE_MS) break;
      if (G.dirty) rebuildGroup(G);
    }
    buildSum += performance.now() - t0;
    // shadows only in closer views: the MS houses are low (mostly 4-10 m),
    // and over the whole city their shadows are below a pixel but cost a
    // second pass of every core mesh (the OSM core casts up to 4000 units)
    const focus = camera.userData.focus;
    const cast = (focus ? camera.position.distanceTo(focus) : 0) < CAST_U;
    if (cast !== castNow) {
      castNow = cast;
      for (const m of coreMeshes) m.castShadow = cast;
      for (const T of tiles.values()) if (T.mesh) T.mesh.castShadow = cast;
    }
    if (frames % 15 === 0) refreshStats();
  };

  // for tests: resolves when nothing is pending (or after timeoutMs)
  api.idle = function idle(timeoutMs = 30000) {
    const t0 = performance.now();
    return new Promise((res) => {
      const tick = () => {
        const busy = !coreDone || fetching > 0 || jobs.length > 0 || quiet < 2 || [...groups.values()].some((G) => G.dirty);
        if (!busy || performance.now() - t0 > timeoutMs) {
          refreshStats();
          return res(stats);
        }
        setTimeout(tick, 100);
      };
      tick();
    });
  };
  api.prefetch = function prefetch(x, z, seconds = 8) {
    dest = { x, z, until: clock + seconds };
    sinceSchedule = SCHEDULE_S;
  };
  api.mainMs = () => +buildSum.toFixed(0);
  // for tests: MS buildings drawn with their centre within rM metres of (x, z)
  api.countNear = function countNear(x, z, rM) {
    const r2 = (rM * S) ** 2;
    let n = 0;
    const scan = (c) => {
      for (let i = 0; i < c.length; i += 2) if ((c[i] - x) ** 2 + (c[i + 1] - z) ** 2 <= r2) n++;
    };
    scan(coreCents);
    for (const T of tiles.values()) if (T.lod && T.cents) scan(T.cents);
    return n;
  };
  return api;
}
