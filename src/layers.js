// The visitor's layer choice (layer-defs.js) at run time: read once at
// start (?layers= > localStorage > the device class default), changed from
// the Layers panel, saved per city. Listeners get (id, on) for each layer
// that changed; main.js loads or hides the layer without a reload.
// Same as lisboa-3d's.
import { LAYER_IDS, resolveSelection, urlSelection, serializeSelection, presetLayers, presetOf, defaultsFor } from './layer-defs.js';
import { dataPath } from './city.js';
import { assetUrl } from './data.js';

export function createLayers({ cls, cityId }) {
  const KEY = `${cityId || 'city'}-layers`;
  let saved = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    // storage blocked: the class default, not saved
  }
  const fromUrl = urlSelection(location.search);
  const resolved = fromUrl ? { layers: fromUrl, source: 'url' } : resolveSelection(saved, cls);
  const sel = { ...resolved.layers };
  const listeners = new Set();
  let manifest = null;
  let manifestP = null;

  function emit(changes) {
    for (const [id, on] of changes) for (const fn of listeners) fn(id, on);
  }
  function save() {
    try {
      localStorage.setItem(KEY, serializeSelection(sel));
    } catch {
      // not saved; the choice still applies to this visit
    }
  }
  function apply(next) {
    const changes = LAYER_IDS.filter((id) => !!next[id] !== !!sel[id]).map((id) => [id, !!next[id]]);
    for (const [id, on] of changes) sel[id] = on;
    if (changes.length) {
      save();
      emit(changes);
    }
    return changes.length;
  }

  return {
    source: resolved.source,
    cls,
    on: (id) => !!sel[id],
    get selection() {
      return { ...sel };
    },
    get preset() {
      return presetOf(sel);
    },
    get classPreset() {
      return presetOf(defaultsFor(cls));
    },
    set(id, on) {
      return apply({ ...sel, [id]: !!on });
    },
    setPreset(p) {
      return apply(presetLayers(p));
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // <data_dir>/layers.json (scripts/layers-manifest.mjs); null when absent
    loadManifest() {
      manifestP ||= fetch(assetUrl(dataPath('layers.json')))
        .then((r) => (r.ok && (r.headers.get('content-type') || '').includes('json') ? r.json() : null))
        .catch(() => null)
        .then((m) => (manifest = m && typeof m.layers === 'object' ? m : null));
      return manifestP;
    },
    get manifest() {
      return manifest;
    },
  };
}
