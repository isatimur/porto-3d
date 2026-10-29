// Nature from OpenStreetMap (data/nature.json, fetched by
// scripts/fetch-nature.mjs): land cover painted into a mask texture the
// ground shader reads, instanced trees in the woods and parks, and water.
//
// Trees: every instance is a small clump (two or three crowns), so a few
// thousand instances read as woodland. Near the camera they are low-poly
// meshes that sway in the wind and cast shadows; farther out they switch to
// camera-facing billboards. The split is recomputed on the CPU when the
// camera moves, so the far set costs two triangles per clump.
//
// Trees never stand on a street, a building, a landmark or water: those
// are rasterised into an occupancy mask first and every candidate point is
// tested against it. A landmark that is itself a park (Palácio de Cristal,
// Parque da Cidade, Cordoaria...) keeps only its built core clear: the rest
// of its garden is planted like any park.
//
// The street trees, avenue rows and hedges of OSM (src/street-trees.js,
// data/trees.json) arrive a moment later and join the same instanced
// meshes; they have their own, shorter mesh radius and far cut-off.
import * as THREE from 'three';
import { S } from './geo.js';
import { FOG_UNIFORMS, WEATHER_UNIFORMS, CLOUD_GLSL, SEASON_GLSL } from './scene.js';
import { createWater } from './water.js';
import { CITY } from './city.js';
import { loadStreetTrees, plantStreetTrees, HEDGE } from './street-trees.js';

// ------------------------------------------------------------ tuning
const LAND_PX = 0.5; // land-cover mask: pixels per world unit (8 m per pixel)
const NEAR = 360; // world units (1.4 km): nearer clumps are meshes, farther billboards
const REPART_MOVE = 18; // re-split after the camera moved this far
// relative tree density per square metre, by land-cover kind
const DENSITY = { forest: 1, scrub: 0.45, park: 0.95, garden: 0.55, orchard: 0.85, vineyard: 0.7, grass: 0.03, farmland: 0.008 };
// the wooded sanctuary hills get more of the budget: they are the views
// (cities/<id>.json nature.hills: Braga's Bom Jesus do Monte and Sameiro)
const HILLS = () => CITY.nature?.hills || [];
const HILL_BOOST = 6;

