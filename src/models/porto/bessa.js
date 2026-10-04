// Estádio do Bessa Século XXI, Porto (rebuilt 2003 for Boavista FC). A single-tier
// bowl with a continuous roof, granite-grey concrete, four floodlight pylons and
// the pitched green field inside. Authored 170 x 132 m, 30 m.
import { corniceProfile } from '../kit.js';
import { win } from '../parts.js';
import { rect, offset } from '../geom.js';
import { polyCornice } from '../metric.js';
import { fitTo } from './site-fit.js';

function bessa(k, site) {
  const W = 170;
  const D = 132;
  const H = 30;
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  const outer = rect(0, 0, W, D);
  const inner = rect(0, 0, 116, 80);

  // ------------------------------------------------------------------ field
  k.prism(rect(0, 0, W + 6, D + 6), -0.4, 0.4, 'sand');
  k.prism(rect(0, 0, 108, 72), 0, 0.16, 'grass');
  k.prism(rect(0, 0, 112, 76), 0, 0.08, 'grass');
  for (let i = 0; i < 5; i++) k.box(0.35, 0.02, 72, 'white', -54 + i * 27, 0.17, 0);
  k.box(108, 0.02, 0.35, 'white', 0, 0.17, 0);

  // ---------------------------------------------------------------- the bowl
  k.prism(outer, 0, 13, 'graniteGrey', { holes: [inner] });
  k.prism(offset(outer, 0.6), 0, 1.2, 'graniteDark', { holes: [offset(inner, -0.6)] });
  polyCornice(k, outer, 13, corniceProfile('band', 0.6), 'graniteLight');

  // concrete seating tiers on all four sides (rake toward the field)
  const seats = (push, width, run, x, z) => {
    k.push(push);
    k.stairs(width, run, 11.5, 14, 'seat', x, 13, z, { below: 13 });
    k.box(width, 0.5, 0.6, 'graniteLight', x, 24, z);
    k.pop();
  };
  seats({}, 110, 26, 0, -46);
  seats({ ry: Math.PI }, 110, 26, 0, 46);
  seats({ ry: Math.PI / 2 }, 76, 26, -64, 0);
  seats({ ry: -Math.PI / 2 }, 76, 26, 64, 0);

  // roof: a cantilevered ring over the stands, on a ring of raking columns
  const roofOuter = rect(0, 0, W + 8, D + 8);
  const roofInner = rect(0, 0, 96, 60);
  k.prism(roofInner, 26.5, 2.4, 'steel', { holes: [rect(0, 0, 88, 52)] });
  k.prism(roofOuter, 26.5, 2.4, 'steel', { holes: [roofInner] });
  k.prism(roofOuter, 28.9, 0.5, 'lead', { holes: [roofInner] });
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2;
    const rr = 1.02;
    k.box(0.5, 13.5, 0.5, 'steel', Math.sin(a) * 92 * rr * 0.55, 13, Math.cos(a) * 68 * rr * 0.55, { rx: -0.22, rz: Math.sin(a) * 0.2 });
  }

  // ------------------------------------------------------- outer facade skin
  for (const [push, len, n] of [[{}, W, 16], [{ ry: Math.PI }, W, 16], [{ ry: Math.PI / 2 }, D, 12], [{ ry: -Math.PI / 2 }, D, 12]]) {
    k.push(push);
    for (let i = 0; i < n; i++) {
      const u = -len / 2 + (len / n) * (i + 0.5);
      k.box(len / n - 0.7, 9.5, 0.6, 'graniteGrey', u, 0.4, 0.3);
      k.box(len / n - 1.2, 2.4, 0.9, 'dark', u, 10, 0.35);
      win(k, u, 3.2, len / n - 2.2, 5.0, 0.75, { trim: 'granite', pane: 'glass', bw: 0.24, depth: 0.3, head: 'flat' });
    }
    k.pop();
  }
  // corner stair towers
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    k.cyl(4.4, 4.8, 30, 12, 'graniteGrey', sx * (W / 2 + 3), 0, sz * (D / 2 + 3));
    k.corniceRing(9.4, 9.4, corniceProfile('eave', 0.5), 'graniteLight', sx * (W / 2 + 3), 24, sz * (D / 2 + 3));
  }

  // -------------------------------------------------------------- floodlights
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const px = sx * (W / 2 - 6);
    const pz = sz * (D / 2 - 6);
    k.box(1.6, 34, 1.6, 'steel', px, 0, pz);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
      k.box(0.9, 0.7, 0.5, 'dark', px + (c - 2) * 1.0, 34 + r * 0.9, pz + 0.6);
      k.box(0.7, 0.5, 0.2, 'window', px + (c - 2) * 1.0, 34 + r * 0.9 + 0.1, pz + 0.9, { emit: 0.5 });
    }
    k.box(6, 0.5, 2.4, 'steel', px, 30, pz);
  }

  // ------------------------------------------------------------ perimeter
  k.prism(rect(0, 0, W + 20, D + 20), -0.35, 0.35, 'sand', { holes: [rect(0, 0, W + 8, D + 8)] });
  for (let i = 0; i < 26; i++) {
    const t = (i / 25) * Math.PI * 2;
    k.tree(Math.sin(t) * 96, 0, Math.cos(t) * 74, 6.5, { crown: 'round' });
  }
  for (let i = 0; i < 8; i++) k.lamp(6, -78 + i * 22, 0, 62, { globe: true });

  done();
}
bessa.metric = true;
bessa.rule = {
  note: 'Estádio do Bessa: single-tier bowl, seats, cantilever roof, four pylons',
  fitTo: true,
};
export default { bessa };
