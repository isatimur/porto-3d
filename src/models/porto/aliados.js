// Avenida dos Aliados + Câmara Municipal, Porto — the granite civic avenue
// (Barry Parker plan, opened 1917, 250 m) terminating in the Beaux-Arts
// Paços do Concelho (Correia da Silva, built 1920–1957): a central portico,
// rows of granite facades with mansard roofs, and the 70 m tower with clock
// and carillon under a green copper roof. The avenue is laid as a granite
// axis; the City Hall is the landmark.
import * as THREE from 'three';
import { Kit, PALETTE, MAT, PROFILES, corniceProfile, archPath } from '../kit.js';
import { edges, obb, offset, bbox, rect } from '../geom.js';
import { win } from '../parts.js';

const COPPER = 0x4f8f78;

function disc(k, r, th, color, x, y, z, o = {}) {
  k.cyl(r, r, th, o.seg ?? 20, color, x, y - th / 2, z, { rx: Math.PI / 2, ...o });
}

// One granite avenue block: beaux-arts facade, mansard roof, regular bays.
function avenueBlock(k, cx, cz, w, d, h, facing) {
  k.prism(rect(cx, cz, w, d), 0, h, 'granite');
  k.prism(rect(cx, cz, w + 0.2, d + 0.2), 0, 1.0, 'graniteDark');
  k.corniceRing(w, d, corniceProfile('classic', 0.7), 'graniteLight', cx, h - 0.8, cz);
  k.push({ x: cx, z: cz, ry: Math.PI / 2 });
  k.gableRoof(d + 0.3, w, 3.0, 'slate', 0, h, 0, { over: 0.6, ridge: false });
  k.pop();
  // windows on the avenue face only (facing = +1 or -1 in z)
  const zf = cz + facing * (d / 2 + 0.02);
  k.push({ x: cx, z: zf, ry: facing > 0 ? 0 : Math.PI });
  const nb = Math.max(2, Math.round(w / 5.4));
  for (let s = 0; s < 3; s++) {
    for (let i = 0; i < nb; i++) {
      const wx = -w / 2 + (w / nb) * (i + 0.5);
      const wy = 3.6 + s * 4.4;
      if (wy + 2.2 > h) continue;
      win(k, wx, wy, 1.2, 2.1, 0, { trim: 'graniteLight', pane: 'glass', bw: 0.22, depth: 0.3, sill: s > 0, head: s === 0 ? 'seg' : undefined });
    }
  }
  // ground-floor shops
  for (let i = 0; i < nb; i++) {
    const wx = -w / 2 + (w / nb) * (i + 0.5);
    win(k, wx, 0, 2.2, 2.8, 0, { arch: 'round', trim: 'granite', pane: 'dark', bw: 0.24, depth: 0.3 });
  }
  k.pop();
}

