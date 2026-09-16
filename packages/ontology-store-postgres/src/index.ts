/**
 * @sourcing/ontology-store-postgres — the only `OntologyContext` adapter, the sole
 * owner of DDL, and the only holder of database credentials.
 *
 * Two invariants converge on this package (PLAN.md §6):
 *
 *   1. Nothing writes to `object_properties` except through the repository layer here.
 *      The EAV model gives up database-level type constraints, so Zod validation on the
 *      way in is the *only* guarantee that stored rows match the schema.
 *   2. No code outside this package imports `pg` or reads `DATABASE_URL`. Enforced by
 *      `pnpm check:db-boundary`, because an unenforced invariant is a convention.
 */
import { ONTOLOGY_SCHEMA_VERSION } from '@sourcing/ontology';

/**
 * The ontology schema version this store's migrations are written against. Checked
 * against the single `schema_versions` row on connect so a version skew surfaces as a
 * startup failure rather than as silently malformed writes.
 */
export const SUPPORTED_SCHEMA_VERSION: string = ONTOLOGY_SCHEMA_VERSION;

export { createPostgresContext } from './context.js';
export {
  approveAction,
  executeProposedAs,
  objectAuditHistory,
  proposeAction,
} from './governance.js';
export {
  assertSupportedSchema,
  auditHistoryForObject,
  insertGraph,
  insertLink,
  insertObject,
  updateProperty,
  type Queryable,
} from './repository.js';
