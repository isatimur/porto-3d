// The city an API call is for: ?city=<id>, validated against the config
// files on disk (cities/<id>.json), default porto. Shared by api/adsb.js
// and api/route.js (an underscore file is not a route on Vercel).
// vercel.json includeFiles ships cities/*.json with the functions.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CITIES = join(dirname(fileURLToPath(import.meta.url)), '..', 'cities');
const ID_RE = /^[a-z][a-z0-9-]*$/;
const cache = new Map();

// { id, name, origin, aircraft: { lat, lon, radius_nm }, domain } or null
// when the id is not a known city.
export function cityConfig(id = 'porto') {
  if (!ID_RE.test(id)) return null;
  if (cache.has(id)) return cache.get(id);
  const file = join(CITIES, `${id}.json`);
  let cfg = null;
  if (existsSync(file)) {
    try {
      const j = JSON.parse(readFileSync(file, 'utf8'));
      const point = j.aircraft || j.origin;
      cfg = {
        id: j.id || id,
        name: j.name?.en || id,
        domain: j.domain || null,
        origin: j.origin,
        aircraft: { lat: +point.lat, lon: +point.lon, radius_nm: +(j.aircraft?.radius_nm ?? 40) },
      };
    } catch {
      cfg = null;
    }
  }
  cache.set(id, cfg);
  return cfg;
}

// The User-Agent the upstream sees: the city's site.
export function userAgent(cfg) {
  const site = cfg?.domain || 'https://porto-3d.com';
  return `${site.replace(/^https?:\/\//, '')} live map (${site})`;
}
