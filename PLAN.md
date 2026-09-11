# Implementation Plan — Week 1

Companion to `ONTOLOGY.md`. That document is the design contract; this one is how we
build it, what we deliberately are not building, and why. Where the two disagree, this
document records the amendment explicitly (see §8).

Status: agreed, not yet scaffolded.

---

## 1. Week 1 scope

Five object types, five link types, two Actions.

**Objects:** `Supplier`, `Part`, `Device`, `Site`, `QualityEvent`

**Links:**

| Link | From → To |
|---|---|
| `SUPPLIES` | Supplier → Part |
| `COMPOSED_OF` | Device → Part |
| `MANUFACTURED_AT` | Device → Site |
| `AFFECTS_SUPPLIER` | QualityEvent → Supplier |
| `AFFECTS_PART` | QualityEvent → Part |

**Actions:** `approveSupplierChange` (human approval branch),
`flagPartForRequalification` (auto-apply branch)

Between them these two Actions exercise both halves of the governance model, which is
why a third is not needed to prove the thesis.

**The query that has to work:**

```
Supplier --SUPPLIES--> Part <--COMPOSED_OF-- Device --MANUFACTURED_AT--> Site
```

returning the path and its weakest confidence link.

---

## 2. Toolchain

- **Node 24 LTS** (`.nvmrc`), pnpm 12 workspaces, Turborepo 2. Node 20 was the original
  constraint, but it reached end-of-life in April 2026 — starting Week 1 on a runtime
  that receives no security patches is not a trade worth making for a governance
  platform.
- TypeScript strict, `NodeNext` module resolution, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, no `any`
- **TypeScript pinned to 5.9, not 7.** `typescript-eslint@8` peer-requires
  `typescript <6.1.0`, and type-aware lint rules are what make "no `any`" enforceable
  rather than aspirational. Losing typed linting costs more than being a major version
  behind. Revisit when typescript-eslint ships TS 7 support.
- Postgres 16 via Docker Compose — the only service in the compose file
- `pg` (node-postgres) with **no ORM**. EAV assembly and recursive-CTE traversal are
  hand-written SQL regardless; an ORM would add a mapping layer that models none of it.
- Fastify for `apps/api`
- Migrations are numbered plain `.sql` files applied by a ~30-line runner. No
  `node-pg-migrate`: with five fixed tables the dependency is not earned, and
  hand-written SQL stays readable to a reviewer.

---

## 3. Repository structure

```text
sourcing-ontology-platform/
├── ONTOLOGY.md                  # design contract
├── PLAN.md                      # this file
├── pnpm-workspace.yaml          # packages/*, apps/*, services/*
├── turbo.json
├── tsconfig.base.json
├── docker-compose.yml           # postgres:16-alpine
├── .nvmrc                       # 20
│
├── packages/
│   ├── ontology/                # @sourcing/ontology
│   └── ontology-store-postgres/ # @sourcing/ontology-store-postgres
│       ├── migrations/
│       └── seed/
│
├── apps/
│   └── api/                     # @sourcing/api
│
├── contracts/
│   └── ontology.schema.json     # build artifact, committed
│
└── services/                    # empty until Python arrives
```

Two packages, one app. Turbo tasks: `build`, `typecheck`, `test`, `lint`, `db:migrate`,
`db:seed`, `conformance`.

---

## 4. What lives where

### `@sourcing/ontology`

Pure. Only runtime dependency is `zod`. Contains:

- `Tracked<T>`, `Provenance`, and the confidence conventions
- Object and link type definitions, and their Zod schemas
- Path confidence algebra — **minimum along the path, never the product**
- `ActionDefinition`s with preconditions and `approvalPolicy`
- The `OntologyContext` interface, **declared here and implemented elsewhere**

That last point is the load-bearing one. Core declares the port rather than importing an
implementation, so the whole Action layer — preconditions, approval routing, the
agent-may-not-execute rule — is unit-testable against an in-memory adapter with no
database running.

Ships ESM with an `exports` map and generated `.d.ts`. `pnpm add @sourcing/ontology` in
a bare Node project yields types, validation and traversal math and pulls in no
Postgres, no HTTP, no React. This is what "consumable independently of the app" means
operationally, and it is a constraint the package's dependency list must keep proving.

