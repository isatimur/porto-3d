// Ordinary buildings up close: pitched roofs and facades by district.
// DOM-free (the tile worker imports it through buildings.js).
//
// Zones, by distance from the city's historic centre (data/buildings.json
// `hist`, set by buildings.js before the first extrusion):
//   historic  <= 900 m   granite ground floor, plaster or azulejo above,
//                        tall narrow windows with wooden shutters, iron
//                        balconies, shop fronts on the main streets;
//   riverfront<= 1300 m  and low ground: granite arcades and shop fronts at
//                        street level (the Ribeira / Douro waterfront);
//   ring      <= 2200 m  19th-20th c. plaster in Braga's palette, regular
//                        windows, a granite plinth;
//   outer                houses (<= 300 m2, low): plaster, sparse windows;
//                        apartment blocks and anything tall: concrete and
//                        glass bands; sheds: metal with a high window strip.
// Wall palettes drift per 1 km tile (wallBase), so a block reads as one
// palette with subtle building-to-building colour and value variation.
// The style and a seed ride in the wall attribute aWall.w (style * 2 +
// seed), a shop-front edge in aWall.z (+1000); the fragment shader below
// draws everything from those, no textures bar a small procedural detail
// map (src/textures.js) sampled by world position.
//
// Roofs: OSM roof:shape when tagged; otherwise houses and small buildings
// get gabled or hipped roofs on their oriented minimum-area rectangle
// (clipped to the footprint when it is not a rectangle), about 30 degrees,
// ridge at most 3.5 m; large, complex, commercial and industrial buildings
// stay flat, with a parapet and some rooftop boxes. The roof is the lower
// envelope of a few planes, one per rectangle side (plus a flat cap), so a
// facet is the footprint clipped to the convex region where its plane is
// lowest, and a wall's top follows the same envelope (gable triangles).
import { ShapeUtils, Vector2 } from 'three';
import { S } from './geo.js';

// ------------------------------------------------------------ config
// ?facades=0: flat roofs and the old window grid everywhere (A/B, escape hatch)
const CFG = { cx: 0, cz: 0, grefM: 0, has: false, lite: false, off: new URLSearchParams(globalThis.location?.search || '').get('facades') === '0' };
// centre: world {x, z} of the historic centre (null: no historic zone)
export function setFacadeConfig({ centre = undefined, lite = undefined, off = undefined, centreGroundM = undefined } = {}) {
  if (centre !== undefined) {
    CFG.has = !!centre;
    CFG.cx = centre ? centre.x : 0;
    CFG.cz = centre ? centre.z : 0;
  }
  if (centreGroundM !== undefined) CFG.grefM = Number.isFinite(centreGroundM) ? centreGroundM : 0;
  if (lite !== undefined) CFG.lite = !!lite;
  if (off !== undefined) CFG.off = !!off;
}
export const getFacadeConfig = () => ({ centre: CFG.has ? { x: CFG.cx, z: CFG.cz } : null, centreGroundM: CFG.grefM, lite: CFG.lite, off: CFG.off });

export const HIST_M = 900;
export const RING_M = 2200;
// Ribeira / Douro waterfront: ground this far below the centre, this close
// to it, reads as the old riverfront and gets arcaded ground floors.
export const OLD_M = 1300;
export const OLD_DROP_M = 45;
export const STYLE = { LEGACY: 0, HIST: 1, AZUL: 2, RING: 3, MODERN: 4, HOUSE: 5, IND: 6, ARCADE: 7 };

// metres from the historic centre (Infinity without one)
export function centreDist(x, z) {
  return CFG.has ? Math.hypot(x - CFG.cx, z - CFG.cz) / S : Infinity;
}

// Coherent random in [0, 1) per 1 km tile (world units), so a neighbourhood
// picks one palette and drifts together instead of a per-building patchwork.
function tileHash(x, z, salt = 0) {
  const tx = Math.floor(x / (1000 * S));
  const tz = Math.floor(z / (1000 * S));
  let h = Math.imul(tx ^ (0x9e3779b9 + salt), 0x85ebca6b) ^ Math.imul(tz ^ 0x27d4eb2f, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

// ------------------------------------------------------------ colours
// sRGB hex -> linear rgb [r, g, b]
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export function hexLinear(hex) {
  const n = typeof hex === 'number' ? hex : parseInt(String(hex).replace('#', ''), 16);
  if (!Number.isFinite(n)) return null;
  return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)];
}
const L = (list) => list.map(hexLinear);
// Braga's plaster: white and cream most, then ochre, pale pink, pale blue;
// a few granite fronts in the centre
const PAL = {
  [STYLE.HIST]: L([0xece7dc, 0xe8dfcc, 0xe0d0ad, 0xd9b26a, 0xd8b8a8, 0xbccad3, 0xb0a693, 0xe9e4da, 0x9fa2a0, 0xc9b79a]),
  [STYLE.AZUL]: L([0xe9e6de]),
  [STYLE.ARCADE]: L([0xece7dc, 0xe6ddcb, 0xd9cfb6, 0xc4b79e, 0xd8c6ab]),
  [STYLE.RING]: L([0xe9e3d6, 0xe4d6b9, 0xdbb577, 0xdcbaab, 0xc2ced4, 0xe6dfcf, 0xcfd2bd, 0xd7c4a2]),
  [STYLE.MODERN]: L([0xd8d5ce, 0xcac6bd, 0xe2ded4, 0xbab5ab, 0xd3cab9]),
  [STYLE.HOUSE]: L([0xefe9de, 0xece4d2, 0xe6d6b4, 0xe2c99e, 0xdfc4b8, 0xd5d5cc]),
  [STYLE.IND]: L([0xaaa9a4, 0xa0a6aa, 0xb7b0a0, 0x929a9e]),
  [STYLE.LEGACY]: L([0xcfc2aa, 0xd8d0c0, 0xb9ad99, 0xc9ae86, 0xcdb7a6, 0xa89f92]),
};
const MATERIAL = { stone: 0xb0a898, brick: 0xa45c42, concrete: 0xbcb9b1, glass: 0x71889a, wood: 0x8c6c4c, metal: 0x9ca2a6 };
// terracotta, new and weathered
const TERRACOTTA = L([0xb4623f, 0xa85a3c, 0x9e5238, 0xbc6c48, 0x914d37, 0xab6649, 0xc1734e, 0x9a5a44]);
const FLAT_ROOF = L([0x7d786f, 0x8f8a80, 0x6f6c66]);
const CLUTTER = hexLinear(0xa5a39d);

// ------------------------------------------------------------ style
// k: OSM kind (or 'ms'); hM: wall height (m); a: attrs ({ m, wc, ... });
// groundM: ground height at the building (m, 0 at the centre's terrain)
export function facadeStyle(x, z, k, areaM2, hM, a, h1, groundM = null) {
  if (CFG.off) return STYLE.LEGACY;
  const d = centreDist(x, z);
  const m = a?.m;
  if (k === 'industrial' || m === 'metal') return STYLE.IND;
  if (k === 'commercial' && areaM2 > 1500 && hM <= 14) return STYLE.IND;
  if (m === 'glass') return STYLE.MODERN;
  // the Douro waterfront (Ribeira, Bolsa, the low riverfront): granite
  // arcades and shop fronts at street level, plaster or azulejo above
  if (CFG.has && groundM != null && hM <= 26 && m !== 'glass' && m !== 'concrete' && d <= OLD_M && groundM - CFG.grefM < -OLD_DROP_M) return STYLE.ARCADE;
  if (d <= HIST_M) {
    if (hM > 22) return STYLE.MODERN;
    if (m === 'concrete') return STYLE.RING;
    return h1 < 0.15 && m !== 'stone' && !a?.wc ? STYLE.AZUL : STYLE.HIST;
  }
  if (m === 'concrete') return STYLE.MODERN;
  if (d <= RING_M) {
    if (hM >= 17 || ((k === 'commercial' || k === 'public') && areaM2 > 1500)) return STYLE.MODERN;
    return STYLE.RING;
  }
  if (hM >= 14) return STYLE.MODERN;
  if (areaM2 <= 300) return STYLE.HOUSE;
  return k === 'commercial' || k === 'public' ? STYLE.MODERN : STYLE.RING;
}

