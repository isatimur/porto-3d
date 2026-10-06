// Ponte do Freixo (1995) — the low-level motorway crossing of the Douro
// (A20 / IP1 / E01), the most upstream of Porto's bridges. Real data:
// total ~747 m (OSM corridor 742.3 m), eight spans, main span 150 m, eight
// traffic lanes, and in fact two parallel portal-frame bridges set side by
// side just 10 cm apart. The deck sits far lower than every other Porto–Gaia
// bridge (~35 m here).
import { bbox } from '../geom.js';

const TOTAL = 742.3;    // OSM corridor length (real ~747 m)
const DECK_Y = 35;      // deck top, dims height 35
const HALF_DECK = 18.2; // one of the two parallel decks
const GAP = 0.1;        // the 10 cm between the two bridges
const MAIN = 150;
const A_MAX = 2 * (HALF_DECK / 2 + GAP / 2) + HALF_DECK; // 36.5 m overall

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

function builder(k, site) {
  const { span, ang } = readFrame(site, TOTAL);
  const half = span / 2;
  const dz = HALF_DECK / 2 + GAP / 2;   // centre of each deck: +-9.15 m
  const river = MAIN / 2;

  // Pier positions: a 150 m main span between the two river piers, then three
  // approach spans to the west and four to the east (eight in all).
  const west = [-274.1, -174.6, -river];
  const east = [river, 149.7, 224.4, 299.1];
  const piers = [...west, ...east];

  k.begin('main');
  k.push({ ry: ang });

  // --- the two parallel portal-frame decks, 10 cm apart
  for (const s of [-1, 1]) {
    const z = s * dz;
    k.box(span, 1.6, HALF_DECK, 'graniteGrey', 0, DECK_Y - 1.6, z);
    k.box(span, 0.5, HALF_DECK - 4, 'sand', 0, DECK_Y - 0.5, z);
    // edge and inner parapets
    for (const e of [-1, 1]) {
      const pe = z + e * (HALF_DECK / 2 - 0.25);
      k.box(span, 0.9, 0.5, 'graniteLight', 0, DECK_Y, pe);
      k.box(span, 0.12, 0.12, 'steel', 0, DECK_Y + 1.25, pe);
      k.box(span, 0.1, 0.1, 'steel', 0, DECK_Y + 0.7, pe);
      const posts = 72;
      for (let i = 0; i < posts; i++) {
        const px = -half + ((i + 0.5) * span) / posts;
        k.box(0.14, 1.0, 0.14, 'steel', px, DECK_Y + 0.9, pe);
      }
    }
    // four lanes of dashed markings on each deck
    for (const lz of [-6.2, -2.1, 2.1, 6.2]) {
      const dashes = 74;
      for (let i = 0; i < dashes; i++) {
        const px = -half + ((i + 0.5) * span) / dashes;
        k.box(3.2, 0.05, 0.18, 'white', px, DECK_Y + 0.02, z + lz);
      }
    }
  }
  // --- the seam between the two bridges
  k.box(span, 0.4, GAP + 0.4, 'graniteDark', 0, DECK_Y - 0.4, 0);

  // --- portal-frame piers: for each deck two legs and a cap beam
  for (const px of piers) {
    const inRiver = Math.abs(Math.abs(px) - river) < 1;
    const h = DECK_Y - 1.6 - 1.2;
    for (const s of [-1, 1]) {
      const z = s * dz;
      for (const e of [-1, 1]) {
        const legs = inRiver ? 4.2 : 3.0;
        const depth = inRiver ? 4.5 : 3.2;
        k.box(legs, h, depth, 'graniteGrey', px, 0, z + e * (HALF_DECK / 2 - 3.4));
      }
      k.box(5.5, 1.4, HALF_DECK - 2.5, 'graniteGrey', px, h, z);
      k.box(7.0, 1.0, HALF_DECK - 1, 'graniteLight', px, 0, z);
      k.box(1.0, 0.6, HALF_DECK - 4, 'graniteDark', px, h - 3.0, z);
    }
  }

  // --- abutments, kept inside the corridor
  for (const s of [-1, 1]) {
    const ex = s * (half - 5);
    k.box(8, DECK_Y - 2.5, 2 * dz + HALF_DECK, 'graniteDark', ex, 0, 0);
    k.box(9.5, 1.2, 2 * dz + HALF_DECK, 'graniteLight', ex, DECK_Y - 2.5, 0);
  }

  // --- detail pass: pier cap bearings, scuppers and deck lighting
  for (const px of piers) {
    for (const s of [-1, 1]) {
      k.box(6.5, 0.5, 2.0, 'graniteDark', px, DECK_Y - 2.1, s * dz);
    }
  }
  for (const s of [-1, 1]) k.box(span, 0.15, 0.15, 'steel', 0, DECK_Y + 1.3, s * (2 * dz - 0.6));
  for (let i = 0; i < 16; i++) {
    const px = -half + ((i + 0.5) * span) / 16;
    for (const s of [-1, 1]) {
      // low lamp posts on the median rail (1.5 m): the old 2.8 m posts took the
      // model to 39.5 m against the 35 m deck-level height of
      // data/dimensions.json (12.7 %)
      k.box(0.14, 1.5, 0.14, 'steel', px, DECK_Y + 1.5, s * (2 * dz - 1.0));
      k.box(0.9, 0.16, 0.26, 'window', px + s * 0.4, DECK_Y + 2.9, s * (2 * dz - 1.0), { emit: 0.5 });
    }
  }

  k.pop();
  k.end('main');
}

builder.metric = true;
builder.rule = {
  note: 'Ponte do Freixo: ~747 m (OSM 742.3 m), eight spans, 150 m main span, eight lanes in two portal-frame decks 10 cm apart, low ~35 m deck',
  extent: { box: { x0: -A_MAX / 2, x1: A_MAX / 2, z0: -TOTAL / 2, z1: TOTAL / 2 } },
  frame: { x0: -HALF_DECK - 2, x1: HALF_DECK + 2, z0: -TOTAL / 2, z1: TOTAL / 2, y0: 0 },
};

export default { 'ponte-freixo': builder };
