// Farolim de Felgueiras (Foz do Douro): the 1886 hexagonal granite lighthouse
// (10 m) at the sea end of the Molhe de Felgueiras.
//
// Sources (all in data/dimensions.json):
//  - plan: OSM way 446589339 "Molhe de Felgueiras" (236 x 16 m, closed
//    outline). The mole is drawn as that outline itself, nothing outside it.
//  - light: OSM node 1675107645 "Farolim de Felgueiras" (41.146734, -8.677299),
//    pt.wikipedia 41 08 48.32 N, 8 40 38.2 W, Wikidata Q10280208 (height 10 m).
//  - tower: granite ashlar, red gallery rail, red lantern, red dome (pt.wikipedia,
//    photos in assets/img/felgueiras*.jpg); a small white barrel-vaulted
//    house with a red door stands against its foot.
//  - height: pt.wikipedia gives a focal height of 17 m above sea level on a 10 m
//    tower, so the crown at the head is about 6-7 m over the water; at the
//    shore end it is lower (estimate 4 m, from the photos). The crown therefore
//    rises along the mole from the root to the head.
//  - light: Fl R 5 s, 9 nm, automated 1979, switched off 2009 (only the fog
//    signal runs): the lamp is dark.
//
// Datum. The fit puts y = 0 on the lowest DEM point under the outline
// (about 0 m a.s.l.); the water plane of the sea is 1.04 m a.s.l. (world
// y -22.5), so the water is WATER m above the model's zero. The mole stands
// on a footing sunk well below it, so a small datum shift never opens a gap.
import { MAT } from '../kit.js';
import { offset, obb } from '../geom.js';

const WATER = 1.1; // water plane above the model zero (m)
const ROOT_FREEBOARD = 4.0; // crown over the water at the shore end (m)
const HEAD_FREEBOARD = 6.0; // crown over the water at the head (m)
const FOOT = -8; // footing depth under the model zero (m)
const RED = 0xa9291f;
const SLABS = 16;

// Sutherland-Hodgman clip of a polygon to u0 <= x <= u1.
function clipU(poly, u0, u1) {
  const clip = (pts, inside, cut) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ia = inside(a);
      const ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
    return out;
  };
  const at = (u) => (a, b) => {
    const t = (u - a[0]) / (b[0] - a[0]);
    return [u, a[1] + (b[1] - a[1]) * t];
  };
  let r = clip(poly, (p) => p[0] >= u0, at(u0));
  if (r.length) r = clip(r, (p) => p[0] <= u1, at(u1));
  return r;
}

