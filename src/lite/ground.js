// Lite ground and water: a coarse terrain grid (160 m cells, about 40 k
// triangles) with the colour baked into the vertices (land cover, slope
// shading, built-up share), and the water as one flat plane under it. An
// unlit material, no textures, no shaders of our own. Same handles main.js
// uses on the full ground (userData.applyPads, setLod, setLandcover).
import * as THREE from 'three';

const C = (h) => new THREE.Color(h);
const PAL = {
  heath: C(0x8a9460),
  grass: C(0x7e9a55),
  forest: C(0x4a683c),
  field: C(0xb2a468),
  urban: C(0x9a9083),
  rock: C(0x8e887c),
  shore: C(0xcbbf98),
  water: C(0x3f7391),
};
const SUN = new THREE.Vector3(-0.45, 0.75, -0.5).normalize(); // the baked light: from the north-west
const RING = 6; // outer vertex rings that fade into the horizon

export function createGroundLite({ terrain, heightAt, atmosphere, S, cell = 160 }) {
  const b = terrain.bounds;
  const cols = Math.max(2, Math.ceil((b.x1 - b.x0) / (cell * S)) + 1);
  const rows = Math.max(2, Math.ceil((b.zS - b.zN) / (cell * S)) + 1);
  const n = cols * rows;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const base = new Float32Array(n * 3); // the painted colours; the rim is blended from these
  const index = new Uint16Array((cols - 1) * (rows - 1) * 6);
  const dx = (b.x1 - b.x0) / (cols - 1);
  const dz = (b.zS - b.zN) / (rows - 1);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = (j * cols + i) * 3;
      pos[v] = b.x0 + i * dx;
      pos[v + 2] = b.zN + j * dz;
    }
  }
  let k = 0;
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      index[k++] = a;
      index[k++] = a + cols;
      index[k++] = a + 1;
      index[k++] = a + 1;
      index[k++] = a + cols;
      index[k++] = a + cols + 1;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  const material = atmosphere.register(new THREE.MeshBasicMaterial({ vertexColors: true }), { seasonal: true });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'ground';
  mesh.frustumCulled = false;

  // the sea level: elevation 1 m (the Douro and the coast read as water)
  const seaY = (1 - terrain.datum) * S;
  const wGeo = new THREE.PlaneGeometry(b.x1 - b.x0, b.zS - b.zN, 6, 6);
  wGeo.rotateX(-Math.PI / 2);
  wGeo.translate((b.x0 + b.x1) / 2, seaY, (b.zN + b.zS) / 2);
  const wCol = new Float32Array(wGeo.attributes.position.count * 3);
  wGeo.setAttribute('color', new THREE.BufferAttribute(wCol, 3));
  const wMat = atmosphere.register(new THREE.MeshBasicMaterial({ vertexColors: true }));
  const water = new THREE.Mesh(wGeo, wMat);
  water.name = 'water-lite';
  water.frustumCulled = false;
  water.renderOrder = -1;

  const group = new THREE.Group();
  group.name = 'ground-lite';
  group.add(water, mesh);

  let land = null; // { data, w, h, rect }
  let built = null; // (x, z) -> 0..1
  const tmp = new THREE.Color();
  const ny = new THREE.Vector3();

  function paint() {
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const idx = j * cols + i;
        const v = idx * 3;
        const x = pos[v];
        const z = pos[v + 2];
        const y = pos[v + 1];
        // slope from the neighbours
        const hl = pos[(j * cols + Math.max(0, i - 1)) * 3 + 1];
        const hr = pos[(j * cols + Math.min(cols - 1, i + 1)) * 3 + 1];
        const hu = pos[(Math.max(0, j - 1) * cols + i) * 3 + 1];
        const hd = pos[(Math.min(rows - 1, j + 1) * cols + i) * 3 + 1];
        ny.set(hl - hr, 2 * dx, hu - hd).normalize();
        const lit = Math.max(0, ny.dot(SUN));
        const shade = Math.min(1.18, 0.58 + 0.66 * lit);
        const slope = 1 - ny.y;
        let f = 0;
        let g = 0;
        let fl = 0;
        if (land) {
          const u = Math.floor(((x - land.rect.x0) / land.rect.w) * land.w);
          const w = Math.floor(((z - land.rect.z0) / land.rect.d) * land.h);
          if (u >= 0 && w >= 0 && u < land.w && w < land.h) {
            const o = (w * land.w + u) * 4;
            f = land.data[o] / 255;
            g = land.data[o + 1] / 255;
            fl = land.data[o + 2] / 255;
          }
        }
        tmp.copy(PAL.heath);
        if (fl > 0.05) tmp.lerp(PAL.field, Math.min(1, fl * 1.2));
        if (g > 0.05) tmp.lerp(PAL.grass, Math.min(1, g * 1.1));
        if (f > 0.05) tmp.lerp(PAL.forest, Math.min(1, f));
        const bu = built ? built(x, z) : 0;
        if (bu > 0.02) tmp.lerp(PAL.urban, Math.min(0.92, bu));
        if (slope > 0.12) tmp.lerp(PAL.rock, Math.min(0.7, (slope - 0.12) * 3));
        const above = y - seaY;
        if (above < 0.5) tmp.lerp(PAL.water, 1);
        else if (above < 1.4) tmp.lerp(PAL.shore, 0.7 * (1 - (above - 0.5) / 0.9));
        base[v] = tmp.r * shade;
        base[v + 1] = tmp.g * shade;
        base[v + 2] = tmp.b * shade;
      }
    }
    col.set(base);
    ring();
  }

  // the outer rings fade into the horizon colour (no fog here)
  function ring() {
    const tint = seasonOf();
    const hz = atmosphere.horizon;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const d = Math.min(i, j, cols - 1 - i, rows - 1 - j);
        if (d >= RING) continue;
        const a = 1 - d / RING; // 1 at the rim
        const v = (j * cols + i) * 3;
        col[v] = base[v] + (hz.r / tint.r - base[v]) * a * a;
        col[v + 1] = base[v + 1] + (hz.g / tint.g - base[v + 1]) * a * a;
        col[v + 2] = base[v + 2] + (hz.b / tint.b - base[v + 2]) * a * a;
      }
    }
    geo.attributes.color.needsUpdate = true;
    // the water plane's rim
    const wp = wGeo.attributes.position;
    for (let q = 0; q < wp.count; q++) {
      const x = wp.getX(q);
      const z = wp.getZ(q);
      const rim = Math.abs(x - (b.x0 + b.x1) / 2) > (b.x1 - b.x0) / 2 - 1 || Math.abs(z - (b.zN + b.zS) / 2) > (b.zS - b.zN) / 2 - 1;
      const wt = wMat.color;
      wCol[q * 3] = rim ? hz.r / Math.max(0.05, wt.r) : PAL.water.r;
      wCol[q * 3 + 1] = rim ? hz.g / Math.max(0.05, wt.g) : PAL.water.g;
      wCol[q * 3 + 2] = rim ? hz.b / Math.max(0.05, wt.b) : PAL.water.b;
    }
    wGeo.attributes.color.needsUpdate = true;
  }
  const _one = new THREE.Color(1, 1, 1);
  function seasonOf() {
    // the colour the ground material multiplies with: ring colours divide it out
    const c = material.color;
    return _one.set(Math.max(0.05, c.r), Math.max(0.05, c.g), Math.max(0.05, c.b));
  }
  atmosphere.onChange(ring);

  function applyPads() {
    for (let q = 0; q < n; q++) pos[q * 3 + 1] = heightAt(pos[q * 3], pos[q * 3 + 2]);
    geo.attributes.position.needsUpdate = true;
    geo.computeBoundingSphere();
    paint();
  }
  applyPads();

  // the height of the coarse mesh itself (the two triangles of the cell), so what
  // stands on it (roads, buildings) never sinks into or hovers over it
  function surfaceAt(x, z) {
    const fx = Math.min(cols - 1.0001, Math.max(0, (x - b.x0) / dx));
    const fz = Math.min(rows - 1.0001, Math.max(0, (z - b.zN) / dz));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = j * cols + i;
    const ha = pos[a * 3 + 1];
    const hr = pos[(a + 1) * 3 + 1];
    const hd = pos[(a + cols) * 3 + 1];
    if (u + v <= 1) return ha + (hr - ha) * u + (hd - ha) * v;
    const hdr = pos[(a + cols + 1) * 3 + 1];
    return hdr + (hd - hdr) * (1 - u) + (hr - hdr) * (1 - v);
  }

  group.userData = {
    applyPads,
    surfaceAt,
    setLod() {},
    setLandcover(tex, rect) {
      const img = tex?.image;
      if (!img?.data) return;
      land = { data: img.data, w: img.width, h: img.height, rect };
      paint();
    },
    // built-up share at a world point (0..1), from the lite city's cells
    setBuilt(fn) {
      built = fn;
      paint();
    },
    stats: { triangles: index.length / 3, cols, rows, seaY },
  };
  return group;
}
