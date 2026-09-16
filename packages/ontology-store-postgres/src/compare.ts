import {
  canonicalTraversalResult,
  createInMemoryContext,
  linkTypeDefinitions,
  objectTypeDefinitions,
  ONTOLOGY_SCHEMA_VERSION,
  supplyChainFixture,
  supplyChainQueries,
} from '@sourcing/ontology';

import { createPostgresContext } from './context.js';
import { assertSupportedSchema, insertGraph, type Queryable } from './repository.js';

/**
 * jsonb does not preserve key insertion order, so a string comparison against the
 * TypeScript object would fail for a payload that is structurally identical. Sorted
 * keys make the comparison structural, which is what PLAN.md §6.2 asked for.
 */
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`).join(',')}}`;
}

/**
 * Runs the shared fixture through both implementations and throws on the first
 * `TraversalResult` that disagrees, including `truncated` and `pathCount`.
 *
 * One function, two callers (`postgres.test.ts` and `conformance.ts`), so a mismatch
 * cannot be "caught in tests" and "missed in CI" depending on which copy someone
 * updated.
 */
export async function compareFixtureTraversals(db: Queryable): Promise<number> {
  const memory = createInMemoryContext(supplyChainFixture);
  await insertGraph(db, supplyChainFixture);
  const postgres = createPostgresContext(db);

  for (const [index, query] of supplyChainQueries.entries()) {
    const [fromMemory, fromPostgres] = await Promise.all([
      memory.traverse(query),
      postgres.traverse(query),
    ]);

    const expected = canonicalTraversalResult(fromMemory);
    const actual = canonicalTraversalResult(fromPostgres);

    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      throw new Error(
        `traversal mismatch at query[${String(index)}] ${JSON.stringify(query)}\n` +
          `memory:\n${JSON.stringify(expected, null, 2)}\n` +
          `postgres:\n${JSON.stringify(actual, null, 2)}`,
      );
    }
  }

  return supplyChainQueries.length;
}

export async function assertSchemaPayload(db: Queryable): Promise<void> {
  await assertSupportedSchema(db);

  const { rows } = await db.query<{
    version: string;
    object_types: unknown;
    link_types: unknown;
  }>('SELECT version, object_types, link_types FROM schema_versions WHERE version = $1', [
    ONTOLOGY_SCHEMA_VERSION,
  ]);

  const row = rows[0];
  if (row === undefined) {
    throw new Error(`schema_versions has no row for ${ONTOLOGY_SCHEMA_VERSION}`);
  }

  // Structural: jsonb normalises key order, so a string comparison against the SQL
  // literal would produce false failures. The stored row is what actually matters.
  if (stable(row.object_types) !== stable(objectTypeDefinitions)) {
    throw new Error('schema_versions.object_types does not match objectTypeDefinitions');
  }
  if (stable(row.link_types) !== stable(linkTypeDefinitions)) {
    throw new Error('schema_versions.link_types does not match linkTypeDefinitions');
  }
}
