/**
 * Types shared by the backend and the extension.
 *
 * These are the API request/response contracts (M3: ingestion status; M4:
 * search lands here next).
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
