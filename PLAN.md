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

- Node 20 (`.nvmrc`), pnpm workspaces, Turborepo
- TypeScript strict, `NodeNext` module resolution, `noUncheckedIndexedAccess`, no `any`
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
`object_property`, `links` and `audit_records`. Migrations live inside this package
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

Five tables. Three are the ontology, two are governance.

### `objects` — identity only

`id` (canonical, survives future merges), `object_type`, `schema_version`, `created_at`.
No properties. Keeping identity separate from properties is what lets a merge later
repoint properties without rewriting identity.

### `object_property` — the Tracked layer

Primary key `(object_id, property_name, ordinal)`. Then:

- `value jsonb` with a **`value_type` discriminator column** (`STRING`, `NUMBER`,
  `BOOLEAN`, `TIMESTAMP`). The discriminator is structural, not semantic: enums are
  stored as `STRING` and their membership is enforced by Zod, because a discriminator
  that tried to encode every enum would duplicate the type definitions it is meant to
  describe. Its job is telling a reader how to interpret the `jsonb` without consulting
  the schema.
- `confidence numeric(4,3)`, `CHECK (confidence >= 0 AND confidence <= 1)`
- Provenance **expanded into real columns**: `source_system`, `source_record_id`,
  `pipeline_run_id`, `extracted_at`, `method`. Five columns instead of one `jsonb` blob,
  which turns every lineage and calibration question into a plain `WHERE` — group
  confidence by `method` to check calibration, or find everything one
  `pipeline_run_id` touched in order to retract it.
- `verified_by`, `verified_at`

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
```

#### Indexes

```sql
-- Low-confidence review queue: what a human should go look at next.
-- Partial, because verified rows are all confidence 1.0 and never belong in the queue,
-- which keeps the index proportional to the work outstanding rather than to the table.
CREATE INDEX ... ON object_property (confidence) WHERE verified_by IS NULL;
```

Object assembly — fetching every property of one object — is served by the primary key
on `(object_id, property_name, ordinal)`, whose leading-edge prefix already covers
lookups by `object_id` and by `(object_id, property_name)`. **No separate
`(object_id, property_name)` index is created**, because it would duplicate that prefix
and cost write throughput for no read benefit.

### `links` — relationships

`id`, `link_type`, `from_id`, `to_id`, `created_at`, unique on
`(link_type, from_id, to_id)`, plus the same confidence, expanded provenance, and
verification columns as `object_property`.

**Link confidence is a column on `links`, not a row in `object_property`.** Weakest-link
traversal is the platform's core read path; it must walk edges and accumulate
`LEAST(...)` without joining out to a property table per hop. This is the one place where
the uniform EAV treatment is deliberately not applied, and the reason is query
performance on the single query that matters most.

### `audit_records` and `schema_versions`

`audit_records` as specified in `ONTOLOGY.md` §5, append-only, never updated or deleted.

`schema_versions` holds **exactly one row, written by migration**. The table stays
because it is cheap and because audit records will eventually point at it, but nothing in
Week 1 writes a second row.

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

1. **Nothing writes to `object_property` except through the repository layer in
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

3. **The store package is the only holder of database credentials, enforced in CI.** A
   check fails the build if anything outside `@sourcing/ontology-store-postgres` imports
   `pg` or reads `DATABASE_URL` — including `apps/api` and every script. Invariant 1 is
   the system's only type guarantee, and an invariant with no enforcement is a
   convention: it survives exactly until the first deadline. This check is what makes it
   structural.

4. **Path confidence is the minimum along the path.** Never the product. Reporting the
   weakest link names the single fact a human needs to go verify; a product reports a
   number nobody can act on.

5. **Agents may propose Actions. Agents may never execute them.** Enforced at the API
   boundary where actor identity is established.

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

- [ ] Migration: `objects`, `object_property`, `links`, `audit_records`,
      `schema_versions`
- [ ] Constraints: confidence range, verified⇒1.0, verified pair
- [ ] Partial index on `(confidence) WHERE verified_by IS NULL`
- [ ] Single `schema_versions` row written by migration
- [ ] Repository layer — sole writer, Zod validation on every write
- [ ] Object assembly: EAV rows → `Tracked<T>` objects, arrays via `ordinal`
- [ ] Recursive-CTE traversal with `LEAST(...)` accumulation and cycle detection
- [ ] `maxDepth` parameter defaulting to 6, with a `truncated` flag in the result
- [ ] Audit write in the same transaction as every mutation
- [ ] Audit history query for any object
- [ ] Seed: ~20 suppliers, ~60 parts, ~10 devices, 3 sites, plus quality events
- [ ] Conformance check over the seeded database

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

Week 2+: entity resolution and `confirmSupplierMerge`; `Contract` and `PurchaseOrder`
with LLM clause extraction; the Python extraction service; confidence calibration eval
against a golden set; agent-proposed additive schema changes as scored diffs; the web
app. Out of scope per `ONTOLOGY.md` §7: inventory and lead times, multi-tenancy and RLS,
real-time streaming ingestion.

---

## 11. Open

Nothing. The two previously open items — HTTP framework and migration runner — are
resolved in §2.
