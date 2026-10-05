// Paço Episcopal do Porto (Nicolau Nasoni, rebuilt 1734-1745). The bishop's
// palace beside the Sé: four granite wings round an open courtyard, a tall
// entrance pavilion with the episcopal arms, a grand courtyard stair, hipped
// tiled roofs and the balustraded terrace over the old city wall. Authored
// 59.2 x 49 m, 26 m.
import { corniceProfile } from '../kit.js';
import { win, pediment, cartouche, bell } from '../parts.js';
import { rect, offset } from '../geom.js';
import { polyCornice } from '../metric.js';
import { fitTo } from './site-fit.js';

function paco(k, site) {
  const W = 59.2;
  const D = 49;
  const H = 26;
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  const wing = 12;
  const bodyH = 12.5;
  const zF = D / 2;
  const zB = -D / 2;

  k.prism(rect(0, 0, W - 2 * wing, D - 2 * wing), -0.12, 0.18, 'graniteLight');

  // plinth and four ranges round the courtyard
  k.prism(offset(rect(0, 0, W, D), 0.3), 0, 1.1, 'graniteDark');
  k.box(W, bodyH, wing, 'granite', 0, 0, zF - wing / 2);
  k.box(W, bodyH, wing, 'granite', 0, 0, zB + wing / 2);
  k.box(wing, bodyH, D - 2 * wing, 'granite', -(W / 2 - wing / 2), 0, 0);
  k.box(wing, bodyH, D - 2 * wing, 'granite', (W / 2 - wing / 2), 0, 0);
  k.hipRoof(W, wing, 3.4, 'terracotta', 0, bodyH, zF - wing / 2, { over: 0.7 });
  k.hipRoof(W, wing, 3.4, 'terracotta', 0, bodyH, zB + wing / 2, { over: 0.7 });
  k.hipRoof(wing, D - 2 * wing, 3.4, 'terracotta', -(W / 2 - wing / 2), bodyH, 0, { over: 0.7 });
  k.hipRoof(wing, D - 2 * wing, 3.4, 'terracotta', (W / 2 - wing / 2), bodyH, 0, { over: 0.7 });
  k.corniceRing(W, D, corniceProfile('eave', 0.5), 'graniteLight', 0, bodyH - 0.35, 0);
  polyCornice(k, rect(0, 0, W, D), bodyH, corniceProfile('classic', 0.6), 'graniteLight');
  // dentil course under the main cornice
  for (let i = 0; i < 60; i++) k.box(0.45, 0.35, 0.35, 'graniteLight', -W / 2 + (W / 60) * (i + 0.5), bodyH - 0.45, zF + 0.75);

  // corner quoins
  const q = 1.3;
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    k.box(q, bodyH, q, 'graniteLight', sx * (W / 2 - q / 2), 0, sz * (D / 2 - q / 2));
  }
  // roof dormers and chimney stacks
  for (const u of [-20, -8, 8, 20]) {
    k.box(1.8, 1.6, 1.4, 'granite', u, bodyH + 1.4, zF - 1.6);
    k.push({ x: u, z: zF - 1.6 });
    k.gableRoof(1.9, 1.5, 0.7, 'terracotta', 0, bodyH + 3.0, 0, { over: 0.25, ridge: false, ry: Math.PI / 2 });
    k.pop();
    win(k, u, bodyH + 1.7, 1.0, 1.0, zF - 0.95, { trim: 'graniteLight', pane: 'glass', bw: 0.18, depth: 0.22 });
  }
  for (const [cu, cz2] of [[-W / 2 + 4, zF - 6], [W / 2 - 4, zF - 6], [-W / 2 + 4, zB + 6], [W / 2 - 4, zB + 6]]) {
    k.box(1.4, 2.4, 1.4, 'granite', cu, bodyH + 1.0, cz2);
    k.box(1.8, 0.35, 1.8, 'graniteLight', cu, bodyH + 3.4, cz2);
    for (const s of [-1, 1]) k.cyl(0.22, 0.22, 0.7, 6, 'terracotta', cu + s * 0.4, bodyH + 3.75, cz2);
  }

  // entrance pavilion and tall Nasoni tower over the front
  k.box(13, bodyH + 2.2, 1.4, 'graniteLight', 0, 0, zF + 0.5);
  k.box(11.5, 7.0, 0.9, 'granite', 0, 0, zF + 1.2);
  pediment(k, 12, 3.0, 1.4, 'graniteLight', 0, bodyH + 2.2, zF + 0.9, { frame: 0.45 });
  cartouche(k, 3.0, 3.8, 0.8, 'graniteLight', 0, bodyH + 3.2, zF + 1.1, { crown: 'granite' });
  k.surround({ x: 0, y: 0, w: 3.6, h: 6.2, arch: 'round' }, 0.5, 0.6, 'graniteLight', zF + 1.3);
  win(k, 0, 0, 3.4, 5.8, zF + 1.6, { arch: 'round', trim: 'granite', pane: 'wood', bw: 0.45, depth: 0.45 });
  // flanking statues on pedestals
  for (const sx of [-1, 1]) {
    k.box(1.2, 1.0, 1.2, 'graniteLight', sx * 5.4, bodyH + 3.4, zF + 0.9);
    k.statue(2.2, 'graniteLight', sx * 5.4, bodyH + 4.4, zF + 0.9, { pose: sx > 0 ? 'raise' : 'hold' });
  }

  const towerH = H;
  k.box(12, towerH, 12, 'granite', 0, 0, zF - 6);
  k.corniceRing(12.6, 12.6, corniceProfile('classic', 0.7), 'graniteLight', 0, towerH - 1.4, zF - 6);
  k.push({ x: 0, z: zF - 6 });
  k.hipRoof(13, 13, 3.2, 'slate', 0, towerH, 0, { over: 0.6 });
  k.pop();
  for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    k.push({ x: 0, z: zF - 6, ry });
    win(k, 0, 14.5, 1.6, 3.0, 6.1, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.28, depth: 0.34 });
    win(k, 0, 19.5, 1.4, 2.4, 6.1, { arch: 'round', trim: 'graniteLight', pane: 'glass', bw: 0.26, depth: 0.3 });
    k.cyl(1.3, 1.3, 0.3, 16, 'graniteLight', 0, 22.5, 6.2, { rx: Math.PI / 2 });
    k.cyl(1.0, 1.0, 0.2, 16, 'white', 0, 22.5, 6.4, { rx: Math.PI / 2 });
    k.box(0.1, 0.85, 0.08, 'dark', 0, 22.55, 6.55);
    k.box(0.6, 0.1, 0.08, 'dark', 0.25, 22.5, 6.55);
    k.pop();
  }
  // tower balustrade, corner urns, bells and a cross
  const tz2 = zF - 6;
  for (const [ry, off] of [[0, 5.7], [Math.PI, 5.7], [Math.PI / 2, 5.7], [-Math.PI / 2, 5.7]]) {
    k.push({ x: 0, z: tz2, ry });
    k.balustrade(10.6, 1.1, 'graniteLight', 0, towerH, off, { cheap: true, d: 0.22, sp: 0.6 });
    k.pop();
  }
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    k.box(0.9, 1.0, 0.9, 'graniteLight', sx * 5.4, towerH, tz2 + sz * 5.4);
    k.urn(1.1, 'graniteLight', sx * 5.4, towerH + 1.0, tz2 + sz * 5.4);
  }
  k.box(0.2, 2.6, 0.2, 'iron', 0, towerH + 3.2, tz2);
  k.box(1.2, 0.16, 0.16, 'iron', 0, towerH + 4.4, tz2);
  bell(k, 1.6, 0, towerH + 1.4, tz2 + 5.2);

  // windows on the outer elevations, with stone heads and sills
  for (const sz of [zF, zB]) {
    k.push({ z: sz, ry: sz > 0 ? 0 : Math.PI });
    for (const u of [-23, -16.5, -10, 10, 16.5, 23]) for (const yy of [1.7, 5.5, 9.3]) {
      const head = Math.round(yy) === 5 ? 'tri' : 'flat';
      win(k, u, yy, 1.6, 2.3, 0.1, { trim: 'graniteLight', pane: 'glass', bw: 0.26, depth: 0.34, sill: true, head });
    }
    // string course
    k.box(W, 0.35, 0.5, 'graniteLight', 0, 8.2, 0.3);
    k.pop();
  }
  for (const sx of [-1, 1]) {
    k.push({ x: sx * W / 2, z: 0, ry: sx * Math.PI / 2 });
    for (let i = 0; i < 5; i++) {
      const u = -D / 2 + 8 + i * ((D - 16) / 4);
      for (const yy of [1.7, 5.5, 9.3]) {
        win(k, u, yy, 1.5, 2.2, 0.1, { trim: 'graniteLight', pane: 'glass', bw: 0.24, depth: 0.32, sill: true, head: yy > 8 ? 'tri' : 'flat' });
      }
    }
    k.box(D, 0.35, 0.5, 'graniteLight', 0, 8.2, 0.3, { ry: Math.PI / 2 });
    k.pop();
  }

  // courtyard-facing arcade and windows
  for (const [push, len] of [[{ z: zF - wing, ry: Math.PI }, W - 2 * wing], [{ z: zB + wing, ry: 0 }, W - 2 * wing]]) {
    k.push(push);
    k.arcade(len - 0.6, 4.4, 0.5, Math.max(3, Math.round((len - 0.6) / 4.5)), 1.8, 3.0, 'graniteLight');
    k.cornice(len - 0.4, corniceProfile('classic', 0.4), 'graniteLight', 0, 4.4, 0);
    for (let i = 0; i < 5; i++) {
      const u = -len / 2 + (len / 5) * (i + 0.5);
      for (const yy of [5.5, 9.3]) win(k, u, yy, 1.4, 2.1, 0, { trim: 'granite', pane: 'glass', bw: 0.22, depth: 0.3, sill: true });
    }
    k.pop();
  }
  for (const [push, len] of [[{ x: -(W / 2 - wing), z: 0, ry: Math.PI / 2 }, D - 2 * wing], [{ x: (W / 2 - wing), z: 0, ry: -Math.PI / 2 }, D - 2 * wing]]) {
    k.push(push);
    k.arcade(len - 0.6, 4.4, 0.5, Math.max(3, Math.round((len - 0.6) / 4.5)), 1.8, 3.0, 'graniteLight');
    k.cornice(len - 0.4, corniceProfile('classic', 0.4), 'graniteLight', 0, 4.4, 0);
    for (let i = 0; i < 4; i++) {
      const u = -len / 2 + (len / 4) * (i + 0.5);
      for (const yy of [5.5, 9.3]) win(k, u, yy, 1.4, 2.1, 0, { trim: 'granite', pane: 'glass', bw: 0.22, depth: 0.3, sill: true });
    }
    k.pop();
  }

  // grand double-return stair against the south courtyard range
  for (const sx of [-1, 1]) {
    k.stairs(4.6, 5.0, 2.4, 9, 'graniteLight', sx * 5.2, 0, 10.5, { below: 0.6 });
    k.push({ x: sx * 5.2, z: 5.5 });
    k.balustrade(4.6, 1.0, 'graniteLight', 0, 2.4, 0, { cheap: true, d: 0.22, sp: 0.5 });
    k.pop();
  }
  k.box(14.0, 0.4, 3.0, 'graniteLight', 0, 2.4, 5.8);
  k.balustrade(13.6, 0.9, 'graniteLight', 0, 2.8, 7.2, { cheap: true, d: 0.22, sp: 0.5 });
  for (const sx of [-1, 1]) k.urn(1.0, 'graniteLight', sx * 6.2, 3.7, 5.8);

  // courtyard parterre, well and clipped planting
  const court = rect(0, -1, 24, 12);
  k.prism(court, 0.05, 0.35, 'hedge');
  k.prism(offset(court, -1.2), 0.05, 0.12, 'sand', { holes: [offset(offset(court, -1.2), -1.2)] });
  k.cyl(1.6, 1.8, 1.2, 12, 'graniteDark', 0, 0, -1);
  k.box(2.4, 0.28, 2.4, 'granite', 0, 1.2, -1);
  k.cyl(0.5, 0.6, 0.9, 10, 'graniteLight', 0, 0.4, -8);
  k.box(0.1, 0.7, 0.05, 'bronze', 0, 1.3, -8);
  for (const sx of [-1, 1]) for (const cz2 of [-8, 4]) {
    k.box(0.9, 1.4, 0.9, 'graniteLight', sx * 9, 0, cz2);
    k.statue(2.0, 'graniteLight', sx * 9, 1.4, cz2, { pose: 'hold' });
  }
  k.tree(-W / 2 + wing + 5, 0, -6, 7, { kind: 'topiary' });
  k.tree(W / 2 - wing - 5, 0, 6, 7, { kind: 'topiary' });
  k.tree(-14, 0, zF - wing - 6, 6, { crown: 'oval' });
  k.tree(14, 0, zF - wing - 6, 6, { crown: 'oval' });

  // balustraded terrace over the old city wall along the front
  k.prism(rect(0, zF + 4.0, W + 6, 3.0), -0.1, 2.0, 'granite');
  for (const [x0, len] of [[0, W + 6]]) {
    k.balustrade(len, 1.2, 'graniteLight', x0, 2.0, zF + 5.4, { cheap: true, d: 0.24, sp: 0.7 });
  }
  for (const u of [-W / 2 - 1, -W / 4, 0, W / 4, W / 2 + 1]) k.urn(1.1, 'graniteLight', u, 3.2, zF + 5.4);
  // monumental gate piers and iron gates on the terrace
  for (const sx of [-1, 1]) {
    k.box(1.6, 4.2, 1.6, 'granite', sx * 3.0, 0, zF + 4.0);
    k.box(2.0, 0.5, 2.0, 'graniteLight', sx * 3.0, 4.2, zF + 4.0);
    k.sphere(0.5, 'graniteLight', sx * 3.0, 4.7, zF + 4.0, { seg: 6, rings: 4, flat: true });
    k.box(0.12, 3.0, 0.12, 'iron', sx * 1.9, 0, zF + 4.0);
    k.box(0.12, 3.0, 0.12, 'iron', sx * 1.1, 0, zF + 4.0);
  }
  k.lamp(5.6, -8, 0, zF + 3.0, { globe: true });
  k.lamp(5.6, 8, 0, zF + 3.0, { globe: true });

  done();
}
paco.metric = true;
paco.rule = { note: 'Paço Episcopal: four granite wings round a court with the entrance tower', fitTo: true };
export default { 'paco-episcopal': paco };
