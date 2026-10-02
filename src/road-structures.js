// Bridge and tunnel geometry for the core streets (roads.js); the streamed
// tiles carry no bridge or tunnel tags. DOM-free and three-free: it pushes flat-shaded
// triangles into an accumulator T = { pos: [], nor: [], col: [], idx: [] }
// (world units; colours linear 0..1), which the caller packs.
//
//   bridgeGeometry(T, pts, opts)   a deck of real width along pts [{x, z, y, g, s}]
//     (y: top of the road surface, g: ground, s: distance along), with the
//     slab edge, parapets, piers down to the ground every ~20 m, abutments
//     at raised ends; style 'arch' draws granite spandrel walls over round
//     arches instead (the medieval bridges on the Cávado);
//   portalGeometry(T, p, opts)     a tunnel portal: head wall, pilasters, wing
//     walls, a dark mouth, and a short hood over the first metres of the
//     tunnel, where the vehicles disappear (road-network.js HID).

const M = 1 / 4; // world units per metre

function push(T, x, y, z, nx, ny, nz, c) {
  T.pos.push(x, y, z);
  T.nor.push(nx, ny, nz);
  T.col.push(c[0], c[1], c[2]);
  if (T.wall) T.wall.push(0, -1, 0, 0);
}
// a quad a-b-c-d with its face normal (from the corners); flipped so it
// faces `toward` when given
export function quad(T, a, b, c, d, col, toward) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = d[0] - a[0];
  const vy = d[1] - a[1];
  const vz = d[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const L = Math.hypot(nx, ny, nz);
  if (L < 1e-12) return;
  nx /= L;
  ny /= L;
  nz /= L;
  let flip = false;
  if (toward && nx * toward[0] + ny * toward[1] + nz * toward[2] < 0) {
    flip = true;
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const v = T.pos.length / 3;
  for (const p of [a, b, c, d]) push(T, p[0], p[1], p[2], nx, ny, nz, col);
  if (flip) T.idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
  else T.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
}
// an oriented box: centre (x, z), bottom y0, top y1, u = unit along
// (ux, uz), half sizes hu (along) and hv (across)
export function orientedBox(T, x, z, y0, y1, ux, uz, hu, hv, col, { top = true } = {}) {
  const vx = -uz;
  const vz = ux;
  const c = [
    [x - ux * hu - vx * hv, z - uz * hu - vz * hv],
    [x + ux * hu - vx * hv, z + uz * hu - vz * hv],
    [x + ux * hu + vx * hv, z + uz * hu + vz * hv],
    [x - ux * hu + vx * hv, z - uz * hu + vz * hv],
  ];
  for (let k = 0; k < 4; k++) {
    const a = c[k];
    const b = c[(k + 1) % 4];
    const mx = (a[0] + b[0]) / 2 - x;
    const mz = (a[1] + b[1]) / 2 - z;
    quad(T, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], col, [mx, 0, mz]);
  }
  if (top) quad(T, [c[0][0], y1, c[0][1]], [c[1][0], y1, c[1][1]], [c[2][0], y1, c[2][1]], [c[3][0], y1, c[3][1]], col, [0, 1, 0]);
}

// per-point unit normals (left of travel, x east z south: (dz, -dx) is left)
function normals(pts) {
  const n = pts.length;
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    const L = Math.hypot(dx, dz) || 1;
    dx /= L;
    dz /= L;
    out[i * 2] = dz;
    out[i * 2 + 1] = -dx;
  }
  return out;
}

const SLAB_M = 1.3;
const PARAPET_M = 1.05;

