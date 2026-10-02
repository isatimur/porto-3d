// The living city: what moves on the map.
//
//   - the Bom Jesus funicular (1882, water balance): two cars on the real
//     OSM tracks (data/life.json), counter-balanced, one up while the
//     other comes down; a 4-minute trip run ten times faster, with a pause
//     at the stations. The cars ride on the model's own track bed;
//   - traffic on the primary and secondary streets: instanced cars and
//     vans that follow the OSM polylines at 30-55 km/h in both directions,
//     turning onto a connected street at each end; head and tail lights at
//     night, drawn as points too, so from far away they are streams of light;
//   - birds: four boid flocks circling Bom Jesus, Sameiro, the Sé towers and
//     the Rio Este; they scatter when the camera flies close;
//   - fountains: a GPU particle spray on the fountains of Praça da
//     República, Avenida Central, Santa Bárbara, Bom Jesus and Tibães;
//   - sky and weather (src/weather.js) and the real-time mode (src/live.js).
//
// One update per frame from main.js on the shared clock; nothing allocates
// per frame. Traffic and flocks are culled against the view frustum; the
// counts halve on phones. Under reduced motion everything stands still.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CITY } from './city.js';

// <data_dir>/life.json (funicular tracks, fountains; Braga: scripts/
// fetch-funicular.mjs), set by main.js from loadData() before createLife().
let LIFE = null;
export function setLifeData(doc) {
  LIFE = doc && typeof doc === 'object' ? doc : null;
}
import { S } from './geo.js';
import { t } from './i18n.js';
import { createWeather, addScaled } from './weather.js';
import { createLive } from './live.js';
import { createTrafficModel } from './traffic-model.js';
import { buildNetwork, createFlow } from './road-network.js';
import { createStreetscape } from './streetscape.js';

// shared by the materials here: night 0..1 and the emissive boost (above
// the bloom threshold when post-processing is on)
const LIFE_UNIFORMS = {
  uLifeNight: { value: 0 },
  uLifeGlow: { value: 1 },
  uLifeTime: { value: 0 },
};

const GRAVITY = 9.81 * S; // world units / s^2

// ------------------------------------------------------------ helpers
function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// Heights of a landmark mesh's up-facing surfaces at world points: for
// each point the highest surface between lo[i] and hi[i] (world y), or
// NaN. One pass over the triangles. The geometry is world-oriented around
// the mesh position (fit.js), at real scale. (streetscape.js: the paving of
// the landmark squares.)
export function surfaceHeights(mesh, xs, zs, lo, hi) {
  const out = new Float32Array(xs.length).fill(NaN);
  if (!mesh?.geometry?.attributes?.position) return out;
  const P = mesh.geometry.attributes.position.array;
  const I = mesh.geometry.index?.array;
  const px = mesh.position.x;
  const py = mesh.position.y;
  const pz = mesh.position.z;
  const CELL = 1;
  const grid = new Map();
  let bx0 = Infinity;
  let bx1 = -Infinity;
  let bz0 = Infinity;
  let bz1 = -Infinity;
  const qx = new Float32Array(xs.length);
  const qz = new Float32Array(xs.length);
  for (let i = 0; i < xs.length; i++) {
    qx[i] = xs[i] - px;
    qz[i] = zs[i] - pz;
    bx0 = Math.min(bx0, qx[i]);
    bx1 = Math.max(bx1, qx[i]);
    bz0 = Math.min(bz0, qz[i]);
    bz1 = Math.max(bz1, qz[i]);
    const key = Math.floor(qx[i] / CELL) * 65536 + Math.floor(qz[i] / CELL);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  }
  const n = I ? I.length / 3 : P.length / 9;
  for (let t = 0; t < n; t++) {
    const a = (I ? I[t * 3] : t * 3) * 3;
    const b = (I ? I[t * 3 + 1] : t * 3 + 1) * 3;
    const c = (I ? I[t * 3 + 2] : t * 3 + 2) * 3;
    const ax = P[a];
    const az = P[a + 2];
    const bx = P[b];
    const bz = P[b + 2];
    const cx = P[c];
    const cz = P[c + 2];
    const tx0 = Math.min(ax, bx, cx);
    const tx1 = Math.max(ax, bx, cx);
    const tz0 = Math.min(az, bz, cz);
    const tz1 = Math.max(az, bz, cz);
    if (tx1 < bx0 || tx0 > bx1 || tz1 < bz0 || tz0 > bz1) continue;
    // up-facing (or down: winding varies), not a wall
    const ux = bx - ax;
    const uy = P[b + 1] - P[a + 1];
    const uz = bz - az;
    const vx = cx - ax;
    const vy = P[c + 1] - P[a + 1];
    const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-12 || Math.abs(ny) / nl < 0.6) continue;
    const det = ux * vz - uz * vx;
    if (Math.abs(det) < 1e-12) continue;
    for (let gx = Math.floor(tx0 / CELL); gx <= Math.floor(tx1 / CELL); gx++) {
      for (let gz = Math.floor(tz0 / CELL); gz <= Math.floor(tz1 / CELL); gz++) {
        const list = grid.get(gx * 65536 + gz);
        if (!list) continue;
        for (const i of list) {
          const wx = qx[i] - ax;
          const wz = qz[i] - az;
          const s = (wx * vz - wz * vx) / det;
          const r = (ux * wz - uz * wx) / det;
          if (s < -1e-4 || r < -1e-4 || s + r > 1 + 1e-4) continue;
          const y = py + P[a + 1] + s * uy + r * vy;
          if (y < lo[i] || y > hi[i]) continue;
          if (!(y <= out[i])) out[i] = y;
        }
      }
    }
  }
  return out;
}

function box(w, h, d, x, y, z, color, glow = 0) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y + h / 2, z);
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  const col = new THREE.Color(color);
  for (let i = 0; i < n; i++) col.toArray(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
  g.deleteAttribute('uv');
  return g;
}

// A lit material with vertex colours, and an emissive term at night from
// aGlow (lit windows) plus an optional lamp shader chunk.
function lifeMaterial({ roughness = 0.7, metalness = 0, lamps = '' } = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness });
  // the program cache keys on onBeforeCompile's source, which every life
  // material shares: without this, cars and vans would share one lamp band
  mat.customProgramCacheKey = () => `life:${lamps}`;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, LIFE_UNIFORMS);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;\nvarying vec3 vLP;\nvarying vec3 vLN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;\nvLP = position;\nvLN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uLifeNight;\nuniform float uLifeGlow;\nvarying float vGlow;\nvarying vec3 vLP;\nvarying vec3 vLN;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1.0, 0.7, 0.38) * vGlow * uLifeNight * uLifeGlow * 0.9;
