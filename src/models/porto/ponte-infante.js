// Ponte Infante Dom Henrique (2003) — the high-level concrete road bridge
// linking Fontainhas (Porto) to the Serra do Pilar (Gaia). Real data: total
// length ~371 m (OSM corridor 403.0 m with approaches), deck 20 m wide,
// maximum height 75 m, reinforced-concrete arch with a 280 m span and a rise
// of 25 m (span/rise 11.2, a world record for the type). A 4.5 m box girder
// rests on a flexible 1.5 m arch.
import { bbox } from '../geom.js';

const TOTAL = 403.0;    // OSM corridor length (real ~371 m; ~405 m site extent)
const ARCH = 280;
const DECK_W = 20;
const A_MAX = 22;       // widest drawn element (abutment)
const DECK_Y = 75;      // deck top, dims height 75
const SPRING_Y = 50;    // arch springing high on the rocky banks
const CROWN_Y = 74;     // arch crown just under the deck
const RIB_Z = 5.6;

function readFrame(site, defSpan) {
  const fp = site && site.footprint;
  const outline = fp && Array.isArray(fp.outline) && fp.outline.length >= 3 ? fp.outline : null;
  if (outline) {
    const b = bbox(outline);
    const long = Math.max(b.w, b.d);
    if (long > 40) return { span: long, ang: b.w >= b.d ? 0 : Math.PI / 2 };
  }
  return { span: defSpan, ang: 0 };
}

function parabola(x, half, y0, y1) {
  const t = x / half;
  return y0 + (y1 - y0) * (1 - t * t);
}

function builder(k, site) {
  const { span, ang } = readFrame(site, TOTAL);
  const half = span / 2;
  const af = Math.min(ARCH / 2, span * 0.36);
  const archAt = (x) => parabola(x, af, SPRING_Y, CROWN_Y);
  const N = 56;

  k.begin('main');
  k.push({ ry: ang });

  // --- the two concrete arch ribs, with an upper and lower chord
  for (const z of [-RIB_Z, RIB_Z]) {
    let prev = [-af, archAt(-af), z];
    for (let i = 1; i <= N; i++) {
      const x = -af + (2 * af * i) / N;
      const p = [x, archAt(x), z];
      k.segment(prev, p, 3.4, 1.5, 'graniteGrey', { ext: 0.2 });
      k.segment([prev[0], prev[1] - 2.2, z], [p[0], p[1] - 2.2, z], 0.5, 0.5, 'graniteDark');
      prev = p;
    }
  }
  // --- cross beams between the ribs
  for (let i = 1; i < N; i += 2) {
    const x = -af + (2 * af * i) / N;
    const y = archAt(x);
    k.segment([x, y, -RIB_Z], [x, y, RIB_Z], 1.3, 1.1, 'graniteGrey');
    k.segment([x, y - 2.2, -RIB_Z], [x, y - 2.2, RIB_Z], 0.4, 0.4, 'graniteDark');
  }
  // --- spandrel columns from the arch up to the deck
  for (const z of [-RIB_Z, RIB_Z]) {
    for (let i = 1; i < N; i++) {
      const x = -af + (2 * af * i) / N;
      const y = archAt(x);
      if (y < DECK_Y - 6) {
        k.segment([x, y, z], [x, DECK_Y - 5, z], 1.8, 1.5, 'graniteGrey');
      }
    }
  }

  // --- the deck: a 4.5 m box girder, full length including approaches
  k.box(span, 4.5, DECK_W - 4, 'graniteGrey', 0, DECK_Y - 5.0, 0);
  k.box(span, 1.2, DECK_W, 'white', 0, DECK_Y - 1.2, 0);
  // sidewalks and kerbs
  for (const s of [-1, 1]) {
    const z = s * (DECK_W / 2 - 1.5);
    k.box(span, 0.4, 3.0, 'graniteLight', 0, DECK_Y - 0.4, z);
    k.box(span, 0.35, 0.5, 'graniteLight', 0, DECK_Y - 0.1, s * (DECK_W / 2 - 0.25));
    k.box(span, 0.15, 0.15, 'steel', 0, DECK_Y + 1.25, s * (DECK_W / 2 - 0.35));
    k.box(span, 0.1, 0.1, 'steel', 0, DECK_Y + 0.7, s * (DECK_W / 2 - 0.35));
    const posts = Math.max(10, Math.round(span / 8));
    for (let i = 0; i < posts; i++) {
      const px = -half + ((i + 0.5) * span) / posts;
      k.box(0.14, 1.3, 0.14, 'steel', px, DECK_Y, s * (DECK_W / 2 - 0.35));
    }
  }
  // central divider
  k.box(span, 0.3, 0.9, 'graniteLight', 0, DECK_Y - 0.1, 0);
  // four lanes of dashed markings
  for (const lz of [-7.0, -3.5, 3.5, 7.0]) {
    const dashes = Math.max(8, Math.round(span / 9));
    for (let i = 0; i < dashes; i++) {
      const px = -half + ((i + 0.5) * span) / dashes;
      k.box(3.0, 0.05, 0.18, 'white', px, DECK_Y + 0.02, lz);
    }
  }
  // low-level lighting masts
  const masts = Math.max(6, Math.round(span / 34));
  for (let i = 0; i < masts; i++) {
    const px = -half + ((i + 0.5) * span) / masts;
    for (const s of [-1, 1]) {
      k.box(0.2, 0.9, 0.2, 'steel', px, DECK_Y, s * 3.2);
      k.box(1.2, 0.16, 0.3, 'window', px + s, DECK_Y + 0.9, s * 3.2, { emit: 0.6 });
    }
  }

  // --- massive abutments carrying the arch springing on the steep banks
  for (const s of [-1, 1]) {
    const px = s * af;
    k.box(10, SPRING_Y, DECK_W + 2, 'graniteDark', px, 0, 0);
    k.box(11.6, 2, DECK_W + 2, 'graniteLight', px, SPRING_Y - 2, 0);
    k.box(11, 1.4, DECK_W + 2, 'graniteLight', px, 0, 0);
  }
  // --- approach piers beyond the abutments
  const outer = half - 6;
  for (const s of [-1, 1]) {
    const count = Math.max(1, Math.round((outer - af) / 26));
    for (let i = 0; i < count; i++) {
      const px = s * (af + ((i + 0.5) * (outer - af)) / count);
      for (const sz of [-1, 1]) {
        k.cyl(2.0, 2.4, DECK_Y - 6, 8, 'graniteGrey', px, 0, sz * (DECK_W / 2 - 4));
      }
      k.box(6, 1.6, DECK_W - 5, 'graniteGrey', px, DECK_Y - 7.4, 0);
    }
  }

  k.pop();
  k.end('main');
}

builder.metric = true;
builder.rule = {
  note: 'Ponte Infante D. Henrique: 280 m concrete arch, rise 25 m, deck 20 m wide at 75 m, ~403 m OSM corridor with approaches',
  extent: { box: { x0: -A_MAX / 2, x1: A_MAX / 2, z0: -TOTAL / 2, z1: TOTAL / 2 } },
  frame: { x0: -DECK_W, x1: DECK_W, z0: -TOTAL / 2, z1: TOTAL / 2, y0: 0 },
};

export default { 'ponte-infante': builder };
