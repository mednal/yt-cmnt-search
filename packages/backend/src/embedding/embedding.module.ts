import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  EMBEDDING_PROVIDER,
  SCHEMA_EMBEDDING_DIMENSIONS,
} from './embedding.constants';
import { LocalEmbeddingProvider } from './local-embedding.provider';
import type { EmbeddingProvider } from './embedding.types';

/**
 * Binds the one concrete provider to the `EMBEDDING_PROVIDER` token.
 *
 * Swapping providers (OpenAI, another vendor, a different local model) means
 * changing the class built here and nothing else — plus a migration, since
 * the vector column's width has to match the new model's dimensions.
 */
@Module({
  providers: [
    {
      provide: EMBEDDING_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): EmbeddingProvider => {
        const provider = new LocalEmbeddingProvider(config);

        // Fails at boot rather than at the first write, where a mismatch
        // would surface as an opaque error from Postgres mid-ingest.
        if (provider.dimensions !== SCHEMA_EMBEDDING_DIMENSIONS) {
          throw new Error(
            `Provider ${provider.model} produces ${provider.dimensions}-dimension vectors, ` +
              `but comments.embedding stores ${SCHEMA_EMBEDDING_DIMENSIONS}. ` +
              'Add a migration changing the column width before switching providers.',
          );
        }

        return provider;
      },
    },
  ],
  exports: [EMBEDDING_PROVIDER],
})
export class EmbeddingModule {}
