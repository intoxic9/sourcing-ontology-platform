import {
  linkInputSchema,
  objectSchemas,
  objectTypeDefinition,
  ONTOLOGY_SCHEMA_VERSION,
  type AuditRecord,
  type AuditStatus,
  type ActorType,
  type InMemoryGraph,
  type LinkInput,
  type ObjectOf,
  type ObjectTypeName,
  type Provenance,
  type PropertyDefinition,
  type Tracked,
} from '@sourcing/ontology';
import type { Pool, PoolClient } from 'pg';

/**
 * A pool or a single client. Conformance and any future multi-statement Action run
 * inside one transaction, which needs a single client rather than a pool.
 */
export type Queryable = Pool | PoolClient;

export async function assertSupportedSchema(db: Queryable): Promise<void> {
  const { rows } = await db.query<{ version: string }>('SELECT version FROM schema_versions');

  if (rows.length === 0) {
    throw new Error(
      'schema_versions is empty after migrations. "Not yet written" and "never written" must not look the same.',
    );
  }

  if (!rows.some((row) => row.version === ONTOLOGY_SCHEMA_VERSION)) {
    throw new Error(
      `schema_versions has no row for ${ONTOLOGY_SCHEMA_VERSION}; the store cannot write against an unknown schema.`,
    );
  }
}

/**
 * The sole writer (PLAN.md §6.1). EAV storage gives up database-level type constraints,
 * so Zod at this boundary is the only thing that makes a property row well-typed — and
 * a guarantee with a bypass is not a guarantee. Nothing else in the system writes to
 * `object_properties` or `links`.
 *
 * Validation runs on the way *out* as well. The same argument applies in reverse: rows
 * assembled back into an object are only known to be well-formed because something
 * checked them.
 */

const INSERT_OBJECT = `
    INSERT INTO objects (id, object_type, schema_version)
    VALUES ($1, $2, $3)
`;

const INSERT_PROPERTY = `
    INSERT INTO object_properties (
        object_id, property_name, ordinal,
        value, value_type, confidence,
        source_system, source_record_id, pipeline_run_id, extracted_at, method,
        verified_by, verified_at
    ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13)
`;

const INSERT_LINK = `
    INSERT INTO links (
        link_type, from_id, to_id, confidence,
        source_system, source_record_id, pipeline_run_id, extracted_at, method,
        verified_by, verified_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id
`;

/**
 * Splits provenance back into the column pair the schema stores it as. The
 * discriminated union is what makes this total: migration 004's biconditional CHECKs
 * reject exactly the combinations the union cannot express, so these two nulls are
 * never a guess.
 */
function provenanceColumns(provenance: Provenance): {
  sourceRecordId: string | null;
  pipelineRunId: string | null;
} {
  return {
    sourceRecordId: 'sourceRecordId' in provenance ? provenance.sourceRecordId : null,
    pipelineRunId: 'pipelineRunId' in provenance ? provenance.pipelineRunId : null,
  };
}

/** Rows for one property: a scalar is a single row at ordinal 0, an array is N rows. */
function propertyRows(
  definition: PropertyDefinition,
  raw: unknown,
): readonly Tracked<unknown>[] {
  if (definition.cardinality === 'MULTIPLE') return raw as readonly Tracked<unknown>[];
  if (raw === undefined) return [];
  return [raw as Tracked<unknown>];
}

export async function insertObject<T extends ObjectTypeName>(
  db: Queryable,
  objectType: T,
  data: ObjectOf<T>,
): Promise<void> {
  const parsed = objectSchemas[objectType].parse(data) as ObjectOf<T>;
  const asRecord = parsed as Record<string, unknown>;
  const id = asRecord['id'] as string;

  await db.query(INSERT_OBJECT, [id, objectType, ONTOLOGY_SCHEMA_VERSION]);

  for (const definition of objectTypeDefinition(objectType).properties) {
    const values = propertyRows(definition, asRecord[definition.name]);

    for (const [ordinal, tracked] of values.entries()) {
      const { sourceRecordId, pipelineRunId } = provenanceColumns(tracked.provenance);

      await db.query(INSERT_PROPERTY, [
        id,
        definition.name,
        ordinal,
        JSON.stringify(tracked.value),
        definition.valueType,
        tracked.confidence,
        tracked.provenance.sourceSystem,
        sourceRecordId,
        pipelineRunId,
        tracked.provenance.extractedAt,
        tracked.provenance.method,
        tracked.verification?.by ?? null,
        tracked.verification?.at ?? null,
      ]);
    }
  }
}

/** Returns the database-generated link id. */
export async function insertLink(db: Queryable, input: LinkInput): Promise<string> {
  const link = linkInputSchema.parse(input);
  const { sourceRecordId, pipelineRunId } = provenanceColumns(link.provenance);

  const result = await db.query<{ id: string }>(INSERT_LINK, [
    link.linkType,
    link.fromId,
    link.toId,
    link.confidence,
    link.provenance.sourceSystem,
    sourceRecordId,
    pipelineRunId,
    link.provenance.extractedAt,
    link.provenance.method,
    link.verification?.by ?? null,
    link.verification?.at ?? null,
  ]);

  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('link insert returned no id');
  return id;
}

