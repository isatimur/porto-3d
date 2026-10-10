// Real terrain from data/terrain.json (EU-DEM 25 m via OpenTopoData,
// resampled to a regular lat/lon grid, rows south to north). DOM-free, so
// node scripts can import it.
//
// heightAt(x, z) is the one height function of the scene: world units,
// 0 at the terrain height of the projection origin (the city centre).
// It samples the grid bilinearly, then applies "pads": flat or profiled
// patches under landmarks, so a stadium cut into a hillside or a church on
// a terrace stands on level ground instead of sinking into the DEM slope.
// Roads, routes, buildings and landmarks all read this same function.

export const VERTICAL_EXAGGERATION = 1.0;

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// ------------------------------------------------------------ relief
// The DEM is a broad, smooth lattice: at 1:1 it reads as gentle ramps and
// the Douro gorge, the Serra do Pilar shoulders, the Sé hill and the Foz
// cliffs lose their bite. Baked once here, cheaply, on the grid itself:
//   - a local high-pass (raw minus a ~550 m box blur) boosts landforms no
//     wider than about a kilometre, so hills and the gorge crisp up while
//     the regional slope and the datum are untouched;
//   - a second, tighter high-pass (~220 m) sharpens the knee where a gorge
//     bank, the Gaia slope or a Foz cliff turns over; its gain rises with
//     the local slope, so flat ground is left alone and the steep banks
//     bite harder;
//   - named summits (Sé, Serra do Pilar, the Gaia upland) add a little
//     broad gain, so the rounded tops read as hills rather than ramps;
//   - a positive-only ridged noise raises granite outcrops and boulders on
//     the Gaia hillside and the rocky Foz / Matosinhos / Leça coast;
//   - a dune berm shapes the beach/dune transition behind each ocean beach.
// Every added term is non-negative, so ridges rise while hollows, the
// riverbed and the coast keep their raw height (water.js reads heightAt).
// The raw heights are kept and re-exported for the streamed tiles, so
// tile-worker rebuilds exactly the same enhanced grid and nothing seams.
const RELIEF_GAIN = 0.34; // broad high-pass, about 550 m
const RELIEF_BLUR_R = 5; // cells
const FINE_BLUR_R = 2; // cells, about 220 m
const FINE_GAIN = 0.22;
const SLOPE_LO = 0.09; // m/m where the tight gain starts to bite
const SLOPE_HI = 0.34;
const SLOPE_BOOST = 1.2;
// Soft ceiling on the high-pass, so the city hills sharpen but the distant
// 300 m ridges are not pumped up past their real height.
const RELIEF_CAP = 24; // m
const relief = (v) => (v <= 0 ? 0 : (v * RELIEF_CAP) / (v + RELIEF_CAP));
const ROCK_MIN_H = 6; // m: never raise the riverbed or the shore
const ROCK_A = 6.0; // m of outcrop relief
const DUNE_A = 3.4; // m of dune berm
const MICRO_M = 1.1; // metres of fine relief
const EDGE_FADE = 8; // cells: no enhancement within this many cells of the rim

const hash2 = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// Smooth deterministic value noise; the outcrop lobes are built from it.
function vnoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

// Ridged fbm, roughly 0..1 with crests on the ridges: rock lines, not blobs.
function ridgeFbm(x, y) {
  let n = 0;
  let amp = 0.6;
  let f = 1;
  for (let o = 0; o < 2; o++) {
    n += amp * (1 - Math.abs(2 * vnoise(x * f + o * 13.7, y * f - o * 7.1) - 1));
    amp *= 0.5;
    f *= 2.03;
  }
  return n;
}

// Smooth falloff weight for a named region, 1 at the centre, 0 at the rim.
const regionW = (mx, mz, r) => {
  const d = Math.hypot(mx - r.x, mz - r.z);
  return d >= r.r ? 0 : 1 - smooth(d / r.r);
};

