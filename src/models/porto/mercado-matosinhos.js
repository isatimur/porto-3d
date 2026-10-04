// Mercado Municipal de Matosinhos (project 1936, opened 1952). A big covered
// market hall: granite arcades on the long sides, a tall tiled roof with a
// glazed clerestory, gabled entrance bays and the stall grid inside. Authored
// 95.2 x 57 m, 15 m.
import { corniceProfile } from '../kit.js';
import { win, pediment, cartouche } from '../parts.js';
import { rect, offset } from '../geom.js';
import { polyCornice, polyWindows } from '../metric.js';
import { fitTo } from './site-fit.js';

function mercado(k, site) {
  const W = 95.2;
  const D = 57;
  const H = 15;
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  const wallH = 6.5;
  const body = rect(0, 0, W, D);
  k.prism(offset(body, 0.4), 0, 1.0, 'graniteDark');
  k.prism(body, 0, wallH, 'cream');

  // cornice and a glazed clerestory band over the walls
  polyCornice(k, body, wallH, corniceProfile('eave', 0.6), 'graniteLight');
  k.prism(body, wallH, 2.6, 'graniteLight', { holes: [rect(0, 0, W - 2, D - 2)] });
  for (const [push, len, n] of [[{}, W, 20], [{ ry: Math.PI }, W, 20], [{ ry: Math.PI / 2 }, D, 12], [{ ry: -Math.PI / 2 }, D, 12]]) {
    k.push(push);
    for (let i = 0; i < n; i++) {
      const u = -len / 2 + (len / n) * (i + 0.5);
      win(k, u, wallH + 0.5, (len / n) * 0.7, 1.8, 0.05, { trim: 'graniteLight', pane: 'glass', bw: 0.2, depth: 0.24 });
    }
    k.pop();
  }

  // granite arcades along both long sides
  for (const sz of [-1, 1]) {
    k.push({ z: sz * (D / 2 - 0.6), ry: sz > 0 ? 0 : Math.PI });
    k.arcade(W - 6, wallH, 1.0, 11, 4.6, 5.4, 'granite');
    for (let i = 0; i < 11; i++) {
      const u = -(W - 6) / 2 + ((W - 6) / 11) * (i + 0.5);
      k.surround({ x: u, y: 0, w: 4.6, h: 5.4, arch: 'round' }, 0.35, 0.5, 'graniteLight', 0.7);
      k.box(5.2, 0.6, 1.4, 'graniteLight', u, wallH - 0.2, 0.6);
    }
    k.pop();
  }

  // gabled entrance bays on the two short ends
  for (const sz of [-1, 1]) {
    k.push({ z: sz * (D / 2 + 0.4), ry: sz > 0 ? 0 : Math.PI });
    k.box(16, wallH + 2.5, 1.4, 'cream', 0, 0, 0);
    k.arcade(16, wallH, 1.2, 3, 3.6, 5.2, 'granite');
    k.corniceRing(16, 1.4, corniceProfile('classic', 0.6), 'graniteLight', 0, wallH + 2.5, 0);
    pediment(k, 15, 3.6, 1.6, 'graniteLight', 0, wallH + 2.5, 0.7, { frame: 0.5 });
    cartouche(k, 2.6, 3.2, 0.7, 'graniteLight', 0, wallH + 3.4, 0.9, { crown: 'granite' });
    // clock
    k.cyl(1.1, 1.1, 0.3, 16, 'graniteLight', 0, wallH + 1.4, 1.0, { rx: Math.PI / 2 });
    k.cyl(0.85, 0.85, 0.2, 16, 'white', 0, wallH + 1.4, 1.2, { rx: Math.PI / 2 });
    k.box(0.1, 0.7, 0.06, 'dark', 0, wallH + 1.45, 1.35);
    k.box(0.5, 0.1, 0.06, 'dark', 0, wallH + 1.4, 1.35);
    k.pop();
  }

  // tall tiled roof with a glazed ridge lantern
  k.push({ z: 0 });
  k.hipRoof(W + 0.8, D + 0.8, 5.6, 'terracotta', 0, wallH + 2.6, 0, { over: 0.9 });
  k.pop();
  k.prism(rect(0, 0, W * 0.7, 4), wallH + 2.6, 2.4, 'steel');
  k.gableRoof(W * 0.72, 4.4, 1.6, 'lead', 0, wallH + 5.0, 0, { over: 0.4, ridge: false });

  // interior stall grid, visible through the arcades
  for (let i = 0; i < 9; i++) for (let j = 0; j < 4; j++) {
    const x = -W / 2 + 7 + i * 10;
    const z = -D / 2 + 10 + j * 11;
    k.box(4.4, 1.0, 2.4, 'wood', x, 0, z);
    k.box(4.6, 0.12, 2.6, 'graniteLight', x, 1.0, z);
    k.box(3.8, 1.4, 0.12, 'white', x, 1.1, z - 1.2);
  }

  // pavement, trees and lamps around the market
  k.prism(rect(0, 0, W + 14, D + 14), -0.1, 0.1, 'sand', { holes: [rect(0, 0, W + 4, D + 4)] });
  for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) {
    k.tree(sx * (W / 2 + 5), 0, -D / 2 + 6 + i * 11, 6, { crown: 'round' });
  }
  for (const sx of [-1, 1]) k.lamp(6.5, sx * (W / 2 + 3), 0, D / 2 + 4, { globe: true });

  done();
}
mercado.metric = true;
mercado.rule = { note: 'Mercado de Matosinhos: arcaded hall, tall tiled roof, gabled entrances', fitTo: true };
export default { 'mercado-matosinhos': mercado };
