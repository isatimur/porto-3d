#!/usr/bin/env node
// The STCP bus stops of the centre, for the street furniture (src/street-kit.js
// stands a shelter or a pole at each one). Derived from the GTFS schedule the
// pipeline already fetched (scripts/fetch-gtfs.mjs -> data/gtfs/schedule.json):
// no network. A stop is kept when a bus route (GTFS route_type 3) of the STCP
// feed serves it and it lies within RADIUS_M of the city origin. Output:
// data/stops.json, { source, licence, built, radius_m, stops: [[lat, lon, n]] }
// with lat/lon at 1e-5 (about 1 m) and n the number of bus patterns that call
// there (a busy stop gets a shelter, a quiet one a pole).
//
//   node scripts/build-stops.mjs [--city porto] [--radius 4000]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const cityId = opt('city', 'porto');
const RADIUS_M = Number(opt('radius', 4000));
const city = JSON.parse(readFileSync(join(ROOT, 'cities', `${cityId}.json`), 'utf8'));
const src = join(ROOT, 'data', 'gtfs', 'schedule.json');
if (!existsSync(src)) {
  console.error(`build-stops: ${src} missing (run scripts/fetch-gtfs.mjs first)`);
  process.exit(1);
}
const g = JSON.parse(readFileSync(src, 'utf8'));
const { lat: oLat, lon: oLon } = city.origin;
const mLat = 111320;
const mLon = 111320 * Math.cos((oLat * Math.PI) / 180);
const calls = new Map();
for (const p of g.patterns) {
  const r = g.routes[p.r];
  if (!r || r.type !== 3 || (r.feed && r.feed !== 'stcp')) continue;
  for (const s of new Set(p.st)) calls.set(s, (calls.get(s) || 0) + 1);
}
const stops = [];
for (const [i, n] of calls) {
  const s = g.stops[i];
  if (!s) continue;
  const d = Math.hypot((s[0] - oLat) * mLat, (s[1] - oLon) * mLon);
  if (d > RADIUS_M) continue;
  stops.push([+s[0].toFixed(5), +s[1].toFixed(5), n]);
}
// stable order: north to south, west to east
stops.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
const out = {
  source: `GTFS ${g.agency || 'STCP'} (${g.catalogue || 'open data'}), built ${g.built || '?'}; bus stops (route_type 3) within ${RADIUS_M} m of the origin`,
  licence: g.licence || 'see data/gtfs/schedule.json',
  built: new Date().toISOString().slice(0, 10),
  radius_m: RADIUS_M,
  stops,
};
writeFileSync(join(ROOT, 'data', 'stops.json'), JSON.stringify(out));
console.log(`build-stops: ${stops.length} stops -> data/stops.json`);
