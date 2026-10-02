// Data for the living city (src/life.js): the two Bom Jesus funicular
// tracks and the fountains that get a water spray. Writes data/life.json.
//
//   node scripts/fetch-funicular.mjs            Overpass first, then fallback
//   node scripts/fetch-funicular.mjs --offline  footprints.json only
//
// Tracks: OSM railway=funicular within 600 m of the upper station
// (41.5549, -8.3770). The ways come in short pieces (bridges carry
// layer=1); they are chained end to end into two lines, top station first.
// Without Overpass the same ways are read from data/footprints.json
// (the bom-jesus parts tagged "funicular").
//
// Fountains: OSM amenity=fountain near each landmark that has one, else
// the water points of data/footprints.json. `kind`: jet (a plume that
// rises and falls back into a round basin) or spout (a wall spout that
// throws an arc forward, on the Bom Jesus stair risers).
// Node 22, no dependencies.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { overpass, r6, CITY, dataPath, dataRel } from './geo-lib.mjs';

// Braga-only: the Bom Jesus funicular and its named fountains are not generalised.
if (CITY.id !== 'braga') {
  console.log('fetch-funicular is Braga-only (life.json is hand-curated per city)');
  process.exit(0);
}
const OUT = dataPath('life.json');
const FOOT = JSON.parse(readFileSync(dataPath('footprints.json'), 'utf8'));
const OFFLINE = process.argv.includes('--offline');

const TOP = [41.5549, -8.377];
const key = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
const dist = (a, b) => Math.hypot((a[0] - b[0]) * 110574, (a[1] - b[1]) * 83400);

// Chain way pieces ([[lat, lon], ...]) into continuous lines.
function chain(pieces) {
  const left = pieces.map((p) => p.slice());
  const lines = [];
  while (left.length) {
    let line = left.shift();
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const p = left[i];
        const a = line[0];
        const b = line[line.length - 1];
        if (key(p[0]) === key(b)) line = line.concat(p.slice(1));
        else if (key(p[p.length - 1]) === key(a)) line = p.concat(line.slice(1));
        else if (key(p[0]) === key(a)) line = p.slice().reverse().concat(line.slice(1));
        else if (key(p[p.length - 1]) === key(b)) line = line.concat(p.slice().reverse().slice(1));
        else continue;
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    lines.push(line);
  }
  // top station first; the two longest lines are the tracks
  return lines
    .map((l) => (dist(l[0], TOP) > dist(l[l.length - 1], TOP) ? l.reverse() : l))
    .sort((a, b) => length(b) - length(a))
    .slice(0, 2);
}
const length = (l) => l.slice(1).reduce((s, p, i) => s + dist(l[i], p), 0);

async function tracksFromOsm() {
  const els = await overpass(`[out:json][timeout:60];way["railway"="funicular"](around:600,${TOP[0]},${TOP[1]});out geom;`, { rounds: 2, label: 'funicular' });
  const pieces = els.filter((e) => e.type === 'way' && e.geometry).map((e) => e.geometry.map((g) => [g.lat, g.lon]));
  return { pieces, source: `OSM Overpass railway=funicular (${pieces.length} ways)` };
}

function tracksFromFootprints() {
  const pieces = FOOT['bom-jesus'].parts.filter((p) => p.tag === 'funicular').map((p) => p.pts);
  return { pieces, source: `data/footprints.json bom-jesus funicular parts (${pieces.length} ways)` };
}

// The fountains that get a spray. Positions from OSM (amenity=fountain)
// when a match lies within `r` metres of the footprint point, else the
// footprint point itself.
const FOUNTAINS = [
  { id: 'praca-republica', site: 'praca-republica', name: 'Chafariz da Praça da República', pick: (p) => /Chafariz/.test(p.name || ''), kind: 'jet', h: 4.5, r: 5.5 },
  // the garden fountain of the Avenida (OSM node 11280978633)
  { id: 'avenida-central', site: 'avenida-central', name: 'Avenida Central', at: [41.551378, -8.417833], kind: 'jet', h: 3, r: 3 },
  { id: 'largo-santa-barbara', site: 'santa-barbara', name: 'Rua Francisco Sanches', at: [41.551303, -8.425328], kind: 'jet', h: 1.5, r: 1.5 },
  { id: 'santa-barbara', site: 'santa-barbara', name: 'Fonte de Santa Bárbara', pick: (p) => /Santa Bárbara/.test(p.name || ''), kind: 'jet', h: 1.6, r: 1.2 },
  { id: 'santa-barbara-castelos', site: 'santa-barbara', name: 'Fonte dos Castelos', pick: (p) => /Castelos/.test(p.name || ''), kind: 'jet', h: 1.2, r: 1 },
  { id: 'bom-jesus-lago', site: 'bom-jesus', name: 'Fonte do Lago', pick: (p) => /Lago/.test(p.name || ''), kind: 'jet', h: 2.2, r: 1.5 },
  { id: 'bom-jesus-evangelistas', site: 'bom-jesus', name: 'Terreiro dos Evangelistas', at: [41.556432, -8.376067], kind: 'jet', h: 2.4, r: 2.2 },
  { id: 'tibaes-claustro', site: 'tibaes', name: 'Mosteiro de Tibães', pick: (p, i) => i === 1, kind: 'jet', h: 1.8, r: 1.5 },
  { id: 'tibaes-horta', site: 'tibaes', name: 'Mosteiro de Tibães', pick: (p, i) => i === 3, kind: 'jet', h: 1.4, r: 1.2 },
];

