// Igreja das Carmelitas, Porto (1619-1622). The Carmelite church beside the
// Carmo, at Largo do Carmo: a single nave with a Baroque granite front, twin
// bell towers, an azulejo flank and a polygonal apse. Authored 37.1 x 19.9 m, 25 m.
import { corniceProfile } from '../kit.js';
import { win, bellTower, bell } from '../parts.js';
import { rect, offset } from '../geom.js';
import { polyCornice, polyBand } from '../metric.js';
import { fitTo } from './site-fit.js';

function carmelitas(k, site) {
  const W = 37.1;
  const D = 19.9;
  const H = 25;
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  const wn = 13.5;
  const dn = 30;
  const cx = -3;

  // blue-and-white azulejo panel with a tiled chequer pattern, framed in granite
  const azulejoPanel = (w, h, x, yBase, z, ry = 0) => {
    k.box(w, h, 0.14, 'azulejo', x, yBase, z, { mat: 4, ry });
    k.push({ x, z, ry });
    const cols = Math.max(3, Math.round(w / 0.62));
    const rows = Math.max(3, Math.round(h / 0.62));
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const c = (i + j) % 2 ? 'doorBlue' : 'azulejo';
      k.box(w / cols - 0.14, h / rows - 0.14, 0.06, c, -w / 2 + (w / cols) * (i + 0.5), yBase + (h / rows) * j + 0.05, 0.09, { mat: 4 });
    }
    k.pop();
    k.box(w + 0.5, 0.3, 0.32, 'graniteLight', x, yBase - 0.3, z, { ry });
    k.box(w + 0.5, 0.3, 0.32, 'graniteLight', x, yBase + h, z, { ry });
  };

  const nave = rect(cx, -2, wn, dn);
  k.prism(offset(nave, 0.3), 0, 1.2, 'graniteDark');
  k.prism(nave, 0, 14.5, 'graniteWarm');
  polyBand(k, nave, 12.4, 0.4, 0.22, 'graniteLight');
  k.push({ z: -2 });
  k.gableRoof(wn + 0.4, dn + 0.8, 4.4, 'terracotta', cx, 14.5, 0);
  k.pop();
  polyCornice(k, nave, 14.5, corniceProfile('eave', 0.5), 'graniteLight');

  for (const sx of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const bz = -2 - dn / 2 + 3 + i * 6;
      k.box(1.0, 10, 1.5, 'granite', cx + sx * (wn / 2 + 0.7), 0, bz);
      k.box(1.2, 1.1, 1.7, 'graniteLight', cx + sx * (wn / 2 + 0.7), 10, bz);
      k.cone(0.55, 1.6, 4, 'graniteLight', cx + sx * (wn / 2 + 0.7), 11.1, bz);
      k.sphere(0.22, 'graniteLight', cx + sx * (wn / 2 + 0.7), 12.8, bz, { seg: 6, rings: 4, flat: true });
    }
    for (let i = 0; i < 4; i++) {
      const bz = -2 - dn / 2 + 5.5 + i * 6;
      k.push({ x: cx + sx * (wn / 2 + 0.05), z: bz, ry: sx > 0 ? Math.PI / 2 : -Math.PI / 2 });
      win(k, 0, 4.0, 1.3, 4.0, 0, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.3, depth: 0.32 });
      k.pop();
    }
    // corbel table under the eaves
    for (let i = 0; i < 20; i++) {
      const bz = -2 - dn / 2 + 0.7 + (i * (dn - 1.4)) / 19;
      k.box(0.5, 0.4, 0.24, 'graniteLight', cx + sx * (wn / 2 + 0.12), 13.75, bz);
      k.cone(0.18, 0.34, 4, 'graniteLight', cx + sx * (wn / 2 + 0.2), 13.45, bz);
    }
  }

  // polygonal apse with windows and a slate cap
  const apse = [];
  const apz = -2 - dn / 2 - 1.8;
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * 0.5 + (i / 6) * Math.PI;
    apse.push([cx + Math.cos(a) * 5.8, apz + Math.sin(a) * 5.8]);
  }
  k.prism(apse, 0, 11, 'graniteWarm');
  polyCornice(k, apse, 11, corniceProfile('band', 0.4), 'graniteLight');
  k.push({ x: cx, z: apz });
  k.cone(6.1, 3.4, 7, 'slate', 0, 11, 0);
  k.lathe([[0, 0], [0.14, 0.1], [0.1, 0.5], [0.05, 0.9], [0, 1]], 6, 'graniteLight', 0, 14.4, 0, { sr: 0.9, sh: 1.4, flat: true });
  k.pop();
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI * 0.5 + ((i + 1) / 4) * Math.PI;
    k.push({ x: cx + Math.cos(a) * 5.85, z: apz + Math.sin(a) * 5.85, ry: a + Math.PI / 2 });
    win(k, 0, 3.4, 1.2, 3.2, 0, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.28, depth: 0.3 });
    k.pop();
  }

  // front with portal, oculus, niche statues and a broken-pediment crest
  const fz = -2 + dn / 2;
  k.wall(wn + 2.0, 17.5, 1.2, 'graniteWarm', [
    { x: 0, y: 0, w: 3.2, h: 6.4, arch: 'round', pane: 'wood', inset: 0.5 },
    { x: 0, y: 11.0, w: 2.0, h: 2.0, arch: 'round', pane: 'glass', inset: 0.4 },
  ], cx, 0, fz - 0.45);
  k.surround({ x: 0, y: 0, w: 3.2, h: 6.4, arch: 'round' }, 0.5, 0.6, 'graniteLight', fz + 0.4);
  k.surround({ x: 0, y: 0.2, w: 3.7, h: 6.9, arch: 'round' }, 0.4, 0.5, 'graniteLight', fz + 0.2);
  k.box(0.85, 1.1, 0.55, 'graniteLight', cx, 8.6, fz + 0.55);
  k.box(2.4, 1.3, 0.4, 'granite', cx, 6.7, fz + 0.5);
  k.statue(1.4, 'graniteLight', cx, 6.8, fz + 0.75, { pose: 'hold' });
  k.surround({ x: 0, y: 8.6, w: 1.8, h: 2.8, arch: 'round' }, 0.32, 0.42, 'graniteLight', fz + 0.3);
  k.statue(1.9, 'graniteLight', cx, 8.7, fz + 0.65, { pose: 'pray' });
  k.cyl(1.6, 1.6, 0.32, 18, 'graniteLight', cx, 13.4, fz + 0.35, { rx: Math.PI / 2 });
  k.cyl(1.25, 1.25, 0.22, 16, 'glass', cx, 13.4, fz + 0.5, { rx: Math.PI / 2, emit: 0.25 });
  for (let i = 0; i < 8; i++) k.box(0.13, 2.4, 0.14, 'graniteLight', cx, 13.4, fz + 0.6, { rz: (i * Math.PI) / 8 });
  for (const sx of [-1, 1]) {
    k.box(0.7, 11.5, 0.6, 'graniteLight', cx + sx * 4.4, 2.0, fz + 0.35);
    k.box(0.95, 0.55, 0.85, 'graniteLight', cx + sx * 4.4, 13.5, fz + 0.4);
    k.box(0.4, 1.2, 0.4, 'graniteLight', cx + sx * 4.4, 0.8, fz + 0.4);
    win(k, cx + sx * 6.6, 4.2, 1.3, 3.0, fz + 0.1, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.26, depth: 0.3 });
  }
  k.box(wn + 2.8, 0.8, 1.6, 'graniteLight', cx, 4.6, fz + 0.5);
  k.cornice(wn + 3.0, corniceProfile('classic', 0.7), 'graniteLight', cx, 17.5, fz + 0.1);
  // scrolls and a cartouche over the facade, flanked by urns
  for (const s of [-1, 1]) {
    k.box(1.0, 0.9, 0.6, 'graniteLight', cx + s * 2.6, 18.3, fz + 0.35);
    k.sphere(0.62, 'graniteLight', cx + s * 3.1, 18.75, fz + 0.35, { seg: 6, rings: 4, flat: true });
  }
  k.box(1.4, 1.8, 0.5, 'graniteLight', cx, 19.0, fz + 0.3);
  k.urn(1.1, 'graniteLight', cx - 5.4, 18.3, fz + 0.2);
  k.urn(1.1, 'graniteLight', cx + 5.4, 18.3, fz + 0.2);
  k.box(0.16, 1.6, 0.16, 'iron', cx, 20.8, fz + 0.3);
  k.box(0.7, 0.14, 0.14, 'iron', cx, 21.8, fz + 0.3);

  // twin bell towers flanking the front
  const tx = wn / 2 + 2.7;
  for (const sx of [-1, 1]) {
    bellTower(k, {
      w: 5.2, hBody: 15, hBelfry: 5, x: cx + sx * tx, z: fz - 4,
      body: 'graniteWarm', trim: 'graniteLight', cap: 'pyramid', clock: sx > 0, openings: 1, urns: 'pinnacle',
    });
    k.push({ x: cx + sx * tx, z: fz - 4 });
    k.corniceRing(6.2, 6.2, corniceProfile('band', 0.5), 'graniteLight', 0, 15.0, 0);
    for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      k.push({ ry });
      k.box(1.1, 3.4, 0.4, 'dark', 0, 16.4, 2.6, { mat: 8 });
      for (let i = 0; i < 5; i++) k.box(0.12, 3.4, 0.44, 'graniteLight', -0.4 + i * 0.2, 16.4, 2.62);
      k.pop();
    }
    k.pop();
  }
  // a low screen wall links the towers across the front
  k.box(tx * 2 - 5.6, 1.6, 0.8, 'graniteLight', cx, 17.5, fz + 0.2);
  for (let i = 0; i < 9; i++) k.cone(0.3, 0.8, 4, 'graniteLight', cx - tx + 3.0 + i * ((tx * 2 - 6) / 8), 19.1, fz + 0.2);

  // azulejo panel on the south flank
  azulejoPanel(7.5, 4.6, cx + wn / 2 + 0.12, 5.0, -2, Math.PI / 2);

  // side chapels, forecourt cross, steps and lamps
  for (const sx of [-1, 1]) {
    k.prism(rect(cx + sx * (wn / 2 + 1.6), 3.0, 2.8, 7.5), 0, 9.5, 'graniteWarm');
    polyCornice(k, rect(cx + sx * (wn / 2 + 1.6), 3.0, 2.8, 7.5), 9.5, corniceProfile('eave', 0.4), 'graniteLight');
    k.push({ x: cx + sx * (wn / 2 + 1.6), z: 3.0 });
    k.gableRoof(2.8, 7.5, 1.8, 'terracotta', 0, 9.5, 0, { over: 0.4, ry: Math.PI / 2 });
    k.pop();
  }
  k.prism(rect(cx, fz + 4, 12, 7), -0.06, 0.12, 'sand');
  k.box(7.0, 0.3, 1.6, 'graniteLight', cx, 0, fz + 1.4);
  k.stairs(7.0, 1.4, 0.5, 3, 'graniteLight', cx, 0, fz + 2.2, { below: 0.5 });
  k.box(0.5, 3.6, 0.5, 'graniteLight', cx + 4.5, 0, fz + 3.4);
  k.box(1.5, 0.16, 0.16, 'iron', cx + 4.5, 3.6, fz + 3.4);
  k.box(0.16, 1.5, 0.16, 'iron', cx + 4.5, 2.7, fz + 3.4);
  for (const sx of [-1, 1]) k.lamp(4.6, cx + sx * 6, 0, fz + 2.8, { globe: true });
  k.tree(-11, 0, fz + 3, 5.5, { crown: 'oval' });
  k.tree(5, 0, fz + 4, 5, { crown: 'oval' });

  done();
}
carmelitas.metric = true;
carmelitas.rule = { note: 'Igreja das Carmelitas: Baroque nave, granite front and twin bell towers', fitTo: true };
export default { 'igreja-carmelitas': carmelitas };
