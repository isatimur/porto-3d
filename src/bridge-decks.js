// The Douro bridges that have an authored 1:1 model (src/models/porto/ponte-*.js).
// Their roads, rails and footways in the street network ride the model's real
// deck height (metres above the river) instead of the engine's "clear the
// water by 2.8 m" rule, and roads.js leaves the engine's slab, parapets and
// piers out (the model draws the structure). DOM-free.
//
// deckM: height of the road / rail surface above the water, per source in
// data/dimensions.json. test(t, kind): picks the OSM ways of that deck.
const near = (t, re) => re.test(t.name || '') || re.test(t.bn || '');

export const BRIDGE_DECKS = [
  {
    id: 'luis-upper',
    ll: [41.13957, -8.60921],
    r: 340,
    deckM: 60,
    test: (t, kind) => near(t, /Luiz I \(tabuleiro superior\)|^Ponte Dom Luís I$/) || (kind === 'rail' && near(t, /Ponte Luiz I/)),
  },
  {
    id: 'luis-lower',
    ll: [41.13957, -8.60921],
    r: 340,
    deckM: 11.2,
    test: (t, kind) => near(t, /Luiz I \(tabuleiro inferior\)/) || (kind === 'foot' && t.sf === 'metal' && t.br && (t.ly || 0) === 1),
  },
  {
    id: 'arrabida',
    ll: [41.14706, -8.64052],
    r: 420,
    deckM: 65,
    test: (t) => near(t, /Ponte da Arr[áa]bida/) || t.br === 'cantilever',
  },
  {
    id: 'infante',
    ll: [41.14106, -8.60168],
    r: 330,
    deckM: 73.8,
    test: (t) => near(t, /Ponte Infante Dom Henrique/) && !!t.br,
  },
  {
    id: 'sao-joao',
    ll: [41.1384, -8.59629],
    r: 700,
    deckM: 55,
    test: (t, kind) => kind === 'rail' && near(t, /Ponte de São João/),
  },
  {
    id: 'freixo',
    ll: [41.14192, -8.5809],
    r: 520,
    deckM: 30,
    test: (t) => near(t, /Ponte do Freixo/) && !!t.br,
  },
];

// The authored deck a way belongs to (or null): its first point must lie
// within the deck's radius of the bridge centre. dist(lat, lon) is the
// distance to a [lat, lon] in metres.
export function authoredDeck(t, kind, lat, lon) {
  for (const d of BRIDGE_DECKS) {
    if (!d.test(t, kind)) continue;
    const m = Math.hypot((lat - d.ll[0]) * 110574, (lon - d.ll[1]) * 111320 * Math.cos((d.ll[0] * Math.PI) / 180));
    if (m <= d.r) return d;
  }
  return null;
}