${lamps}`,
      );
  };
  return mat;
}

// ------------------------------------------------------------ funicular
const TRIP_S = 32; // one run down or up (real: about 4 minutes)
const DWELL_S = 8; // at the stations
const CAR_M = 10;

function carGeometry() {
  // metres, then to world units: a stepped car of four compartments on an
  // inclined chassis, cream with maroon trim; the windows light at night
  const parts = [box(2.4, 0.8, CAR_M, 0, 0, 0, 0x221e1b)];
  for (let c = 0; c < 4; c++) {
    const zc = -3.75 + c * 2.5;
    parts.push(box(2.3, 2.1, 2.4, 0, 0.8, zc, 0xe9dcb4));
    parts.push(box(2.36, 0.9, 2.2, 0, 1.75, zc, 0x27404f, 1));
    parts.push(box(2.5, 0.12, 2.5, 0, 2.9, zc, 0xc26a66));
  }
  const g = mergeGeometries(parts);
  g.scale(S, S, S);
  return g;
}

function buildFunicular({ project, heightAt, items }) {
  const tracks = LIFE?.funicular?.tracks;
  const it = items.find((i) => i.data.id === 'bom-jesus');
  if (!Array.isArray(tracks) || tracks.length < 2) return null;
  const mesh = it?.meshes?.[0];
  const STEP = 1.5; // world units (6 m) between samples
  const lines = tracks.slice(0, 2).map((tr) => {
    const pts = tr.map((q) => project(q[0], q[1]));
    const xs = [];
    const zs = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / STEP));
      for (let j = i === 1 ? 0 : 1; j <= n; j++) {
        xs.push(a.x + ((b.x - a.x) * j) / n);
        zs.push(a.z + ((b.z - a.z) * j) / n);
      }
    }
    const g = xs.map((x, i) => heightAt(x, zs[i]));
    // the model's bed: the highest up-facing surface a little above the
    // ground; a median removes single bumps (sleepers, piers)
    const hits = surfaceHeights(mesh, xs, zs, g.map((v) => v - 1), g.map((v) => v + 0.8));
    const raw = g.map((v, i) => (Number.isFinite(hits[i]) ? hits[i] : v + 0.35));
    const ys = raw.map((_, i) => {
      const w = raw.slice(Math.max(0, i - 2), i + 3).sort((p, q) => p - q);
      return w[w.length >> 1];
    });
    // top station first: the profile only falls (as the model's does)
    for (let i = 1; i < ys.length; i++) ys[i] = Math.min(ys[i], ys[i - 1]);
    const cum = [0];
    for (let i = 1; i < xs.length; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
    return { xs, zs, ys, g, cum, total: cum[cum.length - 1], hits: hits.filter(Number.isFinite).length };
  });

  const geo = carGeometry();
  const cars = new THREE.InstancedMesh(geo, lifeMaterial({ roughness: 0.6 }), 2);
  cars.name = 'funicular-cars';
  cars.castShadow = true;
  cars.receiveShadow = true;
  cars.frustumCulled = false;
  cars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const half = (CAR_M / 2 + 1) * S;
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler(0, 0, 0, 'YXZ');
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3(1, 1, 1);
  const _m = new THREE.Matrix4();
  const at = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  function sample(L, s) {
    const cum = L.cum;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const u = THREE.MathUtils.clamp((s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]), 0, 1);
    at.x = L.xs[i - 1] + (L.xs[i] - L.xs[i - 1]) * u;
    at.z = L.zs[i - 1] + (L.zs[i] - L.zs[i - 1]) * u;
    // slope over the car's length, so the car does not rock per sample
    const s0 = Math.max(0, s - half);
    const s1 = Math.min(L.total, s + half);
    at.y = heightOn(L, s) + 0.1 * S;
    const dy = heightOn(L, s1) - heightOn(L, s0);
    const dx = L.xs[i] - L.xs[i - 1];
    const dz = L.zs[i] - L.zs[i - 1];
    at.yaw = Math.atan2(dx, dz); // +z of the car: downhill
    at.pitch = Math.atan2(-dy, Math.max(1e-3, s1 - s0));
    return at;
  }
  function heightOn(L, s) {
    const cum = L.cum;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const u = THREE.MathUtils.clamp((s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]), 0, 1);
    return L.ys[i - 1] + (L.ys[i] - L.ys[i - 1]) * u;
  }
  // trapezoid speed profile: 15 % accelerating, 15 % braking
  const A = 0.15;
  const profile = (x) => (x < A ? (0.5 * x * x) / (A * (1 - A)) : x < 1 - A ? (x - A / 2) / (1 - A) : 1 - (0.5 * (1 - x) * (1 - x)) / (A * (1 - A)));
  let time = DWELL_S + TRIP_S * 0.35; // first view: under way
  let u = 0;
  function phaseU(t) {
    const P = 2 * (TRIP_S + DWELL_S);
    const p = ((t % P) + P) % P;
    if (p < DWELL_S) return 0;
    if (p < DWELL_S + TRIP_S) return profile((p - DWELL_S) / TRIP_S);
    if (p < 2 * DWELL_S + TRIP_S) return 1;
    return 1 - profile((p - 2 * DWELL_S - TRIP_S) / TRIP_S);
  }
  function place(idx, L, s) {
    sample(L, s);
    _e.set(at.pitch, at.yaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(at.x, at.y, at.z);
    _m.compose(_p, _q, _s);
    cars.setMatrixAt(idx, _m);
  }
  function update(dt, camera) {
    time += dt;
    const hidden = !it || !mesh?.visible || camera.position.distanceToSquared(_p.set(it.x, it.base, it.z)) > 2600 * 2600;
    cars.visible = !hidden;
    if (hidden) return;
    u = phaseU(time);
    // car A comes down track 0 while car B goes up track 1
    const [L0, L1] = lines;
    place(0, L0, half + u * (L0.total - 2 * half));
    place(1, L1, L1.total - half - u * (L1.total - 2 * half));
    cars.instanceMatrix.needsUpdate = true;
  }
  update(0, { position: new THREE.Vector3(it?.x ?? 0, 0, it?.z ?? 0) });
  return {
    object: cars,
    update,
    lines,
    // tests: 0 at the stations (car A up), 0.5 mid-track, 1 (car A down)
    seek(k) {
      time = DWELL_S + TRIP_S * THREE.MathUtils.clamp(k, 0, 1) * 0.999;
    },
    get u() {
      return u;
    },
    stats: { tracks: lines.map((L) => +(L.total / S).toFixed(0)), bedHits: lines.map((L) => `${L.hits}/${L.xs.length}`) },
  };
}

// ------------------------------------------------------------ traffic
// pedestrian centre (lat, lon, radius m): no traffic on its streets (the
// tunnels under it still carry theirs). cities/<id>.json traffic.car_free
// (Braga: the Sé / Rua do Souto / Largo do Paço, and Praça da República).
const CAR_FREE = () => CITY.traffic?.car_free || [];
const PAINT = [0xf1f1ee, 0xa9afb4, 0x1d1f22, 0x2b3f63, 0x9e2a24, 0x8a7a66].map((h) => new THREE.Color(h));
const LORRY_PAINT = [0xf1f1ee, 0xe8e4da, 0x2c4a7a, 0x9e2a24, 0x3d5c3a].map((h) => new THREE.Color(h));
// the main axes by their OSM name and ref (traffic-model.js AXIS_IDS order)
const AXIS_OF = (t) => (t.name === 'Avenida da Liberdade' ? 1 : /EN 101/.test(t.ref || '') ? 2 : /A 11|CSB|EN 14/.test(t.ref || '') || /Circular Sul de Braga/.test(t.name || '') ? 3 : 0);
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'motorway_link', 'trunk_link', 'primary_link']);

// 0 car, 1 van, 2 lorry; +z is the front (head lamps), metres to world
function vehicleGeometry(type) {
  const parts =
    type === 2
      ? [
          box(2.3, 0.45, 12.6, 0, 0.15, 0, 0x151515),
          box(2.5, 2.7, 2.3, 0, 0.4, 5.1, 0xffffff), // cab
          box(2.52, 0.9, 1.2, 0, 1.75, 5.7, 0x2f3438), // windscreen band
          box(2.55, 3.1, 10, 0, 0.75, -1.3, 0xd8d6d0), // box trailer
        ]
      : type === 1
        ? [box(1.9, 0.3, 4.6, 0, 0, 0, 0x151515), box(2.0, 1.95, 5.2, 0, 0.3, 0, 0xffffff), box(2.02, 0.7, 0.9, 0, 1.3, 2.0, 0x3a3f44)]
        : [box(1.7, 0.3, 3.6, 0, 0, 0, 0x151515), box(1.8, 0.7, 4.4, 0, 0.3, 0, 0xffffff), box(1.6, 0.55, 2.3, 0, 1.0, -0.2, 0x4a4f55)];
  const g = mergeGeometries(parts);
  g.scale(S, S, S);
  return g;
}
// head and tail lamps on the front and back faces, in world units
const lampChunk = (y0, y1) => `
{
  float band = step(${(y0 * S).toFixed(4)}, vLP.y) * step(vLP.y, ${(y1 * S).toFixed(4)}) * step(${(0.42 * S).toFixed(4)}, abs(vLP.x));
  vec3 lamp = step(0.9, vLN.z) * vec3(1.0, 0.92, 0.75) + step(0.9, -vLN.z) * vec3(1.0, 0.07, 0.03);
  totalEmissiveRadiance += lamp * band * uLifeNight * uLifeGlow * 1.6;
}`;

function buildTraffic({ roads, project, heightAt, mobile, model, N: nCars }) {
  const zones = CAR_FREE().map(([la, lo, r]) => ({ ...project(la, lo), r: r * S }));
  const blocked = (x, z) => zones.some((q) => (x - q.x) ** 2 + (z - q.z) ** 2 < q.r * q.r);

  // ---- the junction graph of the real streets (road-network.js): shared
  // OSM nodes, one-way streets, roundabouts, bridges and tunnels
  const net = buildNetwork(roads, project, heightAt);
  const g = net.graph;
  if (!g.n) return null;
  // buffers for the peak (traffic-model.js): 600, 300 on phones, 150 in light mode
  const N = nCars ?? (mobile ? 300 : 600);
  const rnd = lcg(20260928);
  const flow = createFlow(net, { N, rnd, blocked });
  if (!flow) return null;
  const nD = g.n;
  // per directed lane: the main axis (1..3) from the OSM name and ref, a
  // major-road flag, the distance from the centre, the lorry share
  const laneAxis = new Uint8Array(nD);
  const lanePrimary = new Uint8Array(nD);
  const laneFast = new Uint8Array(nD);
  const centreW = new Float32Array(nD);
  const RMAX = 1150; // world units (4.6 km) from the centre: then respawn
  for (let d = 0; d < nD; d++) {
    const w = net.ways[g.way[d]];
    laneAxis[d] = AXIS_OF(w.t);
    lanePrimary[d] = MAJOR.has(w.hw) ? 1 : 0;
    laneFast[d] = w.hw === 'motorway' || w.hw === 'trunk' || w.hw === 'motorway_link' ? 1 : 0;
    const m = (g.A[d] + g.B[d]) >> 1;
    const r = Math.hypot(net.X[m], net.Z[m]);
    // more in the city than out in the hills; the motorways keep a dense flow
    centreW[d] = r > RMAX - 30 ? 0 : laneFast[d] ? 0.5 : 0.04 + Math.exp(-r / 420);
  }
  let weighedFor = -1;
  function weigh(demand) {
    weighedFor = demand;
    // Avenida da Liberdade (axis 1) is short and central: at peak it fills
    // up far more than the long EN 101 and A 11 corridors
    flow.weigh((d, base) => {
      const ax = laneAxis[d];
      return base * centreW[d] * (ax === 1 ? 1 + 10 * demand : ax ? 1 + 2.5 * demand : 1);
    });
  }
  weigh(model ? model.state.demand : 0);

  // ---- vehicles: lorries on the motorways, vans everywhere
  const vt = flow.vt;
  const vc = new Uint8Array(N);
  function spawn(i) {
    flow.spawn(i);
    const d = flow.vd[i];
    const r = rnd();
    vt[i] = r < (laneFast[d] ? 0.24 : 0.03) ? 2 : r < (laneFast[d] ? 0.36 : 0.15) ? 1 : 0;
    vc[i] = vt[i] === 2 ? Math.floor(rnd() * LORRY_PAINT.length) : vt[i] ? (rnd() < 0.8 ? 0 : 1) : Math.floor(rnd() * PAINT.length);
  }
  for (let i = 0; i < N; i++) spawn(i);

  const lampsCar = lampChunk(0.55, 0.85);
  const LAMPS = [lampsCar, lampChunk(0.6, 0.95), lampChunk(0.8, 1.15)];
  const NAMES = ['traffic-cars', 'traffic-vans', 'traffic-lorries'];
  const meshes = [0, 1, 2].map((type) => {
    const m = new THREE.InstancedMesh(vehicleGeometry(type), lifeMaterial({ roughness: 0.38, metalness: 0.25, lamps: LAMPS[type] }), type === 2 ? Math.ceil(N * 0.4) : N);
    m.name = NAMES[type];
    m.frustumCulled = false; // culled per vehicle below
    m.castShadow = false;
    m.receiveShadow = true;
    m.count = 0;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, PAINT[0]);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    return m;
  });

  // Night light streaks, one per vehicle, as in a long exposure: a
  // screen-space quad from the vehicle back along its path, at least 22 px
  // long and 3.8 px wide (10 x 2.5 px over the whole city), so the streets carry streams of
  // light. White where the vehicle comes toward the camera (headlights),
  // red where it drives away (tail lights).
  const lp = new Float32Array(N * 3); // vehicle front, world
  const ld = new Float32Array(N * 3); // heading x, z; trail length (world)
  const lgeo = new THREE.InstancedBufferGeometry();
  lgeo.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
  lgeo.setIndex([0, 1, 2, 0, 2, 3]);
  const lpAttr = new THREE.InstancedBufferAttribute(lp, 3).setUsage(THREE.DynamicDrawUsage);
  const ldAttr = new THREE.InstancedBufferAttribute(ld, 3).setUsage(THREE.DynamicDrawUsage);
  lgeo.setAttribute('iPos', lpAttr);
  lgeo.setAttribute('iDir', ldAttr);
  lgeo.instanceCount = 0;
  const lmat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { ...LIFE_UNIFORMS, uView: { value: new THREE.Vector2(1440, 900) } },
    vertexShader: /* glsl */ `
      uniform vec2 uView;
      attribute vec3 iPos;
      attribute vec3 iDir;
      varying float vAlong;
      varying float vAcross;
      varying float vFade;
      varying float vHead;
      void main() {
        vec3 h = vec3(iDir.x, 0.0, iDir.y);
        vec4 c0 = projectionMatrix * viewMatrix * vec4(iPos, 1.0);
        vec4 c1 = projectionMatrix * viewMatrix * vec4(iPos - h * iDir.z, 1.0);
        if (c0.w <= 0.0 || c1.w <= 0.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vec2 s0 = c0.xy / c0.w * 0.5 * uView;
        vec2 s1 = c1.xy / c1.w * 0.5 * uView;
        vec2 d = s1 - s0;
        float len = length(d);
        vec2 dir = len > 1e-3 ? d / len : vec2(1.0, 0.0);
        vec2 perp = vec2(-dir.y, dir.x);
        // over the whole city the streaks shrink and dim, so they stay a
        // flow of light and not a shower of comets
        float far = smoothstep(500.0, 3200.0, c0.w);
        vec2 sp = s0 + dir * max(len, mix(22.0, 10.0, far)) * position.x + perp * mix(1.9, 1.25, far) * position.y;
        gl_Position = vec4(sp / (0.5 * uView) * c0.w, c0.z, c0.w);
        vAlong = position.x;
        vAcross = position.y;
        float dist = c0.w;
        // up close the lamps on the car bodies take over
        vFade = smoothstep(25.0, 90.0, dist) * (1.0 - smoothstep(5000.0, 8500.0, dist)) * mix(1.0, 0.6, far);
        vHead = smoothstep(-0.15, 0.15, dot(h, normalize(cameraPosition - iPos)));
      }`,
    fragmentShader: /* glsl */ `
      uniform float uLifeNight;
      uniform float uLifeGlow;
      varying float vAlong;
      varying float vAcross;
      varying float vFade;
      varying float vHead;
      void main() {
        float k = pow(1.0 - vAlong, 1.3) * (1.0 - vAcross * vAcross);
        // red carries little luminance: it gets more energy to glow as much
        vec3 c = mix(vec3(1.0, 0.07, 0.02) * 2.6, vec3(1.0, 0.9, 0.7) * 1.7, vHead);
        gl_FragColor = vec4(c * k * uLifeNight * vFade * uLifeGlow, 1.0);
      }`,
  });
  lmat.toneMapped = false;
  const lights = new THREE.Mesh(lgeo, lmat);
  lights.name = 'traffic-lights';
  lights.frustumCulled = false;
  lights.renderOrder = 31;
  lights.visible = false;

  const group = new THREE.Group();
  group.name = 'traffic';
  group.add(meshes[0], meshes[1], meshes[2], lights);

  const RMAX2 = RMAX * RMAX;
  let visible = 0;
  let active = N;
  let flowT = 0; // seconds, for the stop-and-go waves
  const ms = model?.state;
  function speedK(i) {
    if (!ms) return 1;
    const l = flow.vd[i];
    const ax = laneAxis[l];
    if (!ax) return lanePrimary[l] ? ms.primaryK : ms.freeK;
    let k = ms.axisK;
    const jam = ms.jam;
    if (jam > 0.02) {
      // a wave of slow traffic travelling against the flow (about 280 m
      // long, 5 m/s back), and a queue in the last 40 m before a junction
      const w = 0.5 + 0.5 * Math.sin(-flow.vs[i] * 0.09 + (l & 7) * 3.1 + flowT * 0.11 + ax);
      k *= 1 - 0.8 * jam * (w * w * (3 - 2 * w));
      const left = g.len[l] - flow.vs[i];
      if (left < 10) k *= 1 - 0.75 * jam * (1 - left / 10);
    }
    return Math.max(0.06, k);
  }

  const pos = { x: 0, y: 0, z: 0, hx: 0, hz: 1, dy: 0, hidden: 0 };

  function inView(frustum, x, y, z, r) {
    const p = frustum.planes;
    for (let k = 0; k < 6; k++) if (p[k].normal.x * x + p[k].normal.y * y + p[k].normal.z * z + p[k].constant < -r) return false;
    return true;
  }

  const counts = [0, 0, 0]; // visible cars, vans, lorries (reused every frame)
  const caps = meshes.map((m) => m.instanceMatrix.count);
  const streakAttrs = [lpAttr, ldAttr];
  function update(dt, camera, frustum, { night, camDist, width, height }) {
    flowT += dt;
    if (ms) {
      if (Math.abs(ms.demand - weighedFor) > 0.04) weigh(ms.demand);
      const want = Math.min(N, ms.count);
      // new vehicles enter where the demand now sends them
      for (let i = active; i < want; i++) spawn(i);
      active = want;
    } else active = Math.round(N * 0.5 * (1 - 0.2 * night));
    const bodies = camDist < 2800;
    const showLights = night > 0.02;
    counts[0] = counts[1] = counts[2] = 0;
    let nl = 0;
    const cx = camera.position.x;
    const cz = camera.position.z;
    for (let i = 0; i < active; i++) {
      if (dt > 0 && !flow.step(i, dt, speedK(i))) {
        // a one-way street that ends (or the map edge): it leaves the map
        spawn(i);
        flow.locate(i, pos, -1);
        continue;
      }
      const p = flow.locate(i, pos, dt);
      if (p.x * p.x + p.z * p.z > RMAX2) {
        spawn(i);
        continue;
      }
      // inside a tunnel: out of sight until the other portal
      if (p.hidden) continue;
      if (!inView(frustum, p.x, p.y, p.z, 3)) continue;
      const t = vt[i];
      if (bodies && counts[t] < caps[t] && (p.x - cx) ** 2 + (p.z - cz) ** 2 < 2800 * 2800) {
        const m = meshes[t];
        const k = counts[t]++;
        const e = m.instanceMatrix.array;
        const o = k * 16;
        // +z of the vehicle along the travel direction, pitched with the
        // ramp; x stays level (the body does not roll)
        const cp = 1 / Math.sqrt(1 + p.dy * p.dy);
        const sp = p.dy * cp;
        e[o] = p.hz;
        e[o + 1] = 0;
        e[o + 2] = -p.hx;
        e[o + 3] = 0;
        e[o + 4] = -p.hx * sp;
        e[o + 5] = cp;
        e[o + 6] = -p.hz * sp;
        e[o + 7] = 0;
        e[o + 8] = p.hx * cp;
        e[o + 9] = sp;
        e[o + 10] = p.hz * cp;
        e[o + 11] = 0;
        e[o + 12] = p.x;
        e[o + 13] = p.y + 0.13;
        e[o + 14] = p.z;
        e[o + 15] = 1;
        (t === 2 ? LORRY_PAINT : PAINT)[vc[i]].toArray(m.instanceColor.array, k * 3);
      }
      if (showLights) {
        const half = (t === 2 ? 6.4 : t ? 2.6 : 2.2) * S;
        const o = nl * 3;
        lp[o] = p.x + p.hx * half;
        lp[o + 1] = p.y + 0.13 + 0.7 * S;
        lp[o + 2] = p.z + p.hz * half;
        ld[o] = p.hx;
        ld[o + 1] = p.hz;
        ld[o + 2] = flow.vv[i] * 2.5 + 2 * half; // the path of the last 2.5 s
        nl++;
      }
    }
    for (let t = 0; t < 3; t++) {
      const m = meshes[t];
      m.count = counts[t];
      m.visible = counts[t] > 0;
      if (counts[t]) {
        m.instanceMatrix.clearUpdateRanges();
        m.instanceMatrix.addUpdateRange(0, counts[t] * 16);
        m.instanceMatrix.needsUpdate = true;
        m.instanceColor.clearUpdateRanges();
        m.instanceColor.addUpdateRange(0, counts[t] * 3);
        m.instanceColor.needsUpdate = true;
      }
      // shadows only in a close-up, where a car's shadow is more than a pixel
      m.castShadow = camDist < 260;
    }
    lights.visible = nl > 0;
    if (nl) {
      lgeo.instanceCount = nl;
      for (const a of streakAttrs) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, nl * 3);
        a.needsUpdate = true;
      }
      lmat.uniforms.uView.value.set(width, height);
    }
    visible = counts[0] + counts[1] + counts[2];
  }

  let laneLen = 0;
  for (let d = 0; d < nD; d++) laneLen += g.len[d];
  return {
    object: group,
    update,
    flow,
    net,
    stats: {
      // the graph: junction nodes, edges (street pieces between them),
      // directed lanes (one per allowed direction)
      nodes: g.nodes,
      edges: g.edges,
      lanes: nD,
      oneWay: g.rev.filter((r) => r < 0).length,
      vehicles: N,
      laneKm: +(laneLen / S / 1000).toFixed(1),
      axisLanes: [1, 2, 3].map((a) => laneAxis.filter((v) => v === a).length),
    },
    // tests: mean speed factor of the active vehicles on the axes and off them
    speedSample() {
      let sa = 0;
      let na = 0;
      let so = 0;
      let no = 0;
      for (let i = 0; i < active; i++) {
        if (laneAxis[flow.vd[i]]) {
          sa += speedK(i);
          na++;
        } else {
          so += speedK(i);
          no++;
        }
      }
      return { axis: na ? +(sa / na).toFixed(2) : null, onAxis: na, other: no ? +(so / no).toFixed(2) : null };
    },
    get visible() {
      return visible;
    },
    get active() {
      return active;
    },
  };
}

// ------------------------------------------------------------ birds
function birdGeometry() {
  // units; +z forward, wings along x; aWing 0 at the body, 1 at the tips
  const W = BIRD_SPAN / 2;
  const D = 0.03; // dihedral: the wings in a shallow V, so a bird seen edge-on still shows
  const p = [
    // body
    0, 0, 0.24, -0.04, 0, -0.12, 0.04, 0, -0.12,
    // tail
    0, 0, -0.07, -0.06, 0, -0.24, 0.06, 0, -0.24,
    // left wing (two triangles: inner, outer)
    -0.02, 0, 0.08, -0.02, 0, -0.07, -W * 0.55, D * 0.55, 0.0,
    -W * 0.55, D * 0.55, 0.0, -0.02, 0, -0.07, -W, D, -0.09,
    // right wing
    0.02, 0, 0.08, W * 0.55, D * 0.55, 0.0, 0.02, 0, -0.07,
    W * 0.55, D * 0.55, 0.0, W, D, -0.09, 0.02, 0, -0.07,
  ];
  const w = [0, 0, 0, 0, 0, 0, 0, 0, 0.55, 0.55, 0, 1, 0, 0.55, 0, 0.55, 1, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(w, 1));
  g.computeVertexNormals();
  return g;
}

const BIRD_SPAN = 0.5; // world units (2 m): gulls, larger than life so they read on the map

function birdMaterial(uHeight) {
  // gull grey: light over the dark woods of the hills, and the shaded
  // undersides still read against the sky
  const mat = new THREE.MeshLambertMaterial({ color: 0xb8b3a8, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uLifeTime = LIFE_UNIFORMS.uLifeTime;
    sh.uniforms.uHeight = uHeight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uLifeTime;\nuniform float uHeight;\nattribute float aWing;\nattribute float aPhase;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  // wing beat with glides; a far bird is drawn at least 12 px wide (4 px
  // over the whole city), so a flock reads as birds, not as noise
  float ph = aPhase * 6.2831;
  float amp = 0.55 + 0.45 * sin(uLifeTime * 0.7 + aPhase * 17.0);
  transformed.y += sin(uLifeTime * 11.0 + ph) * 0.13 * aWing * amp;
  vec4 ip = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float dist = max(distance(ip.xyz, cameraPosition), 1.0);
  float px = ${BIRD_SPAN.toFixed(2)} * uHeight * 0.5 * projectionMatrix[1][1] / dist;
  float minPx = mix(12.0, 4.0, smoothstep(250.0, 2500.0, dist));
  transformed *= clamp(minPx / px, 1.0, 16.0);
}`,
      );
  };
  return mat;
}

