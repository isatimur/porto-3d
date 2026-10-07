// Ponte Luís I (Théophile Seyrig, Société Willebroeck; 1881-86): wrought-iron
// double-deck arch over the Douro, drawn 1:1 in metres.
//
//   - arch: parabolic, 172 m chord, 44.6 m rise (axis), two lattice ribs that
//     lean in toward the crown; deepest at the springings (crescent), meeting
//     the upper-deck girder at the crown
//   - upper deck: lattice girders, 60 m over the water, carried by the arch
//     (spandrel posts) and, beyond the springings, by tapered iron lattice
//     towers that stand on the hillsides; Metro line D (two tracks, overhead
//     line) with a walkway each side
//   - lower deck: road, hung from the arch by hangers
//   - granite springing blocks at the foot of the arch, abutment blocks where
//     the deck enters the hill
// Frame: u along the deck (+u = Gaia side, local +z), v across, y up. The
// arch is centred 28 m south of the middle of the OSM corridor: the OSM
// lower-deck ways run -61 .. +118 m, the upper deck -205 .. +197 m.
// Heights are metres above the water (the model's y = 0 sits 0.8 m under it).
// Sources and estimates: data/dimensions.json (ponte-luis-i).
import { bridgeFrame, rod, truss, railing, crookLamp, catenaryMast, wire, parabola, LAMP, IRON } from '../bridge-kit.js';

const UC = 28.3; // arch centre along the corridor (m, from the OSM lower-deck ways)
const HALF = 86; // half the arch chord (172 m)
const RISE = 44.6; // rise of the arch axis
const SPRING_Y = 10.6; // axis height at the springings (estimate)
const UPPER_Y = 60; // upper deck surface
const LOWER_Y = 11.2; // lower deck surface (estimate, scaled from photographs)
const U_PORTO = -204; // upper deck ends (OSM way ends -205 / +197, incl. approach slabs)
const U_GAIA = 198;
const GIRDER_BOT = 56.2;
const GIRDER_TOP = 59.2;
const N = 48; // arch panels (3.58 m)
const IRON_C = IRON.luis;
const TOWER_PITCH = 35.4;

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const axisY = (u) => parabola(u, HALF, SPRING_Y, RISE);
const depthAt = (u) => 3.0 + 3.4 * (u / HALF) ** 2; // crescent: deep at the springings
const ribV = (u) => 5.0 + 1.4 * (u / HALF) ** 2; // the ribs lean in toward the crown

