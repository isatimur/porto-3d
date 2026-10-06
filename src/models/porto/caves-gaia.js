// Caves do Vinho do Porto, Gaia — the port-wine lodges on the south bank
// (Croft 1678, Taylor's 1692, Sandeman 1790, Graham's 1820). Long, low, dark
// warehouse buildings with pitched roofs, rows of small windows and doors,
// big painted brand boards (white letters on dark boards), and oak casks
// stacked in the open yard. Aligned to the footprint's long axis, river +z.
import { Kit, PALETTE, MAT, PROFILES, corniceProfile } from '../kit.js';
import { edges, obb, offset, bbox, rect } from '../geom.js';
import { win } from '../parts.js';

// Painted signboard: a dark framed board carrying a row of white letter
// blocks spelling a brand name.
function signBoard(k, text, x, y, z, w, h, o = {}) {
  k.box(w + 0.5, h + 0.5, 0.16, o.frame ?? 'graniteLight', x, y - 0.25, z);
  k.box(w, h, 0.22, o.board ?? 0x1b2632, x, y, z + 0.08, { mat: MAT.smooth });
  const n = text.length;
  const pad = w * 0.07;
  const lw = (w - pad * 2) / n;
  for (let i = 0; i < n; i++) {
    const cx = x - w / 2 + pad + lw * (i + 0.5);
    const bw = lw * 0.56;
    const bh = h * 0.42;
    const by = y + (h - bh) / 2;
    k.box(bw, bh, 0.06, 'white', cx, by, z + 0.2, { mat: MAT.smooth });
    const ch = text.charCodeAt(i);
    if (ch % 2) k.box(bw, bh * 0.2, 0.06, 'white', cx, by - bh * 0.25, z + 0.2, { mat: MAT.smooth });
    if (ch % 3 === 0) k.box(bw * 0.22, bh, 0.06, 'white', cx - bw * 0.34, by, z + 0.2, { mat: MAT.smooth });
  }
}

// Oak cask lying on its side, axis along x.
function cask(k, x, y, z, r = 0.52, len = 1.35) {
  const yc = y + r;
  k.segment([x - len / 2, yc, z], [x + len / 2, yc, z], r * 2, r * 2, 'wood', { round: true, seg: 10 });
  for (const f of [-0.3, 0.3]) {
    k.segment([x + f * len - 0.05, yc, z], [x + f * len + 0.05, yc, z], r * 2.09, r * 2.09, 'iron', { round: true, seg: 10 });
  }
}

function warehouse(k, cx, cz, w, d, h, sign) {
  k.prism(rect(cx, cz, w, d), 0, h, 'graniteDark');
  k.prism(rect(cx, cz, w + 0.3, d + 0.3), 0, 0.9, 'granite');
  k.cornice(w, corniceProfile('band', 0.4), 'graniteDark', cx, h - 0.4, cz + d / 2);
  k.push({ x: cx, z: cz, ry: Math.PI / 2 });
  k.gableRoof(d + 0.4, w + 0.6, 2.6, 'slate', 0, h, 0, { over: 0.6 });
  k.pop();
  // rows of small windows / recessed doors on both long faces
  for (const s of [-1, 1]) {
    const zf = cz + s * (d / 2 + 0.02);
    k.push({ x: cx, z: zf, ry: s > 0 ? 0 : Math.PI });
    const nb = Math.max(2, Math.round(w / 4.5));
    for (let i = 0; i < nb; i++) {
      const wx = -w / 2 + (w / nb) * (i + 0.5);
      win(k, wx, 3.4, 0.95, 1.5, 0, { trim: 'graniteLight', pane: 'glass', bw: 0.18, depth: 0.25 });
    }
    const nd = Math.max(1, Math.round(w / 13));
    for (let i = 0; i < nd; i++) {
      const wx = -w / 2 + (w / nd) * (i + 0.5);
      win(k, wx, 0, 2.2, 3.2, 0, { arch: 'round', trim: 'granite', pane: 'dark', bw: 0.24, depth: 0.35 });
    }
    k.pop();
  }
  if (sign) signBoard(k, sign, cx, h * 0.55, cz + d / 2 + 0.16, Math.min(w * 0.7, 28), 2.6);
  // granite quoins, iron tie plates and a hoist beam with its pulley block
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    for (let q = 0; q < 6; q++) k.box(0.5, 0.9, 0.5, 'granite', cx + sx * (w / 2 - 0.25), 0.9 + q * 2.0, cz + sz * (d / 2 - 0.25));
  }
  for (const s of [-1, 1]) {
    const zf = cz + s * (d / 2 + 0.06);
    k.segment([cx - w * 0.32, h * 0.82, zf], [cx + w * 0.32, h * 0.82, zf], 0.2, 0.2, 'iron');
    k.box(1.0, 0.55, 1.0, 'wood', cx, h * 0.82 - 0.75, zf + 0.2);
    k.cyl(0.3, 0.3, 0.22, 8, 'iron', cx, h * 0.82 - 1.2, zf + 0.2, { rx: Math.PI / 2 });
    for (let i = -2; i <= 2; i++) k.box(0.16, 0.16, 0.14, 'iron', cx + i * (w * 0.18), h * 0.62, zf);
  }
}

