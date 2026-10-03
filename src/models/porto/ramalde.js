// Igreja de Ramalde (Igreja de São Salvador de Ramalde), Porto. The parish is
// first recorded as Rianhaldy in the 1258 Inquirições of Afonso III. The
// present church was rebuilt in the 18th century, next to the Casa de Ramalde
// that Nicolau Nasoni remodelled from 1746. It has a single nave with gilded
// woodwork and an interior lined with 18th-century azulejo panels, and a
// gabled bell wall (espadaña) crowning the granite facade.
import { Kit, PALETTE, MAT, PROFILES, corniceProfile } from '../kit.js';
import { win } from '../parts.js';
import { edges, offset, bbox, rect } from '../geom.js';
import { fitTo } from './site-fit.js';
import * as THREE from 'three';

function disc(k, r, th, color, x, y, z, o = {}) {
  k.cyl(r, r, th, o.seg ?? 20, color, x, y - th / 2, z, { rx: Math.PI / 2, ...o });
}

// Gabled bell wall with three arched bell-openings and a cross.
function bellGable(k, w, h, color, x, y0, z) {
  k.push({ x, y: y0, z });
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, h * 0.6);
  s.lineTo(0, h);
  s.lineTo(-w / 2, h * 0.6);
  s.closePath();
  for (const ox of [-w * 0.28, 0, w * 0.28]) {
    const hole = new THREE.Path();
    const r = w * 0.115;
    hole.moveTo(ox - r, h * 0.22);
    hole.lineTo(ox + r, h * 0.22);
    hole.lineTo(ox + r, h * 0.5 - r);
    hole.absarc(ox, h * 0.5 - r, r, 0, Math.PI, false);
    hole.lineTo(ox - r, h * 0.22);
    s.holes.push(hole);
  }
  k.extrude(s, 0.65, color, 0, 0, 0, { curve: 8 });
  for (const ox of [-w * 0.28, 0, w * 0.28]) {
    k.surround({ x: ox, y: h * 0.22, w: w * 0.23, h: h * 0.28, arch: 'round' }, 0.14, 0.22, 'graniteLight', 0.36);
    k.statue(h * 0.26, 'bronze', ox, h * 0.34, 0.42, { pose: 'pray' });
  }
  k.box(0.12, h * 0.36, 0.12, 'iron', 0, h, 0.2);
  k.box(w * 0.22, 0.12, 0.12, 'iron', 0, h + h * 0.26, 0.2);
  k.pop();
}

