import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatAge, formatCount, formatLikes, formatScore } from './format.ts';

test('formatLikes abbreviates the way YouTube does', () => {
  assert.equal(formatLikes(0), '0');
  assert.equal(formatLikes(999), '999');
  assert.equal(formatLikes(1000), '1K');
  assert.equal(formatLikes(1234), '1.2K');
  assert.equal(formatLikes(13_400), '13K');
  assert.equal(formatLikes(1_400_000), '1.4M');
  assert.equal(formatLikes(2_500_000_000), '2.5B');
});

test('formatLikes tolerates values the API should never send', () => {
  assert.equal(formatLikes(-5), '0');
  assert.equal(formatLikes(Number.NaN), '0');
});

test('formatAge counts back from the reference time', () => {
  const now = new Date('2026-09-05T12:00:00Z');
  assert.equal(formatAge('2026-09-05T11:59:30Z', now), 'just now');
  assert.equal(formatAge('2026-09-05T11:00:00Z', now), '1 hour ago');
  assert.equal(formatAge('2026-09-02T12:00:00Z', now), '3 days ago');
  assert.equal(formatAge('2026-08-01T12:00:00Z', now), '1 month ago');
  assert.equal(formatAge('2023-09-05T12:00:00Z', now), '3 years ago');
});

test('formatAge returns null when there is no usable date', () => {
  assert.equal(formatAge(null), null);
  assert.equal(formatAge('not a date'), null);
});

test('formatScore reads similarity as a percentage and ts_rank as a number', () => {
  assert.equal(formatScore(0.8123, 'semantic'), '81% match');
  assert.equal(formatScore(0.0607, 'keyword'), '0.061');
  assert.equal(formatScore(Number.NaN, 'semantic'), '—');
});

test('formatCount separates thousands', () => {
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(2709), '2,709');
});
