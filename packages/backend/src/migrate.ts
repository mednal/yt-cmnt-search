/**
 * Migration runner: applies `migrations/NNN_*.sql` in order, once each.
 *
 * Run with `npm run migrate` from packages/backend. Standalone on purpose —
 * schema changes should not require booting the Nest application.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { Client } from 'pg';

import { DEFAULT_DATABASE_URL } from './database/database.constants';
import { pendingMigrations } from './database/migration-planner';

const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

/** Arbitrary constant key; serialises concurrent runners against each other. */
const ADVISORY_LOCK_KEY = 8_675_309;

const LEDGER = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

async function main(): Promise<void> {
  const client = new Client({
    connectionString: process.env['DATABASE_URL'] ?? DEFAULT_DATABASE_URL,
  });

  await client.connect();

  try {
    // Held for the whole run and released with the session, so a crashed
    // runner does not leave the lock stuck.
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await client.query(LEDGER);

    const files = (await readdir(MIGRATIONS_DIR)).filter((name) =>
      name.endsWith('.sql'),
    );
    const { rows } = await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations',
    );

    const pending = pendingMigrations(
      files,
      rows.map((row) => row.filename),
    );

    if (pending.length === 0) {
      console.log('Schema up to date; no migrations to apply.');
      return;
    }

    for (const filename of pending) {
      const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8');

      // One transaction per migration: a failure rolls back that file only,
      // and everything before it stays applied and recorded.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [filename],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(
          `Migration ${filename} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      console.log(`Applied ${filename}`);
    }

    console.log(`Done: ${pending.length} migration(s) applied.`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
