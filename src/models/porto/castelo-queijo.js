// Forte de São Francisco Xavier do Queijo (Castelo do Queijo), 1661-1662.
// A low triangular sea fort on a granite rock at Foz do Douro: ashlar
// curtain walls with crenellations, domed corner watch turrets (guaritas),
// a monumental landward gate with the arms of Portugal, gun platforms with
// historic cannon and the service buildings (command house, barracks).
import { corniceProfile } from '../kit.js';
import { bbox, rect } from '../geom.js';
import { chapel } from '../parts.js';
import { fitTo } from './site-fit.js';

// Crenellated parapet along a plan line a->b ([x,z]) on top of a wall.
function crenelLine(k, a, b, y, mw, mh, t, color) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ry = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
  const n = Math.max(2, Math.floor(len / (mw * 1.2)));
  const pitch = len / n;
  k.push({ x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, ry });
  for (let i = 0; i < n; i++) {
    const u = -((n - 1) * pitch) / 2 + i * pitch;
    k.box(mw, mh, t, color, u, y, 0);
  }
  k.pop();
}

// Domed corner watch turret (guarita) at (x, z), sitting on the wall.
function guarita(k, x, y, z, r, color) {
  k.cyl(r * 0.9, r, 1.6, 8, color, x, y - 1.2, z);
  k.cyl(r * 1.15, r * 1.15, 0.25, 8, color, x, y + 0.4, z);
  k.dome(r * 1.05, color, x, y + 0.6, z, { seg: 10, rings: 4 });
  k.sphere(r * 0.16, 'iron', x, y + 0.6 + r * 1.05, z, { seg: 5, rings: 3, flat: true });
}

