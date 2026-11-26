// The street ground (porto-041): in the old centre the ground follows the
// streets, and the streets follow the ground.
//
// The DEM under Porto is a 12 m lattice of a 25-30 m survey. On the steep
// slopes of the Sé hill, the Barredo and the Luís I bridge foot it stood over
// the edge of a street (ground through the paving), fell away under the other
// edge (paving in the air), and a raised approach ramp stood on a grass
// embankment. Every layer read the same heightAt, but each fitted it its own
// way: the ribbons level across with a bounded cross fall, the sidewalks at
// their own offset, the props and the walker on the raw ground.
//
// Here the ground takes the streets' own profile. From the road network built
// on the plain ground (road-network.js: each way's smoothed centreline Y,
// the ramps lifted to the bridge decks) a raster of a target height T and a
// weight W is made over the district (cities/<id>.json street_ground):
//   - under a drawn street and its sidewalks: T = the way's Y, level across
//     (the ribbons stand RIBBON_LIFT over it, as everywhere);
//   - a margin beyond the paving (the frontage, MARGIN_M): T = Y + lift, so
//     the ground meets the paving's top and no slab edge shows;
//   - a footway or stair (not drawn as a ribbon in the core): the ground is the
//     path, T = Y over its width;
//   - inside a pedestrian square (road-network.js plazaRings): the ring's
//     surface, interpolated inward;
//   - two pavings over each other in plan, more than STACK_M apart: the
//     upper one keeps its ground; then SMOOTH_PASSES 3 x 3 means over the
//     core cells turn the creases where ways meet into slopes;
//   - beyond: back to the plain ground over a feather that widens with the
//     height step (1 : BATTER, FALL_MIN_M .. FALL_MAX_M), so a cut or a fill
//     is a slope, not a cliff.
// W is 0 inside the flat part of a pad (a landmark's site, a quay terrace)
// and fades to 0 at the district's edge, so the ground outside is unchanged.
// terrain.js applies it as the last step of heightAt: base + W (T - base).
// The network is then built again on the new ground (road-network.js
// setStreetDrape drops the memoised one): its ways drape on this ground, so
// the ramps need no embankment and every layer that reads heightAt agrees
// with the drawn paving.
//
// DOM-free: node tests import it.

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export const CELL_M = 2; // raster cell
export const MARGIN_M = 1.5; // frontage beyond the paving at the paving's top
export const FALL_MIN_M = 5;
export const FALL_MAX_M = 24;
export const BATTER = 1.6; // feather run per metre of height step
export const EDGE_M = 40; // fade to the plain ground at the district's edge
export const STACK_M = 0.5; // two pavings further apart than this: the upper one wins
export const SMOOTH_PASSES = 3; // 3 x 3 means over the core cells (2 m): creases become slopes

