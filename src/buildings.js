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
import { setFacadeConfig, facadeStyle, wallBase, roofBase, roofPlan, extrudeRoofed, STYLE, FACADE_VERT_PARS, FACADE_VERT, FACADE_FRAG_PARS, FACADE_FRAG } from './facades.js';

const TILE_M = 1000; // 1 km: about 60 draw calls for the city, not 230
const MAX_TRIS = 1_500_000;
const SMALL_M2 = 30; // dropped first if over budget ...
const FAR_M = 2500; // ... when farther than this from the centre
const SKIRT = 0.4; // world units the walls reach below the lowest ground point
const FLAT = { shape: 'flat', planes: [], parapet: false, clutter: 0 }; // far LOD: a plain box
// core tiles farther than this from the camera draw flat caps for their
// pitched roofs (a ridge is a pixel or two out there)
const MID_M = 1400;

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
export function extrudeBuilding(T, pts, h, k, areaM2, seedIndex, heightAt, roofOnly = false, attrs = null) {
  const n = pts.length;
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
    lastPlan.plan = plan; // tests (count the roof kinds)
    lastPlan.style = style;
    const sf = attrs?.sf;
    extrudeRoofed(T, pts, plan, { base, gmin, top, footM, hM, wc, rc, w: seed, seed: seedIndex, shop: sf && sf.size ? (i) => sf.has(i) : null });
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

// Fade-in for the streamed tiles (src/tiles.js): each vertex carries the
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

export function createBuildingMaterial({ fade = false } = {}) {
  if (!BUILDING_UNIFORMS.uGrime.value) BUILDING_UNIFORMS.uGrime.value = createFacadeDetailTexture();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  material.name = fade ? 'buildings-tiles' : 'buildings';
  material.defines = {};
  if (fade) material.defines.BRG_FADE = '';
  if (WIN_LITE) material.defines.BRG_WIN_LITE = '';
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, BUILDING_UNIFORMS);
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
  if (!b.r && !b.rc && !b.wc && !b.m && !b.ro && !b.s) return null;
  const a = { r: b.r, rc: b.rc, wc: b.wc, m: b.m, ro: b.ro };
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
  if (!Array.isArray(list) || !list.length) return { group, stats, material: null };
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
  let tris = 0;
  for (let bi = 0; bi < list.length; bi++) {
    const b = list[bi];
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

  // --- pass 2: geometry per tile
  const tiles = new Map();
  const tileOf = (it) => {
    const key = `${Math.floor(it.cx / S / TILE_M)},${Math.floor(it.cz / S / TILE_M)}`;
    let t = tiles.get(key);
    if (!t) tiles.set(key, (t = { key, pos: [], nor: [], col: [], wall: [], idx: [], near: [], farCap: [], roofs: { pos: [], nor: [], col: [], wall: [], idx: [] } }));
    return t;
  };
  for (const it of keep) {
    const T = tileOf(it);
    extrudeBuilding(T, it.pts, it.h, it.k, it.areaM2, it.seed, heightAt, false, it.attrs);
    extrudeBuilding(T.roofs, it.pts, it.h, it.k, it.areaM2, it.seed, heightAt, true, it.attrs);
    stats.built++;
  }

  const material = createBuildingMaterial();
  for (const T of tiles.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(T.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(T.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(T.col, 3));
    g.setAttribute('aWall', new THREE.Float32BufferAttribute(T.wall, 4));
    // index blocks: [pitched roofs | walls and flat roofs | flat caps for
    // the pitched ones]; near draws the first two, the middle LOD the last two
    const nA = T.near.length;
    const nB = T.idx.length;
    const nC = T.farCap.length;
    const all = T.near.concat(T.idx, T.farCap);
    g.setIndex(all);
    g.userData.ranges = { near: [0, nA + nB], mid: [nA, nB + nC] };
    g.setDrawRange(0, nA + nB);
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
    stats.vertices += T.pos.length / 3;
  }
  // Very far tiles draw their roofs only: a tile wholly beyond 6 km from the
  // camera (`cam`) and 3 km from the focus. Called by src/tiles.js.
  // Tiles beyond MID from the camera draw flat caps instead of the pitched
  // roofs (the same buffers, another index range): as cheap as before.
  const VFAR = 6000 * S;
  const KEEP = 3000 * S;
  const MID = MID_M * S;
  group.userData.updateLod = (cam, focus) => {
    for (const mesh of group.children) {
      const full = mesh.userData.full;
      const bs = full.boundingSphere;
      const dc = Math.hypot(bs.center.x - cam.x, bs.center.y - cam.y, bs.center.z - cam.z) - bs.radius;
      const r = full.userData.ranges;
      if (r) {
        const mid = full.drawRange.start > 0;
        const wantMid = dc > (mid ? MID * 0.9 : MID);
        if (wantMid !== mid) {
          const [s, c] = wantMid ? r.mid : r.near;
          full.setDrawRange(s, c);
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
  return { group, stats, material, footprints: keep.map((it) => it.pts) };
}
