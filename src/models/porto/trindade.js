// Igreja da Trindade, Praça da Trindade, Porto — behind the Câmara
// Municipal. Built through the 19th century to a design by Carlos Amarante
// (buried here), opened for worship on 5 June 1841; large neoclassical
// granite church with a tall twin-tower front and a José de Brito altar
// panel (the Baptism of Christ). The old Ordem Terceira and its hospital
// occupy the south ranges.
import { Kit, PALETTE, MAT, PROFILES, corniceProfile } from '../kit.js';
import { edges, obb, offset, bbox, rect } from '../geom.js';
import { win, bellTower, pediment, flutedColumn } from '../parts.js';
import { fitTo } from './site-fit.js';

// Documented fallback: the OSM outline of the Trindade conjunto (way
// 286005374), 78.8 x 30.1 m at bearing 33.3 deg (data/dimensions.json).
const FB = { x0: -15.07, x1: 15.07, z0: -39.27, z1: 39.27 };

function builder(k, site) {
  const o = site?.footprint?.outline;
  const b = o && o.length >= 3 ? bbox(o) : bbox([[FB.x0, FB.z0], [FB.x1, FB.z1], [FB.x0, FB.z1], [FB.x1, FB.z0]]);
  const BOX = { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, w: b.w, d: b.d, cx: b.cx, cz: b.cz };
  const H = site?.dims?.height_m?.total ?? 30;
  const done = fitTo(k, site, { w: BOX.w, d: BOX.d, h: H, cx: BOX.cx, cz: BOX.cz }, BOX);

  const W = BOX.w;
  const D = BOX.d;
  const cx = BOX.cx;
  const cz = BOX.cz;

  k.begin('main');
  // granite platform filling the outline (model extent)
  k.prism(rect(cx, cz, W, D), -0.5, 0.5, 'graniteDark');

  const nw = 19;
  const nd = D - 12;
  const ncz = cz + 3;
  // nave
  k.prism(rect(cx, ncz, nw, nd), 0, 17, 'graniteWarm');
  k.corniceRing(nw, nd, corniceProfile('eave', 0.6), 'granite', cx, 16.7, ncz);
  k.push({ x: cx, z: ncz });
  k.gableRoof(nw + 0.5, nd + 1.4, 4.8, 'terracotta', 0, 17, 0, { over: 0.65 });
  k.pop();
  // buttressed side walls with tall windows
  for (let i = 0; i < 5; i++) {
    const wz = ncz - nd / 2 + 3.5 + (i * (nd - 7)) / 4;
    for (const s of [-1, 1]) {
      k.push({ x: cx + s * (nw / 2 + 0.6), z: wz, ry: s * Math.PI / 2 });
      win(k, 0, 5.5, 1.5, 5.0, 0.1, { trim: 'granite', pane: 'glass', arch: 'round', bw: 0.32, depth: 0.3, sill: true });
      k.pop();
    }
  }
  // polygonal apse at the back (-z)
  k.push({ x: cx, z: ncz - nd / 2 });
  k.prism([[-6, 0], [-4, -6], [4, -6], [6, 0], [4, 1], [-4, 1]], 0, 14, 'graniteWarm');
  k.pop();

  // ---------------- twin-tower neoclassical facade on +z
  const fz = ncz + nd / 2;
  const fw = nw + 4;
  k.wall(fw, 21, 1.4, 'graniteWarm', [{ x: 0, y: 0, w: 3.6, h: 7.6, arch: 'round', pane: 'dark', inset: 0.6 }], cx, 0, fz - 0.5);
  k.box(fw + 1, 1.3, 2.1, 'granite', cx, 0, fz - 0.6);
  k.box(fw + 1, 1.2, 2.1, 'granite', cx, 21, fz - 0.6);
  k.surround({ x: 0, y: 0, w: 3.6, h: 7.6, arch: 'round' }, 0.5, 0.7, 'granite', fz + 0.5);
  // engaged columns and three windows over the door
  for (const s of [-1, 1]) flutedColumn(k, 15, 0.5, 'graniteLight', cx + s * 5.2, 0.5, fz - 0.1, { flutes: 10, capital: 'ionic' });
  for (const sx of [-1, 0, 1]) win(k, cx + sx * 4.4, 9.6, 1.8, 3.6, fz + 0.2, { trim: 'granite', pane: 'glass', arch: sx === 0 ? 'round' : undefined, sill: true, bw: 0.34 });
  pediment(k, fw * 0.82, 4.0, 1.1, 'granite', cx, 21.2, fz - 0.4);
  // oculus in the tympanum
  k.cyl(1.4, 1.4, 0.4, 16, 'graniteLight', cx, 22.8 - 1.4, fz + 0.1, { rx: Math.PI / 2 });
  k.cyl(1.0, 1.0, 0.3, 16, 'window', cx, 22.8 - 1.0, fz + 0.32, { rx: Math.PI / 2, emit: 0.4 });
  k.box(0.16, 2.6, 0.16, 'iron', cx, 25.6, fz - 0.2);
  k.box(1.1, 0.16, 0.16, 'iron', cx, 27.1, fz - 0.2);
  for (const s of [-1, 1]) {
    bellTower(k, {
      w: 5.4, hBody: 17.5, hBelfry: 5.0,
      x: cx + s * (fw / 2 - 2.3), z: fz - 1.7,
      body: 'graniteWarm', trim: 'granite', cap: 'pyramid', capH: 5.0,
      openings: 1, windows: 2, winArch: 'round', urns: false, balustrade: false, cross: false, lantern: false,
    });
  }

  // ---------------- Ordem Terceira / hospital ranges to the south
  const rH = 12;
  k.prism(rect(cx, cz - D / 2 + 6, W - 2, 12), 0, rH, 'plaster');
  k.corniceRing(W - 2, 12, corniceProfile('eave', 0.45), 'granite', cx, rH - 0.3, cz - D / 2 + 6);
  k.push({ x: cx, z: cz - D / 2 + 6 });
  k.hipRoof(W - 2, 12, 3.2, 'terracotta', 0, rH, 0, { over: 0.6 });
  k.pop();
  for (let i = 0; i < 6; i++) {
    for (const wy of [2.0, 5.8, 9.4]) {
      if (wy + 1.9 > rH) continue;
      win(k, -W / 2 + 3 + (i * (W - 6)) / 5, wy, 1.1, 1.8, cz - D / 2 + 12.1, { trim: 'granite', pane: 'glass', bw: 0.2, depth: 0.25, sill: true });
    }
  }
  k.end('main');

  done();
}
builder.metric = true;
builder.rule = {
  note: 'Igreja da Trindade (Porto): 19th-c. church by Carlos Amarante (opened 1841), twin-tower front + Ordem Terceira ranges',
  extent: { box: { x0: -15.07, x1: 15.07, z0: -39.27, z1: 39.27 } },
  fitTo: true,
};
export default { trindade: builder };
