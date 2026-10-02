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
import { Kit, PALETTE, MAT, triangleCount } from './models/kit.js';
import { blockBuilders } from './models/porto/block.js';
// Detailed 1:1 builders (one file per landmark, { [id]: builder }).
import ponteLuisI from './models/porto/ponte-luis-i.js';
import ponteArrabida from './models/porto/ponte-arrabida.js';
import ponteMariaPia from './models/porto/ponte-maria-pia.js';
import clerigos from './models/porto/clerigos.js';
import sePorto from './models/porto/se-porto.js';
import bolsa from './models/porto/bolsa.js';
import saoBento from './models/porto/sao-bento.js';
import lello from './models/porto/lello.js';
import casaMusica from './models/porto/casa-musica.js';
import serralves from './models/porto/serralves.js';
import dragao from './models/porto/dragao.js';
import mercadoBolhao from './models/porto/mercado-bolhao.js';
import carmo from './models/porto/carmo.js';
import uportoReitoria from './models/porto/uporto-reitoria.js';
import saoFranciscoPorto from './models/porto/sao-francisco-porto.js';
import ribeira from './models/porto/ribeira.js';
import felgueiras from './models/porto/felgueiras.js';
import cavesGaia from './models/porto/caves-gaia.js';
import aliados from './models/porto/aliados.js';
import palacioCristal from './models/porto/palacio-cristal.js';

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
};

const DETAILED = {
  ...ponteLuisI,
  ...ponteArrabida,
  ...ponteMariaPia,
  ...clerigos,
  ...sePorto,
  ...bolsa,
  ...saoBento,
  ...lello,
  ...casaMusica,
  ...serralves,
  ...dragao,
  ...mercadoBolhao,
  ...carmo,
  ...uportoReitoria,
  ...saoFranciscoPorto,
  ...ribeira,
  ...felgueiras,
  ...cavesGaia,
  ...aliados,
  ...palacioCristal,
};
const BUILDERS = { ...blockBuilders(Object.keys(LANDMARK_SPECS)), ...DETAILED };

const TYPE_DEFAULT = Object.fromEntries(Object.entries(LANDMARK_SPECS).map(([id, s]) => [s.type, id]));
export const MODEL_TYPES = Object.keys(TYPE_DEFAULT);

// Kept for the shared engine (src/main.js): one city per project, nothing to load.
export function registerModels({ builders = {}, specs = {} } = {}) {
  Object.assign(BUILDERS, builders);
  Object.assign(LANDMARK_SPECS, specs);
}
export async function loadCityModels() {
  return null;
}

function resolve(type, landmarkId) {
  if (landmarkId && BUILDERS[landmarkId]) return landmarkId;
  if (TYPE_DEFAULT[type]) return TYPE_DEFAULT[type];
  return 'clerigos';
}

export function specFor(landmarkId, type) {
  return LANDMARK_SPECS[landmarkId] ?? LANDMARK_SPECS[resolve(type, landmarkId)] ?? { h: 50, yaw: 0 };
}

export function isMetric(type, landmarkId) {
  return !!BUILDERS[resolve(type, landmarkId)].metric;
}

// Fit rules a builder carries with it (builder.rule, see fit.js FIT_RULES).
export function builderRule(type, landmarkId) {
  return BUILDERS[resolve(type, landmarkId)].rule || {};
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// site: { footprint, dims } for metric builders.
export function buildModel(type, landmarkId, site = null) {
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