// The Câmara: broad granite block, projecting columned portico and the
// 70 m central tower with clock, carillon and copper roof. Local +z = avenue.
function camara(k) {
  const Bw = 62;   // facade width
  const Bd = 28;
  const Hh = 29;   // six storeys to the main cornice
  k.begin('camara');
  k.prism(rect(0, 0, Bw, Bd), 0, Hh, 'granite');
  k.prism(rect(0, 0, Bw + 0.4, Bd + 0.4), 0, 1.4, 'graniteDark');
  for (const y of [1.4, 14.0, 23.0]) k.corniceRing(Bw, Bd, corniceProfile('band', 0.4), 'graniteLight', 0, y, 0);
  k.corniceRing(Bw, Bd, corniceProfile('classic', 0.9), 'graniteLight', 0, Hh - 0.9, 0);
  // mansard roof with dormers
  k.prism(rect(0, 0, Bw - 0.8, Bd - 0.8), Hh, 3.4, 'granite');
  k.push({ z: 0 });
  k.gableRoof(Bd - 1, Bw - 1.4, 3.0, 'slate', 0, Hh + 3.4, 0, { over: 0.5, ridge: false, ry: Math.PI / 2 });
  k.pop();
  // facade windows
  const zf = Bd / 2 + 0.02;
  k.push({ z: zf });
  for (let s = 0; s < 5; s++) {
    for (let i = -6; i <= 6; i++) {
      const wx = i * 4.4;
      if (Math.abs(i) <= 1 && s >= 1) continue; // portico bays
      const wy = 2.8 + s * 4.2;
      if (wy + 2.2 > Hh) continue;
      win(k, wx, wy, 1.3, 2.2, 0, { trim: 'graniteLight', pane: 'glass', bw: 0.24, depth: 0.32, sill: true, head: s === 0 ? 'seg' : undefined });
    }
  }
  k.pop();
  // central portico: steps, eight columns, entablature and attic
  k.stairs(18, 4.0, 1.5, 4, 'granite', 0, 0, zf + 5.6, { below: 1.4 });
  for (let i = 0; i < 8; i++) k.column(10.5, 0.5, 'graniteLight', -7.0 + i * 2.0, 1.2, zf + 3.6, { smooth: true });
  k.box(18, 1.4, 4.2, 'graniteLight', 0, 11.7, zf + 3.2);
  k.box(19, 1.2, 4.6, 'granite', 0, 13.1, zf + 3.2);
  k.statue(2.2, 'graniteLight', 0, 14.3, zf + 3.4, { pose: 'hold' });
  win(k, 0, 1.4, 4.2, 7.0, zf + 1.6, { arch: 'round', trim: 'graniteDark', pane: 'dark', bw: 0.4, depth: 0.5 });
  k.end('camara');

  // ------------------------------------------------------------- the tower
  k.begin('tower');
  const tz = -6;
  const shaftH = 44;
  k.box(13, shaftH, 13, 'granite', 0, 0, tz);
  k.box(14, 1.6, 14, 'graniteDark', 0, 0, tz);
  // paired pilasters and windows up the shaft
  for (const sx of [-1, 1]) for (let s = 0; s < 3; s++) {
    k.box(0.7, 8.0, 0.7, 'graniteLight', sx * 4.6, 6 + s * 11, tz + 6.3);
    win(k, sx * 2.2, 9 + s * 11, 1.1, 2.1, tz + 6.6, { trim: 'graniteLight', pane: 'glass', bw: 0.18, depth: 0.25 });
  }
  for (const y of [5.0, 22.0, 38.0]) k.corniceRing(13, 13, corniceProfile('band', 0.5), 'graniteLight', 0, y, tz);
  k.corniceRing(13, 13, corniceProfile('classic', 0.9), 'graniteLight', 0, shaftH - 1.0, tz);
  // clock stage (front face toward the avenue, +z)
  const cy = shaftH + 2.2;
  k.box(11, 7.0, 11, 'granite', 0, shaftH + 1.0, tz);
  k.corniceRing(11, 11, corniceProfile('band', 0.5), 'graniteLight', 0, cy + 6.4, tz);
  const czer = tz + 5.6;
  disc(k, 3.0, 0.5, 'graniteLight', 0, cy + 3.2, czer);
  disc(k, 2.5, 0.3, 'white', 0, cy + 3.2, czer + 0.28);
  k.box(0.2, 1.7, 0.1, 'dark', 0, cy + 3.2, czer + 0.46);
  k.box(1.3, 0.18, 0.1, 'dark', 0, cy + 3.6, czer + 0.46);
  // carillon stage: arched openings on all four faces
  const by = cy + 7.0;
  k.box(10, 7.0, 10, 'granite', 0, by, tz);
  for (const [ry, off] of [[0, 5.0], [Math.PI, 5.0], [Math.PI / 2, 5.0], [-Math.PI / 2, 5.0]]) {
    k.push({ y: by, z: tz, ry });
    k.wall(10, 7.0, 0.8, 'granite', [{ x: 0, y: 1.2, w: 3.0, h: 4.6, arch: 'round', pane: null }], 0, 0, off);
    k.pop();
  }
  k.box(9.6, 7.0, 9.6, 'dark', 0, by, tz);
  k.corniceRing(10, 10, corniceProfile('classic', 0.7), 'graniteLight', 0, by + 7.0, tz);
  // small attic stage then copper roof
  k.box(8, 2.4, 8, 'granite', 0, by + 7.0, tz);
  const ry0 = by + 9.4;
  k.lathe([[0, 0], [1.0, 0], [1.0, 0.25], [0.85, 0.5], [0.55, 0.8], [0.3, 1.0], [0, 1]], 12, COPPER, 0, ry0, tz, { sr: 4.6, sh: 5.6, smooth: true, mat: MAT.smooth });
  k.cyl(0.7, 0.2, 2.0, 8, COPPER, 0, ry0 + 5.6, tz, { mat: MAT.smooth });
  k.cyl(0.1, 0.1, 1.4, 5, 'iron', 0, ry0 + 7.4, tz);
  k.sphere(0.25, 'gold', 0, ry0 + 8.8, tz, { seg: 7, rings: 5, emit: 0.5 });

  // ---------------------------------------------------------- detail pass
  // tower: clock numerals, corner urns at the carillon cornice and louvre slats
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.box(0.14, 0.14, 0.08, 'dark', Math.sin(a) * 2.2, cy + 3.2 + Math.cos(a) * 2.2, czer + 0.5);
  }
  for (const [px, pz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) k.cone(0.5, 1.1, 6, 'graniteLight', px * 3.6, by + 7.0, tz + pz * 3.6);
  for (const [ry, off] of [[0, 5.0], [Math.PI, 5.0], [Math.PI / 2, 5.0], [-Math.PI / 2, 5.0]]) {
    k.push({ y: by, z: tz, ry });
    for (let i = 0; i < 7; i++) k.box(0.1, 4.4, 0.16, 'graniteLight', -1.35 + i * 0.45, 1.2, off + 0.28);
    k.pop();
  }
  // facade: window head caps on the middle storeys and a parapet over the cornice
  for (let s = 1; s <= 3; s++) {
    for (let i = -6; i <= 6; i++) {
      if (Math.abs(i) <= 1 && s >= 1) continue;
      k.box(1.7, 0.3, 0.5, 'graniteLight', i * 4.4, 2.8 + s * 4.2 + 2.2, zf + 0.15);
    }
  }
  k.box(Bw - 2, 0.8, 0.5, 'graniteLight', 0, Hh + 0.2, zf - 0.1);
  k.end('tower');
}

