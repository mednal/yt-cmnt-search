import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  DEFAULT_OPENAI_MODEL,
  EMBEDDING_BATCH_SIZE,
  OPENAI_EMBEDDING_DIMENSIONS,
} from './embedding.constants';
import { EmbeddingApiError, assertVectorShape } from './embedding.types';
import type { EmbeddingProvider } from './embedding.types';

const EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';

/** Attempts per batch, including the first. Only 429/5xx are retried. */
const MAX_ATTEMPTS = 3;

/** Backoff before retry n (1-based): 500ms, then 1000ms. */
const RETRY_BASE_DELAY_MS = 500;

interface OpenAIEmbeddingsResponse {
  data?: { index: number; embedding: number[] }[];
}

/**
 * `EmbeddingProvider` backed by the OpenAI embeddings endpoint.
 *
 * Uses the platform `fetch` rather than the `openai` SDK, matching
 * `YoutubeService`: one POST does not justify a dependency.
 *
 * Not the bound provider — `LocalEmbeddingProvider` is, so the project costs
 * nothing to run. Kept because it is the drop-in upgrade path if embedding
 * quality ever justifies paying for it; switching back means rebinding it in
 * `EmbeddingModule` *and* a migration widening the vector column to 1536.
 */
@Injectable()
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = OPENAI_EMBEDDING_DIMENSIONS;
  readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.model =
      this.config.get<string>('OPENAI_EMBEDDING_MODEL') ?? DEFAULT_OPENAI_MODEL;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new EmbeddingApiError('OPENAI_API_KEY is not configured', 500);
    }

    // Callers are expected to stay within one batch, but the interface takes
    // an unbounded array — chunking here keeps that contract honest.
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
      const chunk = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
      vectors.push(...(await this.embedBatch(chunk, apiKey)));
    }
    return vectors;
  }

  /** One request, retried on rate limits and transient server errors. */
  private async embedBatch(
    texts: string[],
    apiKey: string,
  ): Promise<number[][]> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.requestBatch(texts, apiKey);
      } catch (error) {
        const retryable =
          error instanceof EmbeddingApiError &&
          (error.status === 429 || error.status >= 500);

        if (!retryable || attempt >= MAX_ATTEMPTS) {
          throw error;
        }
        await sleep(RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }

  private async requestBatch(
    texts: string[],
    apiKey: string,
  ): Promise<number[][]> {
    let response: Response;
    try {
      response = await fetch(EMBEDDINGS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: this.model, input: texts }),
      });
    } catch (error) {
      // Network-level failure: treated as 503 so it is retried like a 5xx.
      throw new EmbeddingApiError(
        `Could not reach OpenAI: ${error instanceof Error ? error.message : String(error)}`,
        503,
      );
    }

    if (!response.ok) {
      throw new EmbeddingApiError(
        await describeApiError(response),
        response.status,
      );
    }

    const body = (await response.json()) as OpenAIEmbeddingsResponse;
    return this.toVectors(body, texts.length);
  }

  private toVectors(
    body: OpenAIEmbeddingsResponse,
    expected: number,
  ): number[][] {
    // Ordered by the echoed `index` rather than trusting response order.
    const vectors = [...(body.data ?? [])]
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);

    assertVectorShape(vectors, expected, this.dimensions, this.model);
    return vectors;
  }
}

/** Pulls OpenAI's own error message out of the response body, if present. */
async function describeApiError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;

  return body?.error?.message ?? `OpenAI API responded ${response.status}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
