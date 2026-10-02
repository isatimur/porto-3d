// Livraria Lello, Porto (1906), Francisco Xavier Esteves. Narrow ornate
// neo-Gothic facade with pointed arches and a crocketed gable; the crimson
// forked staircase is hinted through the open ground-floor frontwork.
import * as THREE from 'three';
import { Kit, PALETTE, MAT, PROFILES, corniceProfile, archPath, pointedPath } from '../kit.js';
import { onEdge, polyCornice, polyBand, polyWindows, roofOver, plainBuilding } from '../metric.js';
import { edges, obb, offset, bbox } from '../geom.js';
import { win, tablet } from '../parts.js';
import { fitTo } from './site-fit.js';

const rectPts = (cx, cz, w, d) => [
  [cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2],
  [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2],
];

function builder(k, site) {
  const done = fitTo(k, site, { w: 10, d: 16.2, h: 17.5, cx: 0, cz: 0.3 });
  const W = 9;
  const D = 15;
  const H = 13;
  const fz = D / 2;

  // interior shell, glimpsed through the open front
  k.begin('interior');
  k.box(W - 1, H - 1, D - 1, 'dark', 0, 0.5, -0.5);
  k.box(W - 1.4, H - 1.5, 0.3, 'wood', 0, 0.7, fz - 4.6);
  for (const sx of [-1, 1]) k.box(0.3, H - 2, D - 4, 'wood', sx * (W / 2 - 0.7), 0.7, 0);
  // book spines on the shelves, tucked behind the open frontwork
  const BOOK = ['maroon', 'ochre', 'graniteDark', 'terracotta', 'wood', 'gold', 'rose'];
  for (const sx of [-1, 1]) {
    for (let s = 0; s < 4; s++) {
      const wy = 1.5 + s * 2.5;
      for (let i = 0; i < 14; i++) {
        const z = -4.2 + i * 0.78;
        if (z > fz - 2.6) continue;
        k.box(0.16, 1.0 + (i % 3) * 0.14, 0.18, BOOK[(i + s * 2) % BOOK.length], sx * (W / 2 - 1.05), wy, z);
      }
    }
  }
  for (let i = 0; i < 22; i++) k.box(0.14, 1.1 + (i % 4) * 0.1, 0.16, BOOK[i % BOOK.length], -2.8 + i * 0.26, 1.3 + (i % 3) * 1.9, fz - 4.9);
  k.end('interior');

  // crimson forked staircase: two curved flights meeting at a landing
  k.begin('stair');
  for (const s of [-1, 1]) {
    for (let i = 0; i < 11; i++) {
      const t = i / 10;
      const x = s * (0.7 + 1.7 * t);
      const z = fz - 1.4 - 3.2 * t;
      const y = 0.35 + 4.4 * t;
      k.box(2.0, 0.24, 1.05, 'maroon', x, y, z, { ry: s * 0.55 * t });
    }
    k.segment([s * 0.8, 1.0, fz - 1.6], [s * 2.4, 5.4, fz - 4.6], 0.16, 0.16, 'rose', { round: true, seg: 5 });
  }
  k.lathe(PROFILES.column, 8, 'wood', 0, 0.2, fz - 3.2, { sr: 0.28, sh: 6.4, smooth: true });
  k.box(3.0, 0.4, 3.0, 'wood', 0, 5.2, fz - 5.0);
  k.end('stair');

  // ------------------------------------------------------------- front facade
  k.begin('front');
  k.prism(rectPts(0, 0, W, D), 0, H, 'cream');
  k.gableRoof(W, D, 3, 'slate', 0, H, 0, { over: 0.5 });
  // stone ground floor with three pointed openings (open frontwork)
  k.wall(W, 5.6, 0.7, 'granite', [
    { x: -2.5, y: 0, w: 2.6, h: 4.8, arch: 'pointed', pane: 'glass' },
    { x: 0, y: 0, w: 2.4, h: 5.2, arch: 'pointed', pane: null },
    { x: 2.5, y: 0, w: 2.6, h: 4.8, arch: 'pointed', pane: 'glass' },
  ], 0, 0, fz - 0.35);
  for (const hx of [-2.5, 0, 2.5]) k.surround({ x: hx, y: 0, w: hx === 0 ? 2.4 : 2.6, h: hx === 0 ? 5.2 : 4.8, arch: 'pointed' }, 0.28, 0.45, 'graniteLight', fz);
  polyBand(k, rectPts(0, 0, W, D), 5.6, 0.5, 0.25, 'graniteLight');
  // upper storey: three pointed windows with quatrefoil heads
  for (const hx of [-2.4, 0, 2.4]) {
    win(k, hx, 6.8, 1.5, 3.4, fz + 0.05, { arch: 'pointed', pane: 'window', bw: 0.25, depth: 0.3, emit: 0.3 });
    k.surround({ x: hx, y: 6.8, w: 1.5, h: 3.4, arch: 'pointed' }, 0.22, 0.3, 'graniteLight', fz + 0.5);
  }
  // crocketed gable with a central oculus and flanking pinnacles
  k.push({ z: fz });
  const g = new THREE.Shape();
  g.moveTo(-W / 2, 0);
  g.lineTo(W / 2, 0);
  g.lineTo(0, 3.4);
  g.closePath();
  k.extrude(g, 0.7, 'cream', 0, H - 0.6, 0.2, {});
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      k.cone(0.22, 0.4, 4, 'cream', sx * (W / 2) * (1 - t), H - 0.6 + 3.4 * t, 0.55, {});
    }
  }
  k.cyl(0.55, 0.55, 0.4, 12, 'graniteLight', 0, H + 2.0, 0.6, { rx: Math.PI / 2 });
  k.cyl(0.38, 0.38, 0.3, 12, 'window', 0, H + 2.0, 0.75, { rx: Math.PI / 2, emit: 0.4 });
  k.pop();
  k.lathe(PROFILES.finial, 6, 'graniteLight', 0, H + 2.9, fz + 0.2, { sr: 0.35, sh: 1.6, flat: true });
  for (const sx of [-1, 1]) k.pinnacle(2.6, 'graniteLight', sx * (W / 2 - 0.2), H - 0.4, fz + 0.2);
  tablet(k, 3.6, 0.8, 0.25, 'graniteLight', 0, 10.9, fz + 0.55, { lines: 1, face: 'graniteDark' });
  // flank and rear openings
  for (const sx of [-1, 1]) {
    k.push({ x: sx * (W / 2), z: 0, ry: sx > 0 ? Math.PI / 2 : -Math.PI / 2 });
    for (const zz of [-3.5, 0.5, 4.5]) win(k, zz, 6.8, 1.3, 3.0, 0, { arch: 'pointed', pane: 'window', bw: 0.22, depth: 0.28, emit: 0.28 });
    win(k, 0, 1.4, 1.4, 3.0, 0, { arch: 'pointed', pane: 'glass', bw: 0.22, depth: 0.28 });
    k.pop();
  }
  k.push({ z: -fz, ry: Math.PI });
  win(k, 0, 6.6, 2.2, 3.6, 0, { arch: 'pointed', pane: 'window', bw: 0.25, depth: 0.3, emit: 0.25 });
  win(k, 0, 1.2, 2.0, 3.4, 0, { arch: 'pointed', pane: 'dark', bw: 0.25, depth: 0.3 });
  k.pop();
  for (const sx of [-1, 1]) k.box(0.7, 2.2, 0.7, 'graniteDark', sx * 2.4, H + 2.2, -3.0);
  k.end('front');
  done();
}

builder.metric = true;
builder.rule = { note: 'Livraria Lello narrow ~9x15 m facade; crimson staircase glimpsed' };
export default { lello: builder };
