import {
  canonicalTraversalResult,
  createInMemoryContext,
  linkTypeDefinitions,
  objectTypeDefinitions,
  ONTOLOGY_SCHEMA_VERSION,
  patternConformanceCases,
} from '@sourcing/ontology';

import { createPostgresContext } from './context.js';
import { assertSupportedSchema, insertGraph, type Queryable } from './repository.js';
import { truncateOntologyData } from './reset-graph.js';

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`).join(',')}}`;
}

export async function compareFixtureTraversals(db: Queryable): Promise<number> {
  const postgres = createPostgresContext(db);

  for (const [index, conformanceCase] of patternConformanceCases.entries()) {
    await truncateOntologyData(db);

    const memory = createInMemoryContext(conformanceCase.fixture);
    await insertGraph(db, conformanceCase.fixture);

    const [fromMemory, fromPostgres] = await Promise.all([
      memory.traverse(conformanceCase.query),
      postgres.traverse(conformanceCase.query),
    ]);

    const expected = canonicalTraversalResult(fromMemory);
    const actual = canonicalTraversalResult(fromPostgres);

    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      throw new Error(
        `traversal mismatch at case[${String(index)}] ${conformanceCase.name}\n` +
          `memory:\n${JSON.stringify(expected, null, 2)}\n` +
          `postgres:\n${JSON.stringify(actual, null, 2)}`,
      );
    }
  }

  return patternConformanceCases.length;
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

  if (stable(row.object_types) !== stable(objectTypeDefinitions)) {
    throw new Error('schema_versions.object_types does not match objectTypeDefinitions');
  }
  if (stable(row.link_types) !== stable(linkTypeDefinitions)) {
    throw new Error('schema_versions.link_types does not match linkTypeDefinitions');
  }
}
