// Teatro Sá da Bandeira, Porto (1859; remodelled as a cinema in the 20th c.).
// A neoclassical auditorium block on Rua Sá da Bandeira: rusticated base, a
// hexastyle pilaster front of tall arched windows, a moulded cornice, an attic
// and the stage house rising behind. Authored 62.7 x 35.2 m, 22 m.
import { corniceProfile } from '../kit.js';
import { win, pediment, cartouche, scrollCrest, flutedColumn, tablet } from '../parts.js';
import { rect, offset } from '../geom.js';
import { polyCornice, roofOver } from '../metric.js';
import { fitTo } from './site-fit.js';

function teatroSa(k, site) {
  const W = 62.7;
  const D = 35.2;
  const H = 22;
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  const bodyH = 16.5;
  const fz = D / 2;

  k.prism(rect(0, 0, W, D), 0, bodyH, 'ochre');
  k.prism(offset(rect(0, 0, W, D), 0.25), 0, 1.4, 'graniteDark');

  // rusticated ground floor with three entrance arches and real voussoirs
  k.prism(rect(0, fz - 6, W, 12), 1.4, 1.0, 'graniteLight');
  k.wall(W, 6.4, 1.1, 'granite', [
    { x: 0, y: 0, w: 3.6, h: 4.6, arch: 'round', pane: 'doorBlue', inset: 0.5 },
    { x: -12, y: 0, w: 2.6, h: 4.2, arch: 'round', pane: 'doorBlue', inset: 0.5 },
    { x: 12, y: 0, w: 2.6, h: 4.2, arch: 'round', pane: 'doorBlue', inset: 0.5 },
  ], 0, 1.4, fz + 0.55);
  for (const [ax, aw, ah] of [[0, 3.6, 4.6], [-12, 2.6, 4.2], [12, 2.6, 4.2]]) {
    const r = aw / 2;
    const springY = 1.4 + (ah - r);
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI - (i / 6) * Math.PI;
      k.box(0.58, 0.44, 0.36, 'graniteLight', ax + Math.cos(a) * r, springY + Math.sin(a) * r - 0.22, fz + 1.05, { rz: a - Math.PI / 2 });
    }
    k.box(0.72, 0.95, 0.5, 'graniteLight', ax, springY + r - 0.12, fz + 1.12); // keystone
    k.box(aw + 1.2, 0.4, 0.5, 'graniteLight', ax, 1.2, fz + 1.05); // base
  }
  k.surround({ x: 0, y: 0, w: 3.6, h: 4.6, arch: 'round' }, 0.35, 0.5, 'graniteLight', fz + 1.15);
  for (const sx of [-1, 1]) k.surround({ x: sx * 12, y: 0, w: 2.6, h: 4.2, arch: 'round' }, 0.3, 0.45, 'graniteLight', fz + 1.15);
  // rustication joints and courses across the base
  for (let i = 0; i < 12; i++) k.box(0.15, 5.2, 0.28, 'graniteLight', -W / 2 + (W / 12) * (i + 0.5), 1.4, fz + 1.16);
  for (let i = 1; i < 4; i++) k.box(W + 0.3, 0.16, 0.32, 'graniteLight', 0, 1.4 + i * 1.55, fz + 1.16);

  // upper floor: eight bays of tall arched windows framed by pilasters
  const n = 8;
  for (let i = 0; i < n; i++) {
    const u = -W / 2 + (W / n) * (i + 0.5);
    if (i !== 0 && i !== n - 1) {
      k.box(1.1, 1.0, 0.9, 'graniteLight', u - (W / n) / 2, 5.4, fz + 0.95);
      flutedColumn(k, 7.4, 0.42, 'graniteLight', u - (W / n) / 2, 6.4, fz + 0.6);
      k.box(1.3, 0.7, 0.9, 'graniteLight', u - (W / n) / 2, 13.8, fz + 0.7);
    }
    const head = i % 2 ? 'seg' : 'tri';
    const top = win(k, u, 7.4, 2.0, 4.2, fz + 0.55, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.3, depth: 0.4, head });
    k.balustrade(2.3, 0.8, 'graniteLight', u, 6.5, fz + 0.95, { cheap: true, d: 0.2, sp: 0.38 });
    if (i % 2 === 0) k.cyl(0.62, 0.62, 0.35, 14, 'graniteLight', u, top + 0.5, fz + 0.75, { rx: Math.PI / 2 }); // relief medallion
  }
  k.box(W + 1.2, 0.7, 1.6, 'graniteLight', 0, 4.0, fz + 0.5);

  // cornice with a dentil course, attic and central crest
  for (let i = 0; i < 42; i++) k.box(0.5, 0.4, 0.4, 'graniteLight', -W / 2 + (W / 42) * (i + 0.5), bodyH - 0.55, fz + 1.4);
  polyCornice(k, rect(0, 0, W + 0.4, D + 0.4), bodyH, corniceProfile('classic', 1.0), 'graniteLight');
  k.prism(rect(0, 0, W - 4, D - 3), bodyH + 0.8, 2.2, 'ochre');
  for (let i = 0; i < 12; i++) {
    const u = -W / 2 + (W / 12) * (i + 0.5);
    k.box(2.2, 1.4, 1.0, 'graniteLight', u, bodyH + 0.9, fz - 1.2);
  }
  k.balustrade(W - 4, 1.3, 'graniteLight', 0, bodyH + 3.0, 0, { cheap: true, d: 0.26, sp: 0.7, posts: 8 });
  pediment(k, 12, 3.2, 1.4, 'graniteLight', 0, bodyH + 3.0, fz - 1.0, { frame: 0.5 });
  cartouche(k, 3.0, 3.6, 0.8, 'graniteLight', 0, bodyH + 4.2, fz - 0.4, { crown: 'granite' });
  scrollCrest(k, 8, 2.6, 0.8, 'graniteLight', 0, bodyH + 6.2, fz - 1.2);
  k.box(0.16, 2.2, 0.16, 'iron', 0, bodyH + 9.2, fz - 1.0);
  k.box(1.0, 0.14, 0.14, 'iron', 0, bodyH + 10.1, fz - 1.0);
  for (const u of [-W / 2 + 5, W / 2 - 5]) k.urn(0.95, 'graniteLight', u, bodyH + 3.2, fz - 0.4);

  // side elevations: pilasters, windows and exit doors with lamps
  for (const sx of [-1, 1]) {
    k.push({ x: sx * W / 2, z: 0, ry: sx * Math.PI / 2 });
    k.corniceRing(D, 0.5, corniceProfile('band', 0.4), 'graniteLight', 0, bodyH - 1.0, 0);
    for (let i = 0; i < 7; i++) {
      const u = -D / 2 + (D / 7) * (i + 0.5);
      win(k, u, 7.4, 1.8, 3.6, 0, { trim: 'graniteLight', pane: 'glass', bw: 0.28, depth: 0.36, head: 'flat' });
      k.box(0.55, 13.0, 0.6, 'graniteLight', u - D / 14, 1.4, 0.1);
    }
    k.wall(4.0, 4.6, 0.4, 'granite', [{ x: 0, y: 0, w: 1.8, h: 2.8, arch: 'round', pane: 'wood', inset: 0.3 }], 0, 0, D / 2 - 2);
    k.surround({ x: 0, y: 0, w: 1.8, h: 2.8, arch: 'round' }, 0.28, 0.4, 'graniteLight', D / 2 - 1.7);
    k.lamp(4.6, 0, 0, D / 2 + 0.6, { globe: true });
    k.pop();
  }
  // back elevation
  k.push({ z: -fz, ry: Math.PI });
  for (let i = 0; i < 7; i++) {
    const u = -W / 2 + (W / 7) * (i + 0.5);
    win(k, u, 2.0, 1.6, 3.0, 0.1, { trim: 'granite', pane: 'glass', bw: 0.26, depth: 0.3 });
  }
  k.pop();

  // stage house / fly tower rising over the rear half, with louvres and vanes
  const stageH = H;
  k.prism(rect(0, -D / 2 + 10, 34, 20), 0, stageH, 'ochre');
  k.prism(offset(rect(0, -D / 2 + 10, 34, 20), 0.3), 0, 0.8, 'graniteDark');
  k.corniceRing(34, 20, corniceProfile('eave', 0.6), 'graniteLight', 0, stageH - 0.6, -D / 2 + 10);
  roofOver(k, rect(0, -D / 2 + 10, 34, 20), stageH, 3.2, 'slate', 'hip', { over: 0.6 });
  for (let i = 0; i < 5; i++) k.box(0.9, 4.5, 0.7, 'dark', -12 + i * 6, stageH - 5.4, -D / 2 + 20.4);
  for (let i = 0; i < 5; i++) k.box(0.7, 4.5, 0.9, 'dark', -12 + i * 6, stageH - 5.4, -D / 2 - 0.4);
  k.box(4.2, 0.8, 2.0, 'steel', 0, stageH + 3.0, -D / 2 + 10);
  for (const u of [-14, -7, 7, 14]) k.box(1.0, 1.2, 1.0, 'graniteLight', u, stageH + 3.4, -D / 2 + 10);
  roofOver(k, rect(0, fz - 8, W - 4, D - 16), bodyH + 3.0, 4.0, 'terracotta', 'hip', { over: 0.7 });
  for (const u of [-W / 2 + 12, W / 2 - 12]) {
    k.box(1.4, 2.2, 1.4, 'ochre', u, bodyH + 4.4, 2.0);
    k.box(1.8, 0.4, 1.8, 'graniteLight', u, bodyH + 6.6, 2.0);
    for (const g of [-1, 1]) k.cyl(0.22, 0.22, 0.7, 6, 'terracotta', u + g * 0.4, bodyH + 7.0, 2.0);
  }

  // marquee with the theatre name, bulb lighting, poster cases and steps
  k.push({ x: 0, z: fz + 1.2 });
  k.box(14, 0.5, 0.7, 'graniteLight', 0, 7.6, 0);
  k.box(13, 0.22, 3.4, 'glass', 0, 7.25, 1.6, { emit: 0.05 });
  tablet(k, 8.4, 1.7, 0.5, 'graniteLight', 0, 5.7, 1.1, { lines: 1, ink: 'dark' });
  for (const sx of [-1, 1]) k.box(0.45, 5.0, 0.45, 'iron', sx * 6.2, 0, 2.6);
  for (let i = 0; i < 9; i++) k.sphere(0.13, 'window', -5.2 + i * 1.3, 5.2, 3.1, { seg: 6, rings: 4, emit: 0.6 });
  for (const sx of [-1, 1]) {
    k.box(1.5, 2.6, 0.22, 'doorBlue', sx * 3.6, 0.4, 0.9);
    k.box(1.7, 0.3, 0.3, 'graniteLight', sx * 3.6, 3.0, 0.9);
  }
  k.pop();
  k.stairs(9.0, 1.6, 0.6, 3, 'graniteLight', 0, 0, fz + 2.6, { below: 0.6 });
  for (const sx of [-1, 1]) k.lamp(5.2, sx * 9.5, 0, fz + 1.4, { globe: true });

  done();
}
teatroSa.metric = true;
teatroSa.rule = { note: 'Teatro Sá da Bandeira: neoclassical auditorium block with a stage house', fitTo: true };
export default { 'teatro-sa-da-bandeira': teatroSa };
