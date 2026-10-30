import test from 'node:test';
import assert from 'node:assert/strict';
import { getCurrentMonthKey, getNextRelease } from '../date-utils.js';

test('opens at midnight on the 25th in the configured timezone', () => {
  const now = new Date('2026-03-24T12:00:00.000Z');
  assert.equal(getNextRelease('Europe/Paris', now).toISOString(), '2026-03-24T23:00:00.000Z');
});

test('moves to next month when the current local date is the 25th', () => {
  const now = new Date('2026-03-25T00:00:00.000Z');
  assert.equal(getNextRelease('Europe/Paris', now).toISOString(), '2026-04-24T22:00:00.000Z');
});

test('handles year rollover in the configured timezone', () => {
  const now = new Date('2026-12-31T12:00:00.000Z');
  assert.equal(getNextRelease('Europe/Paris', now).toISOString(), '2027-01-24T23:00:00.000Z');
});

test('uses the couple timezone when determining the current capsule month', () => {
  const now = new Date('2026-10-31T23:30:00.000Z');
  assert.equal(getCurrentMonthKey('Europe/Paris', now), '2026-11-01');
});
