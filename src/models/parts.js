// Compound architectural parts shared by the landmark builders.
// All take a Kit and draw in its current transform; front = +z.
import * as THREE from 'three';
import { PROFILES, corniceProfile, archPath, MAT } from './kit.js';

// Framed window on a wall face at z (the face plane). A granite surround
// stands proud of the face, the pane sits behind it: reads as a recess.
export function win(k, x, y, w, h, z, o = {}) {
  const bw = o.bw ?? Math.max(0.35, w * 0.16);
  const d = o.depth ?? 0.45;
  const trim = o.trim ?? 'granite';
  const hole = { x, y, w, h, arch: o.arch };
  k.surround(hole, bw, d, trim, z, { sill: !!o.sill });
  const pane = new THREE.Shape();
  if (o.arch === 'round') archPath(pane, x, y, w, h);
  else {
    pane.moveTo(x - w / 2, y);
    pane.lineTo(x + w / 2, y);
    pane.lineTo(x + w / 2, y + h);
    pane.lineTo(x - w / 2, y + h);
  }
  k.plane(pane, o.pane ?? 'glass', 0, 0, z + 0.04, { emit: o.emit, mat: MAT.flat });
  if (o.bars) {
    for (let i = 1; i < 3; i++) k.box(0.12, h, 0.1, 'iron', x - w / 2 + (w * i) / 3, y, z + 0.1);
    k.box(w, 0.12, 0.1, 'iron', x, y + h * 0.55, z + 0.1);
  }
  if (o.sill) k.box(w + bw * 2.6, 0.35, d + 0.35, trim, x, y - bw - 0.2, z + (d + 0.35) / 2);
  const top = y + h + bw;
  if (o.head === 'tri') pediment(k, w + bw * 2.8, (w + bw * 2.8) * 0.26, 0.55, trim, x, top + 0.1, z + 0.3, { frame: 0.22 });
  else if (o.head === 'flat') k.box(w + bw * 2.8, 0.45, d + 0.3, trim, x, top, z + (d + 0.3) / 2);
  else if (o.head === 'seg') segPediment(k, w + bw * 2.6, (w + bw * 2.6) * 0.22, 0.55, trim, x, top + 0.05, z + 0.3);
  if (o.balcony) {
    const bwid = w + bw * 3;
    k.box(bwid, 0.35, 1.5, trim, x, y - 0.35, z + 0.75);
    k.balustrade(bwid, 1.4, o.balcony === true ? 'iron' : o.balcony, x, y, z + 1.35, { cheap: true, d: 0.18, sp: 0.4 });
  }
  return top;
}

// Triangular pediment: tympanum plus raking and horizontal cornices.
export function pediment(k, w, h, depth, color, x, y, z, o = {}) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  k.extrude(s, depth, o.tympanum ?? color, x, y, z);
  const f = o.frame ?? 0.4;
  const len = Math.hypot(w / 2, h);
  const a = Math.atan2(h, w / 2);
  k.box(w + f, f, depth + f, color, x, y - f * 0.5, z);
  for (const sx of [-1, 1]) {
    k.box(len + f, f, depth + f, color, x + (sx * w) / 4, y + h / 2 - f * 0.5, z, { rz: -sx * a });
  }
  return y + h;
}

// Segmental (curved) pediment.
export function segPediment(k, w, h, depth, color, x, y, z) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.quadraticCurveTo(w / 2, h * 1.6, 0, h * 1.6);
  s.quadraticCurveTo(-w / 2, h * 1.6, -w / 2, 0);
  k.extrude(s, depth, color, x, y, z, { curve: 6 });
  return y + h;
}

// Baroque broken pediment with scrolls and a central cartouche.
export function scrollCrest(k, w, h, depth, color, x, y, z) {
  // mirrored in shape space (ExtrudeGeometry fixes the winding), never by
  // a negative scale, which would turn the faces inside out
  for (const sx of [-1, 1]) {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(sx * w * 0.32, 0);
    s.quadraticCurveTo(sx * w * 0.34, h * 0.55, sx * w * 0.12, h * 0.62);
    s.quadraticCurveTo(sx * w * 0.02, h * 0.66, 0, h * 0.5);
    s.closePath();
    k.extrude(s, depth, color, x + sx * w * 0.18, y, z, { curve: 5 });
  }
  cartouche(k, w * 0.32, h, depth * 1.2, color, x, y, z + depth * 0.2);
}