// wall rgb (linear, before dimming) for a style, a seed and the tags.
// x, z (world) pick a per-tile palette drift so a block reads as one
// palette with subtle building-to-building colour and value variation.
export function wallBase(style, h1, a, x = 0, z = 0) {
  if (a?.wc) {
    const c = hexLinear(a.wc);
    if (c) return c;
  }
  if (a?.m && MATERIAL[a.m]) return hexLinear(MATERIAL[a.m]);
  const p = PAL[style] || PAL[STYLE.LEGACY];
  const t = tileHash(x, z, 11);
  const c = p[Math.floor(((h1 * 0.72 + t * 0.28) % 1) * p.length) % p.length];
  const v = 0.94 + 0.12 * (0.5 * tileHash(x, z, 23) + 0.5 * h1);
  const warm = (tileHash(x, z, 37) - 0.5) * 0.05;
  return [c[0] * v * (1 + warm), c[1] * v, c[2] * v * (1 - warm)];
}
export function roofBase(flat, h2, a) {
  if (a?.rc) {
    const c = hexLinear(a.rc);
    // OSM roof colours are often loud (#E96B39): pull them toward the tile
    if (c) return [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8];
  }
  const p = flat ? FLAT_ROOF : TERRACOTTA;
  return p[Math.floor(h2 * p.length) % p.length];
}

// ------------------------------------------------------------ OSM tags
// The tags scripts/fetch-buildings.mjs and fetch-tiles.mjs keep, normalised:
// { r roof shape, rc roof colour '#rrggbb', wc wall colour, m material,
// ro 'across' }; only the keys a building has. Null when none.
const NAMED = {
  white: '#ffffff', black: '#202020', grey: '#808080', gray: '#808080', lightgrey: '#d3d3d3', lightgray: '#d3d3d3',
  darkgrey: '#5a5a5a', darkgray: '#5a5a5a', silver: '#c0c0c0', red: '#a8452f', darkred: '#7a2a20', maroon: '#7a3a2e',
  orange: '#c0643f', terracotta: '#c0643f', brown: '#8b5a3c', beige: '#e8dcc0', cream: '#f0e6cc', ivory: '#f6f2e4',
  yellow: '#e8c860', lightyellow: '#f4ebc0', coral: '#e9a58a', salmon: '#e8957a', pink: '#e8b4b0', lightpink: '#f0c4c8',
  moccasin: '#ffe4b5', wheat: '#f0dcb0', tan: '#d2b48c', blue: '#6a8caf', lightblue: '#b8cad8', green: '#5f8a5a',
};
export function colourHex(v) {
  if (v == null) return null;
  let s = String(v).trim().toLowerCase().replace(/\s+/g, '');
  if (NAMED[s]) return NAMED[s];
  if (/^#?[0-9a-f]{3}$/.test(s)) s = s.replace('#', '').replace(/(.)/g, '$1$1');
  else if (/^#?[0-9a-f]{6}$/.test(s)) s = s.replace('#', '');
  else return null;
  return '#' + s;
}
const MATS = { stone: 'stone', granite: 'stone', sandstone: 'stone', brick: 'brick', bricks: 'brick', concrete: 'concrete', glass: 'glass', mirror: 'glass', wood: 'wood', timber_framing: 'wood', metal: 'metal', steel: 'metal', metal_plates: 'metal', plaster: 'plaster', render: 'plaster', cement_block: 'concrete' };
export function osmExtras(tags = {}) {
  const out = {};
  const r = normShape(tags['roof:shape']);
  if (r) out.r = r;
  const rc = colourHex(tags['roof:colour']);
  if (rc) out.rc = rc;
  const wc = colourHex(tags['building:colour']);
  if (wc) out.wc = wc;
  const m = MATS[String(tags['building:material'] || tags['building:facade:material'] || '').toLowerCase()];
  if (m && m !== 'plaster') out.m = m;
  if (tags['roof:orientation'] === 'across') out.ro = 'across';
  return Object.keys(out).length ? out : null;
}

// ------------------------------------------------------------ roof plan
// Oriented minimum-area rectangle over the footprint's edge directions:
// { ux, uz, u0, u1, v0, v1, area } (u along the long side).
export function minRect(pts) {
  let best = null;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) continue;
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of pts) {
      const u = p.x * ux + p.z * uz;
      const v = -p.x * uz + p.z * ux;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-9) best = { ux, uz, u0, u1, v0, v1, area };
  }
  if (!best) return null;
  if (best.v1 - best.v0 > best.u1 - best.u0) {
    // turn it so u runs along the long side
    const { ux, uz, u0, u1, v0, v1 } = best;
    best = { ux: -uz, uz: ux, u0: v0, u1: v1, v0: -u1, v1: -u0, area: best.area };
  }
  return best;
}

const RIDGE_MAX_M = 3.5;
const PARAPET_M = 0.8;
const EAVE_M = 0.35; // roof overhang past the walls (regular footprints)
const REGULAR_FILL = 0.85; // footprint area / its rectangle: roof on the rectangle
const MERGE_M = 0.12; // wall-top kinks smaller than this are dropped
const SHAPES = new Set(['flat', 'gabled', 'hipped', 'pyramidal', 'skillion']);
// tagged roof:shape (scripts keep the raw value) -> one of SHAPES
export function normShape(s) {
  if (!s) return null;
  s = String(s).toLowerCase();
  if (SHAPES.has(s)) return s;
  if (/gambrel|saltbox|round|gabled_row|double_saltbox/.test(s)) return 'gabled';
  if (/hip|mansard|dome|onion|cone/.test(s)) return 'hipped';
  if (/skillion|lean/.test(s)) return 'skillion';
  return null;
}

// The roof of one footprint: { shape, planes, parapet, clutter }.
// planes: [{ ax, az, c }], roof y = ax * x + az * z + c (world units);
// empty for a flat roof. top: eave height (world y).
export function roofPlan(pts, areaM2, k, hM, style, top, a, h2, h3) {
  const flat = (parapet) => ({ shape: 'flat', planes: [], parapet: parapet && !CFG.lite, clutter: 0 });
  if (CFG.off) return flat(false);
  const tagged = normShape(a?.r);
  const shed = k === 'industrial' || style === STYLE.IND;
  const big = areaM2 > 900;
  let shape = tagged;
  const n = pts.length;
  const R = n >= 3 ? minRect(pts) : null;
  if (!R) return flat(false);
  const fill = (areaM2 * S * S) / R.area;
  const hist = style === STYLE.HIST || style === STYLE.AZUL || style === STYLE.ARCADE;
  // regular footprints: the roof on the rectangle (cheap, with eaves);
  // irregular ones: a hip clipped to the outline (centre only) or flat
  const regular = fill >= REGULAR_FILL;
  if (!shape) {
    if (shed || k === 'church') shape = 'flat';
    else if (hist) shape = areaM2 <= 1600 && (regular || (fill >= 0.5 && n <= 24)) ? 'auto' : 'flat';
    else if (style === STYLE.RING) shape = areaM2 <= 700 && regular && hM <= 20 ? 'auto' : 'flat';
    else if (style === STYLE.MODERN) shape = areaM2 <= 300 && hM <= 14 && regular ? 'auto' : 'flat';
    else shape = areaM2 <= 300 && hM <= 14 && regular ? 'auto' : 'flat';
  }
  if (shape === 'flat') {
    // parapets and rooftop boxes only where the camera comes close (the
    // centre and the ring): elsewhere a flat roof costs what it did
    let cx = 0;
    let cz = 0;
    for (const p of pts) {
      cx += p.x;
      cz += p.z;
    }
    const close = centreDist(cx / n, cz / n) <= RING_M;
    const parapet = close && !shed && areaM2 >= 120 && hM >= 5;
    const p = flat(parapet);
    // rooftop clutter: machine rooms and vents on some larger flat roofs
    if (close && !CFG.lite && !shed && areaM2 >= 150 && h3 < 0.5) p.clutter = areaM2 > 600 ? 3 : areaM2 > 300 ? 2 : 1;
    if (close && !CFG.lite && shed && areaM2 >= 400 && h3 < 0.3) p.clutter = 2;
    return p;
  }
  const len = R.u1 - R.u0;
  const wid = R.v1 - R.v0;
  const halfW = wid / 2;
  const halfL = len / 2;
  const pitch = ((27 + 6 * h2) * Math.PI) / 180;
  const tanP = Math.tan(pitch);
  const capU = RIDGE_MAX_M * S;
  let H = Math.min(capU, tanP * halfW);
  if (H < 0.7 * S) return flat(false);
  if (shape === 'auto') {
    // gabled along the long axis for elongated, regular footprints; hipped
    // otherwise (a hip clips cleanly to an irregular outline)
    const hist = style === STYLE.HIST || style === STYLE.AZUL || style === STYLE.ARCADE;
    const gabledShare = hist ? 0.35 : 0.55;
    shape = len / wid >= 1.3 && fill >= 0.85 && h2 < gabledShare ? 'gabled' : 'hipped';
  }
  // the four sides as planes: height = top + s * (distance inside the side)
  const { ux, uz } = R;
  // side lines: v = v0 (inward +v), v = v1 (inward -v), u = u0 (+u), u = u1 (-u)
  // a point's v = -x*uz + z*ux, u = x*ux + z*uz
  const side = (gu, gv, off, s) => ({ ax: s * (gu * ux - gv * uz), az: s * (gu * uz + gv * ux), c: top + s * off });
  const across = a?.ro === 'across';
  const planes = [];
  if (shape === 'skillion') {
    const Hs = Math.min(2 * S, Math.tan((15 * Math.PI) / 180) * wid);
    const s = Hs / wid;
    planes.push(across ? side(1, 0, -R.u0, Hs / len) : side(0, 1, -R.v0, s));
    return { shape, planes, parapet: false, clutter: 0, poly: regular ? eaveRect(R) : null };
  }
  let sW = tanP; // slope off the long sides
  let sL = tanP; // off the short sides (hips)
  if (shape === 'pyramidal') {
    sW = H / halfW;
    sL = H / halfL;
  } else if (shape === 'gabled' && tanP * halfW > capU) sW = capU / halfW;
  if (shape === 'gabled' && across) {
    // ridge across the long axis: the gables on the long sides
    H = Math.min(capU, tanP * halfL);
    const s = H / halfL;
    planes.push(side(1, 0, -R.u0, s), side(-1, 0, R.u1, s));
  } else {
    planes.push(side(0, 1, -R.v0, sW), side(0, -1, R.v1, sW));
    if (shape !== 'gabled') planes.push(side(1, 0, -R.u0, sL), side(-1, 0, R.u1, sL));
  }
  // a flat cap where a wide hip would rise above the ridge limit
  if (shape === 'hipped' && tanP * halfW > capU + 1e-6) planes.push({ ax: 0, az: 0, c: top + capU });
  return { shape, planes, parapet: false, clutter: 0, poly: regular ? eaveRect(R) : null };
}

