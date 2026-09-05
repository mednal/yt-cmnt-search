/**
 * Injection token for the `EmbeddingProvider` implementation.
 *
 * Consumers inject this symbol, never a concrete provider class, so swapping
 * the provider is a one-line change in `EmbeddingModule` (locked decision 2
 * in IMPLEMENTATION_PLAN.md).
 */
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

/**
 * Local ONNX model, run in-process by Transformers.js. Chosen over a paid
 * API so the project has no per-comment cost and no key to distribute: a
 * Chrome extension can end up with more users than a free API tier allows.
 */
export const DEFAULT_LOCAL_MODEL = 'Xenova/gte-small';
export const LOCAL_EMBEDDING_DIMENSIONS = 384;

/** The paid alternative, kept available behind the same interface. */
export const DEFAULT_OPENAI_MODEL = 'text-embedding-3-small';
export const OPENAI_EMBEDDING_DIMENSIONS = 1536;

/**
 * Vector width the `comments.embedding` column stores (migration 002).
 * `EmbeddingModule` refuses to boot a provider that disagrees with this.
 */
export const SCHEMA_EMBEDDING_DIMENSIONS = LOCAL_EMBEDDING_DIMENSIONS;

/**
 * Comments embedded per provider call, and therefore per embed step. One
 * batch is a bounded unit of work: it is written to the database before the
 * next one starts, so a crash never loses completed embeddings.
 */
export const EMBEDDING_BATCH_SIZE = 96;

/**
 * Hard cap on the characters of a single comment sent for embedding. Models
 * truncate past their context window anyway (gte-small at 512 tokens); this
 * just stops a pathological comment from wasting work or failing its batch.
 */
export const MAX_EMBEDDING_INPUT_CHARS = 8_000;
