// The street level of the centre, close up ("Город вблизи"):
//
//   - calçada portuguesa: white limestone and black basalt cobbles, drawn by
//     a texture-sampled shader (calcadaMaterial: textures.js calçada maps) on
//     the pedestrian streets and the
//     sidewalks (roads.js uses it in its own meshes) and here on the
//     pedestrian squares (<data_dir>/streetscape.json, OSM highway=pedestrian
//     areas and place=square): waves on the main squares (Praça da
//     República, Avenida Central, Largo do Paço), a diagonal net on the
//     other largos, a border band along the streets. The single stones show
//     only close up; farther away the pattern, then a flat tint. On a
//     landmark that is a square with its own paving (Praça da República),
//     the calçada lies on that paving (its height read from the model);
//   - street furniture, instanced, within ~350 m of the point the camera
//     looks at: a post under every street-lamp glow of roads.js, iron
//     lanterns on the pedestrian streets and squares (OSM street_lamp nodes,
//     else every 20 m) with their own glow at night, benches, bollards at
//     the entrances of the pedestrian streets, street trees (OSM natural=tree
//     and tree_row), café terraces (tables, chairs, umbrellas) in front of
//     the cafés and restaurants of pois.json;
//   - people (people.js) on the walk lanes built here: the pedestrian streets,
//     the sidewalks and paths across the squares, cut wherever they meet a
//     carriageway with cars, a building or a landmark;
//   - the POI signs (pois.js) on the facades.
//
// Built from life.js once streetscape.json and pois.json have arrived;
// updated every frame on the shared clock. Light mode (lite): fewer and
// nearer people, no trees, benches or bollards, shorter radii.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { S } from './geo.js';
import { CITY, dataPath, hasData } from './city.js';
import { buildNetwork } from './road-network.js';
import { RIBBON_LIFT, SIDEWALK_R, WALKED, sidewalkM, lampSites, lampGlow, LAMP_HEIGHT_M } from './roads.js';
import { loadPois, createPoiSigns, isOpenAtHour, guessOpen } from './pois.js';
import { createPeople, pedestrianDemand } from './people.js';
import { buildPortoStreetLife } from './porto-streetscape.js';

// ------------------------------------------------------------ calçada
// The pavement material moved to calcada.js (roads.js needs it at boot; this
// module is part of the deferred life layer). Re-exported for old importers.
import { CALCADA, calcadaPatternOf, calcadaMaterial } from './calcada.js';
export { CALCADA, calcadaPatternOf, calcadaMaterial };

// ------------------------------------------------------------ helpers
function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function pip(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
const polyArea = (poly) => {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j].x * poly[i].z - poly[i].x * poly[j].z;
  return a / 2;
};

// polygons ({x, z} rings) in a grid: inside(x, z)
function polyIndex(polys, CELL = 8) {
  const list = [];
  const grid = new Map();
  for (const poly of polys) {
    if (!poly || poly.length < 3) continue;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of poly) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    const i = list.length;
    list.push({ poly, x0, x1, z0, z1 });
    for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) {
      for (let gz = Math.floor(z0 / CELL); gz <= Math.floor(z1 / CELL); gz++) {
        const k = gx * 65536 + gz;
        let c = grid.get(k);
        if (!c) grid.set(k, (c = []));
        c.push(i);
      }
    }
  }
  return {
    count: list.length,
    inside(x, z) {
      const c = grid.get(Math.floor(x / CELL) * 65536 + Math.floor(z / CELL));
      if (!c) return false;
      for (const i of c) {
        const b = list[i];
        if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
        if (pip(b.poly, x, z)) return true;
      }
      return false;
    },
  };
}

// carriageways with cars: segments with their half width; near(x, z, m):
// within the half width + m of one
function carIndex(net, zones, CELL = 8) {
  const { X, Z, Y, G } = net;
  const seg = [];
  const grid = new Map();
  for (const w of net.ways) {
    if (!w.car || w.tunnel) continue;
    const half = (w.widthM / 2) * S;
    for (let i = w.start; i < w.start + w.n - 1; i++) {
      // a deck passes over whatever is below it
      if (Y[i] - G[i] > 1 || Y[i + 1] - G[i + 1] > 1) continue;
      const mx = (X[i] + X[i + 1]) / 2;
      const mz = (Z[i] + Z[i + 1]) / 2;
      if (zones.some((q) => (mx - q.x) ** 2 + (mz - q.z) ** 2 < q.r * q.r)) continue;
      const k = seg.length / 5;
      seg.push(X[i], Z[i], X[i + 1], Z[i + 1], half);
      const r = half + 1;
      for (let gx = Math.floor((Math.min(X[i], X[i + 1]) - r) / CELL); gx <= Math.floor((Math.max(X[i], X[i + 1]) + r) / CELL); gx++) {
        for (let gz = Math.floor((Math.min(Z[i], Z[i + 1]) - r) / CELL); gz <= Math.floor((Math.max(Z[i], Z[i + 1]) + r) / CELL); gz++) {
          const key = gx * 65536 + gz;
          let c = grid.get(key);
          if (!c) grid.set(key, (c = []));
          c.push(k);
        }
      }
    }
  }
  return {
    near(x, z, m = 0) {
      const c = grid.get(Math.floor(x / CELL) * 65536 + Math.floor(z / CELL));
      if (!c) return false;
      for (const k of c) {
        const o = k * 5;
        const ax = seg[o];
        const az = seg[o + 1];
        const dx = seg[o + 2] - ax;
        const dz = seg[o + 3] - az;
        const L2 = dx * dx + dz * dz || 1e-9;
        const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        const ex = ax + dx * u - x;
        const ez = az + dz * u - z;
        const r = seg[o + 4] + m;
        if (ex * ex + ez * ez < r * r) return true;
      }
      return false;
    },
  };
}

