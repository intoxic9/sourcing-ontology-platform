/**
 * @sourcing/ontology — the pure ontology core.
 *
 * Dependency budget: zod, and nothing else. No database driver, no HTTP framework, no
 * Node globals. That budget is the feature: it is what lets the Action layer, the
 * preconditions and the minimum-confidence path algebra be tested with no Postgres
 * running, and what makes this package consumable on its own. See PLAN.md §4.
 *
 * This package declares the `OntologyContext` port; `@sourcing/ontology-store-postgres`
 * implements it. The dependency arrow never points the other way.
 */

export {
  confidenceSchema,
  evidenceShape,
  provenanceMethodSchema,
  provenanceSchema,
  timestampSchema,
  tracked,
  VERIFIED_IMPLIES_CERTAIN_MESSAGE,
  verificationSchema,
  verifiedImpliesCertain,
  type Provenance,
  type ProvenanceMethod,
  type Tracked,
  type Verification,
} from './tracked.js';

export {
  deviceSchema,
  objectSchemas,
  objectTypeNameSchema,
  partSchema,
  qualityEventSchema,
  siteSchema,
  supplierSchema,
  type Device,
  type ObjectTypeName,
  type Part,
  type QualityEvent,
  type Site,
  type Supplier,
} from './object-types.js';

export {
  linkCardinalitySchema,
  linkSchema,
  linkTypeDefinitions,
  linkTypeNames,
  linkTypeNameSchema,
  objectTypeNames,
  type Link,
  type LinkCardinality,
  type LinkTypeDefinition,
  type LinkTypeName,
} from './link-types.js';

export {
  deriveObjectTypeDefinition,
  objectTypeDefinition,
  objectTypeDefinitions,
  type Cardinality,
  type Mutability,
  type ObjectTypeDefinition,
  type PropertyDefinition,
  type ValueType,
} from './definition.js';

export { buildContract, serializeContract, type OntologyContract } from './contract.js';

export { DEFAULT_MAX_TRAVERSAL_DEPTH, ONTOLOGY_SCHEMA_VERSION } from './constants.js';
