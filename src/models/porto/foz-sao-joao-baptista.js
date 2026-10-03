// Igreja de São João Baptista da Foz, Porto. The parish church of the Foz do
// Douro, at the mouth of the Douro. Its predecessor, the Igreja Velha, was the
// medieval church of the Benedictine monastery of Santo Tirso and was rebuilt
// from 1527 by bishop D. Miguel da Silva with the architect Francesco de
// Cremona — the first Renaissance work in northern Portugal. Demolished in
// 1646 to make room for the São João Baptista fort, its Renaissance vault
// (the first in the country) became the fortress parade ground. The present
// church is 17th-century, set within the low bastioned ramparts.
import * as THREE from 'three';
import { Kit, PALETTE, MAT, PROFILES, corniceProfile } from '../kit.js';
import { win, pediment } from '../parts.js';
import { edges, offset, bbox, rect } from '../geom.js';
import { fitTo } from './site-fit.js';

function disc(k, r, th, color, x, y, z, o = {}) {
  k.cyl(r, r, th, o.seg ?? 20, color, x, y - th / 2, z, { rx: Math.PI / 2, ...o });
}

// Small gabled bell wall (espadaña) rising above a facade at y0.
function bellGable(k, w, h, color, x, y0, z) {
  k.push({ x, y: y0, z });
  // wall with two arched openings
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, h * 0.62);
  s.lineTo(0, h);
  s.lineTo(-w / 2, h * 0.62);
  s.closePath();
  for (const ox of [-w * 0.24, w * 0.24]) {
    const hole = new THREE.Path();
    const r = w * 0.14;
    hole.moveTo(ox - r, h * 0.2);
    hole.lineTo(ox + r, h * 0.2);
    hole.lineTo(ox + r, h * 0.5 - r);
    hole.absarc(ox, h * 0.5 - r, r, 0, Math.PI, false);
    hole.lineTo(ox - r, h * 0.2);
    s.holes.push(hole);
  }
  k.extrude(s, 0.7, color, 0, 0, 0, { curve: 8 });
  for (const ox of [-w * 0.24, w * 0.24]) k.surround({ x: ox, y: h * 0.2, w: w * 0.28, h: h * 0.3, arch: 'round' }, 0.16, 0.25, 'graniteLight', 0.38);
  k.statue(h * 0.34, 'graniteLight', 0, h * 0.5, 0.5, { pose: 'pray' });
  k.box(0.12, h * 0.4, 0.12, 'iron', 0, h, 0.2);
  k.box(w * 0.24, 0.12, 0.12, 'iron', 0, h + h * 0.3, 0.2);
  k.pop();
}

