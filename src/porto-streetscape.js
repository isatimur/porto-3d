// Porto's own street life: the furniture and signage that read as *Porto*
// rather than as a generic centre. Built from the engine's own data (the road
// network, the landmarks, the terrain) by streetscape.js, so it is alive even
// before streetscape.json / pois.json land. Focused on the four districts the
// city is known for:
//
//   - Ribeira and the Douro quays: granite bollards along the river edge,
//     wrought-iron balconies and wall lamps on the arcaded facades;
//   - Aliados and Santa Catarina (the Baixa): black-and-white café awnings
//     and hanging signs ("A Brasileira" / "Majestic" style);
//   - blue-and-white azulejo street-name plaques wherever a named street
//     enters a district;
//   - tram-stop poles along the STCP Tram 1 line on the Ribeira.
//
// Every item is instanced and merged, follows the terrain, and is culled by
// distance around the camera focus. Light mode keeps a subset and fewer,
// nearer copies; reduced motion slows and thins the people (people.js).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { S } from './geo.js';
import { buildNetwork } from './road-network.js';
import { createCrowd, pedestrianDemand, DEMAND_MAX } from './people.js';

const IRON = 0x1d2621;
const AZUL = 0x1b3a6b; // Porto azulejo cobalt
const WHITE = 0xf4f2ea;
const GRANITE = 0x8f8a7e;
const TERRA = 0xb23a2e;

// ------------------------------------------------------------ geometry
// A part carries its own flat colour and an emissive weight (aGlow), so one
// instanced material lights the lanterns at night.
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
// metres; y is the bottom
const boxG = (w, h, d, x, y, z, color, glow = 0) => part(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), color, glow);
const boxR = (w, h, d, x, y, z, rotX, color, glow = 0) => part(new THREE.BoxGeometry(w, h, d).rotateX(rotX).translate(x, y, z), color, glow);
const cylG = (rt, rb, h, seg, x, y, z, color, glow = 0) => part(new THREE.CylinderGeometry(rt, rb, h, seg, 1, false).translate(x, y + h / 2, z), color, glow);
function merged(parts) {
  const g = mergeGeometries(parts);
  g.scale(S, S, S);
  g.computeBoundingSphere();
  return g;
}

// +z is the front of every piece (it looks along the street).
const PIECES = {
  // an azulejo street-name plaque on a small post
  plaque: () =>
    merged([
      cylG(0.045, 0.06, 2.25, 6, 0, -0.05, 0, IRON),
      boxG(1.04, 0.66, 0.05, 0, 2.02, -0.01, AZUL),
      boxG(0.94, 0.56, 0.05, 0, 2.06, 0.02, WHITE),
      boxG(0.78, 0.1, 0.02, 0, 2.4, 0.05, AZUL),
      boxG(0.6, 0.08, 0.02, 0, 2.24, 0.05, AZUL),
      boxG(0.42, 0.07, 0.02, 0, 2.1, 0.05, AZUL),
      cylG(0.07, 0.07, 0.06, 6, 0, 2.66, 0, IRON),
    ]),
  // a café awning with a hanging sign (the canopy is tinted per instance)
  awning: () =>
    merged([
      boxR(3.1, 0.06, 1.45, 0, 2.95, 0.7, -0.42, WHITE),
      boxG(3.1, 0.24, 0.06, 0, 2.55, 1.34, WHITE),
      boxG(3.1, 0.1, 0.02, 0, 2.55, 1.39, IRON),
      cylG(0.03, 0.03, 2.55, 4, -1.45, 0, 1.18, IRON),
      cylG(0.03, 0.03, 2.55, 4, 1.45, 0, 1.18, IRON),
      boxG(0.74, 0.5, 0.05, 0, 1.82, 1.48, 0x161616),
      boxG(0.5, 0.07, 0.02, 0, 2.02, 1.51, WHITE),
      boxG(0.38, 0.06, 0.02, 0, 1.88, 1.51, WHITE),
    ]),
  // a tram-stop pole (STCP blue/yellow)
  trampole: () =>
    merged([
      cylG(0.05, 0.07, 2.7, 6, 0, -0.05, 0, IRON),
      boxG(0.52, 0.78, 0.05, 0, 2.7, 0, 0x14315c, 0.25),
      boxG(0.52, 0.14, 0.03, 0, 3.44, 0.02, 0xe8c33a, 0.25),
      boxG(0.4, 0.3, 0.02, 0, 3.05, 0.03, WHITE, 0.25),
      boxG(0.24, 0.24, 0.02, 0, 2.6, 0.03, WHITE, 0.25),
    ]),
  // a granite quay bollard with an iron band
  bollard: () =>
    merged([
      cylG(0.1, 0.13, 0.92, 8, 0, -0.06, 0, GRANITE),
      cylG(0.14, 0.11, 0.12, 8, 0, 0.86, 0, GRANITE),
      cylG(0.105, 0.105, 0.07, 8, 0, 0.5, 0, 0x2a2c2e),
    ]),
  // a wrought-iron balcony on the Ribeira facades
  balcony: () => {
    const W = 1.7;
    const p = [
      boxG(W + 0.08, 0.09, 0.55, 0, -0.04, 0.18, GRANITE),
      boxG(W, 0.05, 0.05, 0, 0.86, 0.42, IRON),
      boxG(W, 0.05, 0.05, 0, 0.02, 0.42, IRON),
      boxG(0.05, 0.9, 0.05, -W / 2, 0, 0.42, IRON),
      boxG(0.05, 0.9, 0.05, W / 2, 0, 0.42, IRON),
    ];
    for (let k = 1; k <= 9; k++) p.push(cylG(0.014, 0.014, 0.86, 4, -W / 2 + (W * k) / 10, 0.02, 0.42, IRON));
    return merged(p);
  },
  // a wrought-iron wall lantern on a bracket (+z is outward)
  walllamp: () =>
    merged([
      boxG(0.06, 0.06, 0.52, 0, 0, 0.2, IRON),
      boxG(0.05, 0.28, 0.05, 0, -0.2, 0.42, IRON),
      cylG(0.12, 0.07, 0.26, 4, 0, -0.02, 0.5, 0xffe2a8, 1),
      cylG(0.02, 0.14, 0.12, 4, 0, 0.24, 0.5, IRON),
      cylG(0.02, 0.02, 0.08, 4, 0, 0.36, 0.5, IRON),
    ]),
};
const AWNING_COLORS = [0x141414, 0x24452f, 0x8a2433, 0x1b3a6b, 0x3a3a3a].map((h) => new THREE.Color(h));

