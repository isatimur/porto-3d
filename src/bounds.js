// Honest bounds for instanced layers, so three.js can frustum-cull them
// instead of drawing them with `frustumCulled = false` behind the camera.
import * as THREE from 'three';

// A layer refilled with the items within R (world units, horizontal) of
// (cx, cz), their bases between ylo and yhi, scaled up to smax: its bounding
// sphere from those numbers alone, without a pass over the instances.
export function setRingBounds(mesh, cx, cz, R, ylo, yhi, smax = 1) {
  const g = mesh.geometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  // a piece's reach from its own origin, at the largest scale
  const piece = (g.boundingSphere.radius + g.boundingSphere.center.length()) * smax;
  mesh.boundingSphere ??= new THREE.Sphere();
  mesh.boundingSphere.center.set(cx, (ylo + yhi) / 2, cz);
  mesh.boundingSphere.radius = Math.hypot(R, (yhi - ylo) / 2) + piece;
}
