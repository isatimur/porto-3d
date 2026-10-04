// Farol de Leça, Leça da Palmeira, Matosinhos (1926). A 46 m octagonal
// lighthouse on the coast north of the Douro: white painted shaft with a red
// band, a corbelled gallery, a glazed lantern and a domed cap, beside the
// keeper's house. Authored 8.2 x 8.1 m, 46 m.
import { corniceProfile } from '../kit.js';
import { win } from '../parts.js';
import { rect } from '../geom.js';
import { polyCornice } from '../metric.js';
import { fitTo } from './site-fit.js';

function farolLeca(k, site) {
  const S = 8.2;
  const H = 46;
  const done = fitTo(k, site, { w: S, d: 8.1, h: H, cx: 0, cz: 0 });

  // rocky plinth and keeper's house
  k.prism(rect(0, 0, S + 8, 8 + 8), -0.3, 0.5, 'graniteDark');
  k.box(9.5, 5.5, 5.5, 'white', -6.0, 0, 0);
  k.hipRoof(10.0, 6.0, 2.2, 'terracotta', -6.0, 5.5, 0, { over: 0.5 });
  win(k, -6.0, 1.2, 1.4, 2.4, 2.85, { trim: 'granite', pane: 'glass', bw: 0.24, depth: 0.28 });
  win(k, -4.0, 1.2, 1.2, 2.2, 2.85, { trim: 'granite', pane: 'glass', bw: 0.22, depth: 0.26 });

  // octagonal tower: plinth, shaft, painted band
  k.cyl(4.2, 4.8, 2.4, 8, 'graniteLight', 0, 0, 0);
  k.cyl(3.4, 4.2, 6.0, 8, 'white', 0, 2.4, 0);
  k.cyl(2.5, 3.4, 30.0, 8, 'white', 0, 8.4, 0);
  k.cyl(2.75, 3.0, 4.0, 8, 'flowerRed', 0, 22.0, 0);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    k.push({ x: Math.sin(a) * 2.9, z: Math.cos(a) * 2.9, ry: a });
    win(k, 0, 12.0, 0.9, 1.6, 0, { arch: 'round', trim: 'granite', pane: 'glass', bw: 0.16, depth: 0.2 });
    win(k, 0, 18.0, 0.9, 1.6, 0, { arch: 'round', trim: 'granite', pane: 'glass', bw: 0.16, depth: 0.2 });
    win(k, 0, 30.0, 0.8, 1.4, 0, { arch: 'round', trim: 'granite', pane: 'glass', bw: 0.14, depth: 0.2 });
    k.pop();
  }
  k.box(0.4, 1.4, 0.4, 'granite', 0, 0, 4.0);

  // corbelled gallery and balustrade
  k.cyl(3.9, 3.2, 1.0, 8, 'graniteLight', 0, 38.4, 0);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    k.push({ x: Math.sin(a) * 3.5, z: Math.cos(a) * 3.5, ry: a });
    k.balustrade(2.7, 1.2, 'iron', 0, 39.4, 0, { cheap: true, d: 0.14, sp: 0.35 });
    k.pop();
  }
  k.box(7.6, 0.3, 7.6, 'graniteLight', 0, 39.4, 0, { ry: Math.PI / 8 });

  // glazed lantern with mullions, dome and finial
  k.cyl(2.3, 2.5, 3.4, 8, 'white', 0, 39.7, 0);
  k.cyl(2.15, 2.35, 3.0, 8, 'window', 0, 39.9, 0, { emit: 0.35, open: true });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    k.box(0.35, 3.2, 0.35, 'iron', Math.sin(a) * 2.2, 39.9, Math.cos(a) * 2.2, { ry: a });
  }
  k.corniceRing(5.0, 5.0, corniceProfile('classic', 0.5), 'iron', 0, 43.1, 0);
  k.dome(2.5, 'steel', 0, 43.4, 0, { seg: 12, rings: 6 });
  k.cyl(0.25, 0.3, 1.6, 8, 'steel', 0, 45.4, 0);
  k.sphere(0.35, 'flowerRed', 0, 47.0, 0, { seg: 8, rings: 5 });
  k.box(0.18, 1.4, 0.18, 'iron', 0, 45.4, 0);
  k.box(0.9, 0.14, 0.14, 'iron', 0, 46.4, 0);

  // surrounding rock, rail and a small beacon shed
  k.prism(rect(0, 0, S + 12, 8 + 12), -0.35, 0.35, 'graniteDark', { holes: [rect(0, 0, S + 8, 8 + 8)] });
  k.box(3.2, 2.0, 3.2, 'white', 5.5, 0, -4.0);
  k.cone(2.0, 1.2, 4, 'terracotta', 5.5, 2.0, -4.0);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.box(0.12, 1.0, 0.12, 'iron', Math.sin(a) * 6.5, 0.35, Math.cos(a) * 6.5);
  }

  done();
}
farolLeca.metric = true;
farolLeca.rule = { note: 'Farol de Leça: 46 m octagonal tower, gallery, lantern and keeper house', fitTo: true };
export default { 'farol-leca': farolLeca };
