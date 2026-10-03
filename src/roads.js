// Street network (road-network.js: the OSM ways with their heights,
// bridges and tunnels), in layers:
//   - the street surface: one ribbon per way at its real width (from the
//     class and `lanes`: a motorway carriageway 10.8 m, a primary street
//     7.8 m, a residential lane 5.7 m), coloured by the OSM `surface`
//     (asphalt, Braga's granite setts, paving stones, gravel ...). On a
//     bridge it is the deck, on the approach ramps it rises to it, inside a
//     tunnel it is not drawn;
//   - bridges: the deck's edge, parapets (railings on footbridges), piers
//     down to the ground, abutments; tunnel portals with a dark mouth;
//   - close range only: lane markings (dashed centre lines on two-way roads,
//     lane lines and edge lines on the motorways), sidewalks in the centre,
//     the islands of the roundabouts;
//   - calçada portuguesa (streetscape.js calcadaMaterial): the pedestrian
//     streets of the centre and the sidewalks are white limestone and black
//     basalt cobbles, in the same meshes (no extra draw): a per-vertex
//     pattern attribute picks waves, a diagonal net, a border band or
//     plain stone; 0 keeps the vertex colour;
//   - a LineSegments2 at a constant pixel width on top: the glowing line
//     that keeps the network readable from far away, where a ribbon a few
//     metres wide is thinner than a pixel. It runs on the decks; over a
//     tunnel it is a faint dashed hint (Legend toggle).
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { S } from './geo.js';
import { buildNetwork, surfaceOf } from './road-network.js';
import { bridgeGeometry, portalGeometry, quad as embankmentQuad } from './road-structures.js';
import { language } from './i18n.js';
import { calcadaMaterial, calcadaPatternOf, CALCADA } from './streetscape.js';

// Order is draw order (later draws on top). metres: fallback width; px: the
// line's CSS pixel width (the floor); surface: ribbon tone of the colour.
export const STYLE = {
  water: { color: 0x6fb2dd, metres: 8, px: 1.5, opacity: 0.7, surface: 0.55 },
  minor: { color: 0xc9a47a, metres: 3, px: 0.75, opacity: 0.3, surface: 0.55 },
  rail: { color: 0xa3a3a3, metres: 2.5, px: 1.2, opacity: 0.65, dashed: true, surface: 0.4 },
  secondary: { color: 0xe0a45e, metres: 5, px: 1.2, opacity: 0.62, surface: 0.55 },
  primary: { color: 0xf3bb68, metres: 8, px: 1.7, opacity: 0.88, glow: true, surface: 0.55 },
};

// street surfaces (sRGB) by kind: the streamed tiles (tiles.js) use these
export const SURFACE = { primary: 0x5b5753, secondary: 0x66615a, minor: 0x777066, rail: 0x5f574e, water: 0x2a4652 };

export const LIFT = 0.35; // line: world units (1.4 m) above the road surface
export const RIBBON_LIFT = 0.12; // ribbon: 0.5 m
export const MAX_SEG = 6; // subdivide longer segments so they follow the terrain

const CONCRETE = 0xbab5ab;
const PIER = 0xa39e94;
const GRANITE = 0x978d7f;
const PORTAL = 0xb3aea4;
const EARTH = 0x5d6b3f;
// the bridge and portal colours, for the streamed tiles (src/tiles.js)
export const STRUCTURE_COLORS = { concrete: CONCRETE, pier: PIER, granite: GRANITE, portal: PORTAL, earth: EARTH };
const MARK = 0xe9e7e0;
const SIDEWALK = 0x9f998f;
const ISLAND = 0x5b7a3c;
const KERB = 0xc4c0b8;
export const SIDEWALK_R = 470; // world units (1.9 km) around the centre
// the streets with sidewalks, and a sidewalk's width in metres (streetscape.js
// walks people on them)
export const WALKED = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'primary_link', 'secondary_link', 'tertiary_link']);
export const sidewalkM = (hw) => (hw === 'residential' || hw === 'living_street' ? 1.6 : 2.4);
const ARCH = /Ponte (Romana|do Prado|de Prado|do Bico|Velha|Medieval|de São Claúdio)/i;

const lin = (hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};
// pat: also a calçada pattern per vertex (aPat: pattern, metres across the
// strip from its middle, half width in metres); `cur` is the pattern of the
// strips being added
const newT = (pat = false) => ({ pos: [], nor: [], col: [], idx: [], wall: null, pat: pat ? [] : null, cur: 0 });
function geometryOf(T) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(T.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(T.nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(T.col, 3));
  if (T.pat) g.setAttribute('aPat', new THREE.Float32BufferAttribute(T.pat, 3));
  g.setIndex(T.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(T.idx, 1) : new THREE.Uint16BufferAttribute(T.idx, 1));
  g.computeBoundingSphere();
  return g;
}