// species: 0 maritime/stone pine, 1 eucalyptus, 2 broadleaf (oak, plane),
// 3 shrub (laurel), 4 a patch of closed woodland canopy (seven crowns),
// 5 cypress, 6 linden (avenue), 7 palm (Foz), 8 vine (Gaia terraces),
// 9 willow (Douro bank), 10 poplar (Douro bank), 11 reed (water margin),
// 12 jacaranda (gardens), 13 agapanthus (beds), 14 a clipped hedge block
// (OSM hedges only, src/street-trees.js; never a billboard). `bloom` is the
// spring / early-summer blossom tint the crown shader mixes in.
const SPECIES = [
  { h: [14, 22], w: 0.95, tint: 0x334221, trunk: 0x5a4030, bloom: 0xd66f85 },
  { h: [20, 32], w: 0.7, tint: 0x4d5a3a, trunk: 0x8c806c, bloom: 0xd66f85 },
  { h: [10, 18], w: 1.05, tint: 0x42592a, trunk: 0x54443a, bloom: 0xdfc9a6 },
  { h: [2.5, 4.5], w: 1.7, tint: 0x4d5a2c, trunk: 0x4a3e30, bloom: 0xd66f85 },
  { h: [15, 24], w: 1.9, tint: 0x384d24, trunk: 0x4f3d30, bloom: 0xd66f85 },
  { h: [9, 16], w: 0.42, tint: 0x2f4a2b, trunk: 0x5c4a36, bloom: 0xd66f85 },
  { h: [12, 20], w: 0.95, tint: 0x54702f, trunk: 0x6b5a44, bloom: 0xe3d29a },
  { h: [7, 13], w: 0.85, tint: 0x4a6132, trunk: 0x8a7a5e, bloom: 0xd66f85 },
  { h: [1.6, 3.2], w: 1.5, tint: 0x3f5a24, trunk: 0x4a3e30, bloom: 0xd66f85 },
  { h: [11, 19], w: 1.2, tint: 0x63744a, trunk: 0x6b6350, bloom: 0xd66f85 },
  { h: [16, 26], w: 0.52, tint: 0x5f7a34, trunk: 0x77705e, bloom: 0xd66f85 },
  { h: [1.8, 3.6], w: 1.35, tint: 0x707c42, trunk: 0x6a6034, bloom: 0xd6b46f },
  { h: [8, 14], w: 1.15, tint: 0x4a5a2e, trunk: 0x5c5144, bloom: 0x8f7bd6 },
  { h: [2, 3.8], w: 1.6, tint: 0x46662f, trunk: 0x4a3e30, bloom: 0x8f9fd6 },
  { h: [1.5, 2.1], w: 1, tint: 0x3d5a27, trunk: 0x3d5a27, bloom: 0x3d5a27 },
];
// Seasons (src/seasons.js, WEATHER_UNIFORMS.seasonW), per species:
//   pal:   crown colours, sRGB: spring, summer, autumn A, autumn B, winter
//          (for the deciduous crowns: the bare twig mass);
//   pal:   share of crowns that follow the palette (the rest stay evergreen);
//   bare:  share of crowns that drop their leaves: in winter they shrink to
//          half size and turn twig-grey, so the trunks show;
//   bloom: share of trees that blossom in spring (lime and fruit trees in
//          the avenues, gardens and orchards).
// Eucalyptus and the maritime pine stay green all year.
const SEASON_CROWNS = [
  { pal: [0x3c4d25, 0x334221, 0x34411f, 0x34411f, 0x2d3721], share: 1, bare: 0, bloom: 0 },
  { pal: [0x56653f, 0x4d5a3a, 0x4d5a3a, 0x4b5839, 0x48533b], share: 1, bare: 0, bloom: 0 },
  { pal: [0x587e38, 0x3c5625, 0xb87a2c, 0x8a4a22, 0x5e5249], share: 1, bare: 1, bloom: 0.6 },
  { pal: [0x607e33, 0x4a5829, 0x7e6a2e, 0x6a4a24, 0x524c36], share: 0.5, bare: 0.5, bloom: 0.4 },
  { pal: [0x52722c, 0x33491f, 0x86682e, 0x684824, 0x4f473b], share: 0.4, bare: 0.4, bloom: 0.12 },
  // cypress: evergreen, a touch darker and bluer than the pines
  { pal: [0x31492c, 0x2f4a2b, 0x2f4a2b, 0x2d452a, 0x2a3f28], share: 1, bare: 0, bloom: 0 },
  // linden: spring lime, summer green, gold autumn, bare grey twigs; blooms
  { pal: [0x7a9a44, 0x4e6a2e, 0xc39a36, 0x9a5a22, 0x5e5249], share: 1, bare: 1, bloom: 0.7 },
  // palm: evergreen, stays green through the year
  { pal: [0x45602c, 0x3f5a2c, 0x3f5a2c, 0x3d572b, 0x39512a], share: 1, bare: 0, bloom: 0 },
  // vine (Gaia terraces): green, rust-red autumn, thin in winter
  { pal: [0x5f7f36, 0x46602a, 0xa8482a, 0x83341f, 0x554d3d], share: 1, bare: 0.7, bloom: 0.1 },
  // willow (Douro bank): silvery spring, then green and a soft gold autumn
  { pal: [0x7e9152, 0x5f7440, 0xcdb44a, 0xa8822f, 0x6a6152], share: 1, bare: 0.9, bloom: 0 },
  // poplar (Douro bank): bright green, a clear golden-yellow autumn
  { pal: [0x88a848, 0x5f7a34, 0xe6bb3c, 0xc0832a, 0x6a6152], share: 1, bare: 1, bloom: 0 },
  // reed: green through summer, straw and tawny through autumn and winter
  { pal: [0x83914a, 0x717f3e, 0xb29a4c, 0x93793a, 0x776a3c], share: 1, bare: 0.15, bloom: 0.05 },
  // jacaranda: green, then bare; the violet blossom is the whole point
  { pal: [0x6f8f3e, 0x4e6a30, 0xb08a34, 0x7c5a26, 0x6a6152], share: 1, bare: 0.9, bloom: 1 },
  // agapanthus: low green clumps, blue-violet flower heads in early summer
  { pal: [0x4f7a34, 0x466a2c, 0x6e6a2c, 0x5a5228, 0x4a5230], share: 1, bare: 0.2, bloom: 1 },
  // hedge (box, laurel, privet): evergreen, clipped
  { pal: [0x46632b, 0x3d5a27, 0x3d5a27, 0x3b5626, 0x37502a], share: 0, bare: 0, bloom: 0 },
];
// Vines (8) only where OSM maps a vineyard: the Gaia and Douro banks inside
// the core have none, so no park, garden or orchard grows them.
const MIX = {
  forest: [0.14, 0.12, 0.04, 0, 0.7, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  scrub: [0.04, 0.04, 0.12, 0.8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  park: [0.14, 0.02, 0.37, 0, 0.12, 0.06, 0.06, 0, 0, 0.1, 0.08, 0, 0.05, 0],
  garden: [0.12, 0, 0.25, 0.12, 0, 0.06, 0.1, 0.12, 0, 0.04, 0.02, 0, 0.1, 0.07],
  orchard: [0, 0, 0.8, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  vineyard: [0, 0, 0.2, 0.05, 0, 0, 0, 0, 0.65, 0, 0, 0, 0, 0.1],
  grass: [0.15, 0.05, 0.55, 0.05, 0, 0.05, 0, 0, 0, 0.05, 0.05, 0, 0.05, 0],
  farmland: [0.1, 0.1, 0.8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};
const CELLS = SPECIES.length; // billboard atlas cells

function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function pickSpecies(mix, r) {
  let acc = 0;
  for (let i = 0; i < mix.length; i++) {
    acc += mix[i];
    if (r < acc) return i;
  }
  return 2;
}

const hash2 = (x, y) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

// Porto-native planting. This fork shows one city, so its districts live
// here; `CITY.nature.regions` overrides them (same shape). Each region
// remaps the *tree* species inside a circle, blending out over its radius,
// and never touches shrubs (3) or closed canopy (4): every species it can
// choose uses the same clump-footprint factor, so the budget (and the tree
// count, to a handful) is unchanged. `b` shifts the budget toward the
// district so its species actually read there.
//   Gaia bank and hills: the lodge gardens — stone pine, cypress, plane,
//     a few palms and jacarandas — and eucalyptus up the hills (no vines:
//     OSM maps no vineyard there).
//   Serra do Pilar: pine and cypress on the sanctuary hill.
//   Palácio de Cristal and Serralves: the old gardens — plane, lime,
//     cypress and cedar at Cristal; oak, liquidambar, lime and pine at
//     Serralves.
//   Parque da Cidade: umbrella pines with oaks, cypress, lakeside willows
//     and poplars.
//   Foz: palms at the mouth, pines behind, agapanthus in the beds.
//   Matosinhos / Leça coast: maritime pine and cypress on the dunes, with
//     reed at the Leça mouth; street gardens around the market and the câmara.
//   Aliados / Cordoaria / São Lázaro / Passeio Alegre: the gardens and
//     avenues — plane, linden, jacaranda accents, palms at the river mouth.
const PORTO_REGIONS = [
  { lat: 41.1375, lon: -8.614, r: 1600, b: 2.8, sp: [[0, 0.3], [5, 0.24], [2, 0.22], [1, 0.12], [7, 0.06], [12, 0.06]] },
  { lat: 41.1579, lon: -8.6291, r: 900, b: 1.6, sp: [[0, 0.6], [5, 0.4]] },
  // Palácio de Cristal gardens and Serralves park
  { lat: 41.1476, lon: -8.6262, r: 420, b: 3.2, sp: [[2, 0.36], [6, 0.2], [5, 0.2], [0, 0.12], [12, 0.06], [7, 0.06]] },
  { lat: 41.1585, lon: -8.6605, r: 520, b: 2.4, sp: [[2, 0.5], [6, 0.16], [0, 0.16], [5, 0.1], [10, 0.08]] },
  { lat: 41.163, lon: -8.677, r: 2000, b: 2.8, sp: [[0, 0.42], [2, 0.2], [5, 0.13], [9, 0.15], [10, 0.1]] },
  { lat: 41.149, lon: -8.679, r: 1500, b: 4, sp: [[7, 0.5], [0, 0.35], [13, 0.15]] },
  // Matosinhos and Leça da Palmeira: pine and cypress on the dunes
  { lat: 41.1815, lon: -8.686, r: 1500, b: 3.2, sp: [[0, 0.46], [5, 0.28], [2, 0.16], [11, 0.1]] },
  { lat: 41.1955, lon: -8.701, r: 1200, b: 2.6, sp: [[0, 0.4], [5, 0.34], [11, 0.16], [13, 0.1]] },
  // Matosinhos town: garden and street trees around the market and the câmara
  { lat: 41.1845, lon: -8.6895, r: 850, b: 3.5, sp: [[6, 0.3], [2, 0.28], [12, 0.17], [7, 0.13], [13, 0.12]] },
  { lat: 41.1487, lon: -8.6125, r: 900, b: 6, sp: [[6, 0.65], [2, 0.2], [12, 0.15]] },
  // the three gardens: Cordoaria, São Lázaro, Passeio Alegre
  { lat: 41.1452, lon: -8.6147, r: 300, b: 6, sp: [[2, 0.42], [6, 0.28], [12, 0.18], [13, 0.12]] },
  { lat: 41.1468, lon: -8.6073, r: 260, b: 6, sp: [[2, 0.5], [6, 0.28], [13, 0.22]] },
  { lat: 41.148, lon: -8.679, r: 380, b: 5, sp: [[7, 0.55], [2, 0.25], [6, 0.2]] },
];

function regionSpecies(s, x, z, regions) {
  if (!regions.length || s === 3 || s === 4) return s; // keep shrubs and canopy
  let best = null;
  let bw = 0;
  for (const g of regions) {
    const d = Math.hypot(x - g.x, z - g.z);
    if (d < g.r) {
      const w = 1 - d / g.r;
      if (w > bw) {
        bw = w;
        best = g;
      }
    }
  }
  if (!best) return s;
  if (hash2(x * 0.13 + 7.1, z * 0.13 - 3.7) > bw) return s; // soft edge
  const roll = hash2(x * 0.71 - 11.3, z * 0.37 + 5.9);
  let acc = 0;
  for (const [sp, w] of best.sp) {
    acc += w;
    if (roll < acc) return sp;
  }
  return best.sp[best.sp.length - 1][0];
}

// Ray-cast point in polygon with holes; rings = [[{x,z}]].
function inRings(x, z, rings) {
  let inside = false;
  for (const poly of rings) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
  }
  return inside;
}

function ringArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x + poly[i].x) * (poly[j].z - poly[i].z);
  return Math.abs(a) / 2;
}

// ------------------------------------------------------------ geometry
// A crown: an icosahedron squashed to an ellipsoid, normals pointing out
// from its centre (soft, rounded shading), jittered so no two look alike.
function crown(geos, cx, cy, cz, rx, ry, seed, color) {
  const g = new THREE.IcosahedronGeometry(1, 0); // already non-indexed
  const r = lcg(seed);
  const p = g.attributes.position;
  const n = new Float32Array(p.count * 3);
  const c = new Float32Array(p.count * 3);
  const k = new Float32Array(p.count);
  // crown centre (unit clump space) and a per-crown random: the winter
  // shrink and the per-crown autumn colour read them
  const ctr = new Float32Array(p.count * 4);
  const cr = r();
  for (let i = 0; i < p.count; i++) ctr.set([cx, cy, cz, cr], i * 4);
  // jitter the shared corners consistently: key by rounded position
  const jit = new Map();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    if (!jit.has(key)) jit.set(key, 0.82 + r() * 0.36);
    const j = jit.get(key);
    p.setXYZ(i, cx + x * rx * j, cy + y * ry * j, cz + z * rx * j);
    const l = Math.hypot(x, y * 0.8, z) || 1;
    n[i * 3] = x / l;
    n[i * 3 + 1] = (y * 0.8) / l + 0.25;
    n[i * 3 + 2] = z / l;
    const shade = 0.62 + 0.48 * (y * 0.5 + 0.5); // darker underneath
    c[i * 3] = color.r * shade;
    c[i * 3 + 1] = color.g * shade;
    c[i * 3 + 2] = color.b * shade;
    k[i] = 1;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aCrown', new THREE.BufferAttribute(k, 1));
  g.setAttribute('aCenter', new THREE.BufferAttribute(ctr, 4));
  geos.push(g);
}

// Trunks reach 0.25 (a quarter of the clump height) below the base, so on a
// hillside the downhill trunks of a clump still meet the ground.
const TRUNK_FOOT = 0.25;
function trunk(geos, x, z, h, r, color) {
  const g = new THREE.CylinderGeometry(r * 0.7, r, h + TRUNK_FOOT, 4, 1, true).toNonIndexed();
  g.translate(x, (h - TRUNK_FOOT) / 2, z);
  const count = g.attributes.position.count;
  const c = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    c[i * 3] = color.r;
    c[i * 3 + 1] = color.g;
    c[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aCrown', new THREE.BufferAttribute(new Float32Array(count), 1));
  // w < 0: a trunk, never shrinks
  const ctr = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) ctr.set([x, 0, z, -1], i * 4);
  g.setAttribute('aCenter', new THREE.BufferAttribute(ctr, 4));
  geos.push(g);
}

function merge(geos) {
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3], ['aCrown', 1], ['aCenter', 4]]) {
    const arr = new Float32Array(n * size);
    let o = 0;
    for (const g of geos) {
      arr.set(g.attributes[name].array, o);
      o += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  for (const g of geos) g.dispose();
  out.computeBoundingSphere();
  return out;
}

// Unit clumps: height 1 (the tallest crown top), footprint about the
// species width ratio. White crown colour; the instance tint colours it.
function clumpGeometry(species) {
  const geos = [];
  const white = new THREE.Color(1, 1, 1);
  const bark = new THREE.Color(SPECIES[species].trunk);
  const r = lcg(101 + species * 17);
  if (species === 0) {
    // maritime pine: tall bare trunks, umbrella crowns at the top
    const spots = [[0, 0, 1], [0.26, 0.14, 0.84], [-0.18, -0.24, 0.9], [0.06, -0.34, 0.8]];
    for (const [x, z, h] of spots) {
      trunk(geos, x, z, h * 0.8, 0.022, bark);
      crown(geos, x, h * 0.86, z, 0.2, 0.11, r() * 1e6, white);
    }
  } else if (species === 1) {
    // eucalyptus: slender trunks, tall loose crowns
    const spots = [[0, 0, 1], [0.2, 0.12, 0.82], [-0.14, -0.18, 0.9], [0.1, -0.3, 0.76]];
    for (const [x, z, h] of spots) {
      trunk(geos, x, z, h * 0.5, 0.016, bark);
      crown(geos, x, h * 0.72, z, 0.13, 0.28, r() * 1e6, white);
    }
  } else if (species === 2) {
    // broadleaf: short trunk, one broad crown and two smaller lobes
    trunk(geos, 0, 0, 0.42, 0.035, bark);
    crown(geos, 0, 0.62, 0, 0.42, 0.36, r() * 1e6, white);
    crown(geos, 0.3, 0.5, 0.18, 0.26, 0.24, r() * 1e6, white);
    crown(geos, -0.24, 0.48, -0.2, 0.24, 0.22, r() * 1e6, white);
  } else if (species === 3) {
    // shrubs: three low blobs
    crown(geos, 0, 0.45, 0, 0.5, 0.45, r() * 1e6, white);
    crown(geos, 0.55, 0.32, 0.2, 0.36, 0.32, r() * 1e6, white);
    crown(geos, -0.3, 0.3, -0.45, 0.34, 0.3, r() * 1e6, white);
  } else if (species === 5) {
    // cypress: a narrow dark column, two stacked crowns on a short trunk
    trunk(geos, 0, 0, 0.26, 0.018, bark);
    crown(geos, 0, 0.36, 0, 0.15, 0.22, r() * 1e6, white);
    crown(geos, 0.02, 0.68, -0.01, 0.12, 0.32, r() * 1e6, white);
  } else if (species === 6) {
    // linden: a tall, rounded avenue crown and two shoulders
    trunk(geos, 0, 0, 0.34, 0.03, bark);
    crown(geos, 0, 0.66, 0, 0.4, 0.34, r() * 1e6, white);
    crown(geos, 0.24, 0.56, 0.16, 0.24, 0.22, r() * 1e6, white);
    crown(geos, -0.2, 0.53, -0.14, 0.22, 0.2, r() * 1e6, white);
  } else if (species === 7) {
    // palm: bare trunk, a fan of flat fronds at the top
    trunk(geos, 0, 0, 0.68, 0.024, bark);
    const N = 7;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + 0.35;
      crown(geos, Math.cos(a) * 0.17, 0.82, Math.sin(a) * 0.17, 0.22, 0.05, r() * 1e6, white);
    }
    crown(geos, 0, 0.9, 0, 0.17, 0.06, r() * 1e6, white);
  } else if (species === 8) {
    // vine row (Gaia terraces): a low trellis of small crowns in a line
    for (const x of [-0.6, -0.3, 0, 0.3, 0.6]) {
      crown(geos, x, 0.42 + r() * 0.12, 0, 0.13, 0.3, r() * 1e6, white);
    }
  } else if (species === 9) {
    // willow (Douro bank): a broad silver dome, lowest lobes trailing
    trunk(geos, 0, 0, 0.3, 0.03, bark);
    crown(geos, 0, 0.6, 0, 0.5, 0.4, r() * 1e6, white);
    crown(geos, 0.34, 0.5, 0.16, 0.3, 0.26, r() * 1e6, white);
    crown(geos, -0.3, 0.48, -0.2, 0.28, 0.24, r() * 1e6, white);
    crown(geos, 0.02, 0.4, 0.28, 0.26, 0.2, r() * 1e6, white);
  } else if (species === 10) {
    // poplar (Douro bank): a tall, narrow column on a straight trunk
    trunk(geos, 0, 0, 0.56, 0.02, bark);
    crown(geos, 0, 0.74, 0, 0.2, 0.32, r() * 1e6, white);
    crown(geos, 0, 0.48, 0, 0.23, 0.26, r() * 1e6, white);
    crown(geos, 0.12, 0.62, 0.04, 0.12, 0.2, r() * 1e6, white);
  } else if (species === 11) {
    // reed (water margin): a tuft of tall thin blades, no trunk
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + r() * 0.8;
      const d = 0.06 + r() * 0.2;
      crown(geos, Math.cos(a) * d, 0.4 + r() * 0.35, Math.sin(a) * d, 0.06 + r() * 0.04, 0.32 + r() * 0.18, r() * 1e6, white);
    }
  } else if (species === 12) {
    // jacaranda: a broad, flat-topped umbrella crown over a short trunk
    trunk(geos, 0, 0, 0.38, 0.032, bark);
    crown(geos, 0, 0.6, 0, 0.5, 0.28, r() * 1e6, white);
    crown(geos, 0.32, 0.54, 0.14, 0.3, 0.22, r() * 1e6, white);
    crown(geos, -0.26, 0.52, -0.18, 0.28, 0.2, r() * 1e6, white);
  } else if (species === 13) {
    // agapanthus: a low rounded bed, no trunk, flower heads on top
    crown(geos, 0, 0.42, 0, 0.44, 0.36, r() * 1e6, white);
    crown(geos, 0.5, 0.32, 0.18, 0.3, 0.28, r() * 1e6, white);
    crown(geos, -0.36, 0.3, -0.32, 0.28, 0.26, r() * 1e6, white);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.6;
      crown(geos, Math.cos(a) * 0.22, 0.66, Math.sin(a) * 0.22, 0.1, 0.13, r() * 1e6, white);
    }
  } else if (species === 14) {
    // clipped hedge: a unit block (1 x 1 x 1, base at 0) the instance
    // stretches along its piece; no bottom face. One "crown" so it takes
    // the season colour; darker toward the foot like the crowns.
    const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    g.translate(0, 0.5, 0);
    const p = g.attributes.position;
    const nrm = g.attributes.normal;
    const keep = [];
    for (let t = 0; t < p.count; t += 3) if (nrm.getY(t) > -0.5) keep.push(t);
    const n = keep.length * 3;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    let o = 0;
    for (const t of keep) {
      for (let v = t; v < t + 3; v++, o++) {
        pos.set([p.getX(v), p.getY(v), p.getZ(v)], o * 3);
        // a soft, slightly upward normal: a leafy surface, not a wall
        const nx = nrm.getX(v);
        const ny = nrm.getY(v) + 0.35;
        const nz = nrm.getZ(v);
        const l = Math.hypot(nx, ny, nz) || 1;
        nor.set([nx / l, ny / l, nz / l], o * 3);
        const shade = 0.66 + 0.4 * p.getY(v);
        col.set([shade, shade, shade], o * 3);
      }
    }
    const h = new THREE.BufferGeometry();
    h.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    h.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    h.setAttribute('color', new THREE.BufferAttribute(col, 3));
    h.setAttribute('aCrown', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
    const ctr = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) ctr.set([0, 0.5, 0, 0.5], i * 4);
    h.setAttribute('aCenter', new THREE.BufferAttribute(ctr, 4));
    g.dispose();
    geos.push(h);
  } else {
    // closed canopy: seven crowns of mixed height on a disc; the trunks
    // are hidden under it, two short ones show at the edge
    const spots = [[0, 0, 1], [0.52, 0.18, 0.86], [-0.46, 0.3, 0.92], [0.12, 0.6, 0.8], [-0.2, -0.52, 0.9], [0.5, -0.4, 0.84], [-0.62, -0.18, 0.78]];
    spots.forEach(([x, z, h], i) => {
      if (i === 1 || i === 6) trunk(geos, x, z, h * 0.6, 0.024, bark);
      const wide = i % 3 === 0;
      crown(geos, x, h * (wide ? 0.74 : 0.7), z, wide ? 0.34 : 0.3, wide ? 0.26 : 0.3, r() * 1e6, white);
    });
  }
  return merge(geos);
}

