// Walk mode (src/main.js startMode('walk')): the visitor stands in the street
// at eye height and walks.
//
//   W / S, ↑ / ↓   forward, back        A / D, ← / →   step left, right
//   Shift          run                   drag           look around
//   phone          the stick walks, a drag on the map looks around
//
// This file owns the camera while it is active: main.js calls update()
// instead of the orbit rig, and lowers its ground floor and near plane (EYE
// and NEAR below). The walker does not pass through buildings
// (walk-collide.js, on the outlines main.js hands over). The orbit target
// rides a few metres ahead of the walker, so the tiles, the crowd and the
// labels that follow "where the camera looks" keep working.
import * as THREE from 'three';
import { t } from './i18n.js';
import { METRES_PER_UNIT } from './geo.js';
import { createCollider } from './walk-collide.js';
import { createFigure } from './walk-figure.js';
import { loadCharacter } from './character-model.js';

// the walker: a textured model with idle, walk and run (assets/characters/3d/)
const HERO = {
  url: 'assets/characters/3d/heroi.glb',
  clips: { idle: 'assets/characters/3d/heroi-idle.glb', walk: 'own', run: 'assets/characters/3d/heroi-run.glb' },
};

const M = 1 / METRES_PER_UNIT; // world units per metre
export const EYE = 1.7 * M; // eye height above the ground
export const NEAR = 0.3 * M; // near plane while walking
const SPEED = 1.4 * M; // walk, units per second
const RUN = 4.2 * M;
const BODY = 0.3 * M; // body radius: a slim person fits between a bollard and a table
const FOV = 62; // the orbit camera's 38 degrees is a telephoto at eye level
const LOOK = 0.0042; // radians per pixel
const PITCH = 1.25; // look up and down limit, radians
const AHEAD = 12 * M; // the orbit target rides this far ahead
const BACK = 4.6 * M; // third person: the camera's distance from the head
const HEAD = 1.62 * M; // third person: the point the camera turns about
const TILT = 0.3; // third person: the camera sits this far above level, radians
const CLOSE = 1.6 * M; // third person: with less room than this the camera looks from the eyes
const PLACE_M = 25; // a place this near offers its card
// riding an e-scooter (mount / dismount): arcade handling, metres and seconds
const RIDE_MAX = 8.5 * M; // about 30 km/h
const RIDE_BOOST = 11 * M; // Shift: about 40 km/h
const RIDE_BACK = 3 * M; // reverse
const RIDE_ACC = 6 * M; // per second
const RIDE_BRAKE = 12 * M;
const RIDE_DRAG = 0.9; // per second, rolling with no throttle
const RIDE_TURN = 2.2; // radians per second at full speed
const RIDE_BODY = 0.4 * M;
const RIDE_DECK = 0.18 * M; // the rider stands on the deck
const RIDE_CAM = 6.5 * M; // the chase camera's distance

// distance from a point to an outline ([{x, z}]), world units
function outlineDistance(pts, x, z) {
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const ax = pts[j].x, az = pts[j].z;
    const dx = pts[i].x - ax, dz = pts[i].z - az;
    const len = dx * dx + dz * dz;
    const k = len > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len)) : 0;
    best = Math.min(best, Math.hypot(x - ax - dx * k, z - az - dz * k));
  }
  return best;
}

const KEYS = {
  KeyW: ['z', 1], ArrowUp: ['z', 1], KeyS: ['z', -1], ArrowDown: ['z', -1],
  KeyD: ['x', 1], ArrowRight: ['x', 1], KeyA: ['x', -1], ArrowLeft: ['x', -1],
};

