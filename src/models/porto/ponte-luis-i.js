// Ponte Luís I (1886) — wrought-iron double-deck parabolic arch over the Douro.
// Real dimensions: total length 385 m, central arch span 172 m, lower deck
// ~10 m and upper deck ~60 m above the water. Two parallel arch ribs with
// vertical hangers to the lower deck and columns up to the upper deck,
// granite abutment pylons and masonry approach piers.
import { bbox } from '../geom.js';

const TOTAL = 385;
const ARCH = 172;
const LOW_Y = 10;
const HIGH_Y = 60;
const DECK_W = 14;
const RIB_Z = 5.2;
const PYLON_W = 16;

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
  const af = Math.min(ARCH / 2, span * 0.23);
  const crownY = 52;
  const archAt = (x) => parabola(x, af, LOW_Y, crownY);
  const N = 26;

  k.begin('main');
  k.push({ ry: ang });

  // --- granite abutment pylons
  for (const s of [-1, 1]) {
    const px = s * af;
    k.box(PYLON_W, HIGH_Y + 2, DECK_W + 2, 'graniteDark', px, 0, 0);
    k.box(PYLON_W + 2.5, 1.6, DECK_W + 4, 'graniteLight', px, HIGH_Y + 2, 0);
    k.box(PYLON_W + 1, 0.8, DECK_W + 3, 'graniteLight', px, 1.4, 0);
  }

  // --- the two arch ribs
  for (const z of [-RIB_Z, RIB_Z]) {
    let prev = [(-af), archAt(-af), z];
    for (let i = 1; i <= N; i++) {
      const x = -af + (2 * af * i) / N;
      const p = [x, archAt(x), z];
      k.segment(prev, p, 1.8, 1.6, 'iron', { ext: 0.2 });
      prev = p;
    }
  }

  // --- vertical hangers (arch down to the lower deck)
  for (const z of [-RIB_Z, RIB_Z]) {
    for (let i = 2; i < N - 1; i += 2) {
      const x = -af + (2 * af * i) / N;
      const y = archAt(x);
      if (y > LOW_Y + 2) k.segment([x, y, z], [x, LOW_Y, z], 0.4, 0.4, 'steel');
    }
  }

  // --- columns from the arch up to the upper deck
  for (const z of [-RIB_Z, RIB_Z]) {
    for (let i = 1; i < N; i += 2) {
      const x = -af + (2 * af * i) / N;
      const y = archAt(x);
      if (y < HIGH_Y - 2) k.segment([x, y, z], [x, HIGH_Y, z], 0.9, 0.9, 'iron');
    }
  }

  // --- cross bracing between the ribs
  for (let i = 0; i <= N; i += 2) {
    const x = -af + (2 * af * i) / N;
    const y = archAt(x);
    k.segment([x, y, -RIB_Z], [x, y, RIB_Z], 0.5, 0.5, 'iron');
  }
  for (let i = 0; i + 2 <= N; i += 2) {
    const x0 = -af + (2 * af * i) / N;
    const x1 = -af + (2 * af * (i + 2)) / N;
    const y0 = archAt(x0);
    const y1 = archAt(x1);
    k.segment([x0, y0, -RIB_Z], [x1, y1, RIB_Z], 0.35, 0.35, 'iron');
    k.segment([x0, y0, RIB_Z], [x1, y1, -RIB_Z], 0.35, 0.35, 'iron');
  }

  // --- decks and railings
  const deck = (y, posts) => {
    k.box(span, 0.9, DECK_W, 'steel', 0, y - 0.9, 0);
    k.box(span, 0.35, DECK_W + 0.6, 'steel', 0, y - 1.25, 0);
    for (const s of [-1, 1]) {
      const z = s * (DECK_W / 2 - 0.2);
      k.box(span, 0.14, 0.5, 'iron', 0, y - 0.05, z);
      k.box(span, 0.12, 0.12, 'iron', 0, y + 1.35, z);
      for (let i = 0; i < posts; i++) {
        const px = -half + ((i + 0.5) * span) / posts;
        k.box(0.12, 1.4, 0.12, 'iron', px, y - 0.05, z);
      }
    }
  };
  deck(LOW_Y, 18);
  deck(HIGH_Y, 18);

  // --- masonry approach piers under the decks
  const inner = af + 9;
  for (const s of [-1, 1]) {
    const outer = half - 4;
    const count = Math.max(1, Math.round((outer - inner) / 42));
    for (let i = 0; i < count; i++) {
      const x = s * (inner + ((i + 0.5) * (outer - inner)) / count);
      const h = HIGH_Y - 1;
      k.box(9, h, DECK_W, 'graniteDark', x, 0, 0);
      k.box(10, 1, DECK_W + 1.5, 'graniteLight', x, h, 0);
      k.box(9.6, 0.7, DECK_W + 1, 'graniteLight', x, 2.2, 0);
    }
  }

  k.pop();
  k.end('main');
}

builder.metric = true;
builder.rule = {
  note: 'Ponte Luís I: 385 m total, 172 m arch, lower deck 10 m / upper deck 60 m',
  frame: { x0: -TOTAL / 2, x1: TOTAL / 2, z0: -DECK_W, z1: DECK_W, y0: 0 },
};

export default { 'ponte-luis-i': builder };