// opts: { halfW (world), lift (world, the ribbon lift over y), col, pierCol,
//   style: 'beam' | 'arch', spacingM, keepOut: [[s0, s1], ...] no piers there,
//   rail: bool (open railings), abut: [bool, bool],
//   open(i, side) -> bool: no side wall or parapet on segment i, side 1 left / -1 right }
export function bridgeGeometry(T, pts, opts) {
  const n = pts.length;
  if (n < 2) return 0;
  const { halfW, lift = 0, col, pierCol = col, style = 'beam', keepOut = [], railing = false } = opts;
  const N = normals(pts);
  const slab = SLAB_M * M;
  const par = PARAPET_M * M;
  const parW = (railing ? 0.12 : 0.32) * M;
  const arch = style === 'arch';
  const tris0 = T.idx.length;
  // arch layout: spans between piers of 3 m, about 12 m each
  let spans = null;
  if (arch) {
    const L = pts[n - 1].s - pts[0].s;
    const k = Math.max(1, Math.round(L / (15 * M)));
    const span = L / k;
    spans = { s0: pts[0].s, span, pier: Math.min(3 * M, span * 0.25) };
  }
  const deckAt = (i) => pts[i].y + lift;
  // under-side height at point i (the bottom of the side wall)
  function bottom(i) {
    const p = pts[i];
    if (!arch) return deckAt(i) - slab;
    const u = (p.s - spans.s0) / spans.span;
    const k = Math.floor(u);
    const f = u - k; // 0..1 within the span
    const half = spans.pier / spans.span / 2;
    if (f < half || f > 1 - half) return p.g - 1 * M; // pier: solid to the ground
    // round arch between the piers, springing where it fits under the deck
    const t = (f - half) / (1 - 2 * half); // 0..1 across the opening
    const open = spans.span - spans.pier;
    const rise = Math.min(open / 2, Math.max(0.5 * M, deckAt(i) - p.g - 1.4 * M));
    const spring = deckAt(i) - 1.1 * M - rise;
    return Math.max(p.g - 1 * M, spring + rise * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)));
  }
  for (let i = 0; i + 1 < n; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const ya = deckAt(i);
    const yb = deckAt(i + 1);
    const ba = bottom(i);
    const bb = bottom(i + 1);
    for (const side of [1, -1]) {
      // no parapet where the edge runs onto another deck (two carriageways
      // on one structure, a slip road leaving the deck)
      if (opts.open && opts.open(i, side)) continue;
      const ex = side * halfW;
      const ox = side * (halfW + parW);
      // edge lines
      const aIn = [a.x + N[i * 2] * ex, a.z + N[i * 2 + 1] * ex];
      const bIn = [b.x + N[i * 2 + 2] * ex, b.z + N[i * 2 + 3] * ex];
      const aOut = [a.x + N[i * 2] * ox, a.z + N[i * 2 + 1] * ox];
      const bOut = [b.x + N[i * 2 + 2] * ox, b.z + N[i * 2 + 3] * ox];
      const outN = [N[i * 2] * side, 0, N[i * 2 + 1] * side];
      const inN = [-outN[0], 0, -outN[2]];
      // outer face: parapet top down to the slab bottom (or the arches)
      quad(T, [aOut[0], ya + par, aOut[1]], [bOut[0], yb + par, bOut[1]], [bOut[0], bb, bOut[1]], [aOut[0], ba, aOut[1]], col, outN);
      if (!railing) {
        // parapet: inner face and cap
        quad(T, [aIn[0], ya, aIn[1]], [bIn[0], yb, bIn[1]], [bIn[0], yb + par, bIn[1]], [aIn[0], ya + par, aIn[1]], col, inN);
        quad(T, [aIn[0], ya + par, aIn[1]], [bIn[0], yb + par, bIn[1]], [bOut[0], yb + par, bOut[1]], [aOut[0], ya + par, aOut[1]], col, [0, 1, 0]);
      } else {
        // a steel railing: a thin top rail and the posts' shadow line
        quad(T, [aIn[0], ya + par, aIn[1]], [bIn[0], yb + par, bIn[1]], [bIn[0], yb + par - 0.08 * M, bIn[1]], [aIn[0], ya + par - 0.08 * M, aIn[1]], col, inN);
      }
    }
    // soffit: the underside across the full width
    const L0 = [a.x + N[i * 2] * (halfW + parW), a.z + N[i * 2 + 1] * (halfW + parW)];
    const R0 = [a.x - N[i * 2] * (halfW + parW), a.z - N[i * 2 + 1] * (halfW + parW)];
    const L1 = [b.x + N[i * 2 + 2] * (halfW + parW), b.z + N[i * 2 + 3] * (halfW + parW)];
    const R1 = [b.x - N[i * 2 + 2] * (halfW + parW), b.z - N[i * 2 + 3] * (halfW + parW)];
    if (ba > a.g - 0.5 * M || bb > b.g - 0.5 * M) quad(T, [L0[0], ba, L0[1]], [L1[0], bb, L1[1]], [R1[0], bb, R1[1]], [R0[0], ba, R0[1]], pierCol, [0, -1, 0]);
  }
  if (!arch) {
    // piers every ~20 m (motorway decks 30 m) where the deck is high enough
    const spacing = (opts.spacingM || 20) * M;
    const len = pts[n - 1].s - pts[0].s;
    const count = Math.floor(len / spacing);
    const off = (len - count * spacing) / 2;
    const wide = halfW > 6.5 * M;
    let seg = 0;
    for (let k = 0; k <= count; k++) {
      const s = pts[0].s + off + k * spacing;
      if (s - pts[0].s < 4 * M || pts[n - 1].s - s < 4 * M) continue;
      if (keepOut.some(([s0, s1]) => s > s0 && s < s1)) continue;
      while (seg < n - 2 && pts[seg + 1].s < s) seg++;
      const a = pts[seg];
      const b = pts[seg + 1];
      const u = (s - a.s) / Math.max(1e-6, b.s - a.s);
      const x = a.x + (b.x - a.x) * u;
      const z = a.z + (b.z - a.z) * u;
      const y = a.y + (b.y - a.y) * u + lift;
      const gr = a.g + (b.g - a.g) * u;
      if (y - slab - gr < 2.2 * M) continue;
      let ux = b.x - a.x;
      let uz = b.z - a.z;
      const L = Math.hypot(ux, uz) || 1;
      ux /= L;
      uz /= L;
      if (wide) {
        // two round-ish columns under a wide deck, and a cap beam
        for (const sgn of [1, -1]) {
          const cx = x - uz * halfW * 0.5 * sgn;
          const cz = z + ux * halfW * 0.5 * sgn;
          orientedBox(T, cx, cz, gr - 1 * M, y - slab - 0.9 * M, ux, uz, 0.9 * M, 0.9 * M, pierCol, { top: false });
        }
        orientedBox(T, x, z, y - slab - 0.9 * M, y - slab, ux, uz, 0.8 * M, halfW * 0.85, pierCol);
      } else {
        orientedBox(T, x, z, gr - 1 * M, y - slab, ux, uz, 0.7 * M, Math.min(halfW * 0.8, 2.8 * M), pierCol, { top: false });
      }
    }
    // abutments where a raised end meets the ground
    for (const end of [0, n - 1]) {
      const p = pts[end];
      const q = pts[end === 0 ? 1 : n - 2];
      const y = p.y + lift;
      if (y - slab - p.g < 0.8 * M) continue;
      let ux = q.x - p.x;
      let uz = q.z - p.z;
      const L = Math.hypot(ux, uz) || 1;
      ux /= L;
      uz /= L;
      orientedBox(T, p.x + ux * 0.8 * M, p.z + uz * 0.8 * M, p.g - 1 * M, y - slab, ux, uz, 0.8 * M, halfW + parW, pierCol, { top: false });
    }
  }
  return (T.idx.length - tris0) / 3;
}

