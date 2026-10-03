// Procedural textures for the landmark and building shaders (browser only;
// every map here is a plain-array DataTexture, so the module also imports
// cleanly under Node for budgeting/tests — no canvas, no DOM, no downloads).
//
// createStoneTextures() -> { detail, tone, normal }, all 512 x 512, tiling:
//   detail (RGBA): R granite ashlar height (running-bond courses, thin mortar
//     joints, beveled arris, pitted faces), G barrel roof-tile height (cap /
//     pan columns with a lapped course shadow), B multi-octave value noise
//     (render, foliage, carved stone), A slate / lead scales.
//   tone (RGBA): R per-block tone of the ashlar (0 cool grey .. 1 warm buff:
//     the two-tone granite of Porto), G mortar mask, B rain streaks (long in
//     v), A roof grime / moss / lichen (roof tiles, plaster base).
//   normal (RGBA): tangent-space normals from the heights, RG = ashlar,
//     BA = roof tiles (z rebuilt in the shader). u runs along the wall or
//     the eave, v up the wall or the roof slope.
// createAzulejoTexture(): the blue-and-white (or polychrome) pattern tile of
// a Palácio do Raio / Congregados façade, 8 x 8 tiles, sRGB data.
// createCalcadaTexture(): calçada portuguesa patterns (wave / net / flower /
//   sidewalk / street) in white limestone and black basalt.
// createWetDryTexture(): a small normal + roughness modulation map for
//   wet/dry stone (R wetness, G micro-roughness, BA normals).
// createFacadeDetailTexture(): a 64 x 64 RGBA data map for the ordinary
//   building shader (soiling, render grain, rain streaks), sampled by world
//   position in src/facades.js. Shared by OSM and MS buildings.
//
// All factories are memoised: the OSM fabric (src/buildings.js) and the
// Microsoft footprints (src/buildings-ms.js) reuse one GPU texture, and so do
// every landmark. textureBudget() reports the resident bytes (mip-inclusive)
// of everything built so far.
import * as THREE from 'three';

function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// integer hash: stable per (x, y) for block/tile identity
function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Tileable value noise with period nx x ny cells over `size` pixels.
function valueNoise(size, n, seed, ny = n) {
  const r = lcg(seed);
  const g = new Float32Array(n * ny);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const fx = (x / size) * n;
    const fy = (y / size) * ny;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const at = (i, j) => g[(((j % ny) + ny) % ny) * n + (((i % n) + n) % n)];
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}

