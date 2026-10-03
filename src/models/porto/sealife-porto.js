// SEA LIFE Porto (2009), the Foz do Douro aquarium: a low two-storey block
// next to the Castelo do Queijo, with a glazed ocean front, a rounded
// ocean-facing shell, a big blue sign, a shark-fin sculpture and the paved
// forecourt where the queues form.
import { corniceProfile } from '../kit.js';
import { bbox, offset, rect } from '../geom.js';
import { flatWindow } from '../parts.js';
import { fitTo } from './site-fit.js';

function rrect(cx, cz, w, d, r, n = 3) {
  const hw = w / 2;
  const hd = d / 2;
  const pts = [];
  const corner = (sx, sz) => {
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * (Math.PI / 2);
      pts.push([cx + sx * (hw - r + Math.cos(a) * r), cz + sz * (hd - r + Math.sin(a) * r)]);
    }
  };
  corner(1, -1); corner(1, 1); corner(-1, 1); corner(-1, -1);
  return pts;
}

function sealife(k, site) {
  const o = site?.footprint?.outline;
  const b = o && o.length >= 3 ? bbox(o) : { w: 44.4, d: 38.5, cx: 0, cz: 0 };
  const W = Math.max(20, b.w);
  const D = Math.max(16, b.d);
  const H = 12;
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  // paved forecourt, exactly filling the footprint box
  k.prism(rect(0, 0, W, D), 0, 0.25, 'graniteLight');
  k.prism(rect(0, 0, W * 0.42, D), 0.25, 0.05, 'sand');

  // main aquarium block (rounded plan), set back toward the land side
  const bw = W * 0.80;
  const bd = D * 0.66;
  const bz = -D * 0.10;
  const plan = rrect(0, bz, bw, bd, Math.min(6, bd * 0.22), 4);
  k.prism(offset(plan, 0.35), 0.25, 0.6, 'graniteDark');
  k.prism(plan, 0.25, 6.4, 'graniteGrey', { bevel: 0.18 });
  k.corniceRing(bw, bd, corniceProfile('band', 0.45), 'slate', 0, 6.65, bz);
  // upper storey slab
  k.prism(offset(plan, -1.0), 6.65, 3.0, 'white', { bevel: 0.15 });
  k.prism(offset(plan, 0.2), 9.65, 0.4, 'slate');

  // continuous glazed ocean front on the south (+z) face
  const fz = bz + bd / 2 - 1.2;
  for (const zz of [fz, bz - bd / 2 + 1.2]) {
    k.box(bw * 0.86, 2.6, 0.3, 'glass', 0, 2.0, zz, { emit: 0.12, mat: 0 });
    k.box(bw * 0.86, 2.4, 0.3, 'glass', 0, 6.9, zz, { emit: 0.10, mat: 0 });
  }
  // vertical mullions across the ocean front
  for (let i = 0; i < 14; i++) {
    const u = -bw * 0.42 + (bw * 0.84 * i) / 13;
    k.box(0.22, 6.4, 0.4, 'steel', u, 0.3, fz + 0.05);
  }

  // entrance: projecting canopy, glass doors, blue sign band
  const ez = bz + bd / 2 + 0.2;
  k.box(14, 0.5, 6, 'white', 0, 5.0, ez + 3);
  for (const s of [-1, 1]) k.box(0.35, 4.75, 0.35, 'steel', s * 6.4, 0.25, ez + 5.6);
  k.box(9.5, 3.4, 0.4, 'glass', 0, 0.3, ez + 0.1, { emit: 0.14, mat: 0 });
  for (let i = 0; i < 3; i++) k.box(0.16, 3.4, 0.5, 'steel', (i - 1) * 3.2, 0.3, ez + 0.2);
  k.box(15, 2.4, 0.5, 'doorBlue', 0, 3.3, ez + 0.05);
  k.box(10, 1.3, 0.55, 'white', 0, 3.9, ez + 0.06);

  // shark-fin sculpture on the forecourt (sets the 12 m height)
  k.push({ x: W * 0.28, z: D * 0.30, ry: -0.5 });
  k.prism(rect(0, 0, 3.2, 1.2), 0.3, 0.6, 'graniteDark');
  k.prism([[-1.4, 0], [1.4, 0], [0.5, 9.6], [-0.2, 11.4], [-0.6, 8.2]], 0.9, 0.35, 'steel');
  k.box(0.2, 11.3, 0.25, 'steel', 0, 0.3, 0);
  k.pop();

  // forecourt detail: planters, benches, bollards
  for (let i = 0; i < 6; i++) {
    const px = -W * 0.34 + i * W * 0.13;
    k.box(2.2, 0.7, 2.2, 'graniteLight', px, 0.25, D * 0.34);
    k.tree(px, 0.95, D * 0.34, 3.2, { kind: 'topiary', color: 'hedge' });
  }
  for (let i = 0; i < 22; i++) k.cyl(0.09, 0.09, 0.9, 5, 'steel', -W * 0.30 + i * (W * 0.60 / 21), 0.25, D * 0.10);
  for (let i = 0; i < 12; i++) k.box(1.8, 0.45, 0.5, 'wood', -W * 0.26 + i * (W * 0.52 / 11), 0.65, -D * 0.34);

  // low side wing (ticketing) and service yard
  k.prism(rect(-W * 0.34, bz - bd * 0.15, W * 0.22, D * 0.34), 0.25, 4.2, 'graniteGrey');
  k.prism(rect(-W * 0.34, bz - bd * 0.15, W * 0.22, D * 0.34), 4.45, 0.3, 'slate');
  for (let i = 0; i < 4; i++) flatWindow(k, -W * 0.34 + (i - 1.5) * 2.2, 1.0, 1.4, 1.8, bz - bd * 0.15 + D * 0.17 + 0.03, { trim: 'steel', pane: 'glass' });
  k.box(W * 0.10, 3.0, D * 0.10, 'graniteDark', W * 0.32, 0.25, bz - bd * 0.10);

  // rooftop plant and a pale wave crest over the ocean side
  for (let i = 0; i < 5; i++) k.box(2.4, 1.4, 2.0, 'steel', -bw * 0.30 + i * bw * 0.15, 10.05, bz - bd * 0.20);
  for (let i = 0; i < 30; i++) k.box(1.2, 0.55, 0.5, 'white', -bw * 0.42 + (bw * 0.84 * i) / 29, 10.05, bz + bd * 0.34, { ry: 0.22 });
  // glazing mullions on the east and west faces
  for (let i = 0; i < 8; i++) {
    const zz = bz - bd * 0.42 + (bd * 0.84 * i) / 7;
    k.box(0.28, 6.4, 0.22, 'steel', bw / 2 - 0.5, 0.3, zz);
    k.box(0.28, 6.4, 0.22, 'steel', -bw / 2 + 0.5, 0.3, zz);
  }
  // porthole windows around the two storeys
  for (let i = 0; i < 14; i++) {
    const u = -bw * 0.42 + (bw * 0.84 * i) / 13;
    k.cyl(0.32, 0.32, 0.25, 10, 'steel', u, 1.6, fz + 0.2, { rx: Math.PI / 2 });
    k.cyl(0.24, 0.24, 0.28, 10, 'glass', u, 1.6, fz + 0.24, { rx: Math.PI / 2, emit: 0.1, mat: 0 });
    k.cyl(0.32, 0.32, 0.25, 10, 'steel', u, 8.0, bz - bd / 2 + 1.0, { rx: Math.PI / 2 });
    k.cyl(0.24, 0.24, 0.28, 10, 'glass', u, 8.0, bz - bd / 2 + 0.96, { rx: Math.PI / 2, emit: 0.1, mat: 0 });
  }
  // hedge planters along the forecourt edge
  for (let i = 0; i < 14; i++) k.ico(0.7, 1, 'hedge', -W * 0.42 + (W * 0.84 * i) / 13, 0.75, -D * 0.44, { jitter: 0.2, sy: 0.6 });

  // --- detail: a forecourt flag, facade signage and a service-yard screen
  k.cyl(0.06, 0.06, 5.0, 5, 'steel', W * 0.42, 0.25, D * 0.40);
  k.box(1.2, 0.8, 0.04, 'doorBlue', W * 0.42 + 0.62, 4.6, D * 0.40);
  k.box(2.6, 1.0, 0.2, 'doorBlue', -W * 0.22, 1.4, D * 0.44, { ry: 0.2 });
  k.box(2.2, 0.6, 0.24, 'white', -W * 0.22, 1.9, D * 0.46, { ry: 0.2 });
  for (let i = 0; i < 5; i++) k.box(0.18, 1.8, 0.6, 'steel', -W * 0.42 + i * W * 0.06, 0.25, -D * 0.42);

  done();
}
sealife.metric = true;
sealife.rule = {
  note: 'SEA LIFE Porto 2009 aquarium block: glazed ocean front, blue sign, shark-fin sculpture',
  fitTo: true,
};

export default { 'sealife-porto': sealife };