// Billboard atlas: one cell per species, grey shading with alpha;
// the instance tint colours it in the shader.
function billboardAtlas() {
  const W = 128;
  const H = 128;
  const cv = document.createElement('canvas');
  cv.width = W * CELLS;
  cv.height = H;
  const ctx = cv.getContext('2d');
  const r = lcg(9);
  const blob = (x, y, rx, ry) => {
    const g = ctx.createRadialGradient(x - rx * 0.35, y - ry * 0.45, rx * 0.1, x, y, Math.max(rx, ry));
    g.addColorStop(0, 'rgb(255,255,255)');
    g.addColorStop(0.7, 'rgb(170,170,170)');
    g.addColorStop(1, 'rgb(105,105,105)');
    ctx.fillStyle = g;
    ctx.beginPath();
    // lumpy outline
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const k = 0.86 + r() * 0.2;
      const px = x + Math.cos(a) * rx * k;
      const py = y + Math.sin(a) * ry * k;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.fill();
  };
  const stem = (x, y0, y1, w, shade) => {
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    ctx.fillRect(x - w / 2, y1, w, y0 - y1);
  };
  const cell = (i, draw) => {
    ctx.save();
    ctx.translate(i * W, 0);
    draw();
    ctx.restore();
  };
  // y grows downward: the ground line is at H
  cell(0, () => {
    for (const [x, h] of [[64, 1], [92, 0.84], [42, 0.9]]) {
      stem(x, H, H - H * h * 0.82, 3, 120);
      blob(x, H - H * h * 0.86, 22, 11);
    }
  });
  cell(1, () => {
    for (const [x, h] of [[64, 1], [86, 0.82], [46, 0.9]]) {
      stem(x, H, H - H * h * 0.6, 2, 200);
      blob(x, H - H * h * 0.7, 13, 24);
      blob(x + 3, H - H * h * 0.88, 10, 13);
    }
  });
  cell(2, () => {
    stem(64, H, H - 50, 5, 110);
    blob(64, H - 78, 46, 40);
    blob(92, H - 62, 26, 26);
  });
  cell(3, () => {
    blob(64, H - 34, 34, 30);
    blob(98, H - 24, 22, 20);
    blob(40, H - 22, 22, 19);
  });
  cell(4, () => {
    // a canopy patch seen from the side: a lumpy band of crowns
    for (const [x, h, rx] of [[18, 0.72, 18], [40, 0.86, 20], [64, 1, 22], [88, 0.84, 20], [110, 0.74, 17]]) {
      stem(x, H, H - H * h * 0.5, 3, 105);
      blob(x, H - H * h * 0.68, rx, H * h * 0.3);
    }
  });
  cell(5, () => {
    // cypress: a slender column
    stem(64, H, H - 30, 2, 110);
    blob(64, H - 58, 15, 44);
    blob(64, H - 96, 11, 24);
  });
  cell(6, () => {
    // linden: a tall rounded avenue crown
    stem(64, H, H - 44, 4, 120);
    blob(64, H - 84, 40, 42);
    blob(92, H - 66, 24, 26);
    blob(38, H - 62, 22, 24);
  });
  cell(7, () => {
    // palm: a bare stem under a fan of fronds
    stem(64, H, H - 68, 4, 170);
    for (const [x, y, rx, ry] of [[40, 62, 24, 7], [64, 56, 26, 7], [88, 62, 24, 7], [52, 76, 18, 6], [78, 76, 18, 6]]) blob(x, H - y, rx, ry);
  });
  cell(8, () => {
    // vine row: a low line of small crowns
    for (const x of [16, 40, 64, 88, 112]) blob(x, H - 30, 15, 22);
  });
  cell(9, () => {
    // willow: a broad silver dome with trailing lower lobes
    stem(64, H, H - 40, 4, 130);
    blob(64, H - 80, 48, 40);
    blob(96, H - 58, 26, 24);
    blob(34, H - 56, 24, 22);
  });
  cell(10, () => {
    // poplar: a tall narrow column
    stem(64, H, H - 58, 3, 150);
    blob(64, H - 92, 17, 40);
    blob(64, H - 54, 20, 30);
  });
  cell(11, () => {
    // reed: a tuft of tall thin blades
    for (const [x, h] of [[40, 0.8], [50, 0.95], [60, 0.86], [72, 1], [84, 0.82], [92, 0.9]]) {
      stem(x, H, H - H * h, 2, 150);
      blob(x, H - H * h, 4, 12);
    }
  });
  cell(12, () => {
    // jacaranda: a broad flat-topped umbrella
    stem(64, H, H - 46, 4, 120);
    blob(64, H - 82, 46, 30);
    blob(96, H - 70, 24, 20);
    blob(34, H - 68, 24, 20);
  });
  cell(13, () => {
    // agapanthus: a low bed with flower heads on top
    blob(64, H - 30, 40, 28);
    blob(102, H - 22, 22, 18);
    blob(28, H - 20, 22, 17);
    for (const x of [46, 64, 84]) blob(x, H - 52, 8, 12);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

// ------------------------------------------------------------ build
// opts: { data, project, heightAt, rect: {x0,zN,x1,zS}, roads, buildings,
//         avoid: { outlines: [[{x,z}]], plans: [{cx,cz,ux,uz,hu,hv}], boxes: [Box3] },
//         budget, mobile }
// Tree kinds for the streamed tiles (src/tile-worker.js scatters their
// trees with the same heights, mixes and densities).
export const TREE_TABLES = { heights: SPECIES.map((s) => s.h), mix: MIX, density: DENSITY };

// a canvas path through rings of { x, z } points (world units)
const path = (ctx, rings) => {
  ctx.beginPath();
  for (const ring of rings) {
    ring.forEach((p, i) => (i ? ctx.lineTo(p.x, p.z) : ctx.moveTo(p.x, p.z)));
    ctx.closePath();
  }
};

// The cheap first half of the nature layer: the land-cover mask the ground
// shader reads (woods, grass, fields; the built-up channel is painted later
// by paintBuilt, once the buildings exist) and the water (sea, Douro, ponds).
// main.js builds it before the first frame, so the boot view already has a
// coloured ground and water; buildNature(opts with base) adds the trees.
export function buildNatureBase(opts) {
  const { data, project, heightAt } = opts;
  if (!data || !Array.isArray(data.areas)) return null;
  // The masks cover the core only, the area of nature.json: the terrain
  // rectangle may reach far past it (the streamed tiles bring their own).
  let rect = opts.rect;
  if (data.bbox) {
    const sw = project(data.bbox.s, data.bbox.w);
    const ne = project(data.bbox.n, data.bbox.e);
    rect = { x0: Math.max(rect.x0, sw.x), x1: Math.min(rect.x1, ne.x), zN: Math.max(rect.zN, ne.z), zS: Math.min(rect.zS, sw.z) };
  }

  // ---- project
  const areas = [];
  for (const a of data.areas) {
    if (!Array.isArray(a.r) || !a.r.length) continue;
    const rings = a.r.map((ring) => ring.map((q) => project(q[0], q[1]))).filter((r) => r.length >= 3);
    if (!rings.length) continue;
    const area = Math.max(0, ringArea(rings[0]) - rings.slice(1).reduce((s, r) => s + ringArea(r), 0));
    areas.push({ k: a.k, rings, area, open: a.o === 1 });
  }

  const W = rect.x1 - rect.x0;
  const D = rect.zS - rect.zN;

  // ---- land-cover mask (R forest, G green, B fields, A built-up)
  const lw = Math.ceil(W * LAND_PX);
  const lh = Math.ceil(D * LAND_PX);
  const layer = () => {
    const cv = document.createElement('canvas');
    cv.width = lw;
    cv.height = lh;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.setTransform(LAND_PX, 0, 0, LAND_PX, -rect.x0 * LAND_PX, -rect.zN * LAND_PX);
    return { cv, ctx };
  };
  const fillKinds = (ctx, kinds) => {
    for (const a of areas) {
      const v = kinds[a.k];
      if (v == null) continue;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      path(ctx, a.rings);
      ctx.fill('evenodd');
    }
  };
  const Lf = layer();
  fillKinds(Lf.ctx, { scrub: 150, forest: 255 });
  const Lg = layer();
  fillKinds(Lg.ctx, { grass: 200, park: 225, garden: 235 });
  const Lb = layer();
  fillKinds(Lb.ctx, { orchard: 85, vineyard: 170, farmland: 255 });
  const px = lw * lh;
  const mask = new Uint8Array(px * 4);
  const rd = (L) => L.ctx.getImageData(0, 0, lw, lh).data;
  const f = rd(Lf);
  const g = rd(Lg);
  const b = rd(Lb);
  for (let i = 0; i < px; i++) {
    mask[i * 4] = f[i * 4];
    mask[i * 4 + 1] = g[i * 4];
    mask[i * 4 + 2] = b[i * 4];
  }
  // the built-up channel (A): painted from the building outlines once they
  // exist (the boot view starts without it)
  let builtDone = false;
  // urban: oriented rectangles { cx, cz, ux, uz, hu, hv } (world units) of
  // landmark sites in the city: the OSM buildings under a landmark are
  // skipped, so without these the station square or the church forecourt
  // would read as a lawn
  const paintBuilt = (buildings, urban = []) => {
    if (builtDone || !buildings?.length) return;
    builtDone = true;
    const Lu = layer();
    Lu.ctx.fillStyle = '#fff';
    Lu.ctx.strokeStyle = '#fff';
    Lu.ctx.lineWidth = 3 / LAND_PX;
    for (const poly of buildings) {
      path(Lu.ctx, [poly]);
      Lu.ctx.fill();
      Lu.ctx.stroke();
    }
    for (const r of urban) {
      const vx = -r.uz; // across the long axis
      const vz = r.ux;
      const corner = (a, c) => ({ x: r.cx + r.ux * a * r.hu + vx * c * r.hv, z: r.cz + r.uz * a * r.hu + vz * c * r.hv });
      path(Lu.ctx, [[corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]]);
      Lu.ctx.fill();
    }
    const u = blur(rd(Lu), lw, lh, 3);
    for (let i = 0; i < px; i++) mask[i * 4 + 3] = Math.min(255, u[i] * 1.6);
    landcover.needsUpdate = true;
  };
  // The gravel walks of the parks (src/street-trees.js): a pale line through
  // the lawn, painted after the blur of the built-up channel so it stays
  // sharp. The mask has 8 m pixels, so a walk reads from a distance only.
  const paintWalks = (lines) => {
    const Lw = layer();
    Lw.ctx.strokeStyle = '#fff';
    Lw.ctx.lineWidth = 1 / LAND_PX;
    Lw.ctx.lineCap = 'round';
    Lw.ctx.lineJoin = 'round';
    for (const pts of lines) {
      if (pts.length < 2) continue;
      Lw.ctx.beginPath();
      pts.forEach((p, i) => (i ? Lw.ctx.lineTo(p.x, p.z) : Lw.ctx.moveTo(p.x, p.z)));
      Lw.ctx.stroke();
    }
    const w = rd(Lw);
    for (let i = 0; i < px; i++) {
      const v = w[i * 4 + 3]; // coverage (the canvas is transparent elsewhere)
      if (!v || mask[i * 4 + 1] < 150) continue; // only through lawns
      mask[i * 4 + 3] = Math.max(mask[i * 4 + 3], v * 0.8);
      mask[i * 4 + 1] = Math.round(mask[i * 4 + 1] * (1 - (v / 255) * 0.75));
    }
    landcover.needsUpdate = true;
  };
  // canvas rows run north to south, as do world z; no flip needed
  const landcover = new THREE.DataTexture(mask, lw, lh, THREE.RGBAFormat);
  landcover.flipY = false;
  landcover.magFilter = THREE.LinearFilter;
  landcover.minFilter = THREE.LinearMipmapLinearFilter;
  landcover.generateMipmaps = true;
  landcover.anisotropy = 4; // read across the whole ground at grazing angles
  landcover.colorSpace = THREE.NoColorSpace;
  landcover.needsUpdate = true;
  // uv = (world - rect origin) / size: rows from zN downward
  const landRect = { x0: rect.x0, z0: rect.zN, w: lw / LAND_PX, d: lh / LAND_PX };

  // ---- water: river ribbons and pond / reservoir polygons (src/water.js)
  // (the lite scene draws one flat plane instead: opts.noWater)
  let water = opts.noWater ? null : createWater({ data, areas, project, heightAt });
  return {
    rect,
    areas,
    landcover,
    landRect,
    landPx: `${lw}x${lh}`,
    get water() {
      return water;
    },
    paintBuilt,
    paintWalks,
    // the landmark pads change the ground under the banks after the first
    // build: make the water again on the final heights and swap it in
    rebuildWater(parent) {
      if (opts.noWater) return;
      const old = water;
      water = createWater({ data, areas, project, heightAt });
      if (old?.mesh) {
        parent?.remove(old.mesh);
        old.mesh.geometry.dispose();
        old.mesh.material.dispose?.();
      }
      if (water && parent) parent.add(water.mesh);
    },
  };
}

export function buildNature(opts) {
  const { data, project, heightAt } = opts;
  const group = new THREE.Group();
  group.name = 'nature';
  const stats = { areas: 0, trees: 0, near: 0, far: 0, water: 0, rejected: 0, landPx: '', stream: 0, bank: 0, coast: 0, species: [] };
  const uniforms = {
    uTime: { value: 0 },
    uSunView: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    // x, y: the world x, z direction the wind blows toward; z: its
    // strength (1 is about 7 m/s)
    uWind: { value: new THREE.Vector3(0.93, -0.37, 0.85) },
    // how far autumn has gone on today's date (see fallProgress)
    uTurn: { value: fallProgress() },
  };
  stats.turn = [+uniforms.uTurn.value.x.toFixed(2), +uniforms.uTurn.value.y.toFixed(2)];
  const base = opts.base || buildNatureBase(opts);
  if (!base) return { group, stats, landcover: null, update() {}, uniforms, setStreamTrees() {}, setNearRadius() {} };
  const { rect, areas, landcover, landRect, water } = base;
  base.paintBuilt(opts.buildings);
  stats.areas = areas.length;
  stats.landPx = base.landPx;
  // room for the streamed trees of the tiles around the core
  const STREAM = opts.streamCap ?? (opts.mobile ? 2500 : 8000);
  const W = rect.x1 - rect.x0;
  const D = rect.zS - rect.zN;

  // ---- occupancy: where no tree may stand (1 px per world unit)
  const OCC = opts.mobile ? 0.5 : 1;
  const ow = Math.ceil(W * OCC);
  const oh = Math.ceil(D * OCC);
  const tOcc = performance.now();
  const occCv = document.createElement('canvas');
  occCv.width = ow;
  occCv.height = oh;
  const oc = occCv.getContext('2d', { willReadFrequently: true });
  oc.setTransform(OCC, 0, 0, OCC, -rect.x0 * OCC, -rect.zN * OCC);
  oc.fillStyle = '#fff';
  oc.strokeStyle = '#fff';
  oc.lineCap = 'round';
  oc.lineJoin = 'round';
  // Two masks in one canvas: red is the woods' and parks' test (streets
  // with a verge), green the street trees' (the carriageway alone: a
  // pavement tree stands a metre from the kerb). Everything else is white.
  const ROAD_M = { primary: 8 + 8, secondary: 5 + 6, minor: 3 + 5, rail: 3 + 6, water: 10, foot: 2 + 2 };
  const CARRIAGE_M = { primary: 8, secondary: 6, minor: 4, rail: 4, water: 10, foot: 1.5 };
  const strokeRoads = (widths, style) => {
    oc.strokeStyle = style;
    for (const feat of opts.roads?.features || []) {
      const wM = widths[feat.kind];
      if (!wM || !Array.isArray(feat.pts) || feat.pts.length < 2) continue;
      // a pedestrian street or a footway is no carriageway: its mapped trees stand
      if (widths === CARRIAGE_M && (feat.kind === 'foot' || feat.t?.hw === 'pedestrian')) continue;
      // the real carriageway: OSM lanes where mapped
      const lanes = feat.t?.ln || 0;
      oc.lineWidth = Math.max(wM, widths === CARRIAGE_M ? lanes * 3.2 + 1 : wM) * S;
      oc.beginPath();
      feat.pts.forEach((q, i) => {
        const p = project(q[0], q[1]);
        if (i) oc.lineTo(p.x, p.z);
        else oc.moveTo(p.x, p.z);
      });
      oc.stroke();
    }
  };
  strokeRoads(ROAD_M, '#f00');
  strokeRoads(CARRIAGE_M, '#fff');
  // buildings: a 4 m margin for the woods, 1.5 m for a pavement tree
  // (in batches of 48: one huge path strokes very slowly, one call per
  // building costs the most calls)
  const blds = opts.buildings || [];
  for (let b0 = 0; b0 < blds.length; b0 += 48) {
    const bp = new Path2D();
    for (let b = b0; b < Math.min(blds.length, b0 + 48); b++) {
      blds[b].forEach((p, i) => (i ? bp.lineTo(p.x, p.z) : bp.moveTo(p.x, p.z)));
      bp.closePath();
    }
    oc.strokeStyle = '#f00';
    oc.lineWidth = 2;
    oc.stroke(bp);
    oc.strokeStyle = '#fff';
    oc.lineWidth = 0.75;
    oc.fill(bp);
    oc.stroke(bp);
  }
  // Landmarks: their OSM outlines, fitted plans and model boxes, with a
  // margin. A landmark that is a park or garden (most of its ground is
  // green in the land cover) keeps only its built core clear.
  const lc = landcover.image.data;
  const lw = landcover.image.width;
  const lh = landcover.image.height;
  // 1 green, 0 not, -1 off the land-cover map (not counted)
  const greenAt = (x, z) => {
    const i = Math.floor((x - landRect.x0) * (lw / landRect.w));
    const j = Math.floor((z - landRect.z0) * (lh / landRect.d));
    if (i < 0 || j < 0 || i >= lw || j >= lh) return -1;
    const k = (j * lw + i) * 4;
    return lc[k] > 100 || lc[k + 1] > 150 ? 1 : 0;
  };
  const GREEN_SITE = 300; // world units² (~0.5 ha)
  const greenShare = (pts, test) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    const st = Math.max(1, Math.sqrt(((x1 - x0) * (z1 - z0)) / 400));
    let n = 0;
    let g = 0;
    for (let x = x0 + st / 2; x < x1; x += st) {
      for (let z = z0 + st / 2; z < z1; z += st) {
        if (!test(x, z)) continue;
        const v = greenAt(x, z);
        if (v < 0) continue;
        n++;
        g += v;
      }
    }
    return n ? g / n : 0;
  };
  const parkSites = [];
  // the park landmarks' outlines: past the edge of the core (Parque da
  // Cidade reaches the sea) their ground is still open to trees
  const parkOutlines = [];
  oc.lineWidth = 6;
  for (const poly of opts.avoid?.outlines || []) {
    if (ringArea(poly) > GREEN_SITE && greenShare(poly, (x, z) => inRings(x, z, [poly])) > 0.55) {
      parkSites.push({ kind: 'outline', at: [Math.round(poly[0].x), Math.round(poly[0].z)], area: Math.round(ringArea(poly)) });
      const xs = poly.map((p) => p.x);
      const zs = poly.map((p) => p.z);
      parkOutlines.push({ poly, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) });
      continue;
    }
    path(oc, [poly]);
    oc.fill();
    oc.stroke();
  }
  // an oriented rectangle, or for a park site its core (the pavilion, the
  // museum, the lawn the model lays out itself)
  const fillRect = (cx, cz, ux, uz, hu, hv) => {
    const corners = [[hu, hv], [-hu, hv], [-hu, -hv], [hu, -hv]].map(([a, c]) => ({ x: cx + a * ux - c * uz, z: cz + a * uz + c * ux }));
    if (hu * hv * 4 > GREEN_SITE && greenShare(corners, (x, z) => inRings(x, z, [corners])) > 0.55) {
      // at least 56 m, at most 120 m each way from the centre
      hu = Math.min(hu, Math.max(14, Math.min(30, hu * 0.42)));
      hv = Math.min(hv, Math.max(14, Math.min(30, hv * 0.42)));
      parkSites.push({ kind: 'rect', at: [Math.round(cx), Math.round(cz)], core: [Math.round(hu / S), Math.round(hv / S)] });
      const core = [[hu, hv], [-hu, hv], [-hu, -hv], [hu, -hv]].map(([a, c]) => ({ x: cx + a * ux - c * uz, z: cz + a * uz + c * ux }));
      path(oc, [core]);
    } else path(oc, [corners]);
    oc.fill();
  };
  for (const r of opts.avoid?.plans || []) fillRect(r.cx, r.cz, r.ux, r.uz, r.hu + 3, r.hv + 3);
  for (const bx of opts.avoid?.boxes || []) fillRect((bx.min.x + bx.max.x) / 2, (bx.min.z + bx.max.z) / 2, 1, 0, (bx.max.x - bx.min.x) / 2 + 3, (bx.max.z - bx.min.z) / 2 + 3);
  stats.parkSites = parkSites;
  for (const a of areas) {
    if (a.k !== 'water') continue;
    path(oc, a.rings);
    oc.fill('evenodd');
  }
  for (const l of data.lines || []) {
    oc.lineWidth = ((l.w || 3) + 6) * S;
    oc.beginPath();
    l.p.forEach((q, i) => {
      const p = project(q[0], q[1]);
      if (i) oc.lineTo(p.x, p.z);
      else oc.moveTo(p.x, p.z);
    });
    oc.stroke();
  }
  let occ = oc.getImageData(0, 0, ow, oh).data;
  stats.occMs = Math.round(performance.now() - tOcc);
  const inParkOutline = (x, z) => parkOutlines.some((o) => x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1 && inRings(x, z, [o.poly]));
  const occAt = (x, z, ch) => {
    const i = Math.floor((x - rect.x0) * OCC);
    const j = Math.floor((z - rect.zN) * OCC);
    if (i < 0 || j < 0 || i >= ow || j >= oh) return !inParkOutline(x, z);
    return occ[(j * ow + i) * 4 + ch] > 40;
  };
  const blocked = (x, z) => occAt(x, z, 0);
  const blockedStreet = (x, z) => occAt(x, z, 1);

  // ---- scatter
  const hills = HILLS().map((h) => ({ ...project(h.lat, h.lon), r: h.r * S }));
  // Porto-native district planting, projected once (CITY.nature.regions wins).
  // `b` biases the tree budget toward the district so its species read there.
  const regions = (CITY.nature?.regions || PORTO_REGIONS).map((g) => ({ ...project(g.lat, g.lon), r: g.r * S, b: g.b ?? 1.8, sp: g.sp }));
  const boostAt = (x, z) => {
    let k = 1;
    for (const h of hills) {
      const d = Math.hypot(x - h.x, z - h.z);
      if (d < h.r) k = Math.max(k, 1 + (HILL_BOOST - 1) * (1 - d / h.r));
    }
    for (const g of regions) {
      const d = Math.hypot(x - g.x, z - g.z);
      if (d < g.r) k = Math.max(k, 1 + (g.b - 1) * (1 - d / g.r));
    }
    return k;
  };
  const cands = areas.filter((a) => DENSITY[a.k] > 0 && a.area > 4);
  let weightSum = 0;
  for (const a of cands) {
    let cx = 0;
    let cz = 0;
    for (const p of a.rings[0]) {
      cx += p.x;
      cz += p.z;
    }
    cx /= a.rings[0].length;
    cz /= a.rings[0].length;
    a.weight = a.area * DENSITY[a.k] * boostAt(cx, cz);
    weightSum += a.weight;
  }
  const budget = opts.budget ?? 5000;
  const rnd = lcg(20260928);
  const trees = []; // { x, y, z, h, rot, s, tint }
  const tint = new THREE.Color();
  // the Douro's water level, for "up the hill" (Porto: the river at the Ribeira)
  const river = project(41.1405, -8.612);
  const riverY = heightAt(river.x, river.z);
  // value noise at grove scale (~70 m): parks and gardens are planted in
  // clumps with open lawns between, not as an even orchard
  const groveNoise = (x, z) => {
    const fx = x / 18;
    const fz = z / 18;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const sx = tx * tx * (3 - 2 * tx);
    const sz = tz * tz * (3 - 2 * tz);
    const a = hash2(ix, iz);
    const b = hash2(ix + 1, iz);
    const c = hash2(ix, iz + 1);
    const d = hash2(ix + 1, iz + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  };
  for (const a of cands) {
    const want = (budget * a.weight) / weightSum;
    let n = Math.floor(want) + (rnd() < want % 1 ? 1 : 0);
    if (!n) continue;
    const xs = a.rings[0].map((p) => p.x);
    const zs = a.rings[0].map((p) => p.z);
    const bx0 = Math.min(...xs);
    const bx1 = Math.max(...xs);
    const bz0 = Math.min(...zs);
    const bz1 = Math.max(...zs);
    const planted = a.k === 'park' || a.k === 'garden';
    // dart throwing with a minimum spacing: an even, natural scatter (in
    // the parks closer, inside the groves)
    const minD = Math.sqrt(a.area / n) * (planted ? 0.46 : 0.62);
    const cell = minD / Math.SQRT2;
    const grid = new Map();
    const key = (i, j) => i * 73856093 ^ j * 19349663;
    const mix = MIX[a.k];
    let tries = n * (planted ? 22 : 14);
    while (n > 0 && tries-- > 0) {
      const x = bx0 + rnd() * (bx1 - bx0);
      const z = bz0 + rnd() * (bz1 - bz0);
      if (!inRings(x, z, a.rings)) continue;
      // groves and lawns; small gardens (under ~0.3 ha) stay as they are
      if (planted && a.area > 200 && rnd() > THREE.MathUtils.smoothstep(groveNoise(x, z), 0.3, 0.62)) continue;
      const gi = Math.floor(x / cell);
      const gj = Math.floor(z / cell);
      let close = false;
      for (let di = -2; di <= 2 && !close; di++) {
        for (let dj = -2; dj <= 2 && !close; dj++) {
          const q = grid.get(key(gi + di, gj + dj));
          if (q && Math.hypot(q.x - x, q.z - z) < minD) close = true;
        }
      }
      if (close) continue;
      let s = regionSpecies(pickSpecies(mix, rnd()), x, z, regions);
      // eucalyptus takes over the woods up the hills (over ~70 m above the river)
      if ((a.k === 'forest' || a.k === 'scrub') && s !== 3 && (heightAt(x, z) - riverY) / S > 70 && rnd() < 0.4) s = 1;
      const sp = SPECIES[s];
      let hM = sp.h[0] + rnd() * (sp.h[1] - sp.h[0]);
      // parks and gardens of mixed ages: young trees, the odd old giant
      if (planted) {
        const age = rnd();
        hM *= age < 0.2 ? 0.5 + rnd() * 0.2 : age > 0.92 ? 1.2 + rnd() * 0.15 : 0.85 + rnd() * 0.2;
      }
      // the whole clump keeps clear, not only its centre
      const reach = hM * S * (s === 4 ? 0.62 : s === 3 ? 0.4 : s === 9 || s === 10 ? 0.3 : 0.25);
      if (blocked(x, z) || blocked(x + reach, z) || blocked(x - reach, z) || blocked(x, z + reach) || blocked(x, z - reach)) {
        stats.rejected++;
        continue;
      }
      grid.set(key(gi, gj), { x, z });
      tint.set(sp.tint).multiplyScalar(0.8 + rnd() * 0.4);
      tint.offsetHSL((rnd() - 0.5) * 0.03, 0, 0);
      trees.push({
        x,
        // sink the base a little: the trunk foot stays in the ground on a slope
        y: heightAt(x, z) - Math.min(0.35, hM * S * 0.12),
        z,
        h: hM * S,
        s,
        rot: s === 8 ? contourRot(x, z, rnd() * Math.PI * 2) : rnd() * Math.PI * 2,
        tint: [tint.r, tint.g, tint.b],
        phase: rnd() * 6.283,
        pk: planted ? 1 : 0, // a park or garden tree: the mapped trees replace it
      });
      n--;
    }
  }

  // ---- riverbank planting along the Douro. The two large Douro water
  // polygons (never the sea or the ponds) are walked edge by edge; a short
  // way out from the water line we drop willows, poplars and reed tufts,
  // with a few agapanthus. Points that land in the water, on a street or
  // by a building are rejected by the same occupancy test as every tree.
  {
    const bankBand = 9; // world units (~35 m) of riparian margin
    const bankMinD = 5; // world units between bank clumps
    // the river polygons only: below the sea, above the park ponds
    const bankAreas = areas.filter((a) => a.k === 'water' && a.area > 30e3 && a.area < 1e6);
    const bankRings = bankAreas.flatMap((a) => a.rings);
    const bankBudget = opts.mobile ? 130 : 420;
    const bankMix = [[9, 0.36], [11, 0.3], [10, 0.26], [13, 0.08]];
    const rnd2 = lcg(20261102);
    const bcell = bankMinD / Math.SQRT2;
    const bgrid = new Map();
    const bkey = (i, j) => (i * 73856093) ^ (j * 19349663);
    let placed = 0;
    for (const a of bankAreas) {
      for (const ring of a.rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          if (placed >= bankBudget) break;
          const p = ring[j];
          const q = ring[i];
          const dx = q.x - p.x;
          const dz = q.z - p.z;
          const len = Math.hypot(dx, dz);
          if (len < 1e-3) continue;
          const nx = -dz / len;
          const nz = dx / len;
          const steps = Math.max(1, Math.round(len / 6));
          for (let k = 0; k < steps && placed < bankBudget; k++) {
            const t = (k + rnd2()) / steps;
            const bx = p.x + dx * t;
            const bz = p.z + dz * t;
            const d = 1.5 + rnd2() * bankBand;
            // step onto the land side, then fall back to the other normal
            let x = bx + nx * d;
            let z = bz + nz * d;
            if (inRings(x, z, bankRings)) {
              x = bx - nx * d;
              z = bz - nz * d;
              if (inRings(x, z, bankRings)) continue;
            }
            const gi = Math.floor(x / bcell);
            const gj = Math.floor(z / bcell);
            let close = false;
            for (let di = -2; di <= 2 && !close; di++) {
              for (let dj = -2; dj <= 2 && !close; dj++) {
                const o = bgrid.get(bkey(gi + di, gj + dj));
                if (o && Math.hypot(o.x - x, o.z - z) < bankMinD) close = true;
              }
            }
            if (close) continue;
            let s = bankMix[bankMix.length - 1][0];
            let acc = 0;
            const roll = rnd2();
            for (const [sp, w] of bankMix) {
              acc += w;
              if (roll < acc) {
                s = sp;
                break;
              }
            }
            const sp = SPECIES[s];
            const hM = sp.h[0] + rnd2() * (sp.h[1] - sp.h[0]);
            const reach = hM * S * (s === 9 || s === 10 ? 0.3 : 0.2);
            if (blocked(x, z) || blocked(x + reach, z) || blocked(x - reach, z) || blocked(x, z + reach) || blocked(x, z - reach)) {
              stats.rejected++;
              continue;
            }
            bgrid.set(bkey(gi, gj), { x, z });
            tint.set(sp.tint).multiplyScalar(0.8 + rnd2() * 0.4);
            tint.offsetHSL((rnd2() - 0.5) * 0.03, 0, 0);
            trees.push({
              x,
              y: heightAt(x, z) - Math.min(0.35, hM * S * 0.12),
              z,
              h: hM * S,
              s,
              rot: rnd2() * Math.PI * 2,
              tint: [tint.r, tint.g, tint.b],
              phase: rnd2() * 6.283,
            });
            placed++;
          }
        }
      }
    }
    stats.bank = placed;
  }

  // ---- coastal planting along the ocean shore. data.coast is the OSM
  // coastline (ascending latitude, fetching the whole wide bbox); from Foz
  // north to Leça da Palmeira it is walked edge by edge and the land side is
  // found by the higher ground. Maritime pine and cypress go on the dunes,
  // coastal scrub and reed at their foot. Inside the core the same occupancy
  // test as every other tree applies; beyond it (Matosinhos / Leça, which
  // have no core street data) only the water polygons are excluded, and the
  // band is kept narrow and shore-hugging so nothing lands in the built town.
  if (Array.isArray(data.coast) && data.coast.length >= 2) {
    const coastMinD = opts.mobile ? 6.5 : 4.5; // world units between clumps
    const coastBudget = opts.mobile ? 70 : 230;
    const coastBand = 10; // world units (~40 m) behind the waterline
    const waterRings = areas.filter((a) => a.k === 'water').flatMap((a) => a.rings);
    const coast = data.coast.map(([lat, lon]) => ({ lat, ...project(lat, lon) })).filter((p) => p.lat >= 41.146 && p.lat <= 41.205);
    const rnd3 = lcg(20261215);
    const ccell = coastMinD / Math.SQRT2;
    const cgrid = new Map();
    const ckey = (i, j) => (i * 73856093) ^ (j * 19349663);
    let placed = 0;
    for (let s = 0; s < coast.length - 1 && placed < coastBudget; s++) {
      const p = coast[s];
      const q = coast[s + 1];
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      const steps = Math.max(1, Math.round(len / 6));
      for (let k = 0; k < steps && placed < coastBudget; k++) {
        const t = (k + rnd3()) / steps;
        const bx = p.x + dx * t;
        const bz = p.z + dz * t;
        const nx = -dz / len;
        const nz = dx / len;
        const d = 1.5 + rnd3() * coastBand;
        // the ocean is west: take the higher (land) side
        let x = bx + nx * d;
        let z = bz + nz * d;
        if (heightAt(x, z) < heightAt(bx - nx * d, bz - nz * d)) {
          x = bx - nx * d;
          z = bz - nz * d;
        }
        // stay above the sand and the quays: the shore sample is the waterline
        const rise = heightAt(x, z) - heightAt(bx, bz);
        if (rise < 0.6) continue;
        if (inRings(x, z, waterRings)) continue;
        const inside = x > rect.x0 && x < rect.x1 && z > rect.zN && z < rect.zS;
        if (inside && blocked(x, z)) {
          stats.rejected++;
          continue;
        }
        const gi = Math.floor(x / ccell);
        const gj = Math.floor(z / ccell);
        let close = false;
        for (let di = -2; di <= 2 && !close; di++) {
          for (let dj = -2; dj <= 2 && !close; dj++) {
            const o = cgrid.get(ckey(gi + di, gj + dj));
            if (o && Math.hypot(o.x - x, o.z - z) < coastMinD) close = true;
          }
        }
        if (close) continue;
        const lat = p.lat + (q.lat - p.lat) * t;
        const mix =
          lat < 41.172
            ? [[7, 0.28], [0, 0.34], [5, 0.14], [13, 0.14], [2, 0.1]] // Foz
            : lat < 41.189
              ? [[0, 0.46], [5, 0.28], [3, 0.16], [2, 0.1]] // Matosinhos dunes
              : [[0, 0.4], [5, 0.3], [11, 0.2], [3, 0.1]]; // Leça
        let sp = mix[mix.length - 1][0];
        let acc = 0;
        const roll = rnd3();
        for (const [spc0, w] of mix) {
          acc += w;
          if (roll < acc) {
            sp = spc0;
            break;
          }
        }
        const spc = SPECIES[sp];
        const hM = spc.h[0] + rnd3() * (spc.h[1] - spc.h[0]);
        const reach = hM * S * (sp === 3 ? 0.4 : sp === 0 || sp === 5 ? 0.22 : 0.25);
        if (inside && (blocked(x + reach, z) || blocked(x - reach, z) || blocked(x, z + reach) || blocked(x, z - reach))) {
          stats.rejected++;
          continue;
        }
        cgrid.set(ckey(gi, gj), { x, z });
        tint.set(spc.tint).multiplyScalar(0.8 + rnd3() * 0.4);
        tint.offsetHSL((rnd3() - 0.5) * 0.03, 0, 0);
        trees.push({
          x,
          y: heightAt(x, z) - Math.min(0.35, hM * S * 0.12),
          z,
          h: hM * S,
          s: sp,
          rot: rnd3() * Math.PI * 2,
          tint: [tint.r, tint.g, tint.b],
          phase: rnd3() * 6.283,
        });
        placed++;
      }
    }
    stats.coast = placed;
  }
  stats.trees = trees.length;

  // ---- tree meshes (near) and billboards (far)
  // The OSM street trees and hedges (src/street-trees.js) arrive after the
  // build and join these meshes. They are many and small, so they get their
  // own LOD: meshes only within STREET_NEAR_K of the near radius and at most
  // `streetNear` of them (the nearest), billboards out to STREET_FAR_K, then
  // nothing; hedges are meshes within HEDGE_K and nothing beyond.
  const STREET_NEAR = opts.mobile ? 180 : 380;
  const HEDGE_NEAR = opts.mobile ? 500 : 1400;
  const STREET_CAP = opts.mobile ? 9000 : 18000;
  const bySpecies = SPECIES.map(() => []);
  for (const t of trees) bySpecies[t.s].push(t);
  stats.species = bySpecies.map((list) => list.length);
  const near = bySpecies.map((list, s) => {
    const geo = clumpGeometry(s);
    // the hedge blocks only ever hold hedges
    const cap = s === 14 ? HEDGE_NEAR : Math.max(1, list.length + STREAM + STREET_NEAR);
    // rgb: the tree's own tint; w: flags (1 evergreen, 2 a clipped hedge)
    const tintAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    tintAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aTint', tintAttr);
    const mat = treeMaterial(uniforms, s);
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    // the shadow pass shrinks and sways the crowns the same way: bare
    // winter crowns cast no summer shadows
    mesh.customDepthMaterial = treeDepthMaterial(uniforms, s);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `trees-${s}`;
    group.add(mesh);
    return { mesh, list, street: [], stream: [], tintAttr, cap };
  });

  const bbGeo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  bbGeo.index = quad.index;
  bbGeo.setAttribute('position', quad.attributes.position);
  bbGeo.setAttribute('uv', quad.attributes.uv);
  const bbCap = trees.length + STREAM + STREET_CAP + 1;
  const bbInst = new THREE.InstancedBufferAttribute(new Float32Array(bbCap * 4), 4);
  const bbInfo = new THREE.InstancedBufferAttribute(new Float32Array(bbCap * 4), 4);
  const bbTint = new THREE.InstancedBufferAttribute(new Float32Array(bbCap * 3), 3);
  for (const a of [bbInst, bbInfo, bbTint]) a.setUsage(THREE.DynamicDrawUsage);
  bbGeo.setAttribute('aInst', bbInst);
  bbGeo.setAttribute('aInfo', bbInfo);
  bbGeo.setAttribute('aTint', bbTint);
  bbGeo.instanceCount = 0;
  const bbMat = billboardMaterial(uniforms, billboardAtlas());
  const billboards = new THREE.Mesh(bbGeo, bbMat);
  billboards.frustumCulled = false;
  billboards.name = 'tree-billboards';
  group.add(billboards);

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const lastCam = new THREE.Vector3(Infinity, 0, 0);
  let nearR = NEAR;
  const STREET_NEAR_K = 0.38;
  const STREET_FAR_K = 2;
  const HEDGE_K = 0.38;
  // the woods' and parks' own meshes end a little inside the near radius:
  // the room pays for the street trees (the triangle budget is fixed)
  const AREA_NEAR_K = 0.88;
  const street = []; // every street tree (not the hedges), for the nearest-first cut
  const streetD2 = new Float32Array(STREET_CAP);
  // upload only the part of an instance buffer that is in use
  const upload = (attr, n) => {
    if (!n) return;
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, n * attr.itemSize);
    attr.needsUpdate = true;
  };
  function partition(cam) {
    lastCam.copy(cam);
    const r2 = (nearR * AREA_NEAR_K) ** 2;
    // street trees: the nearest `streetNear` within STREET_NEAR_K are meshes;
    // the budget follows the class's near radius (smaller on M and S)
    const streetNear = Math.round(STREET_NEAR * Math.min(1, (nearR / 220) ** 2));
    let rs2 = (nearR * STREET_NEAR_K) ** 2;
    let n = 0;
    for (const t of street) {
      const dx = t.x - cam.x;
      const dy = t.y - cam.y;
      const dz = t.z - cam.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < rs2) streetD2[n++] = d2;
    }
    if (n > streetNear) rs2 = streetD2.subarray(0, n).sort()[streetNear];
    const rf2 = (nearR * STREET_FAR_K) ** 2;
    const rh2 = (nearR * HEDGE_K) ** 2;
    let far = 0;
    let nearCount = 0;
    let streetCount = 0;
    for (let s = 0; s < near.length; s++) {
      const N = near[s];
      let k = 0;
      const wr = SPECIES[s].w;
      const nl = N.list.length;
      const ns = nl + N.street.length;
      for (let ti = 0, nt = ns + N.stream.length; ti < nt; ti++) {
        const t = ti < nl ? N.list[ti] : ti < ns ? N.street[ti - nl] : N.stream[ti - ns];
        const dx = t.x - cam.x;
        const dy = t.y - cam.y;
        const dz = t.z - cam.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const st = t.st || 0;
        const asMesh = st === 0 ? d2 < r2 : st === 1 ? d2 < rs2 : d2 < rh2;
        if (asMesh && k < N.cap) {
          _p.set(t.x, t.y, t.z);
          _q.setFromAxisAngle(_up, t.rot);
          _s.set(t.h * (t.sx || 1), t.h, t.h * (t.sz || 1));
          _m.compose(_p, _q, _s);
          N.mesh.setMatrixAt(k, _m);
          N.tintAttr.setXYZW(k, t.tint[0], t.tint[1], t.tint[2], t.f || 0);
          k++;
          if (st) streetCount++;
        } else if (st === 0 || (st === 1 && d2 < rf2)) {
          bbInst.setXYZW(far, t.x, t.y, t.z, t.h);
          bbInfo.setXYZW(far, s, wr, t.phase, t.f || 0);
          bbTint.setXYZ(far, t.tint[0], t.tint[1], t.tint[2]);
          far++;
        }
      }
      N.mesh.count = k;
      upload(N.mesh.instanceMatrix, k);
      upload(N.tintAttr, k);
      nearCount += k;
    }
    bbGeo.instanceCount = far;
    upload(bbInst, far);
    upload(bbInfo, far);
    upload(bbTint, far);
    stats.near = nearCount;
    stats.nearStreet = streetCount;
    stats.far = far;
  }

  // ---- water: built with the base (the boot view drew it already)
  if (water) {
    group.add(water.mesh);
    stats.water = water.triangles;
  }

  // ---- leaf field for the falling leaves and petals (src/leaves.js)
  const leafField = buildLeafField(trees, rect, heightAt);

  // ---- street trees, avenue rows and hedges (src/street-trees.js): they
  // arrive a moment after the build; the occupancy mask is kept until then
  const tintFor = (t, r) => {
    tint.set(t.f === HEDGE ? 0x3d5a27 : SPECIES[t.s].tint).multiplyScalar(0.8 + r() * 0.4);
    tint.offsetHSL((r() - 0.5) * 0.03, 0, 0);
    return [tint.r, tint.g, tint.b];
  };
  const inside = (x, z) => (x > rect.x0 && x < rect.x1 && z > rect.zN && z < rect.zS) || inParkOutline(x, z);
  // a vine row's rotation along the contour of the slope it stands on
  function contourRot(x, z, fallback) {
    const gx = heightAt(x + 1, z) - heightAt(x - 1, z);
    const gz = heightAt(x, z + 1) - heightAt(x, z - 1);
    if (Math.hypot(gx, gz) < 0.02) return fallback; // flat: any way
    return Math.atan2(-gx, -gz); // local x along (-gz, gx)
  }
  stats.street = null;
  loadStreetTrees()
    .then((doc) => {
      if (!doc) return;
      const t0 = performance.now();
      const res = plantStreetTrees({ doc, project, heightAt, roads: opts.roads, inside, blocked: blockedStreet, mobile: !!opts.mobile });
      const plantMs = Math.round(performance.now() - t0);
      const r = lcg(20261010);
      let trees2 = 0;
      for (const t of res.trees) {
        if (street.length >= STREET_CAP) break;
        t.tint = tintFor(t, r);
        near[t.s].street.push(t);
        street.push(t);
        trees2++;
      }
      for (const t of res.hedges) {
        t.tint = tintFor(t, r);
        near[t.s].street.push(t);
      }
      // where a park's trees are mapped, they replace the invented ones
      // nearby (Parque da Cidade maps 1,500): no double planting
      const MC = 6;
      const mgrid = new Set();
      for (const t of street) mgrid.add(`${Math.floor(t.x / MC)},${Math.floor(t.z / MC)}`);
      const mapped = (x, z) => {
        const i = Math.floor(x / MC);
        const j = Math.floor(z / MC);
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (mgrid.has(`${i + di},${j + dj}`)) return true;
        return false;
      };
      let replaced = 0;
      for (const N of near) {
        const before = N.list.length;
        N.list = N.list.filter((t) => !(t.pk && mapped(t.x, t.z)));
        replaced += before - N.list.length;
      }
      stats.street = { ...res.stats, planted: trees2, hedgePieces: res.hedges.length, replaced, plantMs };
      stats.street.ms = Math.round(performance.now() - t0);
      lastCam.set(Infinity, 0, 0); // re-split at the next update
      // the walks and the leaf field in a second, idle task (a phone gets
      // two short tasks, not one long one)
      const later = window.requestIdleCallback || ((f) => setTimeout(f, 60));
      later(
        () => {
          const t1 = performance.now();
          if (res.walks.length) base.paintWalks?.(res.walks);
          // the avenues drop their leaves too
          const lf = buildLeafField(near.flatMap((N) => N.list).concat(street), rect, heightAt);
          leafField.texture.image.data.set(lf.texture.image.data);
          leafField.texture.needsUpdate = true;
          lf.texture.dispose();
          stats.street.idleMs = Math.round(performance.now() - t1);
        },
        { timeout: 3000 },
      );
    })
    .catch((e) => console.warn('[porto] street trees skipped', e?.message || e))
    .finally(() => {
      occ = null; // the occupancy mask is no longer needed
      occCv.width = occCv.height = 0;
    });

  // ---- wind: read from the cloud drift (weather.js moves the cloud deck
  // with the wind at six times its speed), so the trees lean with the
  // weather's wind without a new hook; the default is the Atlantic breeze
  const wind = { x: 0.93, z: -0.37, speed: 6 };
  const cloud = WEATHER_UNIFORMS.cloudParams.value;
  let lastCloud = null;
  const updateWind = (dt) => {
    if (dt > 0 && lastCloud) {
      const period = 1 / (WEATHER_UNIFORMS.cloudShape.value.y || 1 / 2600);
      const k = period / (6 * S * dt);
      const vx = -(cloud.x - lastCloud.x) * k;
      const vz = -(cloud.y - lastCloud.y) * k;
      const sp = Math.hypot(vx, vz);
      if (sp > 0.5 && sp < 40) {
        const a = 1 - Math.exp(-dt * 0.8);
        wind.x += (vx / sp - wind.x) * a;
        wind.z += (vz / sp - wind.z) * a;
        wind.speed += (sp - wind.speed) * a;
      }
    }
    lastCloud = { x: cloud.x, y: cloud.y };
    const l = Math.hypot(wind.x, wind.z) || 1;
    uniforms.uWind.value.set(wind.x / l, wind.z / l, THREE.MathUtils.clamp(wind.speed / 7, 0.3, 2));
  };

  const _sv = new THREE.Vector3();
  function update(dt, camera, light) {
    uniforms.uTime.value += dt;
    updateWind(dt);
    water?.update(dt, light);
    if (light) {
      _sv.copy(light.dir).transformDirection(camera.matrixWorldInverse);
      uniforms.uSunView.value.copy(_sv);
      uniforms.uSunColor.value.copy(light.color);
      bbMat.uniforms.uSunDir.value.copy(light.dir);
      bbMat.uniforms.uSunColor.value.copy(light.color);
      bbMat.uniforms.uAmbient.value.copy(light.ambient);
    }
    if (lastCam.distanceToSquared(camera.position) > REPART_MOVE * REPART_MOVE) partition(camera.position);
  }

  return {
    group,
    stats,
    data, // the OSM lines and areas (life.js puts a flock over the Rio Este)
    landcover,
    landRect,
    uniforms,
    water,
    leafField,
    update,
    setNearRadius(r) {
      nearR = r;
      lastCam.set(Infinity, 0, 0);
    },
    setShadows(on) {
      for (const N of near) N.mesh.castShadow = on;
    },
    // Trees of the streamed tiles (src/tiles.js): a list of Float32Arrays,
    // 9 floats per clump: x, y (base), z, height, species, rotation, sway
    // phase, and two randoms for the tint. Replaces the previous set; at
    // most `streamCap` clumps are kept. They join the same meshes and
    // billboards as the core's trees, so they sway, turn with the seasons
    // and switch to billboards the same way.
    streamCap: STREAM,
    setStreamTrees(chunks) {
      for (const N of near) N.stream = [];
      let n = 0;
      const c = new THREE.Color();
      for (const arr of chunks) {
        for (let i = 0; i + 8 < arr.length && n < STREAM; i += 9, n++) {
          const s = arr[i + 4] | 0;
          const sp = SPECIES[s];
          if (!sp) continue;
          c.set(sp.tint).multiplyScalar(0.8 + arr[i + 7] * 0.4);
          c.offsetHSL((arr[i + 8] - 0.5) * 0.03, 0, 0);
          // vines: the row runs along the slope's contour, like a terrace
          near[s].stream.push({ x: arr[i], y: arr[i + 1], z: arr[i + 2], h: arr[i + 3], s, rot: s === 8 ? contourRot(arr[i], arr[i + 2], arr[i + 5]) : arr[i + 5], phase: arr[i + 6], tint: [c.r, c.g, c.b] });
        }
      }
      stats.stream = n;
      lastCam.set(Infinity, 0, 0); // re-split at the next update
    },
  };
}

