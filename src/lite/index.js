// The lite scene (the Potato class): see perf/ARCHITECTURE.md "Lite scene".
// Loaded only when the class asks for it, so the full scene's bundle does not
// carry it.
export { createAtmosphereLite, TIMES as LITE_TIMES } from './atmosphere.js';
export { createGroundLite } from './ground.js';
export { buildRoadsLite } from './roads.js';
export { createCityLite } from './city.js';
export { createSeasonsLite } from './seasons.js';
