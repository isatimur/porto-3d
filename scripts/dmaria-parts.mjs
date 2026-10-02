// Escola Secundária D. Maria II: replace the two Microsoft ML blobs (which
// merge the whole complex into one U) with the real blocks traced from
// aerial imagery (ESRI World Imagery, z19, 0.22 m/px) in the frame of the
// one OSM building (way 473728998, the long red-roofed main block).
// u = along the main block towards NE (0 at its SW end), v = perpendicular
// towards SE (0 on the block's axis). Metres. Idempotent.
import { readFileSync, writeFileSync } from 'node:fs';

const FP = 'data/footprints.json';
const fp = JSON.parse(readFileSync(FP, 'utf8'));
const site = fp['dmaria-ii'];
const main = site.parts.find((p) => p.tag === 'building' && !p.name);
if (!main) throw new Error('main OSM block not found');

// local metres around the main block's centroid
const lat0 = main.pts.reduce((s, p) => s + p[0], 0) / main.pts.length;
const lon0 = main.pts.reduce((s, p) => s + p[1], 0) / main.pts.length;
const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
const kz = 110574;
const toXY = ([la, lo]) => [(lo - lon0) * kx, (la - lat0) * kz]; // x east, y north
const toLL = ([x, y]) => [+(lat0 + y / kz).toFixed(6), +(lon0 + x / kx).toFixed(6)];

// main-block axis from its two farthest vertices
const xy = main.pts.map(toXY);
let best = [0, 1, 0];
for (let i = 0; i < xy.length; i++) for (let j = i + 1; j < xy.length; j++) {
  const d = Math.hypot(xy[j][0] - xy[i][0], xy[j][1] - xy[i][1]);
  if (d > best[2]) best = [i, j, d];
}
let A = xy[best[0]];
let B = xy[best[1]];
if (B[1] < A[1]) [A, B] = [B, A]; // B is the NE end
const L = best[2];
const u = [(B[0] - A[0]) / L, (B[1] - A[1]) / L]; // NE
const v = [u[1], -u[0]]; // SE (right of u)
const P = (du, dv) => [A[0] + u[0] * du + v[0] * dv, A[1] + u[1] * du + v[1] * dv];
const rect = (u0, u1, v0, v1) => [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)].map(toLL);
console.log(`main block ${L.toFixed(1)} m long, bearing ${((Math.atan2(u[0], u[1]) * 180) / Math.PI).toFixed(1)}°`);

// blocks traced from the aerial (see docs/final5 aerial mosaic); heights are
// storey counts × 3.3 m plus the parapet, flat roofs unless noted
const blocks = [
  { name: 'Ala nascente (bloco NE)', tag: 'building', height_m: 9.5, roof: 'flat', pts: rect(L - 22, L + 2, 8, 56) },
  { name: 'Ala da avenida', tag: 'building', height_m: 9.5, roof: 'flat', pts: rect(18, L - 22, 42, 52) },
  { name: 'Bloco do pátio', tag: 'building', height_m: 5.5, roof: 'flat', pts: rect(48, 70, 18, 36) },
  { name: 'Bloco SW', tag: 'building', height_m: 8, roof: 'flat', pts: rect(-2, 22, 8, 30) },
  { name: 'Pavilhão gimnodesportivo', tag: 'building', height_m: 10.5, roof: 'sawtooth', pts: rect(-62, -2, 36, 72) },
  { name: 'Bloco poente', tag: 'building', height_m: 8, roof: 'gable', pts: rect(-52, -8, 3, 21) },
  { name: 'Campo de jogos', tag: 'pitch', height_m: 0, pts: rect(-24, 6, 20, 42) },
  { name: 'Pátio ajardinado', tag: 'garden', height_m: 0, pts: rect(70, L - 24, 10, 40) },
  { name: 'Recreio', tag: 'square', height_m: 0, pts: rect(22, 48, 8, 40) },
];
site.parts = site.parts.filter((p) => !/Microsoft ML footprint/.test(p.name || '') && !blocks.some((b) => b.name === p.name));
site.parts.push(...blocks);
site.height_m = 13;
// blocks traced from aerial imagery; heights are estimates (check-geo vocabulary)
site.height_source = 'estimate';
writeFileSync(FP, JSON.stringify(fp, null, 2) + '\n');
console.log(`dmaria-ii parts now: ${site.parts.map((p) => p.tag + ':' + (p.name || 'main')).join(' | ')}`);
