/**
 * The seam between the pipeline and whoever produces vectors.
 *
 * Implementations own their own batching, retrying and authentication; the
 * caller only hands over texts and gets vectors back in the same order.
 */
export interface EmbeddingProvider {
  /** Model identifier, for logs and error messages. */
  readonly model: string;

  /** Vector width every returned embedding has. */
  readonly dimensions: number;

  /**
   * Embeds `texts`, returning one vector per input, in input order.
   * Returns `[]` for an empty input without calling out to anything.
   */
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * A mapped, known failure from an embedding provider (missing key, quota,
 * malformed response, ...). `message` is safe to store as
 * `video_jobs.last_error` — never a raw stack trace, never the API key.
 */
export class EmbeddingApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'EmbeddingApiError';
  }
}

/**
 * Checks a provider's output before any of it reaches the database.
 *
 * A short batch would misalign vectors with comments, and a wrong-width one
 * would surface much later as an opaque `expected 384 dimensions` error from
 * Postgres — both are far easier to diagnose here.
 */
export function assertVectorShape(
  vectors: number[][],
  expected: number,
  dimensions: number,
  model: string,
): void {
  if (vectors.length !== expected) {
    throw new EmbeddingApiError(
      `${model} returned ${vectors.length} embeddings for ${expected} inputs`,
      502,
    );
  }

  // Indexed rather than `find`, so a missing vector is caught too instead of
  // reading as "no bad vector found".
  const bad = vectors.findIndex(
    (vector) => !Array.isArray(vector) || vector.length !== dimensions,
  );
  if (bad !== -1) {
    throw new EmbeddingApiError(
      `${model} returned a ${vectors[bad]?.length ?? 0}-dimension vector, expected ${dimensions}`,
      502,
    );
  }
}
