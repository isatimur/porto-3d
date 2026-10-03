// The living city: what moves on the map.
//
//   - the Bom Jesus funicular (1882, water balance) and Porto's Funicular
//     dos Guindais (1891, rebuilt 2004): two cars on the real OSM tracks
//     (data/life.json), counter-balanced, one up while the other comes
//     down; a 4-minute trip run ten times faster, with a pause at the
//     stations. The cars ride on the model's own track bed where the city
//     has one (Braga), else on the terrain height;
//   - the historic trams (Elétrico Linhas 1, 18 and 22): yellow Carros
//     Elétricos on three real OSM routes — Infante <-> Passeio Alegre along
//     the river, Clérigos <-> Passeio Alegre, and Carmo <-> Batalha — with
//     1435 mm gauge rails set in the pavement, following the ground, easing
//     to a stop and reversing at each terminus, each showing its number and
//     lit interior with passengers hinted at the windows;
//   - the Teleférico de Gaia (2011): two stations, two haul ropes and six
//     cabins gliding between the Cais de Gaia and the Jardim do Morro, each
//     cabin gently swaying; a cabin passes every ~20 s;
//   - rolling stock on the Douro crossings (data/life.json `rail`): the
//     Metro do Porto (Linha D) on the Luís I upper deck between Jardim do
//     Morro and São Bento, CP mainline trains (a locomotive and carriages)
//     on the Ponte de São João to/from Campanhã, and the green CP Urbanos
//     EMU on the same São João alignment. Each consist rides the real OSM
//     alignment with its livery, pantograph and lit destination board; on the
//     bridge it holds the deck height (60 m Luís I upper, 66 m São João,
//     dimensions.json), elsewhere it follows the terrain, ramping down off
//     the bridge at the ends;
//   - river traffic on the Douro: rabelo boats (flat-bottomed, port casks,
//     a square sail with its red cross, a crew), Douro cruisers down to the
//     Foz and up to Freixo, a three-deck barco-hotel and the small Gaia <->
//     Ribeira ferry, each on its own ordered path with a spreading, fading
//     wake; rabelos also lie moored along the Cais de Gaia (data/life.json
//     `boats`);
//   - traffic on the primary and secondary streets: instanced cars, vans and
//     lorries, plus a few Porto taxis and STCP buses, that follow the OSM
//     polylines at 30-55 km/h in both directions, turning onto a connected
//     street at each end; head and tail lights at night, drawn as points too,
//     so from far away they are streams of light;
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

export function buildFunicular({ project, heightAt, items }) {
  const cfg = LIFE?.funicular;
  const tracks = cfg?.tracks;
  if (!Array.isArray(tracks) || tracks.length < 2) return null;
  // a modelled track bed when the city has one (Braga's Bom Jesus); Porto's
  // Guindais has none, so the cars ride the terrain height instead
  const it = (cfg.site ? items.find((i) => i.data.id === cfg.site) : null) || items.find((i) => i.data.id === 'bom-jesus');
  const mesh = it?.meshes?.[0];
  const top = project(tracks[0][0][0], tracks[0][0][1]);
  const topY = heightAt(top.x, top.z);
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
    const hidden = (mesh ? !mesh.visible : false) || camera.position.distanceToSquared(_p.set(top.x, topY, top.z)) > 2600 * 2600;
    cars.visible = !hidden;
    if (hidden) return;
    u = phaseU(time);
    // car A comes down track 0 while car B goes up track 1
    const [L0, L1] = lines;
    place(0, L0, half + u * (L0.total - 2 * half));
    place(1, L1, L1.total - half - u * (L1.total - 2 * half));
    cars.instanceMatrix.needsUpdate = true;
  }
  update(0, { position: new THREE.Vector3(top.x, topY, top.z) });
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

// ------------------------------------------------------------ trams
const TRAM_M = 9; // metres, the Porto Carro Elétrico
const TRAM_SPEEDUP = 10; // the map runs the timetable faster, like the funicular

// A yellow Carro Elétrico: skirt, body, a lit window band, clerestory roof,
// a raised trolley pole, twin headlights, a dark destination board and the
// front fender; +z is the front (metres -> world).
function tramGeometry() {
  const W = 2.4;
  const parts = [
    box(W, 0.5, TRAM_M, 0, 0, 0, 0x24231f), // chassis / skirt
    box(W, 1.5, TRAM_M - 0.5, 0, 0.5, 0, 0xe7b32a), // yellow body
    box(W + 0.06, 0.85, TRAM_M - 1.9, 0, 1.0, 0.1, 0x223039, 1), // lit side windows
    box(W + 0.07, 0.7, 0.12, 0, 1.0, TRAM_M / 2 - 0.3, 0x2a3a44, 1), // front window
    box(W - 0.2, 0.18, TRAM_M - 0.9, 0, 2.0, 0, 0xd39a1c), // clerestory roof
    box(0.1, 1.35, 0.1, 0, 2.15, -1.9, 0x3a3f42), // trolley pole
    box(1.5, 0.07, 0.07, 0, 3.5, -1.9, 0x3a3f42), // trolley bar
    box(0.5, 0.62, 0.12, 0, 1.5, TRAM_M / 2 - 0.04, 0x14120f), // destination board
    box(0.18, 0.18, 0.1, -0.72, 0.72, TRAM_M / 2 - 0.02, 0xffe9b0, 1), // headlights
    box(0.18, 0.18, 0.1, 0.72, 0.72, TRAM_M / 2 - 0.02, 0xffe9b0, 1),
    box(W - 0.3, 0.5, 0.06, 0, 0.05, TRAM_M / 2 + 0.05, 0x24231f), // front fender
  ];
  // interior light washing the clerestory, and passengers hinted as dark
  // shapes just outside the lit window band
  parts.push(box(W + 0.08, 0.07, TRAM_M - 2.0, 0, 1.86, 0.1, 0xffe9b0, 1));
  for (const sgn of [-1, 1]) {
    for (const z of [-2.6, -1.3, 0.6, 1.9]) {
      parts.push(box(0.34, 0.5, 0.26, sgn * (W / 2 + 0.06), 0.92, z, 0x1b2026)); // torso
      parts.push(box(0.22, 0.26, 0.22, sgn * (W / 2 + 0.06), 1.5, z, 0x1b2026)); // head
    }
  }
  const g = mergeGeometries(parts);
  g.scale(S, S, S);
  return g;
}

// The route-number board: a little canvas texture (black destination blind,
// a stripe in the line's colour, the number in cream). No DOM (headless
// smoke) -> null, and the board falls back to a plain dark plate.
function boardTexture(number, colour) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#14120f';
  x.fillRect(0, 0, 128, 64);
  x.fillStyle = colour || '#187EC2';
  x.fillRect(0, 0, 128, 9);
  x.fillStyle = '#f6efdc';
  x.font = 'bold 42px system-ui, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(String(number), 64, 39);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Rails: two thin steel strips per line, following the polyline at ground
// height (nothing here reads roads.json), so a tram street reads as a tram
// street before a car appears. One static InstancedMesh, a box per segment,
// two per line at the 1435 mm gauge.
function buildRails(lines, cfg) {
  const gauge = (cfg?.rail_gauge_m ?? 1.435) * S;
  const RW = (cfg?.rail_width_m ?? 0.07) * S;
  const RH = (cfg?.rail_height_m ?? 0.045) * S;
  let count = 0;
  for (const L of lines) count += (L.xs.length - 1) * 2;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x585a5e,
    roughness: 0.42,
    metalness: 0.62,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const rails = new THREE.InstancedMesh(geo, mat, count);
  rails.name = 'tram-rails';
  rails.castShadow = false;
  rails.receiveShadow = true;
  rails.frustumCulled = false;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  let k = 0;
  for (const L of lines) {
    for (let i = 1; i < L.xs.length; i++) {
      const ax = L.xs[i - 1];
      const az = L.zs[i - 1];
      const bx = L.xs[i];
      const bz = L.zs[i];
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) continue;
      const nx = dz / len; // segment right-hand normal
      const nz = -dx / len;
      const y0 = (L.ys[i - 1] + L.ys[i]) * 0.5;
      e.set(0, Math.atan2(dx, dz), 0, 'YXZ');
      q.setFromEuler(e);
      sc.set(RW, RH, len + RW);
      for (const sgn of [-1, 1]) {
        p.set((ax + bx) * 0.5 + nx * gauge * 0.5 * sgn, y0 + RH * 0.5 + 0.02, (az + bz) * 0.5 + nz * gauge * 0.5 * sgn);
        m.compose(p, q, sc);
        rails.setMatrixAt(k++, m);
      }
    }
  }
  rails.count = k;
  rails.instanceMatrix.needsUpdate = true;
  return rails;
}

