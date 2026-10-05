// The city this page shows: cities/<id>.json, loaded once before start().
//
// The id comes from, in order: VITE_CITY at build time (one Vercel project
// per city), ?city= in the query, the hostname (porto-3d.com -> porto, and
// any <id>-3d.com), else porto. The config is fetched from /cities/<id>.json
// (vite.config.js copies cities/ into the build).
//
// CITY is one shared object, filled by loadCity(): every module may import
// it, but must read it lazily (after loadCity() resolved), since ES imports
// evaluate before the fetch answers. main.js awaits loadCity() first.
import { language, t } from './i18n.js';

const HOSTS = { 'porto-3d.com': 'porto', 'www.porto-3d.com': 'porto', 'porto-3d.vercel.app': 'porto' };
const ID_RE = /^[a-z][a-z0-9-]*$/;

export function resolveCityId(envId, search = '', hostname = '') {
  const q = new URLSearchParams(search).get('city');
  if (q && ID_RE.test(q)) return q;
  if (envId && ID_RE.test(envId)) return envId;
  if (HOSTS[hostname]) return HOSTS[hostname];
  const m = /^(?:www\.)?([a-z][a-z0-9-]*)-3d\.(?:com|pt|app)$/.exec(hostname || '');
  if (m) return m[1];
  return 'porto'; // this project is Porto: the default city
}

export const CITY_ID = resolveCityId(import.meta.env.VITE_CITY, globalThis.location?.search, globalThis.location?.hostname);

// Filled by loadCity(); the shape is cities/README.md plus the derived keys
// below (data_dir, name_ru_cases, hostnames, og_image).
export const CITY = { id: CITY_ID, loaded: false };

function withDefaults(cfg) {
  const id = cfg.id || CITY_ID;
  const ru = cfg.name?.ru || cfg.name?.en || id;
  return {
    ...cfg,
    id,
    name: { pt: cfg.name?.pt || cfg.name?.en || id, en: cfg.name?.en || id, ru },
    name_ru_cases: { gen: ru, prep: ru, ins: ru, ...(cfg.name_ru_cases || {}) },
    data_dir: (cfg.data_dir || (id === 'porto' ? 'data' : `data/${id}`)).replace(/\/$/, ''),
    landmarks_file: cfg.landmarks_file || `${cfg.data_dir || (id === 'porto' ? 'data' : `data/${id}`)}/landmarks.json`,
    timezone: cfg.timezone || 'Europe/Lisbon',
    weather: cfg.weather || cfg.origin,
    aircraft: { radius_nm: 40, ...(cfg.aircraft || cfg.origin) },
    start_view: cfg.start_view || {},
    traffic: cfg.traffic || {},
    nature: cfg.nature || {},
    transit: cfg.transit || {},
    loaded: true,
  };
}

export async function loadCity(id = CITY_ID) {
  const base = import.meta.env.BASE_URL;
  const res = await fetch(`${base}cities/${id}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`cities/${id}.json: HTTP ${res.status}`);
  if (!(res.headers.get('content-type') || '').includes('json')) throw new Error(`cities/${id}.json is not JSON (unknown city?)`);
  const cfg = withDefaults(await res.json());
  Object.assign(CITY, cfg);
  return CITY;
}

// A path under the city's data directory: 'roads.json' -> 'data/roads.json'
// for Braga, 'data/guimaraes/roads.json' for Guimarães.
export const dataPath = (file) => `${CITY.data_dir}/${file}`;

// False when the city config lists the file under "data_absent": the file is
// optional and this city ships none, so the loader skips the fetch (no 404).
export const hasData = (file) => !(Array.isArray(CITY.data_absent) && CITY.data_absent.includes(file));

// The city's name in the page language; the Russian edition needs cases.
export function cityName(lang = language, form = 'nom') {
  if (lang === 'ru' && form !== 'nom') return CITY.name_ru_cases?.[form] || CITY.name.ru;
  return CITY.name?.[lang] || CITY.name?.en || CITY.id;
}

// t() with the city filled in: '{city}', '{city_gen}' (Браги), '{city_prep}'
// (Браге), '{city_ins}' (Брагой). Non-Russian editions use the plain name.
export function cityT(source) {
  return t(source).replace(/\{city(?:_(gen|prep|ins))?\}/g, (_, form) => cityName(language, form || 'nom'));
}

// Query string to reach the API functions for this city ('' for Braga, so
// its CDN cache keys stay as they were).
export const cityQuery = () => (CITY.id === 'porto' ? '' : `city=${CITY.id}`);

// The static shell (index.html) is written for Braga so crawlers see a
// full page. Once the config is here, the visible city strings are set
// again from it: for Braga the same strings, for another city its own.
export function applyCityShell() {
  const lang = language;
  const name = cityName(lang);
  const set = (sel, attr, value) => {
    for (const el of document.querySelectorAll(sel)) if (value) el.setAttribute(attr, value);
  };
  document.title = cityT('{city} — 3D-карта достопримечательностей');
  set('meta[name="description"]', 'content', CITY.description?.[lang] || cityT('Интерактивная 3D-карта {city_gen}: соборы, сады, площади и святилища на холмах.'));
  set('#scene', 'aria-label', cityT('Трёхмерная карта {city_gen}'));
  set('#cinema-toggle', 'title', cityT('Фильм о {city_prep} с утра до ночи'));
  set('#story-toggle', 'title', CITY.id === 'porto' ? cityT('2000 лет истории {city_gen}') : cityT('История {city_gen}'));
  set('#story', 'aria-label', cityT('История {city_gen}'));
  for (const sel of ['.brand h1', '.loader-title']) {
    const el = document.querySelector(sel);
    if (el) el.textContent = name;
  }
  const brand = document.querySelector('.cinema-brand');
  if (brand?.firstChild?.nodeType === Node.TEXT_NODE) brand.firstChild.textContent = `${name} `;
  if (CITY.domain) {
    set('link[rel="canonical"]', 'href', `${CITY.domain}/`);
    set('meta[property="og:url"]', 'content', `${CITY.domain}/`);
    if (CITY.og_image) {
      set('meta[property="og:image"]', 'content', `${CITY.domain}${CITY.og_image}`);
      set('meta[name="twitter:image"]', 'content', `${CITY.domain}${CITY.og_image}`);
    }
  }
  set('meta[property="og:site_name"]', 'content', `${CITY.name.en} 3D`);
  set('meta[name="apple-mobile-web-app-title"]', 'content', `${CITY.name.en} 3D`);
}
