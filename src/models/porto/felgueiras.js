// Farolim de Felgueiras (Foz do Douro) — the 1886 hexagonal granite
// lighthouse (~10 m) at the tip of the Felgueiras mole, where the Douro meets
// the Atlantic. The footprint is the long breakwater, so the mole itself is
// drawn as a low granite quay with the small tower, white with granite bands,
// a glass lantern and a red copper dome, plus ocean and rocks.
import { Kit, PALETTE, MAT, PROFILES, corniceProfile } from '../kit.js';
import { edges, obb, offset, bbox, rect } from '../geom.js';

function builder(k, site) {
  const o = site?.footprint?.outline;
  const bb = o && o.length >= 3 ? obb(o) : { L: 130, W: 11, cx: 0, cz: 0, a: 0 };
  const L = Math.max(50, Math.min(220, bb.L));
  const W = Math.max(6, Math.min(20, bb.W));

  k.push({ x: bb.cx, z: bb.cz, ry: bb.a });
  k.begin('main');

  // ocean around the mole
  k.prism(rect(0, 0, L + 90, W + 110), -1.4, 0.5, 'water', { emit: 0.06 });

  // breakwater mole: battered granite quay, low and long
  k.frustum(L, W + 3, L - 4, W, 1.5, 'graniteDark', 0, -0.9, 0);
  k.prism(rect(0, 0, L - 3, W), 0.5, 0.35, 'graniteWarm');
  k.prism(rect(0, -W / 2 + 0.4, L, 1.2), 0.2, 0.6, 'granite');
  k.prism(rect(0, W / 2 - 0.4, L, 1.2), 0.2, 0.6, 'granite');
  // rocky toe scattered along both water sides
  for (let i = 0; i < 22; i++) {
    const rx = -L / 2 + (L * (i + 0.5)) / 22;
    k.ico(0.9 + (i % 3) * 0.45, 0, 'graniteDark', rx, -0.25, W / 2 + 1.0 + (i % 2) * 0.9, { jitter: 0.35, sy: 0.6 });
    if (i % 2 === 0) k.ico(1.15, 0, 'graniteDark', rx, -0.45, -W / 2 - 1.1, { jitter: 0.3, sy: 0.55 });
  }
  // quay railing along both edges of the mole
  const np = Math.max(12, Math.round(L / 2.2));
  for (const s of [-1, 1]) {
    for (let i = 0; i < np; i++) k.box(0.1, 0.95, 0.1, 'iron', -L / 2 + (L * (i + 0.5)) / np, 0.85, s * (W / 2 - 0.25));
    k.box(L, 0.08, 0.08, 'iron', 0, 1.8, s * (W / 2 - 0.25));
    k.box(L, 0.05, 0.05, 'iron', 0, 1.4, s * (W / 2 - 0.25));
  }
  // setts kerb lining both edges of the mole crown
  const nk = Math.max(12, Math.round(L / 1.8));
  for (const s of [-1, 1]) {
    for (let i = 0; i < nk; i++) k.box(1.45, 0.22, 0.42, 'graniteWarm', -L / 2 + (L * (i + 0.5)) / nk, 0.85, s * (W / 2 - 0.35));
  }
  // mooring bollards along the sheltered side
  for (let i = 0; i < 8; i++) k.cyl(0.22, 0.32, 0.7, 8, 'iron', -L / 2 + 9 + (i * (L - 18)) / 7, 1.0, -W / 2 + 1.1);
  k.end('main');

  // -------------------------------------------------------- the lighthouse
  // The light, not the mole, is the landmark's height: the 'height' group
  // lets fit.js measure it (rule.heightRel) instead of the low breakwater.
  k.begin('height');
  k.begin('tower');
  const tx = L / 2 - 4.5;
  const y0 = 0.85;              // mole crown
  // hexagonal plinth
  k.cyl(3.0, 3.4, 0.7, 6, 'granite', tx, y0, 0);
  // hexagonal shaft, white with granite rings
  k.cyl(1.55, 2.05, 5.2, 6, 'white', tx, y0 + 0.7, 0);
  for (let i = 0; i < 3; i++) k.cyl(1.98 - i * 0.16, 2.05 - i * 0.16, 0.28, 6, 'graniteWarm', tx, y0 + 0.9 + i * 1.6, 0);
  // door and slit windows
  k.box(0.9, 1.9, 0.3, 'wood', tx, y0 + 0.7, 1.9);
  for (let i = 0; i < 3; i++) k.box(0.4, 0.9, 0.3, 'glass', tx, y0 + 2.4 + i * 0.9, 1.75 - i * 0.05, { emit: 0.15 });
  // service ladder up the shaft
  for (let i = 0; i < 7; i++) k.box(0.55, 0.08, 0.08, 'iron', tx - 1.85, y0 + 1.5 + i * 0.6, 0);
  k.box(0.08, 4.6, 0.08, 'iron', tx - 2.12, y0 + 1.5, 0);
  k.box(0.08, 4.6, 0.08, 'iron', tx - 1.6, y0 + 1.5, 0);
  const ty = y0 + 0.7 + 5.2;
  // gallery: red platform, railing posts and rail
  k.cyl(2.5, 2.5, 0.3, 12, 'rust', tx, ty, 0);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    k.box(0.1, 0.7, 0.1, 'rust', tx + Math.cos(a) * 2.25, ty + 0.3, Math.sin(a) * 2.25);
  }
  k.cyl(2.28, 2.28, 0.08, 12, 'rust', tx, ty + 0.95, 0, { open: true });
  // lantern room: mullioned glass drum under the dome
  k.cyl(1.45, 1.5, 1.35, 12, 'glass', tx, ty + 0.3, 0, { emit: 0.5 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.26;
    k.box(0.12, 1.35, 0.12, 'iron', tx + Math.cos(a) * 1.34, ty + 0.3, Math.sin(a) * 1.34);
  }
  // the lamp
  k.sphere(0.55, 'window', tx, ty + 0.95, 0, { seg: 10, rings: 6, emit: 0.95 });
  // red copper dome + finial
  k.cyl(1.55, 1.5, 0.25, 12, 'rust', tx, ty + 1.65, 0);
  k.dome(1.5, 'rust', tx, ty + 1.9, 0, { seg: 14, rings: 6 });
  k.cyl(0.08, 0.08, 0.6, 5, 'iron', tx, ty + 3.35, 0);
  k.sphere(0.16, 'gold', tx, ty + 3.95, 0, { seg: 6, rings: 4, emit: 0.5 });
  k.end('tower');
  k.end('height');

  // keeper's house on the mole
  k.begin('house');
  const hx = tx - 12;
  k.box(6, 3.0, 4.5, 'white', hx, y0, -1.2);
  k.push({ x: hx, z: -1.2 });
  k.hipRoof(6.2, 4.7, 1.6, 'terracotta', 0, y0 + 3.0, 0, { over: 0.4 });
  k.pop();
  k.box(0.9, 1.9, 0.25, 'wood', hx, y0, 1.05);
  for (const s of [-1, 1]) k.box(0.8, 0.9, 0.25, 'glass', hx + s * 1.8, y0 + 1.4, 1.05, { emit: 0.2 });
  // old fog-signal hut
  k.box(2.6, 2.4, 2.6, 'white', hx + 6.5, y0, 1.4);
  k.cone(1.8, 1.3, 4, 'rust', hx + 6.5, y0 + 2.4, 1.4);
  // foam lines breaking along the mole
  for (let i = 0; i < 12; i++) k.box(3.2, 0.06, 0.5, 'white', -L / 2 + (L * (i + 0.5)) / 12, -1.05, W / 2 + 3.2 + (i % 2) * 1.6, { emit: 0.25 });

  // ---------------------------------------------------------- detail pass
  k.begin('works');
  // winch house with a mooring drum, and a small hand crane on the mole tip
  const wx = tx - 20;
  k.box(4.2, 3.0, 3.6, 'wood', wx, y0, 0);
  k.push({ x: wx, z: 0 });
  k.gableRoof(4.4, 3.8, 1.2, 'rust', 0, y0 + 3.0, 0, { over: 0.35 });
  k.pop();
  k.box(0.9, 1.8, 0.25, 'wood', wx, y0, 1.82);
  k.cyl(1.5, 1.5, 0.5, 12, 'wood', wx, y0 + 0.4, -1.95, { rx: Math.PI / 2 });
  k.cyl(0.35, 0.35, 0.6, 8, 'iron', wx, y0 + 0.4, -1.95, { rx: Math.PI / 2 });
  // hand crane: mast, jib and pulley block
  const cxr = tx - 30;
  k.cyl(0.28, 0.38, 6.5, 8, 'iron', cxr, y0, -0.4);
  k.segment([cxr, y0 + 6.3, -0.4], [cxr + 5.5, y0 + 4.6, -0.4], 0.22, 0.22, 'iron');
  k.cyl(0.5, 0.5, 0.22, 10, 'iron', cxr + 5.5, y0 + 4.6, -0.4, { rx: Math.PI / 2 });
  k.cyl(0.08, 0.08, 4.4, 5, 'iron', cxr + 5.5, y0 + 2.4, -0.4);
  k.box(0.7, 0.7, 0.7, 'bronze', cxr + 5.5, y0 + 0.2, -0.4);
  // fog bell on a timber frame near the house
  const bx2 = tx - 8;
  k.box(0.18, 3.2, 0.18, 'wood', bx2 - 0.8, y0, 2.4);
  k.box(0.18, 3.2, 0.18, 'wood', bx2 + 0.8, y0, 2.4);
  k.box(2.0, 0.18, 0.18, 'wood', bx2, y0 + 3.2, 2.4);
  k.lathe([[0, 0], [0.5, 0], [0.46, 0.12], [0.34, 0.5], [0.3, 0.86], [0.12, 1], [0, 1]], 8, 'bronze', bx2, y0 + 2.2, 2.4, { sr: 1.1, sh: 1.1, smooth: true });
  // stone steps down the sheltered face to the water, with a rope rail
  for (let i = 0; i < 6; i++) k.box(2.2, 0.3, 0.9, 'graniteWarm', L / 2 - 18, 0.5 - i * 0.3, -W / 2 - 0.5 - i * 0.85);
  for (let i = 0; i < 4; i++) k.box(0.08, 1.0, 0.08, 'iron', L / 2 - 18 - 0.9, 1.4 - i * 0.3, -W / 2 - 0.6 - i * 1.3);
  // extra tetrapod blocks along the exposed side
  for (let i = 0; i < 8; i++) {
    const rx = -L / 2 + (L * (i + 0.5)) / 8;
    k.box(1.6, 1.0, 1.6, 'graniteDark', rx, -1.1, -W / 2 - 2.2, { ry: (i % 3) * 0.4, rz: 0.2 });
  }
  k.end('works');
  k.end('house');
  k.pop();
}
builder.metric = true;
builder.rule = { note: 'Farolim de Felgueiras: ~10 m hexagonal tower on the breakwater mole at the Douro mouth' };
export default { felgueiras: builder };
