// Biblioteca Municipal Almeida Garrett (2001, José Manuel Soares): a long,
// low civic reading pavilion with a granite base, punched windows and a
// shallow tiled roof, set in the Jardins do Palácio de Cristal. Authored
// metric on the real OSM footprint.
import { corniceProfile } from '../kit.js';
import { plainBuilding } from '../metric.js';
import { win, flutedColumn } from '../parts.js';
import { bbox, rect, offset } from '../geom.js';
import { fitTo } from './site-fit.js';

function builder(k, site) {
  const o = site?.footprint?.outline;
  const b = o && o.length >= 3 ? bbox(o) : { w: 35, d: 6.8, cx: 0, cz: 0 };
  const W = Math.max(10, b.w);
  const D = Math.max(6, b.d);
  const H = 14;
  const done = fitTo(k, site, { w: b.w || 35, d: b.d || 6.8, h: H, cx: b.cx, cz: b.cz });

  // garden pad and a gravel walk exactly the footprint box
  k.prism(rect(b.cx, b.cz, W, D), -0.2, 0.2, 'grass');
  k.prism(rect(b.cx, b.cz, W * 0.99, D * 0.62), 0, 0.1, 'sand');

  // main rendered body: two storeys of windows, cornice, shallow hipped roof
  plainBuilding(k, rect(b.cx, b.cz, W, D), 10.6, {
    wall: 'plaster', trim: 'granite', bay: 3.4, windows: true,
    rise: 2.2, roofColor: 'terracotta', roofKind: 'hip', over: 0.4,
  });

  // granite plinth band and long-face pilasters
  k.prism(offset(rect(b.cx, b.cz, W, D), 0.2), 0, 1.6, 'granite');
  const alongX = W >= D;
  const L = alongX ? W : D;
  const S = alongX ? D : W;
  const nPil = Math.max(3, Math.round(L / 5.5));
  for (let i = 0; i <= nPil; i++) {
    const u = -L / 2 + (L * i) / nPil;
    const px = alongX ? b.cx + u : b.cx + S / 2 + 0.2;
    const pz = alongX ? b.cz + S / 2 + 0.2 : b.cz + u;
    k.box(0.5, 9.6, 0.4, 'graniteLight', px, 1.6, pz, { ry: alongX ? 0 : Math.PI / 2 });
    k.box(0.5, 9.6, 0.4, 'graniteLight', alongX ? b.cx + u : b.cx - S / 2 - 0.2, 1.6, alongX ? b.cz - S / 2 - 0.2 : b.cz + u, { ry: alongX ? 0 : Math.PI / 2 });
  }

  // central entrance: projecting porch, steps and a framed doorway
  const fz = b.cz + D / 2 + 0.05;
  k.box(5.2, 0.5, 2.4, 'graniteLight', b.cx, 0, fz + 0.9);
  k.box(5.2, 0.24, 1.5, 'granite', b.cx, 0.26, fz + 1.5);
  k.surround({ x: 0, y: 0, w: 3.2, h: 4.4, arch: 'rect' }, 0.4, 0.5, 'granite', b.cx, 0, fz + 0.35);
  k.box(2.6, 3.9, 0.18, 'doorBlue', b.cx, 0.1, fz + 0.4);
  win(k, 0, 5.6, 2.2, 2.2, fz + 0.45, { trim: 'granite', pane: 'glass', arch: 'round', bw: 0.3, sill: true });
  for (const s of [-1, 1]) win(k, s * 2.6, 0.7, 1.6, 4.0, fz + 0.4, { trim: 'granite', pane: 'glass', sill: true, bw: 0.28 });

  // name tablet over the door and a small reading-room lantern on the roof
  k.box(4.4, 0.9, 0.22, 'granite', b.cx, 8.0, fz + 0.45);
  k.box(3.8, 0.5, 0.05, 'graniteDark', b.cx, 8.2, fz + 0.57);
  k.box(3.4, 1.1, 2.2, 'graniteLight', b.cx, 12.6, b.cz);
  k.dome(1.5, 'lead', b.cx, 13.7, b.cz, { seg: 12, rings: 5 });
  k.cyl(0.09, 0.09, 0.9, 5, 'iron', b.cx, 15.1, b.cz);

  // entrance colonnade of fluted granite columns
  for (let i = 0; i < 5; i++) {
    flutedColumn(k, 5.0, 0.28, 'graniteLight', b.cx - 2.4 + i * 1.2, 0.5, fz + 1.35, { flutes: 10 });
  }
  k.box(6.4, 0.5, 1.4, 'graniteLight', b.cx, 5.5, fz + 1.35);

  // dormer windows on the two long roof slopes
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const dz = b.cz - D * 0.28 + i * D * 0.28;
      const dx = b.cx + sx * W * 0.3;
      k.box(1.3, 1.4, 1.5, 'plaster', dx, 10.3, dz);
      k.box(1.7, 0.24, 1.9, 'granite', dx, 11.7, dz);
      k.box(0.1, 0.85, 0.85, 'glass', dx + sx * 0.68, 10.6, dz, { emit: 0.16 });
    }
  }
  // corner urns on the parapet
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    k.lathe([[0, 0], [0.3, 0], [0.3, 0.1], [0.16, 0.16], [0.34, 0.4], [0.28, 0.62], [0.14, 0.72], [0.18, 0.78], [0, 1]], 7, 'graniteLight', b.cx + sx * (W / 2 - 0.2), 12.4, b.cz + sz * (D / 2 - 0.2), { sr: 0.8, sh: 1.2, flat: true });
  }

  // parapet with coping round the flat roof edges
  k.corniceRing(W + 0.5, D + 0.5, corniceProfile('band', 0.4), 'graniteLight', b.cx, 10.6, b.cz);

  // a few garden trees within the pad
  for (let i = 0; i < 4; i++) {
    const tx = b.cx - W * 0.44 + (W * 0.88 * (i + 0.5)) / 4;
    const tz = b.cz + (i % 2 ? 1 : -1) * (S / 2 + 2.6);
    k.tree(tx, 0, tz, 6 + (i % 2) * 1.5, { crown: 'round' });
  }
  done();
}
builder.metric = true;
builder.rule = {
  note: 'Biblioteca Municipal Almeida Garrett: long low library pavilion with granite base, punched windows and tiled roof',
  extent: [/./],
  fitTo: true,
};

export default { 'almeida-garrett': builder };
