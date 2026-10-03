// Convento de Corpus Christi, Vila Nova de Gaia. A 14th-century house of
// the Cónegos Regrantes de Santo Agostinho (tradition: founded by D. Leonor
// de Alvim, wife of Nun'Álvares Pereira), badly damaged by the 1720s and
// rebuilt in the 18th century; the Capela de Corpus Christi holds the
// Gothic tomb tradition of the founder. Now a two-storey convent block
// around a cloister, with the church on the north side.
import { Kit, PALETTE, MAT, PROFILES, corniceProfile } from '../kit.js';
import { edges, obb, offset, bbox, rect } from '../geom.js';
import { win, pediment } from '../parts.js';
import { fitTo } from './site-fit.js';

// Documented fallback: the OSM outline of the convent (way 701396870),
// 76.7 x 74.1 m at bearing 7.2 deg (data/dimensions.json).
const FB = { x0: -37.14, x1: 37.14, z0: -38.63, z1: 38.63 };

function range(k, x, z, w, d, h, col, ridge = 'z') {
  k.prism(rect(x, z, w, d), 0, h, col);
  k.corniceRing(w, d, corniceProfile('eave', 0.45), 'granite', x, h - 0.3, z);
  k.push({ x, z });
  if (ridge === 'z') k.gableRoof(w + 0.3, d + 0.8, Math.min(3, w * 0.35), 'terracotta', 0, h, 0, { over: 0.5 });
  else k.hipRoof(w + 0.3, d + 0.8, Math.min(3, d * 0.3), 'terracotta', 0, h, 0, { over: 0.5 });
  k.pop();
}

