// Serralves: the Art Deco Casa de Serralves villa (Marques da Silva, 1930s)
// and Álvaro Siza's 1999 museum — a long white modernist bar with a tower —
// set in the park lawn among trees.
import { Kit, PALETTE, MAT, PROFILES, corniceProfile, archPath } from '../kit.js';
import { onEdge, polyCornice, polyBand, polyWindows, roofOver, plainBuilding } from '../metric.js';
import { flatWindow, ribbonWindows } from '../parts.js';
import { edges, obb, offset, bbox, rect } from '../geom.js';

function venue(site) {
  const o = site?.footprint?.outline;
  const b = o && o.length >= 3 ? bbox(o) : { cx: 0, cz: 0, w: 150, d: 80 };
  return { cx: b.cx, cz: b.cz, w: Math.max(90, b.w), d: Math.max(60, b.d) };
}

function serralves(k, site) {
  const V = venue(site);
  // lawn
  k.prism(rect(V.cx, V.cz, V.w * 2.3, V.d * 3.0), -0.3, 0.3, 'grass');
  // clipped hedge frame and gravel drive
  const H = rect(V.cx, V.cz, V.w + 26, V.d + 22);
  for (const e of edges(H)) {
    if (e.len < 2) continue;
    onEdge(k, e, 0, 0);
    k.box(e.len, 1.5, 1.4, 'hedge', 0, 0, 0);
    k.pop();
  }

  // ---------------- Siza museum: long low white bar on the west
  const mx = V.cx - V.w * 0.06;
  const mz = V.cz + 6;
  const ML = Math.min(96, V.w * 0.72);
  const MD = 17;
  const MH = 8.6;
  const Mp = rect(mx, mz, ML, MD);
  k.prism(Mp, 0, MH, 'white', { bevel: 0.25 });
  // plinth
  k.prism(offset(Mp, 0.35), 0, 0.5, 'graniteLight');
  // continuous glazed ribbon on both long faces
  k.box(ML - 6, 3.4, 0.3, 'glass', mx, 2.1, mz + MD / 2 + 0.02, { emit: 0.06 });
  k.box(ML - 6, 3.4, 0.3, 'glass', mx, 2.1, mz - MD / 2 - 0.02, { emit: 0.06 });
  // white fascia over the glass and a roof band
  k.prism(offset(Mp, 0.25), 6.1, 0.5, 'white');
  k.prism(offset(Mp, 0.3), MH, 0.4, 'graniteLight');
  // entrance: projecting white canopy and steps
  const ez = mz + MD / 2;
  k.box(14, 0.6, 5, 'white', mx, 4.6, ez + 2.2);
  for (const s of [-1, 1]) k.box(0.4, 4.6, 0.4, 'graniteLight', mx + s * 6.8, 0, ez + 4.2);
  k.prism(rect(mx, ez + 3.4, 13, 3), 0, 0.4, 'graniteLight');
  // tower at the west end
  const tx = mx - ML / 2 + 8;
  k.box(12, 17.5, 12, 'white', tx, 0, mz - 1);
  k.box(2.4, 12, 0.4, 'glass', tx, 4, mz - 1 + 6.1, { emit: 0.05 });
  k.box(13, 0.6, 13, 'graniteLight', tx, 17.5, mz - 1);
  // a few punched openings on the east end
  for (let i = 0; i < 4; i++) flatWindow(k, mx + ML / 2 - 8, 4.6, 1.3, 2.2, mz + MD / 2 + 0.2, { trim: 'graniteLight', pane: 'glass' });

  // ---------------- Casa de Serralves villa on the east
  const vx = V.cx + V.w * 0.34;
  const vz = V.cz - 4;
  const VL = 40;
  const VD = 15;
  const VH = 8.8;
  const Vp = rect(vx, vz, VL, VD);
  k.prism(Vp, 0, VH, 'cream', { bevel: 0.2 });
  k.prism(offset(Vp, 0.3), 0, 0.6, 'granite');
  k.corniceRing(VL, VD, corniceProfile('eave', 0.55), 'white', vx, VH - 0.2, vz);
  roofOver(k, Vp, VH + 0.3, 3.2, 'terracotta', 'hip', { over: 0.7 });
  // window rows (Art Deco trim, some lit)
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < 5; i++) {
      flatWindow(k, vx - VL / 2 + 5 + i * 7.5, 1.6 + s * 3.6, 1.5, 2.3, vz + VD / 2 + 0.2, { trim: 'white', pane: 'glass', emit: s ? 0.16 : 0 });
    }
  }
  // curved semicircular wing at the west end
  const wx = vx - VL / 2;
  k.cyl(7.5, 7.5, VH, 16, 'cream', wx, 0, vz, { t0: Math.PI / 2, tl: Math.PI, smooth: true });
  k.cyl(8, 8, 0.5, 16, 'white', wx, VH - 0.2, vz, { t0: Math.PI / 2, tl: Math.PI, smooth: true });
  k.cyl(7.9, 7.9, 0.4, 16, 'granite', wx, 0, vz, { t0: Math.PI / 2, tl: Math.PI, smooth: true });
  // cylindrical tower with a shallow dome
  const dx = wx - 2;
  k.cyl(4.2, 4.4, 15, 14, 'cream', dx, 0, vz - 2, { smooth: true });
  k.dome(4.3, 'terracotta', dx, 15, vz - 2, { seg: 14, rings: 5 });
  k.lathe(PROFILES.finial, 6, 'white', dx, 15 + 3.6, vz - 2, { sr: 0.35, sh: 1.2, flat: true });

  // ---------------- park: scattered trees and a path
  const spots = [[-1, 1], [0.6, -1.1], [1.0, 0.8], [-0.7, -0.9], [0.2, 1.15], [1.15, -0.2]];
  for (let i = 0; i < spots.length; i++) {
    k.tree(V.cx + spots[i][0] * V.w * 0.85, 0, V.cz + spots[i][1] * V.d * 1.05, 12 + (i % 3) * 3, { kind: 'round', lobes: 2 });
  }
  k.prism(rect(V.cx, V.cz + V.d * 0.75, V.w * 1.2, 4), -0.05, 0.12, 'sand');

  // ---------------- facade and garden detail
  // museum: mullions along the glazed ribbons and roof plant screens
  for (let i = 0; i < 26; i++) {
    const px = mx - (ML - 6) / 2 + ((ML - 6) * i) / 25;
    k.box(0.12, 3.4, 0.28, 'graniteLight', px, 2.1, mz + MD / 2 + 0.05);
    k.box(0.12, 3.4, 0.28, 'graniteLight', px, 2.1, mz - MD / 2 - 0.05);
  }
  for (let i = 0; i < 4; i++) k.box(4.0, 1.4, 1.6, 'graniteGrey', mx - ML / 2 + 12 + i * 22, MH, mz);
  // villa: windows on the flanks and rear, a storey band, chimneys
  for (const s of [-1, 1]) {
    k.push({ x: vx + s * VL / 2, z: vz, ry: s > 0 ? Math.PI / 2 : -Math.PI / 2 });
    for (let r = 0; r < 2; r++) for (let i = 0; i < 3; i++) flatWindow(k, -VD / 2 + 3 + i * 5, 1.6 + r * 3.6, 1.5, 2.3, 0.2, { trim: 'white', pane: 'glass', emit: r ? 0.12 : 0 });
    k.pop();
  }
  k.push({ x: vx, z: vz - VD / 2, ry: Math.PI });
  for (let r = 0; r < 2; r++) for (let i = 0; i < 5; i++) flatWindow(k, -VL / 2 + 5 + i * 7.5, 1.6 + r * 3.6, 1.5, 2.3, 0.2, { trim: 'white', pane: 'glass', emit: 0.1 });
  k.pop();
  k.prism(offset(Vp, 0.15), 5.2, 0.35, 'white');
  for (const [cx2, cz2] of [[vx - VL / 2 + 6, vz], [vx + VL / 2 - 6, vz]]) {
    k.box(1.2, 2.4, 1.2, 'cream', cx2, VH + 0.3, cz2);
    k.box(1.6, 0.4, 1.6, 'graniteLight', cx2, VH + 2.7, cz2);
  }
  // garden: a fountain, benches and more planting
  k.cyl(4.2, 4.6, 0.8, 16, 'graniteLight', V.cx + 18, 0, V.cz + 30);
  k.cyl(0.6, 0.9, 2.2, 10, 'graniteLight', V.cx + 18, 0.8, V.cz + 30);
  for (const [bx, bz, br] of [[-30, 18, 0], [30, -10, Math.PI / 2], [-10, -40, 0]]) {
    k.box(2.2, 0.5, 0.6, 'wood', V.cx + bx, 0, V.cz + bz, { ry: br });
    k.box(2.2, 0.5, 0.6, 'wood', V.cx + bx, 0.5, V.cz + bz - 0.3, { ry: br });
  }
  for (let i = 0; i < 4; i++) k.tree(V.cx - 40 + i * 26, 0, V.cz + 55, 9 + (i % 2) * 3, { kind: 'round' });

  // more planting, a rose trellis and a terrace balustrade
  for (let i = 0; i < 5; i++) k.tree(V.cx - 55 + i * 22, 0, V.cz - 60, 8 + (i % 3) * 3, { kind: i % 2 ? 'cypress' : 'round' });
  for (let i = 0; i < 14; i++) k.box(0.15, 2.6, 0.15, 'wood', V.cx + 40, 0, V.cz - 34 + i * 4);
  k.box(0.2, 0.2, 56, 'wood', V.cx + 40, 2.6, V.cz - 8);
  k.box(0.2, 0.2, 56, 'wood', V.cx + 40, 1.4, V.cz - 8);
  for (let i = 0; i < 18; i++) k.box(0.12, 0.7, 0.12, 'graniteLight', V.cx - 20 + i * 2.4, 0, V.cz + 44);
  k.box(43, 0.12, 0.12, 'graniteLight', V.cx - 0.4, 0.7, V.cz + 44);

  // ---------------------------------------------------------- detail pass
  // museum: horizontal board-marked reveals and a projecting rooflight housing
  for (let i = 1; i < 5; i++) k.box(ML - 4, 0.12, 0.3, 'graniteGrey', mx, i * 1.2, mz + MD / 2 + 0.04);
  for (let i = 1; i < 5; i++) k.box(ML - 4, 0.12, 0.3, 'graniteGrey', mx, i * 1.2, mz - MD / 2 - 0.04);
  k.box(9, 1.2, 3.0, 'white', mx - ML / 2 + 20, MH + 0.4, mz);
  // entrance: soffit ribs, door mullions and a wheelchair ramp kerb
  for (let i = -3; i <= 3; i++) k.box(0.18, 0.5, 4.6, 'graniteGrey', mx + i * 1.8, 4.35, ez + 2.2);
  for (let i = -3; i <= 3; i++) k.box(0.14, 2.4, 0.2, 'graniteLight', mx + i * 1.6, 1.4, ez + 2.0);
  k.box(14, 0.3, 0.35, 'graniteLight', mx, 0.35, ez + 4.7);
  // villa: stepped Art Deco window surrounds and roof urns on the wing
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < 5; i++) {
      const wx = vx - VL / 2 + 5 + i * 7.5;
      const wy = 1.6 + s * 3.6;
      k.box(2.0, 0.28, 0.35, 'white', wx, wy + 2.3, vz + VD / 2 + 0.25);
      k.box(0.28, 0.7, 0.35, 'white', wx - 0.9, wy + 1.9, vz + VD / 2 + 0.25);
      k.box(0.28, 0.7, 0.35, 'white', wx + 0.9, wy + 1.9, vz + VD / 2 + 0.25);
    }
  }
  for (const sx of [-1, 1]) k.urn(0.9, 'graniteLight', vx + sx * (VL / 2 - 2), VH + 0.6, vz + VD / 2 - 1.5, { seg: 6 });
  // curved wing: a dentil cornice following the half-cylinder
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI / 2 + (i / 10) * Math.PI;
    k.box(0.5, 0.35, 0.5, 'white', wx + Math.cos(a) * 7.8, VH + 0.05, vz + Math.sin(a) * 7.8, { ry: -a });
  }
  // garden: a reflecting pool with a fountain jet and stone urns on the terrace
  k.prism(rect(V.cx - 30, V.cz + 30, 16, 9), 0, 0.35, 'graniteLight');
  k.prism(rect(V.cx - 30, V.cz + 30, 14.5, 7.5), 0.35, 0.12, 'water', { emit: 0.3 });
  k.cyl(0.3, 0.4, 1.6, 8, 'graniteLight', V.cx - 30, 0.4, V.cz + 30);
  k.cyl(0.14, 0.2, 2.4, 6, 'water', V.cx - 30, 1.8, V.cz + 30, { emit: 0.5 });
  for (let i = 0; i < 6; i++) k.urn(0.8, 'graniteLight', V.cx - 24 + i * 9.5, 0.75, V.cz + 44, { seg: 6 });
}
serralves.metric = true;
serralves.rule = { note: 'Serralves villa (Marques da Silva) + Siza museum bar, 1999', fitTo: true };

export default { serralves };