// The landmarks around the centre. A landmark that is a paved square (its
// model has a floor near the ground over most of its outline) can be walked
// on: at(x, z) is the floor's height there, NaN where something stands on
// it (a fountain, a kiosk). Any other landmark is solid inside its outline.
function landmarkFloors({ items, outlines, heightAt, surfaceHeights, near }) {
  const floors = [];
  const solids = [];
  const STEP = 0.5; // world units (2 m)
  for (const it of items || []) {
    const poly = outlines?.[it.index];
    if (!poly || poly.length < 3) continue;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of poly) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    if (!near((x0 + x1) / 2, (z0 + z1) / 2)) continue;
    const areaM = Math.abs(polyArea(poly)) / (S * S);
    const meshes = (it.meshes || []).filter((m) => m?.geometry?.attributes?.position);
    if (areaM < 1500 || !meshes.length || !surfaceHeights) {
      solids.push(poly);
      continue;
    }
    const nx = Math.ceil((x1 - x0) / STEP) + 1;
    const nz = Math.ceil((z1 - z0) / STEP) + 1;
    const xs = [];
    const zs = [];
    const lo = [];
    const hi = [];
    const at = [];
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * STEP;
        const z = z0 + j * STEP;
        if (!pip(poly, x, z)) continue;
        const g = heightAt(x, z);
        xs.push(x);
        zs.push(z);
        lo.push(g - 0.5);
        hi.push(g + 0.6);
        at.push(j * nx + i);
      }
    }
    if (xs.length < 20) {
      solids.push(poly);
      continue;
    }
    const hit = new Float32Array(xs.length).fill(NaN);
    for (const m of meshes) {
      const h = surfaceHeights(m, xs, zs, lo, hi);
      for (let k = 0; k < h.length; k++) if (Number.isFinite(h[k]) && !(h[k] <= hit[k])) hit[k] = h[k];
    }
    // open sky only: a floor under a roof, an arcade, a parasol or a crown
    // is inside the landmark (a church stands on its own ground pad)
    const lo2 = xs.map((_, k) => (Number.isFinite(hit[k]) ? hit[k] : lo[k] + 0.5) + 0.45);
    const hi2 = xs.map(() => 1e6);
    for (const m of meshes) {
      const h = surfaceHeights(m, xs, zs, lo2, hi2);
      for (let k = 0; k < h.length; k++) if (Number.isFinite(h[k])) hit[k] = NaN;
    }
    const off = [];
    for (let k = 0; k < xs.length; k++) if (Number.isFinite(hit[k])) off.push(hit[k] - heightAt(xs[k], zs[k]));
    off.sort((a, b) => a - b);
    const med = off.length ? off[off.length >> 1] : NaN;
    const Y = new Float32Array(nx * nz).fill(NaN);
    const inside = new Uint8Array(nx * nz);
    let valid = 0;
    for (let k = 0; k < xs.length; k++) {
      inside[at[k]] = 1;
      const g = heightAt(xs[k], zs[k]);
      const o = hit[k] - g;
      if (Number.isFinite(o) && Math.abs(o - med) < 0.06) {
        // where the model's floor lies under the terrain, the ground shows:
        // the walking surface is the higher of the two (at the street level)
        Y[at[k]] = Math.max(hit[k], g + RIBBON_LIFT - 0.024);
        valid++;
      }
    }
    if (!(Math.abs(med) < 0.45) || valid < 0.4 * xs.length) {
      solids.push(poly);
      continue;
    }
    // small things (a lamp post, a bench, a parasol) leave a hole of one or
    // two cells: the paving runs under them
    for (let pass = 0; pass < 2; pass++) {
      const fill = [];
      for (let j = 1; j < nz - 1; j++) {
        for (let i = 1; i < nx - 1; i++) {
          const k = j * nx + i;
          if (!inside[k] || Number.isFinite(Y[k])) continue;
          let s = 0;
          let c = 0;
          for (const q of [k - 1, k + 1, k - nx, k + nx]) {
            if (Number.isFinite(Y[q])) {
              s += Y[q];
              c++;
            }
          }
          if (c >= 3) fill.push(k, s / c);
        }
      }
      for (let q = 0; q < fill.length; q += 2) Y[fill[q]] = fill[q + 1];
    }
    floors.push({ id: it.data.id, poly, x0, x1, z0, z1, nx, nz, STEP, Y, inside, valid, points: xs.length });
  }
  const solidIdx = polyIndex(solids);
  return {
    floors,
    solids: solids.length,
    solidAt: (x, z) => solidIdx.inside(x, z),
    // floor height, NaN (blocked), or undefined (not on a floor landmark)
    at(x, z) {
      for (const f of floors) {
        if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1 || !pip(f.poly, x, z)) continue;
        const u = (x - f.x0) / f.STEP;
        const v = (z - f.z0) / f.STEP;
        const i = Math.min(f.nx - 2, Math.max(0, Math.floor(u)));
        const j = Math.min(f.nz - 2, Math.max(0, Math.floor(v)));
        const a = f.Y[j * f.nx + i];
        const b = f.Y[j * f.nx + i + 1];
        const c = f.Y[(j + 1) * f.nx + i];
        const d = f.Y[(j + 1) * f.nx + i + 1];
        const fu = u - i;
        const fv = v - j;
        // corners outside the outline take the others' height
        const vals = [a, b, c, d].filter(Number.isFinite);
        if (vals.length < 3) return NaN;
        const m = vals.reduce((s, q) => s + q, 0) / vals.length;
        const A = Number.isFinite(a) ? a : f.inside[j * f.nx + i] ? NaN : m;
        const B = Number.isFinite(b) ? b : f.inside[j * f.nx + i + 1] ? NaN : m;
        const C = Number.isFinite(c) ? c : f.inside[(j + 1) * f.nx + i] ? NaN : m;
        const D = Number.isFinite(d) ? d : f.inside[(j + 1) * f.nx + i + 1] ? NaN : m;
        return (A * (1 - fu) + B * fu) * (1 - fv) + (C * (1 - fu) + D * fu) * fv;
      }
      return undefined;
    },
  };
}

// ------------------------------------------------------------ furniture
function part(geo, color, glow = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  const col = new THREE.Color(color);
  for (let i = 0; i < n; i++) col.toArray(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
  return g;
}
// metres; y: the bottom
const boxG = (w, h, d, x, y, z, color, glow = 0) => part(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), color, glow);
const cylG = (rt, rb, h, seg, x, y, z, color, glow = 0) => part(new THREE.CylinderGeometry(rt, rb, h, seg, 1, false).translate(x, y + h / 2, z), color, glow);
const coneG = (r, h, seg, x, y, z, color) => part(new THREE.ConeGeometry(r, h, seg, 1, true).translate(x, y + h / 2, z), color);
const icoG = (r, x, y, z, color) => part(new THREE.IcosahedronGeometry(r, 0).translate(x, y, z), color);
function merged(parts) {
  const g = mergeGeometries(parts);
  g.scale(S, S, S);
  g.computeBoundingSphere();
  return g;
}
const IRON = 0x1d2621;
// +z is the front (a bench's seat faces +z)
const FURNITURE = {
  // a tall street lamp under the roads.js glow (7 m)
  tall: () => merged([cylG(0.1, 0.14, 0.6, 6, 0, -0.3, 0, 0x3a3d40), cylG(0.06, 0.09, LAMP_HEIGHT_M - 0.1, 6, 0, 0.3, 0, 0x4a4e52), boxG(0.62, 0.14, 0.3, 0, LAMP_HEIGHT_M - 0.1, 0, 0xf2e6c8, 1), boxG(0.66, 0.06, 0.34, 0, LAMP_HEIGHT_M + 0.04, 0, 0x3a3d40)]),
  // Braga's iron lantern on a post, 4.4 m
  lantern: () =>
    merged([
      cylG(0.12, 0.16, 0.7, 6, 0, -0.3, 0, IRON),
      cylG(0.045, 0.06, 3.3, 6, 0, 0.4, 0, IRON),
      cylG(0.2, 0.12, 0.5, 4, 0, 3.7, 0, 0xffe2a8, 1),
      cylG(0.02, 0.25, 0.2, 4, 0, 4.2, 0, IRON),
      cylG(0.02, 0.02, 0.15, 4, 0, 4.4, 0, IRON),
    ]),
  bench: () =>
    merged([
      boxG(0.07, 0.42, 0.48, -0.75, -0.05, 0, IRON),
      boxG(0.07, 0.42, 0.48, 0.75, -0.05, 0, IRON),
      boxG(1.8, 0.06, 0.46, 0, 0.37, 0.02, 0x8a5a36),
      boxG(1.8, 0.34, 0.05, 0, 0.5, -0.22, 0x7d5131),
    ]),
  bollard: () => merged([cylG(0.08, 0.1, 1.2, 6, 0, -0.3, 0, 0x2a2c2e), cylG(0.11, 0.11, 0.06, 6, 0, 0.72, 0, 0x8f8a7e)]),
  // a café table with two chairs (along x)
  table: () =>
    merged([
      cylG(0.38, 0.38, 0.04, 8, 0, 0.7, 0, 0xd8d2c4),
      cylG(0.035, 0.035, 0.72, 4, 0, -0.02, 0, 0x55595d),
      cylG(0.22, 0.22, 0.03, 6, 0, 0, 0, 0x55595d),
      boxG(0.42, 0.45, 0.4, -0.66, -0.02, 0, 0x5d6266),
      boxG(0.05, 0.42, 0.4, -0.9, 0.43, 0, 0x5d6266),
      boxG(0.42, 0.45, 0.4, 0.66, -0.02, 0, 0x5d6266),
      boxG(0.05, 0.42, 0.4, 0.9, 0.43, 0, 0x5d6266),
    ]),
  // a parasol; the instance colour tints it
  umbrella: () => merged([cylG(0.025, 0.025, 2.3, 4, 0, 0, 0, 0xe8e4da), coneG(1.35, 0.42, 8, 0, 1.98, 0, 0xf6f2ea), cylG(1.35, 1.35, 0.12, 8, 0, 1.86, 0, 0xf6f2ea)]),
  tree: () => merged([cylG(0.12, 0.2, 3.6, 5, 0, -0.3, 0, 0x5b4636), icoG(2.1, 0, 4.9, 0, 0x4f6d30), icoG(1.5, 0.7, 5.9, -0.4, 0x5a7a36), icoG(1.3, -0.8, 5.5, 0.6, 0x48662b)]),
};
const UMBRELLA_COLORS = [0xf3efe6, 0xb23a2e, 0x24452f, 0x23324f, 0xe7d9b0, 0x8a2433].map((h) => new THREE.Color(h));

