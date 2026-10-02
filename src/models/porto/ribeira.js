// Cais da Ribeira, Porto — the medieval riverfront of the Douro (UNESCO,
// 1996). Not one building but a continuous terrace: 3–4 storey houses with
// ground-floor arcades, varied pastel and granite facades, tiled hip roofs
// and small chimneys, facing the paved quay. The row is aligned to the
// footprint's long axis; rabelo boats sit at the quay.
import { Kit, PALETTE, MAT, PROFILES, corniceProfile } from '../kit.js';
import { edges, obb, offset, bbox, rect } from '../geom.js';
import { win } from '../parts.js';

const FACADES = ['plaster', 'cream', 'ochre', 'rose', 'white', 'graniteWarm', 'ochre', 'cream'];

function rabelo(k, x, z, ry, s = 1) {
  k.push({ x, z, ry });
  k.frustum(3.2 * s, 1.4 * s, 2.4 * s, 1.0 * s, 1.1 * s, 'wood', 0, -0.25, 0);
  k.box(0.25 * s, 7 * s, 0.25 * s, 'wood', 0, 0.7 * s, 0.1 * s);
  k.box(4.2 * s, 3.2 * s, 0.08 * s, 'sand', 0, 5.2 * s, 0.05 * s);
  k.box(4.0 * s, 0.15 * s, 0.6 * s, 'wood', 0, 7.0 * s, 0.1 * s);
  k.pop();
}

function builder(k, site) {
  const o = site?.footprint?.outline;
  const bb = o && o.length >= 3 ? obb(o) : { L: 96, W: 14, cx: 0, cz: 0, a: 0 };
  const L = Math.max(40, Math.min(170, bb.L));
  const Dp = Math.max(8, Math.min(17, bb.W));
  const zF = Dp / 2;            // facade line
  const rnd = k.rnd;

  k.push({ x: bb.cx, z: bb.cz, ry: bb.a });
  k.begin('main');

  // paved quay edge + river
  k.prism(rect(0, zF + 5.5, L + 26, 7), -0.35, 0.75, 'graniteWarm');
  k.prism(rect(0, zF + 5.5, L + 25, 6.4), 0.4, 0.2, 'sand');
  k.prism(rect(0, zF + 30, L + 60, 52), -0.7, 0.42, 'water', { emit: 0.04 });
  k.prism(rect(0, zF + 3.4, L + 30, 1.0), -0.3, 0.5, 'graniteDark');

  // the terrace: houses of varied width, height and colour, side by side
  let x = -L / 2;
  let hi = 0;
  while (x < L / 2 - 2.5) {
    const w = Math.max(5.5, Math.min(12, 5.5 + rnd() * 6.5));
    const ww = Math.min(w, L / 2 - x);
    const cx = x + ww / 2;
    const h = 11.5 + Math.round(rnd() * 4.5);
    const col = FACADES[Math.floor(rnd() * FACADES.length)];
    const gh = 3.6;             // arcade storey
    // body set back behind the arcade wall
    k.prism(rect(cx, -0.35, ww - 0.15, Dp - 0.7), 0, h, col);
    k.box(ww - 0.6, gh - 0.4, 0.16, 'dark', cx, 0.25, zF - 0.95);
    // ground-floor arcade on the quay face
    const na = Math.max(1, Math.round(ww / 3.3));
    k.push({ x: cx, z: zF - 0.25, ry: 0 });
    k.arcade(ww - 0.3, gh, 0.75, na, (ww / na) * 0.62, gh - 0.55, 'graniteWarm');
    k.pop();
    // upper storeys of windows
    const sy = [gh + 0.7, gh + 4.2, gh + 7.7];
    for (const wy of sy) {
      if (wy + 1.9 > h) continue;
      const nb = Math.max(1, Math.round(ww / 3.0));
      for (let i = 0; i < nb; i++) {
        const wx = -ww / 2 + (ww / nb) * (i + 0.5);
        win(k, cx + wx, wy, 1.0, 1.7, zF - 0.18, { trim: 'granite', pane: 'glass', bw: 0.2, depth: 0.28, sill: true, balcony: rnd() > 0.78 ? 'iron' : false });
      }
    }
    // cornice, tiled hip roof, chimneys
    k.cornice(ww, corniceProfile('eave', 0.4), 'granite', cx, h - 0.35, zF - 0.3);
    k.push({ x: cx, z: -0.35 });
    k.hipRoof(ww - 0.1, Dp - 0.7, 2.6, 'terracotta', 0, h, 0, { over: 0.45 });
    k.pop();
    const nch = 1 + Math.floor(rnd() * 2);
    for (let c = 0; c < nch; c++) k.box(0.5, 0.9, 0.5, 'graniteWarm', cx + (rnd() - 0.5) * ww * 0.6, h + 2.4, -1 + rnd() * (Dp - 2));
    x += ww;
    hi++;
  }
  k.end('main');

  // street lamps on the quay
  k.begin('quay');
  for (let i = 0; i < Math.max(2, Math.round(L / 22)); i++) {
    const lx = -L / 2 + (L * (i + 0.5)) / Math.max(2, Math.round(L / 22));
    k.lamp(4.6, lx, 0.55, zF + 3.0, { globe: true });
  }
  // rabelo boats on the Douro
  const nbo = Math.max(2, Math.round(L / 26));
  for (let i = 0; i < nbo; i++) {
    rabelo(k, -L / 2 + (L * (i + 0.5)) / nbo + (rnd() - 0.5) * 6, zF + 12 + rnd() * 8, Math.PI / 2 + (rnd() - 0.5) * 0.35);
  }
  k.end('quay');
  k.pop();
}
builder.metric = true;
builder.rule = { note: 'Cais da Ribeira: continuous arcaded terrace row on the Douro quay, ~96 m' };
export default { ribeira: builder };
