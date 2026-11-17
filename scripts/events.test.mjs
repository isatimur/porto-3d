// src/events.js: one CustomEvent on window with a stable payload, and
// nothing sent or kept anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const SOURCE = readFileSync(new URL('src/events.js', root), 'utf8');
const KEYS = ['name', 'city', 'route', 'stop', 'attempt', 'type', 'lang'];

test('emit dispatches p3d:event with the seven documented keys', async () => {
  globalThis.window = new EventTarget();
  const { emit, EVENT } = await import('../src/events.js');
  assert.equal(EVENT, 'p3d:event');
  const got = [];
  window.addEventListener(EVENT, (e) => got.push(e.detail));
  emit('quest_step_completed', { city: 'porto', route: 'from-the-tower-to-the-river', stop: 'ribeira', attempt: 2, type: 'find_on_map', lang: 'pt', extra: 'dropped' });
  emit('quest_started');
  assert.deepEqual(got[0], { name: 'quest_step_completed', city: 'porto', route: 'from-the-tower-to-the-river', stop: 'ribeira', attempt: 2, type: 'find_on_map', lang: 'pt' });
  assert.deepEqual(Object.keys(got[1]), KEYS, 'always the same keys, in order');
  assert.deepEqual(got[1], { name: 'quest_started', city: null, route: null, stop: null, attempt: null, type: null, lang: null });
  assert.ok(Object.isFrozen(got[0]), 'a listener cannot change what the next one sees');
  delete globalThis.window;
});

test('the module sends nothing, keeps nothing, reads no identity or location', () => {
  const code = SOURCE.replace(/\/\/.*$/gm, ''); // the header comment may name the listener
  for (const word of ['fetch', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'cookie', 'navigator', 'geolocation', 'location', 'import(']) {
    assert.ok(!code.includes(word), `src/events.js uses ${word}`);
  }
  assert.doesNotMatch(SOURCE, /^import /m, 'no imports: the module stays standalone');
});

test('the schema comment documents every key and every event the route fires', () => {
  for (const k of KEYS) assert.match(SOURCE, new RegExp(`^//\\s+${k}\\s`, 'm'), `schema comment: ${k}`);
  const quest = readFileSync(new URL('src/quest.js', root), 'utf8');
  const fired = new Set([...quest.matchAll(/track\('([a-z_]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...fired].sort(), ['outbound_visit_clicked', 'quest_completed', 'quest_started', 'quest_step_completed']);
  for (const name of fired) assert.ok(SOURCE.includes(`'${name}'`), `schema comment: ${name}`);
});

test('the schema comment lists every task type, and the step event carries it', async () => {
  const { TASK_TYPES } = await import('../src/quest-tasks.js');
  for (const type of TASK_TYPES) assert.ok(SOURCE.includes(`'${type}'`), `schema comment: ${type}`);
  const quest = readFileSync(new URL('src/quest.js', root), 'utf8');
  assert.match(quest, /track\('quest_step_completed', .*, task\.type\);/,'quest_step_completed passes the task type');
});
