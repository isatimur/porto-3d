// Estação Ferroviária de General Torres, Vila Nova de Gaia. On the Linha do
// Norte between Campanhã and Gaia: the line opened on 5 November 1877; a
// shelter was installed in 1902 (then an apeadeiro, "Apeadeiro da Rua do
// General Torres"); the present station was rebuilt and opened in early
// 1994 under the Porto rail-node programme, and remodelled in 2018. The
// model is the station head building and its platform canopy.
import { Kit, PALETTE, MAT, PROFILES, corniceProfile } from '../kit.js';
import { edges, obb, offset, bbox, rect } from '../geom.js';
import { win } from '../parts.js';
import { fitTo } from './site-fit.js';

// Documented fallback: the OSM outline of the station (way 1312447799),
// 106.7 x 8.2 m at bearing 79.9 deg (data/dimensions.json).
const FB = { x0: -4.07, x1: 4.07, z0: -53.34, z1: 53.34 };

function builder(k, site) {
  const o = site?.footprint?.outline;
  const b = o && o.length >= 3 ? bbox(o) : bbox([[FB.x0, FB.z0], [FB.x1, FB.z1], [FB.x0, FB.z1], [FB.x1, FB.z0]]);
  const BOX = { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, w: b.w, d: b.d, cx: b.cx, cz: b.cz };
  // Drawn box as modelled: the clock and the canopy eaves reach 9.74 m across
  // (the OSM corridor is 8.14 m) and the steep head roof reaches 12.6 m.
  // fitTo() scales this drawn box onto the OSM extent, so the reported main
  // block matches the footprint instead of the unscaled overhang.
  const DRAWN = { w: 9.74, d: BOX.d, h: 12.6 };
  const done = fitTo(k, site, { ...DRAWN, cx: BOX.cx, cz: BOX.cz }, BOX);

  const W = BOX.w;
  const D = BOX.d;
  const cx = BOX.cx;
  const cz = BOX.cz;
  const rnd = k.rnd;

  k.begin('main');
  // ballast + platform deck filling the outline (model extent)
  k.prism(rect(cx, cz, W, D), -0.6, 0.6, 'graniteDark');
  k.prism(rect(cx, cz, W - 0.5, D - 1), 0, 0.8, 'graniteWarm');
  // two rails along the track corridor
  for (const s of [-1, 1]) {
    k.box(0.12, 0.16, D - 2, 'iron', cx + s * (W / 2 - 0.7), 0.8, cz);
    for (let i = 0; i < Math.round(D / 1.2); i++) k.box(W - 1.8, 0.08, 0.22, 'wood', cx, 0.66, cz - D / 2 + 1 + i * 1.2);
  }

  // ---------------- head building (south end), steep gable roof
  const bD = 34;
  const bZ = cz - D / 2 + bD / 2 + 1;
  k.prism(rect(cx, bZ, W - 0.6, bD), 0, 6.6, 'plaster');
  k.box(W - 0.6, 0.35, bD, 'granite', cx, 0.8, bZ);
  k.corniceRing(W - 0.2, bD, corniceProfile('eave', 0.4), 'granite', cx, 6.6, bZ);
  k.push({ x: cx, z: bZ });
  // steep roof reaching the real 12 m
  k.gableRoof(W + 0.6, bD + 1.0, 5.4, 'slate', 0, 6.9, 0, { over: 0.5 });
  k.pop();
  // door and windows on both platform faces
  for (const s of [-1, 1]) {
    k.push({ x: cx + s * (W / 2 - 0.3), z: bZ, ry: s * Math.PI / 2 });
    k.wall(bD * 0.5, 4.4, 0.5, 'graniteWarm', [{ x: 0, y: 0, w: 2.2, h: 3.4, arch: 'round', pane: 'glass', inset: 0.3 }], 0, 0, 0);
    for (const dx of [-bD * 0.28, bD * 0.28]) win(k, dx, 1.2, 1.3, 2.4, 0.05, { trim: 'granite', pane: 'glass', bw: 0.22, depth: 0.25, arch: 'round', sill: true });
    k.pop();
  }
  // clock + name board on the town (+x) face
  k.cyl(0.9, 0.9, 0.25, 16, 'granite', cx + W / 2 - 0.1, 4.6, bZ, { rx: Math.PI / 2 });
  k.cyl(0.68, 0.68, 0.18, 16, 'white', cx + W / 2 + 0.06, 4.6, bZ, { rx: Math.PI / 2 });
  k.box(0.1, 0.5, 0.06, 'dark', cx + W / 2 + 0.18, 4.6, bZ);
  k.box(0.5, 1.4, 6, 'doorBlue', cx + W / 2 - 0.2, 2.6, bZ);

  // ---------------- platform canopy on cast-iron columns
  const cZ0 = bZ + bD / 2 + 3;
  const cZ1 = cz + D / 2 - 3;
  const nCol = Math.max(3, Math.round((cZ1 - cZ0) / 7));
  for (let i = 0; i <= nCol; i++) {
    const pz = cZ0 + ((cZ1 - cZ0) * i) / nCol;
    for (const s of [-1, 1]) {
      k.cyl(0.11, 0.16, 4.6, 6, 'lampGreen', cx + s * (W / 2 - 0.5), 0.8, pz);
      k.box(0.55, 0.16, 0.55, 'lampGreen', cx + s * (W / 2 - 0.5), 5.4, pz);
    }
    // lattice tie
    k.box(W - 1.0, 0.14, 0.14, 'iron', cx, 5.2, pz);
  }
  // canopy roof
  k.box(W + 1.2, 0.22, cZ1 - cZ0 + 2.4, 'iron', cx, 5.5, (cZ0 + cZ1) / 2);
  k.box(W + 1.0, 0.1, cZ1 - cZ0 + 2.0, 'glass', cx, 5.72, (cZ0 + cZ1) / 2, { emit: 0.06, mat: MAT.flat });
  // platform lighting + benches
  for (let i = 1; i < nCol; i++) {
    const pz = cZ0 + ((cZ1 - cZ0) * i) / nCol;
    k.lamp(4.2, cx + (i % 2 ? 1 : -1) * (W / 2 - 1.2), 0.8, pz, { globe: true });
    k.box(1.8, 0.4, 0.5, 'wood', cx + (i % 2 ? -1 : 1) * (W / 2 - 1.4), 1.1, pz + 2);
  }
  // --- detail pass: glazed canopy bays, name boards and platform clocks
  for (let i = 0; i < nCol; i++) {
    const pz = cZ0 + ((cZ1 - cZ0) * (i + 0.5)) / nCol;
    k.box(W - 1.2, 0.06, 0.9, 'glass', cx, 5.63, pz, { mat: 0, emit: 0.06 });
  }
  k.box(0.35, 2.2, 0.2, 'doorBlue', cx + W / 2 - 0.2, 0.8, cZ0 + 3);
  k.box(0.35, 2.2, 0.2, 'doorBlue', cx - W / 2 + 0.2, 0.8, cZ1 - 3);
  for (const pz of [cZ0 + (cZ1 - cZ0) * 0.35, cZ0 + (cZ1 - cZ0) * 0.7]) {
    k.box(2.0, 0.4, 0.5, 'wood', cx, 0.8, pz);
    k.cyl(0.7, 0.7, 0.2, 14, 'granite', cx, 4.6, pz, { rx: Math.PI / 2 });
    k.cyl(0.52, 0.52, 0.14, 12, 'white', cx, 4.75, pz, { rx: Math.PI / 2 });
  }
  k.end('main');

  done();
}
builder.metric = true;
builder.rule = {
  note: 'Estação de General Torres (Gaia): Linha do Norte station (line 1877; rebuilt 1994, remodelled 2018), head building + platform canopy',
  extent: { box: { x0: -4.07, x1: 4.07, z0: -53.34, z1: 53.34 } },
  fitTo: true,
};
export default { 'estacao-general-torres': builder };
