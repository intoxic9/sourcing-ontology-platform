import { Pool } from 'pg';

import { loadDatabaseUrl } from '../env.js';
import { assertSupportedSchema } from '../repository.js';
import {
  DEMO_WEEK2_EXTRACTED_AT,
  DEMO_WEEK2_PIPELINE_RUN_ID,
  truncateOntologyData,
} from '../reset-graph.js';
import { loadWeek2Manifest, runWeek2Ingest } from './run-week2-ingest.js';

const databaseUrl = loadDatabaseUrl();
if (databaseUrl === undefined) {
  throw new Error('DATABASE_URL is not set');
}

const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();

try {
  await assertSupportedSchema(client);
  await client.query('BEGIN');
  await truncateOntologyData(client);
  const manifest = await loadWeek2Manifest();
  const { report } = await runWeek2Ingest(client, {
    pipelineRunId: DEMO_WEEK2_PIPELINE_RUN_ID,
    extractedAt: DEMO_WEEK2_EXTRACTED_AT,
  });
  await client.query('COMMIT');

  console.log(`fixture: ${manifest.fixtureId}`);
  console.log(
    `accepted vendors=${String(report.accepted.vendors)} parts=${String(report.accepted.materials)} devices=${String(report.accepted.devices)}`,
  );
  console.log(
    `links supply=${String(report.accepted.supplyLinks)} bom=${String(report.accepted.bomLinks)}`,
  );
  console.log('rejects:', report.rejectsByCode);
  console.log('skipped links:', report.skippedLinksByCode);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
