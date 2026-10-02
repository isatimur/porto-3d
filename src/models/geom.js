// 2D polygon helpers for metre-based authoring. DOM-free.
// Points are [x, z] pairs in the landmark's local frame (metres, +z = the
// main front, origin at the centre of the outline's box, y = 0 at the base).

export const TAU = Math.PI * 2;

export function bbox(pts) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const [x, z] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return { x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 };
}

export function area(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[(i + 1) % pts.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

export function centroid(pts) {
  if (pts.length < 3) {
    const n = pts.length || 1;
    return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
  }
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[(i + 1) % pts.length];
    const f = x0 * z1 - x1 * z0;
    a += f;
    cx += (x0 + x1) * f;
    cz += (z0 + z1) * f;
  }
  if (Math.abs(a) < 1e-9) return centroid(pts.slice(0, 2));
  return [cx / (3 * a), cz / (3 * a)];
}

export function inside(pts, x, z) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

// Drop repeated closing point and near-duplicate vertices.
export function clean(pts, eps = 0.05) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p);
  }
  if (out.length > 2 && Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) <= eps) out.pop();
  return out;
}

// Edges with length, unit direction, outward unit normal and the yaw that
// turns a Kit's local +z onto that normal (Kit.push({ ry })).
export function edges(pts) {
  const ccw = area(pts) > 0;
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const ex = (b[0] - a[0]) / len;
    const ez = (b[1] - a[1]) / len;
    // positive shoelace area = counter-clockwise in the (x, z) plane:
    // the outward normal is the right-hand side of the edge
    const nx = ccw ? ez : -ez;
    const nz = ccw ? -ex : ex;
    out.push({ a, b, len, ex, ez, nx, nz, mx: (a[0] + b[0]) / 2, mz: (a[1] + b[1]) / 2, ry: Math.atan2(nx, nz), i });
  }
  return out;
}

// Offset a simple polygon by d (positive = outward), mitred corners
// (clamped so spikes at sharp corners stay short).
export function offset(pts, d) {
  const E = edges(pts);
  const n = E.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const e0 = E[(i - 1 + n) % n];
    const e1 = E[i];
    let mx = e0.nx + e1.nx;
    let mz = e0.nz + e1.nz;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const cos = mx * e1.nx + mz * e1.nz;
    const k = d / Math.max(0.35, cos);
    out.push([e1.a[0] + mx * k, e1.a[1] + mz * k]);
  }
  return out;
}

// Rectangle as a polygon (centre, width along x, depth along z, turn a).
export function rect(cx, cz, w, d, a = 0) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => [cx + x * c + z * s, cz - x * s + z * c]);
}

// Oriented box of a point set along the direction of angle a (radians,
// measured like Kit ry: a = 0 is the local x axis).
export function obb(pts, a = null) {
  if (a == null) a = mainAngle(pts);
  const c = Math.cos(a);
  const s = Math.sin(a);
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const [x, z] of pts) {
    const u = x * c - z * s;
    const v = x * s + z * c;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  const cu = (u0 + u1) / 2;
  const cv = (v0 + v1) / 2;
  return { a, cx: cu * c + cv * s, cz: -cu * s + cv * c, L: u1 - u0, W: v1 - v0 };
}

// Direction of the longest edge (radians, Kit ry convention for local x).
export function mainAngle(pts) {
  let best = null;
  for (const e of edges(pts)) if (!best || e.len > best.len) best = e;
  return best ? Math.atan2(-best.ez, best.ex) : 0;
}

// Point at parameter t along a polyline.
export function along(line, t) {
  let total = 0;
  const seg = [];
  for (let i = 1; i < line.length; i++) {
    const l = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    seg.push(l);
    total += l;
  }
  let d = t * total;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) {
      const f = seg[i] ? Math.min(1, d / seg[i]) : 0;
      return [line[i][0] + (line[i + 1][0] - line[i][0]) * f, line[i][1] + (line[i + 1][1] - line[i][1]) * f];
    }
    d -= seg[i];
  }
  return line[0];
}

export function polyLength(line) {
  let t = 0;
  for (let i = 1; i < line.length; i++) t += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  return t;
}