Emits `contracts/ontology.schema.json` from its Zod schemas at build time.

### `@sourcing/ontology-store-postgres`

The only adapter, and the sole owner of DDL. Implements `OntologyContext`. Owns the
migrations, the seed script, transaction boundaries, and every write to
`object_properties`, `links` and `audit_records`. Migrations live inside this package
rather than a top-level `db/` so that exactly one component owns the physical schema.

### `apps/api`

Wires core to the store and exposes HTTP. Owns actor identity, so it is where
`actorType: 'HUMAN' | 'AGENT'` is established and where the rule that agents may propose
but never execute is enforced on the way in.

### `services/` (Python, later)

**Python services speak HTTP to `apps/api` and never touch Postgres.** A Python
extraction service with a database connection bypasses Actions, preconditions and audit
— which is the entire thesis. Routing it through the API makes "writes are governed" true
by construction rather than by discipline. Python services propose Actions with
`actorType: 'AGENT'`.

Turborepo orchestrates them via a thin `package.json` in each service directory whose
scripts shell out to `uv run pytest` and `uv run ruff check`. Turbo then caches and
graphs them without pnpm needing to understand Python.

The TS↔Python contract is `contracts/ontology.schema.json`. Python generates Pydantic
models from that artifact; it must not hand-redeclare `Tracked<T>` or `Provenance`,
because two hand-maintained definitions of the provenance envelope will drift.

---

## 5. Storage design

Six tables. Three are the ontology (`objects`, `object_properties`, `links`) and three
are governance (`audit_records`, `audit_record_objects`, `schema_versions`). A seventh,
`schema_migrations`, belongs to the migration runner rather than to the model.

### `objects` — identity only

`id` (canonical, survives future merges), `object_type`, `schema_version`, `created_at`.
No properties. Keeping identity separate from properties is what lets a merge later
repoint properties without rewriting identity.

### `object_properties` — the Tracked layer

Primary key `(object_id, property_name, ordinal)`. Then:

- `value jsonb` with a **`value_type` discriminator column** (`STRING`, `NUMBER`,
  `BOOLEAN`, `TIMESTAMP`). The discriminator is structural, not semantic: enums are
  stored as `STRING` and their membership is enforced by Zod, because a discriminator
  that tried to encode every enum would duplicate the type definitions it is meant to
  describe. Its job is telling a reader how to interpret the `jsonb` without consulting
  the schema.
- `confidence` via the `confidence_score` domain (`numeric(4,3)` bounded to 0–1).
  `numeric`, not float, because the verified-implies-1.0 constraint compares for exact
  equality and 1.0 is not reliably representable in binary floating point.
- Provenance **expanded into real columns**: `source_system`, `source_record_id`,
  `pipeline_run_id`, `extracted_at`, `method`. Five columns instead of one `jsonb` blob,
  which turns every lineage and calibration question into a plain `WHERE` — group
  confidence by `method` to check calibration, or find everything one
  `pipeline_run_id` touched in order to retract it.
- `verified_by`, `verified_at`

`confidence_score` and `provenance_method` are Postgres domains, because both appear
identically on `object_properties` and `links` and the confidence range rule should have
exactly one owner.

`ordinal` is how array properties are stored: one row per element, each with its own
confidence and provenance. This makes `Tracked<T>[]` free rather than a second storage
shape, so `certifications` keeps per-element provenance and `aliases` will slot in
unchanged when entity resolution arrives. Scalars are `ordinal = 0`.

**This table is current state, mutated in place.** History lives in `audit_records`
with before/after state. Making the property table append-only as well would create two
histories that can disagree.

#### Constraints

