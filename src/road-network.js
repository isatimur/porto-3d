// The street network as one model: heights, structures and the traffic graph.
// DOM-free and three-free, so node scripts can import it (scripts/check-traffic.mjs).
//
// buildNetwork(roads, project, heightAt) reads roads.json v2 (src: scripts/
// fetch-roads.mjs) once per roads object and returns:
//   - every street, path bridge and railway as a densified polyline in
//     world units (points <= 3 units = 12 m apart) with two heights per
//     point: the ground (G) and the road surface (Y). They differ on
//     bridges (the deck), on the approach ramps next to them, and inside
//     tunnels, where the point is also marked hidden (HID);
//   - the bridges, each with its crossings (what it spans), and the road
//     tunnels with their portals;
//   - the junction graph for the traffic: edges between the OSM nodes that
//     two streets share, one directed lane set per allowed direction
//     (one-way streets, motorways and roundabouts have one).
//
// createFlow(net, opts) runs the vehicles on that graph (life.js draws them).
// Right-hand traffic: two-way roads carry each direction right of the
// centre line; one-way ways (a motorway carriageway, a roundabout) spread
// their lanes around the way line. Roundabouts in OSM run in the direction
// of travel, anticlockwise in Portugal, so following `ow` turns them right.
//
// Streetscape model on top of the network (all still three-free):
//   - SIDEWALK_WIDTH_M / PAVEMENT_COLOR / KERB_COLOR: the sidewalk and kerb
//     the urban classes carry, coloured by class;
//   - roundaboutRings + net.roundaboutRings, and buildStreetscapeGeometry:
//     the central island and the splitter islands at the arms, as geometry;
//   - net.pedestrianZones / net.pedestrianZoneWay + pedestrianZonesOf: the
//     car-free paved zones (Rua de Santa Catarina, Rua das Flores ...), which
//     createFlow blocks by default;
//   - BUS_LANE_COLOR / TRAM_LANE_COLOR + the transit bands in
//     buildStreetscapeGeometry: bus/PSV lanes and street-running rail.
// buildStreetscapeGeometry(net) returns one merged mesh per feature
// (sidewalks, kerbs, islands, transit) of plain arrays, so the draw layer
// uploads a few BufferGeometries instead of a mesh per way.

import { authoredDeck, deckBase } from './bridge-decks.js';

// ------------------------------------------------------------ classes
// laneM: lane width; lanes: default lanes both ways (oneWay: default on a
// one-way way); extraM: shoulders and gutters; kmh: default speed; turn: how
// strongly traffic turns onto it; spawn: share of the vehicles; slope: the
// steepest ramp to a bridge.
export const CLASS = {
  motorway: { laneM: 3.6, lanes: 4, oneWay: 2, extraM: 3.6, kmh: 120, turn: 12, spawn: 5, slope: 0.045 },
  trunk: { laneM: 3.4, lanes: 2, oneWay: 2, extraM: 1.6, kmh: 70, turn: 7, spawn: 3, slope: 0.055 },
  primary: { laneM: 3.3, lanes: 2, oneWay: 1, extraM: 1.2, kmh: 50, turn: 5, spawn: 2.2, slope: 0.07 },
  secondary: { laneM: 3.1, lanes: 2, oneWay: 1, extraM: 1, kmh: 50, turn: 3.5, spawn: 1.4, slope: 0.07 },
  tertiary: { laneM: 3, lanes: 2, oneWay: 1, extraM: 0.8, kmh: 50, turn: 2.4, spawn: 0.9, slope: 0.08 },
  motorway_link: { laneM: 3.6, lanes: 2, oneWay: 1, extraM: 2.6, kmh: 70, turn: 4, spawn: 0.8, slope: 0.06 },
  trunk_link: { laneM: 3.4, lanes: 2, oneWay: 1, extraM: 1.6, kmh: 50, turn: 3, spawn: 0.5, slope: 0.07 },
  primary_link: { laneM: 3.3, lanes: 2, oneWay: 1, extraM: 1, kmh: 40, turn: 2.6, spawn: 0.4, slope: 0.07 },
  secondary_link: { laneM: 3.1, lanes: 2, oneWay: 1, extraM: 1, kmh: 40, turn: 2, spawn: 0.3, slope: 0.08 },
  tertiary_link: { laneM: 3, lanes: 2, oneWay: 1, extraM: 0.8, kmh: 40, turn: 1.6, spawn: 0.2, slope: 0.08 },
  unclassified: { laneM: 2.8, lanes: 2, oneWay: 1, extraM: 0.4, kmh: 40, turn: 0.7, spawn: 0.12, slope: 0.1 },
  residential: { laneM: 2.7, lanes: 2, oneWay: 1, extraM: 0.3, kmh: 30, turn: 0.35, spawn: 0.07, slope: 0.1 },
  living_street: { laneM: 2.5, lanes: 2, oneWay: 1, extraM: 0, kmh: 20, turn: 0.08, spawn: 0.01, slope: 0.1 },
  pedestrian: { laneM: 2.5, lanes: 2, oneWay: 2, extraM: 0, kmh: 0, slope: 0.12, noCar: true },
  path: { laneM: 1.2, lanes: 2, oneWay: 2, extraM: 0.4, kmh: 0, slope: 0.12, noCar: true },
  rail: { laneM: 2.4, lanes: 1, oneWay: 1, extraM: 1.2, kmh: 0, slope: 0.025, noCar: true },
};
const classOf = (t = {}, kind) => CLASS[t.hw] || (kind === 'rail' ? CLASS.rail : kind === 'foot' ? CLASS.path : kind === 'minor' ? CLASS.residential : kind === 'secondary' ? CLASS.secondary : CLASS.primary);

// street surfaces (sRGB): OSM `surface`, else the class default
export const SURFACE_COLOR = {
  asphalt: 0x4f4d4b,
  sett: 0x857d72, // Braga's granite setts (paralelos)
  cobblestone: 0x7c7466,
  unhewn_cobblestone: 0x746b5d,
  paving_stones: 0x8e8981,
  stone: 0x837b70,
  concrete: 0x95918a,
  'concrete:lanes': 0x95918a,
  paved: 0x5b5855,
  metal: 0x5b6064,
  wood: 0x6f5a45,
  gravel: 0x9a8a6f,
  fine_gravel: 0x9f8f74,
  compacted: 0x93846a,
  unpaved: 0x8c7b61,
  ground: 0x7f6c52,
  dirt: 0x7f6c52,
  grass: 0x5f7040,
  pebblestone: 0x8d8579,
};
const SURFACE_DEFAULT = { primary: 0x4d4b49, secondary: 0x57544f, minor: 0x6c665d, foot: 0x8b857b, rail: 0x5f574e };
export function surfaceOf(f) {
  const s = f.t?.sf;
  return SURFACE_COLOR[s] ?? SURFACE_DEFAULT[f.kind] ?? 0x66615a;
}

// ------------------------------------------------------------ streetscape
// The street-level model: which urban way carries a sidewalk and a kerb, where
// the roundabout islands sit, which lanes are bus/tram, and which named streets
// are car-free pedestrian zones. The draw layer asks
// `buildStreetscapeGeometry(net)` for one merged mesh per feature (sidewalks,
// kerbs, islands, transit markings) instead of a mesh per way. All metre
// values; geometry multiplies by net.S (roads.js RIBBON_LIFT for reference).
export const SIDEWALK_WIDTH_M = {
  primary: 2.4,
  secondary: 2.4,
  tertiary: 2.4,
  primary_link: 2.0,
  secondary_link: 2.0,
  tertiary_link: 2.0,
  unclassified: 1.8,
  residential: 1.6,
  living_street: 1.6,
};
export const KERB_H_M = 0.15; // kerb face height (a step up to the pavement)
export const GAUGE_M = 1.435; // standard tram/light-rail gauge
export const URBAN_R = 470; // world units (~1.9 km) around the origin: the centre
// pavements (sRGB) by class: the Baixa's limestone paving is lighter than a
// residential lane's worn concrete
export const PAVEMENT_COLOR = {
  primary: 0xa6a096,
  secondary: 0x9f998f,
  tertiary: 0x9a948a,
  primary_link: 0xa6a096,
  secondary_link: 0x9f998f,
  tertiary_link: 0x9a948a,
  unclassified: 0x948e84,
  residential: 0x8f8980,
  living_street: 0x8b857b,
};
export const KERB_COLOR = {
  primary: 0xdcd7cf,
  secondary: 0xd7d2ca,
  tertiary: 0xd1ccc4,
  primary_link: 0xdcd7cf,
  secondary_link: 0xd7d2ca,
  tertiary_link: 0xd1ccc4,
  unclassified: 0xcac5bd,
  residential: 0xc4bfb7,
  living_street: 0xbfbab2,
};
export const ISLAND_COLOR = 0x5b7a3c;
export const ISLAND_KERB_COLOR = 0xc4c0b8;
export const BUS_LANE_COLOR = 0xa83b2e; // bus/PSV lane paint
export const TRAM_LANE_COLOR = 0xbfae8e; // street-running rail

