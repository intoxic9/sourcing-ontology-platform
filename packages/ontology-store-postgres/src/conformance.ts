/**
 * Conformance check. Fails closed if the database is missing, if `schema_versions` is
 * empty or stale, or if the in-memory walk and the recursive CTE disagree on any
 * TraversalResult for the shared fixture — including `truncated` and `pathCount`.
 *
 * Two implementations that agree on the easy cases and disagree on truncation is the
 * exact failure this exists to catch, which is why the queries in `supplyChainQueries`
 * spend most of their time around the depth cap.
 */
import { Pool } from 'pg';

import { assertSchemaPayload, compareFixtureTraversals } from './compare.js';
import { requireDatabaseUrl } from './env.js';
import { SUPPORTED_SCHEMA_VERSION } from './index.js';

const pool = new Pool({ connectionString: requireDatabaseUrl() });
const client = await pool.connect();

try {
  await assertSchemaPayload(client);
  console.log(`conformance: schema_versions ${SUPPORTED_SCHEMA_VERSION} matches the definitions`);

  await client.query('BEGIN');
  try {
    const compared = await compareFixtureTraversals(client);
    console.log(
      `conformance: ok — ${String(compared)} queries agree between in-memory and Postgres`,
    );
  } finally {
    await client.query('ROLLBACK');
  }
} finally {
  client.release();
  await pool.end();
}