// Separable box blur of the grid, clamped at the edges; one channel.
function blurGrid(H, cols, rows, R) {
  const tmp = new Float32Array(H.length);
  const k = 1 / (2 * R + 1);
  for (let r = 0; r < rows; r++) {
    const o = r * cols;
    let s = 0;
    for (let x = -R; x <= R; x++) s += H[o + Math.min(cols - 1, Math.max(0, x))];
    for (let c = 0; c < cols; c++) {
      tmp[o + c] = s * k;
      s += H[o + Math.min(cols - 1, c + R + 1)] - H[o + Math.max(0, c - R)];
    }
  }
  const out = new Float32Array(H.length);
  for (let c = 0; c < cols; c++) {
    let s = 0;
    for (let y = -R; y <= R; y++) s += tmp[Math.min(rows - 1, Math.max(0, y)) * cols + c];
    for (let r = 0; r < rows; r++) {
      out[r * cols + c] = s * k;
      s += tmp[Math.min(rows - 1, r + R + 1) * cols + c] - tmp[Math.max(0, r - R) * cols + c];
    }
  }
  return out;
}

function enhanceGrid(H, cols, rows, frame) {
  const s0 = blurGrid(H, cols, rows, RELIEF_BLUR_R);
  const s1 = blurGrid(H, cols, rows, FINE_BLUR_R);
  const G = new Float32Array(H.length);
  const dx = frame ? (frame.x1 - frame.x0) / Math.max(1, cols - 1) : 1;
  const dz = frame ? (frame.zN - frame.zS) / Math.max(1, rows - 1) : 1;
  const at = (c, r) => H[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const edge = Math.min(c, cols - 1 - c, r, rows - 1 - r);
      const ef = smooth(Math.min(1, Math.max(0, (edge - 2) / EDGE_FADE)));
      const mx = frame ? frame.x0 + dx * c : c;
      const mz = frame ? frame.zS + dz * r : r;

      // local slope, from the raw grid; steep banks get the tight boost
      const gx = (at(c + 1, r) - at(c - 1, r)) / (2 * dx);
      const gz = (at(c, r + 1) - at(c, r - 1)) / (2 * dz);
      const slope = Math.hypot(gx, gz);
      const steep = smooth(Math.min(1, Math.max(0, (slope - SLOPE_LO) / (SLOPE_HI - SLOPE_LO))));

      // broad high-pass, with a little extra on the named summits
      let gain = RELIEF_GAIN;
      if (frame) for (const s of frame.summits) gain += s.g * regionW(mx, mz, s);
      const hp = Math.max(0, H[i] - s0[i]) * gain;
      // tight high-pass: the knee of a gorge bank, the Gaia slope, a cliff
      const fine = Math.max(0, H[i] - s1[i]) * FINE_GAIN * (1 + SLOPE_BOOST * steep);

      // outcrops: positive ridged noise on the rocky shores (Gaia hillside,
      // Foz cliffs, the Matosinhos / Leça coast), kept off the riverbed and
      // the waterline by each region's own floor
      let rock = 0;
      if (frame) {
        let rw = 0;
        let minH = ROCK_MIN_H;
        for (const s of frame.rocks) {
          const w = regionW(mx, mz, s);
          if (w > rw) {
            rw = w;
            minH = s.minH ?? ROCK_MIN_H;
          }
        }
        if (rw > 0 && H[i] > minH) {
          const crest = ridgeFbm((c + 0.5) * 0.75, (r + 0.5) * 0.75);
          rock = ROCK_A * Math.pow(Math.max(0, crest - 0.42) / 0.58, 1.5) * rw * (0.3 + 0.7 * steep);
        }
      }
      // dune berm behind each beach, land only: a low crest on the Foz belt
      // and a taller one on the Matosinhos / Leça dunes
      let dune = 0;
      if (frame) {
        const land = smooth(Math.min(1, Math.max(0, (H[i] - 0.4) / 2.5)));
        if (land > 0) {
          let dw = 0;
          for (const d of frame.dunes) dw = Math.max(dw, regionW(mx, mz, d));
          if (dw > 0) {
            const bLo = (H[i] - 5) / 3.2;
            const bHi = (H[i] - 18) / 6.5;
            dune = DUNE_A * (Math.exp(-bLo * bLo) + 0.5 * Math.exp(-bHi * bHi)) * dw * land;
          }
        }
      }
      // the Leixões quays and the Leça mouth stay surveyed: suppress the
      // positive-only enhancement there so the flat quays and channel remain
      let flatW = 0;
      if (frame) for (const f of frame.flats) flatW = Math.max(flatW, regionW(mx, mz, f));
      // ridges and hilltops rise only: hollows, the riverbed and the coast
      // keep their raw height, so the water surface (water.js reads heightAt)
      // stays where the DEM put it.
      const micro = (hash2(c * 1.7, r * 2.3) - 0.5 + 0.5 * (hash2(c * 0.5 + 3, r * 0.5 - 2) - 0.5)) * 2 * MICRO_M;
      G[i] = H[i] + (relief(hp + fine) + rock + dune + micro) * ef * (1 - flatW);
    }
  }
  return G;
}

