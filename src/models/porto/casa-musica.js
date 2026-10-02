// Casa da Música (Rem Koolhaas / OMA, 2005): a white faceted concrete
// sculpture on the Rotunda da Boavista, with a glazed front slit and a
// sweeping curved entrance. Real massing ~78 x 56 m, ~26 m high.
import { Kit, PALETTE, MAT, PROFILES, corniceProfile, archPath } from '../kit.js';
import { onEdge, polyCornice, polyBand, polyWindows, roofOver, plainBuilding } from '../metric.js';
import { edges, obb, offset, bbox, rect } from '../geom.js';

// Irregular crystalline plan, ~78 x 55 m. Centred by bbox in the builder.
function massing(site) {
  const o = site?.footprint?.outline;
  if (o && o.length >= 3) return o;
  return [[-39, -20], [-20, -28], [18, -26], [39, -8], [30, 20], [-16, 29], [-39, 14]];
}

function casaMusica(k, site) {
  const pts = massing(site);
  const b = bbox(pts);
  const P = pts.map(([x, z]) => [x - b.cx, z - b.cz]);

  // plaza + granite apron
  k.prism(offset(P, 26).map(([x, z]) => [x + b.cx, z + b.cz]), -0.35, 0.35, 'sand');
  k.prism(offset(P, 7).map(([x, z]) => [x + b.cx, z + b.cz]), -0.35, 1.0, 'graniteLight');

  k.push({ x: b.cx, z: b.cz });

  // chamfered white concrete body
  k.prism(P, 0.4, 15, 'white', { bevel: 0.8 });
  // upper crystalline volume, inset and turned
  k.push({ y: 15, ry: 0.14 });
  k.prism(offset(P, -5), 0, 9, 'white', { bevel: 0.6 });
  k.pop();
  // folded top slab overhanging the west
  k.prism(P.map(([x, z]) => [x - 3, z]), 23.6, 1.4, 'graniteGrey');
  k.push({ y: 24.6, ry: -0.2 });
  k.prism(offset(P, -7), 0, 2.2, 'white', { bevel: 0.5 });
  k.pop();

  // main glazed slit on the front edge
  const E = edges(P);
  let front = E[0];
  for (const e of E) if (e.nz > front.nz) front = e;
  onEdge(k, front, 4.6, -0.4);
  k.wall(front.len * 0.86, 6.4, 0.7, 'white',
    [{ x: 0, y: 0.5, w: front.len * 0.6, h: 4.8, pane: 'glass', inset: 0.45, emit: 0.1 }], 0, 0, 0.3);
  k.pop();
  // a second slit on the east flank
  for (const e of E) {
    if (Math.abs(e.ex) > 0.8 && e.len > 24) {
      onEdge(k, e, 11, -0.3);
      k.wall(e.len * 0.5, 3.6, 0.6, 'white', [{ x: 0, y: 0.3, w: e.len * 0.36, h: 2.4, pane: 'glass', inset: 0.4 }], 0, 0, 0.3);
      k.pop();
      break;
    }
  }

  // sweeping curved glazed entrance near the front
  const fb = bbox(P);
  const ex = 8;
  const ez = fb.z1 - 3;
  k.cyl(9, 9, 7, 16, 'glass', ex, 0, ez, { t0: Math.PI * 0.55, tl: Math.PI * 0.9, open: true, smooth: true, emit: 0.08 });
  k.cyl(9.6, 9.6, 0.5, 16, 'white', ex, 6.9, ez, { t0: Math.PI * 0.55, tl: Math.PI * 0.95, smooth: true });
  k.cyl(9.6, 9.6, 0.4, 16, 'graniteLight', ex, 0, ez, { t0: Math.PI * 0.55, tl: Math.PI * 0.95, smooth: true });

  // leaning shard facing the plaza
  k.push({ x: -18, z: fb.z1 - 5, ry: -0.35, rz: 0.12 });
  k.frustum(11, 2.2, 7, 1.4, 24, 'white', 0, 0, 0);
  k.wall(3.2, 12, 0.5, 'white', [{ x: 0, y: 0, w: 2.2, h: 11, pane: 'glass', inset: 0.3 }], 0, 7, 1.2);
  k.pop();

  // second shard on the opposite flank
  k.push({ x: 21, z: -fb.z1 + 7, ry: 0.32, rz: -0.14 });
  k.frustum(9, 2.0, 6, 1.2, 20, 'white', 0, 0, 0);
  k.wall(2.6, 10, 0.4, 'white', [{ x: 0, y: 0, w: 1.8, h: 9, pane: 'glass', inset: 0.25 }], 0, 6, 1.0);
  k.pop();

  // rooftop plant volume and skylights over the hall
  k.push({ y: 23.6, ry: 0.08 });
  k.frustum(30, 22, 24, 16, 2.8, 'graniteGrey', -4, 0, -2);
  k.pop();
  for (const [sx, sz] of [[-9, -7], [7, -9], [5, 6], [-6, 8]]) {
    k.box(4.2, 0.6, 3.2, 'glass', sx, 26.2, sz, { emit: 0.05 });
    k.box(4.6, 0.25, 3.6, 'white', sx, 26.0, sz);
  }
  // roof rail and vents
  k.balustrade(48, 1.1, 'graniteGrey', 0, 24.6, -18, { cheap: true, d: 0.2, sp: 0.5 });

  // plaza radial paving
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.box(0.7, 0.06, 11, 'graniteLight', Math.cos(a) * 22, 0.36, Math.sin(a) * 22, { ry: -a });
  }
  k.cyl(24, 24, 0.06, 40, 'graniteLight', 0, 0.34, 0);

  k.pop();

  // a few steps to the plaza
  k.stairs(18, 3.2, 1.0, 3, 'graniteLight', b.cx, 0, b.cz - fb.z1 - 2.5);
  k.tree(b.cx + 34, 0, b.cz + 20, 9, { kind: 'round' });
  k.lamp(6, b.cx - 30, 0, b.cz - 24);
}
casaMusica.metric = true;
casaMusica.rule = { note: 'Casa da Música faceted concrete mass, OMA 2005' };

export default { 'casa-musica': casaMusica };
