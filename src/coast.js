// The sea, from the real OSM coastline (data/coast.json -> data/nature.json
// area id "sea", scripts/fetch-coast.mjs). CPU side only: the water shader
// (src/water.js) stays as it is.
//
// water.js hands the projected areas to buildSea(); the sea comes back as one
// mesh that shares the water material and replaces the old coarse ocean body.
//
//   - a quadtree over the sea polygon: 16-unit (64 m) cells along the coast,
//     doubling away from it up to 256 units (1 km); a cell the coast crosses is
//     cut by the polygon (Sutherland-Hodgman) and triangulated (earcut), a cell
//     in open water is two triangles. The surface is flat, so the T-junctions
//     between cell sizes cannot crack (the waves are per-pixel in the shader).
//   - the surface sits at the sea level of the ground (median of the ground
//     under the open sea, plus the lift water.js uses): the real coast is
//     dense, so draping the surface on the coarse DEM would tilt the rim.
//   - vertex attributes for the shader (aKind and aShore keep the ocean values
//     2 and 99; the names are the ones water.js declares for the sea mesh):
//       aSeaDist   distance to the coast, world units (capped at COAST_CAP)
//       aSeaDepth  water depth, world units: 0.2 m at the shore, a shelf that
//                  reaches 40 m offshore (40 (1 - exp(-d / 900 m)))
//       aMouth     1 at the Douro estuary edge to 0 at MOUTH_M metres away
//                  (the soft border between the estuary and the sea; extra,
//                  the shader may use it or the uWMouth disc)
//     attach() also sets the water.js uniforms: setSeaShoreAttributes(true)
//     and setWaterMouth(x, z, r) with the centre of the estuary's seaward edge.
import * as THREE from 'three';
import { S } from './geo.js';

const CELL_MIN = 16; // world units (64 m)
const CELL_MAX = 256; // 1 km
const BUCKET = 64; // segment index cell, world units
const COAST_CAP = 400; // world units (1.6 km)
const DEPTH_M = 900; // metres: e-folding distance of the depth gradient
const SHELF_M = 40; // metres: the depth the shelf reaches offshore
const MOUTH_M = 450; // metres: width of the estuary / sea transition
const OCEAN_AREA = 1.0e6; // world units²: same threshold as water.js
const LIFT = 0.14; // world units above the ground level of the open sea

// ------------------------------------------------------------ geometry helpers
// flat polygon: [x0, z0, x1, z1, ...]
function clipHalf(poly, inside, cut) {
  const out = [];
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const ax = poly[((i + n - 1) % n) * 2];
    const az = poly[((i + n - 1) % n) * 2 + 1];
    const bx = poly[i * 2];
    const bz = poly[i * 2 + 1];
    const ia = inside(ax, az);
    const ib = inside(bx, bz);
    if (ib) {
      if (!ia) out.push(...cut(ax, az, bx, bz));
      out.push(bx, bz);
    } else if (ia) out.push(...cut(ax, az, bx, bz));
  }
  return out;
}

// the part of a polygon inside the square [x0, x1] x [z0, z1]
function clipSquare(poly, x0, z0, x1, z1) {
  let p = clipHalf(
    poly,
    (x) => x >= x0,
    (ax, az, bx, bz) => [x0, az + ((bz - az) * (x0 - ax)) / (bx - ax)],
  );
  if (p.length < 6) return p;
  p = clipHalf(
    p,
    (x) => x <= x1,
    (ax, az, bx, bz) => [x1, az + ((bz - az) * (x1 - ax)) / (bx - ax)],
  );
  if (p.length < 6) return p;
  p = clipHalf(
    p,
    (x, z) => z >= z0,
    (ax, az, bx, bz) => [ax + ((bx - ax) * (z0 - az)) / (bz - az), z0],
  );
  if (p.length < 6) return p;
  return clipHalf(
    p,
    (x, z) => z <= z1,
    (ax, az, bx, bz) => [ax + ((bx - ax) * (z1 - az)) / (bz - az), z1],
  );
}

const polyArea = (poly) => {
  let a = 0;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += poly[j * 2] * poly[i * 2 + 1] - poly[i * 2] * poly[j * 2 + 1];
  return Math.abs(a) / 2;
};