// A flat strip along points i0..i1 of the network, offset `off` (world,
// left of travel positive) with half width h, at height Y + lift. One quad
// per segment, lengthened by `ext` at both ends so consecutive quads overlap
// at the joints (opaque, so overlaps do not show). Skips hidden points.
function strip(T, net, i0, i1, off, h, lift, col, ext = h) {
  const { X, Z, HID } = net;
  for (let i = i0; i < i1; i++) {
    if (HID[i] && HID[i + 1]) continue;
    const ax = X[i];
    const az = Z[i];
    const bx = X[i + 1];
    const bz = Z[i + 1];
    let dx = bx - ax;
    let dz = bz - az;
    const L = Math.hypot(dx, dz);
    if (L < 1e-5) continue;
    dx /= L;
    dz /= L;
    const lx = dz; // left of travel (x east, z south)
    const lz = -dx;
    const e = Math.min(ext, L);
    // each edge on the surface: level with the way, or up the hillside
    const sy = net.surfaceY;
    const c = [
      [ax - dx * e + lx * (off + h), sy(i, off + h) + lift, az - dz * e + lz * (off + h)],
      [ax - dx * e + lx * (off - h), sy(i, off - h) + lift, az - dz * e + lz * (off - h)],
      [bx + dx * e + lx * (off - h), sy(i + 1, off - h) + lift, bz + dz * e + lz * (off - h)],
      [bx + dx * e + lx * (off + h), sy(i + 1, off + h) + lift, bz + dz * e + lz * (off + h)],
    ];
    const v = T.pos.length / 3;
    for (const p of c) {
      T.pos.push(p[0], p[1], p[2]);
      T.nor.push(0, 1, 0);
      T.col.push(col[0], col[1], col[2]);
    }
    if (T.pat) {
      const hm = h / S;
      T.pat.push(T.cur, hm, hm, T.cur, -hm, hm, T.cur, -hm, hm, T.cur, hm, hm);
    }
    // counter-clockwise from above
    const up = (c[1][2] - c[0][2]) * (c[2][0] - c[0][0]) - (c[1][0] - c[0][0]) * (c[2][2] - c[0][2]);
    if (up >= 0) T.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    else T.idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
  }
}

