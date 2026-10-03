// Igreja de São Nicolau, Porto (rebuilt 1758-1762 after a fire; mixed
// neoclassical/baroque, Frei Manuel de Jesus Maria), on the Ribeira by the
// Rua do Infante D. Henrique. Single nave with a brick vault, rococo gilded
// altarpiece and a bell gable cut by a niche over the patron saint; an 1861
// azulejo front and the 1832 railed adro. OSM outline 18.30 x 37.49 m.
import { corniceProfile } from '../kit.js';
import { polyCornice, polyBand, polyWindows } from '../metric.js';
import { rect, offset } from '../geom.js';
import { win, pediment, segPediment, bell } from '../parts.js';
import { fitTo } from './site-fit.js';

const W = 18.3;
const D = 37.49;
const H = 18;

function saoNicolau(k, site) {
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  k.prism(rect(0, 0, W - 0.5, D - 0.5), -0.2, 0.24, 'graniteLight');

  // ------------------------------------------------------------------- nave
  const cx = -2.5;
  const cz = 0;
  const wn = 10.5;
  const dn = 28;
  const nave = rect(cx, cz, wn, dn);
  k.prism(offset(nave, 0.3), 0, 1.2, 'graniteDark');
  k.prism(nave, 0, 13, 'granite');
  polyBand(k, offset(nave, 0.25), 1.1, 0.45, 0.25, 'graniteLight');
  polyCornice(k, nave, 13, corniceProfile('eave', 0.5), 'graniteLight');
  k.push({ x: cx, z: cz });
  k.gableRoof(wn + 0.4, dn + 0.8, 4.4, 'terracotta', 0, 13, 0);
  k.pop();
  polyWindows(k, nave, {
    storeys: [4.4, 8.4], bay: 5.0, w: 1.4, h: 3.0,
    win: { trim: 'graniteLight', pane: 'glass', bw: 0.28, depth: 0.36, sill: true, head: 'seg' },
  });

  // -------------------------------------------------------------- sacristy
  const sac = rect(cx + wn / 2 + 3.6, cz - 3, 7, 16);
  k.prism(sac, 0, 8, 'granite');
  polyCornice(k, sac, 8, corniceProfile('band', 0.4), 'graniteLight');
  polyWindows(k, sac, { storeys: [3.2, 5.9], bay: 3.8, w: 1.1, h: 2.0, win: { trim: 'graniteLight', pane: 'glass', bw: 0.24, depth: 0.28 } });
  k.push({ x: sac[0][0], z: sac[0][1] });
  k.hipRoof(7.5, 7.5, 2.3, 'terracotta', 0, 8, 0, { over: 0.5 });
  k.pop();

  // ------------------------------------------------------------------ facade
  const fz = cz + dn / 2;
  k.wall(wn + 1.4, 14.4, 1.1, 'granite', [
    { x: 0, y: 0, w: 3.0, h: 6.4, arch: 'round', pane: 'glass', inset: 0.5 },
    { x: 0, y: 9.0, w: 1.9, h: 2.2, arch: 'round', pane: 'glass', inset: 0.4 },
  ], cx, 0, fz - 0.45);
  k.box(wn + 2.0, 1.1, 1.6, 'graniteLight', cx, 0, fz - 0.55);
  // 1861 azulejo panels flanking the portal
  for (const sx of [-1, 1]) {
    k.box(2.6, 4.6, 0.22, 'azulejo', cx + sx * 4.0, 2.6, fz + 0.15, { mat: 4 });
    k.box(2.9, 0.35, 0.3, 'graniteLight', cx + sx * 4.0, 2.2, fz + 0.2);
  }
  // baroque portal: columns, entablature and a split pediment
  k.surround({ x: 0, y: 0, w: 3.0, h: 6.4, arch: 'round' }, 0.5, 0.6, 'graniteLight', fz + 0.4);
  for (const sx of [-1, 1]) k.column(5.4, 0.34, 'graniteLight', cx + sx * 2.1, 0.6, fz + 0.7, { smooth: true });
  k.box(5.4, 0.7, 1.3, 'graniteLight', cx, 6.3, fz + 0.6);
  segPediment(k, 5.8, 1.6, 1.0, 'graniteLight', cx, 7.0, fz + 0.5);
  // bell gable cut by a niche with the patron saint reaches the 18 m ridge
  k.wall(4.4, 5.4, 1.0, 'granite', [{ x: 0, y: 1.1, w: 2.0, h: 3.0, arch: 'round', pane: null }], cx, 12.6, fz - 0.1);
  k.surround({ x: 0, y: 1.1, w: 2.0, h: 3.0, arch: 'round' }, 0.28, 0.35, 'graniteLight', fz + 0.45);
  bell(k, 1.5, cx, 13.9, fz + 0.2);
  k.statue(1.6, 'graniteLight', cx, 15.4, fz + 0.5, { pose: 'raise' });
  k.box(3.0, 0.5, 1.0, 'graniteLight', cx, 17.9, fz - 0.1);
  k.box(0.14, 1.0, 0.14, 'iron', cx, 18.4, fz);
  k.box(0.64, 0.13, 0.13, 'iron', cx, 18.9, fz);

  // ---------------------------------------------------- 1832 railed adro front
  k.prism(rect(cx, fz + 4.5, 11.5, 6.5), -0.05, 0.16, 'sand');
  k.box(11.8, 0.5, 0.5, 'graniteLight', cx, 0, fz + 7.6);
  for (let i = 0; i < 6; i++) {
    const px = cx - 5.5 + i * 2.2;
    k.box(0.35, 2.2, 0.35, 'granite', px, 0, fz + 7.6);
    k.box(0.06, 1.5, 0.06, 'iron', px + 1.1, 0.5, fz + 7.6);
  }
  k.box(12.0, 0.08, 0.08, 'iron', cx, 1.7, fz + 7.6);

  for (let i = 0; i < 2; i++) k.tree(-7.5 + i * 3, 0, 15 - i * 2, 5.5 + i, { crown: 'oval' });
  k.lamp(4.0, 6.0, 0.35, 15, { globe: true });

  done();
}
saoNicolau.metric = true;
saoNicolau.rule = {
  note: 'Igreja de São Nicolau: baroque nave, sacristy, bell gable, azulejo front and railed adro',
  fitTo: true,
  extent: { box: { x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2 } },
};
export default { 'sao-nicolau': saoNicolau };
