// Porto's street level, close up: the pieces that make a street read as a
// lived-in Porto street rather than a clean model.
//
//   - a post under every street-lamp glow of roads.js (the glows hung in the
//     air), iron lanterns along the pedestrian streets and the Douro quays;
//   - benches on the quays and the squares, black iron bollards across the
//     mouths of the pedestrian streets;
//   - STCP bus shelters and stop poles at the real stop positions
//     (data/stops.json, scripts/build-stops.mjs from the GTFS schedule),
//     snapped to the kerb of the nearest carriageway and facing it;
//   - cars parked along the kerbs of the residential streets, clear of the
//     moving lanes, the junctions and the stops;
//   - café terraces (tables, chairs, parasols) and shop awnings on the
//     facades of the Clérigos / Baixa streets, and terraces along the house
//     rows of the Ribeira and Gaia quays (read from the built landmark model:
//     those houses are in the model, not in the OSM footprints);
//   - a second, small crowd (people.js createCrowd): strollers along the
//     Ribeira and Gaia quays and around the fronts of the main landmarks.
//
// Draw cost: every static piece goes into ONE merged mesh (one draw, no
// shadow pass), refilled from baked cells when the camera focus moves; the
// crowd is one more instanced draw. The placement runs in small steps over
// the first frames (no long task). Nothing here runs in the lite scene (class
// P builds no life layer); class M keeps about half, S about a third.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { S } from './geo.js';
import { CITY, dataPath, hasData } from './city.js';
import { assetUrl } from './data.js';
import { buildNetwork } from './road-network.js';
import { RIBBON_LIFT, SIDEWALK_R, WALKED, sidewalkM, lampPosts } from './roads.js';
import { createCrowd, pedestrianDemand } from './people.js';

// ------------------------------------------------------------ geometry
// metres; y is the bottom; +z is the front of every piece
function part(geo, color, { glow = 0, tint = 0 } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  const col = new THREE.Color(color);
  for (let i = 0; i < n; i++) col.toArray(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
  g.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(n).fill(tint), 1));
  return g;
}
const box = (w, h, d, x, y, z, color, o) => part(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), color, o);
// a box tilted about x (an awning's canopy), centred at (x, y, z)
const boxTilt = (w, h, d, x, y, z, rx, color, o) => part(new THREE.BoxGeometry(w, h, d).rotateX(rx).translate(x, y, z), color, o);
// open-ended: the caps are never seen on a thin post
const pole = (rt, rb, h, seg, x, y, z, color, o) => part(new THREE.CylinderGeometry(rt, rb, h, seg, 1, true).translate(x, y + h / 2, z), color, o);
const cone = (r, h, seg, x, y, z, color, o) => part(new THREE.ConeGeometry(r, h, seg, 1, true).translate(x, y + h / 2, z), color, o);
// a flat dark quad on the ground under a piece: its contact shadow (the
// layer casts no shadow of its own)
const contact = (w, d, x = 0, z = 0) => part(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(x, 0.035, z), 0x2a2724);

const IRON = 0x1f2422; // Porto's dark green-black street iron
const STEEL = 0x4a4f53;
const STCP_BLUE = 0x14315c;
const STCP_YELLOW = 0xe8c33a;
const GLASS = 0x3b4a52;
const WOOD = 0x7d5131;
const WHITE = 0xf2efe6;

function pieceGeometry(parts) {
  const g = mergeGeometries(parts);
  g.scale(S, S, S);
  return g;
}
const PIECES = {
  // the main-street lamp under the roads.js glow (LAMP_HEIGHT_M 7 m): a
  // tapered post, a short arm toward the street and the lamp head
  lamp: () =>
    pieceGeometry([
      pole(0.13, 0.16, 0.9, 5, 0, -0.3, 0, IRON),
      pole(0.06, 0.09, 6.4, 5, 0, 0.6, 0, 0x39413d),
      box(0.08, 0.08, 0.95, 0, 6.85, 0.42, 0x39413d),
      box(0.5, 0.18, 0.36, 0, 6.82, 0.95, 0xfff0cf, { glow: 1 }),
    ]),
  // a historic iron lantern on a post (the quays, the pedestrian streets)
  lantern: () =>
    pieceGeometry([
      pole(0.11, 0.15, 0.7, 5, 0, -0.3, 0, IRON),
      pole(0.045, 0.06, 2.9, 5, 0, 0.4, 0, IRON),
      pole(0.2, 0.13, 0.5, 4, 0, 3.3, 0, 0xffe2a8, { glow: 1 }),
      cone(0.27, 0.24, 4, 0, 3.8, 0, IRON),
    ]),
  // a slatted bench on an iron frame, the seat facing +z
  bench: () =>
    pieceGeometry([
      contact(1.9, 0.75),
      box(0.07, 0.42, 0.46, -0.78, -0.05, 0.02, IRON),
      box(0.07, 0.42, 0.46, 0.78, -0.05, 0.02, IRON),
      box(1.8, 0.06, 0.48, 0, 0.36, 0.04, WOOD),
      box(1.8, 0.36, 0.05, 0, 0.48, -0.2, WOOD),
    ]),
  // a black iron pilarete with a pale band
  bollard: () => pieceGeometry([pole(0.07, 0.09, 1.2, 5, 0, -0.3, 0, IRON), cone(0.1, 0.12, 5, 0, 0.9, 0, IRON), pole(0.092, 0.092, 0.06, 5, 0, 0.66, 0, 0xb7b1a3)]),
  // an STCP bus shelter: glass back, roof, a lit advert panel at the side,
  // a bench, and the stop flag on its own pole; +z faces the street
  shelter: () =>
    pieceGeometry([
      contact(3.6, 1.7, 0, 0.1),
      box(3.4, 0.08, 1.6, 0, 2.45, 0.15, 0xd7d9d6),
      box(3.3, 2.1, 0.05, 0, 0.3, -0.55, GLASS),
      box(0.06, 2.45, 0.06, -1.65, 0, -0.55, STEEL),
      box(0.06, 2.45, 0.06, 1.65, 0, -0.55, STEEL),
      box(0.08, 1.75, 1.15, 1.62, 0.45, 0.05, 0xf3efe2, { glow: 0.75 }),
      box(2.2, 0.06, 0.4, -0.4, 0.45, -0.3, STEEL),
      pole(0.04, 0.05, 2.6, 4, -1.95, -0.05, 0.75, STEEL),
      box(0.46, 0.46, 0.05, -1.95, 2.25, 0.75, STCP_BLUE, { glow: 0.2 }),
      box(0.46, 0.12, 0.06, -1.95, 2.71, 0.75, STCP_YELLOW, { glow: 0.2 }),
    ]),
  // a quiet stop: the flag on a pole and a small timetable box
  stoppole: () =>
    pieceGeometry([
      pole(0.04, 0.05, 2.6, 4, 0, -0.05, 0, STEEL),
      box(0.46, 0.46, 0.05, 0, 2.15, 0, STCP_BLUE, { glow: 0.2 }),
      box(0.46, 0.12, 0.06, 0, 2.61, 0, STCP_YELLOW, { glow: 0.2 }),
      box(0.3, 0.42, 0.08, 0, 1.2, 0.05, 0xe9e6dc),
    ]),
  // a parked car (the instance colour paints the body); +z the bonnet
  car: () =>
    pieceGeometry([
      contact(2.0, 4.5),
      box(1.74, 0.66, 4.15, 0, 0.2, 0, WHITE, { tint: 1 }),
      box(1.56, 0.5, 2.1, 0, 0.86, -0.25, 0x262d33),
      box(1.48, 0.07, 1.9, 0, 1.36, -0.28, WHITE, { tint: 1 }),
    ]),
  // a café table with two chairs under a parasol (the instance colour)
  terrace: () =>
    pieceGeometry([
      contact(2.0, 1.1),
      box(0.72, 0.04, 0.72, 0, 0.72, 0, 0xd8d2c4),
      box(0.44, 0.46, 0.42, -0.72, 0, 0, 0x5d6266),
      box(0.44, 0.46, 0.42, 0.72, 0, 0, 0x5d6266),
      box(0.05, 2.9, 0.05, 0, 0, 0, 0xe8e4da),
      cone(1.45, 0.42, 6, 0, 2.5, 0, WHITE, { tint: 1 }),
    ]),
  // the same table without a parasol (the narrow streets, the shade side)
  table: () =>
    pieceGeometry([
      contact(2.0, 1.0),
      box(0.72, 0.04, 0.72, 0, 0.72, 0, 0xd8d2c4),
      box(0.08, 0.72, 0.08, 0, 0, 0, 0x55595d),
      box(0.44, 0.46, 0.42, -0.72, 0, 0, 0x5d6266),
      box(0.44, 0.46, 0.42, 0.72, 0, 0, 0x5d6266),
    ]),
  // a shopfront awning on the facade (the instance colour), y 0 at the
  // ground; +z points out from the wall
  awning: () =>
    pieceGeometry([
      boxTilt(3.0, 0.05, 1.45, 0, 2.95, 0.66, 0.38, WHITE, { tint: 1 }),
      box(3.0, 0.26, 0.04, 0, 2.42, 1.34, WHITE, { tint: 1 }),
    ]),
};