function queijo(k, site) {
  const o = site?.footprint?.outline;
  const b = o && o.length >= 3 ? bbox(o) : { w: 55.8, d: 34.8, cx: 0, cz: 0 };
  const W = Math.max(20, b.w);
  const D = Math.max(16, b.d);
  const H = 12;
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  // rocky headland slab exactly filling the footprint box
  k.prism(rect(0, 0, W, D), 0, 0.9, 'graniteDark');
  k.prism(rect(0, 0, W - 1.6, D - 1.6), 0.9, 0.4, 'granite');

  // triangular curtain wall, inset from the bbox
  const t = Math.max(1.5, W * 0.035);
  const A = [-W * 0.40, -D * 0.34];
  const B = [W * 0.40, -D * 0.34];
  const C = [0, D * 0.34];
  const wallH = 4.6;
  for (const [p, q] of [[A, B], [B, C], [C, A]]) {
    k.wallLine(p, q, wallH, t, 'graniteLight', 1.1, { ext: 0.4 });
    k.box(Math.hypot(q[0] - p[0], q[1] - p[1]) + 0.5, 0.5, t + 0.5, 'granite', (p[0] + q[0]) / 2, wallH + 1.1, (p[1] + q[1]) / 2, { ry: Math.atan2(-(q[1] - p[1]), q[0] - p[0]) });
    crenelLine(k, [p[0] * 0.8, p[1] * 0.8], [q[0] * 0.8, q[1] * 0.8], wallH + 1.6, 1.5, 1.7, t * 0.8, 'graniteLight');
  }

  // corner bastions with turrets
  const bastR = Math.max(2.6, W * 0.075);
  for (const [cx, cz, sx, sz] of [[A[0], A[1], -1, -1], [B[0], B[1], 1, -1], [C[0], C[1], 0, 1]]) {
    k.cyl(bastR * 0.92, bastR, wallH + 1.0, 6, 'graniteLight', cx, 1.0, cz);
    k.cyl(bastR * 1.05, bastR * 1.05, 0.5, 6, 'granite', cx, wallH + 1.9, cz);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      k.box(1.3, 1.4, 0.8, 'graniteLight', cx + Math.cos(a) * bastR * 0.92, wallH + 2.3, cz + Math.sin(a) * bastR * 0.92, { ry: -a });
    }
    guarita(k, cx + sx * bastR * 0.5, wallH + 2.4, cz + sz * bastR * 0.5, 1.5, 'graniteLight');
  }

  // landward gate on the south wall (between A and B)
  const gx = 0;
  const gz = A[1];
  k.box(11, 8.6, t + 2.2, 'graniteLight', gx, 1.1, gz);
  k.gate(9, 6.4, t + 2.6, [{ x: 0, w: 4.4, h: 5.2 }], 'graniteDark', gx, 1.1, gz, {});
  k.box(11, 0.7, t + 2.6, 'granite', gx, 9.7, gz);
  // arms of Portugal over the arch
  k.box(2.6, 2.0, 0.5, 'granite', gx, 6.7, gz - t * 0.5 - 1.3);
  k.box(2.0, 0.5, 0.4, 'granite', gx, 6.5, gz - t * 0.5 - 1.5);
  // flanking crenellated turrets on the gate block
  for (const s of [-1, 1]) {
    k.cyl(1.5, 1.7, 8.0, 6, 'graniteLight', gx + s * 5.6, 1.1, gz);
    k.cyl(1.7, 1.7, 0.4, 6, 'granite', gx + s * 5.6, 9.1, gz);
    k.dome(1.6, 'graniteLight', gx + s * 5.6, 9.5, gz, { seg: 8, rings: 4 });
  }

  // inner courtyard buildings: command house (hip roof) + barracks + magazine
  const Bx = -W * 0.18;
  const Bz = D * 0.02;
  k.box(W * 0.26, 4.2, D * 0.34, 'plaster', Bx, 1.1, Bz);
  k.corniceRing(W * 0.26, D * 0.34, corniceProfile('eave', 0.4), 'granite', Bx, 4.9, Bz);
  k.push({ x: Bx, z: Bz });
  k.hipRoof(W * 0.26 + 0.6, D * 0.34 + 0.6, 1.8, 'terracotta', 0, 5.3, 0);
  k.pop();
  for (let i = 0; i < 4; i++) k.box(0.4, 5.6, 0.4, 'granite', Bx - W * 0.10 + i * W * 0.07, 1.1, Bz + D * 0.17 + 0.3);
  k.box(W * 0.30, 3.2, D * 0.20, 'graniteLight', W * 0.05, 1.1, D * 0.16);
  k.push({ x: W * 0.05, z: D * 0.16 });
  k.gableRoof(W * 0.30 + 0.5, D * 0.20 + 0.5, 1.3, 'terracotta', 0, 4.3, 0, { ry: Math.PI / 2 });
  k.pop();
  // powder magazine (sunk, small)
  k.box(W * 0.16, 2.4, D * 0.16, 'graniteDark', -W * 0.30, 1.1, D * 0.20);

  // the small chapel of São Francisco Xavier in the courtyard
  chapel(k, W * 0.20, 1.1, -D * 0.06, 3.6, 0.2);
  // cobbled courtyard paving
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 7; j++) {
      k.box(1.5, 0.06, 1.5, j % 2 ? 'granite' : 'graniteDark', -W * 0.30 + (W * 0.60 * i) / 15, 1.35, -D * 0.26 + (D * 0.42 * j) / 6);
    }
  }
  // windows and doors on the command house
  for (let i = 0; i < 3; i++) {
    k.box(0.9, 1.5, 0.15, 'glass', Bx - W * 0.06 + i * W * 0.06, 2.4, Bz + D * 0.17 + 0.05, { emit: 0.1, mat: 0 });
    k.box(0.9, 1.5, 0.15, 'glass', Bx - W * 0.06 + i * W * 0.06, 2.4, Bz - D * 0.17 - 0.05, { emit: 0.1, mat: 0 });
  }
  k.box(1.2, 2.2, 0.2, 'doorBlue', Bx, 1.1, Bz - D * 0.17 - 0.06);

  // gun platforms with historic cannon
  for (const [px, pz, ry] of [[A[0] * 0.55, A[1] * 0.75, 0.6], [B[0] * 0.55, B[1] * 0.75, -0.6], [0, D * 0.24, Math.PI]]) {
    k.prism(rect(px, pz, 5.4, 3.6, -ry * 0.3), 1.3, 0.5, 'graniteDark');
    for (let i = 0; i < 3; i++) {
      const u = (i - 1) * 1.5;
      k.push({ x: px + u * Math.cos(ry), z: pz + u * Math.sin(ry), ry });
      k.box(1.4, 0.7, 1.4, 'wood', 0, 1.8, 0);
      k.cyl(0.34, 0.42, 2.6, 10, 'iron', 0, 2.3, 0.9, { rx: Math.PI / 2 });
      k.cyl(0.18, 0.18, 2.2, 6, 'iron', 0, 2.3, 2.4, { rx: Math.PI / 2 });
      k.pop();
    }
  }

  // flagstaff in the courtyard (sets the 12 m height)
  k.cyl(0.12, 0.18, 9.2, 6, 'granite', W * 0.30, 1.2, D * 0.28);
  k.cyl(0.05, 0.05, 1.6, 4, 'iron', W * 0.30, 10.4, D * 0.28);
  k.box(1.6, 1.0, 0.05, 'white', W * 0.30 + 0.8, 11.0, D * 0.28);
  k.box(0.9, 0.66, 0.06, 'maroon', W * 0.30 + 0.7, 11.17, D * 0.28);

  done();
}
queijo.metric = true;
queijo.rule = {
  note: 'Forte de São Francisco Xavier (Castelo do Queijo), 1662 triangular sea fort on its rock',
  fitTo: true,
};

export default { 'castelo-queijo': queijo };