// a bucketed segment index over rings of {x, z}: nearest-distance queries
function segIndex(rings, skip, open = false) {
  const segs = [];
  for (const ring of rings) {
    for (let i = open ? 1 : 0, j = open ? 0 : ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j];
      const b = ring[i];
      if (skip && skip(a, b)) continue;
      segs.push(a.x, a.z, b.x, b.z);
    }
  }
  const grid = new Map();
  for (let s = 0; s < segs.length; s += 4) {
    const bx0 = Math.floor(Math.min(segs[s], segs[s + 2]) / BUCKET);
    const bx1 = Math.floor(Math.max(segs[s], segs[s + 2]) / BUCKET);
    const bz0 = Math.floor(Math.min(segs[s + 1], segs[s + 3]) / BUCKET);
    const bz1 = Math.floor(Math.max(segs[s + 1], segs[s + 3]) / BUCKET);
    for (let bx = bx0; bx <= bx1; bx++) {
      for (let bz = bz0; bz <= bz1; bz++) {
        const k = bx * 100003 + bz;
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(s);
      }
    }
  }
  const segDist = (s, x, z) => {
    const ax = segs[s];
    const az = segs[s + 1];
    const dx = segs[s + 2] - ax;
    const dz = segs[s + 3] - az;
    const l2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    return Math.hypot(ax + dx * t - x, az + dz * t - z);
  };
  // nearest distance, searching bucket rings out to maxD (then returns maxD)
  const dist = (x, z, maxD) => {
    const cx = Math.floor(x / BUCKET);
    const cz = Math.floor(z / BUCKET);
    let best = maxD;
    const R = Math.ceil(maxD / BUCKET);
    for (let r = 0; r <= R; r++) {
      if ((r - 1) * BUCKET > best) break;
      for (let bx = cx - r; bx <= cx + r; bx++) {
        for (let bz = cz - r; bz <= cz + r; bz++) {
          if (Math.max(Math.abs(bx - cx), Math.abs(bz - cz)) !== r) continue;
          const l = grid.get(bx * 100003 + bz);
          if (!l) continue;
          for (const s of l) {
            const d = segDist(s, x, z);
            if (d < best) best = d;
          }
        }
      }
    }
    return best;
  };
  return { dist, count: segs.length / 4 };
}

// Distance field over polylines of {x, z} (world units): dist(x, z, maxD) is the
// distance to the nearest line, or maxD. open: the lines are not closed rings.
export function distanceField(lines, { open = false } = {}) {
  return segIndex(lines, null, open).dist;
}

// The sea the last buildSea() made: its level and its polygon, for the harbour
// layer (structures stand on this level and need to know which side is water).
let seaNow = null;
export const seaState = () => seaNow;

const median = (a) => {
  const b = a.slice().sort((p, q) => p - q);
  return b[b.length >> 1];
};

// ------------------------------------------------------------ the sea
const cache = new Map(); // ring signature -> built lattice (the geometry is rebuilt after the pads move the ground)

