// Mosteiro da Serra do Pilar (begun 1538, re-inaugurated 1672) — the
// Renaissance monastery on the Gaia hill facing Porto. Its unique feature: a
// circular church and a circular single-storey cloister of the same diameter.
// The church is covered by a hemispherical dome on a tall drum; the Cloister
// of Silence has 36 Ionic columns in groups of nine, four circular chapels, a
// central fountain and 72 floor tombs. North and south wings carry the convent
// rooms; a bell tower stands between them. National Monument (1910), UNESCO
// World Heritage (1996).
//
// Drawn in its own metres and sized onto the OSM footprint by site-fit.js:
// the model fills the outline's local bounding box (17.41 x 57.06 m locally)
// so the fit is 1:1, with the height normalised to 30 m (dims). With no
// footprint the authored fallback size (16.6 x 57.1 m) is kept.
import { PROFILES, corniceProfile } from '../kit.js';
import { bbox } from '../geom.js';
import { fitTo } from './site-fit.js';

const EXT_W = 17.414;   // OSM outline local bbox, across the complex
const EXT_D = 57.064;   // OSM outline local bbox, front (+z) to back
const H = 30;           // dims height (dome + lantern + cross)

function ringPoints(cx, cz, r, n) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    p.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return p;
}

function builder(k, site) {
  const o = site?.footprint?.outline;
  const b = o && o.length >= 3 ? bbox(o) : null;
  const BW = b ? b.w : 16.6;
  const BD = b ? b.d : 57.1;
  const R = BW / 2;                 // rotunda outer radius = half the width
  const top = 20.4 + R;             // wall + dome + lantern + cross
  const authored = b ? { w: b.w, d: b.d, h: top, cx: b.cx, cz: b.cz } : { w: BW, d: BD, h: top, cx: 0, cz: 0 };
  const done = fitTo(k, site, authored, b || undefined);

  const zc = BD * 0.28;             // church centre
  const zk = -BD * 0.105;           // cloister centre
  const dn = BD * 0.07;             // north wing depth
  const dd = BD * 0.254;            // south wing depth

  k.begin('main');

  // ------------------------------------------------- circular church
  k.cyl(R, R, 0.9, 32, 'graniteDark', 0, 0, zc);
  k.cyl(R - 0.2, R - 0.2, 14.1, 32, 'plaster', 0, 0.9, zc);
  k.cyl(R, R, 0.9, 32, 'granite', 0, 15.0, zc);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const px = Math.cos(a) * (R - 0.45);
    const pz = zc + Math.sin(a) * (R - 0.45);
    k.box(0.6, 13.4, 0.7, 'granite', px, 0.9, pz, { ry: -a });
    k.box(1.3, 3.4, 0.35, 'glass', Math.cos(a) * (R - 0.25), 10.2, zc + Math.sin(a) * (R - 0.25), { ry: -a, emit: 0.08 });
  }
  // hemispherical dome, meridional ribs, lantern and cross
  k.dome(R - 0.2, 'graniteLight', 0, 15.9, zc, { seg: 28, rings: 8 });
  const y0 = 15.9;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    let prev = [Math.cos(a) * (R - 0.35), y0, zc + Math.sin(a) * (R - 0.35)];
    for (let s = 1; s <= 4; s++) {
      const th = (s / 4) * (Math.PI / 2);
      const rr = (R - 0.35) * Math.cos(th);
      const pt = [Math.cos(a) * rr, y0 + (R - 0.2) * Math.sin(th), zc + Math.sin(a) * rr];
      k.segment(prev, pt, 0.42, 0.42, 'granite', { round: true, seg: 4 });
      prev = pt;
    }
  }
  k.cyl(1.7, 1.7, 3.2, 12, 'graniteLight', 0, y0 + (R - 0.2), zc);
  k.dome(1.7, 'lead', 0, y0 + (R - 0.2) + 3.2, zc, { seg: 12, rings: 5 });
  k.box(0.16, 1.0, 0.16, 'iron', 0, y0 + (R - 0.2) + 4.9, zc);
  k.box(0.6, 0.16, 0.16, 'iron', 0, y0 + (R - 0.2) + 5.45, zc);

  // front portal and steps on the +z side
  const zf = zc + R;
  k.box(4.4, 7.2, 0.7, 'granite', 0, 0.9, zf + 0.1);
  k.surround({ x: 0, y: 0.4, w: 2.4, h: 4.6, arch: 'round' }, 0.5, 0.6, 'granite', zf + 0.8);
  for (const s of [-1, 1]) k.cyl(0.42, 0.5, 5.6, 8, 'graniteLight', s * 1.8, 0.9, zf + 0.6);
  k.box(5.6, 0.8, 1.2, 'graniteLight', 0, 6.5, zf + 0.3);
  k.stairs(5.2, 3.2, 0.9, 4, 'graniteLight', 0, 0, zf + 1.2);

  // ------------------------------------------------- circular cloister
  const C = BW * 0.43;
  const seg = 36;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const mid = (a0 + a1) / 2;
    if (mid > 0.6 && mid < 1.4) continue; // entrance toward +z
    k.wallLine([Math.cos(a0) * C, zk + Math.sin(a0) * C], [Math.cos(a1) * C, zk + Math.sin(a1) * C], 3.1, 0.55, 'granite', 0);
  }
  const rc = C * 0.755;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    k.lathe(PROFILES.column, 10, 'graniteLight', Math.cos(a) * rc, 0, zk + Math.sin(a) * rc, { sr: 0.3, sh: 4.4, smooth: true });
  }
  k.prism(ringPoints(0, zk, C + 0.5, 36), 4.4, 0.7, 'graniteLight', { holes: [ringPoints(0, zk, C * 0.59, 36).slice().reverse()] });
  k.prism(ringPoints(0, zk, C + 0.7, 36), 5.1, 0.5, 'terracotta', { holes: [ringPoints(0, zk, C * 0.56, 36).slice().reverse()] });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const cx = Math.cos(a) * (C - 0.4);
    const cz = zk + Math.sin(a) * (C - 0.4);
    k.cyl(1.5, 1.5, 4.0, 12, 'granite', cx, 0, cz);
    k.dome(1.5, 'lead', cx, 4.0, cz, { seg: 12, rings: 4 });
  }
  k.cyl(C * 0.6, C * 0.6, 0.15, 32, 'sand', 0, 0, zk);
  k.cyl(1.7, 1.9, 0.8, 16, 'graniteLight', 0, 0, zk);
  k.cyl(0.35, 0.5, 1.6, 10, 'graniteLight', 0, 0.8, zk);
  k.lathe(PROFILES.basin, 10, 'graniteLight', 0, 2.2, zk, { sr: 1.0, sh: 1.4, smooth: true });
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    k.box(1.2, 0.12, 0.5, 'graniteDark', Math.cos(a) * C * 0.9, 0, zk + Math.sin(a) * C * 0.9, { ry: -a });
  }

  // ------------------------------------------------- bell tower (kept inside the width)
  const tx = -BW * 0.30;
  const tz = BD * 0.05;
  k.box(BW * 0.20, 20.5, BW * 0.20, 'granite', tx, 0, tz);
  k.box(BW * 0.18, 2.6, BW * 0.18, 'graniteLight', tx, 20.5, tz);
  for (const s of [-1, 1]) k.box(1.4, 1.8, 0.2, 'dark', tx + s * 0.9, 21.0, tz + BW * 0.10 - 0.05);
  k.box(BW * 0.21, 0.5, BW * 0.21, 'graniteLight', tx, 20.5, tz);
  k.cone(BW * 0.12, 3.0, 4, 'terracotta', tx, 23.1, tz, { ry: Math.PI / 4 });
  k.box(0.14, 0.9, 0.14, 'iron', tx, 26.1, tz);

  // ------------------------------------------------- north and south wings
  k.box(BW * 0.55, 7.0, dn, 'plaster', 0, 0, BD / 2 - dn / 2);
  k.push({ x: 0, z: BD / 2 - dn / 2 });
  k.corniceRing(BW * 0.55, dn, corniceProfile('band', 0.35), 'granite', 0, 6.6, 0);
  k.hipRoof(BW * 0.55, dn, 2.2, 'terracotta', 0, 7.0, 0, { over: 0.5 });
  k.pop();

  k.box(BW * 0.66, 8.2, dd, 'plaster', 0, 0, -BD / 2 + dd / 2);
  k.push({ x: 0, z: -BD / 2 + dd / 2 });
  k.corniceRing(BW * 0.66, dd, corniceProfile('band', 0.4), 'granite', 0, 7.7, 0);
  k.hipRoof(BW * 0.66, dd, 2.8, 'terracotta', 0, 8.2, 0, { over: 0.6 });
  k.pop();
  for (let i = 0; i < 3; i++) {
    for (let s = 0; s < 2; s++) {
      k.box(1.0, 1.8, 0.3, 'glass', -BW * 0.2 + i * BW * 0.2, 1.2 + s * 3.4, -BD / 2 + dd + 0.15, { emit: s ? 0.12 : 0 });
    }
  }

  k.end('main');
  done();
}

builder.metric = true;
builder.rule = {
  note: 'Serra do Pilar: round domed church + round same-diameter cloister, wings and bell tower; site-fit onto the OSM outline (17.4 x 57.1 m), height 30 m',
  extent: { box: { x0: -EXT_W / 2, x1: EXT_W / 2, z0: -EXT_D / 2, z1: EXT_D / 2 } },
  frame: { x0: -EXT_W / 2, x1: EXT_W / 2, z0: -EXT_D / 2, z1: EXT_D / 2, y0: 0 },
};

export default { 'serra-do-pilar': builder };
