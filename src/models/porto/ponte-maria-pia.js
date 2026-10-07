// Ponte Maria Pia (Gustave Eiffel & Théophile Seyrig, 1875-77): wrought-iron
// crescent arch carrying a single railway track, disused since 1991.
// Drawn 1:1 in metres.
//
//   - crescent arch, 160 m span, two lattice ribs that lean in toward the
//     crown; 10 m deep at the crown, 7 m at the haunches, tapering to the
//     four pivots; intrados chord 167 m, rise 37.5 m (pt.wikipedia)
//   - deck: lattice girders, 3.4 m deep, 60 m over the water, 352.9 m long,
//     on tapered iron lattice towers (two stand on the arch)
//   - granite pivot bases at the feet of the arch
// Frame: u along the deck (+u = local +z, bearing 54 deg), v across, y up;
// the arch is centred on the OSM corridor. Heights: metres over the water.
// Sources and estimates: data/dimensions.json (ponte-maria-pia).
import { bridgeFrame, rod, truss, railing, latticeTower, parabola, IRON } from '../bridge-kit.js';

const UC = 12.5; // arch centre along the corridor: the OSM water polygon runs -60 .. +85 m
const H = 80; // half the arch span
const PIVOT_Y = 11.4; // pivot height over the water (estimate: crown top 59.5, rise 48.6)
const CROWN_TOP = 59.5; // top chord at the crown
const CROWN_D = 9.9; // arch depth at the crown
const DECK_Y = 60;
const GIRDER_BOT = 56.0;
const GIRDER_TOP = 59.4;
const END = 176.4; // 352.875 / 2
const IRON_C = IRON.mariaPia;
const N = 32;

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const depthAt = (u) => CROWN_D * Math.sqrt(Math.max(0, 1 - (u / H) ** 2)); // crescent: 7 m at 0.7 H, pointed at the pivots
const axisY = (u) => parabola(u, H, PIVOT_Y, CROWN_TOP - CROWN_D / 2 - PIVOT_Y);
const ribV = (u) => 2.6 + 3.4 * (u / H) ** 2; // the ribs lean in toward the crown

