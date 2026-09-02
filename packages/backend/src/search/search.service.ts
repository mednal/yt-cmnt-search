import { Injectable, NotImplementedException } from '@nestjs/common';
import type { SearchResponse } from '@yca/shared';

import { DatabaseService } from '../database';

import { toSearchResultItem } from './search.types';
import type { SearchQuery, SearchRow } from './search.types';

/**
 * Ranked comment search for one video.
 *
 * Keyword mode is Postgres full-text search. The `to_tsvector('english',
 * text)` expression is written exactly as migration 001 indexes it — any
 * drift (a different configuration, a wrapping function) silently drops the
 * GIN index and turns every search into a sequential scan.
 *
 * Semantic mode lands in M6; the mode is already part of the contract so the
 * panel can be written against one endpoint.
 */
@Injectable()
export class SearchService {
  constructor(private readonly database: DatabaseService) {}

  async search(request: SearchQuery): Promise<SearchResponse> {
    if (request.mode === 'semantic') {
      throw new NotImplementedException(
        'Semantic search is not available yet — use mode=keyword.',
      );
    }
    return this.keywordSearch(request);
  }

  private async keywordSearch(request: SearchQuery): Promise<SearchResponse> {
    const { videoId, query, limit, offset } = request;

    // websearch_to_tsquery (not plainto_/to_tsquery) because the input is
    // whatever a user typed: it accepts quoted phrases, OR and -word, and
    // never raises a syntax error on stray operators.
    const { rows } = await this.database.query<SearchRow>(
      `SELECT youtube_comment_id,
              author,
              text,
              like_count,
              published_at,
              parent_comment_id,
              ts_rank(to_tsvector('english', text), websearch_to_tsquery('english', $2)) AS score,
              COUNT(*) OVER () AS total
       FROM comments
       WHERE video_id = $1
         AND to_tsvector('english', text) @@ websearch_to_tsquery('english', $2)
       -- id last so paging is stable when rank and likes tie.
       ORDER BY score DESC, like_count DESC, id
       LIMIT $3 OFFSET $4`,
      [videoId, query, limit, offset],
    );

    // The window function only reports a total alongside a row, so an empty
    // page (no matches, or an offset past the end) means falling back to 0.
    const [first] = rows;

    return {
      videoId,
      query,
      mode: 'keyword',
      total: first ? Number(first.total) : 0,
      limit,
      offset,
      results: rows.map(toSearchResultItem),
    };
  }
}