// The field the falling leaves and petals read (src/leaves.js), one texel
// per 4 world units (16 m) over the data rectangle, half float:
//   R ground height (world y), G deciduous crowns nearby 0..1 (autumn
//   leaves), B blossoming trees nearby 0..1 (spring petals), A the mean
//   crown height there (world units).
const FIELD_UNIT = 4;
function buildLeafField(trees, rect, heightAt) {
  const w = Math.ceil((rect.x1 - rect.x0) / FIELD_UNIT);
  const h = Math.ceil((rect.zS - rect.zN) / FIELD_UNIT);
  const n = w * h;
  const dec = new Float32Array(n * 4);
  const blo = new Float32Array(n * 4);
  const cnt = new Float32Array(n * 4);
  const hgt = new Float32Array(n * 4);
  for (const t of trees) {
    const i = Math.floor((t.x - rect.x0) / FIELD_UNIT);
    const j = Math.floor((t.z - rect.zN) / FIELD_UNIT);
    if (i < 0 || j < 0 || i >= w || j >= h) continue;
    const k = (j * w + i) * 4;
    const sc = SEASON_CROWNS[t.s];
    dec[k] += t.f ? 0 : sc.bare; // evergreen street trees keep their leaves
    blo[k] += sc.bloom;
    cnt[k] += 1;
    hgt[k] += t.h;
  }
  const bd = blur(dec, w, h, 2);
  const bb = blur(blo, w, h, 2);
  const bc = blur(cnt, w, h, 2);
  const bh = blur(hgt, w, h, 2);
  // each clump stands for a few crowns: scale so the densest tenth of the
  // wooded cells reads as full cover
  const p90 = (a) => {
    const v = Array.from(a).filter((x) => x > 1e-4).sort((x, y) => x - y);
    return v.length ? v[Math.floor(v.length * 0.9)] : 1;
  };
  const kd = 0.9 / p90(bd);
  const kb = 0.9 / p90(bb);
  const data = new Uint16Array(n * 4);
  const half = THREE.DataUtils.toHalfFloat;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const x = rect.x0 + (i + 0.5) * FIELD_UNIT;
      const z = rect.zN + (j + 0.5) * FIELD_UNIT;
      data[k * 4] = half(heightAt(x, z));
      data[k * 4 + 1] = half(Math.min(1, bd[k] * kd));
      data[k * 4 + 2] = half(Math.min(1, bb[k] * kb));
      data[k * 4 + 3] = half(bc[k] > 1e-3 ? bh[k] / bc[k] : 0);
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  // uv = (world xz - origin) / size; rows run north to south like world z
  return { texture: tex, rect: { x0: rect.x0, z0: rect.zN, w: w * FIELD_UNIT, d: h * FIELD_UNIT } };
}

