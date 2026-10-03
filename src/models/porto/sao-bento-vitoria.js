// Igreja e Mosteiro de São Bento da Vitória, Porto (Benedictine monastery
// begun at the end of the 16th c. on the old Judiaria do Olival, finished
// c. 1707; church by Diogo Marques Lucas). A tall classical granite church
// with a tower, a large four-square monastery with a cloister courtyard and
// the terrace over the Ribeira. OSM outline 75.80 x 112.67 m, 25 m high.
import { corniceProfile } from '../kit.js';
import { onEdge, polyCornice, polyBand, polyWindows } from '../metric.js';
import { rect, offset, edges } from '../geom.js';
import { win, pediment, bell } from '../parts.js';
import { fitTo } from './site-fit.js';

const W = 75.8;
const D = 112.67;
const H = 25;

function saoBentoVitoria(k, site) {
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  // terraced ground over the hill
  k.prism(rect(0, 0, W - 0.8, D - 0.8), -0.3, 0.35, 'graniteLight');
  k.prism(rect(18, 44, 56, 40), -0.1, 0.2, 'sand');

  // ------------------------------------------------------------------ church
  const cx = -25;
  const cz = -6;
  const wn = 24;
  const dn = 62;
  const nave = rect(cx, cz, wn, dn);
  k.prism(offset(nave, 0.35), 0, 1.4, 'graniteDark');
  k.prism(nave, 0, 19, 'granite');
  polyBand(k, offset(nave, 0.3), 1.3, 0.55, 0.3, 'graniteLight');
  polyCornice(k, nave, 19, corniceProfile('eave', 0.6), 'granite');
  k.push({ x: cx, z: cz });
  k.gableRoof(wn + 0.4, dn + 1.0, 5.4, 'terracotta', 0, 19, 0);
  k.pop();
  polyWindows(k, nave, {
    storeys: [5.0, 9.6, 14.0], bay: 6.6, w: 1.6, h: 3.4,
    win: { trim: 'graniteLight', pane: 'glass', bw: 0.32, depth: 0.42, sill: true, head: 'seg' },
  });

  // monumental west front
  const fz = cz + dn / 2;
  k.wall(wn + 2.4, 21, 1.4, 'granite', [
    { x: 0, y: 0, w: 4.8, h: 8.6, arch: 'round', pane: 'glass', inset: 0.6 },
    { x: 0, y: 12.0, w: 2.4, h: 2.6, arch: 'round', pane: 'glass', inset: 0.45 },
  ], cx, 0, fz - 0.55);
  k.box(wn + 3.0, 1.3, 2.0, 'graniteLight', cx, 0, fz - 0.65);
  k.box(wn + 3.0, 1.2, 2.0, 'graniteLight', cx, 21, fz - 0.65);
  k.surround({ x: 0, y: 0, w: 4.8, h: 8.6, arch: 'round' }, 0.55, 0.7, 'graniteLight', fz + 0.5);
  pediment(k, 12, 3.4, 1.6, 'graniteLight', cx, 22.2, fz - 0.6);
  k.statue(2.6, 'graniteLight', cx, 23.0, fz + 0.5, { pose: 'raise' });

  // tower reaching the 25 m height
  const tx = cx - wn / 2 - 8;
  const tz = fz + 3;
  k.box(7.2, 17, 7.2, 'granite', tx, 0, tz);
  k.box(7.8, 1.2, 7.8, 'graniteDark', tx, 0, tz);
  k.corniceRing(7.2, 7.2, corniceProfile('classic', 0.7), 'graniteLight', tx, 17, tz);
  k.wall(7.2, 4.0, 0.9, 'granite', [
    { x: -1.6, y: 0.8, w: 1.4, h: 2.6, arch: 'round', pane: null },
    { x: 1.6, y: 0.8, w: 1.4, h: 2.6, arch: 'round', pane: null },
  ], tx, 18.2, tz + 3.2);
  k.push({ x: tx, z: tz });
  for (const ry of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
    k.push({ ry });
    k.wall(7.2, 4.0, 0.7, 'granite', [], 0, 18.2, 3.0);
    k.pop();
  }
  bell(k, 1.8, -1.6, 19.0, 3.0);
  bell(k, 1.8, 1.6, 19.0, 3.0);
  k.box(6.6, 0.5, 6.6, 'graniteLight', 0, 22.2, 0);
  k.cone(5.2, 2.2, 4, 'slate', 0, 22.6, 0);
  k.box(0.2, 1.2, 0.2, 'iron', 0, 24.8, 0);
  k.pop();

  // --------------------------------------------------------------- monastery
  const mc = { x: 16, z: 0 };
  const mon = rect(mc.x, mc.z, 46, 86);
  const court = rect(mc.x, mc.z, 28, 54);
  k.prism(offset(mon, 0.3), 0, 1.4, 'graniteDark');
  k.prism(mon, 0, 13, 'granite', { holes: [court] });
  k.prism(court, 0, 0.2, 'sand');
  polyCornice(k, mon, 13, corniceProfile('eave', 0.55), 'graniteLight');
  polyWindows(k, mon, {
    storeys: [2.8, 7.6], bay: 5.4, w: 1.4, h: 2.4,
    win: { trim: 'graniteLight', pane: 'glass', bw: 0.28, depth: 0.34, sill: true },
  });
  // cloister arcade around the courtyard
  for (const e of edges(court)) {
    onEdge(k, e, 0, -0.35);
    k.arcade(e.len - 1.2, 5.2, 0.7, Math.max(3, Math.round((e.len - 1.2) / 4.2)), 2.3, 3.8, 'granite');
    k.box(e.len - 0.6, 0.5, 1.0, 'graniteLight', 0, 5.2, 0.1);
    k.pop();
  }
  // flat lead roof with the courtyard open
  k.prism(mon, 13, 0.55, 'lead', { holes: [court] });
  // corner pavilions
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    k.box(9, 15.5, 9, 'granite', mc.x + sx * 20, 0, mc.z + sz * 40);
    k.push({ x: mc.x + sx * 20, z: mc.z + sz * 40 });
    k.hipRoof(9, 9, 2.8, 'terracotta', 0, 15.5, 0, { over: 0.5 });
    k.pop();
  }

  // ------------------------------------------------ east terrace over the river
  k.prism(rect(16, 54, 46, 14), 0, 1.1, 'graniteWarm');
  k.box(46, 1.6, 0.6, 'granite', 16, 0, 60.6);
  for (let i = 0; i < 6; i++) k.tree(-2 + i * 8, 0, 55, 7 + (i % 3), { kind: 'cypress' });
  // fountain
  k.lathe([[0, 0], [1.0, 0], [0.9, 0.4], [0.7, 0.8], [0.5, 1], [0, 1]], 10, 'granite', 16, 0, 50, { sr: 1.6, sh: 1.4, smooth: true });
  k.cyl(0.25, 0.25, 0.3, 8, 'water', 16, 1.4, 50);

  for (let i = 0; i < 4; i++) k.tree(-36 + i * 9, 0, 34 - i * 2, 8 + (i % 2), { crown: 'round' });
  k.lamp(4.6, -4, 0.4, 30, { globe: true });

  done();
}
saoBentoVitoria.metric = true;
saoBentoVitoria.rule = {
  note: 'Igreja e Mosteiro de São Bento da Vitória: church, tower, four-square cloister monastery and terrace',
  fitTo: true,
  extent: { box: { x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2 } },
};
export default { 'sao-bento-vitoria': saoBentoVitoria };