// Dashes along a way at offset `off`: dash / gap in metres (gap 0: solid)
function dashes(T, net, w, off, halfM, dashM, gapM, lift, col) {
  const { X, Z, C, HID } = net;
  const h = halfM * S;
  const period = (dashM + gapM) * S;
  const dash = dashM * S;
  const a = w.start;
  const b = w.start + w.n - 1;
  if (!gapM) {
    strip(T, net, a, b, off, h, lift, col, 0);
    return;
  }
  // walk the way; emit quads for the parts of each segment inside a dash
  for (let i = a; i < b; i++) {
    if (HID[i] || HID[i + 1]) continue;
    const s0 = C[i];
    const s1 = C[i + 1];
    const L = s1 - s0;
    if (L < 1e-5) continue;
    const dx = (X[i + 1] - X[i]) / L;
    const dz = (Z[i + 1] - Z[i]) / L;
    const lx = dz;
    const lz = -dx;
    let k = Math.floor(s0 / period);
    for (; k * period < s1; k++) {
      const d0 = Math.max(s0, k * period + 1 * S);
      const d1 = Math.min(s1, k * period + 1 * S + dash);
      if (d1 <= d0) continue;
      const u0 = (d0 - s0) / L;
      const u1 = (d1 - s0) / L;
      const x0 = X[i] + dx * (d0 - s0);
      const z0 = Z[i] + dz * (d0 - s0);
      const x1 = X[i] + dx * (d1 - s0);
      const z1 = Z[i] + dz * (d1 - s0);
      const ya = net.surfaceY(i, off);
      const yb = net.surfaceY(i + 1, off);
      const y0 = ya + (yb - ya) * u0 + lift;
      const y1 = ya + (yb - ya) * u1 + lift;
      const v = T.pos.length / 3;
      T.pos.push(x0 + lx * (off + h), y0, z0 + lz * (off + h), x0 + lx * (off - h), y0, z0 + lz * (off - h), x1 + lx * (off - h), y1, z1 + lz * (off - h), x1 + lx * (off + h), y1, z1 + lz * (off + h));
      for (let q = 0; q < 4; q++) {
        T.nor.push(0, 1, 0);
        T.col.push(col[0], col[1], col[2]);
      }
      // left (+off) edge first, then the right one, then forward: faces up
      T.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
  }
}

// lite (light mode, main.js): the markings, sidewalks and islands only
// within 450 units instead of 900. (The main-street glow stays: one draw,
// and the golden streets are the look.)
export function buildRoads(roads, project, heightAt, { waterRibbon = true, lite = false } = {}) {
  const DETAIL_U = lite ? 450 : 900;
  const group = new THREE.Group();
  group.name = 'roads';
  const materials = [];
  const lines = {};
  const glows = [];
  let lastNight = -1;
  let lastClose = 1;
  let lastFar = 0;
  let bloomOn = false;
  let hintOn = true;
  function applyBloom() {
    const core = lines.primary?.material;
    const kc = bloomOn ? 1.45 - 0.35 * lastFar : 1;
    const kg = bloomOn ? 3 - 1.8 * lastFar : 1;
    if (core) {
      core.userData.base ??= core.color.clone();
      core.color.copy(core.userData.base).multiplyScalar(kc);
    }
    for (const g of glows) {
      g.userData.base ??= g.color.clone();
      g.color.copy(g.userData.base).multiplyScalar(kg);
    }
  }
  function applyOpacity() {
    const w = Math.max(0, lastNight);
    const near = 0.3 + 0.7 * lastClose;
    for (const [kind, line] of Object.entries(lines)) {
      const st = STYLE[kind];
      line.material.opacity = st.opacity * near * (kind === 'primary' ? 1 - 0.25 * w : 1 - 0.55 * w);
    }
    if (hint) hint.material.opacity = 0.32 * (0.4 + 0.6 * lastClose) * (1 - 0.3 * w);
  }

  const net = buildNetwork(roads, project, heightAt);
  const { X, Z, Y, G, HID } = net;
  const counts = {};

  // ---- constant-width lines: on the decks, not through tunnels
  const buckets = {};
  for (const k of Object.keys(STYLE)) buckets[k] = [];
  const hintArr = [];
  for (const w of net.ways) {
    const out = buckets[w.kind];
    if (!out) continue;
    for (let i = w.start; i < w.start + w.n - 1; i++) {
      if (HID[i] || HID[i + 1]) {
        if (w.tunnel) hintArr.push(X[i], G[i] + LIFT, Z[i], X[i + 1], G[i + 1] + LIFT, Z[i + 1]);
        continue;
      }
      out.push(X[i], Y[i] + LIFT, Z[i], X[i + 1], Y[i + 1] + LIFT, Z[i + 1]);
    }
  }
  // rivers, draped; culverts and the covered Rio Este are not drawn
  (roads.features || []).forEach((f, fi) => {
    if (f.kind !== 'water' || net.hiddenFeature[fi] || !Array.isArray(f.pts) || f.pts.length < 2) return;
    let prev = null;
    for (const p of f.pts) {
      const cur = project(p[0], p[1]);
      if (prev) {
        const dx = cur.x - prev.x;
        const dz = cur.z - prev.z;
        const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / MAX_SEG));
        for (let i = 0; i < n; i++) {
          const ax = prev.x + (dx * i) / n;
          const az = prev.z + (dz * i) / n;
          const bx = prev.x + (dx * (i + 1)) / n;
          const bz = prev.z + (dz * (i + 1)) / n;
          buckets.water.push(ax, heightAt(ax, az) + LIFT, az, bx, heightAt(bx, bz) + LIFT, bz);
        }
      }
      prev = cur;
    }
  });

  // ---- street surfaces, one mesh per kind (draw order), vertex colours
  const ORDER = ['foot', 'minor', 'rail', 'secondary', 'primary'];
  // the minor streets carry the pedestrian ones: calçada-capable
  const surf = Object.fromEntries(ORDER.map((k) => [k, newT(k === 'minor')]));
  let calcadaWays = 0;
  const colCache = new Map();
  const colOf = (hex) => {
    let c = colCache.get(hex);
    if (!c) colCache.set(hex, (c = lin(hex)));
    return c;
  };
  for (const w of net.ways) {
    const T = surf[w.kind];
    if (!T) continue;
    // footways: only their bridges (the paths themselves are not in the core)
    // (and not the crossings on a road deck: the deck is their surface)
    if (w.kind === 'foot' && (!w.bridge || w.onDeck)) continue;
    const h = (w.widthM / 2) * S;
    if (T.pat) {
      // pedestrian streets of the centre: calçada (by name: waves on the
      // main squares, a diagonal net on the largos, a border on the ruas)
      const m = w.start + (w.n >> 1);
      T.cur = w.hw === 'pedestrian' && !w.tunnel && X[m] * X[m] + Z[m] * Z[m] < SIDEWALK_R * SIDEWALK_R ? calcadaPatternOf(w.t.name, 'street') : 0;
      if (T.cur) calcadaWays++;
    }
    strip(T, net, w.start, w.start + w.n - 1, 0, h, RIBBON_LIFT, colOf(surfaceOf(w.f)));
  }
  let ribbonTris = 0;
  let order = 1;
  ORDER.forEach((kind, k) => {
    const T = surf[kind];
    if (!T.idx.length) return;
    const rm = T.pat
      ? calcadaMaterial({ polygonOffsetUnits: -3 - k, roughness: 0.92, lite })
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 - k });
    materials.push(rm);
    const mesh = new THREE.Mesh(geometryOf(T), rm);
    mesh.name = `street-${kind}`;
    mesh.receiveShadow = true;
    group.add(mesh);
    ribbonTris += T.idx.length / 3;
  });
  if (waterRibbon && buckets.water.length) {
    // rivers without the nature layer: a flat blue ribbon
    const T = newT();
    const c = lin(SURFACE.water);
    const a = buckets.water;
    for (let i = 0; i < a.length; i += 6) {
      const dx = a[i + 3] - a[i];
      const dz = a[i + 5] - a[i + 2];
      const L = Math.hypot(dx, dz) || 1;
      const nx = (-dz / L) * 4 * S;
      const nz = (dx / L) * 4 * S;
      const v = T.pos.length / 3;
      const y0 = a[i + 1] - LIFT + RIBBON_LIFT;
      const y1 = a[i + 4] - LIFT + RIBBON_LIFT;
      T.pos.push(a[i] + nx, y0, a[i + 2] + nz, a[i] - nx, y0, a[i + 2] - nz, a[i + 3] - nx, y1, a[i + 5] - nz, a[i + 3] + nx, y1, a[i + 5] + nz);
      for (let q = 0; q < 4; q++) {
        T.nor.push(0, 1, 0);
        T.col.push(c[0], c[1], c[2]);
      }
      T.idx.push(v, v + 2, v + 1, v, v + 3, v + 2, v, v + 1, v + 2, v, v + 2, v + 3);
    }
    const wm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    materials.push(wm);
    const mesh = new THREE.Mesh(geometryOf(T), wm);
    mesh.name = 'street-water';
    group.add(mesh);
  }

  // ---- bridges and tunnel portals
  const ST = newT();
  const concrete = lin(CONCRETE);
  const pier = lin(PIER);
  const granite = lin(GRANITE);
  let archBridges = 0;
  // the drawn decks, for the parapets between decks side by side
  const decks = net.bridges
    .filter((wi) => !net.ways[wi].onDeck)
    .map((wi) => {
      const w = net.ways[wi];
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (let i = w.start; i < w.start + w.n; i++) {
        x0 = Math.min(x0, X[i]);
        x1 = Math.max(x1, X[i]);
        z0 = Math.min(z0, Z[i]);
        z1 = Math.max(z1, Z[i]);
      }
      const r = (w.widthM / 2 + 1) * S;
      return { wi, w, x0: x0 - r, x1: x1 + r, z0: z0 - r, z1: z1 + r, half: (w.widthM / 2) * S };
    });
  // is (x, z, y) on the surface of another deck (in plan, and within 1.5 m in height)?
  function onOtherDeck(self, x, z, y) {
    for (const d of decks) {
      if (d.wi === self || x < d.x0 || x > d.x1 || z < d.z0 || z > d.z1) continue;
      const w = d.w;
      for (let i = w.start; i < w.start + w.n - 1; i++) {
        const ax = X[i];
        const az = Z[i];
        const dx = X[i + 1] - ax;
        const dz = Z[i + 1] - az;
        const L2 = dx * dx + dz * dz || 1e-9;
        const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        const px = ax + dx * u - x;
        const pz = az + dz * u - z;
        if (px * px + pz * pz > (d.half + 0.2 * S) ** 2) continue;
        if (Math.abs(Y[i] + (Y[i + 1] - Y[i]) * u - y) < 1.5 * S) return true;
      }
    }
    return false;
  }
  for (const wi of net.bridges) {
    const w = net.ways[wi];
    if (w.onDeck) continue;
    const pts = [];
    for (let i = w.start; i < w.start + w.n; i++) pts.push({ x: X[i], z: Z[i], y: Y[i], g: G[i], s: net.C[i] });
    const arch = w.t.bs === 'arch' || ARCH.test(w.t.name || '') || ARCH.test(w.t.bn || '');
    if (arch) archBridges++;
    // no piers standing in a street or on a railway under the deck
    const keepOut = w.crossings.filter((c) => !c.water).map((c) => {
      const cw = c.way >= 0 ? net.ways[c.way].widthM / 2 + 2.5 : 4;
      return [c.s - cw * S * 1.6, c.s + cw * S * 1.6];
    });
    bridgeGeometry(ST, pts, {
      halfW: (w.widthM / 2) * S,
      lift: RIBBON_LIFT,
      col: arch ? granite : concrete,
      pierCol: arch ? granite : pier,
      style: arch ? 'arch' : 'beam',
      spacingM: w.hw === 'motorway' || w.hw === 'trunk' ? 32 : w.kind === 'rail' ? 24 : 20,
      keepOut,
      railing: w.kind === 'foot',
      open(k, side) {
        // the edge at the segment's middle, just outside the parapet
        const i = w.start + k;
        const dx = X[i + 1] - X[i];
        const dz = Z[i + 1] - Z[i];
        const L = Math.hypot(dx, dz) || 1;
        const e = (w.widthM / 2 + 0.6) * S * side;
        const x = (X[i] + X[i + 1]) / 2 + (dz / L) * e;
        const z = (Z[i] + Z[i + 1]) / 2 - (dx / L) * e;
        return onOtherDeck(wi, x, z, (Y[i] + Y[i + 1]) / 2);
      },
    });
  }
  const earth = lin(EARTH);
  // embankments under the raised approach ramps: a grass slope (1:1.5) from
  // each edge of the surface down to the ground, so no ramp floats
  let embankments = 0;
  for (const w of net.ways) {
    if (w.bridge || w.tunnel || !surf[w.kind] || w.kind === 'foot') continue;
    const half = (w.widthM / 2) * S;
    const end = w.start + w.n - 1;
    let any = false;
    for (let i = w.start; i < end; i++) {
      const la = Y[i] - G[i];
      const lb = Y[i + 1] - G[i + 1];
      if (la < 0.3 * S && lb < 0.3 * S) continue;
      if (HID[i] || HID[i + 1]) continue;
      any = true;
      let dx = X[i + 1] - X[i];
      let dz = Z[i + 1] - Z[i];
      const L = Math.hypot(dx, dz);
      if (L < 1e-5) continue;
      dx /= L;
      dz /= L;
      for (const side of [1, -1]) {
        const lx = dz * side;
        const lz = -dx * side;
        const ta = [X[i] + lx * half, Y[i] + RIBBON_LIFT, Z[i] + lz * half];
        const tb = [X[i + 1] + lx * half, Y[i + 1] + RIBBON_LIFT, Z[i + 1] + lz * half];
        const ra = half + Math.max(0.4 * S, 1.5 * la);
        const rb = half + Math.max(0.4 * S, 1.5 * lb);
        const fa = [X[i] + lx * ra, 0, Z[i] + lz * ra];
        const fb = [X[i + 1] + lx * rb, 0, Z[i + 1] + lz * rb];
        fa[1] = heightAt(fa[0], fa[2]) - 0.3 * S;
        fb[1] = heightAt(fb[0], fb[2]) - 0.3 * S;
        embankmentQuad(ST, ta, tb, fb, fa, earth, [lx, 0.6, lz]);
      }
    }
    if (any) embankments++;
  }
  const portalCol = lin(PORTAL);
  const coveredCol = lin(CONCRETE);
  const dark = [0.008, 0.008, 0.01];
  let portalsOpen = 0;
  let portalsCovered = 0;
  for (const p of net.portals) {
    const w = net.ways[p.way];
    // the hood reaches at most halfway into the tunnel (the other portal's
    // hood covers the rest), and never less than where vehicles vanish
    // and stops short of a street at ground level over or beside the tunnel
    // (p.clear); with no room for a hood the mouth is that street's edge and
    // no portal is drawn (the vehicles vanish there)
    const hoodM = Math.min(Math.max(4.5, Math.min(11, (w.chainLen ?? w.len) / S / 2 - 0.3)), p.clear / S);
    if (hoodM < 2.5) {
      portalsOpen++;
      continue;
    }
    const style = p.type === 'covered' ? 'covered' : 'bored';
    if (style === 'covered') portalsCovered++;
    portalGeometry(ST, { x: p.x, z: p.z, y: p.y + RIBBON_LIFT, dx: p.dx, dz: p.dz }, { halfW: (w.widthM / 2) * S, col: style === 'covered' ? coveredCol : portalCol, dark, cap: earth, hoodM, style });
  }
  let structTris = 0;
  if (ST.idx.length) {
    const sm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
    materials.push(sm);
    const mesh = new THREE.Mesh(geometryOf(ST), sm);
    mesh.name = 'road-structures';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    structTris = ST.idx.length / 3;
  }

  // ---- close range: markings, sidewalks, roundabout islands
  const detail = new THREE.Group();
  detail.name = 'road-detail';
  group.add(detail);
  const MT = newT();
  const mk = lin(MARK);
  const MARK_LIFT = RIBBON_LIFT + 0.004;
  const PAINTED = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'unclassified']);
  const SETT = new Set(['sett', 'cobblestone', 'unhewn_cobblestone', 'paving_stones', 'stone', 'gravel', 'unpaved', 'ground', 'dirt', 'compacted', 'grass']);
  for (const w of net.ways) {
    if (!w.car || !PAINTED.has(w.hw) || SETT.has(w.t.sf) || w.t.jn) continue;
    const lw = w.laneW;
    const fast = w.hw === 'motorway' || w.hw === 'trunk';
    const half = (w.widthM / 2) * S;
    if (w.ow === 0) {
      // the centre line: dashed, solid on the fast roads; lane lines too
      if (w.total >= 2) dashes(MT, net, w, 0, 0.07, fast ? 0 : 3, fast ? 0 : 5, MARK_LIFT, mk);
      for (let k = 1; k < w.fwd; k++) dashes(MT, net, w, -k * lw, 0.06, 3, 7, MARK_LIFT, mk);
      for (let k = 1; k < w.back; k++) dashes(MT, net, w, k * lw, 0.06, 3, 7, MARK_LIFT, mk);
    } else {
      // one carriageway: lane lines between its lanes
      for (let k = 1; k < w.total; k++) dashes(MT, net, w, (k - w.total / 2) * lw, 0.07, 4, 10, MARK_LIFT, mk);
    }
    if (fast || /_link$/.test(w.hw)) {
      // edge lines
      const e = Math.min(half - 0.3 * S, (w.total / 2) * lw + 0.2 * S);
      dashes(MT, net, w, e, 0.08, 0, 0, MARK_LIFT, mk);
      dashes(MT, net, w, -e, 0.08, 0, 0, MARK_LIFT, mk);
    }
  }
  // sidewalks in the city: calçada both sides of the streets (plain white
  // limestone; the kerbs keep their granite colour)
  const SW = newT(true);
  const swc = lin(SIDEWALK);
  const kerb = lin(KERB);
  for (const w of net.ways) {
    if (!WALKED.has(w.hw) || w.tunnel || w.bridge) continue;
    const m = w.start + (w.n >> 1);
    if (X[m] * X[m] + Z[m] * Z[m] > SIDEWALK_R * SIDEWALK_R) continue;
    const half = (w.widthM / 2) * S;
    const sw = sidewalkM(w.hw) * S;
    for (const sgn of [1, -1]) {
      SW.cur = CALCADA.sidewalk;
      strip(SW, net, w.start, w.start + w.n - 1, sgn * (half + sw / 2 + 0.15 * S), sw / 2, RIBBON_LIFT + 0.02, swc, 0);
      SW.cur = 0;
      strip(SW, net, w.start, w.start + w.n - 1, sgn * (half + 0.08 * S), 0.12 * S, RIBBON_LIFT + 0.03, kerb, 0);
    }
  }
  // roundabout islands: rings of roundabout ways (closed, or chained end to end)
  const IT = newT();
  const isl = lin(ISLAND);
  const rings = roundaboutRings(net);
  for (const ring of rings) {
    const pts = ring.pts;
    let cx = 0;
    let cz = 0;
    let cy = 0;
    for (const i of pts) {
      cx += X[i];
      cz += Z[i];
      cy += Y[i];
    }
    cx /= pts.length;
    cz /= pts.length;
    cy /= pts.length;
    const inset = (ring.halfM + 0.8) * S;
    const v0 = IT.pos.length / 3;
    IT.pos.push(cx, heightAt(cx, cz) + RIBBON_LIFT + 0.05, cz);
    IT.nor.push(0, 1, 0);
    IT.col.push(isl[0], isl[1], isl[2]);
    let n = 0;
    for (const i of pts) {
      const dx = X[i] - cx;
      const dz = Z[i] - cz;
      const r = Math.hypot(dx, dz);
      const k = r > inset ? (r - inset) / r : 0;
      IT.pos.push(cx + dx * k, Y[i] + RIBBON_LIFT + 0.05, cz + dz * k);
      IT.nor.push(0, 1, 0);
      IT.col.push(isl[0], isl[1], isl[2]);
      n++;
    }
    for (let k = 0; k < n; k++) {
      const a = v0 + 1 + k;
      const b = v0 + 1 + ((k + 1) % n);
      // anticlockwise rings (x east, z south): (c, b, a) faces up
      IT.idx.push(v0, b, a, v0, a, b);
    }
  }
  const detailMeshes = [];
  const addDetail = (T, name, units, color) => {
    if (!T.idx.length) return 0;
    const m = T.pat
      ? calcadaMaterial({ polygonOffsetUnits: units, roughness: 0.9, lite })
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: color ? 0.7 : 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: units });
    materials.push(m);
    const mesh = new THREE.Mesh(geometryOf(T), m);
    mesh.name = name;
    mesh.receiveShadow = true;
    detail.add(mesh);
    detailMeshes.push(mesh);
    return T.idx.length / 3;
  };
  // sidewalks under the carriageways (so crossings stay asphalt), markings on top
  const swTris = addDetail(SW, 'sidewalks', -1.5, false);
  const mTris = addDetail(MT, 'lane-markings', -12, true);
  const iTris = addDetail(IT, 'roundabout-islands', -10, false);

  for (const [kind, st] of Object.entries(STYLE)) {
    const arr = buckets[kind];
    counts[kind] = arr.length / 6;
    if (arr.length) addLine(kind, st, arr);
  }
  function addLine(kind, st, arr) {
    const geo = new LineSegmentsGeometry();
    geo.setPositions(arr);
    const mat = new LineMaterial({
      color: st.color,
      linewidth: st.px,
      transparent: true,
      opacity: st.opacity,
      depthWrite: false,
      dashed: !!st.dashed,
      dashSize: 1.5,
      gapSize: 1.2,
    });
    mat.toneMapped = false;
    mat.fog = true;
    materials.push(mat);
    const line = new LineSegments2(geo, mat);
    if (st.dashed) line.computeLineDistances();
    line.renderOrder = order++;
    line.frustumCulled = false;
    line.name = `road-${kind}`;
    group.add(line);
    lines[kind] = line;

    if (st.glow) {
      const glowMat = new LineMaterial({
        color: st.color,
        linewidth: st.px * 3,
        transparent: true,
        opacity: 0.09,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      glowMat.toneMapped = false;
      glowMat.fog = true;
      materials.push(glowMat);
      const glow = new LineSegments2(geo, glowMat);
      glow.renderOrder = order++;
      glow.frustumCulled = false;
      glow.name = `road-${kind}-glow`;
      group.add(glow);
      glows.push(glowMat);
    }
  }
  // the tunnels: a faint dashed line over the ground where they run
  let hint = null;
  if (hintArr.length) {
    const geo = new LineSegmentsGeometry();
    geo.setPositions(hintArr);
    const mat = new LineMaterial({ color: 0xf3d7a8, linewidth: 1.3, transparent: true, opacity: 0.32, depthWrite: false, dashed: true, dashSize: 2.2, gapSize: 2.2 });
    mat.toneMapped = false;
    mat.fog = true;
    materials.push(mat);
    hint = new LineSegments2(geo, mat);
    hint.computeLineDistances();
    hint.renderOrder = order++;
    hint.frustumCulled = false;
    hint.name = 'road-tunnel-hint';
    group.add(hint);
  }
  counts.ribbonTriangles = ribbonTris;
  counts.structureTriangles = structTris;
  counts.detailTriangles = swTris + mTris + iTris;
  counts.bridges = net.bridges.length;
  counts.archBridges = archBridges;
  counts.tunnels = net.tunnels.length;
  counts.portals = net.portals.length;
  counts.embankments = embankments;
  counts.portalsDrawn = net.portals.length - portalsOpen;
  counts.roundabouts = rings.length;
  counts.tunnelHint = hintArr.length / 6;
  counts.calcadaWays = calcadaWays;

  const lamps = streetLamps(net);
  if (lamps) group.add(lamps);
  counts.lamps = lamps ? lamps.geometry.attributes.position.count : 0;

  if (hint) legendToggle((on) => api.setTunnelHint(on));

  let detailOn = true;
  const api = {
    group,
    counts,
    net,
    // the constant-width lines by kind, and the primary glow materials: the
    // streamed tiles (src/tiles.js) draw their main streets with the same
    // materials, so night, bloom and view-distance changes reach them too
    lines,
    glows,
    // w, h: CSS pixels; dpr: gl_PointSize counts device pixels
    setResolution(w, h, dpr = 1) {
      for (const m of materials) if (m.isLineMaterial) m.resolution.set(w, h);
      if (lamps) lamps.material.uniforms.uHeight.value = h * dpr;
    },
    // 0 day .. 1 night: lamps on; the unlit street surfaces and the minor
    // lines darken with the land, the main streets keep a soft glow
    setNight(w) {
      if (Math.abs(w - lastNight) < 0.005) return;
      lastNight = w;
      applyOpacity();
      for (const g of glows) g.opacity = 0.09 + 0.05 * w;
      if (lamps) {
        lamps.material.uniforms.uNight.value = w;
        lamps.visible = w > 0.02;
      }
    },
    // with post-processing, the main streets' core and glow go above the
    // bloom threshold (linear HDR); without it they keep their plain colours
    setBloom(on) {
      bloomOn = !!on;
      applyBloom();
    },
    // camera distance to the orbit target: in a close-up the constant-width
    // lines step back and the lit street surfaces carry the streets; the
    // markings, sidewalks and islands show only there
    setViewDistance(d) {
      const k = THREE.MathUtils.smoothstep(d, 60, 420);
      // from far away the whole network is on screen at once: less glow
      const far = THREE.MathUtils.smoothstep(d, 1800, 5000);
      if (Math.abs(far - lastFar) > 0.02) {
        lastFar = far;
        applyBloom();
      }
      const on = d < DETAIL_U;
      if (on !== detailOn) {
        detailOn = on;
        detail.visible = on;
      }
      if (Math.abs(k - lastClose) < 0.01) return;
      lastClose = k;
      applyOpacity();
    },
    // the thin blue river line is for the far view; up close the water
    // surface shows the river at its width
    setWaterLine(visible) {
      if (lines.water) lines.water.visible = visible;
    },
    // the dashed tunnel hint (Legend)
    setTunnelHint(on) {
      hintOn = !!on;
      if (hint) hint.visible = hintOn;
    },
  };
  return api;
}

// Rings of roundabout ways: closed ways, or one-way pieces chained end node
// to start node until they close. Returns [{ pts: [global point], halfM }].
function roundaboutRings(net) {
  const rings = [];
  const pieces = [];
  net.ways.forEach((w, wi) => {
    if (w.t.jn !== 'roundabout' && w.t.jn !== 'circular') return;
    if (w.closed) {
      const pts = [];
      for (let i = w.start; i < w.start + w.n - 1; i++) pts.push(i);
      if (pts.length >= 3) rings.push({ pts, halfM: w.widthM / 2 });
      return;
    }
    const a = net.endNode(w, 0);
    const b = net.endNode(w, 1);
    if (a >= 0 && b >= 0) pieces.push({ wi, a, b, used: false });
  });
  const byStart = new Map();
  for (const p of pieces) {
    if (!byStart.has(p.a)) byStart.set(p.a, []);
    byStart.get(p.a).push(p);
  }
  for (const p0 of pieces) {
    if (p0.used) continue;
    const chain = [p0];
    p0.used = true;
    let end = p0.b;
    let ok = false;
    for (let guard = 0; guard < 16; guard++) {
      if (end === p0.a) {
        ok = true;
        break;
      }
      const next = (byStart.get(end) || []).find((q) => !q.used);
      if (!next) break;
      next.used = true;
      chain.push(next);
      end = next.b;
    }
    if (!ok) continue;
    const pts = [];
    let half = 0;
    for (const p of chain) {
      const w = net.ways[p.wi];
      half = Math.max(half, w.widthM / 2);
      for (let i = w.start; i < w.start + w.n - 1; i++) pts.push(i);
    }
    // a ring must be round enough to hold an island
    if (pts.length >= 3) rings.push({ pts, halfM: half });
  }
  return rings;
}

// The Legend (index.html #legend): a switch for the tunnel hint, added here
// so the markup stays as it is
function legendToggle(onChange) {
  if (typeof document === 'undefined') return;
  const list = document.querySelector('#legend .legend-list');
  if (!list || list.querySelector('.legend-tunnels')) return;
  const label = { ru: 'тоннели (пунктир)', pt: 'túneis (tracejado)', en: 'tunnels (dashed)' }[language] || 'tunnels';
  const li = document.createElement('li');
  li.className = 'legend-tunnels';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-pressed', 'true');
  btn.style.cssText = 'all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:inherit';
  btn.innerHTML = '<svg viewBox="0 0 24 8" aria-hidden="true" width="24" height="8"><line x1="1" y1="4" x2="23" y2="4" stroke="#f3d7a8" stroke-width="1.6" stroke-dasharray="3 3" /></svg>';
  btn.append(document.createTextNode(label));
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    btn.style.opacity = on ? '1' : '0.45';
    onChange(on);
  });
  li.append(btn);
  list.append(li);
}

