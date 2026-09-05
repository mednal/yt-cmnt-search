/**
 * Types shared by the backend and the extension.
 *
 * These are the API request/response contracts (M3: ingestion status;
 * M4: search; M5: embedding).
 */

/** Lifecycle of one asynchronous, resumable job step (ingest or embed). */
export type JobState = 'pending' | 'running' | 'complete' | 'error';

/** `GET /videos/:videoId/status` — the full `video_jobs` row. */
export interface VideoJobStatus {
  videoId: string;
  ingestState: JobState;
  commentCount: number;
  embedState: JobState;
  embeddedCount: number;
  lastError: string | null;
  /** `null` when the job has not started yet (no ingest/embed call made). */
  updatedAt: string | null;
}

/** `POST /videos/:videoId/ingest` — result of one bounded ingest step. */
export interface IngestStepResponse {
  state: JobState;
  commentCount: number;
  /** `true` once every comment page has been fetched. */
  done: boolean;
}

/** `POST /videos/:videoId/embed` — result of one bounded embedding batch. */
export interface EmbedStepResponse {
  state: JobState;
  /** Comments of this video that now have a vector. */
  embeddedCount: number;
  /** Comments still waiting for one, after this batch. */
  remaining: number;
  /** `true` once every stored comment is embedded. */
  done: boolean;
}

/**
 * How a search query is matched.
 *
 * `keyword` is Postgres full-text matching; `semantic` compares embeddings
 * (M6) and only covers comments embedded so far.
 */
export type SearchMode = 'keyword' | 'semantic';

/** One matching comment. */
export interface SearchResultItem {
  /** YouTube's own comment id — what M9 uses to jump to the comment. */
  youtubeCommentId: string;
  author: string;
  text: string;
  likeCount: number;
  publishedAt: string | null;
  /** `null` for a top-level comment, the thread's id for a reply. */
  parentCommentId: string | null;
  /**
   * Relevance, higher is better: `ts_rank` in keyword mode, cosine
   * similarity in semantic mode. Comparable within a response, not across
   * modes.
   */
  score: number;
}

/** `GET /videos/:videoId/search` — one page of ranked results. */
export interface SearchResponse {
  videoId: string;
  query: string;
  mode: SearchMode;
  /** Total matches for the query, not just those on this page. */
  total: number;
  limit: number;
  offset: number;
  results: SearchResultItem[];
}
