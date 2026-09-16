import { z } from 'zod';

import { ONTOLOGY_SCHEMA_VERSION } from './constants.js';
import { linkSchema, linkTypeDefinitions, type LinkTypeDefinition } from './link-types.js';
import { objectSchemas, objectTypeNameSchema } from './object-types.js';

type SchemaNode = z.core.JSONSchema.BaseSchema;

/**
 * The contract Python consumes. `PLAN.md` §7: Python services talk HTTP and never the
 * database, so this file is the entire shared surface between the two languages, and it
 * is committed rather than generated at install time — a contract you have to run a
 * build to see is not a contract anyone reads in review.
 *
 * Built here in the pure core rather than in the emit script so that it is ordinary
 * testable computation. The script's only job is `writeFile`.
 */
export type OntologyContract = {
  readonly $schema: string;
  readonly title: string;
  readonly description: string;
  readonly 'x-ontologyVersion': string;
  readonly 'x-linkTypes': readonly LinkTypeDefinition[];
  readonly $defs: Readonly<Record<string, SchemaNode>>;
};

/** `QUALITY_EVENT` → `QualityEvent`, so generated Python classes are named sensibly. */
function pascalCase(name: string): string {
  return name
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join('');
}

/**
 * Each call to `z.toJSONSchema` emits its own copy of the shared `$defs`. They must be
 * identical — they come from the same schema instances — so merging is safe, but a
 * mismatch would mean two different `Provenance` definitions silently overwriting each
 * other in one document. Cheap to check, and the failure would otherwise be invisible.
 */
function mergeShared(
  target: Record<string, SchemaNode>,
  additions: Record<string, SchemaNode> | undefined,
): void {
  for (const [name, definition] of Object.entries(additions ?? {})) {
    const existing = target[name];
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(definition)) {
      throw new Error(`contract: conflicting definitions emitted for $defs/${name}`);
    }
    target[name] = definition;
  }
}

/**
 * Emits one schema, lifting its `$defs` into the document-wide pool. The internal
 * `$ref`s Zod writes are already `#/$defs/<name>`, which resolves correctly once the
 * shared definitions sit at the document root.
 */
function emitInto(shared: Record<string, SchemaNode>, schema: z.ZodType): SchemaNode {
  const emitted: SchemaNode = { ...z.toJSONSchema(schema) };
  mergeShared(shared, emitted.$defs);

  // Both are document-level concerns that would be wrong repeated inside a $defs entry.
  delete emitted.$defs;
  delete emitted.$schema;
  return emitted;
}

export function buildContract(): OntologyContract {
  const shared: Record<string, SchemaNode> = {};
  const types: Record<string, SchemaNode> = {};

  // Driven by the enum rather than the schema map's key order, so the document's
  // ordering comes from the canonical list of object types.
  for (const name of objectTypeNameSchema.options) {
    // The canonical name is SUPPLIER while the $defs key is Supplier, so the mapping is
    // recorded rather than left for the consumer to infer from the casing —
    // x-linkTypes names its endpoints by the canonical name.
    types[pascalCase(name)] = {
      ...emitInto(shared, objectSchemas[name]),
      'x-objectType': name,
    };
  }

  types['Link'] = emitInto(shared, linkSchema);

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Sourcing ontology',
    description:
      'Generated from the Zod schemas in @sourcing/ontology by scripts/emit-contract.mjs. ' +
      'Do not edit by hand. The x- prefixed keys are extensions that JSON Schema tooling ignores.',
    'x-ontologyVersion': ONTOLOGY_SCHEMA_VERSION,
    'x-linkTypes': linkTypeDefinitions,

    // Shared definitions first so the file reads top-down: the vocabulary, then the
    // types that use it.
    $defs: { ...shared, ...types },
  };
}

/**
 * The single definition of the file's bytes, so the emit and the drift check cannot
 * disagree about formatting. Trailing newline and LF throughout, matching
 * `.gitattributes`.
 */
export function serializeContract(): string {
  return `${JSON.stringify(buildContract(), null, 2)}\n`;
}
