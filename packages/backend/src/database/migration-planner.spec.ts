import { isMigrationFilename, pendingMigrations } from './migration-planner';

describe('isMigrationFilename', () => {
  it('accepts the numbered snake_case convention', () => {
    expect(isMigrationFilename('001_initial_schema.sql')).toBe(true);
    expect(isMigrationFilename('012_add_ivfflat_index.sql')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isMigrationFilename('1_initial.sql')).toBe(false);
    expect(isMigrationFilename('001-initial.sql')).toBe(false);
    expect(isMigrationFilename('001_InitialSchema.sql')).toBe(false);
    expect(isMigrationFilename('README.md')).toBe(false);
  });
});

describe('pendingMigrations', () => {
  it('returns unapplied migrations in numeric order', () => {
    const pending = pendingMigrations(
      ['003_c.sql', '001_a.sql', '002_b.sql'],
      ['001_a.sql'],
    );

    expect(pending).toEqual(['002_b.sql', '003_c.sql']);
  });

  it('returns nothing when everything is applied', () => {
    expect(pendingMigrations(['001_a.sql'], ['001_a.sql'])).toEqual([]);
  });

  it('ignores applied entries whose file is gone', () => {
    expect(pendingMigrations(['002_b.sql'], ['001_a.sql', '002_b.sql'])).toEqual(
      [],
    );
  });

  it('throws on a malformed filename rather than skipping it', () => {
    expect(() => pendingMigrations(['001_a.sql', 'oops.sql'], [])).toThrow(
      /Malformed migration filename/,
    );
  });
});