// Coat of arms: shield with a crown.
export function cartouche(k, w, h, depth, color, x, y, z, o = {}) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, h * 0.75);
  s.lineTo(w / 2, h * 0.75);
  s.lineTo(w / 2, h * 0.35);
  s.quadraticCurveTo(w / 2, 0, 0, 0);
  s.quadraticCurveTo(-w / 2, 0, -w / 2, h * 0.35);
  s.closePath();
  k.extrude(s, depth, color, x, y, z, { curve: 5, mat: MAT.smooth });
  // a raised border and the charge, scrolled sides, a crown with three points
  k.push({ x, y: y + h * 0.06, z: z + depth * 0.5, s: 0.82 });
  const b = new THREE.Shape();
  b.moveTo(-w / 2, h * 0.75);
  b.lineTo(w / 2, h * 0.75);
  b.lineTo(w / 2, h * 0.35);
  b.quadraticCurveTo(w / 2, 0, 0, 0);
  b.quadraticCurveTo(-w / 2, 0, -w / 2, h * 0.35);
  b.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-w * 0.38, h * 0.68);
  hole.lineTo(w * 0.38, h * 0.68);
  hole.lineTo(w * 0.38, h * 0.36);
  hole.quadraticCurveTo(w * 0.38, h * 0.08, 0, h * 0.08);
  hole.quadraticCurveTo(-w * 0.38, h * 0.08, -w * 0.38, h * 0.36);
  hole.closePath();
  b.holes.push(hole);
  k.extrude(b, depth * 0.3, color, 0, 0, 0, { curve: 5, mat: MAT.smooth });
  k.pop();
  k.box(w * 0.4, h * 0.34, depth * 0.3, o.inlay ?? color, x, y + h * 0.26, z + depth * 0.55, { mat: MAT.smooth });
  if (o.scrolls !== false) for (const sx of [-1, 1]) volute(k, h * 0.16, depth * 0.8, color, x + sx * (w / 2 + h * 0.08), y + h * 0.5, z, { dir: sx, turns: 1.3 });
  k.frustum(w * 0.62, depth * 1.1, w * 0.82, depth * 1.1, h * 0.14, o.crown ?? color, x, y + h * 0.75, z);
  for (const sx of [-1, 0, 1]) k.sphere(w * 0.07, o.crown ?? color, x + sx * w * 0.3, y + h * (sx ? 0.93 : 0.98), z, { seg: 6, rings: 4, flat: true });
}

// Wall whose top follows a slope from (x0, h0) to (x1, h1), solid down to yb,
// thickness t centred on z, with a granite coping along the top.
export function slopedParapet(k, x0, x1, h0, h1, z, t, color, coping = 'granite', yb = 0) {
  const s = new THREE.Shape();
  s.moveTo(x0, yb);
  s.lineTo(x1, yb);
  s.lineTo(x1, h1);
  s.lineTo(x0, h0);
  s.closePath();
  k.extrude(s, t, color, 0, 0, z);
  if (coping) {
    const len = Math.hypot(x1 - x0, h1 - h0);
    const a = Math.atan2(h1 - h0, x1 - x0);
    k.box(len + 0.3, 0.4, t + 0.35, coping, (x0 + x1) / 2, (h0 + h1) / 2 - 0.1, z, { rz: a });
  }
}

// ------------------------------------------------ carved baroque ornament
// Flat carved pieces: a 2D outline extruded by `depth` toward +z, centred
// on z (so z is the middle of the relief; put it at face + depth / 2).

