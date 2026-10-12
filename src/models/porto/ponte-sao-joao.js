// Ponte de São João (Edgar Cardoso, 1987-91): the double-track railway bridge
// of the Linha do Norte, a post-tensioned concrete box girder built in
// cantilever. Drawn 1:1 in metres.
//
//   - a continuous multi-span frame with vertical piers: a 250 m central span
//     and two 125 m side spans on two river piers (130 micropiles each),
//     then viaducts of about 45 m spans (pt.wikipedia, Ordem dos Engenheiros)
//   - trapezoidal two-cell box girder: 14 m deep over the river piers, 7 m at
//     the middle of the central span, 4 m on the viaducts
//   - electrified double track, catenary masts, noise-free parapets
// Frame: u along the line (+u = local +z, bearing 48.5 deg), v across, y up.
// The model covers the whole 1143 m of the OSM bridge way; where the hills
// are higher than the deck the girder runs inside them.
// Heights: metres over the water (deck: estimate, see dimensions.json).
// Sources and estimates: data/dimensions.json (ponte-sao-joao).
import { bridgeFrame, cuttingWalls, rod, loft, catenaryMast, wire } from '../bridge-kit.js';

const UC = 104; // middle of the river, from the OSM water polygon (-43 .. +251 m)
const SPAN_C = 250;
const SPAN_S = 125;
const DECK_Y = 65.4; // rail bed level: the rail head is at 66 m (Wikidata P2048 "66 m"; data/life.json carries the CP trains at deck_m 66), the masts reach 73 m
const SLAB = 0.9;
const V0 = -5.3; // the two tracks sit 5.3 m off the middle of the OSM outline (local x +5.3)
const W_TOP = 14.4;
const W_BOT = 8.0;
const CONC = 0xe6e6e0;
const CONC_D = 0xcfcfc8;
const C = { mat: 8 };
const U_MIN = -572; // the OSM bridge way runs -571.5 .. +575.6 m (1143 m, the published 1140 m)
const U_MAX = 575;

// river piers, side piers, viaduct piers (absolute u)
function pierList() {
  const P = [{ u: UC - SPAN_C / 2, kind: 'river' }, { u: UC + SPAN_C / 2, kind: 'river' }];
  P.push({ u: UC - SPAN_C / 2 - SPAN_S, kind: 'side' }, { u: UC + SPAN_C / 2 + SPAN_S, kind: 'side' });
  for (let u = UC - SPAN_C / 2 - SPAN_S - 45; u > U_MIN - 10; u -= 45) P.push({ u, kind: 'via' });
  for (let u = UC + SPAN_C / 2 + SPAN_S + 45; u < U_MAX + 10; u += 45) P.push({ u, kind: 'via' });
  return P.sort((a, b) => a.u - b.u);
}

// girder depth: 14 m over the river piers, 7 m in the middle of the central
// span (a parabolic soffit between them, no dip and hump), down to 4 m at the
// side piers and on the viaducts
function depthAt(u) {
  const x = Math.abs(u - UC);
  if (x <= SPAN_C / 2) return 7 + 7 * (x / (SPAN_C / 2)) ** 2;
  const ts = (x - SPAN_C / 2) / SPAN_S;
  return ts < 1 ? 4 + 10 * (1 - ts) ** 1.6 : 4;
}