// The rectangle grown by the eave overhang: the roof of a regular
// footprint. The planes pass through the eave line `top` on the walls and
// drop below it over the overhang.
function eaveRect(R) {
  const o = EAVE_M * S;
  const { ux, uz } = R;
  const at = (u, v) => ({ x: u * ux - v * uz, z: u * uz + v * ux });
  const p = [at(R.u0 - o, R.v0 - o), at(R.u1 + o, R.v0 - o), at(R.u1 + o, R.v1 + o), at(R.u0 - o, R.v1 + o)];
  return polyArea2(p) < 0 ? p.reverse() : p;
}

const planeY = (P, x, z) => P.ax * x + P.az * z + P.c;
function envelope(planes, x, z) {
  let y = Infinity;
  for (const P of planes) {
    const v = planeY(P, x, z);
    if (v < y) y = v;
  }
  return y;
}

// The top of a wall a -> b under the roof: [{ t, y }], t in 0..1, concave.
function wallTop(planes, a, b, top) {
  if (!planes.length) return [{ t: 0, y: top }, { t: 1, y: top }];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const ts = [0, 1];
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      const P = planes[i];
      const Q = planes[j];
      // (P - Q)(a + t d) = 0
      const k0 = planeY(P, a.x, a.z) - planeY(Q, a.x, a.z);
      const k1 = (P.ax - Q.ax) * dx + (P.az - Q.az) * dz;
      if (Math.abs(k1) < 1e-12) continue;
      const t = -k0 / k1;
      if (t <= 1e-4 || t >= 1 - 1e-4) continue;
      // keep it only where both planes are the envelope
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      const e = envelope(planes, x, z);
      if (planeY(P, x, z) - e < 1e-5) ts.push(t);
    }
  }
  ts.sort((p, q) => p - q);
  let out = [];
  for (const t of ts) {
    if (out.length && t - out.at(-1).t < 1e-4) continue;
    out.push({ t, y: Math.max(top, envelope(planes, a.x + dx * t, a.z + dz * t)) });
  }
  // drop kinks within MERGE_M of the straight line (near-rectangular
  // footprints under a rectangle roof): a triangle each, for nothing
  const tol = MERGE_M * S;
  for (let k = 1; k < out.length - 1 && out.length > 2; ) {
    const p = out[k - 1];
    const q = out[k + 1];
    const y = p.y + ((q.y - p.y) * (out[k].t - p.t)) / (q.t - p.t);
    if (Math.abs(out[k].y - y) < tol) out.splice(k, 1);
    else k++;
  }
  return out;
}

// Sutherland-Hodgman: polygon (any) clipped to f(p) <= 0, f linear
function clipHalf(poly, fx, fz, f0) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const A = poly[i];
    const B = poly[(i + 1) % n];
    const fa = fx * A.x + fz * A.z + f0;
    const fb = fx * B.x + fz * B.z + f0;
    if (fa <= 0) out.push(A);
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
      const t = fa / (fa - fb);
      out.push({ x: A.x + (B.x - A.x) * t, z: A.z + (B.z - A.z) * t });
    }
  }
  return out;
}
// drop repeated and collinear points (the clips leave them on the cut lines)
function tidy(poly) {
  let p = poly;
  for (let pass = 0; pass < 2 && p.length >= 3; pass++) {
    const out = [];
    const n = p.length;
    for (let i = 0; i < n; i++) {
      const A = out.length ? out.at(-1) : p[(i + n - 1) % n];
      const B = p[i];
      const C = p[(i + 1) % n];
      if (Math.abs(B.x - A.x) + Math.abs(B.z - A.z) < 1e-6) continue;
      const cross = (B.x - A.x) * (C.z - B.z) - (B.z - A.z) * (C.x - B.x);
      const l = Math.hypot(B.x - A.x, B.z - A.z) * Math.hypot(C.x - B.x, C.z - B.z);
      if (Math.abs(cross) <= 1e-6 * l) continue;
      out.push(B);
    }
    p = out;
  }
  return p;
}
function polyArea2(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const A = p[i];
    const B = p[(i + 1) % p.length];
    a += A.x * B.z - B.x * A.z;
  }
  return a;
}

