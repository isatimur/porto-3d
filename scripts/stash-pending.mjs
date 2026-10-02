// Move unfinished landmark entries out of the live data files into
// data/new/pending.json (and back with --restore), so the app stays
// consistent while their texts and models are still being made.
// Usage: node scripts/stash-pending.mjs [--restore] id1 id2 ...
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { CITY, cityArg, dataRel } from './city-lib.mjs';

const args = process.argv.slice(2);
cityArg(args); // strips --city <id> (CITY is already resolved from argv)
const restore = args.includes('--restore');
const ids = args.filter((a) => !a.startsWith('--'));
const FILES = {
  landmarks: CITY.landmarks_file,
  footprints: dataRel('footprints.json'),
  dimensions: dataRel('dimensions.json'),
};
const PENDING = dataRel('new', 'pending.json');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const write = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');

const landmarks = read(FILES.landmarks);
const footprints = read(FILES.footprints);
const dimensions = read(FILES.dimensions);
const pending = existsSync(PENDING) ? read(PENDING) : { landmarks: [], footprints: {}, dimensions: {} };

if (!restore) {
  const keep = [];
  for (const l of landmarks) {
    if (ids.includes(l.id)) pending.landmarks.push(l);
    else keep.push(l);
  }
  for (const id of ids) {
    if (footprints[id]) { pending.footprints[id] = footprints[id]; delete footprints[id]; }
    if (dimensions[id]) { pending.dimensions[id] = dimensions[id]; delete dimensions[id]; }
  }
  write(FILES.landmarks, keep);
  write(FILES.footprints, footprints);
  write(FILES.dimensions, dimensions);
  write(PENDING, pending);
  console.log(`stashed ${ids.length} ids; landmarks now ${keep.length}; pending ${pending.landmarks.length}`);
} else {
  const back = ids.length ? pending.landmarks.filter((l) => ids.includes(l.id)) : pending.landmarks;
  for (const l of back) {
    if (!landmarks.find((x) => x.id === l.id)) landmarks.push(l);
    if (pending.footprints[l.id]) footprints[l.id] = pending.footprints[l.id];
    if (pending.dimensions[l.id]) dimensions[l.id] = pending.dimensions[l.id];
  }
  pending.landmarks = pending.landmarks.filter((l) => !back.includes(l));
  for (const l of back) { delete pending.footprints[l.id]; delete pending.dimensions[l.id]; }
  write(FILES.landmarks, landmarks);
  write(FILES.footprints, footprints);
  write(FILES.dimensions, dimensions);
  write(PENDING, pending);
  console.log(`restored ${back.length} ids; landmarks now ${landmarks.length}`);
}