function builder(k, site) {
  const o = site?.footprint?.outline;
  const bb = o && o.length >= 3 ? obb(o) : { L: 120, W: 46, cx: 0, cz: 0, a: 0 };
  const L = Math.max(70, Math.min(200, bb.L));
  const W = Math.max(26, Math.min(70, bb.W));
  const rnd = k.rnd;

  k.push({ x: bb.cx, z: bb.cz, ry: bb.a });
  k.begin('main');

  // riverside quay, and the river bed under the scene's own Douro: it keeps
  // the model box as wide as the OSM extent (the never-shrink rule) and sits
  // below the water line, never seen. The water slab that stood here showed
  // as a pale-blue flat polygon on the Gaia bank.
  k.prism(rect(0, W / 2 + 7, L + 30, 12), -0.3, 0.7, 'graniteWarm');
  k.prism(rect(0, W / 2 + 40, L + 80, 60), -2.2, 0.45, 'graniteDark');

  // three parallel lodges set back from the river
  // (a metre lower than first drawn: the ridge of the tallest lodge stood at
  // 15.9 m against the 14 m of data/dimensions.json, 13.6 % over)
  warehouse(k, 0, W / 2 - 11, L * 0.92, 15, 12, 'SANDEMAN');
  warehouse(k, -L * 0.06, W / 2 - 32, L * 0.62, 14, 11.5, "GRAHAM'S");
  warehouse(k, L * 0.22, W / 2 - 32, L * 0.28, 13, 10.5, "TAYLOR'S");

  // open yard: rows of casks between the lodges and beside them
  const yards = [
    { cx: -L * 0.3, cz: W / 2 - 11, n: 5, rows: 3 },
    { cx: L * 0.34, cz: W / 2 - 20, n: 4, rows: 3 },
  ];
  for (const yd of yards) {
    for (let r = 0; r < yd.rows; r++) {
      for (let i = 0; i < yd.n; i++) {
        cask(k, yd.cx - ((yd.n - 1) * 2.0) / 2 + i * 2.0, 0, yd.cz - ((yd.rows - 1) * 1.7) / 2 + r * 1.7, 0.52, 1.35);
      }
    }
  }
  // a few barrels standing under the eaves
  for (let i = 0; i < 8; i++) {
    const bx = -L * 0.42 + i * 3.1;
    k.cyl(0.55, 0.62, 1.5, 10, 'wood', bx, 0, W / 2 - 3.2);
  }
  // yard lamps and a flag pole
  for (let i = 0; i < Math.max(2, Math.round(L / 45)); i++) {
    k.lamp(4.4, -L / 2 + (L * (i + 0.5)) / Math.max(2, Math.round(L / 45)), 0, W / 2 - 2.5, { globe: true });
  }
  // ---------------------------------------------------------- detail pass
  // yard: cobbled apron strips, a weighbridge and stacked pallets by the doors
  for (const yd of yards) k.prism(rect(yd.cx, yd.cz, yd.n * 3.2, yd.rows * 3.0), 0, 0.08, 'graniteGrey');
  k.box(6.0, 0.4, 3.0, 'steel', -L * 0.16, 0, W / 2 - 6.0);
  k.box(6.6, 0.3, 3.6, 'granite', -L * 0.16, 0, W / 2 - 6.0);
  for (let i = 0; i < 5; i++) k.box(1.3, 0.45 * (i + 1), 1.1, 'wood', L * 0.4, 0, W / 2 - 8 - i * 0.1);
  for (let i = 0; i < 4; i++) k.box(2.6, 0.2, 1.6, 'wood', -L * 0.4 + i * 0.6, i * 0.22, W / 2 - 5.4 + i * 0.5);
  k.end('main');
  k.pop();
}
builder.metric = true;
builder.rule = { note: 'Gaia port lodges: dark pitched warehouses, brand boards and cask rows, ~120 m' };
export default { 'caves-gaia': builder };
