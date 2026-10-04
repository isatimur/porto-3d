// Igreja das Carmelitas, Porto (1619-1622). The Carmelite church beside the
// Carmo, at Largo do Carmo: a single nave with a Baroque granite front, a
// squarer bell tower on the north-west, an azulejo flank and a polygonal apse.
// Authored 37.1 x 19.9 m, 25 m.
import { corniceProfile } from '../kit.js';
import { win, bellTower } from '../parts.js';
import { rect, offset } from '../geom.js';
import { polyCornice, polyBand } from '../metric.js';
import { fitTo } from './site-fit.js';

function carmelitas(k, site) {
  const W = 37.1;
  const D = 19.9;
  const H = 25;
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  const wn = 13.5;
  const dn = 30;
  const nave = rect(-3, -2, wn, dn);
  k.prism(offset(nave, 0.3), 0, 1.2, 'graniteDark');
  k.prism(nave, 0, 14.5, 'graniteWarm');
  polyBand(k, nave, 12.4, 0.4, 0.22, 'graniteLight');
  k.push({ z: -2 });
  k.gableRoof(wn + 0.4, dn + 0.8, 4.4, 'terracotta', 0, 14.5, 0);
  k.pop();
  polyCornice(k, nave, 14.5, corniceProfile('eave', 0.5), 'graniteLight');

  for (const sx of [-1, 1]) {
    for (let i = 0; i < 5; i++) k.box(1.0, 10, 1.5, 'granite', -3 + sx * (wn / 2 + 0.7), 0, -2 - dn / 2 + 3 + i * 6);
    for (let i = 0; i < 4; i++) {
      k.push({ x: -3 + sx * (wn / 2 + 0.05), z: -2 - dn / 2 + 5.5 + i * 6, ry: sx > 0 ? Math.PI / 2 : -Math.PI / 2 });
      win(k, 0, 4.0, 1.3, 4.0, 0, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.3, depth: 0.32 });
      k.pop();
    }
  }

  // polygonal apse
  const apse = [];
  const apz = -2 - dn / 2 - 1.8;
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * 0.5 + (i / 6) * Math.PI;
    apse.push([-3 + Math.cos(a) * 5.8, apz + Math.sin(a) * 5.8]);
  }
  k.prism(apse, 0, 11, 'graniteWarm');
  polyCornice(k, apse, 11, corniceProfile('band', 0.4), 'graniteLight');
  k.push({ x: -3, z: apz });
  k.cone(6.1, 3.4, 7, 'slate', 0, 11, 0);
  k.pop();

  // front with portal, oculus, niches and a pediment
  const fz = -2 + dn / 2;
  k.wall(wn + 2.0, 17.5, 1.2, 'graniteWarm', [
    { x: 0, y: 0, w: 3.2, h: 6.4, arch: 'round', pane: 'wood', inset: 0.5 },
    { x: 0, y: 11.0, w: 2.0, h: 2.0, arch: 'round', pane: 'glass', inset: 0.4 },
  ], -3, 0, fz - 0.45);
  k.surround({ x: 0, y: 0, w: 3.2, h: 6.4, arch: 'round' }, 0.5, 0.6, 'graniteLight', fz + 0.4);
  k.surround({ x: 0, y: 8.6, w: 1.8, h: 2.8, arch: 'round' }, 0.32, 0.42, 'graniteLight', fz + 0.3);
  k.statue(1.9, 'graniteLight', -3, 8.7, fz + 0.65, { pose: 'pray' });
  k.cyl(1.6, 1.6, 0.32, 18, 'graniteLight', -3, 13.4, fz + 0.35, { rx: Math.PI / 2 });
  k.cyl(1.25, 1.25, 0.22, 16, 'glass', -3, 13.4, fz + 0.5, { rx: Math.PI / 2, emit: 0.25 });
  k.box(wn + 2.8, 0.8, 1.6, 'graniteLight', -3, 4.6, fz + 0.5);
  k.cornice(wn + 3.0, corniceProfile('classic', 0.7), 'graniteLight', -3, 17.5, fz + 0.1);
  k.box(6.5, 0.6, 1.2, 'graniteLight', -3, 18.3, fz + 0.4);

  // bell tower on the north-west corner
  bellTower(k, { w: 5.2, hBody: 15, hBelfry: 5, x: -3 - (wn / 2 + 2.6), z: -2 - dn / 2 + 4, body: 'graniteWarm', trim: 'graniteLight', cap: 'pyramid', clock: false });
  k.statue(1.8, 'graniteLight', -3 - (wn / 2 + 2.6), 14.2, fz - 1.2, { pose: 'hold' });

  // azulejo panel on the south flank
  k.box(7.5, 4.6, 0.12, 'azulejo', -3 + wn / 2 + 0.06, 5.0, -2, { mat: 4, ry: Math.PI / 2 });
  k.box(7.9, 0.3, 0.3, 'graniteLight', -3 + wn / 2 + 0.1, 9.7, -2, { ry: Math.PI / 2 });

  // small forecourt
  k.prism(rect(-3, fz + 4, 12, 7), -0.06, 0.12, 'sand');
  for (const sx of [-1, 1]) k.lamp(4.6, -3 + sx * 6, 0, fz + 2.8, { globe: true });
  k.tree(-11, 0, fz + 3, 5.5, { crown: 'oval' });
  k.tree(5, 0, fz + 4, 5, { crown: 'oval' });

  done();
}
carmelitas.metric = true;
carmelitas.rule = { note: 'Igreja das Carmelitas: Baroque nave, granite front and north-west bell tower', fitTo: true };
export default { 'igreja-carmelitas': carmelitas };
