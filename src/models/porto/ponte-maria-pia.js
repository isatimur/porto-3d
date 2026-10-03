// Ponte Maria Pia (1877, Gustave Eiffel) — single-track railway arch over the
// Douro. Real dimensions: total length ~353 m, central arch span ~160 m, deck
// ~60 m above the water; two slender near-semicircular lattice ribs, X-lattice
// spandrels up to the deck and six lattice piers per approach.
import { bbox } from '../geom.js';

const TOTAL = 353;
const ARCH = 160;
const DECK_Y = 60;
const DECK_W = 8;
const RIB_Z = 2.8;

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

// Circular arc through (-half,spring), (0,spring+rise), (half,spring).
function arcAt(x, half, springY, rise) {
  const R = (rise * rise + half * half) / (2 * rise);
  const cy = springY + rise - R;
  return cy + Math.sqrt(Math.max(0, R * R - x * x));
}

function builder(k, site) {
  const { span, ang } = readFrame(site, TOTAL);
  const half = span / 2;
  const af = Math.min(ARCH / 2, span * 0.23);
  const springY = 2;
  const rise = 50;
  const archAt = (x) => arcAt(x, af, springY, rise);
  const N = 28;

  k.begin('main');
  k.push({ ry: ang });

  // --- the two arch ribs
  for (const z of [-RIB_Z, RIB_Z]) {
    let prev = [-af, archAt(-af), z];
    for (let i = 1; i <= N; i++) {
      const x = -af + (2 * af * i) / N;
      const p = [x, archAt(x), z];
      k.segment(prev, p, 1.5, 1.2, 'iron', { ext: 0.2 });
      prev = p;
    }
  }

  // --- vertical spandrel posts and X-lattice between the ribs
  for (const z of [-RIB_Z, RIB_Z]) {
    for (let i = 1; i < N; i += 2) {
      const x = -af + (2 * af * i) / N;
      const y = archAt(x);
      if (y < DECK_Y - 2) k.segment([x, y, z], [x, DECK_Y, z], 0.45, 0.45, 'iron');
    }
  }
  for (let i = 0; i + 2 <= N; i += 2) {
    const x0 = -af + (2 * af * i) / N;
    const x1 = -af + (2 * af * (i + 2)) / N;
    k.segment([x0, archAt(x0), -RIB_Z], [x1, DECK_Y, RIB_Z], 0.3, 0.3, 'iron');
    k.segment([x0, archAt(x0), RIB_Z], [x1, DECK_Y, -RIB_Z], 0.3, 0.3, 'iron');
  }

  // --- cross bracing between the arch ribs
  for (let i = 0; i <= N; i += 2) {
    const x = -af + (2 * af * i) / N;
    const y = archAt(x);
    k.segment([x, y, -RIB_Z], [x, y, RIB_Z], 0.4, 0.4, 'iron');
  }
  for (let i = 0; i + 2 <= N; i += 2) {
    const x0 = -af + (2 * af * i) / N;
    const x1 = -af + (2 * af * (i + 2)) / N;
    const y0 = archAt(x0);
    const y1 = archAt(x1);
    k.segment([x0, y0, -RIB_Z], [x1, y1, RIB_Z], 0.28, 0.28, 'iron');
    k.segment([x0, y0, RIB_Z], [x1, y1, -RIB_Z], 0.28, 0.28, 'iron');
  }

  // --- rail deck: track slab, guard railings and two running rails
  k.box(span, 0.8, DECK_W, 'steel', 0, DECK_Y - 0.8, 0);
  k.box(span, 0.5, DECK_W + 0.5, 'steel', 0, DECK_Y - 1.3, 0);
  for (const s of [-1, 1]) {
    const z = s * (DECK_W / 2 - 0.1);
    k.box(span, 0.12, 0.35, 'iron', 0, DECK_Y - 0.02, z);
    k.box(span, 0.1, 0.1, 'iron', 0, DECK_Y + 1.15, z);
    for (let i = 0; i < 16; i++) {
      const px = -half + ((i + 0.5) * span) / 16;
      k.box(0.1, 1.15, 0.1, 'iron', px, DECK_Y - 0.02, z);
    }
  }
  for (const z of [-1.5, 1.5]) k.box(span, 0.16, 0.16, 'steel', 0, DECK_Y + 0.06, z);

  // --- lattice approach piers and end abutments
  const inner = af + 6;
  const outer = half - 5;
  for (const s of [-1, 1]) {
    for (let p = 0; p < 6; p++) {
      const x = s * (inner + ((p + 0.5) * (outer - inner)) / 6);
      k.box(5.5, 1, DECK_W + 0.6, 'iron', x, DECK_Y - 1.6, 0);
      for (const sz of [-1, 1]) {
        const z = sz * (DECK_W / 2 - 0.4);
        k.box(0.5, DECK_Y - 1.5, 0.5, 'iron', x - 2, 0, z);
        k.box(0.5, DECK_Y - 1.5, 0.5, 'iron', x + 2, 0, z);
      }
      for (let l = 0; l < 4; l++) {
        const y0 = (DECK_Y - 3) * (l / 4);
        const y1 = (DECK_Y - 3) * ((l + 1) / 4);
        for (const sz of [-1, 1]) {
          k.segment([x - 2, y0, sz * (DECK_W / 2 - 0.4)], [x + 2, y1, sz * (DECK_W / 2 - 0.4)], 0.25, 0.25, 'iron');
          k.segment([x + 2, y0, sz * (DECK_W / 2 - 0.4)], [x - 2, y1, sz * (DECK_W / 2 - 0.4)], 0.25, 0.25, 'iron');
        }
      }
    }
    const ex = s * (half - 2.5);
    k.box(7, DECK_Y - 1.5, DECK_W + 1.5, 'graniteDark', ex, 0, 0);
    k.box(9, 1.4, DECK_W + 2.5, 'graniteLight', ex, DECK_Y - 1.5, 0);
  }

  // ---------------------------------------------------------- detail pass
  // permanent way: sleepers, rail chairs and a pair of running rails
  for (let i = 0; i < 60; i++) {
    const x = -half + ((i + 0.5) * span) / 60;
    k.box(0.9, 0.22, DECK_W - 0.6, 'wood', x, DECK_Y - 0.02, 0);
  }
  for (const z of [-1.5, 1.5]) {
    for (let i = 0; i < 30; i++) k.box(0.24, 0.3, 0.5, 'iron', -half + ((i + 0.5) * span) / 30, DECK_Y + 0.2, z);
  }
  // gusset plates at the lattice nodes and masonry pier footings
  for (let i = 0; i + 2 <= N; i += 2) {
    const x0 = -af + (2 * af * i) / N;
    const y0 = archAt(x0);
    k.box(1.6, 1.6, 1.6, 'iron', x0, y0 - 0.8, -RIB_Z);
    k.box(1.6, 1.6, 1.6, 'iron', x0, y0 - 0.8, RIB_Z);
  }
  for (const s of [-1, 1]) {
    for (let p = 0; p < 6; p++) {
      const x = s * (inner + ((p + 0.5) * (outer - inner)) / 6);
      for (const sz of [-1, 1]) k.box(6, 1.6, 4, 'graniteDark', x, 0, sz * (DECK_W / 2 - 0.4));
    }
  }
  // a narrow inspection walkway outboard of the track
  k.box(span, 0.16, 1.1, 'steel', 0, DECK_Y - 0.1, DECK_W / 2 + 0.4);
  for (let i = 0; i < 24; i++) k.box(0.12, 1.0, 0.12, 'iron', -half + ((i + 0.5) * span) / 24, DECK_Y - 0.1, DECK_W / 2 + 0.9);

  k.pop();
  k.end('main');
}

builder.metric = true;
builder.rule = {
  note: 'Ponte Maria Pia: 353 m total, 160 m arch, single-track deck ~60 m',
  frame: { x0: -TOTAL / 2, x1: TOTAL / 2, z0: -DECK_W, z1: DECK_W, y0: 0 },
};

export default { 'ponte-maria-pia': builder };
