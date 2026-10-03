// Ponte da Arrábida (1963) — concrete arch road bridge over the Douro. Real
// dimensions: central span 270 m, deck ~70 m above the water, four lanes
// (~20 m). The world's longest concrete arch when completed. Two slender
// concrete ribs, many vertical spandrel columns, a road box deck with parapet
// and two massive abutments.
import { bbox } from '../geom.js';

const TOTAL = 493;
const ARCH = 270;
const DECK_Y = 70;
const DECK_W = 20;
const RIB_Z = 5.5;

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
  const af = Math.min(ARCH / 2, span * 0.28);
  const springY = 10;
  const crownY = 58;
  const archAt = (x) => parabola(x, af, springY, crownY);
  const N = 40;

  k.begin('main');
  k.push({ ry: ang });

  // --- the two concrete arch ribs
  for (const z of [-RIB_Z, RIB_Z]) {
    let prev = [-af, archAt(-af), z];
    for (let i = 1; i <= N; i++) {
      const x = -af + (2 * af * i) / N;
      const p = [x, archAt(x), z];
      k.segment(prev, p, 3.2, 2.6, 'graniteGrey', { ext: 0.3 });
      prev = p;
    }
  }

  // --- vertical spandrel columns from the arch to the deck
  for (const z of [-RIB_Z, RIB_Z]) {
    for (let i = 1; i < N; i++) {
      const x = -af + (2 * af * i) / N;
      const y = archAt(x);
      if (y < DECK_Y - 3) k.segment([x, y, z], [x, DECK_Y - 2, z], 1.6, 1.6, 'graniteGrey');
    }
  }

  // --- lattice web along each rib: X bracing between consecutive nodes
  for (const z of [-RIB_Z, RIB_Z]) {
    for (let i = 0; i + 2 <= N; i += 2) {
      const x0 = -af + (2 * af * i) / N;
      const x1 = -af + (2 * af * (i + 2)) / N;
      const y0 = archAt(x0);
      const y1 = archAt(x1);
      k.segment([x0, y0 - 1.5, z], [x1, y1, z], 0.4, 0.4, 'graniteGrey');
      k.segment([x1, y1 - 1.5, z], [x0, y0, z], 0.4, 0.4, 'graniteGrey');
    }
  }

  // --- cross beams between the ribs
  for (let i = 1; i < N; i += 2) {
    const x = -af + (2 * af * i) / N;
    const y = archAt(x);
    k.segment([x, y, -RIB_Z], [x, y, RIB_Z], 1.2, 1.2, 'graniteGrey');
  }

  // --- road box deck with kerbs and parapet
  k.box(span, 1.6, DECK_W, 'white', 0, DECK_Y - 3.6, 0);
  k.box(span, 2.0, DECK_W - 3, 'graniteGrey', 0, DECK_Y - 5.6, 0);
  for (const s of [-1, 1]) {
    const z = s * (DECK_W / 2 - 0.5);
    k.box(span, 0.45, 0.9, 'graniteGrey', 0, DECK_Y - 2, z);
    k.box(span, 0.9, 0.55, 'white', 0, DECK_Y - 1.55, s * (DECK_W / 2 - 0.25));
  }
  // parapet posts and under-deck ribs
  const posts = Math.max(8, Math.round(span / 12));
  for (let i = 0; i < posts; i++) {
    const px = -half + ((i + 0.5) * span) / posts;
    for (const s of [-1, 1]) k.box(0.35, 1.1, 0.35, 'graniteGrey', px, DECK_Y - 1.6, s * (DECK_W / 2 - 0.25));
  }
  for (let i = 1; i < posts; i++) {
    const px = -half + (i * span) / posts;
    k.box(1.1, 1.2, DECK_W - 2, 'graniteGrey', px, DECK_Y - 5.2, 0);
  }

  // --- approach viaducts: paired columns under the deck
  const inner = af + 4;
  const outer = half - 6;
  for (const s of [-1, 1]) {
    const count = Math.max(1, Math.round((outer - inner) / 26));
    for (let i = 0; i < count; i++) {
      const x = s * (inner + ((i + 0.5) * (outer - inner)) / count);
      for (const sz of [-1, 1]) {
        k.cyl(1.9, 2.3, DECK_Y - 1.6, 8, 'graniteGrey', x, 0, sz * (DECK_W / 2 - 4));
      }
      k.box(6, 1.8, DECK_W - 4, 'graniteGrey', x, DECK_Y - 3.4, 0);
    }
    const ex = s * (half - 3);
    k.box(10, DECK_Y - 1.5, DECK_W + 2, 'graniteGrey', ex, 0, 0);
    k.box(12, 1.6, DECK_W + 4, 'white', ex, DECK_Y - 1.5, 0);
  }

  // ---------------------------------------------------------- detail pass
  // arch intrados: soffit panels spanning between the two ribs, gusset
  // plates under each node and a voussoir keystone at the crown
  for (let i = 0; i < N; i++) {
    const x = -af + (2 * af * i) / N;
    const y = archAt(x);
    k.box(1.4, 0.5, RIB_Z * 2 - 3.2, 'graniteGrey', x, y - 1.5, 0);
    if (i % 3 === 0) k.box(2.6, 0.7, 1.2, 'graniteLight', x, y - 2.0, -RIB_Z);
  }
  k.box(3.4, 1.6, 2.0, 'graniteLight', 0, archAt(0) - 0.4, 0);
  // spandrel capitals and pier footings
  for (const z of [-RIB_Z, RIB_Z]) {
    for (let i = 1; i < N; i += 2) {
      const x = -af + (2 * af * i) / N;
      const y = archAt(x);
      if (y < DECK_Y - 3) k.box(2.0, 0.5, 2.0, 'graniteLight', x, DECK_Y - 2.6, z);
    }
  }
  for (const s of [-1, 1]) {
    for (const sz of [-1, 1]) k.box(6, 1.4, 6, 'graniteGrey', s * (half - 3), 0, sz * (DECK_W / 2 - 4));
  }
  // drainage downpipes under the deck edge and an inspection gantry
  for (let i = 0; i < 8; i++) {
    const x = -half + (span * (i + 0.5)) / 8;
    k.box(0.35, 4.0, 0.35, 'graniteGrey', x, DECK_Y - 8.2, DECK_W / 2 - 0.6);
  }
  k.box(3.2, 0.25, DECK_W - 4, 'steel', -af + 8, DECK_Y - 6.0, 0);

  k.pop();
  k.end('main');
}

builder.metric = true;
builder.rule = {
  note: 'Ponte da Arrábida: 493 m total, 270 m concrete arch, deck ~70 m, four lanes',
  frame: { x0: -TOTAL / 2, x1: TOTAL / 2, z0: -DECK_W, z1: DECK_W, y0: 0 },
};

export default { 'ponte-arrabida': builder };
