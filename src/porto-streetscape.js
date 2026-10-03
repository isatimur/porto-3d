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
const STONE = 0x9a938a;
const TERRA = 0xb23a2e;
const BRONZE = 0x3f6b52; // weathered bronze with a green patina
const BRONZE_D = 0x35543f;
const SIGN_BLUE = 0x14315c;

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
const coneG = (r, h, seg, x, y, z, color, glow = 0) => part(new THREE.ConeGeometry(r, h, seg, 1, true).translate(x, y + h / 2, z), color, glow);
const icoG = (r, x, y, z, color, glow = 0) => part(new THREE.IcosahedronGeometry(r, 0).translate(x, y, z), color, glow);
const sphereG = (r, x, y, z, color, glow = 0) => part(new THREE.SphereGeometry(r, 8, 6).translate(x, y, z), color, glow);
const boxY = (w, h, d, x, y, z, rotY, color, glow = 0) => part(new THREE.BoxGeometry(w, h, d).rotateY(rotY).translate(x, y + h / 2, z), color, glow);
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
  // an ornate five-globe cast-iron lamp (the Aliados candelabra)
  ornateLamp: () =>
    merged([
      cylG(0.3, 0.42, 1.5, 8, 0, 0, 0, IRON),
      cylG(0.1, 0.16, 4.1, 8, 0, 1.5, 0, IRON),
      boxG(2.9, 0.1, 0.1, 0, 5.5, 0, IRON),
      cylG(0.05, 0.05, 0.3, 6, -1.35, 5.4, 0, IRON),
      cylG(0.05, 0.05, 0.3, 6, 1.35, 5.4, 0, IRON),
      cylG(0.24, 0.15, 0.42, 6, 0, 5.6, 0, 0xffe2a8, 1),
      cylG(0.06, 0.22, 0.2, 6, 0, 6.02, 0, IRON),
      cylG(0.18, 0.12, 0.34, 6, -1.35, 5.7, 0, 0xffe2a8, 1),
      coneG(0.2, 0.18, 6, -1.35, 6.04, 0, IRON),
      cylG(0.18, 0.12, 0.34, 6, 1.35, 5.7, 0, 0xffe2a8, 1),
      coneG(0.2, 0.18, 6, 1.35, 6.04, 0, IRON),
    ]),
  // a traffic signal: pole, head, three lenses (+z faces the roadway)
  trafficlight: () =>
    merged([
      cylG(0.09, 0.12, 0.5, 6, 0, -0.2, 0, 0x2a2c2e),
      cylG(0.055, 0.07, 3.15, 6, 0, 0.3, 0, 0x33383c),
      boxG(0.34, 0.98, 0.26, 0, 3.3, 0.02, 0x1c1f22),
      cylG(0.1, 0.1, 0.06, 8, 0, 3.42, 0.16, 0xd23b2e, 1),
      cylG(0.1, 0.1, 0.06, 8, 0, 3.72, 0.16, 0xe0a53a, 0.85),
      cylG(0.1, 0.1, 0.06, 8, 0, 4.02, 0.16, 0x2fa84f, 0.85),
      boxG(0.4, 0.08, 0.1, 0, 4.3, 0.02, 0x1c1f22),
    ]),
  // a direction / street sign post with two arms
  signpost: () =>
    merged([
      cylG(0.05, 0.06, 2.9, 6, 0, -0.05, 0, 0x3a3d40),
      boxG(1.05, 0.2, 0.05, 0.5, 2.35, 0.03, SIGN_BLUE),
      boxG(0.78, 0.05, 0.02, 0.5, 2.43, 0.06, WHITE),
      boxG(0.9, 0.2, 0.05, -0.44, 2.05, 0.03, WHITE),
      boxG(0.64, 0.05, 0.02, -0.44, 2.13, 0.06, SIGN_BLUE),
    ]),
  // a telephone / substation cabinet on the pavement
  utilitybox: () =>
    merged([
      boxG(0.86, 0.12, 0.66, 0, -0.06, 0, 0x3a3f3c),
      boxG(0.72, 1.15, 0.5, 0, 0.06, 0, 0x59635f),
      boxG(0.62, 1.0, 0.04, 0, 0.14, 0.25, 0x4b534f),
      boxG(0.16, 0.04, 0.03, 0.16, 0.62, 0.27, 0x9aa39c),
      boxG(0.7, 0.05, 0.06, 0, 1.18, 0, 0x3a3f3c),
    ]),
  // a Baixa kiosk: octagonal body under a conical canopy
  kiosk: () =>
    merged([
      cylG(1.7, 1.8, 0.24, 8, 0, 0, 0, STONE),
      cylG(1.4, 1.45, 2.4, 8, 0, 0.24, 0, 0x24452f),
      boxG(1.5, 0.9, 0.08, 0, 0.7, 1.42, 0xf0eee6),
      boxG(1.5, 0.1, 0.1, 0, 1.6, 1.44, 0x8a2433),
      cylG(0.1, 0.1, 0.35, 6, 0, 2.64, 0, IRON),
      coneG(2.05, 0.7, 8, 0, 2.64, 0, 0x8a2433),
      cylG(0.06, 0.08, 0.3, 6, 0, 3.34, 0, IRON),
    ]),
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
  // a parasol; the instance colour tints the canopy
  umbrella: () =>
    merged([
      cylG(0.025, 0.025, 2.3, 4, 0, 0, 0, 0xe8e4da),
      coneG(1.35, 0.42, 8, 0, 1.98, 0, 0xf6f2ea),
      cylG(1.35, 1.35, 0.12, 8, 0, 1.86, 0, 0xf6f2ea),
    ]),
  // D. Pedro IV: an equestrian bronze on a tall granite pedestal (+z front)
  statueEquestrian: () =>
    merged([
      boxG(2.6, 0.25, 3.0, 0, 0, 0, STONE),
      boxG(2.3, 2.5, 2.6, 0, 0.25, 0, GRANITE),
      boxG(2.7, 0.22, 3.1, 0, 2.75, 0, STONE),
      boxG(0.95, 1.05, 2.5, 0, 3.5, 0, BRONZE),
      boxG(0.9, 1.15, 0.8, 0, 3.42, 1.25, BRONZE),
      boxG(0.2, 1.15, 0.2, -0.34, 2.6, 0.85, BRONZE),
      boxG(0.2, 1.15, 0.2, 0.34, 2.6, 0.85, BRONZE),
      boxG(0.22, 1.2, 0.22, -0.34, 2.55, -0.85, BRONZE),
      boxG(0.22, 1.2, 0.22, 0.34, 2.55, -0.85, BRONZE),
      boxG(0.45, 1.25, 0.5, 0, 4.05, 1.5, BRONZE),
      boxG(0.32, 0.5, 0.72, 0, 5.0, 1.85, BRONZE),
      boxG(0.24, 0.8, 0.24, 0, 3.6, -1.5, BRONZE),
      boxG(0.55, 0.9, 0.42, 0, 4.55, -0.1, BRONZE_D),
      boxG(0.16, 0.7, 0.16, -0.36, 4.6, 0.05, BRONZE_D),
      boxG(0.16, 0.7, 0.16, 0.36, 4.6, 0.05, BRONZE_D),
      boxG(0.18, 0.75, 0.22, -0.3, 3.95, -0.05, BRONZE_D),
      boxG(0.18, 0.75, 0.22, 0.3, 3.95, -0.05, BRONZE_D),
      sphereG(0.17, 0, 5.55, -0.1, BRONZE_D),
    ]),
  // a standing figure on a pedestal (Vímara Peres, Flora, the Infante)
  statueStanding: () =>
    merged([
      boxG(1.9, 0.16, 1.9, 0, 0, 0, STONE),
      boxG(1.55, 1.5, 1.55, 0, 0.16, 0, GRANITE),
      boxG(1.8, 0.16, 1.8, 0, 1.66, 0, STONE),
      cylG(0.34, 0.5, 1.7, 8, 0, 1.82, 0, BRONZE),
      boxG(0.62, 0.55, 0.42, 0, 3.0, 0, BRONZE),
      boxG(0.15, 0.75, 0.15, -0.32, 3.0, 0.06, BRONZE),
      boxG(0.15, 0.75, 0.15, 0.32, 3.0, 0.06, BRONZE),
      sphereG(0.18, 0, 3.78, 0, BRONZE),
    ]),
  // a bust on a plinth (the Cordoaria poets)
  statueBust: () =>
    merged([
      boxG(1.1, 0.14, 1.1, 0, 0, 0, STONE),
      boxG(0.85, 1.45, 0.85, 0, 0.14, 0, GRANITE),
      boxG(1.0, 0.14, 1.0, 0, 1.59, 0, STONE),
      boxG(0.66, 0.72, 0.4, 0, 1.73, 0, BRONZE),
      boxG(0.5, 0.34, 0.32, 0, 2.45, 0, BRONZE),
      sphereG(0.17, 0, 2.86, 0.02, BRONZE),
    ]),
  // the Fonte dos Leões: an octagonal basin, a column and four spouts
  fountain: () => {
    const p = [
      cylG(2.45, 2.6, 0.55, 8, 0, 0, 0, GRANITE),
      cylG(2.6, 2.6, 0.14, 8, 0, 0.55, 0, STONE),
      cylG(2.3, 2.3, 0.06, 8, 0, 0.62, 0, 0x3f6f8a, 0.15),
      cylG(0.4, 0.62, 2.3, 8, 0, 0.6, 0, STONE),
      cylG(1.15, 0.72, 0.4, 8, 0, 2.75, 0, STONE),
      cylG(0.16, 0.24, 0.5, 8, 0, 3.15, 0, GRANITE),
      icoG(0.17, 0, 3.82, 0, GRANITE),
    ];
    for (const [lx, lz] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) {
      const a = Math.atan2(lx, lz);
      p.push(boxY(0.42, 0.5, 0.9, lx, 0.7, lz, a, BRONZE_D));
      p.push(icoG(0.2, lx + Math.sin(a) * 0.5, 1.22, lz + Math.cos(a) * 0.5, BRONZE_D));
    }
    return merged(p);
  },
  // the Boavista column: a tall shaft with a lion on the capital
  column: () =>
    merged([
      boxG(3.4, 0.5, 3.4, 0, 0, 0, STONE),
      boxG(2.8, 0.5, 2.8, 0, 0.5, 0, GRANITE),
      cylG(0.55, 0.8, 8.6, 12, 0, 1.0, 0, STONE),
      boxG(1.5, 0.6, 1.5, 0, 9.6, 0, GRANITE),
      boxG(0.6, 1.15, 1.7, 0, 10.2, 0.15, 0xb08a4a),
      boxG(0.5, 0.42, 0.5, 0, 11.35, 0.75, 0xb08a4a),
      icoG(0.3, 0, 11.98, 0.75, 0xb08a4a),
    ]),
};
const AWNING_COLORS = [0x141414, 0x24452f, 0x8a2433, 0x1b3a6b, 0x3a3a3a].map((h) => new THREE.Color(h));
const UMBRELLA_COLORS = [0xf3efe6, 0xb23a2e, 0x24452f, 0x23324f, 0xe7d9b0, 0x8a2433].map((h) => new THREE.Color(h));

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

