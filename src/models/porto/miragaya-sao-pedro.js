// Igreja de São Pedro de Miragaia, Porto. The parish of the old fishing
// quarter on the Douro, dedicated to the fisherman-saint Peter. The present
// church was reformed by bishop Nicolau Monteiro in 1672; in 1740 it was
// partly demolished and rebuilt, keeping the chancel and transept, and its
// walls were clad in azulejo between 1863 and 1876. The granite facade carries
// a scrolled pediment inscribed "Divo Petro Dicata".
import { Kit, PALETTE, MAT, PROFILES, corniceProfile } from '../kit.js';
import { onEdge } from '../metric.js';
import { win, pediment, bellTower } from '../parts.js';
import { edges, offset, bbox, rect } from '../geom.js';
import { fitTo } from './site-fit.js';

function disc(k, r, th, color, x, y, z, o = {}) {
  k.cyl(r, r, th, o.seg ?? 20, color, x, y - th / 2, z, { rx: Math.PI / 2, ...o });
}

function builder(k, site) {
  const done = fitTo(k, site, { w: 18.8, d: 35.3, h: 16, cx: 0, cz: 0 });
  const o = site?.footprint?.outline;
  const b = o && o.length >= 3 ? bbox(o) : { w: 18.8, d: 35.3, cx: 0, cz: 0 };
  const W = Math.max(13, b.w);
  const D = Math.max(22, b.d);
  const cx = b.cx;
  const cz = b.cz;
  const zF = cz + D / 2;
  const zB = cz - D / 2;
  const H = 11.5;
  k.prism(rect(cx, cz, W + 2.2, D + 1.6), 0, 1.0, 'granite');
  // stepped churchyard dropping toward the Douro (+z)
  k.prism(rect(cx, zF + 8, W + 14, 14), -0.1, 0.22, 'graniteWarm');
  k.prism(rect(cx, zF + 15, W + 14, 2.2), -0.1, 0.6, 'graniteDark');

  // ------------------------------------------------------------- nave body
  k.begin('mask');
  k.prism(rect(cx, cz, W, D), 0, H, 'graniteWarm');
  k.prism(offset(rect(cx, cz, W, D), 0.25), 0, 1.8, 'graniteDark');
  k.corniceRing(W, D, corniceProfile('eave', 0.5), 'graniteLight', cx, H - 0.4, cz);
  k.push({ x: cx, z: cz });
  k.gableRoof(W + 0.4, D + 1.0, 4.2, 'terracotta', 0, H, 0, { over: 0.7 });
  k.pop();
  k.end('mask');

  // lower transept arms and the retained chancel at the back
  k.prism(rect(cx, zB + 2.6, W * 0.62, 5.5), 0, 9.6, 'graniteWarm');
  k.corniceRing(W * 0.62, 5.5, corniceProfile('band', 0.38), 'graniteLight', cx, 9.6, zB + 2.6);
  k.push({ x: cx, z: cz });
  k.hipRoof(W * 0.66, 6.0, 2.2, 'terracotta', 0, 9.6, zB - cz + 2.6, { over: 0.4 });
  k.pop();

  // azulejo wall panels (1863-1876) on both long flanks
  const E = edges(rect(cx, cz, W, D));
  for (const e of E) {
    if (Math.abs(e.nx) < 0.9) continue;
    onEdge(k, e, 0, 0.06);
    const n = Math.max(3, Math.round(e.len / 5.5));
    const holes = [];
    for (let i = 0; i < n; i++) holes.push({ x: -e.len / 2 + (e.len / n) * (i + 0.5), y: 1.3, w: 1.45, h: 3.2, arch: 'round', pane: 'glass', inset: 0.32 });
    k.wall(e.len - 1.0, 8.4, 0.42, 'azulejo', holes, 0, 2.0, 0.14);
    k.box(e.len - 0.8, 0.55, 0.65, 'graniteLight', 0, 10.4, 0.2);
    k.box(e.len - 0.8, 0.9, 0.65, 'granite', 0, 1.1, 0.24);
    k.pop();
  }

  // -------------------------------------------------------------- facade
  k.push({ x: cx, z: zF });
  k.wall(W + 1.2, H + 2.4, 1.1, 'graniteWarm',
    [{ x: 0, y: 0, w: 4.2, h: 7.0, arch: 'round', pane: 'dark', inset: 0.6 }], 0, 0, 0.25);
  k.box(W + 1.8, 0.9, 1.6, 'graniteLight', 0, 0, 0.35);
  k.box(W + 1.8, 0.65, 1.6, 'graniteLight', 0, H + 2.4, 0.35);
  k.surround({ x: 0, y: 0, w: 4.2, h: 7.0, arch: 'round' }, 0.4, 0.5, 'graniteLight', 0.8);
  // large barred choir window (the "janelão gradeado") and azimuth
  win(k, 0, 8.6, 2.6, 3.4, 0.75, { trim: 'graniteLight', pane: 'glass', bars: true, bw: 0.3, sill: true });
  for (const s of [-1, 1]) {
    win(k, s * 5.2, 3.4, 1.5, 3.0, 0.7, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.26, sill: true });
    disc(k, 0.78, 0.22, 'graniteLight', s * 5.2, 9.4, 0.75, { seg: 16 });
    disc(k, 0.52, 0.15, 'window', s * 5.2, 9.4, 0.9, { seg: 14, emit: 0.35 });
  }
  // triangular pediment inscribed Divo Petro Dicata, with cross
  pediment(k, W + 1.6, 3.0, 1.0, 'graniteLight', 0, H + 2.4, 0.4, { frame: 0.34 });
  k.statue(1.35, 'graniteLight', 0, H + 3.0, 0.9, { pose: 'hold' });
  k.box(0.14, 2.0, 0.14, 'iron', 0, H + 5.5, 0.9);
  k.box(0.9, 0.14, 0.14, 'iron', 0, H + 6.7, 0.9);
  k.pop();

  // --------------------------------------------- rear bell tower over the transept
  k.begin('height');
  bellTower(k, {
    w: 4.3, hBody: 9.2, hBelfry: 3.2,
    x: cx, z: zB + 3.4,
    body: 'graniteWarm', trim: 'graniteLight', cap: 'pyramid', capH: 2.6,
    openings: 1, windows: 1, clock: false, urns: false, balustrade: false, cross: true,
  });
  k.end('height');
  // riverside churchyard: cruzeiro, lime trees and pediment urns
  k.prism(rect(cx, zF + 6, 3.0, 3.0), 0, 0.4, 'graniteLight');
  k.box(1.1, 0.45, 1.1, 'graniteLight', cx, 0.4, zF + 6);
  k.box(0.4, 3.0, 0.4, 'graniteLight', cx, 0.85, zF + 6);
  k.box(0.9, 0.3, 0.3, 'graniteLight', cx, 3.25, zF + 6);
  k.tree(cx - W * 0.42, 0, zF + 3, 6.5, { crown: 'round' });
  k.tree(cx + W * 0.42, 0, zF + 3, 6, { crown: 'oval' });
  k.tree(cx - W * 0.42, 0, zB + 2, 7, { crown: 'oval' });
  for (const sx of [-1, 1]) k.urn(1.0, 'graniteLight', cx + sx * (W / 2 - 0.7), H - 0.4, zF - 0.7, { seg: 7 });

  // --- detail pass: tiled ridge, azulejo panels and a rear garth
  for (let i = 0; i < 12; i++) {
    const tz = cz - D / 2 + 2 + (i * (D - 4)) / 11;
    k.box(0.5, 0.24, 0.44, 'terracotta', cx, H + 4.15, tz);
  }
  for (const sx of [-1, 1]) {
    k.box(2.4, 3.2, 0.2, 'azulejo', cx + sx * 5.2, 4.6, zF + 0.16, { mat: MAT.azulejo });
    k.box(2.8, 0.3, 0.3, 'graniteLight', cx + sx * 5.2, 4.2, zF + 0.22);
  }
  k.tree(cx, 0, zB + 5.5, 6.5, { crown: 'round' });
  done();
}
builder.metric = true;
builder.rule = {
  note: 'São Pedro de Miragaia: riverside Baroque parish church, azulejo flanks, Divo Petro Dicata pediment',
  fitTo: true,
};
export default { 'miragaya-sao-pedro': builder };
