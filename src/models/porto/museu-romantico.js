// Museu Romântico da Quinta da Macieirinha (Porto): a long two-storey 19th-
// century villa, cream render over granite, hipped terracotta roof, a small
// pedimented portico. Home of the Romantic Museum; King Charles Albert died
// here in exile in 1849. Authored 1:1 in metres on its OSM footprint.
import { corniceProfile } from '../kit.js';
import { win, segPediment } from '../parts.js';
import { rect } from '../geom.js';
import { fitTo } from './site-fit.js';

function museuRomantico(k, site) {
  const W = 19.1;
  const D = 45.9;
  const H = 12;
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  // granite plinth and a paved forecourt in front of the villa
  k.box(W + 1.8, 1.0, D + 1.8, 'granite', 0, 0, 0);
  k.prism(rect(0, D / 2 + 7.5, W + 17, 13), -0.15, 0.22, 'graniteLight');

  // main body: two rendered storeys
  const bodyH = 8.3;
  k.prism(rect(0, 0, W, D), 0, bodyH, 'cream');
  k.corniceRing(W, D, corniceProfile('eave', 0.5), 'granite', 0, bodyH - 0.35, 0);
  // granite quoins at the four corners and a string course
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(1.1, bodyH, 1.1, 'granite', sx * (W / 2 - 0.35), 0, sz * (D / 2 - 0.35));
  k.corniceRing(W + 0.2, D + 0.2, corniceProfile('band', 0.32), 'granite', 0, 4.1, 0);
  // hipped terracotta roof with three granite chimneys
  k.hipRoof(W, D, 4.2, 'terracotta', 0, bodyH, 0, { over: 0.7 });
  for (const zz of [-D * 0.3, D * 0.08, D * 0.3]) k.box(1.5, 2.6, 1.1, 'granite', W * 0.22, bodyH + 0.9, zz);

  // ---- front (+z): central pedimented portico and flanking windows
  const zF = D / 2;
  k.box(W * 0.36, 5.4, 1.5, 'graniteLight', 0, 0, zF + 0.65);
  k.box(W * 0.42, 0.6, 2.2, 'granite', 0, 5.4, zF + 0.75);
  segPediment(k, W * 0.44, 2.2, 0.85, 'granite', 0, 6.0, zF + 0.55);
  win(k, 0, 1.1, 2.6, 3.9, zF + 1.4, { trim: 'granite', pane: 'wood', bw: 0.35, depth: 0.4 });
  for (const sx of [-1, 1]) for (const yy of [1.5, 5.3]) {
    win(k, sx * 6.6, yy, 1.6, 2.4, zF + 0.2, { trim: 'granite', pane: 'glass', bw: 0.26, depth: 0.36, sill: true });
  }
  // two lamps flanking the entrance
  k.lamp(3.2, -(W * 0.3), 0, zF + 1.4);
  k.lamp(3.2, W * 0.3, 0, zF + 1.4);

  // ---- long flanks: two storeys of windows on each side
  const flank = (sx) => {
    k.push({ x: sx * W / 2, z: 0, ry: sx * Math.PI / 2 });
    const n = 10;
    for (let i = 0; i < n; i++) {
      const u = -D / 2 + 2.6 + i * ((D - 5.2) / (n - 1));
      for (const yy of [1.6, 5.4]) {
        win(k, u, yy, 1.5, 2.3, 0, { trim: 'granite', pane: 'glass', bw: 0.25, depth: 0.35, sill: true });
      }
    }
    k.pop();
  };
  flank(-1);
  flank(1);

  // ---- back (-z)
  k.push({ z: -D / 2, ry: Math.PI });
  for (const sx of [-1, 1]) for (const yy of [1.6, 5.4]) {
    win(k, sx * 5.2, yy, 1.6, 2.4, 0, { trim: 'granite', pane: 'glass', bw: 0.26, depth: 0.35, sill: true });
  }
  k.pop();

  // ---- garden: clipped hedge parterre and a few trees along the forecourt
  k.prism(rect(0, D / 2 + 13.5, W + 16, 1.4), 0, 0.9, 'hedge');
  k.balustrade(W + 16, 1.1, 'graniteLight', 0, 0.15, D / 2 + 14.6, { cheap: true, d: 0.24, sp: 0.6, posts: 8 });
  for (const tx of [-W / 2 - 5, W / 2 + 5]) {
    k.tree(tx, 0, D / 2 + 5, 7.5, { crown: 'oval' });
    k.tree(tx, 0, -D / 2 - 4, 7, { crown: 'round' });
  }
  // roof dormers over the front slope
  for (const xx of [-W * 0.3, -W * 0.1, W * 0.1, W * 0.3]) {
    k.box(1.8, 1.6, 1.2, 'cream', xx, bodyH + 0.9, D / 2 - 2.4);
    k.hipRoof(1.8, 1.2, 0.7, 'terracotta', xx, bodyH + 2.5, D / 2 - 2.4, { over: 0.15 });
  }

  done();
}
museuRomantico.metric = true;
museuRomantico.rule = {
  note: 'Museu Romântico da Quinta da Macieirinha: long 19th-c. villa, 19.1 x 45.9 m, 12 m',
  extent: { box: { x0: -9.5, x1: 9.5, z0: -23.0, z1: 23.0 } },
  fitTo: true,
};
export default { 'museu-romantico': museuRomantico };
