// Jardim de São Lázaro (1834): Porto's oldest municipal garden, with its
// cast-iron coreto bandstand, a fountain from the São Domingos convent, lime
// trees and sculpture groups beside the Public Library. Real OSM outline and
// parts. Authored metric.
import { bbox, rect, inside, centroid } from '../geom.js';
import { PROFILES } from '../kit.js';
import { fitTo } from './site-fit.js';

function coreto(k, x, z) {
  // octagonal cast-iron bandstand
  k.cyl(4.6, 4.9, 0.7, 8, 'granite', x, 0, z);
  k.cyl(4.3, 4.3, 0.4, 8, 'iron', x, 0.7, z);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    k.column(4.0, 0.2, 'lampGreen', x + Math.cos(a) * 3.7, 1.1, z + Math.sin(a) * 3.7, { smooth: true });
  }
  k.cyl(4.1, 4.4, 0.6, 8, 'iron', x, 5.1, z);
  k.lathe([[0, 0], [0.2, 0.05], [0.35, 0.15], [0.32, 0.4], [0.42, 0.75], [0.2, 0.95], [0, 1]], 8, 'slate', x, 5.7, z, { sr: 5.0, sh: 2.4, flat: true });
  k.pinnacle(1.8, 'iron', x, 8.1, z);
  // a shallow railing between the columns
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    k.box(3.0, 1.3, 0.12, 'iron', x + Math.cos(a) * 3.5, 1.1, z + Math.sin(a) * 3.5, { ry: -a });
  }
}

function builder(k, site) {
  const fp = site?.footprint;
  const o = fp?.outline;
  const b = o && o.length >= 3 ? bbox(o) : { w: 110, d: 66, cx: 0, cz: 0 };
  const H = 9;
  const done = fitTo(k, site, { w: b.w || 110, d: b.d || 66, h: H, cx: b.cx, cz: b.cz });
  const rnd = k.rnd;

  const ground = o && o.length >= 3 ? o : rect(0, 0, b.w, b.d);
  k.prism(ground, -0.3, 0.3, 'grass');

  // real OSM parts: paths, beds, pond and the library block
  for (const p of fp?.parts || []) {
    const pts = p.pts;
    if (!pts || pts.length < 3) continue;
    if (p.tag === 'water') k.prism(pts, 0, 0.12, 'water', { emit: 0.05 });
    else if (p.tag === 'garden') k.prism(pts, 0, 0.05, 'foliageDark');
    else if (p.tag === 'building') k.prism(pts, 0, Math.min(7, p.height_m || 5), 'graniteLight');
  }

  const c = centroid(ground);
  // crossing walks
  k.box(b.w * 0.8, 0.1, 3.8, 'sand', c[0], 0.1, c[1]);
  k.box(3.8, 0.1, b.d * 0.8, 'sand', c[0], 0.1, c[1]);
  // four parterre beds
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    k.prism(rect(c[0] + sx * b.w * 0.2, c[1] + sz * b.d * 0.22, b.w * 0.22, b.d * 0.25), 0, 0.4, 'hedge');
  }

  // the coreto, the garden's emblem
  coreto(k, c[0], c[1] - b.d * 0.16);

  // fountain taken from the São Domingos convent, by the north railing
  const fx = c[0] + b.w * 0.16;
  const fz = c[1] - b.d * 0.4;
  k.lathe(PROFILES.basin, 14, 'graniteLight', fx, 0, fz, { sr: 1.9, sh: 1.3, smooth: true });
  k.cyl(0.9, 1.1, 2.2, 12, 'granite', fx, 0, fz);
  k.cyl(0.2, 0.2, 0.3, 10, 'water', fx, 2.0, fz, { emit: 0.5 });

  // sculpture groups near the art school side
  for (let i = 0; i < 4; i++) {
    const sx = c[0] - b.w * 0.3 + i * b.w * 0.09;
    const sz = c[1] + b.d * 0.3;
    k.box(1.6, 0.8, 1.6, 'graniteLight', sx, 0, sz);
    k.statue(1.9, i % 2 ? 'graniteLight' : 'plaster', sx, 0.8, sz, { pose: i % 2 ? 'hold' : 'down' });
  }

  // lime avenue plus scattered older trees
  let placed = 0;
  let guard = 0;
  while (placed < 36 && guard < 5000) {
    guard++;
    const x = b.cx + (rnd() - 0.5) * b.w * 0.94;
    const z = b.cz + (rnd() - 0.5) * b.d * 0.94;
    if (!inside(ground, x, z)) continue;
    if (Math.hypot(x - c[0], z - (c[1] - b.d * 0.16)) < 8) continue;
    k.tree(x, 0, z, 6.5 + rnd() * 2.2, { crown: placed % 3 ? 'round' : 'oval', lobes: 1 + (placed % 2) });
    placed++;
  }
  for (let i = 0; i < 8; i++) {
    k.lamp(4.0, c[0] - b.w * 0.3 + (b.w * 0.6 * i) / 7, 0, c[1] + b.d * 0.05, { globe: true });
  }

  // --- detail: parterre kerbs, a north railing and an upper fountain jet
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    k.box(b.w * 0.24, 0.3, 0.4, 'graniteLight', c[0] + sx * b.w * 0.2, 0.4, c[1] + sz * b.d * 0.22);
    k.box(0.4, 0.3, b.d * 0.27, 'graniteLight', c[0] + sx * b.w * 0.2, 0.4, c[1] + sz * b.d * 0.22);
  }
  k.box(b.w * 0.9, 0.5, 0.4, 'granite', c[0], 0.1, c[1] + b.d * 0.44);
  k.cyl(0.25, 0.25, 0.3, 10, 'water', fx, 2.2, fz, { emit: 0.5 });
  done();
}
builder.metric = true;
builder.rule = {
  note: 'Jardim de São Lázaro: oldest municipal garden (1834), cast-iron coreto bandstand, convent fountain and lime avenue',
  extent: [/./],
  fitTo: true,
};

export default { 'sao-lazaro': builder };