// sRGB hex -> linear working colour (the same mapping THREE.Color applies), so
// the plain arrays upload as vertex colours exactly like roads.js's lin().
function toLinear(hex) {
  const f = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return [f(((hex >> 16) & 255) / 255), f(((hex >> 8) & 255) / 255), f((hex & 255) / 255)];
}

// one merged mesh: plain typed-array-friendly lists, no three
function newMesh() {
  return { position: [], normal: [], color: [], index: [] };
}
function vert(T, p, c, n) {
  T.position.push(p[0], p[1], p[2]);
  T.normal.push(n[0], n[1], n[2]);
  T.color.push(c[0], c[1], c[2]);
}
// a quad a-b-c-d with a given normal, wound to agree with it
function quad(T, a, b, c, d, col, n = [0, 1, 0]) {
  const i = T.position.length / 3;
  for (const p of [a, b, c, d]) vert(T, p, col, n);
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const d2 = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
  if (d2 >= 0) T.index.push(i, i + 1, i + 2, i, i + 2, i + 3);
  else T.index.push(i, i + 2, i + 1, i, i + 3, i + 2);
}
function tri(T, a, b, c, col, n = [0, 1, 0]) {
  const i = T.position.length / 3;
  for (const p of [a, b, c]) vert(T, p, col, n);
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const d2 = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
  if (d2 >= 0) T.index.push(i, i + 1, i + 2);
  else T.index.push(i, i + 2, i + 1);
}

export const LANE_M = 3; // nominal lane width (m)
const MAX_STEP = 3; // world units between points
const PROFILE_CUT = 0.06; // a ground way may lie this far (0.25 m) under the ground
const CROSS_FALL = 0.4; // steepest cross slope a ribbon follows (rise per unit across)
const PROFILE_FILL = 0.3; // ... and this far (1.2 m) over it, before it counts as a ramp
// tunnel=yes and its variants: a bored road/rail tunnel, drawn with a portal
// facade in the hillside
const ROAD_TUNNELS = new Set(['yes', 'avalanche_protector', 'flooded']);
// tunnel=building_passage / covered, or covered=yes without a tunnel tag
// (the VCI cut-and-cover under the centre, metro station boxes, arcades):
// drawn with the flat concrete covered mouth instead
const COVERED_TUNNELS = new Set(['building_passage', 'covered', 'gallery']);

// clearance of a deck (top of the road surface) over what it spans, in m.
// Water: over the terrain model, which has no river channel (the Este and
// the Torto run 2-4 m below their banks in reality, the DEM shows < 1 m):
// a deck at bank level plus a visible gap over the water surface, and no
// hump in a flat street. A way: over that way's own surface (a ramp or a
// deck below counts at its real height), 5.1 m headroom + 1.3 m deck.
export const CLEAR_WATER = { river: 2.8, stream: 2.2, canal: 2.4, other: 2.2 };
export const CLEAR_WAY = 6.4;
// a tunnel chain shorter than this is an underpass under a square or a
// building: drawn as an open road, no portals, never hidden
export const MIN_TUNNEL_M = 12;

const memo = new WeakMap();

export function buildNetwork(roads, project, heightAt) {
  if (memo.has(roads)) return memo.get(roads);
  const net = build(roads, project, heightAt);
  memo.set(roads, net);
  return net;
}

// Rings of roundabout ways: closed ways, or one-way pieces chained end node to
// start node until they close. Returns [{ pts: [global point], halfM, cx, cz }].
// (roads.js draws the central island; the geometry builder below reuses this.)
export function roundaboutRings(net) {
  const rings = [];
  const pieces = [];
  net.ways.forEach((w, wi) => {
    if (w.t.jn !== 'roundabout' && w.t.jn !== 'circular') return;
    if (w.closed) {
      const pts = [];
      for (let i = w.start; i < w.start + w.n - 1; i++) pts.push(i);
      if (pts.length >= 3) rings.push({ pts, halfM: w.widthM / 2, ways: [wi] });
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
    const ws = [];
    let half = 0;
    for (const p of chain) {
      const w = net.ways[p.wi];
      ws.push(p.wi);
      half = Math.max(half, w.widthM / 2);
      for (let i = w.start; i < w.start + w.n - 1; i++) pts.push(i);
    }
    if (pts.length >= 3) rings.push({ pts, halfM: half, ways: ws });
  }
  for (const ring of rings) {
    let cx = 0;
    let cz = 0;
    for (const i of ring.pts) {
      cx += net.X[i];
      cz += net.Z[i];
    }
    ring.cx = cx / ring.pts.length;
    ring.cz = cz / ring.pts.length;
  }
  return rings;
}

// The car-free pedestrian zones of the centre, derived from OSM alone: a
// pedestrianized named street (highway=pedestrian / living_street) is car-free,
// plus the small named car lanes that run right alongside it (the OSM pieces
// still tagged residential along Rua de Santa Catarina, Rua das Flores). The
// core must be a real pedestrianised stretch (>= ~240 m sampled), and a car
// lane is only pulled in within ~64 m of that core, so a same-named street in
// another parish and a genuine arterial of the same name stay car roads.
// Returns the zones and a per-way flag for the traffic graph.
export function pedestrianZonesOf(net) {
  const { ways, X, Z } = net;
  const wayZone = new Uint8Array(ways.length);
  const CELL = 8; // world units (~32 m)
  const key = (x, z) => Math.floor(x / CELL) * 100003 + Math.floor(z / CELL);
  const byName = new Map();
  ways.forEach((w, wi) => {
    const name = w.t?.name;
    if (!name || w.kind === 'rail' || w.tunnel) return;
    const ped = w.hw === 'pedestrian' || w.hw === 'living_street';
    const small = w.car && (w.hw === 'residential' || w.hw === 'unclassified' || w.hw === 'living_street' || w.hw === 'service');
    if (!ped && !small) return;
    let a = byName.get(name);
    if (!a) byName.set(name, (a = []));
    a.push(wi);
  });
  const zones = [];
  for (const [name, list] of byName) {
    const ped = list.filter((wi) => {
      const h = ways[wi].hw;
      return h === 'pedestrian' || h === 'living_street';
    });
    if (!ped.length) continue;
    let pedPts = 0;
    const core = new Set();
    for (const wi of ped) {
      const w = ways[wi];
      pedPts += w.n;
      for (let i = w.start; i < w.start + w.n; i++) core.add(key(X[i], Z[i]));
    }
    if (pedPts < 20) continue; // a real pedestrianised run, not a stray footway
    const near = (wi) => {
      const w = ways[wi];
      for (let i = w.start; i < w.start + w.n; i++) {
        const gx = Math.floor(X[i] / CELL);
        const gz = Math.floor(Z[i] / CELL);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) if (core.has((gx + dx) * 100003 + (gz + dz))) return true;
        }
      }
      return false;
    };
    const members = [...ped];
    for (const wi of list) if (!ped.includes(wi) && near(wi)) members.push(wi);
    const zone = { name, ways: members, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const wi of members) {
      const w = ways[wi];
      wayZone[wi] = 1;
      w.pedestrianZone = true;
      w.paved = true;
      for (let i = w.start; i < w.start + w.n; i++) {
        zone.minX = Math.min(zone.minX, X[i]);
        zone.maxX = Math.max(zone.maxX, X[i]);
        zone.minZ = Math.min(zone.minZ, Z[i]);
        zone.maxZ = Math.max(zone.maxZ, Z[i]);
      }
    }
    zones.push(zone);
  }
  return { zones, wayZone };
}

