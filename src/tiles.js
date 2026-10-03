// The whole city, streamed. The core (roads.json, buildings.json,
// nature.json) loads first and at once; then data/tiles/index.json, and the
// 1 km tiles around the core (scripts/fetch-tiles.mjs) stream in as the
// camera moves, nearest and most visible first:
//   - the wanted radius grows with the camera's height above the ground:
//     3 km at 300 m, 8 km at 2 km, everything from about 4.5 km up;
//   - a tile within 4 km of the camera gets the near LOD (every footprint
//     extruded with windows, all streets, water, shadows); farther tiles
//     the far LOD (one box per building, the main streets), merged 3 x 3
//     tiles per draw call;
//   - fetching, decoding and triangulating run in a Web Worker
//     (src/tile-worker.js); the main thread only wraps the typed arrays in
//     BufferGeometries, within about 2 ms per frame;
//   - new tiles fade in over 0.6 s (dither, buildings.js FADE_*);
//   - tiles beyond twice the radius are dropped; GPU memory is capped
//     (~350 MB desktop, ~120 MB phones);
//   - the land cover of each tile goes into one wide mask the ground shader
//     reads outside the core; the woods get trees (nature.js stream trees,
//     at most 8000 clumps); the main streets join the core's
//     constant-width street lines, with the core's own materials.
// Phones: half the radius, near LOD only within 2 km, one worker.
// ?tiles=0 turns the streaming off.
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { S } from './geo.js';
import { assetUrl } from './data.js';
import { dataPath } from './city.js';
import { groundAxes } from './scene.js';
import { BUILDING_UNIFORMS, createBuildingMaterial, FADE_S, FADE_VERT_PARS, FADE_VERT, FADE_FRAG_PARS, FADE_FRAG } from './buildings.js';
import { getFacadeConfig } from './facades.js';
import { SURFACE, STRUCTURE_COLORS } from './roads.js';
import { TREE_TABLES } from './nature.js';

const LAND_PX = 64; // land-cover pixels per tile side (~15 m)
const GROUP = 3; // far LOD: tiles per merged block side
const SLICE_MS = 2; // main-thread budget per frame for new geometry
const SCHEDULE_S = 0.25;
const VFAR_U = 6000 * S; // far tiles beyond this from the camera: roof-only houses
const FOCUS_KEEP_U = 3000 * S; // ... and only beyond this from the focus (the orbit target)
const CAST_U = 700; // shadows only within 2.8 km of the focus (as buildings-ms.js)
const ROAD_WIDTHS = { primary: 8, secondary: 5, minor: 3, service: 3, track: 2.5, rail: 2.5 };
const ROAD_COLORS = { ...SURFACE, service: 0x777066, track: 0x7d6c55 };

