// Add the Largo do Pópulo square (OSM way 363504384) and the Campo da Vinha
// garden (way 287120520) as parts of the Pópulo footprint, from an Overpass
// `out geom` dump saved at /tmp/populo-square.json. Idempotent.
import { readFileSync, writeFileSync } from 'node:fs';
import { dataRel } from './city-lib.mjs';

const FP = dataRel('footprints.json'); // Braga-specific content (populo); --city only moves the path
const fp = JSON.parse(readFileSync(FP, 'utf8'));
const dump = JSON.parse(readFileSync(process.argv[2] || '/tmp/populo-square.json', 'utf8'));
const want = { 363504384: { tag: 'square', name: 'Largo do Pópulo', height_m: 0 }, 287120520: { tag: 'garden', name: 'Campo da Vinha', height_m: 0 } };
const parts = fp.populo.parts;
let added = 0;
for (const e of dump.elements) {
  const w = want[e.id];
  if (!w) continue;
  if (parts.some((p) => p.osm_id === e.id)) continue;
  const pts = e.geometry.map((g) => [+g.lat.toFixed(6), +g.lon.toFixed(6)]);
  parts.push({ tag: w.tag, name: w.name, height_m: w.height_m, osm_id: e.id, pts });
  added++;
}
writeFileSync(FP, JSON.stringify(fp, null, 2) + '\n');
console.log(`populo parts: +${added}, now ${parts.length}`);