// Street lamps along the main and secondary streets: one Points draw, warm
// sodium glow, only at night. Every LAMP_M metres, alternating sides; on the
// decks at the parapets; none in the tunnels. streetscape.js stands a post
// under each glow near the camera (lampSites), and adds the lanterns of the
// pedestrian streets with the same glow (lampGlow).
const LAMP_M = 34;
export const LAMP_HEIGHT_M = 7;
// [x, y, z, ...] world: the glow points, LAMP_HEIGHT_M over the surface
export function lampSites(net) {
  const pos = [];
  const { X, Z, Y, C, HID } = net;
  for (const w of net.ways) {
    if ((w.kind !== 'primary' && w.kind !== 'secondary') || w.tunnel) continue;
    const half = (w.widthM / 2 + 1.2) * S;
    const step = LAMP_M * S;
    let s = step * 0.5;
    let side = 1;
    let i = w.start;
    const end = w.start + w.n - 1;
    while (s < w.len) {
      while (i < end - 1 && C[i + 1] < s) i++;
      if (!HID[i]) {
        const L = Math.max(1e-6, C[i + 1] - C[i]);
        const u = (s - C[i]) / L;
        const ux = (X[i + 1] - X[i]) / L;
        const uz = (Z[i + 1] - Z[i]) / L;
        const x = X[i] + ux * (s - C[i]) - uz * half * side;
        const z = Z[i] + uz * (s - C[i]) + ux * half * side;
        pos.push(x, Y[i] + (Y[i + 1] - Y[i]) * u + LAMP_HEIGHT_M * S, z);
      }
      side = -side;
      s += step;
    }
  }
  return pos;
}
function streetLamps(net) {
  return lampGlow(lampSites(net));
}
// The warm glow of lamps at night: one Points draw. sizeU: the glow's size
// in world units (2.4: about 10 m); name: the object's name.
export function lampGlow(pos, { sizeU = 2.4, name = 'street-lamps', maxPx = 12 } = {}) {
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uNight: { value: 0 }, uHeight: { value: 900 } },
    vertexShader: /* glsl */ `
      uniform float uHeight;
      varying float vFade;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        // a small glow in perspective (about 10 m), 1.5 .. 12 px
        gl_PointSize = clamp(${sizeU.toFixed(2)} * projectionMatrix[1][1] * uHeight * 0.5 / d, 1.5, ${maxPx.toFixed(1)});
        vFade = 1.0 - smoothstep(2500.0, 6000.0, d);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      varying float vFade;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r = dot(p, p);
        if (r > 1.0) discard;
        float core = exp(-r * 12.0);
        float halo = exp(-r * 3.0) * 0.22;
        vec3 sodium = vec3(1.0, 0.58, 0.24);
        gl_FragColor = vec4(sodium * (core * 2.4 + halo) * uNight * vFade, 1.0);
      }`,
  });
  mat.toneMapped = false;
  const pts = new THREE.Points(geo, mat);
  pts.name = name;
  // point sizes follow the real drawing buffer, whatever set the pixel
  // ratio (the 2x quality mode, a postcard capture)
  const _db = new THREE.Vector2();
  pts.onBeforeRender = (renderer) => {
    const t = renderer.getRenderTarget();
    mat.uniforms.uHeight.value = t ? t.height : renderer.getDrawingBufferSize(_db).y;
  };
  pts.frustumCulled = false;
  pts.visible = false;
  pts.renderOrder = 30;
  return pts;
}
