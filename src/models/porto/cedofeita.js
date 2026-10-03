// Igreja de São Martinho de Cedofeita, Porto — the oldest church in the city.
// A low Romanesque granite nave and tower (current temple early 13th c., over
// a Suevic foundation; restored 1935), thick walls, a semicircular apse, a
// round-arched portal with archivolts, small windows and a corbel table.
// OSM outline 11.55 x 25.96 m, 16 m high.
import { corniceProfile, PROFILES } from '../kit.js';
import { polyCornice, polyBand } from '../metric.js';
import { rect, offset } from '../geom.js';
import { win } from '../parts.js';
import { fitTo } from './site-fit.js';

const W = 11.55;
const D = 25.96;
const H = 16;

function cedofeita(k, site) {
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  k.prism(rect(0, 0, W - 0.4, D - 0.4), -0.2, 0.24, 'graniteLight');
  k.prism(rect(-1, 3, 9, 10), -0.05, 0.14, 'sand');

  // ---------------------------------------------------------------- nave + walls
  const cx = -1;
  const cz = 0;
  const wn = 7.5;
  const dn = 16;
  const nave = rect(cx, cz, wn, dn);
  // thick Romanesque walls: a stout plinth and a single mass
  k.prism(offset(nave, 0.45), 0, 1.6, 'graniteDark');
  k.prism(nave, 0, 9.5, 'granite');
  polyBand(k, offset(nave, 0.35), 1.4, 0.5, 0.35, 'granite');
  // corbel table under the eaves (small Romanesque crenellation)
  k.crenels(wn + 0.2, dn + 0.2, 'graniteLight', cx, 9.0, cz, { mw: 0.9, mh: 0.6, t: 0.5 });
  k.push({ x: cx, z: cz });
  k.gableRoof(wn + 0.3, dn + 0.7, 3.2, 'terracotta', 0, 9.6, 0);
  k.pop();
  // small round-arched windows on both flanks
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const bz = cz - 5 + i * 5;
      k.push({ x: cx + sx * (wn / 2 + 0.05), z: bz, ry: sx > 0 ? Math.PI / 2 : -Math.PI / 2 });
      win(k, 0, 4.6, 0.7, 1.6, 0, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.2, depth: 0.24 });
      k.pop();
    }
  }

  // ------------------------------------------------------------ semicircular apse
  const apse = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI;
    apse.push([cx + Math.cos(a) * 4.0, cz - dn / 2 - 1.6 - Math.sin(a) * 3.0]);
  }
  apse.push([cx - 4.0, cz - dn / 2 - 1.6]);
  k.prism(apse, 0, 7.0, 'granite');
  polyCornice(k, apse, 7.0, corniceProfile('band', 0.35), 'graniteLight');
  k.push({ x: cx, z: cz - dn / 2 - 1.6 });
  k.cone(4.3, 2.0, 8, 'terracotta', 0, 7.0, 0, { smooth: false });
  k.pop();
  const az = cz - dn / 2 - 1.6;
  k.push({ x: cx, z: az, ry: Math.PI });
  win(k, 0, 3.6, 0.7, 1.6, -3.6, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.2, depth: 0.24 });
  k.pop();

  // ------------------------------------------------------------------- facade
  const fz = cz + dn / 2;
  k.wall(wn + 1.2, 11, 1.0, 'granite', [
    { x: 0, y: 0, w: 2.4, h: 5.4, arch: 'round', pane: 'glass', inset: 0.5 },
    { x: 0, y: 7.6, w: 1.2, h: 1.2, arch: 'round', pane: 'glass', inset: 0.4 },
  ], cx, 0, fz - 0.4);
  k.box(wn + 1.7, 0.9, 1.4, 'graniteLight', cx, 0, fz - 0.5);
  // Romanesque portal: three stepped archivolts
  for (let i = 0; i < 3; i++) {
    k.surround({ x: 0, y: 0.3 * i, w: 2.4 + i * 0.9, h: 5.4 + i * 0.7, arch: 'round' }, 0.26, 0.42, 'graniteLight', fz + 0.3 + i * 0.3);
  }
  // oculus and gable
  k.cyl(1.0, 1.0, 0.3, 16, 'graniteLight', cx, 9.4, fz + 0.3, { rx: Math.PI / 2 });
  k.cyl(0.75, 0.75, 0.2, 14, 'glass', cx, 9.4, fz + 0.45, { rx: Math.PI / 2, emit: 0.25 });
  const gy = 11.0;
  k.push({ x: cx, z: fz - 0.2 });
  k.gableRoof(wn + 1.0, 1.6, 2.6, 'granite', 0, gy, 0, { over: 0.2, ridge: false });
  k.pop();
  k.box(0.14, 1.1, 0.14, 'iron', cx, gy + 2.4, fz - 0.2);
  k.box(0.6, 0.12, 0.12, 'iron', cx, gy + 2.9, fz - 0.2);

  // -------------------------------------------------------------------- tower
  const tx = cx - wn / 2 - 2.6;
  const tz = 5.0;
  k.box(3.8, 11, 3.8, 'granite', tx, 0, tz);
  k.box(4.2, 1.0, 4.2, 'graniteDark', tx, 0, tz);
  k.corniceRing(3.8, 3.8, corniceProfile('classic', 0.5), 'graniteLight', tx, 11, tz);
  k.push({ x: tx, z: tz });
  win(k, 0, 7.4, 0.8, 1.8, 1.9, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.2, depth: 0.24 });
  k.wall(2.4, 2.4, 0.6, 'granite', [{ x: 0, y: 0.5, w: 1.0, h: 1.6, arch: 'round', pane: null }], 0, 11, 1.9);
  k.cone(2.8, 2.6, 4, 'slate', 0, 13.4, 0);
  k.box(0.16, 1.1, 0.16, 'iron', 0, 15.3, 0);
  k.box(0.6, 0.12, 0.12, 'iron', 0, 15.8, 0);
  k.pop();

  // Romanesque flank buttresses
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const bz = cz - 6 + i * 4;
      k.box(0.9, 7.0, 1.1, 'granite', cx + sx * (wn / 2 + 0.7), 0, bz);
      k.cone(0.6, 0.8, 4, 'graniteDark', cx + sx * (wn / 2 + 0.7), 7.0, bz);
    }
  }

  // west porch (galilé) on the facade
  k.prism(rect(cx, fz + 2.0, 6.2, 4.0), 0, 0.3, 'graniteLight');
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    k.column(4.6, 0.32, 'granite', cx + sx * 2.6, 0.3, fz + 2.0 + sz * 1.4, { smooth: true });
  }
  k.gableRoof(6.6, 4.4, 1.6, 'terracotta', cx, 4.9, fz + 2.0, { over: 0.3 });
  k.box(6.4, 0.5, 4.2, 'graniteLight', cx, 0, fz + 2.0);

  // churchyard wall with a gate and a row of old headstones
  k.box(W - 0.6, 1.8, 0.45, 'granite', 0, 0, -D / 2 + 0.6);
  k.box(0.45, 1.8, D - 1.2, 'granite', -W / 2 + 0.5, 0, 0);
  k.box(0.45, 1.8, D - 1.2, 'granite', W / 2 - 0.5, 0, 0);
  for (const sz of [-1.6, 1.6]) k.box(0.7, 3.0, 0.7, 'graniteLight', 0, 0, fz + 4.6 + sz);
  k.box(0.1, 2.0, 2.6, 'iron', 0, 0, fz + 4.6);
  for (let i = 0; i < 5; i++) {
    const gx = 3.0 - (i % 2) * 0.5;
    const gz = -8 + i * 3.4;
    k.box(1.1, 0.3, 0.7, 'graniteLight', gx, 0, gz);
    k.box(0.5, 1.1, 0.18, 'graniteLight', gx, 0.3, gz - 0.35);
  }

  for (let i = 0; i < 3; i++) k.tree(3.4 - i * 0.4, 0, -6 + i * 7, 6.5 + (i % 2), { crown: 'round' });
  for (let i = 0; i < 3; i++) k.tree(-7.5 + i * 0.6, 0, -8 + i * 9, 7 + (i % 2), { kind: 'cypress' });
  k.lamp(3.8, 3.0, 0.3, 9.5, { globe: true });

  done();
}
cedofeita.metric = true;
cedofeita.rule = {
  note: 'Igreja de Cedofeita: low Romanesque nave, apse, archivolted portal and tower, oldest church in Porto',
  fitTo: true,
  extent: { box: { x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2 } },
};
export default { cedofeita };