function builder(k, site) {
  const fp = site?.footprint;
  const o = fp?.outline;
  const ok = o && o.length >= 3;
  const bb = ok ? obb(o) : { L: 236, W: 16, cx: 0, cz: 0, a: 0 };
  const c = Math.cos(bb.a);
  const s = Math.sin(bb.a);
  // site -> mole frame (u along the mole, v across it)
  const toUV = ([x, z]) => [(x - bb.cx) * c - (z - bb.cz) * s, (x - bb.cx) * s + (z - bb.cz) * c];
  const poly = ok ? o.map(toUV) : [[-118, -8], [118, -8], [118, 8], [-118, 8]];
  const us = poly.map((p) => p[0]);
  const uMin = Math.min(...us);
  const uMax = Math.max(...us);

  // the light: OSM node, else the end of the mole
  const lightPart = fp?.part?.(/Farolim/);
  const tp = lightPart?.pts?.[0] ? toUV(lightPart.pts[0]) : [uMin + 8, 0];
  const headDir = tp[0] >= (uMin + uMax) / 2 ? 1 : -1; // which end of u is the head
  const uHead = headDir > 0 ? uMax : uMin;

  // Sea side of the mole: the side that faces the open sea (north-west). The
  // local +z of the site points to compass bearing frontDeg; the mole frame is
  // turned by bb.a, so world = u * (c, -s) + v * (s, c) in site axes.
  const f = ((fp?.frontDeg ?? 62) * Math.PI) / 180;
  const ex = [-Math.cos(f), -Math.sin(f)]; // site +x in world (east, south)
  const ez = [Math.sin(f), -Math.cos(f)]; // site +z in world
  const vWorld = [s * ex[0] + c * ez[0], s * ex[1] + c * ez[1]];
  const sv = vWorld[0] * -1 + vWorld[1] * -1 >= 0 ? 1 : -1; // +v is toward NW?

  const crownAtSlab = (i) => WATER + ROOT_FREEBOARD + ((HEAD_FREEBOARD - ROOT_FREEBOARD) * (i + 0.5)) / SLABS;
  // slab index counted from the root end
  const slabOf = (u) => {
    const t = headDir > 0 ? (u - uMin) / (uMax - uMin) : (uMax - u) / (uMax - uMin);
    return Math.max(0, Math.min(SLABS - 1, Math.floor(t * SLABS)));
  };
  const crownAt = (u) => crownAtSlab(slabOf(u));

  k.push({ x: bb.cx, z: bb.cz, ry: bb.a });
  k.begin('main');

  // ---- the mole: granite ashlar on the OSM outline, crown rising to the head
  const inner = offset(poly, -0.35);
  for (let i = 0; i < SLABS; i++) {
    const ta = i / SLABS;
    const tb = (i + 1) / SLABS;
    const [ua, ub] = headDir > 0 ? [uMin + (uMax - uMin) * ta, uMin + (uMax - uMin) * tb] : [uMax - (uMax - uMin) * tb, uMax - (uMax - uMin) * ta];
    const crown = crownAtSlab(i);
    const body = clipU(poly, ua - (i === 0 ? 1 : 0.0), ub + (i === SLABS - 1 ? 1 : 0.0));
    if (body.length >= 3) k.prism(body, FOOT, crown - FOOT, 'graniteDark');
    const top = clipU(inner, ua, ub);
    if (top.length >= 3) k.prism(top, crown - 0.02, 0.12, 'granite');
  }

  // ---- parapet: a granite wall on the sea side and round the head (photos);
  // on the sheltered side only a low red iron rail near the head.
  const ring = offset(poly, -0.55);
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const mu = (a[0] + b[0]) / 2;
    const mv = (a[1] + b[1]) / 2;
    const seaSide = mv * sv > 0;
    const nearHead = Math.abs(uHead - mu) < 9;
    if (!(seaSide || nearHead)) continue;
    const y0 = crownAt(mu) + 0.1;
    k.wallLine(a, b, 1.25, 0.8, 'graniteGrey', y0, { ext: 0.25 });
    k.wallLine(a, b, 0.16, 1.0, 'granite', y0 + 1.25, { ext: 0.25 });
  }
  // low red rail along the sheltered edge, last 40 m before the head
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const mu = (a[0] + b[0]) / 2;
    const mv = (a[1] + b[1]) / 2;
    if (mv * sv > 0 || Math.abs(uHead - mu) > 40 || Math.abs(uHead - mu) < 9) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 2) continue;
    const y0 = crownAt(mu) + 0.1;
    const np = Math.max(1, Math.round(len / 2.4));
    let prev = null;
    for (let j = 0; j <= np; j++) {
      const p = [a[0] + ((b[0] - a[0]) * j) / np, a[1] + ((b[1] - a[1]) * j) / np];
      k.box(0.07, 1.0, 0.07, RED, p[0], y0, p[1], { mat: MAT.metal });
      if (prev) {
        k.segment([prev[0], y0 + 0.95, prev[1]], [p[0], y0 + 0.95, p[1]], 0.05, 0.05, RED, { mat: MAT.metal });
        k.segment([prev[0], y0 + 0.5, prev[1]], [p[0], y0 + 0.5, p[1]], 0.04, 0.04, RED, { mat: MAT.metal });
      }
      prev = p;
    }
  }
  k.end('main');

  // ---- the lighthouse: 10 m hexagonal granite tower on the mole head
  const [tx, tz] = tp;
  const y0 = crownAt(tx) + 0.1;
  k.begin('height');
  k.begin('tower');
  // shaft: 6.3 m, tapering (10 m to the top of the dome and vane in all)
  const shaftH = 6.3;
  k.cyl(1.3, 1.7, shaftH, 6, 'graniteGrey', tx, y0, tz);
  for (const y of [2.0, 4.3]) {
    const r = 1.7 - (0.4 * y) / shaftH;
    for (const sgn of [-1, 1]) {
      const wx = tx + sgn * (r * 0.866 + 0.02);
      k.box(0.12, 1.05, 0.7, RED, wx, y0 + y, tz, { mat: MAT.smooth });
      k.box(0.14, 0.78, 0.46, 'glass', wx, y0 + y + 0.14, tz);
    }
  }
  // corbelled cornice and the gallery
  k.cyl(1.75, 1.35, 0.5, 6, 'granite', tx, y0 + shaftH, tz);
  const gy = y0 + shaftH + 0.5;
  k.cyl(1.85, 1.85, 0.15, 12, 'granite', tx, gy, tz);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.box(0.06, 1.0, 0.06, RED, tx + Math.cos(a) * 1.78, gy + 0.15, tz + Math.sin(a) * 1.78, { mat: MAT.metal });
  }
  k.cyl(1.8, 1.8, 0.05, 12, RED, tx, gy + 1.1, tz, { open: true, mat: MAT.metal });
  k.cyl(1.8, 1.8, 0.05, 12, RED, tx, gy + 0.6, tz, { open: true, mat: MAT.metal });
  // lantern: red base, glazed drum (lamp dark since 2009), red dome, vane
  k.cyl(1.0, 1.05, 0.85, 12, RED, tx, gy + 0.15, tz, { mat: MAT.smooth });
  k.cyl(0.92, 0.95, 0.85, 12, 'glass', tx, gy + 1.0, tz);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.26;
    k.box(0.08, 0.85, 0.08, RED, tx + Math.cos(a) * 0.93, gy + 1.0, tz + Math.sin(a) * 0.93, { mat: MAT.metal });
  }
  k.cyl(1.05, 1.0, 0.1, 12, RED, tx, gy + 1.85, tz, { mat: MAT.smooth });
  k.dome(1.0, RED, tx, gy + 1.95, tz, { seg: 14, rings: 6, mat: MAT.smooth });
  k.cyl(0.04, 0.04, 0.55, 5, 'iron', tx, gy + 2.85, tz);
  k.box(0.55, 0.05, 0.05, 'iron', tx, gy + 3.15, tz);
  k.end('tower');
  k.end('height');

  // ---- the white barrel-vaulted keeper's shed against the foot of the tower,
  // red door toward the sheltered side (photos)
  k.begin('shed');
  const hu = tx - headDir * 2.8;
  const hv = tz - sv * 2.2;
  const hy = crownAt(hu) + 0.1;
  const innerDir = -sv;
  k.box(3.2, 1.6, 4.0, 'white', hu, hy, hv);
  k.cyl(1.6, 1.6, 4.0, 14, 'white', hu, hy + 1.6 - 2.0, hv, { rx: Math.PI / 2 });
  k.box(0.9, 1.9, 0.12, RED, hu, hy, hv + innerDir * 2.02, { mat: MAT.smooth });
  k.end('shed');
  k.pop();
}
builder.metric = true;
builder.rule = {
  note: 'Farolim de Felgueiras: 10 m hexagonal granite tower on the Molhe de Felgueiras (OSM way 446589339), crown 4-6 m over the water',
  // The model stands on the mole outline itself: that is the OSM extent it must match.
  extent: { part: /Molhe/ },
  heightRel: true,
  // The mole stands in the sea: no ground pad (it would paint a slab on the water).
  pad: 'none',
  // The camera frames the head of the mole with the tower, not all 236 m of it.
  frame: { x0: -30, x1: 30, z0: -135, z1: -45, y0: 0 },
  deviationNote: 'none: the model is the OSM mole outline plus the 10 m light mapped as a node on it',
};
export default { felgueiras: builder };
