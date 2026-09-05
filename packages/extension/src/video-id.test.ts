import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isYouTubeHost, parseVideoId } from './video-id.ts';

test('reads the id from a watch URL', () => {
  assert.equal(parseVideoId('https://www.youtube.com/watch?v=rfscVS0vtbw'), 'rfscVS0vtbw');
});

test('ignores other query parameters and the timestamp', () => {
  assert.equal(
    parseVideoId('https://www.youtube.com/watch?list=PL123&v=rfscVS0vtbw&t=42s'),
    'rfscVS0vtbw',
  );
});

test('reads the id from shorts, live, embed and youtu.be URLs', () => {
  assert.equal(parseVideoId('https://www.youtube.com/shorts/rfscVS0vtbw'), 'rfscVS0vtbw');
  assert.equal(parseVideoId('https://www.youtube.com/live/rfscVS0vtbw?feature=share'), 'rfscVS0vtbw');
  assert.equal(parseVideoId('https://www.youtube.com/embed/rfscVS0vtbw'), 'rfscVS0vtbw');
  assert.equal(parseVideoId('https://youtu.be/rfscVS0vtbw?t=10'), 'rfscVS0vtbw');
});

test('accepts youtube subdomains', () => {
  assert.equal(parseVideoId('https://m.youtube.com/watch?v=rfscVS0vtbw'), 'rfscVS0vtbw');
  assert.equal(parseVideoId('https://music.youtube.com/watch?v=rfscVS0vtbw'), 'rfscVS0vtbw');
});

test('returns null for YouTube pages that are not a video', () => {
  assert.equal(parseVideoId('https://www.youtube.com/'), null);
  assert.equal(parseVideoId('https://www.youtube.com/feed/subscriptions'), null);
  assert.equal(parseVideoId('https://www.youtube.com/@SomeChannel'), null);
});

test('returns null for non-YouTube hosts, including look-alikes', () => {
  assert.equal(parseVideoId('https://example.com/watch?v=rfscVS0vtbw'), null);
  assert.equal(parseVideoId('https://notyoutube.com/watch?v=rfscVS0vtbw'), null);
  assert.equal(parseVideoId('https://youtube.com.evil.test/watch?v=rfscVS0vtbw'), null);
});

test('returns null for ids of the wrong shape', () => {
  assert.equal(parseVideoId('https://www.youtube.com/watch?v=tooshort'), null);
  assert.equal(parseVideoId('https://www.youtube.com/watch?v=has spaces!'), null);
  assert.equal(parseVideoId('https://www.youtube.com/watch?v='), null);
});

test('returns null for missing or malformed input', () => {
  assert.equal(parseVideoId(undefined), null);
  assert.equal(parseVideoId(null), null);
  assert.equal(parseVideoId(''), null);
  assert.equal(parseVideoId('not a url'), null);
});

test('isYouTubeHost matches youtube domains only', () => {
  assert.equal(isYouTubeHost('www.youtube.com'), true);
  assert.equal(isYouTubeHost('youtu.be'), true);
  assert.equal(isYouTubeHost('youtube.com.evil.test'), false);
});
