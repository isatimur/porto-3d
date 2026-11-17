// Draw only the visible part of a city-wide merged mesh.
//
// The core's road layer is a dozen merged meshes and fat-line sets, each as
// wide as the city (radius about 6.6 km). three.js culls whole objects, so
// they were drawn in full in every view: 1.2 M primitives in a view of the
// sea with the whole city behind the camera, and at street level only about
// a fifth of what they drew was on screen.
//
// cellRuns() sorts the object's triangles (or line segments) by grid cell
// along a Morton curve, once, in place: the buffers keep their size and no
// triangle is split or copied, so no seam can open between cells. Per frame
// the cells whose boxes touch the view (for a shadow caster, also the shadow
// camera's view) are taken; consecutive visible cells form runs, and the
// closest runs are merged until at most `maxRuns` remain. Each run is one draw
// of a child "slot" that shares the object's buffers (a drawRange for meshes,
// an instance window for fat lines). Over the whole city every cell is
// visible: one run, one draw, as before. Up close a few runs draw a fraction.
//
// The object keeps its API (visible, material, geometry.drawRange for the
// line LOD, renderOrder, castShadow): it moves to a layer no camera renders,
// its `visible` still hides the slots, and the slots copy the rest.
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';

const HIDDEN_LAYER = 31; // no camera renders it; the slots stay on layer 0
const _v = new THREE.Vector3();
const _box = new THREE.Box3();

// Z-order key of a cell: neighbours in space are mostly neighbours in the list
function morton(ix, iz) {
  let r = 0;
  for (let b = 0; b < 15; b++) r |= (((ix >> b) & 1) << (2 * b)) | (((iz >> b) & 1) << (2 * b + 1));
  return r >>> 0;
}

// n primitives with a centre (x, z) each: their stable order by cell key, and
// the cells as [start, count] ranges of that order, in curve order. A counting
// sort over the grid's cells (a few hundred): no Map lookup per primitive, it
// runs once per object while the road layer is built (on the critical path).
function sortByCell(n, centre, cell) {
  const cx = new Float64Array(n);
  const cz = new Float64Array(n);
  const c = [0, 0];
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    centre(i, c);
    cx[i] = c[0];
    cz[i] = c[1];
    if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    if (c[0] < x0) x0 = c[0];
    if (c[0] > x1) x1 = c[0];
    if (c[1] < z0) z0 = c[1];
    if (c[1] > z1) z1 = c[1];
  }
  if (!(x1 >= x0 && z1 >= z0)) x0 = x1 = z0 = z1 = 0; // no finite centre at all
  const nx = Math.floor((x1 - x0) / cell) + 1;
  const nz = Math.floor((z1 - z0) / cell) + 1;
  const id = new Uint32Array(n); // the primitive's grid cell
  const count = new Uint32Array(nx * nz);
  for (let i = 0; i < n; i++) {
    let g = Math.floor((cx[i] - x0) / cell) + nx * Math.floor((cz[i] - z0) / cell);
    // a primitive with a broken (NaN) centre still gets a cell, the first: it
    // is kept and counted, never dropped or written twice
    if (!(g >= 0 && g < count.length)) g = 0;
    id[i] = g;
    count[g]++;
  }
  // the occupied cells along the Morton curve, and where each one starts
  const used = [];
  for (let g = 0; g < count.length; g++) if (count[g]) used.push(g);
  const key = (g) => morton(g % nx, Math.floor(g / nx));
  used.sort((a, b) => key(a) - key(b));
  const fill = new Uint32Array(nx * nz);
  let s = 0;
  const cells = used.map((g) => {
    fill[g] = s;
    const cellRange = { start: s, count: count[g], box: new THREE.Box3() };
    s += count[g];
    return cellRange;
  });
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[fill[id[i]]++] = i;
  return { order, cells };
}

