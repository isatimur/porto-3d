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
    for (let i = -2; i <= 2; i++) {
      k.box(0.6, 12, 1.1, 'doorBlue', side * (116 * sx), 1, i * 24 * sz, { mat: MAT.flat });
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
    // rows of seats climbing each tier
    const seats = 40;
    for (let s = 0; s < seats; s++) {
      const a = (s / seats) * Math.PI * 2;
      k.box(1.5, 0.42, 1.2, 'seat', Math.cos(a) * (ow / 2) * sx, y + 0.3, Math.sin(a) * (od / 2) * sz, { ry: -a });
    }
  });

  // concourse columns carrying the roof ring
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    k.cyl(0.9, 1.1, 4, 6, 'steel', Math.cos(a) * 112 * sx, 26, Math.sin(a) * 92 * sz);
  }

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
  // radial trusses under the roof ring
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    k.segment([Math.cos(a) * 62 * sx, 29, Math.sin(a) * 42 * sz], [Math.cos(a) * 118 * sx, 29, Math.sin(a) * 98 * sz], 0.7, 0.7, 'steel');
  }

  // corner floodlight masts
  for (const [sx2, sz2] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const px = sx2 * 104 * sx;
    const pz = sz2 * 88 * sz;
    k.cyl(1.2, 1.8, 44, 8, 'steel', px, 0, pz);
    k.box(9, 6, 1.2, 'steel', px, 44, pz, { ry: Math.atan2(sx2, sz2) });
    k.box(8, 5, 0.4, 'window', px, 45, pz - sz2 * 0.8, { ry: Math.atan2(sx2, sz2), emit: 0.6 });
    // a bank of four lamps in the mast head
    for (let l = -1; l <= 1; l++) k.box(2.2, 1.6, 0.3, 'window', px + l * 2.4, 44.6, pz - sz2 * 1.0, { emit: 0.55 });
  }

  // ---------------------------------------------------------- detail pass
  // vomitories (entrance tunnels) cut through the facade shell
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    k.box(4.4, 5.5, 1.0, 'dark', Math.cos(a) * 116 * sx, 0, Math.sin(a) * 96 * sz, { ry: -a });
    k.box(5.2, 0.6, 1.4, 'graniteGrey', Math.cos(a) * 117 * sx, 5.5, Math.sin(a) * 97 * sz, { ry: -a });
  }
  // radial access stairs climbing between the tiers
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.13;
    for (let s = 0; s < 8; s++) {
      const r = (192 - s * 6) * sx;
      k.box(2.6, 0.35, 1.1, 'graniteGrey', Math.cos(a) * r, 4 + s * 2.1, Math.sin(a) * r * (sz / sx), { ry: -a });
    }
  }
  // blue seat mosaic on the lower tier (club colours) and aisle numbers
  for (let s = 0; s < 24; s++) {
    const a = (s / 24) * Math.PI * 2;
    k.box(2.4, 0.42, 1.2, s % 2 ? 'doorBlue' : 'seat', Math.cos(a) * 88 * sx, 5.3, Math.sin(a) * 70 * sz, { ry: -a });
  }
  // advertising hoardings, dugouts and corner flags round the pitch
  for (const s of [-1, 1]) {
    for (let i = -6; i <= 6; i++) k.box(6.5, 1.0, 0.25, i % 2 ? 'white' : 'doorBlue', i * 7 * sx, 0.5, s * 56 * sz, { ry: s < 0 ? Math.PI : 0 });
    for (let i = -4; i <= 4; i++) k.box(0.25, 1.0, 6.5, i % 2 ? 'white' : 'doorBlue', s * 65 * sx, 0.5, i * 7 * sz, { ry: s < 0 ? Math.PI / 2 : -Math.PI / 2 });
    k.box(7, 2.0, 2.4, 'graniteGrey', s * 20 * sx, 0.2, s * 52 * sz, { mat: MAT.flat });
  }
  for (const [sx2, sz2] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) k.box(0.12, 1.8, 0.12, 'white', sx2 * 54 * sx, 0.2, sz2 * 36 * sz);
  // one large scoreboard on the north stand
  k.box(22, 8, 1.2, 'dark', 0, 30, 86 * sz);
  k.box(20, 6, 0.4, 'window', 0, 30, 86 * sz - 0.6, { emit: 0.15 });
}
function THREEclamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
dragao.metric = true;
dragao.rule = { note: 'Estádio do Dragão bowl, facade shell, tiers and roof, 2003', fitTo: true };

export default { dragao };
