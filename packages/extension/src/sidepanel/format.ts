/**
 * Pure formatting helpers for the results list.
 *
 * Kept free of DOM and `chrome` references so they can be unit-tested by
 * `node --test` without a browser environment.
 */

/** "1.2K", "13K", "1.4M" — YouTube's own like-count shorthand. */
export function formatLikes(likes: number): string {
  if (!Number.isFinite(likes) || likes < 0) {
    return '0';
  }
  if (likes < 1000) {
    return String(Math.floor(likes));
  }

  for (const [size, suffix] of [
    [1_000_000_000, 'B'],
    [1_000_000, 'M'],
    [1_000, 'K'],
  ] as const) {
    if (likes >= size) {
      const scaled = likes / size;
      // One decimal below 10 ("1.2K"), none above it ("13K") — more precision
      // than that is noise on a comment.
      return `${scaled < 10 ? trimZero(scaled.toFixed(1)) : String(Math.floor(scaled))}${suffix}`;
    }
  }
  return String(Math.floor(likes));
}

/** "3 days ago", relative to `now`. `null` when the date is unknown. */
export function formatAge(publishedAt: string | null, now: Date = new Date()): string | null {
  if (!publishedAt) {
    return null;
  }
  const published = new Date(publishedAt);
  if (Number.isNaN(published.getTime())) {
    return null;
  }

  const seconds = Math.round((now.getTime() - published.getTime()) / 1000);
  if (seconds < 60) {
    return 'just now';
  }

  for (const [size, name] of [
    [31_536_000, 'year'],
    [2_592_000, 'month'],
    [604_800, 'week'],
    [86_400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ] as const) {
    if (seconds >= size) {
      const value = Math.floor(seconds / size);
      return `${value} ${name}${value === 1 ? '' : 's'} ago`;
    }
  }
  return 'just now';
}

/**
 * Relevance, as the panel shows it.
 *
 * Semantic scores are cosine similarity in 0..1, which reads naturally as a
 * percentage; `ts_rank` has no upper bound and no meaning outside its own
 * result set, so keyword mode gets a plain number instead of a fake percent.
 */
export function formatScore(score: number, mode: 'keyword' | 'semantic'): string {
  if (!Number.isFinite(score)) {
    return '—';
  }
  return mode === 'semantic' ? `${Math.round(score * 100)}% match` : score.toFixed(3);
}

/** "3 of 12", with the thousands separators long comment counts need. */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function trimZero(value: string): string {
  return value.endsWith('.0') ? value.slice(0, -2) : value;
}