function builder(k, site) {
  const done = fitTo(k, site, { w: 34.2, d: 54.7, h: 20, cx: 0, cz: 0 });
  const o = site?.footprint?.outline;
  const b = o && o.length >= 3 ? bbox(o) : { w: 34.2, d: 54.7, cx: 0, cz: 0 };
  const W = Math.max(24, b.w);
  const D = Math.max(36, b.d);
  const cx = b.cx;
  const cz = b.cz;
  const zF = cz + D / 2;
  const zB = cz - D / 2;
  // ------------------------------------------------- bastioned rampart ring
  k.prism(rect(cx, cz, W, D), 0, 3.4, 'graniteDark', { holes: [rect(cx, cz, W - 5.0, D - 5.0)] });
  k.prism(offset(rect(cx, cz, W, D), 0.0), 3.4, 0.5, 'granite');
  k.prism(rect(cx, cz, W - 5.0, D - 5.0), -0.05, 0.25, 'graniteWarm');
  // corner bastion toward the sea (+z) and a pointed landward spur
  k.prism([[cx - 3.6, zF], [cx + 3.6, zF], [cx + 4.6, zF + 4.2], [cx, zF + 5.6], [cx - 4.6, zF + 4.2]], 0, 4.4, 'graniteDark');
  k.prism([[cx - 3.0, zB - 3.6], [cx + 3.0, zB - 3.6], [cx, zB - 7.6]], 0, 4.6, 'graniteDark');
  // firing steps and embrasures along the seaward wall
  for (let i = 0; i < 9; i++) k.box(1.4, 0.7, 0.9, 'granite', cx - W / 2 + 2 + i * ((W - 4) / 8), 3.9, zF + 0.2);

  // ------------------------------------------------------------- church body
  k.begin('mask');
  const cw = W * 0.52;
  const cd = D * 0.62;
  const ccz = cz + D * 0.03;
  const H = 13.5;
  k.prism(rect(cx, ccz, cw, cd), 0, H, 'graniteWarm');
  k.prism(offset(rect(cx, ccz, cw, cd), 0.28), 0, 1.8, 'graniteDark');
  k.corniceRing(cw, cd, corniceProfile('eave', 0.55), 'graniteLight', cx, H - 0.4, ccz);
  k.push({ x: cx, z: ccz });
  k.gableRoof(cw + 0.5, cd + 1.0, 4.8, 'terracotta', 0, H, 0, { over: 0.7 });
  k.pop();
  // shallow transept
  k.prism(rect(cx, ccz - 2, cw + 7, 6), 0, 11.5, 'graniteWarm');
  k.corniceRing(cw + 7, 6, corniceProfile('band', 0.42), 'graniteLight', cx, 11.5, ccz - 2);
  k.end('mask');

  // buttresses and round-headed side windows
  const nb = 4;
  for (const s of [-1, 1]) {
    for (let i = 0; i <= nb; i++) {
      const bz = ccz - cd / 2 + 1.4 + ((cd - 2.8) * i) / nb;
      k.box(1.0, H - 1.4, 0.9, 'graniteLight', cx + s * (cw / 2 + 0.3), 0, bz);
    }
    k.push({ x: cx + s * (cw / 2), z: ccz, ry: s > 0 ? Math.PI / 2 : -Math.PI / 2 });
    for (let i = 0; i < nb; i++) {
      const wx = -cd / 2 + 1.4 + ((cd - 2.8) * (i + 0.5)) / nb;
      win(k, wx, 7.4, 1.3, 3.8, 0, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.24, depth: 0.3 });
      win(k, wx, 3.4, 1.0, 2.0, 0, { trim: 'graniteLight', pane: 'glass', bw: 0.2, depth: 0.26 });
    }
    k.pop();
  }

  // ------------------------------------------------------- west front facade
  k.push({ x: cx, z: ccz + cd / 2 });
  k.wall(cw + 1.2, H + 2.2, 1.05, 'graniteWarm',
    [{ x: 0, y: 0, w: 3.8, h: 6.6, arch: 'round', pane: 'dark', inset: 0.55 }], 0, 0, 0.2);
  k.box(cw + 1.8, 0.85, 1.5, 'graniteLight', 0, 0, 0.3);
  k.surround({ x: 0, y: 0, w: 3.8, h: 6.6, arch: 'round' }, 0.4, 0.5, 'graniteLight', 0.72);
  win(k, 0, 8.4, 1.9, 3.0, 0.7, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.28, sill: true });
  for (const s of [-1, 1]) {
    win(k, s * 3.9, 3.2, 1.2, 2.8, 0.65, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.24, sill: true });
  }
  pediment(k, cw + 1.4, 2.8, 0.9, 'graniteLight', 0, H + 2.2, 0.35, { frame: 0.32 });
  disc(k, 1.0, 0.28, 'graniteLight', 0, H + 1.0, 0.9, { seg: 20 });
  disc(k, 0.68, 0.2, 'glass', 0, H + 1.0, 1.05, { seg: 18, emit: 0.25 });
  k.pop();

  // ---------------------------------------------------- gabled bell wall above
  k.begin('height');
  bellGable(k, 4.6, 5.6, 'graniteWarm', cx, H + 4.2, ccz + cd / 2 - 0.4);
  k.end('height');

  // row of small houses clinging inside the rampart (the Foz Velha lanes)
  k.box(6.5, 5.2, 5.0, 'cream', cx - W * 0.32, 0, zB + 5.5);
  k.push({ x: cx - W * 0.32, z: zB + 5.5 });
  k.hipRoof(6.7, 5.2, 2.0, 'terracotta', 0, 5.2, 0, { over: 0.5 });
  k.pop();
  k.box(6.0, 5.6, 5.2, 'white', cx + W * 0.33, 0, zB + 6.0);
  k.push({ x: cx + W * 0.33, z: zB + 6.0 });
  k.hipRoof(6.2, 5.4, 2.1, 'terracotta', 0, 5.6, 0, { over: 0.5 });
  k.pop();
  // crenellated parapet round the rampart ring
  k.crenels(W - 0.6, D - 0.6, 'granite', cx, 3.9, cz, { mw: 2.2, mh: 1.2, t: 0.8, pointed: true });
  // cannons ranged on the seaward rampart
  for (let i = 0; i < 5; i++) {
    const gx = cx - W * 0.28 + i * ((W * 0.56) / 4);
    k.cyl(0.22, 0.3, 2.6, 8, 'iron', gx, 4.3, zF - 1.4, { rx: Math.PI / 2.6 });
    k.box(1.1, 0.5, 0.9, 'wood', gx, 4.3, zF - 2.4);
  }
  // trees inside the fort and the flagpole of the old fortaleza
  k.tree(cx - W * 0.38, 0, zF - 7, 7, { crown: 'round' });
  k.tree(cx + W * 0.4, 0, zF - 9, 6.5, { kind: 'topiary' });
  k.tree(cx - W * 0.42, 0, zB + 3, 8, { crown: 'oval' });
  k.tree(cx + W * 0.43, 0, zB + 2, 7.5, { crown: 'oval' });
  k.cyl(0.08, 0.1, 9, 6, 'white', cx, 4.4, zF + 3.6);
  k.box(1.4, 1.0, 0.05, 'maroon', cx + 0.7, 12.9, zF + 3.6);
  done();
}
builder.metric = true;
builder.rule = {
  note: 'São João Baptista da Foz: 17th-century church inside the 1646 São João Baptista fort ramparts at the Douro mouth',
  fitTo: true,
};
export default { 'foz-sao-joao-baptista': builder };