function buildBirds({ items, heightAt, project, nature, mobile, lite = false }) {
  const byId = (id) => items.find((i) => i.data.id === id);
  const anchors = [];
  for (const [id, lift, r] of [['bom-jesus', 13, 26], ['sameiro', 16, 26], ['se-braga', 9, 15]]) {
    const it = byId(id);
    if (it) anchors.push({ id, x: it.x, z: it.z, y: it.top + lift, r });
  }
  // the Rio Este: the middle of its longest OSM line
  const este = (nature?.data?.lines || []).filter((l) => l.n === 'Rio Este').sort((a, b) => b.p.length - a.p.length)[0];
  if (este) {
    const q = este.p[este.p.length >> 1];
    const c = project(q[0], q[1]);
    anchors.push({ id: 'rio-este', x: c.x, z: c.z, y: heightAt(c.x, c.z) + 14, r: 40 });
  }
  const M = lite ? 10 : mobile ? 20 : 40;
  const uHeight = { value: 900 };
  const geo = birdGeometry();
  const mat = birdMaterial(uHeight);
  const rnd = lcg(77);
  const flocks = anchors.map((a, fi) => {
    const P = new Float32Array(M * 3);
    const V = new Float32Array(M * 3);
    for (let i = 0; i < M; i++) {
      const ang = rnd() * Math.PI * 2;
      P[i * 3] = a.x + Math.cos(ang) * a.r * (0.5 + rnd() * 0.5);
      P[i * 3 + 1] = a.y + (rnd() - 0.5) * 6;
      P[i * 3 + 2] = a.z + Math.sin(ang) * a.r * (0.5 + rnd() * 0.5);
      V[i * 3] = -Math.sin(ang) * 3;
      V[i * 3 + 2] = Math.cos(ang) * 3;
    }
    const ig = geo.clone();
    const phase = new Float32Array(M);
    for (let i = 0; i < M; i++) phase[i] = rnd();
    ig.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    const mesh = new THREE.InstancedMesh(ig, mat, M);
    mesh.name = `birds-${a.id}`;
    mesh.castShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(a.x, a.y, a.z), a.r * 2);
    const ground = heightAt(a.x, a.z);
    return { a, P, V, mesh, dir: fi % 2 ? -1 : 1, omega: 0.05 + 0.02 * fi, panic: 0, ground, cx: a.x, cy: a.y, cz: a.z };
  });
  const group = new THREE.Group();
  group.name = 'birds';
  for (const f of flocks) group.add(f.mesh);

  const MAXV = 3.6;
  const MINV = 1.8;
  const _x = new THREE.Vector3();
  const _y = new THREE.Vector3();
  const _z = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  let time = 0;
  let scattered = 0;
  function step(f, dt, cam) {
    const { a, P, V } = f;
    const tgx = a.x + Math.cos(time * f.omega * f.dir + a.r) * a.r;
    const tgz = a.z + Math.sin(time * f.omega * f.dir + a.r) * a.r;
    const tgy = a.y + Math.sin(time * 0.23 + a.r) * 5;
    // scatter: the camera close to the flock
    const dcx = f.cx - cam.x;
    const dcy = f.cy - cam.y;
    const dcz = f.cz - cam.z;
    const dc = Math.hypot(dcx, dcy, dcz);
    if (dc < 45) {
      if (f.panic <= 0) scattered++;
      f.panic = 4.5;
    }
    f.panic = Math.max(0, f.panic - dt);
    const panic = f.panic > 0 ? Math.min(1, f.panic / 1.5) : 0;
    const vmax = MAXV * (1 + 1.3 * panic);
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let i = 0; i < M; i++) {
      const o = i * 3;
      const px = P[o];
      const py = P[o + 1];
      const pz = P[o + 2];
      let cx = 0;
      let cy = 0;
      let cz = 0;
      let ax = 0;
      let ay = 0;
      let az = 0;
      let rx = 0;
      let ry = 0;
      let rz = 0;
      let n = 0;
      for (let j = 0; j < M; j++) {
        if (j === i) continue;
        const q = j * 3;
        const dx = P[q] - px;
        const dy = P[q + 1] - py;
        const dz = P[q + 2] - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 36) continue;
        n++;
        cx += dx;
        cy += dy;
        cz += dz;
        ax += V[q];
        ay += V[q + 1];
        az += V[q + 2];
        if (d2 < 1.2) {
          const k = 1 / Math.max(d2, 0.05);
          rx -= dx * k;
          ry -= dy * k;
          rz -= dz * k;
        }
      }
      let fx = (tgx - px) * 0.05;
      let fy = (tgy - py) * 0.12;
      let fz = (tgz - pz) * 0.05;
      if (n) {
        const cohesion = 0.25 * (1 - panic);
        fx += (cx / n) * cohesion + (ax / n - V[o]) * 0.6 + rx * 0.9;
        fy += (cy / n) * cohesion + (ay / n - V[o + 1]) * 0.6 + ry * 0.9;
        fz += (cz / n) * cohesion + (az / n - V[o + 2]) * 0.6 + rz * 0.9;
      }
      if (panic > 0) {
        const ex = px - cam.x;
        const ey = py - cam.y;
        const ez = pz - cam.z;
        const e = Math.max(Math.hypot(ex, ey, ez), 1);
        const k = (panic * 40) / e;
        fx += (ex / e) * k;
        fy += (ey / e) * k * 0.5 + panic * 1.5;
        fz += (ez / e) * k;
      }
      // keep clear of the ground
      if (py < f.ground + 10) fy += (f.ground + 10 - py) * 0.8;
      let vx = V[o] + fx * dt;
      let vy = V[o + 1] + fy * dt;
      let vz = V[o + 2] + fz * dt;
      vy *= 0.97;
      const sp = Math.hypot(vx, vy, vz);
      const lim = THREE.MathUtils.clamp(sp, MINV, vmax) / Math.max(sp, 1e-6);
      vx *= lim;
      vy *= lim;
      vz *= lim;
      V[o] = vx;
      V[o + 1] = vy;
      V[o + 2] = vz;
      P[o] = px + vx * dt;
      P[o + 1] = py + vy * dt;
      P[o + 2] = pz + vz * dt;
      sx += P[o];
      sy += P[o + 1];
      sz += P[o + 2];
    }
    f.cx = sx / M;
    f.cy = sy / M;
    f.cz = sz / M;
  }
  function write(f) {
    const { P, V, mesh } = f;
    const e = mesh.instanceMatrix.array;
    let r2 = 0;
    for (let i = 0; i < M; i++) {
      const o = i * 3;
      _z.set(V[o], V[o + 1], V[o + 2]).normalize();
      _x.crossVectors(UP, _z);
      if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
      _x.normalize();
      _y.crossVectors(_z, _x);
      const m = i * 16;
      e[m] = _x.x;
      e[m + 1] = _x.y;
      e[m + 2] = _x.z;
      e[m + 3] = 0;
      e[m + 4] = _y.x;
      e[m + 5] = _y.y;
      e[m + 6] = _y.z;
      e[m + 7] = 0;
      e[m + 8] = _z.x;
      e[m + 9] = _z.y;
      e[m + 10] = _z.z;
      e[m + 11] = 0;
      e[m + 12] = P[o];
      e[m + 13] = P[o + 1];
      e[m + 14] = P[o + 2];
      e[m + 15] = 1;
      r2 = Math.max(r2, (P[o] - f.cx) ** 2 + (P[o + 1] - f.cy) ** 2 + (P[o + 2] - f.cz) ** 2);
    }
    mesh.instanceMatrix.needsUpdate = true;
    // the flock's own sphere: the renderer culls each flock against the view
    mesh.boundingSphere.center.set(f.cx, f.cy, f.cz);
    mesh.boundingSphere.radius = Math.sqrt(r2) + 6;
  }
  for (const f of flocks) write(f);

  let shown = 0;
  function update(dt, camera, { night, rain, height }) {
    time += dt;
    uHeight.value = height;
    // at night and in heavy rain the birds are roosting
    const on = night < 0.55 && rain < 0.5;
    shown = 0;
    for (const f of flocks) {
      f.mesh.visible = on;
      if (!on) continue;
      if (dt > 0) {
        // two sub-steps keep the flock stable at 30 fps
        step(f, dt * 0.5, camera.position);
        step(f, dt * 0.5, camera.position);
        write(f);
      }
      shown += M;
    }
  }
  return {
    object: group,
    update,
    flocks,
    stats: { flocks: flocks.length, birds: flocks.length * M },
    get scattered() {
      return scattered;
    },
    get shown() {
      return shown;
    },
  };
}