```sql
-- Human verification means certainty. A verified property cannot be probabilistic.
CHECK (verified_by IS NULL OR confidence = 1.0)

-- verified_by and verified_at are set together or not at all.
CHECK ((verified_by IS NULL) = (verified_at IS NULL))

-- The discriminator is checked against the jsonb it claims to describe, so it cannot
-- drift into decoration. This recovers the one piece of EAV type safety the database
-- can still give us. TIMESTAMP is checked only as far as "is a string" — format
-- validation stays with Zod, because two owners of a format rule is one too many.
CHECK (
       (value_type = 'STRING'    AND jsonb_typeof(value) = 'string')
    OR (value_type = 'NUMBER'    AND jsonb_typeof(value) = 'number')
    OR (value_type = 'BOOLEAN'   AND jsonb_typeof(value) = 'boolean')
    OR (value_type = 'TIMESTAMP' AND jsonb_typeof(value) = 'string')
)

-- Two provenance columns are conditionally required rather than always required. Both
-- are amendments to ONTOLOGY.md §2 — see §8.
CHECK (source_record_id IS NOT NULL OR method = 'INFERRED')
CHECK (pipeline_run_id  IS NOT NULL OR method = 'HUMAN_ENTRY')
```

`source_record_id` is null for `INFERRED` values because a value derived from other
tracked values has no raw source row. Overloading the column to sometimes mean "raw
source" and sometimes "the properties this was derived from" would give it two meanings,
which is worse than a null. Derivation tracking gets its own structure when `INFERRED`
values actually arrive. `pipeline_run_id` is null for `HUMAN_ENTRY` because a person
typing a value has no ingestion run, and synthesising one would corrupt the "everything
run X touched" retraction query.

#### Indexes

```sql
-- Low-confidence review queue: what a human should go look at next.
-- Partial, because verified rows are all confidence 1.0 and never belong in the queue,
-- which keeps the index proportional to the work outstanding rather than to the table.
CREATE INDEX object_properties_review_queue_idx
    ON object_properties (confidence) WHERE verified_by IS NULL;

-- The same index on links. Path confidence is the minimum along the path and link
-- confidence is usually what sets that minimum, so a review queue blind to links would
-- systematically hide the weakest evidence in the graph.
CREATE INDEX links_review_queue_idx
    ON links (confidence) WHERE verified_by IS NULL;
```

Object assembly — fetching every property of one object — is served by the primary key
on `(object_id, property_name, ordinal)`, whose leading-edge prefix already covers
lookups by `object_id` and by `(object_id, property_name)`. **No separate
`(object_id, property_name)` index is created**, because it would duplicate that prefix
and cost write throughput for no read benefit.

### `links` — relationships

`id`, `link_type`, `from_id`, `to_id`, `created_at`, unique on
`(link_type, from_id, to_id)`, plus the same confidence, expanded provenance, and
verification columns as `object_properties`.

**Link confidence is a column on `links`, not a row in `object_properties`.** Weakest-link
traversal is the platform's core read path; it must walk edges and accumulate
`LEAST(...)` without joining out to a property table per hop. This is the one place where
the uniform EAV treatment is deliberately not applied, and the reason is query
performance on the single query that matters most.

`links` also carries `CHECK (from_id <> to_id)`, since all five Week 1 link types join
different object types and a self-edge is the cheapest degenerate cycle to exclude, and
two directional indexes:

```sql
CREATE INDEX links_from_idx ON links (from_id, link_type);
CREATE INDEX links_to_idx   ON links (to_id, link_type);
```

Both are needed because traversal reads edges in both directions — the second hop of the
critical path runs against the arrow — and the `(link_type, from_id, to_id)` unique
index leads with `link_type` and so serves neither.

### `audit_records` and `schema_versions`

`audit_records` as specified in `ONTOLOGY.md` §5, append-only, never updated or deleted,
plus an `approver_type` column added in `003`. Beyond the constraints in `ONTOLOGY.md` it
carries the governance rules described in §6.5: an agent-proposed action cannot reach
`EXECUTED` without an approver, an `APPROVED` record must name its approver, and an
approver must be a human. `EXECUTED` without an approver stays legal, because that is
exactly the shape of a human-initiated action whose `approvalPolicy` returned `AUTO`.

`schema_versions` holds **exactly one row**, written by the migration that lands
alongside the object and link type definitions in `@sourcing/ontology`. It cannot be
written earlier: its `object_types`/`link_types` payload is produced by those
definitions, and inventing the `ObjectTypeDefinition` shape in SQL first would invert
the source of truth. Both columns are `NOT NULL`, so there is no state in which the row
exists with an empty payload.

