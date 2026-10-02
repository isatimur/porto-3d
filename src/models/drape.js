// Draped ground pieces and cheap planting for the metric builders on
// sloping sites (parks, campuses, car parks). DOM-free.
// ground(x, z): the visible terrain in metres relative to the base (fit.js
// footprint.ground). Plan points are [x, z] in the landmark frame.
import * as THREE from 'three';
import { bbox, inside } from './geom.js';

// Sutherland-Hodgman: a (possibly concave) polygon clipped by an
// axis-aligned rectangle.
export function clipRect(poly, x0, z0, x1, z1) {
  let out = poly;
  const planes = [
    (p) => p[0] >= x0, (p) => p[0] <= x1, (p) => p[1] >= z0, (p) => p[1] <= z1,
  ];
  const cut = [
    (a, b) => { const t = (x0 - a[0]) / (b[0] - a[0]); return [x0, a[1] + (b[1] - a[1]) * t]; },
    (a, b) => { const t = (x1 - a[0]) / (b[0] - a[0]); return [x1, a[1] + (b[1] - a[1]) * t]; },
    (a, b) => { const t = (z0 - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, z0]; },
    (a, b) => { const t = (z1 - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, z1]; },
  ];
  for (let k = 0; k < 4; k++) {
    const src = out;
    out = [];
    if (!src.length) break;
    for (let i = 0; i < src.length; i++) {
      const a = src[i];
      const b = src[(i + 1) % src.length];
      const ia = planes[k](a);
      const ib = planes[k](b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut[k](a, b));
    }
  }
  return out;
}

// A polygon laid on the terrain: cut into cells of `cell` metres, every
// vertex at ground + lift. o.holes: polygons left out (a cell piece whose
// centre falls in a hole is dropped); o.level(x, z): override the height.
export function drapePoly(k, poly, ground, lift, color, o = {}) {
  const cell = o.cell ?? 8;
  const b = bbox(poly);
  const pos = [];
  const yAt = o.level ?? ((x, z) => ground(x, z) + lift);
  for (let x = b.x0; x < b.x1; x += cell) {
    for (let z = b.z0; z < b.z1; z += cell) {
      const piece = clipRect(poly, x, z, Math.min(x + cell, b.x1), Math.min(z + cell, b.z1));
      if (piece.length < 3) continue;
      const v = piece.map(([px, pz]) => new THREE.Vector2(px, pz));
      if (Math.abs(THREE.ShapeUtils.area(v)) < 0.05) continue;
      let faces;
      try {
        faces = THREE.ShapeUtils.triangulateShape(v, []);
      } catch {
        continue;
      }
      for (const f of faces) {
        const t = f.map((i) => piece[i]);
        const cx = (t[0][0] + t[1][0] + t[2][0]) / 3;
        const cz = (t[0][1] + t[1][1] + t[2][1]) / 3;
        if (o.holes && o.holes.some((h) => inside(h, cx, cz))) continue;
        // wind every triangle counter-clockwise seen from above (normal up)
        const cr = (t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[1][1] - t[0][1]) * (t[2][0] - t[0][0]);
        const tri = cr < 0 ? t : [t[0], t[2], t[1]];
        for (const [px, pz] of tri) pos.push(px, yAt(px, pz), pz);
      }
    }
  }
  if (!pos.length) return k;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  return k.add(g, color, { flat: true, ...o, holes: undefined, level: undefined, cell: undefined });
}

// A ribbon of width w along a polyline, draped (vertex every `step` m).
// o.keep(x, z): drop the stretches where it returns false (outside a park).
export function ribbon(k, line, w, ground, lift, color, o = {}) {
  const step = o.step ?? 4;
  const pts = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(L / step));
    for (let j = i === 1 ? 0 : 1; j <= n; j++) pts.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  if (pts.length < 2) return k;
  const pos = [];
  const side = (i) => {
    const a = pts[Math.max(0, i - 1)];
    const c = pts[Math.min(pts.length - 1, i + 1)];
    let dx = c[0] - a[0];
    let dz = c[1] - a[1];
    const L = Math.hypot(dx, dz) || 1;
    dx /= L;
    dz /= L;
    const p = pts[i];
    const l = [p[0] - dz * (w / 2), p[1] + dx * (w / 2)];
    const r = [p[0] + dz * (w / 2), p[1] - dx * (w / 2)];
    return [l, r].map(([x, z]) => [x, ground(x, z) + lift, z]);
  };
  const S = pts.map((_, i) => side(i));
  for (let i = 0; i < pts.length - 1; i++) {
    if (o.keep && (!o.keep(pts[i][0], pts[i][1]) || !o.keep(pts[i + 1][0], pts[i + 1][1]))) continue;
    const [l0, r0] = S[i];
    const [l1, r1] = S[i + 1];
    // up-facing: (l0, r0, r1), (l0, r1, l1) wound so the normal points up
    const up = (a, b, c) => {
      const cr = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
      return cr < 0 ? [a, b, c] : [a, c, b];
    };
    for (const t of [up(l0, r0, r1), up(l0, r1, l1)]) for (const v of t) pos.push(...v);
  }
  if (!pos.length) return k;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  return k.add(g, color, { flat: true, ...o, keep: undefined, step: undefined });
}

// Cheap broadleaf (plane, lime, oak): a four-sided trunk and one or two
// soft crowns, about 32..52 triangles. h = total height.
export function lowTree(k, x, y, z, h, o = {}) {
  const rnd = k.rnd;
  const leaf = o.color ?? (rnd() > 0.5 ? 'foliage' : 'foliageDark');
  const r = h * (o.spread ?? 0.3);
  const bole = h * (o.bole ?? 0.42);
  k.cyl(h * 0.018, h * 0.028, bole + r * 0.4, 4, 'trunk', x, y, z);
  const cy = y + bole + r * 0.75;
  k.ico(r, 0, leaf, x, cy, z, { jitter: 0.22, sy: o.sy ?? 0.9, soft: true, ry: rnd() * 6 });
  if (o.lobes !== 1) {
    const a = rnd() * Math.PI * 2;
    k.ico(r * 0.72, 0, leaf, x + Math.cos(a) * r * 0.55, cy + r * 0.3, z + Math.sin(a) * r * 0.55, { jitter: 0.22, sy: 0.85, soft: true, ry: rnd() * 6 });
  }
  return k;
}

// Conifer (cedar, sequoia, cypress): trunk and two stacked cones, ~40 tris.
export function lowConifer(k, x, y, z, h, o = {}) {
  const leaf = o.color ?? 'foliageDark';
  const r = h * (o.spread ?? 0.16);
  k.cyl(h * 0.016, h * 0.03, h * 0.3, 4, o.trunk ?? 'trunk', x, y, z);
  k.cone(r, h * 0.62, 6, leaf, x, y + h * 0.18, z, { ry: k.rnd() });
  k.cone(r * 0.7, h * 0.45, 6, leaf, x, y + h * 0.55, z, { ry: k.rnd() });
  return k;
}
