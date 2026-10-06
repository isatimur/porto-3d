// Estação de São Bento, Porto (1916), on the former São Bento de Avé Maria
// monastery. Long two-storey granite building, monumental entrance, mansard
// attic; the vestibule's ~20,000 azulejo tiles (Jorge Colaço) hinted at the
// entrance and on the front panels.
import { Kit, PALETTE, MAT, PROFILES, corniceProfile, archPath, pointedPath } from '../kit.js';
import { onEdge, polyCornice, polyBand, polyWindows, roofOver, plainBuilding } from '../metric.js';
import { edges, obb, offset, bbox } from '../geom.js';
import { win, pediment } from '../parts.js';
import { fitTo } from './site-fit.js';

const rectPts = (cx, cz, w, d) => [
  [cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2],
  [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2],
];

function disc(k, r, th, color, x, y, z, o = {}) {
  k.cyl(r, r, th, o.seg ?? 20, color, x, y - th / 2, z, { rx: Math.PI / 2, ...o });
}

function builder(k, site) {
  const done = fitTo(k, site, { w: 73.8, d: 26.8, h: 24.4, cx: 0, cz: 1.5 }, { w: 73.8, d: 26.8, cx: 0, cz: 1.5 });
  const W = 72;
  const D = 22; // the front elements hang on D / 2 (z = 11)
  const H = 13;
  // The body is 1 m deeper at the back (the OSM station is 26.8 m deep and
  // the model's main block was 11 % short of it): same front, rear at z -12.
  const DB = D + 1;
  const ZC = -0.5;
  const body = rectPts(0, ZC, W, DB);

  // ---------------------------------------------------------------- main block
  k.begin('main');
  k.prism(offset(body, 0.4), 0, 3.4, 'graniteDark');
  k.prism(body, 0, H, 'granite');
  polyBand(k, offset(body, 0.4), 3.3, 0.5, 0.4, 'graniteLight');
  polyCornice(k, body, H, corniceProfile('classic', 0.9), 'graniteLight');
  polyWindows(k, body, {
    storeys: [2.4, 7.8], bay: 4.2, w: 1.5, h: 3.0,
    win: { trim: 'graniteLight', pane: 'glass', bw: 0.3, depth: 0.35, head: 'flat', sill: true },
  });
  // mansard attic
  k.frustum(W + 0.2, DB + 0.2, W - 8, DB - 7, 5.5, 'slate', 0, H, ZC);
  k.box(W - 8, 0.5, DB - 7, 'lead', 0, H + 5.5, ZC);
  // dormers on the front slope
  for (let i = -3; i <= 3; i++) {
    const x = i * 8.4;
    k.push({ x, z: D / 2 - 2.0 });
    k.box(2.4, 2.2, 1.6, 'granite', 0, H + 1.3, 0);
    k.push({ ry: Math.PI / 2 });
    k.gableRoof(1.6, 2.4, 0.9, 'slate', 0, H + 3.5, 0, { over: 0.2, ridge: false });
    k.pop();
    win(k, 0, H + 1.7, 1.0, 1.5, 0.85, { trim: 'graniteLight', pane: 'window', bw: 0.15, depth: 0.2, emit: 0.35 });
    k.pop();
  }
  k.end('main');

  // ------------------------------------------------------- monumental pavilion
  k.begin('pavilion');
  k.begin('height');
  const pz = D / 2 - 1.2;
  k.prism(rectPts(0, pz, 20, 5), 0, 17, 'granite');
  k.box(21, 1.4, 6, 'graniteDark', 0, 0, pz);
  // vestibule glimpsed through the arches: azulejo wall proud of the body front
  k.box(15.5, 9.6, 0.25, 'azulejo', 0, 1.2, 11.1, { mat: MAT.azulejo });
  k.box(16.2, 0.5, 0.45, 'graniteLight', 0, 10.7, 11.2);
  k.wall(18, 10.5, 0.9, 'granite', [
    { x: -5.4, y: 0, w: 3.6, h: 6.6, arch: 'round', pane: null },
    { x: 0, y: 0, w: 4.4, h: 7.4, arch: 'round', pane: null },
    { x: 5.4, y: 0, w: 3.6, h: 6.6, arch: 'round', pane: null },
  ], 0, 0, pz + 2.0);
  for (const hx of [-5.4, 0, 5.4]) k.surround({ x: hx, y: 0, w: hx === 0 ? 4.4 : 3.6, h: hx === 0 ? 7.4 : 6.6, arch: 'round' }, 0.35, 0.55, 'graniteLight', pz + 2.5);
  // clock
  disc(k, 1.7, 0.35, 'graniteLight', 0, 13.4, pz + 2.55, { seg: 22 });
  disc(k, 1.3, 0.25, 'white', 0, 13.4, pz + 2.75, { seg: 20 });
  k.box(0.12, 1.1, 0.08, 'dark', 0, 13.5, pz + 2.9);
  k.box(0.75, 0.12, 0.08, 'dark', 0.3, 13.4, pz + 2.9);
  // attic + segmental pediment
  k.box(20, 2.6, 5, 'granite', 0, 17, pz);
  pediment(k, 15, 3.2, 5.4, 'graniteLight', 0, 19.6, pz);
  k.lathe(PROFILES.finial, 6, 'graniteLight', 0, 22.8, pz, { sr: 0.5, sh: 1.6, flat: true });
  // azulejo panels flanking the entrance (Jorge Colaço memorial)
  for (const sx of [-1, 1]) {
    k.box(6.8, 5.0, 0.3, 'graniteLight', sx * 14, 1.9, 11.0, {});
    k.box(6.0, 4.2, 0.35, 'azulejo', sx * 14, 2.3, 11.15, { mat: MAT.azulejo });
  }
  k.end('height');
  k.end('pavilion');

  // iron and glass entrance canopy
  k.box(13, 0.25, 3.0, 'iron', 0, 8.2, pz + 3.6);
  for (const sx of [-1, 1]) k.segment([sx * 6, 8.3, pz + 5.0], [sx * 6, 1.0, pz + 4.6], 0.1, 0.1, 'iron', { round: true, seg: 4 });

  // ---------------------------------------------------------- detail pass
  // corner pavilions (torreões) capping both ends, each with a pyramidal
  // slate cap and a finial
  for (const sx of [-1, 1]) {
    const ex = sx * 32.5;
    k.prism(rectPts(ex, ZC, 7.5, DB + 2.5), 0, H + 1.6, 'granite');
    polyCornice(k, rectPts(ex, ZC, 7.5, DB + 2.5), H + 1.6, corniceProfile('classic', 0.6), 'graniteLight');
    k.push({ x: ex, z: ZC });
    k.hipRoof(7.5, DB + 2.5, 4.2, 'slate', 0, H + 1.6, 0, { over: 0.35 });
    k.pop();
    k.lathe(PROFILES.finial, 6, 'graniteLight', ex, H + 5.6, 0, { sr: 0.3, sh: 1.2, flat: true });
    // two windows per face on the pavilions
    win(k, ex, 2.4, 1.4, 3.0, D / 2 + 1.35, { trim: 'graniteLight', pane: 'glass', bw: 0.28, depth: 0.32, sill: true });
    win(k, ex, 7.8, 1.4, 3.0, D / 2 + 1.35, { trim: 'graniteLight', pane: 'glass', bw: 0.28, depth: 0.32, sill: true });
  }
  // mansard: dormer pediments and slate ridge cresting along the ridge
  for (let i = -3; i <= 3; i++) {
    const x = i * 8.4;
    k.box(3.0, 0.5, 2.0, 'graniteLight', x, H + 3.4, D / 2 - 1.9);
    k.box(0.7, 0.5, 0.5, 'graniteLight', x, H + 4.6, D / 2 - 1.9);
  }
  for (let i = -5; i <= 5; i++) k.lathe(PROFILES.finial, 5, 'graniteLight', i * 6.4, H + 6.2, 0, { sr: 0.16, sh: 0.7, flat: true });
  // facade: giant pilasters framing the three entrance arches
  for (const px of [-9.8, -2.6, 2.6, 9.8]) {
    k.box(0.9, 12.5, 0.5, 'graniteLight', px, 0.8, 11.15);
    k.box(1.2, 0.55, 0.7, 'graniteLight', px, 13.3, 11.2);
    k.box(1.2, 0.55, 0.7, 'graniteLight', px, 0.8, 11.2);
  }
  // chimneys on the main roof
  for (let i = -2; i <= 2; i++) k.box(1.0, 2.4, 1.0, 'graniteWarm', i * 14, H + 5.6, -7.0);
  // iron platform canopy trusses reaching back over the tracks
  for (let i = -3; i <= 3; i++) {
    k.box(0.3, 0.3, 9.0, 'iron', i * 8.0, 10.0, -7.0);
    k.segment([i * 8.0, 10.0, -11.5], [i * 8.0, 6.5, -2.5], 0.18, 0.18, 'iron');
  }
  done();
}

builder.metric = true;
builder.rule = { note: 'São Bento station ~72x22 m, mansard attic; azulejo vestibule hinted' };
export default { 'sao-bento': builder };
