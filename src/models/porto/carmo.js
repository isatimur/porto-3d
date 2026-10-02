// Igreja do Carmo (rococo, 1756-1768, José de Figueiredo Seixas). A granite
// and plaster facade with a curved segmental pediment and two bell towers,
// and the celebrated lateral wall clad in blue-and-white azulejo (1912).
import { Kit, PALETTE, MAT, PROFILES, corniceProfile, archPath } from '../kit.js';
import { onEdge, polyCornice, polyBand, polyWindows, roofOver, plainBuilding } from '../metric.js';
import { win, pediment, segPediment, bellTower, flutedColumn } from '../parts.js';
import { edges, obb, offset, bbox, rect } from '../geom.js';

function carmo(k, site) {
  const o = site?.footprint?.outline;
  const b = o && o.length >= 3 ? bbox(o) : { w: 18, d: 34, cx: 0, cz: -15 };
  const Wd = Math.max(12, b.w);
  const Dp = Math.max(22, b.d);
  const zFront = b.cz + b.d / 2;
  const zBack = b.cz - b.d / 2;
  const H = 12.5;

  // plinth
  k.box(Wd + 2.4, 1.1, Dp + 2.4, 'granite', b.cx, 0, b.cz);
  // paved churchyard
  k.prism(rect(b.cx, zFront + 12, Wd + 20, 24), -0.1, 0.2, 'graniteLight');

  // nave body
  const nave = rect(b.cx, b.cz, Wd, Dp);
  k.prism(nave, 0, H, 'plaster');
  k.corniceRing(Wd, Dp, corniceProfile('eave', 0.55), 'granite', b.cx, H - 0.3, b.cz);
  k.prism(offset(nave, 0.25), 0, 2.2, 'granite');
  k.push({ x: b.cx, z: b.cz });
  k.gableRoof(Wd + 0.4, Dp + 1.2, 4.4, 'terracotta', 0, H, 0);
  k.pop();

  // ---------------- azulejo lateral wall on the east flank
  const E = edges(nave);
  const side = E.find((e) => e.nx > 0.9) || E[0];
  const winHoles = [];
  const nn = Math.max(3, Math.round(side.len / 6));
  for (let i = 0; i < nn; i++) winHoles.push({ x: -side.len / 2 + (side.len / nn) * (i + 0.5), y: 2.4, w: 1.7, h: 3.4, arch: 'round', pane: 'glass', inset: 0.35 });
  onEdge(k, side, 0, 0.04);
  k.wall(side.len - 1.4, 9.8, 0.45, 'azulejo', winHoles, 0, 0, 0);
  // granite plinth, pilasters and cornice framing the tilework
  k.box(side.len - 1.0, 1.4, 0.7, 'granite', 0, 0, 0.2);
  k.cornice(side.len - 0.6, corniceProfile('band', 0.5), 'granite', 0, 9.8, 0.1);
  k.box(side.len - 1.0, 0.5, 0.8, 'granite', 0, 9.8, 0.2);
  for (let i = 0; i <= nn; i++) k.box(0.55, 8.4, 0.5, 'granite', -side.len / 2 + (side.len / nn) * i, 1.4, 0.15);
  for (const hh of winHoles) k.surround(hh, 0.24, 0.35, 'granite', 0.22);
  k.pop();
  // a smaller tiled panel on the west flank too
  const side2 = E.find((e) => e.nx < -0.9);
  if (side2) {
    onEdge(k, side2, 0, 0.04);
    k.wall(side2.len - 6, 8.5, 0.4, 'azulejo', [], 0, 0, 0);
    k.box(side2.len - 5.6, 1.2, 0.6, 'granite', 0, 0, 0.15);
    k.pop();
  }

  // ---------------- facade
  const fz = zFront;
  k.wall(Wd + 6, 16.5, 1.4, 'plaster', [{ x: 0, y: 0, w: 5, h: 8.4, arch: 'round', pane: 'glass', inset: 0.5 }], b.cx, 0, fz - 0.4);
  k.box(Wd + 6.6, 1.2, 1.9, 'granite', b.cx, 0, fz - 0.5);
  k.box(Wd + 6.6, 1.1, 1.9, 'granite', b.cx, 16.5, fz - 0.5);
  // portal surround and a window over it
  k.surround({ x: 0, y: 0, w: 5, h: 8.4, arch: 'round' }, 0.5, 0.6, 'granite', fz + 0.4);
  win(k, 0, 9.4, 2.0, 3.0, fz + 0.5, { trim: 'granite', pane: 'glass', arch: 'round', sill: true, head: 'seg', bw: 0.35 });
  for (const s of [-1, 1]) win(k, s * 6.4, 3.4, 1.6, 3.6, fz + 0.5, { trim: 'granite', pane: 'glass', sill: true, bw: 0.3 });
  // curved segmental pediment on the central bay
  segPediment(k, Wd + 1.2, 3.4, 1.3, 'granite', b.cx, 17.6, fz - 0.5);
  k.statue(2.0, 'plaster', b.cx, 18.2, fz + 0.4, { pose: 'hold' });
  // twin bell towers
  for (const s of [-1, 1]) {
    bellTower(k, {
      w: 4.6, hBody: 13.5, hBelfry: 4.6, x: b.cx + s * (Wd / 2 + 4.4), z: fz + 1.2,
      body: 'plaster', trim: 'granite', cap: 'bell', capH: 4.0, openings: 1, windows: 2,
      winArch: 'round', clock: false, urns: true, balustrade: false, cross: true,
    });
  }
}
carmo.metric = true;
carmo.rule = { note: 'Igreja do Carmo: rococo facade, twin towers, azulejo flank, 1768' };

export default { carmo };