// data: parsed terrain.json or null (flat fallback).
// toMetres(lat, lon) -> {x, z} local metres (z = south); S: world units per metre.
export function createTerrain(data, toMetres, S, { exaggeration = VERTICAL_EXAGGERATION } = {}) {
  const ok = data && Array.isArray(data.heights) && data.cols > 1 && data.rows > 1 && data.heights.length === data.cols * data.rows;
  if (data && !ok) console.warn('[porto] terrain.json is malformed; using flat ground');

  const cols = ok ? data.cols : 2;
  const rows = ok ? data.rows : 2;
  const H = ok ? Float32Array.from(data.heights) : new Float32Array(4);
  // grid corners in metres: west/east x, south/north z (z grows to the south)
  const sw = ok ? toMetres(data.bbox.s, data.bbox.w) : { x: -1, z: 1 };
  const ne = ok ? toMetres(data.bbox.n, data.bbox.e) : { x: 1, z: -1 };
  const x0 = sw.x;
  const x1 = ne.x;
  const zS = sw.z;
  const zN = ne.z;
  // The named relief regions, in local metres. Kept here (not in the grid)
  // so the core and the streamed tiles resolve the same masks: tile-worker
  // rebuilds this grid from the raw heights and the same projection origin.
  const frame = ok
    ? (() => {
        const at = (lat, lon) => {
          const m = toMetres(lat, lon);
          return { x: m.x, z: m.z };
        };
        return {
          x0,
          x1,
          zS,
          zN,
          summits: [
            { ...at(41.1428, -8.6112), r: 620, g: 0.5 }, // Sé do Porto
            { ...at(41.1378, -8.6108), r: 520, g: 0.45 }, // Serra do Pilar
            { ...at(41.1258, -8.606), r: 950, g: 0.28 }, // Gaia upland
          ],
          // rocky shores: positive ridged outcrops, each with its own floor
          // so the Foz cliffs and the Matosinhos / Leça coast are carved
          // without touching the riverbed or the waterline
          rocks: [
            { ...at(41.13, -8.612), r: 1900, minH: 6 }, // Gaia hillside
            { ...at(41.157, -8.682), r: 1500, minH: 3.5 }, // Foz cliffs
            { ...at(41.184, -8.683), r: 2200, minH: 3.5 }, // Matosinhos dunes
            { ...at(41.196, -8.7), r: 2000, minH: 3.5 }, // Leça da Palmeira
          ],
          // dune belts behind each beach: a low crest at Foz, a taller one on
          // the Matosinhos / Leça dunes (land only, ridges rise)
          dunes: [
            { ...at(41.157, -8.682), r: 1500 }, // Foz dune belt
            { ...at(41.184, -8.683), r: 2200 }, // Matosinhos dune belt
            { ...at(41.196, -8.7), r: 2000 }, // Leça dune belt
          ],
          // kept flat: the Leixões quays and the Leça river mouth. The DEM is
          // already level there, so no relief is added and the surveyed quays
          // and channel stay put.
          flats: [
            { ...at(41.1855, -8.7035), r: 1200 }, // Porto de Leixões quays
            { ...at(41.188, -8.706), r: 700 }, // Leça river mouth
          ],
        };
      })()
    : null;
  // The elevation actually sampled: raw + relief high-pass + micro-relief
  // (see enhanceGrid). `H` stays raw and is re-exported for the tiles.
  const G = ok ? enhanceGrid(H, cols, rows, frame) : H;

  // Mean height of the border cells: outside the grid the ground eases
  // toward it, so the clamped edge profile does not run out as ridges.
  let rim = 0;
  let rimN = 0;
  for (let c = 0; c < cols; c++) {
    rim += H[c] + H[(rows - 1) * cols + c];
    rimN += 2;
  }
  for (let r = 0; r < rows; r++) {
    rim += H[r * cols] + H[r * cols + cols - 1];
    rimN += 2;
  }
  rim /= rimN;
  const RIM_FADE_M = 2000;

  // The fine core (data/terrain-fine.bin.gz, src/terrain-fine.js): a 12 m grid
  // over the core bbox plus a margin, read in place of the lattice above. Inside
  // it the surface is the fine grid; across the outer FINE_BLEND_M of its margin
  // it blends into the lattice, so the streamed ring (which has only the
  // lattice) meets it without a step. data.fine = { bbox, cols, rows, heights }.
  const fineSrc =
    ok && data.fine && data.fine.cols > 1 && data.fine.rows > 1 && data.fine.heights?.length === data.fine.cols * data.fine.rows
      ? data.fine
      : null;
  const FH = fineSrc ? (fineSrc.heights instanceof Float32Array ? fineSrc.heights : Float32Array.from(fineSrc.heights)) : null;
  const fsw = fineSrc ? toMetres(fineSrc.bbox.s, fineSrc.bbox.w) : null;
  const fne = fineSrc ? toMetres(fineSrc.bbox.n, fineSrc.bbox.e) : null;
  const fx0 = fsw ? fsw.x : 0;
  const fx1 = fne ? fne.x : 0;
  const fzS = fsw ? fsw.z : 0;
  const fzN = fne ? fne.z : 0;
  const FINE_BLEND_M = 360;
  function fineMetres(mx, mz) {
    const fcols = fineSrc.cols;
    const frows = fineSrc.rows;
    let fc = ((mx - fx0) / (fx1 - fx0)) * (fcols - 1);
    let fr = ((fzS - mz) / (fzS - fzN)) * (frows - 1);
    fc = fc < 0 ? 0 : fc > fcols - 1 ? fcols - 1 : fc;
    fr = fr < 0 ? 0 : fr > frows - 1 ? frows - 1 : fr;
    const c0 = Math.min(fcols - 2, Math.floor(fc));
    const r0 = Math.min(frows - 2, Math.floor(fr));
    const tc = fc - c0;
    const tr = fr - r0;
    const i = r0 * fcols + c0;
    const a = FH[i] + (FH[i + 1] - FH[i]) * tc;
    const b = FH[i + fcols] + (FH[i + fcols + 1] - FH[i + fcols]) * tc;
    return a + (b - a) * tr;
  }

  // Raw ground height in metres above sea level, at local metres: the fine
  // core where it exists, else the lattice (coarseMetres).
  function rawMetres(mx, mz) {
    if (fineSrc) {
      const d = Math.min(mx - fx0, fx1 - mx, mz - fzN, fzS - mz);
      if (d >= FINE_BLEND_M) return fineMetres(mx, mz);
      if (d > 0) {
        const w = smooth(d / FINE_BLEND_M);
        const c = coarseMetres(mx, mz);
        return c + (fineMetres(mx, mz) - c) * w;
      }
    }
    return coarseMetres(mx, mz);
  }

  // The lattice height (EU-DEM, enhanced). Outside the grid there is no data:
  // the edge profile is averaged over a window that widens with the distance
  // (no ridges running out from the edge), then eases toward the rim mean.
  function coarseMetres(mx, mz) {
    const ox = mx < x0 ? x0 - mx : mx > x1 ? mx - x1 : 0;
    const oz = mz > zS ? mz - zS : mz < zN ? zN - mz : 0;
    if (!ox && !oz) return gridMetres(mx, mz);
    const d = Math.hypot(ox, oz);
    const cx = mx < x0 ? x0 : mx > x1 ? x1 : mx;
    const cz = mz > zS ? zS : mz < zN ? zN : mz;
    const w = d * 0.8;
    let h = 0;
    for (let k = -2; k <= 2; k++) {
      // spread along the edge the point lies beyond (both for corners)
      h += gridMetres(ox ? cx : cx + (k * w) / 2, oz ? cz : cz + (k * w) / 2);
    }
    h /= 5;
    return h + (rim - h) * smooth(d / RIM_FADE_M);
  }

  function gridMetres(mx, mz) {
    let fc = ((mx - x0) / (x1 - x0)) * (cols - 1);
    let fr = ((zS - mz) / (zS - zN)) * (rows - 1);
    fc = fc < 0 ? 0 : fc > cols - 1 ? cols - 1 : fc;
    fr = fr < 0 ? 0 : fr > rows - 1 ? rows - 1 : fr;
    const c0 = Math.min(cols - 2, Math.floor(fc));
    const r0 = Math.min(rows - 2, Math.floor(fr));
    const tc = fc - c0;
    const tr = fr - r0;
    const i = r0 * cols + c0;
    const a = G[i] + (G[i + 1] - G[i]) * tc;
    const b = G[i + cols] + (G[i + cols + 1] - G[i + cols]) * tc;
    return a + (b - a) * tr;
  }

  // Datum: the DEM height at the origin becomes y = 0.
  // Always taken from the lattice, so it is the same number with or without
  // the fine core: models, fits and bridge decks keep their heights.
  const datum = ok ? coarseMetres(0, 0) : 0;
  const k = S * exaggeration;

  // Raw world height, no pads.
  const rawAt = (x, z) => (rawMetres(x / S, z / S) - datum) * k;

  // Pads, in world units. Each: centre (cx, cz), unit long axis (ux, uz),
  // half extents (hu along, hv across), falloff distance, and either a
  // constant height `y` or a profile `yAt(u, v, x, z)` in local pad coords.
  const pads = [];
  // Optional pad fields (src/fit.js padFor sets them):
  //   cutMax  most ground a pad may take away, world units (Infinity: a site
  //           that is levelled, a stadium; default Infinity). A building on a
  //           slope takes a small cut and stands partly in the hill, as real
  //           buildings do, instead of sitting in a pit with ramps round it.
  //   batter  the fill or cut face is never steeper than 1 : batter (the
  //           feather widens with the height step, up to fallMax), so a step
  //           of 12 m is a long slope, not a cliff or a floating shelf.
  //   fallMax the widest feather the batter may use (default: fall).
  //   fillMax most ground a pad may add, world units (default unlimited). Where
  //           the pad plane stands higher than the ground it may build, the rest
  //           is a retaining wall (src/pad-walls.js) under the pad's edge.
  function addPad(p) {
    const fallMax = Math.max(p.fall, p.fallMax ?? p.fall);
    const pad = { ...p, fallMax, r: Math.hypot(p.hu, p.hv) + fallMax };
    pads.push(pad);
    return pad;
  }
  // A cut up to 70 % of the limit is taken whole; beyond that it saturates
  // smoothly towards the limit (no kink, so no crease in the ground).
  const softCut = (d, L) => {
    const a = 0.7 * L;
    return d <= a ? d : a + (L - a) * Math.tanh((d - a) / (L - a));
  };

  // heightAt runs hundreds of thousands of times at load (every building,
  // road and tree vertex) and every frame (traffic, people, camera). It used
  // to test all ~70 pads on each call. A coarse grid now lists, per cell, the
  // pads whose bounding square touches it, in pad order, so the result is
  // bit-for-bit the same as the full scan (a pad left out of a cell would have
  // failed the radius test there). Rebuilt lazily when pads are added.
  const PAD_CELL = 48; // world units (192 m)
  let padCells = null;
  let padCount = -1;
  const padKey = (ix, iz) => (ix + 2048) * 4096 + (iz + 2048);
  function buildPadCells() {
    padCells = new Map();
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      const x0 = Math.floor((p.cx - p.r) / PAD_CELL);
      const x1 = Math.floor((p.cx + p.r) / PAD_CELL);
      const z0 = Math.floor((p.cz - p.r) / PAD_CELL);
      const z1 = Math.floor((p.cz + p.r) / PAD_CELL);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iz = z0; iz <= z1; iz++) {
          const k = padKey(ix, iz);
          const list = padCells.get(k);
          if (list) list.push(i);
          else padCells.set(k, [i]);
        }
      }
    }
    padCount = pads.length;
  }

  function heightAt(x, z) {
    let h = rawAt(x, z);
    if (padCount !== pads.length) buildPadCells();
    const list = padCells.get(padKey(Math.floor(x / PAD_CELL), Math.floor(z / PAD_CELL)));
    if (!list) return h;
    for (let j = 0; j < list.length; j++) {
      const p = pads[list[j]];
      const dx = x - p.cx;
      const dz = z - p.cz;
      if (dx * dx + dz * dz > p.r * p.r) continue;
      const u = dx * p.ux + dz * p.uz;
      const v = -dx * p.uz + dz * p.ux;
      const ou = Math.abs(u) - p.hu;
      const ov = Math.abs(v) - p.hv;
      const d = Math.hypot(ou > 0 ? ou : 0, ov > 0 ? ov : 0);
      if (d >= p.fallMax) continue;
      const target = p.yAt ? p.yAt(u, v, x, z) : p.y;
      let step = target - h; // > 0 fill, < 0 cut
      if (step < 0) {
        if (p.cutMax !== undefined && -step > 0.7 * p.cutMax) step = -softCut(-step, p.cutMax);
      } else if (step > 0) {
        if (p.fillMax !== undefined && step > 0.7 * p.fillMax) step = softCut(step, p.fillMax);
        // a pad never fills the river, the shore or a beach: ground under 1.5 m
        // above sea level is left alone, eased in up to 5 m (a garden terrace
        // used to push a spur 80 m high into the Douro)
        const e = h / k + datum;
        if (e < 5) step *= e <= 1.5 ? 0 : smooth((e - 1.5) / 3.5);
      }
      // the feather widens with the step: face no steeper than 1 : batter
      let fall = p.fall;
      if (p.batter) {
        const f = p.batter * Math.abs(step);
        fall = f < p.fall ? p.fall : f > p.fallMax ? p.fallMax : f;
      }
      if (d >= fall) continue;
      h += step * (1 - smooth(d / fall));
    }
    return h;
  }

  // Terrain extent in world units, for the ground mesh, the haze wall and
  // the fly-mode walls. The grid now reaches past the core to the streamed
  // tiles (data/tiles); `core` is the original 90 x 60 grid inside it: the
  // area of roads.json, buildings.json and nature.json. With an old core-only
  // file `core` equals `bounds`.
  const bounds = { x0: x0 * S, x1: x1 * S, zN: zN * S, zS: zS * S, cols, rows };
  let core = bounds;
  if (ok && data.core?.bbox) {
    const c = data.core;
    const csw = toMetres(c.bbox.s, c.bbox.w);
    const cne = toMetres(c.bbox.n, c.bbox.e);
    core = { x0: csw.x * S, x1: cne.x * S, zN: cne.z * S, zS: csw.z * S, cols: c.cols, rows: c.rows, c0: c.c0, r0: c.r0 };
  }

  // The fine core in world units: the lattice of the ground mesh (scene.js
  // groundAxes) is the data's own 12 m grid inside it. null without the file.
  const fine = fineSrc
    ? { x0: fx0 * S, x1: fx1 * S, zN: fzN * S, zS: fzS * S, cols: fineSrc.cols, rows: fineSrc.rows, blend: FINE_BLEND_M * S }
    : null;

  return {
    ok,
    heightAt,
    rawAt,
    rawMetres,
    addPad,
    pads,
    bounds,
    core,
    fine,
    // the raw grid, for the tile worker (src/tile-worker.js), which drapes
    // the streamed tiles on the same ground; `fine` rides along so that the
    // workers rebuild the very same height function
    grid: ok ? { bbox: data.bbox, cols, rows, heights: H, core: data.core || null, fine: fineSrc ? { bbox: fineSrc.bbox, cols: fineSrc.cols, rows: fineSrc.rows, heights: FH } : null } : null,
    datum,
    // metres above sea level at a world point (with pads)
    elevationAt: (x, z) => heightAt(x, z) / k + datum,
    minM: ok ? data.min_m : 0,
    maxM: ok ? data.max_m : 0,
    source: ok ? data.source : 'flat',
  };
}