function builder(k, site) {
  const F = bridgeFrame(site, 1144);
  const g = F.ground;

  k.begin('main');
  k.push({ ry: F.ang });
  k.push({ z: V0 });

  // --------------------------------------------------------- box girder
  const rings = [];
  const step = 4;
  for (let u = U_MIN; u <= U_MAX + 0.01; u += step) {
    const d = depthAt(u);
    const yt = DECK_Y - SLAB;
    const yb = yt - d;
    rings.push([[u, yt, -W_TOP / 2 + 1], [u, yt, W_TOP / 2 - 1], [u, yb, W_BOT / 2], [u, yb, -W_BOT / 2]]);
  }
  // the ring order is (TL, TR, BR, BL) with +z to the right: top-right is +v
  loft(k, rings, CONC, C);
  // the slab with its cantilevers
  k.box(U_MAX - U_MIN, SLAB, W_TOP + 1, CONC, (U_MIN + U_MAX) / 2, DECK_Y - SLAB, 0, C);
  // track bed: ballast and two rails each, sleepers as a darker strip
  k.box(U_MAX - U_MIN, 0.45, 9.4, 0x6f6a63, (U_MIN + U_MAX) / 2, DECK_Y, 0, { mat: 8 });
  for (const v of [-2.45, 2.45]) {
    for (const o of [-0.7175, 0.7175]) rod(k, [U_MIN, DECK_Y + 0.55, v + o], [U_MAX, DECK_Y + 0.55, v + o], 0.1, 0.16, 0x9ba1a6);
  }
  // parapets (noise barriers are low walls) and the cable trough
  for (const s of [-1, 1]) {
    k.box(U_MAX - U_MIN, 1.1, 0.35, CONC, (U_MIN + U_MAX) / 2, DECK_Y + 0.1, s * (W_TOP / 2 - 0.1), C);
    for (let u = U_MIN; u <= U_MAX; u += 3.2) rod(k, [u, DECK_Y + 1.2, s * (W_TOP / 2 - 0.1)], [u, DECK_Y + 2.1, s * (W_TOP / 2 - 0.1)], 0.07, 0.07, 0xa7adb2, { mat: 9 });
    rod(k, [U_MIN, DECK_Y + 2.1, s * (W_TOP / 2 - 0.1)], [U_MAX, DECK_Y + 2.1, s * (W_TOP / 2 - 0.1)], 0.07, 0.07, 0xa7adb2, { mat: 9 });
  }
  // catenary: a mast every 48 m on each edge with a cantilever, two contact wires
  for (let u = U_MIN + 18; u < U_MAX - 6; u += 48) {
    for (const s of [-1, 1]) catenaryMast(k, u, s * (W_TOP / 2 - 0.5), DECK_Y + 0.1, { h: 7.4, dir: s, reach: s > 0 ? 4.9 : 4.9, color: 0xe3e3dd });
  }
  for (const v of [-2.45, 2.45]) {
    wire(k, [U_MIN, DECK_Y + 5.5, v], [U_MAX, DECK_Y + 5.5, v], 0x30343a, 0.06);
    wire(k, [U_MIN, DECK_Y + 6.4, v], [U_MAX, DECK_Y + 6.4, v], 0x30343a, 0.05);
  }

  // ------------------------------------------------------------- piers
  for (const p of pierList()) {
    if (p.u < U_MIN + 2 || p.u > U_MAX - 2) continue;
    const gy = g(p.u, 0);
    const soffit = DECK_Y - SLAB - depthAt(p.u);
    const base = p.kind === 'via' ? gy - 2.5 : p.kind === 'river' ? -4 : Math.min(gy, 3) - 4;
    if (soffit - base < 2) continue;
    if (p.kind === 'river') {
      // a single tapered oval-ish column under the haunch: cap, shaft, foot
      k.frustum(5.2, 8.6, 3.5, 7.4, soffit - base - 4.5, CONC_D, p.u, base, 0, C);
      k.frustum(3.5, 7.4, 5.6, 8.2, 4.5, CONC, p.u, soffit - 4.5, 0, C);
    } else if (p.kind === 'side') {
      k.frustum(4.4, 8.0, 3.2, 7.0, soffit - base - 3.0, CONC_D, p.u, base, 0, C);
      k.frustum(3.2, 7.0, 4.6, 8.0, 3.0, CONC, p.u, soffit - 3.0, 0, C);
    } else {
      k.frustum(3.0, 7.2, 2.4, 6.4, soffit - base - 1.6, CONC_D, p.u, base, 0, C);
      k.frustum(2.4, 6.4, 3.6, 7.6, 1.6, CONC, p.u, soffit - 1.6, 0, C);
    }
    if (p.kind === 'river') k.box(11, 2.4, 17, CONC_D, p.u, base, 0, C); // the footing cap at the waterline
  }

  // ------------------------------------------- abutments where the hills meet the deck
  for (const e of [U_MIN, U_MAX]) {
    const sgn = e < 0 ? -1 : 1;
    const gy = g(e + sgn * 3, 0);
    const bot = Math.min(gy, DECK_Y - 3) - 3;
    k.box(7, DECK_Y - SLAB - bot, W_TOP, CONC_D, e + sgn * 3.5, bot, 0, C);
  }
  // the cuttings at both ends (the hills stand over the rail bed): concrete
  // retaining walls at the pad edge (this frame is V0 off the OSM middle)
  const FV = { ground: (u, v) => g(u, v + V0), raw: (u, v) => F.raw(u, v + V0) };
  cuttingWalls(k, FV, { u0: U_MIN, u1: U_MAX, v: W_TOP / 2 + 0.7, maxH: 10, topMax: DECK_Y + 2, color: CONC_D, cap: CONC });

  k.pop();
  k.pop();
  k.end('main');
}

builder.metric = true;
builder.rule = {
  note: 'Ponte de São João: concrete box-girder rail bridge, 250 m central span, girder 14 m over the river piers',
  // The DEM stays (the deck spans the valley) except at the two ends, where
  // the hills stand 3 to 7 m over the rail bed: the line runs in a cutting
  // there (the girder ends inside the hill), so the track, the parapets and
  // the masts stand in it instead of being buried in the grass. The tracks
  // sit 5.3 m off the middle of the OSM outline (local x +5.3).
  pad: {
    box: { x0: -3.9, x1: 14.5, z0: -600, z1: 600 },
    margin: 0,
    fall: 10,
    level: (x, z, h) => Math.min(h, DECK_Y - 1.0),
  },
  extent: { box: { x0: -8.5, x1: 8.5, z0: -571.9, z1: 571.9 } },
  deviationNote: 'OSM outline is the 15 m corridor of both tracks with the approach cuttings; the model is the 1143 m deck with its 14.4 m box girder',
  frame: { x0: -8.5, x1: 8.5, z0: -571.9, z1: 571.9, y0: 0 },
};

export default { 'ponte-sao-joao': builder };
