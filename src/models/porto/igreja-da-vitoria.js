// Igreja de Nossa Senhora da Vitória, Porto (1524; rebuilt 18th-19th c.). A
// single-nave church on Rua de São Bento da Vitória with a granite front, a
// bell gable over the portal, an azulejo panel and a polygonal apse. Authored
// 37.2 x 18 m, 20 m.
import { corniceProfile } from '../kit.js';
import { win } from '../parts.js';
import { rect, offset } from '../geom.js';
import { polyCornice, polyBand } from '../metric.js';
import { fitTo } from './site-fit.js';

function vitoria(k, site) {
  const W = 37.2;
  const D = 18;
  const H = 20;
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  const wn = 13;
  const dn = 30;
  const nave = rect(0, -2, wn, dn);
  k.prism(offset(nave, 0.3), 0, 1.1, 'graniteDark');
  k.prism(nave, 0, 13.5, 'granite');
  polyBand(k, nave, 11.4, 0.4, 0.22, 'graniteLight');
  k.push({ z: -2 });
  k.gableRoof(wn + 0.4, dn + 0.8, 4.6, 'terracotta', 0, 13.5, 0);
  k.pop();
  polyCornice(k, nave, 13.5, corniceProfile('eave', 0.5), 'graniteLight');

  // buttresses and round-headed windows along the flanks
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const bz = -2 - dn / 2 + 3 + i * 6;
      k.box(1.0, 9.5, 1.4, 'granite', sx * (wn / 2 + 0.7), 0, bz);
    }
    for (let i = 0; i < 4; i++) {
      const bz = -2 - dn / 2 + 5.5 + i * 6;
      k.push({ x: sx * (wn / 2 + 0.05), z: bz, ry: sx > 0 ? Math.PI / 2 : -Math.PI / 2 });
      win(k, 0, 3.4, 1.3, 4.0, 0, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.3, depth: 0.32 });
      k.pop();
    }
  }

  // polygonal apse
  const apse = [];
  const apz = -2 - dn / 2 - 1.6;
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * 0.5 + (i / 6) * Math.PI;
    apse.push([Math.cos(a) * 5.6, apz + Math.sin(a) * 5.6]);
  }
  k.prism(apse, 0, 10.5, 'granite');
  polyCornice(k, apse, 10.5, corniceProfile('band', 0.4), 'graniteLight');
  k.push({ z: apz });
  k.cone(5.9, 3.4, 7, 'slate', 0, 10.5, 0);
  k.pop();
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI * 0.5 + ((i + 1) / 4) * Math.PI;
    k.push({ x: Math.cos(a) * 5.65, z: apz + Math.sin(a) * 5.65, ry: a + Math.PI / 2 });
    win(k, 0, 3.2, 1.2, 3.2, 0, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.28, depth: 0.3 });
    k.pop();
  }

  // granite front: portal, oculus, niche and a bell gable
  const fz = -2 + dn / 2;
  k.wall(wn + 1.4, 15.5, 1.1, 'granite', [
    { x: 0, y: 0, w: 3.0, h: 6.0, arch: 'round', pane: 'wood', inset: 0.5 },
    { x: 0, y: 10.2, w: 1.9, h: 1.9, arch: 'round', pane: 'glass', inset: 0.4 },
  ], 0, 0, fz - 0.4);
  k.surround({ x: 0, y: 0, w: 3.0, h: 6.0, arch: 'round' }, 0.45, 0.55, 'graniteLight', fz + 0.35);
  k.surround({ x: 0, y: 8.0, w: 1.7, h: 2.6, arch: 'round' }, 0.3, 0.4, 'graniteLight', fz + 0.25);
  k.statue(1.8, 'graniteLight', 0, 8.1, fz + 0.6, { pose: 'pray' });
  k.cyl(1.5, 1.5, 0.3, 18, 'graniteLight', 0, 12.6, fz + 0.3, { rx: Math.PI / 2 });
  k.cyl(1.15, 1.15, 0.2, 16, 'glass', 0, 12.6, fz + 0.45, { rx: Math.PI / 2, emit: 0.25 });
  for (const sx of [-1, 1]) win(k, sx * 4.6, 3.2, 1.6, 3.4, fz + 0.05, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.28, depth: 0.3 });
  // bell gable
  k.wall(3.4, 5.0, 0.9, 'granite', [{ x: 0, y: 1.0, w: 1.7, h: 2.8, arch: 'round', pane: null }], 0, 15.5, fz - 0.1);
  k.box(4.2, 0.6, 1.2, 'graniteLight', 0, 20.5, fz - 0.1);
  k.cornice(4.6, corniceProfile('classic', 0.5), 'graniteLight', 0, 20.9, fz - 0.05);
  k.box(0.16, 1.2, 0.16, 'iron', 0, 21.1, fz);
  k.box(0.8, 0.14, 0.14, 'iron', 0, 21.7, fz);
  k.statue(1.7, 'graniteLight', 0, 20.7, fz + 0.5, { pose: 'hold' });

  // azulejo panel on the south flank
  k.box(8.0, 5.0, 0.12, 'azulejo', wn / 2 + 0.06, 4.5, -2, { mat: 4, ry: Math.PI / 2 });
  k.box(8.4, 0.3, 0.3, 'graniteLight', wn / 2 + 0.1, 9.6, -2, { ry: Math.PI / 2 });
  k.box(8.4, 0.3, 0.3, 'graniteLight', wn / 2 + 0.1, 4.3, -2, { ry: Math.PI / 2 });

  // parvis cross and lamps
  k.prism(rect(0, fz + 4, 10, 6), -0.06, 0.12, 'sand');
  k.box(0.5, 3.4, 0.5, 'graniteLight', 4.5, 0, fz + 3.5);
  k.box(1.4, 0.16, 0.16, 'iron', 4.5, 3.4, fz + 3.5);
  k.box(0.16, 1.4, 0.16, 'iron', 4.5, 2.6, fz + 3.5);
  for (const sx of [-1, 1]) k.lamp(4.4, sx * 5.5, 0, fz + 2.5, { globe: true });
  k.tree(-8, 0, fz + 3, 5.5, { crown: 'oval' });

  // --- detail pass: ridge cresting, buttress finials, urns and the stations
  for (let i = 0; i < 11; i++) {
    const tz = -2 - dn / 2 + 2.5 + (i * (dn - 5)) / 10;
    k.box(0.5, 0.24, 0.5, 'terracotta', 0, 18.05, tz);
  }
  for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) {
    const bz = -2 - dn / 2 + 3 + i * 6;
    k.sphere(0.22, 'graniteLight', sx * (wn / 2 + 0.7), 10.5, bz, { seg: 6, rings: 4, flat: true });
    k.cone(0.32, 0.7, 4, 'graniteLight', sx * (wn / 2 + 0.7), 9.5, bz);
  }
  for (const u of [-5.5, -3.2, 3.2, 5.5]) k.urn(1.0, 'graniteLight', u, 15.5, fz - 0.1);
  // stations of the cross along the south flank
  for (let i = 0; i < 5; i++) {
    const bz = -2 - dn / 2 + 4 + i * 5.4;
    k.box(1.0, 1.3, 0.16, 'graniteLight', wn / 2 + 0.09, 4.6, bz, { ry: Math.PI / 2 });
    k.box(0.7, 1.0, 0.05, 'dark', wn / 2 + 0.16, 4.75, bz, { ry: Math.PI / 2 });
  }
  // two extra windows per flank
  for (const sx of [-1, 1]) {
    k.push({ x: sx * (wn / 2 + 0.05), z: -2 + 3, ry: sx > 0 ? Math.PI / 2 : -Math.PI / 2 });
    win(k, 0, 3.4, 1.3, 4.0, 0, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.3, depth: 0.32 });
    k.pop();
    k.push({ x: sx * (wn / 2 + 0.05), z: -2 - 8, ry: sx > 0 ? Math.PI / 2 : -Math.PI / 2 });
    win(k, 0, 3.4, 1.3, 4.0, 0, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.3, depth: 0.32 });
    k.pop();
  }

  done();
}
vitoria.metric = true;
vitoria.rule = { note: 'Igreja da Vitória: single-nave church with a granite front and bell gable', fitTo: true };
export default { 'igreja-da-vitoria': vitoria };