function fbm(size, seed) {
  const o = [valueNoise(size, 4, seed), valueNoise(size, 8, seed + 1), valueNoise(size, 16, seed + 2), valueNoise(size, 32, seed + 3), valueNoise(size, 64, seed + 4)];
  return (x, y) => 0.34 * o[0](x, y) + 0.26 * o[1](x, y) + 0.18 * o[2](x, y) + 0.13 * o[3](x, y) + 0.09 * o[4](x, y);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const fract = (v) => v - Math.floor(v);
function smoothstep(a, b, v) {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

// --------------------------------------------------------------- registry
// Every DataTexture built here is tracked once, so textureBudget() gives a
// truthful resident-size figure for the whole material set.
const REGISTRY = new Map();
const CACHE = new Map();
function cached(key, build) {
  let v = CACHE.get(key);
  if (!v) CACHE.set(key, (v = build()));
  return v;
}

export function textureBudget() {
  let bytes = 0;
  for (const b of REGISTRY.values()) bytes += b;
  return { textures: REGISTRY.size, bytes, mb: +(bytes / 1048576).toFixed(2) };
}

function dataTexture(data, size, colorSpace = THREE.NoColorSpace) {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = colorSpace;
  tex.needsUpdate = true;
  if (!REGISTRY.has(tex)) REGISTRY.set(tex, size * size * 4 * (4 / 3)); // + mip chain
  return tex;
}

// ------------------------------------------------------------ stone set
// Granite ashlar and barrel roof tiles, one 512 x 512 set the landmark shader
// (src/landmarks.js) reads by surface id. The ashlar is a true running bond:
// 8 courses of rock-faced blocks with staggered vertical joints, a thin
// mortar recess and a beveled arris; each block carries its own tone and
// weathering so the two-tone Porto granite reads at close range.
export function createStoneTextures(size = 512) {
  return cached(`stone:${size}`, () => {
    const data = new Uint8Array(size * size * 4);
    const tone = new Uint8Array(size * size * 4);
    const hA = new Float32Array(size * size);
    const hT = new Float32Array(size * size);
    const noise = fbm(size, 11);
    const grime = fbm(size, 41);
    const pit = fbm(size, 71);
    const streak = valueNoise(size, 48, 23, 3);
    const streak2 = valueNoise(size, 96, 29, 5);

    // Ashlar grid: NC courses, NB running-bond columns (half-block stagger on
    // odd courses). Hash by (course, column mod NB) so the map tiles in x and
    // the one block cut by the seam keeps a single identity on both sides.
    const NC = 8;
    const ch = size / NC;
    const NB = 5;
    const bw = size / NB;
    const off = [];
    for (let c = 0; c < NC; c++) off.push(c % 2 ? 0.5 : 0.0);
    const tint = new Float32Array(NC * NB);
    const warm = new Float32Array(NC * NB);
    for (let c = 0; c < NC; c++) {
      for (let k = 0; k < NB; k++) {
        const i = c * NB + k;
        tint[i] = 0.80 + 0.20 * hash2(k * 7 + 1, c * 13 + 3);
        warm[i] = hash2(k * 31 + 5, c * 17 + 9) < 0.4 ? 0.62 + 0.38 * hash2(k, c) : 0.08 + 0.22 * hash2(k + 9, c + 9);
      }
    }

    // Barrel (canal) tiles: NW columns across the eave, RH courses up the
    // slope; each column a half-round cap, each course lapping the one below.
    const NW = 16;
    const RH = 10;
    const cw = size / NW;
    const rh = size / RH;

    // Slate: 24 rows of staggered scales.
    const srows = 24;
    const sh = size / srows;
    const sw = size / 20;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const p = y * size + x;
        const i = p * 4;
        const nz = noise(x, y);

        // --- ashlar
        const c = Math.floor(y / ch);
        const fy = y - c * ch;
        const u = x / bw + off[c];
        const col = Math.floor(u);
        const fu = u - col;
        const dv = Math.min(fu, 1 - fu) * bw; // px to the vertical joint
        const dh = Math.min(fy, ch - fy); // px to the course joint
        const dEdge = Math.min(dv, dh);
        const mortar = 1 - smoothstep(0.6, 2.4, dEdge); // recessed, soft joint
        const bevel = smoothstep(0, 3.4, dEdge); // rounded arris on the face
        const cm = ((col % NB) + NB) % NB;
        const bi = c * NB + cm;
        const t = tint[bi];
        const weath = hash2(cm * 3 + 1, c * 5 + 2);
        const face = (0.60 + 0.40 * bevel) * t * (0.85 + 0.18 * nz) + (pit(x, y) - 0.5) * 0.12;
        const a = face * (1 - mortar) + 0.24 * mortar;
        data[i] = clamp01(a) * 255;
        hA[p] = a;
        tone[i] = warm[bi] * 255;
        tone[i + 1] = clamp01(mortar * (0.78 + 0.22 * weath)) * 255;

        // --- barrel tiles: alternating convex caps, lapped courses
        const colT = Math.floor(x / cw);
        const row = Math.floor(y / rh);
        const fv = y / rh - row;
        const lean = (hash2(colT, row * 3 + 1) - 0.5) * 0.10; // slight hand-laid wobble
        const fuc = fract(x / cw + lean);
        const prof = Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * fuc), 0.75); // cap at fuc = 0.5
        const lap = 1 - 0.30 * (1 - smoothstep(0.0, 0.08, fv)); // shadow under the lap
        const lip = smoothstep(0.90, 0.98, fv); // raised lower edge of the tile
        const tt = 0.78 + 0.30 * hash2(colT, row * 7 + 2);
        const tileH = clamp01((prof * lap + 0.06 * lip) * tt * (0.86 + 0.2 * nz));
        data[i + 1] = tileH * 255;
        hT[p] = prof * (0.7 + 0.3 * lap) + 0.22 * fv + 0.12 * lip;

        // --- noise
        data[i + 2] = clamp01(nz * 1.1 + (pit(x, y) - 0.5) * 0.18) * 255;

        // --- slate scales
        const sr = Math.floor(y / sh);
        const sfu = fract(x / sw + (sr % 2 ? 0.5 : 0));
        const sfv = (y - sr * sh) / sh;
        const edge = Math.min(sfu, 1 - sfu) * sw < 1.2 || sfv < 0.12;
        data[i + 3] = clamp01(edge ? 0.35 : (0.7 + 0.3 * sfv) * (0.85 + 0.25 * nz)) * 255;

        // --- streaks and weathering
        tone[i + 2] = clamp01(0.62 * streak(x, y) + 0.38 * streak2(x, y)) * 255;
        const damp = 1 - bevel * 0.5; // lichen collects in the joints
        const lich = smoothstep(0.60, 0.95, grime(x, y)) * damp;
        const moss = hash2(colT * 5 + 2, row * 11 + 3) > 0.80 ? smoothstep(0.4, 0.9, grime(x, y)) : 0;
        tone[i + 3] = clamp01(0.60 * grime(x, y) + 0.40 * lich + 0.55 * moss) * 255;
      }
    }

    // normals from the heights (central differences, wrapping)
    const nrm = new Uint8Array(size * size * 4);
    const at = (h, x, y) => h[((y + size) % size) * size + ((x + size) % size)];
    const pack = (v) => clamp01(v * 0.5 + 0.5) * 255;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        for (const [h, s, o] of [[hA, 3.2, 0], [hT, 5.5, 2]]) {
          const nx = -(at(h, x + 1, y) - at(h, x - 1, y)) * s;
          const ny = -(at(h, x, y + 1) - at(h, x, y - 1)) * s;
          const l = Math.hypot(nx, ny, 1);
          nrm[i + o] = pack(nx / l);
          nrm[i + o + 1] = pack(ny / l);
        }
      }
    }
    return { detail: dataTexture(data, size), tone: dataTexture(tone, size), normal: dataTexture(nrm, size) };
  });
}

