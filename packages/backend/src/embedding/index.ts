export {
  DEFAULT_LOCAL_MODEL,
  DEFAULT_OPENAI_MODEL,
  EMBEDDING_BATCH_SIZE,
  EMBEDDING_PROVIDER,
  LOCAL_EMBEDDING_DIMENSIONS,
  MAX_EMBEDDING_INPUT_CHARS,
  OPENAI_EMBEDDING_DIMENSIONS,
  SCHEMA_EMBEDDING_DIMENSIONS,
} from './embedding.constants';
export { EmbeddingModule } from './embedding.module';
export { EmbeddingApiError, assertVectorShape } from './embedding.types';
export type { EmbeddingProvider } from './embedding.types';
export { LocalEmbeddingProvider } from './local-embedding.provider';
export type { FeatureExtractor } from './local-embedding.provider';
export { OpenAIEmbeddingProvider } from './openai-embedding.provider';
