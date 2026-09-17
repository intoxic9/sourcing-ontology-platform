/**
 * Loads the demo graph from Week 2 SAP CSV fixtures (not the Week 1 in-memory seed).
 * Truncates ontology data first so re-runs and ingest do not stack two graphs.
 */
import { Pool } from 'pg';

import { requireDatabaseUrl } from './env.js';
import { runWeek2Ingest } from './ingest/run-week2-ingest.js';
import {
  DEMO_WEEK2_EXTRACTED_AT,
  DEMO_WEEK2_PIPELINE_RUN_ID,
  truncateOntologyData,
} from './reset-graph.js';

const pool = new Pool({ connectionString: requireDatabaseUrl() });
const client = await pool.connect();

try {
  await client.query('BEGIN');
  await truncateOntologyData(client);
  const { plan, report } = await runWeek2Ingest(client, {
    pipelineRunId: DEMO_WEEK2_PIPELINE_RUN_ID,
    extractedAt: DEMO_WEEK2_EXTRACTED_AT,
  });
  await client.query('COMMIT');
  console.log(
    `seed: Week 2 ingest — ${String(plan.suppliers.length)} suppliers, ${String(plan.parts.length)} parts, ${String(plan.devices.length)} devices, ${String(plan.links.length)} links`,
  );
  console.log(
    `seed: rejects ${String(report.rejects.length)}, skipped links ${String(report.skippedLinks.length)}, run ${report.pipelineRunId}`,
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
