// Projection and terrain. DOM-free, so node scripts can import it.
//
// Local equirectangular metres around `origin`:
//   x =  (lon - lon0) * cos(lat0) * 111320     (east)
//   z = -(lat - lat0) * 110574                 (south; north is -z)
// One fixed scale maps metres to world units: 1 world unit = METRES_PER_UNIT
// metres, the same on all three axes. Heights come from the real terrain
// (src/terrain.js), with no vertical exaggeration by default.
import { createTerrain } from './terrain.js';

export const METRES_PER_UNIT = 4;
export const S = 1 / METRES_PER_UNIT; // world units per metre
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320;

// Kept for callers that fitted the map into a box: the map now spans
// about +-1460 x and -690..+840 z world units at the fixed scale.
export const FIT_HALF_EXTENT = 1500;

export function createProjection(origin, bbox, landmarks = [], terrainData = null) {
  const lat0 = origin.lat;
  const lon0 = origin.lon;
  const kx = Math.cos((lat0 * Math.PI) / 180) * M_PER_DEG_LON;

  const toMetres = (lat, lon) => ({ x: (lon - lon0) * kx, z: -(lat - lat0) * M_PER_DEG_LAT });

  // Everything below works in world units.
  const project = (lat, lon) => {
    const m = toMetres(lat, lon);
    return { x: m.x * S, z: m.z * S };
  };

  const terrain = createTerrain(terrainData, toMetres, S);

  let maxAbs = 1;
  const pts = [];
  if (bbox) pts.push(toMetres(bbox.s, bbox.w), toMetres(bbox.n, bbox.e));
  for (const l of landmarks) pts.push(toMetres(l.lat, l.lon));
  for (const p of pts) maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.z));

  return {
    S,
    METRES_PER_UNIT,
    lat0,
    lon0,
    toMetres,
    project,
    terrain,
    heightAt: terrain.heightAt,
    maxAbsMetres: maxAbs,
  };
}
