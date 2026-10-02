// Torre e Igreja dos Clérigos, Porto. Niccolò Nasoni, 1754-1763.
// Tower 75.6 m (225 steps), granite; convex baroque church in front.
import { Kit, PALETTE, MAT, PROFILES, corniceProfile, archPath, pointedPath } from '../kit.js';
import { onEdge, polyCornice, polyBand, polyWindows, roofOver, plainBuilding } from '../metric.js';
import { edges, obb, offset, bbox } from '../geom.js';
import { win, scrollCrest, bell } from '../parts.js';

const rectPts = (cx, cz, w, d) => [
  [cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2],
  [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2],
];

// Convex facade plan: apex at (cx, cz), bulging toward +z.
function curvedPlan(cx, cz, halfW, R, t, seg = 10) {
  const a = Math.asin(Math.min(0.92, halfW / R));
  const zc = cz - R;
  const outer = [];
  const inner = [];
  for (let i = 0; i <= seg; i++) {
    const p = -a + (2 * a * i) / seg;
    outer.push([cx + R * Math.sin(p), zc + R * Math.cos(p)]);
    inner.push([cx + (R - t) * Math.sin(p), zc + (R - t) * Math.cos(p)]);
  }
  return outer.concat(inner.reverse());
}

// Disc centred at (x, y, z), facing the current local +z.
function disc(k, r, th, color, x, y, z, o = {}) {
  k.cyl(r, r, th, o.seg ?? 20, color, x, y - th / 2, z, { rx: Math.PI / 2, ...o });
}

