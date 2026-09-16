import {
  linkInputSchema,
  objectSchemas,
  objectTypeDefinition,
  ONTOLOGY_SCHEMA_VERSION,
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

/**
 * Writes a fixture graph through the same functions that production writes go through.
 * The conformance check loads the shared fixture this way so a bypass around Zod cannot
 * accidentally make the two implementations agree.
 */
export async function insertGraph(db: Queryable, graph: InMemoryGraph): Promise<void> {
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
}
