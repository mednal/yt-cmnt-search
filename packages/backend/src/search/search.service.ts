import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { SearchResponse } from '@yca/shared';

import { DatabaseService, toVectorLiteral } from '../database';
import {
  EMBEDDING_PROVIDER,
  EmbeddingApiError,
  MAX_EMBEDDING_INPUT_CHARS,
} from '../embedding';
import type { EmbeddingProvider } from '../embedding';

import { SEMANTIC_CANDIDATE_POOL, toSearchResultItem } from './search.types';
import type { SearchQuery, SearchRow } from './search.types';

/**
 * Ranked comment search for one video.
 *
 * Keyword mode is Postgres full-text search. The `to_tsvector('english',
 * text)` expression is written exactly as migration 001 indexes it — any
 * drift (a different configuration, a wrapping function) silently drops the
 * GIN index and turns every search into a sequential scan.
 *
 * Semantic mode embeds the query with the same provider that embedded the
 * comments and ranks by cosine distance. It sees only comments embedded so
 * far: a video mid-embedding returns fewer results than keyword mode, which
 * is why the panel reports coverage from `GET /videos/:videoId/status`.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddings: EmbeddingProvider,
  ) {}

  async search(request: SearchQuery): Promise<SearchResponse> {
    return request.mode === 'semantic'
      ? this.semanticSearch(request)
      : this.keywordSearch(request);
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

    return this.toResponse(request, rows);
  }

  /**
   * Meaning-based search: embed the query, then rank this video's embedded
   * comments by cosine distance.
   *
   * The inner query is the whole ranking (`ORDER BY <=> ... LIMIT pool`) and
   * the outer one only pages inside it. Keeping the distance ordering next to
   * its LIMIT in one place is also what an IVFFlat/HNSW index needs to be
   * used at all, so this shape stays correct once the table is large enough
   * to want one.
   */
  private async semanticSearch(request: SearchQuery): Promise<SearchResponse> {
    const { videoId, query, limit, offset } = request;

    const vector = toVectorLiteral(await this.embedQuery(query));

    const { rows } = await this.database.query<SearchRow>(
      // Comments with no vector yet are skipped rather than treated as
      // non-matches: they are unprocessed, not irrelevant.
      //
      // `1 - distance` because the panel ranks and displays "higher is
      // better" scores; with normalised vectors (the provider L2-normalises)
      // cosine distance is in [0, 2], so this is the usual cosine similarity.
      `WITH ranked AS (
         SELECT youtube_comment_id,
                author,
                text,
                like_count,
                published_at,
                parent_comment_id,
                1 - (embedding <=> $2::vector) AS score
         FROM comments
         WHERE video_id = $1
           AND embedding IS NOT NULL
         ORDER BY embedding <=> $2::vector
         LIMIT $3
       )
       SELECT ranked.*, COUNT(*) OVER () AS total
       FROM ranked
       -- youtube_comment_id last so paging is stable when scores tie.
       ORDER BY score DESC, like_count DESC, youtube_comment_id
       LIMIT $4 OFFSET $5`,
      [videoId, vector, SEMANTIC_CANDIDATE_POOL, limit, offset],
    );

    return this.toResponse(request, rows);
  }

  /**
   * Embeds the search query itself.
   *
   * Same trimming and length cap the comments went through, so the query and
   * what it is compared against are prepared identically. A provider failure
   * is an upstream dependency failing, not a bad request — mapped to 502, as
   * the embedding pipeline does.
   */
  private async embedQuery(query: string): Promise<number[]> {
    const text = query.trim().slice(0, MAX_EMBEDDING_INPUT_CHARS);

    let vectors: number[][];
    try {
      vectors = await this.embeddings.embed([text]);
    } catch (error) {
      throw new HttpException(
        error instanceof EmbeddingApiError ? error.message : errorMessage(error),
        HttpStatus.BAD_GATEWAY,
      );
    }

    const [vector] = vectors;
    if (!vector) {
      // The provider contract is one vector per input; its own shape check
      // should have caught this already, so this is belt and braces.
      throw new HttpException(
        `Embedding provider ${this.embeddings.model} returned no vector for the query`,
        HttpStatus.BAD_GATEWAY,
      );
    }
    return vector;
  }

  private toResponse(request: SearchQuery, rows: SearchRow[]): SearchResponse {
    const { videoId, query, mode, limit, offset } = request;

    // The window function only reports a total alongside a row, so an empty
    // page (no matches, or an offset past the end) means falling back to 0.
    const [first] = rows;

    return {
      videoId,
      query,
      mode,
      total: first ? Number(first.total) : 0,
      limit,
      offset,
      results: rows.map(toSearchResultItem),
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
