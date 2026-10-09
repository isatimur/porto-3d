import { language, loadTranslations, localizeLandmark, localizeRoute } from './i18n.js';
import { CITY, dataPath } from './city.js';
import { setDims } from './fit.js';
import { unpackBuildings } from './buildings-pack.js';

const BASE = import.meta.env.BASE_URL;

// Content hashes of the data files (vite.config.js `__DATA_V__`): a data URL
// carries ?v=<hash>, so Vercel can serve it as immutable (vercel.json) and a
// returning visitor makes no request for a file that did not change. A new
// deploy that changes a file changes only that file's URL. The tile folders
// share the hash of their index.
const DATA_V = typeof __DATA_V__ !== 'undefined' ? __DATA_V__ : {};
function versionOf(rel) {
  if (DATA_V[rel]) return DATA_V[rel];
  for (const dir of ['data/tiles/', 'data/tiles-ms/']) if (rel.startsWith(dir) && DATA_V[dir]) return DATA_V[dir];
  return null;
}

export function assetUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  const rel = String(path).replace(/^\.?\//, '');
  const v = rel.includes('?') ? null : versionOf(rel);
  return BASE + rel + (v ? `?v=${v}` : '');
}

// The Vite dev server answers a missing file with index.html and status 200,
// so a 200 alone proves nothing. Require JSON content and a clean parse.
async function fetchJSON(path) {
  const res = await fetch(assetUrl(path));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (!type.includes('json')) throw new Error(`content-type "${type}" is not JSON`);
  return JSON.parse(await res.text());
}

function cleanLandmarks(raw) {
  if (!Array.isArray(raw)) throw new Error('landmarks.json is not an array');
  const out = [];
  for (const l of raw) {
    const lat = Number(l?.lat);
    const lon = Number(l?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      console.warn('[porto] landmark skipped, bad coordinates:', l?.id);
      continue;
    }
    out.push({
      ...l,
      id: String(l.id ?? `landmark-${out.length}`),
      name_ru: l.name_ru || l.name_pt || String(l.id),
      name_pt: l.name_pt || '',
      category: l.category ? String(l.category) : 'other',
      year: l.year == null ? '' : String(l.year),
      lat,
      lon,
    });
  }
  if (!out.length) throw new Error('landmarks.json has no usable entries');
  return out;
}

function cleanRoads(raw) {
  if (!raw || !Array.isArray(raw.features) || !raw.origin) throw new Error('roads.json has no origin/features');
  return raw;
}

// ------------------------------------------------------------ rich fields
// All optional. After this pass the UI can rely on: strings are strings
// (maybe empty), lists are arrays (maybe empty), panorama is object or null.
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const isUrl = (u) => typeof u === 'string' && /^https?:\/\//.test(u);
const cleanCredit = (c) => (c && typeof c === 'object' ? { author: str(c.author), license: str(c.license), source_url: isUrl(c.source_url) ? c.source_url : '' } : null);
const GALLERY_KINDS = new Set(['interior', 'exterior', 'detail']);
const YT_ID = /^[\w-]{6,20}$/;

function cleanRich(l) {
  l.history_ru = str(l.history_ru);
  l.tip_ru = str(l.tip_ru);
  l.facts_ru = (Array.isArray(l.facts_ru) ? l.facts_ru : []).map(str).filter(Boolean);
  l.sources = (Array.isArray(l.sources) ? l.sources : [])
    .filter((s) => s && isUrl(s.url))
    .map((s) => ({ title: str(s.title) || s.url, url: s.url }));
  l.gallery = (Array.isArray(l.gallery) ? l.gallery : [])
    .filter((g) => g && str(g.src))
    .map((g) => ({ src: g.src, kind: GALLERY_KINDS.has(g.kind) ? g.kind : '', caption_ru: str(g.caption_ru), credit: cleanCredit(g.credit) }));
  // two shapes: an equirectangular image {src}, or a 360° YouTube video
  // {type:'youtube', youtube_id} when no free panorama photo exists
  const p = l.panorama;
  if (p && p.type === 'youtube' && YT_ID.test(String(p.youtube_id || ''))) {
    l.panorama = { type: 'youtube', youtube_id: String(p.youtube_id), title: str(p.title), channel: str(p.channel), caption_ru: str(p.caption_ru), credit: cleanCredit(p.credit) };
  } else if (p && str(p.src)) {
    l.panorama = { type: 'image', src: p.src, caption_ru: str(p.caption_ru), credit: cleanCredit(p.credit) };
  } else {
    l.panorama = null;
  }
  l.videos = (Array.isArray(l.videos) ? l.videos : [])
    .filter((v) => v && YT_ID.test(String(v.youtube_id || '')))
    .map((v) => ({ youtube_id: String(v.youtube_id), title: str(v.title), channel: str(v.channel), lang: str(v.lang) }));
  return l;
}

