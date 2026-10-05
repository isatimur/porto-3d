// Igreja de Nossa Senhora da Vitória, Porto (1524; rebuilt 18th-19th c.). A
// single-nave church on Rua de São Bento da Vitória with a granite front, a
// bell gable over the portal, azulejo panels and a polygonal apse. Authored
// 37.2 x 18 m, 20 m.
import { corniceProfile } from '../kit.js';
import { win, bell } from '../parts.js';
import { rect, offset } from '../geom.js';
import { polyCornice, polyBand } from '../metric.js';
import { fitTo } from './site-fit.js';

function vitoria(k, site) {
  const W = 37.2;
  const D = 18;
  const H = 20;
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  const wn = 13;
  const dn = 30;

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

  const nave = rect(0, -2, wn, dn);
  k.prism(offset(nave, 0.3), 0, 1.1, 'graniteDark');
  k.prism(nave, 0, 13.5, 'granite');
  polyBand(k, nave, 11.4, 0.4, 0.22, 'graniteLight');
  k.push({ z: -2 });
  k.gableRoof(wn + 0.4, dn + 0.8, 4.6, 'terracotta', 0, 13.5, 0);
  k.pop();
  polyCornice(k, nave, 13.5, corniceProfile('eave', 0.5), 'graniteLight');

  // buttresses with gablets and finials, round-headed windows along the flanks
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const bz = -2 - dn / 2 + 3 + i * 6;
      k.box(1.0, 9.5, 1.4, 'granite', sx * (wn / 2 + 0.7), 0, bz);
      k.box(1.2, 1.2, 1.6, 'graniteLight', sx * (wn / 2 + 0.7), 9.5, bz);
      k.cone(0.55, 1.6, 4, 'graniteLight', sx * (wn / 2 + 0.7), 10.7, bz);
      k.sphere(0.22, 'graniteLight', sx * (wn / 2 + 0.7), 12.4, bz, { seg: 6, rings: 4, flat: true });
    }
    for (let i = 0; i < 4; i++) {
      const bz = -2 - dn / 2 + 5.5 + i * 6;
      k.push({ x: sx * (wn / 2 + 0.05), z: bz, ry: sx > 0 ? Math.PI / 2 : -Math.PI / 2 });
      win(k, 0, 3.4, 1.3, 4.0, 0, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.3, depth: 0.32 });
      k.pop();
    }
    // corbel table under the eaves
    for (let i = 0; i < 20; i++) {
      const bz = -2 - dn / 2 + 0.7 + (i * (dn - 1.4)) / 19;
      k.box(0.5, 0.4, 0.24, 'graniteLight', sx * (wn / 2 + 0.12), 12.75, bz);
      k.cone(0.18, 0.34, 4, 'graniteLight', sx * (wn / 2 + 0.2), 12.45, bz);
    }
  }

  // polygonal apse with windows, buttresses and a conical slate roof
  const apse = [];
  const apz = -2 - dn / 2 - 1.6;
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * 0.5 + (i / 6) * Math.PI;
    apse.push([Math.cos(a) * 5.6, apz + Math.sin(a) * 5.6]);
  }
  k.prism(apse, 0, 10.5, 'granite');
  polyCornice(k, apse, 10.5, corniceProfile('band', 0.4), 'graniteLight');
  k.push({ z: apz });
  k.cone(5.9, 3.4, 7, 'slate', 0, 10.5, 0);
  k.lathe([[0, 0], [0.14, 0.1], [0.1, 0.5], [0.05, 0.9], [0, 1]], 6, 'graniteLight', 0, 13.9, 0, { sr: 0.9, sh: 1.4, flat: true });
  k.pop();
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI * 0.5 + ((i + 1) / 4) * Math.PI;
    k.push({ x: Math.cos(a) * 5.65, z: apz + Math.sin(a) * 5.65, ry: a + Math.PI / 2 });
    win(k, 0, 3.2, 1.2, 3.2, 0, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.28, depth: 0.3 });
    k.pop();
  }

  // sacristy leaning on the gospel flank near the apse
  k.prism(rect(wn / 2 + 4.0, -14.5, 7.5, 7.0), 0, 8.0, 'granite');
  k.prism(offset(rect(wn / 2 + 4.0, -14.5, 7.5, 7.0), 0.25), 0, 0.8, 'graniteDark');
  polyCornice(k, rect(wn / 2 + 4.0, -14.5, 7.5, 7.0), 8.0, corniceProfile('eave', 0.45), 'graniteLight');
  k.push({ x: wn / 2 + 4.0, z: -14.5 });
  k.hipRoof(8.0, 7.5, 2.4, 'terracotta', 0, 8.0, 0, { over: 0.6 });
  k.pop();
  k.push({ x: wn / 2 + 7.75, z: -14.5, ry: Math.PI / 2 });
  win(k, 0, 2.0, 1.3, 2.4, 0, { trim: 'granite', pane: 'glass', bw: 0.24, depth: 0.28, sill: true });
  k.pop();

  // granite front: stepped portal, niche, oculus, azulejo and a bell gable
  const fz = -2 + dn / 2;
  k.wall(wn + 1.4, 15.5, 1.1, 'granite', [
    { x: 0, y: 0, w: 3.0, h: 6.0, arch: 'round', pane: 'wood', inset: 0.5 },
    { x: 0, y: 10.2, w: 1.9, h: 1.9, arch: 'round', pane: 'glass', inset: 0.4 },
  ], 0, 0, fz - 0.4);
  // three stepped archivolts round the portal + keystone and tympanum
  k.surround({ x: 0, y: 0, w: 3.0, h: 6.0, arch: 'round' }, 0.45, 0.55, 'graniteLight', fz + 0.35);
  k.surround({ x: 0, y: 0.15, w: 3.5, h: 6.5, arch: 'round' }, 0.4, 0.45, 'graniteLight', fz + 0.15);
  k.surround({ x: 0, y: 0.3, w: 4.0, h: 7.0, arch: 'round' }, 0.35, 0.35, 'graniteLight', fz - 0.05);
  k.box(0.8, 1.0, 0.5, 'graniteLight', 0, 8.2, fz + 0.5); // keystone
  k.box(2.4, 1.3, 0.4, 'granite', 0, 6.4, fz + 0.45); // tympanum
  k.statue(1.4, 'graniteLight', 0, 6.5, fz + 0.7, { pose: 'hold' });
  // jamb pilasters with capitals and statues
  for (const sx of [-1, 1]) {
    k.box(0.7, 8.6, 0.6, 'graniteLight', sx * 2.6, 0, fz + 0.35);
    k.box(0.95, 0.5, 0.8, 'graniteLight', sx * 2.6, 8.6, fz + 0.4);
    k.statue(1.7, 'graniteLight', sx * 3.7, 0.4, fz + 0.7, { pose: 'down' });
  }
  k.surround({ x: 0, y: 8.0, w: 1.7, h: 2.6, arch: 'round' }, 0.3, 0.4, 'graniteLight', fz + 0.25);
  k.statue(1.8, 'graniteLight', 0, 8.1, fz + 0.6, { pose: 'pray' });
  // oculus with tracery spokes
  k.cyl(1.5, 1.5, 0.3, 18, 'graniteLight', 0, 12.6, fz + 0.3, { rx: Math.PI / 2 });
  k.cyl(1.15, 1.15, 0.2, 16, 'glass', 0, 12.6, fz + 0.45, { rx: Math.PI / 2, emit: 0.25 });
  for (let i = 0; i < 8; i++) k.box(0.13, 2.2, 0.14, 'graniteLight', 0, 12.6, fz + 0.55, { rz: (i * Math.PI) / 8 });
  for (const sx of [-1, 1]) win(k, sx * 4.6, 3.2, 1.6, 3.4, fz + 0.05, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.28, depth: 0.3 });
  // azulejo panels flanking the front door and along the south flank
  azulejoPanel(2.6, 4.6, -5.6, 3.4, fz + 0.62);
  azulejoPanel(2.6, 4.6, 5.6, 3.4, fz + 0.62);
  azulejoPanel(7.4, 4.6, wn / 2 + 0.12, 5.2, -2, Math.PI / 2);

  // bell gable with scrolls, two bells, corner urns and a rayed cross
  k.wall(3.4, 5.0, 0.9, 'granite', [{ x: 0, y: 1.0, w: 1.7, h: 2.8, arch: 'round', pane: null }], 0, 15.5, fz - 0.1);
  k.surround({ x: 0, y: 1.0, w: 1.7, h: 2.8, arch: 'round' }, 0.25, 0.35, 'graniteLight', fz + 0.35);
  bell(k, 2.0, 0, 16.2, fz - 0.5);
  k.box(4.2, 0.6, 1.2, 'graniteLight', 0, 20.5, fz - 0.1);
  k.cornice(4.6, corniceProfile('classic', 0.5), 'graniteLight', 0, 20.9, fz - 0.05);
  for (const sx of [-1, 1]) {
    k.box(0.9, 1.4, 0.9, 'graniteLight', sx * 1.9, 18.7, fz - 0.15);
    k.urn(0.95, 'graniteLight', sx * 2.2, 20.9, fz - 0.1);
  }
  k.box(0.16, 1.2, 0.16, 'iron', 0, 21.1, fz);
  k.box(0.8, 0.14, 0.14, 'iron', 0, 21.7, fz);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    k.box(0.6, 0.08, 0.08, 'gold', Math.cos(a) * 0.5, 21.5 + Math.sin(a) * 0.5, fz, { rz: a, emit: 0.5 });
  }
  k.statue(1.7, 'graniteLight', 0, 20.7, fz + 0.5, { pose: 'hold' });

  // parvis: paving, granite steps and rail, cross and lamps
  k.prism(rect(0, fz + 4, 10, 6), -0.06, 0.12, 'sand');
  k.box(7.0, 0.3, 1.6, 'graniteLight', 0, 0, fz + 1.4);
  k.stairs(7.0, 1.4, 0.5, 3, 'graniteLight', 0, 0, fz + 2.2, { below: 0.5 });
  for (const sx of [-1, 1]) {
    k.box(0.14, 1.0, 0.14, 'iron', sx * 3.6, 1.2, fz + 3.0);
    k.box(0.9, 0.1, 0.1, 'iron', sx * 3.2, 2.1, fz + 3.0);
  }
  k.box(0.5, 3.4, 0.5, 'graniteLight', 4.5, 0, fz + 3.5);
  k.box(1.4, 0.16, 0.16, 'iron', 4.5, 3.4, fz + 3.5);
  k.box(0.16, 1.4, 0.16, 'iron', 4.5, 2.6, fz + 3.5);
  for (const sx of [-1, 1]) k.lamp(4.4, sx * 5.5, 0, fz + 2.5, { globe: true });
  k.tree(-8, 0, fz + 3, 5.5, { crown: 'oval' });

  // --- detail pass: ridge cresting, buttress finials, urns and the stations
  for (let i = 0; i < 13; i++) {
    const tz = -2 - dn / 2 + 2.0 + (i * (dn - 4)) / 12;
    k.box(0.5, 0.26, 0.5, 'terracotta', 0, 18.15, tz);
    if (i % 2 === 0) k.cone(0.3, 0.7, 4, 'graniteLight', 0, 18.4, tz);
  }
  for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) {
    const bz = -2 - dn / 2 + 3 + i * 6;
    k.sphere(0.22, 'graniteLight', sx * (wn / 2 + 0.7), 10.5, bz, { seg: 6, rings: 4, flat: true });
    k.cone(0.32, 0.7, 4, 'graniteLight', sx * (wn / 2 + 0.7), 9.5, bz);
  }
  for (const u of [-5.5, -3.2, 3.2, 5.5]) k.urn(1.0, 'graniteLight', u, 15.5, fz - 0.1);
  // stations of the cross along the south flank
  for (let i = 0; i < 5; i++) {
    const bz = -2 - dn / 2 + 4 + i * 5.4;
    k.box(1.0, 1.3, 0.16, 'graniteLight', wn / 2 + 0.09, 4.6, bz, { ry: Math.PI / 2 });
    k.box(0.7, 1.0, 0.05, 'dark', wn / 2 + 0.16, 4.75, bz, { ry: Math.PI / 2 });
    k.box(1.2, 0.18, 0.3, 'graniteLight', wn / 2 + 0.1, 5.9, bz, { ry: Math.PI / 2 });
  }
  // side chapels with gable roofs and a lantern over the crossing
  for (const sx of [-1, 1]) {
    k.prism(rect(sx * (wn / 2 + 1.5), 3.0, 2.6, 7.5), 0, 9.0, 'granite');
    polyCornice(k, rect(sx * (wn / 2 + 1.5), 3.0, 2.6, 7.5), 9.0, corniceProfile('eave', 0.4), 'graniteLight');
    k.push({ x: sx * (wn / 2 + 1.5), z: 3.0 });
    k.gableRoof(2.6, 7.5, 1.8, 'terracotta', 0, 9.0, 0, { over: 0.4, ry: Math.PI / 2 });
    k.pop();
  }
  k.cyl(1.6, 1.8, 2.2, 8, 'granite', 0, 13.5, -2);
  k.dome(1.7, 'slate', 0, 15.7, -2, { seg: 10, rings: 5 });
  k.lathe([[0, 0], [0.12, 0.12], [0.07, 0.6], [0, 1]], 6, 'graniteLight', 0, 17.3, -2, { sr: 0.7, sh: 1.4, flat: true });

  done();
}
vitoria.metric = true;
vitoria.rule = { note: 'Igreja da Vitória: single-nave church with a granite front and bell gable', fitTo: true };
export default { 'igreja-da-vitoria': vitoria };
