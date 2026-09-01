import { BadRequestException } from '@nestjs/common';
import type { SearchResponse } from '@yca/shared';

import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import type { SearchQuery } from './search.types';

describe('SearchController', () => {
  let received: SearchQuery | undefined;
  let controller: SearchController;

  beforeEach(() => {
    received = undefined;
    const service = {
      search: jest.fn(async (query: SearchQuery): Promise<SearchResponse> => {
        received = query;
        return {
          videoId: query.videoId,
          query: query.query,
          mode: query.mode,
          total: 0,
          limit: query.limit,
          offset: query.offset,
          results: [],
        };
      }),
    };
    controller = new SearchController(service as unknown as SearchService);
  });

  it('defaults to keyword mode and the first page', async () => {
    await controller.runSearch('v1', 'windows');

    expect(received).toEqual({
      videoId: 'v1',
      query: 'windows',
      mode: 'keyword',
      limit: 20,
      offset: 0,
    });
  });

  it('trims the query', async () => {
    await controller.runSearch('v1', '  windows  ');

    expect(received?.query).toBe('windows');
  });

  // Validation runs before the handler returns its promise, so these throw
  // synchronously rather than rejecting.
  it.each([undefined, '', '   '])('rejects a blank query (%p)', (q) => {
    expect(() => controller.runSearch('v1', q)).toThrow(BadRequestException);
  });

  it('accepts explicit paging', async () => {
    await controller.runSearch('v1', 'windows', 'keyword', '50', '100');

    expect(received).toMatchObject({ limit: 50, offset: 100 });
  });

  it.each(['0', '101', '-1', 'abc', '1.5'])('rejects limit=%s', (limit) => {
    expect(() => controller.runSearch('v1', 'windows', undefined, limit)).toThrow(
      BadRequestException,
    );
  });

  it('rejects a negative offset', () => {
    expect(() =>
      controller.runSearch('v1', 'windows', undefined, undefined, '-1'),
    ).toThrow(BadRequestException);
  });

  it('rejects an unknown mode', () => {
    expect(() => controller.runSearch('v1', 'windows', 'fuzzy')).toThrow(
      BadRequestException,
    );
  });

  it('passes semantic mode through for the service to handle', async () => {
    await controller.runSearch('v1', 'windows', 'semantic');

    expect(received?.mode).toBe('semantic');
  });
});
