import { ConfigService } from '@nestjs/config';

import {
  DEFAULT_LOCAL_MODEL,
  EMBEDDING_BATCH_SIZE,
  LOCAL_EMBEDDING_DIMENSIONS,
} from './embedding.constants';
import { EmbeddingApiError } from './embedding.types';
import { LocalEmbeddingProvider } from './local-embedding.provider';
import type { FeatureExtractor } from './local-embedding.provider';

function vector(seed: number, width = LOCAL_EMBEDDING_DIMENSIONS): number[] {
  return new Array<number>(width).fill(seed);
}

function configWith(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/**
 * The provider under test with the model loader replaced, so the tests cover
 * batching, caching and validation without loading 130MB of ONNX weights.
 */
class TestableProvider extends LocalEmbeddingProvider {
  public loads = 0;

  constructor(
    private readonly extractor: FeatureExtractor,
    private readonly loadFails?: Error,
    config: ConfigService = configWith({}),
  ) {
    super(config);
  }

  protected override async createExtractor(): Promise<FeatureExtractor> {
    this.loads += 1;
    if (this.loadFails) {
      throw this.loadFails;
    }
    return this.extractor;
  }
}

/** Stands in for the Transformers.js pipeline: one vector per input text. */
function fakeExtractor(width = LOCAL_EMBEDDING_DIMENSIONS): jest.Mock<
  Promise<{ tolist(): number[][] }>,
  Parameters<FeatureExtractor>
> {
  return jest.fn(
    async (
      texts: string[],
      _options: { pooling: 'mean'; normalize: boolean },
    ) => ({
      tolist: (): number[][] => texts.map((_, i) => vector(i, width)),
    }),
  );
}

describe('LocalEmbeddingProvider', () => {
  it('defaults to the local model and its dimensions', () => {
    const provider = new TestableProvider(fakeExtractor());

    expect(provider.model).toBe(DEFAULT_LOCAL_MODEL);
    expect(provider.dimensions).toBe(LOCAL_EMBEDDING_DIMENSIONS);
  });

  it('honours EMBEDDING_MODEL when set', () => {
    const provider = new TestableProvider(
      fakeExtractor(),
      undefined,
      configWith({ EMBEDDING_MODEL: 'Xenova/all-MiniLM-L6-v2' }),
    );

    expect(provider.model).toBe('Xenova/all-MiniLM-L6-v2');
  });

  it('returns an empty result without loading the model', async () => {
    const provider = new TestableProvider(fakeExtractor());

    await expect(provider.embed([])).resolves.toEqual([]);
    expect(provider.loads).toBe(0);
  });

  it('mean-pools and normalises, returning one vector per input', async () => {
    const extractor = fakeExtractor();
    const provider = new TestableProvider(extractor);

    const vectors = await provider.embed(['a', 'b']);

    expect(vectors).toEqual([vector(0), vector(1)]);
    expect(extractor).toHaveBeenCalledWith(['a', 'b'], {
      pooling: 'mean',
      normalize: true,
    });
  });

  it('loads the model once and reuses it across calls', async () => {
    const provider = new TestableProvider(fakeExtractor());

    await provider.embed(['a']);
    await provider.embed(['b']);

    expect(provider.loads).toBe(1);
  });

  it('loads the model once when concurrent calls race', async () => {
    const provider = new TestableProvider(fakeExtractor());

    await Promise.all([provider.embed(['a']), provider.embed(['b'])]);

    expect(provider.loads).toBe(1);
  });

  it('splits inputs larger than one batch across runs', async () => {
    const extractor = fakeExtractor();
    const provider = new TestableProvider(extractor);
    const total = EMBEDDING_BATCH_SIZE + 3;

    const vectors = await provider.embed(
      Array.from({ length: total }, (_, i) => `text ${i}`),
    );

    expect(extractor).toHaveBeenCalledTimes(2);
    expect(vectors).toHaveLength(total);
  });

  it('reports a failed model load and allows a later retry', async () => {
    const provider = new TestableProvider(
      fakeExtractor(),
      new Error('ENOTFOUND huggingface.co'),
    );

    await expect(provider.embed(['a'])).rejects.toThrow(
      /Could not load local model .*ENOTFOUND/,
    );
    // Not cached as a permanent failure: a transient download problem must
    // not poison the process.
    await expect(provider.embed(['a'])).rejects.toThrow(EmbeddingApiError);
    expect(provider.loads).toBe(2);
  });

  it('reports an inference failure without leaking a stack trace', async () => {
    const extractor = fakeExtractor();
    extractor.mockRejectedValue(new Error('tensor shape mismatch'));
    const provider = new TestableProvider(extractor);

    await expect(provider.embed(['a'])).rejects.toThrow(
      /failed to embed: tensor shape mismatch/,
    );
  });

  it('rejects vectors of the wrong width', async () => {
    const provider = new TestableProvider(fakeExtractor(8));

    await expect(provider.embed(['a'])).rejects.toThrow(
      `returned a 8-dimension vector, expected ${LOCAL_EMBEDDING_DIMENSIONS}`,
    );
  });
});