export function buildTrams({ project, heightAt, mobile, lite }) {
  const cfg = LIFE?.trams;
  // routes: either a bare [[lat, lon], ...] polyline (older data) or
  // { id, name, colour, points } (the real STCP lines in data/life.json)
  const routes = (cfg?.routes || [])
    .map((r, i) => (Array.isArray(r) ? { id: String(i + 1), points: r } : r))
    .filter((r) => r && Array.isArray(r.points) && r.points.length >= 2);
  if (!routes.length) return null;
  const STEP = 1.5; // world units between samples
  const lines = routes
    .map((tr) => {
      const p = tr.points.map((q) => project(q[0], q[1]));
      const xs = [];
      const zs = [];
      for (let i = 1; i < p.length; i++) {
        const a = p[i - 1];
        const b = p[i];
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / STEP));
        for (let j = i === 1 ? 0 : 1; j <= n; j++) {
          xs.push(a.x + ((b.x - a.x) * j) / n);
          zs.push(a.z + ((b.z - a.z) * j) / n);
        }
      }
      // ground height, median-smoothed so the tram does not bob per sample
      const raw = xs.map((x, i) => heightAt(x, zs[i]));
      const ys = raw.map((_, i) => {
        const w = raw.slice(Math.max(0, i - 2), i + 3).sort((m, n) => m - n);
        return w[w.length >> 1];
      });
      const cum = [0];
      for (let i = 1; i < xs.length; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
      return { id: tr.id, name: tr.name, colour: tr.colour, xs, zs, ys, cum, total: cum[cum.length - 1] };
    })
    .filter(Boolean);
  if (!lines.length) return null;

  // a few cars per line: the yellow body is shared between them, the
  // destination board carries the line's number and colour
  const perRoute = lite || mobile ? 1 : 2;
  const group = new THREE.Group();
  group.name = 'trams';

  // rails first: they never move, one static InstancedMesh follows every
  // line at ground height (no roads.json)
  const rails = buildRails(lines, cfg);
  group.add(rails);

  const bodyGeo = tramGeometry();
  const bodyMat = lifeMaterial({ roughness: 0.45, metalness: 0.2 });
  const boardGeo = new THREE.PlaneGeometry(0.46 * S, 0.5 * S);

  const speed = (cfg.speed_mps ?? 6) * S * TRAM_SPEEDUP;
  const DWELL = 6; // seconds at each terminus
  // trapezoid speed profile: 15 % accelerating, 15 % braking
  const A = 0.15;
  const profile = (x) => (x < A ? (0.5 * x * x) / (A * (1 - A)) : x < 1 - A ? (x - A / 2) / (1 - A) : 1 - (0.5 * (1 - x) * (1 - x)) / (A * (1 - A)));
  // a round trip: out, dwell, back, dwell. The eased ends round the tram's
  // path into a pill, so it slows, stops and reverses without a snap.
  function arcAt(L, t) {
    const one = L.total / speed;
    const P = 2 * (one + DWELL);
    const p = ((t % P) + P) % P;
    if (p < DWELL) return 0;
    if (p < DWELL + one) return profile((p - DWELL) / one) * L.total;
    if (p < 2 * DWELL + one) return L.total;
    return (1 - profile((p - 2 * DWELL - one) / one)) * L.total;
  }

  const cars = [];
  const boardMats = [];
  lines.forEach((L, li) => {
    const cycle = 2 * (L.total / speed + DWELL);
    const tex = boardTexture(L.id, L.colour);
    const boardMat = new THREE.MeshStandardMaterial({
      color: 0x14120f,
      roughness: 0.7,
      metalness: 0,
      map: tex,
      emissive: 0xffffff,
      emissiveMap: tex,
      emissiveIntensity: 0,
      toneMapped: false,
    });
    boardMats.push(boardMat);
    for (let k = 0; k < perRoute; k++) {
      const car = new THREE.Group();
      car.name = `tram-${L.id}`;
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.receiveShadow = true;
      car.add(body);
      const board = new THREE.Mesh(boardGeo, boardMat);
      board.position.set(0, 1.5 * S, (TRAM_M / 2 + 0.05) * S);
      car.add(board);
      group.add(car);
      cars.push({ L, car, offset: ((k + 0.5) / perRoute) * cycle + li * cycle * 0.21 });
    }
  });

  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler(0, 0, 0, 'YXZ');
  const _p = new THREE.Vector3();
  const at = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  function sample(L, s) {
    let i = 1;
    while (i < L.cum.length - 1 && L.cum[i] < s) i++;
    const u = THREE.MathUtils.clamp((s - L.cum[i - 1]) / Math.max(1e-6, L.cum[i] - L.cum[i - 1]), 0, 1);
    at.x = L.xs[i - 1] + (L.xs[i] - L.xs[i - 1]) * u;
    at.z = L.zs[i - 1] + (L.zs[i] - L.zs[i - 1]) * u;
    at.y = L.ys[i - 1] + (L.ys[i] - L.ys[i - 1]) * u;
    const dx = L.xs[i] - L.xs[i - 1];
    const dz = L.zs[i] - L.zs[i - 1];
    at.yaw = Math.atan2(dx, dz); // +z of the tram along the travel direction
    at.pitch = Math.atan2(-(L.ys[i] - L.ys[i - 1]), Math.max(1e-3, Math.hypot(dx, dz)));
    return at;
  }
  let time = -DWELL * 0.4; // first view: a tram already under way
  function update(dt, camera) {
    time += dt;
    // the destination boards light at night (LIFE_UNIFORMS is updated by
    // createLife just before this runs)
    const night = LIFE_UNIFORMS.uLifeNight.value;
    for (const bm of boardMats) bm.emissiveIntensity = Math.min(1, night * 1.6);
    const cx = camera.position.x;
    const cz = camera.position.z;
    for (let i = 0; i < cars.length; i++) {
      const tr = cars[i];
      sample(tr.L, arcAt(tr.L, time + tr.offset));
      _e.set(at.pitch, at.yaw, dt > 0 ? Math.sin(time * 1.3 + i * 2.1) * 0.012 : 0, 'YXZ');
      _q.setFromEuler(_e);
      _p.set(at.x, at.y + 0.09 * S, at.z);
      tr.car.position.copy(_p);
      tr.car.quaternion.copy(_q);
      const dx = at.x - cx;
      const dz = at.z - cz;
      tr.car.visible = dx * dx + dz * dz < 2600 * 2600;
    }
  }
  update(0, { position: new THREE.Vector3(0, 0, 0) });
  return {
    object: group,
    update,
    lines,
    stats: {
      trams: cars.length,
      routes: lines.length,
      perRoute,
      km: +(lines.reduce((s, L) => s + L.total, 0) / S / 1000).toFixed(1),
      railSegments: rails.count,
    },
  };
}

// ------------------------------------------------------------ rail
// Rolling stock on the Douro crossings (data/life.json `rail`): the Metro do
// Porto (Linha D) on the Luís I upper deck, and CP mainline trains on the
// Ponte de São João to Campanhã. A train is one rigid consist — an
// articulated 3-section metro or a locomotive + carriages — riding the real
// OSM alignment. On the bridge it holds the deck height (the landmark model's
// base + dimensions.json: 60 m Luís I upper, 66 m São João); off it, it
// follows the terrain, ramping between the two over RAIL_BLEND at the ends.
const RAIL_SPEEDUP = 2; // the map runs the service a little faster than real time
const RAIL_LIFT = 0.16; // world units the wheels sit above the deck / ground
const RAIL_BLEND = 20; // world units (80 m) to ramp from the deck to the terrain
const RAIL_SPAN_W = 20; // world units (80 m) lateral tolerance of a bridge span

// Metro do Porto LRV: a silver-white articulated three-section car with the
// operator's blue and yellow stripes and a lit window band; +z is the front.
function metroGeometry() {
  const W = 2.65;
  const SL = 10.6; // one section
  const L = SL * 3;
  const z0 = -L / 2;
  const parts = [];
  for (let c = 0; c < 3; c++) {
    const zc = z0 + SL * (c + 0.5);
    parts.push(box(W, 0.55, SL, 0, 0.25, zc, 0x2a2d30)); // skirt / bogies
    parts.push(box(W + 0.04, 1.55, SL - 0.3, 0, 0.8, zc, 0xe4e7e9)); // silver body
    parts.push(box(W + 0.1, 0.72, SL - 1.7, 0, 1.28, zc, 0x1f2a30, 1)); // lit windows
    parts.push(box(W + 0.11, 0.16, SL - 0.6, 0, 0.82, zc, 0x1f7ec2)); // blue stripe
    parts.push(box(W + 0.11, 0.12, SL - 0.6, 0, 1.02, zc, 0xf9c212)); // yellow stripe
    parts.push(box(W - 0.3, 0.22, SL - 0.7, 0, 2.42, zc, 0x9aa0a4)); // roof
  }
  // front cab: yellow end, windscreen, destination plate, twin headlights
  parts.push(box(W, 1.9, 0.55, 0, 0.7, L / 2 - 0.28, 0xf9c212));
  parts.push(box(W - 0.5, 0.95, 0.16, 0, 1.35, L / 2 + 0.02, 0x1f2a30, 1));
  parts.push(box(W - 0.9, 0.3, 0.1, 0, 1.95, L / 2 + 0.05, 0x14120f));
  parts.push(box(0.22, 0.22, 0.1, -0.85, 0.85, L / 2 + 0.07, 0xffe9b0, 1));
  parts.push(box(0.22, 0.22, 0.1, 0.85, 0.85, L / 2 + 0.07, 0xffe9b0, 1));
  // pantograph
  parts.push(box(0.1, 0.95, 0.1, 0, 2.55, -1.5, 0x3a3f42));
  parts.push(box(1.5, 0.08, 0.08, 0, 3.5, -1.5, 0x3a3f42));
  // door leaves between the sections, a lit line-D board and a roof AC unit
  for (let c = 0; c < 3; c++) {
    const zc = z0 + SL * (c + 0.5);
    for (const sgn of [-1, 1]) {
      parts.push(box(0.06, 1.35, 1.15, sgn * (W / 2 + 0.03), 0.9, zc - SL / 2 + 1.9, 0x39424a));
      parts.push(box(0.06, 1.35, 1.15, sgn * (W / 2 + 0.03), 0.9, zc + SL / 2 - 1.9, 0x39424a));
    }
  }
  parts.push(box(W - 0.95, 0.12, 0.12, 0, 1.78, L / 2 + 0.07, 0xf9c212, 1));
  parts.push(box(W - 1.4, 0.26, 0.5, 0, 2.42, -L / 2 + 3.0, 0x8a9095));
  // the LRV is double-ended: a rear cab in yellow
  parts.push(box(W, 1.9, 0.55, 0, 0.7, -L / 2 + 0.28, 0xf9c212));
  parts.push(box(W - 0.5, 0.95, 0.16, 0, 1.35, -L / 2 - 0.02, 0x1f2a30, 1));
  parts.push(box(W - 0.9, 0.3, 0.1, 0, 1.95, -L / 2 - 0.05, 0x14120f));
  const g = mergeGeometries(parts);
  g.userData.lengthM = L;
  g.scale(S, S, S);
  return g;
}