const PAINT = [0xf1f1ee, 0xa9afb4, 0x1d1f22, 0x2b3f63, 0x9e2a24, 0x8a7a66, 0xd8d5cc, 0x5a6066, 0x2f4a3a, 0x6b1f22];
const PARASOL = [0xf3efe6, 0xb23a2e, 0x24452f, 0x23324f, 0xe7d9b0, 0x8a2433, 0xd9a441];
const AWNING = [0x141414, 0x24452f, 0x8a2433, 0x1b3a6b, 0x3a3a3a, 0xb7472f, 0xe9e2cf];
const PALETTE = { car: PAINT, terrace: PARASOL, awning: AWNING };

// a piece as flat arrays (world units): position, normal, colour (linear),
// glow, tint flag
function flatten(g) {
  return {
    nv: g.attributes.position.count,
    pos: g.attributes.position.array,
    nrm: g.attributes.normal.array,
    col: g.attributes.color.array,
    glow: g.attributes.aGlow.array,
    tint: g.attributes.aTint.array,
  };
}

function kitMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.06 });
  mat.customProgramCacheKey = () => 'porto-street-kit';
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
  return Math.abs(a / 2);
};
// numeric key of a grid cell (cells within +-32k of the origin)
const cellKey = (gx, gz) => (gx + 32768) * 65536 + (gz + 32768);
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
        const k = cellKey(gx, gz);
        let c = grid.get(k);
        if (!c) grid.set(k, (c = []));
        c.push(i);
      }
    }
  }
  return {
    inside(x, z) {
      const c = grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
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

// the landmarks people walk on (a quay, a square, a garden): never solid
const WALKABLE = new Set(['ribeira', 'cais-gaia', 'praca-batalha', 'cordoaria', 'jardim-do-morro', 'palacio-cristal', 'parque-cidade', 'serralves', 'passeio-alegre']);
// streets and quays with café terraces and awnings (OSM names)
const TERRACE_RE = /^(Cais da Ribeira|Pra[çc]a da Ribeira|Muro dos Bacalhoeiros|Cais da Estiva|Cais de Gaia|Avenida de Diogo Leite|Rua das Flores|Rua da Galeria de Paris|Rua C[âa]ndido dos Reis|Rua das Carmelitas|Rua dos Cl[ée]rigos|Pra[çc]a de Parada Le[ií]t[ãa]o|Pra[çc]a de Gomes Teixeira|Pra[çc]a de Lisboa|Rua de Santa Catarina|Avenida dos Aliados|Pra[çc]a da Liberdade|Rua de Mouzinho da Silveira|Rua do Almada|Rua de S[áa] da Bandeira|Pra[çc]a de Carlos Alberto|Rua de Jos[ée] Falc[ãa]o|Rua da F[áa]brica|Rua de Passos Manuel|Pra[çc]a da Batalha|Rua de S[ãa]o Jo[ãa]o|Rua do Infante Dom Henrique|Largo de S[ãa]o Domingos)$/;
const QUAY_RE = /^(Cais |Muro dos Bacalhoeiros|Pra[çc]a da Ribeira|Avenida de Diogo Leite)/;
// the landmarks whose fronts draw a crowd
const CROWD_SITES = ['clerigos', 'lello', 'sao-bento', 'se-porto', 'bolsa', 'sao-francisco-porto', 'aliados', 'mercado-bolhao', 'casa-musica', 'caves-gaia', 'igreja-carmelitas', 'carmo', 'santo-ildefonso', 'teatro-nacional-sao-joao', 'trindade', 'coliseu', 'casa-do-infante', 'serra-do-pilar'];
// the landmarks that draw their own house row along a quay: terraces go in
// front of the model's facades
const FRONT_SITES = ['ribeira', 'cais-gaia'];

// device class: XL / L full, M about half, S a third (P never gets here)
const CLASS_K = { XL: 1, L: 0.85, M: 0.55, S: 0.35, P: 0 };
const FRAME_MS = 6; // placement work per frame

async function fetchJson(name) {
  if (!hasData(name)) return null;
  try {
    const r = await fetch(assetUrl(dataPath(name)));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (!(r.headers.get('content-type') || '').includes('json')) throw new Error('not JSON');
    return await r.json();
  } catch (e) {
    console.info(`[porto] ${dataPath(name)} unavailable (${e.message}); street kit without it`);
    return null;
  }
}

// ------------------------------------------------------------ public
// ctx (life.js via streetscape.js): { camera, roads, project, heightAt, items,
// outlines, footprints, lite, debug, model, fx, surfaceHeights }
export function createStreetKit(ctx) {
  const { camera, roads, project, heightAt, items = [], outlines = [], footprints = [], fx, model } = ctx;
  const cls = ctx.debug?.governor?.cls || (ctx.lite ? 'M' : 'XL');
  const K = CLASS_K[cls] ?? (ctx.lite ? 0.55 : 1);
  const group = new THREE.Group();
  group.name = 'porto-street-kit';
  const stats = { status: 'building', cls, k: K, pieces: {}, tris: 0, drawnTris: 0, cells: 0, ms: {}, crowd: null, people: 0 };
  if (!(K > 0) || !roads) {
    stats.status = 'off';
    return { object: group, stats, update() {} };
  }
  const t0 = performance.now();
  const rnd = lcg(20261010);
  const keep = () => K >= 1 || rnd() < K;
  const R_CENTRE = SIDEWALK_R; // world units around the origin with the full street level
  const groundY = (x, z) => heightAt(x, z) + RIBBON_LIFT + 0.01;

  // ---- the index (built in the first step)
  let net = null;
  let X = null;
  let Z = null;
  let Y = null;
  let ways = [];
  let bIdx = null;
  let lIdx = null;
  const solidAt = (x, z) => bIdx.inside(x, z) || lIdx.inside(x, z);
  const zones = (CITY.traffic?.car_free || []).map(([la, lo, r]) => ({ ...project(la, lo), r: r * S }));
  const inZone = (x, z) => zones.some((q) => (x - q.x) ** 2 + (z - q.z) ** 2 < q.r * q.r);
  const SC = 8;
  const segs = [];
  const segGrid = new Map();
  const JC = 8;
  const junc = new Map();
  // the buildings near the centre (the far ring is never furnished)
  function buildFootprints() {
    const lim = (R_CENTRE + 140) ** 2;
    bIdx = polyIndex(
      footprints.filter((p) => p?.length && p[0].x * p[0].x + p[0].z * p[0].z < lim),
      8,
    );
  }
  function buildIndex() {
    net = buildNetwork(roads, project, heightAt);
    ({ X, Z, Y, ways } = net);
    const solids = [];
    for (const it of items) {
      const poly = outlines?.[it.index];
      if (!poly || poly.length < 3 || WALKABLE.has(it.data?.id)) continue;
      // a large outline is a square or a park more often than a wall
      if (polyArea(poly) / (S * S) > 6000) continue;
      solids.push(poly);
    }
    lIdx = polyIndex(solids, 8);
    // carriageways: a segment grid (near test, nearest segment)
    for (let wi = 0; wi < ways.length; wi++) {
      const w = ways[wi];
      if (!w.car || w.tunnel) continue;
      const m = w.start + (w.n >> 1);
      if (X[m] * X[m] + Z[m] * Z[m] > (R_CENTRE + 120) ** 2) continue;
      const half = (w.widthM / 2) * S;
      for (let i = w.start; i < w.start + w.n - 1; i++) {
        if (Y[i] - net.G[i] > 1 || Y[i + 1] - net.G[i + 1] > 1) continue; // a deck passes over
        const k = segs.length / 6;
        segs.push(X[i], Z[i], X[i + 1], Z[i + 1], half, wi);
        const r = half + 1;
        for (let gx = Math.floor((Math.min(X[i], X[i + 1]) - r) / SC); gx <= Math.floor((Math.max(X[i], X[i + 1]) + r) / SC); gx++) {
          for (let gz = Math.floor((Math.min(Z[i], Z[i + 1]) - r) / SC); gz <= Math.floor((Math.max(Z[i], Z[i + 1]) + r) / SC); gz++) {
            const key = cellKey(gx, gz);
            let c = segGrid.get(key);
            if (!c) segGrid.set(key, (c = []));
            c.push(k);
          }
        }
      }
    }
    // junctions: three or more way ends at a node
    for (let n = 0; n < net.nNodes; n++) {
      const nw = net.nodeWays[n];
      if (!nw || nw.length < 6) continue;
      const i = nw[1];
      if (X[i] * X[i] + Z[i] * Z[i] > (R_CENTRE + 60) ** 2) continue;
      const key = cellKey(Math.floor(X[i] / JC), Math.floor(Z[i] / JC));
      let c = junc.get(key);
      if (!c) junc.set(key, (c = []));
      c.push(X[i], Z[i]);
    }
  }
  // on (or within m of) a carriageway; skip: a way index to ignore
  function onCar(x, z, m = 0, skip = -1) {
    const c = segGrid.get(cellKey(Math.floor(x / SC), Math.floor(z / SC)));
    if (!c) return false;
    for (const k of c) {
      const o = k * 6;
      if (segs[o + 5] === skip) continue;
      const ax = segs[o];
      const az = segs[o + 1];
      const dx = segs[o + 2] - ax;
      const dz = segs[o + 3] - az;
      const L2 = dx * dx + dz * dz || 1e-9;
      const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      const ex = ax + dx * u - x;
      const ez = az + dz * u - z;
      const r = segs[o + 4] + m;
      if (ex * ex + ez * ez < r * r) return true;
    }
    return false;
  }
  // the nearest carriageway segment within maxR
  function nearestCar(x, z, maxR) {
    let best = null;
    let bd = maxR * maxR;
    for (let gx = Math.floor((x - maxR) / SC); gx <= Math.floor((x + maxR) / SC); gx++) {
      for (let gz = Math.floor((z - maxR) / SC); gz <= Math.floor((z + maxR) / SC); gz++) {
        for (const k of segGrid.get(cellKey(gx, gz)) || []) {
          const o = k * 6;
          const ax = segs[o];
          const az = segs[o + 1];
          const dx = segs[o + 2] - ax;
          const dz = segs[o + 3] - az;
          const L2 = dx * dx + dz * dz || 1e-9;
          const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
          const px = ax + dx * u;
          const pz = az + dz * u;
          const d2 = (px - x) ** 2 + (pz - z) ** 2;
          if (d2 < bd) {
            bd = d2;
            const L = Math.sqrt(L2);
            best = { px, pz, tx: dx / L, tz: dz / L, half: segs[o + 4], wi: segs[o + 5] };
          }
        }
      }
    }
    return best;
  }
  const nearJunction = (x, z, r) => {
    for (let gx = Math.floor((x - r) / JC); gx <= Math.floor((x + r) / JC); gx++) {
      for (let gz = Math.floor((z - r) / JC); gz <= Math.floor((z + r) / JC); gz++) {
        const c = junc.get(cellKey(gx, gz));
        if (!c) continue;
        for (let q = 0; q < c.length; q += 2) if ((c[q] - x) ** 2 + (c[q + 1] - z) ** 2 < r * r) return true;
      }
    }
    return false;
  };
  // at least r apart from the other pieces of a kind
  const taken = new Map();
  function spaced(kind, x, z, r) {
    let grid = taken.get(kind);
    if (!grid) taken.set(kind, (grid = new Map()));
    const cx = Math.floor(x / r);
    const cz = Math.floor(z / r);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        const c = grid.get(cellKey(gx, gz));
        if (!c) continue;
        for (let q = 0; q < c.length; q += 2) if ((c[q] - x) ** 2 + (c[q + 1] - z) ** 2 < r * r) return false;
      }
    }
    const k = cellKey(cx, cz);
    let c = grid.get(k);
    if (!c) grid.set(k, (c = []));
    c.push(x, z);
    return true;
  }

  // ---- instances
  const TYPES = Object.keys(PIECES);
  const typeId = Object.fromEntries(TYPES.map((t, i) => [t, i]));
  const IT = [];
  const IX = [];
  const IY = [];
  const IZ = [];
  const IYAW = [];
  const IPITCH = [];
  const ITINT = [];
  const count = Object.fromEntries(TYPES.map((t) => [t, 0]));
  function put(type, x, y, z, yaw = 0, pitch = 0) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return -1;
    IT.push(typeId[type]);
    IX.push(x);
    IY.push(y);
    IZ.push(z);
    IYAW.push(yaw);
    IPITCH.push(pitch);
    const pal = PALETTE[type];
    ITINT.push(pal ? Math.floor(rnd() * pal.length) : 0);
    count[type]++;
    return IT.length - 1;
  }

  // ---- placement, as steps over ranges of ways
  // 1. a post under every main-street lamp
  function placeLamps() {
    const lp = lampPosts(net);
    for (let q = 0; q < lp.length; q += 4) {
      const x = lp[q];
      const z = lp[q + 2];
      if (x * x + z * z > R_CENTRE * R_CENTRE) continue;
      if (solidAt(x, z) || onCar(x, z, -0.2 * S) || !keep()) continue;
      put('lamp', x, Math.max(lp[q + 1], heightAt(x, z)) + RIBBON_LIFT, z, lp[q + 3]);
    }
  }
  // 2. lanterns, benches and bollards along the pedestrian streets and quays
  function placePedestrian(w) {
    if (w.tunnel || w.bridge) return;
    const name = w.t.name || '';
    const quay = QUAY_RE.test(name);
    const ped = w.hw === 'pedestrian' || w.hw === 'living_street' || (w.kind === 'foot' && quay);
    if (!ped) return;
    const m = w.start + (w.n >> 1);
    if (X[m] * X[m] + Z[m] * Z[m] > R_CENTRE * R_CENTRE) return;
    const square = /^(Pra[çc]a|Largo|Praceta|Jardim|Alameda|Passeio)/.test(name);
    const half = (w.widthM / 2) * S;
    const C = net.C;
    const c0 = C[w.start];
    let side = 1;
    const lanStep = (quay ? 22 : 18) * S;
    let next = lanStep * 0.5;
    let nextBench = 9 * S;
    for (let i = w.start; i < w.start + w.n - 1; i++) {
      const dx = X[i + 1] - X[i];
      const dz = Z[i + 1] - Z[i];
      const L = Math.hypot(dx, dz);
      if (L < 1e-6) continue;
      const tx = dx / L;
      const tz = dz / L;
      const s0 = C[i] - c0;
      const s1 = C[i + 1] - c0;
      while (next < s1) {
        const u = (next - s0) / L;
        const off = Math.max(0.6 * S, half - 0.5 * S);
        const x = X[i] + dx * u - tz * off * side;
        const z = Z[i] + dz * u + tx * off * side;
        if (!solidAt(x, z) && !onCar(x, z, 0.3 * S) && spaced('lantern', x, z, 9 * S) && keep()) put('lantern', x, groundY(x, z), z, 0);
        side = -side;
        next += lanStep;
      }
      // benches: the quays and the squares, facing across the way
      if (!quay && !square) continue;
      while (nextBench < s1) {
        const u = (nextBench - s0) / L;
        const cx = X[i] + dx * u;
        const cz = Z[i] + dz * u;
        for (const sd of [1, -1]) {
          const off = half + (quay ? 2.5 : 0.2) * S;
          const x = cx - tz * off * sd;
          const z = cz + tx * off * sd;
          if (solidAt(x, z) || solidAt(x - tz * sd * 1.2 * S, z + tx * sd * 1.2 * S) || onCar(x, z, 0.6 * S)) continue;
          if (Math.abs(heightAt(x, z) - Y[i]) > 1.2 * S) continue; // off the quay edge
          if (!spaced('bench', x, z, 7 * S) || !keep()) continue;
          put('bench', x, groundY(x, z), z, Math.atan2(tz * sd, -tx * sd));
          break;
        }
        nextBench += (quay ? 16 : 13) * S + rnd() * 6 * S;
      }
    }
    // bollards across the mouths where the pedestrian street meets a carriageway
    if (w.hw !== 'pedestrian') return;
    for (const end of [0, 1]) {
      const i = end ? w.start + w.n - 1 : w.start;
      const j = end ? i - 1 : i + 1;
      const x0 = X[i];
      const z0 = Z[i];
      if (!onCar(x0, z0, 1.5 * S)) continue;
      let tx = X[j] - x0;
      let tz = Z[j] - z0;
      const L = Math.hypot(tx, tz) || 1;
      tx /= L;
      tz /= L;
      // step back from the carriageway to the kerb line
      let back = 0.5 * S;
      while (back < 8 * S && onCar(x0 + tx * back, z0 + tz * back, 0.4 * S)) back += 0.5 * S;
      const bx = x0 + tx * back;
      const bz = z0 + tz * back;
      const nB = Math.max(2, Math.min(6, Math.round((2 * half) / (1.5 * S))));
      for (let q = 0; q < nB; q++) {
        const lat = (q - (nB - 1) / 2) * ((2 * half - 0.8 * S) / Math.max(1, nB - 1));
        const x = bx - tz * lat;
        const z = bz + tx * lat;
        if (solidAt(x, z) || !spaced('bollard', x, z, 1.1 * S)) continue;
        put('bollard', x, groundY(x, z), z, 0);
      }
    }
  }
  // 3. café terraces and awnings on the named streets and quays
  function placeTerraces(w) {
    const name = w.t.name || '';
    if (!TERRACE_RE.test(name) || w.tunnel || w.bridge) return;
    const quay = QUAY_RE.test(name);
    const half = (w.widthM / 2) * S;
    const maxF = half + (quay ? 26 : 9) * S;
    const sw = w.car && WALKED.has(w.hw) ? sidewalkM(w.hw) * S : 0;
    const STEP = 3.4 * S;
    const C = net.C;
    const base = C[w.start];
    const end = w.start + w.n - 1;
    let s = STEP * 0.5;
    let i = w.start;
    while (s < C[end] - base) {
      while (i < end - 1 && C[i + 1] - base < s) i++;
      const L = Math.max(1e-6, C[i + 1] - C[i]);
      const u = (s - (C[i] - base)) / L;
      const tx = (X[i + 1] - X[i]) / L;
      const tz = (Z[i + 1] - Z[i]) / L;
      const cx = X[i] + (X[i + 1] - X[i]) * u;
      const cz = Z[i] + (Z[i + 1] - Z[i]) * u;
      s += STEP;
      for (const sd of [1, -1]) {
        const nx = -tz * sd;
        const nz = tx * sd;
        // march out to the facade
        let d = Math.max(0.5 * S, half * 0.6);
        while (d < maxF && !solidAt(cx + nx * d, cz + nz * d)) d += 0.4 * S;
        if (d >= maxF) continue;
        const fx = cx + nx * d;
        const fz = cz + nz * d;
        const yaw = Math.atan2(-nx, -nz); // +z out of the wall, toward the way
        // awnings: most bays, on the ground-floor shopfronts
        if (rnd() < 0.62 && spaced('awning', fx, fz, 3.6 * S) && keep()) {
          put('awning', fx - nx * 0.06 * S, heightAt(fx - nx * 0.3 * S, fz - nz * 0.3 * S) + RIBBON_LIFT, fz - nz * 0.06 * S, yaw);
        }
        // terraces: in front of the facade, never on the carriageway
        const td = d - (quay ? 3.2 + rnd() * 3.5 : 1.9 + rnd() * 0.6) * S;
        if (w.car && td < half + 0.4 * S) continue; // no room on the pavement
        if (!w.car && td < 0.6 * S && !quay) continue;
        if (rnd() > (quay ? 0.85 : 0.6)) continue;
        const x = cx + nx * td;
        const z = cz + nz * td;
        if (solidAt(x, z) || onCar(x, z, 0.5 * S)) continue;
        if (sw && td > half + 0.15 * S + sw + 0.5 * S) continue; // past the pavement
        if (/^Cais d[ae] (Ribeira|Gaia)$/.test(name) && inFrontSite(x, z)) continue; // placeFronts reads these from the model
        if (Math.abs(heightAt(x, z) - heightAt(cx, cz)) > 1.5 * S) continue;
        if (!spaced('terrace', x, z, 2.6 * S) || !keep()) continue;
        put(quay || rnd() < 0.55 ? 'terrace' : 'table', x, groundY(x, z), z, yaw + (rnd() - 0.5) * 0.5);
      }
    }
  }
  // the quay landmarks' boxes (+30 m): their terraces come from the model
  let frontBoxes = null;
  function inFrontSite(x, z) {
    if (!frontBoxes) {
      frontBoxes = [];
      for (const id of FRONT_SITES) {
        const it = items.find((q) => q?.data?.id === id);
        const poly = it && outlines?.[it.index];
        if (!poly || poly.length < 3) continue;
        const M = 30 * S;
        frontBoxes.push([Math.min(...poly.map((p) => p.x)) - M, Math.max(...poly.map((p) => p.x)) + M, Math.min(...poly.map((p) => p.z)) - M, Math.max(...poly.map((p) => p.z)) + M]);
      }
    }
    return frontBoxes.some((b) => x >= b[0] && x <= b[1] && z >= b[2] && z <= b[3]);
  }
  // 4. parked cars along the kerbs of the residential streets
  const PARK = new Set(['residential', 'unclassified', 'tertiary', 'secondary']);
  function placeCars(w, wi) {
    if (!w.car || w.tunnel || w.bridge || !PARK.has(w.hw) || w.t.jn) return;
    const m = w.start + (w.n >> 1);
    if (X[m] * X[m] + Z[m] * Z[m] > R_CENTRE * R_CENTRE || inZone(X[m], Z[m])) return;
    const lw = w.laneW;
    // the outermost moving lane's centre (road-network.js laneOffset)
    const outer = w.ow === 0 ? (Math.max(w.fwd, w.back) - 0.5) * lw : (w.total / 2 - 0.5) * lw;
    const half = (w.widthM / 2) * S;
    // the car's centre: its inner side 0.15 m clear of a car in that lane
    const off = Math.max(half - 0.55 * S, outer + (0.9 + 0.15 + 0.9) * S);
    if (off - half > 1.15 * S) return; // more than 1.15 m onto the pavement: no room
    const sw = WALKED.has(w.hw) ? sidewalkM(w.hw) * S : 0;
    const occupancy = (w.hw === 'residential' ? 0.72 : 0.5) * Math.min(1, K * 1.1);
    const C = net.C;
    const end = w.start + w.n - 1;
    const base = C[w.start];
    const total = C[end] - base;
    for (const sd of [1, -1]) {
      if (sd === -1 && w.ow !== 0 && rnd() < 0.5) continue; // one-way: often one side only
      let s = 7 * S + rnd() * 3 * S;
      let i = w.start;
      while (s < total - 7 * S) {
        while (i < end - 1 && C[i + 1] - base < s) i++;
        const L = Math.max(1e-6, C[i + 1] - C[i]);
        const u = (s - (C[i] - base)) / L;
        const tx = (X[i + 1] - X[i]) / L;
        const tz = (Z[i + 1] - Z[i]) / L;
        const cx = X[i] + (X[i + 1] - X[i]) * u;
        const cz = Z[i] + (Z[i + 1] - Z[i]) * u;
        s += (5.3 + rnd() * 0.8) * S;
        if (rnd() > occupancy) continue;
        const nx = -tz * sd;
        const nz = tx * sd;
        const x = cx + nx * off;
        const z = cz + nz * off;
        if (sw && off + 0.95 * S > half + 0.15 * S + sw) continue;
        if (nearJunction(x, z, 11 * S)) continue;
        // the car's corners and its outer side: no wall, no other street
        let clear = true;
        for (const [a, b] of [[2.2, 0], [-2.2, 0], [2.2, 0.95], [-2.2, 0.95], [0, 0.95]]) {
          const px = x + tx * a * S + nx * b * S;
          const pz = z + tz * a * S + nz * b * S;
          if (solidAt(px, pz) || onCar(px, pz, 0, wi)) {
            clear = false;
            break;
          }
        }
        if (!clear || !spaced('car', x, z, 4.8 * S)) continue;
        const yF = heightAt(x + tx * 2 * S, z + tz * 2 * S);
        const yB = heightAt(x - tx * 2 * S, z - tz * 2 * S);
        const pitch = Math.max(-0.2, Math.min(0.2, Math.atan2(yF - yB, 4 * S)));
        const y = Math.max(net.surfaceY(i, 0), heightAt(x, z) + RIBBON_LIFT - 0.02);
        put('car', x, y, z, Math.atan2(tx * sd, tz * sd), sd === 1 ? pitch : -pitch);
      }
    }
  }
  // 5. STCP stops: shelters and poles at the real positions
  const stopPts = [];
  function placeStops(doc) {
    let shelters = 0;
    let poles = 0;
    for (const s of doc?.stops || []) {
      const [la, lo, nPat] = s;
      const p = project(la, lo);
      if (p.x * p.x + p.z * p.z > R_CENTRE * R_CENTRE) continue;
      const seg = nearestCar(p.x, p.z, 18 * S);
      if (!seg) continue;
      // the stop's side of the street
      const cross = seg.tx * (p.z - seg.pz) - seg.tz * (p.x - seg.px);
      const sd = cross >= 0 ? 1 : -1;
      const nx = -seg.tz * sd;
      const nz = seg.tx * sd;
      const yaw = Math.atan2(-nx, -nz); // +z toward the street
      let placed = false;
      if (nPat >= 4 && keep()) {
        const off = seg.half + 1.25 * S;
        const x = seg.px + nx * off;
        const z = seg.pz + nz * off;
        let clear = !onCar(x, z, 0.1 * S);
        for (const [a, b] of [[1.8, 0.6], [-1.8, 0.6], [1.8, -0.8], [-1.8, -0.8], [-2.0, -0.8]]) {
          if (solidAt(x + seg.tx * a * S + nx * b * S, z + seg.tz * a * S + nz * b * S)) clear = false;
        }
        if (clear && spaced('stop', x, z, 6 * S)) {
          put('shelter', x, groundY(x, z), z, yaw);
          shelters++;
          placed = true;
          stopPts.push(x, z);
        }
      }
      if (!placed) {
        const off = seg.half + 0.45 * S;
        const x = seg.px + nx * off;
        const z = seg.pz + nz * off;
        if (solidAt(x, z) || !spaced('stop', x, z, 6 * S)) continue;
        put('stoppole', x, groundY(x, z), z, yaw);
        poles++;
        stopPts.push(x, z);
      }
    }
    stats.shelters = shelters;
    stats.stopPoles = poles;
  }

  // ---- quay lines (data/quays.json): the river edge, for the crowd and the
  // quay terraces
  let quayLines = [];
  const QC = 10;
  const quayGrid = new Map();
  function indexQuays(doc) {
    quayLines = [];
    for (const raw of doc?.lines || []) {
      if (!Array.isArray(raw) || raw.length < 2) continue;
      const pts = raw.map(([mx, my]) => ({ x: mx * S, z: -my * S }));
      quayLines.push(pts);
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 1.5));
        for (let j = 0; j <= n; j++) {
          const x = a.x + ((b.x - a.x) * j) / n;
          const z = a.z + ((b.z - a.z) * j) / n;
          const key = cellKey(Math.floor(x / QC), Math.floor(z / QC));
          let c = quayGrid.get(key);
          if (!c) quayGrid.set(key, (c = []));
          c.push(x, z);
        }
      }
    }
  }
  function nearestQuay(x, z, r) {
    let best = null;
    let bd = r * r;
    for (let gx = Math.floor((x - r) / QC); gx <= Math.floor((x + r) / QC); gx++) {
      for (let gz = Math.floor((z - r) / QC); gz <= Math.floor((z + r) / QC); gz++) {
        const c = quayGrid.get(cellKey(gx, gz));
        if (!c) continue;
        for (let q = 0; q < c.length; q += 2) {
          const d2 = (c[q] - x) ** 2 + (c[q + 1] - z) ** 2;
          if (d2 < bd) {
            bd = d2;
            best = { x: c[q], z: c[q + 1], d: Math.sqrt(d2) };
          }
        }
      }
    }
    return best;
  }

  // 6. terraces in front of the house rows the quay landmarks model
  // themselves: the facade is where the model's roofs end (surfaceHeights),
  // on the side that faces the river (the quay line)
  function placeFronts(it) {
    const poly = outlines?.[it.index];
    const meshes = (it.meshes || []).filter((m) => m?.geometry?.attributes?.position);
    if (!poly || !meshes.length || !ctx.surfaceHeights) return 0;
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
    const M = 30 * S;
    x0 -= M;
    x1 += M;
    z0 -= M;
    z1 += M;
    const G = 1.6 * S; // grid step
    const nx = Math.ceil((x1 - x0) / G) + 1;
    const nz = Math.ceil((z1 - z0) / G) + 1;
    const xs = new Float32Array(nx * nz);
    const zs = new Float32Array(nx * nz);
    const lo = new Float32Array(nx * nz);
    const hi = new Float32Array(nx * nz).fill(1e6);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        xs[k] = x0 + i * G;
        zs[k] = z0 + j * G;
        lo[k] = heightAt(xs[k], zs[k]) + 2.6 * S;
      }
    }
    // a roof (a house, an arcade) over the cell
    const roof = new Uint8Array(nx * nz);
    for (const m of meshes) {
      const h = ctx.surfaceHeights(m, xs, zs, lo, hi);
      for (let k = 0; k < h.length; k++) if (Number.isFinite(h[k])) roof[k] = 1;
    }
    let placed = 0;
    for (let j = 1; j < nz - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        if (!roof[k]) continue;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (roof[k + di + dj * nx]) continue;
          // a facade cell: does it face the river?
          const fx = xs[k] + di * G * 0.5;
          const fz = zs[k] + dj * G * 0.5;
          const q = nearestQuay(fx, fz, 40 * S);
          if (!q || q.d < 5 * S) continue;
          if (((q.x - fx) * di + (q.z - fz) * dj) / q.d < 0.6) continue;
          if (rnd() > 0.7) continue;
          // one or two rows of tables, short of the quay edge
          const rows = q.d > 9 * S ? 2 : 1;
          for (let r = 0; r < rows; r++) {
            const dist = (2.4 + r * 2.4 + rnd() * 0.6) * S;
            if (dist > q.d - 2.2 * S) break;
            const x = fx + di * dist + (rnd() - 0.5) * 0.8 * S * Math.abs(dj);
            const z = fz + dj * dist + (rnd() - 0.5) * 0.8 * S * Math.abs(di);
            const ii = Math.round((x - x0) / G);
            const jj = Math.round((z - z0) / G);
            if (ii < 0 || jj < 0 || ii >= nx || jj >= nz || roof[jj * nx + ii]) continue;
            if (bIdx.inside(x, z) || onCar(x, z, 0.4 * S)) continue;
            if (!spaced('terrace', x, z, 2.5 * S) || !keep()) continue;
            put(rnd() < 0.85 ? 'terrace' : 'table', x, groundY(x, z), z, Math.atan2(di, dj) + (rnd() - 0.5) * 0.5);
            placed++;
          }
        }
      }
    }
    return placed;
  }

  // ---- the crowd: quays and landmark fronts
  let crowd = null;
  let crowdPaths = 0;
  const reducedMotion = !!(ctx.reducedMotion ?? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches));
  function makeCrowd() {
    const paths = [];
    const STEPW = 0.5; // world units between path samples
    const okWalk = (x, z) => Number.isFinite(x) && Number.isFinite(heightAt(x, z)) && !solidAt(x, z) && !onCar(x, z, 0.4 * S);
    function addRun(xs, zs, half, name) {
      // split where blocked; keep runs of 6+ samples
      let run = null;
      const flush = () => {
        if (run && run.x.length >= 6) paths.push({ x: Float32Array.from(run.x), z: Float32Array.from(run.z), y: Float32Array.from(run.y), half, ped: true, name, district: 'kit' });
        run = null;
      };
      for (let k = 0; k < xs.length; k++) {
        const x = xs[k];
        const z = zs[k];
        if (!okWalk(x, z)) {
          flush();
          continue;
        }
        if (!run) run = { x: [], z: [], y: [] };
        run.x.push(x);
        run.z.push(z);
        run.y.push(groundY(x, z) - 0.01);
      }
      flush();
    }
    // (a) the river quays of the centre: the quay line, 6 m inland
    const rib = project(41.14075, -8.61298);
    const gaia = project(41.13786, -8.61545);
    const nearQuay = (x, z) => (x - rib.x) ** 2 + (z - rib.z) ** 2 < 260 ** 2 || (x - gaia.x) ** 2 + (z - gaia.z) ** 2 < 260 ** 2;
    for (const pts of quayLines) {
      if (!pts.some((p) => nearQuay(p.x, p.z))) continue;
      const xs = [];
      const zs = [];
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / STEPW));
        for (let j = 0; j < n; j++) {
          xs.push(a.x + ((b.x - a.x) * j) / n);
          zs.push(a.z + ((b.z - a.z) * j) / n);
        }
      }
      // the land side: the higher ground, voted over the line
      const n = xs.length;
      const nX = new Float32Array(n);
      const nZ = new Float32Array(n);
      let vote = 0;
      for (let k = 0; k < n; k++) {
        const a = Math.max(0, k - 1);
        const b = Math.min(n - 1, k + 1);
        const L = Math.hypot(xs[b] - xs[a], zs[b] - zs[a]) || 1;
        nX[k] = -(zs[b] - zs[a]) / L;
        nZ[k] = (xs[b] - xs[a]) / L;
        if (k % 3 === 0) vote += heightAt(xs[k] + nX[k] * 2.5, zs[k] + nZ[k] * 2.5) - heightAt(xs[k] - nX[k] * 2.5, zs[k] - nZ[k] * 2.5);
      }
      const sg = vote >= 0 ? 1 : -1;
      const ox = [];
      const oz = [];
      for (let k = 0; k < n; k++) {
        const ok = nearQuay(xs[k], zs[k]);
        ox.push(ok ? xs[k] + nX[k] * sg * 6 * S : NaN);
        oz.push(ok ? zs[k] + nZ[k] * sg * 6 * S : NaN);
      }
      addRun(ox, oz, 3.2 * S, 'promenade');
    }
    // (b) a ring around the fronts of the main landmarks
    for (const id of CROWD_SITES) {
      const it = items.find((q) => q?.data?.id === id);
      const poly = it && outlines?.[it.index];
      if (!poly || poly.length < 3) continue;
      let cx = 0;
      let cz = 0;
      for (const p of poly) {
        cx += p.x;
        cz += p.z;
      }
      cx /= poly.length;
      cz /= poly.length;
      const xs = [];
      const zs = [];
      const NA = 72;
      for (let a = 0; a <= NA; a++) {
        const ang = (a / NA) * Math.PI * 2;
        const dx = Math.cos(ang);
        const dz = Math.sin(ang);
        // the outline's reach in that direction (its farthest crossing)
        let r = 0;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const ax = poly[j].x - cx;
          const az = poly[j].z - cz;
          const ex = poly[i].x - cx - ax;
          const ez = poly[i].z - cz - az;
          const den = dx * ez - dz * ex;
          if (Math.abs(den) < 1e-9) continue;
          const t = (ax * ez - az * ex) / den;
          const u = (ax * dz - az * dx) / den;
          if (t > 0 && u >= 0 && u <= 1) r = Math.max(r, t);
        }
        const rr = r > 0 ? r + (5 + 2 * Math.sin(ang * 3)) * S : NaN;
        xs.push(cx + dx * rr);
        zs.push(cz + dz * rr);
      }
      addRun(xs, zs, 2.4 * S, id);
    }
    crowdPaths = paths.length;
    if (!paths.length) return null;
    const max = Math.round((ctx.lite ? 100 : 160) * Math.min(1, K * 1.15));
    return createCrowd({ paths, max, lite: !!ctx.lite, reducedMotion });
  }

  // ---- the layer: one merged mesh around the focus, from baked cells
  const pieces = TYPES.map((t) => flatten(PIECES[t]()));
  const CELL = 24; // world units (96 m)
  const cells = new Map();
  function addToCell(k) {
    const gx = Math.floor(IX[k] / CELL);
    const gz = Math.floor(IZ[k] / CELL);
    const key = cellKey(gx, gz);
    let c = cells.get(key);
    if (!c) cells.set(key, (c = { gx, gz, list: [], nv: 0, baked: null }));
    c.list.push(k);
    c.nv += pieces[IT[k]].nv;
    c.baked = null;
  }
  const palLin = Object.fromEntries(Object.entries(PALETTE).map(([t, a]) => [typeId[t], a.map((h) => new THREE.Color(h))]));
  function bake(c) {
    const nv = c.nv;
    const pos = new Float32Array(nv * 3);
    const nrm = new Int8Array(nv * 3);
    const col = new Uint8Array(nv * 3);
    const glw = new Uint8Array(nv);
    let v = 0;
    for (const k of c.list) {
      const P = pieces[IT[k]];
      const cy = Math.cos(IYAW[k]);
      const sy = Math.sin(IYAW[k]);
      const cp = Math.cos(IPITCH[k]);
      const sp = Math.sin(IPITCH[k]);
      const pal = palLin[IT[k]];
      const tc = pal ? pal[ITINT[k] % pal.length] : null;
      const ox = IX[k];
      const oy = IY[k];
      const oz = IZ[k];
      for (let q = 0; q < P.nv; q++) {
        const o = q * 3;
        const w = v * 3;
        // pitch about x (the nose up), then yaw about y
        const px = P.pos[o];
        const py = P.pos[o + 1] * cp + P.pos[o + 2] * sp;
        const pz = -P.pos[o + 1] * sp + P.pos[o + 2] * cp;
        pos[w] = ox + px * cy + pz * sy;
        pos[w + 1] = oy + py;
        pos[w + 2] = oz - px * sy + pz * cy;
        const qx = P.nrm[o];
        const qy = P.nrm[o + 1] * cp + P.nrm[o + 2] * sp;
        const qz = -P.nrm[o + 1] * sp + P.nrm[o + 2] * cp;
        nrm[w] = Math.round((qx * cy + qz * sy) * 127);
        nrm[w + 1] = Math.round(qy * 127);
        nrm[w + 2] = Math.round((-qx * sy + qz * cy) * 127);
        const t = tc && P.tint[q] > 0.5;
        col[w] = Math.min(255, Math.round(P.col[o] * (t ? tc.r : 1) * 255));
        col[w + 1] = Math.min(255, Math.round(P.col[o + 1] * (t ? tc.g : 1) * 255));
        col[w + 2] = Math.min(255, Math.round(P.col[o + 2] * (t ? tc.b : 1) * 255));
        glw[v] = Math.round(P.glow[q] * 255);
        v++;
      }
    }
    c.baked = { pos, nrm, col, glw };
    stats.cells++;
  }

  // the drawn buffer: capacity scales with the class (42 k triangles at XL,
  // about 15 k on S)
  const MAXV = Math.round(126000 * Math.max(0.35, K));
  const geo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(new Float32Array(MAXV * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const aNrm = new THREE.BufferAttribute(new Int8Array(MAXV * 3), 3, true).setUsage(THREE.DynamicDrawUsage);
  const aCol = new THREE.BufferAttribute(new Uint8Array(MAXV * 3), 3, true).setUsage(THREE.DynamicDrawUsage);
  const aGlw = new THREE.BufferAttribute(new Uint8Array(MAXV), 1, true).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aPos);
  geo.setAttribute('normal', aNrm);
  geo.setAttribute('color', aCol);
  geo.setAttribute('aGlow', aGlw);
  geo.setDrawRange(0, 0);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  const uniforms = { uStNight: { value: 0 }, uStGlow: { value: 1 } };
  const mesh = new THREE.Mesh(geo, kitMaterial(uniforms));
  mesh.name = 'porto-street-kit';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.visible = false;
  mesh.matrixAutoUpdate = false;
  group.add(mesh);

  const R_FURN = K >= 0.8 ? 80 : K >= 0.5 ? 64 : 48; // world units around the focus
  let drawnV = 0;
  // fill the buffer with the cells around (fx0, fz0), nearest first; bake
  // what is missing within a small budget. Returns true while cells wait.
  function fill(fx0, fz0) {
    const r = R_FURN + CELL;
    const list = [];
    for (let gx = Math.floor((fx0 - r) / CELL); gx <= Math.floor((fx0 + r) / CELL); gx++) {
      for (let gz = Math.floor((fz0 - r) / CELL); gz <= Math.floor((fz0 + r) / CELL); gz++) {
        const c = cells.get(cellKey(gx, gz));
        if (!c) continue;
        const d2 = ((gx + 0.5) * CELL - fx0) ** 2 + ((gz + 0.5) * CELL - fz0) ** 2;
        if (d2 > (R_FURN + CELL * 0.71) ** 2) continue;
        list.push([d2, c]);
      }
    }
    list.sort((a, b) => a[0] - b[0]);
    const tb = performance.now();
    let pending = false;
    let v = 0;
    for (const [, c] of list) {
      if (v + c.nv > MAXV) break;
      if (!c.baked) {
        if (performance.now() - tb > 4) {
          pending = true;
          continue;
        }
        bake(c);
      }
      aPos.array.set(c.baked.pos, v * 3);
      aNrm.array.set(c.baked.nrm, v * 3);
      aCol.array.set(c.baked.col, v * 3);
      aGlw.array.set(c.baked.glw, v);
      v += c.nv;
    }
    drawnV = v;
    geo.setDrawRange(0, v);
    for (const [a, k] of [
      [aPos, 3],
      [aNrm, 3],
      [aCol, 3],
      [aGlw, 1],
    ]) {
      a.clearUpdateRanges();
      if (v) a.addUpdateRange(0, v * k);
      a.needsUpdate = true;
    }
    geo.boundingSphere.center.set(fx0, heightAt(fx0, fz0), fz0);
    geo.boundingSphere.radius = R_FURN + CELL * 1.5 + 20;
    stats.drawnTris = Math.round(v / 3);
    return pending;
  }

  // ---- the build: small steps over the first frames
  let docs = null;
  fetchJson('stops.json')
    .then((stops) => fetchJson('quays.json').then((quays) => (docs = { stops, quays })))
    .catch(() => (docs = { stops: null, quays: null }));
  const steps = [];
  const timed = (key, fn) => () => {
    const a = performance.now();
    fn();
    stats.ms[key] = (stats.ms[key] || 0) + Math.round(performance.now() - a);
  };
  steps.push(timed('footprints', buildFootprints));
  steps.push(timed('index', buildIndex));
  steps.push(timed('lamps', placeLamps));
  // the way passes, in slices of ways
  const SLICE = 1500;
  steps.push(() => {
    for (let a = 0; a < ways.length; a += SLICE) {
      const b = Math.min(ways.length, a + SLICE);
      steps.push(
        timed('ways', () => {
          for (let wi = a; wi < b; wi++) {
            const w = ways[wi];
            placePedestrian(w);
            placeTerraces(w);
            placeCars(w, wi);
          }
        }),
      );
    }
    steps.push(() => (stage = 'data'));
  });
  let stage = 'steps';
  let ready = false;
  const frontPending = new Set(FRONT_SITES);
  let nextFrontCheck = 0;
  function finish() {
    const tb = performance.now();
    try {
      if (docs.stops) placeStops(docs.stops);
    } catch (e) {
      console.warn('[porto] street kit: stops failed', e);
    }
    indexQuays(docs.quays);
    // parked cars where a stop stands: dropped
    if (stopPts.length) {
      for (let k = 0; k < IT.length; k++) {
        if (IT[k] !== typeId.car) continue;
        for (let q = 0; q < stopPts.length; q += 2) {
          if ((IX[k] - stopPts[q]) ** 2 + (IZ[k] - stopPts[q + 1]) ** 2 < (14 * S) ** 2) {
            IT[k] = -1;
            count.car--;
            break;
          }
        }
      }
    }
    for (let k = 0; k < IT.length; k++) if (IT[k] >= 0) addToCell(k);
    try {
      crowd = makeCrowd();
      if (crowd) group.add(crowd.object);
      stats.crowd = crowd ? { paths: crowdPaths, ...crowd.stats } : null;
    } catch (e) {
      console.warn('[porto] street kit: crowd failed', e);
    }
    tally();
    stats.ms.finish = Math.round(performance.now() - tb);
    stats.buildMs = Math.round(performance.now() - t0);
    stats.status = 'ready';
    ready = true;
  }
  function tally() {
    let tris = 0;
    for (const t of TYPES) {
      stats.pieces[t] = count[t];
      tris += (count[t] * pieces[typeId[t]].nv) / 3;
    }
    stats.tris = Math.round(tris);
    stats.trisEach = Object.fromEntries(TYPES.map((t) => [t, pieces[typeId[t]].nv / 3]));
  }
  function build() {
    const tb = performance.now();
    while (stage === 'steps' && steps.length && performance.now() - tb < FRAME_MS) {
      try {
        steps.shift()();
      } catch (e) {
        console.warn('[porto] street kit: a build step failed', e);
        stats.status = `failed: ${e.message}`;
        stage = 'failed';
      }
    }
    if (stage === 'data' && docs) {
      stage = 'done';
      finish();
    }
  }
  // the quay terraces wait for their landmark's model (built lazily)
  function checkFronts(now) {
    if (!frontPending.size || now < nextFrontCheck || !quayLines.length) return false;
    nextFrontCheck = now + 1000;
    let added = false;
    for (const id of [...frontPending]) {
      const it = items.find((q) => q?.data?.id === id);
      if (!it) {
        frontPending.delete(id);
        continue;
      }
      if (!(it.meshes || []).some((m) => m?.geometry?.attributes?.position)) continue;
      frontPending.delete(id);
      const n0 = IT.length;
      const tb = performance.now();
      const n = placeFronts(it);
      stats.ms[`front-${id}`] = Math.round(performance.now() - tb);
      (stats.fronts ||= {})[id] = n;
      for (let k = n0; k < IT.length; k++) addToCell(k);
      if (n) added = true;
      break; // one site per check
    }
    if (added) tally();
    return added;
  }

  function clockOf() {
    const st = model?.state;
    const c = model?.clock;
    return { hour: st?.hour ?? 13, weekend: !!st?.weekend, ymd: c?.ymd ?? 0 };
  }
  let lastX = Infinity;
  let lastZ = Infinity;
  let lastFill = -1e9;
  let on = false;
  let pendingBake = false;
  function update(dt, frustum, view) {
    if (!ready) {
      build();
      return;
    }
    const now = performance.now();
    if (checkFronts(now)) lastX = Infinity;
    const camDist = view?.camDist ?? 0;
    uniforms.uStNight.value = view?.night ?? 0;
    uniforms.uStGlow.value = fx?.enabled ? 2.4 : 1;
    const focus = camera?.userData?.focus || camera?.position || { x: 0, z: 0 };
    const fxp = focus.x;
    const fzp = focus.z;
    const want = camDist < (ctx.lite ? 320 : 560);
    if (want !== on) {
      on = want;
      mesh.visible = false;
      lastX = Infinity;
    }
    if (on && ((fxp - lastX) ** 2 + (fzp - lastZ) ** 2 > 36 || pendingBake) && now - lastFill > 180) {
      lastX = fxp;
      lastZ = fzp;
      lastFill = now;
      pendingBake = fill(fxp, fzp);
      mesh.visible = drawnV > 0;
    }
    if (crowd) {
      const clk = clockOf();
      const demand = pedestrianDemand(clk.hour, clk.weekend, clk.ymd) * (view?.rain > 0.5 ? 0.45 : 1);
      crowd.update(dt, camera, frustum, { fx: fxp, fz: fzp, R: ctx.lite ? 95 : 150, on: camDist < (ctx.lite ? 220 : 380), demand });
      stats.people = crowd.shown;
    }
  }
  return {
    object: group,
    stats,
    update,
    get mesh() {
      return mesh;
    },
    get crowd() {
      return crowd;
    },
    get ready() {
      return ready;
    },
    // tests: every placed instance of a type, [x, y, z, yaw, ...]
    instancesOf(type) {
      const t = typeId[type];
      const out = [];
      for (let k = 0; k < IT.length; k++) if (IT[k] === t) out.push(IX[k], IY[k], IZ[k], IYAW[k]);
      return out;
    },
  };
}
