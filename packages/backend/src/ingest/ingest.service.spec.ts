import { HttpException } from '@nestjs/common';
import type { QueryResult, QueryResultRow } from 'pg';

import { DatabaseService } from '../database';
import { YoutubeApiError, YoutubeService } from '../youtube';
import type { CommentPage, FetchedComment } from '../youtube';

import { IngestService } from './ingest.service';
import type { VideoJobRow } from './video-job.types';

function comment(id: string, overrides: Partial<FetchedComment> = {}): FetchedComment {
  return {
    youtubeCommentId: id,
    author: 'Author',
    authorChannelId: null,
    text: `comment ${id}`,
    likeCount: 0,
    publishedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    parentCommentId: null,
    ...overrides,
  };
}

function row(overrides: Partial<VideoJobRow> = {}): VideoJobRow {
  return {
    video_id: 'v1',
    ingest_state: 'pending',
    ingest_page_token: null,
    comment_count: 0,
    embed_state: 'pending',
    embedded_count: 0,
    last_error: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function queryResult<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return { rows } as QueryResult<T>;
}

/**
 * Fakes the handful of query shapes `IngestService` issues, keyed by a
 * distinctive substring of the SQL. Good enough for this service's small,
 * fixed set of statements without pulling in a real Postgres.
 */
class FakeDatabase {
  public jobRow: VideoJobRow | undefined;
  public insertedCount = 0;

  // Routed by a distinctive substring rather than the exact SQL text, so
  // reformatting the service's queries doesn't break these tests.
  query = jest.fn(
    async (sql: string, _params: readonly unknown[] = []): Promise<QueryResult> => {
      if (sql.includes('INSERT INTO video_jobs')) {
        this.jobRow = row();
        return queryResult([]);
      }
      if (sql.includes("ingest_state = 'running'")) {
        this.jobRow = { ...this.jobRow!, ingest_state: 'running' };
        return queryResult([]);
      }
      if (sql.includes("ingest_state = 'error'")) {
        const [, message] = _params as [string, string];
        this.jobRow = { ...this.jobRow!, ingest_state: 'error', last_error: message };
        return queryResult([]);
      }
      if (sql.includes('ingest_page_token = $2')) {
        const [, pageToken, inserted] = _params as [string, string | null, number];
        this.jobRow = {
          ...this.jobRow!,
          ingest_page_token: pageToken,
          comment_count: this.jobRow!.comment_count + inserted,
          ingest_state: pageToken === null ? 'complete' : 'running',
          last_error: null,
          updated_at: new Date(),
        };
        return queryResult([this.jobRow]);
      }
      if (sql.includes('SELECT * FROM video_jobs')) {
        return queryResult(this.jobRow ? [this.jobRow] : []);
      }
      if (sql.includes('INSERT INTO comments')) {
        const [ids] = _params as [string[]];
        return queryResult(ids.map(() => ({ inserted: true })));
      }
      throw new Error(`FakeDatabase: unhandled query: ${sql}`);
    },
  );
}

describe('IngestService', () => {
  let db: FakeDatabase;
  let youtube: { listCommentThreads: jest.Mock<Promise<CommentPage>, [string, string | null]> };
  let service: IngestService;

  beforeEach(() => {
    db = new FakeDatabase();
    youtube = { listCommentThreads: jest.fn() };
    service = new IngestService(
      db as unknown as DatabaseService,
      youtube as unknown as YoutubeService,
    );
  });

  it('reports a not-started video without touching YouTube', async () => {
    const status = await service.status('v1');

    expect(status).toEqual({
      videoId: 'v1',
      ingestState: 'pending',
      commentCount: 0,
      embedState: 'pending',
      embeddedCount: 0,
      lastError: null,
      updatedAt: null,
    });
    expect(youtube.listCommentThreads).not.toHaveBeenCalled();
  });

  it('stays running and stores the next page token when more pages remain', async () => {
    youtube.listCommentThreads.mockResolvedValue({
      comments: [comment('c1'), comment('c2')],
      nextPageToken: 'page-2',
    });

    const result = await service.step('v1');

    expect(result).toEqual({ state: 'running', commentCount: 2, done: false });
    expect(youtube.listCommentThreads).toHaveBeenCalledWith('v1', null);
  });

  it('marks the job complete once YouTube returns no further page', async () => {
    youtube.listCommentThreads.mockResolvedValue({
      comments: [comment('c1')],
      nextPageToken: null,
    });

    const result = await service.step('v1');

    expect(result).toEqual({ state: 'complete', commentCount: 1, done: true });
  });

  it('does not call YouTube again once already complete', async () => {
    db.jobRow = row({ ingest_state: 'complete', comment_count: 5 });

    const result = await service.step('v1');

    expect(result).toEqual({ state: 'complete', commentCount: 5, done: true });
    expect(youtube.listCommentThreads).not.toHaveBeenCalled();
  });

  it('resumes from the stored page token on the next call', async () => {
    db.jobRow = row({ ingest_state: 'running', ingest_page_token: 'page-2', comment_count: 2 });
    youtube.listCommentThreads.mockResolvedValue({ comments: [comment('c3')], nextPageToken: null });

    await service.step('v1');

    expect(youtube.listCommentThreads).toHaveBeenCalledWith('v1', 'page-2');
  });

  it('records the failure and throws a gateway error when YouTube fails', async () => {
    youtube.listCommentThreads.mockRejectedValue(new YoutubeApiError('quota exceeded', 403));

    await expect(service.step('v1')).rejects.toThrow(HttpException);
    expect(db.jobRow?.ingest_state).toBe('error');
    expect(db.jobRow?.last_error).toBe('quota exceeded');
  });
});