// Small, tileable facade-detail field for the ordinary-building shader
// (src/buildings.js, shared with the MS fabric): no colour, four independent
// channels the material samples by world position to break up flat plaster.
// 64 x 64 RGBA8 (16 KB), so it costs one fetch, not a texture budget. None of
// the channels is colour: the shader uses them as masks, so they stay linear.
//   R  broad neighbourhood soiling (large patches across a block)
//   G  fine plaster / render grain
//   B  vertical rain streaks (varies across the wall, constant up it)
//   A  lime-wash mottling plus a damp, darker foot on the wall
export function createFacadeDetailTexture(size = 64) {
  return cached(`facade:${size}`, () => {
    const data = new Uint8Array(size * size * 4);
    const broad = valueNoise(size, 3, 313);
    const mid = valueNoise(size, 7, 401);
    const grain = valueNoise(size, 24, 509);
    const streaks = valueNoise(size, 48, 617, 2); // many columns, few rows
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        data[i] = clamp01(broad(x, y) * 1.1) * 255;
        data[i + 1] = clamp01(0.45 * mid(x, y) + 0.55 * grain(x, y)) * 255;
        data[i + 2] = clamp01(Math.pow(streaks(x, y), 1.6) * 1.15) * 255;
        data[i + 3] = clamp01(0.5 * mid(x, y) + 0.5 * broad(x, y)) * 255;
      }
    }
    return dataTexture(data, size);
  });
}

// ------------------------------------------------------------ azulejo
// Small repeatable azulejo patterns as sRGB DataTextures (8 x 8 tiles), so a
// façade reads as glazed ceramic instead of a shader approximation. Patterns:
//   'raio'        blue-and-white star / cross-flower lattice (Palácio do Raio)
//   'lattice'     diagonal blue grid with a blue boss, white ground
//   'floral'      blue palmette rosette on white
//   'polychrome'  blue / ochre / green geometry on white (Porto polychrome)
// Palettes: 'cobalt', 'polychrome', 'verdant'. Memoised per (size, pattern,
// palette), so every façade that asks for the same tile shares one texture.
const AZ_PALETTES = {
  cobalt: { grout: [206, 204, 196], base: [58, 92, 178], white: [244, 243, 236], blue: [58, 92, 178], ochre: [176, 132, 58], green: [58, 120, 92] },
  polychrome: { grout: [206, 204, 196], base: [246, 244, 236], white: [246, 244, 236], blue: [52, 86, 170], ochre: [184, 134, 48], green: [64, 132, 86] },
  verdant: { grout: [200, 204, 196], base: [236, 240, 230], white: [246, 246, 240], blue: [54, 92, 160], ochre: [176, 140, 66], green: [46, 110, 84] },
};