// ------------------------------------------------------------ routes
const MODES = new Set(['foot', 'bus', 'funicular', 'taxi']);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

function cleanRoutes(raw, landmarks) {
  const list = Array.isArray(raw) ? raw : raw?.routes;
  if (!Array.isArray(list)) throw new Error('routes.json has no routes[]');
  const byId = new Map(landmarks.map((l) => [l.id, l]));
  const out = [];
  for (const r of list) {
    if (!r || !r.id) continue;
    const stops = (Array.isArray(r.stops) ? r.stops : [])
      .filter((s) => {
        if (byId.has(s?.landmark_id)) return true;
        console.warn(`[porto] route "${r.id}": stop skipped, unknown landmark "${s?.landmark_id}"`);
        return false;
      })
      .map((s) => ({ landmark_id: s.landmark_id, time_ru: str(s.time_ru), stay_min: num(s.stay_min), note_ru: str(s.note_ru) }));
    if (stops.length < 2) {
      console.warn(`[porto] route "${r.id}" skipped: fewer than two known stops`);
      continue;
    }
    const legs = [];
    for (const g of Array.isArray(r.legs) ? r.legs : []) {
      const a = byId.get(g?.from);
      const b = byId.get(g?.to);
      if (!a || !b) continue;
      let pts = (Array.isArray(g.pts) ? g.pts : []).filter((p) => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1])).map((p) => [+p[0], +p[1]]);
      if (pts.length < 2) pts = [[a.lat, a.lon], [b.lat, b.lon]]; // no geometry: straight line
      legs.push({
        from: g.from,
        to: g.to,
        mode: MODES.has(g.mode) ? g.mode : 'foot',
        distance_m: num(g.distance_m),
        duration_min: num(g.duration_min),
        note_ru: str(g.note_ru),
        pts,
      });
    }
    out.push({
      id: String(r.id),
      name_ru: str(r.name_ru) || String(r.id),
      subtitle_ru: str(r.subtitle_ru),
      color: /^#[0-9a-f]{3,8}$/i.test(r.color || '') ? r.color : '#e0a948',
      duration_ru: str(r.duration_ru),
      distance_km: num(r.distance_km),
      walk_km: num(r.walk_km),
      description_ru: str(r.description_ru),
      attribution: str(raw?.attribution),
      stops,
      legs,
    });
  }
  return out;
}

// Story mode text (<data_dir>/story.json), fetched when the story first opens.
export async function loadStory() {
  return fetchJSON(dataPath('story.json'));
}

// Small per-city tables the modules used to import statically. Optional:
// a city without them gets an empty object.
async function fetchTable(file, key, status) {
  try {
    const v = await fetchJSON(dataPath(file));
    status[key] = 'real';
    return v;
  } catch (e) {
    status[key] = 'missing';
    console.info(`[porto] ${dataPath(file)} unavailable (${e.message}); ${key} empty.`);
    return {};
  }
}

// The core buildings: data/buildings.bin.gz (buildings-pack.js, a fifth of the
// JSON's size on the wire and no 9 MB parse), unpacked with the browser's own
// DecompressionStream; the JSON file stays the fallback for a browser without
// it, and for a city that has no packed file.
async function fetchBuildings() {
  const packed = dataPath('buildings.bin.gz');
  if (typeof DecompressionStream !== 'undefined' && DATA_V[packed]) {
    try {
      const res = await fetch(assetUrl(packed));
      if (res.ok && res.body) {
        const buf = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
        return unpackBuildings(buf);
      }
    } catch (e) {
      console.warn(`[porto] ${packed} unavailable (${e.message}); falling back to buildings.json`);
    }
  }
  return fetchJSON(dataPath('buildings.json'));
}