// ------------------------------------------------------------ geometry
// Pushes walls and roof of one building into T (see buildings.js
// extrudeBuilding for the layout). g: { base, gmin, top, footM, hM, wc,
// rc, w (aWall.w), shop(i) -> bool }.
const contour = [];
export function extrudeRoofed(T, pts, plan, g) {
  const { base, gmin, top, footM, hM, wc, rc, w } = g;
  const n = pts.length;
  // the pitched facets first: a clip that fails on an odd outline (the
  // facets do not cover it) falls back to a flat roof
  const facets = plan.planes.length ? roofFacets(plan, pts) : null;
  if (facets === null && plan.planes.length) plan = FLAT_FALLBACK;
  const planes = plan.planes;
  const wallTo = plan.parapet ? top + PARAPET_M * S : top;
  let run = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const nx = dz / len;
    const nz = -dx / len;
    const LM = len / S;
    const zEnc = hM + (g.shop && g.shop(i) ? 1000 : 0);
    const tops = planes.length ? wallTop(planes, a, b, top) : [{ t: 0, y: wallTo }, { t: 1, y: wallTo }];
    // polygon: a_base, b_base, then the top from b back to a; convex (the
    // envelope is concave along the wall), so a fan from a_base
    const v = T.pos.length / 3;
    const f = 0.62;
    T.pos.push(a.x, base, a.z, b.x, base, b.z);
    T.nor.push(nx, 0, nz, nx, 0, nz);
    T.col.push(wc[0] * f, wc[1] * f, wc[2] * f, wc[0] * f, wc[1] * f, wc[2] * f);
    T.wall.push(run, -footM, zEnc, w, run + LM, -footM, zEnc, w);
    for (let k = tops.length - 1; k >= 0; k--) {
      const { t, y } = tops[k];
      T.pos.push(a.x + dx * t, y, a.z + dz * t);
      T.nor.push(nx, 0, nz);
      T.col.push(wc[0], wc[1], wc[2]);
      T.wall.push(run + LM * t, (y - gmin) / S, zEnc, w);
    }
    const m = 2 + tops.length;
    for (let j = 1; j < m - 1; j++) T.idx.push(v, v + j + 1, v + j);
    if (plan.parapet) {
      // the parapet's inner face (no windows: aWall.y -1, as the roof)
      const u = T.pos.length / 3;
      const pf = 0.8;
      T.pos.push(a.x, top, a.z, b.x, top, b.z, b.x, wallTo, b.z, a.x, wallTo, a.z);
      for (let q = 0; q < 4; q++) {
        T.nor.push(-nx, 0, -nz);
        T.col.push(wc[0] * pf, wc[1] * pf, wc[2] * pf);
        T.wall.push(0, -1, 0, w);
      }
      T.idx.push(u, u + 1, u + 2, u, u + 2, u + 3);
    }
    run += LM;
  }

  // roof
  if (!planes.length) {
    flatCap(T, pts, top, rc, w, T.idx);
    if (plan.clutter) clutter(T, pts, top, plan.clutter, w, g.seed);
    return;
  }
  // T.near / T.farCap (optional): the pitched facets go to T.near, and a
  // flat cap at the eaves to T.farCap, so a mesh can draw either (the
  // middle LOD of buildings.js); without them, the facets go to T.idx
  const IDX = T.near || T.idx;
  if (T.farCap) flatCap(T, pts, top, rc, w, T.farCap);
  for (const { P, poly, faces } of facets) {
    let nx = -P.ax;
    let ny = 1;
    let nz = -P.az;
    const nl = Math.hypot(nx, ny, nz);
    nx /= nl;
    ny /= nl;
    nz /= nl;
    // the facet's own slope extent (plane height), so the shader can draw an
    // eave shadow at the low edge and a ridge cap at the high one: aWall.z
    // carries 0 at the eave .. 1 at the ridge
    let ymin = Infinity;
    let ymax = -Infinity;
    for (const p of poly) {
      const y = planeY(P, p.x, p.z);
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;
    }
    const yr = Math.max(ymax - ymin, 1e-6);
    const v0 = T.pos.length / 3;
    for (const p of poly) {
      const y0 = planeY(P, p.x, p.z);
      T.pos.push(p.x, plan.poly ? y0 : Math.max(top, y0), p.z);
      T.nor.push(nx, ny, nz);
      T.col.push(rc[0], rc[1], rc[2]);
      T.wall.push(0, -1, (y0 - ymin) / yr, w);
    }
    for (const [ia, ib, ic] of faces) {
      const A = poly[ia];
      const B = poly[ib];
      const C = poly[ic];
      const up = (B.z - A.z) * (C.x - A.x) - (B.x - A.x) * (C.z - A.z);
      if (up >= 0) IDX.push(v0 + ia, v0 + ib, v0 + ic);
      else IDX.push(v0 + ia, v0 + ic, v0 + ib);
    }
  }
}

const FLAT_FALLBACK = { shape: 'flat', planes: [], parapet: false, clutter: 0 };
// [{ P, poly, faces }] per plane: its region of the roof outline (the eave
// rectangle, or the footprint), triangulated; null when the facets do not
// cover the outline (within 2 %)
function roofFacets(plan, pts) {
  const planes = plan.planes;
  const roofPoly = plan.poly || pts;
  const out = [];
  let covered = 0;
  for (let i = 0; i < planes.length; i++) {
    const P = planes[i];
    let poly = roofPoly;
    for (let j = 0; j < planes.length && poly.length >= 3; j++) {
      if (j === i) continue;
      const Q = planes[j];
      // P <= Q
      poly = clipHalf(poly, P.ax - Q.ax, P.az - Q.az, P.c - Q.c - 1e-7);
    }
    poly = tidy(poly);
    if (poly.length < 3 || Math.abs(polyArea2(poly)) < 1e-6) continue;
    const contour = poly.map((p) => new Vector2(p.x, p.z));
    const faces = ShapeUtils.triangulateShape(contour, []);
    if (!faces.length) continue;
    for (const [a, b, c] of faces) {
      const A = poly[a];
      const B = poly[b];
      const C = poly[c];
      covered += Math.abs((B.x - A.x) * (C.z - A.z) - (B.z - A.z) * (C.x - A.x)) / 2;
    }
    out.push({ P, poly, faces });
  }
  const want = Math.abs(polyArea2(roofPoly)) / 2;
  return Math.abs(covered - want) <= 0.02 * want ? out : null;
}

function flatCap(T, pts, y, rc, w, IDX) {
  contour.length = 0;
  for (const p of pts) contour.push(new Vector2(p.x, p.z));
  const faces = ShapeUtils.triangulateShape(contour, []);
  const v0 = T.pos.length / 3;
  for (const p of pts) {
    T.pos.push(p.x, y, p.z);
    T.nor.push(0, 1, 0);
    T.col.push(rc[0], rc[1], rc[2]);
    T.wall.push(0, -1, 0, w);
  }
  for (const [a, b, c] of faces) {
    const A = pts[a];
    const B = pts[b];
    const C = pts[c];
    const up = (B.z - A.z) * (C.x - A.x) - (B.x - A.x) * (C.z - A.z);
    if (up >= 0) IDX.push(v0 + a, v0 + b, v0 + c);
    else IDX.push(v0 + a, v0 + c, v0 + b);
  }
}

function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
const frac = (v) => v - Math.floor(v);
// machine rooms and vents: small boxes (top and four sides) on a flat roof
function clutter(T, pts, y, count, w, seed) {
  const R = minRect(pts);
  if (!R) return;
  const { ux, uz } = R;
  const at = (u, v) => ({ x: u * ux - v * uz, z: u * uz + v * ux });
  let r = frac(Math.sin(seed * 12.9898 + 4.1) * 43758.5453);
  const rnd = () => (r = frac(r * 9301 + 0.4927 + Math.sin(r * 78.233) * 0.5));
  for (let c = 0, tries = 0; c < count && tries < count * 4; tries++) {
    const su = (1.4 + 2.2 * rnd()) * S;
    const sv = (1.2 + 1.6 * rnd()) * S;
    const hb = (1.0 + 1.4 * rnd()) * S;
    const u = R.u0 + su + (R.u1 - R.u0 - 2 * su) * rnd();
    const v = R.v0 + sv + (R.v1 - R.v0 - 2 * sv) * rnd();
    const cs = [at(u - su / 2, v - sv / 2), at(u + su / 2, v - sv / 2), at(u + su / 2, v + sv / 2), at(u - su / 2, v + sv / 2)];
    if (!cs.every((p) => inPoly(p.x, p.z, pts))) continue;
    c++;
    const k = 0.85 + 0.25 * rnd();
    const col = [CLUTTER[0] * k, CLUTTER[1] * k, CLUTTER[2] * k];
    const y1 = y + hb;
    // (cs is counter-clockwise like the footprint: outward normal (dz, -dx))
    for (let i = 0; i < 4; i++) {
      const A = cs[i];
      const B = cs[(i + 1) % 4];
      const L = Math.hypot(B.x - A.x, B.z - A.z);
      const nx = (B.z - A.z) / L;
      const nz = -(B.x - A.x) / L;
      const v0 = T.pos.length / 3;
      T.pos.push(A.x, y, A.z, B.x, y, B.z, B.x, y1, B.z, A.x, y1, A.z);
      for (let q = 0; q < 4; q++) {
        T.nor.push(nx, 0, nz);
        T.col.push(col[0] * 0.85, col[1] * 0.85, col[2] * 0.85);
        T.wall.push(0, -1, 0, w);
      }
      T.idx.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
    }
    const v0 = T.pos.length / 3;
    for (const p of cs) {
      T.pos.push(p.x, y1, p.z);
      T.nor.push(0, 1, 0);
      T.col.push(col[0], col[1], col[2]);
      T.wall.push(0, -1, 0, w);
    }
    // same orientation test as the roofs
    const up = (cs[1].z - cs[0].z) * (cs[2].x - cs[0].x) - (cs[1].x - cs[0].x) * (cs[2].z - cs[0].z);
    if (up >= 0) T.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
    else T.idx.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
  }
}

