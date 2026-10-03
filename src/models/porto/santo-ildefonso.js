// Igreja de Santo Ildefonso, Porto (rebuilt 1730-1739; consecrated 18 July
// 1739). A proto-Baroque granite church on Praça da Batalha with two flanking
// bell towers and a facade clad in 1932 azulejo panels by Jorge Colaço showing
// scenes from the life of Saint Ildefonso. The interior is a polygonal nave
// with a rococo retable and a Nasoni-designed altarpiece.
import { Kit, PALETTE, MAT, PROFILES, corniceProfile } from '../kit.js';
import { onEdge } from '../metric.js';
import { win, bellTower, scrollCrest } from '../parts.js';
import { edges, offset, bbox, rect } from '../geom.js';
import { fitTo } from './site-fit.js';

function disc(k, r, th, color, x, y, z, o = {}) {
  k.cyl(r, r, th, o.seg ?? 20, color, x, y - th / 2, z, { rx: Math.PI / 2, ...o });
}

function builder(k, site) {
  const done = fitTo(k, site, { w: 15.9, d: 38.2, h: 30, cx: 0, cz: 0 });
  const o = site?.footprint?.outline;
  const b = o && o.length >= 3 ? bbox(o) : { w: 15.9, d: 38.2, cx: 0, cz: 0 };
  const W = Math.max(12, b.w);
  const D = Math.max(24, b.d);
  const cx = b.cx;
  const cz = b.cz;
  const zF = cz + D / 2;
  const zB = cz - D / 2;
  const H = 13.5;
  // granite plinth and the paved churchyard on Praça da Batalha
  k.prism(rect(cx, cz, W + 2.0, D + 1.6), 0, 1.0, 'granite');
  k.prism(rect(cx, zF + 9, W + 17, 16), -0.1, 0.22, 'graniteLight');

  // ------------------------------------------------------------- nave body
  k.begin('mask');
  k.prism(rect(cx, cz, W, D), 0, H, 'granite');
  k.prism(offset(rect(cx, cz, W, D), 0.25), 0, 2.0, 'graniteDark');
  k.corniceRing(W, D, corniceProfile('eave', 0.55), 'graniteLight', cx, H - 0.4, cz);
  k.push({ x: cx, z: cz });
  k.gableRoof(W + 0.4, D + 1.0, 4.6, 'terracotta', 0, H, 0, { over: 0.7 });
  k.pop();
  k.end('mask');

  // polygonal apse closing the nave at the back
  k.prism(rect(cx, zB + 3.0, W * 0.72, 6.5), 0, 12.0, 'granite');
  k.corniceRing(W * 0.72, 6.5, corniceProfile('band', 0.4), 'graniteLight', cx, 12.0, zB + 3.0);
  k.cone(W * 0.36, 2.6, 6, 'slate', cx, 12.0, zB + 3.0, { ry: Math.PI / 6 });

  // flank walls: azulejo tile panels (1932) between granite pilasters
  const E = edges(rect(cx, cz, W, D));
  for (const e of E) {
    if (Math.abs(e.nx) < 0.9) continue;
    onEdge(k, e, 0, 0.06);
    const n = Math.max(3, Math.round(e.len / 5.5));
    const holes = [];
    for (let i = 0; i < n; i++) holes.push({ x: -e.len / 2 + (e.len / n) * (i + 0.5), y: 1.4, w: 1.55, h: 3.4, arch: 'round', pane: 'glass', inset: 0.35 });
    k.wall(e.len - 1.0, 9.6, 0.45, 'azulejo', holes, 0, 2.1, 0.15);
    k.box(e.len - 0.8, 0.6, 0.7, 'graniteLight', 0, 11.9, 0.25);
    k.box(e.len - 0.8, 1.0, 0.7, 'granite', 0, 1.1, 0.3);
    for (let i = 0; i <= n; i++) k.box(0.4, 9.5, 0.55, 'graniteLight', -e.len / 2 + (e.len / n) * i, 2.1, 0.2);
    k.pop();
  }

  // -------------------------------------------------------------- facade
  k.push({ x: cx, z: zF });
  k.wall(W + 1.2, H + 2.6, 1.15, 'azulejo',
    [{ x: 0, y: 0, w: 4.6, h: 7.6, arch: 'round', pane: 'dark', inset: 0.6 }], 0, 0, 0.25);
  k.box(W + 1.8, 0.95, 1.6, 'graniteLight', 0, 0, 0.35);
  k.box(W + 1.8, 0.7, 1.6, 'graniteLight', 0, H + 2.6, 0.35);
  k.surround({ x: 0, y: 0, w: 4.6, h: 7.6, arch: 'round' }, 0.42, 0.55, 'graniteLight', 0.8);
  win(k, 0, 9.6, 2.2, 3.0, 0.75, { arch: 'round', trim: 'graniteLight', pane: 'glass', head: 'seg', bw: 0.32, sill: true });
  for (const s of [-1, 1]) {
    win(k, s * 5.3, 3.4, 1.7, 3.4, 0.7, { trim: 'graniteLight', pane: 'glass', sill: true, bw: 0.28 });
    win(k, s * 5.3, 9.2, 1.5, 2.8, 0.7, { trim: 'graniteLight', pane: 'glass', bw: 0.26 });
  }
  // patron niche, scroll crest and iron cross over the entablature
  k.surround({ x: 0, y: H + 3.1, w: 2.0, h: 3.0, arch: 'round' }, 0.3, 0.5, 'graniteLight', 0.65);
  k.statue(1.6, 'graniteLight', 0, H + 3.2, 1.05, { pose: 'hold' });
  scrollCrest(k, 6.6, 3.2, 0.85, 'graniteLight', 0, H + 2.7, 0.8);
  k.box(0.16, 2.5, 0.16, 'iron', 0, H + 6.2, 0.8);
  k.box(1.15, 0.16, 0.16, 'iron', 0, H + 7.65, 0.8);
  // oculus lighting the choir
  disc(k, 1.0, 0.3, 'graniteLight', 0, H + 4.9, 0.95, { seg: 20 });
  disc(k, 0.7, 0.2, 'window', 0, H + 4.9, 1.1, { seg: 18, emit: 0.4 });
  k.pop();

  // ------------------------------------------------- twin flanking towers
  k.begin('height');
  for (const s of [-1, 1]) {
    bellTower(k, {
      w: 5.0, hBody: 12.6, hBelfry: 4.4,
      x: cx + s * (W / 2 - 2.4), z: zF - 3.0,
      body: 'granite', trim: 'graniteLight', cap: 'bell', capH: 4.4,
      openings: 1, windows: 2, winArch: 'round', clock: false,
      urns: true, balustrade: false, cross: true, sideWindows: true,
    });
    // azulejo medallions on the tower shafts
    for (const ry of [0, Math.PI / 2, -Math.PI / 2]) {
      k.push({ x: cx + s * (W / 2 - 2.4), z: zF - 3.0, ry });
      disc(k, 1.15, 0.25, 'azulejo', 0, 10.5, 2.55, { seg: 16, mat: MAT.azulejo });
      disc(k, 0.85, 0.15, 'graniteLight', 0, 10.5, 2.7, { seg: 14 });
      k.pop();
    }
  }
  k.end('height');

  // --- detail pass: the full line of 1932 azulejo medallions, roof ridge and
  // corner urns on the nave cornice
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const wz = cz - D / 2 + 5 + i * ((D - 10) / 4);
      k.push({ x: cx + sx * (W / 2 + 0.08), z: wz, ry: sx > 0 ? Math.PI / 2 : -Math.PI / 2 });
      disc(k, 0.7, 0.2, 'azulejo', 0, 8.6, 0.35, { seg: 14, mat: MAT.azulejo });
      disc(k, 0.5, 0.12, 'graniteLight', 0, 8.6, 0.5, { seg: 12 });
      k.pop();
    }
  }
  for (let i = 0; i < 10; i++) {
    const wz = cz - D / 2 + 2.5 + (i * (D - 5)) / 11;
    k.box(0.5, 0.24, 0.45, 'terracotta', cx, H + 4.65, wz);
  }
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    k.urn(1.0, 'graniteLight', cx + sx * (W / 2 - 0.5), H - 0.4, cz + sz * (D / 2 - 0.5), { seg: 7 });
  }

  done();
}
builder.metric = true;
builder.rule = {
  note: 'Santo Ildefonso: proto-Baroque granite church, twin bell towers, 1932 Jorge Colaço azulejo facade',
  fitTo: true,
};
export default { 'santo-ildefonso': builder };
