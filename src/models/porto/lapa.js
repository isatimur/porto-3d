// Igreja da Lapa, Porto (1756-1863; rococo/neoclassical, Figueiredo Seixas)
// with the Lapa cemetery of the Irmandade and the heart of King Pedro IV.
// Authored 1:1: church with twin towers, sacristy, monastery wing and the
// walled cemetery that fills the OSM site outline (53.14 x 62.86 m).
import { corniceProfile } from '../kit.js';
import { polyCornice, polyBand, polyWindows } from '../metric.js';
import { rect, offset } from '../geom.js';
import { win, segPediment, bellTower } from '../parts.js';
import { fitTo } from './site-fit.js';

const W = 53.14;
const D = 62.86;
const H = 30;

function lapa(k, site) {
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  // paved churchyard and cemetery ground
  k.prism(rect(0, 0, W - 0.6, D - 0.6), -0.25, 0.3, 'graniteLight');
  k.prism(rect(-8, 4, 28, 30), -0.05, 0.14, 'sand');

  // ------------------------------------------------------------------ church
  const cx = -10;
  const cz = -6;
  const wn = 20;
  const dn = 42;
  const nave = rect(cx, cz, wn, dn);
  k.prism(offset(nave, 0.35), 0, 1.3, 'graniteDark');
  k.prism(nave, 0, 15, 'granite');
  polyBand(k, offset(nave, 0.3), 1.2, 0.5, 0.3, 'graniteLight');
  polyCornice(k, nave, 15, corniceProfile('eave', 0.55), 'granite');
  k.push({ x: cx, z: cz });
  k.gableRoof(wn + 0.4, dn + 1.0, 5.0, 'terracotta', 0, 15, 0);
  k.pop();
  polyWindows(k, nave, {
    storeys: [4.4, 8.2], bay: 6.4, w: 1.6, h: 3.2,
    win: { trim: 'graniteLight', pane: 'glass', bw: 0.3, depth: 0.4, sill: true, head: 'seg' },
  });

  // facade + portal
  const fz = cz + dn / 2;
  k.wall(wn + 2, 17, 1.2, 'granite', [
    { x: 0, y: 0, w: 4.4, h: 8.2, arch: 'round', pane: 'glass', inset: 0.5 },
    { x: -7, y: 5.6, w: 1.8, h: 3.2, arch: 'round', pane: 'glass', inset: 0.4 },
    { x: 7, y: 5.6, w: 1.8, h: 3.2, arch: 'round', pane: 'glass', inset: 0.4 },
  ], cx, 0, fz - 0.5);
  k.box(wn + 2.6, 1.1, 1.7, 'graniteLight', cx, 0, fz - 0.6);
  k.box(wn + 2.6, 1.0, 1.7, 'graniteLight', cx, 17, fz - 0.6);
  k.surround({ x: 0, y: 0, w: 4.4, h: 8.2, arch: 'round' }, 0.5, 0.6, 'graniteLight', fz + 0.4);
  segPediment(k, 8.4, 3.2, 1.2, 'graniteLight', cx, 17.4, fz - 0.5);
  k.statue(2.2, 'plaster', cx, 18.2, fz + 0.3, { pose: 'hold' });
  // twin bell towers, the tallest element (~28 m)
  for (const s of [-1, 1]) {
    bellTower(k, {
      w: 6.0, hBody: 12.5, hBelfry: 4.0, x: cx + s * (wn / 2 + 4.2), z: fz + 0.6,
      body: 'granite', trim: 'graniteLight', cap: 'bell', capH: 3.2,
      openings: 1, windows: 2, winArch: 'round', clock: true, urns: true,
      balustrade: false, cross: true,
    });
  }

  // --------------------------------------------------------------- sacristy
  const sac = rect(cx - wn / 2 - 4.5, cz, 8, 17);
  k.prism(sac, 0, 10, 'granite');
  polyCornice(k, sac, 10, corniceProfile('eave', 0.45), 'graniteLight');
  polyWindows(k, sac, { storeys: [3.4, 6.6], bay: 4.2, w: 1.3, h: 2.2, win: { trim: 'graniteLight', pane: 'glass', bw: 0.26, depth: 0.3 } });
  k.push({ x: sac[0][0], z: sac[0][1] });
  k.hipRoof(9.5, 8, 2.4, 'terracotta', 0, 10, 0, { over: 0.5 });
  k.pop();

  // ------------------------------------------------- monastery / college wing
  const wing = rect(cx + wn / 2 + 9, cz - 4, 12, 22);
  k.prism(wing, 0, 8.5, 'granite');
  k.prism(offset(wing, 0.25), 0, 1.1, 'graniteDark');
  polyCornice(k, wing, 8.5, corniceProfile('band', 0.4), 'graniteLight');
  polyWindows(k, wing, { storeys: [3.0, 6.0], bay: 4.4, w: 1.2, h: 2.0, win: { trim: 'graniteLight', pane: 'glass', bw: 0.24, depth: 0.28 } });
  k.push({ x: wing[0][0], z: wing[0][1] });
  k.hipRoof(12, 12, 2.6, 'terracotta', 0, 8.5, 0, { over: 0.5 });
  k.pop();

  // ---------------------------------------------------------------- cemetery
  const x0 = 8;
  const x1 = 25.4;
  const z0 = -28;
  const z1 = 28;
  const ww = x1 - x0;
  const wd = z1 - z0;
  k.box(ww, 2.6, 0.55, 'granite', (x0 + x1) / 2, 0, z0);
  k.box(ww, 2.6, 0.55, 'granite', (x0 + x1) / 2, 0, z1);
  k.box(0.55, 2.6, wd, 'granite', x0, 0, (z0 + z1) / 2);
  k.box(0.55, 2.6, wd, 'granite', x1, 0, (z0 + z1) / 2);
  // gate piers and iron gate on the church side
  for (const sz of [-2.2, 2.2]) k.box(0.8, 4.0, 0.8, 'graniteLight', x0 + 0.3, 0, sz);
  k.box(0.12, 2.6, 4.2, 'iron', x0 + 0.3, 0, 0);
  // rows of graves with headstones
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 5; c++) {
      const gx = x0 + 2.2 + c * 3.1;
      const gz = z0 + 3.4 + r * 7.0;
      k.box(1.5, 0.32, 0.95, 'graniteLight', gx, 0, gz);
      k.box(0.62, 1.35, 0.2, 'graniteLight', gx, 0.32, gz - 0.5);
    }
  }
  // a central memorial chapel and cypress avenue
  const chap = rect((x0 + x1) / 2, 0, 5.5, 6.5);
  k.prism(chap, 0, 5.2, 'granite');
  polyCornice(k, chap, 5.2, corniceProfile('band', 0.35), 'graniteLight');
  k.wall(3.0, 3.2, 0.5, 'granite', [{ x: 0, y: 0, w: 1.6, h: 2.4, arch: 'round', pane: 'dark', inset: 0.25 }], chap[0][0], 0, chap[0][1] + 3.2);
  k.push({ x: chap[0][0], z: chap[0][1] });
  k.cone(4.4, 2.6, 4, 'slate', 0, 5.2, 0);
  k.pop();
  for (let i = 0; i < 7; i++) k.tree(x0 + 1.6, 0, z0 + 4 + i * 8, 7 + (i % 2) * 1.5, { kind: 'cypress' });
  for (let i = 0; i < 4; i++) k.tree(x1 - 1.6, 0, z0 + 7 + i * 14, 6.5 + (i % 3), { kind: 'cypress' });

  // a few trees and a lamp in the front court
  for (let i = 0; i < 3; i++) k.tree(-20 + i * 7, 0, 24 - i * 1.5, 7.5 + i, { crown: 'round' });
  k.lamp(4.4, -4, 0.4, 24, { globe: true });

  // --- detail: more graves, a memorial cross and cemetery gate arms
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const gx = x0 + 3.4 + c * 3.6;
      const gz = z0 + 4 + r * 3.2;
      k.box(0.9, 1.5, 0.3, 'graniteLight', gx, 0, gz);
      k.cyl(0.22, 0.26, 1.2, 8, 'graniteLight', gx, 1.5, gz);
    }
  }
  k.box(0.5, 3.8, 0.5, 'graniteLight', x0 + 1.0, 0, 0);
  k.box(1.8, 0.5, 0.18, 'graniteLight', x0 + 1.0, 3.4, 0);
  k.box(3.0, 1.4, 0.4, 'graniteLight', x0 + 1.6, 0, -1.2);
  k.box(3.0, 1.4, 0.4, 'graniteLight', x0 + 1.6, 0, 1.2);

  done();
}
lapa.metric = true;
lapa.rule = {
  note: 'Igreja da Lapa + twin towers + walled Lapa cemetery on the OSM site outline',
  fitTo: true,
  extent: { box: { x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2 } },
};
export default { lapa };
