// Lite city: the OSM core's buildings as plain oriented boxes (flat roof, no
// facades, no windows, no roof shapes), colour baked into the vertices.
//   near   boxes of the buildings around the camera's focus, merged per 250 m
//          cell, built a cell or two a frame, capped at `budget` buildings;
//   far    one coarse block per 125 m cell for everything else (one mesh,
//          rebuilt when the near set changes);
// so the triangle count stays a few tens of thousands at any distance. The
// 355 000 footprints are read once into typed arrays (about 9 MB) and the
// list is let go.
import * as THREE from 'three';

const NEAR_CELL_M = 250;
const FAR_CELL_M = 125;
const WALL = [0xdccfb6, 0xd3c0a2, 0xe2d6c0, 0xc9b190, 0xbba78d, 0xd9c2a0].map((h) => new THREE.Color(h));
const ROOF = [0xb4623f, 0xa6563a, 0xc07049, 0x8f6a58, 0x9c5f45].map((h) => new THREE.Color(h));
// baked face shading under a light from the north-west, high: roof 1, then the walls
const SHADE = { roof: 1.0, e: 0.74, w: 0.9, s: 0.82, n: 0.96 };

export function createCityLite({ buildings, project, surfaceAt, atmosphere, S, masks = { outlines: [], plans: [] }, budget = 6500, maxRadiusM = 900 }) {
  const group = new THREE.Group();
  group.name = 'buildings';
  const stats = { input: 0, built: 0, skippedOutline: 0, skippedPlan: 0, droppedSmall: 0, degenerate: 0, tiles: 0, triangles: 0, vertices: 0, nearCells: 0, nearBuildings: 0, farBlocks: 0 };
  const list = buildings?.buildings; // the data object of data.js: the JSON, or the packed list
  if (!list || !(list.length > 0) || typeof list.at !== 'function') return { group, stats, material: null, footprints: [], skyRects: new Float32Array(0), update() {}, builtAt: () => 0 };
  stats.input = list.length;

  // ---- landmark masks
  const outlineBoxes = masks.outlines.map((poly) => {
    const xs = poly.map((p) => p.x);
    const zs = poly.map((p) => p.z);
    return { poly, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  });
  const pip = (poly, x, z) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
  };
  const underLandmark = (x, z) => {
    for (const p of masks.plans) {
      const dx = x - p.cx;
      const dz = z - p.cz;
      const u = dx * p.ux + dz * p.uz;
      const v = -dx * p.uz + dz * p.ux;
      if (Math.abs(u) <= p.hu && Math.abs(v) <= p.hv) return 'plan';
    }
    for (const o of outlineBoxes) if (x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1 && pip(o.poly, x, z)) return 'outline';
    return null;
  };

  // ---- pass 1: one oriented box per building
  const cap = list.length;
  const B = { cx: new Float32Array(cap), cz: new Float32Array(cap), ang: new Float32Array(cap), hw: new Float32Array(cap), hd: new Float32Array(cap), h: new Float32Array(cap), tone: new Uint8Array(cap) };
  let n = 0;
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let bi = 0; bi < list.length; bi++) {
    const b = list.at(bi);
    if (!Array.isArray(b.p) || b.p.length < 3 || !(b.h > 0)) {
      stats.degenerate++;
      continue;
    }
    const pts = b.p.map((q) => project(q[0], q[1]));
    // the longest edge gives the box's direction
    let best = 0;
    let ang = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const c = pts[(i + 1) % pts.length];
      const l = (c.x - a.x) ** 2 + (c.z - a.z) ** 2;
      if (l > best) {
        best = l;
        ang = Math.atan2(c.z - a.z, c.x - a.x);
      }
    }
    if (!(best > 1e-8)) {
      stats.degenerate++;
      continue;
    }
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of pts) {
      const u = p.x * ca + p.z * sa;
      const v = -p.x * sa + p.z * ca;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    const hw = (u1 - u0) / 2;
    const hd = (v1 - v0) / 2;
    const um = (u0 + u1) / 2;
    const vm = (v0 + v1) / 2;
    const cx = um * ca - vm * sa;
    const cz = um * sa + vm * ca;
    // under 4 x 4 m and low: a shed, not worth a box
    if (hw * hd * 4 < (16 * S * S) && b.h < 5) {
      stats.droppedSmall++;
      continue;
    }
    const under = underLandmark(cx, cz);
    if (under) {
      stats[under === 'plan' ? 'skippedPlan' : 'skippedOutline']++;
      continue;
    }
    B.cx[n] = cx;
    B.cz[n] = cz;
    B.ang[n] = ang;
    B.hw[n] = hw;
    B.hd[n] = hd;
    B.h[n] = b.h;
    B.tone[n] = bi % 251;
    n++;
    const ex = Math.abs(hw * ca) + Math.abs(hd * sa);
    const ez = Math.abs(hw * sa) + Math.abs(hd * ca);
    if (cx - ex < x0) x0 = cx - ex;
    if (cx + ex > x1) x1 = cx + ex;
    if (cz - ez < z0) z0 = cz - ez;
    if (cz + ez > z1) z1 = cz + ez;
  }
  stats.built = n;
  if (!n) return { group, stats, material: null, footprints: [], skyRects: new Float32Array(0), update() {}, builtAt: () => 0 };

  // ---- bins: near cells (250 m) by counting sort, and the coarse blocks (125 m)
  const NC = NEAR_CELL_M * S;
  const FC = FAR_CELL_M * S;
  const gx0 = x0;
  const gz0 = z0;
  const nnx = Math.ceil((x1 - gx0) / NC) + 1;
  const nnz = Math.ceil((z1 - gz0) / NC) + 1;
  const cellOf = new Uint32Array(n);
  const counts = new Uint32Array(nnx * nnz + 1);
  for (let i = 0; i < n; i++) {
    const c = Math.floor((B.cz[i] - gz0) / NC) * nnx + Math.floor((B.cx[i] - gx0) / NC);
    cellOf[i] = c;
    counts[c + 1]++;
  }
  for (let c = 0; c < nnx * nnz; c++) counts[c + 1] += counts[c];
  const order = new Uint32Array(n);
  const fill = counts.slice(0, nnx * nnz);
  for (let i = 0; i < n; i++) order[fill[cellOf[i]]++] = i;
  const cellCount = (c) => counts[c + 1] - counts[c];

  const fnx = Math.ceil((x1 - gx0) / FC) + 1;
  const fnz = Math.ceil((z1 - gz0) / FC) + 1;
  const farArea = new Float32Array(fnx * fnz); // covered plan area (square world units)
  const farH = new Float32Array(fnx * fnz); // area-weighted height (metres x area)
  for (let i = 0; i < n; i++) {
    const c = Math.floor((B.cz[i] - gz0) / FC) * fnx + Math.floor((B.cx[i] - gx0) / FC);
    const a = 4 * B.hw[i] * B.hd[i];
    farArea[c] += a;
    farH[c] += a * B.h[i];
  }
  const cellArea = FC * FC;
  // built-up share of the ground (the ground tint reads it)
  const builtAt = (x, z) => {
    const i = Math.floor((x - gx0) / FC);
    const j = Math.floor((z - gz0) / FC);
    if (i < 0 || j < 0 || i >= fnx || j >= fnz) return 0;
    return Math.min(1, (farArea[j * fnx + i] / cellArea) * 1.6);
  };

  // ---- geometry
  const material = atmosphere.register(new THREE.MeshBasicMaterial({ vertexColors: true }));
  const _c = new THREE.Color();

  // appends one box (4 walls + the roof) to the typed builders
  function pushBox(out, cx, cz, ang, hw, hd, y0, y1, wall, roof) {
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const base = out.v;
    const corner = (su, sv) => [cx + su * hw * ca - sv * hd * sa, cz + su * hw * sa + sv * hd * ca];
    const C = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    // wall shade from the outward normal of each side
    const sides = [
      { a: 0, b: 1, nx: sa, nz: -ca }, // -v side
      { a: 1, b: 2, nx: ca, nz: sa }, // +u side
      { a: 2, b: 3, nx: -sa, nz: ca }, // +v side
      { a: 3, b: 0, nx: -ca, nz: -sa }, // -u side
    ];
    for (const s of sides) {
      // north is -z: a wall facing -z is lit more, east (+x) less
      const k = 0.5 * (1 + (-s.nz * 0.55 - s.nx * 0.35)); // 0..1 across the compass
      const shade = SHADE.e + (SHADE.n - SHADE.e) * Math.max(0, Math.min(1, k));
      const p = C[s.a];
      const q = C[s.b];
      const vi = out.v;
      out.pos.push(p[0], y0, p[1], q[0], y0, q[1], q[0], y1, q[1], p[0], y1, p[1]);
      for (let i = 0; i < 4; i++) out.col.push(wall.r * shade, wall.g * shade, wall.b * shade);
      out.idx.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
      out.v += 4;
    }
    const vi = out.v;
    for (const p of C) out.pos.push(p[0], y1, p[1]);
    for (let i = 0; i < 4; i++) out.col.push(roof.r * SHADE.roof, roof.g * SHADE.roof, roof.b * SHADE.roof);
    out.idx.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
    out.v += 4;
    return out.v - base;
  }
  const mk = () => ({ pos: [], col: [], idx: [], v: 0 });
  function toMesh(out, name) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(out.col, 3));
    g.setIndex(out.v > 65000 ? new THREE.Uint32BufferAttribute(out.idx, 1) : new THREE.Uint16BufferAttribute(out.idx, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.name = name;
    return m;
  }

  function buildingBox(out, i) {
    const cx = B.cx[i];
    const cz = B.cz[i];
    const ang = B.ang[i];
    const hw = B.hw[i];
    const hd = B.hd[i];
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    // the lowest ground under the box, minus a skirt, to the roof
    let lo = Infinity;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
      lo = Math.min(lo, surfaceAt(cx + su * hw * ca - sv * hd * sa, cz + su * hw * sa + sv * hd * ca));
    }
    const y0 = lo - 0.5;
    const y1 = lo + Math.max(2, B.h[i]) * S;
    const t = B.tone[i];
    pushBox(out, cx, cz, ang, hw, hd, y0, y1, WALL[t % WALL.length], ROOF[(t >> 2) % ROOF.length]);
  }

  // ---- near cells
  const near = new Map(); // cell -> mesh
  let focusCell = -1;
  const wanted = []; // cells to build, nearest first
  function wantNear(fx, fz) {
    wanted.length = 0;
    const ci = Math.floor((fx - gx0) / NC);
    const cj = Math.floor((fz - gz0) / NC);
    const R = Math.ceil((maxRadiusM * S) / NC);
    const cand = [];
    for (let j = cj - R; j <= cj + R; j++) {
      for (let i = ci - R; i <= ci + R; i++) {
        if (i < 0 || j < 0 || i >= nnx || j >= nnz) continue;
        const cxm = gx0 + (i + 0.5) * NC;
        const czm = gz0 + (j + 0.5) * NC;
        const d = Math.hypot(cxm - fx, czm - fz);
        if (d > maxRadiusM * S + NC * 0.7) continue;
        const c = j * nnx + i;
        if (cellCount(c)) cand.push({ c, d });
      }
    }
    cand.sort((a, b) => a.d - b.d);
    let total = 0;
    const keep = new Set();
    for (const q of cand) {
      const k = cellCount(q.c);
      if (total + k > budget && keep.size) break;
      total += k;
      keep.add(q.c);
      wanted.push(q.c);
    }
    return keep;
  }
  function buildCell(c) {
    const out = mk();
    for (let k = counts[c]; k < counts[c + 1]; k++) buildingBox(out, order[k]);
    if (!out.v) return null;
    const m = toMesh(out, `lite-near-${c}`);
    group.add(m);
    near.set(c, m);
    stats.triangles += out.idx.length / 3;
    stats.nearBuildings += counts[c + 1] - counts[c];
    return m;
  }
  function dropCell(c) {
    const m = near.get(c);
    if (!m) return;
    group.remove(m);
    m.geometry.dispose();
    near.delete(c);
    stats.triangles -= m.geometry.index.count / 3;
    stats.nearBuildings -= cellCount(c);
  }

  // ---- far blocks (all the 125 m cells outside the near set)
  let farMesh = null;
  let farDirty = true;
  function buildFar() {
    const out = mk();
    let blocks = 0;
    for (let j = 0; j < fnz; j++) {
      for (let i = 0; i < fnx; i++) {
        const c = j * fnx + i;
        const a = farArea[c];
        if (a < cellArea * 0.04) continue;
        const cx = gx0 + (i + 0.5) * FC;
        const cz = gz0 + (j + 0.5) * FC;
        // under a loaded near cell: its own buildings stand there
        const nc = Math.floor((cz - gz0) / NC) * nnx + Math.floor((cx - gx0) / NC);
        if (near.has(nc)) continue;
        const cover = Math.min(1, a / cellArea);
        const h = Math.max(6, farH[c] / a);
        const half = (FC / 2) * Math.sqrt(Math.min(1, cover * 1.15));
        const g0 = surfaceAt(cx, cz);
        // seen from far the roofs dominate: half way to the wall colour reads as a built-up block
        const wl = WALL[(i * 7 + j * 3) % WALL.length];
        pushBox(out, cx, cz, 0, half, half, g0 - 0.6, g0 + h * S * 0.85, wl, _c.copy(ROOF[(i + j) % ROOF.length]).lerp(wl, 0.45));
        blocks++;
      }
    }
    if (farMesh) {
      group.remove(farMesh);
      farMesh.geometry.dispose();
      stats.triangles -= farMesh.geometry.index.count / 3;
      farMesh = null;
    }
    stats.farBlocks = blocks;
    if (!out.v) return;
    farMesh = toMesh(out, 'lite-far');
    farMesh.frustumCulled = false;
    group.add(farMesh);
    stats.triangles += out.idx.length / 3;
  }

  // called every frame with the focus point and the camera distance (world units)
  let farAt = 0;
  let nearOn = true;
  function update(focus, camDist, perFrame = 2) {
    // beyond 3 km from the focus the near boxes are sub-pixel: far blocks only
    const wantNearOn = camDist < 800;
    if (wantNearOn !== nearOn) {
      nearOn = wantNearOn;
      farDirty = true;
    }
    if (nearOn) {
      const cell = Math.floor((focus.z - gz0) / NC) * nnx + Math.floor((focus.x - gx0) / NC);
      if (cell !== focusCell) {
        focusCell = cell;
        const keep = wantNear(focus.x, focus.z);
        for (const c of [...near.keys()]) if (!keep.has(c)) {
          dropCell(c);
          farDirty = true;
        }
      }
      let built = 0;
      for (const c of wanted) {
        if (built >= perFrame) break;
        if (near.has(c)) continue;
        buildCell(c);
        farDirty = true;
        built++;
      }
    } else if (near.size) {
      for (const c of [...near.keys()]) dropCell(c);
      focusCell = -1;
      farDirty = true;
    }
    const now = performance.now();
    if (farDirty && (!farMesh || now - farAt > 250)) {
      farDirty = false;
      farAt = now;
      buildFar();
    }
    stats.nearCells = near.size;
  }

  // the skyline grid of the cinema wants every building's box and height
  let sky = null;
  const skyRects = {
    get value() {
      if (!sky) {
        sky = new Float32Array(n * 5);
        for (let i = 0; i < n; i++) {
          const ca = Math.cos(B.ang[i]);
          const sa = Math.sin(B.ang[i]);
          const ex = Math.abs(B.hw[i] * ca) + Math.abs(B.hd[i] * sa);
          const ez = Math.abs(B.hw[i] * sa) + Math.abs(B.hd[i] * ca);
          sky.set([B.cx[i] - ex, B.cz[i] - ez, B.cx[i] + ex, B.cz[i] + ez, B.h[i]], i * 5);
        }
      }
      return sky;
    },
  };

  group.userData.updateLod = () => {};
  return {
    group,
    stats,
    // the full layer's reveal fade needs these two fields
    material: { userData: { reveal: { value: 1 } }, defines: {} },
    footprints: [],
    get skyRects() {
      return skyRects.value;
    },
    update,
    builtAt,
    count: n,
  };
}