const INSERT_AUDIT = `
    INSERT INTO audit_records (
        action_name, actor, actor_type, status, justification, input_payload,
        before_state, after_state, schema_version,
        approved_by, approved_at, approver_type
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11, $12)
    RETURNING id, proposed_at
`;

const UPDATE_AUDIT_LIFECYCLE = `
    UPDATE audit_records
       SET status = $2,
           approved_by = $3,
           approved_at = $4,
           approver_type = $5,
           before_state = $6::jsonb,
           after_state = $7::jsonb
     WHERE id = $1
`;

const INSERT_AUDIT_OBJECT = `
    INSERT INTO audit_record_objects (audit_record_id, object_id)
    VALUES ($1, $2)
    ON CONFLICT DO NOTHING
`;

const UPDATE_PROPERTY = `
    UPDATE object_properties
       SET value = $4::jsonb,
           value_type = $5,
           confidence = $6,
           source_system = $7,
           source_record_id = $8,
           pipeline_run_id = $9,
           extracted_at = $10,
           method = $11,
           verified_by = $12,
           verified_at = $13
     WHERE object_id = $1 AND property_name = $2 AND ordinal = $3
`;

const SELECT_AUDIT = `
    SELECT ar.id, ar.action_name, ar.actor, ar.actor_type, ar.proposed_at,
           ar.approved_by, ar.approved_at, ar.approver_type, ar.status,
           ar.justification, ar.input_payload, ar.before_state, ar.after_state,
           ar.schema_version
      FROM audit_records ar
     WHERE ar.id = $1
`;

const SELECT_AUDIT_FOR_OBJECT = `
    SELECT ar.id, ar.action_name, ar.actor, ar.actor_type, ar.proposed_at,
           ar.approved_by, ar.approved_at, ar.approver_type, ar.status,
           ar.justification, ar.input_payload, ar.before_state, ar.after_state,
           ar.schema_version
      FROM audit_records ar
      JOIN audit_record_objects aro ON aro.audit_record_id = ar.id
     WHERE aro.object_id = $1
     ORDER BY ar.proposed_at ASC, ar.id ASC
`;

type AuditRow = {
  id: string;
  action_name: string;
  actor: string;
  actor_type: ActorType;
  proposed_at: Date;
  approved_by: string | null;
  approved_at: Date | null;
  approver_type: ActorType | null;
  status: AuditStatus;
  justification: string;
  input_payload: unknown;
  before_state: unknown;
  after_state: unknown;
  schema_version: string;
};

function toAuditRecord(row: AuditRow): AuditRecord {
  return {
    id: row.id,
    actionName: row.action_name,
    actor: row.actor,
    actorType: row.actor_type,
    proposedAt: row.proposed_at.toISOString(),
    status: row.status,
    justification: row.justification,
    inputPayload: row.input_payload,
    beforeState: row.before_state,
    afterState: row.after_state,
    schemaVersion: row.schema_version,
    ...(row.approved_by === null ? {} : { approvedBy: row.approved_by }),
    ...(row.approved_at === null ? {} : { approvedAt: row.approved_at.toISOString() }),
    ...(row.approver_type === null ? {} : { approverType: row.approver_type }),
  };
}

export type AuditInsert = {
  actionName: string;
  actor: string;
  actorType: ActorType;
  status: AuditStatus;
  justification: string;
  inputPayload: unknown;
  beforeState?: unknown;
  afterState?: unknown;
  approvedBy?: string;
  approvedAt?: string;
  approverType?: ActorType;
};

export async function insertAuditRecord(
  db: Queryable,
  draft: AuditInsert,
): Promise<AuditRecord> {
  const result = await db.query<{ id: string; proposed_at: Date }>(INSERT_AUDIT, [
    draft.actionName,
    draft.actor,
    draft.actorType,
    draft.status,
    draft.justification,
    JSON.stringify(draft.inputPayload),
    draft.beforeState === undefined ? null : JSON.stringify(draft.beforeState),
    draft.afterState === undefined ? null : JSON.stringify(draft.afterState),
    ONTOLOGY_SCHEMA_VERSION,
    draft.approvedBy ?? null,
    draft.approvedAt ?? null,
    draft.approverType ?? null,
  ]);

  const row = result.rows[0];
  if (row === undefined) throw new Error('audit insert returned no id');

  return {
    id: row.id,
    actionName: draft.actionName,
    actor: draft.actor,
    actorType: draft.actorType,
    proposedAt: row.proposed_at.toISOString(),
    status: draft.status,
    justification: draft.justification,
    inputPayload: draft.inputPayload,
    beforeState: draft.beforeState ?? null,
    afterState: draft.afterState ?? null,
    schemaVersion: ONTOLOGY_SCHEMA_VERSION,
    ...(draft.approvedBy === undefined ? {} : { approvedBy: draft.approvedBy }),
    ...(draft.approvedAt === undefined ? {} : { approvedAt: draft.approvedAt }),
    ...(draft.approverType === undefined ? {} : { approverType: draft.approverType }),
  };
}

