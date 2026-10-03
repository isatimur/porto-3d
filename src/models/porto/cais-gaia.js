// Cais de Gaia — the Gaia riverfront on the left bank of the Douro, facing
// the historic Porto (UNESCO). The quay was Porto's wine harbour for
// centuries; the present esplanade, restaurant and bar row (Tasso de Sousa,
// 2000-2003) sits under the wine lodges, with the Teleférico lower station
// and rabelo boats on the river. The model is the lodge/restaurant row.
import { Kit, PALETTE, MAT, PROFILES, corniceProfile } from '../kit.js';
import { edges, obb, offset, bbox, rect } from '../geom.js';
import { win } from '../parts.js';
import { fitTo } from './site-fit.js';

const FACADES = ['plaster', 'cream', 'ochre', 'rose', 'white', 'graniteWarm', 'ochre', 'cream'];

function rabelo(k, x, z, ry, s = 1) {
  k.push({ x, z, ry });
  k.frustum(3.2 * s, 1.4 * s, 2.4 * s, 1.0 * s, 1.1 * s, 'wood', 0, -0.25, 0);
  k.box(0.25 * s, 7 * s, 0.25 * s, 'wood', 0, 0.7 * s, 0.1 * s);
  k.box(4.2 * s, 3.2 * s, 0.08 * s, 'sand', 0, 5.2 * s, 0.05 * s);
  k.box(4.0 * s, 0.15 * s, 0.6 * s, 'wood', 0, 7.0 * s, 0.1 * s);
  k.pop();
}

// Documented fallback: the OSM outline of Cais de Gaia (way 1079535206) is
// the whole 909 x 182.7 m quay area, far larger than the lodge/restaurant
// row the model stands for. The drawn sub-extent is a ~300 m frontage row.
const FB = { x0: -16, x1: 50, z0: -152, z1: 152 };

