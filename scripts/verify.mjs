#!/usr/bin/env node
// Single verification gate for porto-3d. Runs the repository's checks and the
// production build, and reports PASS / FAIL / SKIP for each. Any FAIL exits 1.
//
//   npm run verify
//
// A check is SKIPped when its input data has not been produced yet, so the gate
// stays honest and green while the data rounds are still in progress. As data
// lands, checks become active automatically. Do not weaken this gate to make a
// feature pass; produce the missing data or fix the check.
//
// Each check lists the files it needs. Missing inputs are reported, never
// faked; a check whose inputs exist always runs and its result always counts.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CITY = process.env.CITY || 'porto';
const has = (...parts) => existsSync(join(ROOT, ...parts));

const checks = [
  { name: 'build', cmd: ['npm', 'run', 'build'], needs: [], why: 'the app must compile' },
  {
    name: 'data contract',
    cmd: ['node', 'scripts/check-data.mjs', '--city', CITY],
    needs: ['data/landmarks.json', 'data/routes.json'],
    why: 'routes.json is authored in porto-007; check-data validates landmarks + routes together',
  },
  { name: 'geo', cmd: ['node', 'scripts/check-geo.mjs', '--city', CITY], needs: [], why: '' },
  {
    name: 'dimensions',
    cmd: ['node', 'scripts/check-dimensions.mjs', '--city', CITY],
    needs: ['data/dimensions.json', 'data/landmarks.json'],
    why: 'dimensions.json is authored in porto-004',
  },
  {
    name: '1:1 fit',
    cmd: ['node', 'scripts/check-fit.mjs', '--city', CITY],
    needs: ['data/footprints.json', 'data/landmarks.json'],
    why: 'footprints.json lands in porto-004',
  },
  { name: 'traffic', cmd: ['node', 'scripts/check-traffic.mjs', '--city', CITY], needs: ['data/roads.json'], why: '' },
  {
    name: 'models',
    cmd: ['node', 'scripts/count-tris.mjs', '--city', CITY],
    needs: ['data/footprints.json', 'data/landmarks.json', 'data/roads.json', 'data/terrain.json'],
    why: 'footprints.json lands in porto-004',
  },
];

// Behavioural smoke tests for src/life.js. They load the real module through
// Vite's SSR transform (no running server needed) and are deterministic, so
// they belong in the gate. They read Porto's generated data directly, so they
// only run for the city they were written for.
if (CITY === 'porto') {
  checks.push(
    {
      name: 'smoke life',
      cmd: ['node', 'scripts/smoke-life.mjs'],
      needs: ['data/life.json', 'data/nature.json', 'data/terrain.json', 'cities/porto.json'],
      why: '',
    },
    {
      name: 'smoke trams',
      cmd: ['node', 'scripts/smoke-trams.mjs'],
      needs: ['data/life.json', 'data/terrain.json', 'cities/porto.json'],
      why: '',
    },
    {
      name: 'smoke rail',
      cmd: ['node', 'scripts/smoke-rail.mjs'],
      needs: [
        'data/life.json',
        'data/dimensions.json',
        'data/footprints.json',
        'data/landmarks.json',
        'data/roads.json',
        'data/terrain.json',
        'cities/porto.json',
      ],
      why: '',
    },
  );
}

// Browser smoke, after the build: console errors, GL errors, buffer sizes.
// Exit code 77 means "no browser here": reported as SKIP, never PASS.
checks.push({
  name: 'smoke console',
  cmd: ['node', 'scripts/smoke-console.mjs'],
  needs: ['dist/index.html'],
  why: '',
  skipExit: 77,
});

const results = [];
let failed = 0;
let skipped = 0;

for (const check of checks) {
  const missing = check.needs.filter((f) => !has(f));
  if (missing.length) {
    skipped += 1;
    results.push({ name: check.name, status: 'SKIP' });
    console.log(`SKIP  ${check.name}  (missing: ${missing.join(', ')})${check.why ? ` — ${check.why}` : ''}`);
    continue;
  }
  console.log(`RUN   ${check.name}  ($ ${check.cmd.join(' ')})`);
  const result = spawnSync(check.cmd[0], check.cmd.slice(1), {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    failed += 1;
    results.push({ name: check.name, status: 'FAIL' });
    console.log(`FAIL  ${check.name}  (could not run: ${result.error.message})`);
  } else if (check.skipExit && result.status === check.skipExit) {
    skipped += 1;
    results.push({ name: check.name, status: 'SKIP' });
    console.log(`SKIP  ${check.name}  (no browser available)`);
  } else if (result.status === 0) {
    results.push({ name: check.name, status: 'PASS' });
    console.log(`PASS  ${check.name}`);
  } else {
    failed += 1;
    results.push({ name: check.name, status: 'FAIL' });
    console.log(`FAIL  ${check.name}  (exit ${result.status})`);
  }
}

const passed = results.filter((r) => r.status === 'PASS').length;
console.log('\nverify summary');
for (const r of results) console.log(`  ${r.status}  ${r.name}`);
console.log(
  `\nverify: ${failed ? 'FAILED' : 'OK'} — ${passed} passed, ${failed} failed, ${skipped} skipped` +
    (skipped ? ' (missing input data)' : ''),
);
process.exit(failed ? 1 : 0);