// Statues and monuments at their real places (lat/lon from OSM / the city's
// own record; `ref` is the landmark they anchor to, for provenance and for a
// fallback when the coordinate is missing). +z is the front of every figure.
const MONUMENTS = [
  { id: 'pedro-iv', type: 'statueEquestrian', la: 41.146456, lo: -8.611403, ref: 'aliados', yaw: Math.PI, sc: 1.1 },
  { id: 'fonte-leoes', type: 'fountain', la: 41.147118, lo: -8.615615, ref: 'uporto-reitoria', yaw: 0, sc: 1 },
  { id: 'vimara-peres', type: 'statueStanding', la: 41.14315, lo: -8.611156, ref: 'se-porto', yaw: -1.4, sc: 1 },
  { id: 'flora', type: 'statueStanding', la: 41.145698, lo: -8.616072, ref: 'cordoaria', yaw: 0.4, sc: 0.95 },
  { id: 'ramalho-ortigao', type: 'statueStanding', la: 41.146, lo: -8.616258, ref: 'cordoaria', yaw: -0.5, sc: 0.9 },
  { id: 'antonio-nobre', type: 'statueBust', la: 41.145648, lo: -8.616586, ref: 'cordoaria', yaw: 1.6, sc: 1 },
  { id: 'arnaldo-gama', type: 'statueBust', ref: 'cordoaria', dx: -9, dz: 11, yaw: 1.2, sc: 1 },
  { id: 'infante', type: 'statueStanding', la: 41.141333, lo: -8.614908, ref: 'ribeira', yaw: -2.4, sc: 1.15 },
  { id: 'boavista', type: 'column', la: 41.157921, lo: -8.629139, ref: null, yaw: 0, sc: 1 },
];
// The Baixa kiosks at their usual corners (the STCP kiosk, the garden stands).
const KIOSKS = [
  { id: 'liberdade', ref: 'aliados', la: 41.146352, lo: -8.611872, yaw: 0.9, sc: 1 },
  { id: 'cordoaria', ref: 'cordoaria', la: 41.14583, lo: -8.61715, yaw: 1.6, sc: 1 },
  { id: 'batalha', ref: 'praca-batalha', la: 41.14517, lo: -8.60655, yaw: -1.2, sc: 1 },
  { id: 'sao-lazaro', ref: 'sao-lazaro', la: 41.1462, lo: -8.6029, yaw: 2.4, sc: 1 },
];

