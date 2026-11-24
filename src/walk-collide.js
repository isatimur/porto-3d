// Walk mode collision (src/walk.js). Pure geometry, no three.js: a grid
// index over building outlines and a mover that slides along walls.
//
// polys: outlines in world units, each [{x, z}] or [[x, z]], open or closed.
// cell: grid cell size in world units (8 = 32 m at 4 m per unit).

const X = (p) => (Array.isArray(p) ? p[0] : p.x);
const Z = (p) => (Array.isArray(p) ? p[1] : p.z);

// A gate (an arch over a street) blocks only at its two piers. outline: the
// gate's outline; open: the share of its long side that is the passage. The
// long side is the one across the street; returns two rectangles [[x, z], ...].
export function gatePiers(outline, open = 0.5) {
  // the direction of the longest edge, and the one across it
  let ux = 1, uz = 0, best = -1;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const dx = X(b) - X(a), dz = Z(b) - Z(a), d = Math.hypot(dx, dz);
    if (d > best) { best = d; ux = dx / d; uz = dz / d; }
  }
  const vx = -uz, vz = ux;
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const p of outline) {
    const a = X(p) * ux + Z(p) * uz, b = X(p) * vx + Z(p) * vz;
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
  }
  const pier = ((a1 - a0) * (1 - open)) / 2;
  const rect = (s0, s1) => [[s0, b0], [s1, b0], [s1, b1], [s0, b1]].map(([a, b]) => [a * ux + b * vx, a * uz + b * vz]);
  return [rect(a0, a0 + pier), rect(a1 - pier, a1)];
}

// also(x, z): an extra rule that blocks a point (walk mode: open water).
export function createCollider(polys, cell = 8, also = null) {
  const grid = new Map();
  const list = [];
  for (const src of polys || []) {
    if (!src || src.length < 3) continue;
    const xs = new Float64Array(src.length);
    const zs = new Float64Array(src.length);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < src.length; i++) {
      const x = X(src[i]), z = Z(src[i]);
      if (!Number.isFinite(x) || !Number.isFinite(z)) { x0 = NaN; break; }
      xs[i] = x; zs[i] = z;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    if (!Number.isFinite(x0)) continue;
    const id = list.push({ xs, zs, x0, x1, z0, z1 }) - 1;
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) {
      for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) {
        const key = i + ',' + j;
        let bucket = grid.get(key);
        if (!bucket) grid.set(key, (bucket = []));
        bucket.push(id);
      }
    }
  }

  function inPoly(p, x, z) {
    if (x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1) return false;
    let inside = false;
    const n = p.xs.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const zi = p.zs[i], zj = p.zs[j];
      if (zi > z !== zj > z && x < ((p.xs[j] - p.xs[i]) * (z - zi)) / (zj - zi) + p.xs[i]) inside = !inside;
    }
    return inside;
  }

  // the point is inside a building
  function inside(x, z) {
    const bucket = grid.get(Math.floor(x / cell) + ',' + Math.floor(z / cell));
    if (!bucket) return false;
    for (const id of bucket) if (inPoly(list[id], x, z)) return true;
    return false;
  }

  // a body of radius r at the point touches a building: the centre and
  // eight points on its rim
  const RIM = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];
  function blocked(x, z, r = 0) {
    if (inside(x, z) || (also && also(x, z))) return true;
    if (r > 0) for (const [cx, cz] of RIM) if (inside(x + cx * r, z + cz * r)) return true;
    return false;
  }

  // Move from (x, z) by (dx, dz). A blocked step slides along the wall, or
  // stays when no direction within 85 degrees is free. Long steps
  // are cut into pieces no longer than the radius, so a thin wall holds.
  const TURNS = [15, 30, 45, 60, 75, 85].map((d) => [Math.cos((d * Math.PI) / 180), Math.sin((d * Math.PI) / 180)]);
  function move(x, z, dx, dz, r = 0.1) {
    const len = Math.hypot(dx, dz);
    if (len === 0) return { x, z, hit: false };
    const parts = Math.max(1, Math.ceil(len / Math.max(r, 0.02)));
    const sx = dx / parts, sz = dz / parts;
    let hit = false;
    for (let i = 0; i < parts; i++) {
      if (!blocked(x + sx, z + sz, r)) { x += sx; z += sz; continue; }
      hit = true;
      // slide: the step turned away from the wall by the smallest angle that
      // is free, shortened to its share along that direction (a wall at any
      // angle, not only one along an axis)
      let slid = false;
      for (const [c, s] of TURNS) {
        for (const sg of [1, -1]) {
          const tx = (sx * c - sz * s * sg) * c, tz = (sz * c + sx * s * sg) * c;
          if (blocked(x + tx, z + tz, r)) continue;
          x += tx;
          z += tz;
          slid = true;
          break;
        }
        if (slid) break;
      }
      if (!slid) break;
    }
    return { x, z, hit };
  }

  // the free point nearest to (x, z), searched on rings out to maxR; null
  // when every tested point is blocked
  function freeNear(x, z, r = 0.1, maxR = 60, step = 0.5) {
    if (!blocked(x, z, r)) return { x, z };
    for (let d = step; d <= maxR; d += step) {
      const n = Math.max(8, Math.ceil((2 * Math.PI * d) / step));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 2 * Math.PI;
        const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
        if (!blocked(px, pz, r)) return { x: px, z: pz };
      }
    }
    return null;
  }

  return { inside, blocked, move, freeNear, count: list.length };
}
