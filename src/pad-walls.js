// Retaining walls under the edge of a landmark pad.
//
// A pad (terrain.js addPad, src/fit.js padFor) builds up at most fillMax of
// ground (2.5 m). Where the pad's plane stands higher than the ground it may
// build, the model's own floor would hang in the air over a slope (the Palacio
// de Cristal terrace over the Douro cliff, a church platform on a hillside).
// This draws the missing face: a stone wall along the pad's edge, from the
// plane down to the ground at the edge, wherever that is more than 2 m. All
// walls are one mesh, one draw call, a few hundred triangles per pad.
//
// A wall only stands where the model has a floor at the pad's edge. The pad is
// the model's box, and a garden or a square does not fill its box: the
// Palacio box is the plateau, and its south-west corner, 20 m above the slope,
// holds no lawn. A wall there was a free-standing blade, a long dark wedge
// over the garden. So every wall starts folded flat (top = foot) and stands up
// when the landmark's model is built (reveal, called by src/landmarks.js): a
// segment stands if the model has level ground near the plane within 2.5
// world units inside it. No model, no floor, no wall.
import * as THREE from 'three';

const STEP_U = 2; // world units between samples along an edge (8 m)
const MIN_WALL_M = 2;
const CELL_U = 1; // floor mask cell, world units (4 m)
const FLOOR_TOL_U = 0.75; // a floor lies within 3 m of the pad plane
const FLOOR_NY = 0.6; // and faces up (slope under about 53 degrees)
const REACH_U = [0.5, 1.5, 2.5]; // how far inside the wall a floor is looked for

// (x, z) -> inside an open water area (nature.js buildNatureBase `areas`:
// projected rings, outer first), or null without them
export function openWaterTest(areas) {
  const water = (areas || [])
    .filter((a) => a.k === 'water' && a.open && a.rings?.length)
    .map((a) => {
      const o = a.rings[0];
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of o) {
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
        if (p.z < z0) z0 = p.z;
        if (p.z > z1) z1 = p.z;
      }
      return { rings: a.rings, x0, x1, z0, z1 };
    });
  if (!water.length) return null;
  const inRing = (r, x, z) => {
    let s = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i];
      const b = r[j];
      if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) s = !s;
    }
    return s;
  };
  return (x, z) => water.some((w) => x >= w.x0 && x <= w.x1 && z >= w.z0 && z <= w.z1 && inRing(w.rings[0], x, z) && !w.rings.slice(1).some((h) => inRing(h, x, z)));
}

// inWater(x, z): open water (the Douro, the sea; nature.json `o` areas). A
// pad box that reaches past a quay edge has its wall there on the river bed:
// its top showed as a grey line across the water off Cais da Ribeira. The
// quays (src/quays.js) are the river's edge; no pad wall stands in the river.
export function buildPadWalls(terrain, { S = 0.25, inWater = null } = {}) {
  const { pads, heightAt } = terrain;
  const pos = [];
  const nor = [];
  const col = [];
  const idx = [];
  const minH = MIN_WALL_M * S;
  let walls = 0;
  const byPad = new Map(); // landmark id -> { p, segs: [{ s, pts: [[x, z] x 3], nx, nz }], shown }
  for (const p of pads) {
    if (p.yAt || p.fillMax === undefined || !Number.isFinite(p.y)) continue; // only plain level pads
    const rec = { p, segs: [], shown: false };
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
        if (prev && (prev.h > minH || cur.h > minH) && !(inWater && inWater((prev.x + cur.x) / 2, (prev.z + cur.z) / 2))) {
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
          rec.segs.push({ s: walls, pts: [[prev.x, prev.z], [(prev.x + cur.x) / 2, (prev.z + cur.z) / 2], [cur.x, cur.z]], nx, nz });
          walls++;
        }
        prev = cur;
      }
    }
    if (rec.segs.length && p.id != null) byPad.set(p.id, rec);
  }
  if (!walls) return null;
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.Float32BufferAttribute(pos, 3);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere(); // with the walls standing: the sphere holds them once revealed
  // fold every wall flat: its top vertices (1 and 3 of each segment) down to the foot
  const P = posAttr.array;
  const tops = new Float32Array(walls * 2);
  for (let s = 0; s < walls; s++) {
    for (let k = 0; k < 2; k++) {
      const vt = (s * 4 + 1 + 2 * k) * 3 + 1;
      tops[s * 2 + k] = P[vt];
      P[vt] = P[vt - 3];
    }
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  mat.name = 'pad-walls';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'pad-walls';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const stats = { segments: walls, tris: idx.length / 3, standing: 0, pads: {} };
  mesh.userData.stats = stats;

  // The landmark `id` has its model: stand up the walls that hold its floor.
  // model: the landmark's main mesh (world matrix current or computable).
  mesh.userData.reveal = (id, model) => {
    const rec = byPad.get(id);
    if (!rec || rec.shown || !model) return 0;
    rec.shown = true;
    const t0 = performance.now();
    const mask = floorMask(rec.p, model);
    let up = 0;
    for (const sg of rec.segs) {
      if (!mask.near(sg)) continue;
      for (let k = 0; k < 2; k++) P[(sg.s * 4 + 1 + 2 * k) * 3 + 1] = tops[sg.s * 2 + k];
      up++;
    }
    if (up) posAttr.needsUpdate = true;
    stats.standing += up;
    stats.pads[id] = { walls: rec.segs.length, standing: up, ms: +(performance.now() - t0).toFixed(1) };
    return up;
  };
  return mesh;
}

