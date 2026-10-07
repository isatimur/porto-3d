// Parts for the Douro bridges (src/models/porto/ponte-*.js), 1:1 metres.
// DOM-free (node imports it). A bridge is authored in its own frame:
//   u = along the deck (metres, 0 = the middle), v = across, y = up,
// and mapped to the landmark frame by bridgeFrame().
//
// Members are open four-sided prisms (8 triangles: no end caps), so a 40k
// triangle budget carries about 5000 lattice members.
import * as THREE from 'three';
import { MAT } from './kit.js';
import { bbox } from './geom.js';

// Night lamps: aEmit >= 2 means "lit only at night, weight aEmit - 2"
// (landmarks.js multiplies it by the night uniform).
export const LAMP = (w = 1) => 2 + w;

export const IRON = { luis: 0x4c5865, mariaPia: 0x3d4650, steel: 0x8e979e, rail: 0x6a7077 };

// Where the bridge runs in the landmark frame: along the long side of the
// OSM outline. Returns the yaw for k.push, the length, and ground(u, v)
// (metres above the base) for footings and abutments.
export function bridgeFrame(site, defLen) {
  const fp = site && site.footprint;
  const outline = fp && Array.isArray(fp.outline) && fp.outline.length >= 3 ? fp.outline : null;
  let len = defLen;
  let alongZ = true;
  if (outline) {
    const b = bbox(outline);
    len = Math.max(b.w, b.d);
    alongZ = b.d >= b.w;
  }
  // builder x = u. ry = -90 deg sends +u to local +z; the local point is (-v, u).
  const ang = alongZ ? -Math.PI / 2 : 0;
  const ground = (u, v) => {
    if (!fp || !fp.ground) return 0;
    const g = alongZ ? fp.ground(-v, u) : fp.ground(u, v);
    return Number.isFinite(g) ? g : 0;
  };
  return { len, ang, ground };
}

// An open four-sided prism from p0 to p1: cross-section w (across the plane
// normal) x h (in the plane, perpendicular to the member).
export function rod(k, p0, p1, w, h, color, o = {}) {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const dz = p1[2] - p0[2];
  const hor = Math.hypot(dx, dz);
  const len = Math.hypot(hor, dy);
  if (len < 1e-4) return k;
  const g = new THREE.BoxGeometry(len + (o.ext ?? 0), h, w);
  g.setIndex(Array.from(g.index.array).slice(12)); // drop the two end faces
  const mat = o.mat ?? (typeof color === 'number' ? MAT.metal : undefined);
  return k.add(g, color, {
    flat: true,
    ...o,
    mat,
    ext: undefined,
    x: (p0[0] + p1[0]) / 2,
    y: (p0[1] + p1[1]) / 2,
    z: (p0[2] + p1[2]) / 2,
    ry: Math.atan2(-dz, dx),
    rz: Math.atan2(dy, hor),
    order: 'YZX',
  });
}

// A lattice truss in the plane v = z between a lower and an upper chord.
// lo(u), up(u): chord heights. n panels from u0 to u1. Members: both chords,
// a vertical at each node, and a diagonal per panel (x: crossed; warren:
// alternate directions). cw/ch: chord section (out of plane, in plane); ww/wh: web.
export function truss(k, o) {
  const { u0, u1, n, lo, up, z, color } = o;
  const cw = o.cw ?? 0.7;
  const ch = o.ch ?? 0.5;
  const ww = o.ww ?? 0.45;
  const wh = o.wh ?? 0.3;
  const du = (u1 - u0) / n;
  const mo = { mat: o.mat, emit: o.emit };
  let pl = [u0, lo(u0)];
  let pu = [u0, up(u0)];
  for (let i = 0; i <= n; i++) {
    const u = u0 + i * du;
    const yl = lo(u);
    const yu = up(u);
    if (!o.noVert || i === 0 || i === n) rod(k, [u, yl, z], [u, yu, z], ww, wh, color, mo);
    if (i > 0) {
      rod(k, [pl[0], pl[1], z], [u, yl, z], cw, ch, color, { ...mo, ext: 0.15 });
      rod(k, [pu[0], pu[1], z], [u, yu, z], cw, ch, color, { ...mo, ext: 0.15 });
      const a = u - du;
      const ya = lo(a);
      const yb = up(a);
      if (o.x) {
        rod(k, [a, ya, z], [u, yu, z], ww * 0.8, wh * 0.8, color, mo);
        rod(k, [a, yb, z], [u, yl, z], ww * 0.8, wh * 0.8, color, mo);
      } else if (i % 2) rod(k, [a, ya, z], [u, yu, z], ww, wh, color, mo);
      else rod(k, [a, yb, z], [u, yl, z], ww, wh, color, mo);
      pl = [u, yl];
      pu = [u, yu];
    }
  }
  return k;
}

// Railing: posts every `step` metres and rails, along u at (v, y).
export function railing(k, o) {
  const { u0, u1, v, y, h = 1.1, step = 2.4, color, rails = 2, w = 0.07 } = o;
  const n = Math.max(1, Math.round((u1 - u0) / step));
  for (let i = 0; i <= n; i++) {
    const u = u0 + (i * (u1 - u0)) / n;
    rod(k, [u, y, v], [u, y + h, v], w, w, color);
  }
  for (let r = 0; r < rails; r++) {
    const yy = y + h - (r * (h - 0.15)) / Math.max(1, rails);
    rod(k, [u0, yy, v], [u1, yy, v], w * 0.9, w * 0.9, color);
  }
  return k;
}

// Crook-top lamp post (cast-iron): post, an arm reaching over the roadway
// (dir = +1 / -1 along v), a lantern that glows at night.
export function crookLamp(k, u, v, y, o = {}) {
  const h = o.h ?? 5.4;
  const dir = o.dir ?? 1;
  const reach = o.reach ?? 1.5;
  const c = o.color ?? 0x2d3238;
  rod(k, [u, y, v], [u, y + h, v], 0.18, 0.18, c);
  rod(k, [u, y + h, v], [u, y + h + 0.5, v - dir * reach * 0.45], 0.1, 0.1, c);
  rod(k, [u, y + h + 0.5, v - dir * reach * 0.45], [u, y + h + 0.35, v - dir * reach], 0.1, 0.1, c);
  k.box(0.5, 0.22, 0.34, 0xfff1c8, u, y + h + 0.1, v - dir * reach, { emit: LAMP(1), mat: MAT.flat });
  return k;
}

// Mast for the overhead line (rail and metro): a thin post and a cantilever.
export function catenaryMast(k, u, v, y, o = {}) {
  const h = o.h ?? 6.4;
  const dir = o.dir ?? 1;
  const reach = o.reach ?? 2.4;
  const c = o.color ?? 0x7d858c;
  rod(k, [u, y, v], [u, y + h, v], 0.2, 0.2, c);
  rod(k, [u, y + h - 0.6, v], [u, y + h - 0.6, v - dir * reach], 0.1, 0.12, c);
  rod(k, [u, y + h - 0.2, v], [u, y + h - 0.6, v - dir * reach * 0.6], 0.07, 0.07, c);
  return k;
}

// Straight wire between two points (a contact wire, a stay).
export function wire(k, p0, p1, color = 0x30343a, t = 0.05) {
  return rod(k, p0, p1, t, t, color);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Smooth curve helpers.
export const parabola = (u, half, y0, rise) => y0 + rise * (1 - (u / half) * (u / half));
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
