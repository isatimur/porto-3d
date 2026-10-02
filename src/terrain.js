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
//   - a little deterministic noise breaks the glassy bilinear surface.
// The raw heights are kept and re-exported for the streamed tiles, so
// tile-worker rebuilds exactly the same enhanced grid and nothing seams.
const RELIEF_GAIN = 0.25;
const RELIEF_BLUR_R = 5; // cells, about 550 m
const MICRO_M = 1.1; // metres of fine relief
const EDGE_FADE = 8; // cells: no enhancement within this many cells of the rim

const hash2 = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
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

function enhanceGrid(H, cols, rows) {
  const s0 = blurGrid(H, cols, rows, RELIEF_BLUR_R);
  const G = new Float32Array(H.length);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const edge = Math.min(c, cols - 1 - c, r, rows - 1 - r);
      const ef = smooth(Math.min(1, Math.max(0, (edge - 2) / EDGE_FADE)));
      // ridges and hilltops rise only: hollows, the riverbed and the coast
      // keep their raw height, so the water surface (water.js reads heightAt)
      // stays where the DEM put it.
      const hp = Math.max(0, H[i] - s0[i]) * RELIEF_GAIN * ef;
      const micro = (hash2(c * 1.7, r * 2.3) - 0.5 + 0.5 * (hash2(c * 0.5 + 3, r * 0.5 - 2) - 0.5)) * 2 * MICRO_M * ef;
      G[i] = H[i] + hp + micro;
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
  // The elevation actually sampled: raw + relief high-pass + micro-relief
  // (see enhanceGrid). `H` stays raw and is re-exported for the tiles.
  const G = ok ? enhanceGrid(H, cols, rows) : H;
  // grid corners in metres: west/east x, south/north z (z grows to the south)
  const sw = ok ? toMetres(data.bbox.s, data.bbox.w) : { x: -1, z: 1 };
  const ne = ok ? toMetres(data.bbox.n, data.bbox.e) : { x: 1, z: -1 };
  const x0 = sw.x;
  const x1 = ne.x;
  const zS = sw.z;
  const zN = ne.z;

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

  // Raw DEM height in metres above sea level, at local metres. Outside the
  // grid there is no data: the edge profile is averaged over a window that
  // widens with the distance (no ridges running out from the edge), then
  // eases toward the rim mean.
  function rawMetres(mx, mz) {
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
  const datum = ok ? rawMetres(0, 0) : 0;
  const k = S * exaggeration;

  // Raw world height, no pads.
  const rawAt = (x, z) => (rawMetres(x / S, z / S) - datum) * k;

  // Pads, in world units. Each: centre (cx, cz), unit long axis (ux, uz),
  // half extents (hu along, hv across), falloff distance, and either a
  // constant height `y` or a profile `yAt(u, v, x, z)` in local pad coords.
  const pads = [];
  function addPad(p) {
    const pad = { ...p, r: Math.hypot(p.hu, p.hv) + p.fall };
    pads.push(pad);
    return pad;
  }

  function heightAt(x, z) {
    let h = rawAt(x, z);
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      const dx = x - p.cx;
      const dz = z - p.cz;
      if (dx * dx + dz * dz > p.r * p.r) continue;
      const u = dx * p.ux + dz * p.uz;
      const v = -dx * p.uz + dz * p.ux;
      const ou = Math.abs(u) - p.hu;
      const ov = Math.abs(v) - p.hv;
      const d = Math.hypot(ou > 0 ? ou : 0, ov > 0 ? ov : 0);
      if (d >= p.fall) continue;
      const w = 1 - smooth(d / p.fall);
      const target = p.yAt ? p.yAt(u, v, x, z) : p.y;
      h += (target - h) * w;
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

  return {
    ok,
    heightAt,
    rawAt,
    rawMetres,
    addPad,
    pads,
    bounds,
    core,
    // the raw grid, for the tile worker (src/tile-worker.js), which drapes
    // the streamed tiles on the same ground
    grid: ok ? { bbox: data.bbox, cols, rows, heights: H, core: data.core || null } : null,
    datum,
    // metres above sea level at a world point (with pads)
    elevationAt: (x, z) => heightAt(x, z) / k + datum,
    minM: ok ? data.min_m : 0,
    maxM: ok ? data.max_m : 0,
    source: ok ? data.source : 'flat',
  };
}