function build(roads, project, heightAt) {
  const S = 1 / 4;
  const X = [];
  const Z = [];
  const C = [];
  const ways = [];
  const feats = roads.features || [];
  // ---- densify every street, rail and footway bridge
  for (let fi = 0; fi < feats.length; fi++) {
    const f = feats[fi];
    if (f.kind === 'water' || !Array.isArray(f.pts) || f.pts.length < 2) continue;
    const t = f.t || {};
    const cls = classOf(t, f.kind);
    const start = X.length;
    const at = new Int32Array(f.pts.length); // original point -> global index
    let cum = 0;
    let prev = null;
    for (let i = 0; i < f.pts.length; i++) {
      const p = project(f.pts[i][0], f.pts[i][1]);
      if (!prev) {
        X.push(p.x);
        Z.push(p.z);
        C.push(0);
      } else {
        const L = Math.hypot(p.x - prev.x, p.z - prev.z);
        // on a hillside (ground gradient over 25 %) the points sit twice as
        // close: a ribbon quad then follows the ground's own triangles
        const mx = (p.x + prev.x) / 2;
        const mz = (p.z + prev.z) / 2;
        const gx = heightAt(mx + 1, mz) - heightAt(mx - 1, mz);
        const gz = heightAt(mx, mz + 1) - heightAt(mx, mz - 1);
        const step = Math.hypot(gx, gz) > 0.5 ? MAX_STEP / 2 : MAX_STEP;
        const n = Math.max(1, Math.ceil(L / step));
        for (let k = 1; k <= n; k++) {
          X.push(prev.x + ((p.x - prev.x) * k) / n);
          Z.push(prev.z + ((p.z - prev.z) * k) / n);
          cum += L / n;
          C.push(cum);
        }
      }
      at[i] = X.length - 1;
      prev = p;
    }
    const n = X.length - start;
    // lanes and width
    const ow = t.ow || 0;
    let total = t.ln || (ow ? cls.oneWay : cls.lanes);
    let fwd;
    let back;
    if (ow === 1) {
      fwd = total;
      back = 0;
    } else if (ow === -1) {
      fwd = 0;
      back = total;
    } else if (t.lf || t.lb) {
      fwd = t.lf || Math.max(1, total - (t.lb || 0));
      back = t.lb || Math.max(1, total - fwd);
      total = fwd + back;
    } else {
      fwd = Math.max(1, Math.round(total / 2));
      back = Math.max(1, total - fwd);
    }
    let widthM = total * cls.laneM + cls.extraM;
    if (t.hw === 'pedestrian') widthM = 6;
    if (f.kind === 'foot') widthM = t.hw === 'steps' ? 2 : 3;
    if (f.kind === 'rail') widthM = 4.2;
    const tu = t.tu;
    const isRail = f.kind === 'rail';
    const isWater = f.kind === 'water';
    // a bored tunnel (tunnel=yes ...) — the historic hillside tunnels
    const bored = !!tu && ROAD_TUNNELS.has(tu) && !isWater;
    // a covered tunnel: tunnel=building_passage / covered, or covered=yes on
    // a road with no tunnel tag (the VCI under the centre). covered=yes on a
    // railway alone is a train shed, not a tunnel, so rail needs the tag.
    const covered = (!!tu && COVERED_TUNNELS.has(tu) && !isWater) || (!tu && !!t.cv && !isWater && !isRail);
    const tunnel = bored || covered;
    ways.push({
      fi,
      f,
      t,
      kind: f.kind,
      hw: t.hw || (f.kind === 'rail' ? 'rail' : ''),
      cls,
      start,
      n,
      at,
      len: cum,
      ow,
      fwd,
      back,
      total,
      widthM,
      laneW: cls.laneM * S,
      ly: t.ly || 0,
      bridge: !!t.br || ((t.ly || 0) > 0 && !tu), // settled below by the crossings
      tagBridge: !!t.br,
      // a deck of one of the authored Douro bridges (src/bridge-decks.js):
      // it rides the model's real deck height
      authored: t.br || (t.ly || 0) > 0 ? authoredDeck(t, f.kind, f.pts[0][0], f.pts[0][1]) : null,
      tunnel,
      tunnelType: bored ? 'bored' : 'covered',
      closed: false,
      crossings: [],
      car: !cls.noCar && !t.nocar && f.kind !== 'foot' && f.kind !== 'rail',
    });
  }
  const NP = X.length;
  const PX = Float32Array.from(X);
  const PZ = Float32Array.from(Z);
  const PC = Float32Array.from(C);
  const G = new Float32Array(NP);
  for (let i = 0; i < NP; i++) G[i] = heightAt(PX[i], PZ[i]);
  const Y = Float32Array.from(G);
  const HID = new Uint8Array(NP);
  // the ground's cross slope at each point (rise per world unit to the left
  // of the way's direction), measured over the way's half width: on a
  // hillside the surface and the vehicles follow it (surfaceY below)
  const SL = new Float32Array(NP);
  // unit vector to the left of the way at each point: surfaceY samples the
  // terrain at the real lateral offset with it, so a lane on a bump or in a
  // hollow rides the ground instead of a straight cross-slope estimate.
  const LX = new Float32Array(NP);
  const LZ = new Float32Array(NP);
  for (const w of ways) {
    const d = Math.max(0.75, (w.widthM / 2) * S);
    const end = w.start + w.n - 1;
    for (let i = w.start; i <= end; i++) {
      const a = Math.max(w.start, i - 1);
      const b = Math.min(end, i + 1);
      const tx = PX[b] - PX[a];
      const tz = PZ[b] - PZ[a];
      const L = Math.hypot(tx, tz);
      if (L < 1e-6) continue;
      const lx = tz / L;
      const lz = -tx / L;
      LX[i] = lx;
      LZ[i] = lz;
      const s = (heightAt(PX[i] + lx * d, PZ[i] + lz * d) - heightAt(PX[i] - lx * d, PZ[i] - lz * d)) / (2 * d);
      SL[i] = Math.max(-0.8, Math.min(0.8, s));
    }
  }

  // ---- junction nodes
  let nNodes = roads.nodes || 0;
  for (const w of ways) {
    const j = w.f.j;
    w.jp = []; // [global point, node]
    if (!j) continue;
    for (let k = 0; k < j.length; k += 2) {
      w.jp.push(w.at[j[k]], j[k + 1]);
      if (j[k + 1] + 1 > nNodes) nNodes = j[k + 1] + 1;
    }
    if (w.jp.length >= 4 && w.jp[1] === w.jp.at(-1) && w.f.pts.length > 3) w.closed = true;
  }
  // ---- the way's own profile on the fine terrain: the ground sampled at the
  // points is a 12 m lattice's noise, and ribbons drawn on it twist and tear
  // on a side slope. Low-pass the centreline height and the cross slope along
  // each way; junction points and way ends keep the raw ground, so the ways
  // that meet there still meet. The result stays within CUT below / FILL above
  // the ground (surfaceY below builds the edges from this one profile).
  {
    const pin = new Uint8Array(NP);
    for (const w of ways) {
      pin[w.start] = 1;
      pin[w.start + w.n - 1] = 1;
      for (let k = 0; k < w.jp.length; k += 2) pin[w.jp[k]] = 1;
    }
    const tmp = new Float32Array(NP);
    for (const w of ways) {
      const a = w.start;
      const b = a + w.n - 1;
      if (b - a < 2) continue;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = a; i <= b; i++) tmp[i] = pin[i] ? Y[i] : (Y[i - 1] + 2 * Y[i] + Y[i + 1]) / 4;
        for (let i = a; i <= b; i++) Y[i] = tmp[i];
      }
      for (let i = a; i <= b; i++) Y[i] = pin[i] ? G[i] : Math.min(G[i] + PROFILE_FILL, Math.max(G[i] - PROFILE_CUT, Y[i]));
      for (let pass = 0; pass < 2; pass++) {
        for (let i = a; i <= b; i++) tmp[i] = i === a || i === b ? SL[i] : (SL[i - 1] + 2 * SL[i] + SL[i + 1]) / 4;
        for (let i = a; i <= b; i++) SL[i] = tmp[i];
      }
    }
  }
  const nodeWays = Array.from({ length: nNodes }, () => []);
  ways.forEach((w, wi) => {
    for (let k = 0; k < w.jp.length; k += 2) nodeWays[w.jp[k + 1]].push(wi, w.jp[k]);
  });
  const endNode = (w, end) => {
    if (!w.jp.length) return -1;
    return end ? (w.jp.at(-2) === w.start + w.n - 1 ? w.jp.at(-1) : -1) : w.jp[0] === w.start ? w.jp[1] : -1;
  };
  // short tunnel chains (tunnel ways joined end to end) are open underpasses
  {
    const seen = new Uint8Array(ways.length);
    ways.forEach((w0, w0i) => {
      if (!w0.tunnel || seen[w0i]) return;
      const chain = [w0i];
      seen[w0i] = 1;
      let len = 0;
      for (let q = 0; q < chain.length; q++) {
        const w = ways[chain[q]];
        len += w.len;
        for (let k = 1; k < w.jp.length; k += 2) {
          const nw = nodeWays[w.jp[k]];
          for (let m = 0; m < nw.length; m += 2) {
            const v = nw[m];
            if (!seen[v] && ways[v].tunnel) {
              seen[v] = 1;
              chain.push(v);
            }
          }
        }
      }
      for (const v of chain) ways[v].chainLen = len;
      if (len < MIN_TUNNEL_M * S) for (const v of chain) ways[v].tunnel = false;
    });
  }

  // ---- crossings: what each candidate bridge spans (other streets, rails, rivers)
  const CELL = 20;
  const grid = new Map();
  const segs = []; // [ax, az, bx, bz, featureIndex, wayIndex or -1]
  const wayOfF = new Map(ways.map((w, i) => [w.fi, i]));
  for (let fi = 0; fi < feats.length; fi++) {
    const f = feats[fi];
    if (!Array.isArray(f.pts) || f.pts.length < 2) continue;
    // what runs underground is not in the way (a short underpass is)
    const own = wayOfF.get(fi);
    if (own !== undefined ? ways[own].tunnel : f.t?.tu) continue;
    let prev = project(f.pts[0][0], f.pts[0][1]);
    for (let i = 1; i < f.pts.length; i++) {
      const p = project(f.pts[i][0], f.pts[i][1]);
      const si = segs.length;
      segs.push([prev.x, prev.z, p.x, p.z, fi, wayOfF.get(fi) ?? -1]);
      const x0 = Math.floor(Math.min(prev.x, p.x) / CELL);
      const x1 = Math.floor(Math.max(prev.x, p.x) / CELL);
      const z0 = Math.floor(Math.min(prev.z, p.z) / CELL);
      const z1 = Math.floor(Math.max(prev.z, p.z) / CELL);
      for (let gx = x0; gx <= x1; gx++) {
        for (let gz = z0; gz <= z1; gz++) {
          const key = gx * 100003 + gz;
          let c = grid.get(key);
          if (!c) grid.set(key, (c = []));
          c.push(si);
        }
      }
      prev = p;
    }
  }
  function crossingsOf(wi) {
    const w = ways[wi];
    const out = [];
    const seen = new Set();
    for (let i = w.start + 1; i < w.start + w.n; i++) {
      const ax = PX[i - 1];
      const az = PZ[i - 1];
      const bx = PX[i];
      const bz = PZ[i];
      const x0 = Math.floor(Math.min(ax, bx) / CELL);
      const x1 = Math.floor(Math.max(ax, bx) / CELL);
      const z0 = Math.floor(Math.min(az, bz) / CELL);
      const z1 = Math.floor(Math.max(az, bz) / CELL);
      for (let gx = x0; gx <= x1; gx++) {
        for (let gz = z0; gz <= z1; gz++) {
          for (const si of grid.get(gx * 100003 + gz) || []) {
            const s = segs[si];
            if (s[4] === w.fi) continue;
            const key = `${si}:${i}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const rx = bx - ax;
            const rz = bz - az;
            const qx = s[2] - s[0];
            const qz = s[3] - s[1];
            const den = rx * qz - rz * qx;
            if (Math.abs(den) < 1e-9) continue;
            const u = ((s[0] - ax) * qz - (s[1] - az) * qx) / den;
            const v = ((s[0] - ax) * rz - (s[1] - az) * rx) / den;
            if (u < 0 || u > 1 || v < 0.001 || v > 0.999) continue;
            const along = PC[i - 1] + u * (PC[i] - PC[i - 1]);
            // not at the bridge's own ends (where the approaches join)
            if (along < 0.5 || along > w.len - 0.5) continue;
            const other = feats[s[4]];
            const ow2 = s[5] >= 0 ? ways[s[5]] : null;
            const ly2 = other.t?.ly || 0;
            const isWater = other.kind === 'water';
            if (ow2 && (ow2.tagBridge || ly2 > 0) && ly2 >= w.ly) continue; // runs above or beside
            // a way joined to this one (a stair or ramp winding under its
            // own footbridge) would lift it again every pass
            if (ow2 && ow2.jp.some((v, k) => k % 2 === 1 && w.jp.some((u, m) => m % 2 === 1 && u === v))) continue;
            if (!isWater && ly2 >= w.ly && !w.tagBridge) continue;
            out.push({ s: along, x: ax + u * rx, z: az + u * rz, fi: s[4], way: s[5], water: isWater ? other.t?.ww || 'stream' : null, ly: ly2, u2: v, seg: si });
          }
        }
      }
    }
    return out.sort((a, b) => a.s - b.s);
  }

  // ---- heights: bridges first (in layer order), their ramps, then tunnels
  const NL = new Float32Array(nNodes); // lift of a node above the ground (world)
  const bridges = [];
  ways.forEach((w, wi) => {
    if (!w.bridge || w.tunnel) return;
    w.crossings = crossingsOf(wi);
    if (!w.tagBridge && !w.crossings.length) {
      w.bridge = false; // layer=1 on the ground: nothing below it
      return;
    }
    if (!w.tagBridge && w.len > 250 * S) {
      w.bridge = false;
      return;
    }
    bridges.push(wi);
  });
  bridges.sort((a, b) => ways[a].ly - ways[b].ly);
  // junction nodes where only bridge pieces meet
  const onlyBridges = new Uint8Array(nNodes);
  for (let n = 0; n < nNodes; n++) onlyBridges[n] = nodeWays[n].length > 0 && nodeWays[n].every((v, k) => k % 2 === 1 || ways[v].bridge) ? 1 : 0;
  const wayY = (wi, x, z) => {
    // height of a way's surface nearest to (x, z)
    const w = ways[wi];
    let best = 0;
    let bd = Infinity;
    for (let i = w.start; i < w.start + w.n; i++) {
      const d = (PX[i] - x) ** 2 + (PZ[i] - z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return Y[best];
  };
  function deck(wi) {
    const w = ways[wi];
    const a = w.start;
    const b = a + w.n - 1;
    const n0 = endNode(w, 0);
    const n1 = endNode(w, 1);
    let y0 = G[a] + (n0 >= 0 ? NL[n0] : 0);
    let y1 = G[b] + (n1 >= 0 ? NL[n1] : 0);
    // a footway piece that ends where only other bridge pieces join (the
    // tangle of crossings and paths on and around a deck) comes down to the
    // ground only where a path on the ground joins it: level otherwise
    if (w.kind === 'foot') {
      if (n0 >= 0 && onlyBridges[n0] && y1 - G[b] > y0 - G[a]) y0 = G[a] + (y1 - G[b]);
      if (n1 >= 0 && onlyBridges[n1] && y0 - G[a] > y1 - G[b]) y1 = G[b] + (y0 - G[a]);
    }
    const slope = w.cls.slope;
    const need = w.crossings.map((c) => {
      // what is under it, at its own surface (a deck or a ramp below counts)
      const base = c.way >= 0 ? Math.max(wayY(c.way, c.x, c.z), heightAt(c.x, c.z)) : heightAt(c.x, c.z);
      const clr = c.water ? CLEAR_WATER[c.water] ?? CLEAR_WATER.other : CLEAR_WAY;
      // flat over what it spans, at least one point spacing so the deck
      // between two points never dips under the clearance
      const flat = Math.max(MAX_STEP, (c.way >= 0 ? ways[c.way].widthM / 2 + 3 : c.water === 'river' ? 10 : 3) * S);
      return { s: c.s, h: base + clr * S, flat };
    });
    for (let i = a; i <= b; i++) {
      const s = PC[i];
      const u = w.len > 0 ? s / w.len : 0;
      let y = y0 + (y1 - y0) * u;
      for (const q of need) y = Math.max(y, q.h - slope * Math.max(0, Math.abs(s - q.s) - q.flat));
      // never through the ground inside the span
      const inner = Math.min(1, Math.min(s, w.len - s) / (8 * S));
      y = Math.max(y, G[i] + 0.8 * S * inner);
      Y[i] = y;
    }
    // an authored bridge: its own deck height over the river, flat
    if (w.authored) {
      const d = w.authored;
      // the model's base (0.8 m under the water): the fitted base of the
      // landmark when main.js gave it, else the lowest ground under the deck's ways
      let base = deckBase(d);
      if (base == null) {
        base = Infinity;
        for (const o of ways) if (o.authored === d) for (let i = o.start; i < o.start + o.n; i++) base = Math.min(base, G[i]);
      }
      // never lower than the engine's own height (a deck enters a hill: it
      // follows the ground there)
      for (let i = a; i <= b; i++) Y[i] = Math.max(Y[i], base + d.deckM * S);
    }
    // every junction on the deck lifts what joins there: the approaches at
    // the ends, and a crossing or a slip road in the middle of the span
    let changed = false;
    for (let k = 0; k < w.jp.length; k += 2) {
      const node = w.jp[k + 1];
      const l = Y[w.jp[k]] - G[w.jp[k]];
      if (l > NL[node] + 0.01) {
        NL[node] = l;
        changed = true;
      }
    }
    return changed;
  }
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const wi of bridges) changed = deck(wi) || changed;
    if (!changed) break;
  }
  // footway and cycleway pieces tagged bridge that join a road deck (the
  // crossings and paths drawn on it): their surface is the deck itself
  // ... and the sidewalks of a road bridge, mapped as separate footways
  // alongside it (most of their points within the deck's half width + 7 m;
  // at Avenida da Liberdade over the Este two carriageways and two
  // sidewalks share one structure, the sidewalks 6 m off the road edge)
  const carDecks = bridges.filter((wi) => ways[wi].kind !== 'foot' && ways[wi].kind !== 'rail');
  for (const wi of bridges) {
    const w = ways[wi];
    if (w.kind !== 'foot') continue;
    for (let k = 1; k < w.jp.length && !w.onDeck; k += 2) {
      const nw = nodeWays[w.jp[k]];
      for (let m = 0; m < nw.length; m += 2) {
        const o = ways[nw[m]];
        if (o !== w && o.bridge && o.kind !== 'foot' && o.kind !== 'rail') w.onDeck = true;
      }
    }
    if (w.onDeck) continue;
    let near = 0;
    for (let i = w.start; i < w.start + w.n; i++) {
      let hit = false;
      for (const ci of carDecks) {
        const c = ways[ci];
        const r = (c.widthM / 2 + 7) * S;
        for (let j = c.start; j < c.start + c.n && !hit; j++) if ((PX[j] - PX[i]) ** 2 + (PZ[j] - PZ[i]) ** 2 < r * r) hit = true;
        if (hit) break;
      }
      if (hit) near++;
    }
    if (near >= 0.7 * w.n) w.onDeck = true;
  }

  // approach ramps: the lift spreads from the bridge ends along the
  // connected ways, falling at the class's slope
  const rampWays = ways.map((w, i) => i).filter((i) => !ways[i].bridge && !ways[i].tunnel);
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const wi of rampWays) {
      const w = ways[wi];
      let any = false;
      for (let k = 1; k < w.jp.length; k += 2) if (NL[w.jp[k]] > 0.01) any = true;
      if (!any) continue;
      const slope = w.cls.slope;
      for (let i = w.start; i < w.start + w.n; i++) {
        let lift = 0;
        for (let k = 0; k < w.jp.length; k += 2) {
          const L = NL[w.jp[k + 1]];
          if (L <= 0.01) continue;
          lift = Math.max(lift, L - slope * Math.abs(PC[i] - PC[w.jp[k]]));
        }
        if (lift > Y[i] - G[i]) Y[i] = G[i] + lift;
      }
      for (let k = 0; k < w.jp.length; k += 2) {
        const node = w.jp[k + 1];
        const l = Y[w.jp[k]] - G[w.jp[k]];
        if (l > NL[node] + 0.01) {
          NL[node] = l;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  // bridge ends follow what the ramps raised
  for (const wi of bridges) deck(wi);

  // tunnels: hidden inside, portals where they meet the open air
  const tunnels = [];
  const portals = [];
  const INSIDE = 4 * S; // m inside the portal where a vehicle disappears
  const HOOD = 11 * S; // the longest portal hood (road-structures.js)
  // Tunnel roads stay at the terrain's height (the terrain has no cuttings),
  // so a street at ground level often runs right over or beside the mouth
  // (an underpass under a roundabout or a motorway). `clear`: how far into
  // the tunnel the portal's hood can reach before it meets such a street;
  // the vehicles vanish no later than there.
  const PCELL = 8;
  const pgrid = new Map();
  ways.forEach((w, wi) => {
    if (w.tunnel || !w.car) return;
    for (let i = w.start; i < w.start + w.n; i++) {
      if (Y[i] - G[i] > 3 * S) continue; // a deck passes over the hood
      const key = Math.floor(PX[i] / PCELL) * 100003 + Math.floor(PZ[i] / PCELL);
      let c = pgrid.get(key);
      if (!c) pgrid.set(key, (c = []));
      c.push(i, wi);
    }
  });
  function clearOf(w, x, z, dx, dz) {
    const nodes = new Set();
    for (let k = 1; k < w.jp.length; k += 2) nodes.add(w.jp[k]);
    const halfW = (w.widthM / 2 + 1.7) * S;
    let clear = HOOD;
    const r = HOOD + 12 * S;
    const joined = new Map();
    for (let gx = Math.floor((x - r) / PCELL); gx <= Math.floor((x + r) / PCELL); gx++) {
      for (let gz = Math.floor((z - r) / PCELL); gz <= Math.floor((z + r) / PCELL); gz++) {
        const c = pgrid.get(gx * 100003 + gz);
        if (!c) continue;
        for (let k = 0; k < c.length; k += 2) {
          const i = c[k];
          const oi = c[k + 1];
          let j = joined.get(oi);
          if (j === undefined) {
            const o = ways[oi];
            j = o.jp.some((v, m) => m % 2 === 1 && nodes.has(v));
            joined.set(oi, j);
          }
          if (j) continue; // the approach itself
          const rx = PX[i] - x;
          const rz = PZ[i] - z;
          const u = rx * dx + rz * dz;
          const v = Math.abs(-rx * dz + rz * dx);
          const oh = (ways[oi].widthM / 2) * S;
          if (u < -1 * S || u > HOOD + oh || v > halfW + oh) continue;
          clear = Math.min(clear, Math.max(0, u - oh - 0.5 * S));
        }
      }
    }
    return clear;
  }
  ways.forEach((w, wi) => {
    if (!w.tunnel) return;
    tunnels.push(wi);
    const open = [0, 1].map((end) => {
      const node = endNode(w, end);
      // a portal where no other tunnel piece continues
      return !(node >= 0 && nodeWays[node].some((v, k) => k % 2 === 0 && v !== wi && ways[v].tunnel));
    });
    const inside = [INSIDE, INSIDE];
    for (const end of [0, 1]) {
      if (!open[end]) continue;
      const i = end ? w.start + w.n - 1 : w.start;
      const j = end ? i - 1 : i + 1;
      let dx = PX[j] - PX[i];
      let dz = PZ[j] - PZ[i];
      const L = Math.hypot(dx, dz) || 1;
      dx /= L;
      dz /= L;
      const clear = clearOf(w, PX[i], PZ[i], dx, dz);
      inside[end] = Math.min(INSIDE, clear);
      portals.push({ way: wi, x: PX[i], z: PZ[i], y: Y[i], dx, dz, widthM: w.widthM, name: w.t.name || '', clear, type: w.tunnelType });
    }
    for (let i = w.start; i < w.start + w.n; i++) {
      const s = PC[i];
      if ((!open[0] || s > inside[0]) && (!open[1] || w.len - s > inside[1])) HID[i] = 1;
    }
  });
  const hiddenFeature = new Uint8Array(feats.length);
  feats.forEach((f, i) => {
    if (f.kind === 'water' && f.t?.tu) hiddenFeature[i] = 1; // culverts, the covered Rio Este
  });

  // ---- curve speed caps (m/s) at each point from the bend of the polyline
  const CAP = new Float32Array(NP).fill(40);
  for (const w of ways) {
    for (let i = w.start + 1; i < w.start + w.n - 1; i++) {
      const ax = PX[i] - PX[i - 1];
      const az = PZ[i] - PZ[i - 1];
      const bx = PX[i + 1] - PX[i];
      const bz = PZ[i + 1] - PZ[i];
      const la = Math.hypot(ax, az);
      const lb = Math.hypot(bx, bz);
      if (la < 1e-6 || lb < 1e-6) continue;
      const c = Math.max(-1, Math.min(1, (ax * bx + az * bz) / (la * lb)));
      const th = Math.acos(c);
      if (th < 0.05) continue;
      const R = (((la + lb) / 2) * 4) / (2 * Math.sin(th / 2)); // m
      CAP[i] = Math.max(3.5, Math.min(40, Math.sqrt(2.6 * R)));
    }
  }

  const net = {
    S,
    ways,
    X: PX,
    Z: PZ,
    C: PC,
    G,
    Y,
    HID,
    SL,
    CAP,
    NL,
    heightAt,
    // the surface at point i, `left` world units left of the way's direction:
    // the way's height, or the real terrain at that lateral offset where the
    // ground rises across the road (roads.js draws with this same call, so
    // the mesh and the vehicles sit on one surface)
    surfaceY(i, left) {
      const g = heightAt(PX[i] + LX[i] * left, PZ[i] + LZ[i] * left);
      // a deck, a ramp or a hood: level with the way, or the ground if higher
      if (Y[i] - G[i] > PROFILE_FILL) return g > Y[i] ? g : Y[i];
      // on the ground: the one centreline height plus a bounded cross fall, so
      // the edges do not twist from point to point; kept within CUT below /
      // FILL above the real ground at the edge
      // (a real road is cut into the uphill side, where the ground then
      // hides the edge cleanly, and built up on the downhill side)
      const sl = SL[i] > CROSS_FALL ? CROSS_FALL : SL[i] < -CROSS_FALL ? -CROSS_FALL : SL[i];
      const y = Y[i] + sl * left;
      const lo = g - 0.25;
      const hi = g + 0.6;
      return y < lo ? lo : y > hi ? hi : y;
    },
    nNodes,
    nodeWays,
    bridges,
    tunnels,
    portals,
    hiddenFeature,
    endNode,
  };
  // ---- streetscape model: pedestrian zones, islands, sidewalk coverage
  const ped = pedestrianZonesOf(net);
  net.pedestrianZones = ped.zones;
  net.pedestrianZoneWay = ped.wayZone;
  net.roundaboutRings = roundaboutRings(net);
  net.streetscapeStats = {
    pedestrianZones: ped.zones.length,
    pedestrianZoneWays: ped.wayZone.reduce((s, v) => s + v, 0),
    sidewalkWays: ways.reduce((s, w) => {
      if (!SIDEWALK_WIDTH_M[w.hw] || !w.car || w.tunnel || w.bridge) return s;
      const m = w.start + (w.n >> 1);
      return s + (PX[m] * PX[m] + PZ[m] * PZ[m] <= URBAN_R * URBAN_R ? 1 : 0);
    }, 0),
    roundabouts: net.roundaboutRings.length,
  };
  net.pedestrianZoneAt = (x, z) => {
    for (const q of net.pedestrianZones) {
      if (x >= q.minX && x <= q.maxX && z >= q.minZ && z <= q.maxZ) return q;
    }
    return null;
  };
  net.graph = buildGraph(net);
  return net;
}

// ------------------------------------------------------------ graph
// Edges: the piece of a way between two consecutive junction nodes.
// Directed lanes (dl): an edge in one allowed direction.
function buildGraph(net) {
  const { ways, X, Z, C } = net;
  const A = [];
  const B = [];
  const W = [];
  const NS = [];
  const NE = [];
  const REV = [];
  const EDGE = [];
  let edges = 0;
  ways.forEach((w, wi) => {
    if (!w.car || w.jp.length < 4) return;
    for (let k = 0; k + 2 < w.jp.length; k += 2) {
      const a = w.jp[k];
      const b = w.jp[k + 2];
      if (b <= a) continue;
      const na = w.jp[k + 1];
      const nb = w.jp[k + 3];
      const e = edges++;
      let f = -1;
      if (w.ow >= 0) {
        f = A.length;
        A.push(a);
        B.push(b);
        W.push(wi);
        NS.push(na);
        NE.push(nb);
        REV.push(-1);
        EDGE.push(e);
      }
      if (w.ow <= 0) {
        const r = A.length;
        A.push(b);
        B.push(a);
        W.push(wi);
        NS.push(nb);
        NE.push(na);
        REV.push(f);
        EDGE.push(e);
        if (f >= 0) REV[f] = r;
      }
    }
  });
  const n = A.length;
  const g = {
    edges,
    n,
    A: Int32Array.from(A),
    B: Int32Array.from(B),
    way: Int32Array.from(W),
    ns: Int32Array.from(NS),
    ne: Int32Array.from(NE),
    rev: Int32Array.from(REV),
    edge: Int32Array.from(EDGE),
    len: new Float32Array(n),
    // unit heading at the start and at the end of each lane
    hs: new Float32Array(n * 2),
    he: new Float32Array(n * 2),
  };
  for (let d = 0; d < n; d++) {
    const a = g.A[d];
    const b = g.B[d];
    g.len[d] = Math.abs(C[b] - C[a]);
    const st = b > a ? 1 : -1;
    let hx = X[a + st] - X[a];
    let hz = Z[a + st] - Z[a];
    let L = Math.hypot(hx, hz) || 1;
    g.hs[d * 2] = hx / L;
    g.hs[d * 2 + 1] = hz / L;
    hx = X[b] - X[b - st];
    hz = Z[b] - Z[b - st];
    L = Math.hypot(hx, hz) || 1;
    g.he[d * 2] = hx / L;
    g.he[d * 2 + 1] = hz / L;
  }
  // outgoing lanes per node (CSR)
  const cnt = new Int32Array(net.nNodes + 1);
  for (let d = 0; d < n; d++) cnt[g.ns[d] + 1]++;
  for (let i = 0; i < net.nNodes; i++) cnt[i + 1] += cnt[i];
  const out = new Int32Array(n);
  const fill = cnt.slice(0, net.nNodes);
  for (let d = 0; d < n; d++) out[fill[g.ns[d]]++] = d;
  g.outStart = cnt;
  g.out = out;
  let used = 0;
  for (let i = 0; i < net.nNodes; i++) if (cnt[i + 1] > cnt[i]) used++;
  g.nodes = used;
  return g;
}

// ------------------------------------------------------------ flow
// Vehicles on the graph, in flat typed arrays; no allocation per step.
// opts: { N, rnd, blocked(x, z) -> bool, pedestrianZones -> bool, speedK(i),
//         lorryShare(way) }
// The car-free pedestrian zones of the network (Rua de Santa Catarina, Rua das
// Flores ...) block their own ways by default, on top of the caller's blocked().
export const VEHICLE = { car: 0, van: 1, lorry: 2 };
const LEN_M = [4.4, 5.2, 13];
export function createFlow(net, { N = 600, rnd = Math.random, blocked = null, pedestrianZones = true } = {}) {
  const g = net.graph;
  const { ways, X, Z, Y, C, CAP, HID, S } = net;
  const zoneWay = pedestrianZones ? net.pedestrianZoneWay : null;
  const nD = g.n;
  if (!nD) return null;
  // lanes in the direction of travel, speed (world/s), and spawn weight
  const dLanes = new Uint8Array(nD);
  const dTwo = new Uint8Array(nD);
  const dLaneW = new Float32Array(nD);
  const dV = new Float32Array(nD);
  const dTurn = new Float32Array(nD);
  const dSpawn = new Float32Array(nD);
  const dOk = new Uint8Array(nD);
  const dRound = new Uint8Array(nD);
  for (let d = 0; d < nD; d++) {
    const w = ways[g.way[d]];
    const fwd = g.B[d] > g.A[d];
    const n = w.ow === 0 ? (fwd ? w.fwd : w.back) : w.total;
    dLanes[d] = Math.max(1, Math.min(4, n));
    dTwo[d] = w.ow === 0 ? 1 : 0;
    dLaneW[d] = w.laneW;
    let kmh = w.t.ms || w.cls.kmh;
    if (w.t.jn === 'roundabout' || w.t.jn === 'circular') kmh = Math.min(kmh, 30);
    // what drivers do: a little under the limit on the fast roads
    if (kmh >= 100) kmh *= 0.9;
    dV[d] = (kmh / 3.6) * S;
    dTurn[d] = w.cls.turn || 0.05;
    dRound[d] = w.t.jn === 'roundabout' || w.t.jn === 'circular' ? 1 : 0;
    // car-free zones apply per edge (tunnels under them still carry traffic)
    const m = (g.A[d] + g.B[d]) >> 1;
    const inZone = !w.tunnel && (zoneWay ? zoneWay[g.way[d]] === 1 : false);
    dOk[d] = inZone || (blocked && !w.tunnel && blocked(X[m], Z[m])) ? 0 : 1;
    dSpawn[d] = dOk[d] ? g.len[d] * (w.cls.spawn || 0) : 0;
  }
  if (blocked || zoneWay) for (let d = 0; d < nD; d++) if (!dOk[d]) dTurn[d] = 0;

  const vd = new Int32Array(N); // directed lane
  const vs = new Float32Array(N); // distance along it (world)
  const vg = new Int32Array(N); // segment cursor within the lane
  const vv = new Float32Array(N); // speed (world/s)
  const vdrv = new Float32Array(N); // driver: share of the limit
  const vk = new Uint8Array(N); // lane, 0 = rightmost
  const vo = new Float32Array(N); // lateral offset right of the way line (world)
  const vn = new Int32Array(N).fill(-1); // next lane at the end node
  const vnCap = new Float32Array(N); // speed through that turn (world/s)
  const vt = new Uint8Array(N); // vehicle type
  const vhx = new Float32Array(N); // smoothed heading
  const vhz = new Float32Array(N);
  const ACC = [2.2 * S, 1.8 * S, 1.0 * S];
  const DEC = 3.5 * S;

  // spawn weights (the caller can re-weigh by demand)
  const cdf = new Float32Array(nD);
  let acc = 0;
  function weigh(fn) {
    acc = 0;
    for (let d = 0; d < nD; d++) {
      acc += fn ? fn(d, dSpawn[d]) : dSpawn[d];
      cdf[d] = acc;
    }
  }
  weigh(null);
  function pick(r) {
    const v = r * acc;
    let lo = 0;
    let hi = nD - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // distance along lane d of its k-th point
  const stepOf = (d) => (g.B[d] > g.A[d] ? 1 : -1);
  const distAt = (d, k) => Math.abs(C[g.A[d] + stepOf(d) * k] - C[g.A[d]]);
  const segsOf = (d) => Math.abs(g.B[d] - g.A[d]);

  // turn onto another lane at the end node of d: weighted by the class and
  // by how straight the way on is; no U-turn unless there is no other way
  // (and never on a one-way lane: that vehicle leaves the map)
  const TMP = new Float32Array(64);
  function choose(d) {
    const node = g.ne[d];
    const s0 = g.outStart[node];
    const s1 = Math.min(g.outStart[node + 1], s0 + 64);
    const hx = g.he[d * 2];
    const hz = g.he[d * 2 + 1];
    let sum = 0;
    const rev = g.rev[d];
    for (let k = s0; k < s1; k++) {
      const c = g.out[k];
      let wgt = 0;
      if (c !== rev && g.edge[c] !== g.edge[d] && dOk[c]) {
        const dot = hx * g.hs[c * 2] + hz * g.hs[c * 2 + 1];
        const straight = dot > 0.7 ? 1 : dot > -0.2 ? 0.45 : 0.08;
        wgt = dTurn[c] * straight * (g.way[c] === g.way[d] ? 2.5 : 1);
        // stay on a roundabout past at least one exit most of the time
        if (dRound[d] && dRound[c]) wgt *= 1.6;
      }
      TMP[k - s0] = wgt;
      sum += wgt;
    }
    if (sum <= 0) return rev >= 0 && dOk[rev] ? rev : -1;
    let r = rnd() * sum;
    for (let k = s0; k < s1; k++) {
      r -= TMP[k - s0];
      if (r <= 0 && TMP[k - s0] > 0) return g.out[k];
    }
    return -1;
  }
  function turnCap(d, c) {
    if (c < 0) return 0;
    if (c === g.rev[d]) return 2 * S;
    const dot = g.he[d * 2] * g.hs[c * 2] + g.he[d * 2 + 1] * g.hs[c * 2 + 1];
    // 40 m/s straight on, 5 m/s at a right angle, 3 m/s hairpin
    const v = dot > 0.97 ? 40 : dot > 0 ? 5 + 35 * ((dot - 0) / 0.97) ** 3 : 3 + 2 * (1 + dot);
    return v * S;
  }
  function laneOffset(d, k) {
    const n = dLanes[d];
    const lw = dLaneW[d];
    return dTwo[d] ? (n - k - 0.5) * lw : (n / 2 - k - 0.5) * lw;
  }
  function setLane(i, d) {
    const n = dLanes[d];
    if (vt[i] === 2) vk[i] = 0;
    else if (vk[i] >= n) vk[i] = n - 1;
  }

  function spawn(i, type) {
    const d = pick(rnd());
    vd[i] = d;
    vs[i] = rnd() * g.len[d];
    vg[i] = 0;
    const m = segsOf(d);
    while (vg[i] < m - 1 && distAt(d, vg[i] + 1) < vs[i]) vg[i]++;
    if (type !== undefined) vt[i] = type;
    vdrv[i] = 0.86 + rnd() * 0.22;
    vk[i] = Math.floor(rnd() * dLanes[d]);
    setLane(i, d);
    vo[i] = laneOffset(d, vk[i]);
    vv[i] = dV[d] * vdrv[i] * 0.7;
    vn[i] = choose(d);
    vnCap[i] = turnCap(d, vn[i]);
    vhx[i] = g.hs[d * 2];
    vhz[i] = g.hs[d * 2 + 1];
  }

  // one step; k: the traffic model's speed factor for this vehicle
  function step(i, dt, k) {
    let d = vd[i];
    const L = g.len[d];
    const m = segsOf(d);
    // the speed it wants: the limit, the driver, the clock, the lorry cap
    let want = dV[d] * vdrv[i] * k;
    if (vt[i] === 2) want = Math.min(want, (88 / 3.6) * S);
    // bends ahead within the braking distance
    const st = stepOf(d);
    const s = vs[i];
    for (let q = 1; q <= 3; q++) {
      const kk = vg[i] + q;
      if (kk > m) break;
      const p = g.A[d] + st * kk;
      const ds = Math.max(0, distAt(d, kk) - s);
      const cap = CAP[p] * S;
      const lim = Math.sqrt(cap * cap + 2 * DEC * ds);
      if (lim < want) want = lim;
    }
    // the turn at the end node
    const left = Math.max(0, L - s);
    const tc = vn[i] >= 0 ? vnCap[i] : 1.5 * S;
    const lim = Math.sqrt(tc * tc + 2 * DEC * left);
    if (lim < want) want = lim;
    const v = vv[i];
    vv[i] = want > v ? Math.min(want, v + ACC[vt[i]] * dt) : Math.max(want, v - DEC * 1.6 * dt);
    let ns = s + vv[i] * dt;
    // onto the next lane(s)
    for (let guard = 0; guard < 4 && ns > g.len[d]; guard++) {
      const next = vn[i];
      if (next < 0) return false; // a dead end on a one-way lane or the map edge
      ns -= g.len[d];
      d = next;
      vd[i] = d;
      vg[i] = 0;
      setLane(i, d);
      vn[i] = choose(d);
      vnCap[i] = turnCap(d, vn[i]);
    }
    vs[i] = Math.min(ns, g.len[d]);
    const mm = segsOf(d);
    while (vg[i] < mm - 1 && distAt(d, vg[i] + 1) < vs[i]) vg[i]++;
    // drift toward the lane's offset (lane counts change at junctions)
    const off = laneOffset(d, vk[i]);
    const dv = off - vo[i];
    const r = 1.4 * S * dt;
    vo[i] += dv > r ? r : dv < -r ? -r : dv;
    // keep right: on a two-way road never left of the innermost lane's
    // centre (a vehicle coming off a one-way carriageway, whose lanes lie
    // around the way line, steps over at the junction)
    if (dTwo[d] && vo[i] < 0.5 * dLaneW[d]) vo[i] = 0.5 * dLaneW[d];
    return true;
  }

  // world position and heading into `out` { x, y, z, hx, hz, hidden }
  function locate(i, out, dt = 0) {
    const d = vd[i];
    const st = stepOf(d);
    const a = g.A[d] + st * vg[i];
    const b = a + st;
    const s0 = distAt(d, vg[i]);
    const seg = Math.max(1e-6, Math.abs(C[b] - C[a]));
    const u = Math.max(0, Math.min(1, (vs[i] - s0) / seg));
    let hx = X[b] - X[a];
    let hz = Z[b] - Z[a];
    const L = Math.hypot(hx, hz) || 1;
    hx /= L;
    hz /= L;
    // right of travel: (-hz, hx) (x east, z south)
    const o = vo[i];
    out.x = X[a] + (X[b] - X[a]) * u - hz * o;
    out.z = Z[a] + (Z[b] - Z[a]) * u + hx * o;
    // on the surface under the wheels: the way's height, or the hillside
    // where the ground rises across the road (left of the way = -o forward)
    const left = st > 0 ? -o : o;
    const ya = net.surfaceY(a, left);
    out.y = ya + (net.surfaceY(b, left) - ya) * u;
    // a bump between two densified points can still rise above the
    // interpolated surface: put the wheels on the real ground at the exact
    // position, never below it (a bridge deck stays higher, so it wins)
    const gy = net.heightAt(out.x, out.z);
    if (gy > out.y) out.y = gy;
    out.hidden = u < 0.5 ? HID[a] : HID[b];
    // the body turns smoothly through the polyline's joints
    if (dt > 0) {
      const kk = 1 - Math.exp(-dt * 7);
      let sx = vhx[i] + (hx - vhx[i]) * kk;
      let sz = vhz[i] + (hz - vhz[i]) * kk;
      const l2 = Math.hypot(sx, sz) || 1;
      sx /= l2;
      sz /= l2;
      // never more than 60 degrees behind the lane (a hairpin, a U-turn at a
      // dead end): the body must not face against the traffic
      const dot = sx * hx + sz * hz;
      if (dot < -0.95) {
        sx = hx;
        sz = hz;
      } else if (dot < 0.5) {
        const k = hx * sz - hz * sx >= 0 ? 0.8660254 : -0.8660254;
        sx = hx * 0.5 - hz * k;
        sz = hx * k + hz * 0.5;
      }
      vhx[i] = sx;
      vhz[i] = sz;
    } else if (dt < 0) {
      vhx[i] = hx;
      vhz[i] = hz;
    }
    out.hx = vhx[i];
    out.hz = vhz[i];
    // the lane's own direction here (for the checks)
    out.sx = hx;
    out.sz = hz;
    // the pitch on ramps and decks
    out.dy = (Y[b] - Y[a]) / L;
    return out;
  }

  return {
    N,
    vd,
    vs,
    vv,
    vt,
    vk,
    vo,
    spawn,
    step,
    locate,
    weigh,
    dSpawn,
    dLanes,
    dTwo,
    dV,
    LEN_M,
    get graph() {
      return g;
    },
  };
}

// ------------------------------------------------------------ streetscape geometry
// One flat band along points i0..i1 of a way at lateral offset `off` (world,
// left of travel positive), half width `half`, sitting `lift` over the surface.
// The pavement band sits a kerb above the carriageway (raised), the markings
// sit on it. Hidden points (a tunnel) are skipped.
function band(T, net, w, off, half, lift, col) {
  const { X, Z, HID } = net;
  const o0 = off - half;
  const o1 = off + half;
  for (let i = w.start; i < w.start + w.n - 1; i++) {
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
    const lx = dz;
    const lz = -dx;
    const a = [ax + lx * o0, net.surfaceY(i, o0) + lift, az + lz * o0];
    const b = [ax + lx * o1, net.surfaceY(i, o1) + lift, az + lz * o1];
    const c = [bx + lx * o1, net.surfaceY(i + 1, o1) + lift, bz + lz * o1];
    const d = [bx + lx * o0, net.surfaceY(i + 1, o0) + lift, bz + lz * o0];
    quad(T, a, b, c, d, col);
  }
}

// bus/PSV lanes from the OSM tags the pipeline may carry (busway, psv,
// bus:lanes, lanes:psv). Returns the sides (1 = left of travel, -1 = right).
function busLaneSides(w) {
  const t = w.t || {};
  const has = (...keys) => keys.some((k) => t[k] !== undefined && t[k] !== 'no');
  const sides = [];
  if (has('busway:left', 'psv:forward', 'bus:lanes:forward')) sides.push(1);
  if (has('busway:right', 'psv:backward', 'bus:lanes:backward')) sides.push(-1);
  if (!sides.length && has('busway', 'psv', 'bus', 'bus:lanes', 'lanes:psv')) sides.push(1, -1);
  return sides;
}

// Build the merged streetscape meshes of a network. Returns
// { sidewalks, kerbs, islands, transit, counts } where each mesh is
// { position, normal, color, index } of plain numbers (upload straight into a
// THREE.BufferGeometry). `opts`: urbanR (world units), sidewalks, kerbs,
// islands, transit (false to skip one), lift, kerbH (metres).
export function buildStreetscapeGeometry(net, opts = {}) {
  const S = net.S;
  const { X, Z } = net;
  const urbanR = opts.urbanR ?? URBAN_R;
  const lift = opts.lift ?? 0.12; // road-surface lift (roads.js RIBBON_LIFT)
  const detailLift = lift + 0.02;
  const kerbH = (opts.kerbH ?? KERB_H_M) * S;
  const out = { sidewalks: newMesh(), kerbs: newMesh(), islands: newMesh(), transit: newMesh() };
  const pav = {};
  const kcol = {};
  for (const k of Object.keys(PAVEMENT_COLOR)) pav[k] = toLinear(PAVEMENT_COLOR[k]);
  for (const k of Object.keys(KERB_COLOR)) kcol[k] = toLinear(KERB_COLOR[k]);
  const islandCol = toLinear(ISLAND_COLOR);
  const islandKerbCol = toLinear(ISLAND_KERB_COLOR);
  const busCol = toLinear(BUS_LANE_COLOR);
  const tramCol = toLinear(TRAM_LANE_COLOR);

  // ---- sidewalks (raised) and kerbs, both sides, coloured by class
  for (const w of net.ways) {
    const swM = SIDEWALK_WIDTH_M[w.hw];
    if (!swM || !w.car || w.tunnel || w.bridge) continue;
    const m = w.start + (w.n >> 1);
    if (X[m] * X[m] + Z[m] * Z[m] > urbanR * urbanR) continue;
    const roadHalf = (w.widthM / 2) * S;
    const swHalf = (swM * 0.5) * S;
    const pc = pav[w.hw] || pav.residential;
    const kc = kcol[w.hw] || kcol.residential;
    for (const side of [1, -1]) {
      const swOff = side * (roadHalf + 0.1 * S + swHalf);
      if (opts.sidewalks !== false) band(out.sidewalks, net, w, swOff, swHalf, lift + kerbH, pc);
    }
    if (opts.kerbs !== false) kerbBand(out.kerbs, net, w, roadHalf, lift, kerbH, kc);
  }

  // ---- roundabout islands: central green island + splitter islands at arms
  if (opts.islands !== false) {
    for (const ring of net.roundaboutRings || roundaboutRings(net)) {
      fillIsland(out.islands, out.kerbs, net, ring, lift, kerbH, islandCol, islandKerbCol);
      splitterIslands(out.islands, net, ring, lift, islandCol);
    }
  }

  // ---- bus / tram lane markings
  if (opts.transit !== false) {
    for (const w of net.ways) {
      if (w.tunnel) continue;
      const sides = busLaneSides(w);
      if (sides.length) {
        const roadHalf = (w.widthM / 2) * S;
        for (const side of sides) band(out.transit, net, w, side * (roadHalf - 1.5 * S), 1.4 * S, detailLift, busCol);
      }
      if (w.kind === 'rail' && (w.t?.rw === 'light_rail' || w.t?.rw === 'tram')) {
        for (const side of [1, -1]) band(out.transit, net, w, side * GAUGE_M * 0.5 * S, 0.09 * S, detailLift, tramCol);
      }
    }
  }

  out.counts = {
    sidewalks: out.sidewalks.index.length / 3,
    kerbs: out.kerbs.index.length / 3,
    islands: out.islands.index.length / 3,
    transit: out.transit.index.length / 3,
  };
  return out;
}

// a kerb face that follows the surface: bottom at the carriageway, top a kerb up
function kerbBand(T, net, w, roadHalf, lift, kerbH, col) {
  const { X, Z, HID } = net;
  for (let i = w.start; i < w.start + w.n - 1; i++) {
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
    const lx = dz;
    const lz = -dx;
    for (const side of [1, -1]) {
      const off = side * (roadHalf + 0.05 * net.S);
      const n = [side * lx, 0, side * lz];
      const yb0 = net.surfaceY(i, side * roadHalf) + lift;
      const yb1 = net.surfaceY(i + 1, side * roadHalf) + lift;
      const yt0 = net.surfaceY(i, off) + lift + kerbH;
      const yt1 = net.surfaceY(i + 1, off) + lift + kerbH;
      const a = [ax + lx * off, yb0, az + lz * off];
      const b = [bx + lx * off, yb1, bz + lz * off];
      const c = [bx + lx * off, yt1, bz + lz * off];
      const d = [ax + lx * off, yt0, az + lz * off];
      quad(T, a, b, c, d, col, n);
    }
  }
}

// central island: the ring shrunk toward its centre, filled as a fan, with a
// kerb rim down to the surface
function fillIsland(T, K, net, ring, lift, kerbH, col, kerbCol) {
  const { X } = net;
  const pts = ring.pts;
  const inset = (ring.halfM + 0.8) * net.S;
  const n = pts.length;
  const px = [];
  const pz = [];
  let cx = 0;
  let cz = 0;
  for (const i of pts) {
    const dx = X[i] - ring.cx;
    const dz = net.Z[i] - ring.cz;
    const r = Math.hypot(dx, dz);
    const k = r > inset ? (r - inset) / r : 0;
    const x = ring.cx + dx * k;
    const z = ring.cz + dz * k;
    px.push(x);
    pz.push(z);
    cx += x;
    cz += z;
  }
  cx /= n;
  cz /= n;
  const cy = net.heightAt(cx, cz) + lift + 0.05;
  const v0 = T.position.length / 3;
  vert(T, [cx, cy, cz], col, [0, 1, 0]);
  for (let k = 0; k < n; k++) vert(T, [px[k], cy, pz[k]], col, [0, 1, 0]);
  for (let k = 0; k < n; k++) {
    const a = v0 + 1 + k;
    const b = v0 + 1 + ((k + 1) % n);
    T.index.push(v0, b, a);
  }
  // kerb rim (vertical faces around the island)
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    const ax = px[k];
    const az = pz[k];
    const bx = px[j];
    const bz = pz[j];
    let dx = bx - ax;
    let dz = bz - az;
    const L = Math.hypot(dx, dz) || 1;
    dx /= L;
    dz /= L;
    const ox = dz;
    const oz = -dx; // outward (ring runs one way round; both faces drawn)
    const yb = cy - kerbH;
    quad(K, [ax, yb, az], [bx, yb, bz], [bx, cy, bz], [ax, cy, az], kerbCol, [ox, 0, oz]);
    quad(K, [bx, yb, bz], [ax, yb, az], [ax, cy, az], [bx, cy, bz], kerbCol, [-ox, 0, -oz]);
  }
}

// splitter islands: a small triangle at every arm that meets a ring, pointing
// inward, between the entering and leaving carriageways
function splitterIslands(T, net, ring, lift, col) {
  const { X, Z, nodeWays } = net;
  const isRound = (w) => w.t.jn === 'roundabout' || w.t.jn === 'circular';
  for (const wi of ring.ways || []) {
    const w = net.ways[wi];
    const end = w.start + w.n - 1;
    for (let k = 0; k < w.jp.length; k += 2) {
      const gp = w.jp[k];
      const node = w.jp[k + 1];
      const nw = nodeWays[node] || [];
      let arm = false;
      for (let m = 0; m < nw.length && !arm; m += 2) {
        const o = net.ways[nw[m]];
        if (o !== w && !isRound(o) && o.car) arm = true;
      }
      if (!arm) continue;
      if (gp <= w.start || gp >= end) continue;
      let dx = ring.cx - X[gp];
      let dz = ring.cz - Z[gp];
      const L = Math.hypot(dx, dz) || 1;
      dx /= L;
      dz /= L; // inward
      const tx = -dz;
      const tz = dx;
      const y = net.Y[gp] + lift + 0.05;
      const P = [X[gp], y, Z[gp]];
      const w0 = 1.3 * net.S;
      const in0 = 1.8 * net.S;
      tri(T, [P[0] + tx * w0, y, P[2] + tz * w0], [P[0] - tx * w0, y, P[2] - tz * w0], [P[0] + dx * in0, y, P[2] + dz * in0], col);
    }
  }
}
