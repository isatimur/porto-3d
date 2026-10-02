// GET /api/route?callsign=TAP1329&hex=4951cd: where an aircraft flies from
// and to, its airline, type and registration. One small JSON.
//
// Why a function: the route APIs send no CORS headers (like the ADS-B ones,
// see api/adsb.js), and one shared cache is kinder to them than every
// visitor asking on their own.
//
// Sources, key-less, all asked in parallel per lookup:
//   route (by callsign), the first one that knows it wins:
//     1. adsb.lol routeset   POST https://api.adsb.lol/api/0/routeset
//     2. adsb.im routeset    POST https://adsb.im/api/0/routeset (the same
//        route service; api.adsb.lol answered an empty 201 on 2026-09-29)
//     3. adsb.lol standing data  https://vrs-standing-data.adsb.lol/routes/TA/TAP1329.json
//        (static files on GitHub Pages, the data behind 1 and 2)
//     4. adsbdb              https://api.adsbdb.com/v0/callsign/TAP1329
//   airline name and IATA flight number: adsbdb callsign (4);
//   aircraft (by ICAO hex): adsbdb https://api.adsbdb.com/v0/aircraft/4951cd.
// Route data is crowd-sourced (the VRS standing data): a callsign can fly a
// new route before the data knows it. A route that passes far from Porto
// (the aircraft is within 74 km of it) is treated as unknown, not shown.
//
// Output: { ok, callsign, hex,
//           flight: { iata, icao, airline: { name, icao, iata } } | null,
//           route: { src, origin, destination } | null   (airport: { iata, icao, name, city, country, lat, lon }),
//           aircraft: { src, registration, type, icaoType, manufacturer, operator } | null }
// ok: false only when every upstream failed (a network error, a timeout, a
// 5xx); "not known" is ok: true with nulls.
//
// Caching: each part 10 min per key in this instance, a failure 60 s; the
// reply carries public, max-age=600 (60 when ok: false), so the CDN shares
// it between visitors too.
// The city (its aircraft point, for the plausibility test and the routeset
// query) comes from cities/<id>.json via ?city=<id>, default porto
// (41.55 / -8.42). Every helper takes the config as `cfg`.
import { cityConfig, userAgent } from './_city.js';

const TIMEOUT_MS = 3500;
const TTL_MS = 10 * 60e3;
const FAIL_TTL_MS = 60e3;
const CACHE_MAX = 500;
const PLAUSIBLE_KM = 400; // a route leg passes at most this far from Porto

const CALLSIGN_RE = /^[A-Z0-9]{2,8}$/;
const HEX_RE = /^[0-9a-f]{6}$/;

// A miss: the upstream answered, it just does not know this key.
class Miss extends Error {}

async function http(url, init = {}, cfg = null) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': userAgent(cfg), ...(init.headers || {}) } });
    if (r.status === 404) throw new Miss('404');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    // api.adsb.lol/api/0/routeset answers 201 with an empty body: no data
    if (!text.trim()) throw new Error('empty body');
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- geometry
const RAD = Math.PI / 180;
export function haversineKm(la1, lo1, la2, lo2) {
  const a = Math.sin(((la2 - la1) * RAD) / 2) ** 2 + Math.cos(la1 * RAD) * Math.cos(la2 * RAD) * Math.sin(((lo2 - lo1) * RAD) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
}
// the least distance from the city to the great circle segment a -> b (sampled)
function legDistanceKm(a, b, cfg) {
  const { lat: LAT, lon: LON } = cfg.aircraft;
  const p1 = [a.lat * RAD, a.lon * RAD];
  const p2 = [b.lat * RAD, b.lon * RAD];
  const v = (p) => [Math.cos(p[0]) * Math.cos(p[1]), Math.cos(p[0]) * Math.sin(p[1]), Math.sin(p[0])];
  const A = v(p1);
  const B = v(p2);
  let best = Infinity;
  for (let i = 0; i <= 64; i++) {
    const f = i / 64;
    const x = A[0] * (1 - f) + B[0] * f;
    const y = A[1] * (1 - f) + B[1] * f;
    const z = A[2] * (1 - f) + B[2] * f;
    const lat = Math.atan2(z, Math.hypot(x, y)) / RAD;
    const lon = Math.atan2(y, x) / RAD;
    best = Math.min(best, haversineKm(LAT, LON, lat, lon));
  }
  return best;
}
// A multi-stop route (A-B-C): the leg that passes nearest the city. null
// when no leg passes within PLAUSIBLE_KM (a stale or wrong route).
function pickLeg(airports, cfg) {
  const ok = airports.filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon));
  if (ok.length < 2) return null;
  let best = null;
  for (let i = 0; i + 1 < ok.length; i++) {
    const d = legDistanceKm(ok[i], ok[i + 1], cfg);
    if (!best || d < best.d) best = { d, origin: ok[i], destination: ok[i + 1] };
  }
  return best && best.d <= PLAUSIBLE_KM ? { origin: best.origin, destination: best.destination } : null;
}

