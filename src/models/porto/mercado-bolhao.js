// Mercado do Bolhão (Correia da Silva, 1914; restored 2022). A neoclassical
// covered market: granite base, arched openings, two low side aisles and a
// taller central nave with a clerestory of arched glazing under a gable roof.
import { Kit, PALETTE, MAT, PROFILES, corniceProfile, archPath } from '../kit.js';
import { onEdge, polyCornice, polyBand, polyWindows, roofOver, plainBuilding } from '../metric.js';
import { pediment } from '../parts.js';
import { edges, obb, offset, bbox, rect } from '../geom.js';

function mercadoBolhao(k, site) {
  const o = site?.footprint?.outline;
  const b = o && o.length >= 3 ? bbox(o) : { w: 66, d: 34, cx: 0, cz: 0 };
  const L = Math.max(40, b.w);
  const D = Math.max(24, b.d);
  const cz = b.cz;
  const aisleW = D * 0.3;
  const naveW = D - 2 * aisleW;
  const az = cz + D / 2 - aisleW / 2;

  // granite plinth and paved forecourt
  k.box(L + 3, 1.0, D + 3, 'granite', b.cx, 0, cz);
  k.prism(rect(b.cx, cz + D / 2 + 9, L + 10, 16), -0.15, 0.2, 'sand');

  // ---- side aisles with a ground-floor arcade on the outer long faces
  const arc = [];
  const n = Math.max(5, Math.round(L / 7));
  for (let i = 0; i < n; i++) arc.push({ x: -L / 2 + (L / n) * (i + 0.5), w: L / n * 0.6, h: 6.2 });
  for (const s of [-1, 1]) {
    const cell = rect(b.cx, cz + s * (D / 2 - aisleW / 2), L, aisleW);
    k.prism(cell, 0, 8.5, 'cream');
    k.push({ x: b.cx, z: cz + s * D / 2, ry: s > 0 ? 0 : Math.PI });
    k.gate(L, 8.5, 0.7, arc, 'cream', 0, 0, 0.35);
    k.pop();
    // low hip roof over each aisle
    k.push({ x: b.cx, z: cz + s * (D / 2 - aisleW / 2), ry: Math.PI / 2 });
    k.gableRoof(aisleW + 0.6, L + 1, 2.4, 'terracotta', 0, 8.5, 0, { ridge: false });
    k.pop();
  }
  // arcade glazing behind the arches
  for (const s of [-1, 1]) for (const a of arc) k.box(a.w, a.h, 0.15, 'glass', b.cx + a.x, 0.6, cz + s * (D / 2 - 0.5), { emit: 0.05 });

  // ---- central nave walls, then clerestory of arched glass
  const nave = rect(b.cx, cz, L, naveW);
  k.prism(nave, 0, 9.5, 'plaster');
  const cler = [];
  const cn = Math.max(5, Math.round(L / 7));
  for (let i = 0; i < cn; i++) cler.push({ x: -L / 2 + (L / cn) * (i + 0.5), y: 0.6, w: L / cn * 0.52, h: 4.6, arch: 'round', pane: 'glass', emit: 0.1 });
  for (const s of [-1, 1]) {
    k.push({ x: b.cx, z: cz + s * naveW / 2, ry: s > 0 ? 0 : Math.PI });
    k.wall(L, 5.4, 0.5, 'cream', cler, 0, 9.5, 0.25);
    k.pop();
  }
  // nave gable roof (ridge along x)
  k.push({ x: b.cx, z: cz, ry: Math.PI / 2 });
  k.gableRoof(naveW + 0.5, L + 1.4, 4.2, 'terracotta', 0, 14.9, 0);
  k.pop();
  // clerestory cornice
  polyCornice(k, nave, 14.7, corniceProfile('classic', 0.6), 'granite');

  // ---- neoclassical front pavilion on +z
  const fz = cz + D / 2;
  k.box(16, 12.5, 1.2, 'cream', b.cx, 0, fz - 0.4);
  k.wall(16, 12.5, 0.9, 'granite', [{ x: 0, y: 0, w: 8, h: 9.4, arch: 'round', pane: 'glass', inset: 0.4 }], b.cx, 0, fz + 0.2);
  for (const s of [-1, 1]) k.box(1.1, 11.5, 1.1, 'granite', b.cx + s * 6.4, 0, fz + 0.25);
  k.box(18, 1.0, 1.6, 'granite', b.cx, 12.5, fz - 0.2);
  pediment(k, 18.5, 4.0, 1.4, 'granite', b.cx, 13.5, fz - 0.4, { tympanum: 'cream' });
  k.box(6, 2.6, 0.3, 'cream', b.cx, 9.6, fz + 0.35);

  // ---- iron market columns inside the nave
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      k.cyl(0.18, 0.22, 9.2, 8, 'iron', b.cx - L / 2 + 6 + i * (L - 12) / 5, 0.2, cz + s * naveW * 0.24);
      k.box(0.8, 0.2, 0.8, 'iron', b.cx - L / 2 + 6 + i * (L - 12) / 5, 9.2, cz + s * naveW * 0.24);
    }
  }
  k.corniceRing(L, D, corniceProfile('band', 0.4), 'granite', b.cx, 8.6, cz);
}
mercadoBolhao.metric = true;
mercadoBolhao.rule = { note: 'Mercado do Bolhão: granite base, arcades, nave clerestory, 1914/2022' };

export default { 'mercado-bolhao': mercadoBolhao };
