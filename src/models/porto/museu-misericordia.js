// Museu e Igreja da Misericórdia do Porto (Rua das Flores): the Baroque
// church rebuilt by Niccolò Nasoni, wrapped by the museum wing of the Santa
// Casa, with a cloister courtyard and the celebrated silver collection hall.
// Authored metric on the real OSM relation outline.
import { corniceProfile } from '../kit.js';
import { plainBuilding, polyWindows } from '../metric.js';
import { win, pediment } from '../parts.js';
import { bbox, rect, offset } from '../geom.js';
import { fitTo } from './site-fit.js';

function builder(k, site) {
  const o = site?.footprint?.outline;
  const b = o && o.length >= 3 ? bbox(o) : { w: 65.2, d: 41.1, cx: 0, cz: 0 };
  const W = Math.max(24, b.w);
  const D = Math.max(18, b.d);
  const H = 18;
  const done = fitTo(k, site, { w: b.w || 65.2, d: b.d || 41.1, h: H, cx: b.cx, cz: b.cz });

  // paved churchyard and cloister floor
  k.prism(rect(b.cx, b.cz, W, D), -0.2, 0.2, 'graniteLight');

  // ---- museum wing (three storeys) along the street side
  const mw = W * 0.5;
  const md = D * 0.5;
  const mx = b.cx - W * 0.24;
  const mz = b.cz;
  plainBuilding(k, rect(mx, mz, mw, md), 15, {
    wall: 'plaster', trim: 'granite', bay: 3.6, windows: true,
    rise: 2.6, roofColor: 'terracotta', roofKind: 'hip',
  });
  k.prism(offset(rect(mx, mz, mw, md), 0.2), 0, 1.5, 'granite');
  // silver-collection hall: a slightly taller flat-roofed block with a clerestory
  const sx = mx;
  const sz = mz - md * 0.5 - 5;
  k.prism(rect(sx, sz, mw * 0.7, 10), 0, 17, 'white');
  k.prism(offset(rect(sx, sz, mw * 0.7, 10), 0.3), 17, 0.5, 'graniteLight');
  for (let i = 0; i < 7; i++) {
    k.box(1.6, 1.2, 0.3, 'window', sx - mw * 0.28 + (mw * 0.56 * i) / 6, 15.6, sz + 5.1, { emit: 0.6 });
  }

  // ---- church of the Misericórdia on the east
  const cw = Math.min(20, W * 0.36);
  const cd = D * 0.86;
  const cx = b.cx + W * 0.24;
  const cz = b.cz;
  plainBuilding(k, rect(cx, cz, cw, cd), 13, {
    wall: 'graniteWarm', trim: 'granite', bay: 4.0, windows: false,
    rise: 3.6, roofColor: 'terracotta', roofKind: 'gable',
  });
  k.prism(offset(rect(cx, cz, cw, cd), 0.25), 0, 1.6, 'granite');

  // Nasoni facade on the +x end: portal, oculus, pediment, statues and cross
  k.push({ x: cx + cw / 2 + 0.05, z: cz, ry: Math.PI / 2 });
  k.wall(cd, 15.5, 1.1, 'graniteWarm', [], 0, 0, 0);
  k.surround({ x: 0, y: 0, w: 3.4, h: 5.4, arch: 'round' }, 0.5, 0.6, 'granite', 0, 0, 0.55);
  k.box(2.8, 4.8, 0.2, 'doorBlue', 0, 0.1, 0.62);
  for (const s of [-1, 1]) win(k, s * 4.4, 1.2, 1.8, 4.6, 0.5, { trim: 'granite', pane: 'glass', arch: 'round', bw: 0.3, sill: true });
  k.cyl(1.05, 1.05, 0.4, 16, 'granite', 0, 8.6, 0.5, { rx: Math.PI / 2 });
  pediment(k, 12, 2.6, 0.8, 'granite', 0, 11.4, 0.45, { frame: 0.3 });
  for (const s of [-1, 1]) k.statue(1.9, 'plaster', s * 4.6, 12.4, 0.6, { pose: 'pray' });
  k.box(0.16, 2.0, 0.16, 'iron', 0, 14.3, 0.5);
  k.box(1.0, 0.16, 0.16, 'iron', 0, 15.1, 0.5);
  k.pop();

  // ---- cloister courtyard: an arcade on the inner faces of both wings
  const gx = b.cx + 2;
  const gz = b.cz + D * 0.22;
  k.prism(rect(gx, gz, W * 0.34, D * 0.4), -0.05, 0.15, 'grass');
  for (let i = 0; i < 6; i++) {
    k.column(5.4, 0.34, 'graniteLight', gx - W * 0.16 + (W * 0.32 * i) / 5, 0, gz - D * 0.19, { smooth: true });
  }
  k.box(W * 0.36, 0.8, 1.2, 'graniteLight', gx, 5.4, gz - D * 0.19);
  k.cyl(2.2, 2.6, 0.8, 16, 'granite', gx, 0, gz + 1.5);
  k.cyl(0.4, 0.6, 2.0, 10, 'granite', gx, 0.8, gz + 1.5);
  for (let i = 0; i < 5; i++) k.tree(gx + W * 0.1, 0, gz + D * 0.28 - i * 4, 6 + (i % 2) * 2, { crown: i % 2 ? 'oval' : 'round' });

  // a low boundary wall with coping round the whole block
  k.corniceRing(W, D, corniceProfile('band', 0.35), 'graniteDark', b.cx, 1.4, b.cz);
  done();
}
builder.metric = true;
builder.rule = {
  note: 'Museu e Igreja da Misericórdia: Nasoni church flanked by the Santa Casa museum wing, cloister courtyard and silver hall',
  extent: [/./],
  fitTo: true,
};

export default { 'museu-misericordia': builder };
