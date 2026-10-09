#!/usr/bin/env node
// Packs data/buildings.json into data/buildings.bin.gz (src/buildings-pack.js)
// and checks that the packed file decodes to exactly the same buildings.
//
//   node scripts/pack-buildings.mjs [--city porto] [--check]
//
// --check only verifies an existing buildings.bin.gz against buildings.json
// (npm run verify runs it). Run the pack step again whenever fetch-buildings
// writes a new buildings.json. The file is gzipped here, not by the host: the
// browser unpacks it with DecompressionStream, so its size on the wire does
// not depend on which content types a CDN compresses.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { packBuildings, unpackBuildings } from '../src/buildings-pack.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const city = argv.includes('--city') ? argv[argv.indexOf('--city') + 1] : 'porto';
const cfg = JSON.parse(readFileSync(join(ROOT, 'cities', `${city}.json`), 'utf8'));
const dir = join(ROOT, cfg.data_dir || 'data');
const jsonPath = join(dir, 'buildings.json');
const outPath = join(dir, 'buildings.bin.gz');

if (!existsSync(jsonPath)) {
  console.log(`SKIP  ${jsonPath} is missing`);
  process.exit(77);
}
const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
if (!argv.includes('--check')) {
  const bin = packBuildings(data);
  const gz = gzipSync(bin, { level: 9 });
  writeFileSync(outPath, gz);
  console.log(`packed ${data.buildings.length} buildings: ${statSync(jsonPath).size} B json -> ${bin.length} B binary -> ${gz.length} B gzip`);
}
if (!existsSync(outPath)) {
  console.log('FAIL  buildings.bin.gz is missing (run node scripts/pack-buildings.mjs)');
  process.exit(1);
}
const bin = gunzipSync(readFileSync(outPath));
const back = unpackBuildings(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
let bad = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
if (back.buildings.length !== data.buildings.length) bad++;
if (!same(back.origin, data.origin) || !same(back.bbox, data.bbox) || !same(back.hist, data.hist)) bad++;
for (let i = 0; i < data.buildings.length && bad < 5; i++) {
  const a = data.buildings[i];
  const b = back.buildings.at(i);
  // key order does not matter; values must be identical
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!same(a[k], b[k])) {
      console.log(`building ${i}: ${k} differs`, JSON.stringify(a[k]), JSON.stringify(b[k]));
      bad++;
      break;
    }
  }
}
console.log(bad ? `FAIL  buildings.bin.gz does not match buildings.json (${bad} problem(s))` : `PASS  buildings.bin.gz matches buildings.json (${data.buildings.length} buildings, every coordinate identical)`);
process.exit(bad ? 1 : 0);
