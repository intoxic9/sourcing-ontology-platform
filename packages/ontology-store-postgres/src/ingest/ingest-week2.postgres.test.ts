import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assertReportMatchesManifest, SAP_VENDOR_MASTER } from '@sourcing/ontology';

import { loadDatabaseUrl } from '../env.js';
import type { Queryable } from '../repository.js';
import { ingestObjectId } from './object-id.js';
import { loadWeek2Manifest, runWeek2Ingest } from './run-week2-ingest.js';

const databaseUrl = loadDatabaseUrl();

async function withTransaction(pool: Pool, run: (client: PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await run(client);
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

describe.skipIf(databaseUrl === undefined)('Week 2 ingest pipeline', () => {
  let pool!: Pool;

  beforeAll(() => {
    if (databaseUrl === undefined) throw new Error('DATABASE_URL missing');
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('persists ingested suppliers with opaque ids and source keys', async () => {
    await withTransaction(pool, async (client: Queryable) => {
      const manifest = await loadWeek2Manifest();
      const { report } = await runWeek2Ingest(client, {
        pipelineRunId: 'test-week2-ingest-1',
        extractedAt: '2026-09-17T04:00:00.000Z',
      });
      assertReportMatchesManifest(report, manifest.expectedDataQuality);

      const helixId = ingestObjectId(SAP_VENDOR_MASTER, manifest.demoRoles.helixSurvivorSourceKey);
      const { rows } = await client.query<{ object_type: string }>(
        'SELECT object_type FROM objects WHERE id = $1',
        [helixId],
      );
      expect(rows[0]?.object_type).toBe('SUPPLIER');

      const keys = await client.query<{ source_key: string }>(
        `SELECT source_key FROM object_source_keys
          WHERE source_system = $1 AND object_id = $2`,
        [SAP_VENDOR_MASTER, helixId],
      );
      expect(keys.rows.map((row) => row.source_key)).toContain(
        manifest.demoRoles.helixSurvivorSourceKey,
      );
    });
  });

  it('records ingestion_runs summary with reject tallies', async () => {
    await withTransaction(pool, async (client: Queryable) => {
      const manifest = await loadWeek2Manifest();
      const pipelineRunId = 'test-week2-ingest-2';
      const { report } = await runWeek2Ingest(client, {
        pipelineRunId,
        extractedAt: '2026-09-17T04:00:00.000Z',
      });

      const { rows } = await client.query<{ summary: { rejectsByCode: Record<string, number> } }>(
        'SELECT summary FROM ingestion_runs WHERE id = $1',
        [pipelineRunId],
      );
      expect(rows[0]?.summary.rejectsByCode.VENDOR_INVALID_TIER).toBe(
        manifest.expectedDataQuality.rejectsByCode.VENDOR_INVALID_TIER,
      );
      expect(report.rejectsByCode).toStrictEqual(manifest.expectedDataQuality.rejectsByCode);
    });
  });
});
