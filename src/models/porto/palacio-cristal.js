// Jardins do Palácio de Cristal, Porto — the romantic hillside gardens
// (Emil David, 1860s) above the Douro, and the Pavilhão Rosa Mota (Loreiro,
// 1952) on the site of the 1865 Crystal Palace: a large ribbed dome on an
// octagonal drum. Lawns, hedges, walks and trees with a mirador over the
// river. The pavilion is the landmark.
import { Kit, PALETTE, MAT, PROFILES, corniceProfile } from '../kit.js';
import { edges, obb, offset, bbox, rect } from '../geom.js';

function pavilion(k, x, y, z) {
  const R = 23;         // drum radius
  const drumH = 10;
  const Rise = R;       // hemispherical dome; ribs follow the surface
  k.begin('pavilion');
  // octagonal drum
  k.cyl(R, R + 1.2, drumH, 8, 'graniteLight', x, y, z, { flat: true });
  k.cyl(R + 1.4, R + 1.4, 1.2, 8, 'granite', x, y, z, { flat: true });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    k.box(1.1, drumH - 1.2, 1.1, 'granite', x + Math.cos(a) * R, y + 1.2, z + Math.sin(a) * R, { ry: -a });
  }
  k.corniceRing(R * 1.9, R * 1.9, corniceProfile('classic', 0.8), 'graniteLight', x, y + drumH - 0.6, z);
  // glazed clerestory band round the drum
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    k.box(3.4, 3.0, 0.5, 'glass', x + Math.cos(a) * (R + 0.1), y + 3.2, z + Math.sin(a) * (R + 0.1), { ry: -a, emit: 0.14, mat: MAT.flat });
  }
  // domed roof + meridional ribs
  k.dome(R, 'slate', x, y + drumH, z, { seg: 28, rings: 9 });
  const y0 = y + drumH;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    let prev = [x + Math.cos(a) * (R + 0.2), y0, z + Math.sin(a) * (R + 0.2)];
    const N = 3;
    for (let s = 1; s <= N; s++) {
      const th = (s / N) * (Math.PI / 2);
      const rr = (R + 0.2) * Math.cos(th);
      const yy = y0 + Rise * Math.sin(th);
      const pt = [x + Math.cos(a) * rr, yy, z + Math.sin(a) * rr];
      k.segment(prev, pt, 0.5, 0.5, 'graniteLight', { round: true, seg: 4 });
      prev = pt;
    }
  }
  // lantern + finial
  k.cyl(2.2, 2.2, 1.6, 10, 'graniteLight', x, y0 + Rise, z);
  k.dome(2.2, 'lead', x, y0 + Rise + 1.6, z, { seg: 12, rings: 5 });
  k.cyl(0.12, 0.12, 2.0, 5, 'iron', x, y0 + Rise + 3.6, z);
  k.sphere(0.28, 'gold', x, y0 + Rise + 5.6, z, { seg: 7, rings: 5, emit: 0.5 });
  // entrance portico facing the river (-z)
  k.push({ x, z: z - R - 2 });
  k.box(14, 6.2, 4, 'graniteLight', 0, y, 0);
  k.box(14.6, 0.8, 5, 'granite', 0, y + 6.2, 0);
  for (let i = 0; i < 5; i++) k.column(5.6, 0.4, 'graniteLight', -5 + i * 2.5, y, 3.2, { smooth: true });
  k.box(13, 3.2, 0.4, 'glass', 0, y + 1.4, 1.1, { emit: 0.12, mat: MAT.flat });
  k.pop();
  k.end('pavilion');
}

