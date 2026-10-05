// Farol de Leça, Leça da Palmeira, Matosinhos (1926). A 46 m octagonal
// lighthouse on the coast north of the Douro: white painted shaft with a red
// band, a corbelled gallery, a glazed lantern and a domed cap, beside the
// keeper's house and its outbuildings on the rocky headland. Authored
// 8.2 x 8.1 m, 46 m.
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
  // keeper's house: shutters, door with canopy and two chimneys
  for (const [wx, s] of [[-6.0, -1], [-4.0, 1]]) k.box(0.3, 2.4, 0.12, 'doorBlue', wx + s * 0.95, 1.2, 2.9);
  k.box(1.2, 2.4, 0.15, 'wood', -1.8, 0, -1.4, { ry: -Math.PI / 2 });
  k.box(1.8, 0.2, 0.9, 'graniteLight', -1.5, 2.5, -1.4, { ry: -Math.PI / 2 });
  k.box(0.4, 4.6, 0.4, 'iron', -1.4, 0, -1.4);
  for (const cx2 of [-8.2, -4.2]) {
    k.box(1.0, 1.8, 1.0, 'white', cx2, 5.5, -0.6);
    k.box(1.3, 0.3, 1.3, 'graniteLight', cx2, 7.3, -0.6);
    k.cyl(0.18, 0.18, 0.6, 6, 'terracotta', cx2, 7.6, -0.6);
  }
  // a small outbuilding and a well
  k.box(3.0, 2.6, 2.6, 'white', 5.5, 0, -6.2);
  k.gableRoof(3.2, 2.8, 1.0, 'terracotta', 5.5, 2.6, -6.2, { over: 0.4 });
  k.cyl(1.1, 1.2, 1.0, 12, 'graniteDark', 3.0, 0, 3.4);
  k.box(2.6, 0.25, 0.25, 'iron', 3.0, 1.7, 3.4);

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
  // entrance door with a hood and a lamp, plus painted shaft bands
  k.push({ z: 4.15 });
  win(k, 0, 0.2, 1.4, 2.6, 0.4, { arch: 'round', trim: 'granite', pane: 'wood', bw: 0.24, depth: 0.3 });
  k.box(2.0, 0.25, 0.9, 'graniteLight', 0, 2.9, 0.7);
  k.lamp(3.0, 1.2, 0, 0.5, { globe: true });
  k.pop();
  for (const [by, col] of [[2.4, 'flowerRed'], [8.4, 'flowerRed']]) k.cyl(3.42, 3.42, 0.4, 8, col, 0, by, 0);

  // corbelled gallery on a ring of moulded brackets
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    k.push({ x: Math.sin(a) * 3.15, z: Math.cos(a) * 3.15, ry: a });
    k.box(1.0, 1.4, 1.6, 'graniteLight', 0, 37.0, 0.2);
    k.cyl(0.3, 0.3, 1.3, 6, 'graniteLight', 0, 37.0, 0.8, { rx: Math.PI / 2 });
    k.pop();
  }
  k.cyl(3.9, 3.2, 1.0, 8, 'graniteLight', 0, 38.4, 0);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    k.push({ x: Math.sin(a) * 3.5, z: Math.cos(a) * 3.5, ry: a });
    k.balustrade(2.7, 1.2, 'iron', 0, 39.4, 0, { cheap: true, d: 0.14, sp: 0.35 });
    k.pop();
  }
  k.box(7.6, 0.3, 7.6, 'graniteLight', 0, 39.4, 0, { ry: Math.PI / 8 });

  // glazed lantern with mullions, a watch-room band, dome and finial
  k.cyl(2.3, 2.5, 3.4, 8, 'white', 0, 39.7, 0);
  k.cyl(2.15, 2.35, 3.0, 8, 'window', 0, 39.9, 0, { emit: 0.35, open: true });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    k.box(0.35, 3.2, 0.35, 'iron', Math.sin(a) * 2.2, 39.9, Math.cos(a) * 2.2, { ry: a });
  }
  k.cyl(2.5, 2.5, 0.4, 16, 'iron', 0, 43.1, 0);
  k.corniceRing(5.0, 5.0, corniceProfile('classic', 0.5), 'iron', 0, 43.1, 0);
  k.dome(2.5, 'steel', 0, 43.4, 0, { seg: 12, rings: 6 });
  k.cyl(0.25, 0.3, 1.6, 8, 'steel', 0, 45.4, 0);
  k.sphere(0.35, 'flowerRed', 0, 47.0, 0, { seg: 8, rings: 5 });
  k.box(0.18, 1.4, 0.18, 'iron', 0, 45.4, 0);
  k.box(0.9, 0.14, 0.14, 'iron', 0, 46.4, 0);
  // lightning rod, weather vane and anemometer
  k.cyl(0.06, 0.06, 2.2, 5, 'steel', 0, 47.35, 0);
  k.box(0.5, 0.4, 0.06, 'steel', 0.35, 48.4, 0);
  k.box(0.06, 0.9, 0.06, 'steel', 0, 48.6, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    k.box(0.5, 0.06, 0.06, 'steel', Math.cos(a) * 0.3, 49.3, Math.sin(a) * 0.3, { ry: a });
    k.sphere(0.1, 'steel', Math.cos(a) * 0.55, 49.3, Math.sin(a) * 0.55, { seg: 5, rings: 3, flat: true });
  }

  // surrounding rock, fence, flag and a beacon shed
  k.prism(rect(0, 0, S + 12, 8 + 12), -0.35, 0.35, 'graniteDark', { holes: [rect(0, 0, S + 8, 8 + 8)] });
  k.box(3.2, 2.0, 3.2, 'white', 5.5, 0, -4.0);
  k.cone(2.0, 1.2, 4, 'terracotta', 5.5, 2.0, -4.0);
  k.box(0.14, 7.0, 0.14, 'steel', 8.0, 0, 6.0);
  k.box(1.4, 0.9, 0.06, 'flowerRed', 8.0, 7.0, 6.0);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.box(0.12, 1.0, 0.12, 'iron', Math.sin(a) * 6.5, 0.35, Math.cos(a) * 6.5);
  }
  k.box(12.0, 0.08, 0.08, 'iron', 0, 1.3, 6.6);
  // scattered boulders on the headland
  for (const [rx, rz, rr] of [[9.5, 2.5, 1.6], [-10.5, 4.0, 1.9], [2.0, 10.5, 1.4], [-4.0, -9.5, 1.7], [7.5, 9.0, 1.3]]) {
    k.ico(rr, 1, 'graniteDark', rx, -0.2, rz, { jitter: 0.3 });
    k.ico(rr * 0.7, 1, 'graniteGrey', rx + rr * 0.7, -0.1, rz + rr * 0.5, { jitter: 0.25 });
  }

  done();
}
farolLeca.metric = true;
farolLeca.rule = { note: 'Farol de Leça: 46 m octagonal tower, gallery, lantern and keeper house', fitTo: true };
export default { 'farol-leca': farolLeca };
