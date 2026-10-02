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
}
serralves.metric = true;
serralves.rule = { note: 'Serralves villa (Marques da Silva) + Siza museum bar, 1999' };

export default { serralves };