// separable box blur of the red channel of RGBA data; returns one channel
function blur(rgba, w, h, r) {
  const a = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) a[i] = rgba[i * 4];
  const tmp = new Float32Array(w * h);
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += a[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s * k;
      s += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      a[y * w + x] = s * k;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return a;
}

// ------------------------------------------------------------ materials
// Autumn on today's date. Porto's trees turn late: the first planes and
// limes in early October, the peak in the last week of November, bare by
// the winter solstice. x: the share of the deciduous crowns that have
// turned, y: how deep their colour is. Outside autumn (a visitor who picks
// "autumn" in May) it is the peak.
function fallProgress(d = new Date()) {
  const y = d.getFullYear();
  const start = new Date(y, 8, 23).getTime();
  const peak = new Date(y, 10, 25).getTime();
  const end = new Date(y, 11, 21).getTime();
  const t = d.getTime();
  const p = t < start || t >= end ? 1 : Math.min(1, (t - start) / (peak - start));
  return new THREE.Vector2(0.3 + 0.7 * p, 0.62 + 0.38 * p);
}

// Per-species season uniforms: the palette in linear light and the shares
// (see SEASON_CROWNS). One object per species, shared by the colour and
// the shadow material.
const speciesUniforms = [];
function seasonUniforms(s) {
  if (speciesUniforms[s]) return speciesUniforms[s];
  const sc = SEASON_CROWNS[s];
  speciesUniforms[s] = {
    uPal: { value: sc.pal.map((h) => new THREE.Color(h)) },
    uBase: { value: new THREE.Color(SPECIES[s].tint) },
    uKind: { value: new THREE.Vector3(sc.share, sc.bare, sc.bloom) },
    uBloom: { value: new THREE.Color(SPECIES[s].bloom) },
  };
  return speciesUniforms[s];
}

