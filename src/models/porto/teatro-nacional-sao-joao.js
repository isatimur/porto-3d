// Teatro Nacional São João, Porto (José Marques da Silva, 1918-1920). The
// national theatre on Praça da Batalha: a long monumental block, a giant
// columned front with a high attic and sculptural crest, and the stage house
// behind. Authored 62.2 x 24.5 m, 26 m.
import { corniceProfile } from '../kit.js';
import { win, pediment, cartouche, scrollCrest, flutedColumn } from '../parts.js';
import { rect, offset } from '../geom.js';
import { polyCornice, roofOver, polyWindows } from '../metric.js';
import { fitTo } from './site-fit.js';

function tnsj(k, site) {
  const W = 62.2;
  const D = 24.5;
  const H = 26;
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  const bodyH = 19;
  const fz = D / 2;

  k.prism(rect(0, 0, W, D), 0, bodyH, 'graniteWarm');
  k.prism(offset(rect(0, 0, W, D), 0.3), 0, 1.5, 'graniteDark');
  k.box(W + 0.8, 0.6, 1.4, 'graniteLight', 0, 1.5, fz + 0.4);

  // giant order of eight columns across the front, on a tall base
  const n = 8;
  for (let i = 0; i < n; i++) {
    const u = -W / 2 + (W / n) * (i + 0.5);
    flutedColumn(k, 11.5, 0.55, 'graniteLight', u, 2.4, fz + 0.9);
    k.box(1.7, 0.7, 2.2, 'graniteLight', u, 1.7, fz + 0.9);
  }
  k.box(W - 2, 1.0, 2.2, 'graniteLight', 0, 13.9, fz + 0.7);
  k.box(W - 2, 0.5, 2.6, 'graniteLight', 0, 14.9, fz + 0.7);

  // three portals between the columns
  k.wall(W - 6, 5.6, 1.0, 'graniteWarm', [
    { x: 0, y: 0, w: 4.0, h: 5.2, arch: 'round', pane: 'doorBlue', inset: 0.5 },
    { x: -14, y: 0, w: 3.0, h: 4.8, arch: 'round', pane: 'wood', inset: 0.5 },
    { x: 14, y: 0, w: 3.0, h: 4.8, arch: 'round', pane: 'wood', inset: 0.5 },
  ], 0, 2.0, fz + 0.35);
  for (const sx of [-1, 1]) k.surround({ x: sx * 14, y: 0, w: 3.0, h: 4.8, arch: 'round' }, 0.35, 0.5, 'graniteLight', fz + 0.95);
  k.surround({ x: 0, y: 0, w: 4.0, h: 5.2, arch: 'round' }, 0.4, 0.55, 'graniteLight', fz + 0.95);

  // upper windows and a frieze of relief panels
  for (let i = 0; i < n; i++) {
    const u = -W / 2 + (W / n) * (i + 0.5);
    win(k, u, 8.4, 2.0, 4.6, fz + 0.55, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.32, depth: 0.38 });
    k.box(2.6, 0.5, 0.2, 'graniteLight', u, 7.6, fz + 0.75);
  }
  for (let i = 0; i < 14; i++) k.box(2.4, 2.0, 0.25, 'graniteLight', -W / 2 + (W / 14) * (i + 0.5), 15.6, fz + 0.7);

  polyCornice(k, rect(0, 0, W + 0.4, D + 0.4), bodyH, corniceProfile('classic', 1.1), 'graniteLight');
  // attic block with the crest and the national arms
  k.prism(rect(0, 0, W - 3, D - 2), bodyH + 0.9, 3.2, 'graniteWarm');
  for (let i = 0; i < 13; i++) {
    const u = -W / 2 + (W / 13) * (i + 0.5);
    win(k, u, bodyH + 1.4, 1.4, 2.2, fz - 0.6, { trim: 'graniteLight', pane: 'glass', bw: 0.24, depth: 0.28 });
  }
  k.balustrade(W - 3, 1.4, 'graniteLight', 0, bodyH + 4.1, 0, { cheap: true, d: 0.28, sp: 0.8 });
  pediment(k, 14, 3.6, 1.5, 'graniteLight', 0, bodyH + 4.0, fz - 0.6, { frame: 0.55 });
  cartouche(k, 3.4, 4.2, 0.9, 'graniteLight', 0, bodyH + 5.6, fz + 0.1, { crown: 'granite' });
  scrollCrest(k, 9, 3.0, 0.9, 'graniteLight', 0, bodyH + 8.0, fz - 0.7);
  k.statue(2.2, 'graniteLight', 0, bodyH + 11.0, fz - 0.4, { pose: 'hold' });
  k.box(0.16, 2.6, 0.16, 'iron', 0, bodyH + 13.4, fz - 0.4);

  // flanks: pilasters and two storeys of windows
  for (const sx of [-1, 1]) {
    k.push({ x: sx * W / 2, z: 0, ry: sx * Math.PI / 2 });
    for (let i = 0; i < 5; i++) {
      const u = -D / 2 + (D / 5) * (i + 0.5);
      k.box(0.6, 13.5, 0.6, 'graniteLight', u - D / 10, 2.4, 0);
      win(k, u, 7.6, 1.9, 4.4, 0.05, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.3, depth: 0.36 });
      win(k, u, 2.0, 1.7, 2.6, 0.05, { trim: 'granite', pane: 'glass', bw: 0.26, depth: 0.3 });
    }
    k.pop();
  }
  k.push({ z: -fz, ry: Math.PI });
  for (let i = 0; i < 7; i++) win(k, -W / 2 + (W / 7) * (i + 0.5), 2.0, 1.6, 3.2, 0.1, { trim: 'granite', pane: 'glass', bw: 0.24, depth: 0.3 });
  k.pop();

  // stage house and fly tower at the back, hipped roofs
  k.prism(rect(0, -D / 2 + 7, 36, 15), 0, H, 'graniteWarm');
  k.corniceRing(36, 15, corniceProfile('eave', 0.6), 'graniteLight', 0, H - 0.6, -D / 2 + 7);
  roofOver(k, rect(0, -D / 2 + 7, 36, 15), H, 3.4, 'slate', 'hip', { over: 0.6 });
  for (let i = 0; i < 6; i++) k.box(0.9, 4.8, 0.7, 'dark', -13 + i * 5.2, H - 5.6, -D / 2 + 14.6);
  roofOver(k, rect(0, fz - 6, W - 4, D - 12), bodyH + 4.2, 4.4, 'terracotta', 'hip', { over: 0.7 });

  // entrance forecourt: steps, lamps and bollards
  k.stairs(W - 20, 2.2, 1.0, 4, 'graniteLight', 0, 0, fz + 2.4, { below: 1.0 });
  for (const sx of [-1, 1]) {
    k.lamp(5.4, sx * (W / 2 - 4), 0, fz + 1.6, { globe: true });
    k.box(0.5, 1.1, 0.5, 'graniteLight', sx * 12, 0, fz + 4.0);
  }

  done();
}
tnsj.metric = true;
tnsj.rule = { note: 'Teatro Nacional São João: monumental columned front, attic and stage house', fitTo: true };
export default { 'teatro-nacional-sao-joao': tnsj };
