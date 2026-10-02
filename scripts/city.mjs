// Run the data pipeline of one city, step by step.
// Node 22, no dependencies.
//
//   npm run city -- guimaraes                 (or: node scripts/city.mjs guimaraes)
//   node scripts/city.mjs --city guimaraes
//
// Steps, in order (each is `node scripts/<step>.mjs --city <id>`):
//   terrain, buildings, ms-buildings, roads, nature, tiles, traffic-axes, gtfs
//
// Resume: a step whose main output already exists is skipped.
//   --force        run every selected step again (and allow the Braga run)
//   --from <step>  start at this step (later steps still skip when done)
//   --only <step>  run just this step, even when its output exists
//   --dry-run      print the plan, run nothing
//
// Braga is done: without --force this script refuses to run its pipeline
// (--dry-run still works). The city id is a positional argument or --city.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(`--${f}`);
const valueOf = (f) => {
  const i = argv.indexOf(`--${f}`);
  if (i >= 0) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${f}=`));
  return eq ? eq.slice(f.length + 3) : undefined;
};
const VALUE_FLAGS = new Set(['--from', '--only', '--city']);
const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(argv[i - 1]));
const id = valueOf('city') || positional[0];
if (id) process.env.CITY = id;
const { CITY, ROOT, dataPath, dataRel, listCities } = await import('./city-lib.mjs');

const stepName = (s) => (s ? s.replace(/^fetch-/, '') : s);
const STEPS = [
  { name: 'terrain', script: 'fetch-terrain.mjs', out: 'terrain.json' },
  { name: 'buildings', script: 'fetch-buildings.mjs', out: 'buildings.json' },
  { name: 'ms-buildings', script: 'fetch-ms-buildings.mjs', out: 'buildings-ms.json' },
  { name: 'roads', script: 'fetch-roads.mjs', out: 'roads.json' },
  { name: 'nature', script: 'fetch-nature.mjs', out: 'nature.json' },
  { name: 'tiles', script: 'fetch-tiles.mjs', out: 'tiles/index.json' },
  { name: 'traffic-axes', script: 'fetch-traffic-axes.mjs', out: 'traffic-axes.json' },
  { name: 'gtfs', script: 'fetch-gtfs.mjs', out: 'gtfs/schedule.json', skip: () => (CITY.transit?.gtfs_url ? null : 'no GTFS feed configured') },
].map((s) => ({ ...s, cmd: `node scripts/${s.script} --city ${CITY.id}`, done: existsSync(dataPath(...s.out.split('/'))) }));

const from = stepName(valueOf('from'));
const only = stepName(valueOf('only'));
for (const [label, v] of [['--from', from], ['--only', only]]) {
  if (v && !STEPS.some((s) => s.name === v)) {
    console.error(`${label}: unknown step "${v}" (steps: ${STEPS.map((s) => s.name).join(', ')})`);
    process.exit(2);
  }
}
const FORCE = flag('force');
const DRY = flag('dry-run');

const selected = STEPS.filter((s, i) => {
  if (only) return s.name === only;
  if (from) return i >= STEPS.findIndex((x) => x.name === from);
  return true;
});
const statusOf = (s) => {
  if (!selected.includes(s)) return 'not selected';
  const why = s.skip?.();
  if (why) return `skip (${why})`;
  if (only || FORCE) return s.done ? 'redo (output exists)' : 'todo';
  return s.done ? 'done' : 'todo';
};

const b = CITY.core_bbox;
const g = CITY.tileGrid;
console.log(`city ${CITY.id} (${CITY.name.en}); known cities: ${listCities().join(', ')}`);
console.log(`data dir ${dataRel()}`);
console.log(`core bbox s ${b.s} w ${b.w} n ${b.n} e ${b.e}; wide bbox s ${CITY.wide_bbox.s} w ${CITY.wide_bbox.w} n ${CITY.wide_bbox.n} e ${CITY.wide_bbox.e}`);
console.log(`tile grid ${g.nx} x ${g.ny} (core ${g.coreNx} x ${g.coreNy})`);
console.log('plan:');
for (const s of STEPS) console.log(`  ${s.name.padEnd(13)} ${statusOf(s).padEnd(22)} ${s.cmd}   -> ${dataRel(...s.out.split('/'))}`);

function nextSteps() {
  const lm = CITY.landmarks_file;
  const c = CITY.landmark_candidates?.length;
  console.log('\nnext steps (not run by this script):');
  console.log(`  1. write ${lm}${c ? ` (${c} candidates in cities/${CITY.id}.json landmark_candidates)` : ''} - the landmark agents do this`);
  console.log(`  2. node scripts/fetch-footprints.mjs --city ${CITY.id}   (needs a landmark table for the city in the script)`);
  console.log(`  3. node scripts/fetch-routes.mjs --city ${CITY.id}   (needs the itineraries for the city in the script)`);
  console.log(`  4. ${dataRel('dimensions.json')}: real-world dimensions; check with node scripts/check-dimensions.mjs --city ${CITY.id}`);
  console.log(`  5. models in src/models/${CITY.id}/ (builders registered by src/models/index.${CITY.id}.js); check with node scripts/check-fit.mjs --city ${CITY.id}`);
  console.log(`  6. locales src/locales/en.${CITY.id}.js and src/locales/pt.${CITY.id}.js`);
  console.log(`  7. node scripts/make-og.mjs --city ${CITY.id}   (share pages, icons, og images)`);
}

if (DRY) {
  nextSteps();
  process.exit(0);
}
if (CITY.id === 'braga' && !FORCE) {
  console.error('\nbraga is done: its data is final. Re-run with --force to run the pipeline anyway (it overwrites data/), or use --dry-run.');
  process.exit(1);
}

let ran = 0;
for (const s of selected) {
  const why = s.skip?.();
  if (why) {
    console.log(`\n[${s.name}] skipped: ${why}`);
    continue;
  }
  if (s.done && !FORCE && !only) {
    console.log(`\n[${s.name}] done, skipping (${dataRel(...s.out.split('/'))} exists; --force to redo)`);
    continue;
  }
  console.log(`\n[${s.name}] ${s.cmd}`);
  const r = spawnSync(process.execPath, [resolve(ROOT, 'scripts', s.script), '--city', CITY.id], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, CITY: CITY.id } });
  if (r.status !== 0) {
    console.error(`\n[${s.name}] failed (exit ${r.status ?? r.signal}). Fix it and resume: node scripts/city.mjs ${CITY.id} --from ${s.name}`);
    process.exit(r.status || 1);
  }
  ran++;
}
console.log(`\n${ran} step(s) run for ${CITY.id}.`);
nextSteps();