export function createAzulejoTexture(size = 256, pattern = 'raio', palette = 'cobalt') {
  return cached(`azulejo:${size}:${pattern}:${palette}`, () => {
    const P = AZ_PALETTES[palette] || AZ_PALETTES.cobalt;
    const data = new Uint8Array(size * size * 4);
    const n = 8;
    const t = size / n;
    const put = (i, c, k = 1) => {
      data[i] = c[0] * k;
      data[i + 1] = c[1] * k;
      data[i + 2] = c[2] * k;
      data[i + 3] = 255;
    };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const ix = Math.floor(x / t);
        const iy = Math.floor(y / t);
        const fx = x / t - ix;
        const fy = y / t - iy;
        const glaze = 0.94 + 0.10 * hash2(ix, iy); // per-tile glaze pool
        let col;

        if (pattern === 'lattice') {
          const d1 = Math.abs(fx - fy);
          const d2 = Math.abs(fx + fy - 1);
          const boss = Math.abs(fx - 0.5) < 0.10 && Math.abs(fy - 0.5) < 0.10;
          const line = Math.min(d1, d2) < 0.045 || boss;
          col = line ? (P.blue || P.base) : P.white;
        } else if (pattern === 'floral') {
          const ax = fx - 0.5;
          const ay = fy - 0.5;
          const rr = Math.hypot(ax, ay);
          const ang = Math.atan2(ay, ax);
          const petal = rr < 0.16 + 0.13 * Math.abs(Math.cos(2 * ang));
          const bud = rr < 0.05;
          const corner = Math.min(fx, 1 - fx) < 0.14 && Math.min(fy, 1 - fy) < 0.14;
          col = bud ? (P.ochre || P.blue) : petal || corner ? (P.blue || P.base) : P.white;
        } else if (pattern === 'polychrome') {
          const diamond = Math.abs(fx - 0.5) + Math.abs(fy - 0.5) < 0.40;
          const cross = (Math.abs(fx - 0.5) < 0.09 || Math.abs(fy - 0.5) < 0.09) && diamond;
          const corner = Math.min(fx, 1 - fx) < 0.18 && Math.min(fy, 1 - fy) < 0.18;
          const centre = Math.abs(fx - 0.5) < 0.07 && Math.abs(fy - 0.5) < 0.07;
          col = centre ? P.blue : cross ? P.ochre : diamond ? P.blue : corner ? P.green : P.white;
        } else {
          // raio: each tile carries quarter stars in its four corners (so a
          // full star forms where four tiles meet), a cross-flower at centre,
          // thin diagonals between them, on a cobalt ground.
          let white = 0;
          for (let k = 0; k < 4; k++) {
            const cx = k & 1;
            const cy = (k >> 1) & 1;
            const ax = fx - cx;
            const ay = fy - cy;
            const rr = Math.hypot(ax, ay);
            const ang = Math.atan2(ay, ax);
            const spike = 0.50 + 0.50 * Math.abs(Math.cos(4 * ang));
            if (rr < 0.30 * spike) white = 1;
          }
          if (Math.abs(fx - fy) < 0.045 || Math.abs(fx + fy - 1) < 0.045) white = 1;
          const ax = fx - 0.5;
          const ay = fy - 0.5;
          const rr = Math.hypot(ax, ay);
          const ang = Math.atan2(ay, ax);
          if (rr < 0.055 + 0.065 * Math.abs(Math.cos(2 * ang))) white = 1;
          if (rr < 0.045) white = 0; // cobalt heart
          col = white ? P.white : P.base;
        }

        // grout: a cool grey line around every tile
        const gd = Math.min(fx, 1 - fx, fy, 1 - fy) * t;
        const g = 1 - smoothstep(0.0, 1.4, gd);
        col = [col[0] + (P.grout[0] - col[0]) * g, col[1] + (P.grout[1] - col[1]) * g, col[2] + (P.grout[2] - col[2]) * g];
        put(i, col, glaze);
      }
    }
    return dataTexture(data, size, THREE.SRGBColorSpace);
  });
}

// ------------------------------------------------------------ calçada
// Calçada portuguesa: white limestone and black basalt set by hand. Pattern
// ids mirror src/streetscape.js (CALCADA): 1 waves, 2 net, 3 sidewalk,
// 4 street, 5 flower. Small repeatable sRGB data: RGB = albedo, A = stone
// height / joint mask for a bump map. Lazy + memoised: only the patterns a
// scene actually asks for cost memory.
export const CALCADA_PATTERN = { waves: 1, net: 2, sidewalk: 3, street: 4, flower: 5 };
const CALCADA_NAMES = { 1: 'waves', 2: 'net', 3: 'sidewalk', 4: 'street', 5: 'flower', waves: 'waves', net: 'net', sidewalk: 'sidewalk', street: 'street', flower: 'flower' };
const LIMESTONE = [0.60, 0.58, 0.52]; // linear albedo
const BASALT = [0.075, 0.075, 0.082];