function builder(k, site) {
  const tx = 7;
  const tz = -4;
  const W = 8.4;

  // ---------------------------------------------------------------- tower
  k.begin('tower');
  k.box(W + 1.6, 1.4, W + 1.6, 'granite', tx, 0, tz);
  k.frustum(W, W, W - 0.9, W - 0.9, 44, 'granite', tx, 1.4, tz);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    k.box(0.9, 44, 0.9, 'graniteLight', tx + sx * (W / 2 - 0.45), 1.4, tz + sz * (W / 2 - 0.45));
  }
  k.corniceRing(W, W, corniceProfile('band', 0.5), 'graniteLight', tx, 15, tz);
  k.corniceRing(W, W, corniceProfile('band', 0.5), 'graniteLight', tx, 29, tz);

  // doorway + two shaft windows per face
  k.wall(3.6, 5.4, 0.8, 'granite', [{ x: 0, y: 0, w: 2.3, h: 3.9, arch: 'round', pane: 'dark', inset: 0.5 }], tx, 0.6, tz + W / 2 - 0.4);
  k.surround({ x: 0, y: 0, w: 2.3, h: 3.9, arch: 'round' }, 0.35, 0.55, 'graniteLight', tz + W / 2 + 0.05);
  for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    k.push({ x: tx, z: tz, ry });
    win(k, 0, 19.5, 1.5, 3.0, W / 2 - 0.3, { arch: 'round', pane: 'glass', bw: 0.25, depth: 0.3 });
    win(k, 0, 33.0, 1.5, 3.0, W / 2 - 0.5, { arch: 'round', pane: 'glass', bw: 0.25, depth: 0.3 });
    k.pop();
  }

  let y = 45.4;
  k.corniceRing(W + 0.3, W + 0.3, corniceProfile('classic', 0.8), 'graniteLight', tx, y, tz);
  y += 0.8;

  // clock stage
  k.box(W, 5.4, W, 'granite', tx, y, tz);
  for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    k.push({ x: tx, z: tz, ry });
    disc(k, 1.65, 0.3, 'graniteLight', 0, y + 2.7, W / 2 + 0.1, { seg: 22 });
    disc(k, 1.3, 0.22, 'white', 0, y + 2.7, W / 2 + 0.3, { seg: 20 });
    k.box(0.12, 1.0, 0.08, 'dark', 0, y + 2.75, W / 2 + 0.44);
    k.box(0.7, 0.12, 0.08, 'dark', 0.28, y + 2.7, W / 2 + 0.44);
    k.pop();
  }
  y += 5.4;
  k.corniceRing(W + 0.3, W + 0.3, corniceProfile('classic', 0.8), 'graniteLight', tx, y, tz);
  y += 0.8;

  // belfry: dark core, one arched opening per face, two bells
  const hB = 8.0;
  k.box(W - 1.4, hB, W - 1.4, 'dark', tx, y, tz);
  for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    k.push({ x: tx, z: tz, ry });
    k.wall(W, hB, 0.55, 'granite', [{ x: 0, y: 1.2, w: 3.2, h: 5.4, arch: 'round', pane: null }], 0, y, W / 2 - 0.27);
    k.surround({ x: 0, y: 1.2, w: 3.2, h: 5.4, arch: 'round' }, 0.3, 0.4, 'graniteLight', W / 2);
    k.pop();
  }
  bell(k, 3.0, tx, y + 1.6, tz + W / 2 - 1.2);
  bell(k, 3.0, tx, y + 1.6, tz - W / 2 + 1.2);
  y += hB;
  k.corniceRing(W + 0.3, W + 0.3, corniceProfile('classic', 0.8), 'graniteLight', tx, y, tz);
  y += 0.8;

  // Nasoni crown: balustrade, flame pinnacles, octagonal drum, dome, lantern
  for (const [ry, ox, oz, len] of [[0, 0, W / 2 - 0.2, W * 0.86], [Math.PI, 0, -W / 2 + 0.2, W * 0.86], [Math.PI / 2, W / 2 - 0.2, 0, W * 0.86], [-Math.PI / 2, -W / 2 + 0.2, 0, W * 0.86]]) {
    k.push({ x: tx + ox, z: tz + oz, ry });
    k.balustrade(len, 1.2, 'graniteLight', 0, y, 0, { cheap: true, d: 0.28, sp: 0.55 });
    k.pop();
  }
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    k.lathe(PROFILES.finial, 7, 'graniteLight', tx + sx * W * 0.4, y, tz + sz * W * 0.4, { sr: 0.7, sh: 2.2, flat: true });
  }
  y += 1.3;
  k.cyl(W * 0.36, W * 0.42, 3.4, 8, 'granite', tx, y, tz);
  for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    k.push({ x: tx, z: tz, ry });
    win(k, 0, y + 0.9, 0.9, 1.6, W * 0.27, { arch: 'round', pane: 'glass', bw: 0.18, depth: 0.25 });
    k.pop();
  }
  y += 3.4;
  k.lathe(PROFILES.bellCap, 12, 'granite', tx, y, tz, { sr: W * 0.38, sh: 4.0, smooth: true });
  y += 4.0;
  k.cyl(0.75, 0.85, 1.5, 8, 'graniteLight', tx, y, tz);
  k.dome(0.9, 'granite', tx, y + 1.5, tz, { seg: 10, rings: 5 });
  y += 2.5;
  k.box(0.18, 2.9, 0.18, 'iron', tx, y, tz);
  k.box(1.35, 0.18, 0.18, 'iron', tx, y + 1.9, tz);
  k.end('tower');

  // ---------------------------------------------------------------- church
  k.begin('church');
  const cxc = -6;
  const czc = -12;
  const cw = 16;
  const cd = 34;
  k.prism(offset(rectPts(cxc, czc, cw, cd), 0.25), 0, 1.2, 'graniteDark');
  k.prism(rectPts(cxc, czc, cw, cd), 0, 14, 'granite');
  k.gableRoof(cw, cd, 5, 'terracotta', cxc, 14, czc, { over: 0.6 });
  const fz = czc + cd / 2;
  const plan = curvedPlan(cxc, fz, 9.2, 20, 1.8, 12);
  k.prism(plan, 0, 15, 'granite');
  polyCornice(k, plan, 15, corniceProfile('classic', 0.7), 'graniteLight');

  // door, statue niche, oculus, flanking windows, crest and cross
  win(k, cxc, 0.2, 2.4, 4.4, fz + 0.35, { arch: 'round', pane: 'dark', head: 'seg', bw: 0.35, depth: 0.5 });
  k.push({ x: cxc, z: fz });
  k.surround({ x: 0, y: 6.4, w: 2.0, h: 3.0, arch: 'round' }, 0.3, 0.45, 'graniteLight', 0.4);
  k.statue(1.5, 'graniteLight', 0, 6.6, 0.7, { pose: 'hold' });
  disc(k, 1.15, 0.3, 'graniteLight', 0, 11.2, 0.5, { seg: 20 });
  disc(k, 0.85, 0.2, 'window', 0, 11.2, 0.68, { seg: 18, emit: 0.4 });
  k.pop();
  for (const sx of [-1, 1]) {
    win(k, cxc + sx * 5.6, 2.6, 1.7, 3.2, fz + 0.1, { arch: 'round', pane: 'glass', bw: 0.25, depth: 0.3 });
  }
  scrollCrest(k, 6.5, 3.4, 0.8, 'graniteLight', cxc, 15, fz + 0.4);
  k.box(0.16, 2.4, 0.16, 'iron', cxc, 18.6, fz + 0.4);
  k.box(1.1, 0.16, 0.16, 'iron', cxc, 20.1, fz + 0.4);

  // side chapels
  k.prism(rectPts(cxc - 11, czc - 4, 7, 10), 0, 10, 'granite');
  k.prism(rectPts(cxc + 11, czc - 4, 7, 10), 0, 10, 'granite');
  k.end('church');
}

builder.metric = true;
builder.rule = { note: 'Nasoni tower 75.6 m, curved granite church; authored metric, footprint optional' };
export default { clerigos: builder };