const LANE_KEEP_LITE = new Set([
  'plaque',
  'awning',
  'trampole',
  'bollard',
  'statueEquestrian',
  'statueStanding',
  'statueBust',
  'fountain',
  'column',
  'trafficlight',
  'signpost',
  'ornateLamp',
  'kiosk',
  'table',
  'umbrella',
]);
const CAP = {
  plaque: [80, 40],
  awning: [70, 34],
  trampole: [12, 12],
  bollard: [280, 130],
  balcony: [90, 0],
  walllamp: [64, 0],
  statueEquestrian: [3, 2],
  statueStanding: [6, 4],
  statueBust: [5, 4],
  fountain: [2, 1],
  column: [2, 1],
  trafficlight: [60, 20],
  signpost: [40, 14],
  utilitybox: [50, 18],
  ornateLamp: [48, 16],
  kiosk: [8, 4],
  table: [140, 48],
  umbrella: [110, 36],
};

// ------------------------------------------------------------ build
export function buildPortoStreetLife(ctx) {
  const { roads, project, heightAt, items = [], footprints = [], lite = false, camera, fx, model } = ctx;
  const net = buildNetwork(roads, project, heightAt);
  const { X, Z, Y, G, ways } = net;
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

  // ---- monuments, signals, lamps and terraces: placed from landmark anchors
  // and street names, on occupied-aware ground.
  // carriageways in a grid, so nothing lands on a live lane; only the
  // districts' bounding box is scanned
  let dx0 = Infinity;
  let dx1 = -Infinity;
  let dz0 = Infinity;
  let dz1 = -Infinity;
  for (const d of districts) {
    dx0 = Math.min(dx0, d.x - d.r);
    dx1 = Math.max(dx1, d.x + d.r);
    dz0 = Math.min(dz0, d.z - d.r);
    dz1 = Math.max(dz1, d.z + d.r);
  }
  const inBox = (x, z) => x >= dx0 && x <= dx1 && z >= dz0 && z <= dz1;
  const CAR_CELL = 8;
  const carGrid = new Map();
  const carPts = [];
  for (const w of ways) {
    if (!w.car || w.tunnel) continue;
    if (!inBox(X[w.start + (w.n >> 1)], Z[w.start + (w.n >> 1)])) continue;
    for (let i = w.start; i < w.start + w.n; i++) {
      if (Y[i] - G[i] > 1 || !inBox(X[i], Z[i])) continue;
      const key = Math.floor(X[i] / CAR_CELL) * 65536 + Math.floor(Z[i] / CAR_CELL);
      let c = carGrid.get(key);
      if (!c) carGrid.set(key, (c = []));
      c.push(carPts.length / 3);
      carPts.push(X[i], Z[i], (w.widthM / 2) * S);
    }
  }
  const carNear = (x, z, m = 0) => {
    for (let gx = Math.floor((x - m) / CAR_CELL); gx <= Math.floor((x + m) / CAR_CELL); gx++) {
      for (let gz = Math.floor((z - m) / CAR_CELL); gz <= Math.floor((z + m) / CAR_CELL); gz++) {
        for (const i of carGrid.get(gx * 65536 + gz) || []) {
          const o = i * 3;
          const dx = carPts[o] - x;
          const dz = carPts[o + 1] - z;
          const r = carPts[o + 2] + m;
          if (dx * dx + dz * dz < r * r) return true;
        }
      }
    }
    return false;
  };
  const openAt = (x, z, m = 0.3 * S) => Number.isFinite(heightAt(x, z)) && !bIdx.inside(x, z) && !carNear(x, z, m);
  // a footprint is clear: the centre and a ring around it
  const clearAround = (x, z, r, m = 0.3 * S) => {
    if (!openAt(x, z, m)) return false;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      if (!openAt(x + Math.cos(ang) * r, z + Math.sin(ang) * r, m)) return false;
    }
    return true;
  };
  const anchorPoint = (d) => {
    const it = (items || []).find((q) => q?.data?.id === d.ref);
    if (it) {
      const p = project(it.data.lat, it.data.lon);
      return { x: p.x + (d.dx || 0) * S, z: p.z + (d.dz || 0) * S };
    }
    return d.la != null ? project(d.la, d.lo) : null;
  };
  const monumentPoint = (m) => (m.la != null ? project(m.la, m.lo) : anchorPoint(m));

  // statues and monuments at their real squares and gardens
  let monuments = 0;
  for (const m of MONUMENTS) {
    if (!KEEP.has(m.type) || full(m.type)) continue;
    const p = monumentPoint(m);
    if (!p) continue;
    if (!clearAround(p.x, p.z, 0.9, 0.3 * S)) continue;
    put(m.type, p.x, heightAt(p.x, p.z), p.z, m.yaw || 0, m.sc || 1);
    monuments++;
  }
  // the Baixa kiosks on their usual corners
  let kiosks = 0;
  for (const k of KIOSKS) {
    if (!KEEP.has('kiosk') || full('kiosk')) break;
    const p = anchorPoint(k);
    if (!p || !clearAround(p.x, p.z, 1.0, 0.3 * S) || !spaced('kiosk', p.x, p.z, 8)) continue;
    put('kiosk', p.x, heightAt(p.x, p.z), p.z, k.yaw || 0, k.sc || 1);
    kiosks++;
  }
  // traffic lights and direction posts at the crossings in the centre
  const nodeWays = net.nodeWays;
  const wayAtNode = (wi, node) => {
    const w = ways[wi];
    let gp = -1;
    for (let k = 1; k < w.jp.length; k += 2) if (w.jp[k] === node) { gp = w.jp[k - 1]; break; }
    if (gp < 0) return null;
    const a = Math.max(w.start, gp - 1);
    const b = Math.min(w.start + w.n - 1, gp + 1);
    const tx = X[b] - X[a];
    const tz = Z[b] - Z[a];
    const L = Math.hypot(tx, tz) || 1;
    return { x: X[gp], z: Z[gp], tx: tx / L, tz: tz / L };
  };
  let signals = 0;
  let posts = 0;
  for (let n = 0; n < nodeWays.length; n++) {
    if ((full('trafficlight') || !KEEP.has('trafficlight')) && (full('signpost') || !KEEP.has('signpost'))) break;
    const nw = nodeWays[n];
    if (!nw || nw.length < 4) continue;
    if (!inBox(X[nw[1]], Z[nw[1]])) continue;
    const carSet = [];
    for (let k = 0; k < nw.length; k += 2) {
      const wi = nw[k];
      if (ways[wi].car && !ways[wi].tunnel && !carSet.includes(wi)) carSet.push(wi);
    }
    if (carSet.length < 2) continue;
    const base = wayAtNode(carSet[0], n);
    if (!base || !districtAt(base.x, base.z) || bIdx.inside(base.x, base.z)) continue;
    const nx = base.tz;
    const nz = -base.tx;
    const half = (ways[carSet[0]].widthM / 2) * S + 1.4 * S;
    for (const s of [1, -1]) {
      const x = base.x + nx * s * half;
      const z = base.z + nz * s * half;
      if (!openAt(x, z, 0.2 * S) || !spaced('trafficlight', x, z, 5)) continue;
      if (KEEP.has('trafficlight') && !full('trafficlight')) {
        put('trafficlight', x, heightAt(x, z), z, Math.atan2(-nx * s, -nz * s));
        signals++;
      }
      break;
    }
    if (carSet.length >= 3 && KEEP.has('signpost') && !full('signpost')) {
      const x = base.x - nx * half;
      const z = base.z - nz * half;
      if (openAt(x, z, 0.2 * S) && spaced('signpost', x, z, 14)) {
        put('signpost', x, heightAt(x, z), z, Math.atan2(nx, nz));
        posts++;
      }
    }
  }
  // ornate Aliados candelabra and Baixa lamps, on the pavement side
  let ornates = 0;
  for (const p of paths) {
    if (!KEEP.has('ornateLamp') || full('ornateLamp')) break;
    const d = districts.find((q) => q.id === p.district);
    if (!d || !d.baixa) continue;
    const step = /aliados/i.test(p.name) ? 8 : 22;
    let side = 1;
    for (let k = 6; k < p.x.length - 3; k += step) {
      const q = atSample(p, k);
      const nx = -q.tz * side;
      const nz = q.tx * side;
      side = -side;
      const x = q.x + nx * (p.half + 1.0 * S);
      const z = q.z + nz * (p.half + 1.0 * S);
      if (!openAt(x, z, 0.2 * S) || !spaced('ornateLamp', x, z, 12)) continue;
      put('ornateLamp', x, heightAt(x, z), z, Math.atan2(-nx, -nz));
      ornates++;
      if (full('ornateLamp')) break;
    }
  }
  // phone / substation cabinets against the Baixa facades
  let boxes = 0;
  for (const p of paths) {
    if (!KEEP.has('utilitybox') || full('utilitybox')) break;
    const d = districts.find((q) => q.id === p.district);
    if (!d || !d.baixa) continue;
    for (let k = 6; k < p.x.length - 3; k += 24) {
      const side = buildingSide(p, k, p.half);
      if (!side) continue;
      const q = atSample(p, k);
      const nx = -q.tz * side;
      const nz = q.tx * side;
      const x = q.x + nx * (p.half * 0.8);
      const z = q.z + nz * (p.half * 0.8);
      if (!openAt(x, z, 0.2 * S) || !spaced('utilitybox', x, z, 18)) continue;
      put('utilitybox', x, heightAt(x, z), z, Math.atan2(-nx, -nz));
      boxes++;
      if (full('utilitybox')) break;
    }
  }
  // café terraces: tables and parasols off the Baixa facades
  let tables = 0;
  for (const p of paths) {
    if ((!KEEP.has('table') && !KEEP.has('umbrella')) || (full('table') && full('umbrella'))) continue;
    const d = districts.find((q) => q.id === p.district);
    if (!d || !d.baixa) continue;
    for (let k = 5; k < p.x.length - 4; k += 7) {
      if (full('table') && full('umbrella')) break;
      const side = buildingSide(p, k, p.half);
      if (!side) continue;
      const q = atSample(p, k);
      const nx = -q.tz * side;
      const nz = q.tx * side;
      const tc = 1 + Math.floor(rnd() * 3);
      for (let j = 0; j < tc; j++) {
        const along = (j - (tc - 1) / 2) * 2.2 * S;
        const x = q.x + q.tx * along + nx * (p.half * 0.6);
        const z = q.z + q.tz * along + nz * (p.half * 0.6);
        if (!openAt(x, z, 0.25 * S) || !spaced('table', x, z, 3.2)) continue;
        const y = heightAt(x, z);
        const yaw = Math.atan2(q.tx, q.tz);
        if (KEEP.has('table') && !full('table')) {
          put('table', x, y, z, yaw);
          tables++;
        }
        if (KEEP.has('umbrella') && !full('umbrella') && rnd() < 0.8) put('umbrella', x, y, z, yaw, 1);
      }
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
    const colored = type === 'awning' || type === 'umbrella';
    if (colored) {
      mesh.setColorAt(0, type === 'umbrella' ? UMBRELLA_COLORS[0] : AWNING_COLORS[0]);
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
          if (L.colored) (L.type === 'umbrella' ? UMBRELLA_COLORS : AWNING_COLORS)[i % (L.type === 'umbrella' ? UMBRELLA_COLORS : AWNING_COLORS).length].toArray(mesh.instanceColor.array, k * 3);
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
      if (L.type === 'awning' || L.type === 'umbrella') L.mesh.visible = furnOn && L.shown > 0 && night < 0.6;
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
    monuments,
    signals,
    posts,
    ornates,
    boxes,
    kiosks,
    tables,
    furnitureTris: Math.round(tris),
    people: people?.stats ?? null,
    reducedMotion,
    lite,
    caps: CAP,
  };
  return { object: group, stats, paths, layers, live, update };
}
