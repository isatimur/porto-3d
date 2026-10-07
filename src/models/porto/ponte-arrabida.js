// Ponte da Arrábida (Edgar Cardoso, 1957-63): reinforced-concrete arch road
// bridge over the Douro, drawn 1:1 in metres.
//
//   - one hollow-box arch, 270 m between the springings, 52 m rise, a flat
//     elliptical curve (steeper at the feet), 8.5 m wide, deeper at the feet
//   - deck 26.5 m wide, 65 m over the water (a deep central box with the
//     slab cantilevered on ribs), 493 m long
//   - the deck stands on pairs of slender wall-columns, over the arch and on
//     the side viaducts; at each springing a heavy column rises through the
//     deck into a tower (the lift shafts closed in the 1990s)
// Frame: u along the deck (+u = Gaia, local +z), v across, y up; the arch is
// centred on the OSM corridor. Heights are metres over the water.
// Sources and estimates: data/dimensions.json (ponte-arrabida).
import { bridgeFrame, rod, crookLamp, LAMP } from '../bridge-kit.js';

const H = 135; // half the arch span
const RISE = 52;
const SPRING_Y = 7.7; // axis height at the feet (the crown axis sits 2.1 m under the deck soffit)
const DECK_Y = 65; // road surface
const DECK_W = 26.5;
const END = 248; // OSM way ends
const SOFFIT = DECK_Y - 0.8 - 2.5; // under the central box
const EXP = 2.45; // elliptical curve exponent (2 = parabola; the feet are steeper)
const CONC = 0xcfcfc9;
const CONC_D = 0xb9b9b2;
const N = 60;

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const archAxis = (u) => SPRING_Y + RISE * (1 - Math.abs(u / H) ** EXP);
const archDepth = (u) => 4.2 + 1.9 * Math.abs(u / H) ** 2;
const archW = (u) => 8.5 + 1.5 * Math.abs(u / H) ** 2;
const C = { mat: 8 };

