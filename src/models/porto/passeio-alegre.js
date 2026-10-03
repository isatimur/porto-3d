// Jardim do Passeio Alegre, Foz do Douro (late 19th c., Émile David). The flat
// riverside garden at the mouth of the Douro: lawns crossed by gravel paths,
// clipped hedges, avenues of palms and planes, the bandstand (coreto), the
// Nasoni fountain and the two obelisks from the Quinta da Prelada, the Swiss
// chalet and the lamp-lined promenade on the river.
import { corniceProfile, PROFILES } from '../kit.js';
import { bbox, rect } from '../geom.js';
import { fitTo } from './site-fit.js';

function passeio(k, site) {
  const o = site?.footprint?.outline;
  const b = o && o.length >= 3 ? bbox(o) : { w: 394, d: 147.1, cx: 0, cz: 0 };
  const W = Math.max(40, b.w);
  const D = Math.max(30, b.d);
  const H = 8;
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  // lawn exactly filling the footprint box
  k.prism(rect(0, 0, W, D), 0, 0.18, 'grass');
  // gravel promenade along the river edge and a main cross path
  k.prism(rect(0, D / 2 - D * 0.06, W, D * 0.10), 0.18, 0.06, 'sand');
  k.prism(rect(0, 0, W * 0.06, D), 0.18, 0.06, 'sand');
  k.prism(rect(0, -D * 0.05, W, D * 0.05), 0.18, 0.06, 'sand');

  // clipped hedge borders framing the lawns
  for (const z of [D * 0.30, -D * 0.30]) {
    for (const s of [-1, 1]) {
      const len = W * 0.40;
      const cx = s * W * 0.24;
      k.box(len, 1.0, 0.9, 'hedge', cx, 0.18, z);
    }
  }

  // central flower parterre
  k.prism(rect(0, D * 0.12, W * 0.16, D * 0.22), 0.18, 0.08, 'flowerRed');
  k.prism(rect(0, D * 0.12, W * 0.10, D * 0.14), 0.18, 0.10, 'flowerYellow');
  k.prism(rect(0, D * 0.12, W * 0.04, D * 0.06), 0.18, 0.12, 'flowerPink');

  // Nasoni fountain (basin, column and top bowl)
  const fx = -W * 0.20;
  const fz = 0;
  k.prism(rect(fx, fz, 7.5, 7.5), 0.18, 0.5, 'granite');
  k.lathe(PROFILES.basin, 12, 'graniteLight', fx, 0.68, fz, { sr: 3.0, sh: 1.5, smooth: true });
  k.column(2.6, 0.55, 'graniteLight', fx, 2.2, fz, { smooth: true });
  k.lathe(PROFILES.urn, 10, 'graniteLight', fx, 4.6, fz, { sr: 1.5, sh: 1.2, smooth: true });
  k.sphere(0.35, 'granite', fx, 5.9, fz, { seg: 8, rings: 5 });

  // two obelisks of the Quinta da Prelada (Nasoni) on the promenade
  for (const s of [-1, 1]) {
    k.pinnacle(6.5, 'graniteLight', W * 0.30, 0.18, s * D * 0.18);
    k.prism(rect(W * 0.30, s * D * 0.18, 2.4, 2.4), 0.18, 0.5, 'granite');
  }

  // bandstand (coreto): octagonal platform, eight columns, domed cap
  const kx = W * 0.16;
  const kz = D * 0.02;
  const oct = (cx, cz, r) => Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    return [cx + Math.cos(a) * r, cz + Math.sin(a) * r * 0.7];
  });
  k.prism(oct(kx, kz, 4.6), 0.18, 1.1, 'graniteLight');
  k.prism(oct(kx, kz, 4.9), 1.28, 0.18, 'granite');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    k.column(3.4, 0.24, 'graniteLight', kx + Math.cos(a) * 4.0, 1.46, kz + Math.sin(a) * 4.0 * 0.7, { smooth: true });
  }
  k.prism(oct(kx, kz, 4.5), 4.9, 0.5, 'graniteLight');
  k.dome(4.2, 'slate', kx, 5.4, kz, { seg: 12, rings: 5 });
  k.cyl(0.14, 0.18, 1.9, 6, 'graniteLight', kx, 5.9, kz);
  k.sphere(0.3, 'gold', kx, 7.9, kz, { seg: 8, rings: 5, emit: 0.4 });

  // Swiss chalet (Chalet do Carneiro): small house with a gable roof and porch
  const cx = -W * 0.34;
  const cz = D * 0.34;
  k.box(9.5, 4.2, 7.5, 'wood', cx, 0.18, cz);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.5, 4.4, 0.5, 'wood', cx + sx * 4.5, 0.18, cz + sz * 3.5);
  k.corniceRing(9.5, 7.5, corniceProfile('eave', 0.5), 'cream', cx, 4.38, cz);
  k.push({ x: cx, z: cz });
  k.gableRoof(9.9, 7.9, 2.6, 'terracotta', 0, 4.6, 0, { ry: Math.PI / 2 });
  k.pop();
  k.box(3.2, 2.8, 0.4, 'glass', cx, 1.0, cz + 3.9, { emit: 0.12, mat: 0 });
  k.box(4.2, 0.3, 2.4, 'terracotta', cx, 3.0, cz + 4.8);
  for (const s of [-1, 1]) k.box(0.25, 3.0, 0.25, 'wood', cx + s * 1.9, 0.18, cz + 5.6);

  // avenues of palms and plane trees (the garden's signature)
  const rnd = k.rnd;
  for (let i = 0; i < 12; i++) {
    const px = -W * 0.42 + (W * 0.84 * i) / 11;
    k.tree(px, 0.18, D / 2 - D * 0.12, 6.4 + (i % 2) * 0.9, { kind: 'spread', color: 'foliage', spread: 0.22 });
    k.tree(px, 0.18, -D / 2 + D * 0.12, 6.0 + ((i + 1) % 2) * 0.9, { kind: 'round', color: 'foliageDark' });
  }
  for (let i = 0; i < 16; i++) {
    const px = -W * 0.40 + rnd() * W * 0.80;
    const pz = -D * 0.36 + rnd() * D * 0.72;
    const kind = rnd() > 0.5 ? 'round' : 'spread';
    k.tree(px, 0.18, pz, 5.2 + rnd() * 2.4, { kind, color: rnd() > 0.5 ? 'foliage' : 'foliageDark' });
  }
  for (let i = 0; i < 6; i++) {
    const px = -W * 0.30 + i * W * 0.12;
    k.tree(px, 0.18, D * 0.40, 3.4 + (i % 2), { kind: 'cypress' });
  }

  // lamp posts along the promenade
  for (let i = 0; i < 10; i++) {
    const px = -W * 0.42 + (W * 0.84 * i) / 9;
    k.lamp(3.4, px, 0.18, D / 2 - D * 0.05);
  }

  // --- detail: a river railing and two outer flower parterres
  k.box(W * 0.9, 0.7, 0.25, 'graniteLight', 0, 0.18, D / 2 - D * 0.02);
  for (let i = 0; i < 12; i++) {
    const px = -W * 0.42 + (W * 0.84 * i) / 11;
    k.cyl(0.05, 0.05, 1.2, 5, 'iron', px, 0.9, D / 2 - D * 0.02);
  }
  k.prism(rect(-W * 0.30, -D * 0.22, W * 0.12, D * 0.14), 0.18, 0.08, 'flowerPink');
  k.prism(rect(W * 0.30, -D * 0.22, W * 0.12, D * 0.14), 0.18, 0.08, 'flowerRed');

  done();
}
passeio.metric = true;
passeio.rule = {
  note: 'Jardim do Passeio Alegre: riverside garden, palms, coreto, Nasoni fountain and obelisks',
  fitTo: true,
};

export default { 'passeio-alegre': passeio };
