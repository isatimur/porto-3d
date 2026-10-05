// Mercado Municipal de Matosinhos (project 1936, opened 1952). A big covered
// market hall in the iron-and-glass tradition: granite arcades on the long
// sides, cast-iron columns and triangulated roof trusses carrying a glazed
// nave roof with a ridge lantern, gabled entrance bays and the stall grid
// inside. Authored 95.2 x 57 m, 15 m.
import { corniceProfile } from '../kit.js';
import { win, pediment, cartouche, tablet } from '../parts.js';
import { rect, offset } from '../geom.js';
import { polyCornice } from '../metric.js';
import { fitTo } from './site-fit.js';

function mercado(k, site) {
  const W = 95.2;
  const D = 57;
  const H = 15;
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  const wallH = 6.5;
  const eaveY = wallH + 2.6; // top of the glazed clerestory
  const ridgeY = eaveY + 5.0;
  const body = rect(0, 0, W, D);
  k.prism(offset(body, 0.4), 0, 1.0, 'graniteDark');
  k.prism(body, 0, wallH, 'cream');

  // cornice and a glazed clerestory band over the walls
  polyCornice(k, body, wallH, corniceProfile('eave', 0.6), 'graniteLight');
  k.prism(body, wallH, 2.6, 'graniteLight', { holes: [rect(0, 0, W - 2, D - 2)] });
  for (const [push, len, n] of [[{}, W, 20], [{ ry: Math.PI }, W, 20], [{ ry: Math.PI / 2 }, D, 12], [{ ry: -Math.PI / 2 }, D, 12]]) {
    k.push(push);
    for (let i = 0; i < n; i++) {
      const u = -len / 2 + (len / n) * (i + 0.5);
      win(k, u, wallH + 0.5, (len / n) * 0.7, 1.8, 0.05, { trim: 'graniteLight', pane: 'glass', bw: 0.2, depth: 0.24 });
      k.box(0.12, 2.2, 0.14, 'iron', u + (len / n) * 0.34, wallH + 0.4, 0.18);
    }
    k.pop();
  }

  // granite arcades along both long sides, with voussoirs, keystones and gates
  for (const sz of [-1, 1]) {
    k.push({ z: sz * (D / 2 - 0.6), ry: sz > 0 ? 0 : Math.PI });
    k.arcade(W - 6, wallH, 1.0, 11, 4.6, 5.4, 'granite');
    for (let i = 0; i < 11; i++) {
      const u = -(W - 6) / 2 + ((W - 6) / 11) * (i + 0.5);
      k.surround({ x: u, y: 0, w: 4.6, h: 5.4, arch: 'round' }, 0.35, 0.5, 'graniteLight', 0.7);
      k.box(5.2, 0.6, 1.4, 'graniteLight', u, wallH - 0.2, 0.6);
      const r = 2.3;
      for (let j = 0; j <= 6; j++) {
        const a = Math.PI - (j / 6) * Math.PI;
        k.box(0.55, 0.4, 0.34, 'graniteLight', u + Math.cos(a) * r, 5.4 - r + Math.sin(a) * r - 0.2, 1.15, { rz: a - Math.PI / 2 });
      }
      // folded-back iron gates in each arch
      for (const s of [-1, 1]) {
        k.box(0.1, 4.4, 2.0, 'iron', u + s * 2.5, 0.3, 0.9);
        for (let g = 0; g < 4; g++) k.box(0.16, 4.4, 0.12, 'iron', u + s * (1.6 + g * 0.55), 0.3, 0.9);
        k.box(0.16, 0.16, 2.0, 'iron', u + s * 2.5, 3.0, 0.9);
      }
    }
    k.pop();
  }

  // cast-iron columns: two interior rows plus a perimeter ring at the walls
  for (const cz of [-D / 6, D / 6]) {
    for (let i = 0; i < 13; i++) {
      const x = -W / 2 + 4 + i * ((W - 8) / 12);
      k.box(0.9, 0.5, 0.9, 'graniteDark', x, 0, cz);
      k.cyl(0.32, 0.4, eaveY - 0.5, 10, 'iron', x, 0.5, cz, { smooth: true });
      k.box(0.8, 0.35, 0.8, 'iron', x, eaveY - 0.7, cz);
      k.cyl(0.22, 0.3, 0.6, 8, 'iron', x, eaveY - 0.35, cz);
    }
  }

  // triangulated cast-iron roof trusses across the hall
  const z0 = -D / 2 + 1.2;
  const z1 = D / 2 - 1.2;
  for (let i = 0; i < 14; i++) {
    const x = -W / 2 + 3 + i * ((W - 6) / 13);
    k.segment([x, eaveY, z0], [x, eaveY, z1], 0.35, 0.35, 'iron', { round: true, seg: 5 });
    k.segment([x, eaveY, z0], [x, ridgeY, 0], 0.3, 0.3, 'iron', { round: true, seg: 5 });
    k.segment([x, ridgeY, 0], [x, eaveY, z1], 0.3, 0.3, 'iron', { round: true, seg: 5 });
    for (let j = 1; j < 6; j++) {
      const t = j / 6;
      const z = z0 + (z1 - z0) * t;
      const yT = eaveY + (ridgeY - eaveY) * (1 - Math.abs(2 * t - 1));
      k.segment([x, eaveY, z], [x, yT, z], 0.16, 0.16, 'iron', { round: true, seg: 4 });
      if (j % 2) k.segment([x, eaveY, z], [x, yT, z + (z1 - z0) / 12], 0.13, 0.13, 'iron', { round: true, seg: 4 });
    }
    k.segment([x, eaveY, z0], [x, eaveY + 1.7, z0 - 0.6], 0.2, 0.2, 'iron', { round: true, seg: 4 });
    k.segment([x, eaveY, z1], [x, eaveY + 1.7, z1 + 0.6], 0.2, 0.2, 'iron', { round: true, seg: 4 });
  }

  // glazed nave roof: two slopes of glass with iron glazing bars and purlins
  k.push({ ry: Math.PI / 2 });
  k.gableRoof(D + 1.4, W + 1.0, ridgeY - eaveY, 'glass', 0, eaveY, 0, { over: 0.3, ridge: false });
  k.pop();
  const slopePt = (t, sz) => ({ z: sz * (D / 2 + 0.7) * (1 - t), y: eaveY + (ridgeY - eaveY) * t });
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 30; i++) {
      const x = -W / 2 + i * (W / 29);
      const a = slopePt(0, sz);
      const b = slopePt(1, sz);
      k.segment([x, a.y, a.z], [x, b.y, b.z], 0.14, 0.14, 'iron', { round: true, seg: 4 });
    }
    for (let t = 0.12; t < 1; t += 0.18) {
      const p = slopePt(t, sz);
      k.segment([-W / 2, p.y, p.z], [W / 2, p.y, p.z], 0.12, 0.12, 'iron', { round: true, seg: 4 });
    }
    // tiled eaves strip along the eave
    k.box(W + 1.0, 0.3, 1.2, 'terracotta', 0, eaveY - 0.1, sz * (D / 2 + 0.9));
  }
  // glazed ridge lantern with cross ventilators
  k.prism(rect(0, 0, W * 0.82, 2.2), ridgeY, 1.6, 'iron', { holes: [rect(0, 0, W * 0.82 - 0.4, 1.6)] });
  k.box(W * 0.8, 1.3, 0.15, 'glass', 0, ridgeY + 0.15, 1.0, { emit: 0.06 });
  k.box(W * 0.8, 1.3, 0.15, 'glass', 0, ridgeY + 0.15, -1.0, { emit: 0.06 });
  k.push({ ry: Math.PI / 2 });
  k.gableRoof(2.6, W * 0.84, 1.0, 'lead', 0, ridgeY + 1.6, 0, { over: 0.2, ridge: false });
  k.pop();
  for (let i = 0; i < 6; i++) {
    const x = -W * 0.4 + i * (W * 0.8 / 5);
    k.cyl(0.45, 0.55, 1.1, 8, 'iron', x, ridgeY + 2.4, 0);
    k.cone(0.7, 0.5, 8, 'steel', x, ridgeY + 3.5, 0);
  }

  // gabled entrance bays on the two short ends with the market name
  for (const sz of [-1, 1]) {
    k.push({ z: sz * (D / 2 + 0.4), ry: sz > 0 ? 0 : Math.PI });
    k.box(16, wallH + 2.5, 1.4, 'cream', 0, 0, 0);
    k.arcade(16, wallH, 1.2, 3, 3.6, 5.2, 'granite');
    for (let i = 0; i < 3; i++) {
      const u = -5.3 + i * 5.3;
      k.surround({ x: u, y: 0, w: 3.6, h: 5.2, arch: 'round' }, 0.32, 0.45, 'graniteLight', 0.75);
      k.box(0.1, 4.2, 2.2, 'iron', u - 1.2, 0.2, 0.95);
      k.box(0.1, 4.2, 2.2, 'iron', u + 1.2, 0.2, 0.95);
    }
    k.corniceRing(16, 1.4, corniceProfile('classic', 0.6), 'graniteLight', 0, wallH + 2.5, 0);
    pediment(k, 15, 3.6, 1.6, 'graniteLight', 0, wallH + 2.5, 0.7, { frame: 0.5 });
    cartouche(k, 2.6, 3.2, 0.7, 'graniteLight', 0, wallH + 3.4, 0.9, { crown: 'granite' });
    tablet(k, 7.0, 1.5, 0.5, 'graniteLight', 0, wallH + 0.6, 1.0, { lines: 1, ink: 'dark' });
    // clock
    k.cyl(1.1, 1.1, 0.3, 16, 'graniteLight', 0, wallH + 1.4, 1.0, { rx: Math.PI / 2 });
    k.cyl(0.85, 0.85, 0.2, 16, 'white', 0, wallH + 1.4, 1.2, { rx: Math.PI / 2 });
    k.box(0.1, 0.7, 0.06, 'dark', 0, wallH + 1.45, 1.35);
    k.box(0.5, 0.1, 0.06, 'dark', 0, wallH + 1.4, 1.35);
    k.pop();
  }

  // interior stall grid with canvas awnings, goods, scales and hanging lamps
  for (let i = 0; i < 9; i++) for (let j = 0; j < 4; j++) {
    const x = -W / 2 + 7 + i * 10;
    const z = -D / 2 + 10 + j * 11;
    k.box(4.4, 1.0, 2.4, 'wood', x, 0, z);
    k.box(4.6, 0.12, 2.6, 'graniteLight', x, 1.0, z);
    k.box(3.8, 1.4, 0.12, 'white', x, 1.1, z - 1.2);
    // striped awning over the stall
    for (let s = 0; s < 6; s++) k.box(0.72, 0.1, 2.4, s % 2 ? 'cream' : 'terracotta', x - 2.1 + (s + 0.5) * 0.7, 2.7, z + 0.6, { rx: 0.28 });
    for (const s of [-1, 1]) k.box(0.08, 2.7, 0.08, 'iron', x + s * 2.3, 0, z + 1.6);
    // crates and a scale
    k.box(0.9, 0.6, 0.7, 'wood', x - 1.4, 1.0, z + 0.9);
    k.box(0.9, 0.6, 0.7, 'wood', x + 1.4, 1.0, z + 0.9);
    k.box(0.5, 0.35, 0.5, 'bronze', x, 1.0, z + 0.9);
    k.cyl(0.3, 0.35, 1.0, 6, 'steel', x, eaveY - 1.9, z, { smooth: true });
    k.sphere(0.34, 'window', x, eaveY - 0.9, z, { seg: 8, rings: 5, emit: 0.5 });
  }

  // pavement, trees, lamps and bollards around the market
  k.prism(rect(0, 0, W + 14, D + 14), -0.1, 0.1, 'sand', { holes: [rect(0, 0, W + 4, D + 4)] });
  for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) {
    k.tree(sx * (W / 2 + 5), 0, -D / 2 + 6 + i * 11, 6, { crown: 'round' });
  }
  for (const sx of [-1, 1]) {
    k.lamp(6.5, sx * (W / 2 + 3), 0, D / 2 + 4, { globe: true });
    for (let i = 0; i < 6; i++) k.box(0.3, 0.9, 0.3, 'iron', sx * (W / 2 + 3), 0, -D / 2 + 5 + i * 10);
  }

  done();
}
mercado.metric = true;
mercado.rule = { note: 'Mercado de Matosinhos: arcaded hall, iron trusses, glazed nave roof', fitTo: true };
export default { 'mercado-matosinhos': mercado };
