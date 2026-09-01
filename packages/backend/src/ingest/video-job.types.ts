import type { JobState, VideoJobStatus } from '@yca/shared';

/** Raw `video_jobs` row, as returned by `pg` (snake_case columns). */
export interface VideoJobRow {
  video_id: string;
  ingest_state: JobState;
  ingest_page_token: string | null;
  comment_count: number;
  embed_state: JobState;
  embedded_count: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export function toVideoJobStatus(row: VideoJobRow): VideoJobStatus {
  return {
    videoId: row.video_id,
    ingestState: row.ingest_state,
    commentCount: row.comment_count,
    embedState: row.embed_state,
    embeddedCount: row.embedded_count,
    lastError: row.last_error,
    updatedAt: row.updated_at.toISOString(),
  };
}