function builder(k, site) {
  const F = bridgeFrame(site, 366);
  const g = (u, v) => F.ground(UC + u, v);

  k.begin('main');
  k.push({ ry: F.ang });
  k.push({ x: UC }); // the arch (and the deck, symmetric about it) stands over the water, not in the middle of the OSM corridor

  // ------------------------------------------------------------ arch ribs
  for (const s of [-1, 1]) {
    let pT = null;
    let pB = null;
    for (let i = 0; i <= N; i++) {
      const u = -H + (2 * H * i) / N;
      const v = s * ribV(u);
      const yt = axisY(u) + depthAt(u) / 2;
      const yb = axisY(u) - depthAt(u) / 2;
      if (pT) {
        rod(k, pT, [u, yt, v], 0.9, 0.75, IRON_C, { ext: 0.12 });
        rod(k, pB, [u, yb, v], 0.9, 0.75, IRON_C, { ext: 0.12 });
        if (yt - yb > 0.9) {
          rod(k, pB, [u, yt, v], 0.5, 0.4, IRON_C);
          rod(k, pT, [u, yb, v], 0.5, 0.4, IRON_C);
        }
      }
      if (yt - yb > 0.9) rod(k, [u, yb, v], [u, yt, v], 0.6, 0.45, IRON_C);
      pT = [u, yt, v];
      pB = [u, yb, v];
    }
  }
  // plan bracing between the ribs (struts and X) on both chords
  let prev = null;
  for (let i = 0; i <= N; i += 2) {
    const u = -H + (2 * H * i) / N;
    const v = ribV(u);
    const yt = axisY(u) + depthAt(u) / 2;
    const yb = axisY(u) - depthAt(u) / 2;
    rod(k, [u, yt, -v], [u, yt, v], 0.5, 0.4, IRON_C);
    rod(k, [u, yb, -v], [u, yb, v], 0.5, 0.4, IRON_C);
    if (prev) {
      rod(k, [prev.u, prev.yt, -prev.v], [u, yt, v], 0.34, 0.3, IRON_C);
      rod(k, [prev.u, prev.yt, prev.v], [u, yt, -v], 0.34, 0.3, IRON_C);
      rod(k, [prev.u, prev.yb, -prev.v], [u, yb, v], 0.34, 0.3, IRON_C);
      rod(k, [prev.u, prev.yb, prev.v], [u, yb, -v], 0.34, 0.3, IRON_C);
    }
    prev = { u, yt, yb, v };
  }
  // pivots: granite bases and the pins
  for (const s of [-1, 1]) {
    const u = s * H;
    const gy = Math.min(g(u, 0), 9);
    k.box(12, PIVOT_Y - 1.6 - gy + 4, 15, 'graniteDark', u + s * 1.5, gy - 4, 0);
    k.box(12.8, 0.7, 15.8, 'graniteLight', u + s * 1.5, PIVOT_Y - 1.6, 0);
    for (const t of [-1, 1]) k.cyl(0.9, 0.9, 1.6, 8, IRON_C, u, PIVOT_Y - 1.2, t * ribV(H), { mat: 9 });
  }

  // ------------------------------------------------------------------ deck
  const nPan = Math.round((2 * END) / 3.52);
  for (const s of [-1, 1]) {
    truss(k, { u0: -END, u1: END, n: nPan, lo: () => GIRDER_BOT, up: () => GIRDER_TOP, z: s * 2.4, color: IRON_C, cw: 0.55, ch: 0.5, ww: 0.4, wh: 0.3, x: true, mat: 9 });
  }
  k.box(2 * END, 0.35, 6.4, 0x4a4540, 0, GIRDER_TOP - 0.55, 0, { mat: 8 }); // the tray under the ballast
  k.box(2 * END, 0.25, 3.4, 0x6e655b, 0, GIRDER_TOP - 0.2, 0, { mat: 8 }); // ballast
  for (const v of [-0.72, 0.72]) rod(k, [-END, DECK_Y - 0.1, v], [END, DECK_Y - 0.1, v], 0.1, 0.16, 0x7b5a45);
  for (let u = -END; u <= END + 0.01; u += 3.52) rod(k, [u, GIRDER_BOT + 0.3, -2.9], [u, GIRDER_BOT + 0.3, 2.9], 0.35, 0.4, IRON_C, { mat: 9 });
  for (const s of [-1, 1]) railing(k, { u0: -END, u1: END, v: s * 3.15, y: DECK_Y - 0.55, h: 1.2, step: 3.52, color: IRON_C, rails: 2, w: 0.07 });
  // end plates
  // abutments: the girders end on masonry, the line goes on into the hill
  for (const e of [-END, END]) {
    const sgn = Math.sign(e);
    const gy = Math.min(g(e + sgn * 3, 0), DECK_Y - 3) - 3;
    k.box(7.2, DECK_Y - 1.2 - gy, 7.6, 'graniteDark', e + sgn * 3.6, gy, 0);
    k.box(7.8, 0.4, 8.2, 'graniteLight', e + sgn * 3.6, DECK_Y - 1.2, 0);
    k.box(7.2, 0.25, 3.4, 0x6e655b, e + sgn * 3.6, DECK_Y - 0.8, 0, { mat: 8 });
  }

  // ---------------------------------------------------- towers (tapered iron)
  const towers = [];
  for (const su of [-1, 1]) for (const d of [80, 54, 112, 144]) towers.push({ u: su * d, onArch: d === 54, atPivot: d === 80 });
  for (const t of towers) {
    const u = t.u;
    let base;
    if (t.onArch) base = axisY(u) + depthAt(u) / 2 - 0.5;
    else if (t.atPivot) base = PIVOT_Y + 0.8;
    else base = Math.min(g(u, 0), GIRDER_BOT - 3) - 0.3;
    if (GIRDER_BOT - base < 4) {
      k.box(8, Math.max(1, DECK_Y - 1 - (base - 3)), 7.4, 'graniteDark', u, base - 3, 0);
      continue;
    }
    if (!t.onArch) {
      k.box(11.6, 1.8, 10.4, 'graniteDark', u, base - 2.0, 0);
      k.box(10.6, 0.5, 9.4, 'graniteLight', u, base - 0.3, 0);
    }
    latticeTower(k, { ut: u, base: base + 0.2, top: GIRDER_BOT, bw: t.onArch ? 2.4 : 4.2, tw: 1.8, vBase: t.onArch ? 2.9 : 3.8, vTop: 2.4, color: IRON_C, panel: 3.6, legW: 0.85, mat: 9 });
  }

  k.pop();
  k.pop();
  k.end('main');
}

builder.metric = true;
builder.rule = {
  note: 'Ponte Maria Pia: crescent iron arch 160 m, deck 60 m over the water, 352.9 m',
  // The DEM stays except under the pivots and where the hill is above the deck.
  pad: {
    box: { x0: -8, x1: 8, z0: -186, z1: 186 },
    margin: 0,
    fall: 7,
    level: (x, z, h) => {
      let y = h;
      const d = Math.abs(Math.abs(z - UC) - H);
      const f = 1 - smooth((d - 8) / 10);
      if (f > 0) y += (Math.min(h, 4) - h) * f;
      return Math.min(y, DECK_Y - 2.2);
    },
  },
  extent: { box: { x0: -7.5, x1: 7.5, z0: -185.1, z1: 185.1 } },
  deviationNote: 'OSM outline is the 4.2 m rail centreline; the model spans the 15 m lattice arch and pivot bases',
  frame: { x0: -7.5, x1: 7.5, z0: -185.1, z1: 185.1, y0: 0 },
};

export default { 'ponte-maria-pia': builder };