// p: { x, z, y, dx, dz } portal on the road (y: road surface), d: into the
// tunnel. opts: { halfW, col, dark, cap }
export function portalGeometry(T, p, { halfW, col, dark = [0.01, 0.01, 0.012], cap = col, hoodM = 11 }) {
  const { x, z, y, dx, dz } = p;
  const vx = -dz; // across
  const vz = dx;
  const H = 5.4 * M; // clear height
  const TOP = 7.4 * M; // head wall top
  const w = halfW + 0.6 * M;
  const t = 0.9 * M;
  const back = [-dx, 0, -dz];
  // head wall above the opening
  orientedBox(T, x - dx * t * 0.5, z - dz * t * 0.5, y + H, y + TOP, dx, dz, t * 0.5, w + 1.1 * M, col);
  // pilasters
  for (const sgn of [1, -1]) orientedBox(T, x - dx * t * 0.5 + vx * (w + 0.55 * M) * sgn, z - dz * t * 0.5 + vz * (w + 0.55 * M) * sgn, y - 0.6 * M, y + TOP, dx, dz, t * 0.5, 0.55 * M, col);
  // wing walls splaying out from the portal, falling toward the ends
  for (const sgn of [1, -1]) {
    const bx = x + vx * (w + 1.1 * M) * sgn;
    const bz = z + vz * (w + 1.1 * M) * sgn;
    const ex = bx - dx * 7 * M + vx * 3 * M * sgn;
    const ez = bz - dz * 7 * M + vz * 3 * M * sgn;
    const out = [vx * sgn - dx * 0.4, 0, vz * sgn - dz * 0.4];
    quad(T, [bx, y - 0.6 * M, bz], [ex, y - 0.6 * M, ez], [ex, y + 1 * M, ez], [bx, y + TOP, bz], col, out);
    quad(T, [bx, y - 0.6 * M, bz], [ex, y - 0.6 * M, ez], [ex, y + 1 * M, ez], [bx, y + TOP, bz], col, [-out[0], 0, -out[2]]);
    quad(T, [bx, y + TOP, bz], [ex, y + 1 * M, ez], [ex + vx * 0.5 * M * sgn, y + 1 * M, ez + vz * 0.5 * M * sgn], [bx + vx * 0.5 * M * sgn, y + TOP, bz + vz * 0.5 * M * sgn], cap, [0, 1, 0]);
  }
  // the dark mouth, a little way in
  const mx = x + dx * 0.6 * M;
  const mz = z + dz * 0.6 * M;
  const hood = hoodM * M;
  // hood: roof, walls; dark inside, the portal's stone outside, an earth cover
  const ex = x + dx * hood;
  const ez = z + dz * hood;
  const L0 = [x + vx * w, z + vz * w];
  const R0 = [x - vx * w, z - vz * w];
  const L1 = [ex + vx * w, ez + vz * w];
  const R1 = [ex - vx * w, ez - vz * w];
  quad(T, [L0[0], y + H, L0[1]], [L1[0], y + H, L1[1]], [R1[0], y + H, R1[1]], [R0[0], y + H, R0[1]], dark, [0, -1, 0]);
  quad(T, [L0[0], y - 0.2 * M, L0[1]], [L1[0], y - 0.2 * M, L1[1]], [L1[0], y + H, L1[1]], [L0[0], y + H, L0[1]], dark, [-vx, 0, -vz]);
  quad(T, [R0[0], y - 0.2 * M, R0[1]], [R1[0], y - 0.2 * M, R1[1]], [R1[0], y + H, R1[1]], [R0[0], y + H, R0[1]], dark, [vx, 0, vz]);
  // the far end of the hood: a black wall (the tunnel goes on in the dark)
  quad(T, [L1[0], y - 0.2 * M, L1[1]], [R1[0], y - 0.2 * M, R1[1]], [R1[0], y + H, R1[1]], [L1[0], y + H, L1[1]], dark, back);
  // the dark road surface inside the hood
  quad(T, [L0[0] + dx * 0.6 * M, y + 0.02 * M, L0[1] + dz * 0.6 * M], [L1[0], y + 0.02 * M, L1[1]], [R1[0], y + 0.02 * M, R1[1]], [R0[0] + dx * 0.6 * M, y + 0.02 * M, R0[1] + dz * 0.6 * M], dark, [0, 1, 0]);
  // outside of the hood: walls and an earth-and-grass cover
  const wo = w + 1.1 * M;
  const L0o = [x + vx * wo, z + vz * wo];
  const R0o = [x - vx * wo, z - vz * wo];
  const L1o = [ex + vx * wo, ez + vz * wo];
  const R1o = [ex - vx * wo, ez - vz * wo];
  quad(T, [L0o[0], y - 0.6 * M, L0o[1]], [L1o[0], y - 0.6 * M, L1o[1]], [L1o[0], y + TOP - 0.8 * M, L1o[1]], [L0o[0], y + TOP, L0o[1]], col, [vx, 0, vz]);
  quad(T, [R0o[0], y - 0.6 * M, R0o[1]], [R1o[0], y - 0.6 * M, R1o[1]], [R1o[0], y + TOP - 0.8 * M, R1o[1]], [R0o[0], y + TOP, R0o[1]], col, [-vx, 0, -vz]);
  quad(T, [L0o[0], y + TOP, L0o[1]], [L1o[0], y + TOP - 0.8 * M, L1o[1]], [R1o[0], y + TOP - 0.8 * M, R1o[1]], [R0o[0], y + TOP, R0o[1]], cap, [0, 1, 0]);
  quad(T, [L1o[0], y - 0.6 * M, L1o[1]], [R1o[0], y - 0.6 * M, R1o[1]], [R1o[0], y + TOP - 0.8 * M, R1o[1]], [L1o[0], y + TOP - 0.8 * M, L1o[1]], cap, [dx, 0, dz]);
  void mx;
  void mz;
}