function furnitureMaterial(uniforms, key) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.08 });
  mat.customProgramCacheKey = () => `street-furniture:${key}`;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uStNight = uniforms.uStNight;
    sh.uniforms.uStGlow = uniforms.uStGlow;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vStGlow;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvStGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uStNight;\nuniform float uStGlow;\nvarying float vStGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.74, 0.42) * vStGlow * uStNight * uStGlow * 1.8;');
  };
  return mat;
}

// ------------------------------------------------------------ data
async function fetchStreet() {
  const res = await fetch(`${import.meta.env.BASE_URL}${dataPath('streetscape.json')}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!(res.headers.get('content-type') || '').includes('json')) throw new Error('not JSON');
  return JSON.parse(await res.text());
}

const TERRACE_KINDS = new Set(['cafe', 'restaurant', 'bar', 'pub', 'ice_cream', 'pastry', 'bakery', 'fast_food']);
// lane types and their weight for the spawning people
const LANE = { pedestrian: 0, sidewalk: 1, square: 2, carfree: 3, path: 4 };
const LANE_WEIGHT = [3, 1, 2.6, 2.2, 0.6];

// ------------------------------------------------------------ public
// ctx (life.js): { camera, roads, project, heightAt, items, outlines,
//   footprints, lite, mobile, debug, model, fx, surfaceHeights }
export function createStreetscape(ctx) {
  const group = new THREE.Group();
  group.name = 'streetscape';
  const stats = { status: 'loading' };
  let built = null;
  const t0 = performance.now();
  // Porto's own street life first: it is built from the engine's data (roads,
  // terrain, landmarks) and does not wait on streetscape.json / pois.json
  let porto = null;
  try {
    porto = buildPortoStreetLife(ctx);
    group.add(porto.object);
    stats.porto = porto.stats;
    stats.status = 'ready (porto)';
  } catch (e) {
    console.warn('[porto] porto street life failed', e);
  }
  // the data-driven level needs streetscape.json; a city that ships none (see
  // "data_absent" in its config) keeps only its own street life, no request
  const dataLevel = hasData('streetscape.json')
    ? Promise.all([fetchStreet(), loadPois()])
    : Promise.reject(new Error('not shipped for this city'));
  dataLevel
    .then(([doc, pois]) => {
      try {
        built = build(ctx, group, doc, pois, stats);
        stats.status = porto ? 'ready (porto + data)' : 'ready';
        stats.buildMs = Math.round(performance.now() - t0);
      } catch (e) {
        stats.status = `failed: ${e.message}`;
        console.warn('[porto] streetscape failed', e);
      }
    })
    .catch((e) => {
      if (!porto) stats.status = `no data: ${e.message}`;
      console.info(`[porto] ${dataPath('streetscape.json')} unavailable (${e.message}); Porto street life only.`);
    });
  return {
    object: group,
    stats,
    update(dt, frustum, view) {
      // once the data-driven level is up its own people carry the streets,
      // so the promenade crowd steps aside
      porto?.update(dt, frustum, view, { suppressPeople: !!built });
      built?.update(dt, frustum, view);
    },
    get built() {
      return built;
    },
  };
}

function build(ctx, group, doc, pois, stats) {
  const { camera, roads, project, heightAt, items = [], outlines = [], footprints = [], lite = false, model, fx, surfaceHeights } = ctx;
  const tb = performance.now();
  const rnd = lcg(20260623);
  const net = buildNetwork(roads, project, heightAt);
  const { X, Z } = net;
  const ms = CITY.ms_centre;
  const centre = Array.isArray(ms) ? project(ms[0], ms[1]) : { x: 0, z: 0 };
  // walk lanes and furniture within R of the centre (1.3 km; light mode 1 km)
  const R = lite ? 250 : 330;
  const nearC = (x, z, r = R) => (x - centre.x) ** 2 + (z - centre.z) ** 2 < r * r;
  const STEP = 0.5; // world units (2 m) between lane samples
  const LIFT = RIBBON_LIFT + 0.015;

  // ---- what is in the way
  const zones = (CITY.traffic?.car_free || []).map(([la, lo, r]) => ({ ...project(la, lo), r: r * S }));
  const inZone = (x, z) => zones.some((q) => (x - q.x) ** 2 + (z - q.z) ** 2 < q.r * q.r);
  const bIdx = polyIndex(footprints);
  const cars = carIndex(net, zones);
  const marks = landmarkFloors({ items, outlines, heightAt, surfaceHeights, near: (x, z) => nearC(x, z, R + 80) });
  // the walking surface: a landmark's paving, else the street level
  const groundAt = (x, z) => {
    const f = marks.at(x, z);
    return f === undefined ? heightAt(x, z) + LIFT : f + 0.02;
  };
  // where nobody walks and nothing stands
  const solidAt = (x, z) => bIdx.inside(x, z) || marks.solidAt(x, z) || Number.isNaN(marks.at(x, z));
  const blockedAt = (x, z, y, margin = 0.3 * S) => solidAt(x, z) || (y - heightAt(x, z) < 0.6 && cars.near(x, z, margin));

  // ---- walk lanes: resampled every STEP, cut where blocked
  const LX = [];
  const LZ = [];
  const LY = [];
  const LH = [];
  const laneStart = [];
  const laneN = [];
  const laneType = [];
  const laneEndCar = []; // per lane end: cut by a carriageway (a bollard spot)
  const mouths = []; // [x, z, tx, tz, half] where a pedestrian lane meets a street
  function addLane(px, pz, py, half, type) {
    // resample along the polyline
    const sx = [];
    const sz = [];
    const sy = [];
    const st = [];
    let carry = 0;
    for (let i = 0; i < px.length - 1; i++) {
      const dx = px[i + 1] - px[i];
      const dz = pz[i + 1] - pz[i];
      const L = Math.hypot(dx, dz);
      if (L < 1e-6) continue;
      let s = carry;
      while (s < L) {
        const u = s / L;
        // tested as stored (Float32): a point on a wall must not flip in
        sx.push(Math.fround(px[i] + dx * u));
        sz.push(Math.fround(pz[i] + dz * u));
        sy.push(py[i] + (py[i + 1] - py[i]) * u);
        st.push(dx / L, dz / L);
        s += STEP;
      }
      carry = s - L;
    }
    const n = sx.length;
    if (n < 3) return;
    const ok = new Uint8Array(n);
    const hh = new Float32Array(n);
    const ys = new Float32Array(n);
    const carCut = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const x = sx[k];
      const z = sz[k];
      const f = marks.at(x, z);
      const y = f === undefined ? sy[k] : f + 0.02;
      ys[k] = y;
      if (Number.isNaN(y)) continue;
      const onCar = y - heightAt(x, z) < 0.6 && cars.near(x, z, 0.3 * S);
      if (onCar) carCut[k] = 1;
      if (onCar || bIdx.inside(x, z) || marks.solidAt(x, z)) continue;
      ok[k] = 1;
      // the widest symmetric band that stays clear
      const nx = -st[k * 2 + 1];
      const nz = st[k * 2];
      for (const fr of [1, 0.66, 0.33]) {
        const h = half * fr;
        if (!blockedAt(x + nx * h, z + nz * h, y, 0.15 * S) && !blockedAt(x - nx * h, z - nz * h, y, 0.15 * S)) {
          hh[k] = h;
          break;
        }
      }
    }
    // runs of free samples, at least 3
    let a = 0;
    while (a < n) {
      while (a < n && !ok[a]) a++;
      let b = a;
      while (b < n && ok[b]) b++;
      if (b - a >= 3) {
        laneStart.push(LX.length);
        laneN.push(b - a);
        laneType.push(type);
        for (let k = a; k < b; k++) {
          LX.push(sx[k]);
          LZ.push(sz[k]);
          LY.push(ys[k]);
          LH.push(hh[k]);
        }
        const c0 = a > 0 && carCut[a - 1];
        const c1 = b < n && carCut[b];
        laneEndCar.push(c0 ? 1 : 0, c1 ? 1 : 0);
        if (type === LANE.pedestrian) {
          if (c0) mouths.push(sx[a], sz[a], ys[a], -st[a * 2], -st[a * 2 + 1], half);
          if (c1) mouths.push(sx[b - 1], sz[b - 1], ys[b - 1], st[(b - 1) * 2], st[(b - 1) * 2 + 1], half);
        }
      }
      a = b;
    }
  }
  // the net's points of a way, offset `off` (world, left of travel), with
  // the surface height there
  function wayLine(w, off, lift) {
    const px = [];
    const pz = [];
    const py = [];
    const e = w.start + w.n - 1;
    for (let i = w.start; i <= e; i++) {
      const a = Math.max(w.start, i - 1);
      const b = Math.min(e, i + 1);
      const tx = X[b] - X[a];
      const tz = Z[b] - Z[a];
      const L = Math.hypot(tx, tz) || 1;
      px.push(X[i] + (tz / L) * off);
      pz.push(Z[i] - (tx / L) * off);
      py.push(net.surfaceY(i, off) + lift);
    }
    return [px, pz, py];
  }
  let wayLanes = 0;
  for (const w of net.ways) {
    if (w.tunnel || w.n < 2) continue;
    const m = w.start + (w.n >> 1);
    if (!nearC(X[m], Z[m])) continue;
    if (w.hw === 'pedestrian' || (w.kind === 'foot' && w.hw !== 'steps')) {
      const [px, pz, py] = wayLine(w, 0, RIBBON_LIFT + 0.015);
      addLane(px, pz, py, Math.max(0.3, w.widthM / 2 - 0.7) * S, w.hw === 'pedestrian' ? LANE.pedestrian : LANE.path);
      wayLanes++;
    } else if (WALKED.has(w.hw) && !w.bridge && X[m] * X[m] + Z[m] * Z[m] < SIDEWALK_R * SIDEWALK_R) {
      const half = (w.widthM / 2) * S;
      const sw = sidewalkM(w.hw) * S;
      for (const sgn of [1, -1]) {
        const [px, pz, py] = wayLine(w, sgn * (half + sw / 2 + 0.15 * S), RIBBON_LIFT + 0.035);
        addLane(px, pz, py, Math.max(0.1 * S, sw / 2 - 0.3 * S), LANE.sidewalk);
      }
      // a street of the car-free centre: people walk down the middle too
      if (inZone(X[m], Z[m])) {
        const [px, pz, py] = wayLine(w, 0, RIBBON_LIFT + 0.015);
        addLane(px, pz, py, Math.max(0.5, w.widthM / 2 - 0.8) * S, LANE.carfree);
      }
      wayLanes++;
    }
  }

  // ---- the squares: calçada, paths across, groups, lanterns, benches
  const areas = [];
  for (const a of doc.areas || []) {
    if (!Array.isArray(a.r) || a.r.length < 3) continue;
    const poly = a.r.map((q) => project(q[0], q[1]));
    let cx = 0;
    let cz = 0;
    for (const p of poly) {
      cx += p.x;
      cz += p.z;
    }
    cx /= poly.length;
    cz /= poly.length;
    if (cx * cx + cz * cz > SIDEWALK_R * SIDEWALK_R) continue;
    areas.push({ name: a.name || '', kind: a.k, poly, cx, cz, areaM: a.a || Math.abs(polyArea(poly)) / (S * S), pat: calcadaPatternOf(a.name, 'square') });
  }
  // calçada meshes: draped on the terrain, or laid on a landmark's paving
  const CT = { pos: [], pat: [], idx: [] };
  let carpets = 0;
  function tri(T, a, b, c, pat) {
    const v = T.pos.length / 3;
    for (const p of [a, b, c]) {
      T.pos.push(p.x, p.y, p.z);
      T.pat.push(pat, 0, 1000);
    }
    // up-facing
    const up = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    if (up >= 0) T.idx.push(v, v + 1, v + 2);
    else T.idx.push(v, v + 2, v + 1);
  }
  const MAXE = 2.5; // world units: longer triangle edges are split (drape)
  const onAnyFloor = (x, z) => marks.floors.some((f) => x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1 && pip(f.poly, x, z));
  function drapeTri(a, b, c, pat, depth = 0) {
    const e = Math.max(Math.hypot(a.x - b.x, a.z - b.z), Math.hypot(b.x - c.x, b.z - c.z), Math.hypot(c.x - a.x, c.z - a.z));
    if (e > MAXE && depth < 6) {
      const mid = (p, q) => ({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 });
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      drapeTri(a, ab, ca, pat, depth + 1);
      drapeTri(ab, b, bc, pat, depth + 1);
      drapeTri(ca, bc, c, pat, depth + 1);
      drapeTri(ab, bc, ca, pat, depth + 1);
      return;
    }
    // a landmark's paving carries its own carpet (below)
    if (onAnyFloor((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3)) return;
    const y = (p) => ({ x: p.x, z: p.z, y: heightAt(p.x, p.z) + RIBBON_LIFT - 0.012 });
    tri(CT, y(a), y(b), y(c), pat);
  }
  for (const ar of areas) {
    const tris0 = CT.idx.length;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of ar.poly) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    // on a landmark's paving: a carpet of 2 m cells on the open floor
    ar.floor = '';
    for (const f of marks.floors) {
      if (f.x1 < x0 || f.x0 > x1 || f.z1 < z0 || f.z0 > z1) continue;
      const cy = (i, j) => f.Y[j * f.nx + i];
      let any = false;
      for (let j = 0; j < f.nz - 1; j++) {
        for (let i = 0; i < f.nx - 1; i++) {
          const a = cy(i, j);
          const b = cy(i + 1, j);
          const c = cy(i, j + 1);
          const d = cy(i + 1, j + 1);
          if (!Number.isFinite(a + b + c + d)) continue;
          const x = f.x0 + i * f.STEP;
          const z = f.z0 + j * f.STEP;
          const mx = x + f.STEP / 2;
          const mz = z + f.STEP / 2;
          if (!pip(ar.poly, mx, mz) || !pip(f.poly, mx, mz)) continue;
          const L = 0.012;
          const P = (px, pz, py) => ({ x: px, z: pz, y: py + L });
          tri(CT, P(x, z, a), P(x + f.STEP, z, b), P(x + f.STEP, z + f.STEP, d), ar.pat);
          tri(CT, P(x, z, a), P(x + f.STEP, z + f.STEP, d), P(x, z + f.STEP, c), ar.pat);
          any = true;
        }
      }
      if (any) {
        carpets++;
        ar.floor += `${f.id} `;
      }
    }
    const contour = ar.poly.map((p) => new THREE.Vector2(p.x, p.z));
    if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
    const faces = THREE.ShapeUtils.triangulateShape(contour, []);
    const v = (i) => ({ x: contour[i].x, z: contour[i].y });
    for (const [i, j, k] of faces) drapeTri(v(i), v(j), v(k), ar.pat);
    ar.tris = (CT.idx.length - tris0) / 3;
  }
  let calcadaMesh = null;
  if (CT.idx.length) {
    const g = new THREE.BufferGeometry();
    const n = CT.pos.length / 3;
    g.setAttribute('position', new THREE.Float32BufferAttribute(CT.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(n * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(0.5), 3));
    g.setAttribute('aPat', new THREE.Float32BufferAttribute(CT.pat, 3));
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(CT.idx, 1) : new THREE.Uint16BufferAttribute(CT.idx, 1));
    g.computeBoundingSphere();
    calcadaMesh = new THREE.Mesh(g, calcadaMaterial({ polygonOffsetUnits: -2, lite }));
    calcadaMesh.name = 'calcada-squares';
    calcadaMesh.receiveShadow = true;
    group.add(calcadaMesh);
  }

  // paths across the squares (the walk lanes), standing groups
  const spots = { x: [], y: [], z: [], yaw: [], sit: [], t: [], kind: [], ref: [] };
  const addSpot = (x, y, z, yaw, sit, kind, ref = -1) => {
    if (Number.isNaN(y) || solidAt(x, z) || cars.near(x, z, 0.1 * S)) return;
    spots.x.push(x);
    spots.y.push(y);
    spots.z.push(z);
    spots.yaw.push(yaw);
    spots.sit.push(sit);
    spots.t.push(rnd());
    spots.kind.push(kind);
    spots.ref.push(ref);
  };
  function randomIn(ar) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of ar.poly) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    for (let g = 0; g < 30; g++) {
      const x = x0 + rnd() * (x1 - x0);
      const z = z0 + rnd() * (z1 - z0);
      if (!pip(ar.poly, x, z)) continue;
      const y = groundAt(x, z);
      if (Number.isNaN(y) || blockedAt(x, z, y, 0.5 * S)) continue;
      return { x, z, y };
    }
    return null;
  }
  const squaresNear = areas.filter((a) => nearC(a.cx, a.cz));
  for (const ar of squaresNear) {
    // a few straight paths between points of the edge
    const K = Math.max(1, Math.min(10, Math.round(ar.areaM / 650)));
    for (let k = 0; k < K; k++) {
      const p = randomIn(ar);
      const q = randomIn(ar);
      if (!p || !q || Math.hypot(p.x - q.x, p.z - q.z) < 6) continue;
      // extend both ways to the edge of the square
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const L = Math.hypot(dx, dz);
      const ux = dx / L;
      const uz = dz / L;
      const ext = (o, sgn) => {
        let s = 0;
        while (s < 80 && pip(ar.poly, o.x + ux * sgn * (s + 0.5), o.z + uz * sgn * (s + 0.5))) s += 0.5;
        return { x: o.x + ux * sgn * s, z: o.z + uz * sgn * s };
      };
      const a = ext(p, -1);
      const b = ext(q, 1);
      const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / STEP));
      const px = [];
      const pz = [];
      const py = [];
      for (let i = 0; i <= n; i++) {
        const x = a.x + ((b.x - a.x) * i) / n;
        const z = a.z + ((b.z - a.z) * i) / n;
        px.push(x);
        pz.push(z);
        const y = groundAt(x, z);
        py.push(Number.isNaN(y) ? heightAt(x, z) + LIFT : y);
      }
      addLane(px, pz, py, 1.2 * S, LANE.square);
    }
    // groups standing on the square: two to four people in a ring
    const G = Math.max(1, Math.min(16, Math.round(ar.areaM / 380)));
    for (let k = 0; k < G; k++) {
      const c = randomIn(ar);
      if (!c) continue;
      const m = 2 + Math.floor(rnd() * rnd() * 3.2);
      const a0 = rnd() * Math.PI * 2;
      for (let q = 0; q < m; q++) {
        const ang = a0 + (q / m) * Math.PI * 2;
        const x = c.x + Math.cos(ang) * 0.55 * S;
        const z = c.z + Math.sin(ang) * 0.55 * S;
        addSpot(x, c.y, z, Math.atan2(c.x - x, c.z - z), 0, 0);
      }
    }
  }
  // a pair or a few now and then on the pedestrian streets
  for (let l = 0; l < laneStart.length; l++) {
    if (laneType[l] !== LANE.pedestrian && laneType[l] !== LANE.carfree) continue;
    for (let k = 4; k < laneN[l] - 4; k += 14 + Math.floor(rnd() * 16)) {
      const g = laneStart[l] + k;
      const h = LH[g];
      if (h < 0.5 * S) continue;
      const tx = LX[g + 1] - LX[g];
      const tz = LZ[g + 1] - LZ[g];
      const L = Math.hypot(tx, tz) || 1;
      const o = (rnd() < 0.5 ? -1 : 1) * h * 0.75;
      const cx = LX[g] - (tz / L) * o;
      const cz = LZ[g] + (tx / L) * o;
      const m = 2 + Math.floor(rnd() * 2);
      const a0 = rnd() * Math.PI * 2;
      for (let q = 0; q < m; q++) {
        const ang = a0 + (q / m) * Math.PI * 2;
        const x = cx + Math.cos(ang) * 0.5 * S;
        const z = cz + Math.sin(ang) * 0.5 * S;
        if (solidAt(x, z)) continue;
        addSpot(x, LY[g], z, Math.atan2(cx - x, cz - z), 0, 0);
      }
    }
  }

  // ---- lanes: typed arrays and the links between lane ends
  const nLanes = laneStart.length;
  const NSm = LX.length;
  const lanes = {
    step: STEP,
    nLanes,
    X: Float32Array.from(LX),
    Z: Float32Array.from(LZ),
    Y: Float32Array.from(LY),
    H: Float32Array.from(LH),
    start: Int32Array.from(laneStart),
    n: Int32Array.from(laneN),
    type: Uint8Array.from(laneType),
    weight: Float32Array.from(laneType.map((t) => LANE_WEIGHT[t])),
    sampleLane: new Int32Array(NSm),
  };
  for (let l = 0; l < nLanes; l++) lanes.sampleLane.fill(l, laneStart[l], laneStart[l] + laneN[l]);
  {
    const CELL = 4;
    const cells = new Map();
    for (let k = 0; k < NSm; k++) {
      const key = Math.floor(lanes.X[k] / CELL) * 65536 + Math.floor(lanes.Z[k] / CELL);
      let c = cells.get(key);
      if (!c) cells.set(key, (c = []));
      c.push(k);
    }
    const LINK = 3.5; // world units (14 m)
    const hopClear = (ax, az, bx, bz) => {
      const d = Math.hypot(bx - ax, bz - az);
      const n = Math.ceil(d / 0.3);
      for (let i = 1; i < n; i++) {
        const x = ax + ((bx - ax) * i) / n;
        const z = az + ((bz - az) * i) / n;
        const y = groundAt(x, z);
        if (Number.isNaN(y) || blockedAt(x, z, y, 0.15 * S)) return false;
      }
      return true;
    };
    const linkStart = new Int32Array(nLanes * 2 + 1);
    const links = [];
    const best = new Map();
    for (let l = 0; l < nLanes; l++) {
      for (let end = 0; end < 2; end++) {
        linkStart[l * 2 + end] = links.length;
        const g = laneStart[l] + (end ? laneN[l] - 1 : 0);
        const x = lanes.X[g];
        const z = lanes.Z[g];
        best.clear();
        for (let gx = Math.floor((x - LINK) / CELL); gx <= Math.floor((x + LINK) / CELL); gx++) {
          for (let gz = Math.floor((z - LINK) / CELL); gz <= Math.floor((z + LINK) / CELL); gz++) {
            const c = cells.get(gx * 65536 + gz);
            if (!c) continue;
            for (const k of c) {
              const o = lanes.sampleLane[k];
              if (o === l) continue;
              const d2 = (lanes.X[k] - x) ** 2 + (lanes.Z[k] - z) ** 2;
              if (d2 > LINK * LINK) continue;
              const b = best.get(o);
              if (!b || d2 < b[0]) best.set(o, [d2, k]);
            }
          }
        }
        const cand = [...best.values()].sort((p, q) => p[0] - q[0]).slice(0, 5);
        for (const [, k] of cand) if (hopClear(x, z, lanes.X[k], lanes.Z[k])) links.push(k);
      }
    }
    linkStart[nLanes * 2] = links.length;
    lanes.linkStart = linkStart;
    lanes.links = Int32Array.from(links);
  }
  const laneMs = Math.round(performance.now() - tb);

  // the nearest point of any way (not rail): street trees, and the way out
  // of a building for a POI's sign
  const NP_CELL = 6;
  const npGrid = new Map();
  for (const w of net.ways) {
    if (w.kind === 'rail' || w.tunnel) continue;
    for (let i = w.start; i < w.start + w.n; i++) {
      const key = Math.floor(X[i] / NP_CELL) * 65536 + Math.floor(Z[i] / NP_CELL);
      let c = npGrid.get(key);
      if (!c) npGrid.set(key, (c = []));
      c.push(i);
    }
  }
  function nearestStreet(x, z, r) {
    let best = -1;
    let bd = r * r;
    for (let gx = Math.floor((x - r) / NP_CELL); gx <= Math.floor((x + r) / NP_CELL); gx++) {
      for (let gz = Math.floor((z - r) / NP_CELL); gz <= Math.floor((z + r) / NP_CELL); gz++) {
        for (const i of npGrid.get(gx * 65536 + gz) || []) {
          const d = (X[i] - x) ** 2 + (Z[i] - z) ** 2;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
      }
    }
    return best;
  }

  // ---- furniture items: per type [x, y, z, yaw, scale, colour]
  const F = {};
  for (const k of Object.keys(FURNITURE)) F[k] = [];
  const put = (type, x, y, z, yaw = 0, sc = 1, col = 0) => F[type].push(x, y, z, yaw, sc, col);
  // posts under the roads.js glows
  const sites = lampSites(net);
  const tallXZ = [];
  for (let i = 0; i < sites.length; i += 3) {
    const x = sites[i];
    const z = sites[i + 2];
    if (!nearC(x, z) || solidAt(x, z)) continue;
    put('tall', x, sites[i + 1] - LAMP_HEIGHT_M * S, z, rnd() * 6.28);
    tallXZ.push(x, z);
  }
  // lanterns: OSM street lamps, then every 20 m along the pedestrian lanes
  const lanternXZ = [];
  const lanternGrid = new Map();
  const nearLantern = (x, z, r) => {
    for (let gx = Math.floor((x - r) / 8); gx <= Math.floor((x + r) / 8); gx++) {
      for (let gz = Math.floor((z - r) / 8); gz <= Math.floor((z + r) / 8); gz++) {
        for (const k of lanternGrid.get(gx * 65536 + gz) || []) if ((lanternXZ[k] - x) ** 2 + (lanternXZ[k + 1] - z) ** 2 < r * r) return true;
      }
    }
    return false;
  };
  const addLantern = (x, z, y) => {
    put('lantern', x, y, z, rnd() * 6.28, 0.95 + rnd() * 0.1);
    const key = Math.floor(x / 8) * 65536 + Math.floor(z / 8);
    let c = lanternGrid.get(key);
    if (!c) lanternGrid.set(key, (c = []));
    c.push(lanternXZ.length);
    lanternXZ.push(x, z);
  };
  const nearTall = (x, z, r) => {
    for (let i = 0; i < tallXZ.length; i += 2) if ((tallXZ[i] - x) ** 2 + (tallXZ[i + 1] - z) ** 2 < r * r) return true;
    return false;
  };
  for (const q of doc.lamps || []) {
    const p = project(q[0], q[1]);
    if (!nearC(p.x, p.z) || nearTall(p.x, p.z, 2.5)) continue;
    const y = groundAt(p.x, p.z);
    if (Number.isNaN(y) || blockedAt(p.x, p.z, y, 0.1 * S)) continue;
    addLantern(p.x, p.z, y);
  }
  const osmLanterns = lanternXZ.length / 2;
  for (let l = 0; l < nLanes; l++) {
    const t = laneType[l];
    if (t !== LANE.pedestrian && t !== LANE.carfree && t !== LANE.square) continue;
    if (t === LANE.square) continue; // the squares get theirs on the edge
    let side = rnd() < 0.5 ? 1 : -1;
    for (let k = 3; k < laneN[l] - 1; k += 10) {
      const g = laneStart[l] + k;
      const tx = LX[g + 1] - LX[g];
      const tz = LZ[g + 1] - LZ[g];
      const L = Math.hypot(tx, tz) || 1;
      const o = side * (LH[g] + 0.45 * S);
      side = -side;
      const x = LX[g] - (tz / L) * o;
      const z = LZ[g] + (tx / L) * o;
      if (nearLantern(x, z, 3) || nearTall(x, z, 3)) continue;
      if (solidAt(x, z) || cars.near(x, z, 0.3 * S)) continue;
      addLantern(x, z, LY[g]);
    }
  }
  for (const ar of squaresNear) {
    // along the edge every 22 m, 2 m inside
    const poly = ar.poly;
    const inward = polyArea(poly) > 0 ? 1 : -1;
    let carry = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 1e-6) continue;
      const ux = (b.x - a.x) / L;
      const uz = (b.z - a.z) / L;
      for (let s = carry; s < L; s += 5.5) {
        // left of a counter-clockwise edge (x east, z south) is inside
        const nx = uz * inward;
        const nz = -ux * inward;
        const x = a.x + ux * s + nx * 0.5;
        const z = a.z + uz * s + nz * 0.5;
        carry = s + 5.5 - L;
        if (!pip(poly, x, z) || nearLantern(x, z, 3) || nearTall(x, z, 2.5)) continue;
        const y = groundAt(x, z);
        if (Number.isNaN(y) || blockedAt(x, z, y, 0.2 * S)) continue;
        addLantern(x, z, y);
      }
    }
  }
  const lanternTotal = lanternXZ.length / 2;
  // benches: OSM, then a few on the squares facing in
  const benchSpot = (x, y, z, yaw) => {
    put('bench', x, y, z, yaw);
    if (rnd() < 0.45) {
      const o = rnd() < 0.5 ? -0.42 : 0.42;
      addSpot(x + Math.cos(yaw) * o * S + Math.sin(yaw) * 0.08 * S, y, z - Math.sin(yaw) * o * S + Math.cos(yaw) * 0.08 * S, yaw, 1, 2);
    }
  };
  for (const q of doc.benches || []) {
    const p = project(q[0], q[1]);
    if (!nearC(p.x, p.z)) continue;
    const y = groundAt(p.x, p.z);
    if (Number.isNaN(y) || blockedAt(p.x, p.z, y, 0.1 * S)) continue;
    // OSM direction: the way the sitter looks (degrees from north)
    const yaw = q.length > 2 ? Math.PI - (q[2] * Math.PI) / 180 : rnd() * 6.28;
    benchSpot(p.x, y, p.z, yaw);
  }
  for (const ar of squaresNear) {
    const B = Math.min(8, Math.round(ar.areaM / 900));
    for (let k = 0; k < B; k++) {
      const c = randomIn(ar);
      if (!c) continue;
      benchSpot(c.x, c.y, c.z, Math.atan2(ar.cx - c.x, ar.cz - c.z));
    }
  }
  // bollards: OSM, and three across each mouth of a pedestrian street
  for (const q of doc.bollards || []) {
    const p = project(q[0], q[1]);
    if (!nearC(p.x, p.z)) continue;
    const y = groundAt(p.x, p.z);
    if (!Number.isNaN(y) && !bIdx.inside(p.x, p.z)) put('bollard', p.x, y, p.z);
  }
  for (let i = 0; i < mouths.length; i += 6) {
    const [x, z, y, tx, tz, half] = mouths.slice(i, i + 6);
    const n = Math.max(2, Math.min(4, Math.round((half * 2) / (1.5 * S))));
    for (let k = 0; k < n; k++) {
      const o = (k - (n - 1) / 2) * ((half * 2) / n);
      const bx = x - tz * o - tx * 0.3 * S;
      const bz = z + tx * o - tz * 0.3 * S;
      if (!solidAt(bx, bz) && !cars.near(bx, bz, 0.2 * S)) put('bollard', bx, y, bz);
    }
  }
  // street trees: OSM trees and tree rows (every 7 m) within 16 m of a way;
  // the parks and the landmark gardens have their own (nature.js, models)
  const treeAt = (x, z, sc) => {
    if (!nearC(x, z)) return;
    const y = heightAt(x, z) + LIFT - 0.05;
    if (solidAt(x, z) || marks.at(x, z) !== undefined || cars.near(x, z, 0.4 * S) || nearestStreet(x, z, 4) < 0) return;
    put('tree', x, y, z, rnd() * 6.28, sc, Math.floor(rnd() * 4));
  };
  if (!lite) {
    for (const q of doc.trees || []) {
      const p = project(q[0], q[1]);
      treeAt(p.x, p.z, 0.75 + rnd() * 0.45);
    }
    for (const row of doc.rows || []) {
      const pts = row.map((q) => project(q[0], q[1]));
      for (let i = 0; i < pts.length - 1; i++) {
        const L = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
        for (let s = 0; s < L; s += 7 * S) treeAt(pts[i].x + ((pts[i + 1].x - pts[i].x) * s) / L, pts[i].z + ((pts[i + 1].z - pts[i].z) * s) / L, 0.8 + rnd() * 0.35);
      }
    }
  }

  // ---- POIs: a place on the facade toward the street, terraces
  // the POI's facade point: out of its building toward the nearest street
  const facade = new Map();
  function facadeOf(poi) {
    if (facade.has(poi.id)) return facade.get(poi.id);
    const p = project(poi.lat, poi.lon);
    let out = { x: p.x, z: p.z, dx: 0, dz: 0, wall: false };
    const i = nearestStreet(p.x, p.z, 12);
    if (i >= 0) {
      const dx = X[i] - p.x;
      const dz = Z[i] - p.z;
      const L = Math.hypot(dx, dz) || 1;
      out.dx = dx / L;
      out.dz = dz / L;
      if (bIdx.inside(p.x, p.z) || marks.solidAt(p.x, p.z)) {
        for (let s = 0.1; s < L; s += 0.1) {
          const x = p.x + out.dx * s;
          const z = p.z + out.dz * s;
          if (!bIdx.inside(x, z) && !marks.solidAt(x, z)) {
            out = { x: x + out.dx * 0.08, z: z + out.dz * 0.08, dx: out.dx, dz: out.dz, wall: true };
            break;
          }
        }
      }
    }
    facade.set(poi.id, out);
    return out;
  }
  const signLift = 3.1 * S;
  const placeSign = (poi) => {
    const f = facadeOf(poi);
    const y = heightAt(f.x, f.z) + RIBBON_LIFT;
    return { x: f.x, y: y + signLift, z: f.z };
  };
  // terraces
  const terraces = []; // { poi, open, seats: [spot indices] }
  const sampleCells = new Map();
  for (let k = 0; k < NSm; k++) {
    const key = Math.floor(lanes.X[k] / 4) * 65536 + Math.floor(lanes.Z[k] / 4);
    let c = sampleCells.get(key);
    if (!c) sampleCells.set(key, (c = []));
    c.push(k);
  }
  const nearestSample = (x, z, r, okType) => {
    let best = -1;
    let bd = r * r;
    for (let gx = Math.floor((x - r) / 4); gx <= Math.floor((x + r) / 4); gx++) {
      for (let gz = Math.floor((z - r) / 4); gz <= Math.floor((z + r) / 4); gz++) {
        for (const k of sampleCells.get(gx * 65536 + gz) || []) {
          if (!okType(lanes.type[lanes.sampleLane[k]], k)) continue;
          const d = (lanes.X[k] - x) ** 2 + (lanes.Z[k] - z) ** 2;
          if (d < bd) {
            bd = d;
            best = k;
          }
        }
      }
    }
    return best;
  };
  let tablesN = 0;
  for (const poi of pois) {
    if (!TERRACE_KINDS.has(poi.kind) || poi.outdoor_seating === 'no') continue;
    const p = project(poi.lat, poi.lon);
    if (!nearC(p.x, p.z)) continue;
    const yes = poi.outdoor_seating === 'yes';
    const f = facadeOf(poi);
    // the landmark squares bring their own terraces
    if (marks.at(f.x, f.z) !== undefined) continue;
    const k = nearestSample(f.x, f.z, yes ? 6 : 4.5, (t, kk) => t === LANE.pedestrian || t === LANE.square || t === LANE.carfree || (yes && t === LANE.sidewalk && lanes.H[kk] > 0.7 * S));
    if (k < 0) continue;
    const l = lanes.sampleLane[k];
    const wide = lanes.type[l] !== LANE.sidewalk;
    const k2 = Math.min(k + 1, laneStart[l] + laneN[l] - 1);
    const k1 = k2 - 1;
    let tx = lanes.X[k2] - lanes.X[k1];
    let tz = lanes.Z[k2] - lanes.Z[k1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    // from the facade toward the lane
    let nx = lanes.X[k] - f.x;
    let nz = lanes.Z[k] - f.z;
    const toLane = Math.hypot(nx, nz);
    if (toLane < 1e-3) {
      nx = -tz;
      nz = tx;
    } else {
      nx /= toLane;
      nz /= toLane;
    }
    const first = Math.min(toLane, 1.1 * S);
    const n = poi.kind === 'restaurant' ? 4 + Math.floor(rnd() * 3) : poi.kind === 'cafe' || poi.kind === 'pastry' ? 3 + Math.floor(rnd() * 3) : 2 + Math.floor(rnd() * 2);
    const rows = wide && toLane > 2.6 * S && n > 3 ? 2 : 1;
    const perRow = wide ? Math.ceil(n / rows) : Math.min(2, n);
    const umb = rnd() < 0.78;
    const ucol = Math.floor(rnd() * UMBRELLA_COLORS.length);
    const ter = { poi, open: 0, seats: [] };
    const ti = terraces.length;
    for (let r = 0; r < rows; r++) {
      for (let j = 0; j < perRow; j++) {
        const a = (j - (perRow - 1) / 2) * 2.5 * S;
        const b = first + r * 2.2 * S;
        const x = f.x + tx * a + nx * b;
        const z = f.z + tz * a + nz * b;
        const y = groundAt(x, z);
        if (Number.isNaN(y) || blockedAt(x, z, y, 0.4 * S)) continue;
        const yaw = Math.atan2(-tz, tx); // the table's x (its chairs) along the lane
        put('table', x, y, z, yaw);
        if (umb) put('umbrella', x, y, z, yaw, 1, ucol);
        tablesN++;
        // two seats facing the table
        for (const sgn of [1, -1]) {
          const sx = x + tx * sgn * 0.62 * S;
          const sz = z + tz * sgn * 0.62 * S;
          ter.seats.push(spots.x.length);
          addSpot(sx, y, sz, Math.atan2(-tx * sgn, -tz * sgn), 1, 1, ti);
        }
      }
    }
    if (ter.seats.length) terraces.push(ter);
  }

  // ---- objects
  const uniforms = { uStNight: { value: 0 }, uStGlow: { value: 1 } };
  const layers = [];
  const R_FURN = lite ? 55 : 90; // world units around the focus (220 / 360 m)
  const KEEP = lite ? new Set(['tall', 'lantern', 'table', 'umbrella']) : new Set(Object.keys(FURNITURE));
  for (const [type, arr] of Object.entries(F)) {
    const n = arr.length / 6;
    if (!n || !KEEP.has(type)) continue;
    const geo = FURNITURE[type]();
    const cap = Math.min(n, lite ? 600 : 2500);
    const mesh = new THREE.InstancedMesh(geo, furnitureMaterial(uniforms, type), cap);
    mesh.name = `street-${type}`;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
    mesh.castShadow = !lite && type !== 'bollard';
    mesh.receiveShadow = !lite;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const colored = type === 'umbrella' || type === 'tree';
    if (colored) {
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    const grid = new Map();
    for (let i = 0; i < n; i++) {
      const key = Math.floor(arr[i * 6] / 16) * 65536 + Math.floor(arr[i * 6 + 2] / 16);
      let c = grid.get(key);
      if (!c) grid.set(key, (c = []));
      c.push(i);
    }
    group.add(mesh);
    layers.push({ type, arr: Float32Array.from(arr), n, mesh, cap, grid, colored, shown: 0 });
  }
  const TREE_TINT = [0xffffff, 0xe6f0d8, 0xf3f0d6, 0xd9e6cf].map((h) => new THREE.Color(h));
  function fillLayer(L, fx, fz, R) {
    const { arr, mesh, cap, grid } = L;
    const E = mesh.instanceMatrix.array;
    let k = 0;
    const R2 = R * R;
    for (let gx = Math.floor((fx - R) / 16); gx <= Math.floor((fx + R) / 16) && k < cap; gx++) {
      for (let gz = Math.floor((fz - R) / 16); gz <= Math.floor((fz + R) / 16) && k < cap; gz++) {
        const c = grid.get(gx * 65536 + gz);
        if (!c) continue;
        for (const i of c) {
          if (k >= cap) break;
          const o = i * 6;
          const x = arr[o];
          const z = arr[o + 2];
          if ((x - fx) ** 2 + (z - fz) ** 2 > R2) continue;
          const yaw = arr[o + 3];
          const sc = arr[o + 4];
          const cs = Math.cos(yaw) * sc;
          const sn = Math.sin(yaw) * sc;
          const e = k * 16;
          E[e] = cs;
          E[e + 1] = 0;
          E[e + 2] = -sn;
          E[e + 3] = 0;
          E[e + 4] = 0;
          E[e + 5] = sc;
          E[e + 6] = 0;
          E[e + 7] = 0;
          E[e + 8] = sn;
          E[e + 9] = 0;
          E[e + 10] = cs;
          E[e + 11] = 0;
          E[e + 12] = x;
          E[e + 13] = arr[o + 1];
          E[e + 14] = z;
          E[e + 15] = 1;
          if (L.colored) (L.type === 'umbrella' ? UMBRELLA_COLORS : TREE_TINT)[arr[o + 5]].toArray(mesh.instanceColor.array, k * 3);
          k++;
        }
      }
    }
    L.shown = k;
    mesh.count = k;
    mesh.visible = k > 0;
    if (k) {
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, k * 16);
      mesh.instanceMatrix.needsUpdate = true;
      if (L.colored) {
        mesh.instanceColor.clearUpdateRanges();
        mesh.instanceColor.addUpdateRange(0, k * 3);
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }
  // the lanterns' glow at night (roads.js has the street lamps')
  const glowPos = [];
  const lanterns = F.lantern;
  for (let i = 0; i < lanterns.length; i += 6) glowPos.push(lanterns[i], lanterns[i + 1] + 3.95 * S * lanterns[i + 4], lanterns[i + 2]);
  const glow = lampGlow(glowPos, { sizeU: 1.5, name: 'street-lanterns', maxPx: 10 });
  if (glow) group.add(glow);

  // people
  const people = nLanes ? createPeople({ lanes, spots, max: lite ? 300 : 1500, lite, shadows: !lite }) : null;
  if (people) group.add(people.object);
  // signs
  const signs = createPoiSigns({ list: pois, place: placeSign, lite });
  group.add(signs.object);

  Object.assign(stats, {
    lanes: nLanes,
    laneKm: +((NSm * STEP) / S / 1000).toFixed(1),
    laneSamples: NSm,
    links: lanes.links.length,
    lanesFrom: wayLanes,
    laneMs,
    areas: areas.length,
    carpets,
    floorLandmarks: marks.floors.map((f) => `${f.id} ${f.valid}/${f.points}`),
    solidLandmarks: marks.solids,
    calcadaTriangles: CT.idx.length / 3,
    furniture: Object.fromEntries(Object.entries(F).map(([k, a]) => [k, a.length / 6])),
    lanternsOsm: osmLanterns,
    lanterns: lanternTotal,
    terraces: terraces.length,
    tables: tablesN,
    spots: spots.x.length,
    signs: signs.items.length,
    people: people?.stats ?? null,
    lite,
  });

  // ---- per frame
  const clockOf = () => {
    const st = model?.state;
    const c = model?.clock;
    return { hour: st?.hour ?? 13, weekday: c?.weekday ?? 2, ymd: c?.ymd ?? 0, weekend: !!st?.weekend };
  };
  let lastOpenKey = '';
  let lastFX = Infinity;
  let lastFZ = Infinity;
  let furnOn = false;
  const live = { demand: 0, hour: 0, people: 0, walkers: 0, staying: 0, signs: 0, furniture: 0 };
  stats.live = live;
  const spotOk = (i) => spots.kind[i] !== 1 || terraces[spots.ref[i]].open > 0.5;
  const _f = new THREE.Vector3();
  function update(dt, frustum, view) {
    const night = view.night;
    const camDist = view.camDist;
    uniforms.uStNight.value = night;
    uniforms.uStGlow.value = fx?.enabled ? 2.4 : 1;
    const focus = camera.userData.focus || _f.copy(camera.position);
    const fxp = focus.x;
    const fzp = focus.z;
    const clk = clockOf();
    const month = Math.floor(clk.ymd / 100) % 100;
    // terraces: open or not (every few minutes of scene time)
    const key = `${clk.weekday}:${Math.floor(clk.hour * 12)}`;
    if (key !== lastOpenKey) {
      lastOpenKey = key;
      for (const t of terraces) {
        const o = isOpenAtHour(t.poi, clk.weekday, clk.hour, month);
        t.open = o === null ? (guessOpen(t.poi.kind, clk.hour) ? 1 : 0) : o ? 1 : 0;
      }
    }
    // furniture near the focus
    const fOn = camDist < (lite ? 260 : 420);
    if (fOn !== furnOn) {
      furnOn = fOn;
      if (!fOn) for (const L of layers) L.mesh.visible = false;
      lastFX = Infinity;
    }
    if (fOn && (fxp - lastFX) ** 2 + (fzp - lastFZ) ** 2 > 4) {
      lastFX = fxp;
      lastFZ = fzp;
      for (const L of layers) fillLayer(L, fxp, fzp, R_FURN);
    }
    let fn = 0;
    for (const L of layers) {
      // parasols close at night
      if (L.type === 'umbrella') L.mesh.visible = fOn && L.shown > 0 && night < 0.6;
      if (L.mesh.visible) fn += L.shown;
    }
    if (calcadaMesh) calcadaMesh.visible = camDist < (lite ? 450 : 900);
    if (glow) {
      glow.material.uniforms.uNight.value = night;
      glow.visible = night > 0.02 && camDist < (lite ? 450 : 2500);
    }
    // people
    const demand = pedestrianDemand(clk.hour, clk.weekend, clk.ymd) * (view.rain > 0.5 ? 0.45 : 1);
    live.demand = +demand.toFixed(2);
    live.hour = +clk.hour.toFixed(2);
    if (people) {
      const on = camDist < (lite ? 220 : 360);
      people.update(dt, camera, frustum, { fx: fxp, fz: fzp, R: lite ? 100 : 150, on, demand, spotOk, camDist });
      live.people = people.shown;
      live.walkers = people.shownWalkers;
      live.staying = people.shownStaying;
    }
    // signs
    signs.update(fxp, fzp, lite ? 90 : 120, camDist < (lite ? 220 : 400), { weekday: clk.weekday, hour: clk.hour, month, night, glow: fx?.enabled ? 2.2 : 1, height: view.height });
    live.signs = signs.shown;
    live.furniture = fn;
  }

  // tests: walkers on a carriageway or in a building right now (want 0, 0)
  function check() {
    const w = people ? people.sampleWalkers() : [];
    let onCar = 0;
    let inBuilding = 0;
    for (let i = 0; i < w.length; i += 2) {
      const x = w[i];
      const z = w[i + 1];
      if (cars.near(x, z, 0)) onCar++;
      if (bIdx.inside(x, z)) inBuilding++;
    }
    let spotsBad = 0;
    for (let i = 0; i < spots.x.length; i++) if (cars.near(spots.x[i], spots.z[i], 0) || bIdx.inside(spots.x[i], spots.z[i])) spotsBad++;
    let samplesBad = 0;
    const bad = [];
    for (let k = 0; k < NSm; k++) {
      const x = lanes.X[k];
      const z = lanes.Z[k];
      const el = lanes.Y[k] - heightAt(x, z);
      const c = el < 0.6 && cars.near(x, z, 0);
      const b = bIdx.inside(x, z);
      if (c || b) {
        samplesBad++;
        if (bad.length < 12) bad.push({ k, type: lanes.type[lanes.sampleLane[k]], el: +el.toFixed(2), car: c, building: b, floor: marks.at(x, z) });
      }
    }
    return { walkers: w.length / 2, onCar, inBuilding, spots: spots.x.length, spotsBad, laneSamples: NSm, samplesBad, bad };
  }
  return { update, check, people, signs, layers, lanes, terraces, glow, calcadaMesh, marks, areas };
}
