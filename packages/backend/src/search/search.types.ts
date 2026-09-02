import type { SearchMode, SearchResultItem } from '@yca/shared';

/** Default and maximum page sizes for `GET /videos/:videoId/search`. */
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

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
