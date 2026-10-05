// Estádio do Bessa Século XXI, Porto (rebuilt 2003 for Boavista FC). A
// single-tier bowl with a continuous cantilevered roof, four lattice
// floodlight pylons, turnstile gates in the granite skin and the green field
// with its markings and goals inside. Authored 170 x 132 m, 30 m.
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
  // pitch markings: halfway, centre circle and spot, penalty and goal areas
  k.box(108, 0.02, 0.35, 'white', 0, 0.17, 0);
  k.box(0.35, 0.02, 72, 'white', 0, 0.17, 0);
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    k.box(1.3, 0.02, 0.3, 'white', Math.cos(a) * 9.15, 0.17, Math.sin(a) * 9.15, { ry: a });
  }
  k.cyl(0.3, 0.3, 0.03, 10, 'white', 0, 0.17, 0);
  for (const sx of [-1, 1]) {
    k.box(0.3, 0.02, 40.32, 'white', sx * 37.5, 0.17, 0);
    k.box(16.5, 0.02, 0.3, 'white', sx * 44.25, 0.17, 20.16);
    k.box(16.5, 0.02, 0.3, 'white', sx * 44.25, 0.17, -20.16);
    k.box(0.3, 0.02, 18.32, 'white', sx * 47, 0.17, 0);
    k.box(5.5, 0.02, 0.3, 'white', sx * 49.25, 0.17, 9.16);
    k.box(5.5, 0.02, 0.3, 'white', sx * 49.25, 0.17, -9.16);
    // goal frame and net
    for (const s of [-1, 1]) k.box(0.16, 2.44, 0.16, 'white', sx * 52, 0.17, s * 3.66);
    k.box(0.16, 0.16, 7.32, 'white', sx * 52, 2.61, 0);
    for (const s of [-1, 1]) k.box(0.16, 2.44, 0.16, 'white', sx * 52, 0.17, s * 3.66);
    k.box(0.1, 2.3, 0.1, 'white', sx * 54, 0.2, 3.6);
    k.box(0.1, 2.3, 0.1, 'white', sx * 54, 0.2, -3.6);
    k.box(0.1, 0.1, 7.2, 'white', sx * 54, 2.4, 0);
    for (let i = 0; i < 7; i++) {
      const z = -3.3 + i * 1.1;
      k.box(2.0, 0.03, 0.05, 'white', sx * 53, 0.4 + i * 0.3, z);
    }
    for (let i = 0; i < 5; i++) k.box(2.0, 0.03, 0.05, 'white', sx * 53, 0.5 + i * 0.45, 3.5);
    // corner arcs
    const cx0 = sx * 52;
    const cz0 = sx > 0 ? 34 : 34;
    k.box(0.3, 0.02, 0.3, 'white', cx0, 0.17, cz0);
  }
  // corner flags
  for (const [fx, fz] of [[-52, -34], [-52, 34], [52, -34], [52, 34]]) {
    k.cyl(0.06, 0.06, 1.6, 5, 'white', fx, 0.16, fz);
    k.box(0.6, 0.4, 0.03, 'gold', fx + 0.3, 1.3, fz);
  }
  // dugouts and a tunnel on the west touchline
  for (const dz of [-14, 14]) {
    k.box(6.0, 0.4, 3.0, 'seat', -49, 0.4, dz);
    k.box(6.0, 2.0, 0.15, 'glass', -49, 0.8, dz - 1.4, { emit: 0.05 });
    k.box(6.2, 0.3, 3.2, 'graniteDark', -49, 2.8, dz);
    for (const s of [-1, 1]) k.box(0.2, 2.4, 0.2, 'steel', -49 + s * 3, 0.4, dz + 1.4);
  }
  k.box(3.0, 2.6, 1.0, 'dark', -55, 0, 0);

  // ---------------------------------------------------------------- the bowl
  k.prism(outer, 0, 13, 'graniteGrey', { holes: [inner] });
  k.prism(offset(outer, 0.6), 0, 1.2, 'graniteDark', { holes: [offset(inner, -0.6)] });
  polyCornice(k, outer, 13, corniceProfile('band', 0.6), 'graniteLight');
  // vomitory recesses in the bowl wall
  for (const [push, len, n] of [[{}, W, 10], [{ ry: Math.PI }, W, 10], [{ ry: Math.PI / 2 }, D, 6], [{ ry: -Math.PI / 2 }, D, 6]]) {
    k.push(push);
    for (let i = 0; i < n; i++) {
      const u = -len / 2 + (len / n) * (i + 0.5);
      k.box(2.6, 4.0, 0.8, 'dark', u, 0, 59);
      k.box(3.0, 0.5, 1.0, 'graniteLight', u, 4.0, 59.2);
    }
    k.pop();
  }

  // concrete seating tiers on all four sides (rake toward the field)
  const seats = (push, width, run, x, z) => {
    k.push(push);
    k.stairs(width, run, 11.5, 14, 'seat', x, 13, z, { below: 13 });
    k.box(width, 0.5, 0.6, 'graniteLight', x, 24, z);
    // row nosings in the Boavista black-and-white banding
    for (let r = 0; r < 13; r++) {
      k.box(width - 2, 0.16, 0.55, r % 2 ? 'white' : 'dark', x, 13.4 + r * 0.82, z - 0.6 - r * (run / 14));
    }
    // radial aisles and a front safety rail
    for (let a = -3; a <= 3; a++) k.box(0.6, 11.6, 0.5, 'graniteLight', x + a * (width / 8), 13, z - 0.5, { rx: -0.42 });
    for (let b = 0; b < 24; b++) k.box(0.14, 1.1, 0.14, 'iron', x - width / 2 + 1 + b * ((width - 2) / 23), 13, z - 0.8);
    k.box(width - 1, 0.12, 0.12, 'iron', x, 14.1, z - 0.8);
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
  // roof underside trusses, purlins and fascia
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2;
    const rr = 1.02;
    const px = Math.sin(a) * 92 * rr * 0.55;
    const pz = Math.cos(a) * 68 * rr * 0.55;
    k.box(0.5, 13.5, 0.5, 'steel', px, 13, pz, { rx: -0.22, rz: Math.sin(a) * 0.2 });
    k.segment([px, 24.5, pz], [px * 1.35, 26.6, pz * 1.35], 0.3, 0.3, 'steel', { round: true, seg: 4 });
    k.segment([px, 24.5, pz], [px - Math.sin(a) * 10, 26.8, pz - Math.cos(a) * 10], 0.24, 0.24, 'steel', { round: true, seg: 4 });
  }
  k.prism(roofOuter, 27.6, 0.35, 'graniteGrey', { holes: [roofInner] });
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    k.box(0.2, 0.4, 0.2, 'steel', Math.sin(a) * 88, 28.9, Math.cos(a) * 66, { ry: a });
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
    // turnstile gates and ticket windows at intervals
    for (let i = 0; i < n / 2; i++) {
      const u = -len / 2 + (len / (n / 2)) * (i + 0.5);
      k.box(3.4, 2.4, 0.4, 'dark', u, 0, 0.9);
      k.box(0.35, 2.4, 0.7, 'steel', u - 1.7, 0, 0.9);
      k.box(0.35, 2.4, 0.7, 'steel', u + 1.7, 0, 0.9);
      k.box(4.0, 0.3, 1.6, 'graniteLight', u, 2.4, 1.2);
      k.box(2.4, 1.1, 0.4, 'graniteLight', u + 3.0, 1.5, 0.95);
      win(k, u + 3.0, 1.7, 1.8, 0.8, 1.15, { trim: 'granite', pane: 'window', bw: 0.14, depth: 0.16, emit: 0.4 });
    }
    k.pop();
  }
  // corner stair towers with glazing, louvres and caps
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const tx = sx * (W / 2 + 3);
    const tz = sz * (D / 2 + 3);
    k.cyl(4.4, 4.8, 30, 12, 'graniteGrey', tx, 0, tz);
    k.corniceRing(9.4, 9.4, corniceProfile('eave', 0.5), 'graniteLight', tx, 24, tz);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      k.box(1.6, 8.0, 0.4, 'glass', tx + Math.sin(a) * 4.7, 15, tz + Math.cos(a) * 4.7, { ry: a, emit: 0.06 });
      k.box(0.5, 3.0, 0.5, 'steel', tx + Math.sin(a) * 4.6, 24.5, tz + Math.cos(a) * 4.6, { ry: a });
    }
    k.cyl(4.0, 4.6, 1.0, 12, 'graniteLight', tx, 29.0, tz);
    k.dome(4.1, 'steel', tx, 30.0, tz, { seg: 12, rings: 5 });
  }

  // -------------------------------------------------------------- floodlights
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const px = sx * (W / 2 - 6);
    const pz = sz * (D / 2 - 6);
    // lattice mast
    for (const ox of [-0.9, 0.9]) for (const oz of [-0.9, 0.9]) {
      k.box(0.35, 34, 0.35, 'steel', px + ox, 0, pz + oz);
    }
    for (let r = 0; r < 11; r++) {
      k.box(2.2, 0.18, 0.18, 'steel', px, 1 + r * 3, pz - 0.9);
      k.box(2.2, 0.18, 0.18, 'steel', px, 1 + r * 3, pz + 0.9);
      k.box(0.18, 0.18, 2.2, 'steel', px - 0.9, 1 + r * 3, pz);
      k.box(0.18, 0.18, 2.2, 'steel', px + 0.9, 1 + r * 3, pz);
      k.segment([px - 0.9, 1 + r * 3, pz - 0.9], [px + 0.9, 4 + r * 3, pz + 0.9], 0.12, 0.12, 'steel', { round: true, seg: 4 });
    }
    k.box(6, 0.5, 2.4, 'steel', px, 30, pz);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
      k.box(0.9, 0.7, 0.5, 'dark', px + (c - 2) * 1.0, 34 + r * 0.9, pz + 0.6);
      k.box(0.7, 0.5, 0.2, 'window', px + (c - 2) * 1.0, 34 + r * 0.9 + 0.1, pz + 0.9, { emit: 0.5 });
    }
    k.box(0.2, 6.0, 0.2, 'steel', px + 1.1, 28, pz + 1.1);
  }

  // scoreboard on the north end and perimeter advertising boards
  k.box(12, 5, 1.0, 'dark', 0, 30.5, -D / 2 - 6);
  k.box(10.5, 3.6, 0.3, 'steel', 0, 31.2, -D / 2 - 5.4);
  k.box(9.5, 2.8, 0.12, 'window', 0, 31.5, -D / 2 - 5.2, { emit: 0.25 });
  for (const [push, len] of [[{ z: 74 }, W], [{ z: -74, ry: Math.PI }, W], [{ x: -80, ry: Math.PI / 2 }, D], [{ x: 80, ry: -Math.PI / 2 }, D]]) {
    k.push(push);
    for (let i = 0; i < Math.round(len / 8); i++) {
      const u = -len / 2 + 4 + i * 8;
      const c = i % 3 === 0 ? 'flowerRed' : i % 3 === 1 ? 'doorBlue' : 'cream';
      k.box(7.4, 1.0, 0.3, c, u, 0.4, 0.5);
    }
    k.pop();
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