const str = (s) => (typeof s === 'string' && s.trim() && s.trim().toLowerCase() !== 'unknown' ? s.trim() : null);
const num = (x) => (Number.isFinite(+x) && x !== null && x !== '' ? +x : null);

// ---------------------------------------------------------------- sources
// adsb.lol / adsb.im routeset and the standing data share one airport shape
function fromVrs(j, src, cfg) {
  const r = Array.isArray(j) ? j[0] : j;
  if (!r || typeof r !== 'object') throw new Error('bad answer');
  if (!Array.isArray(r._airports) || r._airports.length < 2 || !str(r.airport_codes)) throw new Miss('unknown');
  if (r.plausible === false) throw new Miss('implausible');
  const airports = r._airports.map((a) => ({
    iata: str(a.iata),
    icao: str(a.icao),
    name: str(a.name),
    city: str(a.location),
    country: str(a.countryiso2),
    lat: num(a.lat),
    lon: num(a.lon),
  }));
  const leg = pickLeg(airports, cfg);
  if (!leg) throw new Miss('implausible');
  return { src, ...leg };
}

const routeset = (host, src) => async (callsign, cfg) =>
  fromVrs(
    await http(
      `https://${host}/api/0/routeset`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planes: [{ callsign, lat: cfg.aircraft.lat, lng: cfg.aircraft.lon }] }),
      },
      cfg,
    ),
    src,
    cfg,
  );

async function standing(callsign, cfg) {
  return fromVrs(await http(`https://vrs-standing-data.adsb.lol/routes/${callsign.slice(0, 2)}/${callsign}.json`, {}, cfg), 'adsb.lol', cfg);
}

function airportDb(a) {
  if (!a) return null;
  return { iata: str(a.iata_code), icao: str(a.icao_code), name: str(a.name), city: str(a.municipality), country: str(a.country_iso_name), lat: num(a.latitude), lon: num(a.longitude) };
}

// adsbdb callsign: the airline and the IATA number, and a route of its own
async function adsbdbCallsign(callsign, cfg) {
  const j = await http(`https://api.adsbdb.com/v0/callsign/${callsign}`, {}, cfg);
  const f = j?.response?.flightroute;
  if (!f || typeof f !== 'object') throw new Miss('unknown');
  const al = f.airline || null;
  const flight = {
    iata: str(f.callsign_iata),
    icao: str(f.callsign_icao) || callsign,
    airline: al ? { name: str(al.name), icao: str(al.icao), iata: str(al.iata) } : null,
  };
  const o = airportDb(f.origin);
  const d = airportDb(f.destination);
  const leg = o && d ? pickLeg([o, d], cfg) : null;
  return { flight, route: leg ? { src: 'adsbdb', ...leg } : null };
}

async function adsbdbAircraft(hex, cfg) {
  const j = await http(`https://api.adsbdb.com/v0/aircraft/${hex}`, {}, cfg);
  const a = j?.response?.aircraft;
  if (!a || typeof a !== 'object') throw new Miss('unknown');
  return {
    src: 'adsbdb',
    registration: str(a.registration),
    type: str(a.type),
    icaoType: str(a.icao_type),
    manufacturer: str(a.manufacturer),
    operator: str(a.registered_owner),
  };
}

// ---------------------------------------------------------------- cache
// key -> { at, ttl, p (a promise of { ok, value }) }; bounded, oldest out
const cache = new Map();
function cached(key, fn) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < hit.ttl) return hit.p;
  const entry = { at: now, ttl: TTL_MS, p: null };
  entry.p = fn().then(
    (value) => ({ ok: true, value }),
    (e) => {
      if (e instanceof Miss) return { ok: true, value: null };
      entry.ttl = FAIL_TTL_MS;
      return { ok: false, value: null };
    },
  );
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return entry.p;
}

