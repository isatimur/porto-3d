// Procedural landmark models for Porto. DOM-free: node can import this file.
//
// buildModel(type, landmarkId, site) returns one merged, non-indexed
// BufferGeometry per landmark (attributes: position, normal, color, aEmit,
// aMat, aUv) plus userData.glass for transparent panes.
//
// Metric builders (builder.metric = true) draw at 1:1 in metres:
//   origin = centre of the OSM outline's box, y = 0 = the base (terrain
//   level at the site, see fit.js), local +z = the main front, +x to the
//   right of a viewer looking at that front.
// site = { footprint, dims }:
//   footprint: the OSM outline and parts in this frame (fit.js siteFrame()),
//     with ground(x, z) = the visible terrain relative to the base;
//   dims: the record of data/dimensions.json for this landmark.
//
// First launch: every landmark uses the generic massing builder (real
// outline, real parts, real heights). Detailed builders replace it one by
// one: add src/models/porto/<name>.js exporting { [id]: builder } and spread
// it into DETAILED below.
//
// The browser does not import this file (it pulls in every builder). The main
// thread reads data/fits.json (src/model-meta.js) and the model worker loads
// builders by group (src/models/loader.js). This file is the whole registry
// for node: scripts/bake-fits.mjs, check-fit.mjs, count-tris.mjs, smoke-rail.mjs.
import { PALETTE, MAT, triangleCount } from './models/kit.js';
import { makeModels } from './model-build.js';
// The builder groups (one file per landmark, { [id]: builder }, merged per group).
import bridges from './models/groups/bridges.js';
import churchesCore from './models/groups/churches-core.js';
import churchesOuter from './models/groups/churches-outer.js';
import civic from './models/groups/civic.js';
import museums from './models/groups/museums.js';
import theatres from './models/groups/theatres.js';
import coast from './models/groups/coast.js';
import parks from './models/groups/parks.js';
import river from './models/groups/river.js';
import stadiums from './models/groups/stadiums.js';
import { specs as portoSpecs } from './models/porto/index.js';

export { PALETTE, MAT, triangleCount };

// Per landmark: model type, legacy target height (unused by metric builders)
// and yaw.
export const LANDMARK_SPECS = {
  clerigos: { type: 'church-tower', h: 76, yaw: 0 },
  lello: { type: 'house', h: 18, yaw: 0 },
  'sao-bento': { type: 'station', h: 20, yaw: 0 },
  'se-porto': { type: 'cathedral', h: 30, yaw: 0 },
  bolsa: { type: 'palace', h: 24, yaw: 0 },
  'sao-francisco-porto': { type: 'church', h: 26, yaw: 0 },
  'ponte-luis-i': { type: 'bridge', h: 60, yaw: 0 },
  ribeira: { type: 'waterfront', h: 16, yaw: 0 },
  serralves: { type: 'museum-villa', h: 10, yaw: 0 },
  'casa-musica': { type: 'concert-hall', h: 26, yaw: 0 },
  dragao: { type: 'stadium', h: 40, yaw: 0 },
  felgueiras: { type: 'lighthouse', h: 12, yaw: 0 },
  'caves-gaia': { type: 'wine-lodge', h: 14, yaw: 0 },
  'ponte-arrabida': { type: 'bridge-arch', h: 70, yaw: 0 },
  'ponte-maria-pia': { type: 'bridge', h: 60, yaw: 0 },
  'mercado-bolhao': { type: 'market', h: 18, yaw: 0 },
  aliados: { type: 'avenue', h: 30, yaw: 0 },
  carmo: { type: 'church', h: 24, yaw: 0 },
  'palacio-cristal': { type: 'park', h: 12, yaw: 0 },
  'uporto-reitoria': { type: 'university', h: 20, yaw: 0 },
  bessa: { type: 'stadium', h: 30, yaw: 0 },
  'teatro-sa-da-bandeira': { type: 'concert-hall', h: 22, yaw: 0 },
  'teatro-nacional-sao-joao': { type: 'concert-hall', h: 26, yaw: 0 },
  'igreja-da-vitoria': { type: 'cathedral', h: 20, yaw: 0 },
  'igreja-carmelitas': { type: 'cathedral', h: 25, yaw: 0 },
  'casa-museu-marta-ortigao-sampaio': { type: 'museum-villa', h: 12, yaw: 0 },
  'mercado-matosinhos': { type: 'market', h: 15, yaw: 0 },
  'camara-matosinhos': { type: 'palace', h: 14, yaw: 0 },
  'farol-leca': { type: 'lighthouse', h: 46, yaw: 0 },
  'paco-episcopal': { type: 'palace', h: 26, yaw: 0 },
};

// Per group, for scripts/bake-fits.mjs (it writes the id -> group table).
export const GROUPS = { bridges, 'churches-core': churchesCore, 'churches-outer': churchesOuter, civic, museums, theatres, coast, parks, river, stadiums };

// Roster-expansion specs (id -> { type, h, yaw }) merged before the derived maps.
Object.assign(LANDMARK_SPECS, portoSpecs);

const DETAILED = Object.assign({}, ...Object.values(GROUPS));
const M = makeModels({ builders: DETAILED, specs: LANDMARK_SPECS });
export const MODEL_TYPES = M.MODEL_TYPES;

// Kept for the shared engine: one city per project, nothing to load.
export function registerModels({ builders = {}, specs = {} } = {}) {
  Object.assign(M.BUILDERS, builders);
  Object.assign(LANDMARK_SPECS, specs);
}
export async function loadCityModels() {
  return null;
}

export const specFor = M.specFor;
export const isMetric = M.isMetric;
export const builderRule = M.builderRule;
export const buildModel = M.buildModel;
// the registry the fit takes as ctx.models (src/fit.js)
export const models = { specFor, builderRule, isMetric, buildModel };