`objects.schema_version` is a foreign key to `schema_versions(version)`, which means no
object can be inserted until that row exists. That is the intended gate.

### `audit_record_objects` — which objects a record touched

`ONTOLOGY.md` §5 gives `AuditRecord` no reference to the objects it mutated, only opaque
`beforeState`/`afterState` payloads, but §8 requires audit history to be queryable for
any object. A join table rather than an `object_id` column, because
`ActionDefinition.execute` returns `ObjectMutation[]` and one action may legitimately
mutate several objects.

Primary key `(audit_record_id, object_id)`, plus an index on `(object_id)` alone —
the primary key's prefix serves the forward direction, while object-scoped audit history
is the direction humans actually ask for.

Two limits worth knowing. `before_state` and `after_state` remain whole-action payloads,
so for a multi-object action you can find every record that touched an object but must
read the `jsonb` to see which slice applied to it; per-object before/after is a larger
change to `ONTOLOGY.md` §5 and neither Week 1 Action needs it. And "every audit record
addresses at least one object" needs a trigger or a deferred constraint to enforce in
the database, so the conformance check asserts it instead.

### `schema_migrations`

A sixth table, owned by the migration runner rather than by the ontology: it records
which `.sql` files have been applied, where `schema_versions` records which ontology
schema the data conforms to. Created by the runner with `CREATE TABLE IF NOT EXISTS` so
that `001` stays purely about the ontology.

### Traversal

One recursive CTE over `links`, accumulating the path as an array and confidence as a
running `LEAST(...)`, with cycle detection via the path array. Everything else in the
store package is plumbing around this query.

**The traversal takes a `maxDepth` parameter, default 6, and returns a `truncated` flag
when the cap was hit.** Cycle detection and depth capping solve different problems: the
path array stops a loop revisiting a node, but a dense BOM graph is acyclic and can still
fan out into a combinatorial result set. The flag matters as much as the cap — a
truncated risk answer that presents itself as complete is worse than an error, because
the missing devices are invisible.

---

## 6. Invariants

These are not conventions. They are the properties the system's claims rest on.

1. **Nothing writes to `object_properties` except through the repository layer in
   `@sourcing/ontology-store-postgres`.** EAV gives up database-level type constraints:
   Postgres cannot tell you that `legalName` on a `SUPPLIER` must be a string, or that
   `SUPPLIES` runs Supplier→Part. Zod validation at the ontology layer is therefore the
   *only* guarantee that the stored data conforms to the schema, and a guarantee with a
   bypass is not a guarantee. No direct SQL from `apps/api`, no ad-hoc `INSERT` in
   scripts, no database credentials outside the store package.

2. **A CI conformance check** runs against the seeded database and asserts that every
   property row and every link row validates against the definitions in
   `@sourcing/ontology`. This is the backstop for invariant 1 — it catches the exact
   class of drift that dropping DB-level type constraints admits.

   **It also fails if `schema_versions` is empty after migrations have run.** "Not yet
   written" and "never written" must not look the same: an unpopulated
   `schema_versions` is indistinguishable from a half-applied migration set, and the
   whole point of persisting the schema is that something checks it is there.

   **And it fails if any `audit_records` row addresses no object**, which the database
   cannot enforce without a trigger.

3. **The store package is the only holder of database credentials, enforced in CI.** A
   check fails the build if anything outside `@sourcing/ontology-store-postgres` imports
   `pg` or reads `DATABASE_URL` — including `apps/api` and every script. Invariant 1 is
   the system's only type guarantee, and an invariant with no enforcement is a
   convention: it survives exactly until the first deadline. This check is what makes it
   structural.

4. **Path confidence is the minimum along the path.** Never the product. Reporting the
   weakest link names the single fact a human needs to go verify; a product reports a
   number nobody can act on.