// places: () => [{ i, name, x, z, outline }] (world units), read at start;
// onPlace(i): the visitor asked for that place's card (the mode has ended)
// street: () => the built street layer ({ lanes, spots }) or null
// solidModels: names of landmark meshes whose own houses are the walls (a
// house row drawn over an open quay): what of them stands higher than 2.2 m
// over the ground blocks the walker
export function createWalk({ camera, scene, rig, heightAt, dom, polys, places = () => [], street = () => null, water = () => null, solidModels = [], reducedMotion = false, bounds = null, onEnter, onExit, onPlace }) {
  // Open water blocks the walker, but not where a street, a sidewalk or a
  // paved square is drawn over it (a bridge, a quay).
  let wet = null;
  let wetRings = null;
  const wetAt = (x, z) => {
    const rings = water();
    if (rings !== wetRings) {
      wetRings = rings;
      wet = rings?.length ? createCollider(rings) : null;
    }
    return (!!wet && wet.inside(x, z) && !pavedAt(x, z)) || inModel(x, z);
  };
  // The solid models as a mask of 0.5 m cells, from their triangles above
  // head height (walls, roofs, the ceiling of an arcade). Built when the
  // model is (it builds lazily), read through the collider's extra rule.
  const MASK = 0.5 * M; // cell, world units
  const masks = new Map(); // mesh name -> { uuid, x0, z0, w, h, bits } (bits null: nothing high)
  // counts the changes to what blocks (a model mask, the furniture): the
  // crowd then moves its paths out of the solids again (people.js)
  let obstacles = 0;
  function maskModel(o) {
    const g = o.geometry;
    if (masks.get(o.name)?.uuid === g.uuid) return;
    // the placeholder box of a model still in the worker is no house row
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (tris < 200) return void masks.delete(o.name);
    masks.set(o.name, { uuid: g.uuid, bits: null, ...buildMask(o) });
    obstacles++;
  }
  function buildMask(o) {
    const g = o.geometry;
    o.updateWorldMatrix(true, false);
    const e = o.matrixWorld.elements;
    const p = g.attributes.position.array, ix = g.index?.array;
    const n = ix ? ix.length : p.length / 3;
    const tris = [];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < n; k += 3) {
      const v = [];
      let y = 0;
      for (let c = 0; c < 3; c++) {
        const a = (ix ? ix[k + c] : k + c) * 3;
        const px = p[a], py = p[a + 1], pz = p[a + 2];
        v.push(e[0] * px + e[4] * py + e[8] * pz + e[12], e[2] * px + e[6] * py + e[10] * pz + e[14]);
        y += (e[1] * px + e[5] * py + e[9] * pz + e[13]) / 3;
      }
      const cx = (v[0] + v[2] + v[4]) / 3, cz = (v[1] + v[3] + v[5]) / 3;
      if (y - heightAt(cx, cz) < 2.2 * M) continue;
      tris.push(v);
      x0 = Math.min(x0, v[0], v[2], v[4]);
      x1 = Math.max(x1, v[0], v[2], v[4]);
      z0 = Math.min(z0, v[1], v[3], v[5]);
      z1 = Math.max(z1, v[1], v[3], v[5]);
    }
    if (!tris.length) return {};
    const w = Math.ceil((x1 - x0) / MASK) + 1, h = Math.ceil((z1 - z0) / MASK) + 1;
    const bits = new Uint8Array(w * h);
    for (const v of tris) {
      // every cell whose centre is in the triangle, and the cells of its corners
      const i0 = Math.floor((Math.min(v[0], v[2], v[4]) - x0) / MASK), i1 = Math.floor((Math.max(v[0], v[2], v[4]) - x0) / MASK);
      const j0 = Math.floor((Math.min(v[1], v[3], v[5]) - z0) / MASK), j1 = Math.floor((Math.max(v[1], v[3], v[5]) - z0) / MASK);
      for (let c = 0; c < 6; c += 2) bits[Math.floor((v[c + 1] - z0) / MASK) * w + Math.floor((v[c] - x0) / MASK)] = 1;
      const den = (v[3] - v[5]) * (v[0] - v[4]) + (v[4] - v[2]) * (v[1] - v[5]);
      if (Math.abs(den) < 1e-12) continue;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = x0 + (i + 0.5) * MASK, z = z0 + (j + 0.5) * MASK;
          const a = ((v[3] - v[5]) * (x - v[4]) + (v[4] - v[2]) * (z - v[5])) / den;
          const b = ((v[5] - v[1]) * (x - v[4]) + (v[0] - v[4]) * (z - v[5])) / den;
          if (a >= 0 && b >= 0 && a + b <= 1) bits[j * w + i] = 1;
        }
      }
    }
    // an opening (erode, then grow back): a pole, a rope, a lamp arm or a
    // mast, thinner than 1.5 m, is no wall
    const pass = (src, keep) => {
      const out = new Uint8Array(w * h);
      for (let j = 1; j < h - 1; j++) {
        for (let i = 1; i < w - 1; i++) {
          let all = 1, any = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const b = src[(j + dj) * w + i + di]; all &= b; any |= b; }
          out[j * w + i] = keep ? all : any;
        }
      }
      return out;
    };
    return { x0, z0, w, h, bits: pass(pass(bits, true), false) };
  }
  function inModel(x, z) {
    for (const m of masks.values()) {
      if (!m.bits) continue;
      const i = Math.floor((x - m.x0) / MASK), j = Math.floor((z - m.z0) / MASK);
      if (i >= 0 && j >= 0 && i < m.w && j < m.h && m.bits[j * m.w + i]) return true;
    }
    return false;
  }
  function readModels() {
    for (const name of solidModels) {
      const o = scene.getObjectByName(name);
      if (o?.isMesh && o.geometry?.attributes?.position) maskModel(o);
    }
  }
  let collider = createCollider(polys, 8, wetAt);
  let seatCount = 0;
  let solidCount = 0; // furniture obstacles in the collider
  // The street layer may arrive after this module, or be switched off. At
  // each start: seated people and their tables become obstacles, and the
  // walk lanes (where the crowd walks) say where a street is.
  // The paving sits above the terrain (about 0.6 m in Braga: kerbs and the
  // graded street). The walk lanes carry that surface height, so the walker
  // stands on the mean of the lane points around; with none within 8 m, on
  // the terrain plus the usual lift. Porto ships no streetscape.json: main.js
  // hands over the promenade paths (porto-streetscape.js) as the lanes, with
  // no seats and no furniture.
  const CELL = 2; // world units
  let laneGrid = null;
  let laneY = null;
  let lift = 0;
  function readLanes() {
    const lanes = street()?.lanes;
    if (!lanes?.X?.length || laneY === lanes.Y) return;
    laneY = lanes.Y;
    laneGrid = new Map();
    const lifts = [];
    for (let k = 0; k < lanes.X.length; k++) {
      const key = Math.floor(lanes.X[k] / CELL) * 65536 + Math.floor(lanes.Z[k] / CELL);
      let bucket = laneGrid.get(key);
      if (!bucket) laneGrid.set(key, (bucket = []));
      bucket.push(lanes.X[k], lanes.Z[k], lanes.Y[k]);
      if (k % 9 === 0) lifts.push(lanes.Y[k] - heightAt(lanes.X[k], lanes.Z[k]));
    }
    lifts.sort((a, b) => a - b);
    lift = Math.max(0, lifts[lifts.length >> 1] || 0);
  }
  // What the walker stands on is what is drawn: the top triangle under the
  // feet among the carriageways, the sidewalks and the paved squares, or the
  // terrain. The triangles within 1.2 km are indexed in 4 m cells, and again
  // when the walker nears the edge of that index. A surface more than 0.6 m
  // over the feet is not a step (a deck overhead, a wall).
  // Porto: the ground mesh (ground-mesh.js) refills its index buffer every
  // frame with only the chunks in view, so its triangles are not read here.
  // The lattice is built from heightAt, so heightAt is the terrain. The quay
  // terraces on the Douro (quays.js) are paved decks over the river's edge,
  // and a landmark model's floors are drawn too (the Ribeira row's raised
  // quay, a church's steps, a bridge deck): without them the walker stood
  // waist-deep in the model's paving.
  const WALKABLE = /^(street-plate|sidewalks|street-(?!water|lamps)[a-z]+|calcada-squares|roundabout-islands|quays-.+|landmark-(?!massing)[a-z0-9-]+)$/;
  const SURF_R = 300; // world units
  const STEP_UP = 0.6 * M;
  // a quay terrace or a model's floor may stand higher than a step over the
  // street beside it (Porto's quay decks: 1.4 m, their edge a plain skirt);
  // the walker climbs it, the eye eases up. A deck or a ceiling overhead is
  // higher than this.
  const CLIMB = 1.8 * M;
  const CLIMBS = /^(quays-|landmark-)/;
  let surf = null; // { tri: Float32Array, grid: Map, x, z, key }
  const _sphere = new THREE.Sphere();
  // Reading the surface walks up to a million triangles (about 0.3 s on a
  // laptop). On the way, while the old index still covers the walker, the new
  // one is built a few milliseconds per frame (pumpSurface), so the walk does
  // not freeze. Only the first read and a jump (start, teleport, or a walker
  // near the edge of the old index) read it in one go.
  let job = null; // the index being built: a generator, see buildSurface
  const SLICE_MS = 3;
  function readSurface(x, z, now = true) {
    if (job && !now) return;
    readModels();
    const meshes = [];
    scene.traverseVisible((o) => {
      if (!o.isMesh || o.isInstancedMesh || !WALKABLE.test(o.name) || !o.geometry?.attributes?.position) return;
      // a model far from the walker: not read at all
      const g = o.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      o.updateWorldMatrix(true, false);
      _sphere.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
      if (Math.hypot(_sphere.center.x - x, _sphere.center.z - z) > SURF_R + _sphere.radius) return;
      meshes.push(o);
    });
    const key = meshes.map((o) => o.geometry.uuid).join();
    const off = surf ? Math.hypot(x - surf.x, z - surf.z) : Infinity;
    if (surf && surf.key === key && off < SURF_R * 0.6) return;
    job = buildSurface(x, z, meshes, key);
    // the old index still holds 0.25 SURF_R past the walker: build in slices
    if (!now && off < SURF_R * 0.75) return;
    pumpSurface(Infinity);
  }
  function pumpSurface(ms = SLICE_MS) {
    if (!job) return;
    const t0 = performance.now();
    for (;;) {
      const r = job.next();
      if (r.done) {
        surf = r.value;
        job = null;
        return;
      }
      if (performance.now() - t0 > ms) return;
    }
  }
  function* buildSurface(x, z, meshes, key) {
    let tri = new Float32Array(9 * 8192);
    let nt = 0; // floats used in tri
    const paved = [];
    const climb = [];
    const grid = new Map();
    let since = 0;
    for (const o of meshes) {
      const hard = o.name !== 'street-plate' ? 1 : 0;
      const up = CLIMBS.test(o.name) ? 1 : 0;
      o.updateWorldMatrix(true, false);
      const e = o.matrixWorld.elements;
      const p = o.geometry.attributes.position.array, ix = o.geometry.index?.array;
      const n = ix ? ix.length : p.length / 3;
      const v = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let k = 0; k < n; k += 3) {
        if (++since >= 2048) {
          since = 0;
          yield;
        }
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let c = 0; c < 3; c++) {
          const a = (ix ? ix[k + c] : k + c) * 3;
          const px = p[a], py = p[a + 1], pz = p[a + 2];
          const wx = e[0] * px + e[4] * py + e[8] * pz + e[12];
          const wz = e[2] * px + e[6] * py + e[10] * pz + e[14];
          v[c * 3] = wx;
          v[c * 3 + 1] = e[1] * px + e[5] * py + e[9] * pz + e[13];
          v[c * 3 + 2] = wz;
          if (wx < x0) x0 = wx;
          if (wx > x1) x1 = wx;
          if (wz < z0) z0 = wz;
          if (wz > z1) z1 = wz;
        }
        if (x1 < x - SURF_R || x0 > x + SURF_R || z1 < z - SURF_R || z0 > z + SURF_R) continue;
        // a wall or a kerb face has no area from above
        if (Math.abs((v[5] - v[8]) * (v[0] - v[6]) + (v[6] - v[3]) * (v[2] - v[8])) < 1e-9) continue;
        const at = nt;
        if (nt + 9 > tri.length) {
          const t = new Float32Array(tri.length * 2);
          t.set(tri);
          tri = t;
        }
        tri.set(v, nt);
        nt += 9;
        paved.push(hard);
        climb.push(up);
        for (let i = Math.floor(x0); i <= Math.floor(x1); i++) {
          for (let j = Math.floor(z0); j <= Math.floor(z1); j++) {
            const g = i * 65536 + j;
            let bucket = grid.get(g);
            if (!bucket) grid.set(g, (bucket = []));
            bucket.push(at);
          }
        }
      }
    }
    return nt ? { tri: tri.subarray(0, nt), paved, climb, grid, x, z, key } : null;
  }
  // a street, a sidewalk or a paved square is drawn at (x, z)
  function pavedAt(x, z) {
    const bucket = surf?.grid.get(Math.floor(x) * 65536 + Math.floor(z));
    if (!bucket) return false;
    const t = surf.tri;
    for (const a of bucket) {
      if (!surf.paved[a / 9]) continue;
      const x1 = t[a], z1 = t[a + 2], x2 = t[a + 3], z2 = t[a + 5], x3 = t[a + 6], z3 = t[a + 8];
      const den = (z2 - z3) * (x1 - x3) + (x3 - x2) * (z1 - z3);
      const u = ((z2 - z3) * (x - x3) + (x3 - x2) * (z - z3)) / den;
      const v = ((z3 - z1) * (x - x3) + (x1 - x3) * (z - z3)) / den;
      if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) return true;
    }
    return false;
  }
  // the drawn surface under (x, z): the highest one the walker can step on
  // from `from`; with none in reach, the lowest one above. The terrain is
  // never overhead: where a road was laid lower than the drawn hillside, the
  // walker stands on the hillside, not under it.
  function surfaceAt(x, z, from) {
    const land = heightAt(x, z);
    const bucket = surf?.grid.get(Math.floor(x) * 65536 + Math.floor(z));
    if (!bucket) return land;
    const t = surf.tri;
    // the terrain is one of the surfaces: a roof above it is not a floor
    let best = land <= from + STEP_UP ? land : -Infinity, over = land <= from + STEP_UP ? Infinity : land;
    for (const a of bucket) {
      const x1 = t[a], z1 = t[a + 2], x2 = t[a + 3], z2 = t[a + 5], x3 = t[a + 6], z3 = t[a + 8];
      const den = (z2 - z3) * (x1 - x3) + (x3 - x2) * (z1 - z3);
      const u = ((z2 - z3) * (x - x3) + (x3 - x2) * (z - z3)) / den;
      const v = ((z3 - z1) * (x - x3) + (x1 - x3) * (z - z3)) / den;
      if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
      const y = u * t[a + 1] + v * t[a + 4] + (1 - u - v) * t[a + 7];
      if (y <= from + (surf.climb[a / 9] ? CLIMB : STEP_UP)) { if (y > best) best = y; } else if (y < over) over = y;
    }
    const s = best > -Infinity ? best : over < Infinity ? over : null;
    return s == null || land > s ? land : s;
  }
  let feetY = null; // the surface the walker stood on last
  let surfClock = 0;
  function ground(x, z) {
    const s = surfaceAt(x, z, feetY ?? laneGround(x, z));
    return s ?? laneGround(x, z);
  }
  function laneGround(x, z) {
    if (!laneGrid) return heightAt(x, z);
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    let sum = 0, weight = 0;
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const bucket = laneGrid.get(i * 65536 + j);
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k += 3) {
          const d2 = (bucket[k] - x) ** 2 + (bucket[k + 1] - z) ** 2;
          if (d2 > CELL * CELL) continue;
          const w = 1 / (d2 + 0.02);
          sum += bucket[k + 2] * w;
          weight += w;
        }
      }
    }
    return weight > 0 ? sum / weight : heightAt(x, z) + lift;
  }
  // half sizes (metres) of the furniture a walker cannot pass through; an
  // umbrella is only its pole
  const SOLID = { tall: 0.2, lantern: 0.2, bench: 0.45, bollard: 0.15, table: 0.4, umbrella: 0.08, tree: 0.3 };
  function readStreet() {
    readLanes();
    const sp = street()?.spots;
    const n = sp ? sp.x.length : 0;
    if (n === seatCount) return;
    seatCount = n;
    const extra = [];
    const r = 0.3 * M; // the seated person and the chair; the gaps between tables stay open
    for (let k = 0; k < n; k++) {
      if (!sp.sit[k]) continue;
      const x = sp.x[k], z = sp.z[k];
      extra.push([[x - r, z - r], [x + r, z - r], [x + r, z + r], [x - r, z + r]]);
    }
    // street furniture: a small square about each post, bench, table and tree
    const F = street()?.furniture || {};
    const before = extra.length;
    for (const [type, half] of Object.entries(SOLID)) {
      const a = F[type] || [];
      for (let k = 0; k < a.length; k += 6) {
        const x = a[k], z = a[k + 2], h = half * M * (a[k + 4] || 1);
        extra.push([[x - h, z - h], [x + h, z - h], [x + h, z + h], [x - h, z + h]]);
      }
    }
    solidCount = extra.length - before;
    collider = createCollider([...polys, ...extra], 8, wetAt);
    obstacles++;
  }
  // People and vehicles are bodies too: the walker cannot stand inside one.
  // Their places come from the instance matrices the crowd and the traffic
  // draw this frame (the drawn ones, so what the walker sees is what stops
  // them). A person is a circle, a vehicle a capsule along its heading. The
  // walker is pushed out, but never into a wall.
  // give: the share of the overlap undone each frame. People give way (the
  // walker squeezes through a crowd, slowed a little); a vehicle does not.
  // Porto: the people are in the street layer ('streetscape': the promenade
  // crowd of porto-streetscape.js and the quay crowd of street-kit.js, both
  // instanced meshes named 'porto-people'); the furniture beside them is not
  // a body.
  const MOVERS = [
    { name: 'people', root: 'streetscape', mesh: /^(porto-people|people)$/, half: 0, rad: 0.22 * M, give: 0.25 },
    { name: 'traffic', root: 'traffic', mesh: null, half: 1.5 * M, rad: 1.0 * M, give: 1 },
  ];
  const moverRoot = (mv) => {
    if (mv.obj === undefined || (mv.obj && !mv.obj.parent)) mv.obj = scene.getObjectByName(mv.root) || undefined;
    return mv.obj;
  };
  // the drawn bodies under a mover's root: a close passer-by drawn as a rigged
  // model (crowd-models.js) is one body; an instanced mesh holds many
  function eachBody(mv, fn) {
    const root = moverRoot(mv);
    if (!root || !root.visible) return;
    root.traverseVisible((o) => {
      if (o.userData.crowdBody) return void fn(o, true);
      if (!o.isInstancedMesh || o.name === 'traffic-lights') return;
      if (mv.mesh && !mv.mesh.test(o.name)) return;
      fn(o, false);
    });
  }
  let bumps = 0;
  let touching = false;
  function shove() {
    let px = pos.x, pz = pos.z;
    let hit = false;
    for (const mv of MOVERS) {
      const reach = mv.half + mv.rad + BODY;
      eachBody(mv, (o, one) => {
        const e = one ? null : o.instanceMatrix.array;
        const count = one ? 1 : o.count;
        for (let k = 0, b = 0; k < count; k++, b += 16) {
          let cx = one ? o.position.x : e[b + 12], cz = one ? o.position.z : e[b + 14];
          if (Math.abs(cx - px) > reach || Math.abs(cz - pz) > reach) continue;
          if (mv.half > 0) {
            // +z of the vehicle is its travel direction
            let hx = e[b + 8], hz = e[b + 10];
            const hl = Math.hypot(hx, hz) || 1;
            hx /= hl;
            hz /= hl;
            const t = THREE.MathUtils.clamp((px - cx) * hx + (pz - cz) * hz, -mv.half, mv.half);
            cx += hx * t;
            cz += hz * t;
          }
          let dx = px - cx, dz = pz - cz;
          let d = Math.hypot(dx, dz);
          const min = mv.rad + BODY;
          if (d >= min) continue;
          if (d < 1e-4) { dx = Math.sin(yaw + 1.57); dz = -Math.cos(yaw + 1.57); d = 1; }
          px += (dx / d) * (min - d) * mv.give;
          pz += (dz / d) * (min - d) * mv.give;
          hit = true;
        }
      });
    }
    if (hit && !touching) bumps++;
    touching = hit;
    if (!hit || collider.blocked(px, pz, BODY)) return;
    pos.x = px;
    pos.z = pz;
  }
  // the free walk-lane point nearest to (x, z), within 600 m; null without lanes.
  // r: the room it needs all round (the start wants room for the camera behind)
  function laneNear(x, z, r = BODY) {
    const lanes = street()?.lanes;
    if (!lanes?.X?.length) return null;
    // Up to 600 m: the opening view looks at a point that is often a park or
    // a roof far from a pavement, and a walk that starts in a field is a bad
    // first step. Farther out the visitor chose that place: start there.
    let best = -1, bestD = (600 * M) ** 2;
    for (let k = 0; k < lanes.X.length; k++) {
      const d = (lanes.X[k] - x) ** 2 + (lanes.Z[k] - z) ** 2;
      if (d < bestD && !collider.blocked(lanes.X[k], lanes.Z[k], r)) { bestD = d; best = k; }
    }
    return best < 0 ? null : { x: lanes.X[best], z: lanes.Z[best] };
  }
  let figure = createFigure();
  figure.root.visible = false;
  scene.add(figure.root);
  // the textured walker replaces the simple figure once it has loaded
  let heroLoad = null;
  function loadHero() {
    heroLoad ??= loadCharacter(HERO.url, 1.75, HERO.clips)
      .then((hero) => {
        hero.root.name = 'walk-figure';
        hero.root.visible = figure.root.visible;
        hero.root.position.copy(figure.root.position);
        hero.root.rotation.copy(figure.root.rotation);
        scene.remove(figure.root);
        figure.dispose();
        scene.add(hero.root);
        figure = hero;
      })
      .catch(() => { /* keep the simple figure */ });
  }
  let view = 'third'; // 'third' | 'first'
  let back = BACK; // the camera's current distance, eased
  let faceYaw = 0; // where the figure faces
  let spots = [];
  let near = null; // the place within reach, or null
  let nearClock = 0;
  const pos = { x: 0, z: 0 };
  let yaw = 0; // 0 looks north (-z), positive turns east
  let pitch = 0;
  let eyeY = 0;
  let active = false;
  let fov0 = camera.fov;
  let walked = 0; // metres, for tests
  const held = new Set();
  const stick = { x: 0, z: 0 };
  const vel = { x: 0, z: 0 };
  const _look = new THREE.Vector3();

  // ------------------------------------------------------------ HUD
  const root = document.createElement('div');
  root.className = 'walk-hud';
  root.hidden = true;
  root.innerHTML = `
    <button type="button" class="walk-exit">${t('Наверх')}</button>
    <button type="button" class="walk-view" aria-pressed="false">${t('От первого лица')}</button>
    <button type="button" class="walk-place" hidden></button>
    <p class="walk-hint walk-hint-keys">${t('WASD — идти, мышь — смотреть, Shift — бегом, V — вид')}</p>
    <p class="walk-hint walk-hint-touch">${t('Стик — идти, проведите по экрану — смотреть')}</p>
    <div class="walk-stick" role="group" aria-label="${t('Направление шага')}"><span class="walk-stick-knob"></span></div>`;
  document.body.appendChild(root);
  root.querySelector('.walk-exit').addEventListener('click', () => stop());
  const viewBtn = root.querySelector('.walk-view');
  function setView(next) {
    view = next === 'first' ? 'first' : 'third';
    viewBtn.setAttribute('aria-pressed', String(view === 'first'));
    figure.root.visible = active && view === 'third';
    back = BODY; // the camera eases out from the head
  }
  viewBtn.addEventListener('click', () => setView(view === 'first' ? 'third' : 'first'));
  const placeBtn = root.querySelector('.walk-place');
  placeBtn.addEventListener('click', () => {
    const spot = near;
    if (!spot) return;
    stop();
    onPlace?.(spot.i);
  });
  const stickEl = root.querySelector('.walk-stick');
  const knob = root.querySelector('.walk-stick-knob');
  let stickPointer = null;
  const setStick = (e) => {
    const rect = stickEl.getBoundingClientRect();
    const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.34);
    let dx = (e.clientX - (rect.left + rect.width / 2)) / radius;
    let dy = (e.clientY - (rect.top + rect.height / 2)) / radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    if (Math.hypot(dx, dy) < 0.12) dx = dy = 0;
    stick.x = dx;
    stick.z = -dy;
    knob.style.transform = `translate(calc(-50% + ${dx * radius}px), calc(-50% + ${dy * radius}px))`;
  };
  const releaseStick = (e) => {
    if (e && e.pointerId !== stickPointer) return;
    stickPointer = null;
    stick.x = stick.z = 0;
    knob.style.transform = '';
  };
  stickEl.addEventListener('pointerdown', (e) => {
    if (stickPointer != null) return;
    e.preventDefault();
    stickPointer = e.pointerId;
    try {
      stickEl.setPointerCapture(e.pointerId);
    } catch {
      // a pointer that is already gone (or a scripted one): the stick still works
    }
    setStick(e);
  });
  stickEl.addEventListener('pointermove', (e) => e.pointerId === stickPointer && setStick(e));
  stickEl.addEventListener('pointerup', releaseStick);
  stickEl.addEventListener('pointercancel', releaseStick);
  stickEl.addEventListener('lostpointercapture', releaseStick);

  // ------------------------------------------------------------ look
  let lookPointer = null;
  let lastX = 0, lastY = 0;
  const onDown = (e) => {
    if (!active || lookPointer != null) return;
    lookPointer = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onMove = (e) => {
    if (!active || e.pointerId !== lookPointer) return;
    yaw += (e.clientX - lastX) * LOOK;
    pitch = THREE.MathUtils.clamp(pitch - (e.clientY - lastY) * LOOK, -PITCH, PITCH);
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onUp = (e) => {
    if (e.pointerId === lookPointer) lookPointer = null;
  };
  dom.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  // ------------------------------------------------------------ keys
  // keyup is read here always, so a key never sticks; keydown comes from
  // the dispatcher in main.js (onKey), after the dialogs had their turn
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => held.clear());
  function onKey(e) {
    if (!active) return false;
    if (e.key === 'Escape') {
      stop();
      return true;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.code === 'KeyV' && !e.repeat) {
      setView(view === 'first' ? 'third' : 'first');
      return true;
    }
    if (KEYS[e.code] || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      held.add(e.code);
      e.preventDefault();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ mode
  // at: { x, z } world units; default: where the orbit camera looks
  // exact: a chosen start (Porto's walk_start): the free point nearest to it,
  // not the nearest walk lane
  function start(at = null, heading = null, exact = false) {
    if (active) return true;
    const from = at || rig.controls.target;
    loadHero();
    readStreet();
    readSurface(from.x, from.z); // a quay over the river's edge is paved, not water
    // a pavement or a pedestrian street first, 2 m from any wall; any free
    // ground otherwise
    const free = (exact && collider.freeNear(from.x, from.z, 2 * M, 30)) || laneNear(from.x, from.z, 2 * M) || laneNear(from.x, from.z) || collider.freeNear(from.x, from.z, BODY);
    if (!free) return false; // no street within reach
    pos.x = free.x;
    pos.z = free.z;
    if (heading != null) yaw = heading;
    else {
      const dx = rig.controls.target.x - camera.position.x;
      const dz = rig.controls.target.z - camera.position.z;
      yaw = Math.hypot(dx, dz) > 1e-6 ? Math.atan2(dx, -dz) : 0;
    }
    pitch = 0;
    vel.x = vel.z = 0;
    walked = 0;
    held.clear();
    releaseStick();
    readSurface(pos.x, pos.z);
    surfClock = 2;
    feetY = null;
    feetY = ground(pos.x, pos.z);
    eyeY = feetY + EYE;
    rig.cancelFlight?.();
    rig.controls.enabled = false;
    fov0 = camera.fov;
    camera.fov = FOV;
    camera.updateProjectionMatrix();
    active = true;
    root.hidden = false;
    faceYaw = yaw;
    spots = places();
    near = null;
    nearClock = 0;
    placeBtn.hidden = true;
    setView(view);
    onEnter?.();
    place(0);
    return true;
  }

  function stop() {
    if (!active) return;
    dismount(); // the scooter stays parked where it stopped
    active = false;
    root.hidden = true;
    figure.root.visible = false;
    held.clear();
    releaseStick();
    lookPointer = null;
    camera.fov = fov0;
    camera.updateProjectionMatrix();
    rig.controls.enabled = true;
    // back up: 160 m behind and 110 m above the walker, looking at the spot
    const fx = Math.sin(yaw), fz = -Math.cos(yaw);
    const base = heightAt(pos.x, pos.z);
    const target = new THREE.Vector3(pos.x, base, pos.z);
    const up = new THREE.Vector3(pos.x - fx * 160 * M, base + 110 * M, pos.z - fz * 160 * M);
    rig.controls.target.copy(target);
    rig.flyTo(up, target, reducedMotion ? 0.01 : 1.4);
    onExit?.();
  }

  function place(dt) {
    feetY = ground(pos.x, pos.z);
    const want = feetY + EYE;
    // steps and kerbs ease in; a first frame snaps
    eyeY = dt > 0 ? eyeY + (want - eyeY) * Math.min(1, dt * 12) : want;
    const fx = Math.sin(yaw), fz = -Math.cos(yaw);
    camera.up.set(0, 1, 0);
    const feet = eyeY - EYE + (ride ? RIDE_DECK : 0);
    figure.root.position.set(pos.x, feet, pos.z);
    figure.root.rotation.y = -faceYaw;
    if (ride) {
      ride.mesh.position.set(pos.x, feet - RIDE_DECK, pos.z);
      ride.mesh.rotation.y = -ride.heading;
    }
    if (view === 'first') {
      const c = Math.cos(pitch);
      camera.position.set(pos.x, eyeY, pos.z);
      _look.set(pos.x + fx * c, eyeY + Math.sin(pitch), pos.z + fz * c);
    } else {
      // the camera turns about the head: behind the walker, a little above
      // level; it comes closer when a house stands in the way
      const e = THREE.MathUtils.clamp(TILT - pitch, 0.02, 1.3);
      const ce = Math.cos(e), se = Math.sin(e);
      const far = ride ? RIDE_CAM : BACK;
      let reach = far;
      for (let k = 1; k <= 12; k++) {
        const d = (far * k) / 12;
        if (collider.blocked(pos.x - fx * ce * d, pos.z - fz * ce * d, BODY * 0.6)) {
          reach = Math.max(BODY, (far * (k - 1)) / 12);
          break;
        }
      }
      back = reach < back || dt <= 0 ? Math.min(back, reach) : back + (reach - back) * Math.min(1, dt * 4);
      if (dt <= 0) back = reach;
      const headY = feet + HEAD;
      // a wall right behind: no room for the camera, so it looks from the
      // eyes and the figure hides until there is room again
      const tight = back < CLOSE;
      figure.root.visible = !tight;
      if (tight) {
        const c = Math.cos(pitch);
        camera.position.set(pos.x, eyeY, pos.z);
        _look.set(pos.x + fx * c, eyeY + Math.sin(pitch), pos.z + fz * c);
      } else {
        const cx = pos.x - fx * ce * back, cz = pos.z - fz * ce * back;
        camera.position.set(cx, Math.max(headY + se * back, ground(cx, cz) + 0.3), cz);
        _look.set(pos.x, feet + 1.3 * M, pos.z); // the chest: the whole figure stays in view
      }
    }
    camera.lookAt(_look);
    const ax = pos.x + fx * AHEAD, az = pos.z + fz * AHEAD;
    rig.controls.target.set(ax, heightAt(ax, az), az);
  }

  // ------------------------------------------------------------ ride
  // An e-scooter (street-missions.js hands over its mesh): W / S throttle and
  // brake, A / D steer, Shift boost. The camera chases from behind and turns
  // with the scooter. A wall stops it with a small bounce.
  let ride = null; // { mesh, speed, heading }
  function mount(mesh) {
    if (!active || ride) return false;
    ride = { mesh, speed: 0, heading: -mesh.rotation.y };
    pos.x = mesh.position.x;
    pos.z = mesh.position.z;
    yaw = ride.heading;
    faceYaw = yaw;
    vel.x = vel.z = 0;
    setView('third');
    return true;
  }
  function dismount() {
    if (!ride) return null;
    const mesh = ride.mesh;
    ride = null;
    // step off to the right, or anywhere free
    const fx = Math.sin(yaw), fz = -Math.cos(yaw);
    const side = collider.freeNear(pos.x - fz * 0.9 * M, pos.z + fx * 0.9 * M, BODY) || collider.freeNear(pos.x, pos.z, BODY);
    if (side) { pos.x = side.x; pos.z = side.z; }
    return mesh;
  }
  function rideStep(dt, ix, iz) {
    const boost = held.has('ShiftLeft') || held.has('ShiftRight');
    const max = boost ? RIDE_BOOST : RIDE_MAX;
    let s = ride.speed;
    if (iz > 0.1) s += RIDE_ACC * iz * dt * (s < 0 ? 3 : 1);
    else if (iz < -0.1) s += (s > 0 ? -RIDE_BRAKE : -RIDE_ACC * 0.5) * -iz * dt;
    else s -= s * Math.min(1, RIDE_DRAG * dt);
    s = THREE.MathUtils.clamp(s, -RIDE_BACK, max);
    // steering bites with speed; reversing turns the other way
    ride.heading += ix * RIDE_TURN * dt * THREE.MathUtils.clamp(Math.abs(s) / RIDE_MAX, 0, 1) * Math.sign(s || 1);
    const fx = Math.sin(ride.heading), fz = -Math.cos(ride.heading);
    const next = collider.move(pos.x, pos.z, fx * s * dt, fz * s * dt, RIDE_BODY);
    if (bounds) {
      next.x = THREE.MathUtils.clamp(next.x, bounds.x0, bounds.x1);
      next.z = THREE.MathUtils.clamp(next.z, Math.min(bounds.zN, bounds.zS), Math.max(bounds.zN, bounds.zS));
    }
    if (next.hit && Math.abs(s) > 2 * M) s *= -0.25; // a bump
    const stepM = Math.hypot(next.x - pos.x, next.z - pos.z) * METRES_PER_UNIT;
    walked += stepM;
    pos.x = next.x;
    pos.z = next.z;
    ride.speed = s;
    // the chase camera swings in behind the scooter; a drag still looks around
    if (lookPointer == null) {
      const d = Math.atan2(Math.sin(ride.heading - yaw), Math.cos(ride.heading - yaw));
      yaw += d * Math.min(1, dt * 3);
      pitch += (-0.12 - pitch) * Math.min(1, dt * 2);
    }
    faceYaw = ride.heading;
    figure.step(0, dt);
  }

  function update(dt) {
    if (!active) return false;
    let ix = stick.x, iz = stick.z;
    for (const code of held) {
      const k = KEYS[code];
      if (!k) continue;
      if (k[0] === 'x') ix += k[1];
      else iz += k[1];
    }
    const n = Math.hypot(ix, iz);
    if (n > 1) { ix /= n; iz /= n; }
    pumpSurface();
    if (ride) {
      rideStep(dt, ix, iz);
      surfClock -= dt;
      if (surfClock <= 0) {
        surfClock = 1;
        readSurface(pos.x, pos.z, false);
      }
      place(dt);
      return true;
    }
    const speed = held.has('ShiftLeft') || held.has('ShiftRight') ? RUN : SPEED;
    const fx = Math.sin(yaw), fz = -Math.cos(yaw);
    // forward (fx, fz); right (-fz, fx)
    const wx = (fx * iz - fz * ix) * speed;
    const wz = (fz * iz + fx * ix) * speed;
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 10);
    vel.x += (wx - vel.x) * k;
    vel.z += (wz - vel.z) * k;
    let stepM = 0;
    if (Math.abs(vel.x) + Math.abs(vel.z) > 1e-5) {
      let dx = vel.x * dt, dz = vel.z * dt;
      const next = collider.move(pos.x, pos.z, dx, dz, BODY);
      if (bounds) {
        next.x = THREE.MathUtils.clamp(next.x, bounds.x0, bounds.x1);
        next.z = THREE.MathUtils.clamp(next.z, Math.min(bounds.zN, bounds.zS), Math.max(bounds.zN, bounds.zS));
      }
      stepM = Math.hypot(next.x - pos.x, next.z - pos.z) * METRES_PER_UNIT;
      walked += stepM;
      if (next.hit) { vel.x *= 0.5; vel.z *= 0.5; }
      pos.x = next.x;
      pos.z = next.z;
    }
    shove();
    // the figure turns to where it walks; standing, it keeps its last heading
    if (n > 0.1 && stepM > 1e-4) {
      const want = Math.atan2(vel.x, -vel.z);
      const d = Math.atan2(Math.sin(want - faceYaw), Math.cos(want - faceYaw));
      faceYaw += d * Math.min(1, dt * 10);
    }
    figure.step(stepM, dt, speed === RUN);
    // the surface index follows the walker and what the scene has loaded
    surfClock -= dt;
    if (surfClock <= 0) {
      surfClock = 2;
      readSurface(pos.x, pos.z, false);
    }
    // a place within reach offers its card (checked three times a second)
    nearClock -= dt;
    if (nearClock <= 0) {
      nearClock = 0.33;
      let best = null, bestD = PLACE_M * M;
      for (const s of spots) {
        if (Math.abs(s.x - pos.x) > 120 || Math.abs(s.z - pos.z) > 120) continue; // 480 m
        const d = s.outline ? (collider.inside(pos.x, pos.z) ? 0 : outlineDistance(s.outline, pos.x, pos.z)) : Math.hypot(s.x - pos.x, s.z - pos.z);
        if (d < bestD) { bestD = d; best = s; }
      }
      if (best !== near) {
        near = best;
        placeBtn.hidden = !near;
        if (near) placeBtn.textContent = `${near.name} ›`;
      }
    }
    place(dt);
    return true;
  }

  return {
    start,
    stop,
    update,
    onKey,
    get active() {
      return active;
    },
    // tests and debugging
    get state() {
      return {
        x: +pos.x.toFixed(3), z: +pos.z.toFixed(3), yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3),
        eyeM: +((eyeY - ground(pos.x, pos.z)) * METRES_PER_UNIT).toFixed(2),
        liftM: +((ground(pos.x, pos.z) - heightAt(pos.x, pos.z)) * METRES_PER_UNIT).toFixed(2),
        walkedM: +walked.toFixed(1), inside: collider.inside(pos.x, pos.z), buildings: collider.count,
        view, near: near ? near.i : null, seats: seatCount, solids: solidCount, bumps, touching, lanes: street()?.lanes?.X?.length || 0,
        blocked: collider.blocked(pos.x, pos.z, BODY * 0.9),
        camM: +(Math.hypot(camera.position.x - pos.x, camera.position.z - pos.z) * METRES_PER_UNIT).toFixed(2),
        camInside: collider.inside(camera.position.x, camera.position.z),
        figure: figure.root.visible,
      };
    },
    setView,
    // cheap, every frame (street-missions.js): where the walker is and faces
    // (forward is sin(yaw), -cos(yaw))
    get position() {
      return { x: pos.x, z: pos.z, yaw };
    },
    // can a body stand at (x, z), world units
    free(x, z) {
      return !collider.blocked(x, z, BODY);
    },
    // counts the changes to what blocks (a model mask, the furniture)
    get obstacles() {
      return obstacles;
    },
    // the drawn surface a person at (x, z) stands on, stepping from y (the
    // close passers-by: their paths run on the terrain, under a quay deck)
    surfaceAt(x, z, y) {
      return surfaceAt(x, z, y);
    },
    // tests: what is at (x, z): 'house', 'water', 'paved' or 'ground'
    what(x, z) {
      if (collider.inside(x, z) || inModel(x, z)) return 'house';
      if (wetAt(x, z)) return 'water';
      return pavedAt(x, z) ? 'paved' : 'ground';
    },
    // an e-scooter (street-missions.js): ride it, step off it
    mount,
    dismount,
    get riding() {
      return ride ? { speedKmh: +((ride.speed / M) * 3.6).toFixed(1), heading: +ride.heading.toFixed(3) } : null;
    },
    // tests: put the walker at a point (world units); false when it is blocked
    teleport(x, z) {
      if (collider.blocked(x, z, BODY)) return false;
      pos.x = x;
      pos.z = z;
      nearClock = 0;
      readSurface(x, z);
      feetY = null;
      return true;
    },
    // tests: the drawn bodies of a kind ('people', 'traffic') as [x, z] pairs
    bodies(name) {
      const out = [];
      const mv = MOVERS.find((m) => m.name === name);
      if (!mv) return out;
      eachBody(mv, (o, one) => {
        if (one) return void out.push([o.position.x, o.position.z]);
        const e = o.instanceMatrix.array;
        for (let k = 0; k < o.count; k++) out.push([e[k * 16 + 12], e[k * 16 + 14]]);
      });
      return out;
    },
    // tests: hold a direction without a keyboard ({x, z} in -1..1), turn
    setInput(x = 0, z = 0) {
      stick.x = x;
      stick.z = z;
    },
    turn(toYaw, toPitch = 0) {
      yaw = toYaw;
      pitch = toPitch;
    },
  };
}
