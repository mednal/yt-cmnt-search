import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Pool, QueryResult, QueryResultRow } from 'pg';

import { PG_POOL } from './database.constants';

/** Result of a connectivity probe, as reported by `GET /health`. */
export interface DatabaseStatus {
  status: 'ok' | 'error';
  /** Present only when `status` is `'error'`. */
  error?: string;
}

/**
 * Thin wrapper over the `pg` pool.
 *
 * Queries are raw SQL by design (no ORM), so this deliberately stays small:
 * it owns the pool lifecycle and nothing else.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(sql, params as unknown[]);
  }

  /** Never throws: a down database is a reportable state, not a crash. */
  async ping(): Promise<DatabaseStatus> {
    try {
      await this.pool.query('SELECT 1');
      return { status: 'ok' };
    } catch (error) {
      return { status: 'error', error: describeError(error) };
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
    this.logger.log('Database pool closed');
  }
}

/**
 * A readable one-line cause.
 *
 * `pg` reports a failed connection as an AggregateError with an empty
 * `message` and the real reasons in `errors`, so unwrap that; other failures
 * carry the useful detail in `code` (ECONNREFUSED, ENOTFOUND, ...).
 */
export function describeError(error: unknown): string {
  if (error instanceof AggregateError) {
    const causes = error.errors.map(describeError).filter(Boolean);
    if (causes.length > 0) {
      return [...new Set(causes)].join('; ');
    }
  }

  if (error instanceof Error) {
    const { code } = error as NodeJS.ErrnoException;
    if (error.message) {
      return code ? `${code}: ${error.message}` : error.message;
    }
    return code ?? error.name;
  }

  return String(error);
}