// ------------------------------------------------------------ shader
// Fragment declarations and the facade/roof code that replaces three's
// <emissivemap_fragment> in the building material (buildings.js). Light
// mode (BRG_WIN_LITE): no azulejo pattern, shutters, balconies, cornices
// or roof tiles; the window grids, granite bands and shop fronts stay.
export const FACADE_VERT_PARS = /* glsl */ `
attribute vec4 aWall;
varying vec4 vWall;
varying vec3 vBW;
`;
export const FACADE_VERT = /* glsl */ `
vWall = aWall;
vBW = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;
export const FACADE_FRAG_PARS = /* glsl */ `
uniform float uNight;
uniform sampler2D uGrime;
varying vec4 vWall;
varying vec3 vBW;
float bHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
// 1 inside the rectangle r = (x0, y0, x1, y1) of the unit cell
float bRect(vec2 f, vec4 r) {
  return step(r.x, f.x) * step(f.x, r.z) * step(r.y, f.y) * step(f.y, r.w);
}
// soft 1 inside [a, b] of u, edges w wide (w: about a pixel)
float bBand(float u, float a, float b, float w) {
  return smoothstep(a - w, a + w, u) - smoothstep(b - w, b + w, u);
}
// Azulejo on a wall plane, p in metres: an inked ground through a white
// lattice, on a ~15 cm tile with grout, a little glossier than plaster.
// motif picks one of four period patterns so a district is not one stamp:
//   0 star/cross through the tile corners (the Raio manner), 1 pomegranate
//   diamond, 2 baroque scroll rosette, 3 chevron border.
vec3 bAzulejoMotif(vec2 p, vec3 ground, vec3 ink, float motif, float nearK) {
  vec2 t = p / 0.15;
  vec2 tf = fract(t);
  vec2 ti = floor(t);
  float tw = fwidth(t.x);
  float tk = (1.0 - smoothstep(0.16, 0.42, tw)) * nearK;
  float grout = 1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.055, min(min(tf.x, 1.0 - tf.x), min(tf.y, 1.0 - tf.y)))) * tk;
  vec2 q = tf - 0.5;
  float m;
  if (motif < 0.5) {
    float d = abs(q.x) + abs(q.y);
    m = clamp(step(d, 0.30) + step(0.62, d) * step(0.5, mod(ti.x + ti.y, 2.0)), 0.0, 1.0);
  } else if (motif < 1.5) {
    float dia = abs(q.x) + abs(q.y);
    m = step(dia, 0.34) * step(0.17, dia);
    m = max(m, (1.0 - step(0.05, abs(q.x))) * (1.0 - step(0.05, abs(q.y))));
    m = max(m, 1.0 - step(0.06, length(q)));
  } else if (motif < 2.5) {
    float r = length(q);
    m = step(0.21, r) * step(r, 0.33);
    m = max(m, 1.0 - step(0.07, r));
    m = max(m, step(0.4, cos(4.0 * atan(q.y, q.x))) * step(r, 0.12));
  } else {
    m = 1.0 - step(0.05, abs(q.y - 0.22 * sign(q.x) * (0.5 - abs(q.x))));
    m = max(m, 1.0 - step(0.05, abs(q.y + 0.18)));
  }
  return mix(ground, mix(ground, ink, clamp(m, 0.0, 1.0)) * grout, tk);
}
// Granite ashlar as a modulation on a base colour: staggered courses at a
// real block height (Porto granite ~0.35-0.45 m), mortar joints with a bevel
// and per-block tone/pitting. p in metres, courseH in metres.
vec3 bAshlar(vec3 base, vec2 p, float courseH, float nearK) {
  float ch = max(courseH, 0.14);
  float row = floor(p.y / ch);
  float fy = fract(p.y / ch);
  float bw = 0.62 + 0.34 * fract(sin(row * 12.9898) * 43758.5453);
  float xo = fract(row * 0.5) * bw;
  float cx = (p.x + xo) / bw;
  float fx = fract(cx);
  float jy = fwidth(p.y / ch);
  float jx = fwidth(cx);
  float hz = 1.0 - smoothstep(0.0, 0.045 + jy, min(fy, 1.0 - fy));
  float vt = 1.0 - smoothstep(0.0, 0.035 + jx, min(fx, 1.0 - fx));
  float joint = clamp(max(hz, vt), 0.0, 1.0) * (1.0 - smoothstep(0.18, 0.5, max(jy, jx)));
  float bh = fract(sin(dot(floor(vec2(cx, row)), vec2(12.9898, 78.233))) * 43758.5453);
  float pit = fract(sin(dot(floor(p * 11.0), vec2(41.3, 289.1))) * 24634.6345);
  vec3 tone = mix(vec3(0.9, 0.92, 0.95), vec3(1.05, 1.0, 0.9), bh);
  float face = (0.9 + 0.18 * bh) * (0.95 + 0.08 * pit);
  float arris = smoothstep(0.0, 0.04, fy) * (1.0 - smoothstep(0.04, 0.09, fy));
  vec3 c = base * tone * face;
  c = mix(c, c * 0.5, joint * 0.8 * nearK);
  c += (c * 0.18 + vec3(0.008)) * arris * nearK;
  return c;
}
// Plaster: pale lime-wash with a per-building hue drift (0 ochre, 1 rose,
// 2 blue, 3 neutral), a fine render grain and low-frequency mottling.
vec3 bPlaster(vec3 col, float grain, float variant, float nearK) {
  vec3 tint = variant < 0.5 ? vec3(1.05, 0.98, 0.86)
           : variant < 1.5 ? vec3(1.04, 0.95, 0.94)
           : variant < 2.5 ? vec3(0.94, 0.98, 1.04)
           : vec3(1.0);
  col *= mix(vec3(1.0), tint, 0.5 * nearK);
  col *= 1.0 - 0.06 * (1.0 - grain) * nearK;
  return col;
}
`;

// linear colours used below
const G = /* glsl */ `
const vec3 B_GRANITE = vec3(0.30, 0.285, 0.25);
const vec3 B_STONE = vec3(0.44, 0.42, 0.37);
const vec3 B_GLASS = vec3(0.035, 0.042, 0.05);
const vec3 B_IRON = vec3(0.018, 0.018, 0.02);
const vec3 B_FRAME = vec3(0.52, 0.52, 0.5);
const vec3 B_SKY = vec3(0.40, 0.50, 0.64);
const vec3 B_STREET = vec3(0.12, 0.115, 0.10);
const vec3 B_LINEN = vec3(0.72, 0.70, 0.64);
`;

export const FACADE_FRAG = /* glsl */ `
#include <emissivemap_fragment>
{
${G}
float bDist = length(vViewPosition);
#ifdef BRG_WIN_LITE
float bNear = 0.0;
#else
float bNear = 1.0 - smoothstep(75.0, 105.0, bDist); // ~300-420 m
#endif
if (vWall.y >= 0.0 && vWall.w >= 0.0) {
  float bSt = floor(vWall.w * 0.5);
  float bSd = vWall.w - 2.0 * bSt;
  float bShop = step(999.0, vWall.z);
  float bH = vWall.z - 1000.0 * bShop;
  float bY = vWall.y;
  float bX = vWall.x;
  float bAo = 0.62 + 0.38 * clamp(bY / max(bH, 3.0), 0.0, 1.0);
  bool bHist = (bSt > 0.5 && bSt < 2.5) || bSt == 7.0;
#ifndef BRG_WIN_LITE
  // world-plan facade detail: broad soiling (R), fine render grain (G) and
  // vertical rain streaks (B) that vary across the wall, not up it
  vec4 bGr = texture2D(uGrime, vec2(vBW.x, vBW.z) * 0.055);
  float bGrime = bGr.r;
  float bStreak = bGr.b;
#endif
  // per style: cell width, floor height, first window floor, window rect, lit share
  float cw = 3.4;
  float fh = 3.1;
  float g0 = 0.6;
  vec4 wr = vec4(0.27, 0.28, 0.73, 0.8);
  float litK = 0.3;
  if (bHist) { cw = 2.5 + 0.7 * bSd; fh = 3.3; g0 = 4.0; wr = vec4(0.31, 0.1, 0.69, 0.84); litK = 0.34; }
  else if (bSt == 3.0) { cw = 3.0 + 0.5 * bSd; fh = 3.1; g0 = 3.6; wr = vec4(0.3, 0.22, 0.7, 0.8); }
  else if (bSt == 4.0) { cw = 1.6; fh = 3.0; g0 = 3.6; wr = vec4(0.0, 0.32, 1.0, 0.9); litK = 0.26; }
  else if (bSt == 5.0) { cw = 3.8 + 1.0 * bSd; fh = 2.9; g0 = 0.3; wr = vec4(0.35, 0.3, 0.65, 0.78); litK = 0.28; }
  else if (bSt == 6.0) { cw = 6.0; fh = 1.0; g0 = max(bH - 2.0, 0.4); wr = vec4(0.1, 0.0, 0.9, 0.75); litK = 0.1; }
  vec2 cell = vec2(bX / cw, (bY - g0) / fh);
  vec2 id = floor(cell);
  vec2 f = fract(cell);
  float inside = step(0.0, id.y) * step((id.y + wr.w) * fh + g0, bH + 0.05);
  if (bSt == 6.0) inside *= step(id.y, 0.5);
  float win = bRect(f, wr) * inside;
  float px = max(fwidth(cell.x), fwidth(cell.y));
  float aa = 1.0 - smoothstep(0.12, 0.35, px);
  // the far average of the window grid (as a darkening)
  float bFar = (wr.z - wr.x) * (wr.w - wr.y) * step(g0, bY) * step(bY, bH);
  vec3 col = diffuseColor.rgb;
  float bNearK = bNear * aa;
  float glassK = 0.0; // how much of this pixel is window glass (lit at night)
  float shopK = 0.0; // ... shop window
  float signK = 0.0; // ... lit shop fascia / hanging sign
  vec3 signCol = vec3(0.0);

  // ---- plaster variants: pale lime-wash with a per-building hue drift
  // (ochre, rose, blue) and a fine render mottle, only on plaster fronts
  #ifndef BRG_WIN_LITE
  if (bNear > 0.0 && bY > g0 && (bSt == 1.0 || bSt == 3.0 || bSt == 5.0)) {
    col = bPlaster(col, bGr.y, bHash(vec2(bSd * 613.0, 5.0)), bNear);
  }
  #endif

  // ---- azulejo: tiled upper floors, several period motifs per panel
  if (bSt == 2.0 && bY > g0) {
    float az = bHash(vec2(bSd * 91.0, 7.0));
    float motif = floor(az * 4.0);
    vec3 ink = az < 0.55 ? vec3(0.03, 0.09, 0.36) : az < 0.8 ? vec3(0.03, 0.2, 0.12) : vec3(0.62, 0.38, 0.05);
    vec3 ground = vec3(0.62, 0.63, 0.62) * 0.78;
    vec3 mean = mix(ground, ink, 0.32);
    #ifdef BRG_WIN_LITE
    col = mean * bAo;
    #else
    col = bAzulejoMotif(vec2(bX, bY), ground, ink, motif, bNear) * bAo;
    // glazed: a little glossier
    roughnessFactor = mix(roughnessFactor, 0.45, 0.6);
    #endif
  }
#ifndef BRG_WIN_LITE
  // occasional azulejo panels on the historic plaster, blue-and-white in the
  // Porto manner: a small share of houses wear a tiled upper facade
  if (bSt == 1.0 && bY > g0 && bNear > 0.0 && bHash(vec2(bSd * 451.0, 3.0)) > 0.84) {
    float azi = bHash(vec2(bSd * 91.0, 7.0));
    float motif = floor(azi * 4.0);
    vec3 ink = azi < 0.6 ? vec3(0.03, 0.09, 0.36) : azi < 0.85 ? vec3(0.03, 0.2, 0.12) : vec3(0.55, 0.34, 0.05);
    col = mix(col, bAzulejoMotif(vec2(bX, bY), vec3(0.62, 0.63, 0.62) * 0.8, ink, motif, bNear), 0.85 * bNear);
    roughnessFactor = mix(roughnessFactor, 0.45, 0.5 * bNear);
  }
#endif

  // ---- ground floor and plinth
  if (bY < g0 && bSt != 5.0 && bSt != 6.0) {
    if (bSt == 7.0) {
      // Ribeira / old waterfront: a round-arched granite arcade with shops
      // and passages behind it, the piers and spandrels in stone
      float bw = 3.0;
      float abay = bX / bw;
      float abi = floor(abay);
      float abf = fract(abay);
      float ahb = bHash(vec2(abi, bSd * 77.0));
      float spring = min(2.7, g0 - 0.6);
      float arcW = 0.3;               // opening half-width, as a bay fraction
      float r = arcW * bw;            // ~0.9 m
      float dxm = (0.5 - abf) * bw;   // m from the arch centre
      float ym = bY - spring;
      float rect = bRect(vec2(abf, bY), vec4(0.5 - arcW, 0.0, 0.5 + arcW, spring));
      float arch = step(dxm * dxm + ym * ym, r * r) * step(0.0, ym);
      float open = clamp(rect + arch, 0.0, 1.0);
      float oa = 1.0 - smoothstep(0.15, 0.45, fwidth(abay));
      col = B_STONE * (0.82 + 0.16 * bSd) * bAo;
      // the archivolt ring just outside the opening
      float ring = clamp(step(dxm * dxm + ym * ym, (r + 0.16) * (r + 0.16)) * step(0.0, ym) - arch, 0.0, 1.0);
      col = mix(col, B_STONE * 1.08, ring * oa * bNear);
      // behind the arch: a lit shop window or a dark passage
      vec3 inner = ahb < 0.55 ? B_GLASS * 1.25 : vec3(0.015, 0.012, 0.01);
      col = mix(col, inner, open * oa);
      shopK = open * oa * step(ahb, 0.55);
      glassK = max(glassK, open * oa);
      // a keystone at the crown on the wider piers
      float key = bRect(vec2(abf, bY), vec4(0.44, spring + r - 0.02, 0.56, spring + r + 0.22)) * step(0.72, ahb);
      col = mix(col, B_STONE * 1.12, key * oa * bNear);
      // a granite kerb at the foot
      col *= 1.0 - 0.2 * bBand(bY, 0.0, 0.18, fwidth(bY)) * bNear;
    } else {
    if (bHist) col = B_GRANITE * (0.92 + 0.16 * bSd) * bAo;
    else if (bSt == 3.0 && bY < 0.9) col = B_GRANITE * bAo;
    else if (bSt == 4.0) col *= 0.82;
    // shop fronts on the main streets, doors elsewhere
    float bay = bX / 3.3;
    float bi = floor(bay);
    float bf = fract(bay);
    float hb = bHash(vec2(bi, bSd * 53.0));
    float openTop = min(3.0, g0 - 0.55);
    if (bShop > 0.5) {
      float o = bRect(vec2(bf, bY), vec4(0.09, 0.0, 0.91, openTop));
      float frame = o - bRect(vec2(bf, bY), vec4(0.12, 0.0, 0.88, openTop - 0.1));
      vec3 fc = hb < 0.4 ? vec3(0.02, 0.05, 0.03) : hb < 0.7 ? vec3(0.08, 0.035, 0.015) : vec3(0.015);
      float oa = 1.0 - smoothstep(0.2, 0.45, fwidth(bay));
      col = mix(col, B_GLASS * 1.3, o * oa);
      col = mix(col, fc, frame * oa * bNear);
      // a fascia over the opening (near: the sign band)
      float fascia = bBand(bY, openTop + 0.08, openTop + 0.45, fwidth(bY)) * step(0.06, bf) * step(bf, 0.94);
      col = mix(col, fc * 1.5 + vec3(0.02), fascia * bNear * 0.8);
      // shop signage: a lit fascia band and hanging sign in a shop colour;
      // crisp enough that it does not wash the wall at a distance
      signK = fascia * (1.0 - smoothstep(0.12, 0.4, fwidth(bY))) * step(0.5, o);
      float sh = bHash(vec2(bi, bSd * 191.0));
      signCol = sh < 0.32 ? vec3(0.20, 0.60, 1.00)
              : sh < 0.55 ? vec3(1.00, 0.32, 0.16)
              : sh < 0.75 ? vec3(1.00, 0.72, 0.28)
              : sh < 0.90 ? vec3(0.95, 0.25, 0.40)
              : vec3(0.45, 1.00, 0.55);
      shopK = o * step(hb, 0.72);
      glassK = max(glassK, o * oa);
    } else if (bSt != 4.0) {
      float door = bRect(vec2(bf, bY), vec4(0.32, 0.0, 0.68, 2.5)) * step(hb, 0.4);
      float gw = bRect(vec2(bf, bY), vec4(0.33, 1.0, 0.67, 2.5)) * step(0.4, hb) * step(2.9, g0);
      vec3 wood = mix(vec3(0.06, 0.03, 0.015), vec3(0.03, 0.06, 0.04), step(0.5, bSd));
      float oa = 1.0 - smoothstep(0.2, 0.45, fwidth(bay));
      col = mix(col, wood, door * oa);
      col = mix(col, B_GLASS, gw * oa);
      // stone door frames up close
      float df = (bRect(vec2(bf, bY), vec4(0.28, 0.0, 0.72, 2.7)) - bRect(vec2(bf, bY), vec4(0.32, 0.0, 0.68, 2.5))) * step(hb, 0.4);
      col = mix(col, B_STONE, df * bNear * oa);
      glassK = max(glassK, gw * oa);
    } else {
      // modern: a glazed ground floor
      float o = bRect(vec2(bf, bY), vec4(0.04, 0.0, 0.96, min(3.0, g0 - 0.4)));
      float oa = 1.0 - smoothstep(0.2, 0.45, fwidth(bay));
      col = mix(col, B_GLASS * 1.4, o * oa);
      shopK = o * step(hb, 0.5) * step(0.5, bShop + step(0.5, bSd));
      glassK = max(glassK, o * oa);
    }
    }
    // granite ashlar: staggered courses of a real block height, mortar
    // rebate and per-block tone/pitting, on the ground floor and plinth
    #ifndef BRG_WIN_LITE
    if (bNear > 0.0) {
      if (bHist) col = mix(col, bAshlar(col, vec2(bX, bY), 0.4, bNear), 1.0 - glassK);
      else if (bSt == 3.0 && bY < 0.9) col = bAshlar(col, vec2(bX, bY), 0.34, bNear);
    }
    #endif
  }

  // ---- upper windows: several opening types and real glazing
  if (inside > 0.0 && bY >= g0) {
    float hw = bHash(id + vec2(bSd * 211.0, bSd * 97.0));
    float hw2 = bHash(id.yx + vec2(bSd * 353.0, bSd * 137.0));
    vec3 glass = bSt == 4.0 ? vec3(0.045, 0.06, 0.075) : B_GLASS;
    float gk = win * aa;
    // window type: guillotine sash (<0.6), round-arched (0.6..0.85), plain
    // casement (>=0.85); shopfronts are drawn on the ground floor
    float archK = 0.0;
    float archCxm = 0.0;
    float archRad = 0.0;
    float archSpring = -1.0;
    float archMask = 1.0;
    #ifndef BRG_WIN_LITE
    if (bNear > 0.0 && bSt != 4.0 && bSt != 6.0) {
      float Wx = wr.z - wr.x;
      archRad = (Wx * cw * 0.5) / fh;      // head radius in f.y units
      archSpring = wr.w - archRad;
      archCxm = (wr.x + wr.z) * 0.5;
      float fits = step(wr.y + 0.05, archSpring);
      float isArch = fits * step(0.6, hw2) * step(hw2, 0.85);
      archK = isArch;
      float dxa = abs(f.x - archCxm);
      float dya = f.y - archSpring;
      float rect = step(wr.y, f.y) * step(f.y, archSpring);
      float circ = step(0.0, dya) * step(dxa * dxa + dya * dya, archRad * archRad);
      archMask = mix(1.0, clamp(rect + circ, 0.0, 1.0), isArch);
      gk *= archMask;
    }
    #endif
    #ifndef BRG_WIN_LITE
    if (bHist && bNear > 0.0) {
      // shutters: open beside the window, or closed over it (not on arches)
      vec3 wood = bSd < 0.4 ? vec3(0.03, 0.075, 0.04) : bSd < 0.7 ? vec3(0.09, 0.04, 0.018) : vec3(0.55, 0.55, 0.52);
      float open = step(hw, 0.6) * (1.0 - archK);
      float closed = step(0.6, hw) * step(hw, 0.78) * (1.0 - archK);
      float sh = (bRect(f, vec4(wr.x - 0.17, wr.y, wr.x - 0.01, wr.w)) + bRect(f, vec4(wr.z + 0.01, wr.y, wr.z + 0.17, wr.w))) * open * inside;
      float slat = 0.75 + 0.25 * smoothstep(0.3, 0.7, fract(bY / 0.09));
      float sk = bNearK;
      col = mix(col, wood * mix(1.0, slat, bNear), sh * sk);
      gk *= 1.0 - closed * bNear;
      col = mix(col, wood * mix(1.0, slat, bNear), win * closed * sk);
      // stone surround; on an arched opening the corner spandrels are filled
      // and a carved arch ring follows the head
      float fr = bRect(f, vec4(wr.x - 0.05, wr.y - 0.03, wr.z + 0.05, wr.w + 0.04)) * inside - win;
      float spand = win * (1.0 - archMask) * inside;
      col = mix(col, B_STONE, clamp(fr + spand, 0.0, 1.0) * sk);
      if (archK > 0.5) {
        float dxq = abs(f.x - archCxm);
        float dyq = f.y - archSpring;
        float rr = sqrt(max(dxq * dxq + dyq * dyq, 0.0));
        float ring = step(archRad, rr) * step(rr, archRad + 0.055) * step(0.0, dyq) * inside;
        col = mix(col, B_STONE * 1.1, ring * sk);
      }
    } else if (bNear > 0.0 && bSt != 6.0) {
      // painted surround; a roller-shutter box over the window
      float fr = bRect(f, vec4(wr.x - 0.04, wr.y - 0.03, wr.z + 0.04, wr.w + 0.03)) * inside - win;
      col = mix(col, bSt == 4.0 ? col * 0.8 : B_FRAME, fr * bNearK);
      if (bSt != 4.0) {
        float box = bRect(f, vec4(wr.x, wr.w - 0.12, wr.z, wr.w)) * inside * (1.0 - archK);
        col = mix(col, vec3(0.22, 0.22, 0.21), box * bNearK);
        gk *= 1.0 - box * bNear;
      } else {
        // mullions
        float mu = 1.0 - smoothstep(0.0, 0.04 + fwidth(cell.x), min(f.x, 1.0 - f.x));
        gk *= 1.0 - mu * bNear;
      }
    }
    #endif
#ifndef BRG_WIN_LITE
    // recessed reveal: a shadowed lintel, lit jamb returns on one side and a
    // shaded one on the other, a stone sill and a shadow line below it
    if (bNear > 0.0 && bSt != 6.0) {
      float fw = max(fwidth(f.x), fwidth(f.y));
      float sK = bNear * (1.0 - smoothstep(0.15, 0.45, fw));
      float sill = bRect(f, vec4(wr.x - 0.075, wr.y - 0.085, wr.z + 0.075, wr.y - 0.015)) * inside;
      float sillUnder = bRect(f, vec4(wr.x - 0.08, wr.y - 0.12, wr.z + 0.08, wr.y - 0.085)) * inside;
      float lintel = bRect(f, vec4(wr.x - 0.02, wr.w, wr.z + 0.02, wr.w + 0.055)) * inside * (1.0 - archK);
      float jambL = bRect(f, vec4(wr.x - 0.03, wr.y, wr.x + 0.008, wr.w)) * inside;
      float jambR = bRect(f, vec4(wr.z - 0.008, wr.y, wr.z + 0.03, wr.w)) * inside;
      col = mix(col, B_STONE * (bHist ? 1.16 : 1.02), sill * sK);
      col = mix(col, B_STONE * 0.84, (jambR + lintel) * 0.7 * sK);
      col = mix(col, B_STONE * 1.05, jambL * 0.5 * sK);
      col *= 1.0 - 0.5 * sillUnder * sK;
    }
#endif
    #ifndef BRG_WIN_LITE
    if (bNear > 0.0) {
      // AO inside the reveal: the opening's corners recede
      float ex = min(f.x - wr.x, wr.z - f.x) / max(wr.z - wr.x, 1e-3);
      float ey = min(f.y - wr.y, wr.w - f.y) / max(wr.w - wr.y, 1e-3);
      float ao = clamp(min(ex, ey) * 2.2, 0.0, 1.0);
      glass = mix(glass, glass * 0.35, (1.0 - ao) * 0.7);
    }
    #endif
    // glass is not flat black: a per-pane value, a skyward gradient and a
    // faint diagonal sheen so the grid reads as glazing, not holes
    vec3 glassLit = glass * (0.72 + 0.75 * hw) + vec3(0.02, 0.028, 0.036) * smoothstep(0.25, 1.0, f.y);
    float sheen = smoothstep(0.8, 1.0, sin(6.2831 * (f.x * 0.6 + f.y * 0.9) + hw * 6.0));
    glassLit += vec3(0.05, 0.06, 0.07) * sheen;
    #ifndef BRG_WIN_LITE
    if (bNear > 0.0) {
      // sky and street reflection at a grazing angle (Fresnel), broken up by
      // a soft streak; lace curtains or a linen blind on some windows
      vec3 V = normalize(vViewPosition);
      vec3 N = normalize(normal);
      vec3 Rf = reflect(-V, N);
      float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
      float up = clamp(Rf.y * 1.5 + 0.35, 0.0, 1.0);
      vec3 refl = mix(B_STREET, B_SKY, up);
      glassLit = mix(glassLit, glassLit * 0.35 + refl, (0.10 + 0.55 * fres) * bNear);
      float streak = smoothstep(0.7, 1.0, sin(5.0 * f.x + 3.0 * f.y + hw * 7.0));
      glassLit += vec3(0.10, 0.115, 0.13) * streak * bNear * (1.0 - smoothstep(0.0, 0.6, up - 0.4));
      float ordWin = (bSt == 4.0 || bSt == 6.0) ? 0.0 : 1.0;
      float curt = step(hw, 0.42) * (1.0 - archK) * ordWin;
      float dTop = wr.w - f.y;
      float hemDepth = (wr.w - wr.y) * (0.35 + 0.45 * fract(hw2 * 7.0));
      hemDepth -= 0.018 * sin(((f.x - wr.x) / max(wr.z - wr.x, 1e-3)) * 12.0 + hw * 3.0);
      float cloth = step(dTop, hemDepth);
      float lace = smoothstep(0.35, 0.8, fract(f.x * 18.0 + f.y * 6.0));
      glassLit = mix(glassLit, B_LINEN * (0.82 + 0.22 * lace), cloth * curt * 0.8 * bNear);
      // guillotine sash: a meeting rail across the middle and thin glazing bars
      float guill = step(hw2, 0.6) * (1.0 - archK) * ordWin;
      float rail = bBand(f.y, (wr.y + wr.w) * 0.5 - 0.014, (wr.y + wr.w) * 0.5 + 0.014, fwidth(f.y));
      float barV = bBand(f.x, (wr.x + wr.z) * 0.5 - 0.007, (wr.x + wr.z) * 0.5 + 0.007, fwidth(f.x));
      glassLit = mix(glassLit, B_FRAME * 0.45, clamp(rail + barV * 0.9, 0.0, 1.0) * guill * bNear);
    }
    #endif
    col = mix(col, glassLit, gk * 0.9);
    glassK = max(glassK, gk);
    roughnessFactor = mix(roughnessFactor, 0.35, gk);
    #ifndef BRG_WIN_LITE
    // wrought-iron balconies: the first floor of most centre houses, some
    // others, with the railing's shadow cast down the wall
    if (bHist && bNear > 0.0) {
      float yb = bY - g0 - id.y * fh;
      float hasB = id.y < 0.5 ? step(bSd, 0.8) : step(bHash(vec2(id.y, bSd * 17.0)), 0.22);
      float span = step(wr.x - 0.12, f.x) * step(f.x, wr.z + 0.12) * inside * hasB;
      float bw = fwidth(yb);
      float slab = bBand(yb, 0.0, 0.14, bw);
      float rail = bBand(yb, 0.95, 1.03, bw);
      float bars = bBand(yb, 0.14, 0.95, bw) * (1.0 - smoothstep(0.12, 0.3, abs(fract(bX / 0.13) - 0.5) * 2.0 - 0.5));
      float bk = span * bNear * (1.0 - smoothstep(0.2, 0.5, fwidth(bX / 0.13)));
      float castSh = step(yb, 0.04) * (1.0 - smoothstep(0.0, 0.7, -yb));
      float barsSh = 0.7 + 0.3 * smoothstep(0.1, 0.4, abs(fract(bX / 0.13) - 0.5));
      col *= 1.0 - 0.30 * castSh * span * bNear * barsSh;
      col = mix(col, B_STONE * 0.9, slab * span * bNear);
      col = mix(col, B_IRON, clamp(rail + bars * 0.85, 0.0, 1.0) * bk);
    }
    #endif
  }

  // ---- cornice and string course (up close)
  #ifndef BRG_WIN_LITE
  if (bNear > 0.0 && (bHist || bSt == 3.0)) {
    float yw = fwidth(bY);
    float cor = bBand(bY, bH - 0.38, bH + 0.01, yw);
    float shadow = bBand(bY, bH - 0.55, bH - 0.38, yw);
    float course = bHist ? bBand(bY, g0 - 0.28, g0 - 0.04, yw) : 0.0;
    col = mix(col, B_STONE * 1.05, clamp(cor + course, 0.0, 1.0) * bNear);
    col *= 1.0 - 0.35 * shadow * bNear;
  }
  #endif

  // the far grid: darken by the window share, fading in as the grid fades out
  col *= 1.0 - 0.3 * bFar * (1.0 - aa) * step(bSt, 5.5);
#ifndef BRG_WIN_LITE
  // soiling: broad neighbourhood grime plus rain streaks, stronger low on
  // the wall, so plaster never reads as a flat untextured plane
  if (bNear > 0.0) {
    float low = 1.0 - clamp(bY / max(bH, 3.0), 0.0, 1.0);
    col *= 1.0 - 0.09 * bGrime * bNear - 0.11 * bStreak * low * bNear;
  }
#endif
  diffuseColor.rgb = col;

  // the lights only after dusk (a uniform branch: by day no hashes run)
  if (uNight > 0.0) {
    // windows come on unevenly through the dusk: each one has its own
    // threshold, so the facade fills up over the evening instead of
    // switching on at once (and empties again at dawn). The share lit at
    // full night is litK; the shared dusk ramp fades them with the sun.
    float turn = smoothstep(0.0, 0.85, uNight);
    float ph = bHash(id + vec2(bSd * 311.0, bSd * 173.0));
    float lit = step(ph, litK * (0.3 + 0.7 * turn));
    #ifdef BRG_WIN_LITE
    vec3 warm = vec3(1.0, 0.67, 0.36);
    #else
    // colour varies window to window: mostly warm amber and incandescent
    // white, the odd cool screen or fluorescent for a lived-in mix
    float tone = bHash(id.yx + bSd * 57.0);
    vec3 warm = tone < 0.52 ? vec3(1.00, 0.55, 0.20)
              : tone < 0.82 ? vec3(1.00, 0.76, 0.47)
              : tone < 0.93 ? vec3(0.72, 0.83, 1.00)
              : vec3(0.86, 0.95, 0.72);
    #endif
    // per-window brightness, so a lit row is not one flat rectangle
    float bVar = 0.7 + 0.6 * bHash(id.xy + bSd * 401.0);
    float exact = win * lit * step(g0, bY);
    float average = 0.26 * litK * inside * (0.4 + 0.6 * turn);
    // 2.6: a lit window (~1.6 in linear HDR) passes the 1.5 bloom threshold
    totalEmissiveRadiance += warm * bVar * mix(average, exact, aa) * uNight * 2.6;
    totalEmissiveRadiance += vec3(1.0, 0.72, 0.42) * shopK * uNight * 2.2;
    // neon-ish shop signage: the fascia band glows in a shop colour
    totalEmissiveRadiance += signCol * signK * uNight * 1.7;
  }
} else if (vWall.y >= 0.0) {
  // churches: floodlit stone at night
  totalEmissiveRadiance += diffuseColor.rgb * uNight * 0.22;
}
#ifndef BRG_WIN_LITE
else if (bNear > 0.0) {
  // roofs: Portuguese canal tiles — rows lapping down the slope, convex
  // covers across it, a shaded eave and a capped ridge
  vec3 nW = (vec4(normal, 0.0) * viewMatrix).xyz;
  if (nW.y > 0.3 && nW.y < 0.985) {
    vec2 dir = normalize(nW.xz);
    float mU = 4.0; // metres per world unit
    float along = dot(vBW.xz, dir) * mU / 0.36;       // course index down-slope
    float across = dot(vBW.xz, vec2(-dir.y, dir.x)) * mU / 0.21; // tile width
    float k = (1.0 - smoothstep(0.2, 0.5, max(fwidth(along), fwidth(across)))) * bNear;
    float frow = fract(along);
    float ftile = fract(across);
    // the lap: a shadow at the lower edge of each course of tiles; convex
    // barrel covers with a water channel between them
    float lap = 1.0 - smoothstep(0.0, 0.11, frow);
    float barrel = 0.5 + 0.5 * cos(6.2831 * ftile);
    float sd = vWall.w - 2.0 * floor(vWall.w * 0.5);
    float mott = 0.9 + 0.2 * bHash(floor(vec2(along, across)) + sd * 31.0);
    diffuseColor.rgb *= mix(1.0, (1.0 - 0.34 * lap - 0.18 * (1.0 - barrel)) * mott, k);
    // aWall.z carries 0 at the eave .. 1 at the ridge: a shadowed eave, a
    // lighter ridge cap and a distinct ridge line
    float hN = clamp(vWall.z, 0.0, 1.0);
    float eave = 1.0 - smoothstep(0.0, 0.05, hN);
    float ridge = smoothstep(0.95, 1.0, hN);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.55, eave * k);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.14 + vec3(0.02), ridge * k);
  }
}
#endif
}
`;
