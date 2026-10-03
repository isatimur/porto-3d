// Capela das Almas (Capela de Santa Catarina), Porto. A chapel on the corner
// of Rua de Santa Catarina and Rua de Fernandes Tomás, its origin a wooden
// chapel to Saint Catherine; the present building is 18th-century and passed
// to the Irmandade das Almas e das Chagas de São Francisco, enlarged in 1801.
// Since 1929 its exterior has been clad in 15,947 blue-and-white azulejo tiles
// by Eduardo Leite (Viúva Lamego), covering some 360 square metres, with the
// lives of Saint Francis and Saint Catherine. A bell tower with two storeys
// stands to the left; the dome is crowned by an iron cross.
import { Kit, PALETTE, MAT, PROFILES, corniceProfile } from '../kit.js';
import { win, cartouche, bellTower } from '../parts.js';
import { offset, bbox, rect } from '../geom.js';
import { fitTo } from './site-fit.js';

function disc(k, r, th, color, x, y, z, o = {}) {
  k.cyl(r, r, th, o.seg ?? 20, color, x, y - th / 2, z, { rx: Math.PI / 2, ...o });
}

function builder(k, site) {
  const done = fitTo(k, site, { w: 12.7, d: 25.8, h: 16, cx: 0, cz: 0 });
  const o = site?.footprint?.outline;
  const b = o && o.length >= 3 ? bbox(o) : { w: 12.7, d: 25.8, cx: 0, cz: 0 };
  const W = Math.max(10, b.w);
  const D = Math.max(18, b.d);
  const cx = b.cx;
  const cz = b.cz;
  const zF = cz + D / 2;
  const zB = cz - D / 2;
  k.prism(rect(cx, cz, W + 1.6, D + 1.6), 0, 0.9, 'granite');
  k.prism(rect(cx, zF + 6, W + 12, 11), -0.1, 0.22, 'graniteLight');

  // ------------------------------------------------ taller front body (tiled)
  const H1 = 12.5;
  const D1 = D * 0.6;
  const cz1 = zF - D1 / 2;
  k.begin('mask');
  k.prism(rect(cx, cz1, W, D1), 0, H1, 'graniteWarm');
  k.prism(offset(rect(cx, cz1, W, D1), 0.22), 0, 1.6, 'graniteDark');
  k.corniceRing(W, D1, corniceProfile('eave', 0.5), 'graniteLight', cx, H1 - 0.4, cz1);
  k.push({ x: cx, z: cz1 });
  k.gableRoof(W + 0.4, D1 + 0.8, 4.0, 'terracotta', 0, H1, 0, { over: 0.6 });
  k.pop();
  k.end('mask');

  // ------------------------------------------------ lower rear body
  const H2 = 9.0;
  const cz2 = cz1 - D1 / 2 - (D - D1) / 2 + 0.2;
  k.prism(rect(cx, cz2, W, D - D1 + 0.4), 0, H2, 'graniteWarm');
  k.corniceRing(W, D - D1 + 0.4, corniceProfile('band', 0.4), 'graniteLight', cx, H2 - 0.3, cz2);
  k.push({ x: cx, z: cz2 });
  k.hipRoof(W + 0.4, D - D1 + 0.8, 2.6, 'terracotta', 0, H2, 0, { over: 0.5 });
  k.pop();

  // azulejo tile skin wrapping the front body's two long walls
  for (const s of [-1, 1]) {
    k.push({ x: cx + s * (W / 2 + 0.06), z: cz1, ry: s > 0 ? Math.PI / 2 : -Math.PI / 2 });
    k.wall(D1 - 0.9, 9.4, 0.4, 'azulejo',
      [{ x: 0, y: 2.4, w: 1.5, h: 3.2, arch: 'round', pane: 'glass', inset: 0.3 }], 0, 1.7, 0.05);
    k.box(D1 - 0.7, 0.5, 0.6, 'graniteLight', 0, 11.1, 0.1);
    k.box(D1 - 0.7, 0.9, 0.6, 'granite', 0, 0.9, 0.12);
    k.pop();
  }

  // --------------------------------------------------- azulejo facade + pediment
  k.push({ x: cx, z: zF });
  k.wall(W + 1.0, H1 + 4.2, 1.0, 'azulejo',
    [{ x: 0, y: 0, w: 3.4, h: 6.2, arch: 'round', pane: 'dark', inset: 0.55 }], 0, 0, 0.2);
  k.box(W + 1.6, 0.8, 1.4, 'graniteLight', 0, 0, 0.3);
  k.surround({ x: 0, y: 0, w: 3.4, h: 6.2, arch: 'round' }, 0.38, 0.5, 'graniteLight', 0.72);
  // framed door + circular pediment over it
  disc(k, 2.2, 0.5, 'graniteLight', 0, H1 + 0.2, 0.75, { seg: 22, ry: Math.PI / 2 });
  disc(k, 1.75, 0.3, 'azulejo', 0, H1 + 0.2, 0.95, { seg: 20, mat: MAT.azulejo });
  // bipartite coat of arms of Saint Francis and Saint Catherine in the tympanum
  cartouche(k, 1.9, 2.0, 0.5, 'graniteLight', 0, H1 + 0.9, 1.35, { cross: 'iron' });
  for (const s of [-1, 1]) {
    win(k, s * (W / 2 - 1.7), 3.0, 1.2, 2.6, 0.65, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.24, sill: true });
    disc(k, 0.62, 0.2, 'graniteLight', s * (W / 2 - 1.7), 7.6, 0.7, { seg: 14 });
    disc(k, 0.42, 0.14, 'window', s * (W / 2 - 1.7), 7.6, 0.82, { seg: 12, emit: 0.35 });
  }
  k.box(0.14, 1.8, 0.14, 'iron', 0, H1 + 6.0, 1.2);
  k.box(0.85, 0.14, 0.14, 'iron', 0, H1 + 7.2, 1.2);
  k.pop();

  // -------------------------------------------- bell tower (two storeys) at left
  k.begin('height');
  bellTower(k, {
    w: 4.0, hBody: 8.6, hBelfry: 3.0,
    x: cx - (W / 2 - 1.9), z: zF - 2.2,
    body: 'graniteWarm', trim: 'graniteLight', cap: 'bell', capH: 2.9,
    openings: 1, windows: 1, clock: false, urns: false, balustrade: true, cross: true,
  });
  k.end('height');

  // --- detail pass: tiled ridges, a tiled street dado and a crossing cupola
  for (let i = 0; i < 10; i++) {
    const tz = cz1 - D1 / 2 + 1.5 + (i * (D1 - 3)) / 9;
    k.box(0.5, 0.24, 0.42, 'terracotta', cx, H1 + 3.75, tz);
  }
  for (let i = 0; i < 8; i++) {
    const tz = cz2 - (D - D1) / 2 + 1.2 + (i * ((D - D1) - 2.4)) / 7;
    k.box(0.45, 0.2, 0.4, 'terracotta', cx, H2 + 2.75, tz);
  }
  k.wall(W + 1.0, 1.4, 0.3, 'azulejo', [], cx, 0, zF + 0.22, { mat: MAT.azulejo });
  for (const s of [-1, 1]) {
    k.push({ x: cx + s * (W / 2 + 0.12), z: cz1, ry: s * Math.PI / 2 });
    k.wall(D1 - 0.8, 1.4, 0.28, 'azulejo', [], 0, 0, 0, { mat: MAT.azulejo });
    k.pop();
  }
  k.cyl(1.6, 1.8, 1.2, 10, 'graniteWarm', cx, H1 + 0.2, cz1 - D1 * 0.12);
  k.dome(1.6, 'lead', cx, H1 + 1.4, cz1 - D1 * 0.12, { seg: 12, rings: 5 });
  k.box(0.1, 0.9, 0.1, 'iron', cx, H1 + 3.0, cz1 - D1 * 0.12);
  k.box(0.6, 0.1, 0.1, 'iron', cx, H1 + 3.4, cz1 - D1 * 0.12);

  done();
}
builder.metric = true;
builder.rule = {
  note: 'Capela das Almas: 18th-century chapel, 15,947 azulejo tiles (Eduardo Leite, 1929), two-storey bell tower',
  fitTo: true,
};
export default { 'capela-almas': builder };
