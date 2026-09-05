import { HttpException } from '@nestjs/common';
import type { QueryResult, QueryResultRow } from 'pg';

import { DatabaseService } from '../database';
import { EmbeddingApiError } from '../embedding';
import type { EmbeddingProvider } from '../embedding';

import { SearchService } from './search.service';
import { SEMANTIC_CANDIDATE_POOL } from './search.types';
import type { SearchQuery, SearchRow } from './search.types';

function searchRow(overrides: Partial<SearchRow> = {}): SearchRow {
  return {
    youtube_comment_id: 'c1',
    author: 'Author',
    text: 'Installing on windows failed',
    like_count: 3,
    published_at: new Date('2026-01-01T00:00:00.000Z'),
    parent_comment_id: null,
    score: 0.75,
    total: '1',
    ...overrides,
  };
}

function request(overrides: Partial<SearchQuery> = {}): SearchQuery {
  return {
    videoId: 'v1',
    query: 'windows',
    mode: 'keyword',
    limit: 20,
    offset: 0,
    ...overrides,
  };
}

describe('SearchService', () => {
  let rows: SearchRow[];
  let db: { query: jest.Mock };
  let embeddings: { embed: jest.Mock; model: string; dimensions: number };
  let service: SearchService;

  beforeEach(() => {
    rows = [];
    db = {
      query: jest.fn(
        async (): Promise<QueryResult<QueryResultRow>> =>
          ({ rows }) as unknown as QueryResult<QueryResultRow>,
      ),
    };
    embeddings = {
      model: 'test-model',
      dimensions: 3,
      embed: jest.fn(async () => [[0.1, 0.2, 0.3]]),
    };
    service = new SearchService(
      db as unknown as DatabaseService,
      embeddings as unknown as EmbeddingProvider,
    );
  });

  describe('keyword mode', () => {
    it('maps rows to the shared result shape', async () => {
      rows = [searchRow({ total: '2' }), searchRow({ youtube_comment_id: 'c2', total: '2' })];

      const response = await service.search(request());

      expect(response).toEqual({
        videoId: 'v1',
        query: 'windows',
        mode: 'keyword',
        total: 2,
        limit: 20,
        offset: 0,
        results: [
          {
            youtubeCommentId: 'c1',
            author: 'Author',
            text: 'Installing on windows failed',
            likeCount: 3,
            publishedAt: '2026-01-01T00:00:00.000Z',
            parentCommentId: null,
            score: 0.75,
          },
          expect.objectContaining({ youtubeCommentId: 'c2' }),
        ],
      });
    });

    it('filters by video and passes the query and paging through as parameters', async () => {
      await service.search(request({ query: 'install error', limit: 5, offset: 10 }));

      const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('video_id = $1');
      // Same expression migration 001 indexes — see comments_text_fts_idx.
      expect(sql).toContain("to_tsvector('english', text) @@ websearch_to_tsquery('english', $2)");
      expect(sql).toContain('ts_rank(');
      expect(params).toEqual(['v1', 'install error', 5, 10]);
    });

    it('reports no matches as an empty, zero-total page', async () => {
      const response = await service.search(request({ query: 'nothingmatchesthis' }));

      expect(response.results).toEqual([]);
      expect(response.total).toBe(0);
    });

    it('handles a comment with no published date', async () => {
      rows = [searchRow({ published_at: null, parent_comment_id: 'c0' })];

      const response = await service.search(request());

      expect(response.results[0]).toMatchObject({
        publishedAt: null,
        parentCommentId: 'c0',
      });
    });

    it('does not embed anything', async () => {
      await service.search(request());

      expect(embeddings.embed).not.toHaveBeenCalled();
    });
  });

  describe('semantic mode', () => {
    const semantic = (overrides: Partial<SearchQuery> = {}): SearchQuery =>
      request({ mode: 'semantic', ...overrides });

    it('embeds the query and ranks by cosine distance over the candidate pool', async () => {
      rows = [searchRow({ score: 0.82 })];

      const response = await service.search(
        semantic({ query: 'people complaining about installation', limit: 5, offset: 10 }),
      );

      expect(embeddings.embed).toHaveBeenCalledWith([
        'people complaining about installation',
      ]);

      const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('embedding <=> $2::vector');
      expect(sql).toContain('embedding IS NOT NULL');
      expect(params).toEqual([
        'v1',
        // pgvector has no binary encoder in `pg`: the vector travels as a
        // text literal and is cast in SQL.
        '[0.1,0.2,0.3]',
        SEMANTIC_CANDIDATE_POOL,
        5,
        10,
      ]);

      expect(response.mode).toBe('semantic');
      expect(response.results[0]?.score).toBe(0.82);
    });

    it('reports an unembedded video as an empty page rather than an error', async () => {
      const response = await service.search(semantic());

      expect(response).toMatchObject({ total: 0, results: [] });
    });

    it('caps a very long query at the provider input limit', async () => {
      await service.search(semantic({ query: 'x'.repeat(20_000) }));

      const [texts] = embeddings.embed.mock.calls[0] as [string[]];
      expect(texts[0]?.length).toBe(8_000);
    });

    it('maps a provider failure to 502 without querying the database', async () => {
      embeddings.embed.mockRejectedValue(
        new EmbeddingApiError('Could not load local model', 500),
      );

      await expect(service.search(semantic())).rejects.toMatchObject({
        status: 502,
        message: 'Could not load local model',
      });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('refuses to search when the provider returns no vector', async () => {
      embeddings.embed.mockResolvedValue([]);

      await expect(service.search(semantic())).rejects.toThrow(HttpException);
      expect(db.query).not.toHaveBeenCalled();
    });
  });
});
