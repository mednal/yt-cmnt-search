import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  DEFAULT_LOCAL_MODEL,
  EMBEDDING_BATCH_SIZE,
  LOCAL_EMBEDDING_DIMENSIONS,
} from './embedding.constants';
import { EmbeddingApiError, assertVectorShape } from './embedding.types';
import type { EmbeddingProvider } from './embedding.types';

/**
 * The slice of Transformers.js this provider uses: a feature-extraction
 * pipeline returning a tensor we flatten with `tolist()`. Typed here rather
 * than imported so the model loader can be swapped in tests.
 */
export interface FeatureExtractor {
  (
    texts: string[],
    options: { pooling: 'mean'; normalize: boolean },
  ): Promise<{ tolist(): number[][] }>;
}

/**
 * `EmbeddingProvider` that runs a small ONNX sentence-transformer in this
 * Node process — no API key, no quota, no per-comment cost, works offline.
 *
 * The model is ~130MB, downloaded once into the Transformers.js cache on
 * first use and reused from disk afterwards.
 */
@Injectable()
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = LOCAL_EMBEDDING_DIMENSIONS;
  readonly model: string;

  private readonly logger = new Logger(LocalEmbeddingProvider.name);

  /**
   * Cached loader promise, not the extractor itself: concurrent first calls
   * then share one load instead of racing to initialise the model twice.
   */
  private loading?: Promise<FeatureExtractor>;

  constructor(private readonly config: ConfigService) {
    this.model =
      this.config.get<string>('EMBEDDING_MODEL') ?? DEFAULT_LOCAL_MODEL;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const extract = await this.load();

    // Bounded chunks even though this is local: one tensor per batch keeps
    // peak memory flat regardless of how much the caller passes in.
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
      const chunk = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
      let output: { tolist(): number[][] };
      try {
        // Mean pooling + L2 normalisation is what sentence-transformers does
        // for this model family; normalised vectors also make pgvector's
        // cosine distance (M6) equivalent to a dot product.
        output = await extract(chunk, { pooling: 'mean', normalize: true });
      } catch (error) {
        throw new EmbeddingApiError(
          `Local model ${this.model} failed to embed: ${errorMessage(error)}`,
          500,
        );
      }
      vectors.push(...output.tolist());
    }

    assertVectorShape(vectors, texts.length, this.dimensions, this.model);
    return vectors;
  }

  /**
   * Loads the model on first use, never at boot: a server that only serves
   * keyword search should not pay a model load, and a failed load must not
   * take the whole application down.
   */
  private load(): Promise<FeatureExtractor> {
    this.loading ??= this.createExtractor().catch((error: unknown) => {
      // Dropped so a later call can retry — a transient first-run model
      // download failure should not poison the process forever.
      this.loading = undefined;
      throw new EmbeddingApiError(
        `Could not load local model ${this.model}: ${errorMessage(error)}`,
        500,
      );
    });

    return this.loading;
  }

  /** Overridden in tests to avoid loading a real model. */
  protected async createExtractor(): Promise<FeatureExtractor> {
    this.logger.log(`Loading embedding model ${this.model}...`);
    const started = Date.now();

    // Imported here rather than at module scope so the (large) library is
    // only pulled in when embedding is actually used.
    const { pipeline } = await import('@huggingface/transformers');
    const extractor = await pipeline('feature-extraction', this.model, {
      dtype: 'fp32',
    });

    this.logger.log(`Model ready in ${Date.now() - started}ms`);
    return extractor as unknown as FeatureExtractor;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
