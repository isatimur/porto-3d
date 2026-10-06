// Water for porto-3d: the inland streams and ponds, the tidal Douro and its
// estuary, and the Atlantic at the Foz.
//
// Adapted from the 3d-ultra-realistic-water skill (MengTo, Pirate Ship
// Sunset) for a city seen from a moving orbit camera:
//
//   - one Gerstner sum, shaded per pixel from its analytic derivatives. Each
//     wave fades out once its wavelength falls below the pixel footprint, so
//     the far water settles into sky instead of boiling into grain. Phases
//     are wrapped to [0, 2pi) on the CPU;
//   - three sea states share that one sum through a per-vertex kind and a
//     per-wave weight: sheltered inland ripples, the choppier tidal river,
//     and the long Atlantic swell (the skill's 8-wave deep-water spectrum);
//   - the ocean swell shoals near the coast: the water shader reads the
//     coastline profile (data/nature.json `coast`, baked from the OSM
//     coastline) and grows the swell's amplitude and steepness as the shore
//     nears, breaking into whitecaps on the crests at the Foz shoreline;
//   - the Douro reverses on a slow tidal cycle and is calmer along the
//     Ribeira walls;
//   - a baked, tileable detail texture (micro normal, foam lattice, fbm),
//     carried by the flow / current, feeds the normals and the foam;
//   - Fresnel reflection of the PMREM sky environment (MeshPhysicalMaterial,
//     ior 1.33: F0 = 0.02) and the skill's sheen + sparkle sun glitter;
//   - rain rings when it rains (WEATHER_UNIFORMS.cloudShape.w).
//
// One material and one draw for all the water. waterUniforms are shared, so
// another basin (a fountain) can use createWaterMaterial() and move with the
// same waves, sun and time. Units are world units: 1 unit = 4 m (S = 0.25).
import * as THREE from 'three';
import { S } from './geo.js';
import { CITY } from './city.js';

const TAU = Math.PI * 2;

// Light mode (main.js): one detail octave instead of the Gerstner sum; no
// rain rings, no subsurface term. Set before the first water material is made.
let LITE = false;
export function setWaterLite(on) {
  LITE = !!on;
}

// ------------------------------------------------------------ spectra
// Inland ripples: [wavelength (world units), amplitude, heading offset from
// the wind (deg), steepness Q]. Wavelengths 2.7 .. 0.57 u (10.8 .. 2.3 m),
// amplitudes 8 .. 1.7 cm, ΣQ = 0.3.
const RIPPLES = [
  [2.7, 0.02, 0, 0.1],
  [1.61, 0.011, 31, 0.08],
  [0.93, 0.0066, -43, 0.07],
  [0.57, 0.0042, 72, 0.05],
];
// Atlantic swell: the skill's deep-water spectrum, 1 unit = 4 m. L 19.5 ..
// 0.775 u (78 .. 3.1 m), A 0.2 .. 0.005 u (0.8 .. 0.02 m), ΣQ = 0.77.
const OCEAN_SWELL = [
  [19.5, 0.2, 0, 0.17],
  [11.75, 0.13, 23, 0.15],
  [7.75, 0.075, -17, 0.13],
  [4.75, 0.045, 38, 0.11],
  [3.075, 0.0263, -31, 0.08],
  [1.925, 0.015, 12, 0.06],
  [1.225, 0.0085, -49, 0.04],
  [0.775, 0.005, 64, 0.03],
];
// How much of each swell wave the sheltered estuary keeps: only the shorter,
// steeper half of the spectrum reaches the tidal river.
const ESTUARY_KEEP = [0.2, 0.45, 0.55, 0.6, 0.6, 0.5, 0.4, 0.35];
// [L, A, deg, Q, wInland, wTidal, wOcean]
const WAVES = [
  ...RIPPLES.map((w) => [w[0], w[1], w[2], w[3], 1, 1.35, 0]),
  ...OCEAN_SWELL.map((w, i) => [w[0], w[1], w[2], w[3], 0, ESTUARY_KEEP[i], 1]),
];

const G = 9.81 * S; // gravity in world units per second squared
const WIND_HEADING = Math.atan2(0.93, -0.37); // from the Atlantic (WSW), as weather.js

// Tidal current: the Douro reverses on a slow cycle. 1 unit = 4 m.
const TIDE_PERIOD = 180; // s, one full ebb + flood (visible, not real 12.4 h)
const TIDE_AMP = 9; // world units (36 m) of downstream texture excursion
// Swell drift: whitecaps and detail scroll with the dominant swell.
const SWELL_SPEED = 0.8; // world units per second (3.2 m/s)
const SWELL_WRAP = 220; // world units before the drift offset wraps
// The Ribeira waterfront, in world units, from ~41.1408 N, 8.6125 W. An
// elongated ellipse along the quay; the tidal chop is damped inside it.
const RIBEIRA = { x: -31.4, z: 243.3, rx: 240, rz: 110 };