// ------------------------------------------------------------ fountains
const SITES = ['praca-republica', 'avenida-central', 'santa-barbara', 'bom-jesus', 'tibaes', 'largo'];

function buildFountains({ project, heightAt, items, mobile }) {
  const list = LIFE?.fountains || [];
  if (!list.length) return null;
  const byId = (id) => items.find((i) => i.data.id === id);
  // down the Bom Jesus stair (bearing 261): where the riser spouts throw
  const down = { x: Math.sin((261 * Math.PI) / 180), z: -Math.cos((261 * Math.PI) / 180) };
  const emitters = [];
  for (const f of list) {
    const c = project(f.lat, f.lon);
    const site = SITES.includes(f.site) ? f.site : 'largo';
    const it = byId(f.site);
    const mesh = it?.meshes?.[0];
    const spout = f.kind === 'spout';
    // spouts: the basin 1.3 m in front of the riser
    const qx = spout ? c.x + down.x * 1.3 * S : c.x;
    const qz = spout ? c.z + down.z * 1.3 * S : c.z;
    const g = heightAt(qx, qz);
    const hit = surfaceHeights(mesh, [qx], [qz], [g - 2], [g + (spout ? 1.2 : 3)])[0];
    const top = Number.isFinite(hit) ? hit : g + 0.15;
    emitters.push({ ...f, site, x: qx, z: qz, y: top + (spout ? 0.9 * S : 0.05), spout });
  }
  // particles per emitter
  const counts = emitters.map((e) => (e.spout ? 40 : e.id === 'praca-republica' ? 520 : e.h >= 3 ? 280 : 130));
  const scale = mobile ? 0.5 : 1;
  const total = counts.reduce((s, n) => s + Math.round(n * scale), 0);
  const O = new Float32Array(total * 3);
  const Vv = new Float32Array(total * 3);
  const T = new Float32Array(total * 3); // life, phase, site
  const rnd = lcg(4242);
  let k = 0;
  emitters.forEach((e, ei) => {
    const n = Math.round(counts[ei] * scale);
    const si = SITES.indexOf(e.site);
    for (let i = 0; i < n; i++) {
      let vx;
      let vy;
      let vz;
      let ox = e.x;
      let oz = e.z;
      if (e.spout) {
        // a small arc forward into the basin below the spout
        const v = (0.9 + rnd() * 0.4) * S;
        vx = down.x * v + (rnd() - 0.5) * 0.15 * S;
        vz = down.z * v + (rnd() - 0.5) * 0.15 * S;
        vy = (0.2 + rnd() * 0.3) * S;
      } else {
        // the central jet; on the Praça also a ring of jets leaning inward
        const ring = e.id === 'praca-republica' && i % 3 === 0;
        const h = (ring ? 1.6 : e.h) * S * (0.75 + 0.25 * rnd());
        const v0 = Math.sqrt(2 * GRAVITY * h);
        const flight = (2 * v0) / GRAVITY;
        const ang = rnd() * Math.PI * 2;
        if (ring) {
          const rr = e.r * 0.62 * S;
          ox += Math.cos(ang) * rr;
          oz += Math.sin(ang) * rr;
          const inward = (rr * 0.7) / flight;
          vx = -Math.cos(ang) * inward;
          vz = -Math.sin(ang) * inward;
        } else {
          const spread = ((e.r * 0.5 * S) / flight) * Math.sqrt(rnd());
          vx = Math.cos(ang) * spread;
          vz = Math.sin(ang) * spread;
        }
        vy = v0;
      }
      const life = e.spout ? 0.9 : (2 * vy) / GRAVITY + 0.12;
      O.set([ox, e.y, oz], k * 3);
      Vv.set([vx, vy, vz], k * 3);
      T.set([life, rnd(), si], k * 3);
      k++;
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(O, 3));
  geo.setAttribute('aVel', new THREE.BufferAttribute(Vv, 3));
  geo.setAttribute('aLife', new THREE.BufferAttribute(T, 3));
  const uniforms = {
    uLifeTime: LIFE_UNIFORMS.uLifeTime,
    uHeight: { value: 900 },
    uColor: { value: new THREE.Color(0.8, 0.85, 0.9) },
    uHide: { value: new Float32Array(SITES.length) },
    uG: { value: GRAVITY },
  };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms,
    vertexShader: /* glsl */ `
      uniform float uLifeTime;
      uniform float uHeight;
      uniform float uG;
      uniform float uHide[${SITES.length}];
      attribute vec3 aVel;
      attribute vec3 aLife;
      varying float vA;
      void main() {
        float life = aLife.x;
        float age = mod(uLifeTime + aLife.y * life, life);
        vec3 p = position + aVel * age - vec3(0.0, 0.5 * uG * age * age, 0.0);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        float hide = 0.0;
        for (int i = 0; i < ${SITES.length}; i++) if (abs(aLife.z - float(i)) < 0.5) hide = uHide[i];
        // droplets of about 12 cm, 1 .. 4.5 px
        gl_PointSize = hide > 0.5 ? 0.0 : clamp(0.03 * projectionMatrix[1][1] * uHeight * 0.5 / d, 1.0, 4.5);
        float k = age / life;
        vA = (1.0 - smoothstep(0.75, 1.0, k)) * smoothstep(0.0, 0.05, k) * (1.0 - smoothstep(300.0, 700.0, d));
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vA;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r = dot(p, p);
        if (r > 1.0 || vA < 0.01) discard;
        gl_FragColor = vec4(uColor, vA * 0.55 * (1.0 - r));
      }`,
  });
  mat.name = 'fountains';
  const points = new THREE.Points(geo, mat);
  points.name = 'fountains';
  points.frustumCulled = false;
  points.renderOrder = 20;
  const sitesItems = SITES.map((s) => byId(s));

  function update(camera, { atmosphere, height, camDist }) {
    // only near: a droplet from far away is less than a pixel
    let near = Infinity;
    for (const e of emitters) near = Math.min(near, (e.x - camera.position.x) ** 2 + (e.z - camera.position.z) ** 2);
    points.visible = camDist < 900 && near < 1200 * 1200;
    if (!points.visible) return;
    uniforms.uHeight.value = height;
    // hidden with its landmark (category filter)
    for (let i = 0; i < sitesItems.length; i++) {
      const it = sitesItems[i];
      uniforms.uHide.value[i] = it && !it.meshes[0].visible ? 1 : 0;
    }
    // water catches the sky and the sun; at night the lamps of the square
    const st = atmosphere.state;
    const sunK = Math.min(1, st.lightI / 4) * Math.max(0, atmosphere.sunDir.y + 0.1);
    addScaled(uniforms.uColor.value.copy(st.mid).multiplyScalar(0.7), st.light, 0.55 * sunK);
    if (st.night > 0) uniforms.uColor.value.lerp(NIGHT_WATER, st.night * 0.8);
  }
  return { object: points, update, emitters, stats: { fountains: emitters.length, particles: total } };
}
const NIGHT_WATER = new THREE.Color(0.5, 0.42, 0.3);