// The model's level floor near the pad plane, as a grid of CELL_U cells in the
// pad's own (u, v) frame. near(seg): is there floor just inside the segment?
function floorMask(p, model) {
  const nu = Math.max(1, Math.ceil((2 * p.hu) / CELL_U));
  const nv = Math.max(1, Math.ceil((2 * p.hv) / CELL_U));
  const cells = new Uint8Array(nu * nv);
  const toU = (x, z) => (x - p.cx) * p.ux + (z - p.cz) * p.uz;
  const toV = (x, z) => -(x - p.cx) * p.uz + (z - p.cz) * p.ux;
  const mark = (u, v) => {
    const i = Math.floor((u + p.hu) / CELL_U);
    const j = Math.floor((v + p.hv) / CELL_U);
    if (i >= 0 && j >= 0 && i < nu && j < nv) cells[j * nu + i] = 1;
  };
  model.updateWorldMatrix(true, false);
  const m = model.matrixWorld.elements;
  const geo = model.geometry;
  const src = geo?.attributes?.position;
  if (src) {
    const count = src.count;
    const w = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const x = src.getX(i), y = src.getY(i), z = src.getZ(i);
      w[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
      w[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      w[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    const index = geo.index?.array;
    const tris = index ? index.length / 3 : count / 3;
    for (let t = 0; t < tris; t++) {
      const a = (index ? index[t * 3] : t * 3) * 3;
      const b = (index ? index[t * 3 + 1] : t * 3 + 1) * 3;
      const c = (index ? index[t * 3 + 2] : t * 3 + 2) * 3;
      if (Math.abs(w[a + 1] - p.y) > FLOOR_TOL_U || Math.abs(w[b + 1] - p.y) > FLOOR_TOL_U || Math.abs(w[c + 1] - p.y) > FLOOR_TOL_U) continue;
      // facing up (either winding)
      const e1x = w[b] - w[a], e1y = w[b + 1] - w[a + 1], e1z = w[b + 2] - w[a + 2];
      const e2x = w[c] - w[a], e2y = w[c + 1] - w[a + 1], e2z = w[c + 2] - w[a + 2];
      const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
      const cl = Math.hypot(cx, cy, cz);
      if (cl === 0 || Math.abs(cy) < FLOOR_NY * cl) continue;
      // rasterise by sampling the triangle at half a cell
      const ua = toU(w[a], w[a + 2]), va = toV(w[a], w[a + 2]);
      const ub = toU(w[b], w[b + 2]), vb = toV(w[b], w[b + 2]);
      const uc = toU(w[c], w[c + 2]), vc = toV(w[c], w[c + 2]);
      const edge = Math.max(Math.hypot(ub - ua, vb - va), Math.hypot(uc - ua, vc - va), Math.hypot(uc - ub, vc - vb));
      const n = Math.min(256, Math.max(1, Math.ceil(edge / (CELL_U * 0.5))));
      for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= n - i; j++) {
          const s = i / n, r = j / n;
          mark(ua + (ub - ua) * s + (uc - ua) * r, va + (vb - va) * s + (vc - va) * r);
        }
      }
    }
  }
  return {
    near(sg) {
      for (const [x, z] of sg.pts) {
        for (const d of REACH_U) {
          const px = x - sg.nx * d, pz = z - sg.nz * d;
          const i = Math.floor((toU(px, pz) + p.hu) / CELL_U);
          const j = Math.floor((toV(px, pz) + p.hv) / CELL_U);
          if (i >= 0 && j >= 0 && i < nu && j < nv && cells[j * nu + i]) return true;
        }
      }
      return false;
    },
  };
}
