// Helpers for the metric (1:1 metre) builders: facades, cornices and roofs
// laid on real OSM polygons. Plan points are [x, z] in the landmark frame.
import { corniceProfile } from './kit.js';
import { win } from './parts.js';
import { edges, obb, offset, bbox } from './geom.js';

// Push a transform that sits on edge e (from geom.edges) at its midpoint,
// local +z = the outward normal, local x along the edge. Call k.pop() after.
export function onEdge(k, e, y = 0, out = 0) {
  return k.push({ x: e.mx + e.nx * out, y, z: e.mz + e.nz * out, ry: e.ry });
}

// Moulded cornice round a polygon at height y (every edge, mitred by
// overlap). prof: corniceProfile(kind, size).
export function polyCornice(k, pts, y, prof, color = 'granite', o = {}) {
  const out = Math.max(...prof.map((p) => p[0]));
  for (const e of edges(pts)) {
    if (o.minLen && e.len < o.minLen) continue;
    onEdge(k, e, y);
    k.cornice(e.len + out * 2, prof, color, 0, 0, 0, o);
    k.pop();
  }
  return k;
}

// Plain band (string course) round a polygon: a thin bevelled ring.
export function polyBand(k, pts, y, h, out, color = 'granite') {
  k.prism(offset(pts, out), y, h, color, { holes: [pts] });
  return k;
}

// Windows along every edge of a polygon (or the edges selected by o.only(e)).
// o: storeys [y...], bay (target bay width), w, h, per-storey overrides via
// o.storey(i) -> win options, skip(e, i, u) to leave a bay blank.
export function polyWindows(k, pts, o) {
  const bay = o.bay ?? 4;
  for (const e of edges(pts)) {
    if (e.len < (o.minLen ?? bay * 0.9)) continue;
    if (o.only && !o.only(e)) continue;
    const n = Math.max(1, Math.floor((e.len - (o.margin ?? 1)) / bay));
    const pitch = (e.len - (o.margin ?? 1)) / n;
    onEdge(k, e, 0, o.out ?? 0);
    for (let i = 0; i < n; i++) {
      const u = -((n - 1) * pitch) / 2 + i * pitch;
      o.storeys.forEach((y, s) => {
        if (o.skip && o.skip(e, i, s, n)) return;
        const so = o.storey ? o.storey(s, i, n, e) : {};
        win(k, u, y, so.w ?? o.w ?? 1.2, so.h ?? o.h ?? 2, 0, { bw: 0.25, depth: 0.25, ...o.win, ...so });
      });
    }
    k.pop();
  }
  return k;
}

// Roof over a polygon: the polygon's oriented box gets a hip or gable roof
// (ridge along the long side). kind: 'hip' | 'gable' | 'flat'.
export function roofOver(k, pts, y, rise, color = 'terracotta', kind = 'hip', o = {}) {
  const b = obb(pts, o.angle ?? null);
  if (kind === 'flat') {
    k.prism(pts, y, o.t ?? 0.4, o.flatColor ?? 'lead');
    return k;
  }
  k.push({ x: b.cx, z: b.cz, ry: b.a });
  if (kind === 'gable') k.gableRoof(b.W, b.L, rise, color, 0, y, 0, { ry: Math.PI / 2, over: o.over ?? 0.5 });
  else k.hipRoof(b.L, b.W, rise, color, 0, y, 0, { over: o.over ?? 0.5 });
  k.pop();
  return k;
}

// A plain rendered building on an OSM polygon (context parts such as
// hotels and houses on a site): walls, plinth, cornice, windows, roof.
export function plainBuilding(k, pts, h, o = {}) {
  const wall = o.wall ?? 'plaster';
  const trim = o.trim ?? 'granite';
  k.prism(pts, o.y ?? -1.5, h + 1.5 + (o.y ?? 0), wall);
  k.prism(offset(pts, 0.15), o.y ?? -1.5, 2.3, trim);
  polyCornice(k, pts, (o.y ?? 0) + h - 0.5, corniceProfile('eave', 0.5), trim);
  const storeys = [];
  for (let s = 0; s < Math.max(1, Math.round(h / 3.6)); s++) storeys.push((o.y ?? 0) + 1 + s * 3.4);
  if (o.windows !== false) polyWindows(k, pts, { storeys, bay: o.bay ?? 3.4, w: 1.1, h: 1.9, win: { trim, pane: 'glass', bw: 0.2, depth: 0.2 } });
  if (o.roof !== false) roofOver(k, pts, (o.y ?? 0) + h, o.rise ?? Math.min(4, bbox(pts).w * 0.25), o.roofColor ?? 'terracotta', o.roofKind ?? 'hip');
  return k;
}