// Spiral scroll (volute) of outer radius R, `turns` turns, band width
// shrinking toward the eye. Lies in the xy plane at (x, y), facing +z.
// o.dir = 1 (counter-clockwise from the bottom) or -1 (mirrored),
// o.tail: a straight tail of that length leaving the outer end sideways.
export function volute(k, R, depth, color, x, y, z, o = {}) {
  const turns = o.turns ?? 1.6;
  const n = Math.round(turns * (o.res ?? (R < 0.4 ? 8 : 12)));
  const dir = o.dir ?? 1;
  const band = o.band ?? 0.28;
  const outer = [];
  const inner = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = -Math.PI / 2 + t * turns * Math.PI * 2;
    const r = R * (1 - 0.72 * t);
    const w = R * band * (1 - 0.6 * t);
    outer.push([dir * Math.cos(a) * r, Math.sin(a) * r]);
    inner.push([dir * Math.cos(a) * (r - w), Math.sin(a) * (r - w)]);
  }
  const pts = [...outer, ...inner.reverse()];
  if (o.tail) {
    pts.unshift([-dir * o.tail, -R]);
    pts.push([-dir * o.tail, -R + R * band]);
  }
  const s = new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b)));
  k.extrude(s, depth, color, x, y, z, { mat: MAT.smooth, ...o.kit });
  // the eye
  // (cyl lifts its centre by half its length: undo that for the turned disc)
  k.cyl(R * 0.2, R * 0.2, depth * 1.3, 6, color, x, y - depth * 0.65, z, { rx: Math.PI / 2, mat: MAT.smooth });
}

// Ornamental window frame of Braga baroque (Santa Cruz, the Raio): an
// outline of lobes with pointed ears round a small opening. kind:
// 'quatrefoil' (four lobes, ears on the diagonals), 'diamond' (a lozenge
// with scrolled ears), 'oval'. size = overall width. The opening (a barred
// dark pane) is o.open x size. Two stepped layers give the carving depth.
export function lobedFrame(k, kind, size, depth, color, x, y, z, o = {}) {
  const R = size / 2;
  const N = 40;
  const rOf = (a) => {
    if (kind === 'diamond') {
      const c = Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)); // lozenge
      const lobe = 0.12 * Math.pow(Math.abs(Math.cos(2 * a)), 6); // round ends
      const ear = 0.14 * Math.pow(Math.max(0, Math.cos(4 * a + Math.PI)), 10);
      return R * (0.74 / c + lobe + ear);
    }
    if (kind === 'oval') return R * (0.9 + 0.1 * Math.cos(2 * a)) * (1 + 0.06 * Math.pow(Math.max(0, Math.cos(8 * a)), 4));
    const lobes = 0.8 + 0.2 * Math.pow(Math.abs(Math.cos(2 * a)), 0.6);
    const ear = 0.2 * Math.pow(Math.max(0, Math.cos(4 * a + Math.PI)), 14);
    return R * (lobes + ear);
  };
  const ring = (f) => {
    const pts = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + Math.PI / 4;
      const r = rOf(a) * f;
      pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
    }
    return pts;
  };
  const open = (o.open ?? 0.42) * R;
  const hole = new THREE.Path();
  if (kind === 'diamond') hole.setFromPoints([[0, -open], [open, 0], [0, open], [-open, 0]].map(([a, b]) => new THREE.Vector2(a, b)).reverse());
  else rectPathRev(hole, -open * 0.85, -open * 0.85, open * 0.85, open * 0.85);
  const s1 = new THREE.Shape(ring(1));
  s1.holes.push(hole);
  k.extrude(s1, depth * 0.5, color, x, y, z - depth * 0.25, { mat: MAT.smooth });
  const s2 = new THREE.Shape(ring(0.78));
  const hole2 = new THREE.Path();
  if (kind === 'diamond') hole2.setFromPoints([[0, -open * 1.08], [open * 1.08, 0], [0, open * 1.08], [-open * 1.08, 0]].map(([a, b]) => new THREE.Vector2(a, b)).reverse());
  else rectPathRev(hole2, -open * 0.95, -open * 0.95, open * 0.95, open * 0.95);
  s2.holes.push(hole2);
  k.extrude(s2, depth * 0.5, color, x, y, z + depth * 0.25, { mat: MAT.smooth });
  // barred pane in the opening
  const pw = kind === 'diamond' ? open * 1.2 : open * 1.7;
  k.box(pw, pw, 0.05, o.pane ?? 'dark', x, y - pw / 2, z - depth * 0.3, { rz: kind === 'diamond' ? Math.PI / 4 : 0, mat: MAT.flat });
  for (const t of [-1, 0, 1]) {
    k.box(0.05, pw, 0.05, 'iron', x + (t * pw) / 3, y - pw / 2, z - depth * 0.2, { rz: kind === 'diamond' ? Math.PI / 4 : 0 });
  }
  if (o.crest !== false) shell(k, R * 0.32, depth * 0.6, color, x, y + rOf(Math.PI / 2) * 0.93, z + depth * 0.1);
}