// Mesh: the index is reordered triangle by triangle; a cell's box holds every
// vertex of its triangles. Ranges in index elements (the drawRange unit).
function prepareMesh(mesh, cell) {
  const idx = mesh.geometry.index;
  const p = mesh.geometry.attributes.position.array;
  const a = idx.array;
  const n = idx.count / 3;
  const { order, cells } = sortByCell(
    n,
    (t, c) => {
      const i0 = a[3 * t] * 3;
      const i1 = a[3 * t + 1] * 3;
      const i2 = a[3 * t + 2] * 3;
      c[0] = (p[i0] + p[i1] + p[i2]) / 3;
      c[1] = (p[i0 + 2] + p[i1 + 2] + p[i2 + 2]) / 3;
    },
    cell,
  );
  const src = a.slice();
  for (let k = 0; k < n; k++) {
    const t = order[k];
    a[3 * k] = src[3 * t];
    a[3 * k + 1] = src[3 * t + 1];
    a[3 * k + 2] = src[3 * t + 2];
  }
  idx.needsUpdate = true;
  for (const c of cells) {
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    for (let e = 3 * c.start; e < 3 * (c.start + c.count); e++) {
      const v = a[e] * 3;
      const x = p[v];
      const y = p[v + 1];
      const z = p[v + 2];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    c.box.min.set(x0, y0, z0);
    c.box.max.set(x1, y1, z1);
    c.start *= 3;
    c.count *= 3;
  }
  return cells;
}

// Fat lines: the segment instances are reordered (positions, and the dash
// distances and colours when present, so a dashed line keeps its phase).
// `pad`: world units around each box for the line's width on screen.
function prepareLines(line, cell, pad) {
  const g = line.geometry;
  const start = g.attributes.instanceStart;
  const n = start.count;
  const P = start.data.array; // stride 6: x0 y0 z0 x1 y1 z1
  const { order, cells } = sortByCell(
    n,
    (i, c) => {
      c[0] = (P[6 * i] + P[6 * i + 3]) / 2;
      c[1] = (P[6 * i + 2] + P[6 * i + 5]) / 2;
    },
    cell,
  );
  const permute = (attr) => {
    if (!attr) return;
    const data = attr.data;
    const s = data.stride;
    const dst = data.array;
    const src = dst.slice();
    for (let k = 0; k < n; k++) {
      const o = order[k] * s;
      const d = k * s;
      for (let j = 0; j < s; j++) dst[d + j] = src[o + j];
    }
    data.needsUpdate = true;
  };
  permute(start);
  permute(g.attributes.instanceDistanceStart);
  permute(g.attributes.instanceColorStart);
  for (const c of cells) {
    for (let k = c.start; k < c.start + c.count; k++) {
      c.box.expandByPoint(_v.set(P[6 * k], P[6 * k + 1], P[6 * k + 2]));
      c.box.expandByPoint(_v.set(P[6 * k + 3], P[6 * k + 4], P[6 * k + 5]));
    }
    c.box.expandByScalar(pad);
  }
  return cells;
}

// a child that draws one run of a mesh: same attributes and index objects
// (three.js uploads them once), its own drawRange
function meshSlot(mesh) {
  const src = mesh.geometry;
  const g = new THREE.BufferGeometry();
  for (const [k, v] of Object.entries(src.attributes)) g.setAttribute(k, v);
  g.setIndex(src.index);
  g.boundingSphere = src.boundingSphere;
  g.boundingBox = src.boundingBox;
  return new THREE.Mesh(g, mesh.material);
}
// fat lines: the 8-vertex template is shared; the instance attributes are
// views into the same interleaved buffers that start at the run's first
// segment (one GPU buffer for the object and all its slots)
const LINE_ATTRS = [
  ['instanceStart', 3, 0],
  ['instanceEnd', 3, 3],
  ['instanceDistanceStart', 1, 0],
  ['instanceDistanceEnd', 1, 1],
  ['instanceColorStart', 3, 0],
  ['instanceColorEnd', 3, 3],
];
function lineSlot(line) {
  const src = line.geometry;
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(src.index);
  g.setAttribute('position', src.attributes.position);
  g.setAttribute('uv', src.attributes.uv);
  g.boundingSphere = src.boundingSphere;
  g.boundingBox = src.boundingBox;
  g.userData.first = -1;
  return new LineSegments2(g, line.material);
}
function setLineWindow(slot, src, first, count) {
  const g = slot.geometry;
  if (g.userData.first !== first) {
    g.userData.first = first;
    for (const [name, size, off] of LINE_ATTRS) {
      const a = src.attributes[name];
      // a new view object: three.js binds the attribute pointers again
      if (a) g.setAttribute(name, new THREE.InterleavedBufferAttribute(a.data, size, off + first * a.data.stride));
    }
  }
  g.instanceCount = count;
  g._maxInstanceCount = count; // three.js would take the whole buffer's count
}

/**
 * Prepare a merged indexed Mesh or a LineSegments2 to draw only its visible
 * cells. opts: { cell: world units per grid cell, maxRuns: at most this many
 * draws, pad: world units around each cell box }. Returns a handle for
 * createCellCuller().add(), or null when the object has a single cell.
 */
const PREPARED = new WeakMap(); // geometry -> cells (a glow shares its line's geometry: sorted once)
export function cellRuns(object, { cell = 250, maxRuns = 3, gapShare = 0.06, pad = 0, min = 3000 } = {}) {
  const isLine = !!object.isLineSegments2;
  const g = object.geometry;
  if (isLine ? !g.attributes.instanceStart : !g.index) return null;
  // small sets are not worth their slots (min: segments or triangles)
  if ((isLine ? g.attributes.instanceStart.count : g.index.count / 3) < min) return null;
  let cells = PREPARED.get(g);
  let prepMs = 0;
  if (!cells) {
    const t0 = performance.now();
    cells = isLine ? prepareLines(object, cell, pad) : prepareMesh(object, cell);
    prepMs = Math.round((performance.now() - t0) * 10) / 10;
    PREPARED.set(g, cells);
  }
  if (cells.length < 2) return null;
  const total = isLine ? g.attributes.instanceStart.count : g.index.count;
  const slots = [];
  for (let i = 0; i < maxRuns; i++) {
    const s = isLine ? lineSlot(object) : meshSlot(object);
    s.name = `${object.name}-run${i}`;
    s.frustumCulled = false; // the runs are the culling
    s.matrixAutoUpdate = false;
    s.visible = false;
    object.add(s);
    slots.push(s);
  }
  object.layers.set(HIDDEN_LAYER);
  const vis = new Uint8Array(cells.length);
  const runs = [{ start: 0, end: total }]; // until the first update: everything, as before
  const stats = { name: object.name, cells: cells.length, runs: 1, drawn: total, total, prepMs };

  // the object's own state onto the slots that draw (cheap, every frame)
  function sync() {
    for (let k = 0; k < slots.length; k++) {
      const s = slots[k];
      const r = runs[k];
      s.visible = !!r && r.end > r.start;
      if (!s.visible) continue;
      s.material = object.material;
      s.castShadow = object.castShadow;
      s.receiveShadow = object.receiveShadow;
      s.renderOrder = object.renderOrder;
      if (isLine) {
        // the line LOD (roads.js setGeoLod) sets the template's index range
        s.geometry.drawRange.start = g.drawRange.start;
        s.geometry.drawRange.count = g.drawRange.count;
        setLineWindow(s, g, r.start, r.end - r.start);
      } else s.geometry.setDrawRange(r.start, r.end - r.start);
    }
  }
  sync();

  // frustum: the view; shadow: the shadow camera's frustum or null
  function cull(frustum, shadow) {
    const cast = object.castShadow && shadow;
    const m = object.matrixWorld;
    const ident = m.equals(_ID);
    for (let i = 0; i < cells.length; i++) {
      const b = ident ? cells[i].box : _box.copy(cells[i].box).applyMatrix4(m);
      vis[i] = frustum.intersectsBox(b) || (cast && shadow.intersectsBox(b)) ? 1 : 0;
    }
    runs.length = 0;
    for (let i = 0; i < cells.length; i++) {
      if (!vis[i]) continue;
      const c = cells[i];
      const last = runs[runs.length - 1];
      if (last && last.end === c.start) last.end = c.start + c.count;
      else runs.push({ start: c.start, end: c.start + c.count });
    }
    // Join the two runs with the smallest gap (it draws a few hidden cells)
    // while there are too many, or while that gap is under `gapShare` of the
    // object: a draw call costs more than a small gap of primitives
    const small = total * gapShare;
    while (runs.length > 1) {
      let best = 0;
      let gap = Infinity;
      for (let i = 0; i + 1 < runs.length; i++) {
        const d = runs[i + 1].start - runs[i].end;
        if (d < gap) {
          gap = d;
          best = i;
        }
      }
      if (runs.length <= maxRuns && gap > small) break;
      runs[best].end = runs[best + 1].end;
      runs.splice(best + 1, 1);
    }
    stats.runs = runs.length;
    stats.drawn = runs.reduce((a, r) => a + r.end - r.start, 0);
  }
  return { object, cull, sync, stats };
}
const _ID = new THREE.Matrix4();

// One culler per layer: the frustums are made once a frame, the cells are
// tested again only when the camera (or the shadow camera) moved.
export function createCellCuller() {
  const handles = [];
  const frustum = new THREE.Frustum();
  const shadowFrustum = new THREE.Frustum();
  const pm = new THREE.Matrix4();
  const last = new Float64Array(64).fill(NaN);
  let dirty = true;
  const changed = (camera, shadowCamera) => {
    const parts = [camera.projectionMatrix.elements, camera.matrixWorldInverse.elements, shadowCamera?.projectionMatrix.elements, shadowCamera?.matrixWorldInverse.elements];
    let diff = false;
    for (let p = 0; p < 4; p++) {
      const e = parts[p];
      for (let i = 0; i < 16; i++) {
        const v = e ? e[i] : 0;
        if (last[p * 16 + i] !== v) {
          last[p * 16 + i] = v;
          diff = true;
        }
      }
    }
    return diff;
  };
  return {
    add(object, opts) {
      const h = cellRuns(object, opts);
      if (h) handles.push(h);
      dirty = true;
      return h;
    },
    // camera: the view (its matrices current); shadowCamera: the sun's shadow
    // camera with its matrices for this frame, or null without shadows
    update(camera, shadowCamera = null) {
      if (dirty || changed(camera, shadowCamera)) {
        dirty = false;
        frustum.setFromProjectionMatrix(pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
        if (shadowCamera) shadowFrustum.setFromProjectionMatrix(pm.multiplyMatrices(shadowCamera.projectionMatrix, shadowCamera.matrixWorldInverse));
        // hidden objects too: one shown later (lamp pools at dusk, the street
        // detail within range) must not draw the cells of an older view
        for (const h of handles) h.cull(frustum, shadowCamera ? shadowFrustum : null);
      }
      for (const h of handles) h.sync();
    },
    get stats() {
      return handles.map((h) => ({ ...h.stats }));
    },
  };
}
