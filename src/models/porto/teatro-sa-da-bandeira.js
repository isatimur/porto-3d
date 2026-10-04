// Teatro Sá da Bandeira, Porto (1859; remodelled as a cinema in the 20th c.).
// A neoclassical auditorium block on Rua Sá da Bandeira: rusticated base, a
// hexastyle pilaster front of tall arched windows, a moulded cornice, an attic
// and the stage house rising behind. Authored 62.7 x 35.2 m, 22 m.
import { corniceProfile } from '../kit.js';
import { win, pediment, cartouche, scrollCrest, flutedColumn } from '../parts.js';
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

  // rusticated ground floor with three entrance arches
  k.prism(rect(0, fz - 6, W, 12), 1.4, 1.0, 'graniteLight');
  k.wall(W, 6.4, 1.1, 'granite', [
    { x: 0, y: 0, w: 3.6, h: 4.6, arch: 'round', pane: 'doorBlue', inset: 0.5 },
    { x: -12, y: 0, w: 2.6, h: 4.2, arch: 'round', pane: 'doorBlue', inset: 0.5 },
    { x: 12, y: 0, w: 2.6, h: 4.2, arch: 'round', pane: 'doorBlue', inset: 0.5 },
  ], 0, 1.4, fz + 0.55);
  for (const sx of [-1, 1]) k.surround({ x: sx * 12, y: 0, w: 2.6, h: 4.2, arch: 'round' }, 0.3, 0.45, 'graniteLight', fz + 1.1);
  k.box(5.6, 0.6, 1.7, 'graniteLight', 0, 6.0, fz + 0.9);

  // upper floor: eight bays of tall arched windows framed by pilasters
  const n = 8;
  for (let i = 0; i < n; i++) {
    const u = -W / 2 + (W / n) * (i + 0.5);
    if (i !== 0 && i !== n - 1) {
      flutedColumn(k, 7.4, 0.42, 'graniteLight', u - (W / n) / 2, 6.4, fz + 0.6, { scale: 0.0001 });
    }
    win(k, u, 7.4, 2.0, 4.2, fz + 0.55, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.3, depth: 0.4, head: i === n / 2 - 1 || i === n / 2 ? 'tri' : null });
  }
  k.box(W + 1.2, 0.7, 1.6, 'graniteLight', 0, 4.0, fz + 0.5);

  // cornice, attic and central crest carrying the theatre's name
  polyCornice(k, rect(0, 0, W + 0.4, D + 0.4), bodyH, corniceProfile('classic', 1.0), 'graniteLight');
  k.prism(rect(0, 0, W - 4, D - 3), bodyH + 0.8, 2.2, 'ochre');
  for (let i = 0; i < 12; i++) {
    const u = -W / 2 + (W / 12) * (i + 0.5);
    k.box(2.2, 1.4, 1.0, 'graniteLight', u, bodyH + 0.9, fz - 1.2);
  }
  k.balustrade(W - 4, 1.3, 'graniteLight', 0, bodyH + 3.0, 0, { cheap: true, d: 0.26, sp: 0.7 });
  pediment(k, 12, 3.2, 1.4, 'graniteLight', 0, bodyH + 3.0, fz - 1.0, { frame: 0.5 });
  cartouche(k, 3.0, 3.6, 0.8, 'graniteLight', 0, bodyH + 4.2, fz - 0.4, { crown: 'granite' });
  scrollCrest(k, 8, 2.6, 0.8, 'graniteLight', 0, bodyH + 6.2, fz - 1.2);
  k.box(0.16, 2.2, 0.16, 'iron', 0, bodyH + 9.2, fz - 1.0);
  k.box(1.0, 0.14, 0.14, 'iron', 0, bodyH + 10.1, fz - 1.0);

  // side elevations: pilasters and windows
  for (const sx of [-1, 1]) {
    k.push({ x: sx * W / 2, z: 0, ry: sx * Math.PI / 2 });
    k.corniceRing(D, 0.5, corniceProfile('band', 0.4), 'graniteLight', 0, bodyH - 1.0, 0);
    for (let i = 0; i < 7; i++) {
      const u = -D / 2 + (D / 7) * (i + 0.5);
      win(k, u, 7.4, 1.8, 3.6, 0, { trim: 'graniteLight', pane: 'glass', bw: 0.28, depth: 0.36 });
    }
    k.pop();
  }
  // back elevation
  k.push({ z: -fz, ry: Math.PI });
  for (let i = 0; i < 7; i++) {
    const u = -W / 2 + (W / 7) * (i + 0.5);
    win(k, u, 2.0, 1.6, 3.0, 0.1, { trim: 'granite', pane: 'glass', bw: 0.26, depth: 0.3 });
  }
  k.pop();

  // stage house / fly tower rising over the rear half
  const stageH = H;
  k.prism(rect(0, -D / 2 + 10, 34, 20), 0, stageH, 'ochre');
  k.prism(offset(rect(0, -D / 2 + 10, 34, 20), 0.3), 0, 0.8, 'graniteDark');
  k.corniceRing(34, 20, corniceProfile('eave', 0.6), 'graniteLight', 0, stageH - 0.6, -D / 2 + 10);
  roofOver(k, rect(0, -D / 2 + 10, 34, 20), stageH, 3.2, 'slate', 'hip', { over: 0.6 });
  for (let i = 0; i < 5; i++) {
    k.box(0.9, 4.5, 0.7, 'dark', -12 + i * 6, stageH - 5.4, -D / 2 + 20.4);
  }
  // hipped roof over the auditorium
  roofOver(k, rect(0, fz - 8, W - 4, D - 16), bodyH + 3.0, 4.0, 'terracotta', 'hip', { over: 0.7 });

  // marquee, lamps and steps
  k.box(9.0, 0.35, 3.0, 'graniteLight', 0, 5.6, fz + 1.8);
  for (const sx of [-1, 1]) k.box(0.5, 5.4, 0.5, 'iron', sx * 4.2, 0.2, fz + 3.0);
  k.stairs(9.0, 1.6, 0.6, 3, 'graniteLight', 0, 0, fz + 2.6, { below: 0.6 });
  for (const sx of [-1, 1]) k.lamp(5.2, sx * 9.5, 0, fz + 1.4, { globe: true });

  done();
}
teatroSa.metric = true;
teatroSa.rule = { note: 'Teatro Sá da Bandeira: neoclassical auditorium block with a stage house', fitTo: true };
export default { 'teatro-sa-da-bandeira': teatroSa };
