// Ponte Infante D. Henrique (Fernández Ordóñez, Adão da Fonseca, Millanes
// Mato; 2000-03): a very flat reinforced-concrete arch under a box-girder
// deck. Span 280 m, rise 25 m (span / rise 11.2, a record for this type),
// deck 20 m wide, 370 m long, arch slab 1.5 m thick, girder 4.5 m deep.
// Drawn 1:1 in metres.
//
//   - the arch is a thin wide slab springing from ledges in the two cliffs
//   - the deck rests on it through wall piers (a trapezoid pier each side,
//     then slender fins toward the feet)
//   - side spans beyond the feet ride on fin walls to the abutments
// Frame: u along the deck (+u = Gaia, local +z), v across, y up; the arch is
// centred on the OSM corridor. Heights: metres over the water.
// Sources and estimates: data/dimensions.json (ponte-infante).
import { bridgeFrame, rod, crookLamp } from '../bridge-kit.js';

const UC = -14; // arch centre along the corridor (middle of the OSM water polygon)
const H = 140; // half the arch span
const DECK_Y = 73.8; // road surface (estimate; OSM height 75 incl. parapet)
const GIRDER_D = 4.5;
const SLAB = 0.6;
const SOFFIT = DECK_Y - SLAB - GIRDER_D;
const SPRING_Y = 38.5; // arch axis at the feet (the DEM cliff ledges at +-140 m)
const RISE = 25;
const END = 203; // OSM way ends (the deck is 370 m, the rest is approach)
const DECK_W = 20;
const ARCH_W = 17;
const CONC = 0xe0ddd0;
const CONC_D = 0xc9c5b8;
const N = 56;
const C = { mat: 8 };

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const axisY = (u) => SPRING_Y + RISE * (1 - (u / H) ** 2);
const thick = (u) => 1.6 + 1.7 * Math.abs(u / H) ** 3;

