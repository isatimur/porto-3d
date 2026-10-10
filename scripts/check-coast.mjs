// Check the sea from the real coast (data/coast.json, data/nature.json area "sea").
// Node 22. Run: node scripts/check-coast.mjs [--city porto] [--write-pip] [--strict]
//
//   1. the sea mesh (src/coast.js) triangulates the whole sea polygon: the sum of
//      the triangle areas equals the polygon area (ratio >= 0.999), no cut cell failed
//   2. what stands in the sea: building footprints, street and quay points
//   3. landmarks inside the sea polygon, with the distance to the coast
//      (--write-pip writes /tmp/review/wave1-water-pip.txt for the landmark owner)
// Exit 1 on a mesh failure (1) or, with --strict, on any building in the sea.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { CITY, dataPath } from './geo-lib.mjs';
import { createProjection } from '../src/geo.js';
import { buildSea } from '../src/coast.js';

const STRICT = process.argv.includes('--strict');
const read = (f) => JSON.parse(readFileSync(dataPath(f), 'utf8'));
const coast = read('coast.json');
const nature = read('nature.json');
const proj = createProjection(CITY.origin, CITY.wide_bbox, [], read('terrain.json'));
const toW = (ring) => ring.map(([lat, lon]) => proj.project(lat, lon));
const ringArea = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j].x * r[i].z - r[i].x * r[j].z;
  return Math.abs(a) / 2;
};
const pip = (x, z, r) => {
  let ins = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i].z > z !== r[j].z > z && x < ((r[j].x - r[i].x) * (z - r[i].z)) / (r[j].z - r[i].z) + r[i].x) ins = !ins;
  return ins;
};
const segDist = (x, z, a, b) => {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1e-9)));
  return Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
};

const seaRing = toW(coast.sea[0]);
const areas = [];
for (const a of nature.areas) {
  if (a.k !== 'water' || a.o !== 1) continue;
  const rings = a.r.map(toW);
  areas.push({ k: 'water', open: true, rings, area: ringArea(rings[0]), id: a.id });
}

let failed = false;
const sea = buildSea({ areas, heightAt: proj.heightAt });
if (!sea) {
  console.log('FAIL no sea mesh');
  process.exit(1);
}
const st = sea.stats;
console.log(`sea mesh: ${sea.triangles} triangles, ${st.verts} vertices, ${st.cut} cut cells, ${st.quads} open cells, area ratio ${st.areaRatio}, cut failures ${st.cutFail}, seaY ${st.seaY}`);
if (st.areaRatio < 0.999 || st.areaRatio > 1.001 || st.cutFail) {
  console.log('FAIL the triangles do not cover the sea polygon');
  failed = true;
}

// distance to the coast (the real coast: ring edges that are not on the bbox frame), metres
const onFrame = (p) => p.lat <= coast.bbox.s + 1e-6 || p.lat >= coast.bbox.n - 1e-6 || p.lon <= coast.bbox.w + 1e-6 || p.lon >= coast.bbox.e - 1e-6;
const segs = [];
for (let i = 0, j = coast.sea[0].length - 1; i < coast.sea[0].length; j = i++) {
  const A = coast.sea[0][j];
  const B = coast.sea[0][i];
  if (onFrame({ lat: A[0], lon: A[1] }) && onFrame({ lat: B[0], lon: B[1] })) continue;
  segs.push([proj.project(A[0], A[1]), proj.project(B[0], B[1])]);
}
const coastDistM = (x, z) => {
  let best = Infinity;
  for (const [a, b] of segs) best = Math.min(best, segDist(x, z, a, b));
  return best * 4; // world units -> metres
};

// 2. what stands in the sea
const inSea = (lat, lon) => {
  const p = proj.project(lat, lon);
  return pip(p.x, p.z, seaRing);
};
let nB = 0;
let inB = 0;
for (const b of read('buildings.json').buildings) {
  nB++;
  if (b.p.some(([lat, lon]) => inSea(lat, lon))) inB++;
}
let nR = 0;
let inR = 0;
for (const f of read('roads.json').features) for (const [lat, lon] of f.pts) {
  nR++;
  if (inSea(lat, lon)) inR++;
}
let nQ = 0;
let inQ = 0;
let deepQ = 0;
if (existsSync(dataPath('quays.json'))) {
  const S = 0.25;
  for (const l of read('quays.json').lines) for (const [mx, my] of l) {
    nQ++;
    if (pip(mx * S, -my * S, seaRing)) {
      inQ++;
      deepQ = Math.max(deepQ, coastDistM(mx * S, -my * S));
    }
  }
}
console.log(`in the sea: ${inB}/${nB} buildings, ${inR}/${nR} street points, ${inQ}/${nQ} quay points (the deepest ${deepQ.toFixed(1)} m from the coast)`);
if (STRICT && inB) failed = true;

// 3. landmarks in the sea
const lines = [];
const nearLines = [];
const lms = JSON.parse(readFileSync(CITY.landmarksPath, 'utf8'));
for (const l of lms) {
  const p = proj.project(l.lat, l.lon);
  const d = coastDistM(p.x, p.z);
  if (pip(p.x, p.z, seaRing)) lines.push(`${l.id}\t${d.toFixed(0)} m\t${l.lat}, ${l.lon}`);
  else if (d < 60) nearLines.push(`${l.id}\t${d.toFixed(0)} m (land side)\t${l.lat}, ${l.lon}`);
}
console.log(lines.length ? `landmarks inside the sea polygon (${lines.length}):\n  ${lines.join('\n  ')}` : 'no landmark inside the sea polygon');
if (nearLines.length) console.log(`landmarks on land within 60 m of the coast (${nearLines.length}):\n  ${nearLines.join('\n  ')}`);
if (process.argv.includes('--write-pip')) {
  mkdirSync('/tmp/review', { recursive: true });
  writeFileSync('/tmp/review/wave1-water-pip.txt', `# landmark points inside the real sea polygon (data/coast.json, OSM coastline), id, distance to the coast, lat lon\n# written by scripts/check-coast.mjs --write-pip\n${lines.length ? lines.join('\n') : '(none inside the sea polygon)'}\n# on land within 60 m of the coast (pin close to the water):\n${nearLines.join('\n')}\n`);
  console.log('wrote /tmp/review/wave1-water-pip.txt');
}
process.exit(failed ? 1 : 0);