function builder(k, site) {
  const F = bridgeFrame(site, 497);
  const g = F.ground;

  k.begin('main');
  k.push({ ry: F.ang });

  // ------------------------------------------------------------------ arch
  let p = null;
  for (let i = 0; i <= N; i++) {
    const u = -H + (2 * H * i) / N;
    const q = [u, archAxis(u), 0];
    if (p) {
      const um = (u + p[0]) / 2;
      rod(k, p, q, archW(um), archDepth(um), CONC, { ...C, ext: 0.6 });
    }
    p = q;
  }
  // soffit shadow line: a narrower darker box along the arch underside
  p = null;
  for (let i = 0; i <= N; i++) {
    const u = -H + (2 * H * i) / N;
    const q = [u, archAxis(u) - archDepth(u) / 2 + 0.2, 0];
    if (p) rod(k, p, q, archW((u + p[0]) / 2) * 0.55, 0.5, CONC_D, { ...C, ext: 0.5 });
    p = q;
  }
  // the arch is lit from below at night: a strip along each lower edge
  for (const s of [-1, 1]) {
    p = null;
    for (let i = 0; i <= N; i++) {
      const u = -H + (2 * H * i) / N;
      const q = [u, archAxis(u) - archDepth(u) / 2 + 0.05, s * (archW(u) / 2 - 0.35)];
      if (p) rod(k, p, q, 0.28, 0.2, 0xfff0cf, { mat: 0, emit: LAMP(0.9), ext: 0.4 });
      p = q;
    }
  }
  // the walkway on top of the arch (Porto Bridge Climb): rail posts and rails
  for (const s of [-1, 1]) {
    let a = null;
    for (let i = 0; i <= N; i++) {
      const u = -H + (2 * H * i) / N;
      const top = archAxis(u) + archDepth(u) / 2;
      if (top > SOFFIT - 1.0) {
        a = null;
        continue;
      }
      const q = [u, top + 1.1, s * 3.6];
      if (i % 2 === 0) rod(k, [u, top, s * 3.6], q, 0.08, 0.08, 0x8f979c, { mat: 9 });
      if (a) rod(k, a, q, 0.07, 0.07, 0x8f979c, { mat: 9 });
      a = q;
    }
  }

  // ----------------------------------------------------------------- deck
  // central box (hollow): the deck's deep web, and the slab on cantilever ribs
  k.box(2 * END, 2.5, 9.5, CONC, 0, SOFFIT, 0, C);
  k.box(2 * END, 0.8, DECK_W, CONC, 0, DECK_Y - 0.9, 0, C);
  k.box(2 * END, 0.1, DECK_W - 1.6, 0x45474b, 0, DECK_Y - 0.12, 0, { mat: 8 });
  for (let u = -END + 3; u <= END; u += 6) {
    for (const s of [-1, 1]) rod(k, [u, DECK_Y - 1.0, s * 4.8], [u, DECK_Y - 2.3, s * 8.6], 0.5, 0.45, CONC_D, C);
    for (const s of [-1, 1]) rod(k, [u, DECK_Y - 1.0, s * 13.2], [u, DECK_Y - 2.3, s * 8.6], 0.5, 0.45, CONC_D, C);
  }
  // central reserve, parapets and a rail on the outer edge
  k.box(2 * END, 0.55, 0.7, CONC, 0, DECK_Y - 0.12, 0, C);
  for (const s of [-1, 1]) {
    k.box(2 * END, 0.9, 0.4, CONC, 0, DECK_Y - 0.12, s * (DECK_W / 2 - 0.2), C);
    rod(k, [-END, DECK_Y + 1.15, s * (DECK_W / 2 - 0.2)], [END, DECK_Y + 1.15, s * (DECK_W / 2 - 0.2)], 0.07, 0.07, 0x9aa1a6, { mat: 9 });
    for (let u = -END; u <= END + 0.01; u += 3) rod(k, [u, DECK_Y + 0.7, s * (DECK_W / 2 - 0.2)], [u, DECK_Y + 1.2, s * (DECK_W / 2 - 0.2)], 0.06, 0.06, 0x9aa1a6, { mat: 9 });
  }
  // street lamps on both outer edges (arm over the carriageway)
  for (const s of [-1, 1]) {
    for (let u = -END + 12; u < END - 6; u += 24) crookLamp(k, u + (s > 0 ? 12 : 0), s * (DECK_W / 2 - 0.5), DECK_Y - 0.12, { h: 9.4, dir: s, reach: 2.6, color: 0x9ea5aa });
  }

  for (let u = -END + 30; u < END; u += 52) k.marker('bridge-lamp', u, DECK_Y + 4, 0, { w: 1 });
  for (const u of [-70, 0, 70]) k.marker('bridge-lamp', u, archAxis(u) + 1, 0, { w: 0.6 });

  // --------------------------------------------------- columns under the deck
  const column = (u, yBase, yTop, wV = 5.0) => {
    for (const du of [-1.35, 1.35]) {
      k.box(0.8, yTop - yBase, wV, CONC, u + du, yBase, 0, C);
      k.box(1.4, 0.6, wV + 0.6, CONC_D, u + du, yTop - 0.6, 0, C);
    }
  };
  // over the arch: pairs from the arch top to the box
  for (let i = 1; i < 8; i++) {
    for (const s of [-1, 1]) {
      const u = s * (H * i) / 8;
      const top = archAxis(u) + archDepth(u) / 2;
      if (SOFFIT - top < 1.2) continue;
      column(u, top - 0.4, SOFFIT + 0.3);
    }
  }
  // side viaducts: pairs on the ground every 22 m
  for (const s of [-1, 1]) {
    for (let u = H + 22; u < END - 8; u += 22.3) {
      const uu = s * u;
      const gy = g(uu, 0);
      if (SOFFIT - gy < 2) continue;
      column(uu, gy - 2.5, SOFFIT + 0.3);
    }
  }
  // the heavy columns at the springings and the towers above the deck
  for (const s of [-1, 1]) {
    const u = s * (H + 3.2);
    const gy = Math.min(g(u, 0), 8);
    k.box(5.4, SOFFIT - gy + 3, 11.5, CONC, u, gy - 3, 0, C);
    k.box(6.2, 0.7, 12.3, CONC_D, u, SOFFIT - 0.2, 0, C);
    // tower above the deck: slots like the real one (the lift shaft's grille)
    // (one on each edge of the deck: the real ones stand outside the carriageways)
    const th = 8.6;
    const tv = -s * 11.0;
    k.box(3.4, th, 5.2, CONC, u, DECK_Y - 0.1, tv, C);
    k.box(4.0, 0.5, 5.8, CONC_D, u, DECK_Y + th - 0.2, tv, C);
    for (let j = 0; j < 6; j++) for (const f of [-1, 1]) k.box(0.1, 0.9, 0.9, 0x6a6e72, u + f * 1.72, DECK_Y + 1.2 + j * 1.2, tv, { mat: 0 });
    // the foot of the arch: a block it springs from
    k.box(14, 7.2, 12, CONC_D, s * (H - 3), gy - 1.2, 0, C);
  }

  // ----------------------------------------------- the deck ends: abutments
  for (const s of [-1, 1]) {
    const e = s * END;
    const gy = g(e, 0);
    const bot = Math.min(gy, DECK_Y - 3) - 3;
    k.box(7, DECK_Y - 0.9 - bot, DECK_W, CONC_D, e + s * 3.5, bot, 0, C);
    k.box(8, 0.45, DECK_W + 1, CONC, e + s * 3.5, DECK_Y - 0.9, 0, C);
  }

  k.pop();
  k.end('main');
}

builder.metric = true;
builder.rule = {
  note: 'Ponte da Arrábida: concrete box arch 270 m, rise 52 m; deck 26.5 m wide at 65 m over the water',
  // The DEM stays except where the structure meets it: a platform under each
  // arch foot and the deck ends cut into the plateau.
  pad: {
    box: { x0: -16, x1: 16, z0: -250, z1: 250 },
    margin: 0,
    fall: 9,
    level: (x, z, h) => {
      let y = h;
      const d = Math.abs(Math.abs(z) - H);
      const f = 1 - smooth((d - 14) / 10);
      if (f > 0) y += (Math.min(h, 6) - h) * f;
      return Math.min(y, DECK_Y - 2.2);
    },
  },
  extent: { box: { x0: -13.5, x1: 13.5, z0: -251.3, z1: 251.3 } },
  deviationNote: 'OSM outline includes the approach embankments; the model is the 26.5 m deck structure with the towers',
  frame: { x0: -13.5, x1: 13.5, z0: -251.3, z1: 251.3, y0: 0 },
};

export default { 'ponte-arrabida': builder };