function rectPathRev(p, x0, y0, x1, y1) {
  p.moveTo(x0, y0);
  p.lineTo(x0, y1);
  p.lineTo(x1, y1);
  p.lineTo(x1, y0);
  p.lineTo(x0, y0);
  return p;
}

// Scallop shell (the Braga baroque crest over windows, clocks and niches):
// a fan of ribbed lobes, radius r, base on (x, y), facing +z.
export function shell(k, r, depth, color, x, y, z, o = {}) {
  const lobes = o.lobes ?? 7;
  const pts = [new THREE.Vector2(0, 0)];
  const M = lobes * 2;
  for (let i = 0; i <= M; i++) {
    const a = Math.PI * (i / M);
    const f = i % 2 === 0 ? 0.84 : 1;
    pts.push(new THREE.Vector2(Math.cos(a) * r * f, Math.sin(a) * r * f * 0.9));
  }
  k.extrude(new THREE.Shape(pts), depth, color, x, y, z, { mat: MAT.smooth });
  // ribs: thin wedges standing proud
  for (let i = 0; i < lobes; i++) {
    const a = Math.PI * ((i + 0.5) / lobes);
    k.segment([x, y, z + depth * 0.5], [x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.8, z + depth * 0.4], r * 0.09, r * 0.09, color, { mat: MAT.smooth });
  }
}

// Fluted column on a moulded base with a capital: shaft of `flutes`
// channels (a star section), height h (base to abacus top), radius r.
// o.capital: 'doric' | 'ionic' | 'corinthian'.
export function flutedColumn(k, h, r, color, x, y, z, o = {}) {
  const f = o.flutes ?? 12;
  const baseH = r * 0.9;
  const capH = o.capital === 'corinthian' ? r * 2.2 : r * 1.1;
  const sh = h - baseH - capH;
  const pts = [];
  for (let i = 0; i < f * 2; i++) {
    const a = (i / (f * 2)) * Math.PI * 2;
    const rr = i % 2 ? r * 0.88 : r;
    pts.push(new THREE.Vector2(Math.cos(a) * rr, Math.sin(a) * rr));
  }
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: sh, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  // entasis: taper the top of the shaft
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / sh;
    const s = 1 - 0.12 * t;
    p.setX(i, p.getX(i) * s);
    p.setZ(i, p.getZ(i) * s);
  }
  k.add(g, color, { flat: true, x, y: y + baseH, z, mat: MAT.smooth });
  // attic base: plinth, torus, scotia, torus
  k.box(r * 2.5, r * 0.3, r * 2.5, color, x, y, z);
  k.lathe([[0, 0], [1.18, 0], [1.2, 0.2], [1.04, 0.4], [1.0, 0.55], [1.1, 0.7], [0.98, 0.95], [0, 1]], 12, color, x, y + r * 0.3, z, { sr: r, sh: baseH - r * 0.3, smooth: true, mat: MAT.smooth });
  const cy = y + baseH + sh;
  if (o.capital === 'corinthian') {
    k.lathe([[0, 0], [0.9, 0], [1.05, 0.3], [1.25, 0.7], [1.4, 0.85], [0, 0.85]], 8, color, x, cy, z, { sr: r, sh: capH, flat: true, mat: MAT.smooth });
    k.box(r * 2.9, capH * 0.18, r * 2.9, color, x, cy + capH * 0.82, z);
  } else if (o.capital === 'ionic') {
    k.box(r * 2.3, capH * 0.45, r * 2.1, color, x, cy, z, { mat: MAT.smooth });
    for (const s of [-1, 1]) k.cyl(r * 0.38, r * 0.38, r * 2.2, 8, color, x + s * r * 1.05, cy + capH * 0.25 - r * 1.1, z, { rx: Math.PI / 2, mat: MAT.smooth });
    k.box(r * 2.6, capH * 0.3, r * 2.6, color, x, cy + capH * 0.7, z);
  } else {
    k.lathe([[0, 0], [0.95, 0], [1.2, 0.5], [0, 0.5]], 12, color, x, cy, z, { sr: r, sh: capH, smooth: true, mat: MAT.smooth });
    k.box(r * 2.6, capH * 0.5, r * 2.6, color, x, cy + capH * 0.5, z);
  }
}