function builder(k, site) {
  const F = bridgeFrame(site, 405);
  const g = F.ground;
  const ay = (u) => axisY(u - UC); // arch axis at a corridor position

  k.begin('main');
  k.push({ ry: F.ang });
  k.push({ x: UC }); // the arch spans the water (OSM water polygon -98 .. +70 m)

  // ------------------------------------------------------------------ arch
  let p = null;
  for (let i = 0; i <= N; i++) {
    const u = -H + (2 * H * i) / N;
    const q = [u, axisY(u), 0];
    if (p) rod(k, p, q, ARCH_W, thick((u + p[0]) / 2), CONC, { ...C, ext: 0.5 });
    p = q;
  }
  // a soffit rib and the edge beams (the arch reads as a slab with thick edges)
  for (const s of [-1, 1]) {
    p = null;
    for (let i = 0; i <= N; i++) {
      const u = -H + (2 * H * i) / N;
      const q = [u, axisY(u) + thick(u) / 2 - 0.1, s * (ARCH_W / 2 - 0.6)];
      if (p) rod(k, p, q, 1.2, 0.6, CONC_D, { ...C, ext: 0.4 });
      p = q;
    }
  }
  // the feet: the arch springs from a block built into the cliff
  for (const s of [-1, 1]) {
    const x = s * (H - 4);
    const gy = Math.min(g(UC + x, 0), SPRING_Y - 3);
    k.box(12, SPRING_Y + 1.6 - gy + 2, ARCH_W + 1, CONC_D, x, gy - 2, 0, C);
  }
  k.pop(); // back to the corridor frame

  // ------------------------------------------------------------------ deck
  // box girder: top slab with cantilevers, a trapezoid box below, braces
  k.box(2 * END, SLAB, DECK_W, CONC, 0, DECK_Y - SLAB, 0, C);
  k.box(2 * END, 0.1, DECK_W - 1.4, 0x3f4144, 0, DECK_Y - 0.1, 0, { mat: 8 });
  k.box(2 * END, GIRDER_D, 9.2, CONC, 0, SOFFIT, 0, C);
  for (let u = -END + 2.5; u <= END; u += 5) {
    for (const s of [-1, 1]) rod(k, [u, SOFFIT + GIRDER_D * 0.8, s * 4.4], [u, DECK_Y - SLAB - 0.05, s * 9.4], 0.6, 0.55, CONC_D, C);
  }
  // central reserve, parapets with the railing, lamps
  k.box(2 * END, 0.6, 0.6, CONC, 0, DECK_Y - 0.1, 0, C);
  for (const s of [-1, 1]) {
    k.box(2 * END, 0.8, 0.35, CONC, 0, DECK_Y - 0.1, s * (DECK_W / 2 - 0.2), C);
    rod(k, [-END, DECK_Y + 1.55, s * (DECK_W / 2 - 0.2)], [END, DECK_Y + 1.55, s * (DECK_W / 2 - 0.2)], 0.07, 0.07, 0xa7adb2, { mat: 9 });
    rod(k, [-END, DECK_Y + 1.1, s * (DECK_W / 2 - 0.2)], [END, DECK_Y + 1.1, s * (DECK_W / 2 - 0.2)], 0.05, 0.05, 0xa7adb2, { mat: 9 });
    for (let u = -END; u <= END + 0.01; u += 2.5) rod(k, [u, DECK_Y + 0.6, s * (DECK_W / 2 - 0.2)], [u, DECK_Y + 1.6, s * (DECK_W / 2 - 0.2)], 0.05, 0.05, 0xa7adb2, { mat: 9 });
    for (let u = -END + 10 + (s > 0 ? 15 : 0); u < END - 6; u += 30) crookLamp(k, u, s * (DECK_W / 2 - 0.4), DECK_Y - 0.1, { h: 7.2, dir: s, reach: 2.2, color: 0x9ea5aa });
  }

  // ------------------------------------------------ the deck on the arch
  // trapezoid pier each side, then fins toward the feet
  for (const s of [-1, 1]) {
    const u = UC + s * 70;
    const top = ay(u) + thick(s * 70) / 2 - 0.3;
    k.frustum(9.2, 17.5, 5.4, 14.0, SOFFIT + 0.2 - top, CONC_D, u, top, 0, C);
    for (const uu of [92, 113, 133]) {
      const x = UC + s * uu;
      const yb = ay(x) + thick(s * uu) / 2 - 0.3;
      if (SOFFIT - yb < 1.5) continue;
      k.box(2.2, SOFFIT + 0.2 - yb, 13.5, CONC_D, x, yb, 0, C);
    }
  }
  // side spans: fin walls on the ground to the abutments
  for (const s of [-1, 1]) {
    for (const uu of [157, 176, 192, 210]) {
      const x = UC + s * uu;
      if (Math.abs(x) > END - 6) continue;
      const gy = g(x, 0);
      if (SOFFIT - gy < 2) continue;
      k.box(2.6, SOFFIT + 0.2 - gy + 2.5, 12.5, CONC_D, x, gy - 2.5, 0, C);
    }
  }

  // ----------------------------------------------- the deck ends: abutments
  for (const s of [-1, 1]) {
    const e = s * END;
    const gy = g(e, 0);
    const bot = Math.min(gy, SOFFIT - 1) - 3;
    k.box(5, SOFFIT + 0.6 - bot, DECK_W, CONC_D, e, bot, 0, C);
  }

  k.pop();
  k.end('main');
}

builder.metric = true;
builder.rule = {
  note: 'Ponte Infante D. Henrique: flat concrete arch 280 m, rise 25 m, deck 20 m wide at 74 m over the water',
  // The DEM stays except under the arch feet (a ledge in the cliff) and where
  // the hill is above the deck.
  pad: {
    box: { x0: -11, x1: 11, z0: -206, z1: 206 },
    margin: 0,
    fall: 9,
    level: (x, z, h) => {
      let y = h;
      const d = Math.abs(Math.abs(z - UC) - H);
      const f = 1 - smooth((d - 10) / 10);
      if (f > 0) y += (SPRING_Y - 2.4 - h) * f;
      return Math.min(y, SOFFIT - 1.2);
    },
  },
  extent: { box: { x0: -10, x1: 10, z0: -202.8, z1: 202.8 } },
  deviationNote: 'the outline is the 20 m deck corridor incl. approach ramps; the model adds the arch slab and parapet lamps',
  frame: { x0: -10, x1: 10, z0: -202.8, z1: 202.8, y0: 0 },
};

export default { 'ponte-infante': builder };