// Vertex code shared by the tree colour and shadow materials: per-tree and
// per-crown hashes, the winter shrink of the bare crowns, the wind sway.
const TREE_VERT_PARS = /* glsl */ `
uniform float uTime;
uniform vec4 seasonW;
uniform vec3 uKind; // x palette share, y bare share, z bloom share
uniform vec3 uWind; // xy the direction it blows toward (world xz), z strength
uniform vec2 uTurn; // autumn on today's date: x share turned, y depth
attribute vec4 aCenter;
attribute vec4 aTint; // rgb the tree's tint, w flags: 1 evergreen, 2 hedge
float tHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
`;
const TREE_DEFORM = /* glsl */ `
#ifdef USE_INSTANCING
  vec2 wp = instanceMatrix[3].xz;
  mat3 tIM = mat3(instanceMatrix);
#else
  vec2 wp = vec2(0.0);
  mat3 tIM = mat3(1.0);
#endif
float tHI = tHash(wp * 0.37 + 0.11);
float tHC = fract(tHI * 7.31 + aCenter.w * 3.17);
float tCrown = step(0.0, aCenter.w);
float tEver = step(0.5, aTint.w); // an evergreen street tree or a hedge
float tStiff = step(1.5, aTint.w); // a clipped hedge does not sway
float tPal = tCrown * step(tHC, uKind.x) * (1.0 - tEver);
float tBare = tCrown * step(tHC, uKind.y) * (1.0 - tEver);
// winter: bare crowns shrink to a twig mass; autumn thins them a little
transformed = mix(transformed, aCenter.xyz, tBare * (seasonW.w * 0.5 + seasonW.z * 0.08 * uTurn.x));
// wind: the crown leans downwind and sways about it, more toward the top;
// gusts roll across the city with the wind. The wind direction is taken
// into the tree's own frame (its rotation; its scale is its height).
float gust = 0.7 + 0.3 * sin(uTime * 0.41 - dot(wp, uWind.xy) * 0.012);
float sway = sin(uTime * 1.3 + wp.x * 0.05 + wp.y * 0.07) + 0.4 * sin(uTime * 2.9 + wp.y * 0.11);
float bend = position.y * position.y * 0.035 * uWind.z * (1.0 - tStiff);
float tScale = max(length(tIM[1]), 1e-4);
vec3 wAlong = transpose(tIM) * vec3(uWind.x, 0.0, uWind.y) / tScale;
vec3 wAcross = transpose(tIM) * vec3(-uWind.y, 0.0, uWind.x) / tScale;
transformed += (wAlong * (0.45 + 0.75 * sway) * gust + wAcross * 0.3 * sin(uTime * 3.1 + tHI * 6.283)) * bend;
`;
// Crown colour for the season, resolved from the authored palette every
// frame (never from last frame's colour, so nothing drifts).
const TREE_SEASON_COLOR = /* glsl */ `
{
  vec3 vary = aTint.rgb / max(uBase, vec3(1e-3)); // this tree's own variation
  vec3 cSum = uPal[1];
  vec3 ever = cSum * (seasonW.x * vec3(1.06, 1.1, 1.0) + vec3(seasonW.y) + seasonW.z * vec3(1.0, 0.97, 0.92) + seasonW.w * vec3(0.86, 0.88, 0.9));
  vec3 cFall = mix(uPal[2], uPal[3], fract(tHC * 5.3 + tHI));
  // one tree in six turns late: still half green
  cFall = mix(cFall, mix(cSum, uPal[2], 0.5), step(0.83, fract(tHI * 13.7)));
  // today's date: only some crowns have turned so far, and not all the way;
  // the rest keep a tired late-summer green
  float turned = step(fract(tHI * 17.31 + 0.13), uTurn.x);
  cFall = mix(cSum * vec3(1.04, 1.0, 0.84), cFall, turned * uTurn.y);
  vec3 own = seasonW.x * uPal[0] + seasonW.y * cSum + seasonW.z * cFall + seasonW.w * uPal[4];
  vec3 leaf = mix(ever, own, tPal) * vary;
  // spring blossom: whole trees, in specks over the crown
  float bloom = step(tHI, uKind.z) * seasonW.x * aCrown;
  float speck = smoothstep(0.3, 0.7, tHash(position.xz * 23.0 + position.y * 7.0 + tHI * 9.0));
  vec3 blossom = uBloom * mix(vec3(0.8, 0.78, 0.92), vec3(1.18, 1.12, 1.02), fract(tHI * 3.1));
  float b = bloom * speck * 0.8;
  vTint = mix(leaf, blossom, b);
  // blossom and bare twigs do not glow against the sun like leaves
  vBack = aCrown * (1.0 - b) * (1.0 - tBare * seasonW.w * 0.8);
}
`;

