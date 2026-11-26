// Quay decks on a quay terrace (src/terraces.js pinToTerrace, used by
// src/quays.js buildQuays): the deck lies flush with the terrace paving.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinToTerrace } from '../src/terraces.js';

// the deck's own rule: 1 m over a 3 m terrace (the Cais da Ribeira after porto-039)
const N = 20;
const tops = Array.from({ length: N }, () => 4);
const levels = tops.map((_, i) => (i >= 6 && i < 14 ? 3 : null));

test('a deck on a terrace lies at the terrace level plus the lift', () => {
  const y = pinToTerrace(tops, levels, 0.03);
  for (let i = 6; i < 14; i++) assert.equal(y[i], 3.03);
});

test('past the terrace the deck eases back to its own rule, and far away is unchanged', () => {
  const y = pinToTerrace(tops, levels, 0.03);
  assert.ok(y[5] > 3.03 && y[5] < 4, `next to the terrace: ${y[5]}`);
  assert.ok(y[4] > y[5] && y[3] > y[4], 'the ease rises away from the terrace');
  for (const i of [0, 1, 2, 17, 18, 19]) assert.equal(y[i], 4);
});

test('without a terrace the tops are unchanged', () => {
  assert.deepEqual(pinToTerrace(tops, tops.map(() => null), 0.03), tops);
});
