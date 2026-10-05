// Casa-Museu Marta Ortigão Sampaio, Porto (Foz). A two-storey 19th-century
// villa with a hipped roof and a small garden, now a museum and library of the
// Porto museum network. Authored on the mapped house + plot, 14.2 x 9 m, 12 m.
import { corniceProfile } from '../kit.js';
import { win, pediment, cartouche } from '../parts.js';
import { rect, offset } from '../geom.js';
import { polyCornice, polyWindows } from '../metric.js';
import { fitTo } from './site-fit.js';

function marta(k, site) {
  const W = 14.2;
  const D = 9;
  const H = 12;
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  const bodyH = 8.6;
  const fz = D / 2;

  // garden ground and low boundary walls with stone pilasters and coping
  k.prism(rect(0, 0, W + 8, D + 8), -0.15, 0.15, 'grass');
  const wallLen = W + 8;
  k.prism(rect(0, fz + 3.4, wallLen, 0.5), 0, 1.6, 'graniteDark');
  k.box(wallLen, 0.3, 0.8, 'graniteLight', 0, 1.6, fz + 3.4);
  for (const sx of [-1, 1]) {
    k.prism(rect(sx * (W / 2 + 4), 0, 0.5, D + 8), 0, 1.6, 'graniteDark');
    k.box(0.8, 0.3, D + 8, 'graniteLight', sx * (W / 2 + 4), 1.6, 0);
    for (const pz of [-fz - 3, 0, fz + 3]) {
      k.box(0.8, 2.1, 0.8, 'granite', sx * (W / 2 + 4), 0, pz);
      k.box(1.0, 0.3, 1.0, 'graniteLight', sx * (W / 2 + 4), 2.1, pz);
      k.urn(0.85, 'graniteLight', sx * (W / 2 + 4), 2.4, pz);
    }
  }

  // the villa
  k.prism(offset(rect(0, 0, W, D), 0.35), 0, 1.0, 'graniteDark');
  k.prism(rect(0, 0, W, D), 0, bodyH, 'rose');
  // quoins at the corners
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    for (let i = 0; i < 8; i++) {
      const w = i % 2 ? 0.55 : 0.8;
      k.box(w, 1.05, 0.22, 'plaster', sx * (W / 2 - w / 2 + 0.02), 0.6 + i * 1.0, sz * (D / 2 + 0.02));
    }
  }
  polyCornice(k, rect(0, 0, W, D), bodyH - 0.4, corniceProfile('eave', 0.5), 'plaster');
  k.hipRoof(W + 0.8, D + 0.8, 3.4, 'terracotta', 0, bodyH, 0, { over: 0.7 });
  // ridge tiles and a cockerel weathervane
  for (let i = 0; i < 14; i++) k.box(0.4, 0.16, 0.5, 'terracotta', -W / 2 + (W / 13) * i, bodyH + 3.55, 0);
  k.box(0.14, 1.3, 0.14, 'iron', 0, bodyH + 3.7, 0);
  k.box(0.7, 0.5, 0.1, 'iron', 0.3, bodyH + 4.6, 0);
  // chimneys with pots
  for (const [cx2, cz2] of [[-W / 2 + 2.2, -1.4], [W / 2 - 2.2, 1.6]]) {
    k.box(1.3, 2.4, 1.3, 'rose', cx2, bodyH + 1.2, cz2);
    k.box(1.7, 0.35, 1.7, 'graniteLight', cx2, bodyH + 3.6, cz2);
    for (const g of [-1, 1]) k.cyl(0.22, 0.22, 0.75, 6, 'terracotta', cx2 + g * 0.35, bodyH + 3.95, cz2);
  }
  // two dormers on the front slope
  for (const dx of [-4.2, 4.2]) {
    k.box(1.6, 1.5, 1.3, 'rose', dx, bodyH + 1.1, fz - 1.4);
    k.push({ x: dx, z: fz - 1.4 });
    k.gableRoof(1.7, 1.5, 0.7, 'terracotta', 0, bodyH + 2.6, 0, { over: 0.25, ridge: false, ry: Math.PI / 2 });
    k.pop();
    win(k, dx, bodyH + 1.4, 0.9, 1.0, fz - 0.75, { trim: 'plaster', pane: 'glass', bw: 0.16, depth: 0.2 });
  }

  // front: porch, balcony, door, pediment and windows
  k.box(4.2, 0.35, 1.7, 'plaster', 0, 4.4, fz + 0.8);
  k.box(4.6, 0.25, 2.0, 'graniteLight', 0, 4.75, fz + 0.85);
  for (const sx of [-1, 1]) k.box(0.4, 4.4, 0.4, 'graniteLight', sx * 1.9, 0, fz + 1.3);
  pediment(k, 4.6, 1.4, 0.7, 'plaster', 0, 4.75, fz + 0.85, { frame: 0.3 });
  cartouche(k, 1.6, 2.0, 0.6, 'graniteLight', 0, 2.2, fz + 0.6, { crown: 'plaster' });
  k.surround({ x: 0, y: 0, w: 2.0, h: 3.4, arch: 'round' }, 0.28, 0.4, 'graniteLight', fz + 0.6);
  win(k, 0, 0.2, 1.8, 3.0, fz + 0.3, { arch: 'round', trim: 'graniteLight', pane: 'wood', bw: 0.3, depth: 0.35 });
  // first-floor balcony with an iron railing and French doors
  k.box(4.8, 0.3, 1.9, 'graniteLight', 0, 4.75, fz + 0.8);
  k.balustrade(4.6, 1.0, 'iron', 0, 5.05, fz + 1.7, { cheap: true, d: 0.12, sp: 0.3 });
  win(k, 0, 5.1, 1.7, 2.6, fz + 0.4, { trim: 'plaster', pane: 'glass', bw: 0.26, depth: 0.3, sill: true, head: 'flat' });
  for (const sx of [-1, 1]) {
    win(k, sx * 4.6, 1.2, 1.5, 2.6, fz + 0.15, { trim: 'plaster', pane: 'glass', bw: 0.26, depth: 0.3, sill: true, head: 'flat' });
    win(k, sx * 4.6, 5.6, 1.5, 2.4, fz + 0.15, { trim: 'plaster', pane: 'glass', bw: 0.26, depth: 0.3, sill: true, head: 'tri' });
    k.box(1.9, 0.3, 0.3, 'graniteLight', sx * 4.6, 1.0, fz + 0.4);
  }
  k.box(W - 1, 0.3, 0.35, 'plaster', 0, 4.5, fz + 0.18);

  // flanks and back with matching windows and stone heads
  const side = (sx) => {
    k.push({ x: sx * W / 2, z: 0, ry: sx * Math.PI / 2 });
    for (const u of [-2.6, 0, 2.6]) for (const yy of [1.2, 5.6]) {
      win(k, u, yy, 1.4, 2.4, 0.05, { trim: 'plaster', pane: 'glass', bw: 0.24, depth: 0.28, sill: true, head: 'flat' });
    }
    k.pop();
  };
  side(-1); side(1);
  k.push({ z: -fz, ry: Math.PI });
  for (const u of [-3.8, -1.2, 1.2, 3.8]) for (const yy of [1.2, 5.6]) {
    win(k, u, yy, 1.4, 2.4, 0.05, { trim: 'plaster', pane: 'glass', bw: 0.24, depth: 0.28, sill: true });
  }
  k.pop();

  // glazed conservatory/veranda leaning on the rear elevation
  k.prism(rect(0, -fz - 1.3, 8.0, 2.4), 0, 2.6, 'plaster');
  k.box(7.6, 2.0, 0.12, 'glass', 0, 0.5, -fz - 2.45, { emit: 0.08 });
  for (let i = 0; i <= 7; i++) k.box(0.12, 2.0, 0.2, 'iron', -3.8 + i * (7.6 / 7), 0.5, -fz - 2.52);
  k.box(8.0, 0.25, 2.6, 'lead', 0, 2.6, -fz - 1.3);
  k.box(7.6, 0.2, 1.0, 'glass', 0, 2.65, -fz - 2.2, { ry: -0.35, emit: 0.06 });

  // coach house / annex at the rear of the garden
  k.prism(rect(-7.2, -9.4, 6.0, 5.0), 0, 4.2, 'plaster');
  k.prism(offset(rect(-7.2, -9.4, 6.0, 5.0), 0.2), 0, 0.5, 'graniteDark');
  polyCornice(k, rect(-7.2, -9.4, 6.0, 5.0), 4.2, corniceProfile('eave', 0.4), 'graniteLight');
  k.push({ x: -7.2, z: -9.4 });
  k.hipRoof(6.4, 5.4, 2.0, 'terracotta', 0, 4.2, 0, { over: 0.5 });
  k.pop();
  k.surround({ x: 0, y: 0, w: 2.4, h: 2.8, arch: 'seg' }, 0.28, 0.4, 'graniteLight', -9.0);
  k.box(2.4, 2.8, 0.15, 'wood', -7.2, 0, -11.85);
  win(k, -4.6, 2.6, 0.9, 1.1, -11.85, { trim: 'plaster', pane: 'glass', bw: 0.16, depth: 0.2 });

  // garden: gravel path, gate piers, hedges, trees and beds
  k.prism(rect(0, fz + 2.6, 2.0, 4.0), 0.02, 0.12, 'sand');
  k.prism(rect(-3.0, -3.0, 12.0, 2.0), 0.02, 0.12, 'sand');
  for (const sx of [-1, 1]) {
    k.box(0.6, 0.7, 6.0, 'hedge', sx * (W / 2 + 2.2), 0, fz + 1.0);
    k.tree(sx * 5.6, 0, fz + 5.0, 6.5, { crown: 'oval' });
  }
  k.tree(-5.5, 0, -fz - 5.0, 7, { crown: 'round' });
  k.tree(5.0, 0, -fz - 4.5, 6, { crown: 'oval' });
  // stone gate piers and iron railings at the street front
  for (const sx of [-1, 1]) {
    k.box(0.6, 2.4, 0.6, 'granite', sx * 1.6, 0, fz + 5.6);
    k.box(0.8, 0.3, 0.8, 'graniteLight', sx * 1.6, 2.4, fz + 5.6);
  }
  k.box(2.6, 1.6, 0.08, 'iron', 0, 0, fz + 5.6);
  for (let i = 0; i < 12; i++) k.box(0.1, 1.4, 0.1, 'iron', -5.2 + i * 0.95, 0, fz + 5.65);
  k.box(11.0, 0.1, 0.1, 'iron', 0, 1.4, fz + 5.65);
  k.lamp(3.4, 3.0, 0, fz + 3.2, { globe: true });
  // museum sign plate
  k.box(2.4, 0.7, 0.12, 'white', 0, 4.8, fz + 1.75);
  k.box(0.18, 2.4, 0.18, 'iron', W / 2 + 3, 0, fz + 4.6);

  // parterre: a box-hedge knot with gravel walks and clipped topiary
  const knot = [[-5.0, fz + 1.0], [-1.0, fz + 1.0], [-1.0, fz + 5.0], [-5.0, fz + 5.0]];
  k.prism(offset(knot, -0.6), 0.02, 0.45, 'hedge');
  k.prism(knot, 0.02, 0.4, 'hedge', { holes: [offset(knot, -0.5)] });
  k.tree(-3.0, 0, fz + 3.0, 2.6, { kind: 'topiary' });
  k.tree(-3.0, 0, fz + 1.4, 2.2, { kind: 'topiary' });
  k.tree(-3.0, 0, fz + 4.6, 2.2, { kind: 'topiary' });
  // sundial on the lawn
  k.box(0.7, 1.1, 0.7, 'graniteLight', 6.0, 0, -2.0);
  k.cyl(0.5, 0.6, 0.25, 10, 'graniteLight', 6.0, 1.1, -2.0);
  k.box(0.08, 1.0, 0.5, 'bronze', 6.0, 1.2, -2.0, { rz: 0.6 });
  // small glazed greenhouse
  k.box(3.0, 0.5, 2.0, 'graniteDark', 6.5, 0, -6.0);
  k.prism(rect(6.5, -6.0, 3.0, 2.0), 0.5, 1.6, 'glass', { emit: 0.05 });
  for (const u of [-1.5, -0.5, 0.5, 1.5]) k.box(0.1, 1.6, 0.1, 'iron', 6.5 + u, 0.5, -6.0);
  k.push({ x: 6.5, z: -6.0 });
  k.gableRoof(3.0, 2.0, 0.7, 'glass', 0, 2.1, 0, { over: 0.15, ridge: false });
  k.pop();

  // --- detail pass: roof clutter, shutters, garden furniture and beds
  for (let i = 0; i < 11; i++) {
    k.box(0.4, 0.22, 0.4, 'terracotta', -W / 2 + (W / 10) * i, bodyH + 3.3, 0);
  }
  for (const sx of [-1, 1]) {
    k.box(1.0, 2.0, 1.0, 'rose', sx * 3.4, bodyH, -1.6);
    k.box(1.3, 0.3, 1.3, 'graniteLight', sx * 3.4, bodyH + 2.0, -1.6);
    k.box(1.4, 1.0, 1.0, 'rose', sx * 2.0, bodyH + 0.6, 1.8);
    k.push({ x: sx * 2.0, z: 1.8 });
    k.gableRoof(1.4, 1.0, 0.5, 'terracotta', 0, bodyH + 1.6, 0, { over: 0.15, ridge: false });
    k.pop();
  }
  // shutters beside the front and flank windows
  for (const sx of [-1, 1]) for (const yy of [1.2, 5.6]) for (const s of [-1, 1]) {
    k.box(0.28, 2.5, 0.12, 'doorBlue', sx * 4.6 + s * 1.0, yy, fz + 0.2);
  }
  for (const yy of [1.2, 5.6]) for (const s of [-1, 1]) k.box(0.28, 2.5, 0.12, 'doorBlue', s * 1.0, yy, fz + 0.2);
  for (const sx of [-1, 1]) for (const u of [-2.6, 0, 2.6]) for (const yy of [1.2, 5.6]) {
    k.push({ x: sx * (W / 2 + 0.08), z: u, ry: sx * Math.PI / 2 });
    for (const s of [-1, 1]) k.box(0.28, 2.5, 0.12, 'doorBlue', s * 0.95, yy, 0);
    k.pop();
  }
  // garden: pergola, fountain, flower beds, rose arches and benches
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) k.box(0.22, 2.6, 0.22, 'wood', sx * 4.2, 0, -1 + i * 3.2);
  k.box(8.8, 0.22, 0.22, 'wood', 0, 2.4, -1, { ry: Math.PI / 2 });
  k.box(8.8, 0.22, 0.22, 'wood', 0, 2.4, 5.4, { ry: Math.PI / 2 });
  for (let i = 0; i < 8; i++) k.box(0.16, 0.16, 8.4, 'wood', -4.2 + i * 1.2, 2.6, 2.2, { ry: Math.PI / 2 });
  k.cyl(1.3, 1.5, 0.7, 12, 'graniteLight', -4.5, 0, -fz - 2.5);
  k.cyl(0.3, 0.4, 1.4, 8, 'graniteLight', -4.5, 0.7, -fz - 2.5);
  k.sphere(0.3, 'water', -4.5, 2.1, -fz - 2.5);
  for (const [fx, fzz] of [[3.5, -fz - 2], [3.5, -fz - 5]]) {
    k.box(3.2, 0.4, 1.4, 'graniteLight', fx, 0.1, fzz);
    for (let i = 0; i < 5; i++) k.sphere(0.28, 'flowerRed', fx - 1.4 + i * 0.7, 0.5, fzz, { seg: 6, rings: 4, flat: true });
  }
  for (const bx of [-4.5, 4.5]) {
    k.box(1.6, 0.16, 0.5, 'wood', bx, 0.5, -3.5);
    k.box(0.16, 0.5, 0.16, 'iron', bx - 0.6, 0, -3.5);
    k.box(0.16, 0.5, 0.16, 'iron', bx + 0.6, 0, -3.5);
  }
  k.tree(-5.8, 0, 1.0, 5.5, { crown: 'round' });
  k.tree(5.8, 0, -1.0, 5.0, { crown: 'oval' });
  // rose arches and clipped cones
  for (const ax of [-2.2, 2.2]) {
    k.push({ x: ax, z: fz + 6.5 });
    for (const s of [-1, 1]) k.box(0.12, 2.2, 0.12, 'iron', s * 0.9, 0, 0);
    k.cyl(0.9, 0.9, 0.12, 10, 'iron', 0, 2.2, 0, { rx: Math.PI / 2, t0: 0, tl: Math.PI });
    k.pop();
  }
  for (const tz of [fz - 4.5, -fz - 6.5]) k.tree(6.8, 0, tz, 3.4, { kind: 'topiary' });

  done();
}
marta.metric = true;
marta.rule = { note: 'Casa-Museu Marta Ortigão Sampaio: two-storey Foz villa with a garden', fitTo: true };
export default { 'casa-museu-marta-ortigao-sampaio': marta };
