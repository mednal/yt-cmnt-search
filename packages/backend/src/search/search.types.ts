import type { SearchMode, SearchResultItem } from '@yca/shared';

/** Default and maximum page sizes for `GET /videos/:videoId/search`. */
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/**
 * How many nearest comments semantic mode ranks before paging.
 *
 * Cosine distance is defined for *every* embedded comment, so unlike keyword
 * mode there is no natural set of "matches" to count: a video with 2700
 * embedded comments would otherwise report 2700 results, almost all of them
 * unrelated. Semantic mode therefore answers a bounded question — the best
 * `SEMANTIC_CANDIDATE_POOL` comments — and pages within that. `total` is the
 * size of that pool, so paging past it is the end of the results, not a gap.
 *
 * An absolute similarity cut-off was the alternative and was rejected: the
 * threshold that separates related from unrelated moves with the model and
 * with how chatty a video's comments are, so it would need re-tuning to stay
 * meaningful. A fixed pool degrades gracefully instead — the ranking is still
 * right, the tail is just weaker.
 */
export const SEMANTIC_CANDIDATE_POOL = 200;

/** A validated search request, as handed to `SearchService`. */
export interface SearchQuery {
  videoId: string;
  /** Trimmed, non-empty. */
  query: string;
  mode: SearchMode;
  limit: number;
  offset: number;
}

/** Raw search row, as returned by `pg` (snake_case columns). */
export interface SearchRow {
  youtube_comment_id: string;
  author: string;
  text: string;
  like_count: number;
  published_at: Date | null;
  parent_comment_id: string | null;
  score: number;
  /** `COUNT(*) OVER ()`: a bigint, which `pg` hands back as a string. */
  total: string;
}

export function toSearchResultItem(row: SearchRow): SearchResultItem {
  return {
    youtubeCommentId: row.youtube_comment_id,
    author: row.author,
    text: row.text,
    likeCount: row.like_count,
    publishedAt: row.published_at?.toISOString() ?? null,
    parentCommentId: row.parent_comment_id,
    score: row.score,
  };
}
