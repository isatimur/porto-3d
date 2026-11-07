import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backLink } from '../src/back-to-globe.js';

test('no link when the visitor did not come from the globe', () => {
  assert.equal(backLink('', 'x', 'en'), null);
  assert.equal(backLink('?intro=0', 'x', 'en'), null);
  assert.equal(backLink('?from=somewhere', 'x', 'en'), null);
});

test('with from=globe the link points at the globe, opened at this city', () => {
  const l = backLink('?intro=1&lang=en&from=globe', 'arouca', 'en');
  assert.equal(l.href, 'https://portugal-3d.com/#from=arouca');
  assert.equal(l.label, 'Portugal in 3D');
});

test('the label follows the page language and falls back to English', () => {
  assert.equal(backLink('?from=globe', 'x', 'pt').label, 'Portugal em 3D');
  assert.equal(backLink('?from=globe', 'x', 'ru').label, 'Португалия в 3D');
  assert.equal(backLink('?from=globe', 'x', 'ja').label, 'Portugal in 3D');
});
