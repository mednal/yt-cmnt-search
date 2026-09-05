import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EmbedStepResponse } from '@yca/shared';

import { DatabaseService } from '../database';
import {
  EMBEDDING_BATCH_SIZE,
  EMBEDDING_PROVIDER,
  EmbeddingApiError,
  MAX_EMBEDDING_INPUT_CHARS,
} from '../embedding';
import type { EmbeddingProvider } from '../embedding';
import type { VideoJobRow } from '../ingest';

import { toVectorLiteral } from './embed.types';
import type { EmbedProgressRow, PendingCommentRow } from './embed.types';

/**
 * Drives embedding one bounded batch at a time.
 *
 * The work queue is the `embedding IS NULL` predicate itself — there is no
 * cursor to corrupt and no way to pay OpenAI twice for a comment already
 * embedded. Each call takes one batch, writes the vectors, then persists
 * progress; the caller repeats until `done`. See IMPLEMENTATION_PLAN.md §2.
 */
@Injectable()
export class EmbedService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(EMBEDDING_PROVIDER)
    private readonly provider: EmbeddingProvider,
  ) {}

  async step(videoId: string): Promise<EmbedStepResponse> {
    const job = await this.findJob(videoId);
    if (!job) {
      throw new NotFoundException(
        `No ingest job for video ${videoId} — POST /videos/${videoId}/ingest first.`,
      );
    }

    // Deliberately no "already complete" short-circuit like IngestService
    // has: this query is a single indexed lookup that costs nothing, and
    // re-checking is what lets embedding pick up comments a later ingest page
    // added after `embed_state` had already reached 'complete'.
    // Whether a *previous* embed step left an error behind, read before this
    // step overwrites the state — see `saveProgress`.
    const recovering = job.embed_state === 'error';

    const pending = await this.selectPending(videoId);
    if (pending.length === 0) {
      return this.saveProgress(videoId, recovering);
    }

    await this.database.query(
      `UPDATE video_jobs SET embed_state = 'running', updated_at = now() WHERE video_id = $1`,
      [videoId],
    );

    const vectors = await this.embed(videoId, pending);
    await this.writeVectors(pending, vectors);

    return this.saveProgress(videoId, recovering);
  }

  /** Next batch of this video's comments that have no vector yet. */
  private async selectPending(videoId: string): Promise<PendingCommentRow[]> {
    const { rows } = await this.database.query<PendingCommentRow>(
      // Ordered by length, not id: the model pads every text in a batch out
      // to the longest one in it, so mixing a 5000-character comment in with
      // 95 short ones costs as much as 96 long ones. Grouping similar lengths
      // measured ~10x faster on real data. Any order is correct — the work
      // queue is the `embedding IS NULL` predicate, not a cursor — and `id`
      // breaks ties so a batch is deterministic.
      // Driven by comments_pending_embedding_idx, whose partial WHERE keeps
      // the sorted set to just this video's unembedded rows.
      `SELECT id, text
       FROM comments
       WHERE video_id = $1 AND embedding IS NULL
       ORDER BY length(text), id
       LIMIT $2`,
      [videoId, EMBEDDING_BATCH_SIZE],
    );
    return rows;
  }

  /** Calls the provider, recording (and rethrowing) a mapped failure. */
  private async embed(
    videoId: string,
    pending: PendingCommentRow[],
  ): Promise<number[][]> {
    try {
      return await this.provider.embed(pending.map((row) => prepare(row.text)));
    } catch (error) {
      const message =
        error instanceof EmbeddingApiError ? error.message : errorMessage(error);

      await this.database.query(
        `UPDATE video_jobs SET embed_state = 'error', last_error = $2, updated_at = now() WHERE video_id = $1`,
        [videoId, message],
      );

      // Same reasoning as ingest: the embedding provider is an upstream
      // dependency that failed, not a malformed client request.
      throw new HttpException(message, HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Writes one batch of vectors in a single statement. Rows leave the
   * `embedding IS NULL` queue here and never come back, which is what makes
   * an interrupted run re-embed nothing already done.
   */
  private async writeVectors(
    pending: PendingCommentRow[],
    vectors: number[][],
  ): Promise<void> {
    if (vectors.length !== pending.length) {
      // The provider contract is one vector per input; a mismatch would
      // silently misalign vectors with comments, so refuse to write.
      throw new HttpException(
        `Embedding provider returned ${vectors.length} vectors for ${pending.length} comments`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    await this.database.query(
      // pgvector has no binary encoder in the `pg` driver, so vectors travel
      // as text literals and are cast here.
      `UPDATE comments AS c
       SET embedding = v.embedding::vector
       FROM UNNEST($1::bigint[], $2::text[]) AS v(id, embedding)
       WHERE c.id = v.id`,
      [pending.map((row) => row.id), vectors.map(toVectorLiteral)],
    );
  }

  /**
   * Recounts progress from `comments` and stores it on the job.
   *
   * Counting rather than incrementing keeps `embedded_count` exact no matter
   * how a step was interrupted or retried. `complete` means "no stored
   * comment lacks a vector" — for a video whose ingest is still running, more
   * comments (and so more work) can appear afterwards.
   *
   * `recovering` says this step started from a failed embed, and is the only
   * case that clears `last_error`: the column is shared with ingest, so a
   * successful embed must not erase an ingest failure the panel still needs.
   */
  private async saveProgress(
    videoId: string,
    recovering: boolean,
  ): Promise<EmbedStepResponse> {
    const { rows } = await this.database.query<EmbedProgressRow>(
      `SELECT COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS embedded,
              COUNT(*) FILTER (WHERE embedding IS NULL)     AS remaining
       FROM comments
       WHERE video_id = $1`,
      [videoId],
    );

    const embeddedCount = Number(rows[0]?.embedded ?? 0);
    const remaining = Number(rows[0]?.remaining ?? 0);
    const done = remaining === 0;

    await this.database.query(
      `UPDATE video_jobs
       SET embedded_count = $2,
           embed_state = CASE WHEN $3::int = 0 THEN 'complete' ELSE 'running' END,
           last_error = CASE WHEN $4::boolean THEN NULL ELSE last_error END,
           updated_at = now()
       WHERE video_id = $1`,
      [videoId, embeddedCount, remaining, recovering],
    );

    return {
      state: done ? 'complete' : 'running',
      embeddedCount,
      remaining,
      done,
    };
  }

  private async findJob(videoId: string): Promise<VideoJobRow | undefined> {
    const { rows } = await this.database.query<VideoJobRow>(
      'SELECT * FROM video_jobs WHERE video_id = $1',
      [videoId],
    );
    return rows[0];
  }
}

/**
 * Makes one comment safe to embed: trimmed, length-capped, never empty.
 *
 * An empty input is rejected by the API, and a comment that can never be
 * embedded would sit in the `embedding IS NULL` queue forever, so a
 * whitespace-only comment is sent as a single space instead.
 */
function prepare(text: string): string {
  const trimmed = text.trim().slice(0, MAX_EMBEDDING_INPUT_CHARS);
  return trimmed.length > 0 ? trimmed : ' ';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
