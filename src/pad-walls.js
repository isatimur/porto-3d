// Retaining walls under the edge of a landmark pad.
//
// A pad (terrain.js addPad, src/fit.js padFor) builds up at most fillMax of
// ground (2.5 m). Where the pad's plane stands higher than the ground it may
// build, the model's own floor would hang in the air over a slope (the Palacio
// de Cristal terrace over the Douro cliff, a church platform on a hillside).
// This draws the missing face: a stone wall along the pad's edge, from the
// plane down to the ground at the edge, wherever that is more than 2 m. All
// walls are one mesh, one draw call, a few hundred triangles per pad.
import * as THREE from 'three';

const STEP_U = 2; // world units between samples along an edge (8 m)
const MIN_WALL_M = 2;

export function buildPadWalls(terrain, { S = 0.25 } = {}) {
  const { pads, heightAt } = terrain;
  const pos = [];
  const nor = [];
  const col = [];
  const idx = [];
  const minH = MIN_WALL_M * S;
  let walls = 0;
  for (const p of pads) {
    if (p.yAt || p.fillMax === undefined || !Number.isFinite(p.y)) continue; // only plain level pads
    // the four edges, walked counter-clockwise: [from (u, v), to (u, v), outward (u, v)]
    const edges = [
      [[-p.hu, -p.hv], [p.hu, -p.hv], [0, -1]],
      [[p.hu, -p.hv], [p.hu, p.hv], [1, 0]],
      [[p.hu, p.hv], [-p.hu, p.hv], [0, 1]],
      [[-p.hu, p.hv], [-p.hu, -p.hv], [-1, 0]],
    ];
    for (const [a, b, out] of edges) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(len / STEP_U));
      // outward normal in world axes: u -> (ux, uz), v -> (-uz, ux)
      const nx = out[0] * p.ux - out[1] * p.uz;
      const nz = out[0] * p.uz + out[1] * p.ux;
      let prev = null;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const u = a[0] + (b[0] - a[0]) * t;
        const v = a[1] + (b[1] - a[1]) * t;
        const x = p.cx + u * p.ux - v * p.uz;
        const z = p.cz + u * p.uz + v * p.ux;
        const ground = heightAt(x, z);
        const h = p.y - ground;
        const cur = { x, z, ground, top: Math.max(p.y, ground), h };
        if (prev && (prev.h > minH || cur.h > minH)) {
          // foot 0.6 m into the ground, top at the plane
          const base = pos.length / 3;
          for (const q of [prev, cur]) {
            pos.push(q.x, q.ground - 0.15, q.z, q.x, q.top, q.z);
            nor.push(nx, 0, nz, nx, 0, nz);
            // dark at the foot, light under the coping, a little mottling by position
            const m = 0.9 + 0.1 * Math.sin(q.x * 0.9 + q.z * 1.3);
            col.push(0.3 * m, 0.285 * m, 0.26 * m, 0.5 * m, 0.48 * m, 0.44 * m);
          }
          idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
          walls++;
        }
        prev = cur;
      }
    }
  }
  if (!walls) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  mat.name = 'pad-walls';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'pad-walls';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.stats = { segments: walls, tris: idx.length / 3 };
  return mesh;
}
