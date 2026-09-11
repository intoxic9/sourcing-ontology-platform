# Sourcing Ontology — Schema Design (v0.1)

A semantic and kinetic layer over medical device sourcing data. This document is the
design contract for Week 1. Everything else in the platform sits on top of it.

---

## 1. Design principles

1. **Every property carries provenance and confidence.** No value enters the ontology
   without knowing where it came from and how much we trust it. Retrofitting this is
   expensive, so it is in the base type from day one.
2. **Reads are free, writes are governed.** Traversal and querying are unrestricted.
   Every mutation goes through an Action with validation, optional approval, and an
   immutable audit record.
3. **The schema is versioned data, not code.** Object types are stored, versioned, and
   diffable, so the adaptive agent can propose changes as reviewable artifacts.
4. **Links are first-class.** Relationships are typed, directional, and carry their own
   confidence, because an inferred link is weaker evidence than a declared one.

---

## 2. Core primitive: the tracked property

Every scalar property on every object is wrapped:

```ts
type Provenance = {
  sourceSystem: string;        // "SAP_VENDOR_MASTER", "CONTRACT_PDF", "ENTITY_RESOLUTION"
  sourceRecordId: string;      // pointer back to the raw row / document / page
  pipelineRunId: string;       // which ingestion run produced this
  extractedAt: string;         // ISO timestamp
  method: 'DIRECT' | 'FUZZY_MATCH' | 'LLM_EXTRACTION' | 'HUMAN_ENTRY' | 'INFERRED';
};

type Tracked<T> = {
  value: T;
  confidence: number;          // 0.0 - 1.0
  provenance: Provenance;
  verifiedBy?: string;         // set when a human confirms; confidence -> 1.0
  verifiedAt?: string;
};
```

Confidence conventions:

| Method            | Typical range | Notes                                        |
|-------------------|---------------|----------------------------------------------|
| `DIRECT`          | 1.0           | Read straight from a system of record        |
| `HUMAN_ENTRY`     | 1.0           | Entered or verified by a person              |
| `FUZZY_MATCH`     | 0.5 - 0.95    | Entity resolution merge score                |
| `LLM_EXTRACTION`  | 0.4 - 0.95    | Model-reported, must be calibration-checked  |
| `INFERRED`        | 0.3 - 0.8     | Derived from other tracked values            |

**Calibration is an eval target, not an assumption.** A model claiming 0.9 must be right
about 90% of the time on the golden set, or the score is recalibrated.

---

## 3. Object types

### Supplier
| Property | Type | Notes |
|---|---|---|
| `id` | `string` | Internal canonical ID (survives merges) |
| `legalName` | `Tracked<string>` | |
| `aliases` | `Tracked<string>[]` | Populated by entity resolution |
| `duns` | `Tracked<string>` | Strong identity key when present |
| `country` | `Tracked<string>` | |
| `tier` | `Tracked<'TIER_1' \| 'TIER_2' \| 'TIER_3'>` | |
| `status` | `Tracked<'APPROVED' \| 'PROVISIONAL' \| 'SUSPENDED' \| 'DISQUALIFIED'>` | Only mutable via Action |
| `qualityRating` | `Tracked<number>` | |
| `certifications` | `Tracked<string>[]` | e.g. ISO 13485 |
| `mergedFrom` | `string[]` | Source record IDs collapsed into this supplier |

### Part
| Property | Type | Notes |
|---|---|---|
| `id` | `string` | |
| `partNumber` | `Tracked<string>` | |
| `description` | `Tracked<string>` | |
| `classification` | `Tracked<'DIRECT_MATERIAL' \| 'COMPONENT' \| 'SUBASSEMBLY'>` | |
| `criticality` | `Tracked<'CRITICAL' \| 'MAJOR' \| 'MINOR'>` | Drives risk weighting |
| `requiresRequalification` | `Tracked<boolean>` | Set via Action |
| `unitCost` | `Tracked<number>` | |

### Device
Finished product. `id`, `deviceName`, `productFamily`,
`regulatoryClass` (`CLASS_I | CLASS_II | CLASS_III`), `lifecycleStage`.

### Site
Manufacturing location. `id`, `siteName`, `country`, `siteType`.

### Contract
| Property | Type | Notes |
|---|---|---|
| `id` | `string` | |
| `contractNumber` | `Tracked<string>` | |
| `effectiveDate` / `expiryDate` | `Tracked<string>` | |
| `paymentTermsDays` | `Tracked<number>` | LLM-extracted |
| `priceEscalationClause` | `Tracked<string>` | LLM-extracted |
| `terminationRights` | `Tracked<string>` | LLM-extracted |
| `isSingleSource` | `Tracked<boolean>` | High risk signal |
| `regulatoryObligations` | `Tracked<string>[]` | |
| `sourceDocumentUri` | `string` | Not tracked; it is the evidence itself |