function builder(k, site) {
  const o = site?.footprint?.outline;
  const bb = o && o.length >= 3 ? obb(o) : { L: 210, W: 150, cx: 0, cz: 0, a: 0 };
  const L = Math.max(80, Math.min(300, bb.L));
  const W = Math.max(60, Math.min(220, bb.W));
  const rnd = k.rnd;

  k.push({ x: bb.cx, z: bb.cz, ry: bb.a });
  k.begin('gardens');
  // park ground: grass with a paved walk grid
  k.prism(rect(0, 0, L, W), -0.25, 0.25, 'grass');
  for (const zc of [W * 0.18, W * 0.4]) k.prism(rect(0, zc, L * 0.92, 3.2), 0, 0.12, 'sand');
  for (const xc of [-L * 0.28, 0, L * 0.28]) k.prism(rect(xc, -W * 0.1, 3.0, W * 0.8), 0, 0.12, 'sand');
  // two raised terraces climbing toward the city (+z), with retaining walls
  for (let t = 0; t < 2; t++) {
    const zc = W * (0.26 + t * 0.2);
    const w = L * (0.82 - t * 0.12);
    const d = W * 0.18;
    const hgt = 1.2 * (t + 1);
    k.prism(rect(0, zc, w, d), 0, hgt, 'graniteDark');
    k.prism(rect(0, zc, w - 1.4, d - 1.4), 0, hgt + 0.05, 'grass');
    k.balustrade(w, 0.9, 'graniteLight', 0, hgt, zc - d / 2, { cheap: true, d: 0.22, sp: 0.55 });
  }
  // clipped hedges edging the lawns
  for (const s of [-1, 1]) {
    k.prism(rect(s * L * 0.42, -W * 0.05, 1.2, W * 0.6), 0, 0.9, 'hedge');
  }
  k.end('gardens');

  // ------------------------------------------------------------- mirador
  k.begin('mirador');
  k.prism(rect(0, -W / 2 + 1, L * 0.72, 4), -0.1, 0.5, 'graniteLight');
  k.balustrade(L * 0.72, 1.1, 'graniteLight', 0, 0.4, -W / 2 - 0.6, { cheap: true, d: 0.24, sp: 0.5, posts: 8 });
  k.prism(rect(0, -W / 2 - 40, L + 80, 70), -4, 0.5, 'water', { emit: 0.05 });
  k.end('mirador');

  // the Pavilhão Rosa Mota at the centre of the gardens
  pavilion(k, 0, 0, 0);

  // -------------------------------------------------------------- planting
  k.begin('trees');
  let placed = 0;
  let guard = 0;
  while (placed < 26 && guard < 400) {
    guard++;
    const tx = (rnd() - 0.5) * (L - 16);
    const tz = (rnd() - 0.5) * (W - 16);
    if (Math.hypot(tx, tz) < 32) continue;          // keep clear of the pavilion
    if (tz > W * 0.2) continue;                     // terraces kept open
    const kind = rnd();
    const h = 7 + rnd() * 6;
    if (kind < 0.16) k.tree(tx, 0, tz, h, { kind: 'cypress' });
    else if (kind < 0.3) k.tree(tx, 0, tz, h * 0.8, { kind: 'topiary' });
    else k.tree(tx, 0, tz, h, { crown: rnd() > 0.5 ? 'round' : 'oval', lobes: 2 });
    placed++;
  }
  // avenue of limes along the main walk
  for (let i = 0; i < 12; i++) {
    const tx = -L * 0.34 + (L * 0.68 * i) / 11;
    if (Math.abs(tx) < 26) continue;
    k.tree(tx, 0, W * 0.17, 8, { crown: 'oval' });
  }
  k.end('trees');

  // a small romanesque museum villa by the entrance
  k.box(14, 6, 9, 'plaster', -L * 0.32, 0, -W * 0.28);
  k.push({ x: -L * 0.32, z: -W * 0.28 });
  k.hipRoof(14, 9, 3, 'terracotta', 0, 6, 0, { over: 0.6 });
  k.pop();
  k.corniceRing(14, 9, corniceProfile('band', 0.4), 'granite', -L * 0.32, 6, -W * 0.28);
  k.pop();
}
builder.metric = true;
builder.rule = { note: 'Palácio de Cristal gardens: ribbed-dome pavilion on terraced lawns over the Douro' };
export default { 'palacio-cristal': builder };
