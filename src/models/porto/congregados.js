// Igreja de Santo António dos Congregados, Praça de Almeida Garrett /
// Avenida dos Aliados, Porto. Baroque twin-tower facade (1703, Congregação
// do Oratório), azulejo panels by Jorge Colaço (1920), mummified Pope
// St Clement relic inside. The model is the church plus its two towers.
import { Kit, PALETTE, MAT, PROFILES, corniceProfile } from '../kit.js';
import { edges, obb, offset, bbox, rect } from '../geom.js';
import { win, bellTower, scrollCrest, pediment } from '../parts.js';
import { fitTo } from './site-fit.js';

// Documented fallback: the OSM outline of the church (way 395125611),
// 17.4 x 41.3 m at bearing 13.5 deg (data/dimensions.json). Used only when
// no footprint is handed to the builder (direct node import).
const FB = { x0: -8.71, x1: 8.71, z0: -20.63, z1: 20.63 };

function builder(k, site) {
  const o = site?.footprint?.outline;
  const b = o && o.length >= 3 ? bbox(o) : bbox([[FB.x0, FB.z0], [FB.x1, FB.z1], [FB.x0, FB.z1], [FB.x1, FB.z0]]);
  const BOX = { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, w: b.w, d: b.d, cx: b.cx, cz: b.cz };
  // Drawn height (facade cross, y 0..28.8 m). fitTo() scales the drawn model
  // to dimensions.json's twin-tower total (35 m).
  const DRAWN_H = 28.8;
  const done = fitTo(k, site, { w: BOX.w, d: BOX.d, h: DRAWN_H, cx: BOX.cx, cz: BOX.cz }, BOX);

  const W = BOX.w;
  const D = BOX.d;
  const cx = BOX.cx;
  const cz = BOX.cz;
  const zF = cz + D / 2 - 1.8;
  const nw = W - 3.4;
  const nd = D - 8;
  const ncz = cz - 2.4;

  k.begin('main');
  // granite platform filling the OSM outline; its box is the model extent
  k.prism(rect(cx, cz, W, D), -0.5, 0.5, 'graniteDark');
  // nave
  k.prism(rect(cx, ncz, nw, nd), 0, 16.5, 'graniteWarm');
  k.corniceRing(nw, nd, corniceProfile('eave', 0.55), 'granite', cx, 16.2, ncz);
  k.push({ x: cx, z: ncz });
  k.gableRoof(nw + 0.5, nd + 1.4, 4.4, 'terracotta', 0, 16.5, 0, { over: 0.7 });
  k.pop();
  // shallow side chapels widening the nave to the outline
  for (const s of [-1, 1]) {
    k.prism(rect(cx + s * (W / 2 - 1.3), ncz - 3, 2.8, nd - 6), 0, 11, 'graniteWarm');
    k.push({ x: cx + s * (W / 2 - 1.3), z: ncz - 3 });
    k.hipRoof(2.8, nd - 6, 2.2, 'terracotta', 0, 11, 0, { over: 0.5 });
    k.pop();
  }
  k.end('main');

  // ---------------- baroque facade on the Aliados
  // height: the facade + towers govern the reported height (they rise above
  // the nave); fit.js takes the max of the 'main' and 'height' groups.
  k.begin('height');
  k.begin('facade');
  const fw = nw + 2.6;
  k.wall(fw, 20.5, 1.3, 'graniteWarm', [{ x: 0, y: 0, w: 3.2, h: 6.2, arch: 'round', pane: 'dark', inset: 0.5 }], cx, 0, zF - 0.5);
  k.box(fw + 0.8, 1.2, 1.9, 'granite', cx, 0, zF - 0.6);
  k.box(fw + 0.8, 1.1, 1.9, 'granite', cx, 20.5, zF - 0.6);
  k.surround({ x: 0, y: 0, w: 3.2, h: 6.2, arch: 'round' }, 0.45, 0.6, 'granite', zF + 0.45);
  win(k, 0, 8.4, 2.0, 3.2, zF + 0.2, { trim: 'granite', pane: 'glass', arch: 'round', sill: true, bw: 0.35, head: 'seg' });
  for (const s of [-1, 1]) {
    win(k, s * 4.6, 3.2, 1.5, 3.4, zF + 0.15, { trim: 'granite', pane: 'glass', sill: true, bw: 0.3 });
    win(k, s * 4.6, 10.5, 1.4, 2.6, zF + 0.15, { trim: 'granite', pane: 'glass', sill: true, bw: 0.28, arch: 'round' });
  }
  // azulejo panels (Jorge Colaço, 1920) flanking the portal
  for (const s of [-1, 1]) k.wall(3.0, 4.4, 0.35, 'azulejo', [], cx + s * 4.6, 13.8, zF + 0.12);
  // segmental pediment + scroll crest + cross
  pediment(k, fw * 0.62, 2.6, 0.9, 'granite', cx, 20.6, zF - 0.4);
  scrollCrest(k, 5.6, 3.0, 0.8, 'graniteLight', cx, 23.2, zF - 0.2);
  k.box(0.16, 2.2, 0.16, 'iron', cx, 26.6, zF - 0.1);
  k.box(1.0, 0.16, 0.16, 'iron', cx, 28.0, zF - 0.1);
  k.end('facade');

  // ---------------- twin bell towers (pyramid tops)
  k.begin('towers');
  for (const s of [-1, 1]) {
    bellTower(k, {
      w: 4.9, hBody: 15.5, hBelfry: 4.6,
      x: cx + s * (W / 2 - 2.6), z: zF - 1.6,
      body: 'graniteWarm', trim: 'granite', cap: 'pyramid', capH: 4.6,
      openings: 1, windows: 2, winArch: 'round', clock: false,
      urns: false, balustrade: false, cross: false, lantern: false,
    });
  }
  k.end('towers');
  k.end('height');

  // a low sacristy range closing the back of the outline
  k.begin('back');
  k.prism(rect(cx, cz - D / 2 + 1.6, W - 4, 3.2), 0, 5.4, 'plaster');
  k.push({ x: cx, z: cz - D / 2 + 1.6 });
  k.hipRoof(W - 4, 3.2, 1.8, 'terracotta', 0, 5.4, 0, { over: 0.5 });
  k.pop();
  k.end('back');

  // --- detail pass: nave ridge tiles, two facade niches and an azulejo dado
  for (let i = 0; i < 12; i++) {
    const tz = ncz - nd / 2 + 2 + (i * (nd - 4)) / 11;
    k.box(0.5, 0.24, 0.44, 'terracotta', cx, 20.95, tz);
  }
  for (const s of [-1, 1]) {
    k.surround({ x: 0, y: 6.9, w: 1.3, h: 2.2, arch: 'round' }, 0.22, 0.35, 'granite', cx + s * 4.6, 0, zF + 0.15);
    k.statue(1.5, 'graniteLight', cx + s * 4.6, 6.95, zF + 0.55, { pose: 'pray' });
  }
  k.box(2.6, 0.4, 0.3, 'azulejo', cx, 0.2, zF + 0.2, { mat: MAT.azulejo });

  done();
}
builder.metric = true;
builder.rule = {
  note: 'Igreja dos Congregados: baroque twin-tower facade on the Aliados (1703), azulejo by Jorge Colaço (1920)',
  extent: { box: { x0: -8.71, x1: 8.71, z0: -20.63, z1: 20.63 } },
  fitTo: true,
};
export default { congregados: builder };
