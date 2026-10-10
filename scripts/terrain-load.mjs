// The terrain the app reads, for node scripts: data/terrain.json with the fine
// core (data/terrain-fine.bin.gz) attached as `fine`, as src/data.js does.
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dataPath } from './city-lib.mjs';
import { unpackFine } from '../src/terrain-fine.js';

export function loadTerrain() {
  const t = JSON.parse(readFileSync(dataPath('terrain.json'), 'utf8'));
  const f = dataPath('terrain-fine.bin.gz');
  if (existsSync(f)) t.fine = unpackFine(gunzipSync(readFileSync(f)));
  return t;
}
