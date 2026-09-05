import { HttpException, NotFoundException } from '@nestjs/common';
import type { QueryResult, QueryResultRow } from 'pg';

import { DatabaseService } from '../database';
import {
  EMBEDDING_BATCH_SIZE,
  EmbeddingApiError,
  LOCAL_EMBEDDING_DIMENSIONS,
} from '../embedding';
import type { EmbeddingProvider } from '../embedding';
import type { VideoJobRow } from '../ingest';

import { EmbedService } from './embed.service';

const DIMENSIONS = LOCAL_EMBEDDING_DIMENSIONS;

function vector(seed: number): number[] {
  return new Array<number>(DIMENSIONS).fill(seed);
}

function row(overrides: Partial<VideoJobRow> = {}): VideoJobRow {
  return {
    video_id: 'v1',
    ingest_state: 'complete',
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
 * Stands in for Postgres with an in-memory comment table, so the tests can
 * assert the thing that actually matters: a comment leaves the
 * `embedding IS NULL` queue once, and is never embedded twice.
 */
class FakeDatabase {
  public jobRow: VideoJobRow | undefined = row();
  public comments: { id: string; text: string; embedding: string | null }[] = [];

  query = jest.fn(
    async (sql: string, params: readonly unknown[] = []): Promise<QueryResult> => {
      if (sql.includes('SELECT * FROM video_jobs')) {
        return queryResult(this.jobRow ? [this.jobRow] : []);
      }
      if (sql.includes('WHERE video_id = $1 AND embedding IS NULL')) {
        const [, limit] = params as [string, number];
        return queryResult(
          this.comments
            .filter((c) => c.embedding === null)
            .slice(0, limit)
            .map((c) => ({ id: c.id, text: c.text })),
        );
      }
      if (sql.includes("embed_state = 'running'")) {
        this.jobRow = { ...this.jobRow!, embed_state: 'running' };
        return queryResult([]);
      }
      if (sql.includes("embed_state = 'error'")) {
        const [, message] = params as [string, string];
        this.jobRow = { ...this.jobRow!, embed_state: 'error', last_error: message };
        return queryResult([]);
      }
      if (sql.includes('UPDATE comments AS c')) {
        const [ids, vectors] = params as [string[], string[]];
        ids.forEach((id, i) => {
          const target = this.comments.find((c) => c.id === id);
          if (target) {
            target.embedding = vectors[i]!;
          }
        });
        return queryResult([]);
      }
      if (sql.includes('COUNT(*) FILTER')) {
        return queryResult([
          {
            embedded: String(this.comments.filter((c) => c.embedding !== null).length),
            remaining: String(this.comments.filter((c) => c.embedding === null).length),
          },
        ]);
      }
      if (sql.includes('SET embedded_count = $2')) {
        const [, embedded, remaining, recovering] = params as [
          string,
          number,
          number,
          boolean,
        ];
        this.jobRow = {
          ...this.jobRow!,
          embedded_count: embedded,
          embed_state: remaining === 0 ? 'complete' : 'running',
          last_error: recovering ? null : this.jobRow!.last_error,
          updated_at: new Date(),
        };
        return queryResult([]);
      }
      throw new Error(`FakeDatabase: unhandled query: ${sql}`);
    },
  );

  seedComments(count: number): void {
    this.comments = Array.from({ length: count }, (_, i) => ({
      id: String(i + 1),
      text: `comment ${i + 1}`,
      embedding: null,
    }));
  }
}

class FakeProvider implements EmbeddingProvider {
  readonly model = 'fake-model';
  readonly dimensions = DIMENSIONS;
  /** Every text handed to the provider, across all calls. */
  public seen: string[] = [];

  embed = jest.fn(async (texts: string[]): Promise<number[][]> => {
    this.seen.push(...texts);
    return texts.map((_, i) => vector(i));
  });
}

describe('EmbedService', () => {
  let db: FakeDatabase;
  let provider: FakeProvider;
  let service: EmbedService;

  beforeEach(() => {
    db = new FakeDatabase();
    provider = new FakeProvider();
    service = new EmbedService(db as unknown as DatabaseService, provider);
  });

  it('rejects a video that has never been ingested', async () => {
    db.jobRow = undefined;

    await expect(service.step('v1')).rejects.toThrow(NotFoundException);
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it('embeds one bounded batch per call and reports what remains', async () => {
    db.seedComments(EMBEDDING_BATCH_SIZE + 4);

    const first = await service.step('v1');

    expect(first).toEqual({
      state: 'running',
      embeddedCount: EMBEDDING_BATCH_SIZE,
      remaining: 4,
      done: false,
    });
    expect(provider.embed).toHaveBeenCalledTimes(1);
    expect(provider.embed.mock.calls[0]![0]).toHaveLength(EMBEDDING_BATCH_SIZE);
  });

  it('drives embedded_count to comment_count over repeated calls', async () => {
    db.seedComments(EMBEDDING_BATCH_SIZE + 4);

    await service.step('v1');
    const second = await service.step('v1');

    expect(second).toEqual({
      state: 'complete',
      embeddedCount: EMBEDDING_BATCH_SIZE + 4,
      remaining: 0,
      done: true,
    });
    expect(db.jobRow?.embed_state).toBe('complete');
    expect(db.comments.every((c) => c.embedding !== null)).toBe(true);
  });

  it('re-embeds nothing already done when a run is interrupted and retried', async () => {
    db.seedComments(EMBEDDING_BATCH_SIZE + 4);

    await service.step('v1');
    await service.step('v1');
    await service.step('v1'); // the "extra" call a driver makes after a crash

    // Every comment handed to the provider exactly once, despite three calls.
    expect(new Set(provider.seen).size).toBe(provider.seen.length);
    expect(provider.seen).toHaveLength(EMBEDDING_BATCH_SIZE + 4);
  });

  it('completes without calling the provider when nothing is pending', async () => {
    const result = await service.step('v1');

    expect(result).toEqual({
      state: 'complete',
      embeddedCount: 0,
      remaining: 0,
      done: true,
    });
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it('picks up comments a later ingest page added after reaching complete', async () => {
    db.seedComments(1);
    await service.step('v1');
    expect(db.jobRow?.embed_state).toBe('complete');

    db.comments.push({ id: '2', text: 'a newly ingested comment', embedding: null });
    const result = await service.step('v1');

    expect(result).toEqual({
      state: 'complete',
      embeddedCount: 2,
      remaining: 0,
      done: true,
    });
  });

  it('records the failure and throws a gateway error when the provider fails', async () => {
    db.seedComments(2);
    provider.embed.mockRejectedValue(new EmbeddingApiError('rate limit reached', 429));

    await expect(service.step('v1')).rejects.toThrow(HttpException);
    expect(db.jobRow?.embed_state).toBe('error');
    expect(db.jobRow?.last_error).toBe('rate limit reached');
    // Nothing was written, so the batch is still queued for the next call.
    expect(db.comments.every((c) => c.embedding === null)).toBe(true);
  });

  it('clears its own error once a later batch succeeds', async () => {
    db.seedComments(1);
    provider.embed.mockRejectedValueOnce(new EmbeddingApiError('rate limit reached', 429));

    await expect(service.step('v1')).rejects.toThrow(HttpException);
    await service.step('v1');

    expect(db.jobRow?.embed_state).toBe('complete');
    expect(db.jobRow?.last_error).toBeNull();
  });

  it('sends trimmed, non-empty text to the provider', async () => {
    db.comments = [
      { id: '1', text: '  padded  ', embedding: null },
      { id: '2', text: '   ', embedding: null },
    ];

    await service.step('v1');

    expect(provider.embed).toHaveBeenCalledWith(['padded', ' ']);
  });

  it('writes vectors as pgvector literals against the right comment ids', async () => {
    db.seedComments(2);

    await service.step('v1');

    expect(db.comments[0]!.embedding).toBe(`[${vector(0).join(',')}]`);
    expect(db.comments[1]!.embedding).toBe(`[${vector(1).join(',')}]`);
  });

  it('refuses to write a batch when the provider returns the wrong count', async () => {
    db.seedComments(2);
    provider.embed.mockResolvedValue([vector(0)]);

    await expect(service.step('v1')).rejects.toThrow(HttpException);
    expect(db.comments.every((c) => c.embedding === null)).toBe(true);
  });
});
