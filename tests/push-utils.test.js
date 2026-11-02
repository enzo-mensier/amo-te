import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeNotificationUrl, normalizePushMessage } from '../push-utils.js';

test('normalizes a custom push and deduplicates selected recipients', () => {
  assert.deepEqual(normalizePushMessage({
    title: '  Coucou  ',
    body: '  Pense à notre capsule  ',
    url: '/?section=current',
    recipients: ['admin', 'partner', 'admin'],
  }), {
    title: 'Coucou',
    body: 'Pense à notre capsule',
    url: '/?section=current',
    recipients: ['admin', 'partner'],
  });
});

test('requires a title, message and at least one valid recipient', () => {
  for (const input of [
    { title: '', body: 'Bonjour', url: '/', recipients: ['admin'] },
    { title: 'Coucou', body: ' ', url: '/', recipients: ['admin'] },
    { title: 'Coucou', body: 'Bonjour', url: '/', recipients: [] },
    { title: 'Coucou', body: 'Bonjour', url: '/', recipients: ['owner'] },
  ]) {
    assert.throws(() => normalizePushMessage(input));
  }
});

test('enforces notification field length limits', () => {
  assert.throws(() => normalizePushMessage({
    title: 't'.repeat(61),
    body: 'Bonjour',
    url: '/',
    recipients: ['admin'],
  }));
  assert.throws(() => normalizePushMessage({
    title: 'Coucou',
    body: 'b'.repeat(241),
    url: '/',
    recipients: ['admin'],
  }));
});

test('only allows same-origin relative notification destinations', () => {
  for (const value of ['/', '/archives', '/?tab=current']) {
    assert.equal(isSafeNotificationUrl(value), true);
  }
  for (const value of ['https://example.com', '//example.com', 'javascript:alert(1)', '/\\example.com']) {
    assert.equal(isSafeNotificationUrl(value), false);
  }
});
