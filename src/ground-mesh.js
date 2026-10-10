// The ground mesh: one vertex lattice (the axes of scene.js groundAxes: 12 m
// inside the fine core, one DEM cell in the ring, coarser beyond), drawn as
// chunks of up to 32 x 32 cells, each with its own level of detail.
//
//   - Vertices are built once, full resolution, from the one height function
//     (terrain.heightAt). Normals and the ambient-occlusion tint come from the
//     lattice heights, not from per-vertex height calls.
//   - Every frame (onBeforeRender) each chunk gets a stride 1, 2, 4 or 8 by its
//     distance from the camera (vertex spacing about distance / K), the chunks
//     outside the frustum are dropped, and one dynamic index buffer is filled
//     from per-chunk index lists that are cached per (chunk, stride). The
//     triangles are the lattice's own, split along the (i+1, j) - (i, j+1)
//     diagonal, so the streamed tiles (tile-worker makeGround) and the MS
//     buildings drape on exactly the same surface at stride 1.
//   - Neighbouring chunks of different stride would leave cracks: each chunk
//     hangs a skirt (a vertical strip, drawn both ways, below its own edge) on
//     every side where the neighbour's stride differs. The skirt is deeper than
//     any height difference two strides can make, so the seam is watertight.
//
// DOM-free apart from three.js: no renderer needed to build or to plan.
import * as THREE from 'three';

const CHUNK_CELLS = 32;
const CHUNK_MAX_LEN = 380; // world units (1.5 km): the coarse ring is cut by length too
const MAX_LOG = 3; // strides 1, 2, 4, 8
const R_AO = 16; // world units, the AO radius (64 m)

function chunkRanges(a) {
  const out = [];
  let i0 = 0;
  const n = a.length;
  while (i0 < n - 1) {
    let i1 = i0 + 1;
    while (i1 < n - 1 && i1 - i0 < CHUNK_CELLS && a[i1 + 1] - a[i0] <= CHUNK_MAX_LEN) i1++;
    out.push([i0, i1]);
    i0 = i1;
  }
  return out;
}

