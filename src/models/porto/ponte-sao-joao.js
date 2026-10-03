// Ponte de São João (1991) — the Linha do Norte railway crossing of the Douro.
// Not an arch: a continuous multi-span frame on vertical piers, prestressed
// concrete. Real data: total ~1147 m (OSM corridor 1143.7 m), main span
// 250 m, two side spans of 125 m, two piers standing in the river bed, deck
// about 66 m above the water. Trapezoidal two-cell box girder, 4 m deep on the
// approach viaducts, 14 m over the river piers, 7 m at mid-span; two tracks
// directly on the top slab, porous-concrete derailment strip.
import { bbox } from '../geom.js';

const TOTAL = 1143.7;   // OSM corridor length (real total ~1147 m)
const MAIN = 250;
const SIDE = 125;
const DECK_W = 13;      // deck width, across the bridge
const A_MAX = 14;       // widest drawn element across the bridge
const TOP = 66;         // deck top above the base (river bed), dims height 66
const PIER_W = 10;      // river pier, along the bridge
const PIER_D = 12;      // river pier, across the bridge
const APPROACH_W = 5.5;
const APPROACH_D = 9;

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

// Frame depth: 7 m at mid main span, 14 m over the river piers, tapering to
// 4 m on the approach viaducts.
function girderDepth(x, river, half) {
  const ax = Math.abs(x);
  if (ax <= river) return 7 + 7 * (ax / river) * (ax / river);
  const t = Math.min(1, (ax - river) / Math.max(1, half - river));
  return 14 - 10 * t;
}

function builder(k, site) {
  const { span, ang } = readFrame(site, TOTAL);
  const half = span / 2;
  const river = MAIN / 2;
  const deckBot = (x) => TOP - 1.4 - girderDepth(x, river, half);

  k.begin('main');
  k.push({ ry: ang });

  // --- continuous box girder under the deck: drawn in vertical slices
  const N = 72;
  for (let i = 0; i < N; i++) {
    const x0 = -half + (span * i) / N;
    const x1 = -half + (span * (i + 1)) / N;
    const xm = (x0 + x1) / 2;
    const seg = x1 - x0 + 0.15;
    const d = girderDepth(xm, river, half);
    k.box(seg, d, DECK_W - 4.2, 'graniteGrey', xm, TOP - 1.4 - d, 0);
    // a stiffening rib under every slice
    k.box(seg, 0.5, DECK_W - 6.0, 'graniteDark', xm, TOP - 1.9 - d, 0);
  }
  // --- top slab (the two tracks sit directly on it)
  k.box(span, 1.4, DECK_W, 'graniteGrey', 0, TOP - 1.4, 0);
  // porous-concrete strip between and beside the rails
  k.box(span, 0.5, DECK_W - 3.6, 'sand', 0, TOP - 0.5, 0);

  // --- parapets and railings on both edges
  for (const s of [-1, 1]) {
    const z = s * (DECK_W / 2 - 0.15);
    k.box(span, 0.7, 0.4, 'graniteGrey', 0, TOP - 0.1, z);
    k.box(span, 0.12, 0.12, 'steel', 0, TOP + 1.3, z);
    k.box(span, 0.1, 0.1, 'steel', 0, TOP + 0.7, z);
    const posts = 76;
    for (let i = 0; i < posts; i++) {
      const px = -half + ((i + 0.5) * span) / posts;
      k.box(0.12, 1.4, 0.12, 'steel', px, TOP, z);
    }
  }

  // --- two tracks: rails and sleepers
  for (const cz of [-2.0, 2.0]) {
    for (const rz of [-0.72, 0.72]) {
      k.box(span, 0.16, 0.14, 'iron', 0, TOP + 0.08, cz + rz);
    }
    const sleepers = Math.round(span / 2.6);
    for (let i = 0; i < sleepers; i++) {
      const px = -half + ((i + 0.5) * span) / sleepers;
      k.box(0.5, 0.14, 2.4, 'wood', px, TOP, cz);
    }
  }

  // --- two river piers, each on a caisson and a 130 micro-pile footprint
  for (const s of [-1, 1]) {
    const px = s * river;
    const top = deckBot(px);
    k.box(PIER_W + 2, 2.2, PIER_D + 2, 'graniteDark', px, 0, 0);
    k.box(PIER_W, top - 2.2, PIER_D, 'graniteDark', px, 2.2, 0);
    k.frustum(PIER_W + 2, PIER_D + 2, PIER_W + 0.5, PIER_D - 1.5, 3.0, 'graniteGrey', px, top - 3.0, 0);
  }

  // --- approach viaducts: paired columns under the deck
  const inner = river + SIDE;
  const outer = half - 8;
  for (const s of [-1, 1]) {
    const count = Math.max(1, Math.round((outer - inner) / 40));
    for (let i = 0; i < count; i++) {
      const px = s * (inner + ((i + 0.5) * (outer - inner)) / count);
      const top = deckBot(px) - 0.2;
      for (const sz of [-1, 1]) {
        k.box(APPROACH_W, top, APPROACH_D, 'graniteGrey', px, 0, sz * (DECK_W / 2 - APPROACH_D / 2 - 0.6));
      }
      k.box(APPROACH_W + 1.6, 1.4, DECK_W - 1.2, 'graniteGrey', px, top, 0);
      k.box(APPROACH_W + 2.4, 1.0, DECK_W + 1, 'graniteLight', px, 0, 0);
    }
    // abutment at the end of the viaduct (kept inside the corridor)
    const ex = s * (half - 5.5);
    k.box(9, TOP - 6, DECK_W + 1, 'graniteDark', ex, 0, 0);
    k.box(10, 1.4, DECK_W + 1, 'graniteLight', ex, TOP - 6, 0);
  }

  k.pop();
  k.end('main');
}

builder.metric = true;
builder.rule = {
  note: 'Ponte de São João: ~1147 m (OSM 1143.7 m) continuous concrete frame, 250 m main span + 2x125 m, deck 66 m, two river piers',
  extent: { box: { x0: -A_MAX / 2, x1: A_MAX / 2, z0: -TOTAL / 2, z1: TOTAL / 2 } },
  frame: { x0: -DECK_W, x1: DECK_W, z0: -TOTAL / 2, z1: TOTAL / 2, y0: 0 },
};

export default { 'ponte-sao-joao': builder };