function builder(k, site) {
  const o = site?.footprint?.outline;
  const bb = o && o.length >= 3 ? obb(o) : { L: 250, W: 46, cx: 0, cz: 0, a: 0 };
  const L = Math.max(80, Math.min(300, bb.L));
  const W = Math.max(24, Math.min(110, bb.W));
  const rnd = k.rnd;

  k.push({ x: bb.cx, z: bb.cz, ry: bb.a });
  k.begin('avenue');
  // paved central axis
  k.prism(rect(0, 0, L, W * 0.34), -0.15, 0.3, 'graniteLight');
  k.prism(rect(0, 0, L, W * 0.3), 0.15, 0.06, 'sand');
  for (let i = -4; i <= 4; i++) k.box(1.2, 0.1, W * 0.3, 'graniteDark', i * (L / 10), 0.21, 0);
  // flanking granite blocks
  const nb = Math.max(3, Math.round(L / 42));
  const bw = (L - 40) / nb;
  for (const s of [-1, 1]) {
    for (let i = 0; i < nb; i++) {
      const cx = -L / 2 + 20 + bw * (i + 0.5);
      const h = 22 + Math.round(rnd() * 5);
      avenueBlock(k, cx, s * (W / 2 - 8), bw - 0.4, 15, h, -s);
    }
  }
  // "A Juventude" (Menina dos Aliados) on the axis
  k.prism(rect(2, 0, 4.5, 4.5), 0, 1.3, 'granite');
  k.column(1.6, 0.5, 'graniteLight', 2, 1.3, 0, { smooth: true });
  k.statue(2.4, 'bronze', 2, 2.9, 0, { pose: 'raise' });
  k.end('avenue');

  // the Câmara closes the axis on the +x end, facing back down the avenue
  k.push({ x: L / 2 - 4, z: 0, ry: -Math.PI / 2 });
  camara(k);
  k.pop();
  k.pop();
}
builder.metric = true;
builder.rule = { note: 'Aliados: 250 m granite avenue axis, Beaux-Arts Câmara with 70 m clock tower' };
export default { aliados: builder };
