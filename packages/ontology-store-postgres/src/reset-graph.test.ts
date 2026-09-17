import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadDatabaseUrl } from './env.js';
import { runWeek2Ingest } from './ingest/run-week2-ingest.js';
import type { Queryable } from './repository.js';
import { truncateOntologyData } from './reset-graph.js';

const databaseUrl = loadDatabaseUrl();

async function withTransaction(
  pool: Pool,
  run: (client: PoolClient) => Promise<void>,
): Promise<void> {
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

async function tableCount(db: Queryable, table: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${table}`,
  );
  return Number(rows[0]?.count ?? 0);
}

describe.skipIf(databaseUrl === undefined)('truncateOntologyData', () => {
  let pool!: Pool;

  beforeAll(() => {
    if (databaseUrl === undefined) throw new Error('DATABASE_URL missing');
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('clears a post-ingest database with ingestion_runs, audit rows, and merge proposals', async () => {
    await withTransaction(pool, async (client: Queryable) => {
      await truncateOntologyData(client);

      await runWeek2Ingest(client, {
        pipelineRunId: 'truncate-order-test',
        extractedAt: '2026-09-17T12:00:00.000Z',
      });

      const { rows: suppliers } = await client.query<{ id: string }>(
        `SELECT id FROM objects WHERE object_type = 'SUPPLIER' ORDER BY id LIMIT 2`,
      );
      const survivor = suppliers[0]?.id;
      const duplicate = suppliers[1]?.id;
      expect(survivor).toBeDefined();
      expect(duplicate).toBeDefined();

      const { rows: audits } = await client.query<{ id: string }>(
        'SELECT id FROM audit_records LIMIT 1',
      );
      const auditId = audits[0]?.id;
      expect(auditId).toBeDefined();

      await client.query(
        `INSERT INTO merge_proposals (
            survivor_id, duplicate_id, score, features, status,
            pipeline_run_id, resolved_at, resolution_audit_id
         ) VALUES ($1, $2, 0.88, '{}'::jsonb, 'CONFIRMED', 'truncate-order-test', now(), $3)`,
        [survivor, duplicate, auditId],
      );

      expect(await tableCount(client, 'objects')).toBeGreaterThan(0);
      expect(await tableCount(client, 'ingestion_runs')).toBe(1);
      expect(await tableCount(client, 'audit_records')).toBeGreaterThan(0);
      expect(await tableCount(client, 'merge_proposals')).toBe(1);

      await truncateOntologyData(client);

      expect(await tableCount(client, 'objects')).toBe(0);
      expect(await tableCount(client, 'object_properties')).toBe(0);
      expect(await tableCount(client, 'links')).toBe(0);
      expect(await tableCount(client, 'object_source_keys')).toBe(0);
      expect(await tableCount(client, 'merge_proposals')).toBe(0);
      expect(await tableCount(client, 'audit_record_objects')).toBe(0);
      expect(await tableCount(client, 'ingestion_runs')).toBe(0);
      expect(await tableCount(client, 'audit_records')).toBe(0);
    });
  });
});
