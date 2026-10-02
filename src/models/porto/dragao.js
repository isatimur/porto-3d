// Estádio do Dragão (Manuel Salgado, 2003), home of FC Porto, ~50,000 seats.
// A rounded bowl: a vertical facade shell, raked concrete tiers, a blue
// accent band, a cantilevered steel roof with four open corners and masts.
import { Kit, PALETTE, MAT, PROFILES, corniceProfile, archPath } from '../kit.js';
import { onEdge, polyCornice, polyBand, polyWindows, roofOver, plainBuilding } from '../metric.js';
import { edges, obb, offset, bbox, rect } from '../geom.js';

function roundRect(w, d, r, seg = 6) {
  const hw = w / 2;
  const hd = d / 2;
  const pts = [];
  const cs = [[hw - r, hd - r, 0], [-hw + r, hd - r, Math.PI / 2], [-hw + r, -hd + r, Math.PI], [hw - r, -hd + r, Math.PI * 1.5]];
  for (const [cx, cz, a0] of cs) for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * (Math.PI / 2); pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  return pts;
}
const rev = (p) => p.slice().reverse();

function dragao(k, site) {
  const b = site?.footprint?.outline && site.footprint.outline.length >= 3 ? bbox(site.footprint.outline) : { w: 220, d: 190 };
  const sx = THREEclamp(b.w / 220, 0.7, 1.4);
  const sz = THREEclamp(b.d / 190, 0.7, 1.4);

  // grass surround and pitch with markings
  k.prism(roundRect(320 * sx, 280 * sz, 60), -0.4, 0.4, 'grass');
  const PITCH = roundRect(150 * sx, 110 * sz, 14 * sx, 4);
  k.prism(PITCH, 0, 0.2, 'grass');
  k.box(0.4, 0.06, 68 * sz, 'white', 0, 0.2, 0);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    k.box(0.5, 0.06, 2.4, 'white', Math.cos(a) * 9.15 * sx, 0.2, Math.sin(a) * 9.15 * sz, { ry: -a });
  }
  for (const s of [-1, 1]) {
    k.box(40 * sx, 0.06, 0.35, 'white', 0, 0.2, s * 52.5 * sz);
    k.box(0.35, 0.06, 16.5 * sz, 'white', s * 55 * sx, 0.2, s * 34 * sz);
    k.box(0.35, 0.06, 16.5 * sz, 'white', s * 55 * sx, 0.2, -s * 34 * sz);
    k.box(0.35, 0.06, 7.3 * sz, 'white', s * 47 * sx, 0.2, 0);
  }
  // goals
  for (const s of [-1, 1]) {
    k.box(0.25, 2.44, 0.25, 'white', s * 52.5 * sx, 0.2, 3.66 * sz);
    k.box(0.25, 2.44, 0.25, 'white', s * 52.5 * sx, 0.2, -3.66 * sz);
    k.box(0.25, 0.25, 7.32 * sz, 'white', s * 52.5 * sx, 2.4, 0);
  }

  // vertical facade shell (annular wall)
  const SHELL = roundRect(232 * sx, 192 * sz, 50 * sx, 6);
  const SHELL_IN = roundRect(184 * sx, 144 * sz, 40 * sx, 6);
  k.prism(SHELL, 0, 26, 'graniteGrey', { holes: [rev(SHELL_IN)] });

  // blue accent band round the shell
  polyBand(k, SHELL, 10, 2.6, 1.2, 'doorBlue');
  // vertical blue fins on the long flanks
  for (const side of [-1, 1]) {
    for (let i = -3; i <= 3; i++) {
      k.box(1.1, 12, 0.6, 'doorBlue', i * 24 * sx, 1, side * (96 * sz), { mat: MAT.flat });
    }
  }

  // raked concrete tiers inside the shell
  const tiers = [
    [184, 144, 40, 6, 5],
    [176, 136, 38, 6, 11],
    [168, 128, 36, 5, 17],
    [160, 120, 34, 5, 21],
  ];
  tiers.forEach(([ow, od, r, h, y], i) => {
    const outer = roundRect(ow * sx, od * sz, r * sx, 5);
    const inner = roundRect((ow - 8) * sx, (od - 8) * sz, (r - 3) * sx, 5);
    k.prism(outer, y, h, i % 2 ? 'seat' : 'graniteGrey', { holes: [rev(inner)] });
  });

  // four dark corner openings between shell and roof
  for (const [sx2, sz2] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    k.box(20 * sx, 26, 3, 'dark', sx2 * 78 * sx, 0, sz2 * 70 * sz, { ry: sx2 * sz2 * Math.PI / 4 });
  }

  // cantilevered steel roof ring with four open corners
  const ROOF = rect(0, 0, 236 * sx, 196 * sz);
  const ROOF_IN = rect(0, 0, 124 * sx, 84 * sz);
  const corners = [[96, 76], [-96, 76], [96, -76], [-96, -76]].map(([x, z]) => rect(x * sx, z * sz, 42, 42));
  k.prism(ROOF, 30, 2.6, 'steel', { holes: [rev(ROOF_IN), ...corners.map(rev)] });
  k.prism(offset(ROOF, 0.6), 30, 0.9, 'doorBlue', { holes: [rev(ROOF_IN)] });
  for (const s of [-1, 1]) k.box(220 * sx, 0.8, 3, 'steel', 0, 32.4, s * 98 * sz);

  // corner floodlight masts
  for (const [sx2, sz2] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const px = sx2 * 104 * sx;
    const pz = sz2 * 88 * sz;
    k.cyl(1.2, 1.8, 44, 8, 'steel', px, 0, pz);
    k.box(9, 6, 1.2, 'steel', px, 44, pz, { ry: Math.atan2(sx2, sz2) });
    k.box(8, 5, 0.4, 'window', px, 45, pz - sz2 * 0.8, { ry: Math.atan2(sx2, sz2), emit: 0.6 });
  }
}
function THREEclamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
dragao.metric = true;
dragao.rule = { note: 'Estádio do Dragão bowl, facade shell, tiers and roof, 2003' };

export default { dragao };
