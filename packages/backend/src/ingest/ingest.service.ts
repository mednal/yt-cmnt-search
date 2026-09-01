import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { IngestStepResponse, VideoJobStatus } from '@yca/shared';

import { DatabaseService } from '../database';
import type { CommentPage, FetchedComment } from '../youtube';
import { YoutubeApiError, YoutubeService } from '../youtube';

import { toVideoJobStatus } from './video-job.types';
import type { VideoJobRow } from './video-job.types';

/**
 * Drives comment ingestion one bounded step at a time.
 *
 * Each call to `step()` fetches exactly one page from YouTube, upserts it,
 * and persists progress to `video_jobs` before returning. There is no
 * in-process loop over pages — the caller (the side panel, or curl) is what
 * walks a video to completion by calling repeatedly. This is what makes a
 * crash mid-ingest lose at most one page: the next call resumes from the
 * stored `ingest_page_token`. See IMPLEMENTATION_PLAN.md §2.
 */
@Injectable()
export class IngestService {
  constructor(
    private readonly database: DatabaseService,
    private readonly youtube: YoutubeService,
  ) {}

  async status(videoId: string): Promise<VideoJobStatus> {
    const job = await this.findJob(videoId);
    if (!job) {
      return {
        videoId,
        ingestState: 'pending',
        commentCount: 0,
        embedState: 'pending',
        embeddedCount: 0,
        lastError: null,
        updatedAt: null,
      };
    }
    return toVideoJobStatus(job);
  }

  async step(videoId: string): Promise<IngestStepResponse> {
    const job = await this.ensureJob(videoId);

    // Already finished a previous run: don't spend YouTube quota re-checking.
    if (job.ingest_state === 'complete') {
      return {
        state: 'complete',
        commentCount: job.comment_count,
        done: true,
      };
    }

    await this.database.query(
      `UPDATE video_jobs SET ingest_state = 'running', updated_at = now() WHERE video_id = $1`,
      [videoId],
    );

    const page = await this.fetchPage(videoId, job.ingest_page_token);
    const inserted = await this.upsertComments(videoId, page.comments);

    const { rows } = await this.database.query<VideoJobRow>(
      `UPDATE video_jobs
       SET ingest_page_token = $2,
           comment_count = comment_count + $3,
           ingest_state = CASE WHEN $2::text IS NULL THEN 'complete' ELSE 'running' END,
           last_error = NULL,
           updated_at = now()
       WHERE video_id = $1
       RETURNING *`,
      [videoId, page.nextPageToken, inserted],
    );

    const updated = rows[0];
    if (!updated) {
      // video_jobs is keyed by video_id and this UPDATE targets a row we
      // just confirmed exists a few lines up; nothing else deletes rows.
      throw new Error(`video_jobs row for ${videoId} vanished mid-step`);
    }

    return {
      state: updated.ingest_state,
      commentCount: updated.comment_count,
      done: updated.ingest_state === 'complete',
    };
  }

  /** Calls YouTube, recording (and rethrowing) a mapped failure on error. */
  private async fetchPage(
    videoId: string,
    pageToken: string | null,
  ): Promise<CommentPage> {
    try {
      return await this.youtube.listCommentThreads(videoId, pageToken);
    } catch (error) {
      const message =
        error instanceof YoutubeApiError ? error.message : errorMessage(error);

      await this.database.query(
        `UPDATE video_jobs SET ingest_state = 'error', last_error = $2, updated_at = now() WHERE video_id = $1`,
        [videoId, message],
      );

      // Reported as a gateway failure regardless of YouTube's own status
      // code: from this API's point of view, YouTube is an upstream
      // dependency that failed, not the client's request being malformed.
      throw new HttpException(message, HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Upserts one page of comments, keyed by `youtube_comment_id` (idempotent
   * — safe to re-run after a crash). Returns the count of rows that were
   * newly inserted (as opposed to updated), via Postgres's `xmax = 0` trick,
   * so `comment_count` never double-counts on a retried page.
   */
  private async upsertComments(
    videoId: string,
    comments: FetchedComment[],
  ): Promise<number> {
    if (comments.length === 0) {
      return 0;
    }

    const videoIds = comments.map(() => videoId);
    const { rows } = await this.database.query<{ inserted: boolean }>(
      `INSERT INTO comments (
         youtube_comment_id, video_id, author, author_channel_id, text,
         like_count, published_at, updated_at, parent_comment_id
       )
       SELECT * FROM UNNEST(
         $1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
         $6::int[], $7::timestamptz[], $8::timestamptz[], $9::text[]
       )
       ON CONFLICT (youtube_comment_id) DO UPDATE SET
         author = EXCLUDED.author,
         author_channel_id = EXCLUDED.author_channel_id,
         text = EXCLUDED.text,
         like_count = EXCLUDED.like_count,
         updated_at = EXCLUDED.updated_at
       RETURNING (xmax = 0) AS inserted`,
      [
        comments.map((c) => c.youtubeCommentId),
        videoIds,
        comments.map((c) => c.author),
        comments.map((c) => c.authorChannelId),
        comments.map((c) => c.text),
        comments.map((c) => c.likeCount),
        comments.map((c) => c.publishedAt),
        comments.map((c) => c.updatedAt),
        comments.map((c) => c.parentCommentId),
      ],
    );

    return rows.filter((row) => row.inserted).length;
  }

  private async findJob(videoId: string): Promise<VideoJobRow | undefined> {
    const { rows } = await this.database.query<VideoJobRow>(
      'SELECT * FROM video_jobs WHERE video_id = $1',
      [videoId],
    );
    return rows[0];
  }

  private async ensureJob(videoId: string): Promise<VideoJobRow> {
    const existing = await this.findJob(videoId);
    if (existing) {
      return existing;
    }

    await this.database.query(
      'INSERT INTO video_jobs (video_id) VALUES ($1) ON CONFLICT (video_id) DO NOTHING',
      [videoId],
    );

    const created = await this.findJob(videoId);
    if (!created) {
      throw new Error(`video_jobs row for ${videoId} missing immediately after insert`);
    }
    return created;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
