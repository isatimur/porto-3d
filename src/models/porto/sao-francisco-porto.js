// Igreja de São Francisco, Porto — the city's finest Gothic church
// (1383–1410, king Fernando I), famed for the baroque gilt interior carved
// 1718–1721. Exterior: a granite west front with a pointed portal and a rose
// window, a nave with gable roof and buttresses, and a three-part apse. The
// convent cloister was destroyed in the 1833 fire and replaced by the Palácio
// da Bolsa; a pointed arcade fragment stands in for the lost cloister.
import * as THREE from 'three';
import { Kit, PALETTE, MAT, PROFILES, corniceProfile, archPath, pointedPath } from '../kit.js';
import { edges, obb, offset, bbox, rect } from '../geom.js';
import { win } from '../parts.js';

function disc(k, r, th, color, x, y, z, o = {}) {
  k.cyl(r, r, th, o.seg ?? 20, color, x, y - th / 2, z, { rx: Math.PI / 2, ...o });
}

function builder(k, site) {
  const o = site?.footprint?.outline;
  const b = o && o.length >= 3 ? bbox(o) : { w: 24, d: 42, cx: 0, cz: -4 };
  const W = Math.max(16, Math.min(30, b.w));
  const D = Math.max(26, Math.min(48, b.d));
  const H = 14.5;                 // nave eaves
  const cx = b.cx;
  const cz = b.cz;
  const zF = cz + D / 2;
  const zB = cz - D / 2;

  // ------------------------------------------------------------ nave mass
  k.begin('main');
  k.prism(rect(cx, cz, W, D), 0, H, 'granite');
  k.prism(offset(rect(cx, cz, W, D), 0.25), 0, 1.3, 'graniteDark');
  k.corniceRing(W, D, corniceProfile('band', 0.5), 'graniteLight', cx, H - 2.4, cz);
  k.push({ x: cx, z: cz });
  k.gableRoof(W + 0.4, D + 1.0, 4.6, 'terracotta', 0, H, 0, { over: 0.7 });
  k.pop();
  // three-part polygonal apse at the east end
  k.prism(rect(cx, zB + 2.5, W * 0.72, 6), 0, 11.5, 'granite');
  k.corniceRing(W * 0.72, 6, corniceProfile('band', 0.4), 'graniteLight', cx, 11.5, zB + 2.5);
  k.end('main');

  // ------------------------------------------------------- flank buttresses
  k.begin('buttress');
  const nb = Math.max(3, Math.round(D / 6));
  for (const sx of [-1, 1]) {
    for (let i = 0; i <= nb; i++) {
      const bz = zB + 1.2 + ((D - 2.4) * i) / nb;
      const bx = cx + sx * (W / 2 + 0.35);
      k.box(1.2, H - 1.2, 1.2, 'graniteLight', bx, 0, bz);
      k.cone(0.95, 2.4, 4, 'graniteLight', bx, H - 1.2, bz, { sz: 0.55, ry: Math.PI / 4 });
    }
    // two-light lancet windows between the buttresses, with a triforium tier
    k.push({ x: cx + sx * (W / 2), z: cz, ry: sx > 0 ? Math.PI / 2 : -Math.PI / 2 });
    for (let i = 0; i < nb - 1; i++) {
      const wx = -D / 2 + 1.2 + ((D - 2.4) * (i + 0.5)) / nb;
      win(k, wx, 7.2, 1.5, 4.4, 0, { arch: 'pointed', pane: 'glass', bw: 0.24, depth: 0.32 });
      win(k, wx, 3.6, 1.0, 2.2, 0, { arch: 'pointed', pane: 'glass', bw: 0.2, depth: 0.26 });
    }
    k.pop();
    // carved pinnacles crowning the buttress tops
    for (let i = 0; i <= nb; i++) {
      const bz = zB + 1.2 + ((D - 2.4) * i) / nb;
      k.pinnacle(2.6, 'graniteLight', cx + sx * (W / 2 + 0.35), H - 1.0, bz);
    }
  }
  k.end('buttress');

  // ------------------------------------------------------------ west front
  k.begin('front');
  const fw = W + 1.8;
  k.push({ x: cx, z: zF });
  // portal opening framed in stepped archivolts
  k.wall(fw, H + 5.5, 1.1, 'granite',
    [{ x: 0, y: 0, w: 4.6, h: 8.2, arch: 'pointed', pane: 'dark', inset: 0.75 }], 0, 0, 0.15);
  for (let i = 0; i < 3; i++) {
    k.surround({ x: 0, y: 0.45 * i, w: 4.6 + i * 1.25, h: 8.2 + i * 0.95, arch: 'pointed' },
      0.36, 0.6, 'graniteLight', 0.65 + i * 0.42);
  }
  // granite gable over the whole front
  const gs = new THREE.Shape();
  gs.moveTo(-fw / 2, 0);
  gs.lineTo(fw / 2, 0);
  gs.lineTo(0, 5.4);
  gs.closePath();
  k.extrude(gs, 1.0, 'granite', 0, H + 5.5, 0.15);
  k.box(fw * 0.6, 1.0, 1.3, 'graniteLight', 0, H + 5.5, 0.25);
  // rose window: granite ring, twelve tracery spokes, glass
  const ry = H + 1.6;
  disc(k, 2.7, 0.55, 'graniteLight', 0, ry, 0.95, { seg: 28 });
  disc(k, 2.2, 0.3, 'glass', 0, ry, 1.15, { seg: 26, emit: 0.28 });
  for (let i = 0; i < 12; i++) k.box(0.16, 4.1, 0.2, 'graniteLight', 0, ry, 1.3, { rz: (i * Math.PI) / 12 });
  disc(k, 0.55, 0.32, 'graniteLight', 0, ry, 1.38, { seg: 12 });
  // twin-light lancets flanking the portal
  for (const s of [-1, 1]) {
    win(k, s * (fw / 2 - 2.4), 2.6, 1.3, 4.2, 0.7, { arch: 'pointed', pane: 'glass', bw: 0.24, depth: 0.32 });
    win(k, s * (fw / 2 - 2.4), 8.4, 1.3, 3.4, 0.7, { arch: 'pointed', pane: 'glass', bw: 0.24, depth: 0.32 });
  }
  k.statue(2.1, 'graniteLight', 0, H + 6.9, 0.8, { pose: 'hold' });
  // corner pinnacles and an apex cross crowning the gable
  for (const s of [-1, 1]) k.pinnacle(3.2, 'graniteLight', s * (fw / 2 - 0.7), H + 5.5, 0.45);
  k.pinnacle(3.8, 'graniteLight', 0, H + 10.9, 0.35);
  for (const s of [-1, 1]) k.statue(1.5, 'graniteLight', s * 3.4, H + 6.4, 0.7, { pose: 'down' });
  k.pop();
  k.end('front');

  // ---------------------------------------------- lost-cloister arcade fragment
  k.begin('cloister');
  const gx = cx + W / 2 + 7;
  k.prism(rect(gx, cz, 13, D - 6), -0.1, 0.25, 'sand');
  k.push({ x: cx + W / 2 + 0.7, z: cz, ry: Math.PI / 2 });
  k.arcade(D - 7, 5.4, 0.7, 4, 2.1, 3.5, 'granite', 0, 0, 0, { pointed: true });
  k.cornice(D - 6.4, corniceProfile('band', 0.4), 'graniteLight', 0, 5.4, 0.2);
  k.box(6.0, 0.5, 0.8, 'graniteLight', 0, 5.9, 0.15);
  k.pop();
  // return wall closing the garth on the south
  k.push({ x: gx, z: cz - (D - 6) / 2, ry: 0 });
  k.arcade(12, 5.2, 0.65, 3, 2.4, 3.4, 'granite', 0, 0, 0, { pointed: true });
  k.cornice(12.4, corniceProfile('band', 0.35), 'graniteLight', 0, 5.2, 0.2);
  k.pop();
  // lean-to roof slab over the walk
  k.prism(rect(cx + W / 2 + 3.6, cz, 6.4, D - 7.6), 5.4, 0.45, 'terracotta',
    { holes: [rect(cx + W / 2 + 3.6, cz, 5.6, D - 8.4)] });
  for (const [px, pz] of [[gx + 5.5, cz - (D - 6) / 2 + 0.6], [cx + W / 2 + 6, cz + (D - 6) / 2 - 0.6]]) {
    k.column(3.4, 0.34, 'graniteLight', px, 0, pz, { smooth: true });
  }
  k.end('cloister');
}
builder.metric = true;
builder.rule = { note: 'São Francisco: Gothic nave ~24x42 m, west portal, rose window, cloister arcade fragment' };
export default { 'sao-francisco-porto': builder };
