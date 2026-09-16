/**
 * Loads the Week 1 seed graph. Truncates ontology data first so a second run is a
 * reset, not a unique-key failure. Leaves schema_versions and schema_migrations alone.
 */
import { Pool } from 'pg';

import { requireDatabaseUrl } from './env.js';
import { insertGraph } from './repository.js';
import { seedGraph } from './seed-data.js';

const TRUNCATE = `
    TRUNCATE audit_record_objects, links, object_properties, objects;
    DELETE FROM audit_records;
`;

const pool = new Pool({ connectionString: requireDatabaseUrl() });
const client = await pool.connect();

try {
  await client.query('BEGIN');
  await client.query(TRUNCATE);
  const audit = await insertGraph(client, seedGraph);
  await client.query('COMMIT');
  console.log(
    `seed: ${String(seedGraph.objects.length)} objects, ${String(seedGraph.links.length)} links, audit ${audit.id}`,
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
