// Geometry vocabulary for the landmark miniatures. DOM-free (node imports it).
//
// Every part is appended to one list and merged into a single non-indexed
// BufferGeometry with these attributes:
//   position, normal  - model space; y = 0 is the ground line, front faces +z
//   color             - linear albedo from PALETTE, jittered per part
//   aEmit             - 0..1 emissive weight (gold, water, lit windows)
//   aMat              - surface id for the detail shader (see MAT)
//   aUv               - wall-aligned coordinates in world units, baked in build()
// Glass parts go to a separate position/normal geometry (userData.glass).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const PALETTE = {
  granite: 0xb2aa98,
  graniteDark: 0x857e72,
  graniteLight: 0xcdc5b2,
  graniteWarm: 0xc6b597,
  graniteGrey: 0x8f9291,
  graniteGold: 0xc4a574, // the golden granite of the Pópulo front (photos)
  plaster: 0xf0ebe0,
  cream: 0xe9dcb4,
  ochre: 0xe3cf88,
  rose: 0xb07a70,
  maroon: 0x6a2c28,
  wood: 0x4f3a2e,
  terracotta: 0xa9583d,
  slate: 0x4a4c54,
  lead: 0x6c7479,
  gold: 0xe3ab4a,
  bronze: 0x6f5a3a,
  hedge: 0x3f5e33,
  grass: 0x66823f,
  foliage: 0x4f7a37,
  foliageDark: 0x3b5f2c,
  flowerRed: 0xa8463e,
  flowerYellow: 0xc9a647,
  flowerPink: 0xb56a88,
  trunk: 0x57504a,
  water: 0x4a7f9a,
  azulejo: 0xf6f6f6,
  doorBlue: 0x3e48a6, // the Raio doors are this blue in the photos
  glass: 0x27404f,
  window: 0xf3c877,
  dark: 0x221e1b,
  iron: 0x2c2d30,
  lampGreen: 0x2f4a3a,
  earth: 0x8a6f52,
  sand: 0xcbb793,
  brick: 0xa8654a,
  rust: 0x7a4a2e,
  steel: 0x9aa2a8,
  seat: 0x8f9695,
  white: 0xfaf8f2,
};

// Surface ids for the detail shader in landmarks.js.
export const MAT = { flat: 0, ashlar: 1, tile: 2, render: 3, azulejo: 4, leaf: 5, slate: 6, water: 7, smooth: 8, metal: 9 };

const MAT_OF = {
  granite: MAT.ashlar, graniteDark: MAT.ashlar, graniteLight: MAT.ashlar, graniteWarm: MAT.ashlar, graniteGrey: MAT.ashlar, graniteGold: MAT.ashlar,
  plaster: MAT.render, cream: MAT.render, ochre: MAT.render, rose: MAT.render, white: MAT.render,
  terracotta: MAT.tile, slate: MAT.slate, lead: MAT.slate, maroon: MAT.smooth, wood: MAT.smooth,
  azulejo: MAT.azulejo,
  hedge: MAT.leaf, grass: MAT.leaf, foliage: MAT.leaf, foliageDark: MAT.leaf,
  flowerRed: MAT.leaf, flowerYellow: MAT.leaf, flowerPink: MAT.leaf,
  water: MAT.water, gold: MAT.metal, bronze: MAT.metal, iron: MAT.metal, steel: MAT.metal, lampGreen: MAT.metal,
  earth: MAT.smooth, sand: MAT.smooth, trunk: MAT.smooth, brick: MAT.ashlar, rust: MAT.smooth,
};

// Emissive weight per palette key. Anything not listed is 0.
const EMIT = { gold: 0.42, water: 0.22, window: 0.85, glass: 0.12 };

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

