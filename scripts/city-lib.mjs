// The city a script works on. Node 22, no dependencies.
//
//   node scripts/<script>.mjs --city guimaraes     (or --city=guimaraes, or CITY=guimaraes)
//
// Default: porto. The config is cities/<id>.json; this module adds the
// derived values every script needs (data directory, tile grid, terrain
// lattice, projection origin). geo-lib.mjs re-exports them as BBOX, ORIGIN,
// TILE_GRID, TERRAIN_LATTICE, DATA_DIR, so a script that imports geo-lib
// follows --city without further changes.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..');
export const CITIES_DIR = join(ROOT, 'cities');
const ID_RE = /^[a-z][a-z0-9-]*$/;

export function listCities() {
  return readdirSync(CITIES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .filter((id) => ID_RE.test(id));
}

// --city <id> | --city=<id> | CITY=<id> | braga. Also strips the flag from
// `args` when an array is given (scripts with their own argv parsing).
export function cityArg(args = process.argv.slice(2)) {
  let id = process.env.CITY || 'porto';
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--city' && args[i + 1]) {
      id = args[i + 1];
      args.splice(i, 2);
      break;
    }
    if (a.startsWith('--city=')) {
      id = a.slice(7);
      args.splice(i, 1);
      break;
    }
  }
  if (!ID_RE.test(id)) throw new Error(`bad city id "${id}"`);
  return id;
}

const M_LAT = 110574;
const M_LON = 111320;
const ceil = (v) => Math.ceil(v - 1e-9);

export function loadCity(id = cityArg()) {
  const file = join(CITIES_DIR, `${id}.json`);
  if (!existsSync(file)) throw new Error(`no such city: ${file} (known: ${listCities().join(', ')})`);
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  if (cfg.id !== id) throw new Error(`${file}: id "${cfg.id}" does not match the file name`);
  for (const k of ['origin', 'core_bbox', 'wide_bbox', 'timezone', 'name']) if (!cfg[k]) throw new Error(`${file}: missing "${k}"`);

  const core = cfg.core_bbox;
  const wide = cfg.wide_bbox;
  const kx = Math.cos((cfg.origin.lat * Math.PI) / 180) * M_LON;
  const widthM = (core.e - core.w) * kx;
  const heightM = (core.n - core.s) * M_LAT;

  // The 1 km tile grid: the core is an exact number of tiles; the wide
  // area extends it by whole tiles on each side (Braga: 11 x 6, +5/5/6/6).
  const nx = cfg.tiles?.core_nx ?? Math.max(1, Math.round(widthM / 1000));
  const ny = cfg.tiles?.core_ny ?? Math.max(1, Math.round(heightM / 1000));
  const dLon = (core.e - core.w) / nx;
  const dLat = (core.n - core.s) / ny;
  const ext = cfg.tiles?.ext ?? {
    w: ceil((core.w - wide.w) / dLon),
    e: ceil((wide.e - core.e) / dLon),
    s: ceil((core.s - wide.s) / dLat),
    n: ceil((wide.n - core.n) / dLat),
  };
  const tileGrid = {
    dLon,
    dLat,
    ext,
    nx: nx + ext.w + ext.e,
    ny: ny + ext.s + ext.n,
    coreNx: nx,
    coreNy: ny,
    bbox: { s: core.s - ext.s * dLat, w: core.w - ext.w * dLon, n: core.n + ext.n * dLat, e: core.e + ext.e * dLon },
    core: { x0: ext.w, y0: ext.s, x1: ext.w + nx, y1: ext.s + ny }, // [x0, x1) x [y0, y1)
  };

  // The terrain lattice: a core grid at ~spacing_m, extended by whole steps
  // past the tile grid (Braga: 90 x 60, +41/41/59/59).
  const spacing = cfg.terrain?.spacing_m ?? 110;
  const lat = cfg.terrain?.lattice;
  const cols = lat?.cols ?? Math.max(2, Math.round(widthM / spacing) + 1);
  const rows = lat?.rows ?? Math.max(2, Math.round(heightM / spacing) + 1);
  const stepLon = (core.e - core.w) / (cols - 1);
  const stepLat = (core.n - core.s) / (rows - 1);
  const lext = lat?.ext ?? {
    w: ceil((core.w - tileGrid.bbox.w) / stepLon),
    e: ceil((tileGrid.bbox.e - core.e) / stepLon),
    s: ceil((core.s - tileGrid.bbox.s) / stepLat),
    n: ceil((tileGrid.bbox.n - core.n) / stepLat),
  };
  const terrainLattice = { coreCols: cols, coreRows: rows, ext: lext, spacingM: spacing, dataset: cfg.terrain?.dataset ?? 'eudem25m' };

  const dataDir = cfg.data_dir ?? (id === 'porto' ? 'data' : `data/${id}`);
  const landmarksFile = cfg.landmarks_file ?? `${dataDir}/landmarks.json`;
  return {
    ...cfg,
    file,
    data_dir: dataDir,
    landmarks_file: landmarksFile,
    dataDir: join(ROOT, dataDir),
    landmarksPath: join(ROOT, landmarksFile),
    cacheDir: join(ROOT, dataDir, '.cache'),
    tileGrid,
    terrainLattice,
    probes: cfg.terrain?.probes ?? { centre: [cfg.origin.lat, cfg.origin.lon] },
    userAgent: `${id}-3d-data/1.0`,
  };
}

// The city of this process: resolved once, shared by every module.
export const CITY = loadCity();
export const DATA_DIR = CITY.dataDir;
export const dataPath = (...parts) => join(CITY.dataDir, ...parts);
export const cachePath = (...parts) => join(CITY.cacheDir, ...parts);
export const landmarksPath = () => CITY.landmarksPath;

// The path a message shows: "data/x.json" for Braga, "data/guimaraes/x.json" for others.
export const dataRel = (...parts) => join(CITY.data_dir, ...parts);

// The landmark list a script works on. landmarks.json when it exists (Braga); otherwise
// the city's landmark_candidates, each completed from data/<id>/new/<id>.osm.json
// ({osm, lat, lon, model}) when that file exists. So the geodata scripts can run before
// the landmark agents have merged landmarks.json. `withPos` keeps only entries with a position.
export function loadLandmarks({ withPos = true } = {}) {
  if (existsSync(CITY.landmarksPath)) return JSON.parse(readFileSync(CITY.landmarksPath, 'utf8'));
  const list = (CITY.landmark_candidates || []).map((c) => {
    const f = join(CITY.dataDir, 'new', `${c.id}.osm.json`);
    if (!existsSync(f)) return { ...c };
    const o = JSON.parse(readFileSync(f, 'utf8'));
    return { ...c, lat: o.lat, lon: o.lon, model: o.model, osm: o.osm };
  });
  return withPos ? list.filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lon)) : list;
}
