import { ConfigService } from '@nestjs/config';

import {
  DEFAULT_OPENAI_MODEL,
  EMBEDDING_BATCH_SIZE,
  OPENAI_EMBEDDING_DIMENSIONS,
} from './embedding.constants';
import { EmbeddingApiError } from './embedding.types';
import { OpenAIEmbeddingProvider } from './openai-embedding.provider';

function vector(seed: number, width = OPENAI_EMBEDDING_DIMENSIONS): number[] {
  return new Array<number>(width).fill(seed);
}

/** A successful embeddings response for `count` inputs. */
function okResponse(count: number, width = OPENAI_EMBEDDING_DIMENSIONS): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: Array.from({ length: count }, (_, index) => ({
        index,
        embedding: vector(index, width),
      })),
    }),
  } as unknown as Response;
}

function errorResponse(status: number, message = 'boom'): Response {
  return {
    ok: false,
    status,
    json: async () => ({ error: { message } }),
  } as unknown as Response;
}

function configWith(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('OpenAIEmbeddingProvider', () => {
  let fetchMock: jest.Mock<Promise<Response>, Parameters<typeof fetch>>;
  let provider: OpenAIEmbeddingProvider;

  beforeEach(() => {
    // Backoff is real time; the tests that retry would otherwise take seconds.
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout);

    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    provider = new OpenAIEmbeddingProvider(
      configWith({ OPENAI_API_KEY: 'test-key' }),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('defaults to the model locked in the plan', () => {
    expect(provider.model).toBe(DEFAULT_OPENAI_MODEL);
    expect(provider.dimensions).toBe(OPENAI_EMBEDDING_DIMENSIONS);
  });

  it('honours OPENAI_EMBEDDING_MODEL when set', () => {
    const custom = new OpenAIEmbeddingProvider(
      configWith({ OPENAI_API_KEY: 'k', OPENAI_EMBEDDING_MODEL: 'other-model' }),
    );

    expect(custom.model).toBe('other-model');
  });

  it('returns an empty result without calling the API', async () => {
    await expect(provider.embed([])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails clearly when the API key is missing', async () => {
    const unconfigured = new OpenAIEmbeddingProvider(configWith({}));

    await expect(unconfigured.embed(['hi'])).rejects.toThrow(
      'OPENAI_API_KEY is not configured',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the texts and returns one vector per input', async () => {
    fetchMock.mockResolvedValue(okResponse(2));

    const vectors = await provider.embed(['a', 'b']);

    expect(vectors).toEqual([vector(0), vector(1)]);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      model: DEFAULT_OPENAI_MODEL,
      input: ['a', 'b'],
    });
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-key',
    );
  });

  it('orders vectors by the echoed index, not response order', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { index: 1, embedding: vector(1) },
          { index: 0, embedding: vector(0) },
        ],
      }),
    } as unknown as Response);

    await expect(provider.embed(['a', 'b'])).resolves.toEqual([
      vector(0),
      vector(1),
    ]);
  });

  it('splits inputs larger than one batch across requests', async () => {
    const total = EMBEDDING_BATCH_SIZE + 3;
    fetchMock
      .mockResolvedValueOnce(okResponse(EMBEDDING_BATCH_SIZE))
      .mockResolvedValueOnce(okResponse(3));

    const vectors = await provider.embed(
      Array.from({ length: total }, (_, i) => `text ${i}`),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vectors).toHaveLength(total);
  });

  it('retries a rate limit and succeeds on a later attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(429, 'Rate limit reached'))
      .mockResolvedValueOnce(okResponse(1));

    await expect(provider.embed(['a'])).resolves.toEqual([vector(0)]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a server error, then gives up with the API message', async () => {
    fetchMock.mockResolvedValue(errorResponse(503, 'upstream unavailable'));

    await expect(provider.embed(['a'])).rejects.toThrow('upstream unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a client error', async () => {
    fetchMock.mockResolvedValue(errorResponse(400, 'invalid input'));

    await expect(provider.embed(['a'])).rejects.toBeInstanceOf(EmbeddingApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a response whose vectors are the wrong width', async () => {
    fetchMock.mockResolvedValue(okResponse(1, 8));

    await expect(provider.embed(['a'])).rejects.toThrow(
      `returned a 8-dimension vector, expected ${OPENAI_EMBEDDING_DIMENSIONS}`,
    );
  });

  it('rejects a response with fewer embeddings than inputs', async () => {
    fetchMock.mockResolvedValue(okResponse(1));

    await expect(provider.embed(['a', 'b'])).rejects.toThrow(
      'returned 1 embeddings for 2 inputs',
    );
  });

  it('treats an unreachable API as retryable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    await expect(provider.embed(['a'])).rejects.toThrow('Could not reach OpenAI');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
