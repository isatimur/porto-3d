// Universidade do Porto – Reitoria, Praça Gomes Teixeira (early 20th c.).
// A dignified symmetrical civic block: granite plinth, two windowed wings,
// a central columned portico with a triangular pediment, the paved square
// and the two lion statues flanking the steps.
import { Kit, PALETTE, MAT, PROFILES, corniceProfile, archPath } from '../kit.js';
import { onEdge, polyCornice, polyBand, polyWindows, roofOver, plainBuilding } from '../metric.js';
import { win, pediment, flutedColumn, tablet } from '../parts.js';
import { edges, obb, offset, bbox, rect } from '../geom.js';
import { fitTo } from './site-fit.js';

function lion(k, x, z, ry) {
  k.push({ x, y: 0, z, ry });
  // granite pedestal
  k.box(2.6, 1.0, 2.6, 'granite', 0, 0, 0);
  k.box(2.2, 2.0, 2.2, 'granite', 0, 1.0, 0);
  k.box(2.5, 0.3, 2.5, 'granite', 0, 3.0, 0);
  const y = 3.3;
  const c = 'bronze';
  // reclining body and haunches
  k.box(3.0, 0.95, 1.05, c, 0.1, y + 0.75, 0, { mat: MAT.metal });
  k.sphere(0.62, c, -1.15, y + 0.85, 0, { seg: 10, rings: 6, mat: MAT.metal });
  k.sphere(0.5, c, -1.15, y + 1.15, 0, { seg: 10, rings: 6, mat: MAT.metal });
  // chest, neck and head
  k.box(0.9, 1.25, 0.95, c, 1.35, y + 0.7, 0, { mat: MAT.metal });
  k.sphere(0.52, c, 1.75, y + 1.55, 0, { seg: 10, rings: 6, mat: MAT.metal });
  k.box(0.55, 0.45, 0.62, c, 2.15, y + 1.4, 0, { mat: MAT.metal });
  k.box(0.3, 0.55, 0.7, c, 1.72, y + 2.0, 0, { mat: MAT.metal });
  // forelegs, paws and tail
  for (const s of [-1, 1]) {
    k.box(1.5, 0.42, 0.34, c, 1.85, y + 0.35, s * 0.34, { mat: MAT.metal });
    k.box(0.45, 0.3, 0.4, c, 2.65, y + 0.25, s * 0.34, { mat: MAT.metal });
  }
  k.segment([-1.4, y + 0.7, 0.3], [-0.4, y + 1.5, 0.55], 0.16, 0.16, c, { round: true, seg: 5, mat: MAT.metal });
  k.pop();
}

function uportoReitoria(k, site) {
  const done = fitTo(k, site, { w: 130.9, d: 158.1, h: 20.89, cx: 0, cz: 32.9 });
  const o = site?.footprint?.outline;
  const b = o && o.length >= 3 ? bbox(o) : { w: 64, d: 34, cx: 0, cz: 0 };
  const W = Math.max(40, b.w);
  const D = Math.max(22, b.d);
  const H = 15.5;
  const zFront = b.cz + D / 2;

  // paved square
  k.prism(rect(b.cx, zFront + 34, W + 70, 66), -0.2, 0.25, 'sand');
  k.prism(rect(b.cx, zFront + 12, W + 22, 22), -0.1, 0.2, 'graniteLight');

  // building block: granite base, plaster upper
  const bodyP = rect(b.cx, b.cz, W, D);
  k.prism(bodyP, 0, H, 'plaster');
  k.prism(offset(bodyP, 0.25), 0, 3.0, 'granite');
  k.prism(offset(bodyP, 0.18).map(([x, z]) => [x, z]), 3.0, 0.4, 'graniteLight');
  k.corniceRing(W, D, corniceProfile('classic', 0.9), 'granite', b.cx, H - 0.4, b.cz);
  k.prism(offset(bodyP, 0.35), H, 0.6, 'granite');
  k.push({ x: b.cx, z: b.cz });
  k.hipRoof(W + 1.2, D + 1.2, 3.2, 'terracotta', 0, H + 0.6, 0, { over: 0.6 });
  k.pop();

  // window rows on side and rear facades
  polyWindows(k, bodyP, {
    storeys: [1.6, 8.6], bay: 4.4, w: 1.5, h: 3.3, margin: 1.6,
    only: (e) => Math.abs(e.nz) < 0.9,
    win: { trim: 'granite', pane: 'glass', bw: 0.3, depth: 0.3, sill: true, emit: 0.1 },
  });
  // front wing windows (either side of the portico)
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const px = s * (W / 2 - 8 - i * 7);
      win(k, px, 1.6, 1.5, 3.3, zFront + 0.3, { trim: 'granite', pane: 'glass', bw: 0.3, depth: 0.3, sill: true, head: 'flat' });
      win(k, px, 8.6, 1.5, 3.3, zFront + 0.3, { trim: 'granite', pane: 'glass', bw: 0.3, depth: 0.3, sill: true, head: 'flat' });
    }
  }
  // corner quoins
  const q = 1.0;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    k.box(q, H, q, 'granite', b.cx + sx * (W / 2 - q / 2), 0, b.cz + sz * (D / 2 - q / 2));
  }

  // central portico
  const pw = 20;
  k.box(pw, 12.5, 5.0, 'plaster', b.cx, 0, zFront + 2.0);
  k.box(pw + 1.5, 3.0, 5.5, 'granite', b.cx, 0, zFront + 2.0);
  for (const s of [-1, 1]) k.box(1.2, 12.5, 1.6, 'granite', b.cx + s * (pw / 2 - 0.6), 0, zFront + 4.4);
  const colZ = zFront + 4.7;
  for (let i = 0; i < 6; i++) {
    const px = b.cx - pw / 2 + 1.8 + i * (pw - 3.6) / 5;
    flutedColumn(k, 9.5, 0.55, 'graniteLight', px, 3.0, colZ, { flutes: 12, capital: 'ionic' });
  }
  k.box(pw + 1.0, 1.6, 5.6, 'granite', b.cx, 12.5, zFront + 3.2);
  pediment(k, pw + 2.0, 4.2, 5.0, 'granite', b.cx, 14.1, zFront + 2.6, { tympanum: 'plaster', frame: 0.5 });
  tablet(k, 6.5, 1.6, 0.3, 'granite', b.cx, 11.0, zFront + 5.05, { face: 'cream', lines: 2 });
  k.statue(2.4, 'plaster', b.cx, 18.6, zFront + 2.6);

  // broad steps to the square
  k.stairs(21, 5.0, 1.6, 3, 'granite', b.cx, 0, zFront + 5.8);
  k.box(23, 0.5, 0.6, 'granite', b.cx, 0, zFront + 8.4);

  // the two lions on their pedestals
  lion(k, b.cx - 13, zFront + 7.5, 0.25);
  lion(k, b.cx + 13, zFront + 7.5, -0.25);
  k.lamp(5, b.cx - W / 2 - 4, 0, zFront + 12);
  k.lamp(5, b.cx + W / 2 + 4, 0, zFront + 12);
  done();
}
uportoReitoria.metric = true;
uportoReitoria.rule = { note: 'Reitoria da Universidade do Porto: portico, pediment, lions' };

export default { 'uporto-reitoria': uportoReitoria };
