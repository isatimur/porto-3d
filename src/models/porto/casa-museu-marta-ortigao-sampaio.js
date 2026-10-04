// Casa-Museu Marta Ortigão Sampaio, Porto (Foz). A two-storey 19th-century
// villa with a hipped roof and a small garden, now a museum and library of the
// Porto museum network. Authored on the mapped house + plot, 14.2 x 9 m, 12 m.
import { corniceProfile } from '../kit.js';
import { win, pediment, cartouche } from '../parts.js';
import { rect, offset } from '../geom.js';
import { polyCornice, polyWindows } from '../metric.js';
import { fitTo } from './site-fit.js';

function marta(k, site) {
  const W = 14.2;
  const D = 9;
  const H = 12;
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  const bodyH = 8.6;
  const fz = D / 2;

  // garden ground and low boundary walls
  k.prism(rect(0, 0, W + 8, D + 8), -0.15, 0.15, 'grass');
  k.prism(rect(0, fz + 3.4, W + 8, 0.5), 0, 1.6, 'graniteDark');
  k.prism(rect(-(W / 2 + 4), 0, 0.5, D + 8), 0, 1.6, 'graniteDark');
  k.prism(rect(W / 2 + 4, 0, 0.5, D + 8), 0, 1.6, 'graniteDark');

  // the villa
  k.prism(offset(rect(0, 0, W, D), 0.35), 0, 1.0, 'graniteDark');
  k.prism(rect(0, 0, W, D), 0, bodyH, 'rose');
  polyCornice(k, rect(0, 0, W, D), bodyH - 0.4, corniceProfile('eave', 0.5), 'plaster');
  k.push({ z: 0 });
  k.hipRoof(W + 0.8, D + 0.8, 3.4, 'terracotta', 0, bodyH, 0, { over: 0.7 });
  k.pop();

  // front: porch, door, pediment and windows
  k.box(4.2, 0.35, 1.7, 'plaster', 0, 4.4, fz + 0.8);
  for (const sx of [-1, 1]) k.box(0.4, 4.4, 0.4, 'graniteLight', sx * 1.9, 0, fz + 1.3);
  pediment(k, 4.6, 1.4, 0.7, 'plaster', 0, 4.75, fz + 0.85, { frame: 0.3 });
  cartouche(k, 1.6, 2.0, 0.6, 'graniteLight', 0, 2.2, fz + 0.6, { crown: 'plaster' });
  k.surround({ x: 0, y: 0, w: 2.0, h: 3.4, arch: 'round' }, 0.28, 0.4, 'graniteLight', fz + 0.6);
  win(k, 0, 0.2, 1.8, 3.0, fz + 0.3, { arch: 'round', trim: 'graniteLight', pane: 'wood', bw: 0.3, depth: 0.35 });
  for (const sx of [-1, 1]) {
    win(k, sx * 4.6, 1.2, 1.5, 2.6, fz + 0.15, { trim: 'plaster', pane: 'glass', bw: 0.26, depth: 0.3, sill: true });
    win(k, sx * 4.6, 5.6, 1.5, 2.4, fz + 0.15, { trim: 'plaster', pane: 'glass', bw: 0.26, depth: 0.3, sill: true });
  }
  win(k, 0, 5.8, 1.7, 2.4, fz + 0.15, { trim: 'plaster', pane: 'glass', bw: 0.26, depth: 0.3, sill: true, head: 'flat' });
  k.box(W - 1, 0.3, 0.35, 'plaster', 0, 4.5, fz + 0.18);

  // flanks and back with matching windows
  const side = (sx) => {
    k.push({ x: sx * W / 2, z: 0, ry: sx * Math.PI / 2 });
    for (const u of [-2.6, 0, 2.6]) for (const yy of [1.2, 5.6]) {
      win(k, u, yy, 1.4, 2.4, 0.05, { trim: 'plaster', pane: 'glass', bw: 0.24, depth: 0.28, sill: true });
    }
    k.pop();
  };
  side(-1); side(1);
  k.push({ z: -fz, ry: Math.PI });
  for (const u of [-3.8, -1.2, 1.2, 3.8]) for (const yy of [1.2, 5.6]) {
    win(k, u, yy, 1.4, 2.4, 0.05, { trim: 'plaster', pane: 'glass', bw: 0.24, depth: 0.28, sill: true });
  }
  k.pop();

  // garden: clipped hedges, a path, trees and a gate
  k.prism(rect(0, fz + 2.6, 2.0, 4.0), 0.02, 0.12, 'sand');
  for (const sx of [-1, 1]) {
    k.box(0.6, 0.7, 6.0, 'hedge', sx * (W / 2 + 2.2), 0, fz + 1.0);
    k.tree(sx * 5.6, 0, fz + 5.0, 6.5, { crown: 'oval' });
  }
  k.tree(-5.5, 0, -fz - 5.0, 7, { crown: 'round' });
  k.tree(5.0, 0, -fz - 4.5, 6, { crown: 'oval' });
  k.box(0.3, 2.0, 2.6, 'iron', 0, 0, fz + 5.6);
  k.lamp(3.4, 3.0, 0, fz + 3.2, { globe: true });
  // museum sign plate
  k.box(2.4, 0.7, 0.12, 'white', 0, 4.8, fz + 1.75);
  k.box(0.18, 2.4, 0.18, 'iron', W / 2 + 3, 0, fz + 4.6);

  // --- detail pass: roof clutter, shutters, garden furniture and beds
  for (let i = 0; i < 11; i++) {
    k.box(0.4, 0.22, 0.4, 'terracotta', -W / 2 + (W / 10) * i, bodyH + 3.3, 0);
  }
  for (const sx of [-1, 1]) {
    k.box(1.0, 2.0, 1.0, 'rose', sx * 3.4, bodyH, -1.6);
    k.box(1.3, 0.3, 1.3, 'graniteLight', sx * 3.4, bodyH + 2.0, -1.6);
    k.box(1.4, 1.0, 1.0, 'rose', sx * 2.0, bodyH + 0.6, 1.8);
    k.push({ x: sx * 2.0, z: 1.8 });
    k.gableRoof(1.4, 1.0, 0.5, 'terracotta', 0, bodyH + 1.6, 0, { over: 0.15, ridge: false });
    k.pop();
  }
  // shutters beside the front and flank windows
  for (const sx of [-1, 1]) for (const yy of [1.2, 5.6]) for (const s of [-1, 1]) {
    k.box(0.28, 2.5, 0.12, 'doorBlue', sx * 4.6 + s * 1.0, yy, fz + 0.2);
  }
  for (const yy of [1.2, 5.6]) for (const s of [-1, 1]) k.box(0.28, 2.5, 0.12, 'doorBlue', s * 1.0, yy, fz + 0.2);
  for (const sx of [-1, 1]) for (const u of [-2.6, 0, 2.6]) for (const yy of [1.2, 5.6]) {
    k.push({ x: sx * (W / 2 + 0.08), z: u, ry: sx * Math.PI / 2 });
    for (const s of [-1, 1]) k.box(0.28, 2.5, 0.12, 'doorBlue', s * 0.95, yy, 0);
    k.pop();
  }
  // garden: pergola, fountain, flower beds and benches
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) k.box(0.22, 2.6, 0.22, 'wood', sx * 4.2, 0, -1 + i * 3.2);
  k.box(8.8, 0.22, 0.22, 'wood', 0, 2.4, -1, { ry: Math.PI / 2 });
  k.box(8.8, 0.22, 0.22, 'wood', 0, 2.4, 5.4, { ry: Math.PI / 2 });
  for (let i = 0; i < 8; i++) k.box(0.16, 0.16, 8.4, 'wood', -4.2 + i * 1.2, 2.6, 2.2, { ry: Math.PI / 2 });
  k.cyl(1.3, 1.5, 0.7, 12, 'graniteLight', -4.5, 0, -fz - 2.5);
  k.cyl(0.3, 0.4, 1.4, 8, 'graniteLight', -4.5, 0.7, -fz - 2.5);
  k.sphere(0.3, 'water', -4.5, 2.1, -fz - 2.5);
  for (const [fx, fzz] of [[3.5, -fz - 2], [3.5, -fz - 5]]) {
    k.box(3.2, 0.4, 1.4, 'graniteLight', fx, 0.1, fzz);
    for (let i = 0; i < 5; i++) k.sphere(0.28, 'flowerRed', fx - 1.4 + i * 0.7, 0.5, fzz, { seg: 6, rings: 4, flat: true });
  }
  for (const bx of [-4.5, 4.5]) {
    k.box(1.6, 0.16, 0.5, 'wood', bx, 0.5, -3.5);
    k.box(0.16, 0.5, 0.16, 'iron', bx - 0.6, 0, -3.5);
    k.box(0.16, 0.5, 0.16, 'iron', bx + 0.6, 0, -3.5);
  }
  k.tree(-5.8, 0, 1.0, 5.5, { crown: 'round' });
  k.tree(5.8, 0, -1.0, 5.0, { crown: 'oval' });

  done();
}
marta.metric = true;
marta.rule = { note: 'Casa-Museu Marta Ortigão Sampaio: two-storey Foz villa with a garden', fitTo: true };
export default { 'casa-museu-marta-ortigao-sampaio': marta };
