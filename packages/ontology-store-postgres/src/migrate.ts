/**
 * Migration runner. A short script rather than node-pg-migrate: with a fixed five-table
 * schema the dependency is not earned, and hand-written SQL stays readable to a
 * reviewer (PLAN.md §2).
 *
 * Applies every numbered .sql file in migrations/ that the ledger has not recorded, in
 * filename order, one transaction per file. Postgres DDL is transactional, so a
 * migration that fails halfway leaves nothing behind and can be fixed and re-run.
 *
 * This file lives inside the store package because it imports pg and reads
 * DATABASE_URL, which nothing outside this package may do (PLAN.md §6.3).
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url);

/**
 * The runner's own ledger, and deliberately not schema_versions: this records which SQL
 * files have run, while schema_versions records which ontology schema the data conforms
 * to. Created here rather than in 001 so that 001 stays purely about the ontology.
 */
const LEDGER = `
    CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   text        NOT NULL PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
    )
`;

if (process.env['DATABASE_URL'] === undefined) {
  // Local convenience only, and only when the variable is absent, so an explicitly set
  // environment always wins over the file. CI sets DATABASE_URL directly.
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
  } catch {
    // No .env file. The explicit error below is a better message than a load failure.
  }
}

const connectionString = process.env['DATABASE_URL'];
if (connectionString === undefined || connectionString === '') {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env, and run `pnpm db:up` first.',
  );
}

const client = new Client({ connectionString });
await client.connect();

try {
  await client.query(LEDGER);

  const ledger = await client.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations',
  );
  const applied = new Set(ledger.rows.map((row) => row.filename));

  const pending = (await readdir(MIGRATIONS_DIR))
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .filter((name) => !applied.has(name));

  for (const file of pending) {
    const sql = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8');

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`migration ${file} failed and was rolled back`, { cause: error });
    }
    console.log(`applied ${file}`);
  }

  console.log(
    pending.length === 0
      ? 'no pending migrations'
      : `${String(pending.length)} migration(s) applied`,
  );
} finally {
  await client.end();
}