// A lit, vertex-coloured material with the streamed tiles' fade-in.
function fadeMaterial(params, defines = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, ...params });
  m.defines = { BRG_FADE: '', ...defines };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uClock = BUILDING_UNIFORMS.uClock;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${FADE_VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${FADE_VERT}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FADE_FRAG_PARS}`)
      .replace('#include <clipping_planes_fragment>', FADE_FRAG);
  };
  return m;
}

const linear = (hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

// horizontal distance from (x, z) to a rectangle
const rectDist = (r, x, z) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.zN - z, 0, z - r.zS));

export function createTiles({ renderer, scene, camera, terrain, heightAt, proj, roadLayer, nature, ground, mobile = false, debug = {} }) {
  const off = new URLSearchParams(location.search).get('tiles') === '0';
  const group = new THREE.Group();
  group.name = 'tiles';
  scene.add(group);

  const NEAR_M = mobile ? 2000 : 4000;
  const MEM_CAP = (mobile ? 120 : 350) * 1048576;
  // phones fetch and build fewer tiles at once, and hold fewer near-LOD
  // draw calls (each near tile is 3 meshes); desktops keep the full budget
  const MAX_INFLIGHT = mobile ? 3 : 6;
  const MAX_NEAR = mobile ? 28 : 110;
  const TREE_CAP = nature?.streamCap ?? 0;

  const matB = createBuildingMaterial({ fade: true });
  const matS = fadeMaterial({ roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  matS.name = 'streets-tiles';
  const matW = fadeMaterial({ roughness: 0.16 }, { BRG_WATER: '' });
  matW.name = 'water-tiles';

  const stats = { enabled: !off, total: 0, loaded: 0, pending: 0, near: 0, far: 0, tris: 0, gpuMB: 0, meshes: 0, trees: 0, radiusKm: 0, altM: 0, fetchMs: 0, buildMs: 0, integrateMs: 0, errors: 0, coverage: null };
  debug.tilesStats = stats;
  let clock = 0;
  let frames = 0;
  let index = null;
  let failed = false;
  let started = false;
  const tiles = new Map();
  const groups = new Map(); // far blocks
  const ready = [];
  const workers = [];
  let inflight = 0;
  let reqId = 0;
  let gpuBytes = 0;
  let sinceSchedule = SCHEDULE_S;
  let linesDirty = false;
  let sinceLines = 0;
  let landDirty = false;
  let sinceLand = 0;
  let treesDirty = false;
  let sinceTrees = 0;
  let treeKey = '';
  let castNow = true;  const nFetch = [0, 0];
  const nBuild = [0, 0];
  const nBuildNear = [0, 0, 0]; // sum, count, max (ms)
  const nBuildFar = [0, 0, 0];

  // ------------------------------------------------------------ start
  async function start() {
    started = true;
    let doc;
    try {
      const res = await fetch(assetUrl(dataPath('tiles/index.json')));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!(res.headers.get('content-type') || '').includes('json')) throw new Error('not JSON');
      doc = await res.json();
      if (!Array.isArray(doc?.tiles) || !doc.grid) throw new Error('no tiles[]');
    } catch (e) {
      failed = true;
      console.info(`[porto] tiles: ${dataPath('tiles/index.json')} unavailable (${e.message}); only the core is drawn`);
      return;
    }
    const g = doc.grid;
    for (const t of doc.tiles) {
      const [s, w, n, e] = t.bbox;
      const sw = proj.project(s, w);
      const ne = proj.project(n, e);
      const rect = { x0: sw.x, x1: ne.x, zN: ne.z, zS: sw.z };
      const key = `${t.x}_${t.y}`;
      tiles.set(key, {
        key,
        x: t.x,
        y: t.y,
        rect,
        cx: (rect.x0 + rect.x1) / 2,
        cz: (rect.zN + rect.zS) / 2,
        box: new THREE.Box3(new THREE.Vector3(rect.x0, -60, rect.zN), new THREE.Vector3(rect.x1, 260, rect.zS)),
        url: new URL(assetUrl(dataPath(`tiles/${key}.json`)), location.href).href,
        state: 'idle',
        lod: null,
        want: null,
        extras: false,
        meshes: [],
        bytes: 0,
        tris: 0,
        born: 0,
        far: null,
        lines: null,
        trees: null,
        tries: 0,
        retryAt: 0,
        reqId: 0,
        prio: 0,
        dCam: Infinity,
      });
    }
    index = doc;
    stats.total = tiles.size;
    stats.coverage = doc.coverage;

    // the wide land-cover mask: the core's own mask copied in, the tiles
    // painted in as they arrive
    const gsw = proj.project(g.bbox.s, g.bbox.w);
    const gne = proj.project(g.bbox.n, g.bbox.e);
    land.rect = { x0: gsw.x, z0: gne.z, w: gne.x - gsw.x, d: gsw.z - gne.z };
    land.w = g.nx * LAND_PX;
    land.h = g.ny * LAND_PX;
    land.ny = g.ny;
    land.data = new Uint8Array(land.w * land.h * 4);
    copyCoreLand();
    land.tex = new THREE.DataTexture(land.data, land.w, land.h, THREE.RGBAFormat);
    land.tex.flipY = false;
    land.tex.magFilter = THREE.LinearFilter;
    land.tex.minFilter = THREE.LinearMipmapLinearFilter;
    land.tex.generateMipmaps = true;
    land.tex.anisotropy = 4;
    land.tex.colorSpace = THREE.NoColorSpace;
    land.tex.needsUpdate = true;
    ground?.userData.setLandcoverWide?.(land.tex, land.rect);

    // workers
    const n = mobile ? 1 : Math.min(2, Math.max(1, (navigator.hardwareConcurrency || 2) - 2));
    const init = {
      type: 'init',
      origin: { lat: proj.lat0, lon: proj.lon0 },
      grid: terrain.grid,
      axes: groundAxes(terrain),
      kinds: doc.kinds,
      facade: getFacadeConfig(), // buildings.js set it while building the core
      roadWidths: ROAD_WIDTHS,
      roadColors: Object.fromEntries(Object.entries(ROAD_COLORS).map(([k, v]) => [k, linear(v)])),
      structureColors: Object.fromEntries(Object.entries(STRUCTURE_COLORS).map(([k, v]) => [k, linear(v)])),
      waterColor: linear(0x24404c),
      trees: TREE_TABLES,
      treesPerM2: 1 / 2500,
      treesPerTile: mobile ? 400 : 900,
      landPx: LAND_PX,
    };
    for (let i = 0; i < n; i++) {
      let w;
      try {
        w = new Worker(new URL('./tile-worker.js', import.meta.url), { type: 'module' });
      } catch (e) {
        failed = true;
        console.warn('[porto] tiles: no module worker; only the core is drawn', e);
        return;
      }
      const W = { w, busy: 0, ok: false };
      w.onmessage = (ev) => onMessage(W, ev.data);
      w.onerror = (ev) => {
        console.warn('[porto] tiles: worker failed', ev.message || ev);
        stats.errors++;
        W.dead = true;
      };
      w.postMessage(init);
      workers.push(W);
    }
  }

  const land = { tex: null, data: null, w: 0, h: 0, ny: 0, rect: null };
  function copyCoreLand() {
    const tex = nature?.landcover;
    const r = nature?.landRect;
    const src = tex?.image?.data;
    if (!src || !r) return;
    const sw = tex.image.width;
    const sh = tex.image.height;
    const px = land.rect.w / land.w;
    const c0 = Math.max(0, Math.floor((r.x0 - land.rect.x0) / px));
    const c1 = Math.min(land.w, Math.ceil((r.x0 + r.w - land.rect.x0) / px));
    const r0 = Math.max(0, Math.floor((r.z0 - land.rect.z0) / px));
    const r1 = Math.min(land.h, Math.ceil((r.z0 + r.d - land.rect.z0) / px));
    const pz = land.rect.d / land.h;
    for (let row = r0; row < r1; row++) {
      const z = land.rect.z0 + (row + 0.5) * pz;
      const v = Math.floor(((z - r.z0) / r.d) * sh);
      if (v < 0 || v >= sh) continue;
      for (let col = c0; col < c1; col++) {
        const x = land.rect.x0 + (col + 0.5) * px;
        const u = Math.floor(((x - r.x0) / r.w) * sw);
        if (u < 0 || u >= sw) continue;
        const si = (v * sw + u) * 4;
        const di = (row * land.w + col) * 4;
        land.data[di] = src[si];
        land.data[di + 1] = src[si + 1];
        land.data[di + 2] = src[si + 2];
        land.data[di + 3] = src[si + 3];
      }
    }
  }
  function paintLand(T, patch) {
    const col0 = T.x * LAND_PX;
    const row0 = (land.ny - 1 - T.y) * LAND_PX;
    for (let r = 0; r < LAND_PX; r++) {
      land.data.set(patch.subarray(r * LAND_PX * 4, (r + 1) * LAND_PX * 4), ((row0 + r) * land.w + col0) * 4);
    }
    landDirty = true;
  }

  // ------------------------------------------------------------ worker results
  function onMessage(W, m) {
    if (m.type === 'ready') {
      W.ok = true;
      return;
    }
    W.busy--;
    inflight--;
    ready.push(m);
  }

  function request(T, lod) {
    const alive = workers.filter((w) => !w.dead);
    if (!alive.length) return false;
    const W = alive.reduce((a, b) => (b.busy < a.busy ? b : a));
    T.reqId = ++reqId;
    T.want = lod;
    T.state = T.state === 'shown' ? 'shown' : 'loading';
    T.loading = true;
    W.busy++;
    inflight++;
    W.w.postMessage({ type: 'load', id: T.reqId, key: T.key, url: T.url, lod, extras: !T.extras });
    return true;
  }

  function geometryOf(p, born, wall) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(p.nor, 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(p.col, 3, true));
    if (wall) g.setAttribute('aWall', new THREE.BufferAttribute(p.wall, 4));
    const b = new Float32Array(p.verts).fill(born);
    g.setAttribute('aBorn', new THREE.BufferAttribute(b, 1));
    g.setIndex(new THREE.BufferAttribute(p.idx, 1));
    const [x0, y0, z0, x1, y1, z1] = p.box;
    g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    return g;
  }
  const bytesOf = (g) => {
    let n = g.index ? g.index.array.byteLength : 0;
    for (const a of Object.values(g.attributes)) n += a.array.byteLength;
    return n;
  };

  function addMesh(T, geo, mat, name, shadows) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = shadows && castNow;
    mesh.userData.casts = shadows;
    mesh.receiveShadow = true;
    group.add(mesh);
    T.meshes.push(mesh);
    const b = bytesOf(geo);
    T.bytes += b;
    gpuBytes += b;
    T.tris += geo.index.count / 3;
  }

  function dropNear(T) {
    for (const m of T.meshes) {
      group.remove(m);
      m.geometry.dispose();
    }
    gpuBytes -= T.bytes;
    T.meshes = [];
    T.bytes = 0;
    T.tris = 0;
  }

  function groupOf(T) {
    const key = `${Math.floor(T.x / GROUP)}_${Math.floor(T.y / GROUP)}`;
    let G = groups.get(key);
    if (!G) groups.set(key, (G = { key, members: new Set(), mesh: null, wmesh: null, bytes: 0, tris: 0, dirty: false }));
    return G;
  }

  function integrate(m) {
    const T = tiles.get(m.key);
    if (!T || m.id !== T.reqId) return; // superseded or dropped
    T.loading = false;
    if (m.type === 'error') {
      // a tile the index lists but the server does not have (a partial
      // deploy): given up at once, without noise
      if (/HTTP 404|is not JSON/.test(m.error)) {
        stats.missing = (stats.missing || 0) + 1;
        if (T.state === 'loading') T.state = 'failed';
        return;
      }
      stats.errors++;
      T.tries++;
      T.retryAt = clock + 5 * T.tries;
      if (T.state === 'loading') T.state = T.tries >= 3 ? 'failed' : 'idle';
      if (T.tries === 1 || T.state === 'failed') console.warn(`[porto] tiles: ${m.key} failed (${m.error})${T.state === 'failed' ? ', given up' : ''}`);
      return;
    }
    nFetch[0] += m.stats.fetchMs;
    nFetch[1] += m.stats.fetchMs > 0 ? 1 : 0;
    nBuild[0] += m.stats.buildMs;
    nBuild[1]++;
    const bl = m.lod === 'near' ? nBuildNear : nBuildFar;
    bl[0] += m.stats.buildMs;
    bl[1]++;
    bl[2] = Math.max(bl[2], m.stats.buildMs);
    const firstShow = T.state !== 'shown';
    const born = firstShow ? clock : clock - 10; // an LOD switch does not fade
    const prev = T.lod;
    // the old LOD goes once the new one is in place
    if (prev === 'near') dropNear(T);
    if (prev === 'far' && m.lod !== 'far') {
      const G = groupOf(T);
      G.members.delete(T);
      G.dirty = true;
      T.far = null;
    }
    if (m.lod === 'near') {
      if (m.mesh.b) addMesh(T, geometryOf(m.mesh.b, born, true), matB, `tile-buildings-${T.key}`, true);
      if (m.mesh.s) addMesh(T, geometryOf(m.mesh.s, born, false), matS, `tile-streets-${T.key}`, false);
      if (m.mesh.w) addMesh(T, geometryOf(m.mesh.w, born, false), matW, `tile-water-${T.key}`, false);
    } else {
      T.far = { b: m.mesh.b, bv: m.mesh.bv, w: m.mesh.w, born };
      const G = groupOf(T);
      G.members.add(T);
      G.dirty = true;
    }
    T.lod = m.lod;
    T.state = 'shown';
    if (m.extras) {
      T.extras = true;
      T.lines = m.extras.lines;
      T.trees = m.extras.trees.length ? m.extras.trees : null;
      paintLand(T, m.extras.land);
      linesDirty = true;
      treesDirty = true;
    }
  }

  // one far block: all its member tiles in one geometry (and one for water)
  function mergeFar(list, key, wall) {
    let verts = 0;
    let idx = 0;
    for (const { p } of list) {
      verts += p.verts;
      idx += p.idx.length;
    }
    if (!verts) return null;
    const pos = new Float32Array(verts * 3);
    const nor = new Int8Array(verts * 3);
    const col = new Uint8Array(verts * 3);
    const wl = wall ? new Float32Array(verts * 4) : null;
    const born = new Float32Array(verts);
    const ix = verts > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
    const box = new THREE.Box3();
    let vo = 0;
    let io = 0;
    for (const { p, b } of list) {
      pos.set(p.pos, vo * 3);
      nor.set(p.nor, vo * 3);
      col.set(p.col, vo * 3);
      if (wl) wl.set(p.wall, vo * 4);
      born.fill(b, vo, vo + p.verts);
      for (let i = 0; i < p.idx.length; i++) ix[io + i] = p.idx[i] + vo;
      box.expandByPoint(new THREE.Vector3(p.box[0], p.box[1], p.box[2])).expandByPoint(new THREE.Vector3(p.box[3], p.box[4], p.box[5]));
      vo += p.verts;
      io += p.idx.length;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
    if (wl) g.setAttribute('aWall', new THREE.BufferAttribute(wl, 4));
    g.setAttribute('aBorn', new THREE.BufferAttribute(born, 1));
    g.setIndex(new THREE.BufferAttribute(ix, 1));
    g.boundingBox = box;
    g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    return g;
  }

  function rebuildGroup(G) {
    G.dirty = false;
    for (const m of [G.mesh, G.wmesh]) {
      if (!m) continue;
      group.remove(m);
      m.geometry.dispose();
    }
    gpuBytes -= G.bytes;
    G.bytes = 0;
    G.tris = 0;
    G.mesh = G.wmesh = null;
    const members = [...G.members];
    // tiles beyond VFAR_M draw their roof-only variant (no walls)
    const pick = (T) => (T.vf && T.far.bv ? T.far.bv : T.far.b);
    const gb = mergeFar(members.filter(pick).map((T) => ({ p: pick(T), b: T.far.born })), G.key, true);
    const gw = mergeFar(members.filter((T) => T.far.w).map((T) => ({ p: T.far.w, b: T.far.born })), G.key, false);
    const put = (g, mat, name) => {
      if (!g) return null;
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = name;
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      group.add(mesh);
      const b = bytesOf(g);
      G.bytes += b;
      gpuBytes += b;
      G.tris += g.index.count / 3;
      return mesh;
    };
    G.mesh = put(gb, matB, `tiles-far-${G.key}`);
    G.wmesh = put(gw, matW, `tiles-far-water-${G.key}`);
    if (!G.members.size) groups.delete(G.key);
  }

  // ------------------------------------------------------------ street lines
  const lineMeshes = [];
  function rebuildLines() {
    linesDirty = false;
    for (const m of lineMeshes) {
      group.remove(m);
      m.geometry.dispose();
    }
    lineMeshes.length = 0;
    for (const kind of ['primary', 'secondary', 'water']) {
      const core = roadLayer?.lines?.[kind];
      if (!core) continue;
      let n = 0;
      for (const T of tiles.values()) if (T.lines && T.state === 'shown') n += T.lines[kind].length;
      if (!n) continue;
      const arr = new Float32Array(n);
      let o = 0;
      for (const T of tiles.values()) {
        if (!T.lines || T.state !== 'shown') continue;
        arr.set(T.lines[kind], o);
        o += T.lines[kind].length;
      }
      const geo = new LineSegmentsGeometry();
      geo.setPositions(arr);
      const add = (mat, order, name) => {
        const line = new LineSegments2(geo, mat);
        line.renderOrder = order;
        line.frustumCulled = false;
        line.name = name;
        line.userData.core = core;
        group.add(line);
        lineMeshes.push(line);
      };
      add(core.material, core.renderOrder, `tiles-road-${kind}`);
      if (kind === 'primary') for (const gm of roadLayer.glows || []) add(gm, core.renderOrder + 1, 'tiles-road-primary-glow');
    }
  }

  // ------------------------------------------------------------ trees
  function rebalanceTrees() {
    treesDirty = false;
    if (!nature?.setStreamTrees || !TREE_CAP) return;
    const list = [...tiles.values()].filter((T) => T.trees && T.state === 'shown').sort((a, b) => a.dCam - b.dCam);
    const chosen = [];
    let n = 0;
    for (const T of list) {
      const c = T.trees.length / 9;
      if (n + c > TREE_CAP) continue;
      chosen.push(T);
      n += c;
    }
    const key = chosen.map((T) => T.key).join(',');
    if (key === treeKey) return;
    treeKey = key;
    nature.setStreamTrees(chosen.map((T) => T.trees));
    stats.trees = n;
  }

  // ------------------------------------------------------------ scheduling
  const _frustum = new THREE.Frustum();
  const _pm = new THREE.Matrix4();
  function radiusFor(altM) {
    if (altM > (mobile ? 6000 : 4500)) return Infinity;
    const r = 3000 * Math.pow(Math.max(altM, 300) / 300, 0.517);
    return (mobile ? r / 2 : r) * S;
  }

  function schedule() {
    const cam = camera.position;
    const focus = camera.userData.focus || cam;
    const altU = Math.max(0, cam.y - heightAt(cam.x, cam.z));
    const R = radiusFor(altU / S);
    stats.radiusKm = Number.isFinite(R) ? +(R / S / 1000).toFixed(1) : 'all';
    stats.altM = Math.round(altU / S);
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pm);
    const nearU = NEAR_M * S;
    const cands = [];
    let nearShown = 0;
    for (const T of tiles.values()) if (T.state === 'shown' && T.lod === 'near') nearShown++;
    for (const T of tiles.values()) {
      const dCam = rectDist(T.rect, cam.x, cam.z);
      const dFoc = rectDist(T.rect, focus.x, focus.z);
      const d = Math.min(dCam, dFoc);
      const d3 = Math.hypot(dCam, altU);
      T.dCam = d3;
      const inView = _frustum.intersectsBox(T.box);
      T.prio = (inView ? 1 : 0.3) / Math.max(d3, 25);
      const lodWant = d3 < nearU ? 'near' : d3 > nearU * 1.2 ? 'far' : T.lod || 'far';
      // very far: roof-only houses, when the tile is 6 km from the camera
      // and 3 km from the focus (hysteresis of 10 %)
      const vf = dFoc > FOCUS_KEEP_U && d3 > (T.vf ? VFAR_U * 0.9 : VFAR_U);
      if (vf !== !!T.vf) {
        T.vf = vf;
        if (T.lod === 'far' && T.far) groupOf(T).dirty = true;
      }
      if (T.lod === 'near') T.prio *= 2;
      if (T.state === 'shown' && d > 2 * R) {
        unload(T);
        continue;
      }
      if (T.loading || T.state === 'failed' || d >= R) continue;
      if (clock < T.retryAt) continue; // after an error (a failed LOD switch too)
      // phones/light: don't fetch off-screen tiles far from the orbit focus
      // (they only cost fill-in when the camera turns); close tiles and the
      // focus's tiles always stream
      const nearFocus = dFoc < FOCUS_KEEP_U;
      if (mobile && !inView && !nearFocus && d3 > nearU * 2) continue;
      let lod = lodWant;
      // near-LOD draw-call cap: beyond ~85 % of the near radius, a tile
      // beyond the cap streams as a far block instead of 3 near meshes
      if (lod === 'near' && T.state !== 'shown' && nearShown >= MAX_NEAR && d3 > nearU * 0.85) lod = 'far';
      if (T.state === 'idle' || (T.state === 'shown' && T.lod !== lodWant)) cands.push({ T, lod, p: T.prio * (lod === 'near' ? 3 : 1) * (T.state === 'shown' ? 0.8 : 1) });
    }
    cands.sort((a, b) => b.p - a.p);
    let sent = 0;
    for (const c of cands) {
      if (inflight >= MAX_INFLIGHT) break;
      // memory cap: a new tile only if it fits, after dropping lower-priority ones
      if (c.T.state !== 'shown' && gpuBytes > MEM_CAP * 0.92 && !evictFor(c.p)) break;
      if (request(c.T, c.lod)) sent++;
    }
    quiet = !sent && !inflight && !ready.length ? quiet + 1 : 0;
  }
  let quiet = 0;

  function evictFor(p) {
    const shown = [...tiles.values()].filter((T) => T.state === 'shown' && T.prio < p).sort((a, b) => a.prio - b.prio);
    let k = 0;
    while (gpuBytes > MEM_CAP * 0.85 && k < shown.length) unload(shown[k++]);
    return gpuBytes <= MEM_CAP * 0.92;
  }

  function unload(T) {
    if (T.lod === 'near') dropNear(T);
    if (T.lod === 'far') {
      const G = groupOf(T);
      G.members.delete(T);
      G.dirty = true;
    }
    T.far = null;
    T.lod = null;
    T.state = 'idle';
    T.reqId++; // anything in flight for it is stale now
    T.loading = false;
    if (T.lines) linesDirty = true;
    if (T.trees) treesDirty = true;
    T.lines = null;
    T.trees = null;
    T.extras = false; // lines and trees come again with the next load
  }

  // ------------------------------------------------------------ per frame
  function update(dt = 1 / 60) {
    frames++;
    clock += dt;
    BUILDING_UNIFORMS.uClock.value = clock;
    if (off || failed) return;
    // after the core's first frames: its shaders compile first
    if (!started) {
      if (debug.ready && frames > 20) start();
      return;
    }
    if (!index || !workers.some((w) => w.ok)) return;

    sinceSchedule += dt;
    if (sinceSchedule >= SCHEDULE_S) {
      sinceSchedule = 0;
      schedule();
    }
    // new geometry within the frame budget
    const t0 = performance.now();
    while (ready.length && performance.now() - t0 < SLICE_MS) integrate(ready.shift());
    for (const G of groups.values()) {
      if (performance.now() - t0 >= SLICE_MS) break;
      if (G.dirty) rebuildGroup(G);
    }
    sinceLines += dt;
    if (linesDirty && sinceLines > 1 && performance.now() - t0 < SLICE_MS) {
      sinceLines = 0;
      rebuildLines();
    }
    sinceLand += dt;
    if (landDirty && sinceLand > 0.8) {
      sinceLand = 0;
      landDirty = false;
      land.tex.needsUpdate = true;
    }
    sinceTrees += dt;
    if (treesDirty && sinceTrees > 1) {
      sinceTrees = 0;
      rebalanceTrees();
    }
    const spent = performance.now() - t0;
    stats.integrateMs = +(stats.integrateMs * 0.9 + spent * 0.1).toFixed(2);

    // shadows from the near tiles like the core: only when they can be seen
    const focus = camera.userData.focus;
    const camDist = focus ? camera.position.distanceTo(focus) : 0;
    const cast = camDist < CAST_U;
    if (cast !== castNow) {
      castNow = cast;
      for (const m of group.children) if (m.userData.casts) m.castShadow = cast;
    }
    if (frames % 15 === 0) {
      // The OSM core (buildings.js) and the landmarks follow the same rule.
      // Set every time: main.js also sets the core's flag (at 4000 units).
      const core = scene.getObjectByName('buildings');
      if (core) for (const m of core.children) if (m.isMesh) m.castShadow = cast;
      core?.userData.updateLod?.(camera.position, focus || camera.position);
      scene.getObjectByName('landmarks')?.traverse((m) => {
        if (!m.isMesh) return;
        if (m.userData.castOrig === undefined) m.userData.castOrig = m.castShadow || !cast; // meshes seen while off keep their casting
        m.castShadow = cast && m.userData.castOrig;
      });
    }
    // the thin river line follows the core's (hidden in a close-up)
    for (const l of lineMeshes) l.visible = l.userData.core.visible;

    if (frames % 15 === 0) refreshStats();
  }

  function refreshStats() {
    let loaded = 0;
    let near = 0;
    let far = 0;
    let tris = 0;
    let meshes = 0;
    for (const T of tiles.values()) {
      if (T.state !== 'shown') continue;
      loaded++;
      if (T.lod === 'near') {
        near++;
        tris += T.tris;
        meshes += T.meshes.length;
      } else far++;
    }
    for (const G of groups.values()) {
      tris += G.tris;
      meshes += (G.mesh ? 1 : 0) + (G.wmesh ? 1 : 0);
    }
    Object.assign(stats, {
      loaded,
      pending: inflight + ready.length,
      near,
      far,
      tris: Math.round(tris),
      gpuMB: +(gpuBytes / 1048576).toFixed(1),
      meshes: meshes + lineMeshes.length,
      fetchMs: nFetch[1] ? +(nFetch[0] / nFetch[1]).toFixed(1) : 0,
      buildMs: nBuild[1] ? +(nBuild[0] / nBuild[1]).toFixed(1) : 0,
      buildNearMs: nBuildNear[1] ? [+(nBuildNear[0] / nBuildNear[1]).toFixed(1), +nBuildNear[2].toFixed(1)] : 0,
      buildFarMs: nBuildFar[1] ? [+(nBuildFar[0] / nBuildFar[1]).toFixed(1), +nBuildFar[2].toFixed(1)] : 0,
      landMB: land.data ? +(land.data.byteLength / 1048576).toFixed(1) : 0,
    });
    if (debug.stats) debug.stats.tiles = stats;
  }

  const api = {
    group,
    stats,
    update,
    get index() {
      return index;
    },
    tiles,
    // for tests: resolves when nothing is pending (or after timeoutMs)
    idle(timeoutMs = 30000) {
      const t0 = performance.now();
      return new Promise((res) => {
        const tick = () => {
          if (off || failed) return res(stats);
          const busy = !index || inflight > 0 || ready.length > 0 || quiet < 2 || [...groups.values()].some((G) => G.dirty);
          if (!busy || performance.now() - t0 > timeoutMs) {
            refreshStats();
            return res(stats);
          }
          setTimeout(tick, 100);
        };
        tick();
      });
    },
    fadeS: FADE_S,
  };
  debug.tiles = api;
  return api;
}