// Flame urn finial (the pinnacle vases of the Braga towers): pedestal,
// urn, flame; overall height h.
export function flameUrn(k, h, color, x, y, z, o = {}) {
  k.box(h * 0.3, h * 0.16, h * 0.3, color, x, y, z);
  k.lathe([[0, 0], [0.5, 0], [0.5, 0.08], [0.3, 0.14], [0.56, 0.34], [0.5, 0.46], [0.24, 0.52], [0.34, 0.56], [0.12, 0.62], [0.24, 0.72], [0.1, 0.9], [0.02, 1], [0, 1]], o.seg ?? 7, color, x, y + h * 0.16, z, { sr: h * 0.3, sh: h * 0.84, flat: true, mat: MAT.smooth });
}

// Carved inscription tablet with scrolled ends (over doors, in friezes).
export function tablet(k, w, h, depth, color, x, y, z, o = {}) {
  k.box(w, h, depth, o.face ?? color, x, y, z, { mat: MAT.smooth });
  k.box(w + depth * 1.6, depth * 0.9, depth * 1.4, color, x, y - depth * 0.45, z + depth * 0.1);
  k.box(w + depth * 1.6, depth * 0.9, depth * 1.4, color, x, y + h - depth * 0.45, z + depth * 0.1);
  for (const s of [-1, 1]) volute(k, h * 0.34, depth * 1.2, color, x + s * (w / 2 + h * 0.2), y + h * 0.5, z + depth * 0.2, { dir: s, turns: 1.2 });
  // incised lines of lettering
  const lines = o.lines ?? 2;
  for (let i = 0; i < lines; i++) k.box(w * 0.78, h * 0.08, 0.02, o.ink ?? 0x8f887a, x, y + (h * (i + 1)) / (lines + 1) - h * 0.04, z + depth / 2 + 0.005, { mat: MAT.smooth });
}

// Bell for a belfry opening.
export function bell(k, h, x, y, z) {
  k.lathe([[0, 0], [0.5, 0], [0.46, 0.12], [0.34, 0.5], [0.3, 0.86], [0.12, 1], [0, 1]], 8, 'bronze', x, y, z, { sr: h, sh: h, smooth: true });
}