// ------------------------------------------------------------ public
export function createLife(ctx) {
  const { renderer, scene, camera, atmosphere, project, heightAt, roads, items, nature, fx, reducedMotion = false, mobile = false, lite = false, debug = {}, setHash = () => {} } = ctx;
  // light mode (main.js): 150 cars at the peak, 10 birds
  const carMax = lite ? 150 : mobile ? 300 : 600;
  const group = new THREE.Group();
  group.name = 'life';
  scene.add(group);

  const t0 = performance.now();
  const safe = (name, fn) => {
    try {
      return fn();
    } catch (e) {
      console.warn(`[porto] life: ${name} failed`, e);
      return null;
    }
  };
  const datumM = debug.projection?.datum ?? 0;
  const weather = createWeather({ scene, atmosphere, datumM, mobile, reducedMotion });
  const live = createLive({ atmosphere, weather, reducedMotion, onPersist: () => setHash() });
  // one clock for traffic and buses: the real Lisbon time in live mode (or
  // ?now=), the preset's hour otherwise (traffic-model.js PRESET_HOUR)
  const model = safe('traffic model', () =>
    createTrafficModel({ max: carMax, getNow: live.now, isLive: () => live.live, getPreset: () => atmosphere.time, project, mobile }),
  );

  const funicular = safe('funicular', () => buildFunicular({ project, heightAt, items }));
  const traffic = safe('traffic', () => buildTraffic({ roads, project, heightAt, mobile, model, N: carMax }));
  const birds = safe('birds', () => buildBirds({ items, heightAt, project, nature, mobile, lite }));
  const fountains = safe('fountains', () => buildFountains({ project, heightAt, items, mobile }));
  // the street level: calçada squares, furniture, people, POI signs
  // (streetscape.js; it builds once its data has arrived)
  const street = safe('streetscape', () =>
    createStreetscape({ camera, roads, project, heightAt, items, outlines: ctx.outlines, footprints: ctx.footprints, lite, mobile, debug, model, fx, surfaceHeights }),
  );
  for (const p of [funicular, traffic, birds, fountains, street]) if (p) group.add(p.object);

  const ctxLive = { scene, camera, renderer, project, heightAt, datumM, mobile, reducedMotion, live, model, atmosphere, group };
  // aircraft and buses: a separate chunk, loaded after the first frame
  let air = null;
  let buses = null;
  Promise.all([import('./liveair.js'), import('./livebus.js')])
    .then(([a, b]) => {
      air = safe('aircraft', () => a.createLiveAir(ctxLive));
      buses = safe('buses', () => b.createLiveBus(ctxLive));
    })
    .catch((e) => console.warn('[porto] life: live layers failed to load', e));
  const buildMs = Math.round(performance.now() - t0);

  const frustum = new THREE.Frustum();
  const _pm = new THREE.Matrix4();
  const _size = new THREE.Vector2();
  const view = { night: 0, camDist: 0, width: 1, height: 1, rain: 0, atmosphere };
  let time = 0;
  const stats = {
    buildMs,
    funicular: funicular?.stats ?? null,
    traffic: traffic?.stats ?? null,
    birds: birds?.stats ?? null,
    fountains: fountains?.stats ?? null,
    streetscape: street?.stats ?? null,
    rainDrops: 0,
    visibleVehicles: 0,
  };

  // the live badge's extra lines: aircraft, buses, traffic (once a second)
  let lastBadge = -Infinity;
  function badgeLines() {
    const tNow = performance.now();
    if (tNow - lastBadge < 1000) return;
    lastBadge = tNow;
    if (!live.live) return;
    live.setExtra('air', air?.badge() ?? null);
    live.setExtra('bus', buses?.badge() ?? null);
    const ms = model?.state;
    if (ms && traffic) {
      const n = Math.round(traffic.active / 10) * 10;
      live.setExtra('traffic', `${t('Трафик:')} ${t(ms.level)} · ≈ ${n} ${t('машин')}${ms.source === 'tomtom' ? ' · TomTom' : ''}`);
    }
  }

  function update(dt, camDist) {
    const adt = reducedMotion ? 0 : dt;
    time += adt;
    LIFE_UNIFORMS.uLifeTime.value = time;
    const night = atmosphere.night;
    LIFE_UNIFORMS.uLifeNight.value = night;
    // emissive above the bloom threshold only when post-processing is on
    LIFE_UNIFORMS.uLifeGlow.value = fx?.enabled ? 2.6 : 1;
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(_pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    renderer.getDrawingBufferSize(_size);

    live.update();
    weather.update(dt, camera, camDist);
    // one frame record, reused (no per-frame objects)
    view.night = night;
    view.camDist = camDist;
    view.width = _size.x;
    view.height = _size.y;
    view.rain = weather.rainK;
    model?.update();
    funicular?.update(adt, camera);
    traffic?.update(adt, camera, frustum, view);
    birds?.update(adt, camera, view);
    fountains?.update(camera, view);
    street?.update(adt, frustum, view);
    air?.update(adt, dt, view);
    buses?.update(adt, dt, view);
    badgeLines();

    stats.visibleVehicles = traffic?.visible ?? 0;
    stats.rainDrops = weather.rainDrops;
    stats.weather = weather.name;
    stats.live = live.live;
    if (debug.stats && debug.stats.life !== stats) debug.stats.life = stats;
  }

  const api = {
    update,
    weather,
    live,
    funicular,
    traffic,
    birds,
    fountains,
    street,
    stats,
    group,
    model,
    get air() {
      return air;
    },
    get buses() {
      return buses;
    },
  };
  debug.life = api;
  if (street) debug.streetscape = street;
  return api;
}
