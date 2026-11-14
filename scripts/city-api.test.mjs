// api/_city.js takes the city id from the query string, so it must bound what it keeps.
// Run: node --test scripts/city-api.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cityConfig } from '../api/_city.js';

const CITIES = join(dirname(fileURLToPath(import.meta.url)), '..', 'cities');

test('the default city resolves', () => {
  assert.match(cityConfig()?.id ?? '', /^[a-z][a-z-]+$/);
});

test('an id longer than 40 characters is refused', () => {
  assert.equal(cityConfig('a'.repeat(40))?.id, undefined);
  assert.equal(cityConfig('a'.repeat(41)), null);
  assert.equal(cityConfig(`${cityConfig().id}${'x'.repeat(4000)}`), null);
});

test('a miss is not cached: a city added later is found', () => {
  const id = 'zz-city-api-test';
  const file = join(CITIES, `${id}.json`);
  assert.equal(cityConfig(id), null);
  writeFileSync(file, JSON.stringify({ id, origin: { lat: 41.5, lon: -8.6 } }));
  try {
    assert.equal(cityConfig(id)?.id, id);
  } finally {
    rmSync(file);
  }
});