// The first route source that knows the callsign. ok: false only when none
// answered at all.
// adsb.lol first; the two fallbacks together, so the worst case stays at two
// timeouts (7 s), inside the function's 10 s.
const lolRouteset = routeset('api.adsb.lol', 'adsb.lol');
const imRouteset = routeset('adsb.im', 'adsb.im');
// (cache keys: Porto's as before; another city gets its own, the leg
// picked depends on the city)
const keyOf = (cfg, k) => (cfg.id === 'porto' ? k : `${cfg.id}:${k}`);
async function routeChain(callsign, dbRoute, cfg) {
  let answered = false;
  const first = await cached(keyOf(cfg, `adsb.lol-routeset:${callsign}`), () => lolRouteset(callsign, cfg));
  if (first.value) return first;
  if (first.ok) answered = true;
  const rest = await Promise.all([
    cached(keyOf(cfg, `adsb.im-routeset:${callsign}`), () => imRouteset(callsign, cfg)),
    cached(keyOf(cfg, `adsb.lol-standing:${callsign}`), () => standing(callsign, cfg)),
  ]);
  for (const r of rest) {
    if (r.ok) answered = true;
    if (r.value) return r;
  }
  const db = await dbRoute;
  if (db.ok) answered = true;
  if (db.value?.route) return { ok: true, value: db.value.route };
  return { ok: answered, value: null };
}

// The core, without the HTTP wrapper (node tests call it directly).
export async function lookupRoute(callsign, hex, cfg = cityConfig('porto')) {
  const db = callsign ? cached(keyOf(cfg, `adsbdb-callsign:${callsign}`), () => adsbdbCallsign(callsign, cfg)) : null;
  const [route, dbr, ac] = await Promise.all([
    callsign ? routeChain(callsign, db, cfg) : null,
    db,
    hex ? cached(`adsbdb-aircraft:${hex}`, () => adsbdbAircraft(hex, cfg)) : null,
  ]);
  const parts = [route, dbr, ac].filter(Boolean);
  return {
    ok: parts.some((p) => p.ok),
    callsign: callsign || null,
    hex: hex || null,
    flight: dbr?.value?.flight || null,
    route: route?.value || null,
    aircraft: ac?.value || null,
  };
}

// ---------------------------------------------------------------- handler
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const head = req.method === 'HEAD';
  const send = (status, cacheControl, body) => {
    res.statusCode = status;
    res.setHeader('Cache-Control', cacheControl);
    res.end(head ? undefined : JSON.stringify(body));
  };
  if (req.method !== 'GET' && !head) {
    res.setHeader('Allow', 'GET, HEAD');
    send(405, 'no-store', { error: 'GET only' });
    return;
  }
  let q;
  try {
    q = new URL(req.url || '/', 'http://x').searchParams;
  } catch {
    q = null;
  }
  const keys = q ? [...q.keys()] : [];
  const callsign = q?.get('callsign') ?? null;
  const hex = q?.get('hex') ?? null;
  const cfg = q?.has('city') ? cityConfig(q.get('city')) : cityConfig('porto');
  const bad =
    !q ||
    !cfg ||
    keys.some((k) => k !== 'callsign' && k !== 'hex' && k !== 'city') ||
    new Set(keys).size !== keys.length ||
    (!callsign && !hex) ||
    (callsign !== null && !CALLSIGN_RE.test(callsign)) ||
    (hex !== null && !HEX_RE.test(hex));
  if (bad) {
    send(400, 'public, max-age=3600, s-maxage=86400', { error: 'callsign=[A-Z0-9]{2,8} and/or hex=[0-9a-f]{6}, optional city=<known id>' });
    return;
  }
  let out;
  try {
    out = await lookupRoute(callsign, hex, cfg);
  } catch {
    out = { ok: false, callsign, hex, flight: null, route: null, aircraft: null };
  }
  res.setHeader('X-Porto-Route', out.route?.src || 'none');
  send(200, out.ok ? 'public, max-age=600, s-maxage=600' : 'public, max-age=60, s-maxage=60', out);
}