// the stair-riser spouts of the Três Virtudes and Cinco Sentidos: the OSM
// water points on the stair axis (lon -8.3779 .. -8.3787)
function stairSpouts() {
  const bj = FOOT['bom-jesus'].parts.filter((p) => p.tag === 'water' && p.pts.length === 1);
  return bj
    .filter((p) => p.pts[0][1] < -8.3779 && p.pts[0][1] > -8.3787)
    .map((p, i) => ({ id: `bom-jesus-spout-${i + 1}`, site: 'bom-jesus', name: 'Escadório', lat: p.pts[0][0], lon: p.pts[0][1], kind: 'spout', h: 1.2, r: 0.9, osm: p.osm }));
}

async function osmFountains() {
  const b = '41.545,-8.485,41.560,-8.365';
  const els = await overpass(`[out:json][timeout:60];(node["amenity"="fountain"](${b});way["amenity"="fountain"](${b}););out center;`, { rounds: 2, allowEmpty: true, label: 'fountains' });
  return els.map((e) => ({ lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, name: e.tags?.name || null, osm: `${e.type[0]}${e.id}` })).filter((f) => f.lat);
}

function footprintPoint(f) {
  if (f.at) return { lat: f.at[0], lon: f.at[1], osm: null };
  const water = FOOT[f.site].parts.filter((p) => p.tag === 'water');
  const p = water.find((q, i) => f.pick(q, i));
  if (!p) return null;
  const n = p.pts.length;
  return { lat: p.pts.reduce((s, q) => s + q[0], 0) / n, lon: p.pts.reduce((s, q) => s + q[1], 0) / n, osm: p.osm };
}

let track;
try {
  if (OFFLINE) throw new Error('offline');
  track = await tracksFromOsm();
  if (track.pieces.length < 2) throw new Error('too few ways');
} catch (e) {
  console.warn(`funicular: ${e.message}; using footprints.json`);
  track = tracksFromFootprints();
}
const tracks = chain(track.pieces).map((l) => l.map(([la, lo]) => [r6(la), r6(lo)]));

let osm = [];
try {
  if (!OFFLINE) osm = await osmFountains();
} catch (e) {
  console.warn(`fountains: ${e.message}; using footprints.json`);
}
const fountains = [];
for (const f of FOUNTAINS) {
  const p = footprintPoint(f);
  if (!p) {
    console.warn(`fountain ${f.id}: no footprint point`);
    continue;
  }
  // snap to an OSM fountain node within 12 m when there is one
  const near = osm.map((o) => ({ o, d: dist([o.lat, o.lon], [p.lat, p.lon]) })).sort((a, b) => a.d - b.d)[0];
  const src = near && near.d < 12 ? { lat: near.o.lat, lon: near.o.lon, osm: near.o.osm, source: 'osm amenity=fountain' } : { ...p, source: 'footprints.json' };
  fountains.push({ id: f.id, site: f.site, name: f.name, lat: r6(src.lat), lon: r6(src.lon), kind: f.kind, h: f.h, r: f.r, osm: src.osm, source: src.source });
}
for (const s of stairSpouts()) fountains.push({ ...s, lat: r6(s.lat), lon: r6(s.lon), source: 'footprints.json' });

const out = {
  generated: new Date().toISOString().slice(0, 10),
  funicular: {
    name: 'Elevador do Bom Jesus do Monte (1882)',
    source: track.source,
    // real: 274 m, ~4 min per trip; the map runs it ten times faster
    tracks,
    lengths_m: tracks.map((l) => Math.round(length(l))),
  },
  fountains,
};
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`${dataRel('life.json')}:${tracks.length} tracks (${out.funicular.lengths_m.join(', ')} m), ${fountains.length} fountains; ${track.source}`);