function builder(k, site) {
  const o = site?.footprint?.outline;
  const ob = o && o.length >= 3 ? obb(o) : null;
  const L = Math.max(120, Math.min(300, ob?.L ?? 300));
  const rnd = k.rnd;
  // placement box: row frontage + quay + a strip of the Douro, centred on
  // the OSM outline, long axis running with the river (local z).
  const cx = ob?.cx ?? -33;
  const BOX = { x0: -16, x1: 50, z0: -L / 2, z1: L / 2, w: 66, d: L, cx: -33, cz: ob?.cz ?? 0 };
  // Drawn height: tallest lodge roof apex before fit (y 0..15.2 m). fitTo()
  // scales the drawn row to dimensions.json's 12 m eaves/total.
  const DRAWN_H = 15.2;
  const done = fitTo(k, site, { w: BOX.w, d: BOX.d, h: DRAWN_H, cx: BOX.cx, cz: BOX.cz }, BOX);

  const zF = 6; // river face of the buildings

  k.begin('main');
  // granite quay slab
  k.prism(rect(-4, BOX.cz, 24, L), -0.4, 1.0, 'graniteWarm');
  // cobbled riverside strip
  k.prism(rect(2, BOX.cz, 4, L), 0.6, 0.15, 'sand');
  // the Douro
  k.prism(rect(29, BOX.cz, 42, L + 4), -0.6, 0.45, 'water', { emit: 0.05 });

  // terrace row: varied 2-3 storey lodges and restaurants with awnings
  let z = -L / 2 + 4;
  let hi = 0;
  while (z < L / 2 - 4) {
    const d = 12 + rnd() * 9;
    const dd = Math.min(d, L / 2 - z);
    const cz = z + dd / 2;
    const h = 8 + Math.round(rnd() * 4);
    const col = FACADES[Math.floor(rnd() * FACADES.length)];
    // body set back from the quay face
    k.prism(rect(-1.5, cz, 13, dd - 0.3), 0, h, col);
    // ground-floor arcade / glazed frontage on the river face (+x)
    k.push({ x: -1.5, z: cz, ry: -Math.PI / 2 });
    k.arcade(dd - 0.4, 3.5, 0.7, Math.max(1, Math.round(dd / 3.4)), (dd / Math.max(1, Math.round(dd / 3.4))) * 0.62, 2.9, 'graniteWarm');
    k.pop();
    // upper windows, river side and back
    const nw = Math.max(1, Math.round(dd / 3.0));
    for (let i = 0; i < nw; i++) {
      const u = -dd / 2 + (dd / nw) * (i + 0.5);
      for (const wy of [4.6, 8.1]) {
        if (wy + 1.7 > h) continue;
        k.push({ x: -1.5, z: cz + u, ry: -Math.PI / 2 });
        win(k, 0, wy, 1.0, 1.7, 7.2, { trim: 'granite', pane: 'glass', bw: 0.2, depth: 0.3, sill: true, balcony: rnd() > 0.8 ? 'iron' : false });
        k.pop();
      }
    }
    // awning over the esplanade
    if (rnd() > 0.35) {
      const aw = 3.2;
      k.prism(rect(2.4, cz, aw, dd - 2), 3.6, 0.18, hi % 3 === 0 ? 'maroon' : 'cream');
      for (const sgn of [-1, 1]) k.cyl(0.08, 0.08, 3.6, 5, 'iron', 2.4 + aw / 2 - 0.2, 0, cz + sgn * (dd / 2 - 1.2));
    }
    // tiled hip roof and chimneys
    k.push({ x: -1.5, z: cz });
    k.hipRoof(13, dd - 0.3, 2.6, 'terracotta', 0, h, 0, { over: 0.45 });
    k.pop();
    const nch = 1 + Math.floor(rnd() * 2);
    for (let c = 0; c < nch; c++) k.box(0.5, 0.9, 0.5, 'graniteWarm', -1.5 + (rnd() - 0.5) * 10, h + 2.3, cz + (rnd() - 0.5) * (dd - 3));
    z += dd;
    hi++;
  }
  k.end('main');

  // quay furniture: lamps, barrels, an acoustic-shell plaza
  k.begin('quay');
  const nl = Math.max(3, Math.round(L / 26));
  for (let i = 0; i < nl; i++) k.lamp(5.0, 5.6, 1.05, -L / 2 + (L * (i + 0.5)) / nl, { globe: true });
  for (let i = 0; i < 14; i++) {
    k.cyl(0.55, 0.55, 1.1, 10, 'wood', 5.0 + rnd() * 6, 0.9, -L / 2 + 10 + rnd() * (L - 20));
  }
  // a low acoustic-shell plaza
  k.dome(7.5, 'white', 6, 0.9, BOX.cz + L * 0.18, { seg: 14, rings: 6, open: true });
  for (let i = 0; i < 6; i++) k.column(4.2, 0.28, 'graniteLight', 6 - 6 + i * 2.4, 0.9, BOX.cz + L * 0.18 + 6, { smooth: true });
  k.end('quay');

  // rabelo boats on the Douro
  k.begin('boats');
  const nb = Math.max(2, Math.round(L / 60));
  for (let i = 0; i < nb; i++) rabelo(k, 18 + rnd() * 10, -L / 2 + 14 + ((L - 28) * (i + 0.5)) / nb + (rnd() - 0.5) * 8, Math.PI / 2 + (rnd() - 0.5) * 0.4);
  k.end('boats');

  // --- detail: riverside bollards, quay signboards and a lodge plaque
  for (let i = 0; i < 10; i++) {
    const zz = -L / 2 + 12 + (i * (L - 24)) / 9;
    k.cyl(0.28, 0.34, 0.9, 8, 'steel', 4.2, 1.0, zz);
  }
  for (let i = 0; i < 5; i++) {
    k.box(0.25, 1.5, 3.4, 'doorBlue', 4.3, 3.0, -L / 2 + 14 + i * ((L - 28) / 4));
    k.box(0.35, 0.4, 3.8, 'graniteLight', 4.25, 2.6, -L / 2 + 14 + i * ((L - 28) / 4));
  }

  done();
}
builder.metric = true;
builder.rule = {
  note: 'Cais de Gaia: ~300 m Gaia riverfront lodge/restaurant row on the Douro quay; the OSM outline is the whole 909 m quay area',
  extent: { box: { x0: -16, x1: 50, z0: -152, z1: 152 } },
  fitTo: true,
};
export default { 'cais-gaia': builder };
