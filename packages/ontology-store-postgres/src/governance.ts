import {
  actionByName,
  AgentExecutionBlockedError,
  checkPreconditions,
  routingDecision,
  type ActionDefinition,
  type Actor,
  type AuditRecord,
  type ObjectMutation,
  type OntologyContext,
  type Tracked,
} from '@sourcing/ontology';
import type { Pool, PoolClient } from 'pg';

import { createPostgresContext } from './context.js';
import {
  addressAuditObjects,
  auditHistoryForObject,
  getAuditRecord,
  insertAuditRecord,
  updateAuditLifecycle,
  updateProperty,
  type Queryable,
} from './repository.js';

function isPool(db: Queryable): db is Pool {
  // PoolClient also has connect(); idleCount is the pool-only tell.
  return 'idleCount' in db;
}

async function inTransaction<T>(
  db: Queryable,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!isPool(db)) return run(db);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function stamp(tracked: Tracked<unknown>, auditId: string): Tracked<unknown> {
  return {
    ...tracked,
    confidence: 1,
    provenance: {
      method: 'HUMAN_ENTRY',
      sourceSystem: 'ACTION',
      sourceRecordId: auditId,
      extractedAt: new Date().toISOString(),
    },
  };
}

async function applyMutations(
  client: PoolClient,
  ctx: OntologyContext,
  mutations: readonly ObjectMutation[],
  auditId: string,
): Promise<{ before: unknown; after: unknown }> {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  for (const mutation of mutations) {
    const current = await ctx.getObject(mutation.objectType, mutation.id);
    before[mutation.id] = current ?? null;

    for (const [name, value] of Object.entries(mutation.properties)) {
      await updateProperty(
        client,
        mutation.objectType,
        mutation.id,
        name,
        stamp(value, auditId),
        'ACTION',
      );
    }

    after[mutation.id] = (await ctx.getObject(mutation.objectType, mutation.id)) ?? null;
  }

  return { before, after };
}

export type ProposeInput = {
  actionName: string;
  input: unknown;
  actor: Actor;
  justification: string;
};

export class UnknownAuditError extends Error {
  constructor(readonly id: string) {
    super(`no audit record ${id}`);
    this.name = 'UnknownAuditError';
  }
}

export async function proposeAction(
  db: Queryable,
  request: ProposeInput,
): Promise<AuditRecord> {
  return inTransaction(db, async (client) => {
    const ctx = createPostgresContext(client);
    const action = actionByName(request.actionName);
    const input = action.inputSchema.parse(request.input);
    await checkPreconditions(action, input, ctx);

    const policy = await action.approvalPolicy(input, ctx);
    const route = routingDecision(policy, request.actor.type);
    const mutations = await action.execute(input, ctx);
    const objectIds = mutations.map((mutation) => mutation.id);

    if (route === 'EXECUTE') {
      if (request.actor.type === 'AGENT') throw new AgentExecutionBlockedError();

      const audit = await insertAuditRecord(client, {
        actionName: action.name,
        actor: request.actor.id,
        actorType: request.actor.type,
        status: 'EXECUTED',
        justification: request.justification,
        inputPayload: input,
      });

      const { before, after } = await applyMutations(client, ctx, mutations, audit.id);
      await updateAuditLifecycle(client, audit.id, {
        status: 'EXECUTED',
        beforeState: before,
        afterState: after,
      });
      await addressAuditObjects(client, audit.id, objectIds);
      return { ...audit, status: 'EXECUTED', beforeState: before, afterState: after };
    }

    const audit = await insertAuditRecord(client, {
      actionName: action.name,
      actor: request.actor.id,
      actorType: request.actor.type,
      status: 'PROPOSED',
      justification: request.justification,
      inputPayload: input,
    });
    await addressAuditObjects(client, audit.id, objectIds);
    return audit;
  });
}

/**
 * Attempt to execute a proposed action without a human approval. Exists so the demo
 * and the tests can show the block as an application error rather than a CHECK
 * violation — the database would refuse it too.
 */
export async function executeProposedAs(
  db: Queryable,
  auditId: string,
  actor: Actor,
): Promise<AuditRecord> {
  if (actor.type === 'AGENT') throw new AgentExecutionBlockedError();
  return approveAction(db, { auditId, approver: actor, justification: 'auto' });
}

export async function approveAction(
  db: Queryable,
  request: { auditId: string; approver: Actor; justification: string },
): Promise<AuditRecord> {
  if (request.approver.type !== 'HUMAN') throw new AgentExecutionBlockedError();

  return inTransaction(db, async (client) => {
    const ctx = createPostgresContext(client);
    const found = await client.query<{
      action_name: string;
      status: string;
      input_payload: unknown;
    }>('SELECT action_name, status, input_payload FROM audit_records WHERE id = $1', [
      request.auditId,
    ]);
    const row = found.rows[0];
    if (row === undefined) throw new UnknownAuditError(request.auditId);
    if (row.status !== 'PROPOSED') {
      throw new Error(`audit ${request.auditId} is ${row.status}, not PROPOSED`);
    }

    const action: ActionDefinition<unknown> = actionByName(row.action_name);
    const input = action.inputSchema.parse(row.input_payload);
    await checkPreconditions(action, input, ctx);
    const mutations = await action.execute(input, ctx);

    const approvedAt = new Date().toISOString();
    const { before, after } = await applyMutations(client, ctx, mutations, request.auditId);

    await updateAuditLifecycle(client, request.auditId, {
      status: 'EXECUTED',
      approvedBy: request.approver.id,
      approvedAt,
      approverType: 'HUMAN',
      beforeState: before,
      afterState: after,
    });

    const updated = await getAuditRecord(client, request.auditId);
    if (updated === undefined) throw new UnknownAuditError(request.auditId);
    return updated;
  });
}

export async function objectAuditHistory(
  db: Queryable,
  objectId: string,
): Promise<readonly AuditRecord[]> {
  return auditHistoryForObject(db, objectId);
}