### PurchaseOrder
`id`, `poNumber`, `orderDate`, `promisedDate`, `quantity`, `unitPrice`, `status`.

### QualityEvent
`id`, `eventType` (`AUDIT_FINDING | NONCONFORMANCE | COMPLAINT | RECALL`),
`severity` (`CRITICAL | MAJOR | MINOR`), `openedAt`, `closedAt`, `description`.

---

## 4. Link types

Links are typed and carry their own `Tracked` confidence.

| Link | From → To | Cardinality |
|---|---|---|
| `SUPPLIES` | Supplier → Part | many-to-many |
| `COMPOSED_OF` | Device → Part | many-to-many (the BOM) |
| `MANUFACTURED_AT` | Device → Site | many-to-many |
| `GOVERNED_BY` | Supplier → Contract | one-to-many |
| `COVERS` | Contract → Part | many-to-many |
| `ORDERED_FROM` | PurchaseOrder → Supplier | many-to-one |
| `ORDERS` | PurchaseOrder → Part | many-to-one |
| `AFFECTS_SUPPLIER` | QualityEvent → Supplier | many-to-one |
| `AFFECTS_PART` | QualityEvent → Part | many-to-many |

**The critical traversal path** the risk agent walks:

```
Supplier --SUPPLIES--> Part <--COMPOSED_OF-- Device --MANUFACTURED_AT--> Site
```

Confidence of a path = the **minimum** confidence along it, not the product. We report
the weakest link because that is the fact a human needs to go verify.

---

## 5. Actions (the kinetic layer)

```ts
type ActionDefinition<TInput> = {
  name: string;
  inputSchema: ZodSchema<TInput>;
  preconditions: (input: TInput, ctx: OntologyContext) => ValidationResult;
  requiresApproval: boolean;
  minimumConfidenceToAutoApply?: number;
  execute: (input: TInput, ctx: OntologyContext) => ObjectMutation[];
};
```

Every invocation writes an immutable `AuditRecord`:

```ts
type AuditRecord = {
  id: string;
  actionName: string;
  actor: string;
  actorType: 'HUMAN' | 'AGENT';        // agents may propose, never auto-execute
  proposedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  status: 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'EXECUTED';
  justification: string;
  inputPayload: unknown;
  beforeState: unknown;
  afterState: unknown;
  schemaVersion: string;
};
```

### Week 1 Actions to implement

1. **`approveSupplierChange`** — moves `Supplier.status`.
   Preconditions: supplier exists; target transition is legal; if moving to `APPROVED`,
   supplier must hold a valid ISO 13485 certification and have no open `CRITICAL`
   QualityEvent. Requires approval. Agents may propose only.

2. **`flagPartForRequalification`** — sets `Part.requiresRequalification`.
   Preconditions: part exists; a linked QualityEvent or supplier status change justifies
   it. Requires approval for `CRITICAL` parts, auto-applies for `MINOR`.

3. **`confirmSupplierMerge`** — accepts or rejects a proposed entity resolution merge.
   Preconditions: both records exist and are unmerged. Auto-applies above 0.95
   confidence, requires human approval below it. Every confirmed merge becomes a
   golden eval case.

---

## 6. Schema versioning

Object type definitions live in a `schema_versions` table, not only in code.

```ts
type SchemaVersion = {
  version: string;             // semver
  objectTypes: ObjectTypeDefinition[];
  linkTypes: LinkTypeDefinition[];
  appliedAt: string;
  appliedVia: 'MIGRATION' | 'AGENT_PROPOSAL';
  auditRecordId?: string;      // set when an agent proposal drove the change
};
```

This is what lets the adaptive agent propose additive schema changes (new property, new
link type) as reviewable diffs scored by the eval suite. Additive changes only in v1.
Destructive changes stay human-authored migrations.

---

## 7. Deliberate exclusions for v1

- Inventory levels and lead times. Real, but they pull the project toward planning
  optimization and away from the governed-ontology thesis.
- Multi-tenancy and row-level security.
- Real-time streaming ingestion. Batch is enough to prove the pattern.

---

## 8. Week 1 done criteria

- [ ] Schema defined and persisted; Postgres tables generated from it
- [ ] Typed TypeScript SDK generated from the schema
- [ ] Traversal works: supplier → affected devices, returning the path and its weakest
      confidence link
- [ ] All three Actions implemented with preconditions and approval routing
- [ ] Audit history queryable for any object
- [ ] Seed data thin but real: ~20 suppliers, ~60 parts, ~10 devices, 3 sites
