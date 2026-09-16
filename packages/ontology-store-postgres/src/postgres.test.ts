import {
  AgentExecutionBlockedError,
  supplyChainFixture,
  supplyChainQueries,
  UnknownObjectError,
  type InMemoryObject,
  type Tracked,
} from '@sourcing/ontology';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { compareFixtureTraversals } from './compare.js';
import { createPostgresContext } from './context.js';
import { loadDatabaseUrl } from './env.js';
import { approveAction, executeProposedAs, objectAuditHistory, proposeAction } from './governance.js';
import { insertGraph, updateProperty, type Queryable } from './repository.js';

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

describe.skipIf(databaseUrl === undefined)('postgres ontology store', () => {
  let pool!: Pool;

  beforeAll(() => {
    if (databaseUrl === undefined) {
      throw new Error('DATABASE_URL disappeared after skipIf');
    }
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('round-trips every fixture object, including arrays and absent optionals', async () => {
    await withTransaction(pool, async (client: Queryable) => {
      await insertGraph(client, supplyChainFixture);
      const ctx = createPostgresContext(client);

      for (const object of supplyChainFixture.objects) {
        const loaded = await ctx.getObject(object.objectType, object.data.id);
        expect(loaded).toStrictEqual(object.data);
      }

      const event = await ctx.getObject('QUALITY_EVENT', 'ev-1');
      expect(event?.closedAt).toBeUndefined();
    });
  });

  it('throws when the id exists as a different type', async () => {
    await withTransaction(pool, async (client: Queryable) => {
      await insertGraph(client, supplyChainFixture);
      const ctx = createPostgresContext(client);
      await expect(ctx.getObject('SUPPLIER', 'part-1')).rejects.toThrow(UnknownObjectError);
    });
  });

  it('returns undefined for an id that is not there', async () => {
    await withTransaction(pool, async (client: Queryable) => {
      const ctx = createPostgresContext(client);
      expect(await ctx.getObject('SUPPLIER', 'nope')).toBeUndefined();
    });
  });

  it('matches getLinks by either endpoint', async () => {
    await withTransaction(pool, async (client: Queryable) => {
      await insertGraph(client, supplyChainFixture);
      const ctx = createPostgresContext(client);
      const links = await ctx.getLinks({ objectId: 'part-1' });
      expect(
        links.map((link) => `${link.linkType}:${link.fromId}->${link.toId}`).sort(),
      ).toStrictEqual([
        'COMPOSED_OF:dev-1->part-1',
        'SUPPLIES:sup-1->part-1',
        'SUPPLIES:sup-2->part-1',
      ]);
    });
  });

  it('throws on an unknown traversal source', async () => {
    await withTransaction(pool, async (client: Queryable) => {
      const ctx = createPostgresContext(client);
      await expect(
        ctx.traverse({
          from: { objectType: 'SUPPLIER', id: 'ghost' },
          to: 'DEVICE',
          via: ['SUPPLIES'],
        }),
      ).rejects.toThrow(UnknownObjectError);
    });
  });

  it('refuses a query that can cross nothing', async () => {
    await withTransaction(pool, async (client: Queryable) => {
      await insertGraph(client, supplyChainFixture);
      const ctx = createPostgresContext(client);
      await expect(
        ctx.traverse({
          from: { objectType: 'SUPPLIER', id: 'sup-1' },
          to: 'DEVICE',
          via: [],
        }),
      ).rejects.toThrow(RangeError);
    });
  });

  it('agrees with the in-memory context on every shared query, including truncated and pathCount', async () => {
    await withTransaction(pool, async (client: Queryable) => {
      const compared = await compareFixtureTraversals(client);
      expect(compared).toBe(supplyChainQueries.length);
    });
  });

  it('writes an ingest audit that addresses every object in the same transaction', async () => {
    await withTransaction(pool, async (client: Queryable) => {
      const audit = await insertGraph(client, supplyChainFixture);
      expect(audit.status).toBe('EXECUTED');
      const trail = await objectAuditHistory(client, 'sup-1');
      expect(trail.map((record) => record.id)).toContain(audit.id);
    });
  });

  it('blocks an agent from executing and then applies the change when a human approves', async () => {
    await withTransaction(pool, async (client: Queryable) => {
      await insertGraph(client, {
        objects: [...supplyChainFixture.objects, provisionalSupplier()],
        links: supplyChainFixture.links,
      });

      const proposed = await proposeAction(client, {
        actionName: 'approveSupplierChange',
        input: {
          supplierId: 'sup-prov',
          toStatus: 'APPROVED',
          justification: 'certs in date',
        },
        actor: { id: 'agent-risk-1', type: 'AGENT' },
        justification: 'certs in date',
      });
      expect(proposed.status).toBe('PROPOSED');

      await expect(
        executeProposedAs(client, proposed.id, { id: 'agent-risk-1', type: 'AGENT' }),
      ).rejects.toThrow(AgentExecutionBlockedError);

      const ctx = createPostgresContext(client);
      expect((await ctx.getObject('SUPPLIER', 'sup-prov'))?.status.value).toBe('PROVISIONAL');

      const executed = await approveAction(client, {
        auditId: proposed.id,
        approver: { id: 'k.novak', type: 'HUMAN' },
        justification: 'approved',
      });
      expect(executed.status).toBe('EXECUTED');
      expect(executed.approverType).toBe('HUMAN');
      expect((await ctx.getObject('SUPPLIER', 'sup-prov'))?.status.value).toBe('APPROVED');

      const trail = await objectAuditHistory(client, 'sup-prov');
      expect(trail.map((record) => record.status)).toContain('EXECUTED');
    });
  });

  it('refuses an ingestion write to an ACTION_ONLY property', async () => {
    await withTransaction(pool, async (client: Queryable) => {
      await insertGraph(client, supplyChainFixture);
      const tracked: Tracked<string> = {
        value: 'SUSPENDED',
        confidence: 1,
        provenance: {
          method: 'HUMAN_ENTRY',
          sourceSystem: 'SAP',
          sourceRecordId: 'x',
          extractedAt: '2026-01-15T09:30:00.000Z',
        },
      };
      await expect(
        updateProperty(client, 'SUPPLIER', 'sup-1', 'status', tracked, 'INGESTION'),
      ).rejects.toThrow(/ACTION_ONLY/);
    });
  });
});

function provisionalSupplier(): InMemoryObject {
  const tracked = <const T>(value: T): Tracked<T> => ({
    value,
    confidence: 1,
    provenance: {
      method: 'DIRECT',
      sourceSystem: 'SAP',
      sourceRecordId: 'rec-1',
      pipelineRunId: 'run-1',
      extractedAt: '2026-01-15T09:30:00.000Z',
    },
  });

  return {
    objectType: 'SUPPLIER',
    data: {
      id: 'sup-prov',
      legalName: tracked('Provisional GmbH'),
      country: tracked('DE'),
      tier: tracked('TIER_1'),
      status: tracked('PROVISIONAL'),
      qualityRating: tracked(80),
      certifications: [tracked('ISO 13485')],
    },
  };
}