// What the first frame needs is awaited here; the two big files are not.
// roads.json (2.8 MB) and buildings.json (9 MB) download while the landmarks
// are fitted and the sky is already on screen; the build steps await
// `roadsReady` and `buildingsReady` right before they use them. The map's
// projection needs only the roads' origin and bbox, which are the city's own
// (cities/<id>.json origin and core_bbox; the data pipeline writes the same
// values), so `roads` starts as that stub.
export async function loadData(onStep = () => {}) {
  const status = { landmarks: 'real', roads: 'loading', routes: 'real', buildings: 'loading' };
  const D = CITY.data_dir;

  const stubRoads = { origin: CITY.origin, bbox: CITY.core_bbox, features: [] };
  const roadsReady = fetchJSON(dataPath('roads.json'))
    .then(cleanRoads)
    .then((r) => {
      status.roads = 'real';
      return r;
    })
    .catch((e) => {
      console.warn(`[porto] ${D}/roads.json unavailable (${e.message}). No streets.`);
      status.roads = 'none';
      return stubRoads;
    });
  const buildingsReady = fetchBuildings()
    .then((b) => {
      status.buildings = 'real';
      return b;
    })
    .catch((e) => {
      console.warn(`[porto] ${D}/buildings.json unavailable (${e.message}). buildings layer disabled.`);
      status.buildings = 'missing';
      return null;
    });

  const [lmRes, rtRes, trRes, fpRes, locRes, ntRes, dims, life, axes] = await Promise.allSettled([
    fetchJSON(CITY.landmarks_file).then(cleanLandmarks),
    fetchJSON(dataPath('routes.json')),
    fetchJSON(dataPath('terrain.json')),
    fetchJSON(dataPath('footprints.json')),
    loadTranslations(language, CITY.id),
    fetchJSON(dataPath('nature.json')),
    fetchTable('dimensions.json', 'dimensions', status),
    fetchTable('life.json', 'life', status),
    fetchTable('traffic-axes.json', 'trafficAxes', status),
  ]);
  onStep();
  setDims(dims.value || {});

  // Geodata for the real-scale scene. Each one is optional: without it the
  // scene degrades (flat ground, no city mass, model-sized landmarks) and
  // says so in the console.
  const geo = {};
  for (const [key, res, file] of [['terrain', trRes, 'terrain.json'], ['footprints', fpRes, 'footprints.json'], ['nature', ntRes, 'nature.json']]) {
    if (res.status === 'fulfilled') {
      geo[key] = res.value;
      status[key] = 'real';
    } else {
      console.warn(`[porto] ${D}/${file} unavailable (${res.reason?.message}). ${key} layer disabled.`);
      geo[key] = null;
      status[key] = 'missing';
    }
  }

  let landmarks;
  if (lmRes.status === 'fulfilled') {
    landmarks = lmRes.value;
  } else {
    // a new city: the map draws the terrain and the city fabric it has;
    // the landmark list comes from the landmark agents later
    console.info(`[porto] ${CITY.name.en}: no landmarks yet (${CITY.landmarks_file}: ${lmRes.reason?.message}). Empty list.`);
    landmarks = [];
    status.landmarks = 'none';
  }

  for (const l of landmarks) cleanRich(l);

  let routes = [];
  let routeErr = rtRes.status === 'rejected' ? rtRes.reason : null;
  if (!routeErr) {
    try {
      routes = cleanRoutes(rtRes.value, landmarks);
    } catch (e) {
      routeErr = e;
    }
  }
  if (routeErr) {
    console.warn(`[porto] ${D}/routes.json unavailable (${routeErr.message}). No routes.`);
    routes = [];
    status.routes = 'none';
  }

  const tr = locRes.status === 'fulfilled' ? locRes.value : null;
  landmarks = landmarks.map((l) => localizeLandmark(l, tr?.landmarks?.[l.id]));
  routes = routes.map((r) => localizeRoute(r, tr?.routes?.[r.id]));

  return { landmarks, roads: stubRoads, roadsReady, buildingsReady, routes, status, life: life.value || {}, trafficAxes: axes.value || {}, ...geo };
}

