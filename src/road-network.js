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

export const LANE_M = 3; // nominal lane width (m)
const MAX_STEP = 3; // world units between points
const ROAD_TUNNELS = new Set(['yes', 'avalanche_protector', 'flooded']);

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
        const n = Math.max(1, Math.ceil(L / MAX_STEP));
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
    const roadTunnel = !!tu && ROAD_TUNNELS.has(tu) && f.kind !== 'water';
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
      tunnel: roadTunnel,
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
      const s = (heightAt(PX[i] + lx * d, PZ[i] + lz * d) - heightAt(PX[i] - lx * d, PZ[i] - lz * d)) / (2 * d);
      SL[i] = Math.max(-0.6, Math.min(0.6, s));
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
      portals.push({ way: wi, x: PX[i], z: PZ[i], y: Y[i], dx, dz, widthM: w.widthM, name: w.t.name || '', clear });
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
    // the surface at point i, `left` world units left of the way's direction:
    // the way's height, or the hillside where it rises above it
    surfaceY(i, left) {
      const h = G[i] + SL[i] * left;
      return h > Y[i] ? h : Y[i];
    },
    nNodes,
    nodeWays,
    bridges,
    tunnels,
    portals,
    hiddenFeature,
    endNode,
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
// opts: { N, rnd, blocked(x, z) -> bool, speedK(i) -> factor, lorryShare(way) }
export const VEHICLE = { car: 0, van: 1, lorry: 2 };
const LEN_M = [4.4, 5.2, 13];
export function createFlow(net, { N = 600, rnd = Math.random, blocked = null } = {}) {
  const g = net.graph;
  const { ways, X, Z, Y, C, CAP, HID, S } = net;
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
    dOk[d] = blocked && !w.tunnel && blocked(X[m], Z[m]) ? 0 : 1;
    dSpawn[d] = dOk[d] ? g.len[d] * (w.cls.spawn || 0) : 0;
  }
  if (blocked) for (let d = 0; d < nD; d++) if (!dOk[d]) dTurn[d] = 0;

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
