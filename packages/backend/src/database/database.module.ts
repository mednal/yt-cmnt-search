import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

import { DEFAULT_DATABASE_URL, PG_POOL } from './database.constants';
import { DatabaseService } from './database.service';

/**
 * Global so later feature modules (ingest, search, embed) can inject
 * DatabaseService without re-importing this module everywhere.
 *
 * The pool connects lazily, so boot does not fail when Postgres is down —
 * `GET /health` reports that instead.
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Pool =>
        new Pool({
          connectionString:
            config.get<string>('DATABASE_URL') ?? DEFAULT_DATABASE_URL,
          max: 10,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
        }),
    },
    DatabaseService,
  ],
  exports: [DatabaseService, PG_POOL],
})
export class DatabaseModule {}