5. **Agents may propose Actions. Agents may never execute them.** Enforced in the
   database, not only at the API boundary:

   ```sql
   -- 002: an agent-proposed action cannot reach EXECUTED unapproved.
   CHECK (NOT (actor_type = 'AGENT' AND status = 'EXECUTED' AND approved_by IS NULL))

   -- 003: and the approver must be a human, not a second agent.
   CHECK ((approved_by IS NULL) = (approver_type IS NULL))
   CHECK (approved_by IS NULL OR approver_type = 'HUMAN')
   ```

   This is the strongest claim the platform makes, so it is structural rather than a
   boundary convention. An agent-proposed action that auto-executes with no human
   involved was executed by the agent in the only sense a regulator cares about;
   "the agent proposed it, the system executed it" dissolves the guarantee into a
   technicality.

   **How far this actually goes, so nobody over-trusts it.** `approver_type` turns an
   implicit assumption into an explicit claim recorded inside the immutable audit
   record: reaching `EXECUTED` requires the writer to assert on the record that a human
   approved, which makes a false claim a discoverable lie rather than a silent absence.
   It is not proof. The column records what the caller says the approver is, and
   `'AGENT'` is deliberately storable — if `'HUMAN'` were the only representable value
   the rejection could never fire and the model would quietly compel the lie. Making
   approver identity unforgeable requires it to be a stored fact rather than a claim,
   which is the `actors` table deferred in §10.

   **Consequence: `approvalPolicy` governs human-initiated actions only.** For
   `actorType: 'AGENT'` it is advisory at most. Nobody reading an `approvalPolicy` that
   returns `AUTO` should be able to conclude it applies to agents, so this has to be
   stated at the `ActionDefinition` type itself and not left to be rediscovered from
   the constraint.

6. **Every mutation writes an immutable `AuditRecord`** with before and after state, in
   the same transaction as the mutation.

7. **Reads are free. Writes are governed** — every mutation goes through an Action with
   preconditions and approval routing.

---

## 7. Decisions and reasoning

### Cut TypeScript codegen; keep only the JSON Schema emit

`ONTOLOGY.md` asks for a "typed TypeScript SDK generated from the schema". The
definitions already live in TypeScript in `@sourcing/ontology`, so the types are simply
there — generating them buys no additional type safety and costs a pipeline to maintain
forever. Codegen survives only as the `contracts/ontology.schema.json` emit, which
exists because Python genuinely cannot read TypeScript types.

### Cut generated DDL; verify instead of generate

Likewise for "Postgres tables generated from it". With the EAV model there is no
per-object-type DDL to generate at all — the five tables are fixed and adding an object
type adds no columns. What the schema needs to guarantee is *conformance*, which the CI
check in §6.2 provides. A generator would have produced a static result and then been
maintained indefinitely for it.

### Collapse the two approval knobs into one `approvalPolicy`

`requiresApproval` and `minimumConfidenceToAutoApply` overlap, and with
`confirmSupplierMerge` cut, nothing in Week 1 routes on confidence —
`flagPartForRequalification` routes on part criticality. A single
`approvalPolicy: (input, ctx) => 'AUTO' | 'REQUIRES_APPROVAL'` is strictly more
expressive than both fields and is one concept rather than two overlapping ones.

It applies to human-initiated actions only. Agent-proposed actions always require human
approval whatever the policy returns — see §6.5.

### `schema_versions` stays, the schema-versioning machine does not

`ONTOLOGY.md` §6 describes agent-proposed additive schema changes as reviewable diffs
scored by the eval suite. The Week 1 done criteria only require that the schema be
defined and persisted. The table is kept because its shape does not change when the rest
is built later; the diffing, the agent proposal path and the diff scoring are deferred.

### Cut `confirmSupplierMerge`

It reads as one Action but it depends on the entire entity resolution subsystem: merge
proposals must exist before they can be confirmed, which means a resolution pipeline, a
`merge_proposals` table, and canonical-ID-survives-merge machinery. The other two
Actions already demonstrate both the human-approval and auto-apply branches. Cutting it
also removes `aliases` and `mergedFrom` from Week 1.

### Cut `Contract` and `PurchaseOrder`

`Contract`'s `paymentTermsDays`, `priceEscalationClause` and `terminationRights` are all
LLM-extracted, so the object type pulls in a document extraction pipeline. Together the
two types also account for four of the nine link types. Dropping them leaves the critical
traversal, both Actions, audit and provenance fully intact. `QualityEvent` is kept
because it is a precondition input to both surviving Actions.