// index of the line nearest xs[i] + d (d signed), for every i: AO and slope taps
function offsetIndex(a, d) {
  const out = new Int32Array(a.length);
  const n = a.length;
  for (let i = 0; i < n; i++) {
    const t = a[i] + d;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (a[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    out[i] = lo + 1 < n && t - a[lo] > a[lo + 1] - t ? lo + 1 : lo;
  }
  return out;
}

export function buildGround({ xs, zs, heightAt, lite = false }) {
  const nx = xs.length;
  const nz = zs.length;
  const cx = chunkRanges(xs);
  const cz = chunkRanges(zs);
  const CXn = cx.length;
  const CZn = cz.length;
  const nChunks = CXn * CZn;

  // ---- skirt vertices: after the lattice, per chunk, per side
  const skirtBase = new Int32Array(nChunks); // first skirt vertex of a chunk
  let nSkirt = 0;
  for (let c = 0; c < nChunks; c++) {
    const [i0, i1] = cx[c % CXn];
    const [j0, j1] = cz[(c / CXn) | 0];
    skirtBase[c] = nx * nz + nSkirt;
    nSkirt += 2 * (i1 - i0 + 1) + 2 * (j1 - j0 + 1);
  }
  const nv = nx * nz + nSkirt;
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const col = new Uint8Array(nv * 4);
  const H = new Float32Array(nx * nz);

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const h = heightAt(xs[i], zs[j]);
      H[k] = h;
      pos[k * 3] = xs[i];
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = zs[j];
    }
  }

  const ixP = offsetIndex(xs, R_AO);
  const ixM = offsetIndex(xs, -R_AO);
  const ixP2 = offsetIndex(xs, R_AO * 2.5);
  const ixM2 = offsetIndex(xs, -R_AO * 2.5);
  const izP = offsetIndex(zs, R_AO);
  const izM = offsetIndex(zs, -R_AO);
  const izP2 = offsetIndex(zs, R_AO * 2.5);
  const izM2 = offsetIndex(zs, -R_AO * 2.5);

  function shadeVertex(i, j) {
    const k = j * nx + i;
    const i0 = i > 0 ? i - 1 : i;
    const i1 = i < nx - 1 ? i + 1 : i;
    const j0 = j > 0 ? j - 1 : j;
    const j1 = j < nz - 1 ? j + 1 : j;
    const gx = (H[j * nx + i1] - H[j * nx + i0]) / (xs[i1] - xs[i0]);
    const gz = (H[j1 * nx + i] - H[j0 * nx + i]) / (zs[j1] - zs[j0]);
    const l = Math.hypot(gx, gz, 1);
    nor[k * 3] = -gx / l;
    nor[k * 3 + 1] = 1 / l;
    nor[k * 3 + 2] = -gz / l;
    const h = H[k];
    const around = (H[j * nx + ixP[i]] + H[j * nx + ixM[i]] + H[izP[j] * nx + i] + H[izM[j] * nx + i]) / 4;
    const around2 = (H[j * nx + ixP2[i]] + H[j * nx + ixM2[i]] + H[izP2[j] * nx + i] + H[izM2[j] * nx + i]) / 4;
    const concave = (around - h) * 0.6 + (around2 - h) * 0.4; // world units
    const ao = Math.min(1, Math.max(0.6, 1 - concave * 0.09));
    const q = Math.round(ao * 255);
    col[k * 4] = col[k * 4 + 1] = col[k * 4 + 2] = q;
    col[k * 4 + 3] = 255;
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) shadeVertex(i, j);

  // ---- chunk geometry: bounds, mean cell, skirt vertices
  const ccen = new Float32Array(nChunks * 3);
  const crad = new Float32Array(nChunks);
  const cls = new Float32Array(nChunks); // mean cell length, world units
  const cdrop = new Float32Array(nChunks);
  // skirt vertex -> source lattice vertex, for the pad patch
  const skirtSrc = new Int32Array(nSkirt);
  const skirtDrop = new Float32Array(nSkirt);
  // skirt vertex id of side side at position t (0..n) of chunk c
  const sideLen = (c, side) => {
    const [i0, i1] = cx[c % CXn];
    const [j0, j1] = cz[(c / CXn) | 0];
    return side < 2 ? i1 - i0 : j1 - j0;
  };
  const sideOff = (c, side) => {
    const [i0, i1] = cx[c % CXn];
    const [j0, j1] = cz[(c / CXn) | 0];
    const ni = i1 - i0 + 1;
    const nj = j1 - j0 + 1;
    return side === 0 ? 0 : side === 1 ? ni : side === 2 ? 2 * ni : 2 * ni + nj;
  };
  // the lattice vertex under position t of side `side` (0 N: j0, 1 S: j1, 2 W: i0, 3 E: i1)
  const sideVertex = (c, side, t) => {
    const [i0, i1] = cx[c % CXn];
    const [j0, j1] = cz[(c / CXn) | 0];
    return side === 0 ? j0 * nx + i0 + t : side === 1 ? j1 * nx + i0 + t : side === 2 ? (j0 + t) * nx + i0 : (j0 + t) * nx + i1;
  };
  for (let c = 0; c < nChunks; c++) {
    const [i0, i1] = cx[c % CXn];
    const [j0, j1] = cz[(c / CXn) | 0];
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const h = H[j * nx + i];
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    }
    const mx = (xs[i0] + xs[i1]) / 2;
    const mz = (zs[j0] + zs[j1]) / 2;
    const my = (lo + hi) / 2;
    ccen[c * 3] = mx;
    ccen[c * 3 + 1] = my;
    ccen[c * 3 + 2] = mz;
    // the skirts hang below the lattice: the sphere covers them too
    cls[c] = (xs[i1] - xs[i0]) / (i1 - i0) / 2 + (zs[j1] - zs[j0]) / (j1 - j0) / 2;
    cdrop[c] = Math.min(45, Math.max(2.5, cls[c] * 2.5));
    crad[c] = Math.hypot((xs[i1] - xs[i0]) / 2, (zs[j1] - zs[j0]) / 2, (hi - lo) / 2 + cdrop[c]);
    for (let side = 0; side < 4; side++) {
      const n = sideLen(c, side);
      for (let t = 0; t <= n; t++) {
        const src = sideVertex(c, side, t);
        const sv = skirtBase[c] + sideOff(c, side) + t;
        skirtSrc[sv - nx * nz] = src;
        skirtDrop[sv - nx * nz] = cdrop[c];
      }
    }
  }
  function syncSkirts() {
    for (let s = 0; s < nSkirt; s++) {
      const v = nx * nz + s;
      const src = skirtSrc[s];
      pos[v * 3] = pos[src * 3];
      pos[v * 3 + 1] = H[src] - skirtDrop[s];
      pos[v * 3 + 2] = pos[src * 3 + 2];
      nor[v * 3] = nor[src * 3];
      nor[v * 3 + 1] = nor[src * 3 + 1];
      nor[v * 3 + 2] = nor[src * 3 + 2];
      col[v * 4] = col[src * 4];
      col[v * 4 + 1] = col[src * 4 + 1];
      col[v * 4 + 2] = col[src * 4 + 2];
      col[v * 4 + 3] = 255;
    }
  }
  syncSkirts();

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3);
  const norAttr = new THREE.BufferAttribute(nor, 3);
  const colAttr = new THREE.BufferAttribute(col, 4, true);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('normal', norAttr);
  geo.setAttribute('color', colAttr);
  const sx0 = xs[0];
  const sx1 = xs[nx - 1];
  const sz0 = zs[0];
  const sz1 = zs[nz - 1];
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3((sx0 + sx1) / 2, 0, (sz0 + sz1) / 2), Math.hypot(sx1 - sx0, sz1 - sz0) / 2 + 400);
  geo.boundingBox = new THREE.Box3(new THREE.Vector3(sx0, -300, sz0), new THREE.Vector3(sx1, 300, sz1));

  // ---- per (chunk, stride) index lists, built on first use
  const lines = (a0, a1, s) => {
    const out = [];
    for (let i = a0; i < a1; i += s) out.push(i);
    out.push(a1);
    return out;
  };
  const bodyCache = new Map();
  function body(c, lg) {
    const key = c * 4 + lg;
    let arr = bodyCache.get(key);
    if (arr) return arr;
    const s = 1 << lg;
    const [i0, i1] = cx[c % CXn];
    const [j0, j1] = cz[(c / CXn) | 0];
    const li = lines(i0, i1, s);
    const lj = lines(j0, j1, s);
    arr = new Uint32Array((li.length - 1) * (lj.length - 1) * 6);
    let o = 0;
    for (let b = 0; b < lj.length - 1; b++) {
      for (let a = 0; a < li.length - 1; a++) {
        const v00 = lj[b] * nx + li[a];
        const v10 = lj[b] * nx + li[a + 1];
        const v01 = lj[b + 1] * nx + li[a];
        const v11 = lj[b + 1] * nx + li[a + 1];
        // counter-clockwise seen from above (+y)
        arr[o++] = v00;
        arr[o++] = v01;
        arr[o++] = v10;
        arr[o++] = v10;
        arr[o++] = v01;
        arr[o++] = v11;
      }
    }
    bodyCache.set(key, arr);
    return arr;
  }
  const skirtCache = new Map();
  function skirt(c, lg, side) {
    const key = (c * 4 + lg) * 4 + side;
    let arr = skirtCache.get(key);
    if (arr) return arr;
    const s = 1 << lg;
    const n = sideLen(c, side);
    const ts = lines(0, n, s);
    arr = new Uint32Array((ts.length - 1) * 12);
    let o = 0;
    const base = skirtBase[c] + sideOff(c, side);
    for (let q = 0; q < ts.length - 1; q++) {
      const ua = sideVertex(c, side, ts[q]);
      const ub = sideVertex(c, side, ts[q + 1]);
      const da = base + ts[q];
      const db = base + ts[q + 1];
      // both windings: the seam is seen from either side
      arr[o++] = ua;
      arr[o++] = da;
      arr[o++] = ub;
      arr[o++] = ub;
      arr[o++] = da;
      arr[o++] = db;
      arr[o++] = ua;
      arr[o++] = ub;
      arr[o++] = da;
      arr[o++] = ub;
      arr[o++] = db;
      arr[o++] = da;
    }
    skirtCache.set(key, arr);
    return arr;
  }

  // ---- the plan: strides, visibility, one index buffer
  let index = new THREE.BufferAttribute(new Uint32Array(700000), 1);
  index.setUsage(THREE.DynamicDrawUsage);
  geo.setIndex(index);
  geo.setDrawRange(0, 0);
  const lg = new Int8Array(nChunks).fill(-1); // current log2 stride per chunk
  const vis = new Uint8Array(nChunks);
  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  const sph = new THREE.Sphere();
  let K = lite ? 28 : 52; // vertex spacing about distance / K
  let bias = 1;
  let lastKey = '';
  let planSig = -1;
  const stats = { tris: 0, chunks: 0, stride: [0, 0, 0, 0], planMs: 0, rebuilds: 0 };

  function plan(camera) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    camera.updateMatrixWorld?.();
    pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const key = `${pv.elements.join(',')}|${K * bias}`;
    if (key === lastKey) return;
    lastKey = key;
    frustum.setFromProjectionMatrix(pv);
    const cp = camera.position;
    const Ke = K * bias;
    for (let c = 0; c < nChunks; c++) {
      const dx = cp.x - ccen[c * 3];
      const dy = cp.y - ccen[c * 3 + 1];
      const dz = cp.z - ccen[c * 3 + 2];
      const d = Math.max(0, Math.hypot(dx, dy, dz) - crad[c]);
      const r = d / (Ke * cls[c]);
      const prev = lg[c];
      let g;
      if (prev >= 0 && r >= (1 << prev) * 0.88 && r < (1 << prev) * 2 * 1.12) g = prev;
      else g = r < 1 ? 0 : Math.min(MAX_LOG, Math.floor(Math.log2(r)));
      lg[c] = g;
      sph.center.set(ccen[c * 3], ccen[c * 3 + 1], ccen[c * 3 + 2]);
      sph.radius = crad[c];
      vis[c] = frustum.intersectsSphere(sph) ? 1 : 0;
    }
    // signature of the plan: skip the copy when nothing changed
    let sig = 0;
    for (let c = 0; c < nChunks; c++) if (vis[c]) sig = (Math.imul(sig, 31) + c * 5 + lg[c] + 1) | 0;
    if (sig === planSig) return;
    planSig = sig;
    let total = 0;
    const parts = [];
    stats.stride = [0, 0, 0, 0];
    for (let c = 0; c < nChunks; c++) {
      if (!vis[c]) continue;
      const g = lg[c];
      const cxi = c % CXn;
      const czi = (c / CXn) | 0;
      const b = body(c, g);
      parts.push(b);
      total += b.length;
      stats.stride[g]++;
      // skirts on the sides whose neighbour draws a different stride
      const nb = [czi > 0 ? c - CXn : -1, czi < CZn - 1 ? c + CXn : -1, cxi > 0 ? c - 1 : -1, cxi < CXn - 1 ? c + 1 : -1];
      for (let side = 0; side < 4; side++) {
        if (nb[side] < 0 || lg[nb[side]] === g) continue;
        const sk = skirt(c, g, side);
        parts.push(sk);
        total += sk.length;
      }
    }
    if (total > index.array.length) {
      index = new THREE.BufferAttribute(new Uint32Array(Math.ceil(total * 1.5)), 1);
      index.setUsage(THREE.DynamicDrawUsage);
      geo.setIndex(index);
    }
    let o = 0;
    for (const p of parts) {
      index.array.set(p, o);
      o += p.length;
    }
    index.clearUpdateRanges();
    if (total) index.addUpdateRange(0, total);
    index.needsUpdate = true;
    geo.setDrawRange(0, total);
    stats.tris = total / 3;
    stats.chunks = parts.length;
    stats.rebuilds++;
    stats.planMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
  }

  // The camera has not moved but the ground changed (pads): force a refill
  // is not needed, the index is unchanged; only the vertex buffers update.
  const lowerIndex = (arr, v) => {
    let lo = 0;
    let hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  // Re-read the height function under `pads` (terrain.pads: cx, cz, r in world
  // units) and fix the normals, the tint and the skirts there. Returns the
  // number of lattice vertices re-read.
  function patch(pads) {
    if (!pads.length) return 0;
    const reach = R_AO * 2.5 + 1;
    const touched = new Uint8Array(nx * nz);
    let n = 0;
    let I0 = nx;
    let I1 = 0;
    let J0 = nz;
    let J1 = 0;
    for (const p of pads) {
      const r = p.r + reach;
      const i0 = Math.max(0, lowerIndex(xs, p.cx - r) - 1);
      const i1 = Math.min(nx - 1, lowerIndex(xs, p.cx + r) + 1);
      const j0 = Math.max(0, lowerIndex(zs, p.cz - r) - 1);
      const j1 = Math.min(nz - 1, lowerIndex(zs, p.cz + r) + 1);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = j * nx + i;
          if (touched[k]) continue;
          touched[k] = 1;
          const h = heightAt(xs[i], zs[j]);
          H[k] = h;
          pos[k * 3 + 1] = h;
          n++;
        }
      }
      I0 = Math.min(I0, i0);
      I1 = Math.max(I1, i1);
      J0 = Math.min(J0, j0);
      J1 = Math.max(J1, j1);
    }
    for (let j = J0; j <= J1; j++) for (let i = I0; i <= I1; i++) if (touched[j * nx + i]) shadeVertex(i, j);
    syncSkirts();
    // chunk bounds (their spheres cull the chunks)
    for (let c = 0; c < nChunks; c++) {
      const [i0, i1] = cx[c % CXn];
      const [j0, j1] = cz[(c / CXn) | 0];
      if (i1 < I0 || i0 > I1 || j1 < J0 || j0 > J1) continue;
      let lo = Infinity;
      let hi = -Infinity;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const h = H[j * nx + i];
          if (h < lo) lo = h;
          if (h > hi) hi = h;
        }
      }
      ccen[c * 3 + 1] = (lo + hi) / 2;
      crad[c] = Math.hypot((xs[i1] - xs[i0]) / 2, (zs[j1] - zs[j0]) / 2, (hi - lo) / 2 + cdrop[c]);
    }
    posAttr.needsUpdate = true;
    norAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    lastKey = '';
    return n;
  }

  return {
    geometry: geo,
    plan,
    patch,
    nx,
    nz,
    xs,
    zs,
    H, // lattice heights, world units (read only)
    stats,
    setBias(b) {
      bias = b;
      lastKey = '';
    },
    // 0: base, 1 and 2: coarser strides sooner (the governor's geometry level)
    setLevel(level) {
      this.setBias(level >= 2 ? 0.45 : level === 1 ? 0.7 : 1);
    },
    // vertex height at lattice node (i, j)
    heightIndex: (i, j) => H[j * nx + i],
    // the triangle count if every chunk were drawn at stride 1 (stats only)
    fullTris: (nx - 1) * (nz - 1) * 2,
    chunkCount: nChunks,
  };
}
