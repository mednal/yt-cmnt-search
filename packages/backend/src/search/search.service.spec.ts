import { NotImplementedException } from '@nestjs/common';
import type { QueryResult, QueryResultRow } from 'pg';

import { DatabaseService } from '../database';

import { SearchService } from './search.service';
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
  let service: SearchService;

  beforeEach(() => {
    rows = [];
    db = {
      query: jest.fn(
        async (): Promise<QueryResult<QueryResultRow>> =>
          ({ rows }) as unknown as QueryResult<QueryResultRow>,
      ),
    };
    service = new SearchService(db as unknown as DatabaseService);
  });

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

  it('rejects semantic mode until M6, without querying the database', async () => {
    await expect(service.search(request({ mode: 'semantic' }))).rejects.toThrow(
      NotImplementedException,
    );
    expect(db.query).not.toHaveBeenCalled();
  });
});
