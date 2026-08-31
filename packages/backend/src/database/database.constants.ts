/** Injection token for the shared `pg` connection pool. */
export const PG_POOL = Symbol('PG_POOL');

/**
 * Fallback used when DATABASE_URL is unset. Matches docker-compose.yml, which
 * publishes the container on 5433 to avoid clashing with a local Postgres.
 */
export const DEFAULT_DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5433/youtube_comment_ai';
