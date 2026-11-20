// The optional map layers: what each one is, which files it fetches, and
// which device classes get it by default. No DOM here: the unit tests and
// scripts/layers-manifest.mjs import this file in Node. Ported from
// braga-3d (its final state after the owner's decisions of 2026-11-18),
// which took it from lisboa-3d.
//
// The core always loads: the terrain (the whole DEM, ring included), the
// roads and street lines of roads.json, the OSM buildings of the core, the
// landmarks and bridges, the river and the coast, the trees, the routes, the
// history routes, the story, and the trams, trains, boats and street life
// that life.js builds from code.
// Every layer below can be switched off: then its files are never requested.
// Sizes are not written here; they are measured from the built files by
// scripts/layers-manifest.mjs into <data_dir>/layers.json, which the Layers
// panel reads at run time.
//
//   files     paths under dist/ (a trailing /** means every file below)
//   chunks    hashed bundle chunks in dist/static, matched by name prefix
//   streamed  the bytes depend on where the camera goes: the size shown is
//             the most it can fetch (every tile)
//   liveExtra live updates from /api come on top and have no fixed size
//   fullOnly  only the Full preset has it (lisboa-3d: the photo textures).
//
// Porto has no street level layer: streetscape.json and pois.json are in the
// city's data_absent, and the street life it does draw is built from code
// that the main chunk already holds, so a switch would save no download. The
// photo textures (art-pack.js) are not a layer yet. The live layer is the
// aircraft of the «Agora» mode and the STCP buses and Metro do Porto trains
// of data/gtfs.

export const LAYERS = [
  {
    id: 'ring',
    name: 'Город вокруг центра',
    hint: 'Кварталы, улицы и вода за пределами центра, по мере движения камеры',
    files: ['data/tiles/**'],
    chunks: ['tile-worker'],
    streamed: true,
  },
  {
    id: 'ms',
    name: 'Дополнительные здания',
    hint: 'Дома из Microsoft Building Footprints там, где в OSM пусто',
    files: ['data/buildings-ms.json', 'data/tiles-ms/**'],
    streamed: true,
  },
  {
    id: 'live',
    name: 'Самолёты, автобусы и метро',
    hint: 'Самолёты в реальном времени, автобусы STCP и метро по расписанию',
    files: ['data/gtfs/**'],
    chunks: ['liveair', 'livebus'],
    liveExtra: true,
  },
];

export const LAYER_IDS = LAYERS.map((l) => l.id);

// Full is what the map loaded before layers existed: every layer. Standard
// is every layer but the fullOnly ones.
export const PRESETS = {
  light: [],
  // the phone default (owner decision, 2026-11-18): the extra buildings and
  // the street level where the map has one (Porto has no such layer); no ring, no
  // live data, no textures
  compact: ['ms'],
  standard: LAYERS.filter((l) => !l.fullOnly).map((l) => l.id),
  full: [...LAYER_IDS],
};
const samePreset = (a, b) => a.length === b.length && a.every((id) => b.includes(id));
// the presets the panel offers: one that equals a preset already offered is
// left out (a second button for the same layers, and presetOf could never
// name the later one). Full is always offered. Porto: Standard equals Full.
export const PRESET_ORDER = ['light', 'compact', 'standard', 'full'].filter(
  (p, i, all) => p === 'full' || (!samePreset(PRESETS[p], PRESETS.full) && !all.slice(0, i).some((q) => samePreset(PRESETS[q], PRESETS[p]))),
);

// device class (perf-classes.js) -> default preset (owner decision,
// 2026-11-18: phones of the S and P classes start Compact)
export const CLASS_PRESET = { XL: 'full', L: 'full', M: 'standard', S: 'compact', P: 'compact' };

const fromList = (list) => Object.fromEntries(LAYER_IDS.map((id) => [id, list.includes(id)]));

export function presetLayers(preset) {
  return fromList(PRESETS[preset] || PRESETS.standard);
}

export function defaultsFor(cls) {
  return presetLayers(CLASS_PRESET[cls] || 'standard');
}

// one of PRESET_ORDER, or 'custom'
export function presetOf(layers) {
  for (const p of PRESET_ORDER) {
    const want = PRESETS[p];
    if (LAYER_IDS.every((id) => !!layers?.[id] === want.includes(id))) return p;
  }
  return 'custom';
}

// The saved record (localStorage) is { v: 1, layers: { id: bool } }. It is
// merged over the class defaults: a layer added later gets its default.
export function resolveSelection(savedText, cls) {
  const layers = defaultsFor(cls);
  let saved = null;
  try {
    saved = savedText ? JSON.parse(savedText) : null;
  } catch {
    saved = null;
  }
  const rec = saved && typeof saved === 'object' && !Array.isArray(saved) && saved.layers && typeof saved.layers === 'object' ? saved.layers : null;
  let used = false;
  if (rec) {
    for (const id of LAYER_IDS) {
      if (typeof rec[id] === 'boolean') {
        layers[id] = rec[id];
        used = true;
      }
    }
  }
  return { layers, source: used ? 'saved' : 'default' };
}

export const serializeSelection = (layers) => JSON.stringify({ v: 1, layers: fromList(LAYER_IDS.filter((id) => layers[id])) });

// ?layers=light|compact|standard|full or ?layers=ring,ms (tests, measurements)
export function urlSelection(search) {
  const v = new URLSearchParams(search || '').get('layers');
  if (v == null) return null;
  if (PRESETS[v]) return presetLayers(v);
  const list = v.split(',').map((s) => s.trim());
  if (v !== 'none' && !list.some((id) => LAYER_IDS.includes(id))) return null;
  return fromList(list);
}

// The measured bytes of a selection. A switched-on layer the manifest does
// not list makes the total unknown (shown as such, never as 0).
export function selectionBytes(layers, manifest) {
  let bytes = 0;
  let unknown = false;
  for (const id of LAYER_IDS) {
    if (!layers?.[id]) continue;
    const b = manifest?.layers?.[id]?.bytes;
    if (Number.isFinite(b)) bytes += b;
    else unknown = true;
  }
  return { bytes, unknown };
}

// 1.8 MB (en) / 1,8 MB (pt, es, de) / 1,8 Mo (fr) / 1,8 МБ (ru); under 1 MB
// in whole KB. Decimal units (1 MB = 1,000,000 bytes), as browsers and phone
// settings show download sizes.
const UNITS = { ru: ['КБ', 'МБ'], fr: ['Ko', 'Mo'] };
export function formatMB(bytes, lang = 'en') {
  if (!Number.isFinite(bytes)) return '?';
  const [kb, mb] = UNITS[lang] || ['KB', 'MB'];
  const comma = lang !== 'en';
  if (bytes < 1e6) return `${Math.round(bytes / 1e3)} ${kb}`;
  const n = (bytes / 1e6).toFixed(1);
  return `${comma ? n.replace('.', ',') : n} ${mb}`;
}