// net: road-network.js buildNetwork on the plain ground.
// district: { x0, x1, z0, z1 } world units (terrain.district).
// opts:
//   baseAt(x, z)     the plain ground (terrain.baseAt), world units
//   padInside(x, z)  true inside a pad's flat part (terrain.padInside)
//   S                world units per metre
//   lift             the ribbons' lift over the way's surface (roads.js RIBBON_LIFT)
//   pavedHalf(w)     half width of the drawn paving of way w (world units), 0
//                    when the way draws no ribbon (a footway in the core)
//   plazas           road-network.js plazaRings: the squares paved inside
export function buildStreetGround(net, district, { baseAt, padInside = () => false, S = 0.25, lift = 0, pavedHalf, plazas = [] }) {
  const cell = CELL_M * S;
  const x0 = district.x0;
  const z0 = district.z0;
  const nx = Math.max(2, Math.ceil((district.x1 - x0) / cell) + 1);
  const nz = Math.max(2, Math.ceil((district.z1 - z0) / cell) + 1);
  const N = nx * nz;
  // per cell: the best core so far (rank: 3 under paving, 2 its margin, 1 a
  // footway; then the nearest centreline), and the feather sums
  const coreRank = new Uint8Array(N);
  const coreD = new Float32Array(N).fill(Infinity);
  const coreT = new Float32Array(N);
  const sumK = new Float32Array(N);
  const sumKT = new Float32Array(N);
  const maxW = new Float32Array(N);
  const base = new Float32Array(N).fill(NaN);
  const baseOf = (k, x, z) => {
    let h = base[k];
    if (h !== h) h = base[k] = baseAt(x, z);
    return h;
  };
  const { X, Z, Y, HID } = net;
  const margin = MARGIN_M * S;
  const fallMax = FALL_MAX_M * S;
  const fallMin = FALL_MIN_M * S;
  const eps = 0.25 * S;
  let ways = 0;
  for (const w of net.ways) {
    if (w.tunnel || w.bridge) continue;
    if (w.kind === 'water') continue;
    const end = w.start + w.n - 1;
    // a way that does not reach the district
    let inside = false;
    for (let i = w.start; i <= end && !inside; i++) {
      if (X[i] > district.x0 - fallMax && X[i] < district.x1 + fallMax && Z[i] > district.z0 - fallMax && Z[i] < district.z1 + fallMax) inside = true;
    }
    if (!inside) continue;
    ways++;
    const paved = pavedHalf(w);
    // the path's own width when nothing is drawn (the ground is the path)
    const core = paved > 0 ? paved + margin : Math.max(0.75 * S, (w.widthM / 2) * S);
    const reach = core + fallMax;
    for (let i = w.start; i < end; i++) {
      if (HID[i] || HID[i + 1]) continue;
      const ax = X[i];
      const az = Z[i];
      const dx = X[i + 1] - ax;
      const dz = Z[i + 1] - az;
      const L2 = dx * dx + dz * dz;
      if (L2 < 1e-10) continue;
      const c0 = Math.max(0, Math.floor((Math.min(ax, ax + dx) - reach - x0) / cell));
      const c1 = Math.min(nx - 1, Math.ceil((Math.max(ax, ax + dx) + reach - x0) / cell));
      const r0 = Math.max(0, Math.floor((Math.min(az, az + dz) - reach - z0) / cell));
      const r1 = Math.min(nz - 1, Math.ceil((Math.max(az, az + dz) + reach - z0) / cell));
      for (let r = r0; r <= r1; r++) {
        const z = z0 + r * cell;
        for (let c = c0; c <= c1; c++) {
          const x = x0 + c * cell;
          let u = ((x - ax) * dx + (z - az) * dz) / L2;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const px = ax + dx * u - x;
          const pz = az + dz * u - z;
          const dist = Math.sqrt(px * px + pz * pz);
          if (dist >= reach) continue;
          const k = r * nx + c;
          const yc = Y[i] + (Y[i + 1] - Y[i]) * u;
          if (dist <= core) {
            // under the paving the ground is the way's surface; the margin
            // meets the paving's top
            const under = paved > 0 && dist <= paved;
            const rank = under ? 3 : paved > 0 ? 2 : 1;
            const t = paved > 0 && !under ? yc + lift : yc;
            // two drawn streets over each other in plan (a road climbing past
            // a square on its wall): the upper one keeps its ground, so no
            // paving hangs in the air; the lower one runs into the bank
            const cur = coreRank[k];
            const over = rank === 3 && cur === 3 && Math.abs(t - coreT[k]) > STACK_M * S;
            if (over ? t > coreT[k] : rank > cur || (rank === cur && dist < coreD[k])) {
              coreRank[k] = rank;
              coreD[k] = dist;
              coreT[k] = t;
            }
            continue;
          }
          // the feather: back to the plain ground, wider for a bigger step
          const t = paved > 0 ? yc + lift : yc;
          const step = Math.abs(t - baseOf(k, x, z));
          const fall = Math.min(fallMax, Math.max(fallMin, BATTER * step));
          const d = dist - core;
          if (d >= fall) continue;
          const wgt = 1 - smooth(d / fall);
          const kk = wgt / ((d + eps) * (d + eps));
          sumK[k] += kk;
          sumKT[k] += kk * t;
          if (wgt > maxW[k]) maxW[k] = wgt;
        }
      }
    }
  }
  // the pedestrian squares (road-network.js plazaRings): paved inside, the
  // ground there the ring's surface, interpolated inward (inverse distance)
  for (const p of plazas) {
    const ring = p.ring;
    let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (const i of ring) {
      bx0 = Math.min(bx0, X[i]);
      bx1 = Math.max(bx1, X[i]);
      bz0 = Math.min(bz0, Z[i]);
      bz1 = Math.max(bz1, Z[i]);
    }
    const sub = ring.filter((_, k) => k % Math.max(1, Math.floor(ring.length / 96)) === 0);
    const c0 = Math.max(0, Math.floor((bx0 - x0) / cell));
    const c1 = Math.min(nx - 1, Math.ceil((bx1 - x0) / cell));
    const r0 = Math.max(0, Math.floor((bz0 - z0) / cell));
    const r1 = Math.min(nz - 1, Math.ceil((bz1 - z0) / cell));
    for (let r = r0; r <= r1; r++) {
      const z = z0 + r * cell;
      for (let c = c0; c <= c1; c++) {
        const k = r * nx + c;
        if (coreRank[k] === 3) continue; // a ribbon's own paving
        const x = x0 + c * cell;
        let inside = false;
        for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
          const ia = ring[a], ib = ring[b];
          if (Z[ia] > z !== Z[ib] > z && x < ((X[ib] - X[ia]) * (z - Z[ia])) / (Z[ib] - Z[ia]) + X[ia]) inside = !inside;
        }
        if (!inside) continue;
        let sw = 0;
        let sy = 0;
        // (power 4: the ring's own height near the edge, a blend in the middle)
        for (const i of sub) {
          const d2 = (X[i] - x) ** 2 + (Z[i] - z) ** 2 + 1e-4;
          const q = 1 / (d2 * d2);
          sw += q;
          sy += q * Y[i];
        }
        coreRank[k] = 3;
        coreD[k] = 0;
        coreT[k] = sy / sw;
      }
    }
  }
  // Where ways meet at different heights (a bridge foot where five streets
  // and a square cross on a 50 % slope) the cores join in creases that a
  // draped ribbon folds over. A few passes of a 3 x 3 mean over the core
  // cells turn the creases into slopes (a core cell next to no core keeps
  // its value: the edge of a street stays where it is).
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    const next = Float32Array.from(coreT);
    for (let r = 1; r < nz - 1; r++) {
      for (let c = 1; c < nx - 1; c++) {
        const k = r * nx + c;
        if (!coreRank[k]) continue;
        let s = 0;
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const q = k + dr * nx + dc;
            if (coreRank[q]) {
              s += coreT[q];
              n++;
            }
          }
        }
        if (n === 9) next[k] = s / 9;
      }
    }
    coreT.set(next);
  }
  const T = new Float32Array(N);
  const W = new Float32Array(N);
  const edge = EDGE_M * S;
  let cells = 0;
  for (let r = 0; r < nz; r++) {
    const z = z0 + r * cell;
    for (let c = 0; c < nx; c++) {
      const k = r * nx + c;
      let t;
      let wgt;
      if (coreRank[k]) {
        t = coreT[k];
        wgt = 1;
      } else if (maxW[k] > 0) {
        t = sumKT[k] / sumK[k];
        wgt = maxW[k];
      } else continue;
      const x = x0 + c * cell;
      // the district's edge: back to the plain ground
      const de = Math.min(x - district.x0, district.x1 - x, z - district.z0, district.z1 - z);
      wgt *= smooth(de / edge);
      if (wgt <= 0) continue;
      if (padInside(x, z)) continue;
      T[k] = t;
      W[k] = wgt;
      cells++;
    }
  }
  return { x0, z0, cell, nx, nz, T, W, stats: { ways, cells, of: N } };
}
