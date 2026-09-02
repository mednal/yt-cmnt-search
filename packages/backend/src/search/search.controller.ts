import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import type { SearchMode, SearchResponse } from '@yca/shared';

import { SearchService } from './search.service';
import { DEFAULT_LIMIT, MAX_LIMIT } from './search.types';

const MODES: readonly SearchMode[] = ['keyword', 'semantic'];

@Controller('videos/:videoId')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /**
   * Ranked search over the comments ingested for this video so far.
   * Searching a partially ingested video is expected — it returns what is
   * stored, not an error.
   */
  @Get('search')
  runSearch(
    @Param('videoId') videoId: string,
    @Query('q') q?: string,
    @Query('mode') mode?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<SearchResponse> {
    return this.search.search({
      videoId,
      query: parseQuery(q),
      mode: parseMode(mode),
      limit: parseBoundedInt(limit, 'limit', DEFAULT_LIMIT, 1, MAX_LIMIT),
      offset: parseBoundedInt(offset, 'offset', 0, 0, Number.MAX_SAFE_INTEGER),
    });
  }
}

function parseQuery(q: string | undefined): string {
  const query = q?.trim() ?? '';
  if (!query) {
    throw new BadRequestException('Query parameter "q" is required.');
  }
  return query;
}

function parseMode(mode: string | undefined): SearchMode {
  if (mode === undefined) {
    return 'keyword';
  }
  if (!MODES.includes(mode as SearchMode)) {
    throw new BadRequestException(
      `Unknown mode "${mode}" — expected one of: ${MODES.join(', ')}.`,
    );
  }
  return mode as SearchMode;
}

/**
 * Rejects out-of-range paging rather than clamping it: a limit of 1000 means
 * the caller expects 1000 rows, and silently returning 100 would look like
 * the end of the results.
 */
function parseBoundedInt(
  raw: string | undefined,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw === '') {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new BadRequestException(
      `Query parameter "${name}" must be an integer between ${min} and ${max}.`,
    );
  }
  return value;
}
