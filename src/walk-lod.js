// Walk-mode level of detail (porto-034, stage 1a of the walk performance
// plan). The engine was made for the map from above; at street level it drew
// most of the city at full detail. While walk mode is on, main.js applies
// one walk profile (see walkProfile there) and reverts it on every exit:
//   - the streamed ring (tiles.js) and the MS buildings (buildings-ms.js)
//     load within WALK_TIERS.radiusM of the walker, build the far boxes from
//     nearM and the roof-only houses from vfarM; the OSM core
//     (buildings.js) takes the same roof-only distance;
//   - the camera far plane is FAR_U, and the fog shader (scene.js) fades
//     everything into the fog colour from 0.6 to 0.95 of it;
//   - shadows: only meshes within CAST_M of the walker cast (walkCasts).
// ?walklod=0 keeps the old behaviour in walk mode.
import * as THREE from 'three';
import { S } from './geo.js';

export const WALK_FAR_U = 1250; // 5 km (the map: 16000 units, 64 km)
export const WALK_TIERS = { radiusM: 1500, nearM: 1000, vfarM: 1500 };
const CAST_M = 400;

// Shared state: main.js sets `on` and the walker's position (world units).
export const WALK_LOD = { on: false, x: 0, z: 0 };

// The tier distances in world units for tiles.js and buildings-ms.js.
export const walkTiersU = () => ({ radiusU: WALK_TIERS.radiusM * S, nearU: WALK_TIERS.nearM * S, vfarU: WALK_TIERS.vfarM * S });

const _s = new THREE.Sphere();
// The one "does this mesh cast a shadow" rule in walk mode: its bounding
// sphere comes within CAST_M of the walker (15 % hysteresis, kept on the
// mesh). Outside walk mode it is always true, so callers write
// `cast && walkCasts(m)` and the map keeps its own rules.
export function walkCasts(mesh) {
  if (!WALK_LOD.on) return true;
  const g = mesh.geometry;
  if (!g) return false;
  if (!g.boundingSphere) g.computeBoundingSphere();
  _s.copy(g.boundingSphere).applyMatrix4(mesh.matrixWorld);
  const d = Math.hypot(_s.center.x - WALK_LOD.x, _s.center.z - WALK_LOD.z) - _s.radius;
  const lim = CAST_M * S * (mesh.userData.walkCast ? 1.15 : 1);
  return (mesh.userData.walkCast = d < lim);
}