// areas: the projected nature areas ({ k, rings: [[{x, z}]], area, open }).
// Returns null when there is no ocean polygon; else
// { area, mesh(material), triangles, stats } where `area` is the ocean area to skip in water.js.
export function buildSea({ areas, heightAt }) {
  const ocean = areas.find((a) => a.k === 'water' && a.open && (a.area || 0) > OCEAN_AREA);
  if (!ocean) return null;
  const ring = ocean.rings[0];
  if (ring.length < 8) return null;
  const estuaries = areas.filter((a) => a.k === 'water' && a.open && a !== ocean).map((a) => a.rings[0]);
  const sig = `${ring.length}:${ring[0].x.toFixed(2)}:${ring[ring.length >> 1].z.toFixed(2)}`;
  let lat = cache.get(sig);
  if (!lat) {
    lat = buildLattice(ring, estuaries);
    if (!lat) return null;
    cache.set(sig, lat);
  }
  // sea level: the ground under the open sea, plus the lift
  const probe = [];
  for (let i = 0; i < lat.far.length; i += 2) probe.push(heightAt(lat.far[i], lat.far[i + 1]));
  const y = (probe.length ? median(probe) : 0) + LIFT;
  const n = lat.xz.length / 2;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = lat.xz[i * 2];
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = lat.xz[i * 2 + 1];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(lat.idx, 1));
  const nor = new Float32Array(n * 3);
  for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('aFlow', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  geo.setAttribute('aShore', new THREE.BufferAttribute(new Float32Array(n).fill(99), 1));
  geo.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(n).fill(2), 1));
  geo.setAttribute('aSeaDist', new THREE.BufferAttribute(lat.coast, 1));
  geo.setAttribute('aSeaDepth', new THREE.BufferAttribute(lat.depth, 1));
  geo.setAttribute('aMouth', new THREE.BufferAttribute(lat.mouth, 1));
  geo.computeBoundingSphere();
  const stats = { ...lat.stats, seaY: +y.toFixed(3) };
  seaNow = { y, ring, mouth: lat.mouthAt };
  return {
    area: ocean,
    triangles: lat.idx.length / 3,
    stats,
    // the mesh shares the water material (one program, one draw state) and
    // follows the water mesh: the dispose hook frees it with the parent
    attach(parent, hooks) {
      hooks?.setSeaShoreAttributes?.(true);
      if (lat.mouthAt) hooks?.setWaterMouth?.(lat.mouthAt.x, lat.mouthAt.z, MOUTH_M * S * 0.8);
      const mesh = new THREE.Mesh(geo, parent.material);
      mesh.name = 'sea';
      mesh.receiveShadow = true;
      mesh.renderOrder = parent.renderOrder;
      mesh.frustumCulled = false;
      parent.add(mesh);
      parent.geometry.addEventListener('dispose', () => geo.dispose());
      parent.userData.sea = stats;
      return mesh;
    },
  };
}

