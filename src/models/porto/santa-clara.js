// Igreja de Santa Clara, Porto (Gothic church finished 1457, baroque
// gilded interior of the first half of the 18th c.). Buttressed granite
// nave, pointed windows, polygonal apse, baroque portal (1697) and a bell
// gable, with the old convent wing alongside. OSM outline 23.55 x 41.41 m.
import { corniceProfile } from '../kit.js';
import { polyCornice, polyBand, polyWindows } from '../metric.js';
import { rect, offset } from '../geom.js';
import { win, pediment } from '../parts.js';
import { fitTo } from './site-fit.js';

const W = 23.55;
const D = 41.41;
const H = 18;

function santaClara(k, site) {
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  k.prism(rect(0, 0, W - 0.6, D - 0.6), -0.2, 0.25, 'graniteLight');

  // ------------------------------------------------------------------- nave
  const cx = -3;
  const cz = 0;
  const wn = 13;
  const dn = 34;
  const nave = rect(cx, cz, wn, dn);
  k.prism(offset(nave, 0.3), 0, 1.2, 'graniteDark');
  k.prism(nave, 0, 12.5, 'granite');
  polyBand(k, offset(nave, 0.25), 1.1, 0.45, 0.25, 'graniteLight');
  polyCornice(k, nave, 12.5, corniceProfile('eave', 0.5), 'graniteLight');
  k.push({ x: cx, z: cz });
  k.gableRoof(wn + 0.4, dn + 0.8, 4.2, 'terracotta', 0, 12.5, 0);
  k.pop();

  // Gothic buttresses and pointed windows along both flanks
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const bz = cz - dn / 2 + 3 + i * 5;
      k.box(1.3, 9.5, 1.7, 'granite', cx + sx * (wn / 2 + 0.9), 0, bz);
      k.cone(0.85, 1.3, 4, 'graniteDark', cx + sx * (wn / 2 + 0.9), 9.5, bz);
    }
    for (let i = 0; i < 6; i++) {
      const bz = cz - dn / 2 + 5.5 + i * 5;
      k.push({ x: cx + sx * (wn / 2 + 0.05), z: bz, ry: sx > 0 ? Math.PI / 2 : -Math.PI / 2 });
      win(k, 0, 4.4, 1.3, 3.8, 0, { arch: 'pointed', trim: 'graniteLight', pane: 'glass', bw: 0.28, depth: 0.3 });
      k.pop();
    }
  }

  // ------------------------------------------------------------ polygonal apse
  const apse = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    apse.push([cx + Math.cos(a) * 6.2, cz - dn / 2 - 2.4 + Math.sin(a) * 6.2]);
  }
  k.prism(apse, 0, 9.5, 'granite');
  polyCornice(k, apse, 9.5, corniceProfile('band', 0.4), 'graniteLight');
  k.push({ x: cx, z: cz - dn / 2 - 2.4 });
  k.cone(6.6, 3.0, 8, 'slate', 0, 9.5, 0, { smooth: false });
  k.pop();
  for (let i = 0; i < 5; i++) {
    const a = Math.PI * 0.2 + (i / 4) * Math.PI * 0.6;
    k.push({ x: cx + Math.cos(a) * 6.25, z: cz - dn / 2 - 2.4 + Math.sin(a) * 6.25, ry: a });
    win(k, 0, 3.6, 1.1, 3.0, 0, { arch: 'pointed', trim: 'graniteLight', pane: 'glass', bw: 0.24, depth: 0.3 });
    k.pop();
  }

  // ------------------------------------------------------------------ facade
  const fz = cz + dn / 2;
  k.wall(wn + 1.6, 14, 1.15, 'granite', [
    { x: 0, y: 0, w: 3.2, h: 6.8, arch: 'pointed', pane: 'glass', inset: 0.5 },
    { x: 0, y: 9.6, w: 2.0, h: 2.0, arch: 'round', pane: 'glass', inset: 0.4 },
  ], cx, 0, fz - 0.45);
  k.box(wn + 2.2, 1.1, 1.6, 'graniteLight', cx, 0, fz - 0.55);
  k.surround({ x: 0, y: 0, w: 3.2, h: 6.8, arch: 'pointed' }, 0.45, 0.55, 'graniteLight', fz + 0.35);
  // oculus / rose window
  k.cyl(1.6, 1.6, 0.35, 20, 'graniteLight', cx, 11.2, fz + 0.35, { rx: Math.PI / 2 });
  k.cyl(1.25, 1.25, 0.22, 18, 'glass', cx, 11.2, fz + 0.5, { rx: Math.PI / 2, emit: 0.25 });
  for (let i = 0; i < 8; i++) k.box(0.12, 2.6, 0.16, 'graniteLight', cx, 10.1, fz + 0.6, { rz: (i * Math.PI) / 8 });
  // bell gable reaching the 18 m ridge
  k.wall(3.6, 4.6, 0.9, 'granite', [{ x: 0, y: 0.9, w: 1.7, h: 2.7, arch: 'round', pane: null }], cx, 14, fz - 0.1);
  k.box(2.4, 0.55, 1.0, 'graniteLight', cx, 18.4, fz - 0.1);
  k.box(0.16, 1.1, 0.16, 'iron', cx, 18.95, fz);
  k.box(0.7, 0.14, 0.14, 'iron', cx, 19.5, fz);
  k.statue(1.7, 'graniteLight', cx, 12.3, fz + 0.45, { pose: 'pray' });

  // ------------------------------------------------ old convent / cloister wing
  const wing = rect(cx + wn / 2 + 5.5, cz + 1, 8.5, 28);
  k.prism(wing, 0, 7.8, 'plaster');
  k.prism(offset(wing, 0.25), 0, 1.1, 'graniteDark');
  k.box(9.0, 0.9, 0.2, 'azulejo', wing[0][0] + 4.4, 4.0, wing[0][1], { mat: 4 });
  polyCornice(k, wing, 7.8, corniceProfile('band', 0.4), 'graniteLight');
  polyWindows(k, wing, { storeys: [2.8, 5.6], bay: 4.4, w: 1.2, h: 2.1, win: { trim: 'graniteLight', pane: 'glass', bw: 0.24, depth: 0.28 } });
  k.push({ x: wing[0][0], z: wing[0][1] });
  k.hipRoof(8.5, 8.5, 2.5, 'terracotta', 0, 7.8, 0, { over: 0.5 });
  k.pop();

  k.prism(rect(2, 18, 16, 6), -0.06, 0.12, 'sand');
  for (let i = 0; i < 2; i++) k.tree(-8 + i * 4, 0, 18 - i * 2, 6 + i, { crown: 'oval' });
  k.lamp(4.2, 7, 0.35, 16, { globe: true });

  // --- detail pass: Gothic ridge, buttress lanterns and a parvis garden
  for (let i = 0; i < 10; i++) {
    const tz = cz - dn / 2 + 2.2 + (i * (dn - 4.4)) / 9;
    k.box(0.55, 0.26, 0.5, 'terracotta', cx, 16.75, tz);
  }
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const bz = cz - dn / 2 + 3 + i * 5;
      k.sphere(0.2, 'graniteLight', cx + sx * (wn / 2 + 0.9), 11.05, bz, { seg: 6, rings: 4, flat: true });
    }
  }
  for (const gz of [cz + dn / 2 + 0.55, cz - dn / 2 - 5.5]) {
    k.box(0.14, 1.15, 0.14, 'iron', cx, 13.4, gz);
    k.box(0.52, 0.12, 0.12, 'iron', cx, 14.05, gz);
  }
  // parvis garden: clipped hedges, cypresses and a statue on a pedestal
  for (const sx of [-1, 1]) {
    k.box(4.4, 0.65, 0.6, 'hedge', cx + sx * 3.4, 0, fz + 1.8);
    k.tree(cx + sx * 5.2, 0, fz + 2.4, 5.2, { kind: 'cypress' });
  }
  k.box(1.0, 0.8, 1.0, 'graniteLight', cx, 0, fz + 1.4);
  k.statue(1.6, 'graniteLight', cx, 0.8, fz + 1.4, { pose: 'pray' });

  done();
}
santaClara.metric = true;
santaClara.rule = {
  note: 'Igreja de Santa Clara: Gothic granite nave, apse, bell gable and convent wing',
  fitTo: true,
  extent: { box: { x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2 } },
};
export default { 'santa-clara': santaClara };
