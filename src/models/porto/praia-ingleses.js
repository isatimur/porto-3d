// Praia dos Ingleses, Foz do Douro: the urban Blue Flag beach at the mouth
// of the Douro. Fine sand sloping to the Atlantic, rocky outcrops in the
// surf, the seawall and balustraded promenade on the land side, dune grass,
// a lifeguard station and the beach flags.
import { bbox, rect } from '../geom.js';
import { fitTo } from './site-fit.js';

function ingleses(k, site) {
  const o = site?.footprint?.outline;
  const b = o && o.length >= 3 ? bbox(o) : { w: 290.4, d: 77.7, cx: 0, cz: 0 };
  const W = Math.max(40, b.w);
  const D = Math.max(20, b.d);
  const H = 2;
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  // sand exactly filling the footprint box
  k.prism(rect(0, 0, W, D), 0, 0.30, 'sand');
  // dune bank along the landward edge (pale dry sand)
  k.prism(rect(0, -D / 2 + D * 0.10, W, D * 0.18), 0.30, 0.26, 'earth');

  // ---------------- Atlantic surf along the seaward (+z) edge
  const seaZ = D / 2 - D * 0.10;
  k.prism(rect(0, seaZ + D * 0.05, W, D * 0.10), 0, 0.10, 'water');
  for (let i = 0; i < 16; i++) k.box(W / 18, 0.06, 0.5, 'white', -W / 2 + (W * (i + 0.5)) / 16, 0.10, seaZ + D * 0.01);

  // rocky outcrops in and at the water line (the beach's signature)
  const rnd = k.rnd;
  for (let i = 0; i < 42; i++) {
    const rx = -W * 0.46 + rnd() * W * 0.92;
    const rz = seaZ - rnd() * D * 0.32;
    const r = 0.5 + rnd() * 1.2;
    const ry = Math.min(0.30 + r * 0.35, 1.9 - r * 0.7);
    k.ico(r, 1, rnd() > 0.5 ? 'graniteDark' : 'graniteGrey', rx, ry, rz, { jitter: 0.4, sy: 0.7 });
  }

  // ---------------- seawall and balustraded promenade on the land side
  const wz = -D / 2 + D * 0.04;
  k.box(W, 1.0, 1.2, 'graniteLight', 0, 0.30, wz);
  k.balustrade(W * 0.96, 0.6, 'graniteLight', 0, 1.30, wz, { cheap: true, d: 0.22, sp: 1.0, posts: 26 });
  // a low flight of steps to the sand
  for (let i = 0; i < 4; i++) k.box(6, 0.22, 2.6 - i * 0.6, 'graniteLight', W * 0.30, 0.30 + i * 0.22, wz + 1.6 + i * 0.6);

  // dune grass clumps
  for (let i = 0; i < 60; i++) {
    const gx = -W * 0.46 + rnd() * W * 0.92;
    const gz = -D / 2 + D * 0.03 + rnd() * D * 0.14;
    const h = 0.35 + rnd() * 0.5;
    k.cyl(0.02, 0.10, h, 4, 'foliageDark', gx, 0.30, gz);
    k.ico(0.22, 0, 'foliage', gx, 0.30 + h, gz, { jitter: 0.3, sy: 0.6 });
  }

  // lifeguard station (a small cab on legs, under the 2 m line)
  const lx = -W * 0.30;
  const lz = -D / 2 + D * 0.07;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.cyl(0.09, 0.09, 0.9, 5, 'wood', lx + sx * 1.4, 0.30, lz + sz * 1.2);
  k.box(3.4, 0.8, 3.0, 'white', lx, 1.20, lz);
  k.box(3.6, 0.2, 3.2, 'graniteLight', lx, 2.0 - 0.2, lz);
  k.box(2.4, 0.5, 0.12, 'doorBlue', lx, 1.35, lz + 1.55);
  k.cyl(0.05, 0.05, 0.9, 4, 'iron', lx - 2.4, 1.1, lz);

  // beach flag poles (Blue Flag and bathing flags)
  for (const [fx, col] of [[W * 0.20, 'doorBlue'], [W * 0.26, 'white'], [-W * 0.38, 'flowerYellow']]) {
    k.cyl(0.05, 0.05, 1.7, 5, 'iron', fx, 0.30, seaZ - D * 0.06);
    k.box(0.8, 0.45, 0.04, col, fx + 0.4, 1.45, seaZ - D * 0.06);
  }

  // a few beach umbrellas near the accesses
  for (let i = 0; i < 6; i++) {
    const ux = -W * 0.10 + i * W * 0.045;
    const uz = seaZ - D * 0.22 - (i % 2) * 4;
    k.cyl(0.05, 0.05, 1.1, 5, 'wood', ux, 0.30, uz);
    k.cone(1.1, 0.5, 8, i % 2 ? 'flowerRed' : 'doorBlue', ux, 1.35, uz);
  }

  // groynes: low rock breakwaters running into the surf
  for (const gx of [-W * 0.22, W * 0.08]) k.box(2.8, 0.7, D * 0.34, 'graniteDark', gx, 0.30, seaZ - D * 0.08);

  // --- detail: a timber boardwalk, promenade lamps and more parasols
  k.box(W * 0.8, 0.12, 1.6, 'wood', 0, 0.34, -D / 2 + D * 0.22);
  for (let i = 0; i < 6; i++) {
    const px = -W * 0.36 + (W * 0.72 * i) / 5;
    k.lamp(3.2, px, 0.34, -D / 2 + D * 0.16, { globe: true });
  }
  for (let i = 0; i < 6; i++) {
    const ux = -W * 0.25 + i * W * 0.09;
    const uz = seaZ - D * 0.34 - (i % 2) * 3;
    k.cyl(0.05, 0.05, 1.0, 5, 'wood', ux, 0.30, uz);
    k.cone(1.0, 0.45, 8, i % 2 ? 'flowerRed' : 'flowerYellow', ux, 1.25, uz);
  }

  done();
}
ingleses.metric = true;
ingleses.rule = {
  note: 'Praia dos Ingleses: Blue Flag beach, sand, surf rocks, seawall promenade and lifeguard post',
  fitTo: true,
};

export default { 'praia-ingleses': ingleses };
