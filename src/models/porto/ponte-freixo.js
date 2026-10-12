// Ponte do Freixo (António Reis, 1995): two side-by-side prestressed-concrete
// box-girder bridges (10 cm apart, four lanes each) on eight spans, the
// biggest 150 m. The lowest of the Douro road bridges. Drawn 1:1 in metres.
//
//   - each deck: a box girder 18 m wide, deep over the piers and shallow at
//     midspan, the soffit a smooth curve (loft sections every 5 m)
//   - piers: one oval-section column per deck, slightly waisted
//   - pier stations from the OSM water polygon (-123.5, +25, +139.5 m are the
//     river piers) and an even rhythm on the land spans
// Frame: u along the deck (+u = Gaia, local +z), v across, y up; the decks run
// -371 .. +388 m along the OSM corridor. Heights: metres over the water.
// Sources and estimates: data/dimensions.json (ponte-freixo).
import { bridgeFrame, landfall, rod, loft, crookLamp } from '../bridge-kit.js';

const DECK_Y = 30; // road surface (estimate: "much lower than the other bridges")
const SLAB = 0.8;
const U0 = -371;
// The bridge (705 m) ends at u = 334; the OSM bridge ways go on to u = 388 over
// the Areinho flats at the same height (the start of the A20): the deck runs
// on over them on one more span, so no road is left in the air past the end.
const U1 = 388;
const PIERS = [-262, -173, -123.5, 25, 139.5, 203, 270, 334]; // 9 spans: 109 89 49.5 148.5 114.5 63.5 67 64 54
const BOUNDS = [U0, ...PIERS, U1];
const IN_WATER = new Set([-123.5, 25, 139.5]);
const DECK_C = 9.05; // deck centre lines (v)
const W_TOP = 18.0;
const W_BOT = 9.2;
const D_PIER = 8.6;
const D_MID = 3.2;
const CONC = 0xdcdcd5;
const CONC_D = 0xc4c4bc;
const C = { mat: 8 };

// girder depth: a smooth curve from the piers to the middle of each span
function depthAt(u) {
  for (let i = 0; i + 1 < BOUNDS.length; i++) {
    const a = BOUNDS[i];
    const b = BOUNDS[i + 1];
    if (u >= a && u <= b) {
      const t = (u - a) / (b - a);
      const s = Math.sin(Math.PI * t);
      return D_MID + (D_PIER - D_MID) * (1 - s) ** 1.7;
    }
  }
  return D_MID;
}