function builder(k, site) {
  const o = site?.footprint?.outline;
  const b = o && o.length >= 3 ? bbox(o) : bbox([[FB.x0, FB.z0], [FB.x1, FB.z1], [FB.x0, FB.z1], [FB.x1, FB.z0]]);
  const BOX = { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, w: b.w, d: b.d, cx: b.cx, cz: b.cz };
  // Drawn height (church roof ridge, y 0..22.4 m). fitTo() scales the drawn
  // model to dimensions.json's total (18 m). Declaring the target 18 m here
  // (instead of the drawn size) left fit.js to scale the geometry after the
  // groups were measured, so the fit report read the unscaled 22.4 m ridge.
  const DRAWN_H = 22.4;
  const done = fitTo(k, site, { w: BOX.w, d: BOX.d, h: DRAWN_H, cx: BOX.cx, cz: BOX.cz }, BOX);

  const W = BOX.w;
  const D = BOX.d;
  const cx = BOX.cx;
  const cz = BOX.cz;
  const rnd = k.rnd;

  k.begin('main');
  // granite platform filling the outline (model extent)
  k.prism(rect(cx, cz, W, D), -0.5, 0.5, 'graniteDark');

  // ---------- the church: north range, slightly higher, gabled
  const chW = 16;
  const chD = 30;
  const chZ = cz + D / 2 - chD / 2 - 1;
  k.prism(rect(cx, chZ, chW, chD), 0, 17.5, 'graniteWarm');
  k.corniceRing(chW, chD, corniceProfile('eave', 0.55), 'granite', cx, 17.2, chZ);
  k.push({ x: cx, z: chZ });
  k.gableRoof(chW + 0.5, chD + 1.2, 4.6, 'terracotta', 0, 17.5, 0, { over: 0.6 });
  k.pop();
  // nave side windows
  for (let i = 0; i < 5; i++) {
    const wz = chZ - chD / 2 + 3 + (i * (chD - 6)) / 4;
    for (const s of [-1, 1]) {
      k.push({ x: cx + s * (chW / 2), z: wz, ry: s * Math.PI / 2 });
      win(k, 0, 6.5, 1.4, 4.0, 0.1, { trim: 'granite', pane: 'glass', arch: 'pointed', bw: 0.3, depth: 0.3, sill: true });
      k.pop();
    }
  }
  // main facade on +z
  const fz = chZ + chD / 2;
  k.wall(chW + 2.4, 16, 1.2, 'graniteWarm', [{ x: 0, y: 0, w: 3.4, h: 7.0, arch: 'round', pane: 'dark', inset: 0.5 }], cx, 0, fz - 0.4);
  k.box(chW + 3, 1.1, 1.8, 'granite', cx, 0, fz - 0.5);
  k.surround({ x: 0, y: 0, w: 3.4, h: 7.0, arch: 'round' }, 0.45, 0.6, 'granite', fz + 0.4);
  win(k, 0, 9.0, 2.6, 2.6, fz + 0.3, { trim: 'granite', pane: 'glass', arch: 'round', bw: 0.28, depth: 0.35 });
  for (const s of [-1, 1]) win(k, s * 5.4, 4.0, 1.6, 3.6, fz + 0.3, { trim: 'granite', pane: 'glass', sill: true, bw: 0.3, arch: 'round' });
  pediment(k, chW * 0.7, 3.0, 0.9, 'granite', cx, 16, fz - 0.3);
  k.box(0.16, 2.4, 0.16, 'iron', cx, 19, fz);
  k.box(1.0, 0.16, 0.16, 'iron', cx, 20.4, fz);

  // ---------- convent ranges round a cloister (south of the church)
  const rH = 11.5;
  const cW = W - 6;                 // overall cloister block
  const cD = D - chD - 6;
  const ccz = cz - D / 2 + cD / 2 + 2;
  // south wing
  range(k, cx, ccz - cD / 2 + 3, cW, 6, rH, 'plaster');
  // west + east wings
  range(k, cx - cW / 2 + 3, ccz, 6, cD - 6, rH, 'plaster', 'z');
  range(k, cx + cW / 2 - 3, ccz, 6, cD - 6, rH, 'plaster', 'z');
  // cloister arcade facing the court
  for (const s of [-1, 1]) {
    k.push({ x: cx + s * (cW / 2 - 6), z: ccz, ry: s * Math.PI / 2 });
    k.gate(6, rH, 0.7, [{ x: 0, w: cD * 0.7, h: 4.4 }], 'graniteWarm', 0, 0, 0);
    k.pop();
  }
  k.push({ x: cx, z: ccz - cD / 2 + 6 });
  k.gate(cW - 12, rH, 0.7, [{ x: 0, w: cW * 0.5, h: 4.4 }], 'graniteWarm', 0, 0, 0);
  k.pop();
  // punched windows on the outer ranges
  for (const s of [-1, 1]) {
    k.push({ x: cx + s * (W / 2 - 0.3), z: ccz, ry: s * Math.PI / 2 });
    for (let i = 0; i < 5; i++) {
      for (const wy of [2.2, 6.4]) win(k, -cD / 2 + 3 + (i * (cD - 6)) / 4, wy, 1.1, 2.0, 0.1, { trim: 'granite', pane: 'glass', bw: 0.22, depth: 0.25, sill: true });
    }
    k.pop();
  }
  k.end('main');

  // ---------- Capela de Corpus Christi: small chapel on the west flank
  k.begin('chapel');
  const capX = cx - W / 2 + 4;
  const capZ = chZ - chD / 2 - 2;
  k.prism(rect(capX, capZ, 7, 11), 0, 9, 'graniteLight');
  k.push({ x: capX, z: capZ });
  k.hipRoof(7, 11, 3.2, 'terracotta', 0, 9, 0, { over: 0.5 });
  k.pop();
  k.push({ x: capX, z: capZ + 5.6, ry: 0 });
  win(k, 0, 1.6, 1.4, 3.0, 0.1, { trim: 'granite', pane: 'dark', arch: 'round', bw: 0.3, depth: 0.35, head: 'seg' });
  k.pop();
  k.end('chapel');

  // ---------- cloister garden
  k.begin('garden');
  k.prism(rect(cx, ccz, cW - 12, cD - 10), 0.1, 0.15, 'grass');
  for (const gx of [-cW * 0.18, 0, cW * 0.18]) k.column(3.6, 0.22, 'graniteLight', cx + gx, 0.25, ccz, { smooth: true });
  for (let i = 0; i < 5; i++) k.tree(cx - cW * 0.28 + rnd() * cW * 0.56, 0.25, ccz - cD * 0.3 + rnd() * cD * 0.6, 6 + rnd() * 3, { crown: 'round' });
  k.end('garden');

  // --- detail: cloister arcade, a lavabo fountain and a church bell gable
  for (let i = 0; i < 5; i++) {
    const gx = cx - cW * 0.16 + (cW * 0.32 * i) / 4;
    k.cyl(0.16, 0.2, 3.6, 8, 'graniteLight', gx, 0.25, ccz - cD * 0.2);
    k.cyl(0.16, 0.2, 3.6, 8, 'graniteLight', gx, 0.25, ccz + cD * 0.2);
    k.box(0.5, 0.2, 0.5, 'graniteLight', gx, 3.85, ccz - cD * 0.2);
    k.box(0.5, 0.2, 0.5, 'graniteLight', gx, 3.85, ccz + cD * 0.2);
  }
  k.cyl(1.6, 1.9, 0.8, 12, 'graniteLight', cx, 0.2, ccz);
  k.cyl(0.3, 0.5, 1.6, 8, 'graniteLight', cx, 1.0, ccz);
  k.lathe(PROFILES.basin, 10, 'graniteLight', cx, 2.6, ccz, { sr: 1.1, sh: 1.4, smooth: true });
  k.box(3.2, 3.4, 0.8, 'graniteWarm', cx, 16, fz - 0.2);
  k.surround({ x: 0, y: 17.0, w: 1.4, h: 2.0, arch: 'round' }, 0.24, 0.35, 'granite', fz + 0.25);

  done();
}
builder.metric = true;
builder.rule = {
  note: 'Convento de Corpus Christi (Gaia): 14th-c. origin, 18th-c. rebuild; church + cloister ranges + Capela',
  extent: { box: { x0: -37.14, x1: 37.14, z0: -38.63, z1: 38.63 } },
  fitTo: true,
};
export default { 'convento-corpus-christi': builder };
