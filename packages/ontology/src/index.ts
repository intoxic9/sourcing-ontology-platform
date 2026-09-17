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
  linkInputSchema,
  linkSchema,
  linkTypeDefinitions,
  linkTypeNames,
  linkTypeNameSchema,
  objectTypeNames,
  type Link,
  type LinkCardinality,
  type LinkInput,
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

export {
  betterPath,
  canonicalTraversalResult,
  CERTAIN,
  collapseToTargets,
  makePath,
  pathConfidence,
  pathTarget,
  weakestLink,
  weakestStepIndex,
  type AffectedTarget,
  type Path,
  type PathNode,
  type PathStep,
  type StepDirection,
  type TraversalQuery,
  type TraversalResult,
} from './traversal.js';

export {
  assertValidTraversalProfile,
  objectTypeAfterStep,
  SUPPLIER_DEVICE_RISK,
  terminalObjectType,
  type PathPattern,
  type PathStepSpec,
  type TraversalProfile,
} from './profiles.js';

export { enumeratePatternPaths, type PatternWalkGraph } from './pattern-walk.js';

export {
  UnknownObjectError,
  MergedObjectError,
  type LinkQuery,
  type ObjectOf,
  type OntologyContext,
} from './context.js';

export {
  createInMemoryContext,
  type InMemoryGraph,
  type InMemoryObject,
} from './in-memory-context.js';

export {
  patternConformanceCases,
  sharedPartBridgeFixture,
  supplyChainFixture,
  type PatternConformanceCase,
} from './fixture.js';

export {
  AgentExecutionBlockedError,
  actorTypeSchema,
  auditStatusSchema,
  checkPreconditions,
  PreconditionsFailedError,
  routingDecision,
  type ActionDefinition,
  type Actor,
  type ActorType,
  type ApprovalDecision,
  type AuditRecord,
  type AuditStatus,
  type ObjectMutation,
  type ValidationResult,
} from './action.js';

export { actionByName, actions, type ActionName } from './actions.js';

export { approveSupplierChange, approveSupplierChangeInputSchema, type ApproveSupplierChangeInput, type SupplierStatus } from './approve-supplier-change.js';

export {
  confirmSupplierMerge,
  confirmSupplierMergeApprovalPolicy,
  confirmSupplierMergeInputSchema,
  validateConfirmSupplierMergePreconditions,
  type ConfirmSupplierMergeInput,
  type MergeProposal,
} from './confirm-supplier-merge.js';

export {
  flagPartForRequalification,
  flagPartForRequalificationInputSchema,
  type FlagPartForRequalificationInput,
} from './flag-part.js';

export { ONTOLOGY_SCHEMA_VERSION } from './constants.js';

export {
  assertReportMatchesManifest,
  buildIngestPlan,
  collapseWhitespace,
  emptyRejectCounts,
  emptySkippedLinkCounts,
  ingestRejectCodeSchema,
  ingestSkippedLinkCodeSchema,
  normalizeLegalNameForMatch,
  normalizeSourceKey,
  SAP_DEVICE_BOM,
  SAP_DEVICE_MASTER,
  SAP_MATERIAL_MASTER,
  SAP_SUPPLY_REL,
  SAP_VENDOR_MASTER,
  tallyRejects,
  tallySkippedLinks,
  vendorMasterRowSchema,
  materialMasterRowSchema,
  deviceMasterRowSchema,
  supplyRelationshipRowSchema,
  deviceBomRowSchema,
  week2ManifestSchema,
  type DataQualityReport,
  type ExpectedMergeCluster,
  type IngestCsvBundle,
  type IngestObjectIdResolver,
  type IngestPlan,
  type IngestRejectCode,
  type IngestSkippedLinkCode,
  type Week2Manifest,
} from './ingest/index.js';