function builder(k, site) {
  const F = bridgeFrame(site, 742);
  const g = F.ground;

  k.begin('main');
  k.push({ ry: F.ang });

  for (const s of [-1, 1]) {
    const v0 = s * DECK_C;
    // ---- box girder: a loft through sections every 5 m
    const rings = [];
    for (let u = U0; u <= U1 + 0.01; u += 5) {
      const yt = DECK_Y - SLAB;
      const yb = yt - depthAt(u);
      rings.push([[u, yt, v0 - W_TOP / 2 + 1.2], [u, yt, v0 + W_TOP / 2 - 1.2], [u, yb, v0 + W_BOT / 2], [u, yb, v0 - W_BOT / 2]]);
    }
    loft(k, rings, CONC, C);
    // ---- slab with its cantilevers, wearing course, parapets, lamps
    k.box(U1 - U0, SLAB, W_TOP, CONC, (U0 + U1) / 2, DECK_Y - SLAB, v0, C);
    k.box(U1 - U0, 0.1, W_TOP - 2.4, 0x3c3e42, (U0 + U1) / 2, DECK_Y - 0.1, v0, { mat: 8 });
    for (const e of [-1, 1]) {
      k.box(U1 - U0, 0.95, 0.4, CONC, (U0 + U1) / 2, DECK_Y - 0.1, v0 + e * (W_TOP / 2 - 0.2), C);
      rod(k, [U0, DECK_Y + 1.35, v0 + e * (W_TOP / 2 - 0.2)], [U1, DECK_Y + 1.35, v0 + e * (W_TOP / 2 - 0.2)], 0.07, 0.07, 0xa7adb2, { mat: 9 });
      for (let u = U0; u <= U1 + 0.01; u += 3) rod(k, [u, DECK_Y + 0.8, v0 + e * (W_TOP / 2 - 0.2)], [u, DECK_Y + 1.4, v0 + e * (W_TOP / 2 - 0.2)], 0.05, 0.05, 0xa7adb2, { mat: 9 });
    }
    // lamps on the outer edge, 36 m
    for (let u = U0 + 12; u < U1 - 8; u += 36) crookLamp(k, u, v0 + s * (W_TOP / 2 - 0.45), DECK_Y - 0.1, { h: 9.0, dir: s, reach: 2.4, color: 0x9ea5aa });
  }
  for (let u = U0 + 40; u < U1; u += 95) k.marker('bridge-lamp', u, DECK_Y + 4, 0, { w: 1.2 });
  // the median where the two decks meet: a jersey barrier and its lamps
  k.box(U1 - U0, 0.9, 0.5, CONC, (U0 + U1) / 2, DECK_Y - 0.1, 0, C);

  // ---- piers: one waisted column per deck
  const pier = (u, soffit) => {
    for (const s of [-1, 1]) {
      const v0 = s * DECK_C;
      const gy = g(u, v0);
      const base = IN_WATER.has(u) ? -4 : gy - 2.5;
      if (soffit - base < 2) continue;
      // a waisted column built from tapered slices (half sizes along u and v)
      const half = (t) => [1.55 + 0.35 * (1 - t) - 0.45 * Math.sin(Math.PI * t) + 0.9 * t ** 6, 3.4 + 0.4 * (1 - t) - 0.6 * Math.sin(Math.PI * t) + 0.9 * t ** 6];
      const n = 6;
      for (let i = 0; i < n; i++) {
        const ya = base + ((soffit - base + 0.4) * i) / n;
        const yb = base + ((soffit - base + 0.4) * (i + 1)) / n;
        const [wA, dA] = half(i / n);
        const [wB, dB] = half((i + 1) / n);
        k.frustum(wA * 2, dA * 2, wB * 2, dB * 2, yb - ya, CONC_D, u, ya, v0, C);
      }
      if (IN_WATER.has(u)) k.box(8.4, 2.2, 12.6, CONC_D, u, base, v0, C); // footing at the waterline
    }
  };
  for (const u of PIERS) pier(u, DECK_Y - SLAB - D_PIER);

  // ---- the deck ends: an abutment where the deck lands on the bank; on the
  // Gaia side the A20 goes on over the riverside flats on its own viaduct
  // (the engine's OSM bridge ways), so the deck ends on a pier, not on a wall
  // 22 m high
  for (const e of [U0, U1]) {
    const sgn = e < 0 ? -1 : 1;
    const gy = g(e, 0);
    if (DECK_Y - gy > 12) {
      pier(e - sgn * 3.2, DECK_Y - SLAB - depthAt(e - sgn * 3.2));
      continue;
    }
    const bot = Math.min(gy, g(e - sgn * 6, 0), DECK_Y - 3) - 3; // down to the ground in front: it holds the landfall
    k.box(6, DECK_Y - SLAB - bot, 2 * DECK_C + W_TOP, CONC_D, e + sgn * 3, bot, 0, C);
  }

  k.pop();
  k.end('main');
}

builder.metric = true;
builder.rule = {
  note: 'Ponte do Freixo: two box-girder decks, 8 spans, main span 150 m, deck 30 m over the water',
  // The DEM stays (the valley is wide and low) except at the Porto landfall:
  // the DEM holds the bank 8 m under the deck end, so the ground is brought up
  // to the deck there and runs down the VCI until it meets the DEM again.
  pad: {
    box: { x0: -18.5, x1: 18.5, z0: -436, z1: -352 },
    margin: 0,
    fall: 12,
    level: (x, z, h) => landfall(z, h, { ends: [U0], top: DECK_Y - 1.2 }),
  },
  extent: { box: { x0: -18.5, x1: 18.5, z0: -371.6, z1: 394 } },
  deviationNote: 'the model is the 705 m deck + abutments and, on the Gaia side, the 54 m span over the last OSM bridge ways',
  frame: { x0: -18.5, x1: 18.5, z0: -371.6, z1: 394, y0: 0 },
};

export default { 'ponte-freixo': builder };
