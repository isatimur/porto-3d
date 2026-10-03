// Jardim de João Chagas, the Cordoaria (founded 1865, Émile David; remodelled
// 2001): a romantic city garden beside the Clérigos tower, with tree avenues,
// the Juan Muñoz bronze group and monuments to Ramalho Ortigão, António Nobre
// and Flora. Real OSM outline and parts. Authored metric.
import { obb, bbox, rect, inside, centroid } from '../geom.js';
import { fitTo } from './site-fit.js';

function monument(k, h, x, z, name) {
  k.box(2.2, 1.0, 2.2, 'graniteLight', x, 0, z);
  k.box(1.7, 2.6, 1.7, 'granite', x, 1.0, z);
  k.statue(h, 'graniteLight', x, 3.6, z, { pose: name % 2 ? 'hold' : 'down' });
}

function builder(k, site) {
  const fp = site?.footprint;
  const o = fp?.outline;
  const b = o && o.length >= 3 ? bbox(o) : { w: 279, d: 211, cx: 0, cz: 0 };
  const H = 9;
  const done = fitTo(k, site, { w: b.w || 279, d: b.d || 211, h: H, cx: b.cx, cz: b.cz });
  const rnd = k.rnd;

  const ground = o && o.length >= 3 ? o : rect(0, 0, b.w, b.d);
  k.prism(ground, -0.3, 0.3, 'grass');

  // real OSM parts: pond, paths, garden beds and the palace blocks
  for (const p of fp?.parts || []) {
    const pts = p.pts;
    if (!pts || pts.length < 3) continue;
    if (p.tag === 'water') k.prism(pts, 0, 0.12, 'water', { emit: 0.05 });
    else if (p.tag === 'garden') k.prism(pts, 0, 0.06, 'foliageDark');
    else if (p.tag === 'square') k.prism(pts.slice(), 0.02, 0.14, 'sand');
    else if (p.tag === 'building') k.prism(pts, 0, Math.min(7, p.height_m || 5), 'graniteLight');
  }

  // gravel walks across the garden
  const c = centroid(ground);
  const ob = o && o.length >= 3 ? obb(o) : { a: 0, L: b.w, W: b.d };
  k.push({ x: c[0], z: c[1], ry: ob.a });
  for (let i = -1; i <= 1; i++) k.box(Math.min(ob.L, 250), 0.1, 4.2, 'sand', 0, 0.1, i * (ob.W / 3));
  for (let i = -1; i <= 1; i++) k.box(4.2, 0.1, Math.min(ob.W, 200), 'sand', i * (ob.L / 3), 0.1, 0);
  k.pop();

  // central circular lawn
  k.cyl(9.5, 9.5, 0.18, 24, 'grass', c[0], 0.1, c[1]);
  k.cyl(0.6, 0.9, 1.6, 10, 'graniteLight', c[0], 0.2, c[1]);

  // Juan Muñoz, "Treze a rir uns dos outros" (2001): thirteen bronze figures
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * Math.PI * 2;
    k.statue(1.85, 'bronze', c[0] + Math.cos(a) * 8.5, 0, c[1] + Math.sin(a) * 8.5, { pose: 'down' });
  }

  // sculptures: Flora (1904) and the Ramalho Ortigão / António Nobre monuments
  monument(k, 2.7, c[0] - ob.L * 0.24, c[1] - ob.W * 0.2, 1);
  monument(k, 2.5, c[0] + ob.L * 0.22, c[1] + ob.W * 0.18, 2);
  k.box(2.4, 1.2, 2.4, 'graniteLight', c[0] + ob.L * 0.05, 0, c[1] - ob.W * 0.3);
  k.statue(2.4, 'graniteLight', c[0] + ob.L * 0.05, 1.2, c[1] - ob.W * 0.3, { pose: 'hold' });

  // tree planting: a grand avenue plus scattered groups
  let placed = 0;
  let guard = 0;
  while (placed < 58 && guard < 6000) {
    guard++;
    const x = b.cx + (rnd() - 0.5) * b.w * 0.96;
    const z = b.cz + (rnd() - 0.5) * b.d * 0.96;
    if (!inside(ground, x, z)) continue;
    if (Math.hypot(x - c[0], z - c[1]) < 12) continue;
    const h = 6.5 + rnd() * 2.5;
    k.tree(x, 0, z, h, { crown: rnd() > 0.4 ? 'spread' : 'round', lobes: 2 });
    placed++;
  }

  // benches and lamps along the walks
  for (let i = 0; i < 10; i++) {
    const x = c[0] - ob.L * 0.4 + (ob.L * 0.8 * i) / 9;
    k.box(2.2, 0.5, 0.6, 'wood', x, 0, c[1] + 6, { ry: 0 });
    if (i % 3 === 0) k.lamp(4.2, x, 0, c[1] + 8, { globe: true });
  }

  // --- detail: a Nasoni-style fountain and two more bronze figures
  k.lathe([[0, 0], [0.3, 0], [0.2, 0.35], [0.22, 0.55], [0.95, 0.66], [1, 1], [0.9, 1], [0, 0.88]], 12, 'graniteLight', c[0] + ob.L * 0.3, 0, c[1] + ob.W * 0.3, { sr: 2.2, sh: 1.6, smooth: true });
  k.cyl(0.35, 0.5, 2.0, 10, 'graniteLight', c[0] + ob.L * 0.3, 1.6, c[1] + ob.W * 0.3);
  k.sphere(0.3, 'water', c[0] + ob.L * 0.3, 3.7, c[1] + ob.W * 0.3, { seg: 8, rings: 5, emit: 0.4 });
  k.box(2.0, 1.0, 2.0, 'graniteLight', c[0] - ob.L * 0.1, 0, c[1] + ob.W * 0.32);
  k.statue(2.2, 'bronze', c[0] - ob.L * 0.1, 1.0, c[1] + ob.W * 0.32, { pose: 'raise' });
  done();
}
builder.metric = true;
builder.rule = {
  note: 'Jardim da Cordoaria (João Chagas): tree avenues, Juan Muñoz bronze group and monuments, beside the Clérigos tower',
  extent: [/./],
  fitTo: true,
};

export default { cordoaria: builder };