function builder(k, site) {
  const done = fitTo(k, site, { w: 17.1, d: 32.6, h: 16, cx: 0, cz: 0 });
  const o = site?.footprint?.outline;
  const b = o && o.length >= 3 ? bbox(o) : { w: 17.1, d: 32.6, cx: 0, cz: 0 };
  const W = Math.max(13, b.w);
  const D = Math.max(22, b.d);
  const cx = b.cx;
  const cz = b.cz;
  const zF = cz + D / 2;
  const zB = cz - D / 2;
  const H = 11.5;
  k.prism(rect(cx, cz, W + 2.0, D + 1.6), 0, 1.0, 'granite');
  k.prism(rect(cx, zF + 7, W + 13, 12), -0.1, 0.22, 'graniteLight');

  // ------------------------------------------------------------- nave body
  k.begin('mask');
  k.prism(rect(cx, cz, W, D), 0, H, 'graniteWarm');
  k.prism(offset(rect(cx, cz, W, D), 0.25), 0, 1.8, 'graniteDark');
  k.corniceRing(W, D, corniceProfile('eave', 0.5), 'graniteLight', cx, H - 0.4, cz);
  k.push({ x: cx, z: cz });
  k.gableRoof(W + 0.4, D + 1.0, 4.4, 'terracotta', 0, H, 0, { over: 0.7 });
  k.pop();
  k.end('mask');

  // lower side chapels and the chancel apse
  for (const s of [-1, 1]) {
    k.prism(rect(cx + s * (W / 2 - 1.8), cz - 3, 4.4, 7.5), 0, 8.6, 'graniteWarm');
    k.corniceRing(4.4, 7.5, corniceProfile('band', 0.35), 'graniteLight', cx + s * (W / 2 - 1.8), 8.6, cz - 3);
    k.push({ x: cx + s * (W / 2 - 1.8), z: cz - 3 });
    k.hipRoof(4.6, 7.7, 2.0, 'terracotta', 0, 8.6, 0, { over: 0.4 });
    k.pop();
  }
  k.prism(rect(cx, zB + 2.4, W * 0.62, 5.0), 0, 9.4, 'graniteWarm');
  k.corniceRing(W * 0.62, 5.0, corniceProfile('band', 0.36), 'graniteLight', cx, 9.4, zB + 2.4);
  k.cone(W * 0.31, 2.2, 6, 'slate', cx, 9.4, zB + 2.4, { ry: Math.PI / 6 });

  // round-headed side windows between pilasters
  const E = edges(rect(cx, cz, W, D));
  for (const e of E) {
    if (Math.abs(e.nx) < 0.9) continue;
    const n = Math.max(3, Math.round(e.len / 6));
    for (let i = 0; i < n; i++) {
      const u = -((n - 1) * (e.len / n)) / 2 + i * (e.len / n);
      win(k, e.mx + e.nx * 0.06 + u * e.ex, 3.2, 1.4, 3.0, e.mz + e.nz * 0.06 + u * e.ez,
        { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.25, depth: 0.3, ry: e.ry });
    }
  }

  // -------------------------------------------------------------- facade
  k.push({ x: cx, z: zF });
  k.wall(W + 1.2, H + 2.6, 1.1, 'graniteWarm',
    [{ x: 0, y: 0, w: 3.8, h: 6.8, arch: 'round', pane: 'dark', inset: 0.55 }], 0, 0, 0.22);
  k.box(W + 1.8, 0.9, 1.6, 'graniteLight', 0, 0, 0.32);
  k.box(W + 1.8, 0.65, 1.6, 'graniteLight', 0, H + 2.6, 0.32);
  k.surround({ x: 0, y: 0, w: 3.8, h: 6.8, arch: 'round' }, 0.4, 0.5, 'graniteLight', 0.8);
  // narthex azulejo panel flanking the door (the tiled narthex of the interior)
  for (const s of [-1, 1]) {
    k.wall(2.6, 4.6, 0.35, 'azulejo', [], s * (W / 2 - 2.0), 0.7, 0.7);
    k.box(2.6, 0.4, 0.5, 'graniteLight', s * (W / 2 - 2.0), 5.3, 0.75);
    win(k, s * (W / 2 - 2.0), 6.6, 1.2, 2.4, 0.7, { trim: 'graniteLight', pane: 'glass', bw: 0.22 });
  }
  win(k, 0, 8.4, 1.8, 2.8, 0.7, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.26, sill: true });
  disc(k, 0.95, 0.28, 'graniteLight', 0, H + 1.4, 0.85, { seg: 18 });
  disc(k, 0.64, 0.18, 'glass', 0, H + 1.4, 1.0, { seg: 16, emit: 0.25 });
  k.pop();

  // --------------------------------------------------------- gabled bell wall
  k.begin('height');
  bellGable(k, 4.2, 5.2, 'graniteWarm', cx, H + 3.6, zF - 0.4);
  k.end('height');
  // churchyard: stepped cruzeiro, lime trees and corner urns on the cornice
  k.prism(rect(cx, zF + 6, 3.4, 3.4), 0, 0.4, 'graniteLight');
  k.box(1.2, 0.5, 1.2, 'graniteLight', cx, 0.4, zF + 6);
  k.box(0.42, 3.2, 0.42, 'graniteLight', cx, 0.9, zF + 6);
  k.box(1.0, 0.3, 0.3, 'graniteLight', cx, 3.7, zF + 6);
  k.tree(cx - W * 0.42, 0, zF + 3.5, 7, { crown: 'round' });
  k.tree(cx + W * 0.42, 0, zF + 3.5, 6.5, { crown: 'oval' });
  k.tree(cx - W * 0.42, 0, zB + 2, 7.5, { crown: 'oval' });
  k.tree(cx + W * 0.42, 0, zB + 2, 7, { crown: 'round' });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.urn(1.1, 'graniteLight', cx + sx * (W / 2 - 0.6), H - 0.5, cz + sz * (D / 2 - 0.6), { seg: 7 });

  // --- detail pass: tiled ridge and tiled narthex panels on the lower flanks
  for (let i = 0; i < 12; i++) {
    const tz = cz - D / 2 + 2 + (i * (D - 4)) / 11;
    k.box(0.5, 0.24, 0.44, 'terracotta', cx, H + 4.35, tz);
  }
  for (const s of [-1, 1]) {
    k.push({ x: cx + s * (W / 2 + 0.1), z: cz - 3, ry: s * Math.PI / 2 });
    k.wall(7.0, 2.2, 0.28, 'azulejo', [], 0, 0, 0, { mat: MAT.azulejo });
    k.box(7.2, 0.28, 0.4, 'graniteLight', 0, 2.2, 0.05);
    k.pop();
  }
  k.lamp(4.2, cx, 0, zF + 5.0, { globe: true });
  done();
}
builder.metric = true;
builder.rule = {
  note: 'Ramalde: 18th-century parish church, azulejo-lined interior, gabled bell wall by the Nasoni Casa de Ramalde',
  fitTo: true,
};
export default { ramalde: builder };