function builder(k, site) {
  const F = bridgeFrame(site, 410);
  const g = F.ground;

  k.begin('main');
  k.push({ ry: F.ang });

  const archE = LAMP(0.3); // the arch is floodlit: gold, lattice still readable
  const deckE = LAMP(0.1);

  // ================================================== the arch (arch frame)
  k.push({ x: UC });
  const ga = (ua, v) => g(UC + ua, v);

  // ---- ribs: chords and an X web, node by node (a rib is a curve, so its
  // members are short straight pieces)
  for (const s of [-1, 1]) {
    let pT = null;
    let pB = null;
    for (let i = 0; i <= N; i++) {
      const u = -HALF + (2 * HALF * i) / N;
      const v = s * ribV(u);
      const yt = axisY(u) + depthAt(u) / 2;
      const yb = axisY(u) - depthAt(u) / 2;
      if (pT) {
        rod(k, pT, [u, yt, v], 0.9, 0.7, IRON_C, { emit: archE, ext: 0.12 });
        rod(k, pB, [u, yb, v], 0.9, 0.7, IRON_C, { emit: archE, ext: 0.12 });
        rod(k, pB, [u, yt, v], 0.5, 0.36, IRON_C, { emit: archE });
        rod(k, pT, [u, yb, v], 0.5, 0.36, IRON_C, { emit: archE });
      }
      rod(k, [u, yb, v], [u, yt, v], 0.6, 0.42, IRON_C, { emit: archE });
      pT = [u, yt, v];
      pB = [u, yb, v];
    }
  }
  // ---- plan bracing between the ribs: a strut every second node, X in plan
  let prev = null;
  for (let i = 0; i <= N; i += 2) {
    const u = -HALF + (2 * HALF * i) / N;
    const v = ribV(u);
    const yb = axisY(u) - depthAt(u) / 2 + 0.3;
    const yt = axisY(u) + depthAt(u) / 2 - 0.3;
    rod(k, [u, yb, -v], [u, yb, v], 0.5, 0.4, IRON_C, { emit: LAMP(0.2) });
    rod(k, [u, yt, -v], [u, yt, v], 0.5, 0.4, IRON_C, { emit: LAMP(0.2) });
    if (prev) {
      rod(k, [prev.u, prev.yb, -prev.v], [u, yb, v], 0.34, 0.3, IRON_C);
      rod(k, [prev.u, prev.yb, prev.v], [u, yb, -v], 0.34, 0.3, IRON_C);
    }
    prev = { u, yb, v };
  }
  // ---- gusset plates at the rib nodes
  for (const s of [-1, 1]) {
    for (let i = 0; i <= N; i += 2) {
      const u = -HALF + (2 * HALF * i) / N;
      k.box(0.9, depthAt(u) * 0.9, 1.0, IRON_C, u, axisY(u) - depthAt(u) * 0.45, s * ribV(u), { mat: 9, emit: LAMP(0.22) });
    }
  }

  // ---- spandrel posts: arch to upper-deck girder, every fourth node (14.3 m)
  for (const s of [-1, 1]) {
    for (let i = 1; i < 12; i++) {
      if (i === 6) continue; // the crown: arch and girder meet
      const u = -HALF + (2 * HALF * i * 4) / N;
      const v = s * ribV(u);
      const y0 = axisY(u) + depthAt(u) / 2 - 0.2;
      const y1 = GIRDER_BOT + 0.2;
      if (y1 - y0 < 0.8) continue;
      const hw = 0.9;
      rod(k, [u - hw, y0, v], [u - hw * 0.8, y1, v], 0.6, 0.5, IRON_C, { mat: 9, emit: deckE });
      rod(k, [u + hw, y0, v], [u + hw * 0.8, y1, v], 0.6, 0.5, IRON_C, { mat: 9, emit: deckE });
      const nP = Math.max(1, Math.round((y1 - y0) / 3.2));
      for (let j = 0; j < nP; j++) {
        const ya = y0 + ((y1 - y0) * j) / nP;
        const yb = y0 + ((y1 - y0) * (j + 1)) / nP;
        rod(k, [u - hw, ya, v], [u + hw * 0.85, yb, v], 0.3, 0.22, IRON_C);
        rod(k, [u + hw, ya, v], [u - hw * 0.85, yb, v], 0.3, 0.22, IRON_C);
      }
    }
  }

  // ---- lower deck: slab, plate girders, railings, cross beams, hangers
  const lowW = 5.4;
  const lowU = HALF + 9;
  k.box(2 * lowU, 0.55, 2 * lowW, 0x6d7076, 0, LOWER_Y - 0.95, 0, { mat: 8 });
  for (const s of [-1, 1]) {
    k.box(2 * lowU, 1.3, 0.28, IRON_C, 0, LOWER_Y - 1.7, s * lowW, { mat: 9 });
    railing(k, { u0: -lowU, u1: lowU, v: s * (lowW - 0.1), y: LOWER_Y - 0.4, h: 1.1, step: 3.58, color: IRON_C, rails: 2 });
    rod(k, [-lowU, LOWER_Y + 0.65, s * (lowW - 0.1)], [lowU, LOWER_Y + 0.65, s * (lowW - 0.1)], 0.09, 0.09, 0xffe9b8, { emit: LAMP(0.5), mat: 0 });
  }
  for (let u = -lowU; u <= lowU + 0.01; u += 3.58) rod(k, [u, LOWER_Y - 1.4, -lowW], [u, LOWER_Y - 1.4, lowW], 0.4, 0.5, IRON_C, { mat: 9 });
  for (const s of [-1, 1]) {
    for (let i = 2; i < N; i += 2) {
      const u = -HALF + (2 * HALF * i) / N;
      const v = s * ribV(u);
      const yb = axisY(u) - depthAt(u) / 2;
      if (yb - LOWER_Y < 3) continue;
      rod(k, [u, yb, v], [u, LOWER_Y - 0.9, v], 0.2, 0.2, IRON_C, { mat: 9, emit: LAMP(0.12) });
      const u2 = u + 3.58;
      const yb2 = axisY(u2) - depthAt(u2) / 2;
      if (u2 < HALF - 3 && yb2 - LOWER_Y > 3) rod(k, [u, LOWER_Y - 0.9, v], [u2, yb2 - 0.4, s * ribV(u2)], 0.16, 0.16, IRON_C);
    }
  }

  // lamp points for the glitter on the river (src/water.js)
  for (const u of [-60, -30, 0, 30, 60]) k.marker('bridge-lamp', u, axisY(u) + 1, 0, { w: 0.9 });
  for (const u of [-50, 50]) k.marker('bridge-lamp', u, LOWER_Y + 1, 0, { w: 0.7 });

  // ---- springing blocks (granite) with the bearing of each rib
  for (const su of [-1, 1]) {
    const u = su * (HALF + 1.5);
    const gy = Math.min(ga(u, 0), 8);
    const top = 9.4;
    k.box(15, top - gy + 4, 17.6, 'graniteDark', u, gy - 4, 0);
    k.box(15.8, 0.7, 18.4, 'graniteLight', u, top, 0);
    k.box(16.4, 0.5, 19.0, 'graniteLight', u, top - 3.2, 0);
    for (const s of [-1, 1]) k.box(5.4, 0.9, 2.6, 'graniteLight', su * HALF, top + 0.7, s * ribV(HALF));
  }
  k.pop(); // the arch frame

  // ============================================== upper deck (corridor frame)
  const upW = 5.0; // girder centre lines
  const uLen = U_GAIA - U_PORTO;
  const uMid = (U_GAIA + U_PORTO) / 2;
  const nPan = Math.round(uLen / 3.44);
  for (const s of [-1, 1]) {
    truss(k, { u0: U_PORTO, u1: U_GAIA, n: nPan, lo: () => GIRDER_BOT, up: () => GIRDER_TOP, z: s * upW, color: IRON_C, cw: 0.7, ch: 0.5, ww: 0.4, wh: 0.3, mat: 9, emit: deckE });
  }
  // deck slab, walkways, cross beams
  k.box(uLen, 0.5, 2 * upW + 4.6, 0x6d7076, uMid, UPPER_Y - 0.9, 0, { mat: 8, flat: true });
  k.box(uLen, 0.12, 2 * upW + 4.6, 0x585b61, uMid, UPPER_Y - 0.42, 0, { mat: 8, flat: true });
  for (let u = U_PORTO; u <= U_GAIA + 0.01; u += 3.44) {
    rod(k, [u, GIRDER_BOT + 0.35, -upW - 2.2], [u, GIRDER_BOT + 0.35, upW + 2.2], 0.4, 0.5, IRON_C, { mat: 9 });
  }
  // Metro tracks: ballast slab, rails
  k.box(uLen, 0.14, 7.4, 0x77706a, uMid, UPPER_Y - 0.4, 0, { mat: 8 });
  for (const v of [-2.45, -1.0, 1.0, 2.45]) rod(k, [U_PORTO, UPPER_Y - 0.2, v], [U_GAIA, UPPER_Y - 0.2, v], 0.1, 0.14, 0x9ba1a6);
  // railings on the outside of the walkways, with the string of bulbs
  for (const s of [-1, 1]) {
    railing(k, { u0: U_PORTO, u1: U_GAIA, v: s * (upW + 2.3), y: UPPER_Y - 0.4, h: 1.3, step: 3.44, color: IRON_C, rails: 3, w: 0.07 });
    rod(k, [U_PORTO, UPPER_Y + 0.95, s * (upW + 2.3)], [U_GAIA, UPPER_Y + 0.95, s * (upW + 2.3)], 0.13, 0.13, 0xffe9b8, { emit: LAMP(0.9), mat: 0 });
    for (let u = U_PORTO + 2; u <= U_GAIA; u += 6.88) k.box(0.28, 0.28, 0.28, 0xfff2cf, u, UPPER_Y + 0.86, s * (upW + 2.3), { emit: LAMP(1), mat: 0 });
  }
  // lamp posts (crook-top), staggered, and the Metro catenary
  let flip = 1;
  for (let u = U_PORTO + 9; u < U_GAIA - 4; u += 17.2) {
    crookLamp(k, u, flip * (upW + 2.1), UPPER_Y - 0.4, { h: 4.9, dir: flip, reach: 1.7 });
    flip = -flip;
  }
  for (let u = U_PORTO + 18; u < U_GAIA - 6; u += 34.4) {
    for (const s of [-1, 1]) catenaryMast(k, u, s * (upW + 1.6), UPPER_Y - 0.4, { h: 6.2, dir: s, reach: 3.4 });
  }
  for (const v of [-1.5, 1.5]) wire(k, [U_PORTO, UPPER_Y + 5.0, v], [U_GAIA, UPPER_Y + 5.0, v], 0x303438, 0.06);
  for (let u = U_PORTO + 40; u < U_GAIA; u += 44) k.marker('bridge-lamp', u, UPPER_Y + 1, 0, { w: 1 });

  // ---- iron lattice towers (beyond the arch the girder rides on them)
  const towers = [];
  for (const su of [-1, 1]) for (let d = 0; d < 5; d++) towers.push({ u: UC + su * (HALF + d * TOWER_PITCH), onArch: d === 0 });
  for (const t of towers) {
    const ut = t.u;
    if (ut < U_PORTO + 4 || ut > U_GAIA - 4) continue;
    const gr = g(ut, 0);
    const base = t.onArch ? 9.9 : Math.min(gr, GIRDER_BOT - 3) - 0.3;
    const H = GIRDER_BOT - base;
    if (H < 4) {
      k.box(9, Math.max(1, UPPER_Y - 0.9 - (base - 3)), 15.2, 'graniteDark', ut, base - 3, 0);
      continue;
    }
    k.box(10.2, 1.9, 13.4, 'graniteDark', ut, base - 2.2, 0);
    k.box(9.2, 0.5, 12.4, 'graniteLight', ut, base - 0.3, 0);
    const bw = 3.6; // half base width (u)
    const tw = 1.7; // half width at the girder
    const nP = Math.max(2, Math.round(H / 3.6));
    for (const s of [-1, 1]) {
      const v = s * upW;
      for (const l of [-1, 1]) rod(k, [ut + l * bw, base + 0.4, v], [ut + l * tw, GIRDER_BOT, v], 0.9, 0.8, IRON_C, { mat: 9, emit: LAMP(0.12) });
      for (let j = 0; j < nP; j++) {
        const ta = j / nP;
        const tb = (j + 1) / nP;
        const wa = bw + (tw - bw) * ta;
        const wb = bw + (tw - bw) * tb;
        const ya = base + 0.4 + (GIRDER_BOT - base - 0.4) * ta;
        const yb = base + 0.4 + (GIRDER_BOT - base - 0.4) * tb;
        rod(k, [ut - wa, ya, v], [ut + wb, yb, v], 0.36, 0.26, IRON_C);
        rod(k, [ut + wa, ya, v], [ut - wb, yb, v], 0.36, 0.26, IRON_C);
        rod(k, [ut - wb, yb, v], [ut + wb, yb, v], 0.4, 0.3, IRON_C);
      }
    }
    for (const f of [0.02, 0.5, 1]) {
      const y = base + 0.4 + (GIRDER_BOT - base - 0.4) * f;
      const w = bw + (tw - bw) * f;
      for (const l of [-1, 1]) rod(k, [ut + l * w, y, -upW], [ut + l * w, y, upW], 0.45, 0.4, IRON_C);
    }
  }

  // ---- the deck ends: abutment blocks where the deck enters the hill
  for (const e of [U_PORTO, U_GAIA]) {
    const sgn = e < 0 ? -1 : 1;
    const gy = g(e + sgn * 2, 0);
    const bot = Math.min(gy, UPPER_Y - 3) - 3;
    k.box(7, UPPER_Y - 0.9 - bot, 15.6, 'graniteDark', e + sgn * 0.5, bot, 0);
    k.box(7.6, 0.45, 16.4, 'graniteLight', e + sgn * 0.5, UPPER_Y - 0.9, 0);
  }

  k.pop();
  k.end('main');
}

builder.metric = true;
builder.rule = {
  note: 'Ponte Luís I: parabolic double-deck iron arch, 172 m chord, upper deck 60 m, lower deck 11 m',
  // The DEM stays except where the structure meets it: a platform under each
  // springing block, and the cutting the upper deck runs in where the hill
  // is higher than the deck (both ends).
  pad: {
    box: { x0: -9, x1: 9, z0: -206, z1: 206 },
    margin: 0,
    fall: 7,
    level: (x, z, h) => {
      let y = h;
      const d = Math.abs(Math.abs(z - UC) - HALF); // distance from a springing line
      const f = 1 - smooth((d - 8) / 10);
      if (f > 0) y += (Math.min(h, 3.5) - h) * f;
      return Math.min(y, UPPER_Y - 1.7);
    },
  },
  extent: { box: { x0: -8.8, x1: 8.8, z0: -205.1, z1: 205.1 } },
  deviationNote: 'OSM outline is the deck corridor; the model spans the 15.4 m deck with walkways and the 17.6 m springing blocks',
  frame: { x0: -8.8, x1: 8.8, z0: -205.1, z1: 205.1, y0: 0 },
};

export default { 'ponte-luis-i': builder };