function composeM(o) {
  _e.set(o.rx || 0, o.ry || 0, o.rz || 0, o.order || 'XYZ');
  _q.setFromEuler(_e);
  const s = o.s ?? 1;
  _s.set((o.sx ?? 1) * s, (o.sy ?? 1) * s, (o.sz ?? 1) * s);
  _p.set(o.x || 0, o.y || 0, o.z || 0);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

// ------------------------------------------------------------ 2D outlines

// Round-headed opening: straight jambs, semicircular head. y0 = sill.
export function archPath(p, cx, y0, w, h, seg = 8) {
  const r = w / 2;
  const spring = y0 + Math.max(0, h - r);
  p.moveTo(cx - r, y0);
  p.lineTo(cx + r, y0);
  p.lineTo(cx + r, spring);
  p.absarc(cx, spring, r, 0, Math.PI, false);
  p.lineTo(cx - r, y0);
  return p;
}

// Segmental (flat-arched) opening: rise is the height of the arc.
export function segArchPath(p, cx, y0, w, h, rise, seg = 6) {
  const r = w / 2;
  p.moveTo(cx - r, y0);
  p.lineTo(cx + r, y0);
  p.lineTo(cx + r, y0 + h - rise);
  for (let i = 1; i < seg; i++) {
    const t = i / seg;
    const x = cx + r - t * w;
    const u = (x - cx) / r;
    p.lineTo(x, y0 + h - rise + rise * (1 - u * u));
  }
  p.lineTo(cx - r, y0 + h - rise);
  p.lineTo(cx - r, y0);
  return p;
}

// Pointed (Gothic) arch.
export function pointedPath(p, cx, y0, w, h, seg = 5) {
  const r = w / 2;
  const spring = y0 + Math.max(0, h - w * 0.85);
  const top = y0 + h;
  p.moveTo(cx - r, y0);
  p.lineTo(cx + r, y0);
  p.lineTo(cx + r, spring);
  for (let i = 1; i <= seg; i++) {
    const t = i / seg;
    const a = t * Math.PI * 0.5;
    p.lineTo(cx + r - r * (1 - Math.cos(a)), spring + (top - spring) * Math.sin(a));
  }
  for (let i = seg - 1; i >= 0; i--) {
    const t = i / seg;
    const a = t * Math.PI * 0.5;
    p.lineTo(cx - r + r * (1 - Math.cos(a)), spring + (top - spring) * Math.sin(a));
  }
  p.lineTo(cx - r, y0);
  return p;
}

export function rectPath(p, x0, y0, x1, y1) {
  p.moveTo(x0, y0);
  p.lineTo(x1, y0);
  p.lineTo(x1, y1);
  p.lineTo(x0, y1);
  p.lineTo(x0, y0);
  return p;
}

function holePath(h, P = THREE.Path) {
  const p = new P();
  const kind = h.arch || 'rect';
  if (kind === 'round') archPath(p, h.x, h.y, h.w, h.h, h.seg ?? 8);
  else if (kind === 'seg') segArchPath(p, h.x, h.y, h.w, h.h, h.rise ?? h.w * 0.18);
  else if (kind === 'pointed') pointedPath(p, h.x, h.y, h.w, h.h);
  else rectPath(p, h.x - h.w / 2, h.y, h.x + h.w / 2, h.y + h.h);
  return p;
}

// Profiles for lathes, [radius, y] from bottom to top, unit height.
export const PROFILES = {
  baluster: [[0, 0], [0.32, 0], [0.32, 0.1], [0.2, 0.16], [0.36, 0.42], [0.3, 0.55], [0.13, 0.72], [0.18, 0.82], [0.3, 0.88], [0.3, 1], [0, 1]],
  urn: [[0, 0], [0.26, 0], [0.26, 0.08], [0.12, 0.14], [0.14, 0.2], [0.34, 0.42], [0.3, 0.6], [0.14, 0.7], [0.2, 0.74], [0.08, 0.84], [0.1, 0.9], [0, 1]],
  finial: [[0, 0], [0.3, 0], [0.3, 0.12], [0.16, 0.18], [0.36, 0.42], [0.2, 0.62], [0.08, 0.7], [0.14, 0.78], [0.02, 1], [0, 1]],
  onion: [[0, 0], [0.98, 0], [1.02, 0.08], [0.9, 0.22], [0.62, 0.42], [0.36, 0.56], [0.22, 0.66], [0.26, 0.74], [0.12, 0.84], [0.06, 1], [0, 1]],
  bellCap: [[0, 0], [1, 0], [1, 0.1], [0.9, 0.16], [0.95, 0.34], [0.72, 0.62], [0.42, 0.8], [0.24, 0.86], [0.28, 0.92], [0, 1]],
  statue: [[0, 0], [0.2, 0], [0.2, 0.1], [0.17, 0.4], [0.13, 0.64], [0.16, 0.72], [0.07, 0.8], [0.09, 0.9], [0, 1]],
  // robed figure without the head: hem, knees, waist, chest, shoulders, neck
  figure: [[0, 0], [0.17, 0], [0.15, 0.3], [0.115, 0.56], [0.14, 0.76], [0.05, 0.81], [0.035, 0.84], [0, 0.84]],
  column: [[0, 0], [1.4, 0], [1.4, 0.04], [1.2, 0.06], [1.08, 0.09], [1.0, 0.11], [0.88, 0.88], [1.02, 0.9], [1.02, 0.92], [1.35, 0.95], [1.45, 1], [0, 1]],
  basin: [[0, 0], [0.3, 0], [0.2, 0.35], [0.22, 0.55], [0.95, 0.66], [1, 1], [0.9, 1], [0, 0.88]],
  lamp: [[0, 0], [0.5, 0], [0.5, 0.06], [0.2, 0.1], [0.14, 0.18], [0.1, 0.7], [0.14, 0.72], [0.1, 0.76], [0, 0.76]],
  obelisk: [[0, 0], [1, 0], [1, 0.14], [0.8, 0.18], [0.62, 0.2], [0.48, 0.88], [0.26, 0.92], [0.34, 0.96], [0, 1]],
};

// ------------------------------------------------------------------ Kit

export class Kit {
  constructor(seed = 1) {
    this.parts = [];
    this.glassParts = [];
    this.rnd = mulberry32(seed);
    this.stack = [new THREE.Matrix4()];
  }

  // Transform stack: push({x, y, z, ry, s}) ... pop().
  push(o) {
    this.stack.push(this.top().clone().multiply(composeM(o)));
    return this;
  }

  pop() {
    this.stack.pop();
    return this;
  }

  top() {
    return this.stack[this.stack.length - 1];
  }

  add(geo, color, o = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    if (o.flat || !g.attributes.normal) {
      if (g.attributes.normal) g.deleteAttribute('normal');
      g.computeVertexNormals();
    }
    g.applyMatrix4(this.top().clone().multiply(composeM(o)));

    if (o.glass) {
      this.glassParts.push(g);
      return this;
    }
    const n = g.attributes.position.count;
    _c.set(PALETTE[color] ?? color);
    const j = 1 + (this.rnd() - 0.5) * 2 * (o.jit ?? 0.03);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r * j;
      col[i * 3 + 1] = _c.g * j;
      col[i * 3 + 2] = _c.b * j;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aEmit', new THREE.BufferAttribute(new Float32Array(n).fill(o.emit ?? EMIT[color] ?? 0), 1));
    g.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(n).fill(o.mat ?? MAT_OF[color] ?? MAT.flat), 1));
    this.parts.push(g);
    return this;
  }

  // ---------------------------------------------------------- primitives

  // Box whose base sits at y.
  box(w, h, d, color, x = 0, y = 0, z = 0, o = {}) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, { ...o, x, y: y + h / 2, z });
  }

  // Cylinder or frustum whose base sits at y. Low segment counts are faceted.
  cyl(rTop, rBot, h, seg, color, x = 0, y = 0, z = 0, o = {}) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, !!o.open, o.t0 ?? 0, o.tl ?? Math.PI * 2);
    if (seg === 4) g.rotateY(Math.PI / 4);
    return this.add(g, color, { flat: seg <= 8 && !o.smooth, ...o, x, y: y + h / 2, z });
  }

  cone(r, h, seg, color, x = 0, y = 0, z = 0, o = {}) {
    const g = new THREE.ConeGeometry(r, h, seg);
    if (seg === 4) g.rotateY(Math.PI / 4);
    return this.add(g, color, { flat: seg <= 8 && !o.smooth, ...o, x, y: y + h / 2, z });
  }

  sphere(r, color, x = 0, y = 0, z = 0, o = {}) {
    const g = new THREE.SphereGeometry(r, o.seg ?? 10, o.rings ?? 7, 0, Math.PI * 2, 0, o.tl ?? Math.PI);
    return this.add(g, color, { ...o, x, y, z });
  }

  // Hemisphere whose base sits at y.
  dome(r, color, x = 0, y = 0, z = 0, o = {}) {
    return this.sphere(r, color, x, y, z, { seg: 16, rings: 6, ...o, tl: Math.PI / 2 });
  }

  ico(r, detail, color, x = 0, y = 0, z = 0, o = {}) {
    const g = new THREE.IcosahedronGeometry(r, detail);
    if (o.jitter) {
      const p = g.attributes.position;
      // IcosahedronGeometry is non-indexed: displace shared corners together.
      const key = (i) => `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      const off = new Map();
      for (let i = 0; i < p.count; i++) {
        const kk = key(i);
        if (!off.has(kk)) off.set(kk, 1 + (this.rnd() - 0.5) * 2 * o.jitter);
        const f = off.get(kk);
        p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f);
      }
    }
    this.add(g, color, { flat: !o.soft, ...o, x, y, z });
    if (o.soft) {
      // foliage: radial normals (a soft round crown instead of a cut gem)
      // and a darker underside (self-shade), baked into the part
      const part = this.parts[this.parts.length - 1];
      const P = part.attributes.position;
      const N = part.attributes.normal;
      const C = part.attributes.color;
      const m = this.top().clone().multiply(composeM({ ...o, x, y, z }));
      const c = new THREE.Vector3().setFromMatrixPosition(m);
      const rr = r * (o.sy ?? 1);
      for (let i = 0; i < P.count; i++) {
        _p.fromBufferAttribute(P, i);
        const f = THREE.MathUtils.clamp((_p.y - c.y) / (rr || 1), -1, 1);
        _p.sub(c);
        _p.y /= (o.sy ?? 1) * (o.sy ?? 1); // ellipsoid normal
        _p.normalize();
        _s.fromBufferAttribute(N, i);
        _s.lerp(_p, 0.75).normalize();
        N.setXYZ(i, _s.x, _s.y, _s.z);
        const k = 0.72 + 0.34 * (f * 0.5 + 0.5);
        C.setXYZ(i, C.getX(i) * k, C.getY(i) * k, C.getZ(i) * k);
      }
    }
    return this;
  }

  // Surface of revolution. profile: [[r, y], ...] bottom to top.
  lathe(profile, seg, color, x = 0, y = 0, z = 0, o = {}) {
    const sr = o.sr ?? 1;
    const sh = o.sh ?? 1;
    const pts = profile.map(([r, yy]) => new THREE.Vector2(Math.max(r * sr, 1e-4), yy * sh));
    return this.add(new THREE.LatheGeometry(pts, seg), color, { flat: seg <= 6 && !o.smooth, ...o, x, y, z });
  }

  // Extrude a Shape (XY plane) along z, centred on z. Optional bevel.
  extrude(shape, depth, color, x = 0, y = 0, z = 0, o = {}) {
    const b = o.bevel;
    const g = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: !!b,
      bevelSize: b ? b : 0,
      bevelThickness: b ? b : 0,
      bevelSegments: 1,
      curveSegments: o.curve ?? 8,
    });
    g.translate(0, 0, -depth / 2);
    return this.add(g, color, { flat: true, ...o, x, y, z });
  }

  // Flat shape facing +z (panes, discs, inlays).
  plane(shape, color, x = 0, y = 0, z = 0, o = {}) {
    return this.add(new THREE.ShapeGeometry(shape, o.curve ?? 8), color, { ...o, x, y, z });
  }

  // Truncated box: bottom wb x db, top wt x dt, base at y.
  frustum(wb, db, wt, dt, h, color, x = 0, y = 0, z = 0, o = {}) {
    const B = [[-wb / 2, 0, db / 2], [wb / 2, 0, db / 2], [wb / 2, 0, -db / 2], [-wb / 2, 0, -db / 2]];
    const T = [[-wt / 2, h, dt / 2], [wt / 2, h, dt / 2], [wt / 2, h, -dt / 2], [-wt / 2, h, -dt / 2]];
    const tri = [];
    const quad = (a, b, c, d) => tri.push(a, b, c, a, c, d);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      quad(B[i], B[j], T[j], T[i]);
    }
    if (wt > 1e-4 || dt > 1e-4) quad(T[0], T[1], T[2], T[3]);
    if (!o.noBottom) quad(B[3], B[2], B[1], B[0]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tri.flat()), 3));
    return this.add(g, color, { ...o, flat: true, x, y, z });
  }

  // Hip roof over w x d (ridge along the longer side), base at y.
  hipRoof(w, d, rise, color = 'terracotta', x = 0, y = 0, z = 0, o = {}) {
    const ov = o.over ?? 0.8;
    const W = w + 2 * ov;
    const D = d + 2 * ov;
    const r = rise * (1 + (2 * ov) / Math.min(w, d));
    const alongX = W >= D;
    const half = Math.abs(W - D) / 2;
    const a = alongX ? [[-half, r, 0], [half, r, 0]] : [[0, r, -half], [0, r, half]];
    const c = [[-W / 2, 0, D / 2], [W / 2, 0, D / 2], [W / 2, 0, -D / 2], [-W / 2, 0, -D / 2]];
    const tri = [];
    const [r0, r1] = a;
    if (alongX) {
      tri.push(c[0], c[1], r1, c[0], r1, r0); // front
      tri.push(c[2], c[3], r0, c[2], r0, r1); // back
      tri.push(c[1], c[2], r1); // right
      tri.push(c[3], c[0], r0); // left
    } else {
      tri.push(c[0], c[1], r1); // front
      tri.push(c[2], c[3], r0); // back
      tri.push(c[1], c[2], r0, c[1], r0, r1); // right
      tri.push(c[3], c[0], r1, c[3], r1, r0); // left
    }
    tri.push(c[3], c[2], c[1], c[3], c[1], c[0]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tri.flat()), 3));
    // eaves overhang below y so the ridge stays at y + rise
    return this.add(g, color, { ...o, flat: true, x, y: y - (r - rise), z });
  }

  // Gable roof: ridge along z, width w, length d, base at y. Overhangs included.
  gableRoof(w, d, rise, color = 'terracotta', x = 0, y = 0, z = 0, o = {}) {
    const ov = o.over ?? 0.8;
    const W = w + 2 * ov;
    const R = rise * (W / w);
    const s = new THREE.Shape();
    s.moveTo(-W / 2, 0);
    s.lineTo(W / 2, 0);
    s.lineTo(0, R);
    s.closePath();
    this.extrude(s, d + 2 * (o.overEnd ?? ov * 0.6), color, x, y - (R - rise), z, o);
    if (o.ridge !== false) this.box(0.5, 0.35, d + 2 * (o.overEnd ?? ov * 0.6), color, x, y + rise - 0.05, z, { ry: o.ry || 0 });
    return this;
  }

  // Straight flight of n steps climbing toward -z. Solid down to y.
  stairs(width, run, rise, n, color, x = 0, y = 0, z = 0, o = {}) {
    const s = new THREE.Shape();
    const sr = run / n;
    const sh = rise / n;
    const base = -(o.below ?? 0);
    s.moveTo(0, base);
    s.lineTo(0, sh);
    for (let i = 0; i < n; i++) {
      s.lineTo(i * sr + sr, (i + 1) * sh);
      if (i < n - 1) s.lineTo(i * sr + sr, (i + 2) * sh);
    }
    s.lineTo(run, base);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false });
    g.translate(0, 0, -width / 2);
    g.rotateY(Math.PI / 2); // shape x -> -z, extrusion -> x
    g.translate(0, 0, run / 2);
    return this.add(g, color, { flat: true, ...o, x, y, z });
  }

  // ------------------------------------------------------ architecture

  // Wall slab (width w, height h, thickness t, front face at z + t/2) with
  // real openings. holes: [{x, y, w, h, arch, pane, emit, inset}]. Each hole
  // gets a pane recessed by `inset` behind the front face, unless pane is null.
  wall(w, h, t, color, holes = [], x = 0, y = 0, z = 0, o = {}) {
    const s = new THREE.Shape();
    rectPath(s, -w / 2, 0, w / 2, h);
    for (const hh of holes) s.holes.push(holePath(hh));
    this.extrude(s, t, color, x, y, z, { ...o, curve: 8 });
    for (const hh of holes) {
      const pane = hh.pane === undefined ? o.pane ?? 'glass' : hh.pane;
      if (!pane) continue;
      const inset = hh.inset ?? o.inset ?? Math.min(t * 0.8, 0.9);
      this.push({ x, y, z, ry: o.ry || 0 });
      this.plane(holePath(hh, THREE.Shape), pane, 0, 0, t / 2 - inset, { emit: hh.emit, mat: MAT.flat });
      this.pop();
    }
    return this;
  }

  // Wall with n openings that reach the ground (arcades, gates). One
  // contour, no holes. Openings: width ow, height oh, 'round' or 'pointed'.
  arcade(w, h, t, n, ow, oh, color, x = 0, y = 0, z = 0, o = {}) {
    const ops = [];
    for (let i = 0; i < n; i++) ops.push({ x: -w / 2 + (w / n) * (i + 0.5), w: ow, h: oh, pointed: o.pointed });
    return this.gate(w, h, t, ops, color, x, y, z, o);
  }

  // Wall with explicit ground-level openings [{x, w, h, pointed}], left to right.
  gate(w, h, t, ops, color, x = 0, y = 0, z = 0, o = {}) {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    for (const op of ops) {
      const cx = op.x;
      const ow = op.w;
      const oh = op.h;
      const r = ow / 2;
      s.lineTo(cx - r, 0);
      if (op.pointed) {
        const spring = oh - ow * 0.85;
        s.lineTo(cx - r, spring);
        for (let j = 1; j <= 5; j++) {
          const a = (j / 5) * Math.PI * 0.5;
          s.lineTo(cx - r + r * (1 - Math.cos(a)), spring + (oh - spring) * Math.sin(a));
        }
        for (let j = 4; j >= 0; j--) {
          const a = (j / 5) * Math.PI * 0.5;
          s.lineTo(cx + r - r * (1 - Math.cos(a)), spring + (oh - spring) * Math.sin(a));
        }
      } else {
        s.lineTo(cx - r, oh - r);
        s.absarc(cx, oh - r, r, Math.PI, 0, true);
      }
      s.lineTo(cx + r, 0);
    }
    s.lineTo(w / 2, 0);
    s.lineTo(w / 2, h);
    s.lineTo(-w / 2, h);
    s.closePath();
    return this.extrude(s, t, color, x, y, z, { curve: 8, ...o });
  }

  // Raised surround around an opening (sits proud of a wall face at z).
  surround(hh, bw, depth, color, z = 0, o = {}) {
    const outer = { ...hh, x: hh.x, y: hh.y - (o.sill ? bw : 0), w: hh.w + 2 * bw, h: hh.h + bw + (o.sill ? bw : 0) };
    const s = holePath({ ...outer, seg: 6 }, THREE.Shape);
    s.holes.push(holePath({ ...hh, seg: 6 }));
    this.extrude(s, depth, color, 0, 0, z + depth / 2, { curve: 6, ...o });
    return this;
  }

  // Moulded cornice of length len along x, profile [[out, y]], back face at z.
  cornice(len, prof, color, x = 0, y = 0, z = 0, o = {}) {
    const pts = [[0, prof[0][1]], ...prof, [0, prof[prof.length - 1][1]]].filter(
      (p, i, a) => i === 0 || Math.abs(p[0] - a[i - 1][0]) + Math.abs(p[1] - a[i - 1][1]) > 1e-5,
    );
    if (pts.length > 2 && Math.abs(pts[0][0] - pts.at(-1)[0]) + Math.abs(pts[0][1] - pts.at(-1)[1]) < 1e-5) pts.pop();
    const s = new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b)));
    const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, curveSegments: 4 });
    g.translate(0, 0, -len / 2);
    g.rotateY(-Math.PI / 2); // profile out -> +z, length -> x
    return this.add(g, color, { flat: true, ...o, x, y, z });
  }

  // Cornice around a w x d rectangle centred at (x, z), at height y.
  corniceRing(w, d, prof, color, x = 0, y = 0, z = 0, o = {}) {
    const out = Math.max(...prof.map((p) => p[0]));
    const sides = [
      [0, d / 2, 0, w + 2 * out],
      [0, -d / 2, Math.PI, w + 2 * out],
      [w / 2, 0, Math.PI / 2, d + 2 * out],
      [-w / 2, 0, -Math.PI / 2, d + 2 * out],
    ];
    for (const [sx, sz, ry, len] of sides) {
      if (o.skip && o.skip.includes(ry)) continue;
      this.push({ x: x + sx, y, z: z + sz, ry });
      this.cornice(len, prof, color, 0, 0, 0, o);
      this.pop();
    }
    return this;
  }

  // Row of balusters between a plinth and a rail, along x, centred at x.
  balustrade(len, h, color, x = 0, y = 0, z = 0, o = {}) {
    const sp = o.sp ?? h * 0.42;
    const n = Math.max(2, Math.round(len / sp));
    const bh = h * 0.72;
    const d = o.d ?? h * 0.34;
    this.push({ x, y, z, ry: o.ry || 0 });
    this.box(len, h * 0.12, d, color, 0, 0, 0);
    this.box(len + d * 0.3, h * 0.16, d * 1.2, color, 0, h * 0.84, 0);
    for (let i = 0; i < n; i++) {
      const bx = -len / 2 + (i + 0.5) * (len / n);
      if (o.cheap) this.cyl(d * 0.28, d * 0.34, bh, 5, color, bx, h * 0.12, 0);
      else this.lathe(PROFILES.baluster, o.seg ?? 6, color, bx, h * 0.12, 0, { sr: d * 1.05, sh: bh, flat: true });
    }
    if (o.posts) {
      for (let i = 0; i <= o.posts; i++) {
        const px = -len / 2 + (i * len) / o.posts;
        this.box(d * 1.3, h, d * 1.3, color, px, 0, 0);
      }
    }
    this.pop();
    return this;
  }

  // Merlons along the four edges of a w x d rectangle. Pointed tops if o.pointed.
  crenels(w, d, color, x = 0, y = 0, z = 0, o = {}) {
    const mw = o.mw ?? 1.6;
    const mh = o.mh ?? 1.8;
    const t = o.t ?? 0.9;
    const edge = (len, cx, cz, ry) => {
      const n = Math.max(1, Math.floor((len + mw) / (mw * 2)));
      const pitch = len / n;
      for (let i = 0; i < n; i++) {
        const u = -len / 2 + pitch * (i + 0.5);
        this.push({ x: cx, y, z: cz, ry });
        this.box(mw, mh, t, color, u, 0, 0);
        if (o.pointed) this.cone(mw * 0.62, mh * 0.55, 4, color, u, mh, 0, { sz: t / mw });
        this.pop();
      }
    };
    edge(w, x, z + d / 2 - t / 2, 0);
    edge(w, x, z - d / 2 + t / 2, Math.PI);
    edge(d - 2 * t, x + w / 2 - t / 2, z, Math.PI / 2);
    edge(d - 2 * t, x - w / 2 + t / 2, z, -Math.PI / 2);
    return this;
  }

  // Obelisk pinnacle on a pedestal with a ball: the Braga baroque motif.
  pinnacle(h, color, x = 0, y = 0, z = 0, o = {}) {
    const pw = h * 0.26;
    this.box(pw, h * 0.2, pw, color, x, y, z);
    this.box(pw * 1.2, h * 0.05, pw * 1.2, color, x, y + h * 0.2, z);
    this.cyl(h * 0.025, h * 0.085, h * 0.58, 4, color, x, y + h * 0.25, z);
    this.sphere(h * 0.06, o.ball ?? color, x, y + h * 0.9, z, { seg: 5, rings: 3, flat: true });
    return this;
  }

  urn(h, color, x = 0, y = 0, z = 0, o = {}) {
    return this.lathe(PROFILES.urn, o.seg ?? 7, color, x, y, z, { sr: h, sh: h, smooth: true });
  }

  // Robed figure of height h (a person is ~1.8 m), facing +z (o.ry turns
  // it): hem, waist, shoulders, a head on a neck and two arms. o.pose:
  // 'down' (arms at the sides), 'pray' (hands joined at the chest),
  // 'raise' (right arm raised: prophets, the blessing figures), 'hold'
  // (one forearm across: a book or an attribute); default by seed.
  // About 115 triangles.
  statue(h, color, x = 0, y = 0, z = 0, o = {}) {
    const poses = ['down', 'pray', 'raise', 'hold'];
    const pose = o.pose ?? poses[Math.floor(this.rnd() * poses.length)];
    this.push({ x, y, z, ry: o.ry ?? 0 });
    this.lathe(PROFILES.figure, o.seg ?? 6, color, 0, 0, 0, { sr: h, sh: h, flat: true, mat: MAT.smooth, sz: 0.8 });
    this.sphere(h * 0.068, color, 0, h * 0.885, h * 0.01, { seg: 6, rings: 3, flat: true, mat: MAT.smooth });
    if (o.arms !== false) {
      const sh = h * 0.765;
      const aw = h * 0.07;
      const hand = {
        down: (s) => [s * h * 0.15, h * 0.47, h * 0.05],
        pray: (s) => [s * h * 0.025, h * 0.63, h * 0.16],
        raise: (s) => (s > 0 ? [h * 0.2, h * 1.02, h * 0.06] : [-h * 0.14, h * 0.5, h * 0.06]),
        hold: (s) => (s > 0 ? [-h * 0.03, h * 0.6, h * 0.17] : [-h * 0.15, h * 0.47, h * 0.05]),
      }[pose];
      for (const s of [-1, 1]) this.segment([s * h * 0.125, sh, 0], hand(s), aw, aw, color, { mat: MAT.smooth });
      if (pose === 'hold') this.box(h * 0.12, h * 0.15, h * 0.04, color, -h * 0.04, h * 0.58, h * 0.19, { mat: MAT.smooth });
    }
    this.pop();
    return this;
  }

  column(h, r, color, x = 0, y = 0, z = 0, o = {}) {
    return this.lathe(PROFILES.column, o.seg ?? 8, color, x, y, z, { sr: r, sh: h, smooth: !!o.smooth, flat: !o.smooth });
  }

  // Deciduous tree (kind 'round'), cypress ('cypress') or clipped yew ('topiary').
  tree(x, y, z, h, o = {}) {
    const kind = o.kind ?? 'round';
    const leaf = o.color ?? (this.rnd() > 0.5 ? 'foliage' : 'foliageDark');
    if (kind === 'cypress') {
      this.cyl(h * 0.03, h * 0.04, h * 0.2, 4, 'trunk', x, y, z);
      this.lathe([[0, 0], [0.13, 0.05], [0.16, 0.3], [0.12, 0.65], [0.05, 0.9], [0, 1]], 6, leaf, x, y + h * 0.1, z, { sh: h * 0.9, sr: h, flat: true });
      return this;
    }
    if (kind === 'topiary') {
      this.lathe([[0, 0], [0.34, 0], [0.4, 0.3], [0.3, 0.7], [0.1, 0.95], [0, 1]], 7, leaf, x, y, z, { sh: h, sr: h, flat: true });
      return this;
    }
    // three crowns: 'round' (oak, lime), 'oval' (tall plane or poplar),
    // 'spread' (umbrella pine, old chestnut: wide and flat on a tall bole).
    // Slim grey-brown trunk that forks into two limbs under the crown.
    const crowns = ['round', 'oval', 'spread'];
    const crown = o.crown ?? crowns[Math.floor(this.rnd() * 3)];
    const r = h * (o.spread ?? 0.3) * (crown === 'spread' ? 1.25 : crown === 'oval' ? 0.8 : 1);
    const bole = h * (crown === 'spread' ? 0.62 : 0.42);
    this.cyl(h * 0.014, h * 0.024, bole, 5, 'trunk', x, y, z);
    const a0 = this.rnd() * Math.PI * 2;
    for (const s of [0, Math.PI]) {
      const a = a0 + s;
      this.segment([x, y + bole * 0.9, z], [x + Math.cos(a) * r * 0.45, y + bole + r * 0.35, z + Math.sin(a) * r * 0.45], h * 0.016, h * 0.016, 'trunk', { round: true, seg: 4 });
    }
    const cy = y + bole + r * (crown === 'spread' ? 0.3 : crown === 'oval' ? 0.9 : 0.6);
    const sy = crown === 'spread' ? 0.42 : crown === 'oval' ? 1.35 : 0.85;
    this.ico(r, 1, leaf, x, cy, z, { jitter: 0.18, sy, soft: true });
    const lobes = (o.lobes ?? 1) - 1 + (crown === 'spread' ? 1 : 0);
    for (let i = 0; i < lobes; i++) {
      const a = a0 + Math.PI / 2 + i * 2.4;
      this.ico(r * 0.68, 1, leaf, x + Math.cos(a) * r * 0.6, cy + r * (crown === 'spread' ? 0.05 : 0.3), z + Math.sin(a) * r * 0.6, { jitter: 0.18, sy, soft: true });
    }
    return this;
  }

  // Street lamp: post, arm and lantern (lit).
  lamp(h, x = 0, y = 0, z = 0, o = {}) {
    const c = o.color ?? 'lampGreen';
    this.cyl(h * 0.025, h * 0.04, h * 0.9, 5, c, x, y, z);
    // frosted globe: pale by day, the emissive weight carries it at night
    if (o.globe) this.sphere(h * 0.065, 0xefe6cf, x, y + h * 0.95, z, { seg: 8, rings: 5, emit: 0.55 });
    else {
      this.cyl(h * 0.07, h * 0.045, h * 0.12, 6, 'window', x, y + h * 0.86, z, { emit: 0.9 });
      this.cone(h * 0.08, h * 0.06, 6, c, x, y + h * 0.98, z);
    }
    return this;
  }

  // ------------------------------------------------- metre authoring (plan)
  // Plan points are [x, z] in metres in the landmark's local frame.

  // Vertical prism on a plan polygon, from y0 up by h. o.holes: [[x, z]...]
  // polygons cut through it; o.bevel: bevel size (bevelled slab edges).
  prism(pts, y0, h, color, o = {}) {
    const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    for (const hole of o.holes || []) s.holes.push(new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x, -z))));
    const b = o.bevel || 0;
    const g = new THREE.ExtrudeGeometry(s, {
      depth: Math.max(1e-3, h - 2 * b),
      bevelEnabled: b > 0,
      bevelSize: b,
      bevelThickness: b,
      bevelOffset: b ? -b : 0,
      bevelSegments: 1,
      curveSegments: o.curve ?? 8,
    });
    g.rotateX(-Math.PI / 2); // shape (x, -z) + depth -> (x, depth, z)
    g.translate(0, y0 + b, 0);
    return this.add(g, color, { flat: true, ...o, holes: undefined });
  }

  // Box whose long axis runs from p0 to p1 ([x, y, z]); cross-section w x h.
  segment(p0, p1, w, h, color, o = {}) {
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const dz = p1[2] - p0[2];
    const hor = Math.hypot(dx, dz);
    const len = Math.hypot(hor, dy);
    if (len < 1e-4) return this;
    const L = len + (o.ext ?? 0); // ext: overlap with the next segment
    const g = o.round ? new THREE.CylinderGeometry(w / 2, w / 2, L, o.seg ?? 5, 1, true).rotateZ(Math.PI / 2) : new THREE.BoxGeometry(L, h, w);
    return this.add(g, color, {
      flat: !o.round,
      ...o,
      ext: undefined,
      x: (p0[0] + p1[0]) / 2,
      y: (p0[1] + p1[1]) / 2,
      z: (p0[2] + p1[2]) / 2,
      ry: Math.atan2(-dz, dx),
      rz: Math.atan2(dy, hor),
      order: 'YZX',
    });
  }

  // Wall slab standing on the plan line a -> b ([x, z]), from y0 up by h.
  wallLine(a, b, h, t, color, y0 = 0, o = {}) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-4) return this;
    return this.box(len + (o.ext ?? 0), h, t, color, (a[0] + b[0]) / 2, y0, (a[1] + b[1]) / 2, { ...o, ry: Math.atan2(-(b[1] - a[1]), b[0] - a[0]) });
  }

  // Named groups: k.begin('main') ... k.end('main') records the box of the
  // parts drawn in between (userData.groups), for the fit report.
  begin(name) {
    (this.groupStart ||= {})[name] = this.parts.length;
    return this;
  }

  end(name) {
    (this.groupRange ||= {})[name] = [this.groupStart[name], this.parts.length];
    return this;
  }

  // Detached piece: the parts drawn between piece(name) and endPiece() are
  // not merged into the model but become their own named mesh (a child of
  // the landmark mesh), so the app can move them (the funicular cars).
  // Draw the piece around its own origin; data goes to mesh.userData
  // (e.g. { track: [[x, y, z] ...] local metres, t: 0..1 }).
  piece(name, data = {}) {
    this.pieceStack ||= [];
    this.pieceStack.push({ name, data, saved: this.parts });
    this.parts = [];
    return this;
  }

  endPiece() {
    const p = this.pieceStack.pop();
    (this.pieces ||= []).push({ name: p.name, data: p.data, parts: this.parts });
    this.parts = p.saved;
    return this;
  }

  // Named empty point (fountains, spouts): an Object3D child of the
  // landmark mesh at this position in the current transform.
  marker(name, x = 0, y = 0, z = 0, data = {}) {
    const v = new THREE.Vector3(x, y, z).applyMatrix4(this.top());
    (this.markers ||= []).push({ name, pos: [v.x, v.y, v.z], data });
    return this;
  }

  // ---------------------------------------------------------------- build

  // Merge, scale so max y = targetH (y = 0 stays the ground line), bake UVs
  // in final units and a soft ground-contact darkening. Without targetH the
  // geometry keeps its authored units (metres for the metric builders).
  build(targetH) {
    const groups = {};
    for (const [name, [i0, i1]] of Object.entries(this.groupRange || {})) {
      const b = new THREE.Box3();
      for (let i = i0; i < i1; i++) {
        this.parts[i].computeBoundingBox();
        b.union(this.parts[i].boundingBox);
      }
      if (!b.isEmpty()) groups[name] = b;
    }
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    g.userData.groups = groups;
    g.computeBoundingBox();
    // skirts below y = 0 (plinths into sloping ground) do not count
    const f = targetH ? targetH / Math.max(1e-3, g.boundingBox.max.y) : 1;
    if (f !== 1) g.scale(f, f, f);
    bakeSurface(g, targetH ?? g.boundingBox.max.y);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    if (this.glassParts.length) {
      const gl = mergeGeometries(this.glassParts, false);
      for (const p of this.glassParts) p.dispose();
      if (f !== 1) gl.scale(f, f, f);
      g.userData.glass = gl;
    }
    g.userData.scale = f;
    g.userData.pieces = (this.pieces || []).map((p) => {
      const pg = mergeGeometries(p.parts, false);
      for (const q of p.parts) q.dispose();
      pg.computeBoundingBox();
      bakeSurface(pg, pg.boundingBox.max.y - pg.boundingBox.min.y, false);
      return { name: p.name, data: p.data, geometry: pg };
    });
    g.userData.markers = this.markers || [];
    // Designed ground under the model (for models that climb a slope):
    // landmarks.js drapes such models onto the real terrain.
    if (this.groundLine) {
      const gl = this.groundLine;
      g.userData.groundLine = (x, z) => f * gl(x / f, z / f);
    }
    return g;
  }
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();
const _u = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function bakeSurface(g, H, ao = true) {
  const pos = g.attributes.position;
  const col = g.attributes.color;
  const uv = new Float32Array(pos.count * 2);
  const aoH = Math.min(10, H * 0.22);
  for (let i = 0; i < pos.count; i += 3) {
    _a.fromBufferAttribute(pos, i + 1).sub(_t.fromBufferAttribute(pos, i));
    _b.fromBufferAttribute(pos, i + 2).sub(_t);
    _n.crossVectors(_a, _b);
    const len = _n.length();
    if (len > 0) _n.divideScalar(len);
    const horizontal = Math.abs(_n.y) > 0.96;
    if (horizontal) {
      _t.set(1, 0, 0);
      _u.set(0, 0, 1);
    } else {
      _t.crossVectors(UP, _n).normalize();
      _u.crossVectors(_n, _t);
    }
    for (let k = 0; k < 3; k++) {
      const vi = i + k;
      _a.fromBufferAttribute(pos, vi);
      uv[vi * 2] = _a.dot(_t);
      uv[vi * 2 + 1] = _a.dot(_u);
      if (_n.y < 0.7 && ao) { // pieces (ao = false) float free of the ground
        const y = _a.y;
        const s = Math.min(1, Math.max(0, y / aoH));
        const ao = 0.76 + 0.24 * s * s * (3 - 2 * s);
        col.setXYZ(vi, col.getX(vi) * ao, col.getY(vi) * ao, col.getZ(vi) * ao);
      }
    }
  }
  g.setAttribute('aUv', new THREE.BufferAttribute(uv, 2));
}

export function triangleCount(geo) {
  return (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
}

// Common cornice profiles, [out, y], unit size (scale with s).
export function corniceProfile(kind, s = 1) {
  const P = {
    classic: [[0, 0], [0.25, 0.08], [0.25, 0.3], [0.55, 0.45], [0.55, 0.6], [1, 0.85], [1, 1]],
    band: [[0, 0], [0.4, 0], [0.4, 0.5], [0.5, 0.6], [0.5, 1]],
    eave: [[0, 0], [0.3, 0.1], [0.6, 0.35], [1, 0.6], [1.1, 0.8], [1.1, 1]],
    base: [[0, 0], [1, 0], [1, 0.5], [0.6, 0.75], [0.3, 1]],
  }[kind];
  return P.map(([a, b]) => [a * s, b * s]);
}
