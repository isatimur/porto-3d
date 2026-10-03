// Palácio da Bolsa, Porto. Joaquim da Costa Lima, from 1842, on the site
// of the São Francisco convent. Neoclassical granite palace round the
// glass-roofed Pátio das Nações; Arab Room and Assembly Room hinted inside.
import { Kit, PALETTE, MAT, PROFILES, corniceProfile, archPath, pointedPath } from '../kit.js';
import { onEdge, polyCornice, polyBand, polyWindows, roofOver, plainBuilding } from '../metric.js';
import { edges, obb, offset, bbox } from '../geom.js';
import { win, pediment, punchedWindows } from '../parts.js';
import { fitTo } from './site-fit.js';

const rectPts = (cx, cz, w, d) => [
  [cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2],
  [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2],
];

function builder(k, site) {
  const done = fitTo(k, site, { w: 70.2, d: 56.9, h: 24, cx: 0, cz: 1.35 });
  const OW = 68;
  const OD = 52;
  const outer = rectPts(0, 0, OW, OD);
  const court = rectPts(0, 3, 26, 26);

  // ------------------------------------------------------- outer palace ring
  k.begin('main');
  k.prism(offset(outer, 0.35), 0, 5.5, 'graniteDark', { holes: [court] });
  k.prism(outer, 0, 20, 'granite', { holes: [court] });
  polyBand(k, offset(outer, 0.35), 5.4, 0.55, 0.35, 'graniteLight');
  polyBand(k, offset(outer, 0.2), 12.6, 0.4, 0.2, 'graniteLight');
  polyCornice(k, outer, 20, corniceProfile('classic', 1.1), 'graniteLight');
  // attic storey + lead roof
  k.prism(offset(outer, -0.3), 20, 2.6, 'granite', { holes: [offset(court, 0.3)] });
  polyCornice(k, offset(outer, -0.3), 22.6, corniceProfile('eave', 0.7), 'lead');

  // rusticated ground floor: shallow pilaster strips
  for (const e of edges(outer)) {
    if (e.len < 6) continue;
    onEdge(k, e, 0.6);
    const n = Math.max(2, Math.round(e.len / 5));
    for (let i = 1; i < n; i++) k.box(0.4, 4.6, 0.3, 'granite', -e.len / 2 + (e.len * i) / n, 0, 0.1);
    k.pop();
  }
  // two storeys of windows on the outer faces
  polyWindows(k, outer, {
    storeys: [2.2, 8.6], bay: 5.8, w: 1.6, h: 3.4,
    win: { trim: 'graniteLight', pane: 'glass', bw: 0.3, depth: 0.4 },
    storey: (s) => (s === 1 ? { arch: 'round', head: 'seg' } : { head: 'flat' }),
  });
  k.end('main');

  // ------------------------------------------------------------------ portico
  k.begin('portico');
  k.stairs(18, 4.5, 1.6, 4, 'granite', 0, 0, 27.5, { below: 1.2 });
  for (let i = 0; i < 6; i++) k.column(10, 0.55, 'graniteLight', -7.5 + i * 3, 1.4, 26.8, { smooth: true });
  k.box(18, 1.4, 3.2, 'graniteLight', 0, 11.4, 26.4);
  pediment(k, 17, 3.4, 2.8, 'graniteLight', 0, 12.8, 26.4);
  // giant arched entrance behind the columns
  win(k, 0, 1.6, 4.4, 7.2, 26.0, { arch: 'round', pane: 'dark', bw: 0.4, depth: 0.5 });
  k.end('portico');

  // ---------------------------------------------------------- detail pass
  // portico order: column bases and capitals, and a triglyph frieze
  for (let i = 0; i < 6; i++) {
    const px = -7.5 + i * 3;
    k.box(1.5, 0.5, 1.5, 'graniteLight', px, 0.95, 26.8);
    k.box(1.4, 0.55, 1.4, 'graniteLight', px, 10.35, 26.8);
    for (let f = -2; f <= 2; f++) k.box(0.1, 8.9, 0.1, 'granite', px + f * 0.22, 1.45, 27.4);
  }
  for (let i = 0; i < 15; i++) k.box(0.5, 0.7, 0.22, 'graniteLight', -8.4 + i * 1.2, 11.8, 25.4);
  // ground-floor keystones and a continuous impost band on the outer faces
  for (const e of edges(outer)) {
    if (e.len < 8) continue;
    onEdge(k, e, 0.6);
    const n = Math.max(2, Math.round(e.len / 5.8));
    for (let i = 0; i < n; i++) {
      const u = -e.len / 2 + (e.len / n) * (i + 0.5);
      k.box(0.9, 0.7, 0.45, 'graniteLight', u, 4.9, 0.18);
    }
    k.pop();
  }
  // attic: iron cresting along the lead roof and a row of carved chimneys
  for (let i = -6; i <= 6; i++) k.lathe(PROFILES.finial, 5, 'bronze', i * 5.2, 23.0, OD / 2 - 0.6, { sr: 0.2, sh: 0.8, flat: true });
  for (let i = -3; i <= 3; i++) k.box(1.2, 2.4, 1.2, 'graniteWarm', i * 9.5, 22.6, -OD / 2 + 3.0);

  // ------------------------------------------------------- inner courtyard
  k.begin('court');
  punchedWindows(k, court, 0, {
    storeys: 2, first: 2.0, storey: 6.4, w: 1.5, h: 3.2, bay: 3.4, margin: 1.4,
    flip: true, trim: 'graniteLight', pane: 'glass', emit: 0.16,
  });
  // Arab Room hint: golden horseshoe-arched gallery on the north walk
  k.push({ x: 0, z: -10, ry: 0 });
  k.arcade(22, 5.0, 0.6, 6, 2.0, 3.7, 'graniteLight', 0, 8.4, 0, {});
  for (let i = 0; i < 6; i++) {
    const ax = -11 + (22 / 6) * (i + 0.5);
    k.box(2.4, 0.5, 0.7, 'gold', ax, 12.1, 0.35, { emit: 0.4 });
    k.box(0.35, 3.0, 0.5, 'gold', ax - 1.05, 8.9, 0.35, { emit: 0.35 });
    k.box(0.35, 3.0, 0.5, 'gold', ax + 1.05, 8.9, 0.35, { emit: 0.35 });
  }
  k.box(22, 0.4, 0.9, 'gold', 0, 13.3, 0.3, { emit: 0.35 });
  k.pop();
  // Assembly Room hint: dressed upper hall on the south walk
  k.push({ x: 0, z: 16, ry: Math.PI });
  k.arcade(22, 5.0, 0.6, 5, 2.6, 4.0, 'graniteLight', 0, 8.4, 0, {});
  k.balustrade(22, 1.2, 'graniteLight', 0, 13.4, 0.5, { cheap: true, d: 0.25, sp: 0.5 });
  k.pop();
  k.end('court');

  // glass roof over the Pátio das Nações
  k.begin('height');
  k.hipRoof(28, 28, 3.2, 'glass', 0, 20.4, 3, { glass: true, over: 0.2 });
  for (let i = -2; i <= 2; i++) {
    k.box(0.14, 0.2, 28, 'iron', i * 5.2, 21.2, 3);
    k.box(28, 0.2, 0.14, 'iron', 0, 21.2, 3 + i * 5.2);
  }
  k.lathe(PROFILES.finial, 6, 'lead', 0, 22.4, 3, { sr: 0.5, sh: 1.6, flat: true });
  k.end('height');
  done();
}

builder.metric = true;
builder.rule = { note: 'Neoclassical palace ~68x52 m round a 26 m glass court; authored metric' };
export default { bolsa: builder };