export async function updateAuditLifecycle(
  db: Queryable,
  id: string,
  patch: {
    status: AuditStatus;
    approvedBy?: string;
    approvedAt?: string;
    approverType?: ActorType;
    beforeState: unknown;
    afterState: unknown;
  },
): Promise<void> {
  await db.query(UPDATE_AUDIT_LIFECYCLE, [
    id,
    patch.status,
    patch.approvedBy ?? null,
    patch.approvedAt ?? null,
    patch.approverType ?? null,
    JSON.stringify(patch.beforeState),
    JSON.stringify(patch.afterState),
  ]);
}

export async function addressAuditObjects(
  db: Queryable,
  auditId: string,
  objectIds: readonly string[],
): Promise<void> {
  for (const objectId of objectIds) {
    await db.query(INSERT_AUDIT_OBJECT, [auditId, objectId]);
  }
}

export async function getAuditRecord(
  db: Queryable,
  id: string,
): Promise<AuditRecord | undefined> {
  const { rows } = await db.query<AuditRow>(SELECT_AUDIT, [id]);
  const row = rows[0];
  return row === undefined ? undefined : toAuditRecord(row);
}

export async function auditHistoryForObject(
  db: Queryable,
  objectId: string,
): Promise<readonly AuditRecord[]> {
  const { rows } = await db.query<AuditRow>(SELECT_AUDIT_FOR_OBJECT, [objectId]);
  return rows.map(toAuditRecord);
}

/**
 * Updates a single property row. `source: 'ACTION'` is the only writer allowed to
 * touch ACTION_ONLY properties; ingestion creates them via insertObject and cannot
 * change them afterwards.
 */
export async function updateProperty(
  db: Queryable,
  objectType: ObjectTypeName,
  objectId: string,
  propertyName: string,
  tracked: Tracked<unknown>,
  source: 'INGESTION' | 'ACTION',
): Promise<void> {
  const definition = objectTypeDefinition(objectType).properties.find(
    (property) => property.name === propertyName,
  );
  if (definition === undefined) {
    throw new Error(`${objectType} has no property ${propertyName}`);
  }
  if (definition.mutability === 'ACTION_ONLY' && source !== 'ACTION') {
    throw new Error(
      `${objectType}.${propertyName} is ACTION_ONLY; ingestion cannot change it`,
    );
  }

  const { sourceRecordId, pipelineRunId } = provenanceColumns(tracked.provenance);
  const result = await db.query(UPDATE_PROPERTY, [
    objectId,
    propertyName,
    0,
    JSON.stringify(tracked.value),
    definition.valueType,
    tracked.confidence,
    tracked.provenance.sourceSystem,
    sourceRecordId,
    pipelineRunId,
    tracked.provenance.extractedAt,
    tracked.provenance.method,
    tracked.verification?.by ?? null,
    tracked.verification?.at ?? null,
  ]);

  if (result.rowCount !== 1) {
    throw new Error(`expected to update 1 row for ${objectId}.${propertyName}, updated ${String(result.rowCount)}`);
  }
}

/**
 * Writes a fixture graph through the same functions that production writes go through.
 * The conformance check loads the shared fixture this way so a bypass around Zod cannot
 * accidentally make the two implementations agree.
 */
export async function insertGraph(db: Queryable, graph: InMemoryGraph): Promise<AuditRecord> {
  const objectIds = graph.objects.map((object) => object.data.id);

  for (const object of graph.objects) {
    await insertObject(db, object.objectType, object.data);
  }

  for (const link of graph.links) {
    const input: LinkInput = {
      linkType: link.linkType,
      fromId: link.fromId,
      toId: link.toId,
      confidence: link.confidence,
      provenance: link.provenance,
      ...(link.verification === undefined ? {} : { verification: link.verification }),
    };
    await insertLink(db, input);
  }

  // After the rows exist, so the join table's FK to objects can succeed. Same
  // transaction as the inserts when the caller opened one — which seed and the
  // tests do.
  const audit = await insertAuditRecord(db, {
    actionName: 'ingestGraph',
    actor: 'system-ingest',
    actorType: 'HUMAN',
    status: 'EXECUTED',
    justification: 'graph ingest',
    inputPayload: { objectIds, linkCount: graph.links.length },
    beforeState: null,
    afterState: { objectIds },
  });
  await addressAuditObjects(db, audit.id, objectIds);
  return audit;
}