// CP Urbanos do Porto: a green-and-white electric multiple unit (no separate
// locomotive), the suburban service over the São João. +z is the front.
function urbanoGeometry(cars = 3) {
  const W = 2.9;
  const CAR = 24;
  const L = cars * CAR;
  const parts = [];
  for (let c = 0; c < cars; c++) {
    const zc = L / 2 - CAR * (c + 0.5);
    parts.push(box(W, 0.5, CAR, 0, 0.25, zc, 0x1b1e21)); // skirt
    parts.push(box(W, 1.7, CAR - 0.5, 0, 0.75, zc, 0xf0f1f2)); // white body
    parts.push(box(W + 0.06, 0.72, CAR - 2.6, 0, 1.35, zc, 0x1f2a30, 1)); // windows
    parts.push(box(W + 0.07, 0.34, CAR - 0.6, 0, 0.55, zc, 0x2e8b57)); // green band
    parts.push(box(W - 0.22, 0.22, CAR - 1.2, 0, 2.5, zc, 0x9aa0a4)); // roof
    for (const sgn of [-1, 1]) {
      parts.push(box(0.06, 1.4, 1.1, sgn * (W / 2 + 0.03), 0.85, zc - CAR / 2 + 3.0, 0x39424a));
      parts.push(box(0.06, 1.4, 1.1, sgn * (W / 2 + 0.03), 0.85, zc + CAR / 2 - 3.0, 0x39424a));
    }
  }
  // cab at the +z end: face, glazing, lit destination and headlights
  parts.push(box(W, 1.85, 0.5, 0, 0.7, L / 2 - 0.25, 0xf0f1f2));
  parts.push(box(W - 0.4, 0.9, 0.14, 0, 1.35, L / 2 + 0.04, 0x1f2a30, 1));
  parts.push(box(W - 0.8, 0.32, 0.1, 0, 1.98, L / 2 + 0.07, 0x14120f));
  parts.push(box(W - 0.8, 0.1, 0.12, 0, 2.16, L / 2 + 0.08, 0x2e8b57, 1));
  parts.push(box(0.22, 0.22, 0.1, -0.9, 0.8, L / 2 + 0.09, 0xffe9b0, 1));
  parts.push(box(0.22, 0.22, 0.1, 0.9, 0.8, L / 2 + 0.09, 0xffe9b0, 1));
  // pantograph on the middle car
  parts.push(box(0.1, 0.95, 0.1, 0, 2.62, 0, 0x3a3f42));
  parts.push(box(1.5, 0.08, 0.08, 0, 3.58, 0, 0x3a3f42));
  const g = mergeGeometries(parts);
  g.userData.lengthM = L;
  g.scale(S, S, S);
  return g;
}

// CP mainline: a white-and-red locomotive + carriages; +z is the front.
function mainlineGeometry(cars = 4) {
  const W = 2.9;
  const LOCO = 19;
  const CAR = 26;
  const L = LOCO + cars * CAR;
  const parts = [];
  const lz = L / 2 - LOCO / 2; // locomotive at the front (+z)
  parts.push(box(W, 0.5, LOCO, 0, 0.25, lz, 0x1b1e21));
  parts.push(box(W, 1.7, LOCO - 0.6, 0, 0.75, lz, 0xf0f1f2));
  parts.push(box(W + 0.06, 0.68, LOCO - 3.2, 0, 1.35, lz, 0x1f2a30, 1)); // windows
  parts.push(box(W + 0.07, 0.32, LOCO - 0.6, 0, 0.55, lz, 0xc0392b)); // red band
  parts.push(box(W - 0.2, 0.22, LOCO - 1.2, 0, 2.55, lz, 0x9aa0a4)); // roof
  parts.push(box(W, 1.95, 0.45, 0, 0.7, L / 2 - 0.2, 0xf0f1f2)); // cab face
  parts.push(box(W - 0.35, 0.95, 0.14, 0, 1.35, L / 2 + 0.06, 0x1f2a30, 1));
  parts.push(box(0.26, 0.26, 0.1, -0.95, 0.8, L / 2 + 0.1, 0xffe9b0, 1)); // headlights
  parts.push(box(0.26, 0.26, 0.1, 0.95, 0.8, L / 2 + 0.1, 0xffe9b0, 1));
  for (let c = 0; c < cars; c++) {
    const zc = L / 2 - LOCO - CAR * (c + 0.5);
    parts.push(box(W, 0.5, CAR, 0, 0.25, zc, 0x1b1e21));
    parts.push(box(W, 1.65, CAR - 0.8, 0, 0.75, zc, 0xf0f1f2));
    parts.push(box(W + 0.06, 0.72, CAR - 2.8, 0, 1.35, zc, 0x1f2a30, 1));
    parts.push(box(W + 0.07, 0.3, CAR - 0.8, 0, 0.55, zc, 0xc0392b));
    parts.push(box(W - 0.25, 0.22, CAR - 1.4, 0, 2.5, zc, 0x9aa0a4));
  }
  // pantograph on the locomotive roof, a lit destination board and the mark
  parts.push(box(0.1, 1.0, 0.1, 0, 2.62, lz, 0x3a3f42));
  parts.push(box(1.6, 0.08, 0.08, 0, 3.72, lz, 0x3a3f42));
  parts.push(box(1.6, 0.06, 0.06, 0, 3.25, lz + 0.5, 0x3a3f42));
  parts.push(box(1.7, 0.32, 0.12, 0, 1.95, L / 2 + 0.06, 0x14120f));
  parts.push(box(1.7, 0.1, 0.14, 0, 2.14, L / 2 + 0.07, 0xc0392b, 1));
  parts.push(box(0.9, 0.3, 0.06, -W / 2 + 0.05, 1.0, lz, 0xc0392b));
  const g = mergeGeometries(parts);
  g.userData.lengthM = L;
  g.scale(S, S, S);
  return g;
}

