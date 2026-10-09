// The builder registry logic: which builder draws which landmark, its spec
// and fit rule, and the call that runs it. DOM-free (node and the model
// worker import it). The browser's main thread does NOT import this file:
// it would drag every builder into the critical bundle. It reads the baked
// numbers of data/fits.json instead (src/model-meta.js).
//
// makeModels({ builders, specs }):
//   builders: { [landmarkId]: builder } for the ids that have a detailed one
//   specs:    { [landmarkId]: { type, h, yaw, ... } }
// Ids without a detailed builder get the generic massing block.
import { Kit } from './models/kit.js';
import { blockBuilders } from './models/porto/block.js';

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function makeModels({ builders = {}, specs = {} } = {}) {
  const LANDMARK_SPECS = specs;
  const BUILDERS = { ...blockBuilders(Object.keys(LANDMARK_SPECS)), ...builders };
  let TYPE_DEFAULT = null;
  const typeDefault = () => (TYPE_DEFAULT ||= Object.fromEntries(Object.entries(LANDMARK_SPECS).map(([id, s]) => [s.type, id])));

  function resolve(type, landmarkId) {
    if (landmarkId && BUILDERS[landmarkId]) return landmarkId;
    if (typeDefault()[type]) return typeDefault()[type];
    return 'clerigos';
  }

  function specFor(landmarkId, type) {
    return LANDMARK_SPECS[landmarkId] ?? LANDMARK_SPECS[resolve(type, landmarkId)] ?? { h: 50, yaw: 0 };
  }

  function isMetric(type, landmarkId) {
    return !!BUILDERS[resolve(type, landmarkId)].metric;
  }

  // Fit rules a builder carries with it (builder.rule, see fit.js FIT_RULES).
  function builderRule(type, landmarkId) {
    return BUILDERS[resolve(type, landmarkId)].rule || {};
  }

  // site: { footprint, dims } for metric builders.
  function buildModel(type, landmarkId, site = null) {
    const id = resolve(type, landmarkId);
    const spec = LANDMARK_SPECS[id];
    const fn = BUILDERS[id];
    const k = new Kit(hash(id));
    let g;
    if (fn.metric) {
      fn(k, site);
      g = k.build();
      g.userData.metric = true;
    } else {
      fn(k);
      g = k.build(spec.h);
    }
    g.userData.type = spec.type;
    g.userData.builder = id;
    return g;
  }

  return {
    LANDMARK_SPECS,
    BUILDERS,
    get MODEL_TYPES() {
      return Object.keys(typeDefault());
    },
    resolve,
    specFor,
    isMetric,
    builderRule,
    buildModel,
  };
}
