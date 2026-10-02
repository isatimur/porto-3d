// Sé do Porto — 12th-c. Romanesque fortress-cathedral on a hilltop.
// Twin-tower crenellated west front, rose window, Gothic cloister with
// azulejo panels and a baroque loggia.
import { Kit, PALETTE, MAT, PROFILES, corniceProfile, archPath, pointedPath } from '../kit.js';
import { onEdge, polyCornice, polyBand, polyWindows, roofOver, plainBuilding } from '../metric.js';
import { edges, obb, offset, bbox } from '../geom.js';
import { win, pediment, bell } from '../parts.js';
import { fitTo } from './site-fit.js';

const rectPts = (cx, cz, w, d) => [
  [cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2],
  [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2],
];

function disc(k, r, th, color, x, y, z, o = {}) {
  k.cyl(r, r, th, o.seg ?? 20, color, x, y - th / 2, z, { rx: Math.PI / 2, ...o });
}

function builder(k, site) {
  const done = fitTo(k, site, { w: 48.6, d: 58, h: 29, cx: -9.75, cz: -12 });
  const body = rectPts(0, -12, 20, 44);

  // -------------------------------------------------------------- nave body
  k.begin('main');
  k.prism(body, 0, 15, 'granite');
  k.prism(offset(body, 0.3), 0, 1.4, 'graniteDark');
  k.gableRoof(20, 44, 5, 'terracotta', 0, 15, -12, { over: 0.7 });
  k.crenels(20, 44, 'graniteLight', 0, 15, -12, { mw: 1.5, mh: 1.4, t: 0.9 });
  // clerestory windows on both flanks
  for (const sx of [-1, 1]) {
    k.push({ x: sx * 10, z: 0, ry: sx > 0 ? Math.PI / 2 : -Math.PI / 2 });
    for (let i = 0; i < 7; i++) win(k, -14 + i * 5, 9.0, 1.4, 3.2, 0, { arch: 'round', pane: 'glass', bw: 0.25, depth: 0.3 });
    k.pop();
  }
  // apse volume at the east end
  k.prism(rectPts(0, -36, 16, 10), 0, 11, 'granite');
  // main = the whole cathedral composition (nave, front, cloister): the fit
  // report checks it against the OSM footprint.

  // ------------------------------------------------------------ west front
  k.begin('front');
  const fz = 10.5;
  // central section between the towers
  k.prism(rectPts(0, 9.3, 11, 3.2), 0, 21, 'granite');
  k.gableRoof(11, 3.2, 2.8, 'terracotta', 0, 21, 9.3, { over: 0.4 });
  k.crenels(11, 3.2, 'graniteLight', 0, 21, 9.3, { mw: 1.1, mh: 1.1, t: 0.8 });

  // Romanesque portal: stepped archivolts
  k.wall(9, 9.5, 0.8, 'granite', [{ x: 0, y: 0, w: 3.4, h: 6.4, arch: 'round', pane: 'dark', inset: 0.6 }], 0, 0, 10.1);
  for (let i = 0; i < 3; i++) {
    k.surround({ x: 0, y: 0.35 * i, w: 3.4 + i * 1.1, h: 6.4 + i * 0.85, arch: 'round' }, 0.32, 0.5, 'graniteLight', 10.8 + i * 0.34);
  }
  // rose window: granite ring, tracery spokes, glass
  k.push({ z: fz });
  disc(k, 2.5, 0.5, 'graniteLight', 0, 14.8, 0.2, { seg: 26 });
  disc(k, 2.05, 0.28, 'glass', 0, 14.8, 0.4, { seg: 24, emit: 0.25 });
  for (let i = 0; i < 8; i++) k.box(0.16, 3.9, 0.2, 'graniteLight', 0, 12.9, 0.55, { rz: (i * Math.PI) / 8 });
  disc(k, 0.5, 0.3, 'graniteLight', 0, 14.8, 0.6, { seg: 12 });
  k.pop();

  // twin towers
  k.begin('height');
  for (const sx of [-1, 1]) {
    const bx = sx * 10.5;
    k.box(7.5, 26, 7.5, 'granite', bx, 0, 9);
    k.box(7.9, 1.4, 7.9, 'graniteDark', bx, 0, 9);
    const f = (ry, off) => {
      k.push({ x: bx, z: 9, ry });
      win(k, 0, 5.2, 1.2, 3.0, off, { arch: 'round', pane: 'glass', bw: 0.22, depth: 0.28 });
      win(k, 0, 13.0, 1.2, 3.0, off, { arch: 'round', pane: 'glass', bw: 0.22, depth: 0.28 });
      win(k, 0, 19.4, 1.2, 2.6, off, { arch: 'round', pane: 'glass', bw: 0.22, depth: 0.28 });
      k.pop();
    };
    f(0, 3.75);
    f(sx > 0 ? Math.PI / 2 : -Math.PI / 2, 3.75);
    f(Math.PI, 3.75);
    k.crenels(7.5, 7.5, 'graniteLight', bx, 24, 9, { mw: 1.2, mh: 1.3, t: 0.8 });
    k.push({ x: bx, z: 9 });
    k.cone(5.6, 3.2, 4, 'slate', 0, 24.4, 0, { smooth: false });
    k.lathe(PROFILES.finial, 6, 'graniteLight', 0, 27.6, 0, { sr: 0.4, sh: 1.4, flat: true });
    k.pop();
  }
  k.end('height');
  k.end('front');

  // ---------------------------------------------------------------- cloister
  k.begin('cloister');
  const clx = -22;
  const clz = -6;
  const outer = rectPts(clx, clz, 23, 23);
  const court = rectPts(clx, clz, 14, 14);
  // thin outer wall, open walk, inner arcade → real depth in the openings
  k.prism(outer, 0, 6.5, 'granite', { holes: [rectPts(clx, clz, 21.8, 21.8)] });
  k.prism(court, 0, 0.18, 'sand');
  for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) k.box(1.3, 6.5, 1.3, 'granite', clx + px * 7, 0, clz + pz * 7);
  // Gothic arcades on the four courtyard faces
  const sides = [
    [clx, clz - 7, 0], [clx, clz + 7, Math.PI], [clx - 7, clz, Math.PI / 2], [clx + 7, clz, -Math.PI / 2],
  ];
  for (const [sx, sz, ry] of sides) {
    k.push({ x: sx, z: sz, ry });
    k.arcade(14, 5.6, 0.7, 4, 2.2, 3.8, 'granite', 0, 0, 0, { pointed: true });
    // azulejo panel band above the arcade
    k.box(13, 1.0, 0.14, 'azulejo', 0, 5.7, 0.4, { mat: MAT.azulejo });
    k.box(13.4, 0.3, 0.25, 'graniteLight', 0, 5.4, 0.45);
    k.pop();
  }
  // lean-to roof slabs over the walk
  k.prism(outer, 6.5, 0.5, 'terracotta', { holes: [rectPts(clx, clz, 13.4, 13.4)] });
  k.corniceRing(23, 23, corniceProfile('eave', 0.5), 'graniteLight', clx, 6.5, clz);
  // baroque loggia on the north walk (upper storey with columns)
  k.push({ x: clx, z: clz - 7 });
  for (let i = 0; i < 5; i++) k.column(3.2, 0.32, 'graniteLight', -5.4 + i * 2.7, 4.6, 0.5, { smooth: true });
  k.box(13.4, 0.5, 1.4, 'graniteLight', 0, 7.8, 0.7);
  k.pop();
  k.end('cloister');
  k.end('main');
  done();
}

builder.metric = true;
builder.rule = { note: 'Romanesque cathedral ~20x44 m nave, twin 26 m towers; authored metric' };
export default { 'se-porto': builder };
