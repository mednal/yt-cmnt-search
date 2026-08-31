/**
 * Pure migration-ordering logic, kept separate from the runner so it can be
 * tested without a database.
 */

/** Numbered plain-SQL migrations: `001_name.sql`, `002_name.sql`, ... */
const MIGRATION_FILENAME = /^\d{3}_[a-z0-9_]+\.sql$/;

export function isMigrationFilename(filename: string): boolean {
  return MIGRATION_FILENAME.test(filename);
}

/**
 * Migrations not yet recorded in `schema_migrations`, in filename order.
 *
 * Filenames are zero-padded, so lexicographic order is numeric order. Throws
 * on a file that does not follow the convention rather than silently skipping
 * it — a migration that never runs is worse than a loud failure at startup.
 */
export function pendingMigrations(
  available: readonly string[],
  applied: readonly string[],
): string[] {
  const malformed = available.filter((name) => !isMigrationFilename(name));
  if (malformed.length > 0) {
    throw new Error(
      `Malformed migration filename(s): ${malformed.join(', ')}. ` +
        'Expected NNN_snake_case_name.sql',
    );
  }

  const done = new Set(applied);
  return available.filter((name) => !done.has(name)).sort();
}