function buildLattice(ring, estuaries) {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const p of ring) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.z < z0) z0 = p.z;
    if (p.z > z1) z1 = p.z;
  }
  const eps = 0.01;
  // edges that run along the polygon's bounding frame (the sea closes along the wide bbox)
  const onFrame = (a, b) => (Math.abs(a.x - x0) < eps && Math.abs(b.x - x0) < eps) || (Math.abs(a.x - x1) < eps && Math.abs(b.x - x1) < eps) || (Math.abs(a.z - z0) < eps && Math.abs(b.z - z0) < eps) || (Math.abs(a.z - z1) < eps && Math.abs(b.z - z1) < eps);
  const coastIdx = segIndex([ring], onFrame);
  const estIdx = estuaries.length ? segIndex(estuaries) : null;
  const flat = new Float64Array(ring.length * 2);
  ring.forEach((p, i) => {
    flat[i * 2] = p.x;
    flat[i * 2 + 1] = p.z;
  });
  const poly = Array.from(flat);
  const polyAreaTotal = polyArea(poly);

  const xz = [];
  const idx = [];
  const coast = [];
  const depth = [];
  const mouth = [];
  const far = [];
  const vmap = new Map();
  const attr = (x, z) => {
    const d = coastIdx.dist(x, z, COAST_CAP);
    coast.push(d);
    depth.push((0.2 + SHELF_M * (1 - Math.exp(-(d / S) / DEPTH_M))) * S);
    const m = estIdx ? estIdx.dist(x, z, (MOUTH_M * S) * 1.0) : MOUTH_M * S;
    const t = Math.min(1, m / (MOUTH_M * S));
    mouth.push(1 - t * t * (3 - 2 * t));
    if (d > 30 && far.length < 800 && (xz.length / 2) % 7 === 0) far.push(x, z);
  };
  const vert = (x, z) => {
    const k = `${Math.round(x * 16)}_${Math.round(z * 16)}`;
    let i = vmap.get(k);
    if (i === undefined) {
      i = xz.length / 2;
      xz.push(x, z);
      attr(x, z);
      vmap.set(k, i);
    }
    return i;
  };
  // the estuary's seaward edge: its vertices that sit on the coast (within 32 m)
  let mcx = 0;
  let mcz = 0;
  let mn = 0;
  for (const er of estuaries) {
    for (const p of er) {
      if (coastIdx.dist(p.x, p.z, 8) < 8) {
        mcx += p.x;
        mcz += p.z;
        mn++;
      }
    }
  }
  const mouthAt = mn ? { x: mcx / mn, z: mcz / mn } : null;
  const stats = { cells: 0, cut: 0, quads: 0, areaRatio: 0, segs: coastIdx.count, ringPts: ring.length, cutFail: 0 };
  let triArea = 0;
  const pip = (x, z) => {
    let ins = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) ins = !ins;
    }
    return ins;
  };
  const addTri = (a, b, c) => {
    // face up: y = 0 plane, normal sign from the cross product (x, z)
    const ax = xz[a * 2];
    const az = xz[a * 2 + 1];
    const cr = (xz[b * 2] - ax) * (xz[c * 2 + 1] - az) - (xz[b * 2 + 1] - az) * (xz[c * 2] - ax);
    if (Math.abs(cr) < 1e-9) return;
    triArea += Math.abs(cr) / 2;
    if (cr > 0) idx.push(a, c, b);
    else idx.push(a, b, c);
  };

  const cell = (cx, cz, size) => {
    const ex = cx + size;
    const ez = cz + size;
    if (ex <= x0 || cx >= x1 || ez <= z0 || cz >= z1) return;
    const mx = cx + size / 2;
    const mz = cz + size / 2;
    const overhang = cx < x0 - eps || ex > x1 + eps || cz < z0 - eps || ez > z1 + eps;
    const d = coastIdx.dist(mx, mz, COAST_CAP);
    const near = d < size * 0.71 + 1.0; // the coast may cross the cell
    if (size > CELL_MIN && (near || d < size * 1.1)) {
      const h = size / 2;
      cell(cx, cz, h);
      cell(cx + h, cz, h);
      cell(cx, cz + h, h);
      cell(cx + h, cz + h, h);
      return;
    }
    stats.cells++;
    if (!near && !overhang) {
      if (!pip(mx, mz)) return;
      const a = vert(cx, cz);
      const b = vert(ex, cz);
      const c = vert(ex, ez);
      const e = vert(cx, ez);
      addTri(a, b, c);
      addTri(a, c, e);
      stats.quads++;
      return;
    }
    const clipped = clipSquare(poly, Math.max(cx, x0), Math.max(cz, z0), Math.min(ex, x1), Math.min(ez, z1));
    if (clipped.length < 6) return;
    // drop repeated points
    const pts = [];
    for (let i = 0; i < clipped.length; i += 2) {
      const l = pts.length;
      if (l && Math.abs(pts[l - 2] - clipped[i]) < 1e-6 && Math.abs(pts[l - 1] - clipped[i + 1]) < 1e-6) continue;
      pts.push(clipped[i], clipped[i + 1]);
    }
    if (pts.length >= 6 && Math.abs(pts[0] - pts[pts.length - 2]) < 1e-6 && Math.abs(pts[1] - pts[pts.length - 1]) < 1e-6) pts.length -= 2;
    if (pts.length < 6) return;
    const contour = [];
    for (let i = 0; i < pts.length; i += 2) contour.push(new THREE.Vector2(pts[i], pts[i + 1]));
    let faces;
    try {
      faces = THREE.ShapeUtils.triangulateShape(contour, []);
    } catch {
      stats.cutFail++;
      return;
    }
    const ids = contour.map((p) => vert(p.x, p.y));
    for (const f of faces) addTri(ids[f[0]], ids[f[1]], ids[f[2]]);
    stats.cut++;
  };
  const nx = Math.ceil((x1 - x0) / CELL_MAX);
  const nz = Math.ceil((z1 - z0) / CELL_MAX);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) cell(x0 + i * CELL_MAX, z0 + j * CELL_MAX, CELL_MAX);
  if (!idx.length) return null;
  stats.areaRatio = +(triArea / polyAreaTotal).toFixed(4);
  stats.verts = xz.length / 2;
  return { xz: new Float32Array(xz), idx: xz.length / 2 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), coast: new Float32Array(coast), depth: new Float32Array(depth), mouth: new Float32Array(mouth), mouthAt, far, stats };
}