// Baroque bell tower of square plan; returns the y of its top.
// o: w, hBody, hBelfry, body, trim, cap ('bell'|'onion'|'pyramid'|'dome'|'none'),
//    capH, openings (per face), clock, windows (body windows on the front),
//    urns (corner urns/pinnacles), cross.
export function bellTower(k, o) {
  const w = o.w;
  const body = o.body ?? 'plaster';
  const trim = o.trim ?? 'granite';
  const hB = o.hBody;
  const hF = o.hBelfry;
  const y0 = o.y ?? 0;
  k.push({ x: o.x ?? 0, y: y0, z: o.z ?? 0, ry: o.ry ?? 0 });
  // plinth, body, corner quoins
  k.box(w + 0.8, 1.4, w + 0.8, trim, 0, 0, 0);
  k.box(w, hB, w, body, 0, 0, 0);
  const q = w * 0.14;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) k.box(q, hB, q, trim, sx * (w / 2 - q / 2 + 0.06), 0, sz * (w / 2 - q / 2 + 0.06));
  // body windows (front and one per side)
  const nwin = o.windows ?? 2;
  for (let i = 0; i < nwin; i++) {
    const wy = hB * (0.25 + (0.5 * i) / Math.max(1, nwin - 1 || 1));
    win(k, 0, wy, w * 0.22, w * 0.34, w / 2, { pane: 'glass', trim, bw: w * 0.05, depth: 0.3, arch: o.winArch });
    if (o.sideWindows !== false) {
      k.push({ ry: Math.PI / 2 });
      win(k, 0, wy, w * 0.2, w * 0.3, w / 2, { pane: 'glass', trim, bw: w * 0.05, depth: 0.3 });
      k.pop();
      k.push({ ry: -Math.PI / 2 });
      win(k, 0, wy, w * 0.2, w * 0.3, w / 2, { pane: 'glass', trim, bw: w * 0.05, depth: 0.3 });
      k.pop();
    }
  }
  if (o.clock) {
    const cy = hB * 0.86;
    k.cyl(w * 0.2, w * 0.2, 0.4, 16, trim, 0, cy, w / 2 + 0.2, { rx: Math.PI / 2 });
    k.cyl(w * 0.16, w * 0.16, 0.2, 16, 'white', 0, cy, w / 2 + 0.45, { rx: Math.PI / 2 });
    k.box(w * 0.02, w * 0.12, 0.1, 'dark', 0, cy, w / 2 + 0.62);
  }
  let y = hB;
  k.corniceRing(w, w, corniceProfile('classic', w * 0.1), trim, 0, y, 0);
  y += w * 0.1;
  // belfry: four slabs with arched openings over a dark core
  const t = w * 0.14;
  const n = o.openings ?? 1;
  const ow = (w * (n === 1 ? 0.46 : 0.3));
  const holes = [];
  for (let i = 0; i < n; i++) holes.push({ x: n === 1 ? 0 : (i - (n - 1) / 2) * w * 0.4, y: hF * 0.14, w: ow, h: hF * 0.7, arch: 'round', pane: null });
  const bellFace = o.belfryBody ?? body;
  for (const [ry, off, len] of [[0, w / 2 - t / 2, w], [Math.PI, w / 2 - t / 2, w], [Math.PI / 2, w / 2 - t / 2, w - 2 * t], [-Math.PI / 2, w / 2 - t / 2, w - 2 * t]]) {
    k.push({ y, ry });
    k.wall(len, hF, t, bellFace, holes, 0, 0, off);
    // opening surrounds
    for (const hh of holes) k.surround(hh, w * 0.05, 0.25, trim, off + t / 2);
    k.pop();
  }
  k.box(w - 2 * t + 0.02, hF, w - 2 * t + 0.02, 'dark', 0, y, 0);
  if (o.bells !== false) for (const hh of holes) bell(k, hF * 0.34, hh.x, y + hF * 0.3, w / 2 - t - 0.6);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) k.box(q, hF, q, trim, sx * (w / 2 - q / 2 + 0.06), y, sz * (w / 2 - q / 2 + 0.06));
  y += hF;
  k.corniceRing(w, w, corniceProfile('classic', w * 0.12), trim, 0, y, 0);
  y += w * 0.12;
  // corner urns or pinnacles
  if (o.urns !== false) {
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      if (o.urns === 'pinnacle') k.pinnacle(w * 0.5, trim, sx * w * 0.44, y, sz * w * 0.44);
      else k.lathe(PROFILES.finial, 7, trim, sx * w * 0.42, y, sz * w * 0.42, { sr: w * 0.14, sh: w * 0.36, flat: true });
    }
  }
  if (o.balustrade) {
    for (const [ry, off] of [[0, w * 0.44], [Math.PI, w * 0.44], [Math.PI / 2, w * 0.44], [-Math.PI / 2, w * 0.44]]) {
      k.push({ y, ry });
      k.balustrade(w * 0.7, w * 0.16, trim, 0, 0, off, { cheap: true, d: w * 0.05, sp: w * 0.09 });
      k.pop();
    }
  }
  // cap
  const cap = o.cap ?? 'bell';
  const capH = o.capH ?? w * 0.9;
  if (cap === 'bell') {
    k.box(w * 0.78, w * 0.12, w * 0.78, trim, 0, y, 0);
    k.lathe(PROFILES.bellCap, 12, o.capColor ?? trim, 0, y + w * 0.12, 0, { sr: w * 0.42, sh: capH, smooth: true });
    y += w * 0.12 + capH;
  } else if (cap === 'onion') {
    k.cyl(w * 0.38, w * 0.4, w * 0.2, 8, trim, 0, y, 0);
    k.lathe(PROFILES.onion, 12, o.capColor ?? trim, 0, y + w * 0.2, 0, { sr: w * 0.4, sh: capH, smooth: true });
    y += w * 0.2 + capH;
  } else if (cap === 'pyramid') {
    k.cone(w * 0.72, capH, 4, o.capColor ?? trim, 0, y, 0);
    y += capH;
  } else if (cap === 'dome') {
    k.cyl(w * 0.36, w * 0.36, w * 0.3, 12, body, 0, y, 0);
    k.dome(w * 0.37, o.capColor ?? trim, 0, y + w * 0.3, 0, { seg: 12, rings: 5 });
    y += w * 0.3 + w * 0.37;
  }
  if (cap !== 'none') {
    // lantern and finial
    if (o.lantern !== false) {
      k.cyl(w * 0.12, w * 0.14, w * 0.3, 8, trim, 0, y - 0.05, 0);
      k.cone(w * 0.15, w * 0.18, 8, trim, 0, y + w * 0.25, 0);
      y += w * 0.4;
    }
    k.lathe(PROFILES.finial, 6, o.finial ?? trim, 0, y, 0, { sr: w * 0.1, sh: w * 0.34, flat: true });
    y += w * 0.34;
    if (o.cross !== false) {
      k.box(0.18, w * 0.4, 0.18, 'iron', 0, y, 0);
      k.box(w * 0.2, 0.16, 0.16, 'iron', 0, y + w * 0.26, 0);
      y += w * 0.4;
    }
  }
  k.pop();
  return y0 + y;
}