### Cut the eval package and any web app

With no LLM extraction in Week 1, confidence calibration has no subject — a
`golden/` fixtures directory is enough until the extraction pipeline exists. The done
criteria require audit history to be *queryable*, not viewable, so the API satisfies them
without a frontend.

### Packages deliberately not created

`ontology-actions` — Actions need the same `OntologyContext` port as traversal, so
splitting them buys a version-bump tax and no consumer benefit. `ontology-sdk` — see
codegen above. `ontology-eval` — see above. Shared `config`/`tsconfig` packages — a root
`tsconfig.base.json` is sufficient at this size. A shared `types` package — that is what
`@sourcing/ontology` is.

### Kept despite the pressure to cut

`Tracked<T>` on every property, because retrofitting provenance is the one thing that
genuinely cannot be done later. Minimum-confidence path semantics, a one-line difference
in SQL and a completely different product claim. The `HUMAN`/`AGENT` actor distinction, a
single check in one place. Immutable audit with before/after state, which is only honest
if it is present from the first mutation.

---

## 8. Amendments to `ONTOLOGY.md`

Recorded so the contract and the code do not silently diverge.

- §8, "Typed TypeScript SDK generated from the schema" → hand-written TypeScript in
  `@sourcing/ontology` plus a committed JSON Schema artifact for Python.
- §8, "Postgres tables generated from it" → reviewed migrations plus the CI conformance
  check in §6.2.
- §5, `requiresApproval` + `minimumConfidenceToAutoApply` → single `approvalPolicy`.
- §7, deliberate exclusions gains: entity resolution and supplier merge, `Contract`,
  `PurchaseOrder`, agent-proposed schema changes, confidence calibration eval.

- §2, `Provenance.pipelineRunId` is typed as a required `string`. It becomes
  **optional**, required for every method except `HUMAN_ENTRY`. A person typing a value
  has no ingestion run, and minting a synthetic one to satisfy the type would put fake
  rows into the "everything pipeline run X touched" retraction query — the one query
  that has to be trustworthy when a bad extraction needs rolling back. Enforced by
  `CHECK (pipeline_run_id IS NOT NULL OR method = 'HUMAN_ENTRY')`.

- §2, `Provenance.sourceRecordId` is typed as a required `string`. It becomes
  **optional**, required for every method except `INFERRED`. An inferred value is
  derived from other tracked values and has no raw row, document or page to point at.
  The rejected alternative was to let it point at the derivation instead, which would
  give one column two meanings — "raw source" for most rows and "the properties this
  came from" for inferred ones — and a column with two meanings is harder to reason
  about than a null. Derivation tracking gets a structure of its own when `INFERRED`
  values actually arrive. Enforced by
  `CHECK (source_record_id IS NOT NULL OR method = 'INFERRED')`.

Both amendments make `Tracked<T>`'s provenance envelope honest about methods that
genuinely lack a field, rather than requiring callers to invent values that then
pollute lineage queries.

- §5, `AuditRecord` has no reference to the objects it mutated, which leaves the §8
  requirement that audit history be queryable for any object with no path other than
  searching `jsonb`. Addressing is added out of band, in the `audit_record_objects`
  join table, so the `AuditRecord` type itself is unchanged.

- §5, `requiresApproval` semantics: **`approvalPolicy` governs human-initiated actions
  only.** An agent-proposed action always requires human approval, regardless of what
  the policy returns, and the database enforces it. See §6.5.

- §5, `AuditRecord` gains **`approverType?: 'HUMAN' | 'AGENT'`**, set together with
  `approvedBy` and constrained to `'HUMAN'` at approval time. Without it `approvedBy` is
  a bare identifier and the database can only enforce "somebody approved" rather than
  "a human approved".

---

## 9. Week 1 build checklist

**Workspace**

- [ ] `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.nvmrc`
- [ ] `docker-compose.yml` with `postgres:16-alpine`
- [ ] Turbo task graph: `build`, `typecheck`, `test`, `lint`, `db:migrate`, `db:seed`,
      `conformance`, `check:db-boundary`
