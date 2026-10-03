// Casa-Museu Guerra Junqueiro (Porto): Casa do Dr. Domingos Barbosa, a granite
// 18th-century townhouse (1730, attr. Nicolau Nasoni) built around a courtyard
// on Rua de D. Hugo. Three storeys of granite, hipped roofs and a carved
// entrance portal with a coat of arms. Now the poet's house-museum.
import { corniceProfile } from '../kit.js';
import { win, cartouche, pediment } from '../parts.js';
import { rect } from '../geom.js';
import { fitTo } from './site-fit.js';

function casaGuerraJunqueiro(k, site) {
  const W = 37.8;
  const D = 63.2;
  const H = 14;
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  const wing = 12;       // depth of each range
  const bodyH = 10.4;    // wall height beneath the roof
  const zF = D / 2;
  const zB = -D / 2;

  // paved courtyard floor
  k.prism(rect(0, 0, W - 2 * wing, D - 2 * wing), -0.1, 0.16, 'graniteLight');

  // four granite ranges round the open court
  k.box(W, bodyH, wing, 'granite', 0, 0, zF - wing / 2);          // front range
  k.box(W, bodyH, wing, 'granite', 0, 0, zB + wing / 2);          // back range
  k.box(wing, bodyH, D - 2 * wing, 'granite', -(W / 2 - wing / 2), 0, 0); // west range
  k.box(wing, bodyH, D - 2 * wing, 'granite', (W / 2 - wing / 2), 0, 0);  // east range
  // hipped roofs on every range (terracotta, low)
  k.hipRoof(W, wing, 3.0, 'terracotta', 0, bodyH, zF - wing / 2, { over: 0.6 });
  k.hipRoof(W, wing, 3.0, 'terracotta', 0, bodyH, zB + wing / 2, { over: 0.6 });
  k.hipRoof(wing, D - 2 * wing, 3.0, 'terracotta', -(W / 2 - wing / 2), bodyH, 0, { over: 0.6 });
  k.hipRoof(wing, D - 2 * wing, 3.0, 'terracotta', (W / 2 - wing / 2), bodyH, 0, { over: 0.6 });
  k.corniceRing(W, D, corniceProfile('eave', 0.45), 'granite', 0, bodyH - 0.3, 0);

  // outer corner quoins
  const q = 1.2;
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    k.box(q, bodyH, q, 'graniteLight', sx * (W / 2 - q / 2), 0, sz * (D / 2 - q / 2));
  }

  // ---- front portal with pediment and coat of arms
  k.box(6.2, 7.4, 1.0, 'graniteLight', 0, 0, zF + 0.45);
  k.box(7.0, 0.7, 1.6, 'granite', 0, 7.4, zF + 0.55);
  pediment(k, 7.4, 2.6, 1.1, 'granite', 0, 8.1, zF + 0.5, { frame: 0.4 });
  cartouche(k, 2.4, 2.8, 0.7, 'graniteLight', 0, 8.6, zF + 0.7, { crown: 'granite' });
  win(k, 0, 1.0, 3.0, 4.4, zF + 0.95, { trim: 'granite', pane: 'wood', bw: 0.4, depth: 0.4 });

  // ---- front range windows (three storeys)
  for (const sx of [-1, 1]) for (const yy of [1.5, 4.9, 8.3]) {
    win(k, sx * 12.5, yy, 1.6, 2.2, zF + 0.15, { trim: 'graniteLight', pane: 'glass', bw: 0.26, depth: 0.34, sill: true });
  }
  // ---- long flanks (three storeys)
  const flank = (sx) => {
    k.push({ x: sx * W / 2, z: 0, ry: sx * Math.PI / 2 });
    const n = 7;
    for (let i = 0; i < n; i++) {
      const u = -D / 2 + 9 + i * ((D - 18) / (n - 1));
      for (const yy of [1.5, 4.9, 8.3]) {
        win(k, u, yy, 1.5, 2.1, 0, { trim: 'graniteLight', pane: 'glass', bw: 0.24, depth: 0.32, sill: true });
      }
    }
    k.pop();
  };
  flank(-1);
  flank(1);
  // ---- back range windows
  k.push({ z: zB, ry: Math.PI });
  for (const sx of [-1, 1, -0.45, 0.45]) for (const yy of [1.5, 4.9, 8.3]) {
    win(k, sx * 10, yy, 1.5, 2.1, 0, { trim: 'graniteLight', pane: 'glass', bw: 0.24, depth: 0.32, sill: true });
  }
  k.pop();

  // courtyard-facing windows on all four ranges
  const court = (push, len) => {
    k.push(push);
    const n = 4;
    for (let i = 0; i < n; i++) {
      const u = -len / 2 + (len / n) * (i + 0.5);
      for (const yy of [1.5, 4.9, 8.3]) {
        win(k, u, yy, 1.4, 2.0, 0, { trim: 'granite', pane: 'glass', bw: 0.22, depth: 0.3, sill: true });
      }
    }
    k.pop();
  };
  court({ z: zF - wing, ry: Math.PI }, W - 2 * wing);
  court({ z: zB + wing, ry: 0 }, W - 2 * wing);
  court({ x: -(W / 2 - wing), z: 0, ry: Math.PI / 2 }, D - 2 * wing);
  court({ x: (W / 2 - wing), z: 0, ry: -Math.PI / 2 }, D - 2 * wing);

  // courtyard well and a clipped bay tree
  k.cyl(1.5, 1.7, 1.1, 12, 'graniteDark', 0, 0, 0);
  k.box(2.2, 0.25, 2.2, 'granite', 0, 1.1, 0);
  k.tree(-W / 2 + wing + 4, 0, -6, 6.5, { kind: 'topiary' });
  k.tree(W / 2 - wing - 4, 0, 6, 6.5, { kind: 'topiary' });

  done();
}
casaGuerraJunqueiro.metric = true;
casaGuerraJunqueiro.rule = {
  note: 'Casa-Museu Guerra Junqueiro: granite 1730 townhouse round a court, 37.8 x 63.2 m, 14 m',
  extent: { box: { x0: -18.9, x1: 18.9, z0: -31.6, z1: 31.6 } },
  fitTo: true,
};
export default { 'casa-guerra-junqueiro': casaGuerraJunqueiro };
