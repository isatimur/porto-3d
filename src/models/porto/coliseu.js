// Coliseu do Porto (Cassiano Branco & Júlio de Brito, opened 19 Dec 1941).
// Art Deco concert hall: a plaster mass on the OSM block, a shallow curved
// white facade with vertical fins, an asymmetric entry tower and marquee, and
// a taller stage fly tower at the back. 1:1 on the outline.
import { Kit, PROFILES, corniceProfile } from '../kit.js';
import { polyCornice, polyBand, polyWindows, roofOver } from '../metric.js';
import { win } from '../parts.js';
import { bbox, offset, rect, edges } from '../geom.js';
import { fitTo } from './site-fit.js';

function builder(k, site) {
  const fp = site?.footprint;
  const o = fp?.outline && fp.outline.length >= 3 ? fp.outline : null;
  const b = o ? bbox(o) : { w: 60.1, d: 103.5, cx: 0, cz: 0, x0: -30, x1: 30, z0: -51.8, z1: 51.8 };
  const plan = o || rect(b.cx, b.cz, b.w, b.d);
  const dimsH = site?.dims?.height_m?.total ?? 32;
  const done = fitTo(k, site, { w: b.w, d: b.d, h: dimsH, cx: b.cx, cz: b.cz }, b);

  const H = dimsH;
  const hallH = H * 0.75;
  const zf = b.z1;

  k.begin('main');

  // plinth and main plaster mass
  k.prism(offset(plan, 1.2), 0, 2.2, 'graniteDark');
  k.prism(plan, 2.2, hallH - 2.2, 'plaster');
  k.prism(offset(plan, -0.8), hallH, H - hallH, 'plaster');
  polyCornice(k, plan, hallH, corniceProfile('eave', 0.9), 'granite');
  polyCornice(k, offset(plan, -0.8), hallH + (H - hallH) - 0.4, corniceProfile('classic', 0.7), 'graniteLight');
  roofOver(k, offset(plan, -0.8), H, 1.6, 'lead', 'flat', { t: 0.6, flatColor: 'lead' });
  polyBand(k, plan, hallH * 0.55, 0.4, 0.22, 'graniteLight');

  // recessed vertical Art Deco strips in the plaster
  for (const e of edges(plan)) {
    if (e.len < b.d * 0.35) continue;
    k.push({ x: e.mx + e.nx * 0.06, z: e.mz + e.nz * 0.06, ry: e.ry });
    const n = Math.max(4, Math.floor(e.len / 3.4));
    for (let i = 0; i < n; i++) {
      const u = -e.len / 2 + (e.len / n) * (i + 0.5);
      k.box(0.5, hallH - 3.4, 0.9, 'graniteLight', u, 2.6, 0);
    }
    k.pop();
  }

  // windows: deep-set bays on every facade
  polyWindows(k, plan, {
    bay: 4.6, w: 1.35, h: 2.9,
    storeys: [3.6, 8.4, 13.2, 18.0],
    win: { trim: 'granite', pane: 'glass', bw: 0.24, depth: 0.35 },
  });

  // ---- shallow curved white entrance facade on the front (+z)
  k.begin('facade');
  const bulge = 4.2;
  const halfW = b.w * 0.44;
  const N = 22;
  for (let i = 0; i <= N; i++) {
    const u = -1 + (2 * i) / N;
    const x = b.cx + halfW * u;
    const z = zf + bulge * (1 - u * u) - 1.0;
    const ry = -Math.atan2(-2 * bulge * u / halfW, 1);
    k.box(0.85, hallH - 1.0, 1.3, 'white', x, 1.0, z, { ry });
    if (i < N) k.box(1.9, hallH - 9.0, 0.5, 'glass', x + halfW / N, 2.6, z, { ry, emit: 0.14 });
  }
  // deep entrance portal and marquee
  k.box(halfW * 1.3, hallH * 0.72, 2.0, 'graniteLight', b.cx, 0.4, zf + bulge - 0.4);
  k.box(3.2, 0.5, 5.4, 'white', b.cx, 6.6, zf + bulge + 2.4);
  k.box(18, 0.7, 1.2, 'white', b.cx, 7.1, zf + bulge + 4.6);
  for (const sx of [-1, 1]) k.cyl(0.18, 0.18, 3.6, 8, 'steel', b.cx + sx * 7.5, 3.0, zf + bulge + 5.0);
  for (let i = 0; i < 9; i++) {
    const c = i % 3 === 0 ? 'window' : 'dark';
    k.box(1.2, 1.5, 0.25, c, b.cx - 6.4 + i * 1.6, 7.4, zf + bulge + 4.2, { emit: i % 3 === 0 ? 0.6 : 0 });
  }
  // entry glazing behind the fins
  k.push({ x: b.cx, z: zf + bulge - 1.4 });
  k.box(halfW * 1.5, 6.4, 0.4, 'glass', 0, 1.0, 0, { emit: 0.22 });
  k.pop();
  k.end('facade');

  // ---- asymmetric corner tower beside the entrance
  k.begin('tower');
  const tx = b.cx + halfW + 3.2;
  k.box(9.0, H * 0.94, 9.0, 'white', tx, 0, zf - 7);
  k.corniceRing(9.0, 9.0, corniceProfile('classic', 0.7), 'graniteLight', tx, hallH, zf - 7);
  k.box(10.0, 1.0, 10.0, 'graniteLight', tx, hallH, zf - 7);
  for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    k.push({ x: tx, z: zf - 7, ry });
    k.box(2.4, 6.2, 0.5, 'glass', 0, 3.0, 4.4, { emit: 0.16 });
    k.box(0.5, 6.2, 1.0, 'white', -1.3, 3.0, 4.6);
    k.box(0.5, 6.2, 1.0, 'white', 1.3, 3.0, 4.6);
    k.pop();
  }
  k.end('tower');

  // ---- stage fly tower at the back (-z)
  k.begin('flytower');
  const fz = b.z0 + b.d * 0.30;
  k.box(b.w * 0.6, H, b.d * 0.34, 'graniteGrey', b.cx, 0, fz);
  k.box(b.w * 0.62, 1.0, b.d * 0.35, 'graniteDark', b.cx, H - 1.0, fz);
  for (const e of edges(rect(b.cx, fz, b.w * 0.6, b.d * 0.34))) {
    if (Math.abs(e.nz) < 0.5) continue;
    k.push({ x: e.mx, z: e.mz, ry: e.ry });
    for (let i = 0; i < 7; i++) k.box(0.6, H - 3, 0.8, 'graniteDark', -b.w * 0.24 + i * (b.w * 0.08), 2, 0.1);
    k.pop();
  }
  k.end('flytower');

  k.end('main');
  done();
}

builder.metric = true;
builder.rule = {
  extent: { box: { x0: -30, x1: 30, z0: -51.8, z1: 51.8 } },
  fitTo: true,
  note: 'Coliseu do Porto: 1941 Art Deco hall, curved white facade, fly tower',
};
export default { coliseu: builder };