export function createCalcadaTexture(pattern = CALCADA_PATTERN.waves, size = 256) {
  const name = CALCADA_NAMES[pattern] || 'waves';
  return cached(`calcada:${name}:${size}`, () => {
    const data = new Uint8Array(size * size * 4);
    const mot = valueNoise(size, 6, 77); // soft wear mottling
    const grey = name === 'sidewalk' ? 0.84 : name === 'street' ? 0.80 : 1.0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const u = x / size;
        const v = y / size;

        // diagonal staggered cobbles, ~8 cm, with dark joints (periodic)
        const CN = 14;
        let r = (u + v) * CN;
        const s = (v - u) * CN;
        r += 0.5 * Math.floor(s);
        const ci = Math.floor(r);
        const cj = Math.floor(s);
        const fx = r - ci - 0.5;
        const fy = s - cj - 0.5;
        const edge = Math.max(Math.abs(fx), Math.abs(fy));
        const joint = smoothstep(0.33, 0.47, edge);
        const hh = hash2(((ci % CN) + CN) % CN, ((cj % CN) + CN) % CN);
        const stone = 0.82 + 0.30 * hh;

        // black basalt share of this pixel
        let m = 0;
        if (name === 'waves') {
          const w = v * 5 + 0.6 * Math.sin(2 * Math.PI * 3 * u);
          m = 1 - smoothstep(0.16, 0.24, Math.abs(fract(w) - 0.5));
        } else if (name === 'net') {
          const q1 = (u + v) * 6;
          const q2 = (u - v) * 6;
          const b = Math.min(Math.abs(q1 - Math.round(q1)), Math.abs(q2 - Math.round(q2)));
          m = 1 - smoothstep(0.04, 0.08, b);
        } else if (name === 'flower') {
          const gf = 4;
          const lx = u * gf - Math.floor(u * gf) - 0.5;
          const ly = v * gf - Math.floor(v * gf) - 0.5;
          const rr = Math.hypot(lx, ly);
          const pr = 0.16 + 0.10 * Math.abs(Math.cos(2 * Math.atan2(ly, lx)));
          m = 1 - smoothstep(pr - 0.02, pr + 0.02, rr);
        }

        const lime = LIMESTONE;
        const rock = [BASALT[0], BASALT[1], BASALT[2]];
        const wear = 0.90 + 0.22 * mot(x, y);
        const cs = stone * (1 - 0.50 * joint) * wear;
        const cr = (lime[0] * grey) + (rock[0] - lime[0] * grey) * m;
        const cg = (lime[1] * grey) + (rock[1] - lime[1] * grey) * m;
        const cb = (lime[2] * grey) + (rock[2] - lime[2] * grey) * m;
        data[i] = clamp01(cr * cs) * 255;
        data[i + 1] = clamp01(cg * cs) * 255;
        data[i + 2] = clamp01(cb * cs) * 255;
        data[i + 3] = clamp01(stone * (1 - 0.75 * joint)) * 255;
      }
    }
    return dataTexture(data, size, THREE.SRGBColorSpace);
  });
}

// Every calçada pattern at once (lazy in practice: only the builds called
// here are ever made). Handy for a future streetscape pass that switches the
// shader to a sampled map.
export function createCalcadaTextures(size = 256) {
  const out = {};
  for (const name of ['waves', 'net', 'sidewalk', 'street', 'flower']) out[name] = createCalcadaTexture(name, size);
  return out;
}

// ------------------------------------------------------------ wet / dry
// Subtle normal + roughness modulation for wet/dry stone. R is a broad
// wetness mask (puddles and damp patches: drive roughness down and specular
// up), G is fine micro-roughness, and B/A are the tangent-space normal xy
// (z rebuilt by the consumer, as with createStoneTextures().normal). Small
// and tileable, so it rides the same wall-aligned uv as the stone maps.
export function createWetDryTexture(size = 128) {
  return cached(`wetdry:${size}`, () => {
    const data = new Uint8Array(size * size * 4);
    const wet = fbm(size, 131);
    const micro = fbm(size, 191);
    const h = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const p = y * size + x;
        const i = p * 4;
        const w = smoothstep(0.55, 0.80, wet(x, y)); // broad puddles / damp
        const g = micro(x, y);
        h[p] = 0.12 * w + 0.04 * g;
        data[i] = clamp01(w) * 255;
        data[i + 1] = clamp01(g) * 255;
      }
    }
    const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
    const pack = (v) => clamp01(v * 0.5 + 0.5) * 255;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const nx = -(at(x + 1, y) - at(x - 1, y)) * 22;
        const ny = -(at(x, y + 1) - at(x, y - 1)) * 22;
        const l = Math.hypot(nx, ny, 1);
        data[i + 2] = pack(nx / l);
        data[i + 3] = pack(ny / l);
      }
    }
    return dataTexture(data, size);
  });
}