// Baroque wall fountain standing against a wall face at z, facing +z.
export function wallFountain(k, x, y, z, h, o = {}) {
  const trim = o.trim ?? 'granite';
  const w = h * 0.42;
  k.box(w, h * 0.7, h * 0.18, trim, x, y, z + h * 0.09);
  k.box(w * 1.2, h * 0.08, h * 0.26, trim, x, y + h * 0.7, z + h * 0.13);
  k.box(w * 0.5, h * 0.3, 0.1, 'dark', x, y + h * 0.3, z + h * 0.185); // niche
  k.statue(h * 0.34, o.statue ?? 'graniteLight', x, y + h * 0.78, z + h * 0.1);
  if (o.urns !== false) for (const sx of [-1, 1]) k.urn(h * 0.16, trim, x + sx * w * 0.48, y + h * 0.78, z + h * 0.1, { seg: 6 });
  // basin and spout
  k.lathe(PROFILES.basin, 9, trim, x, y, z + h * 0.42, { sr: h * 0.26, sh: h * 0.28, smooth: true, sz: 0.8 });
  k.cyl(h * 0.2, h * 0.2, 0.2, 12, 'water', x, y + h * 0.26, z + h * 0.42);
  k.cyl(0.18, 0.12, h * 0.26, 5, 'water', x, y + h * 0.28, z + h * 0.3, { rx: 0.5, emit: 0.6 });
  k.marker('fountain', x, y + h * 0.3, z + h * 0.42, { kind: 'wall', r: h * 0.2 });
}

// Small Via Sacra chapel: white cube, granite corners, pyramid roof, finial.
export function chapel(k, x, y, z, s, ry = 0) {
  k.push({ x, y, z, ry });
  k.box(s, s * 0.95, s, 'plaster', 0, 0, 0);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) k.box(s * 0.12, s * 0.95, s * 0.12, 'granite', sx * s * 0.47, 0, sz * s * 0.47);
  k.corniceRing(s, s, corniceProfile('band', s * 0.08), 'granite', 0, s * 0.95, 0);
  k.wall(s * 0.46, s * 0.62, 0.3, 'granite', [{ x: 0, y: 0, w: s * 0.3, h: s * 0.5, arch: 'round', pane: 'dark', inset: 0.25 }], 0, 0, s / 2 + 0.1);
  k.cone(s * 0.76, s * 0.55, 4, 'graniteDark', 0, s * 1.03, 0);
  k.lathe(PROFILES.finial, 6, 'granite', 0, s * 1.55, 0, { sr: s * 0.12, sh: s * 0.35, flat: true });
  k.pop();
}