function pieceMaterial(uniforms, key) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0.12 });
  mat.customProgramCacheKey = () => `porto-street:${key}`;
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
// building footprints in a grid: inside(x, z)
function polyIndex(polys, CELL = 32) {
  const list = [];
  const grid = new Map();
  for (const poly of polys || []) {
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

// the four districts, anchored on the landmarks of cities/porto.json (the
// hard-coded lat/lon are the fallback when a landmark is missing)
const DISTRICTS = [
  { id: 'ribeira', la: 41.14075, lo: -8.61298, r: 200, quay: true },
  { id: 'cais-gaia', la: 41.13786, lo: -8.61545, r: 230, quay: true },
  { id: 'aliados', la: 41.14903, lo: -8.61058, r: 180, baixa: true },
  { id: 'santa-catarina', la: 41.14983, lo: -8.60555, r: 160, baixa: true },
];
// STCP Tram 1 stops along the Ribeira / Foz line (lat, lon)
const TRAM_STOPS = [
  [41.1422, -8.6106],
  [41.1432, -8.613],
  [41.1408, -8.6128],
  [41.1439, -8.6187],
  [41.1466, -8.6242],
  [41.1476, -8.636],
  [41.1482, -8.658],
  [41.1486, -8.671],
];

const LANE_KEEP_LITE = new Set(['plaque', 'awning', 'trampole', 'bollard']);
const CAP = {
  plaque: [80, 40],
  awning: [70, 34],
  trampole: [12, 12],
  bollard: [280, 130],
  balcony: [90, 0],
  walllamp: [64, 0],
};

// ------------------------------------------------------------ build
export function buildPortoStreetLife(ctx) {
  const { roads, project, heightAt, items = [], footprints = [], lite = false, camera, fx, model } = ctx;
  const net = buildNetwork(roads, project, heightAt);
  const { X, Z, Y, ways } = net;
  const bIdx = polyIndex(footprints);

  const centreOf = (d) => {
    const it = (items || []).find((q) => q?.data?.id === d.id);
    const p = project(it?.data?.lat ?? d.la, it?.data?.lon ?? d.lo);
    return { id: d.id, r: d.r, baixa: !!d.baixa, quay: !!d.quay, x: p.x, z: p.z };
  };
  const districts = DISTRICTS.map(centreOf);
  // the district a point falls in, preferential to the nearest centre
  function districtAt(x, z) {
    let best = null;
    let bd = Infinity;
    for (const d of districts) {
      const q = ((x - d.x) ** 2 + (z - d.z) ** 2) / (d.r * d.r);
      if (q < 1 && q < bd) {
        bd = q;
        best = d;
      }
    }
    return best;
  }

  // ---- walk paths: contiguous runs of a pedestrian or small street that fall
  // inside a district (the promenades the crowd walks)
  const paths = [];
  const PATH_CAP = lite ? 90 : 260;
  for (const w of ways) {
    if (w.kind === 'water' || w.kind === 'rail' || w.tunnel || w.bridge) continue;
    const hw = w.hw || '';
    const ped = w.kind === 'foot' || hw === 'pedestrian' || hw === 'living_street' || hw === 'footway' || hw === 'path';
    if (!ped && !w.car) continue;
    if (hw === 'steps' || hw === 'motorway' || hw === 'motorway_link' || hw === 'trunk' || hw === 'trunk_link') continue;
    let run = null;
    const flush = () => {
      if (run && run.xs.length >= 6) {
        paths.push({
          x: Float32Array.from(run.xs),
          z: Float32Array.from(run.zs),
          y: Float32Array.from(run.ys),
          half: (w.widthM / 2) * S,
          ped,
          name: w.t?.name || '',
          district: run.d.id,
        });
      }
      run = null;
    };
    for (let i = w.start; i < w.start + w.n; i++) {
      const d = districtAt(X[i], Z[i]);
      if (d && !run) run = { d, xs: [], zs: [], ys: [] };
      else if (!d && run) flush();
      if (run) {
        run.xs.push(X[i]);
        run.zs.push(Z[i]);
        run.ys.push(Y[i]);
      }
    }
    flush();
  }
  // keep the longest runs of every district, round-robin, up to the cap
  if (paths.length > PATH_CAP) {
    const byD = new Map();
    for (const p of paths) {
      let a = byD.get(p.district);
      if (!a) byD.set(p.district, (a = []));
      a.push(p);
    }
    const lists = [...byD.values()].map((a) => a.sort((x, y) => y.x.length - x.x.length));
    const kept = [];
    for (let idx = 0; kept.length < PATH_CAP; idx++) {
      let added = false;
      for (const a of lists) {
        if (idx >= a.length) continue;
        kept.push(a[idx]);
        added = true;
        if (kept.length >= PATH_CAP) break;
      }
      if (!added) break;
    }
    paths.length = 0;
    paths.push(...kept);
  }

  // ---- furniture placement
  const F = {};
  for (const k of Object.keys(PIECES)) F[k] = [];
  const put = (type, x, y, z, yaw = 0, sc = 1) => F[type].push(x, y, z, yaw, sc);
  const rnd = lcg(20260624);
  const spacing = new Map();
  function spaced(type, x, z, r) {
    const key = `${type}:${Math.floor(x / 6)}:${Math.floor(z / 6)}`;
    const last = spacing.get(key);
    if (last && (last[0] - x) ** 2 + (last[1] - z) ** 2 < r * r) return false;
    spacing.set(key, [x, z]);
    return true;
  }
  // the path direction at sample k, its right normal (-tz, tx)
  function atSample(p, k) {
    const n = p.x.length;
    const a = Math.max(0, Math.min(n - 2, k - 1));
    const tx = p.x[a + 1] - p.x[a];
    const tz = p.z[a + 1] - p.z[a];
    const L = Math.hypot(tx, tz) || 1;
    return { x: p.x[k], z: p.z[k], y: p.y[k], tx: tx / L, tz: tz / L };
  }
  // is there a building on the +side / -side of the path at sample k?
  function buildingSide(p, k, half) {
    const q = atSample(p, k);
    const nx = -q.tz;
    const nz = q.tx;
    for (const side of [1, -1]) {
      const x = q.x + nx * side * (half + 0.2 * S);
      const z = q.z + nz * side * (half + 0.2 * S);
      if (bIdx.inside(x, z)) return side;
    }
    return 0;
  }
  const KEEP = lite ? LANE_KEEP_LITE : new Set(Object.keys(PIECES));

  const quayName = /cais|ribeira|miragaia|douro|gaia|infante|alf[âa]ndega/i;
  const capOf = (t) => CAP[t][lite ? 1 : 0];
  const full = (t) => F[t].length / 5 >= capOf(t);
  for (const p of paths) {
    const d = districts.find((q) => q.id === p.district);
    const n = p.x.length;
    // azulejo plaques: one where a named street enters a district
    if (p.name && KEEP.has('plaque') && !full('plaque') && spaced('plaque', p.x[1], p.z[1], 9)) {
      const q = atSample(p, 1);
      const nx = -q.tz;
      const nz = q.tx;
      for (const side of [1, -1]) {
        const x = q.x + nx * side * (p.half + 0.7 * S);
        const z = q.z + nz * side * (p.half + 0.7 * S);
        if (!bIdx.inside(x, z)) {
          put('plaque', x, q.y, z, Math.atan2(nx * -side, nz * -side));
          break;
        }
      }
    }
    // café awnings in the Baixa (they sit on the facade, whatever the street)
    if (d.baixa && KEEP.has('awning') && !full('awning')) {
      for (let k = 3; k < n - 2; k += 6) {
        const side = buildingSide(p, k, p.half);
        if (!side) continue;
        const q = atSample(p, k);
        const nx = -q.tz * side;
        const nz = q.tx * side;
        const x = q.x + nx * (p.half + 0.05 * S);
        const z = q.z + nz * (p.half + 0.05 * S);
        if (!spaced('awning', x, z, 6)) continue;
        put('awning', x, q.y + 2.5 * S, z, Math.atan2(-nx, -nz), 1);
        if (full('awning')) break;
      }
    }
    // bollards line the quays
    if (d.quay && KEEP.has('bollard') && !full('bollard')) {
      for (let k = 1; k < n - 1; k += 5) {
        const q = atSample(p, k);
        if (bIdx.inside(q.x, q.z)) continue;
        if (!spaced('bollard', q.x, q.z, 2.2)) continue;
        put('bollard', q.x, q.y, q.z, rnd() * 6.28);
        if (full('bollard')) break;
      }
    }
    // wrought-iron balconies and wall lamps on the Ribeira / Gaia facades
    const riverFront = d.quay && (quayName.test(p.name) || p.district === 'ribeira');
    if (riverFront) {
      for (let k = 4; k < n - 3; k += 8) {
        const side = buildingSide(p, k, p.half);
        if (!side) continue;
        const q = atSample(p, k);
        const nx = -q.tz * side;
        const nz = q.tx * side;
        const x = q.x + nx * (p.half + 0.05 * S);
        const z = q.z + nz * (p.half + 0.05 * S);
        const yaw = Math.atan2(-nx, -nz);
        if (KEEP.has('balcony') && !full('balcony') && spaced('balcony', x, z, 6)) put('balcony', x, q.y + 3.2 * S, z, yaw);
        if (KEEP.has('walllamp') && !full('walllamp') && spaced('wall' + (k % 2), x, z, 8)) put('walllamp', x, q.y + 4.2 * S, z, yaw);
      }
    }
  }
  // tram-stop poles (independent of the paths)
  if (KEEP.has('trampole')) {
    for (const [la, lo] of TRAM_STOPS) {
      const p = project(la, lo);
      const y = heightAt(p.x, p.z);
      if (!Number.isFinite(y) || bIdx.inside(p.x, p.z)) continue;
      put('trampole', p.x, y, p.z, rnd() * 6.28);
    }
  }

  // ---- instanced layers
  const group = new THREE.Group();
  group.name = 'porto-street-life';
  const uniforms = { uStNight: { value: 0 }, uStGlow: { value: 1 } };
  const layers = [];
  let tris = 0;
  for (const type of Object.keys(F)) {
    const arr = F[type];
    const total = arr.length / 5;
    if (!total || !KEEP.has(type)) continue;
    const geo = PIECES[type]();
    const cap = Math.min(total, CAP[type][lite ? 1 : 0]);
    const mesh = new THREE.InstancedMesh(geo, pieceMaterial(uniforms, type), cap);
    mesh.name = `porto-${type}`;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
    mesh.castShadow = !lite && type !== 'bollard' && type !== 'plaque' && type !== 'walllamp';
    mesh.receiveShadow = !lite;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const colored = type === 'awning';
    if (colored) {
      mesh.setColorAt(0, AWNING_COLORS[0]);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    const grid = new Map();
    for (let i = 0; i < total; i++) {
      const key = Math.floor(arr[i * 5] / 16) * 65536 + Math.floor(arr[i * 5 + 2] / 16);
      let c = grid.get(key);
      if (!c) grid.set(key, (c = []));
      c.push(i);
    }
    group.add(mesh);
    layers.push({ type, arr: Float32Array.from(arr), mesh, cap, grid, colored, shown: 0 });
    tris += (geo.attributes.position.count / 3) * cap;
  }
  function fillLayer(L, fx0, fz0, R) {
    const { arr, mesh, cap, grid } = L;
    const E = mesh.instanceMatrix.array;
    let k = 0;
    const R2 = R * R;
    for (let gx = Math.floor((fx0 - R) / 16); gx <= Math.floor((fx0 + R) / 16) && k < cap; gx++) {
      for (let gz = Math.floor((fz0 - R) / 16); gz <= Math.floor((fz0 + R) / 16) && k < cap; gz++) {
        const c = grid.get(gx * 65536 + gz);
        if (!c) continue;
        for (const i of c) {
          if (k >= cap) break;
          const o = i * 5;
          const x = arr[o];
          const z = arr[o + 2];
          if ((x - fx0) ** 2 + (z - fz0) ** 2 > R2) continue;
          const yaw = arr[o + 3];
          const sc = arr[o + 4];
          const cs = Math.cos(yaw) * sc;
          const sn = Math.sin(yaw) * sc;
          const e = k * 16;
          E[e] = cs;
          E[e + 1] = 0;
          E[e + 2] = -sn;
          E[e + 4] = 0;
          E[e + 5] = sc;
          E[e + 6] = 0;
          E[e + 8] = sn;
          E[e + 9] = 0;
          E[e + 10] = cs;
          E[e + 12] = x;
          E[e + 13] = arr[o + 1];
          E[e + 14] = z;
          E[e + 15] = 1;
          if (L.colored) AWNING_COLORS[i % AWNING_COLORS.length].toArray(mesh.instanceColor.array, k * 3);
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

  // ---- people: a few hundred on the paths, culled by distance
  const reducedMotion = !!(ctx.reducedMotion ?? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches));
  const people = createCrowd({
    paths,
    max: lite ? 150 : 340,
    lite,
    reducedMotion,
  });
  if (people) group.add(people.object);

  const R_FURN = lite ? 55 : 95; // world units around the focus (220 / 380 m)
  const live = { furniture: 0, people: 0, paths: paths.length };
  let lastX = Infinity;
  let lastZ = Infinity;
  let furnOn = false;
  function clockOf() {
    const st = model?.state;
    const c = model?.clock;
    return { hour: st?.hour ?? 13, weekend: !!st?.weekend, weekday: c?.weekday ?? 2, ymd: c?.ymd ?? 0 };
  }
  function update(dt, frustum, view, opts = {}) {
    const night = view?.night ?? 0;
    const camDist = view?.camDist ?? 0;
    uniforms.uStNight.value = night;
    uniforms.uStGlow.value = fx?.enabled ? 2.4 : 1;
    const focus = camera?.userData?.focus || camera?.position || { x: 0, z: 0 };
    const fxp = focus.x;
    const fzp = focus.z;
    const on = camDist < (lite ? 320 : 560);
    if (on !== furnOn) {
      furnOn = on;
      if (!on) for (const L of layers) L.mesh.visible = false;
      lastX = Infinity;
    }
    if (on && (fxp - lastX) ** 2 + (fzp - lastZ) ** 2 > 4) {
      lastX = fxp;
      lastZ = fzp;
      for (const L of layers) fillLayer(L, fxp, fzp, R_FURN);
    }
    let fn = 0;
    for (const L of layers) {
      if (L.type === 'awning') L.mesh.visible = furnOn && L.shown > 0 && night < 0.6;
      if (L.mesh.visible) fn += L.shown;
    }
    live.furniture = fn;
    if (people) {
      const clk = clockOf();
      const demand = pedestrianDemand(clk.hour, clk.weekend, clk.ymd) * (view?.rain > 0.5 ? 0.45 : 1);
      const want = !opts.suppressPeople && camDist < (lite ? 220 : 380);
      people.update(dt, camera, frustum, { fx: fxp, fz: fzp, R: lite ? 95 : 150, on: want, demand });
      live.people = people.shown;
    }
  }

  const counts = Object.fromEntries(Object.entries(F).map(([k, a]) => [k, a.length / 5]));
  const stats = {
    districts: districts.map((d) => d.id),
    paths: paths.length,
    pathSamples: paths.reduce((s, p) => s + p.x.length, 0),
    pathKm: +((paths.reduce((s, p) => s + p.x.length, 0) * 0.5) / S / 1000).toFixed(1),
    furniture: counts,
    furnitureTris: Math.round(tris),
    people: people?.stats ?? null,
    reducedMotion,
    lite,
    caps: CAP,
  };
  return { object: group, stats, paths, layers, live, update };
}