export function buildTrains({ project, heightAt, items = [], mobile = false, lite = false }) {
  const cfg = LIFE?.rail;
  const list = (cfg?.items || []).filter((it) => Array.isArray(it.path) && it.path.length >= 2);
  if (!list.length) return null;

  // the bridge deck of a service: the landmark model's base plus the real
  // deck height above it, and the model's world footprint plus the OSM bridge
  // span (the train stays at deck height anywhere inside either — the
  // flattened bridge pad cannot pull it down, and the span covers the
  // viaduct where it runs past the model box) — see fit.js (top of the Luís I
  // deck is +60 m, São João +66 m).
  function bridgeOf(it) {
    const site = it.bridge?.site;
    const item = site ? items.find((q) => q.data.id === site) : null;
    const mesh = item?.meshes?.[0];
    const bb = mesh?.geometry?.boundingBox;
    if (!mesh || !bb || !(it.bridge?.deck_m > 0)) return null;
    const span = Array.isArray(it.bridge.span) && it.bridge.span.length === 2
      ? it.bridge.span.map((q) => project(q[0], q[1]))
      : null;
    return {
      y: mesh.position.y + it.bridge.deck_m * S,
      minX: mesh.position.x + bb.min.x,
      maxX: mesh.position.x + bb.max.x,
      minZ: mesh.position.z + bb.min.z,
      maxZ: mesh.position.z + bb.max.z,
      span,
    };
  }

  const STEP = 1.5; // world units between samples
  const lines = list.map((it) => {
    const p = it.path.map((q) => project(q[0], q[1]));
    const xs = [];
    const zs = [];
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1];
      const b = p[i];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / STEP));
      for (let j = i === 1 ? 0 : 1; j <= n; j++) {
        xs.push(a.x + ((b.x - a.x) * j) / n);
        zs.push(a.z + ((b.z - a.z) * j) / n);
      }
    }
    // terrain, median-smoothed so the train does not bob per sample
    const raw = xs.map((x, i) => heightAt(x, zs[i]));
    const terrain = raw.map((_, i) => {
      const w = raw.slice(Math.max(0, i - 2), i + 3).sort((m, n) => m - n);
      return w[w.length >> 1];
    });
    const deck = bridgeOf(it);
    const ys = terrain.map((g, i) => {
      if (!deck) return g;
      const x = xs[i];
      const z = zs[i];
      const dBox = Math.max(0, deck.minX - x, x - deck.maxX, deck.minZ - z, z - deck.maxZ);
      let w = dBox <= 0 ? 1 : Math.max(0, 1 - dBox / RAIL_BLEND);
      if (deck.span && w < 1) {
        // distance to the OSM bridge span segment, so the deck covers the
        // whole viaduct even where it runs past the landmark model's box
        const [a, b] = deck.span;
        const vx = b.x - a.x;
        const vz = b.z - a.z;
        const l2 = vx * vx + vz * vz;
        if (l2 > 1e-6) {
          const tp = ((x - a.x) * vx + (z - a.z) * vz) / l2;
          const tc = Math.max(0, Math.min(1, tp));
          const along = tp < 0 ? -tp * Math.sqrt(l2) : tp > 1 ? (tp - 1) * Math.sqrt(l2) : 0;
          const lat = Math.max(0, Math.hypot(x - (a.x + tc * vx), z - (a.z + tc * vz)) - RAIL_SPAN_W);
          const dd = Math.hypot(along, lat);
          const ws = dd <= 0 ? 1 : Math.max(0, 1 - dd / RAIL_BLEND);
          if (ws > w) w = ws;
        }
      }
      return g + (deck.y - g) * w;
    });
    const cum = [0];
    for (let i = 1; i < xs.length; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
    return { item: it, xs, zs, ys, cum, total: cum[cum.length - 1], deck: !!deck };
  }).filter((L) => L.total > 1);
  if (!lines.length) return null;

  const group = new THREE.Group();
  group.name = 'rail';
  const mat = lifeMaterial({ roughness: 0.42, metalness: 0.28 });
  const speedK = RAIL_SPEEDUP;
  // trapezoid speed profile: 15 % accelerating, 15 % braking (as the trams)
  const A = 0.15;
  const profile = (x) => (x < A ? (0.5 * x * x) / (A * (1 - A)) : x < 1 - A ? (x - A / 2) / (1 - A) : 1 - (0.5 * (1 - x) * (1 - x)) / (A * (1 - A)));

  const meshes = [];
  const trains = [];
  let tris = 0;
  lines.forEach((L, li) => {
    const it = L.item;
    const service = it.service;
    const geo = service === 'metro' ? metroGeometry() : service === 'urbano' ? urbanoGeometry(it.cars ?? 3) : mainlineGeometry(it.cars ?? 4);
    const want = it.count ?? 1;
    const n = lite || mobile ? 1 : want;
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.name = `rail-${it.id}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // culled per line below
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
    meshes.push(mesh);
    const verts = geo.index ? geo.index.count : geo.attributes.position.count;
    tris += (verts / 3) * n;
    const half = ((geo.userData.lengthM ?? 0) * S) / 2 + 0.4;
    const one = Math.max(1e-3, (L.total - 2 * half) / (Math.max(0.5, it.speed_mps ?? 12) * S * speedK));
    for (let k = 0; k < n; k++) {
      trains.push({ L, mesh, slot: k, half, one, offset: ((k + (li ? 0.35 : 0)) / n) * 2 * one });
    }
    L.mid = [L.xs[L.xs.length >> 1], L.zs[L.zs.length >> 1]];
    L.visible = true;
  });

  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler(0, 0, 0, 'YXZ');
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3(1, 1, 1);
  const _m = new THREE.Matrix4();
  const at = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  function heightOn(L, s) {
    let i = 1;
    while (i < L.cum.length - 1 && L.cum[i] < s) i++;
    const u = THREE.MathUtils.clamp((s - L.cum[i - 1]) / Math.max(1e-6, L.cum[i] - L.cum[i - 1]), 0, 1);
    return L.ys[i - 1] + (L.ys[i] - L.ys[i - 1]) * u;
  }
  function sample(L, s) {
    let i = 1;
    while (i < L.cum.length - 1 && L.cum[i] < s) i++;
    const u = THREE.MathUtils.clamp((s - L.cum[i - 1]) / Math.max(1e-6, L.cum[i] - L.cum[i - 1]), 0, 1);
    at.x = L.xs[i - 1] + (L.xs[i] - L.xs[i - 1]) * u;
    at.z = L.zs[i - 1] + (L.zs[i] - L.zs[i - 1]) * u;
    at.y = L.ys[i - 1] + (L.ys[i] - L.ys[i - 1]) * u;
    const dx = L.xs[i] - L.xs[i - 1];
    const dz = L.zs[i] - L.zs[i - 1];
    at.yaw = Math.atan2(dx, dz); // +z of the consist along the travel direction
    at.pitch = Math.atan2(-(L.ys[i] - L.ys[i - 1]), Math.max(1e-3, Math.hypot(dx, dz)));
    return at;
  }
  // ping-pong along the line, inset by the consist's half-length
  function arcAt(T, tt) {
    const one = T.one;
    const p = ((tt % (2 * one)) + 2 * one) % (2 * one);
    const span = T.L.total - 2 * T.half;
    if (p < one) return T.half + profile(p / one) * span;
    return T.half + (1 - profile((p - one) / one)) * span;
  }
  let time = 0;
  function place(T, s) {
    sample(T.L, s);
    // slope over the consist's length, so it does not rock per sample
    const s0 = Math.max(0, s - T.half);
    const s1 = Math.min(T.L.total, s + T.half);
    at.pitch = Math.atan2(-(heightOn(T.L, s1) - heightOn(T.L, s0)), Math.max(1e-3, s1 - s0));
    _e.set(at.pitch, at.yaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(at.x, at.y + RAIL_LIFT, at.z);
    _m.compose(_p, _q, _s);
    T.mesh.setMatrixAt(T.slot, _m);
  }
  function update(dt, camera) {
    time += dt;
    const cx = camera?.position.x ?? 0;
    const cz = camera?.position.z ?? 0;
    for (const L of lines) {
      const dx = L.mid[0] - cx;
      const dz = L.mid[1] - cz;
      L.visible = !camera || dx * dx + dz * dz < 2600 * 2600;
    }
    for (const T of trains) {
      T.mesh.visible = T.L.visible;
      if (!T.L.visible) continue;
      place(T, arcAt(T, time + T.offset));
      T.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  update(0, { position: new THREE.Vector3(0, 0, 0) });
  return {
    object: group,
    update,
    lines,
    stats: {
      trains: trains.length,
      services: lines.length,
      metro: lines.filter((L) => L.item.service === 'metro').length,
      mainline: lines.filter((L) => L.item.service === 'mainline').length,
      urbano: lines.filter((L) => L.item.service === 'urbano').length,
      km: +(lines.reduce((s, L) => s + L.total, 0) / S / 1000).toFixed(1),
      onDeck: lines.filter((L) => L.deck).length,
      triangles: Math.round(tris),
    },
    // tests: the world position of the first consist of a service
    position(id = 'metro-d') {
      const t = trains.find((T) => T.L.item.id === id);
      if (!t) return null;
      place(t, arcAt(t, time + t.offset));
      return { x: at.x, y: at.y, z: at.z, deck: t.L.deck };
    },
  };
}

// ------------------------------------------------------------ cable car
function cabinGeometry() {  // a red Gaia gondola: cabin, lit window band, roof, hanger arm and grip
  const parts = [
    box(2.2, 1.9, 2.4, 0, 0, 0, 0xc0392b),
    box(2.26, 0.75, 2.46, 0, 0.85, 0, 0x1f2a30, 1),
    box(2.32, 0.18, 2.52, 0, 1.9, 0, 0x9c2d22),
    box(0.12, 0.95, 0.12, 0, 2.08, 0, 0x3a3f42),
    box(1.7, 0.14, 0.55, 0, 3.0, 0, 0x3a3f42),
  ];
  const g = mergeGeometries(parts);
  g.scale(S, S, S);
  return g;
}

export function buildCableCar({ project, heightAt, mobile, lite }) {
  const cfg = LIFE?.cablecar;
  const st = cfg?.stations;
  if (!Array.isArray(st) || st.length < 2) return null;
  const lo = project(st[0][0], st[0][1]);
  const up = project(st[1][0], st[1][1]);
  const DECK = 5 * S; // station deck above the ground
  const a = new THREE.Vector3(lo.x, heightAt(lo.x, lo.z) + DECK, lo.z);
  const b = new THREE.Vector3(up.x, heightAt(up.x, up.z) + DECK, up.z);
  const span = Math.max(1e-3, a.distanceTo(b));
  const yaw = Math.atan2(b.x - a.x, b.z - a.z);
  const sag = span * 0.03;

  const group = new THREE.Group();
  group.name = 'cablecar';

  // stations: a hall, a canopy, a glazed control box and a small tower
  const stGeo = mergeGeometries([
    box(8, 4.6, 10, 0, 0, 0, 0xb7b0a4),
    box(8.8, 0.35, 11, 0, 4.6, 0, 0x6a6459),
    box(3.2, 3.4, 3.2, 0, 0, 0, 0x28323a, 1),
    box(1.2, 6, 1.2, -3, 0, -4, 0x8f887d),
  ]);
  stGeo.scale(S, S, S);
  const stMat = lifeMaterial({ roughness: 0.8 });
  for (const p of [a, b]) {
    const m = new THREE.Mesh(stGeo, stMat);
    m.position.set(p.x, p.y - DECK, p.z);
    m.rotation.y = yaw;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  // the two haul ropes, with a little catenary sag
  const side = { x: -(b.z - a.z) / span, z: (b.x - a.x) / span };
  const ropePts = (sgn) => {
    const arm = 1.3 * S * sgn;
    const out = [];
    for (let i = 0; i <= 24; i++) {
      const s = i / 24;
      out.push(
        new THREE.Vector3(
          a.x + (b.x - a.x) * s + side.x * arm,
          a.y + (b.y - a.y) * s - sag * Math.sin(Math.PI * s),
          a.z + (b.z - a.z) * s + side.z * arm,
        ),
      );
    }
    return out;
  };
  const ropeMat = new THREE.LineBasicMaterial({ color: 0x2a2f33 });
  for (const sgn of [-1, 1]) {
    const rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ropePts(sgn)), ropeMat);
    rope.name = 'cablecar-rope';
    group.add(rope);
  }

  const COUNT = lite ? 2 : cfg.cabins ?? (mobile ? 4 : 6);
  const cab = new THREE.InstancedMesh(cabinGeometry(), lifeMaterial({ roughness: 0.5 }), COUNT);
  cab.name = 'cablecar-cabins';
  cab.castShadow = false;
  cab.frustumCulled = false;
  cab.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(cab);

  const HANG = 3.0 * S; // the grip sits 3 m above the cabin base
  const oneWay = ((cfg.period ?? 20) * COUNT) / 2; // a cabin passes every `period` s
  const mid = new THREE.Vector3().lerpVectors(a, b, 0.5);
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler(0, 0, 0, 'YXZ');
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3(1, 1, 1);
  const _m = new THREE.Matrix4();
  let time = 0;
  function update(dt, camera) {
    time += dt;
    const hidden = camera.position.distanceToSquared(_p.set(mid.x, mid.y, mid.z)) > 2600 * 2600;
    group.visible = !hidden;
    if (hidden) return;
    for (let i = 0; i < COUNT; i++) {
      const ph = (((time / oneWay + i / COUNT) % 2) + 2) % 2;
      const s = ph < 1 ? ph : 2 - ph; // ping-pong: lower <-> upper
      const sgn = i % 2 ? 1 : -1; // one direction per rope
      const arm = 1.3 * S * sgn;
      _p.set(
        a.x + (b.x - a.x) * s + side.x * arm,
        a.y + (b.y - a.y) * s - sag * Math.sin(Math.PI * s) - HANG,
        a.z + (b.z - a.z) * s + side.z * arm,
      );
      const sway = 0.05 * Math.sin(time * 0.9 + i * 1.7);
      _e.set(sway * 0.5, yaw, sway, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_p, _q, _s);
      cab.setMatrixAt(i, _m);
    }
    cab.instanceMatrix.needsUpdate = true;
  }
  update(0, { position: new THREE.Vector3(mid.x, mid.y, mid.z) });
  return {
    object: group,
    update,
    stats: { cabins: COUNT, spanM: Math.round(span / S), gainM: Math.round((b.y - a.y) / S) },
  };
}

// ------------------------------------------------------------ boats
// The Douro at Porto: rabelo boats (flat-bottomed, port casks, square sail),
// Douro cruisers / barco-hotels and the small Gaia <-> Ribeira ferry, each
// following an ordered path over the water with a fading wake. data/life.json
// `boats` (scripts/fetch-life.mjs).
//
// The water surface is draped on the terrain (water.js, which reads
// heightAt), and the open river is kind 1 ("tidal": not a ribbon), so its
// mesh rides at heightAt + LIFT * 0.7. Boats are placed on the same level and
// let the hull sit below the waterline.
const WATER_LIFT = 0.196; // world units (0.78 m); water.js LIFT * 0.7

// Like box(), but a cylinder: centre at (x, y, z), axis +y unless rotated.
function cyl(r, h, seg, x, y, z, color, glow = 0, rz = 0, rx = 0) {
  const g = new THREE.CylinderGeometry(r, r, h, seg).toNonIndexed();
  if (rz) g.rotateZ(rz);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  const col = new THREE.Color(color);
  for (let i = 0; i < n; i++) col.toArray(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
  g.deleteAttribute('uv');
  return g;
}

// A rabelo: flat-bottomed oak hull with raised prow and stern (the
// meia-lua), a deck of port casks, a single mast and a square sail held to a
// yard. `sail` false furls it along the yard. +z is the bow; metres.
function rabeloGeometry(sail = true) {
  const W = 4.4;
  const L = 19;
  const parts = [
    box(W - 0.6, 0.5, L - 1.4, 0, -0.95, 0, 0x4a3220), // flat keel
    box(0.4, 1.5, L, -W / 2 + 0.2, -0.95, 0, 0x6b4a2f), // port strake
    box(0.4, 1.5, L, W / 2 - 0.2, -0.95, 0, 0x6b4a2f), // starboard strake
    box(W, 1.5, 1.0, 0, -0.95, L / 2 - 0.5, 0x5b3d27), // transom, bow
    box(W, 1.5, 1.0, 0, -0.95, -L / 2 + 0.5, 0x5b3d27), // transom, stern
    box(W, 0.8, 3.2, 0, 0.15, L / 2 - 1.6, 0x6b4a2f), // raised prow
    box(W, 0.7, 2.8, 0, 0.15, -L / 2 + 1.4, 0x6b4a2f), // raised stern
    box(W - 0.5, 0.16, L - 1.0, 0, 0.5, 0, 0x8a6440), // deck
    box(0.22, 0.22, L, -W / 2 + 0.15, 0.66, 0, 0x3a2a1c), // gunwale
    box(0.22, 0.22, L, W / 2 - 0.15, 0.66, 0, 0x3a2a1c),
    cyl(0.15, 11.4, 7, 0, 6.0, -0.6, 0x6b4a2f), // mast
    box(0.12, 0.12, 6.6, 0, 9.8, -0.6, 0x5b3d27), // yard
    box(0.16, 0.16, 4.8, W / 2 - 0.5, 0.9, -L / 2 - 1.3, 0x5b3d27), // steering oar
    box(3.0, 0.5, 0.5, 0, -0.1, L / 2 - 0.1, 0x3a2a1c), // small foredeck box
  ];
  // port casks, lying along x in two rows of four, oak and darker cooperage
  for (let i = 0; i < 4; i++) {
    const z = -3.3 + i * 2.0;
    const tone = i % 2 ? 0x7a4a28 : 0x8a5a34;
    parts.push(cyl(0.42, 1.05, 8, -0.85, 1.18, z, tone, 0, Math.PI / 2));
    parts.push(cyl(0.42, 1.05, 8, 0.85, 1.18, z, tone, 0, Math.PI / 2));
  }
  // a pair lashed on top amidships
  parts.push(cyl(0.42, 1.05, 8, 0, 2.26, -0.4, 0x6f4224, 0, Math.PI / 2));
  parts.push(cyl(0.42, 1.05, 8, 0, 2.26, 0.7, 0x6f4224, 0, Math.PI / 2));
  // crew: the helmsman aft and one forward, workwear with bare heads
  parts.push(cyl(0.23, 1.02, 6, 0.55, 1.09, -L / 2 + 1.1, 0x2f3b4c));
  parts.push(cyl(0.17, 0.3, 6, 0.55, 1.75, -L / 2 + 1.1, 0xd8b48c));
  parts.push(cyl(0.23, 1.02, 6, -0.7, 1.09, L / 2 - 2.1, 0x6b3b2a));
  parts.push(cyl(0.17, 0.3, 6, -0.7, 1.75, L / 2 - 2.1, 0xd8b48c));
  if (sail) {
    parts.push(box(6.4, 7.0, 0.08, 0, 2.7, -0.5, 0xd9cdb0)); // square sail
    // the cross of the rabelo canvas, proud of both faces
    parts.push(box(0.62, 7.0, 0.14, 0, 2.7, -0.5, 0xb03a2e));
    parts.push(box(6.4, 0.62, 0.14, 0, 3.4, -0.5, 0xb03a2e));
  } else {
    parts.push(box(6.8, 0.5, 0.5, 0, 9.55, -0.6, 0xd9cdb0)); // furled along the yard
  }
  const g = mergeGeometries(parts);
  g.scale(S, S, S);
  return g;
}

// A Douro cruiser / barco-hotel: long, low, white, a lit window band, a
// sun deck, wheelhouse and funnel. +z is the bow; metres.
function cruiserGeometry() {
  const W = 7;
  const L = 36;
  const parts = [
    box(W, 1.6, L, 0, -0.9, 0, 0x2b3a44), // lower hull
    box(W - 0.3, 1.3, L - 1.2, 0, 0.5, 0, 0xf1f1ee), // white topside
    box(W - 0.5, 1.1, L - 4.0, 0, 1.55, 0.4, 0x223039, 1), // lit window band
    box(W - 1.4, 0.35, L - 8.0, 0, 2.65, -0.6, 0xf1f1ee), // sun deck
    box(5.0, 1.5, 6.5, 0, 3.0, 4.0, 0xf1f1ee), // wheelhouse
    box(4.9, 0.8, 6.0, 0, 3.9, 4.0, 0x223039, 1), // bridge glazing
    cyl(0.9, 2.6, 10, 0, 4.4, -5.5, 0xe8e4da), // funnel
    cyl(0.1, 6.4, 6, 0, 3.2, -12.0, 0xcfcabf), // foremast
    box(0.1, 0.1, 3.0, 0, 8.3, -12.0, 0xcfcabf), // radar bar
  ];
  // rails round the sun deck, lifebuoys on the cabin and the ensign aft
  for (const sgn of [-1, 1]) parts.push(box(0.09, 0.5, L - 8.5, sgn * (W / 2 - 0.75), 2.98, -0.6, 0xcfcabf));
  parts.push(box(W - 1.5, 0.5, 0.09, 0, 2.98, -14.5, 0xcfcabf));
  parts.push(box(W - 1.5, 0.5, 0.09, 0, 2.98, 13.3, 0xcfcabf));
  parts.push(cyl(0.34, 0.1, 8, -W / 2 + 0.28, 1.6, 3.0, 0xe86a2a, 0, Math.PI / 2)); // lifebuoy
  parts.push(cyl(0.34, 0.1, 8, W / 2 - 0.28, 1.6, 3.0, 0xe86a2a, 0, Math.PI / 2));
  parts.push(box(0.08, 0.7, 1.1, 0, 4.55, -L / 2 + 0.9, 0x187ec2)); // ensign
  parts.push(box(2.2, 0.24, 0.12, 0, 2.05, L / 2 - 0.35, 0x14120f)); // name board
  const g = mergeGeometries(parts);
  g.scale(S, S, S);
  return g;
}

// The Gaia <-> Ribeira ferry: a small blue-and-white launch with a lit cabin.
function ferryGeometry() {
  const W = 4.2;
  const L = 12;
  const parts = [
    box(W, 1.1, L, 0, -0.7, 0, 0x1d3a55), // lower hull
    box(W - 0.3, 1.0, L - 0.8, 0, 0.4, 0, 0xf1f1ee), // topside
    box(W - 0.6, 1.1, 6.5, 0, 1.2, 0.3, 0xece6d8), // cabin
    box(W - 0.7, 0.7, 5.8, 0, 2.0, 0.3, 0x223039, 1), // window band
    box(W - 0.2, 0.18, 7.4, 0, 2.7, 0.3, 0xf1f1ee), // cabin roof
    cyl(0.06, 3.2, 5, 0, 3.4, -3.2, 0xcfcabf), // mast
  ];
  // wheelhouse glazing, rails, a lifebuoy and the flag
  parts.push(box(W - 1.7, 0.62, 0.12, 0, 1.95, 2.45, 0x2a3a44, 1));
  for (const sgn of [-1, 1]) parts.push(box(0.07, 0.42, 7.5, sgn * (W / 2 - 0.35), 2.88, 0.3, 0xcfcabf));
  parts.push(box(W - 1.0, 0.42, 0.07, 0, 2.88, -3.35, 0xcfcabf));
  parts.push(cyl(0.24, 0.08, 8, -W / 2 + 0.22, 1.7, 1.6, 0xe86a2a, 0, Math.PI / 2));
  parts.push(box(0.07, 0.55, 0.9, 0, 3.9, -4.1, 0x187ec2));
  const g = mergeGeometries(parts);
  g.scale(S, S, S);
  return g;
}

// A Douro barco-hotel: a long three-deck river cruise ship, white with two lit
// cabin bands, a sun deck, lifeboats and a wheelhouse. +z is the bow; metres.
function hotelGeometry() {
  const W = 11;
  const L = 78;
  const parts = [
    box(W, 1.8, L, 0, -1.0, 0, 0x233038), // lower hull
    box(W - 0.4, 1.4, L - 1.4, 0, 0.7, 0, 0xf2f1ec), // hull topside
    box(W - 0.8, 2.2, L - 3, 0, 2.0, 0, 0xf2f1ec), // deck 1
    box(W - 0.5, 1.0, L - 7, 0, 2.2, -0.5, 0x25313a, 1), // deck 1 windows
    box(W - 1.7, 2.0, L - 9, 0, 4.0, -0.9, 0xf2f1ec), // deck 2
    box(W - 1.4, 0.9, L - 12, 0, 4.3, -1.3, 0x25313a, 1), // deck 2 windows
    box(W - 3.2, 0.3, L - 16, 0, 6.0, -1.8, 0xe6e2d8), // sun deck
    box(W - 3.4, 1.7, 7.0, 0, 6.3, L / 2 - 5.5, 0xf2f1ec), // wheelhouse
    box(W - 3.3, 0.8, 6.4, 0, 7.0, L / 2 - 5.5, 0x25313a, 1), // bridge glazing
    cyl(1.05, 2.6, 10, 0, 7.0, -L / 2 + 11, 0xd8d3c8), // funnel
    cyl(0.12, 6.0, 6, 0, 7.6, L / 2 - 12, 0xcfcabf), // foremast
    box(0.1, 0.1, 3.2, 0, 10.3, L / 2 - 12, 0xcfcabf), // radar bar
    box(2.6, 0.6, 0.12, 0, 2.55, L / 2 - 0.4, 0x14120f), // name board
    box(0.1, 0.9, 1.4, 0, 6.1, -L / 2 + 1.6, 0x187ec2), // ensign
  ];
  for (const sgn of [-1, 1]) {
    parts.push(box(0.08, 0.5, L - 16, sgn * (W / 2 - 1.7), 6.3, -1.8, 0xd9d4c8)); // sun-deck rails
    // a row of lifeboats along the deck-1 casing
    for (let i = -1; i <= 1; i++) parts.push(box(1.1, 0.5, 3.2, sgn * (W / 2 - 0.9), 3.5, i * 14 - 3, 0xf0c04a));
  }
  const g = mergeGeometries(parts);
  g.scale(S, S, S);
  return g;
}

export function buildBoats({ project, heightAt, mobile = false, lite = false, camera }) {
  const cfg = LIFE?.boats;
  const items = cfg?.items;
  const mooredList = cfg?.moored || [];
  if (!Array.isArray(items) || !items.length) return null;
  const TYPES = ['rabelo', 'cruiser', 'ferry', 'hotel'];

  // ---- the paths, subdivided and draped on the terrain (as trams)
  const STEP = 1.5; // world units between samples
  function buildLine(path) {
    const p = path.map((q) => project(q[0], q[1]));
    const xs = [];
    const zs = [];
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1];
      const b = p[i];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / STEP));
      for (let j = i === 1 ? 0 : 1; j <= n; j++) {
        xs.push(a.x + ((b.x - a.x) * j) / n);
        zs.push(a.z + ((b.z - a.z) * j) / n);
      }
    }
    const raw = xs.map((x, i) => heightAt(x, zs[i]) + WATER_LIFT);
    const ys = raw.map((_, i) => {
      const w = raw.slice(Math.max(0, i - 2), i + 3).sort((m, n) => m - n);
      return w[w.length >> 1];
    });
    const cum = [0];
    for (let i = 1; i < xs.length; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
    return { xs, zs, ys, cum, total: cum[cum.length - 1] };
  }

  const geoKey = (type, sail) => (type === 'rabelo' ? (sail ? 'rabelo-sail' : 'rabelo-bare') : type);
  const geoCache = new Map();
  function geoFor(key) {
    if (!geoCache.has(key)) {
      geoCache.set(
        key,
        key === 'rabelo-sail'
          ? rabeloGeometry(true)
          : key === 'rabelo-bare'
            ? rabeloGeometry(false)
            : key === 'cruiser'
              ? cruiserGeometry()
              : key === 'hotel'
                ? hotelGeometry()
                : ferryGeometry(),
      );
    }
    return geoCache.get(key);
  }

  // ---- actors: moving boats (path) and moored boats (fixed)
  const actors = [];
  items.forEach((it, i) => {
    const type = TYPES.includes(it.type) ? it.type : 'rabelo';
    const sail = type === 'rabelo' ? it.sail !== false : false;
    actors.push({
      moving: true,
      type,
      sail,
      line: buildLine(it.path),
      speed: Math.max(0.5, (it.speed_mps ?? 3) * S),
      phase: Number.isFinite(it.phase) ? it.phase : (i * 0.37) % 1,
      meshKey: geoKey(type, sail),
    });
  });
  mooredList.forEach((m) => {
    const type = TYPES.includes(m.type) ? m.type : 'rabelo';
    const sail = m.sail === true;
    const w = project(m.p[0], m.p[1]);
    actors.push({
      moving: false,
      type,
      sail,
      x: w.x,
      z: w.z,
      y: heightAt(w.x, w.z) + WATER_LIFT,
      yaw: ((m.yaw ?? 90) * Math.PI) / 180,
      meshKey: geoKey(type, sail),
    });
  });

  // ---- one InstancedMesh per geometry variant
  const mat = lifeMaterial({ roughness: 0.55, metalness: 0.1 });
  const group = new THREE.Group();
  group.name = 'boats';
  const meshes = [];
  const byKey = new Map();
  for (const a of actors) {
    if (!byKey.has(a.meshKey)) byKey.set(a.meshKey, []);
    byKey.get(a.meshKey).push(a);
  }
  const tris = {};
  for (const [key, list] of byKey) {
    const geo = geoFor(key);
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    mesh.name = `boats-${key}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    list.forEach((a, i) => {
      a.mesh = mesh;
      a.slot = i;
    });
    tris[key] = ((geo.index ? geo.index.count : geo.attributes.position.count) / 3) * list.length;
    group.add(mesh);
    meshes.push(mesh);
  }

  // ---- wakes: one fading, widening ribbon behind each moving boat
  const movers = actors.filter((a) => a.moving);
  const WAKE = lite ? 6 : mobile ? 9 : 14;
  const WAKE_STEP = 2.4; // world units (9.6 m) between trail samples
  const wakeVerts = Math.max(1, movers.length) * WAKE * 2;
  const wpos = new Float32Array(wakeVerts * 3);
  const walpha = new Float32Array(wakeVerts);
  const widx = [];
  for (let b = 0; b < movers.length; b++) {
    const o = b * WAKE * 2;
    for (let i = 0; i < WAKE - 1; i++) widx.push(o + 2 * i, o + 2 * i + 1, o + 2 * i + 2, o + 2 * i + 1, o + 2 * i + 3, o + 2 * i + 2);
  }
  const wgeo = new THREE.BufferGeometry();
  wgeo.setAttribute('position', new THREE.BufferAttribute(wpos, 3).setUsage(THREE.DynamicDrawUsage));
  wgeo.setAttribute('aAlpha', new THREE.BufferAttribute(walpha, 1).setUsage(THREE.DynamicDrawUsage));
  wgeo.setIndex(widx);
  const wmat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(0.86, 0.9, 0.93) }, uOpacity: { value: 0.5 } },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      varying float vA;
      void main() {
        vA = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vA;
      void main() {
        if (vA < 0.01) discard;
        gl_FragColor = vec4(uColor, vA * uOpacity);
      }`,
  });
  const wake = new THREE.Mesh(wgeo, wmat);
  wake.name = 'boat-wakes';
  wake.frustumCulled = false;
  wake.renderOrder = 2;
  group.add(wake);

  for (let b = 0; b < movers.length; b++) {
    const a = movers[b];
    a.h = new Float32Array(WAKE * 3); // newest at index 0
    a.wakeBase = b * WAKE * 2;
  }

  // ---- motion: a smooth out-and-back along the path, no dwell
  const A = 0.15; // trapezoid acceleration / braking fraction
  const profile = (x) => (x < A ? (0.5 * x * x) / (A * (1 - A)) : x < 1 - A ? (x - A / 2) / (1 - A) : 1 - (0.5 * (1 - x) * (1 - x)) / (A * (1 - A)));
  const at = { x: 0, y: 0, z: 0, yaw: 0 };
  function sample(L, s) {
    let i = 1;
    while (i < L.cum.length - 1 && L.cum[i] < s) i++;
    const u = THREE.MathUtils.clamp((s - L.cum[i - 1]) / Math.max(1e-6, L.cum[i] - L.cum[i - 1]), 0, 1);
    at.x = L.xs[i - 1] + (L.xs[i] - L.xs[i - 1]) * u;
    at.z = L.zs[i - 1] + (L.zs[i] - L.zs[i - 1]) * u;
    at.y = L.ys[i - 1] + (L.ys[i] - L.ys[i - 1]) * u;
    at.yaw = Math.atan2(L.xs[i] - L.xs[i - 1], L.zs[i] - L.zs[i - 1]);
    return at;
  }
  function arcAt(L, speed, t) {
    const one = L.total / speed;
    const p = ((t % (2 * one)) + 2 * one) % (2 * one);
    if (p < one) return { s: profile(p / one) * L.total, dir: 1 };
    return { s: (1 - profile((p - one) / one)) * L.total, dir: -1 };
  }

  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler(0, 0, 0, 'YXZ');
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3(1, 1, 1);
  const _m = new THREE.Matrix4();
  function setMatrix(a, x, y, z, yaw, roll, scale = 1) {
    _e.set(0, yaw, roll, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(scale, scale, scale);
    _m.compose(_p, _q, _s);
    a.mesh.setMatrixAt(a.slot, _m);
  }

  // the river anchor, for the far-distance cull
  let ax = 0;
  let az = 0;
  for (const a of movers) {
    ax += a.line.xs[a.line.xs.length >> 1];
    az += a.line.zs[a.line.zs.length >> 1];
  }
  if (movers.length) {
    ax /= movers.length;
    az /= movers.length;
  }

  function inView(frustum, x, y, z, r) {
    const p = frustum.planes;
    for (let k = 0; k < 6; k++) if (p[k].normal.x * x + p[k].normal.y * y + p[k].normal.z * z + p[k].constant < -r) return false;
    return true;
  }

  let time = 0;
  let visible = 0;
  function update(dt, cam, frustum, view) {
    time += dt;
    const c = cam || camera;
    const hidden = c ? c.position.distanceToSquared(_p.set(ax, 0, az)) > 2600 * 2600 : false;
    group.visible = !hidden;
    if (hidden) return;
    visible = 0;

    // foam still catches a little light at night; do not let the wake glow
    wmat.uniforms.uOpacity.value = 0.5 * (view ? 1 - 0.45 * view.night : 1);

    for (const a of actors) {
      if (!a.moving) {
        setMatrix(a, a.x, a.y, a.z, a.yaw, 0);
        if (!frustum || inView(frustum, a.x, a.y, a.z, 6)) visible++;
        continue;
      }
      const { s, dir } = arcAt(a.line, a.speed, time + a.phase * (2 * (a.line.total / a.speed)));
      sample(a.line, s);
      const yaw = at.yaw + (dir < 0 ? Math.PI : 0);
      const roll = dt > 0 ? Math.sin(time * 1.1 + a.slot) * 0.018 : 0;
      const vis = !frustum || inView(frustum, at.x, at.y, at.z, 4);
      a.vis = vis;
      if (vis) {
        visible++;
        setMatrix(a, at.x, at.y, at.z, yaw, roll);
      } else {
        _m.compose(_p.set(0, -1000, 0), _q.set(0, 0, 0, 1), _s.set(0, 0, 0));
        a.mesh.setMatrixAt(a.slot, _m);
      }
      // wake trail (distance-based, so spacing is steady at any speed)
      const h = a.h;
      const d2 = (at.x - h[0]) ** 2 + (at.z - h[2]) ** 2;
      if (dt > 0 && d2 > WAKE_STEP * WAKE_STEP) {
        h.copyWithin(3, 0, (WAKE - 1) * 3);
        h[0] = at.x;
        h[1] = at.y;
        h[2] = at.z;
      }
    }
    for (const m of meshes) m.instanceMatrix.needsUpdate = true;

    // ---- the wake ribbons
    if (movers.length) {
      for (let b = 0; b < movers.length; b++) {
        const a = movers[b];
        const h = a.h;
        const base = a.wakeBase;
        for (let i = 0; i < WAKE; i++) {
          const o3 = i * 3;
          const px = h[o3];
          const py = h[o3 + 1];
          const pz = h[o3 + 2];
          // tangent toward the older sample
          const j = Math.min(WAKE - 1, i + 1);
          let tx = h[j * 3] - px;
          let tz = h[j * 3 + 2] - pz;
          const l = Math.hypot(tx, tz);
          if (l > 1e-4) {
            tx /= l;
            tz /= l;
          } else {
            tx = 0;
            tz = 1;
          }
          const w = 0.5 + 1.9 * (i / (WAKE - 1)); // wake spreads astern
          const v = (base + i * 2) * 3;
          wpos[v] = px - tz * w;
          wpos[v + 1] = py + 0.02;
          wpos[v + 2] = pz + tx * w;
          wpos[v + 3] = px + tz * w;
          wpos[v + 4] = py + 0.02;
          wpos[v + 5] = pz - tx * w;
          const f = Math.pow(1 - i / (WAKE - 1), 1.35);
          const al = a.vis ? 0.55 * f : 0;
          walpha[base + i * 2] = al;
          walpha[base + i * 2 + 1] = al;
        }
      }
      wgeo.attributes.position.needsUpdate = true;
      wgeo.attributes.aAlpha.needsUpdate = true;
      wgeo.computeBoundingSphere();
    }
  }

  // place everything once (reduced motion: this is the final, still frame)
  for (const a of movers) {
    const { s } = arcAt(a.line, a.speed, a.phase * (2 * (a.line.total / a.speed)));
    sample(a.line, s);
    for (let i = 0; i < WAKE; i++) {
      a.h[i * 3] = at.x;
      a.h[i * 3 + 1] = at.y;
      a.h[i * 3 + 2] = at.z;
    }
  }
  update(0, camera ? { position: camera.position } : undefined, null);

  const geoTris = Object.values(tris).reduce((s, n) => s + n, 0);
  return {
    object: group,
    update,
    stats: {
      items: movers.length,
      moored: mooredList.length,
      rabelos: actors.filter((a) => a.type === 'rabelo').length,
      cruisers: actors.filter((a) => a.type === 'cruiser').length,
      ferries: actors.filter((a) => a.type === 'ferry').length,
      hotels: actors.filter((a) => a.type === 'hotel').length,
      routes: items.length,
      triangles: geoTris,
      wakeTriangles: widx.length / 3,
      wakeSegments: WAKE,
    },
    get visible() {
      return visible;
    },
    // tests: the world position of the first moving boat
    position(i = 0) {
      const a = movers[i];
      if (!a) return null;
      const { s } = arcAt(a.line, a.speed, time + a.phase * (2 * (a.line.total / a.speed)));
      sample(a.line, s);
      return { x: at.x, y: at.y, z: at.z };
    },
  };
}

// ------------------------------------------------------------ traffic
// pedestrian centre (lat, lon, radius m): no traffic on its streets (the
// tunnels under it still carry theirs). cities/<id>.json traffic.car_free
// (Braga: the Sé / Rua do Souto / Largo do Paço, and Praça da República).
const CAR_FREE = () => CITY.traffic?.car_free || [];
const PAINT = [0xf1f1ee, 0xa9afb4, 0x1d1f22, 0x2b3f63, 0x9e2a24, 0x8a7a66].map((h) => new THREE.Color(h));
const LORRY_PAINT = [0xf1f1ee, 0xe8e4da, 0x2c4a7a, 0x9e2a24, 0x3d5c3a].map((h) => new THREE.Color(h));
// Porto taxis (dark and cream) and the STCP bus livery (white, blue)
const TAXI_PAINT = [0x1d1f22, 0xf1f1ee, 0x27435f].map((h) => new THREE.Color(h));
const BUS_PAINT = [0xf1f1ee, 0x187ec2, 0xe8e4da].map((h) => new THREE.Color(h));
// one palette per skin (0 car, 1 van, 2 lorry, 3 taxi, 4 bus)
const PAINTS = [PAINT, PAINT, LORRY_PAINT, TAXI_PAINT, BUS_PAINT];
// the main axes by their OSM name and ref (traffic-model.js AXIS_IDS order)
const AXIS_OF = (t) => (t.name === 'Avenida da Liberdade' ? 1 : /EN 101/.test(t.ref || '') ? 2 : /A 11|CSB|EN 14/.test(t.ref || '') || /Circular Sul de Braga/.test(t.name || '') ? 3 : 0);
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'motorway_link', 'trunk_link', 'primary_link']);

// 0 car, 1 van, 2 lorry, 3 taxi, 4 bus; +z is the front (head lamps), metres
function vehicleGeometry(type) {
  const parts =
    type === 4
      ? [
          box(2.5, 0.55, 12.0, 0, 0.2, 0, 0x1b1e21), // chassis
          box(2.5, 2.35, 11.6, 0, 0.75, 0, 0xffffff), // STCP body
          box(2.56, 0.95, 9.6, 0, 1.45, 0, 0x223039, 1), // lit windows
          box(2.57, 0.16, 11.2, 0, 0.92, 0, 0x187ec2), // blue
          box(2.57, 0.12, 11.2, 0, 1.08, 0, 0x2e8b57), // green
          box(2.3, 0.22, 10.8, 0, 3.1, 0, 0x9aa0a4), // roof
          box(1.9, 0.34, 0.12, 0, 2.4, 5.95, 0x14120f), // destination board
          box(1.7, 0.1, 0.14, 0, 2.63, 5.96, 0xf6efdc, 1), // lit route
          box(0.24, 0.24, 0.1, -0.85, 0.75, 6.02, 0xffe9b0, 1), // headlights
          box(0.24, 0.24, 0.1, 0.85, 0.75, 6.02, 0xffe9b0, 1),
          box(2.2, 1.3, 0.08, 0, 0.9, 6.0, 0x223039, 1), // windscreen
        ]
      : type === 3
        ? [
            box(1.7, 0.3, 3.7, 0, 0, 0, 0x151515),
            box(1.8, 0.7, 4.5, 0, 0.3, 0, 0xffffff), // car body (tinted)
            box(1.6, 0.55, 2.4, 0, 1.0, -0.2, 0x2b3036), // cabin glass
            box(0.7, 0.2, 0.34, 0, 1.72, -0.1, 0xffe9b0, 1), // roof taxi sign
            box(1.82, 0.16, 0.5, 0, 0.5, 1.7, 0x2b3f63), // livery band
          ]
        : type === 2
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

  // ---- vehicles: lorries on the motorways, vans and cars everywhere, plus
  // a few Porto taxis and STCP buses on the city streets. `vs` is the visible
  // skin; `vt` (the physics type road-network.js owns) stays 0/1/2 — a bus
  // behaves as the long lorry for lane and speed, a taxi as a car.
  const vt = flow.vt;
  const vs = new Uint8Array(N); // skin: 0 car, 1 van, 2 lorry, 3 taxi, 4 bus
  const vc = new Uint8Array(N);
  function spawn(i) {
    flow.spawn(i);
    const d = flow.vd[i];
    const r = rnd();
    let skin;
    if (laneFast[d]) skin = r < 0.24 ? 2 : r < 0.36 ? 1 : 0;
    else if (lanePrimary[d]) skin = r < 0.03 ? 4 : r < 0.12 ? 3 : r < 0.3 ? 1 : 0;
    else skin = r < 0.015 ? 4 : r < 0.09 ? 3 : r < 0.24 ? 1 : r < 0.27 ? 2 : 0;
    vs[i] = skin;
    vt[i] = skin === 2 || skin === 4 ? 2 : skin === 1 ? 1 : 0;
    vc[i] = Math.floor(rnd() * PAINTS[skin].length);
  }
  for (let i = 0; i < N; i++) spawn(i);

  const lampsCar = lampChunk(0.55, 0.85);
  const LAMPS = [lampsCar, lampChunk(0.6, 0.95), lampChunk(0.8, 1.15), lampsCar, lampChunk(0.55, 0.95)];
  const NAMES = ['traffic-cars', 'traffic-vans', 'traffic-lorries', 'traffic-taxis', 'traffic-buses'];
  const CAP = [1, 1, 0.4, 1, 0.14];
  const meshes = [0, 1, 2, 3, 4].map((type) => {
    const m = new THREE.InstancedMesh(vehicleGeometry(type), lifeMaterial({ roughness: 0.38, metalness: 0.25, lamps: LAMPS[type] }), Math.ceil(N * CAP[type]));
    m.name = NAMES[type];
    m.frustumCulled = false; // culled per vehicle below
    m.castShadow = false;
    m.receiveShadow = true;
    m.count = 0;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, PAINTS[type][0]);
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

  const counts = [0, 0, 0, 0, 0]; // visible cars, vans, lorries, taxis, buses
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
    counts[0] = counts[1] = counts[2] = counts[3] = counts[4] = 0;
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
      const t = vs[i];
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
        PAINTS[t][vc[i]].toArray(m.instanceColor.array, k * 3);
      }
      if (showLights) {
        const half = (t === 2 ? 6.4 : t === 4 ? 6.0 : t === 3 ? 2.2 : t ? 2.6 : 2.2) * S;
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
    for (let t = 0; t < meshes.length; t++) {
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
    visible = counts.reduce((s, n) => s + n, 0);
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
      skins: NAMES,
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
  const trams = safe('trams', () => buildTrams({ project, heightAt, mobile, lite }));
  const trains = safe('trains', () => buildTrains({ project, heightAt, items, mobile, lite }));
  const cablecar = safe('cablecar', () => buildCableCar({ project, heightAt, mobile, lite }));
  const boats = safe('boats', () => buildBoats({ project, heightAt, mobile, lite, camera }));
  const traffic = safe('traffic', () => buildTraffic({ roads, project, heightAt, mobile, model, N: carMax }));
  const birds = safe('birds', () => buildBirds({ items, heightAt, project, nature, mobile, lite }));
  const fountains = safe('fountains', () => buildFountains({ project, heightAt, items, mobile }));
  // the street level: calçada squares, furniture, people, POI signs
  // (streetscape.js; it builds once its data has arrived)
  const street = safe('streetscape', () =>
    createStreetscape({ camera, roads, project, heightAt, items, outlines: ctx.outlines, footprints: ctx.footprints, lite, mobile, debug, model, fx, surfaceHeights }),
  );
  for (const p of [funicular, trams, trains, cablecar, boats, traffic, birds, fountains, street]) if (p) group.add(p.object);

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
    trams: trams?.stats ?? null,
    trains: trains?.stats ?? null,
    cablecar: cablecar?.stats ?? null,
    boats: boats?.stats ?? null,
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
    trams?.update(adt, camera);
    trains?.update(adt, camera);
    cablecar?.update(adt, camera);
    boats?.update(adt, camera, frustum, view);
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
    trams,
    trains,
    cablecar,
    boats,
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