// ---- cheap windows for large rendered / concrete blocks (uminho, dmaria, ...)
import { edges as _planEdges } from './geom.js';

// Flat window on a wall face of the current transform: a frame plane and a
// glass plane (4 triangles). y = sill.
export function flatWindow(k, x, y, w, h, z, o = {}) {
  const f = o.frame ?? 0.09;
  k.add(new THREE.PlaneGeometry(w + 2 * f, h + 2 * f), o.trim ?? 'graniteDark', { x, y: y + h / 2, z, mat: MAT.flat });
  k.add(new THREE.PlaneGeometry(w, h), o.pane ?? 'glass', { x, y: y + h / 2, z: z + 0.02, mat: MAT.flat, emit: o.emit ?? 0.14 });
  return k;
}

// Punched windows on every edge of a plan polygon: per storey n bays of
// flatWindow. o: storeys (count), first (sill of the first floor), storey
// (floor height), w, h, bay, margin, minLen, trim, pane, emit, lit(rnd) ->
// emit override, out (offset from the wall), only(e) -> false to skip an edge.
export function punchedWindows(k, pts, y0, o = {}) {
  const storeys = o.storeys ?? 2;
  const sh = o.storey ?? 3.2;
  const bay = o.bay ?? 3.2;
  const margin = o.margin ?? 1.2;
  for (const e of _planEdges(pts)) {
    if (e.len < (o.minLen ?? bay + margin)) continue;
    if (o.only && !o.only(e)) continue;
    const n = Math.max(1, Math.floor((e.len - margin * 2) / bay));
    const pitch = (e.len - margin * 2) / n;
    const fs = o.flip ? -1 : 1; // flip: the wall faces the other way (a courtyard hole)
    k.push({ x: e.mx + fs * e.nx * (o.out ?? 0.03), y: y0, z: e.mz + fs * e.nz * (o.out ?? 0.03), ry: e.ry + (o.flip ? Math.PI : 0) });
    for (let s = 0; s < storeys; s++) {
      for (let i = 0; i < n; i++) {
        const u = -((n - 1) * pitch) / 2 + i * pitch;
        const emit = o.lit ? o.lit(k.rnd) : o.emit;
        flatWindow(k, u, (o.first ?? 1.0) + s * sh, o.w ?? 1.2, o.h ?? 1.5, 0, { trim: o.trim, pane: o.pane, emit, frame: o.frame });
      }
    }
    k.pop();
  }
  return k;
}

// Ribbon (band) windows on every edge of a plan polygon: per storey one
// dark strip and one glass strip (4 triangles), between margins.
export function ribbonWindows(k, pts, y0, o = {}) {
  const storeys = o.storeys ?? 2;
  const sh = o.storey ?? 3.2;
  for (const e of _planEdges(pts)) {
    if (e.len < (o.minLen ?? 6)) continue;
    if (o.only && !o.only(e)) continue;
    const w = e.len - (o.margin ?? 1.6) * 2;
    if (w < 2) continue;
    const fs = o.flip ? -1 : 1;
    k.push({ x: e.mx + fs * e.nx * (o.out ?? 0.03), y: y0, z: e.mz + fs * e.nz * (o.out ?? 0.03), ry: e.ry + (o.flip ? Math.PI : 0) });
    for (let s = 0; s < storeys; s++) flatWindow(k, 0, (o.first ?? 0.9) + s * sh, w, o.h ?? 1.5, 0, { trim: o.trim, pane: o.pane, emit: o.emit, frame: o.frame ?? 0.14 });
    k.pop();
  }
  return k;
}
