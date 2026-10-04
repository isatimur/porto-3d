// Paço Episcopal do Porto (Nicolau Nasoni, rebuilt 1734-1745). The bishop's
// palace beside the Sé: four granite wings round an open courtyard, a tall
// entrance pavilion with the episcopal arms, hipped tiled roofs and the terrace
// over the old city wall. Authored 59.2 x 49 m, 26 m.
import { corniceProfile } from '../kit.js';
import { win, pediment, cartouche } from '../parts.js';
import { rect, offset } from '../geom.js';
import { polyCornice, polyWindows } from '../metric.js';
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

  // four ranges round the courtyard
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

  // corner quoins
  const q = 1.3;
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    k.box(q, bodyH, q, 'graniteLight', sx * (W / 2 - q / 2), 0, sz * (D / 2 - q / 2));
  }

  // entrance pavilion and tall tower over the front
  k.box(13, bodyH + 2.2, 1.4, 'graniteLight', 0, 0, zF + 0.5);
  k.box(11.5, 7.0, 0.9, 'granite', 0, 0, zF + 1.2);
  pediment(k, 12, 3.0, 1.4, 'graniteLight', 0, bodyH + 2.2, zF + 0.9, { frame: 0.45 });
  cartouche(k, 3.0, 3.8, 0.8, 'graniteLight', 0, bodyH + 3.2, zF + 1.1, { crown: 'granite' });
  k.surround({ x: 0, y: 0, w: 3.6, h: 6.2, arch: 'round' }, 0.5, 0.6, 'graniteLight', zF + 1.3);
  win(k, 0, 0, 3.4, 5.8, zF + 1.6, { arch: 'round', trim: 'granite', pane: 'wood', bw: 0.45, depth: 0.45 });

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
    k.pop();
  }
  k.box(0.2, 2.6, 0.2, 'iron', 0, towerH + 3.2, zF - 6);
  k.box(1.2, 0.16, 0.16, 'iron', 0, towerH + 4.4, zF - 6);

  // windows on the outer elevations
  for (const sz of [zF, zB]) {
    k.push({ z: sz, ry: sz > 0 ? 0 : Math.PI });
    for (const u of [-23, -16.5, -10, 10, 16.5, 23]) for (const yy of [1.7, 5.5, 9.3]) {
      win(k, u, yy, 1.6, 2.3, 0.1, { trim: 'graniteLight', pane: 'glass', bw: 0.26, depth: 0.34, sill: true });
    }
    k.pop();
  }
  for (const sx of [-1, 1]) {
    k.push({ x: sx * W / 2, z: 0, ry: sx * Math.PI / 2 });
    for (let i = 0; i < 5; i++) {
      const u = -D / 2 + 8 + i * ((D - 16) / 4);
      for (const yy of [1.7, 5.5, 9.3]) {
        win(k, u, yy, 1.5, 2.2, 0.1, { trim: 'graniteLight', pane: 'glass', bw: 0.24, depth: 0.32, sill: true });
      }
    }
    k.pop();
  }

  // courtyard-facing arcade and windows
  for (const [push, len] of [[{ z: zF - wing, ry: Math.PI }, W - 2 * wing], [{ z: zB + wing, ry: 0 }, W - 2 * wing]]) {
    k.push(push);
    k.arcade(len - 0.6, 4.4, 0.5, Math.max(3, Math.round((len - 0.6) / 4.5)), 1.8, 3.0, 'graniteLight');
    for (let i = 0; i < 5; i++) {
      const u = -len / 2 + (len / 5) * (i + 0.5);
      for (const yy of [5.5, 9.3]) win(k, u, yy, 1.4, 2.1, 0, { trim: 'granite', pane: 'glass', bw: 0.22, depth: 0.3, sill: true });
    }
    k.pop();
  }
  for (const [push, len] of [[{ x: -(W / 2 - wing), z: 0, ry: Math.PI / 2 }, D - 2 * wing], [{ x: (W / 2 - wing), z: 0, ry: -Math.PI / 2 }, D - 2 * wing]]) {
    k.push(push);
    k.arcade(len - 0.6, 4.4, 0.5, Math.max(3, Math.round((len - 0.6) / 4.5)), 1.8, 3.0, 'graniteLight');
    for (let i = 0; i < 4; i++) {
      const u = -len / 2 + (len / 4) * (i + 0.5);
      for (const yy of [5.5, 9.3]) win(k, u, yy, 1.4, 2.1, 0, { trim: 'granite', pane: 'glass', bw: 0.22, depth: 0.3, sill: true });
    }
    k.pop();
  }

  // courtyard well, garden and terrace walls
  k.cyl(1.6, 1.8, 1.2, 12, 'graniteDark', 0, 0, 0);
  k.box(2.4, 0.28, 2.4, 'granite', 0, 1.2, 0);
  k.tree(-W / 2 + wing + 5, 0, -6, 7, { kind: 'topiary' });
  k.tree(W / 2 - wing - 5, 0, 6, 7, { kind: 'topiary' });
  k.tree(-14, 0, zF - wing - 6, 6, { crown: 'oval' });
  k.tree(14, 0, zF - wing - 6, 6, { crown: 'oval' });
  k.lamp(5.6, -8, 0, zF + 3.0, { globe: true });
  k.lamp(5.6, 8, 0, zF + 3.0, { globe: true });

  done();
}
paco.metric = true;
paco.rule = { note: 'Paço Episcopal: four granite wings round a court with the entrance tower', fitTo: true };
export default { 'paco-episcopal': paco };