- [ ] `check:db-boundary` — fails if anything outside the store package imports `pg` or
      reads `DATABASE_URL` (invariant 6.3)

**`@sourcing/ontology`**

- [ ] `Tracked<T>`, `Provenance`, confidence conventions
- [ ] Five object types and five link types, with Zod schemas
- [ ] `OntologyContext` port
- [ ] Minimum-confidence path algebra, unit-tested with no database
- [ ] `ActionDefinition` with preconditions and `approvalPolicy`
- [ ] `approveSupplierChange` — legal transitions; `APPROVED` requires valid ISO 13485
      and no open `CRITICAL` QualityEvent; requires approval
- [ ] `flagPartForRequalification` — requires a linked QualityEvent or supplier status
      change; approval for `CRITICAL`, auto-apply for `MINOR`
- [ ] In-memory `OntologyContext` for tests
- [ ] JSON Schema emit to `contracts/ontology.schema.json`

**`@sourcing/ontology-store-postgres`**

- [x] `001_init.sql`: `objects`, `object_properties`, `links`, `audit_records`,
      `schema_versions`, plus the `confidence_score` and `provenance_method` domains
- [x] Constraints: confidence range, verified⇒1.0, verified pair, value/value_type
      agreement, conditional `source_record_id` and `pipeline_run_id`, no self-edges
- [x] Partial `(confidence) WHERE verified_by IS NULL` index on both
      `object_properties` and `links`
- [x] Directional traversal indexes `links_from_idx` and `links_to_idx`
- [x] Migration runner over numbered `.sql` files, one transaction per file,
      idempotent via the `schema_migrations` ledger
- [x] `002_audit_governance.sql`: the `audit_record_objects` join table, the agent
      cannot-execute-unapproved constraint, and the approver-required constraint
- [x] `003_approver_identity.sql`: the `approver_type` column, paired with `approved_by`
      and constrained to `HUMAN`
- [ ] `004`: the single `schema_versions` row, which can only be written once the object
      and link type definitions exist in `@sourcing/ontology`
- [ ] Repository layer — sole writer, Zod validation on every write
- [ ] Object assembly: EAV rows → `Tracked<T>` objects, arrays via `ordinal`
- [ ] Recursive-CTE traversal with `LEAST(...)` accumulation and cycle detection
- [ ] `maxDepth` parameter defaulting to 6, with a `truncated` flag in the result
- [ ] Audit write in the same transaction as every mutation
- [ ] Audit history query for any object
- [ ] Seed: ~20 suppliers, ~60 parts, ~10 devices, 3 sites, plus quality events
- [ ] Conformance check over the seeded database, including a non-empty
      `schema_versions` assertion

**`apps/api`**

- [ ] Actor identity and `actorType` resolution
- [ ] Agents-cannot-execute enforcement
- [ ] Read endpoints: object by id, supplier → affected devices with path and weakest
      link
- [ ] Action propose / approve / reject endpoints
- [ ] Audit history endpoint
- [ ] Low-confidence review queue endpoint

**Done criteria (from `ONTOLOGY.md` §8, as amended)**

- [ ] Schema defined and persisted; Postgres tables in place
- [ ] Typed TypeScript access to the ontology
- [ ] Supplier → affected devices returns the path and its weakest confidence link
- [ ] Both Actions implemented with preconditions and approval routing
- [ ] Audit history queryable for any object
- [ ] Seed data thin but real

---

## 10. Deferred

An `actors` table with a `type` column, referenced by both `audit_records.actor` and
`audit_records.approved_by`, which would make actor and approver identity a stored fact
instead of a per-row claim and close the residual gap described in §6.5. Deferred
because it changes how identity works platform-wide, and `approver_type` gets most of
the value for one column.

Week 2+: entity resolution and `confirmSupplierMerge`; `Contract` and `PurchaseOrder`
with LLM clause extraction; the Python extraction service; confidence calibration eval
against a golden set; agent-proposed additive schema changes as scored diffs; the web
app. Out of scope per `ONTOLOGY.md` §7: inventory and lead times, multi-tenancy and RLS,
real-time streaming ingestion.

---

## 11. Open

Nothing. The two previously open items — HTTP framework and migration runner — are
resolved in §2.