// ------------------------------------------------------------ detail texture
// Baked once on the CPU (the nature layer has no renderer yet), 256 x 256:
// RG micro normal from 32 sines with integer wave vectors (tileable), B a
// foam lattice from two Worley octaves, A an fbm. Data, not colour.
function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function detailTexture(size = 256) {
  const r = lcg(71);
  const waves = [];
  for (let i = 0; i < 32; i++) {
    const a = r() * TAU;
    const kmag = Math.floor(3 + Math.pow(r(), 1.6) * 40);
    let kx = Math.round(Math.cos(a) * kmag);
    let ky = Math.round(Math.sin(a) * kmag);
    if (!kx && !ky) kx = 3;
    waves.push({ kx, ky, amp: 1 / Math.pow(Math.hypot(kx, ky), 1.35), ph: r() * TAU });
  }
  // tileable Worley: distance to the nearest two feature points
  const worley = (u, v, per, seed) => {
    const x = u * per;
    const y = v * per;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let d1 = 9;
    let d2 = 9;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = (((ix + i) % per) + per) % per;
        const cy = (((iy + j) % per) + per) % per;
        let h = Math.imul(cx * 374761393 + cy * 668265263 + seed, 1274126177) >>> 0;
        const ox = (h & 0xffff) / 65535;
        h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
        const oy = (h & 0xffff) / 65535;
        const dx = ix + i + ox - x;
        const dy = iy + j + oy - y;
        const d = dx * dx + dy * dy;
        if (d < d1) {
          d2 = d1;
          d1 = d;
        } else if (d < d2) d2 = d;
      }
    }
    return Math.sqrt(d2) - Math.sqrt(d1);
  };
  const vgrid = (n, seed) => {
    const rr = lcg(seed);
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rr();
    return (u, v) => {
      const x = u * n;
      const y = v * n;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const tx = x - x0;
      const ty = y - y0;
      const at = (i, j) => g[(((j % n) + n) % n) * n + (((i % n) + n) % n)];
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const o = [vgrid(4, 3), vgrid(8, 5), vgrid(16, 7), vgrid(32, 11)];
  const fbm = (u, v) => (0.5 * o[0](u, v) + 0.25 * o[1](u, v) + 0.15 * o[2](u, v) + 0.1 * o[3](u, v));
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let gx = 0;
      let gy = 0;
      for (const w of waves) {
        const c = Math.cos((w.kx * u + w.ky * v) * TAU + w.ph) * w.amp;
        gx += w.kx * c;
        gy += w.ky * c;
      }
      const nx = -gx * 0.2;
      const ny = -gy * 0.2;
      const l = Math.hypot(nx, ny, 1);
      const wu = u + (fbm(u, v) - 0.5) * 0.08;
      const wv = v + (fbm(v + 0.37, u) - 0.5) * 0.08;
      const w1 = worley(wu, wv, 9, 17);
      const w2 = worley(wu, wv, 21, 29);
      const sm = (a, b, t) => {
        const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
        return k * k * (3 - 2 * k);
      };
      let lace = (1 - sm(0, 0.2, w1)) * (0.6 + 0.4 * o[3](u, v));
      lace = Math.max(lace, (1 - sm(0, 0.24, w2)) * 0.7);
      const body = fbm(wu * 1.7 % 1, wv * 1.7 % 1);
      const foam = Math.min(1, Math.max(0, lace * 0.75 + body * 0.75 - 0.12));
      const i = (y * size + x) * 4;
      data[i] = ((nx / l) * 0.5 + 0.5) * 255;
      data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      data[i + 2] = foam * 255;
      data[i + 3] = fbm(u, v) * 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8; // grazing views over the lake
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ------------------------------------------------------------ shared uniforms
const phases = new Float32Array(WAVES.length);
const waveList = WAVES.map(([L, A, deg, Q, wi, wt, wo], i) => {
  const k = TAU / L;
  const h = WIND_HEADING + (deg * Math.PI) / 180;
  return {
    L,
    A,
    Q,
    k,
    omega: Math.sqrt(G * k),
    dx: Math.sin(h),
    dz: -Math.cos(h),
    seed: (i * 2.39) % TAU,
    w: new THREE.Vector3(wi, wt, wo),
  };
});
const SWELL_DIR = { x: waveList[RIPPLES.length].dx, z: waveList[RIPPLES.length].dz };
const COAST_MAX = 256; // uniform coast-profile slots
export const waterUniforms = {
  uWaveDir: { value: waveList.map((w) => new THREE.Vector4(w.dx, w.dz, w.k, w.A)) },
  uWaveQ: { value: waveList.map((w) => new THREE.Vector4(w.Q / w.k, w.L, 0, 0)) },
  uWaveW: { value: waveList.map((w) => w.w.clone()) },
  uWavePhase: { value: phases },
  uWDetail: { value: null },
  uWTime: { value: 0 },
  uWSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uWSunCol: { value: new THREE.Color(1, 1, 1) },
  uWDeep: { value: new THREE.Color(0x14302e) },
  uWEDeep: { value: new THREE.Color(0x1c3a34) },
  uWODeep: { value: new THREE.Color(0x0a2233) },
  uWShallow: { value: new THREE.Color(0x4a5a3a) },
  uWFoam: { value: new THREE.Color(0xd9d6cc) },
  uWTideOff: { value: 0 },
  uWSwellOff: { value: new THREE.Vector2() },
  uWSwellGain: { value: 1.6 },
  uWSwellQ: { value: 0.9 },
  uWMaxQ: { value: 1.2 },
  // 0..1 airborne spray torn off the breakers at the shoreline, raised by the
  // weather (weather.js) in a storm or the nortada; the ocean shader lifts it
  // as a pale veil over the crests at the Foz.
  uWSpray: { value: 0 },
  uWShoal: { value: 150 },
  uWWall: { value: new THREE.Vector4(RIBEIRA.x, RIBEIRA.z, RIBEIRA.rx, RIBEIRA.rz) },
  uWCoast: { value: new Float32Array(COAST_MAX) },
  uWCoastCount: { value: 0 },
  uWCoastZ: { value: new THREE.Vector2(0, 1) },
};

const WATER_VERT_PARS = /* glsl */ `
attribute vec2 aFlow;
attribute float aShore;
attribute float aKind;
varying vec2 vFlow;
varying float vShore;
varying float vKind;
`;
const WATER_FRAG_PARS = /* glsl */ `
#define NW ${WAVES.length}
#define NCOAST ${COAST_MAX}
uniform vec4 uWaveDir[NW];   // dx, dz, k, A
uniform vec4 uWaveQ[NW];     // Q/k, L
uniform vec3 uWaveW[NW];     // [inland, tidal, ocean] weight
uniform float uWavePhase[NW];
uniform sampler2D uWDetail;
uniform float uWTime;
uniform float uWTideOff, uWSwellGain, uWSwellQ, uWMaxQ, uWSpray, uWShoal, uWCoastCount;
uniform vec2 uWSwellOff, uWCoastZ;
uniform vec4 uWWall;
uniform float uWCoast[NCOAST];
uniform vec3 uWSunDir, uWSunCol, uWDeep, uWEDeep, uWODeep, uWShallow, uWFoam;
varying vec2 vFlow;
varying float vShore;
varying float vKind;
vec3 wNor = vec3(0.0, 1.0, 0.0);
float wJ = 1.0;
float wH = 0.0;
float wFoamK = 0.0;
float wSprayK = 0.0;

// Coastline x at a world z, from the baked profile (data/nature.json coast).
// Returns a huge x (no shoaling) when the profile is missing or out of range.
float wCoastX(float z) {
  if (uWCoastCount < 1.5) return 1.0e9;
  float u = clamp((z - uWCoastZ.x) / (uWCoastZ.y - uWCoastZ.x + 1e-6), 0.0, 1.0) * (uWCoastCount - 1.0);
  int i0 = int(floor(u));
  int i1 = min(i0 + 1, int(uWCoastCount) - 1);
  return mix(uWCoast[i0], uWCoast[i1], fract(u));
}
float wHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
// rain rings: one expanding ring per cell and cycle; the xz slope of the
// ring profile (world units), faded where a cell is only a few pixels
vec2 wRings(vec2 p, float cell, float t, float foot) {
  vec2 g = p / cell;
  vec2 id = floor(g);
  vec2 f = fract(g);
  vec2 slope = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j));
    float h = wHash(id + o);
    float ph = fract(t * (0.9 + 0.4 * h) + h * 7.3);
    vec2 c = o + vec2(wHash(id + o + 17.1), wHash(id + o + 41.7)) - f;
    float d = length(c);
    float r = ph * 1.1;
    float x = (d - r) * 9.0;
    float env = exp(-x * x * 0.35) * (1.0 - ph) * step(d, 1.2);
    slope += (d > 1e-3 ? -c / d : vec2(0.0)) * cos(x * 2.2) * env;
  }
  // strong slopes: under a flat overcast sky only the Fresnel change shows
  return slope * (1.0 - smoothstep(0.08, 0.25, foot / cell)) * 1.8;
}
// Gerstner sum with analytic partial derivatives; every wave fades out once
// it is shorter than ~2-5 pixel footprints (skill rule 1). kind selects the
// sea state through the per-wave weights; the ocean shoals near the coast and
// the tidal river is damped inside the Ribeira shelter.
vec3 wGerstner(vec2 p, float footprint, float kind, out float J, out float height) {
  float kIn = 1.0 - step(0.5, kind);
  float kTd = step(0.5, kind) * (1.0 - step(1.5, kind));
  float kOc = step(1.5, kind);
  float shoal = 0.0;
  if (kOc > 0.5) {
    float dshore = max(0.0, wCoastX(p.y) - p.x);
    shoal = 1.0 - smoothstep(0.0, uWShoal, dshore);
  }
  float calm = 0.0;
  if (kTd > 0.5) {
    vec2 e = vec2((p.x - uWWall.x) / uWWall.z, (p.y - uWWall.y) / uWWall.w);
    calm = 1.0 - smoothstep(0.45, 1.0, length(e));
  }
  vec3 dPdx = vec3(1.0, 0.0, 0.0);
  vec3 dPdz = vec3(0.0, 0.0, 1.0);
  height = 0.0;
  for (int i = 0; i < NW; i++) {
    float wgt = uWaveW[i].x * kIn + uWaveW[i].y * kTd + uWaveW[i].z * kOc;
    if (wgt <= 0.0) continue;
    vec4 w = uWaveDir[i];
    vec4 q = uWaveQ[i];
    float L = q.y;
    float fade = 1.0 - smoothstep(L * 0.18, L * 0.5, footprint);
    if (fade <= 0.0) continue;
    float ampK = wgt;
    float qK = wgt;
    if (kOc > 0.5) {
      // long swells shoal and steepen toward the shore
      float sw = shoal * smoothstep(2.0, 9.0, L);
      ampK *= 1.0 + uWSwellGain * sw;
      qK *= min(1.0 + uWSwellQ * sw, uWMaxQ);
    }
    if (kTd > 0.5) {
      // calm sheltered band along the Ribeira walls
      ampK *= mix(1.0, 0.3, calm);
      qK *= mix(1.0, 0.45, calm);
    }
    float A = w.w * fade * ampK;
    float QA = q.x * fade * qK;
    float th = w.z * dot(w.xy, p) + uWavePhase[i];
    float s = sin(th), c = cos(th);
    height += A * s;
    float kA = w.z * A, kQA = w.z * QA;
    dPdx.x -= kQA * w.x * w.x * s;
    dPdx.y += kA * w.x * c;
    dPdx.z -= kQA * w.x * w.y * s;
    dPdz.x -= kQA * w.x * w.y * s;
    dPdz.y += kA * w.y * c;
    dPdz.z -= kQA * w.y * w.y * s;
  }
  J = dPdx.x * dPdz.z - dPdx.z * dPdz.x;
  return normalize(cross(dPdz, dPdx));
}
`;

// replaces #include <normal_fragment_maps>: the water normal, world space
const WATER_NORMAL = /* glsl */ `
vec3 wP = vFogWorld;
vec3 wToCam = cameraPosition - wP;
float wDist = length(wToCam);
vec3 wV = wToCam / max(wDist, 1e-4);
vec2 wFw = fwidth(wP.xz);
float wFoot = max(wFw.x + wFw.y, 1e-4);
#ifdef BRG_WATER_LITE
vec3 wN = vec3(0.0, 1.0, 0.0);
{
  vec2 dA = texture2D(uWDetail, wP.xz / 4.8 - vFlow * uWTime * 0.08 + uWTime * vec2(0.011, 0.007)).xy * 2.0 - 1.0;
  vec2 dn = dA * (0.4 * exp(-wDist / 160.0) + 0.08);
  wN = normalize(wN + vec3(dn.x, 0.0, dn.y));
}
#else
vec3 wN = wNor;
{
  float kind = vKind;
  float kIn = 1.0 - step(0.5, kind);
  float kTd = step(0.5, kind) * (1.0 - step(1.5, kind));
  float kOc = step(1.5, kind);
  vec2 s1 = uWTime * vec2(0.011, 0.007);
  vec2 s2 = uWTime * vec2(-0.008, 0.012);
  if (kIn > 0.5) {
    // detail: two octaves carried downstream by the flow map, cross-faded
    float ph0 = fract(uWTime * 0.08);
    float ph1 = fract(uWTime * 0.08 + 0.5);
    float wf = abs(1.0 - 2.0 * ph0);
    vec2 fA = vFlow * ph0 * 12.5;
    vec2 fB = vFlow * ph1 * 12.5;
    vec2 dA = mix(texture2D(uWDetail, (wP.xz - fA) / 4.8 + s1).xy, texture2D(uWDetail, (wP.xz - fB) / 4.8 + s1 + 0.5).xy, wf) * 2.0 - 1.0;
    vec2 dB = mix(texture2D(uWDetail, (wP.zx - fA.yx) / 1.8 + s2).xy, texture2D(uWDetail, (wP.zx - fB.yx) / 1.8 + s2 + 0.5).xy, wf) * 2.0 - 1.0;
    float dStr = 0.3 * exp(-wDist / 160.0) + 0.06;
    vec2 dn = (dA * 0.65 + dB.yx * 0.4) * dStr;
    wN = normalize(wN + vec3(dn.x, 0.0, dn.y));
  } else {
    // open water: two octaves drifting with the tidal current / the swell
    vec2 drift = (vFlow * uWTideOff) * kTd + uWSwellOff * kOc;
    vec2 dA = texture2D(uWDetail, wP.xz / 4.8 + drift / 4.8).xy * 2.0 - 1.0;
    vec2 dB = texture2D(uWDetail, wP.zx / 1.8 - drift / 1.8).xy * 2.0 - 1.0;
    float dStr = 0.28 * exp(-wDist / 300.0) + 0.05;
    vec2 dn = (dA * 0.65 + dB.yx * 0.4) * dStr;
    wN = normalize(wN + vec3(dn.x, 0.0, dn.y));
  }
  #ifdef USE_FOG
  if (cloudShape.w > 0.01) {
    vec2 rg = wRings(wP.xz, 0.4, uWTime, wFoot) + wRings(wP.xz + 0.13, 0.27, uWTime * 1.3 + 0.5, wFoot);
    wN = normalize(wN + vec3(rg.x, 0.0, rg.y) * cloudShape.w);
  }
  #endif
}
#endif
normal = normalize(mat3(viewMatrix) * wN);
`;

// after the lights: glitter in place of the stock sun highlight
const WATER_GLITTER = /* glsl */ `
#include <lights_fragment_end>
reflectedLight.directSpecular *= 0.0;
{
  vec3 L = uWSunDir;
  vec3 R = reflect(-wV, wN);
  R.y = abs(R.y) + 0.002; // skill rule: no reflection below the horizon
  float rl = max(dot(R, L), 0.0);
  float sheen = pow(rl, 90.0) * 0.18 + pow(rl, 12.0) * 0.012;
  float sparkle = pow(rl, 1400.0) * 6.0;
  float shade = 1.0;
  #ifdef USE_FOG
  shade = brgCloudShade(vFogWorld, fogLightDir);
  #endif
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(wN, wV), 0.0), 5.0);
  vec3 glit = uWSunCol * (sheen + sparkle) * shade * (0.35 + 0.65 * fres) * (1.0 - wFoamK) * step(0.0, L.y);
  #ifdef BRG_WATER_LITE
  reflectedLight.indirectSpecular += glit;
  #else
  // subsurface: the ripple faces toward a low sun let a little light through
  float toward = pow(max(dot(-normalize(vec2(wV.x, wV.z) + 1e-4), normalize(L.xz + 1e-4)), 0.0), 2.0);
  vec3 sss = uWShallow * uWSunCol * toward * clamp(1.0 - wN.y, 0.0, 1.0) * 0.35 * shade;
  reflectedLight.indirectSpecular += glit + sss;
  #endif
}
`;

// the body and the foam, before any lighting (replaces color_fragment)
const WATER_COLOR = /* glsl */ `
#include <color_fragment>
wFoamK = 0.0;
{
  vec3 P = vFogWorld;
  float kind = vKind;
  float kIn = 1.0 - step(0.5, kind);
  float kTd = step(0.5, kind) * (1.0 - step(1.5, kind));
  float kOc = step(1.5, kind);
  float shore = vShore;
  // wave surface (normals, Jacobian, crest height) once per pixel
  #ifndef BRG_WATER_LITE
  vec2 wfw = fwidth(P.xz);
  wNor = wGerstner(P.xz, max(wfw.x + wfw.y, 1e-4) * 2.0, kind, wJ, wH);
  #endif
  // body: sheltered green inland, tidal teal, deep blue ocean
  vec3 deep = mix(mix(uWDeep, uWEDeep, kTd), uWODeep, kOc);
  float shallow = kIn * (1.0 - smoothstep(0.0, 2.2, shore));
  #ifndef BRG_WATER_LITE
  shallow = max(shallow, kOc * (1.0 - smoothstep(0.0, uWShoal * 0.55, max(0.0, wCoastX(P.y) - P.x))));
  #endif
  diffuseColor.rgb = mix(deep, uWShallow, shallow * 0.75);
  // foam lattice, scrolled by the flow, the reversing tide, or the swell
  vec2 foamScroll = -vFlow * uWTime * 0.35 * kIn;
  foamScroll += -vFlow * uWTideOff * 0.35 * kTd;
  foamScroll += uWSwellOff * kOc;
  vec4 ft = texture2D(uWDetail, P.xz / 2.2 + foamScroll);
  vec4 ft2 = texture2D(uWDetail, P.zx / 0.85 + uWTime * vec2(0.006, -0.004) + uWSwellOff * kOc);
  float pattern = ft.b * 0.72 + ft2.b * 0.28;
  float m = 0.0;
  if (kIn > 0.5) {
    // lace foam hugging the bank: the lattice thresholded by the mask
    float bank = (1.0 - smoothstep(0.0, 0.8, shore)) * 0.55;
    bank = max(bank, (1.0 - smoothstep(0.0, 1.2, shore)) * clamp(length(vFlow) * 0.7, 0.0, 0.3));
    m = max(m, bank);
  }
  #ifndef BRG_WATER_LITE
  {
    // open-ocean whitecaps on the crests, plus breakers at the shoreline
    float crestFoam = smoothstep(0.78, 0.42, wJ);
    float dshore = max(0.0, wCoastX(P.y) - P.x);
    float shoal = 1.0 - smoothstep(0.0, uWShoal, dshore);
    float breaker = kOc * smoothstep(uWShoal, uWShoal * 0.15, dshore) * smoothstep(-0.02, 0.18, wH);
    // a storm tears more foam off the crests; the nortada and rain lift it
    float openFoam = crestFoam * (kTd * 0.35 + kOc * (0.35 + 0.65 * shoal)) * (0.7 + 0.3 * uWSpray);
    // at m near 1 the threshold below passes for any pattern value, so a
    // whole swell crest turned into a solid white blob (camouflage over the
    // Foz sea). Capped, the lattice still has to agree: foam is lacy.
    // Breakers: densest on the surf line, thinning out to scattered lace
    // 150 m out; open-water whitecaps stay sparse.
    float surf = 1.0 - smoothstep(0.0, uWShoal * 0.3, dshore);
    m = max(m, max(min(openFoam, 0.3), breaker * (0.2 + 0.32 * surf)));
    // airborne spray: torn off the breaking crests at the Foz shoreline,
    // strongest in a storm, none in the lite tier
    wSprayK = kOc * shoal * smoothstep(0.0, 0.16, wH) * uWSpray;
  }
  #endif
  float foam = smoothstep(1.0 - m, 1.2 - m, pattern * 0.88 + m * 0.22);
  float dist = length(cameraPosition - P);
  foam *= 1.0 - smoothstep(250.0, 700.0, dist);
  wSprayK *= 1.0 - smoothstep(300.0, 800.0, dist);
  wFoamK = clamp(foam + wSprayK * 0.6, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, uWFoam * 0.6, foam * 0.85);
  diffuseColor.rgb = mix(diffuseColor.rgb, uWFoam, wSprayK * 0.45);
  // a pale veil that lifts above the breakers, additive so it reads over the
  // shaded water without smearing the sea into a flat white. Scaled by the
  // sun so it dims at night with the rest of the time of day.
  float wDayK = 0.2 + 0.8 * clamp(uWSunDir.y, 0.0, 1.0);
  totalEmissiveRadiance += uWFoam * wSprayK * 0.14 * wDayK;
}
`;

// One program for every water surface. The sea state is read per vertex
// (aKind), so the inland water, the tidal Douro and the ocean share one
// material and one draw.
export function createWaterMaterial() {
  if (!waterUniforms.uWDetail.value) waterUniforms.uWDetail.value = detailTexture();
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x0b1f24,
    roughness: 0.05,
    metalness: 0,
    ior: 1.33, // F0 = 0.02
    envMapIntensity: 1.5,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  mat.name = 'water';
  mat.defines = { BRG_WATER: '' };
  if (LITE) mat.defines.BRG_WATER_LITE = '';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, waterUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${WATER_VERT_PARS}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlow = aFlow;\nvShore = aShore;\nvKind = aKind;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${WATER_FRAG_PARS}`)
      .replace('#include <color_fragment>', WATER_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.85, wFoamK);')
      .replace('#include <normal_fragment_maps>', WATER_NORMAL)
      .replace('#include <lights_fragment_end>', WATER_GLITTER)
      // sparkles may pass the bloom threshold (1.5) as points, never as a blob
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb = min(gl_FragColor.rgb, vec3(2.2));');
  };
  return mat;
}

// ------------------------------------------------------------ geometry
// Distance from (x, z) to the rings' edges, world units.
function edgeDistance(x, z, rings) {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j];
      const b = ring[i];
      const dx = b.x - a.x;
      const dz = b.y - a.y;
      const l2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.y) * dz) / l2));
      best = Math.min(best, Math.hypot(a.x + dx * t - x, a.y + dz * t - z));
    }
  }
  return best;
}

// Net area of a projected area's rings (outer minus holes), world units².
function waterArea(rings) {
  const ringArea = (r) => {
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j].x + r[i].x) * (r[j].y - r[i].y);
    return Math.abs(a) / 2;
  };
  return Math.max(0, ringArea(rings[0]) - rings.slice(1).reduce((s, r) => s + ringArea(r), 0));
}

// Principal axis of a ring, oriented downstream toward the sea (west). Used
// as the tidal-current flow direction of the Douro.
function riverAxis(ring) {
  let mx = 0;
  let mz = 0;
  for (const p of ring) {
    mx += p.x;
    mz += p.y;
  }
  mx /= ring.length;
  mz /= ring.length;
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  for (const p of ring) {
    const dx = p.x - mx;
    const dz = p.y - mz;
    sxx += dx * dx;
    sxz += dx * dz;
    szz += dz * dz;
  }
  const tr = sxx + szz;
  const l1 = (tr + Math.sqrt(Math.max(tr * tr - 4 * (sxx * szz - sxz * sxz), 0))) / 2;
  let ex = l1 - szz;
  let ez = sxz;
  if (Math.abs(ex) < 1e-6 && Math.abs(ez) < 1e-6) {
    ex = 1;
    ez = 0;
  }
  const el = Math.hypot(ex, ez) || 1;
  ex /= el;
  ez /= el;
  if (ex > 0) {
    ex = -ex;
    ez = -ez;
  }
  return { x: ex, z: ez };
}

// Rivers as ribbons draped on the terrain (three vertices across: bank,
// centre, bank, so the bank distance interpolates); ponds and reservoirs as
// flat polygons, split until no edge is longer than MAX_EDGE so the bank
// distance has interior vertices to live on.
export function createWater({ data, areas, project, heightAt }) {
  const pos = [];
  const idx = [];
  const flow = [];
  const shore = [];
  const kind = [];
  const FLOW = 0.45; // world units per second, about 1.8 m/s
  const LIFT = 0.28; // world units (1.1 m) above the terrain
  const MAX_SEG = 5;
  const MAX_EDGE = 4.5; // world units (18 m)
  // A bank-distance mesh only needs vertices near the bank: the Douro or the
  // ocean would otherwise be split to millions of triangles (and overflow the
  // argument list). Cap the vertex count; edges longer than this are fine
  // offshore.
  const VERT_CAP = 20000;
  // Open water (a.open): the tidal estuary, a wide river, the ocean. No bank
  // foam and no fine subdivision — the source ring is dense enough and the
  // surface is flat-shaded anyway. The ocean is identified by area (the only
  // open body of hundreds of km²); the rest is the tidal Douro.
  const SHORE_OPEN = 99.0;
  const OCEAN_AREA = 1.0e6; // world units² (about 16 km²)
  // streams that run in a culvert (the OSM export lost the tunnel tag): in
  // Porto the Rio da Vila under Rua Mouzinho da Silveira showed as a water
  // strip up the middle of a paved street (cities/<id>.json culverted_streams)
  const culverted = new Set(CITY.culverted_streams || []);
  for (const l of data.lines || []) {
    if (!Array.isArray(l.p) || l.p.length < 2) continue;
    if (l.n && culverted.has(l.n)) continue;
    const half = ((l.w || 3) * S) / 2;
    const pts = [];
    let prev = null;
    for (const q of l.p) {
      const c = project(q[0], q[1]);
      if (prev) {
        const n = Math.max(1, Math.ceil(Math.hypot(c.x - prev.x, c.z - prev.z) / MAX_SEG));
        for (let i = 1; i <= n; i++) pts.push({ x: prev.x + ((c.x - prev.x) * i) / n, z: prev.z + ((c.z - prev.z) * i) / n });
      } else pts.push(c);
      prev = c;
    }
    const base = pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      const L = Math.hypot(dx, dz) || 1;
      dx /= L;
      dz /= L;
      const p = pts[i];
      for (const side of [-1, 0, 1]) {
        const x = p.x - dz * half * side;
        const z = p.z + dx * half * side;
        pos.push(x, heightAt(x, z) + LIFT, z);
        flow.push(dx * FLOW, dz * FLOW);
        shore.push(side ? 0 : half);
        kind.push(0);
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const v = base + i * 3;
      for (let k = 0; k < 2; k++) idx.push(v + k, v + 3 + k, v + k + 1, v + k + 1, v + 3 + k, v + 4 + k);
    }
  }
  for (const a of areas) {
    if (a.k !== 'water') continue;
    const outer = a.rings[0].map((p) => new THREE.Vector2(p.x, p.z));
    const holes = a.rings.slice(1).map((r) => r.map((p) => new THREE.Vector2(p.x, p.z)));
    if (THREE.ShapeUtils.isClockWise(outer)) outer.reverse();
    for (const h of holes) if (!THREE.ShapeUtils.isClockWise(h)) h.reverse();
    let faces;
    try {
      faces = THREE.ShapeUtils.triangulateShape(outer, holes);
    } catch {
      continue;
    }
    const all = outer.concat(...holes);
    const rings = [outer, ...holes];
    const open = !!a.open;
    const bodyArea = a.area || waterArea(rings);
    const kindVal = open ? (bodyArea > OCEAN_AREA ? 2 : 1) : 0;
    const axis = kindVal === 1 ? riverAxis(rings[0]) : { x: 0, z: 0 };
    const hs = all.map((p) => heightAt(p.x, p.y));
    let lo = Infinity;
    let hi = -Infinity;
    for (const h of hs) {
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    const flat = hi - lo < 2; // a pond: level; else follow the ground
    // split long edges (midpoints shared through a key map); open water keeps
    // its source resolution — it needs no bank-distance vertices
    const verts = all.map((p) => ({ x: p.x, z: p.y }));
    const mid = new Map();
    const midpoint = (i, j) => {
      const key = i < j ? `${i}_${j}` : `${j}_${i}`;
      let m = mid.get(key);
      if (m === undefined) {
        m = verts.length;
        verts.push({ x: (verts[i].x + verts[j].x) / 2, z: (verts[i].z + verts[j].z) / 2 });
        mid.set(key, m);
      }
      return m;
    };
    let tris = faces.map((f) => f.slice());
    for (let pass = 0; !open && pass < 6 && verts.length < VERT_CAP; pass++) {
      const next = [];
      let split = false;
      for (const [i, j, k] of tris) {
        const e = (p, q) => Math.hypot(verts[p].x - verts[q].x, verts[p].z - verts[q].z);
        if (Math.max(e(i, j), e(j, k), e(k, i)) <= MAX_EDGE) {
          next.push([i, j, k]);
          continue;
        }
        split = true;
        const ij = midpoint(i, j);
        const jk = midpoint(j, k);
        const ki = midpoint(k, i);
        next.push([i, ij, ki], [ij, j, jk], [ki, jk, k], [ij, jk, ki]);
      }
      tris = next;
      if (!split) break;
    }
    const base = pos.length / 3;
    let dist = null;
    let tiny = false;
    if (!open) {
      dist = verts.map((v) => edgeDistance(v.x, v.z, rings));
      // a basin too small for interior vertices would be lace all over: it
      // gets no bank foam (a tank or a fountain pool with a stone rim)
      let far = 0;
      for (const d of dist) if (d > far) far = d;
      tiny = far < 1;
    }
    verts.forEach((v, i) => {
      pos.push(v.x, (flat ? lo : heightAt(v.x, v.z)) + LIFT * 0.7, v.z);
      flow.push(axis.x, axis.z);
      shore.push(open ? SHORE_OPEN : tiny ? 3 : dist[i]);
      kind.push(kindVal);
    });
    for (const [i, j, k] of tris) idx.push(base + i, base + j, base + k);
  }
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  // face every triangle up
  const P = geo.attributes.position.array;
  const I = geo.index.array;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3;
    const b = I[t + 1] * 3;
    const c = I[t + 2] * 3;
    const ny = (P[b + 2] - P[a + 2]) * (P[c] - P[a]) - (P[b] - P[a]) * (P[c + 2] - P[a + 2]);
    if (ny < 0) {
      const tmp = I[t + 1];
      I[t + 1] = I[t + 2];
      I[t + 2] = tmp;
    }
  }
  const nor = new Float32Array(P.length);
  for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
  geo.setAttribute('aShore', new THREE.Float32BufferAttribute(shore, 1));
  geo.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  geo.computeBoundingSphere();

  // The coastline profile (data/nature.json coast, ascending latitude): the
  // ocean shader reads it to shoal and break at the shore. Shared uniforms,
  // so it is baked once for this water body.
  if (Array.isArray(data.coast) && data.coast.length >= 2) {
    const world = data.coast.map(([lat, lon]) => project(lat, lon));
    const n = Math.min(world.length, COAST_MAX);
    const arr = waterUniforms.uWCoast.value;
    for (let i = 0; i < n; i++) arr[i] = world[i].x;
    waterUniforms.uWCoastCount.value = n;
    waterUniforms.uWCoastZ.value.set(world[0].z, world[n - 1].z);
  }

  const mesh = new THREE.Mesh(geo, createWaterMaterial());
  mesh.name = 'water';
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;

  let sunSource = null; // the visible sun (scene.js skySunDir), when set
  let time = 0;
  let tideT = 0;
  let swell = 0;
  return {
    mesh,
    triangles: idx.length / 3,
    // the glitter follows the visible sun disc
    setSunSource(v) {
      sunSource = v;
    },
    // dt: 0 under reduced motion (a still surface); light: { dir, color }
    update(dt, light) {
      const step = Math.min(dt, 1 / 20);
      time += step;
      waterUniforms.uWTime.value = time;
      // phases wrapped on the CPU (skill rule): no large sin() arguments
      for (let i = 0; i < waveList.length; i++) {
        const w = waveList[i];
        let ph = (w.seed - w.omega * time) % TAU;
        if (ph < 0) ph += TAU;
        phases[i] = ph;
      }
      // the Douro reverses on a slow tidal cycle
      tideT += step;
      waterUniforms.uWTideOff.value = TIDE_AMP * Math.sin((TAU * tideT) / TIDE_PERIOD);
      // whitecaps and detail drift with the dominant swell
      swell += step * SWELL_SPEED;
      if (swell > SWELL_WRAP) swell -= SWELL_WRAP;
      waterUniforms.uWSwellOff.value.set(swell * SWELL_DIR.x, swell * SWELL_DIR.z);
      if (light) {
        waterUniforms.uWSunDir.value.copy(sunSource || light.dir);
        waterUniforms.uWSunCol.value.copy(light.color);
      }
    },
  };
}
