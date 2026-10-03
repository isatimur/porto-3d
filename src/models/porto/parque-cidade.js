// Parque da Cidade do Porto (Sidónio Pardal, opened 1993): Portugal's largest
// urban park — a modelled landscape of meadows, lakes and groves reaching the
// ocean, with the Water Pavilion and Sea Life among the trees. Real OSM
// outline and parts, scattered planting. Authored metric.
import { obb, bbox, rect, inside, centroid } from '../geom.js';
import { fitTo } from './site-fit.js';

function builder(k, site) {
  const fp = site?.footprint;
  const o = fp?.outline;
  const b = o && o.length >= 3 ? bbox(o) : { w: 1483, d: 688, cx: 0, cz: 0 };
  const H = 10;
  const done = fitTo(k, site, { w: b.w || 1483, d: b.d || 688, h: H, cx: b.cx, cz: b.cz });
  const rnd = k.rnd;

  // ground: the real park outline
  const ground = o && o.length >= 3 ? o : rect(0, 0, b.w, b.d);
  k.prism(ground, -0.35, 0.35, 'grass');

  // real water, pitches, buildings and garden beds mapped in OSM
  for (const p of fp?.parts || []) {
    const pts = p.pts;
    if (!pts || pts.length < 3) continue;
    if (p.tag === 'water') k.prism(pts, 0, 0.16, 'water', { emit: 0.05 });
    else if (p.tag === 'pitch') k.prism(pts, 0.02, 0.12, 'grass');
    else if (p.tag === 'garden') k.prism(pts, 0, 0.08, 'foliageDark');
    else if (p.tag === 'building') {
      const hh = Math.min(7, p.height_m || 4.5);
      k.prism(pts, 0, hh, 'graniteLight');
      k.prism(pts, hh, 0.3, 'terracotta');
    }
  }

  // path network along the park's main axis
  const c = centroid(ground);
  const ob = o && o.length >= 3 ? obb(o) : { a: 0, cx: c[0], cz: c[1], L: b.w, W: b.d };
  k.push({ x: c[0], z: c[1], ry: ob.a });
  for (let i = -2; i <= 2; i++) k.box(Math.min(ob.L, 1400), 0.1, 4.5, 'sand', 0, 0.12, i * (ob.W / 5));
  for (let i = -3; i <= 3; i++) k.box(4.0, 0.1, Math.min(ob.W, 600), 'sand', i * (ob.L / 7), 0.12, 0);
  k.pop();

  // a few resting points: benches and lamps
  for (let i = 0; i < 8; i++) {
    const x = c[0] + (rnd() - 0.5) * b.w * 0.5;
    const z = c[1] + (rnd() - 0.5) * b.d * 0.5;
    if (!inside(ground, x, z)) continue;
    k.box(2.4, 0.5, 0.7, 'wood', x, 0, z, { ry: rnd() * Math.PI });
    if (i % 2) k.lamp(4.5, x + 2, 0, z, { globe: true });
  }

  // tree planting: meadows kept open, groves clustered by the paths
  let placed = 0;
  let guard = 0;
  while (placed < 115 && guard < 8000) {
    guard++;
    const x = b.cx + (rnd() - 0.5) * b.w * 0.97;
    const z = b.cz + (rnd() - 0.5) * b.d * 0.97;
    if (!inside(ground, x, z)) continue;
    const h = 6.5 + rnd() * 3.2;
    if (rnd() < 0.12) k.tree(x, 0, z, h * 0.9, { kind: 'cypress' });
    else k.tree(x, 0, z, h, { crown: rnd() > 0.5 ? 'round' : 'oval', lobes: 1 + Math.floor(rnd() * 2) });
    placed++;
  }

  // --- detail: a lake fountain and information pylons on the main walks
  k.cyl(2.2, 2.8, 0.9, 14, 'graniteLight', c[0], 0.12, c[1] + b.d * 0.18);
  k.cyl(0.4, 0.6, 2.4, 10, 'graniteLight', c[0], 1.0, c[1] + b.d * 0.18);
  k.lathe([[0, 0], [1.0, 0], [0.9, 0.4], [0.6, 0.8], [0, 1]], 10, 'graniteLight', c[0], 3.4, c[1] + b.d * 0.18, { sr: 1.6, sh: 1.0, smooth: true });
  for (let i = 0; i < 8; i++) {
    const px = c[0] + (rnd() - 0.5) * b.w * 0.5;
    const pz = c[1] + (rnd() - 0.5) * b.d * 0.5;
    if (!inside(ground, px, pz)) continue;
    k.box(0.5, 1.6, 0.9, 'graniteDark', px, 0, pz, { ry: rnd() * 6 });
  }
  done();
}
builder.metric = true;
builder.rule = {
  note: 'Parque da Cidade: oceanfront park of lakes, meadows and groves (Sidónio Pardal, 1993); real outline and OSM water/building parts',
  extent: [/./],
  fitTo: true,
};

export default { 'parque-cidade': builder };