function treeMaterial(uniforms, s) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  mat.name = 'trees';
  mat.defines = { BRG_NO_DUST: '' }; // crowns take snow only above the snow line
  const su = seasonUniforms(s);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, su);
    sh.uniforms.seasonW = WEATHER_UNIFORMS.seasonW;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\n${TREE_VERT_PARS}\nuniform vec3 uPal[5];\nuniform vec3 uBase;\nuniform vec3 uBloom;\nattribute float aCrown;\nvarying float vCrown;\nvarying float vBack;\nvarying vec3 vTint;`,
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvCrown = aCrown;\n${TREE_DEFORM}\n${TREE_SEASON_COLOR}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunView;\nuniform vec3 uSunColor;\nvarying float vCrown;\nvarying float vBack;\nvarying vec3 vTint;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(vec3(1.0), vTint, vCrown);')
      // leaves glow a little when the sun is behind them
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  // vViewPosition points from the fragment to the camera
  float back = pow(max(dot(-normalize(vViewPosition), uSunView), 0.0), 3.0);
  totalEmissiveRadiance += diffuseColor.rgb * uSunColor * back * 0.35 * vBack;
}`,
      );
  };
  return mat;
}

// Shadow caster with the same shrink and sway as the colour material.
function treeDepthMaterial(uniforms, s) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.name = 'trees-depth';
  const su = seasonUniforms(s);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uWind = uniforms.uWind;
    sh.uniforms.uTurn = uniforms.uTurn;
    sh.uniforms.uKind = su.uKind;
    sh.uniforms.seasonW = WEATHER_UNIFORMS.seasonW;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${TREE_VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${TREE_DEFORM}`);
  };
  return mat;
}

function billboardMaterial(uniforms, atlas) {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...FOG_UNIFORMS,
      ...WEATHER_UNIFORMS,
      uTime: uniforms.uTime,
      uWind: uniforms.uWind,
      uTurn: uniforms.uTurn,
      tAtlas: { value: atlas },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uAmbient: { value: new THREE.Color(0.3, 0.3, 0.3) },
      // the season palettes of all species, five colours each (SEASON_CROWNS)
      uBPal: { value: SPECIES.flatMap((_, s) => seasonUniforms(s).uPal.value) },
      uBBase: { value: SPECIES.map((_, s) => seasonUniforms(s).uBase.value) },
      uBKind: { value: SPECIES.map((_, s) => seasonUniforms(s).uKind.value) },
      uBBloom: { value: SPECIES.map((_, s) => seasonUniforms(s).uBloom.value) },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      uniform float uTime;
      uniform vec3 uWind;
      uniform vec2 uTurn;
      uniform vec4 seasonW;
      uniform vec3 uBPal[${CELLS * 5}];
      uniform vec3 uBBase[${CELLS}];
      uniform vec3 uBKind[${CELLS}];
      uniform vec3 uBBloom[${CELLS}];
      attribute vec4 aInst;
      attribute vec4 aInfo;
      attribute vec3 aTint;
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vUp;
      varying float vBare;
      float bHash(vec2 p) {
        vec3 q = fract(vec3(p.xyx) * 0.1031);
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
      }
      // the same season colour as the near meshes, one crown per tree
      vec3 seasonTint(int s, vec3 tint, vec3 base) {
        float h = bHash(aInst.xz * 0.37 + 0.11);
        float hc = fract(h * 7.31 + 1.7);
        vec3 k = uBKind[s];
        float everF = step(0.5, aInfo.w); // an evergreen street tree
        float pal = step(hc, k.x) * (1.0 - everF);
        vec3 cSum = uBPal[s * 5 + 1];
        vec3 ever = cSum * (seasonW.x * vec3(1.06, 1.1, 1.0) + vec3(seasonW.y) + seasonW.z * vec3(1.0, 0.97, 0.92) + seasonW.w * vec3(0.86, 0.88, 0.9));
        vec3 cFall = mix(uBPal[s * 5 + 2], uBPal[s * 5 + 3], fract(hc * 5.3 + h));
        cFall = mix(cFall, mix(cSum, uBPal[s * 5 + 2], 0.5), step(0.83, fract(h * 13.7)));
        float turned = step(fract(h * 17.31 + 0.13), uTurn.x);
        cFall = mix(cSum * vec3(1.04, 1.0, 0.84), cFall, turned * uTurn.y);
        vec3 own = seasonW.x * uBPal[s * 5] + seasonW.y * cSum + seasonW.z * cFall + seasonW.w * uBPal[s * 5 + 4];
        vec3 c = mix(ever, own, pal) * tint / max(base, vec3(1e-3));
        float bloom = step(h, k.z) * seasonW.x;
        c = mix(c, uBBloom[s], bloom * 0.45);
        vBare = step(hc, k.y) * seasonW.w * (1.0 - everF);
        return c;
      }
      void main() {
        vec3 base = aInst.xyz;
        float h = aInst.w;
        float w = h * aInfo.y * 1.15;
        vec3 toCam = cameraPosition - base;
        vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-4, 0.0, 0.0));
        // the same wind as the near meshes, seen across the view
        float gust = 0.7 + 0.3 * sin(uTime * 0.41 - dot(base.xz, uWind.xy) * 0.012);
        float osc = sin(uTime * 1.3 + base.x * 0.05 + base.z * 0.07);
        float lean = dot(right.xz, uWind.xy) * (0.45 + 0.75 * osc) * gust + 0.3 * osc;
        float sway = lean * uWind.z * position.y * position.y * 0.03 * h;
        vec3 p = base + right * (position.x * w + sway) + vec3(0.0, position.y * h, 0.0);
        vec4 mvPosition = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vUv = vec2((aInfo.x + uv.x) / ${CELLS.toFixed(1)}, uv.y);
        int sp = int(aInfo.x + 0.5);
        vTint = seasonTint(sp, aTint, uBBase[sp]);
        vUp = position.y;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D tAtlas;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uAmbient;
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vUp;
      varying float vBare;
      ${CLOUD_GLSL}
      ${SEASON_GLSL}
      void main() {
        vec4 t = texture2D(tAtlas, vUv);
        if (t.a < 0.5) discard;
        // winter: a bare crown lets the sky through in a twiggy pattern
        if (vBare > 0.01 && fract(sin(dot(floor(vUv * vec2(640.0, 128.0)), vec2(12.9898, 78.233))) * 43758.5453) < vBare * 0.55) discard;
        // crowns take the tint; the grey level is baked shading
        float lum = t.r;
        vec3 albedo = vTint * (0.55 + 0.7 * lum);
        // winter: snow on the upper crowns above the snow line (scene.js)
        float snowAlt = smoothstep(seasonSnow.z - 3.0, seasonSnow.z + 6.0, vFogWorld.y);
        albedo = mix(albedo, vec3(0.62, 0.65, 0.7), seasonSnow.x * snowAlt * 0.6 * smoothstep(0.4, 0.9, vUp) * step(0.4, lum));
        // the woods far away lie under the same cloud shadows as the ground
        float sun = clamp(uSunDir.y * 0.8 + 0.35, 0.0, 1.0) * brgCloudShade(vFogWorld, uSunDir);
        vec3 col = albedo * (uAmbient + uSunColor * sun * 0.32 * (0.6 + 0.4 * vUp));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

