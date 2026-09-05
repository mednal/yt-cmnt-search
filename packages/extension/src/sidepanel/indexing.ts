/**
 * Drives one video from "nothing stored" to "fully searchable".
 *
 * The backend deliberately does no long-running work of its own: each call to
 * `/ingest` fetches one page and each call to `/embed` embeds one batch, both
 * persisting progress before returning (IMPLEMENTATION_PLAN.md §2). Something
 * has to call them until they report `done`, and for this milestone that
 * caller is the panel.
 *
 * A run is therefore interruptible at every step boundary — closing the panel,
 * switching video or pressing Stop abandons it, and the next run resumes from
 * the durable state in Postgres rather than starting over.
 */
import { runEmbedStep, runIngestStep } from './api.ts';

export interface IndexingProgress {
  phase: 'ingesting' | 'embedding';
  /** Comments stored so far. */
  commentCount: number;
  /** Of those, how many have a vector. */
  embeddedCount: number;
}

export type IndexingOutcome = 'complete' | 'cancelled';

export class IndexingRun {
  private stopped = false;

  constructor(
    readonly videoId: string,
    private readonly onProgress: (progress: IndexingProgress) => void,
    private commentCount = 0,
    private embeddedCount = 0,
  ) {}

  /** Takes effect at the next step boundary; the step in flight still lands. */
  cancel(): void {
    this.stopped = true;
  }

  /**
   * Fetches every remaining page, then embeds every remaining comment.
   *
   * Ingestion runs to completion first because embedding is driven by
   * `embedding IS NULL`: comments that arrive later are simply picked up by a
   * later batch, so interleaving the two would buy nothing but a longer wait
   * before keyword search is usable.
   *
   * Rejects with `ApiError` on a failed step. The partial work already
   * persisted stays valid — calling `run` again resumes from it.
   */
  async run(): Promise<IndexingOutcome> {
    for (;;) {
      if (this.stopped) {
        return 'cancelled';
      }
      const result = await runIngestStep(this.videoId);
      this.commentCount = result.commentCount;
      this.report('ingesting');
      if (result.done) {
        break;
      }
    }

    for (;;) {
      if (this.stopped) {
        return 'cancelled';
      }
      const result = await runEmbedStep(this.videoId);
      this.embeddedCount = result.embeddedCount;
      this.report('embedding');
      if (result.done) {
        break;
      }
    }

    return this.stopped ? 'cancelled' : 'complete';
  }

  private report(phase: IndexingProgress['phase']): void {
    if (!this.stopped) {
      this.onProgress({
        phase,
        commentCount: this.commentCount,
        embeddedCount: this.embeddedCount,
      });
    }
  }
}
